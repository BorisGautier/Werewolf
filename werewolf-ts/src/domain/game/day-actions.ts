/**
 * Port of the day-phase ability resolutions at the tail end of `DayCycle`:
 * the Gunner's shot and the Spumpkin's detonation. (The Detective's snoop
 * is intentionally not ported as a resolver - re-reading it confirmed it has
 * zero mechanical state effect: an accurate role reveal to the Detective
 * plus a "the wolves might have noticed" message, nothing else.)
 */

import { ROLE_BIT } from '../roles/role.js';
import { killPlayer } from './kill.js';
import type { GameEvent } from './game-event.js';
import { ABSTAIN, type Player } from './player.js';
import { getTeamForRole } from './team.js';

/**
 * Port of the Gunner block. Always spends a bullet and marks the ability
 * used. Shooting the Wise Elder is a special case: the Wise Elder still dies
 * (no immunity from a bullet, unlike their one-time wolf-attack survival),
 * but the guilt costs the Gunner their role entirely - they become a
 * powerless Villager.
 */
export function resolveGunnerShot(players: Player[]): GameEvent[] {
  const events: GameEvent[] = [];

  const gunner = players.find(
    (p) => p.role === ROLE_BIT.Gunner && !p.isDead && p.choice !== null && p.choice !== ABSTAIN,
  );
  if (!gunner) return events;

  const target = players.find((p) => p.id === gunner.choice);
  if (!target) return events;

  gunner.bullet--;
  gunner.hasUsedAbility = true;

  if (target.role === ROLE_BIT.WiseElder) {
    gunner.role = ROLE_BIT.Villager;
    gunner.team = getTeamForRole(ROLE_BIT.Villager);
    gunner.changedRolesCount++;
    gunner.bullet = 0;
    events.push({ type: 'GunnerLostPowerToWiseElder', playerId: gunner.id });
  }

  events.push(...killPlayer(players, target.id, 'Shoot', { killerIds: [gunner.id], isNight: false }));
  return events;
}

/**
 * Port of the Spumpkin block: a 40% chance to detonate, killing both the
 * target *and* the Spumpkin themselves (mirrors the original's
 * `KillPlayer(spumpkin, killMethod: null, killer: null, ...)` - no method/
 * killer attribution for the self-kill, which we map to `'None'` with no
 * killers). Shooting the Wise Elder still costs the Spumpkin their role,
 * same as the Gunner, though this hardly matters since they're about to die
 * anyway - ported for exact parity regardless.
 */
export function resolveSpumpkinDetonate(players: Player[], random: () => number = Math.random): GameEvent[] {
  const events: GameEvent[] = [];

  const spumpkin = players.find(
    (p) => p.role === ROLE_BIT.Spumpkin && !p.isDead && p.choice !== null && p.choice !== ABSTAIN,
  );
  if (!spumpkin) return events;

  const target = players.find((p) => p.id === spumpkin.choice);
  if (!target) return events;

  if (Math.floor(random() * 100) >= 40) return events; // Settings.SpumpkinDetonateChance-equivalent roll failed

  if (target.role === ROLE_BIT.WiseElder) {
    spumpkin.role = ROLE_BIT.Villager;
    spumpkin.team = getTeamForRole(ROLE_BIT.Villager);
    spumpkin.changedRolesCount++;
    events.push({ type: 'GunnerLostPowerToWiseElder', playerId: spumpkin.id });
  }

  events.push(...killPlayer(players, spumpkin.id, 'None', { killerIds: [], isNight: false }));
  events.push(...killPlayer(players, target.id, 'Shoot', { killerIds: [spumpkin.id], isNight: false }));
  return events;
}
