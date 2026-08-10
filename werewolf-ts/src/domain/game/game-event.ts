import type { KillMethod } from './kill-method.js';
import type { Role } from '../roles/role.js';
import type { Team } from './team.js';

/**
 * Domain events emitted by the pure game-state functions (`kill.ts`,
 * `win-condition.ts`). The domain layer never sends Telegram messages or
 * touches the database itself - it returns these events, and the
 * application/infrastructure layers turn them into chat messages, GIFs,
 * achievement unlocks, `GameKill` rows, etc.
 */
export type GameEvent =
  | { type: 'PlayerDied'; playerId: bigint; method: KillMethod; killerIds: bigint[]; isNight: boolean }
  | { type: 'LoverDiedOfGrief'; playerId: bigint; originalVictimId: bigint; isNight: boolean }
  | { type: 'HunterMustShoot'; hunterId: bigint; method: KillMethod; delayed: boolean }
  | { type: 'WolfCubKilled' }
  | { type: 'TraitorBecameWolf'; playerId: bigint }
  | { type: 'SnowWolfBecameWolf'; playerId: bigint }
  | { type: 'CultistAutoConverted'; playerId: bigint }
  | { type: 'CultistHunterKilledCultist'; cultistHunterId: bigint; cultistId: bigint }
  | { type: 'HunterKilledWolfInStandoff'; hunterId: bigint; wolfId: bigint }
  | { type: 'WolfKilledHunterInStandoff'; wolfId: bigint; hunterId: bigint }
  | { type: 'GunnerPreventsWolfWin' }
  | { type: 'GameEnded'; winningTeam: Team }
  | { type: 'PlayerFrozen'; playerId: bigint; cause: 'SnowWolf' }
  | { type: 'GuardianAngelBlockedFreeze'; targetId: bigint; snowWolfId: bigint }
  | { type: 'PlayerDoused'; playerId: bigint; arsonistId: bigint }
  | { type: 'GuardianAngelSavedFromBurning'; playerId: bigint }
  | { type: 'PlayerBitten'; playerId: bigint }
  | { type: 'GuardianAngelBlockedWolfAttack'; targetId: bigint }
  | { type: 'WolvesGotDrunk'; wolfIds: bigint[]; drunkVictimId: bigint }
  | { type: 'WiseElderSurvivedFirstAttack'; playerId: bigint }
  | { type: 'HunterCounterAttack'; hunterId: bigint; shotWolfId: bigint; hunterAlsoDied: boolean }
  | { type: 'CursedTurnedWolf'; playerId: bigint }
  | { type: 'SerialKillerRandomKill'; originalTargetId: bigint; newTargetId: bigint }
  | { type: 'GuardianAngelBlockedSerialKiller'; targetId: bigint }
  | { type: 'PlayerConvertedToCult'; playerId: bigint }
  | { type: 'CultConversionFailed'; targetId: bigint }
  | { type: 'GuardianAngelCleanedDouse'; playerId: bigint }
  | { type: 'RoleStolen'; thiefId: bigint; targetId: bigint; stolenRole: Role }
  | { type: 'WildChildTurnedWolf'; playerId: bigint; roleModelId: bigint }
  | { type: 'DoppelgangerTransformed'; playerId: bigint; newRole: Role; roleModelId: bigint }
  | { type: 'ApprenticeSeerPromoted'; playerId: bigint }
  | { type: 'RoleModelChosen'; playerId: bigint; roleModelId: bigint }
  | { type: 'LoversCreated'; lover1Id: bigint; lover2Id: bigint };
