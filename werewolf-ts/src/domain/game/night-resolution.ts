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
 * Ported so far: Snow Wolf, Arsonist, Wolves, Serial Killer, Cultist Hunter,
 * Cult, Chemist, Harlot, Guardian Angel, Thief (Seer/Sorcerer/Fool/Oracle/
 * Augur live in `clairvoyance.ts` - they're almost entirely informational,
 * not really "night resolution" in the causal sense). Grave Digger's own
 * "how many graves did I dig" computation happens during menu-building in
 * the original (`SendNightActions`), so there's no separate Grave Digger
 * resolver here - its *interactions* with other roles (being frozen,
 * spotted, visited) are already covered above. The `lastGraveDigAt`/
 * `secondLastGraveDigAt` timestamps that computation needs to persist
 * across nights are threaded through via `NightState` (seeded by
 * `Game.enterNight()`, read back by `Game.resolveNightActions()` - see
 * `game.aggregate.ts`), even though the dig count itself is computed there,
 * not here.
 */

import { ROLE_BIT, type Role } from '../roles/role.js';
import { WOLF_ROLES } from './game-balancing.js';
import { killPlayer } from './kill.js';
import { ABSTAIN, SPARK, type Player } from './player.js';
import { visitPlayer, graveDiggerDetectionChance, type VisitContext } from './night-visit.js';
import { promoteToCultist, promoteToWolf } from './transform.js';
import { getTeamForRole } from './team.js';
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
 *
 * `wolvesThatActed`: whichever wolves were still alive/awake at the end of
 * `resolveWolfNight`, i.e. the original's `voteWolves` as it's left after
 * the wolf-night loop. The Cult's "did the wolves go eating tonight?" check
 * reads this exact leftover set, not a fresh recomputation.
 */
export interface NightState {
  guardianAngel: Player | null;
  lastGraveDigAt: Date | null;
  secondLastGraveDigAt: Date | null;
  wolvesThatActed: Player[];
}

export function initialNightState(
  lastGraveDigAt: Date | null = null,
  secondLastGraveDigAt: Date | null = null,
): NightState {
  return { guardianAngel: null, lastGraveDigAt, secondLastGraveDigAt, wolvesThatActed: [] };
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

function bitePlayer(target: Player, alphaId: bigint | null): GameEvent[] {
  target.bitten = true;
  return [{ type: 'PlayerBitten', playerId: target.id, alphaId }];
}

function defaultBiteOrEat(
  players: Player[],
  target: Player,
  voteWolves: readonly Player[],
  bitten: boolean,
  alphaId: bigint | null,
): GameEvent[] {
  if (bitten) return bitePlayer(target, alphaId);
  return killPlayer(players, target.id, 'Eat', {
    killerIds: voteWolves.map((w) => w.id),
    killedByRole: ROLE_BIT.Wolf,
    triggerHunterShot: false,
  });
}

/**
 * Resolves what happens to a single wolf-pack target on a successful visit
 * (i.e. `ga` didn't block it). Mirrors the big `switch (target.PlayerRole)`
 * inside the Wolf Night block's `case VisitResult.Success`. The Harlot and
 * Traitor cases are mechanically identical to `default` in the original
 * (their special-casing is achievement-only, via `goto default`), so
 * they're not listed separately here. The Serial Killer case *is* listed -
 * a successful bite there is the "infect the Serial Killer" mechanic
 * (`StrongestAlpha`), which the original special-cases even though the
 * actual bite/kill logic is identical to `default`.
 */
function resolveWolfVictim(
  players: Player[],
  target: Player,
  voteWolves: readonly Player[],
  bitten: boolean,
  alphaId: bigint | null,
  random: () => number,
): GameEvent[] {
  switch (target.role) {
    case ROLE_BIT.Cursed:
      // Unconditional - a Cursed villager turns wolf on any successful bite attempt, "bitten" roll or not.
      promoteToWolf(target);
      return [{ type: 'CursedTurnedWolf', playerId: target.id }];

    case ROLE_BIT.Drunk: {
      if (bitten) {
        const events = bitePlayer(target, alphaId);
        if (alphaId !== null) events.push({ type: 'AlphaWolfLuckyDay', alphaId });
        return events;
      }
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
      return defaultBiteOrEat(players, target, voteWolves, bitten, alphaId);
    }

    case ROLE_BIT.WiseElder:
      if (bitten) return bitePlayer(target, alphaId);
      if (target.hasUsedAbility) return defaultBiteOrEat(players, target, voteWolves, false, alphaId);
      target.hasUsedAbility = true; // survives their first attack, once
      return [{ type: 'WiseElderSurvivedFirstAttack', playerId: target.id }];

    case ROLE_BIT.SerialKiller: {
      if (!bitten) return defaultBiteOrEat(players, target, voteWolves, false, alphaId);
      const events = bitePlayer(target, alphaId);
      if (alphaId !== null) {
        const alpha = players.find((p) => p.id === alphaId);
        if (alpha) alpha.strongestAlpha = true;
      }
      return events;
    }

    default:
      return defaultBiteOrEat(players, target, voteWolves, bitten, alphaId);
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
  let successCount = 0;
  let lastAlphaId: bigint | null = null;

  for (const choiceId of choices) {
    voteWolves = votingWolves();
    if (voteWolves.length === 0) break;

    const target = players.find((p) => p.id === choiceId);
    const visitorWolf = voteWolves[Math.floor(random() * voteWolves.length)]!;
    const { result, events: visitEvents } = visitPlayer(visitCtx, visitorWolf, target);
    events.push(...visitEvents);

    if (result === 'Success' && target) {
      successCount++;
      if (state.guardianAngel?.choice === target.id) {
        target.wasSavedLastNight = true;
        events.push({ type: 'GuardianAngelBlockedWolfAttack', targetId: target.id });
      } else {
        const alpha = voteWolves.find((w) => w.role === ROLE_BIT.AlphaWolf) ?? null;
        lastAlphaId = alpha?.id ?? lastAlphaId;
        const bitten = alpha !== null && Math.floor(random() * 100) < 20; // Settings.AlphaWolfConversionChance
        events.push(...resolveWolfVictim(players, target, voteWolves, bitten, alpha?.id ?? null, random));
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

  // Mirrors `if (eatCount == 2)`: both pack attacks tonight succeeded (visited without dying,
  // whether or not the target actually ended up bitten/eaten) - feeds IHelped/IncreaseThePack.
  if (successCount === 2) events.push({ type: 'WolfPackAteTwice', alphaId: lastAlphaId });

  state.wolvesThatActed = voteWolves;
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

/** Port of the `#region Serial Killer Night` block. */
export function resolveSerialKillerNight(
  players: Player[],
  state: NightState,
  visitCtx: VisitContext,
): GameEvent[] {
  const events: GameEvent[] = [];
  const random = visitCtx.random ?? Math.random;

  const sk = players.find((p) => p.role === ROLE_BIT.SerialKiller && !p.isDead);
  if (!sk || sk.frozen) return events;

  let skilled = players.find((p) => p.id === sk.choice);
  const { result, events: visitEvents } = visitPlayer(visitCtx, sk, skilled);
  events.push(...visitEvents);

  if (result === 'Success' && skilled) {
    if (sk.stumbledGrave > 0 && sk.stumbledGrave + 1 === visitCtx.dayNumber && Math.floor(random() * 100) < 50) {
      const originalTarget = skilled;
      const eligible = players.filter((p) => p.role !== ROLE_BIT.SerialKiller && !p.isDead);
      const newTarget = eligible[Math.floor(random() * eligible.length)]!;
      // Side-effecting call for parity with the original (e.g. it could trigger another grave-stumble),
      // its result is intentionally not used to gate the kill below.
      events.push(...visitPlayer(visitCtx, sk, newTarget).events);
      skilled = newTarget;
      events.push({ type: 'SerialKillerRandomKill', originalTargetId: originalTarget.id, newTargetId: newTarget.id });
    }

    // The Guardian Angel can't protect the Harlot from the Serial Killer - she's never "found at home".
    if (state.guardianAngel?.choice === skilled.id && skilled.role !== ROLE_BIT.Harlot) {
      skilled.wasSavedLastNight = true;
      events.push({ type: 'GuardianAngelBlockedSerialKiller', targetId: skilled.id });
    } else {
      events.push(...killPlayer(players, skilled.id, 'SerialKilled', { killerIds: [sk.id] }));
    }
  }

  const gd = players.find((p) => p.role === ROLE_BIT.GraveDigger && !p.isDead && p.dugGravesLastNight > 0);
  if (gd) {
    const spotChance = graveDiggerDetectionChance(gd.dugGravesLastNight) / 2;
    if (Math.floor(random() * 100) < spotChance) {
      events.push(...killPlayer(players, gd.id, 'Spotted', { killerIds: [sk.id], diedByVisitingKiller: true }));
    }
  }

  return events;
}

/** Port of the `#region Cult Hunter Night` block. */
export function resolveCultistHunterNight(players: Player[], visitCtx: VisitContext): GameEvent[] {
  const events: GameEvent[] = [];

  // Mirrors `Players.GetPlayerForRole(IRole.CultistHunter)` - default aliveOnly: true.
  const hunter = players.find((p) => p.role === ROLE_BIT.CultistHunter && !p.isDead);
  if (!hunter || hunter.frozen) return events;

  const hunted = players.find((p) => p.id === hunter.choice);
  const { result, events: visitEvents } = visitPlayer(visitCtx, hunter, hunted);
  events.push(...visitEvents);

  if (result === 'Success' && hunted && hunted.role === ROLE_BIT.Cultist) {
    events.push(...killPlayer(players, hunted.id, 'Hunt', { killerIds: [hunter.id] }));
  }
  // Fail/AlreadyDead/a non-Cultist Success target: no state change, message-only in the original.

  return events;
}

/** Conversion odds for target roles that don't have a bespoke mechanical branch (Settings.*ConversionChance). Anything absent defaults to 100 (guaranteed), matching the original's `ConvertToCult(target, voteCult)` default-argument fallback. */
const CULT_CONVERSION_CHANCE = new Map<Role, number>([
  [ROLE_BIT.Seer, 40],
  [ROLE_BIT.GuardianAngel, 60],
  [ROLE_BIT.Detective, 70],
  [ROLE_BIT.Cursed, 60],
  [ROLE_BIT.Harlot, 70],
  [ROLE_BIT.Sorcerer, 40],
  [ROLE_BIT.Blacksmith, 75],
  [ROLE_BIT.Oracle, 50],
  [ROLE_BIT.Sandman, 60],
  [ROLE_BIT.WiseElder, 30],
  [ROLE_BIT.Pacifist, 80],
  [ROLE_BIT.GraveDigger, 30],
  [ROLE_BIT.Augur, 40],
  [ROLE_BIT.Doppelganger, 0],
  [ROLE_BIT.Thief, 0],
  [ROLE_BIT.Spumpkin, 0],
]);

/** Port of `ConvertToCult`. */
function convertToCult(target: Player, chance: number, dayNumber: number, random: () => number): GameEvent[] {
  if (Math.floor(random() * 100) < chance) {
    promoteToCultist(target, dayNumber);
    return [{ type: 'PlayerConvertedToCult', playerId: target.id }];
  }
  return [{ type: 'CultConversionFailed', targetId: target.id }];
}

/**
 * Resolves what happens when the cult's "newbie" successfully visits their
 * night's target. Mirrors the `switch (target.PlayerRole)` inside the Cult
 * Night block's `case VisitResult.Success`.
 */
function resolveCultVictim(
  players: Player[],
  target: Player,
  newbie: Player,
  state: NightState,
  dayNumber: number,
  random: () => number,
): GameEvent[] {
  switch (target.role) {
    case ROLE_BIT.Hunter: {
      if (Math.floor(random() * 100) < 50) {
        // Settings.HunterConversionChance
        promoteToCultist(target, dayNumber);
        return [{ type: 'PlayerConvertedToCult', playerId: target.id }];
      }
      if (Math.floor(random() * 100) < 50) {
        // Settings.HunterKillCultChance
        return killPlayer(players, newbie.id, 'HunterCult', { killerIds: [target.id], diedByVisitingKiller: true });
      }
      return [{ type: 'CultConversionFailed', targetId: target.id }];
    }

    case ROLE_BIT.CultistHunter:
      return killPlayer(players, newbie.id, 'Hunt', { killerIds: [target.id], diedByVisitingKiller: true });

    case ROLE_BIT.Wolf:
    case ROLE_BIT.AlphaWolf:
    case ROLE_BIT.WolfCub:
    case ROLE_BIT.Lycan: {
      const wolvesWentHunting = state.wolvesThatActed.some(
        (w) => (w.choice !== null && w.choice !== ABSTAIN) || (w.choice2 !== null && w.choice2 !== ABSTAIN),
      );
      if (wolvesWentHunting) return [];
      return killPlayer(players, newbie.id, 'VisitWolf', {
        killerIds: [target.id],
        diedByVisitingKiller: true,
        killedByRole: ROLE_BIT.Wolf,
      });
    }

    case ROLE_BIT.SnowWolf: {
      const wentFreezing = target.choice !== null && target.choice !== ABSTAIN;
      if (wentFreezing) return [];
      return killPlayer(players, newbie.id, 'VisitWolf', {
        killerIds: [target.id],
        diedByVisitingKiller: true,
        killedByRole: ROLE_BIT.Wolf,
      });
    }

    case ROLE_BIT.Arsonist:
      if (target.choice === ABSTAIN || target.frozen) {
        return convertToCult(target, 0, dayNumber, random); // guaranteed to fail - matches the original's forced chance:0
      }
      return [];

    default: {
      const chance = CULT_CONVERSION_CHANCE.get(target.role) ?? 100;
      return convertToCult(target, chance, dayNumber, random);
    }
  }
}

/** Port of the `#region Cult Night` block. */
export function resolveCultNight(players: Player[], state: NightState, visitCtx: VisitContext): GameEvent[] {
  const events: GameEvent[] = [];
  const random = visitCtx.random ?? Math.random;

  const voteCult = players.filter((p) => p.role === ROLE_BIT.Cultist && !p.isDead && !p.frozen);
  if (voteCult.length === 0) return events;

  const acted = voteCult.filter((c) => c.choice !== null && c.choice !== ABSTAIN);
  if (acted.length === 0) return events;

  // Most-voted target (mode). Ties go to whichever target was voted for first (mirrors the original's
  // `GroupBy(x => x.Choice).OrderByDescending(x => x.Count()).First()`, a stable sort over a
  // first-occurrence-ordered grouping).
  const voteCounts = new Map<bigint, number>();
  const firstSeenOrder: bigint[] = [];
  for (const c of acted) {
    const choice = c.choice!;
    if (!voteCounts.has(choice)) {
      voteCounts.set(choice, 0);
      firstSeenOrder.push(choice);
    }
    voteCounts.set(choice, voteCounts.get(choice)! + 1);
  }
  let choiceId: bigint | null = null;
  let bestCount = 0;
  for (const id of firstSeenOrder) {
    const count = voteCounts.get(id)!;
    if (count > bestCount) {
      bestCount = count;
      choiceId = id;
    }
  }
  if (choiceId === null) return events;

  const target = players.find((p) => p.id === choiceId);
  if (!target) return events;

  // The "newbie" - most recently converted cultist, ties broken by original list order - is who visits.
  const newbie = [...voteCult].sort((a, b) => b.dayCult - a.dayCult)[0]!;

  const { result, events: visitEvents } = visitPlayer(visitCtx, newbie, target);
  events.push(...visitEvents);

  if (result === 'Success') {
    events.push(...resolveCultVictim(players, target, newbie, state, visitCtx.dayNumber, random));
  }

  return events;
}

/**
 * Port of the `#region Chemist Night` block. `Player.ChemistFailed` from the
 * original isn't tracked here - it only ever picked which death message to
 * show (self-kill vs. killed-their-target), and that's already fully
 * derivable from the emitted `PlayerDied` event (`killerIds` containing the
 * victim's own id).
 */
export function resolveChemistNight(players: Player[], visitCtx: VisitContext): GameEvent[] {
  const events: GameEvent[] = [];
  const random = visitCtx.random ?? Math.random;

  const chemist = players.find((p) => p.role === ROLE_BIT.Chemist && !p.isDead);
  if (!chemist || chemist.frozen) return events;

  const target = players.find((p) => p.id === chemist.choice);
  const { result, events: visitEvents } = visitPlayer(visitCtx, chemist, target);
  events.push(...visitEvents);

  if (result === 'Success' && target) {
    chemist.hasUsedAbility = false; // the brewed potion is used up either way
    if (Math.floor(random() * 100) < 50) {
      // Settings.ChemistSuccessChance
      if (target.role === ROLE_BIT.WiseElder) {
        // Guilt over killing the Wise Elder costs the Chemist their role entirely, same as the
        // Gunner/Spumpkin's day-action equivalent in day-actions.ts.
        chemist.role = ROLE_BIT.Villager;
        chemist.team = getTeamForRole(ROLE_BIT.Villager);
        chemist.changedRolesCount++;
        events.push({ type: 'ChemistLostPowerToWiseElder', playerId: chemist.id });
      }
      events.push(...killPlayer(players, target.id, 'Chemistry', { killerIds: [chemist.id] }));
    } else {
      // Oops - the Chemist blew themselves up instead.
      events.push({ type: 'ChemistBackfired', chemistId: chemist.id, targetId: target.id });
      events.push(...killPlayer(players, chemist.id, 'Chemistry', { killerIds: [chemist.id] }));
    }
  }

  return events;
}

/**
 * Port of the `#region Harlot Night` block. The one non-obvious mechanical
 * branch: visiting someone who turns out to already be dead *this same
 * night* at a wolf's or the Serial Killer's hands gets the Harlot killed too
 * (she stumbled onto the murder) - everything else in this block is
 * message-only. `playersVisited`/`hasStayedHome`/`hasRepeatedVisit` are
 * updated unconditionally on the choice itself (Promiscuous/Affectionate),
 * before the visit's success/failure is even resolved - mirrors the
 * original checking these ahead of its own `VisitPlayer` switch.
 */
export function resolveHarlotNight(players: Player[], visitCtx: VisitContext): GameEvent[] {
  const events: GameEvent[] = [];

  const harlot = players.find((p) => p.role === ROLE_BIT.Harlot && !p.isDead);
  if (!harlot || harlot.frozen) return events;

  const target = players.find((p) => p.id === harlot.choice);
  if (target) {
    if (harlot.playersVisited.has(target.id)) harlot.hasRepeatedVisit = true;
    harlot.playersVisited.add(target.id);
    events.push({ type: 'HarlotVisited', harlotId: harlot.id, targetId: target.id });
  } else {
    harlot.hasStayedHome = true;
  }

  const { result, events: visitEvents } = visitPlayer(visitCtx, harlot, target);
  events.push(...visitEvents);

  if (result === 'AlreadyDead' && target) {
    const killerRole = target.killedByRole;
    const diedToWolfOrSerialKiller =
      killerRole !== null && (WOLF_ROLES.includes(killerRole) || killerRole === ROLE_BIT.SerialKiller);
    if (target.diedLastNight && diedToWolfOrSerialKiller && !target.diedByVisitingKiller && !target.diedByVisitingVictim) {
      events.push(
        ...killPlayer(players, harlot.id, 'VisitVictim', {
          killerIds: [target.id],
          diedByVisitingVictim: true,
          killedByRole: killerRole,
        }),
      );
    }
  }

  return events;
}

/**
 * Port of the `#region GA Night` block: "only notifies the GA about the
 * impact of his actions, and cleans kerosene" - the original's comment is
 * accurate, this is almost entirely messages. The one real state change is
 * clearing `doused` off whoever the GA protected, and *only* in two of the
 * three narrative branches: when they weren't otherwise attacked tonight
 * (preventive cleaning), or when they were specifically saved from a spark
 * (the Arsonist chose SPARK). A player saved from a wolf/Serial Killer
 * attack who happens to also be doused does *not* get cleaned here - that
 * asymmetry is exactly what the original's nested if/else encodes.
 */
export function resolveGuardianAngelNight(
  players: Player[],
  state: NightState,
  visitCtx: VisitContext,
): GameEvent[] {
  const events: GameEvent[] = [];
  const ga = state.guardianAngel;
  if (!ga || ga.frozen || (ga.isDead && !ga.diedLastNight)) return events;

  const save = players.find((p) => p.id === ga.choice);
  const { result, events: visitEvents } = visitPlayer(visitCtx, ga, save);
  events.push(...visitEvents);

  if ((result === 'Success' || result === 'AlreadyDead') && save) {
    if (WOLF_ROLES.includes(save.role) && !save.wasSavedLastNight) ga.gaGuardWolfCount++;
    if (save.wasSavedLastNight) {
      const arsonist = players.find((p) => p.role === ROLE_BIT.Arsonist);
      if (save.doused && arsonist?.choice === SPARK) {
        save.doused = false;
        events.push({ type: 'GuardianAngelCleanedDouse', playerId: save.id });
      }
    } else if (save.doused) {
      save.doused = false;
      events.push({ type: 'GuardianAngelCleanedDouse', playerId: save.id });
    }
  }

  return events;
}

/**
 * Port of `StealRole`: swaps the Thief and their target's role (and the
 * target-specific stats that ride along with a role: bullet count,
 * hasUsedAbility, roleModel). The target becomes a Villager (or, in
 * "ThiefFull" games, a plain Thief); the original Thief takes over
 * everything about the stolen role.
 *
 * If the target turns out to be dead (only possible in the non-ThiefFull,
 * night-1 path - `VisitPlayer` lets a non-full Thief's visit "succeed" even
 * against a dead target), a random living player is picked instead, exactly
 * like the original's `ChooseRandomPlayerId` fallback.
 */
function stealRole(
  players: Player[],
  thief: Player,
  initialTarget: Player,
  thiefFull: boolean,
  visitCtx: VisitContext,
  random: () => number,
): GameEvent[] {
  const events: GameEvent[] = [];
  let target = initialTarget;

  if (target.isDead) {
    const alive = players.filter((p) => !p.isDead && p.id !== thief.id);
    if (alive.length === 0) return events;
    target = alive[Math.floor(random() * alive.length)]!;
    thief.choice = target.id;
  }

  const { result, events: visitEvents } = visitPlayer(visitCtx, thief, target);
  events.push(...visitEvents);
  if (result !== 'Success') return events;

  const stolenRole = target.role;
  const stolenRoleModel = target.roleModel;
  const stolenBullet = target.bullet;
  const stolenHasUsedAbility = target.hasUsedAbility;

  target.role = thiefFull ? ROLE_BIT.Thief : ROLE_BIT.Villager;
  target.team = getTeamForRole(target.role);
  target.changedRolesCount++;

  thief.role = stolenRole;
  thief.team = getTeamForRole(stolenRole);
  thief.changedRolesCount++;
  thief.roleModel = stolenRoleModel;
  thief.bullet = stolenBullet;
  thief.hasUsedAbility = stolenHasUsedAbility;

  events.push({ type: 'RoleStolen', thiefId: thief.id, targetId: target.id, stolenRole });
  return events;
}

/**
 * Port of the `#region Thief Night` block. A non-"ThiefFull" Thief steals
 * unconditionally, but only on the first night; a "ThiefFull" Thief can
 * steal every night, gated by both `frozen` and a 50% roll, and can never
 * target a wolf-team role, Cultist, or Snow Wolf.
 */
export function resolveThiefNight(
  players: Player[],
  dayNumber: number,
  thiefFull: boolean,
  visitCtx: VisitContext,
): GameEvent[] {
  const events: GameEvent[] = [];
  const random = visitCtx.random ?? Math.random;

  const thief = players.find((p) => p.role === ROLE_BIT.Thief && !p.isDead);
  if (!thief) return events;

  if (!thiefFull) {
    if (dayNumber !== 1) return events;
    const target = players.find((p) => p.id === thief.choice);
    if (!target) return events;

    const { result, events: visitEvents } = visitPlayer(visitCtx, thief, target);
    events.push(...visitEvents);
    if (result === 'Success') {
      events.push(...stealRole(players, thief, target, thiefFull, visitCtx, random));
    }
    return events;
  }

  if (thief.frozen) return events;
  const target = players.find((p) => p.id === thief.choice);
  const { result, events: visitEvents } = visitPlayer(visitCtx, thief, target);
  events.push(...visitEvents);

  if (result === 'Success' && target) {
    const canSteal =
      Math.floor(random() * 100) < 50 && // Settings.ThiefStealChance
      !WOLF_ROLES.includes(target.role) &&
      target.role !== ROLE_BIT.Cultist &&
      target.role !== ROLE_BIT.SnowWolf;
    if (canSteal) {
      events.push(...stealRole(players, thief, target, thiefFull, visitCtx, random));
    }
  }

  return events;
}
