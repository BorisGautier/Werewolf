/**
 * Turns a `GameEvent` into one or more chat messages - the part of
 * `Werewolf.cs`'s `NightCycle`/`DayCycle`/`LynchCycle`/`CheckForGameEnd` that
 * was all `Send(...)`/`SendWithQueue(...)` calls interleaved with the game
 * logic itself. Deliberately not exhaustive: role-change/allegiance-secret
 * events (a Cursed villager silently turning Wolf, Cupid's lovers, ...) are
 * PM'd only to the player(s) directly affected, matching the original's
 * information-hiding; a few purely mechanical events (an Augur's memory
 * update, a failed cult conversion, ...) have no player-visible text at all
 * and are intentionally skipped here.
 */

import { ROLE_BIT, ROLE_META, roleName } from '../../domain/roles/role.js';
import { findById, type Player } from '../../domain/game/player.js';
import type { GameEvent } from '../../domain/game/game-event.js';
import type { Team } from '../../domain/game/team.js';
import { deathFlavorKey } from './death-messages.js';

export interface OutgoingMessage {
  /** `'group'` broadcasts to the game's chat; a `bigint` PMs that one player. */
  audience: 'group' | bigint;
  key: string;
  args: unknown[];
}

const TEAM_WIN_KEY: Record<Team, string> = {
  Village: 'VillagersWin',
  Wolf: 'WolvesWin',
  Tanner: 'TannerWin',
  Cult: 'CultWins',
  SerialKiller: 'SerialKillerWins',
  Arsonist: 'ArsonistWins',
  Lovers: 'LoversWin',
  SKHunter: 'SKHunterWin',
  NoOne: 'NoWinner',
  Neutral: 'GenericTeamWin',
  Thief: 'GenericTeamWin',
};

function displayRole(role: bigint): string {
  const name = roleName(role);
  return `${ROLE_META[name].emoji} ${name}`;
}

function nameOf(players: readonly Player[], id: bigint): string {
  return findById(players, id)?.name ?? '???';
}

/** @param showRolesOnDeath mirrors the group's `ShowRolesDeath` config flag. */
export function describeEvent(
  event: GameEvent,
  players: readonly Player[],
  showRolesOnDeath: boolean,
): OutgoingMessage[] {
  const name = (id: bigint) => nameOf(players, id);
  const role = (id: bigint) => displayRole(findById(players, id)?.role ?? 0n);

  switch (event.type) {
    case 'PlayerDied': {
      if (event.method === 'Lynch') {
        return [
          {
            audience: 'group',
            key: showRolesOnDeath ? 'PlayerLynchedWithRole' : 'PlayerLynched',
            args: showRolesOnDeath ? [name(event.playerId), role(event.playerId)] : [name(event.playerId)],
          },
        ];
      }

      if (showRolesOnDeath) {
        const victim = findById(players, event.playerId);

        // The Harlot stumbling onto the wolves'/Serial Killer's actual victim needs that other
        // player's name, not a role reveal - doesn't fit deathFlavorKey's (key, includeRoleArg)
        // shape, so it's built directly here. `killerIds[0]` is the found victim's id (see
        // resolveHarlotNight's 'VisitVictim' call).
        if (event.method === 'VisitVictim' && victim?.role === ROLE_BIT.Harlot && event.killerIds[0] !== undefined) {
          const foundVictimRole = victim.killedByRole !== null ? roleName(victim.killedByRole) : null;
          const key = foundVictimRole === 'SerialKiller' ? 'HarlotFuckedKilledPublic' : 'HarlotFuckedVictimPublic';
          return [{ audience: 'group', key, args: [name(event.playerId), name(event.killerIds[0])] }];
        }

        const selfInflicted = event.killerIds.length === 1 && event.killerIds[0] === event.playerId;
        const killedByRole = victim?.killedByRole != null ? roleName(victim.killedByRole) : null;
        const flavor = victim ? deathFlavorKey(event.method, roleName(victim.role), selfInflicted, killedByRole) : null;
        if (flavor) {
          return [
            {
              audience: 'group',
              key: flavor.key,
              args: flavor.includeRoleArg ? [name(event.playerId), role(event.playerId)] : [name(event.playerId)],
            },
          ];
        }
      }

      return [
        {
          audience: 'group',
          key: showRolesOnDeath ? 'PlayerFoundDeadWithRole' : 'PlayerFoundDead',
          args: showRolesOnDeath ? [name(event.playerId), role(event.playerId)] : [name(event.playerId)],
        },
      ];
    }

    case 'LoverDiedOfGrief':
      return [{ audience: 'group', key: 'LoverDiedOfGrief', args: [name(event.playerId), name(event.originalVictimId)] }];

    case 'GameEnded':
      return [{ audience: 'group', key: TEAM_WIN_KEY[event.winningTeam], args: [event.winningTeam] }];

    case 'HunterCounterAttack':
      return [{ audience: 'group', key: 'HunterCounterAttackMsg', args: [name(event.hunterId), name(event.shotWolfId)] }];

    case 'GunnerPreventsWolfWin':
      return [{ audience: 'group', key: 'GunnerPreventsWolfWinMsg', args: [] }];

    case 'CultistHunterKilledCultist':
      return [
        { audience: 'group', key: 'CultistHunterKilledCultistMsg', args: [name(event.cultistHunterId), name(event.cultistId)] },
      ];

    case 'HunterKilledWolfInStandoff':
      return [{ audience: 'group', key: 'HunterStandoffWin', args: [] }];

    case 'WolfKilledHunterInStandoff':
      return [{ audience: 'group', key: 'HunterStandoffLose', args: [] }];

    case 'RoleStolen':
      return [
        { audience: 'group', key: 'RoleStolenMsg', args: [] },
        { audience: event.thiefId, key: 'RoleStolenPM', args: [name(event.targetId), displayRole(event.stolenRole)] },
      ];

    case 'CursedTurnedWolf':
      return [{ audience: event.playerId, key: 'CursedTurnedWolfMsg', args: [name(event.playerId)] }];

    case 'BittenPlayerTurnedWolf':
      return [{ audience: event.playerId, key: 'BittenTurnedWolfMsg', args: [name(event.playerId)] }];

    case 'WildChildTurnedWolf':
      return [{ audience: event.playerId, key: 'WildChildTurnedWolfMsg', args: [name(event.playerId)] }];

    case 'DoppelgangerTransformed':
      return [{ audience: event.playerId, key: 'DoppelgangerTransformedMsg', args: [name(event.playerId)] }];

    case 'ApprenticeSeerPromoted':
      return [{ audience: event.playerId, key: 'ApprenticeSeerPromotedMsg', args: [name(event.playerId)] }];

    case 'SnowWolfBecameWolf':
      return [{ audience: event.playerId, key: 'SnowWolfBecameWolfMsg', args: [] }];

    case 'TraitorBecameWolf':
      return [{ audience: event.playerId, key: 'TraitorBecameWolfMsg', args: [] }];

    case 'CultistAutoConverted':
    case 'PlayerConvertedToCult':
      return [{ audience: event.playerId, key: 'ConvertedToCult', args: [] }];

    case 'LoversCreated':
      return [
        { audience: event.lover1Id, key: 'YouAreInLove', args: [name(event.lover2Id)] },
        { audience: event.lover2Id, key: 'YouAreInLove', args: [name(event.lover1Id)] },
      ];

    case 'PlayerFrozen':
      return [{ audience: event.playerId, key: 'YouWereFrozen', args: [] }];

    case 'PlayerDoused':
      return [{ audience: event.playerId, key: 'YouWereDoused', args: [] }];

    case 'GuardianAngelBlockedFreeze':
    case 'GuardianAngelBlockedWolfAttack':
    case 'GuardianAngelBlockedSerialKiller':
    case 'GuardianAngelSavedFromBurning':
      return guardianAngelPm(players);

    case 'WiseElderSurvivedFirstAttack':
      return [{ audience: event.playerId, key: 'WiseElderSurvived', args: [] }];

    case 'GunnerLostPowerToWiseElder':
      return [{ audience: event.playerId, key: 'GunnerLostPowerMsg', args: [] }];

    case 'ChemistLostPowerToWiseElder':
      return [{ audience: 'group', key: 'ChemistKillWiseElder', args: [] }];

    case 'HunterLostPowerToWiseElder':
      return [{ audience: event.playerId, key: 'HunterLostPowerMsg', args: [] }];

    // Button presses already get their own immediate feedback as the callback answer
    // (BlacksmithSpreadMsg/SandmanUsedMsg) - these events exist purely for achievement tracking.
    case 'BlacksmithSpreadSilver':
    case 'SandmanUsedSleep':
      return [];

    case 'WolvesGotDrunk':
      return event.wolfIds.map((id) => ({ audience: id, key: 'WolvesGotDrunkMsg', args: [] }));

    case 'GraveDug':
      return [
        {
          audience: event.playerId,
          key: event.graveCount > 0 ? 'GraveDugMsg' : 'GraveDugNone',
          args: event.graveCount > 0 ? [event.graveCount] : [],
        },
      ];

    // Internal bookkeeping / achievement-only in the original - no player-visible text.
    case 'WolfCubKilled':
    case 'CultConversionFailed':
    case 'GuardianAngelCleanedDouse':
    case 'SerialKillerRandomKill':
    case 'PlayerBitten':
    case 'RoleModelChosen':
    case 'WolfPackAteTwice':
    case 'AlphaWolfLuckyDay':
    case 'HarlotVisited':
    case 'ChemistBackfired':
    case 'WolfPackHasDrunkMembers':
    case 'HunterMustShoot': // handled separately by the game loop (triggers the final-shot menu)
      return [];

    case 'SeerVision':
      return [{ audience: event.playerId, key: 'SeerSees', args: [name(event.targetId), displayRole(event.shownRole)] }];

    case 'SorcererVision':
      return event.detectedRole !== null
        ? [{ audience: event.playerId, key: 'SorcererDetects', args: [name(event.targetId), displayRole(event.detectedRole)] }]
        : [{ audience: event.playerId, key: 'SorcererNothing', args: [name(event.targetId)] }];

    case 'FoolVision':
      return event.shownRole !== null
        ? [{ audience: event.playerId, key: 'FoolSees', args: [name(event.targetId), displayRole(event.shownRole)] }]
        : [{ audience: event.playerId, key: 'FoolSeesNothing', args: [name(event.targetId)] }];

    case 'OracleVision':
      return event.shownRole !== null
        ? [{ audience: event.playerId, key: 'OracleSees', args: [name(event.targetId), displayRole(event.shownRole)] }]
        : [{ audience: event.playerId, key: 'OracleNothing', args: [name(event.targetId)] }];

    case 'AugurVision':
      return event.shownRole !== null
        ? [{ audience: event.playerId, key: 'AugurSees', args: [displayRole(event.shownRole)] }]
        : [{ audience: event.playerId, key: 'AugurNothing', args: [] }];

    case 'DetectiveSnoop':
      return [{ audience: event.playerId, key: 'DetectiveSnoop', args: [name(event.targetId), displayRole(event.targetRole)] }];

    case 'DetectiveCaught':
      return wolfPackPms(players, name(event.playerId), 'DetectiveCaught');
  }
}

/** PMs every wolf-pack member (Wolf/AlphaWolf/WolfCub/Lycan/SnowWolf) the same message. */
function wolfPackPms(players: readonly Player[], detectiveName: string, key: string): OutgoingMessage[] {
  const pack = players.filter((p) =>
    [ROLE_BIT.Wolf, ROLE_BIT.AlphaWolf, ROLE_BIT.WolfCub, ROLE_BIT.Lycan, ROLE_BIT.SnowWolf].includes(p.role),
  );
  return pack.map((w) => ({ audience: w.id, key, args: [detectiveName] }));
}

/** The four "your protection worked" events don't all carry the Guardian Angel's own id - look them up. */
function guardianAngelPm(players: readonly Player[]): OutgoingMessage[] {
  const ga = players.find((p) => !p.isDead && p.role === ROLE_BIT.GuardianAngel);
  if (!ga) return [];
  return [{ audience: ga.id, key: 'ProtectionWorked', args: [] }];
}
