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
import type { GameEvent } from './game-event.js';
import { alivePlayers, type Player } from './player.js';

export const SKIP_VOTE = -1n;

export type LynchResolution =
  | { outcome: 'Lynched'; playerId: bigint }
  | { outcome: 'PrinceSurvived'; playerId: bigint }
  | { outcome: 'TannerWinByLynch'; playerId: bigint }
  | { outcome: 'Tied'; tiedPlayerIds: bigint[] }
  | { outcome: 'NoVotes' };

export interface LynchOptions {
  /** 1 on the first vote of the day, 2 on a forced re-vote (e.g. triggered by the Troublemaker). */
  lynchAttempt: number;
  /** Mirrors `Settings.RandomLynch`: pick one of the tied players at random instead of ending in a tie. */
  randomLynchOnTie?: boolean;
  random?: () => number;
}

export interface LynchResult {
  resolution: LynchResolution;
  events: GameEvent[];
}

/** Clears votes/choices at the start of a fresh voting round (mirrors the top of `LynchCycle`'s loop body). */
export function resetLynchState(players: readonly Player[]): void {
  for (const p of players) {
    p.votedBy.clear();
    p.votes = 0;
  }
}

/**
 * Tallies votes, applies idle-kills for players who failed to vote twice in a
 * row (on the first attempt only), and resolves the lynch. Mutates `players`
 * in place.
 */
export function resolveLynchVotes(players: Player[], options: LynchOptions): LynchResult {
  const events: GameEvent[] = [];
  const random = options.random ?? Math.random;

  for (const voter of alivePlayers(players)) {
    if (voter.choice !== null && voter.choice !== SKIP_VOTE) {
      const target = players.find((x) => x.id === voter.choice);
      if (target) {
        target.votes++;
        target.votedBy.add(voter.id);

        if (voter.role === ROLE_BIT.Mayor && voter.hasUsedAbility) {
          target.votes++;
        }
      }
      voter.nonVoteCount = 0;
    } else if (options.lynchAttempt < 2) {
      voter.nonVoteCount++;
      if (voter.nonVoteCount >= 2) {
        events.push(...killPlayer(players, voter.id, 'Idle', { killerIds: [voter.id], isNight: false, triggerHunterShot: false }));
      }
    }
  }

  const maxVotes = Math.max(0, ...players.map((p) => p.votes));
  const tied = players.filter((p) => p.votes === maxVotes && maxVotes > 0);

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
    }
  } else {
    lynched = tied[0];
    resolution = { outcome: 'Lynched', playerId: lynched!.id };
  }

  if (lynched && resolution.outcome === 'Lynched') {
    if (lynched.role === ROLE_BIT.Prince && !lynched.hasUsedAbility) {
      lynched.hasUsedAbility = true;
      resolution = { outcome: 'PrinceSurvived', playerId: lynched.id };
    } else {
      const killerIds = alivePlayers(players)
        .filter((p) => p.choice === lynched!.id)
        .map((p) => p.id);
      events.push(...killPlayer(players, lynched.id, 'Lynch', { killerIds, isNight: false }));

      if (lynched.role === ROLE_BIT.Tanner) {
        lynched.diedLastNight = true; // marks which Tanner should be credited with the win
        events.push(declareWinner(players, 'Tanner'));
        resolution = { outcome: 'TannerWinByLynch', playerId: lynched.id };
      }
    }
  }

  return { resolution, events };
}
