/**
 * Port of the vote-tallying half of `Werewolf.cs`'s `LynchCycle` (the timer
 * loop and Telegram menus are application/infrastructure concerns - this is
 * only "given who everyone voted for, who gets lynched").
 *
 * Vote semantics mirror the original: `choice === null` means "hasn't voted
 * yet", `choice === -1n` means "explicitly abstained" (both are ignored when
 * tallying).
 */

import { ROLE_BIT } from '../roles/role.js';
import { killPlayer } from './kill.js';
import { declareWinner } from './win-condition.js';
import { getTeamForRole } from './team.js';
import type { GameEvent } from './game-event.js';
import { ABSTAIN, alivePlayers, type Player } from './player.js';
import {
  lynchAbstentions,
  lynchBotVotes,
  lynchVotesCast,
} from '../../infrastructure/monitoring/metrics.js';

/** @deprecated use `ABSTAIN` from `player.ts` - kept as an alias so existing imports keep working. */
export const SKIP_VOTE = ABSTAIN;

export type LynchResolution =
  | { outcome: 'Lynched'; playerId: bigint }
  | { outcome: 'PrinceSurvived'; playerId: bigint }
  | { outcome: 'JudgePardoned'; playerId: bigint; judgeId: bigint }
  | { outcome: 'TannerWinByLynch'; playerId: bigint }
  | { outcome: 'Tied'; tiedPlayerIds: bigint[] }
  | { outcome: 'NoVotes' }
  | { outcome: 'PacifistPeace' };

export interface LynchOptions {
  /** 1 on the first vote of the day, 2 on a forced re-vote (e.g. triggered by the Troublemaker). */
  lynchAttempt: number;
  /** Mirrors `Settings.RandomLynch`: pick one of the tied players at random instead of ending in a tie. */
  randomLynchOnTie?: boolean;
  /** If Judge exercised Droit de Grâce */
  judgePardon?: boolean;
  judgeId?: bigint;
  random?: () => number;
  /** Mirrors `Game.avengerTargetMap` (avengerId -> their secret rival's id, assigned at game
   * start) - the Avenger's win condition ("if that rival is executed by village lynch vote")
   * needs it, since the target lives here rather than on the Avenger's own `Player` record. */
  avengerTargetMap?: ReadonlyMap<bigint, bigint>;
  /** `Game.dayNumber` at the time of this vote - only used by mission-mode tracking (the
   * "Prophète" mission cares specifically about a Day 1 vote), tallying itself doesn't need it. */
  dayNumber?: number;
}

/** One cast lynch vote, kept for the AI-narrated Gazette (see `generateAiGazette()`) - `targetId:
 * null` means an explicit abstain. Not used by tallying itself, only accumulated on `Game.voteLog`
 * for a post-game narrative to draw on. */
export interface VoteLogEntry {
  day: number;
  voterId: bigint;
  targetId: bigint | null;
}

export interface LynchResult {
  resolution: LynchResolution;
  events: GameEvent[];
  voteLog: VoteLogEntry[];
}

/** Clears votes/choices at the start of a fresh voting round (mirrors the top of `LynchCycle`'s loop body). */
export function resetLynchState(players: readonly Player[]): void {
  for (const p of players) {
    p.choice = null;
    p.votedBy.clear();
    p.votes = 0;
  }
}

/**
 * Read-only preview of who the vote currently condemns, without mutating `players` or resolving
 * anything - `p.votes` only gets its real value once `resolveLynchVotes` below actually tallies,
 * so a caller that needs to know the outcome *before* that (e.g. the Judge's pardon prompt, which
 * has to fire once the timer ends but before the lynch is finalized) can't just read `p.votes`
 * directly - reads back whatever the *last* resolved round left there, not this one's live
 * `choice`s. Mirrors `resolveLynchVotes`'s own tally math (the Mayor's double vote, the Crow's
 * curse) so the two never disagree about who's tied.
 */
export function previewLynchTally(players: readonly Player[]): {
  tied: bigint[];
  maxVotes: number;
} {
  const votes = new Map<bigint, number>();
  for (const voter of alivePlayers(players)) {
    if (voter.choice === null || voter.choice === ABSTAIN) continue;
    const weight = voter.role === ROLE_BIT.Mayor && voter.hasUsedAbility ? 2 : 1;
    votes.set(voter.choice, (votes.get(voter.choice) ?? 0) + weight);
  }
  for (const p of players) {
    if (p.isCursedByCrow) votes.set(p.id, (votes.get(p.id) ?? 0) + 2);
  }
  const maxVotes = Math.max(0, ...votes.values());
  const tied = [...votes.entries()]
    .filter(([, v]) => v === maxVotes && maxVotes > 0)
    .map(([id]) => id);
  return { tied, maxVotes };
}

/**
 * Rolls the Clumsy Guy's 50% chance of fumbling their vote onto a random living player instead
 * of whoever they actually clicked. Called immediately when the vote is cast (see
 * `Game.resolveClumsyGuyVote()`), not deferred until the lynch resolves - so `voter.choice`
 * already holds the true target by the time anything (the live group announcement, the Judge's
 * pardon-prompt preview, `resolveLynchVotes` below) reads it. No-op for anyone else, or for an
 * abstain (fumbling never applies to abstains).
 */
export function resolveClumsyGuyVote(
  voter: Player,
  players: readonly Player[],
  random: () => number = Math.random,
): void {
  if (voter.role !== ROLE_BIT.ClumsyGuy || voter.choice === null || voter.choice === ABSTAIN) {
    return;
  }
  if (Math.floor(random() * 100) < 50) {
    const original = voter.choice;
    const alive = players.filter((p) => !p.isDead && p.id !== voter.id);
    if (alive.length > 0) {
      voter.choice = alive[Math.floor(random() * alive.length)]!.id;
    }
    if (voter.choice === original) voter.clumsyCorrectLynchCount++;
  } else {
    voter.clumsyCorrectLynchCount++;
  }
}

/**
 * Tallies votes, applies idle-kills for players who failed to vote twice in a
 * row (on the first attempt only), and resolves the lynch. Mutates `players`
 * in place.
 */
export function resolveLynchVotes(players: Player[], options: LynchOptions): LynchResult {
  const events: GameEvent[] = [];
  const voteLog: VoteLogEntry[] = [];
  const random = options.random ?? Math.random;
  const day = options.dayNumber ?? 0;

  for (const voter of alivePlayers(players)) {
    if (voter.choice !== null && voter.choice !== ABSTAIN) {
      lynchVotesCast.inc();
      if (voter.isBot) lynchBotVotes.inc();
      voteLog.push({ day, voterId: voter.id, targetId: voter.choice });
      const target = players.find((x) => x.id === voter.choice);
      if (target) {
        target.votes++;
        target.votedBy.add(voter.id);
        target.everVotedAgainstBy.add(voter.id);
        target.hasBeenVoted = true;

        if (voter.role === ROLE_BIT.Mayor && voter.hasUsedAbility) {
          target.votes++;
          voter.mayorLynchAfterRevealCount++;
        }

        // Mission-mode tracking (see `src/domain/game/missions.ts`) - who they voted for, not
        // whether that vote turned out to be the majority (that's resolved further below, once
        // the final tally is known).
        if (getTeamForRole(target.role) === 'Wolf') voter.everVotedForWolf = true;
        if (getTeamForRole(target.role) !== getTeamForRole(voter.role)) {
          voter.everVotedOppositeCamp = true;
          if (options.dayNumber === 1) voter.votedOppositeCampDay1 = true;
        }
      }
      voter.nonVoteCount = 0;
    } else {
      if (voter.choice === ABSTAIN) {
        lynchAbstentions.inc();
        voter.abstainCount++;
        voteLog.push({ day, voterId: voter.id, targetId: null });
      } else {
        voter.everMissedVote = true;
      }
      if (options.lynchAttempt < 2) {
        voter.nonVoteCount++;
        if (voter.nonVoteCount >= 2) {
          events.push(
            ...killPlayer(players, voter.id, 'Idle', {
              killerIds: [voter.id],
              isNight: false,
              triggerHunterShot: false,
            }),
          );
        }
      }
    }
  }

  // Apply Crow curse (+2 penalty votes) - a one-shot hex that only affects the *next* lynching
  // (see `resolveCrowNight` in night-resolution.ts), so it's cleared again right after applying it.
  players.forEach((p) => {
    if (p.isCursedByCrow) {
      p.votes += 2;
      p.isCursedByCrow = false;
    }
  });

  const maxVotes = Math.max(0, ...players.map((p) => p.votes));
  const tied = players.filter((p) => p.votes === maxVotes && maxVotes > 0);

  // Mission-mode tracking: did this round's vote match whoever ended up with the most votes -
  // regardless of whether that round actually results in a lynch (a tie, a Prince/Judge save).
  if (maxVotes > 0) {
    const topTargetIds = new Set(tied.map((p) => p.id));
    for (const voter of alivePlayers(players)) {
      if (voter.choice === null || voter.choice === ABSTAIN) continue;
      if (topTargetIds.has(voter.choice)) voter.majorityVoteCount++;
      else voter.minorityVoteCount++;
    }
  }

  let lynched: Player | undefined;
  let resolution: LynchResolution;

  if (players.every((p) => p.votes === 0)) {
    resolution = { outcome: 'NoVotes' };
  } else if (tied.length > 1) {
    if (options.randomLynchOnTie) {
      lynched = tied[Math.floor(random() * tied.length)];
      resolution = { outcome: 'Lynched', playerId: lynched!.id };
    } else {
      resolution = { outcome: 'Tied', tiedPlayerIds: tied.map((p) => p.id) };
      for (const p of tied)
        if (p.role === ROLE_BIT.Tanner || p.role === ROLE_BIT.Jester) p.soClose = true;
    }
  } else {
    lynched = tied[0];
    resolution = { outcome: 'Lynched', playerId: lynched!.id };
  }

  if (lynched && resolution.outcome === 'Lynched') {
    if (options.judgePardon && options.judgeId) {
      const judge = players.find((p) => p.id === options.judgeId);
      if (judge) judge.hasUsedAbility = true;
      resolution = { outcome: 'JudgePardoned', playerId: lynched.id, judgeId: options.judgeId };
    } else if (lynched.role === ROLE_BIT.Prince && !lynched.hasUsedAbility) {
      lynched.hasUsedAbility = true;
      resolution = { outcome: 'PrinceSurvived', playerId: lynched.id };
    } else {
      const killerIds = alivePlayers(players)
        .filter((p) => p.choice === lynched!.id)
        .map((p) => p.id);
      for (const killerId of killerIds) {
        const killer = players.find((p) => p.id === killerId);
        if (killer) killer.everVotedForLynchedVictim = true;
      }
      events.push(...killPlayer(players, lynched.id, 'Lynch', { killerIds, isNight: false }));

      // Jester lynch victory
      if (lynched.role === ROLE_BIT.Jester) {
        lynched.won = true;
        events.push(declareWinner(players, 'Tanner'));
        if (killerIds.length > 0) {
          const randomVoterId = killerIds[Math.floor(random() * killerIds.length)]!;
          events.push(
            ...killPlayer(players, randomVoterId, 'Lynch', {
              killerIds: [lynched.id],
              isNight: false,
            }),
          );
        }
      }

      // Avenger rival goal check
      players
        .filter((p) => !p.isDead && p.role === ROLE_BIT.Avenger)
        .forEach((avenger) => {
          if (options.avengerTargetMap?.get(avenger.id) === lynched!.id) {
            avenger.won = true;
            events.push({
              type: 'AvengerRivalLynched',
              avengerId: avenger.id,
              targetId: lynched!.id,
            });
          }
        });

      if (
        lynched.role === ROLE_BIT.Tanner &&
        alivePlayers(players).every((p) => p.choice === lynched!.id)
      ) {
        lynched.tannerOverkill = true;
      }

      if (lynched.role === ROLE_BIT.Tanner) {
        lynched.diedLastNight = true; // marks which Tanner should be credited with the win
        events.push(declareWinner(players, 'Tanner'));
        resolution = { outcome: 'TannerWinByLynch', playerId: lynched.id };
      }
    }
  }

  // Mission-mode tracking: anyone who was at the top of the tally this round and is still alive
  // right now escaped it - whether via a tie that wasn't randomly broken, a Prince/Judge save, or
  // simply not being the one who ended up dying. Checked last, after `killPlayer` above has had
  // its chance to actually kill the lynched target.
  if (maxVotes > 0) {
    for (const p of tied) {
      if (!p.isDead) p.escapedTopVoteLynchCount++;
    }
  }

  return { resolution, events, voteLog };
}
