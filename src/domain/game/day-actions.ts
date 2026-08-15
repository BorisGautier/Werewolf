/**
 * Port of the day-phase ability resolutions at the tail end of `DayCycle`:
 * the Gunner's shot, the Spumpkin's detonation, and the Detective's snoop.
 */

import { ROLE_BIT, type Role } from '../roles/role.js';
import { killPlayer } from './kill.js';
import type { GameEvent } from './game-event.js';
import { ABSTAIN, type Player } from './player.js';
import { getTeamForRole } from './team.js';
import {
  detectiveSnoops,
  gunnerBackfires,
  gunnerHits,
  gunnerShots,
  spumpkinDetonations,
} from '../../infrastructure/monitoring/metrics.js';

/** The "bad team" roles a Detective's snoop (Streetwise) or a Gunner's bullet (SmartGunner) counts as a real hit. */
const THREAT_ROLES: readonly Role[] = [
  ROLE_BIT.Wolf,
  ROLE_BIT.AlphaWolf,
  ROLE_BIT.WolfCub,
  ROLE_BIT.Lycan,
  ROLE_BIT.Cultist,
  ROLE_BIT.SerialKiller,
  ROLE_BIT.SnowWolf,
  ROLE_BIT.Arsonist,
];

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

  gunnerShots.inc();
  gunner.bullet--;
  gunner.hasUsedAbility = true;
  if (THREAT_ROLES.includes(target.role)) {
    gunner.bulletHitBaddies++;
    gunnerHits.inc();
  }

  if (target.role === ROLE_BIT.WiseElder) {
    gunnerBackfires.inc();
    gunner.role = ROLE_BIT.Villager;
    gunner.team = getTeamForRole(ROLE_BIT.Villager);
    gunner.changedRolesCount++;
    gunner.bullet = 0;
    events.push({ type: 'GunnerLostPowerToWiseElder', playerId: gunner.id });
  }

  events.push(...killPlayer(players, target.id, 'Shoot', { killerIds: [gunner.id], isNight: false }));
  return events;
}

export function resolveSpumpkinDetonate(players: Player[], random: () => number = Math.random): GameEvent[] {
  const events: GameEvent[] = [];

  const spumpkin = players.find(
    (p) => p.role === ROLE_BIT.Spumpkin && !p.isDead && p.choice !== null && p.choice !== ABSTAIN,
  );
  if (!spumpkin) return events;

  const target = players.find((p) => p.id === spumpkin.choice);
  if (!target) return events;

  if (Math.floor(random() * 100) >= 40) return events;

  spumpkinDetonations.inc();
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

export function resolveDetectiveSnoop(players: Player[], random: () => number = Math.random): GameEvent[] {
  const events: GameEvent[] = [];

  const detective = players.find(
    (p) => p.role === ROLE_BIT.Detective && !p.isDead && p.choice !== null && p.choice !== ABSTAIN,
  );
  if (!detective) return events;

  detectiveSnoops.inc();
  if (Math.floor(random() * 100) < 40) {
    events.push({ type: 'DetectiveCaught', playerId: detective.id });
  }

  const target = players.find((p) => p.id === detective.choice);
  if (!target) return events;

  events.push({ type: 'DetectiveSnoop', playerId: detective.id, targetId: target.id, targetRole: target.role });

  if (!THREAT_ROLES.includes(target.role)) {
    detective.correctSnoopedIds = [];
  } else {
    if (detective.correctSnoopedIds.includes(target.id)) detective.correctSnoopedIds = [];
    detective.correctSnoopedIds.push(target.id);
    if (detective.correctSnoopedIds.length >= 4) {
      detective.streetwise = true;
      detective.correctSnoopedIds = [];
    }
  }

  return events;
}
