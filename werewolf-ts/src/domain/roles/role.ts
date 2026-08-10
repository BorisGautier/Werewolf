/**
 * Port of `Shared/Roles.cs` from the original C# project.
 *
 * The original uses a 64-bit `[Flags] enum` so that a single `long` can both
 * (a) identify one role (a single bit) and (b) represent a *set* of roles
 * (several bits combined) - e.g. "which roles are disabled for this group".
 * JS's `&`/`|` operators only work on 32 bits, and the highest role bit here
 * is 2^43, so we use `bigint` everywhere a role bitmask is involved.
 *
 * NOTE (carried over from the original, still true here): in a *group config*
 * bitmask, a bit set to 1 means the role is DISABLED, not enabled.
 */

export const ROLE_NAMES = [
  'Villager',
  'Drunk',
  'Harlot',
  'Seer',
  'Traitor',
  'GuardianAngel',
  'Detective',
  'Wolf',
  'Cursed',
  'Gunner',
  'Tanner',
  'Fool',
  'WildChild',
  'Beholder',
  'ApprenticeSeer',
  'Cultist',
  'CultistHunter',
  'Mason',
  'Doppelganger',
  'Cupid',
  'Hunter',
  'SerialKiller',
  'Sorcerer',
  'AlphaWolf',
  'WolfCub',
  'Blacksmith',
  'ClumsyGuy',
  'Mayor',
  'Prince',
  'Lycan',
  'Pacifist',
  'WiseElder',
  'Oracle',
  'Sandman',
  'WolfMan',
  'Thief',
  'Troublemaker',
  'Chemist',
  'SnowWolf',
  'GraveDigger',
  'Augur',
  'Arsonist',
  'Spumpkin',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/** A single role, represented as its unique bit (mirrors `IRole` used as one flag). */
export type Role = bigint;

/** A combination of roles (e.g. "disabled roles for this group"). Same underlying type as `Role`. */
export type RoleFlags = bigint;

/** Special bit (2^0) marking a config bitmask as "explicitly configured" - see GameBalancing. */
export const ROLE_VALID: RoleFlags = 1n;

export const ROLE_NONE: RoleFlags = 0n;

/** Bit values, assigned in the exact same order/values as the original `IRole` enum (2^1 .. 2^43). */
export const ROLE_BIT: Record<RoleName, Role> = ROLE_NAMES.reduce(
  (acc, name, index) => {
    acc[name] = 1n << BigInt(index + 1);
    return acc;
  },
  {} as Record<RoleName, Role>,
);

const ROLE_BY_BIT = new Map<Role, RoleName>(ROLE_NAMES.map((name) => [ROLE_BIT[name], name]));

export interface RoleMeta {
  emoji: string;
  /** Whether group admins are allowed to disable this role via /config. */
  canBeDisabled: boolean;
}

export const ROLE_META: Record<RoleName, RoleMeta> = {
  Villager: { emoji: '👱', canBeDisabled: false },
  Drunk: { emoji: '🍻', canBeDisabled: true },
  Harlot: { emoji: '💋', canBeDisabled: true },
  Seer: { emoji: '👳', canBeDisabled: true },
  Traitor: { emoji: '🖕', canBeDisabled: true },
  GuardianAngel: { emoji: '👼', canBeDisabled: true },
  Detective: { emoji: '🕵', canBeDisabled: true },
  Wolf: { emoji: '🐺', canBeDisabled: false },
  Cursed: { emoji: '😾', canBeDisabled: true },
  Gunner: { emoji: '🔫', canBeDisabled: true },
  Tanner: { emoji: '👺', canBeDisabled: true },
  Fool: { emoji: '🃏', canBeDisabled: true },
  WildChild: { emoji: '👶', canBeDisabled: true },
  Beholder: { emoji: '👁', canBeDisabled: true },
  ApprenticeSeer: { emoji: '🙇', canBeDisabled: true },
  Cultist: { emoji: '👤', canBeDisabled: true },
  CultistHunter: { emoji: '💂', canBeDisabled: true },
  Mason: { emoji: '👷', canBeDisabled: true },
  Doppelganger: { emoji: '🎭', canBeDisabled: true },
  Cupid: { emoji: '🏹', canBeDisabled: true },
  Hunter: { emoji: '🎯', canBeDisabled: true },
  SerialKiller: { emoji: '🔪', canBeDisabled: true },
  Sorcerer: { emoji: '🔮', canBeDisabled: true },
  AlphaWolf: { emoji: '⚡️', canBeDisabled: true },
  WolfCub: { emoji: '🐶', canBeDisabled: true },
  Blacksmith: { emoji: '⚒', canBeDisabled: true },
  ClumsyGuy: { emoji: '🤕', canBeDisabled: true },
  Mayor: { emoji: '🎖', canBeDisabled: true },
  Prince: { emoji: '👑', canBeDisabled: true },
  Lycan: { emoji: '🐺🌝', canBeDisabled: true },
  Pacifist: { emoji: '☮️', canBeDisabled: true },
  WiseElder: { emoji: '📚', canBeDisabled: true },
  Oracle: { emoji: '🌀', canBeDisabled: true },
  Sandman: { emoji: '💤', canBeDisabled: true },
  WolfMan: { emoji: '👱🌚', canBeDisabled: true },
  Thief: { emoji: '😈', canBeDisabled: true },
  Troublemaker: { emoji: '🤯', canBeDisabled: true },
  Chemist: { emoji: '👨‍🔬', canBeDisabled: true },
  SnowWolf: { emoji: '🐺☃️', canBeDisabled: true },
  GraveDigger: { emoji: '☠️', canBeDisabled: true },
  Augur: { emoji: '🦅', canBeDisabled: true },
  Arsonist: { emoji: '🔥', canBeDisabled: true },
  Spumpkin: { emoji: '🎃', canBeDisabled: false },
};

export function roleBit(name: RoleName): Role {
  return ROLE_BIT[name];
}

export function roleName(bit: Role): RoleName {
  const name = ROLE_BY_BIT.get(bit);
  if (!name) throw new Error(`Unknown role bit: ${bit.toString()}`);
  return name;
}

export function allRoles(): Role[] {
  return ROLE_NAMES.map((name) => ROLE_BIT[name]);
}

export function hasFlag(flags: RoleFlags, role: Role): boolean {
  return (flags & role) === role;
}

export function addFlag(flags: RoleFlags, role: Role): RoleFlags {
  return flags | role;
}

export function removeFlag(flags: RoleFlags, role: Role): RoleFlags {
  return flags & ~role;
}

/** All individual roles present in a combined bitmask (mirrors `GetUniqueRoles`). */
export function getUniqueRoles(flags: RoleFlags): Role[] {
  return allRoles().filter((r) => hasFlag(flags, r));
}
