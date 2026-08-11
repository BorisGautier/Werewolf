import type { RoleName } from '../../domain/roles/role.js';
import type { KillMethod } from '../../domain/game/kill-method.js';

const WOLF_ROLE_NAMES: ReadonlySet<RoleName> = new Set(['Wolf', 'AlphaWolf', 'Lycan', 'WolfCub']);

/** Wolf-eaten-at-home victims whose role is revealed through the flavor text itself. */
const EATEN_ROLE_KEY: Partial<Record<RoleName, string>> = {
  ApprenticeSeer: 'ApprenticeSeerEaten',
  Detective: 'DetectiveEaten',
  Drunk: 'DrunkEaten',
  Fool: 'FoolEaten',
  Gunner: 'GunnerEaten',
  Harlot: 'HarlotEaten',
  Mason: 'MasonEaten',
  Seer: 'SeerEaten',
  Sorcerer: 'SorcererEaten',
  WildChild: 'WildChildEaten',
  GuardianAngel: 'GuardianEaten',
};

/** Serial Killer victims with their own flavor text. */
const SERIAL_KILLED_ROLE_KEY: Partial<Record<RoleName, string>> = {
  Blacksmith: 'BlacksmithKilled',
  Cultist: 'CultistKilled',
  Cupid: 'CupidKilled',
  Drunk: 'DrunkKilled',
  GuardianAngel: 'GuardianAngelKilled',
  Gunner: 'GunnerKilled',
  Mayor: 'MayorKilled',
  Prince: 'PrinceKilled',
  Seer: 'SeerKilled',
};

/** Victims who stumbled into a grave the Grave Digger dug, with their own flavor text. */
const GRAVEDIGGER_FELL_ROLE_KEY: Partial<Record<RoleName, string>> = {
  Harlot: 'HarlotFellPublic',
  Cultist: 'CultistFellPublic',
  Thief: 'ThiefFellPublic',
};

/** Died visiting the Serial Killer (`'VisitKiller'`), keyed by the dying player's own role. */
const VISIT_KILLER_ROLE_KEY: Partial<Record<RoleName, string>> = {
  Wolf: 'SerialKillerKilledWolf',
  AlphaWolf: 'SerialKillerKilledWolf',
  Lycan: 'SerialKillerKilledWolf',
  WolfCub: 'SerialKillerKilledWolf',
  CultistHunter: 'SerialKillerKilledCH',
  Thief: 'ThiefStoleKiller',
  Chemist: 'ChemistSKPublic',
  SnowWolf: 'SnowFrozeKiller',
  Arsonist: 'ArsonistVisitKiller',
  Cultist: 'CultConvertKillerPublic',
  Harlot: 'HarlotFuckKillerPublic',
  GuardianAngel: 'GAGuardedKiller',
};

/** Died visiting a wolf (`'VisitWolf'`), keyed by the dying player's own role. */
const VISIT_WOLF_ROLE_KEY: Partial<Record<RoleName, string>> = {
  Harlot: 'HarlotFuckedWolfPublic',
  Cultist: 'CultConvertWolfPublic',
};

export interface DeathFlavor {
  key: string;
  /** Whether this key's template has a second `{1}` slot for the explicit "X was a Y" reveal. */
  includeRoleArg: boolean;
}

/**
 * Picks the specific "how did they die" flavor-text key for a `PlayerDied` group announcement,
 * mirroring `Werewolf.cs`'s `KilledByRole`/`PlayerRole` switch inside its `!secret` branch (the
 * entire switch only ever runs when `ShowRolesDeath` is on - when it's off the original always
 * shows a single generic no-reveal line instead, which is exactly what the `PlayerFoundDead`
 * fallback in `messages.ts` already does). Returns `null` for methods/roles without their own
 * flavor text (lynching - handled separately - fleeing, idling, ...); the caller falls back to
 * the generic `PlayerFoundDeadWithRole` in that case.
 *
 * Two of the original's "died while visiting" variants are deliberately not here:
 *  - `HunterShotWolf`/`HunterShotWolfMulti` (a wolf shot dead by the Hunter's counter-attack) -
 *    already fully narrated by the dedicated `HunterCounterAttackMsg` event, so adding a second
 *    flavor line for the same death here would just double the announcement.
 *  - The Harlot's two "found the wolves'/Serial Killer's actual victim" variants
 *    (`HarlotFuckedVictimPublic`/`HarlotFuckedKilledPublic`, `'VisitVictim'` method) need a
 *    *second player's* name (whoever she found dead), not a role reveal - that shape doesn't fit
 *    this function's `(key, includeRoleArg)` contract, so `messages.ts` builds it directly from
 *    the event's `killerIds[0]` (the found victim's id, per `resolveHarlotNight`).
 */
export function deathFlavorKey(
  method: KillMethod,
  role: RoleName,
  selfInflicted: boolean,
  killedByRole: RoleName | null,
): DeathFlavor | null {
  switch (method) {
    case 'Eat': {
      const key = EATEN_ROLE_KEY[role];
      return key ? { key, includeRoleArg: false } : { key: 'DefaultEaten', includeRoleArg: true };
    }
    case 'SerialKilled': {
      const key = SERIAL_KILLED_ROLE_KEY[role];
      return key ? { key, includeRoleArg: false } : { key: 'DefaultKilled', includeRoleArg: true };
    }
    case 'FallGrave': {
      if (WOLF_ROLE_NAMES.has(role)) return { key: 'WolfFellPublic', includeRoleArg: true };
      const key = GRAVEDIGGER_FELL_ROLE_KEY[role];
      return key ? { key, includeRoleArg: false } : { key: 'DefaultFellPublic', includeRoleArg: true };
    }
    case 'VisitBurning':
      return WOLF_ROLE_NAMES.has(role)
        ? { key: 'WolfVisitBurn', includeRoleArg: true }
        : { key: 'DefaultVisitBurn', includeRoleArg: true };
    case 'Chemistry':
      return selfInflicted ? { key: 'ChemistFailPublic', includeRoleArg: false } : { key: 'ChemistSuccessPublic', includeRoleArg: true };
    case 'VisitKiller': {
      const key = VISIT_KILLER_ROLE_KEY[role];
      return key ? { key, includeRoleArg: false } : null;
    }
    case 'VisitWolf': {
      const key = VISIT_WOLF_ROLE_KEY[role];
      return key ? { key, includeRoleArg: false } : null;
    }
    case 'GuardWolf':
      return { key: 'GAGuardedWolf', includeRoleArg: false };
    case 'Hunt':
      return role === 'Cultist' ? { key: 'HunterKilledCultist', includeRoleArg: false } : null;
    case 'HunterCult':
      return role === 'Cultist' ? { key: 'HunterKilledVisiter', includeRoleArg: true } : null;
    case 'Spotted':
      if (role !== 'GraveDigger') return null;
      return killedByRole === 'SerialKiller'
        ? { key: 'KillerSpottedDiggerPublic', includeRoleArg: false }
        : { key: 'WolvesSpottedDiggerPublic', includeRoleArg: false };
    default:
      return null;
  }
}
