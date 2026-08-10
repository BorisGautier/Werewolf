/**
 * Port of `Werewolf.cs`'s `NightCycle` resolution phase (after the menu
 * timer expires) - the part of the original that decides, for the night
 * just past, who the Seer saw, who the Wolves ate, who got frozen, etc.
 *
 * This is intentionally NOT a set of independent per-role functions: the
 * original resolves roles in a fixed order and several of them read/mutate
 * *the same* shared local state as they go (most notably the Guardian
 * Angel's protection target, which can be nulled out mid-resolution if the
 * GA itself gets frozen by the Snow Wolf). `NightState` below is that shared
 * state, threaded through each step in the same order the original uses.
 *
 * Ported so far: Snow Wolf, Arsonist, Wolves. Everything else in the
 * documented priority order (Grave Digger, Serial Killer, Cultist Hunter,
 * Cult, Chemist, Harlot, Seer, Sorcerer, Fool, Oracle, Augur, Guardian
 * Angel, Thief, plus the day-1-only/passive roles) is tracked separately and
 * still to come - see the project's task list.
 */

import { ROLE_BIT } from '../roles/role.js';
import { WOLF_ROLES } from './game-balancing.js';
import { killPlayer } from './kill.js';
import { ABSTAIN, SPARK, type Player } from './player.js';
import { visitPlayer, graveDiggerDetectionChance, type VisitContext } from './night-visit.js';
import { promoteToWolf } from './transform.js';
import type { GameEvent } from './game-event.js';

/**
 * Cross-role mutable state for a single night's resolution.
 *
 * `guardianAngel`: the Guardian Angel, if alive and they chose a protection
 * target tonight (mirrors the original's `ga` local) - reassigned to `null`
 * mid-resolution if the GA gets frozen (their protection no longer applies
 * to later steps).
 *
 * `lastGraveDigAt`/`secondLastGraveDigAt`: mirror the original's
 * `lastGrave`/`secondLastGrave` instance fields (persisted on `Game` across
 * nights, not reset each night) - the Grave Digger's "graves dug" count is
 * everyone who died after `lastGraveDigAt`. A Snow Wolf freezing a Grave
 * Digger who dug at least one grave "undoes" that night's dig by rewinding
 * `lastGraveDigAt` back to `secondLastGraveDigAt`.
 */
export interface NightState {
  guardianAngel: Player | null;
  lastGraveDigAt: Date | null;
  secondLastGraveDigAt: Date | null;
}

export function initialNightState(): NightState {
  return { guardianAngel: null, lastGraveDigAt: null, secondLastGraveDigAt: null };
}

/** Mirrors the original's `var ga = Players.FirstOrDefault(x => x.PlayerRole == IRole.GuardianAngel & !x.IsDead && x.Choice != 0 && x.Choice != -1);` */
export function findActingGuardianAngel(players: readonly Player[]): Player | null {
  return (
    players.find(
      (p) => p.role === ROLE_BIT.GuardianAngel && !p.isDead && p.choice !== null && p.choice !== ABSTAIN,
    ) ?? null
  );
}

/** Port of the `#region Snow Wolf Night` block in `NightCycle`. */
export function resolveSnowWolfNight(
  players: Player[],
  state: NightState,
  visitCtx: VisitContext,
): GameEvent[] {
  const events: GameEvent[] = [];
  const random = visitCtx.random ?? Math.random;

  const snowWolf = players.find((p) => p.role === ROLE_BIT.SnowWolf && !p.isDead);
  if (!snowWolf || snowWolf.choice === null || snowWolf.choice === ABSTAIN) return events;

  const target = players.find((p) => p.id === snowWolf.choice);
  const { result, events: visitEvents } = visitPlayer(visitCtx, snowWolf, target);
  events.push(...visitEvents);
  if (result !== 'Success' || !target) return events;

  if (target.role === ROLE_BIT.SerialKiller) {
    target.frozen = true;
    events.push({ type: 'PlayerFrozen', playerId: target.id, cause: 'SnowWolf' });
    return events;
  }

  if (state.guardianAngel && state.guardianAngel.choice === target.id) {
    target.wasSavedLastNight = true;
    events.push({ type: 'GuardianAngelBlockedFreeze', targetId: target.id, snowWolfId: snowWolf.id });
    return events;
  }

  if (target.role === ROLE_BIT.Hunter) {
    if (Math.floor(random() * 100) < 50) {
      target.frozen = true;
      events.push({ type: 'PlayerFrozen', playerId: target.id, cause: 'SnowWolf' });
    } else {
      events.push(
        ...killPlayer(players, snowWolf.id, 'HunterShot', {
          killerIds: [target.id],
          diedByVisitingKiller: true,
        }),
      );
    }
    return events;
  }

  // Every other role: freeze them. A frozen Grave Digger who dug at least once tonight has that dig undone.
  target.frozen = true;
  if (target.role === ROLE_BIT.GraveDigger && target.dugGravesLastNight >= 1) {
    state.lastGraveDigAt = state.secondLastGraveDigAt;
    target.dugGravesLastNight = 0;
  }
  if (target.role === ROLE_BIT.GuardianAngel) {
    state.guardianAngel = null;
  }
  events.push({ type: 'PlayerFrozen', playerId: target.id, cause: 'SnowWolf' });
  return events;
}

function bitePlayer(target: Player): GameEvent[] {
  target.bitten = true;
  return [{ type: 'PlayerBitten', playerId: target.id }];
}

function defaultBiteOrEat(
  players: Player[],
  target: Player,
  voteWolves: readonly Player[],
  bitten: boolean,
): GameEvent[] {
  if (bitten) return bitePlayer(target);
  return killPlayer(players, target.id, 'Eat', {
    killerIds: voteWolves.map((w) => w.id),
    killedByRole: ROLE_BIT.Wolf,
    triggerHunterShot: false,
  });
}

/**
 * Resolves what happens to a single wolf-pack target on a successful visit
 * (i.e. `ga` didn't block it). Mirrors the big `switch (target.PlayerRole)`
 * inside the Wolf Night block's `case VisitResult.Success`. The Harlot,
 * Serial Killer and Traitor cases are mechanically identical to `default`
 * in the original (their special-casing is achievement-only, via `goto
 * default`), so they're not listed separately here.
 */
function resolveWolfVictim(
  players: Player[],
  target: Player,
  voteWolves: readonly Player[],
  bitten: boolean,
  random: () => number,
): GameEvent[] {
  switch (target.role) {
    case ROLE_BIT.Cursed:
      // Unconditional - a Cursed villager turns wolf on any successful bite attempt, "bitten" roll or not.
      promoteToWolf(target);
      return [{ type: 'CursedTurnedWolf', playerId: target.id }];

    case ROLE_BIT.Drunk: {
      if (bitten) return bitePlayer(target);
      const events = killPlayer(players, target.id, 'Eat', {
        killerIds: voteWolves.map((w) => w.id),
        killedByRole: ROLE_BIT.Wolf,
        triggerHunterShot: false,
      });
      const wolfIds = voteWolves.map((w) => w.id);
      for (const w of voteWolves) w.drunk = true; // the whole pack sleeps in tomorrow night
      events.push({ type: 'WolvesGotDrunk', wolfIds, drunkVictimId: target.id });
      return events;
    }

    case ROLE_BIT.Hunter: {
      const chance = 30 + (voteWolves.length - 1) * 20; // Settings.HunterKillWolfChanceBase + (packSize - 1) * 20
      if (Math.floor(random() * 100) < chance) {
        const shotWolf = voteWolves[Math.floor(random() * voteWolves.length)]!;
        const events: GameEvent[] = [];
        const hunterAlsoDied = voteWolves.length > 1;
        if (hunterAlsoDied) {
          events.push(
            ...killPlayer(players, target.id, 'Eat', {
              killerIds: voteWolves.map((w) => w.id),
              killedByRole: ROLE_BIT.Wolf,
              triggerHunterShot: false,
            }),
          );
        }
        events.push(
          ...killPlayer(players, shotWolf.id, 'HunterShot', {
            killerIds: [target.id],
            diedByVisitingKiller: true,
          }),
        );
        events.push({ type: 'HunterCounterAttack', hunterId: target.id, shotWolfId: shotWolf.id, hunterAlsoDied });
        return events;
      }
      return defaultBiteOrEat(players, target, voteWolves, bitten);
    }

    case ROLE_BIT.WiseElder:
      if (bitten) return bitePlayer(target);
      if (target.hasUsedAbility) return defaultBiteOrEat(players, target, voteWolves, false);
      target.hasUsedAbility = true; // survives their first attack, once
      return [{ type: 'WiseElderSurvivedFirstAttack', playerId: target.id }];

    default:
      return defaultBiteOrEat(players, target, voteWolves, bitten);
  }
}

/**
 * Picks the most-voted player among `voters`' choice (via `getChoice`),
 * mirrors the original reusing `Player.Votes` as scratch space to tally
 * wolf-pack votes (same trick `resolveLynchVotes` uses for the lynch).
 * `excludeId`, when given, discards votes for that particular target
 * (used so the pack's second victim can't be the same as the first).
 */
function tallyMostVoted(
  players: readonly Player[],
  voters: readonly Player[],
  getChoice: (voter: Player) => bigint | null,
  excludeId: bigint | null,
): bigint | null {
  for (const p of players) p.votes = 0;
  for (const voter of voters) {
    const choice = getChoice(voter);
    if (choice === null || choice === ABSTAIN || choice === excludeId) continue;
    const target = players.find((p) => p.id === choice);
    if (target) target.votes++;
  }
  const withVotes = players.filter((p) => p.votes > 0);
  if (withVotes.length === 0) return null;
  return [...withVotes].sort((a, b) => b.votes - a.votes)[0]!.id;
}

/** Port of the `#region Wolf Night - Non-snow wolves` block. */
export function resolveWolfNight(players: Player[], state: NightState, visitCtx: VisitContext): GameEvent[] {
  const events: GameEvent[] = [];
  const random = visitCtx.random ?? Math.random;

  const wolves = players.filter((p) => !p.isDead && !p.drunk && WOLF_ROLES.includes(p.role));
  const votingWolves = (): Player[] => wolves.filter((w) => !w.drunk && !w.isDead);

  let voteWolves = votingWolves();
  if (voteWolves.length === 0) return events;

  const actedWolves = voteWolves.filter(
    (w) => (w.choice !== null && w.choice !== ABSTAIN) || (w.choice2 !== null && w.choice2 !== ABSTAIN),
  );

  const firstChoiceId = tallyMostVoted(players, actedWolves, (w) => w.choice, null);
  const secondChoiceId = tallyMostVoted(players, actedWolves, (w) => w.choice2, firstChoiceId);
  for (const p of players) p.votes = 0;

  const choices = [firstChoiceId, secondChoiceId].filter((c): c is bigint => c !== null);

  for (const choiceId of choices) {
    voteWolves = votingWolves();
    if (voteWolves.length === 0) break;

    const target = players.find((p) => p.id === choiceId);
    const visitorWolf = voteWolves[Math.floor(random() * voteWolves.length)]!;
    const { result, events: visitEvents } = visitPlayer(visitCtx, visitorWolf, target);
    events.push(...visitEvents);

    if (result === 'Success' && target) {
      if (state.guardianAngel?.choice === target.id) {
        target.wasSavedLastNight = true;
        events.push({ type: 'GuardianAngelBlockedWolfAttack', targetId: target.id });
      } else {
        const alphaPresent = voteWolves.some((w) => w.role === ROLE_BIT.AlphaWolf);
        const bitten = alphaPresent && Math.floor(random() * 100) < 20; // Settings.AlphaWolfConversionChance
        events.push(...resolveWolfVictim(players, target, voteWolves, bitten, random));
      }
    }

    // Independent of what just happened to the main target: give the pack a chance to spot a Grave
    // Digger who dug at least one grave tonight.
    const gd = players.find((p) => p.role === ROLE_BIT.GraveDigger && !p.isDead && p.dugGravesLastNight > 0);
    if (gd) {
      const spotChance = graveDiggerDetectionChance(gd.dugGravesLastNight) / 2;
      if (Math.floor(random() * 100) < spotChance) {
        events.push(
          ...killPlayer(players, gd.id, 'Spotted', {
            killerIds: voteWolves.map((w) => w.id),
            diedByVisitingKiller: true,
            killedByRole: ROLE_BIT.Wolf,
          }),
        );
      }
    }
  }

  return events;
}

/**
 * Port of the `#region Arsonist Night` block. The Arsonist ignores `frozen`
 * entirely ("fire beats ice") - there is no frozen-check here, matching the
 * original exactly.
 */
export function resolveArsonistNight(players: Player[], state: NightState, visitCtx: VisitContext): GameEvent[] {
  const events: GameEvent[] = [];

  const arsonist = players.find((p) => p.role === ROLE_BIT.Arsonist && !p.isDead);
  if (!arsonist) return events;

  if (arsonist.choice === SPARK) {
    const burning = players.filter((p) => !p.isDead && p.doused && p.role !== ROLE_BIT.Arsonist);
    const unprotectedIds = new Set(
      burning.filter((p) => state.guardianAngel?.choice !== p.id).map((p) => p.id),
    );

    for (const victim of burning) {
      if (state.guardianAngel?.choice === victim.id) {
        victim.wasSavedLastNight = true;
        events.push({ type: 'GuardianAngelSavedFromBurning', playerId: victim.id });
      } else {
        events.push(
          ...killPlayer(players, victim.id, 'Burn', {
            killerIds: [arsonist.id],
            triggerHunterShot: false,
            dyingSimultaneously: unprotectedIds,
          }),
        );
        victim.doused = false;
        victim.burning = true;
      }
    }
    return events;
  }

  const doused = players.find((p) => p.id === arsonist.choice);
  if (doused) {
    const { result, events: visitEvents } = visitPlayer(visitCtx, arsonist, doused);
    events.push(...visitEvents);
    if (result === 'Success') {
      doused.doused = true;
      events.push({ type: 'PlayerDoused', playerId: doused.id, arsonistId: arsonist.id });
    }
  }

  return events;
}
