/**
 * Which living roles get a night/day menu, and what a "valid target" looks
 * like for each - a port of the menu-eligibility half of `SendNightActions`/
 * `SendDayActions` (`Werewolf.cs`). The actual *effect* of a choice is 100%
 * decided by the domain layer (`night-resolution.ts`, `day-actions.ts`,
 * `role-changes.ts`); this module only decides who gets asked and which
 * buttons make sense to offer, mirroring the original's `targetBase`
 * filtering. A player picking a target this module wouldn't have offered is
 * still resolved correctly by the domain - these filters are a UX
 * convenience, not a correctness boundary.
 */

import { ROLE_BIT, type Role } from '../../domain/roles/role.js';
import { WOLF_ROLES } from '../../domain/game/game-balancing.js';
import { alivePlayers, type Player } from '../../domain/game/player.js';

/** Roles offered a plain "pick a player" night menu. */
export const NIGHT_TARGET_ROLES: readonly Role[] = [
  ROLE_BIT.Seer,
  ROLE_BIT.Sorcerer,
  ROLE_BIT.Oracle,
  ROLE_BIT.Fool,
  ROLE_BIT.GuardianAngel,
  ROLE_BIT.Harlot,
  ROLE_BIT.SnowWolf,
  ROLE_BIT.SerialKiller,
  ROLE_BIT.CultistHunter,
  ROLE_BIT.Cultist,
  ROLE_BIT.Chemist,
  ROLE_BIT.Thief,
  ROLE_BIT.GraveDigger,
  ROLE_BIT.Augur,
  ROLE_BIT.Watchman,
  ROLE_BIT.Tracker,
  ROLE_BIT.Priestess,
  ROLE_BIT.Mimic,
  ROLE_BIT.Necromancer,
  ROLE_BIT.Reflector,
  ROLE_BIT.Crow,
  ...WOLF_ROLES,
];

/**
 * Roles offered a plain "pick a living player" day menu (the lynch vote itself is handled
 * separately). The Archangel only actually gets this menu while they hold at least one Sacred
 * Bullet (`Game.archangelBulletsMap`) - see the extra gate in `GameLoop.sendDayMenus()`, since that
 * depends on live game state this static list can't express.
 */
export const DAY_TARGET_ROLES: readonly Role[] = [
  ROLE_BIT.Gunner,
  ROLE_BIT.Spumpkin,
  ROLE_BIT.Detective,
  ROLE_BIT.Archangel,
];

/** The five single-button "click to activate" day abilities. */
export const DAY_ABILITY_ROLES: readonly Role[] = [
  ROLE_BIT.Mayor,
  ROLE_BIT.Pacifist,
  ROLE_BIT.Blacksmith,
  ROLE_BIT.Sandman,
  ROLE_BIT.Troublemaker,
];

/** Players a given role can target tonight - excludes self (unless specified). */
export function nightTargets(players: readonly Player[], actor: Player): Player[] {
  if (actor.role === ROLE_BIT.Necromancer) {
    return players.filter((p) => p.isDead);
  }

  const alive = alivePlayers(players).filter((p) => p.id !== actor.id);

  if (actor.role === ROLE_BIT.Arsonist) {
    return alive.filter((p) => !p.doused);
  }
  if (actor.role === ROLE_BIT.SnowWolf) {
    return alive.filter((p) => !p.frozen);
  }
  if (WOLF_ROLES.includes(actor.role)) {
    // A wolf pack doesn't eat its own - matches how the original's targetBase excludes wolf-team members.
    return alive.filter((p) => !WOLF_ROLES.includes(p.role) && p.role !== ROLE_BIT.SnowWolf);
  }
  return alive;
}

/** Living players eligible to be a Wild Child/Doppelganger's role model, or one of Cupid's two lovers. */
export function dayOneTargets(players: readonly Player[], actor: Player): Player[] {
  return alivePlayers(players).filter((p) => p.id !== actor.id);
}
