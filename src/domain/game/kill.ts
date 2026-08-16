/**
 * Port of `Werewolf.cs`'s `KillPlayer` (both overloads) and `KillLover`.
 *
 * Persistence (the original's `DBKill`, which writes `GameKill` rows) and
 * messaging are deliberately left out - this only mutates player state and
 * returns the `GameEvent`s a caller needs to persist/announce. The one
 * "action" this triggers on its own is the lover-death chain reaction,
 * exactly like the original.
 */

import { ROLE_BIT, roleName, type Role } from '../roles/role.js';
import {
  loversSuicides,
  playersEliminated,
  roleDeaths,
} from '../../infrastructure/monitoring/metrics.js';
import type { GameEvent } from './game-event.js';
import type { KillMethod } from './kill-method.js';
import type { Player } from './player.js';

export interface KillOptions {
  killerIds?: readonly bigint[];
  isNight?: boolean;
  diedByVisitingVictim?: boolean;
  diedByVisitingKiller?: boolean;
  killedByRole?: Role;
  /** Set false to suppress the Hunter's dying shot (mirrors `hunterFinalShot`). */
  triggerHunterShot?: boolean;
  /** Players dying in the very same resolution step (e.g. both burnt by the Arsonist) - their lover chain is skipped. */
  dyingSimultaneously?: ReadonlySet<bigint>;
}

function findPlayer(players: readonly Player[], id: bigint): Player {
  const p = players.find((x) => x.id === id);
  if (!p) throw new RangeError(`No player with id ${id.toString()}`);
  return p;
}

/**
 * Kills `victimId` and resolves every chain reaction (lover grief, the
 * Hunter's final shot, the Wolf Cub flag). Mutates `players` in place and
 * returns the events that occurred, in order.
 */
export function killPlayer(
  players: Player[],
  victimId: bigint,
  method: KillMethod,
  options: KillOptions = {},
): GameEvent[] {
  const victim = findPlayer(players, victimId);
  playersEliminated.labels(method).inc();
  try {
    roleDeaths.labels(roleName(victim.role)).inc();
  } catch {
    // ignore unknown role bit
  }
  if (method === 'LoverDied') {
    loversSuicides.inc();
  }
  const isNight = options.isNight ?? true;
  const killerIds = options.killerIds ?? [];
  const dyingSimultaneously = options.dyingSimultaneously ?? new Set<bigint>();
  const events: GameEvent[] = [];

  // A death-by-love is folded into the lover's own kill call, not tracked as a fresh "night death".
  victim.diedLastNight = isNight && method !== 'LoverDied';
  victim.timeDied = new Date();

  const killedByRole =
    options.killedByRole ?? (killerIds.length > 0 ? findPlayer(players, killerIds[0]!).role : null);
  if (killedByRole !== undefined && killedByRole !== null) victim.killedByRole = killedByRole;

  victim.diedByVisitingKiller = options.diedByVisitingKiller ?? false;
  victim.diedByVisitingVictim = options.diedByVisitingVictim ?? false;
  victim.isDead = true;

  if (killerIds.length > 0) {
    events.push({
      type: 'PlayerDied',
      playerId: victim.id,
      method,
      killerIds: [...killerIds],
      isNight,
    });
    if (isNight) {
      for (const killerId of killerIds) {
        findPlayer(players, killerId).killedLastNight++;
      }
    }
  } else {
    events.push({ type: 'PlayerDied', playerId: victim.id, method, killerIds: [], isNight });
  }

  // Idle kills / fleeing skip every further consequence (lover chain, hunter shot, ...).
  if (method === 'Idle' || method === 'Flee') {
    victim.diedByFleeOrIdle = true;
    return events;
  }

  if (victim.inLove && victim.loverId !== null) {
    const lover = players.find((x) => x.id === victim.loverId);
    if (lover && !lover.isDead && !dyingSimultaneously.has(lover.id)) {
      events.push({
        type: 'LoverDiedOfGrief',
        playerId: lover.id,
        originalVictimId: victim.id,
        isNight,
      });
      events.push(
        ...killPlayer(players, lover.id, 'LoverDied', {
          killerIds: [victim.id],
          isNight,
          dyingSimultaneously,
        }),
      );
    }
  }

  if (victim.role === ROLE_BIT.WolfCub) {
    events.push({ type: 'WolfCubKilled', playerId: victim.id });
  }

  if (victim.role === ROLE_BIT.Hunter && (options.triggerHunterShot ?? true)) {
    victim.pendingHunterShot = { method, delayed: isNight };
    events.push({ type: 'HunterMustShoot', hunterId: victim.id, method, delayed: isNight });
  }

  return events;
}
