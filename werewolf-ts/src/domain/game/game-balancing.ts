/**
 * Port of `Shared/GameBalancing.cs`.
 *
 * Given a player count and a set of disabled roles, produces a balanced (or
 * "chaos", unbalanced-on-purpose) list of roles to deal out to players. The
 * algorithm is a faithful line-by-line port of the original: build a pool of
 * candidate roles, shuffle, patch up a few "doesn't make sense alone" cases,
 * then score village-strength vs enemy-strength and retry (up to 500 times)
 * until the game is roughly balanced.
 */

import { randomInt } from 'node:crypto';
import { ROLE_NAMES, ROLE_BIT, type Role, type RoleFlags, getUniqueRoles, hasFlag } from '../roles/role.js';

export const WOLF_ROLES: readonly Role[] = [
  ROLE_BIT.Wolf,
  ROLE_BIT.AlphaWolf,
  ROLE_BIT.WolfCub,
  ROLE_BIT.Lycan,
];

const WOLF_ROLES_WITH_SNOW: readonly Role[] = [...WOLF_ROLES, ROLE_BIT.SnowWolf];

/** Roles that are not on the village team (mirrors `nonVgRoles`). */
const NON_VILLAGE_ROLES: readonly Role[] = [
  ROLE_BIT.Cultist,
  ROLE_BIT.SerialKiller,
  ROLE_BIT.Tanner,
  ROLE_BIT.Wolf,
  ROLE_BIT.AlphaWolf,
  ROLE_BIT.Sorcerer,
  ROLE_BIT.WolfCub,
  ROLE_BIT.Lycan,
  ROLE_BIT.Thief,
  ROLE_BIT.SnowWolf,
  ROLE_BIT.Arsonist,
];

/** Village roles whose identity is revealed / known, capping how many can appear (mirrors `revealedVgRoles`). */
const REVEALED_VILLAGE_ROLES: readonly Role[] = [
  ROLE_BIT.Blacksmith,
  ROLE_BIT.Mayor,
  ROLE_BIT.Pacifist,
  ROLE_BIT.Gunner,
  ROLE_BIT.Sandman,
  ROLE_BIT.Troublemaker,
];

/** Roles whose kill/lynch-blocking ability can stall the game (mirrors the `killStoppingRoleCount` check). */
const KILL_STOPPING_ROLES: readonly Role[] = [ROLE_BIT.Troublemaker, ROLE_BIT.Sandman];

const MAX_BALANCE_ATTEMPTS = 500;

export class UnbalanceableGameError extends Error {
  constructor(playerCount: number) {
    super(`Unable to create a balanced game. Please try again.\nPlayer count: ${playerCount}`);
    this.name = 'UnbalanceableGameError';
  }
}

/** Cryptographically-random Fisher-Yates shuffle (mirrors the RNGCryptoServiceProvider-based `Shuffle`). */
function shuffle<T>(list: T[]): void {
  for (let n = list.length; n > 1; ) {
    const k = randomInt(n);
    n--;
    const tmp = list[k]!;
    list[k] = list[n]!;
    list[n] = tmp;
  }
}

function includesRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role);
}

function countOf(roles: readonly Role[], role: Role): number {
  return roles.filter((r) => r === role).length;
}

export interface BalanceResult {
  /** The roles actually assigned to players, one per player, in random order. */
  rolesToAssign: Role[];
  /** The full candidate pool that was drawn from (useful for "possible roles" UI, e.g. Beholder hints). */
  possibleRoles: Role[];
}

export interface BalanceOptions {
  /** Roles disabled by group config, or roles individually toggled off (see `getUniqueRoles`). */
  disabledRoleFlags: RoleFlags;
  playerCount: number;
  chaos: boolean;
  burningOverkill: boolean;
  /** Set only when validating a config (mirrors `validationMode`): treats every flag bit as meaningful. */
  validationMode?: boolean;
}

export function balance(options: BalanceOptions): BalanceResult {
  const { playerCount, chaos, burningOverkill, validationMode = false } = options;

  const disabledRoles =
    hasFlag(options.disabledRoleFlags, 1n) || validationMode
      ? getUniqueRoles(options.disabledRoleFlags)
      : [];

  let rolesToAssign: Role[] = [];
  let possibleRoles: Role[] = [];
  let balanced = false;
  let attempts = 0;

  do {
    attempts++;
    if (attempts >= MAX_BALANCE_ATTEMPTS) {
      throw new UnbalanceableGameError(playerCount);
    }

    rolesToAssign = getRoleList(playerCount, disabledRoles);
    while (rolesToAssign.length < playerCount) rolesToAssign.push(ROLE_BIT.Villager);

    possibleRoles = [...rolesToAssign];
    shuffle(rolesToAssign);
    rolesToAssign = rolesToAssign.slice(0, playerCount);

    // Sorcerer/Traitor/SnowWolf without any wolves are pointless - convert one to a wolf.
    if (
      (includesRole(rolesToAssign, ROLE_BIT.Sorcerer) ||
        includesRole(rolesToAssign, ROLE_BIT.Traitor) ||
        includesRole(rolesToAssign, ROLE_BIT.SnowWolf)) &&
      !rolesToAssign.some((r) => WOLF_ROLES.includes(r))
    ) {
      const toWolfIndex = rolesToAssign.findIndex(
        (r) => r === ROLE_BIT.Sorcerer || r === ROLE_BIT.Traitor || r === ROLE_BIT.SnowWolf,
      );
      const possibleWolves = WOLF_ROLES.filter((r) => !disabledRoles.includes(r));
      if (toWolfIndex >= 0 && possibleWolves.length > 0) {
        rolesToAssign[toWolfIndex] = possibleWolves[randomInt(possibleWolves.length)]!;
      }
    }

    // Cultist without a Cultist Hunter -> promote a villager to Cultist Hunter (unless disabled).
    if (
      includesRole(rolesToAssign, ROLE_BIT.Cultist) &&
      !includesRole(rolesToAssign, ROLE_BIT.CultistHunter) &&
      !disabledRoles.includes(ROLE_BIT.CultistHunter)
    ) {
      const vgIndex = rolesToAssign.findIndex((r) => !NON_VILLAGE_ROLES.includes(r));
      if (vgIndex >= 0) rolesToAssign[vgIndex] = ROLE_BIT.CultistHunter;
    }

    // Apprentice Seer without a Seer -> becomes a Seer.
    if (includesRole(rolesToAssign, ROLE_BIT.ApprenticeSeer) && !includesRole(rolesToAssign, ROLE_BIT.Seer)) {
      const idx = rolesToAssign.indexOf(ROLE_BIT.ApprenticeSeer);
      rolesToAssign[idx] = ROLE_BIT.Seer;
    }

    // Need at least two teams: some villagers, and at least one "real" enemy.
    const hasVillageTeam = rolesToAssign.some((r) => !NON_VILLAGE_ROLES.includes(r));
    const hasRealEnemy = rolesToAssign.some(
      (r) => NON_VILLAGE_ROLES.includes(r) && r !== ROLE_BIT.Sorcerer && r !== ROLE_BIT.Tanner && r !== ROLE_BIT.Thief,
    );
    balanced = hasVillageTeam && hasRealEnemy;

    // Enemy count must stay below village count.
    const enemyCount = rolesToAssign.filter((r) => NON_VILLAGE_ROLES.includes(r)).length;
    const villageCount = rolesToAssign.filter((r) => !NON_VILLAGE_ROLES.includes(r)).length;
    if (enemyCount >= villageCount) balanced = false;

    if (includesRole(rolesToAssign, ROLE_BIT.SerialKiller) && includesRole(rolesToAssign, ROLE_BIT.Arsonist)) {
      balanced = balanced && burningOverkill;
    }

    if (!chaos) {
      const villageStrength = rolesToAssign
        .filter((r) => !NON_VILLAGE_ROLES.includes(r))
        .reduce((sum, r) => sum + getStrength(r, rolesToAssign), 0);
      const enemyStrength = rolesToAssign
        .filter((r) => NON_VILLAGE_ROLES.includes(r))
        .reduce((sum, r) => sum + getStrength(r, rolesToAssign), 0);

      const varianceAllowed = Math.floor(playerCount / 4) + 1;
      balanced = balanced && Math.abs(villageStrength - enemyStrength) <= varianceAllowed;

      // Unbalanced if more than one revealed village role per 3 players.
      const revealedCount = rolesToAssign.filter((r) => REVEALED_VILLAGE_ROLES.includes(r)).length;
      if (revealedCount * 3 > rolesToAssign.length) balanced = false;

      // Unbalanced if too many kill/lynch-stopping roles relative to player count.
      const onlyWolfBaddies = !rolesToAssign.some(
        (r) => r === ROLE_BIT.Arsonist || r === ROLE_BIT.SerialKiller || r === ROLE_BIT.Cultist,
      );
      const killStoppingCount = rolesToAssign.filter(
        (r) => KILL_STOPPING_ROLES.includes(r) || (onlyWolfBaddies && r === ROLE_BIT.Blacksmith),
      ).length;
      if (killStoppingCount * 4 > rolesToAssign.length) balanced = false;
    }
  } while (!balanced);

  return { rolesToAssign, possibleRoles };
}

/** Mirrors `TryBalance`: checks whether a config can produce a valid game up to `maxPlayers`. */
export function tryBalance(disabledRoleFlags: RoleFlags, maxPlayers: number): boolean {
  for (let playerCount = 5; playerCount <= maxPlayers; playerCount++) {
    try {
      balance({
        disabledRoleFlags,
        playerCount,
        chaos: false,
        burningOverkill: true,
        validationMode: true,
      });
    } catch (err) {
      if (err instanceof UnbalanceableGameError) return false;
      throw err;
    }
  }
  return true;
}

/** Mirrors `GetRoleList`: builds the candidate role pool for a given player count. */
export function getRoleList(playerCount: number, disabledRoles: readonly Role[]): Role[] {
  const rolesToAssign: Role[] = [];

  // Max wolf population: 1 wolf per 5 players, capped at 5.
  let possibleWolves = WOLF_ROLES_WITH_SNOW.filter((r) => !disabledRoles.includes(r));
  const wolfSlots = Math.min(Math.max(Math.floor(playerCount / 5), 1), 5);
  let wolfToAdd = possibleWolves[randomInt(possibleWolves.length)]!;
  for (let i = 0; i < wolfSlots; i++) {
    rolesToAssign.push(wolfToAdd);
    if (wolfToAdd !== ROLE_BIT.Wolf) {
      possibleWolves = possibleWolves.filter((r) => r !== wolfToAdd);
    }
    wolfToAdd = possibleWolves[randomInt(possibleWolves.length)]!;
  }

  // Avoid lone snow wolves.
  if (rolesToAssign.length === 1 && rolesToAssign[0] === ROLE_BIT.SnowWolf) {
    rolesToAssign[0] = ROLE_BIT.Wolf;
  }

  // Add the rest of the role pool.
  for (const name of ROLE_NAMES) {
    const role = ROLE_BIT[name];
    if (WOLF_ROLES_WITH_SNOW.includes(role)) continue;
    if (role === ROLE_BIT.CultistHunter || role === ROLE_BIT.Cultist) {
      if (playerCount > 10) rolesToAssign.push(role);
      continue;
    }
    if (role === ROLE_BIT.Spumpkin) continue;
    rolesToAssign.push(role);
  }

  // A couple more masons - the team is stronger with numbers.
  rolesToAssign.push(ROLE_BIT.Mason, ROLE_BIT.Mason);

  if (includesRole(rolesToAssign, ROLE_BIT.CultistHunter)) {
    rolesToAssign.push(ROLE_BIT.Cultist, ROLE_BIT.Cultist);
  }

  // Pad with villagers for larger games.
  for (let i = 0; i < Math.floor(playerCount / 4); i++) {
    rolesToAssign.push(ROLE_BIT.Villager);
  }

  return rolesToAssign.filter((r) => !disabledRoles.includes(r));
}

const NON_CONVERTIBLE_ROLES: readonly Role[] = [
  ROLE_BIT.Seer,
  ROLE_BIT.GuardianAngel,
  ROLE_BIT.Detective,
  ROLE_BIT.Cursed,
  ROLE_BIT.Harlot,
  ROLE_BIT.Hunter,
  ROLE_BIT.Doppelganger,
  ROLE_BIT.Wolf,
  ROLE_BIT.AlphaWolf,
  ROLE_BIT.WolfCub,
  ROLE_BIT.SerialKiller,
  ROLE_BIT.Lycan,
  ROLE_BIT.Thief,
  ROLE_BIT.SnowWolf,
];

/** Mirrors `GetStrength`: a role's numeric power level, used to balance village vs enemy strength. */
export function getStrength(role: Role, allRolesInGame: readonly Role[]): number {
  switch (role) {
    case ROLE_BIT.Villager:
      return 1;
    case ROLE_BIT.Drunk:
      return 3;
    case ROLE_BIT.Harlot:
      return 6;
    case ROLE_BIT.Seer:
      return (
        7 -
        countOf(allRolesInGame, ROLE_BIT.Lycan) -
        countOf(allRolesInGame, ROLE_BIT.WolfMan) * 2
      );
    case ROLE_BIT.Traitor:
      return 0;
    case ROLE_BIT.GuardianAngel:
      return 7 + (includesRole(allRolesInGame, ROLE_BIT.Arsonist) ? 1 : 0);
    case ROLE_BIT.Detective:
      return 6;
    case ROLE_BIT.Wolf:
      return 10;
    case ROLE_BIT.Cursed:
      return (
        1 -
        Math.floor(
          allRolesInGame.filter((r) => WOLF_ROLES.includes(r) || r === ROLE_BIT.SnowWolf).length / 2,
        )
      );
    case ROLE_BIT.Gunner:
      return 6;
    case ROLE_BIT.Tanner:
      return Math.floor(allRolesInGame.length / 2);
    case ROLE_BIT.Fool:
      return 3;
    case ROLE_BIT.WildChild:
      return 1;
    case ROLE_BIT.Beholder:
      return (
        1 +
        (includesRole(allRolesInGame, ROLE_BIT.Seer) ? 4 : 0) +
        (includesRole(allRolesInGame, ROLE_BIT.Fool) ? 1 : 0)
      );
    case ROLE_BIT.ApprenticeSeer:
      return 6;
    case ROLE_BIT.Cultist:
      return 10 + allRolesInGame.filter((r) => !NON_CONVERTIBLE_ROLES.includes(r)).length;
    case ROLE_BIT.CultistHunter:
      return countOf(allRolesInGame, ROLE_BIT.Cultist) === 0 ? 1 : 7;
    case ROLE_BIT.Mason: {
      const masonCount = countOf(allRolesInGame, ROLE_BIT.Mason);
      return masonCount <= 1 ? 1 : masonCount + 3;
    }
    case ROLE_BIT.Doppelganger:
      return 2;
    case ROLE_BIT.Cupid:
      return 2;
    case ROLE_BIT.Hunter:
      return 6;
    case ROLE_BIT.SerialKiller:
      return 15;
    case ROLE_BIT.Sorcerer:
      return 2;
    case ROLE_BIT.AlphaWolf:
      return 12;
    case ROLE_BIT.WolfCub: {
      const enablesAnotherWolf = [
        ROLE_BIT.AlphaWolf,
        ROLE_BIT.Wolf,
        ROLE_BIT.Lycan,
        ROLE_BIT.SnowWolf,
        ROLE_BIT.WildChild,
        ROLE_BIT.Doppelganger,
        ROLE_BIT.Cursed,
        ROLE_BIT.Traitor,
      ].some((r) => includesRole(allRolesInGame, r));
      return enablesAnotherWolf ? 12 : 10;
    }
    case ROLE_BIT.Blacksmith:
      return 5;
    case ROLE_BIT.ClumsyGuy:
      return -1;
    case ROLE_BIT.Mayor:
      return 4;
    case ROLE_BIT.Prince:
      return 3;
    case ROLE_BIT.WolfMan:
      return 1;
    case ROLE_BIT.Augur:
      return 5;
    case ROLE_BIT.Pacifist:
      return 3;
    case ROLE_BIT.WiseElder:
      return 3;
    case ROLE_BIT.Oracle:
      return 4;
    case ROLE_BIT.Sandman:
      return 3;
    case ROLE_BIT.Lycan:
      return 10;
    case ROLE_BIT.Thief:
      return 0;
    case ROLE_BIT.Troublemaker:
      return 5;
    case ROLE_BIT.Chemist:
      return 0;
    case ROLE_BIT.SnowWolf:
      return 15;
    case ROLE_BIT.GraveDigger:
      return 5;
    case ROLE_BIT.Arsonist:
      return 8;
    case ROLE_BIT.Spumpkin:
      return 2;
    default:
      throw new RangeError(`Unknown role: ${role.toString()}`);
  }
}
