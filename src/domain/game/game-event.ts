import type { KillMethod } from './kill-method.js';
import type { Role } from '../roles/role.js';
import type { Team } from './team.js';

/**
 * Which "you woke up frozen" flavor text a Snow Wolf's target gets, mirroring the role switch in
 * `Werewolf.cs`'s `#region Snow Wolf Night` (`SKFrozen`/`HarlotFrozen`/.../`DefaultFrozen`).
 * Captured at freeze time rather than re-derived from the target's post-resolution state, because
 * two of the branches (`GraveDiggerDug`, `Thief`) depend on state (`dugGravesLastNight`, the
 * group's `thiefFull` setting) that either gets reset or isn't visible by the time messages are
 * built.
 */
export type FreezeFlavor =
  | 'SerialKiller'
  | 'Harlot'
  | 'Chemist'
  | 'Cultist'
  | 'CultistHunter'
  | 'Seeing'
  | 'GuardianAngel'
  | 'Thief'
  | 'GraveDiggerDug'
  | 'Arsonist'
  | 'Default';

/**
 * Domain events emitted by the pure game-state functions (`kill.ts`,
 * `win-condition.ts`). The domain layer never sends Telegram messages or
 * touches the database itself - it returns these events, and the
 * application/infrastructure layers turn them into chat messages, GIFs,
 * achievement unlocks, `GameKill` rows, etc.
 */
export type GameEvent =
  | {
      type: 'PlayerDied';
      playerId: bigint;
      method: KillMethod;
      killerIds: bigint[];
      isNight: boolean;
    }
  | { type: 'LoverDiedOfGrief'; playerId: bigint; originalVictimId: bigint; isNight: boolean }
  | { type: 'HunterMustShoot'; hunterId: bigint; method: KillMethod; delayed: boolean }
  | { type: 'WolfCubKilled'; playerId: bigint }
  | { type: 'TraitorBecameWolf'; playerId: bigint }
  | { type: 'SnowWolfBecameWolf'; playerId: bigint }
  | { type: 'CultistAutoConverted'; playerId: bigint }
  | { type: 'CultistHunterKilledCultist'; cultistHunterId: bigint; cultistId: bigint }
  | { type: 'HunterKilledWolfInStandoff'; hunterId: bigint; wolfId: bigint }
  | { type: 'WolfKilledHunterInStandoff'; wolfId: bigint; hunterId: bigint }
  | { type: 'GunnerPreventsWolfWin' }
  | { type: 'GameEnded'; winningTeam: Team }
  | {
      type: 'PlayerFrozen';
      playerId: bigint;
      cause: 'SnowWolf';
      snowWolfId: bigint;
      flavor: FreezeFlavor;
    }
  | { type: 'GuardianAngelBlockedFreeze'; targetId: bigint; snowWolfId: bigint }
  | { type: 'PlayerDoused'; playerId: bigint; arsonistId: bigint }
  | { type: 'GuardianAngelSavedFromBurning'; playerId: bigint }
  | { type: 'PlayerBitten'; playerId: bigint; alphaId: bigint | null }
  | { type: 'GuardianAngelBlockedWolfAttack'; targetId: bigint }
  | { type: 'WolvesGotDrunk'; wolfIds: bigint[]; drunkVictimId: bigint }
  | { type: 'WiseElderSurvivedFirstAttack'; playerId: bigint }
  | { type: 'HunterCounterAttack'; hunterId: bigint; shotWolfId: bigint; hunterAlsoDied: boolean }
  | { type: 'CursedTurnedWolf'; playerId: bigint }
  | { type: 'SerialKillerRandomKill'; originalTargetId: bigint; newTargetId: bigint }
  | { type: 'GuardianAngelBlockedSerialKiller'; targetId: bigint }
  | { type: 'PlayerConvertedToCult'; playerId: bigint }
  | { type: 'CultConversionFailed'; targetId: bigint }
  | { type: 'GuardianAngelCleanedDouse'; gaId: bigint; playerId: bigint }
  | { type: 'GuardianAngelSaved'; gaId: bigint; targetId: bigint }
  | { type: 'GuardianAngelSavedTargetFromFire'; gaId: bigint; targetId: bigint }
  | { type: 'GuardianAngelNoAttack'; gaId: bigint; targetId: bigint }
  | { type: 'GuardianAngelTargetEmpty'; gaId: bigint; targetId: bigint }
  | { type: 'GuardianAngelDiedProtecting'; gaId: bigint; targetId: bigint }
  | { type: 'ChemistPoisoned'; chemistId: bigint; targetId: bigint }
  | { type: 'ChemistTargetAlreadyDead'; chemistId: bigint; targetId: bigint }
  | { type: 'ChemistTargetEmpty'; chemistId: bigint; targetId: bigint }
  | { type: 'ChemistDiedVisiting'; chemistId: bigint; targetId: bigint }
  | { type: 'RoleStolen'; thiefId: bigint; targetId: bigint; stolenRole: Role }
  | { type: 'ThiefStealForced'; thiefId: bigint; targetId: bigint }
  | { type: 'WildChildTurnedWolf'; playerId: bigint; roleModelId: bigint }
  | { type: 'DoppelgangerTransformed'; playerId: bigint; newRole: Role; roleModelId: bigint }
  | { type: 'ApprenticeSeerPromoted'; playerId: bigint }
  | { type: 'RoleModelChosen'; playerId: bigint; roleModelId: bigint }
  | { type: 'LoversCreated'; lover1Id: bigint; lover2Id: bigint }
  | { type: 'GunnerLostPowerToWiseElder'; playerId: bigint }
  | { type: 'ChemistLostPowerToWiseElder'; playerId: bigint }
  | { type: 'HunterLostPowerToWiseElder'; playerId: bigint }
  | { type: 'BittenPlayerTurnedWolf'; playerId: bigint }
  | { type: 'GraveDug'; playerId: bigint; graveCount: number }
  | { type: 'BlacksmithSpreadSilver'; playerId: bigint; dayNumber: number }
  | { type: 'SandmanUsedSleep'; playerId: bigint; dayNumber: number }
  | { type: 'WolfPackAteTwice'; alphaId: bigint | null }
  | { type: 'AlphaWolfLuckyDay'; alphaId: bigint }
  | { type: 'SeerVision'; playerId: bigint; targetId: bigint; shownRole: Role }
  | { type: 'SorcererVision'; playerId: bigint; targetId: bigint; detectedRole: Role | null }
  | { type: 'FoolVision'; playerId: bigint; targetId: bigint; shownRole: Role | null }
  | { type: 'OracleVision'; playerId: bigint; targetId: bigint; shownRole: Role | null }
  | { type: 'AugurVision'; playerId: bigint; shownRole: Role | null }
  | { type: 'DetectiveSnoop'; playerId: bigint; targetId: bigint; targetRole: Role }
  | { type: 'DetectiveCaught'; playerId: bigint }
  | { type: 'HarlotVisited'; harlotId: bigint; targetId: bigint }
  | { type: 'ChemistBackfired'; chemistId: bigint; targetId: bigint }
  | { type: 'WolfPackHasDrunkMembers'; soberWolfIds: bigint[] };
