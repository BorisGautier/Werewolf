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
 * Ported so far: Snow Wolf, Arsonist. Everything else in the documented
 * priority order (Grave Digger, Wolves, Serial Killer, Cultist Hunter, Cult,
 * Chemist, Harlot, Seer, Sorcerer, Fool, Oracle, Augur, Guardian Angel,
 * Thief, plus the day-1-only/passive roles) is tracked separately and still
 * to come - see the project's task list.
 */

import { ROLE_BIT } from '../roles/role.js';
import { killPlayer } from './kill.js';
import { ABSTAIN, SPARK, type Player } from './player.js';
import { visitPlayer, type VisitContext } from './night-visit.js';
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
