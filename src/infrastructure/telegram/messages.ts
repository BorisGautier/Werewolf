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
import type { FreezeFlavor, GameEvent } from '../../domain/game/game-event.js';
import type { Team } from '../../domain/game/team.js';
import { deathFlavorKey } from './death-messages.js';
import { mentionOrPlain } from './mention.js';

/** The Snow Wolf's target's own "you woke up frozen" locale key, keyed by `FreezeFlavor`. */
const FREEZE_FLAVOR_KEY: Record<FreezeFlavor, string> = {
  SerialKiller: 'SKFrozen',
  Harlot: 'HarlotFrozen',
  Chemist: 'ChemistFrozen',
  Cultist: 'CultistFrozen',
  CultistHunter: 'CHFrozen',
  Seeing: 'SeeingFrozen',
  GuardianAngel: 'GAFrozen',
  Thief: 'ThiefFrozen',
  GraveDiggerDug: 'GraveDiggerFrozen',
  Arsonist: 'ArsonistNotFrozen',
  Default: 'DefaultFrozen',
};

const WOLF_TEAM_ROLES: ReadonlySet<bigint> = new Set([
  ROLE_BIT.Wolf,
  ROLE_BIT.AlphaWolf,
  ROLE_BIT.WolfCub,
  ROLE_BIT.Lycan,
  ROLE_BIT.SnowWolf,
]);

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

function displayRole(
  role: bigint,
  t?: { translate: (lang: string, key: string, ...args: unknown[]) => string },
  language = 'fr',
): string {
  const name = roleName(role);
  const localized = t ? t.translate(language, `Role_${name}`) : name;
  const displayName = localized.startsWith('Role_') ? name : localized;
  return `${ROLE_META[name].emoji} ${displayName}`;
}

function nameOf(players: readonly Player[], id: bigint): string {
  const player = findById(players, id);
  if (!player) return '???';
  return mentionOrPlain(player.id, player.name, player.isBot);
}

/** @param showRolesOnDeath mirrors the group's `ShowRolesDeath` config flag. */
export function describeEvent(
  event: GameEvent,
  players: readonly Player[],
  showRolesOnDeath: boolean,
  t?: { translate: (lang: string, key: string, ...args: unknown[]) => string },
  language = 'fr',
): OutgoingMessage[] {
  const name = (id: bigint) => nameOf(players, id);
  const role = (id: bigint) => displayRole(findById(players, id)?.role ?? 0n, t, language);

  switch (event.type) {
    case 'PlayerDied': {
      if (event.method === 'Lynch') {
        return [
          {
            audience: 'group',
            key: showRolesOnDeath ? 'PlayerLynchedWithRole' : 'PlayerLynched',
            args: showRolesOnDeath
              ? [name(event.playerId), role(event.playerId)]
              : [name(event.playerId)],
          },
        ];
      }

      if (showRolesOnDeath) {
        const victim = findById(players, event.playerId);

        // The Harlot stumbling onto the wolves'/Serial Killer's actual victim needs that other
        // player's name, not a role reveal - doesn't fit deathFlavorKey's (key, includeRoleArg)
        // shape, so it's built directly here. `killerIds[0]` is the found victim's id (see
        // resolveHarlotNight's 'VisitVictim' call).
        if (
          event.method === 'VisitVictim' &&
          victim?.role === ROLE_BIT.Harlot &&
          event.killerIds[0] !== undefined
        ) {
          const foundVictimRole =
            victim.killedByRole !== null ? roleName(victim.killedByRole) : null;
          const key =
            foundVictimRole === 'SerialKiller'
              ? 'HarlotFuckedKilledPublic'
              : 'HarlotFuckedVictimPublic';
          return [
            { audience: 'group', key, args: [name(event.playerId), name(event.killerIds[0])] },
          ];
        }

        const selfInflicted = event.killerIds.length === 1 && event.killerIds[0] === event.playerId;
        const killedByRole = victim?.killedByRole != null ? roleName(victim.killedByRole) : null;
        const flavor = victim
          ? deathFlavorKey(event.method, roleName(victim.role), selfInflicted, killedByRole)
          : null;
        if (flavor) {
          return [
            {
              audience: 'group',
              key: flavor.key,
              args: flavor.includeRoleArg
                ? [name(event.playerId), role(event.playerId)]
                : [name(event.playerId)],
            },
          ];
        }
      }

      return [
        {
          audience: 'group',
          key: showRolesOnDeath ? 'PlayerFoundDeadWithRole' : 'PlayerFoundDead',
          args: showRolesOnDeath
            ? [name(event.playerId), role(event.playerId)]
            : [name(event.playerId)],
        },
      ];
    }

    case 'LoverDiedOfGrief':
      return [
        {
          audience: 'group',
          key: 'LoverDiedOfGrief',
          args: [name(event.playerId), name(event.originalVictimId)],
        },
      ];

    case 'GameEnded':
      return [
        { audience: 'group', key: TEAM_WIN_KEY[event.winningTeam], args: [event.winningTeam] },
      ];

    case 'HunterCounterAttack':
      return [
        {
          audience: 'group',
          key: 'HunterCounterAttackMsg',
          args: [name(event.hunterId), name(event.shotWolfId)],
        },
      ];

    case 'GunnerPreventsWolfWin':
      return [{ audience: 'group', key: 'GunnerPreventsWolfWinMsg', args: [] }];

    case 'CultistHunterKilledCultist':
      return [
        {
          audience: 'group',
          key: 'CultistHunterKilledCultistMsg',
          args: [name(event.cultistHunterId), name(event.cultistId)],
        },
      ];

    case 'HunterKilledWolfInStandoff':
      return [{ audience: 'group', key: 'HunterStandoffWin', args: [] }];

    case 'WolfKilledHunterInStandoff':
      return [{ audience: 'group', key: 'HunterStandoffLose', args: [] }];

    case 'RoleStolen':
      return [
        { audience: 'group', key: 'RoleStolenMsg', args: [] },
        {
          audience: event.thiefId,
          key: 'RoleStolenPM',
          args: [name(event.targetId), displayRole(event.stolenRole)],
        },
      ];

    case 'ThiefStealForced':
      return [{ audience: event.thiefId, key: 'ThiefStealChosen', args: [name(event.targetId)] }];

    case 'PlayerBitten':
      return [{ audience: event.playerId, key: 'PlayerBittenPM', args: [] }];

    case 'CursedTurnedWolf':
      return [
        { audience: event.playerId, key: 'CursedTurnedWolfMsg', args: [name(event.playerId)] },
      ];

    case 'BittenPlayerTurnedWolf':
      return [
        { audience: event.playerId, key: 'BittenTurnedWolfMsg', args: [name(event.playerId)] },
      ];

    case 'WildChildTurnedWolf':
      return [
        { audience: event.playerId, key: 'WildChildTurnedWolfMsg', args: [name(event.playerId)] },
      ];

    case 'DoppelgangerTransformed':
      return [
        {
          audience: event.playerId,
          key: 'DoppelgangerTransformedMsg',
          args: [name(event.playerId)],
        },
      ];

    case 'ApprenticeSeerPromoted':
      return [
        {
          audience: event.playerId,
          key: 'ApprenticeSeerPromotedMsg',
          args: [name(event.playerId)],
        },
      ];

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
      return [
        { audience: event.playerId, key: FREEZE_FLAVOR_KEY[event.flavor], args: [] },
        { audience: event.snowWolfId, key: 'SuccessfulFreeze', args: [name(event.playerId)] },
      ];

    case 'PlayerDoused':
      return [{ audience: event.playerId, key: 'YouWereDoused', args: [] }];

    // Mirrors `GuardBlockedSnowWolf` in the original: the Snow Wolf, not the Guardian Angel, is
    // who gets told the freeze was blocked - the GA's own "you saved someone" PM comes later, from
    // `GuardianAngelSaved`/`GuardianAngelSavedTargetFromFire` (the original's `#region GA Night`
    // block runs after the attacker regions and is the *only* place the GA is ever messaged).
    case 'GuardianAngelBlockedFreeze':
      return [
        { audience: event.snowWolfId, key: 'GuardBlockedSnowWolf', args: [name(event.targetId)] },
      ];

    // Purely state-flagging (sets `wasSavedLastNight`) in the original too - no message fires here,
    // only later from the GA's own night-resolution block (see above).
    case 'GuardianAngelBlockedWolfAttack':
    case 'GuardianAngelBlockedSerialKiller':
    case 'GuardianAngelSavedFromBurning':
      return [];

    case 'GuardianAngelSaved':
      return [
        { audience: event.gaId, key: 'GuardSaved', args: [name(event.targetId)] },
        { audience: event.targetId, key: 'GuardSavedYou', args: [] },
      ];

    case 'GuardianAngelSavedTargetFromFire':
      return [
        { audience: event.gaId, key: 'GuardSavedFromFire', args: [name(event.targetId)] },
        { audience: event.targetId, key: 'GuardSavedYouFromFire', args: [] },
      ];

    case 'GuardianAngelNoAttack':
      return [{ audience: event.gaId, key: 'GuardNoAttack', args: [name(event.targetId)] }];

    case 'GuardianAngelTargetEmpty':
      return [{ audience: event.gaId, key: 'GuardEmptyHouse', args: [name(event.targetId)] }];

    case 'GuardianAngelDiedProtecting': {
      const target = findById(players, event.targetId);
      const key = WOLF_TEAM_ROLES.has(target?.role ?? 0n)
        ? 'GuardWolf'
        : target?.role === ROLE_BIT.SerialKiller
          ? 'GuardKiller'
          : 'GAFell';
      return [{ audience: event.gaId, key, args: key === 'GAFell' ? [name(event.targetId)] : [] }];
    }

    case 'ChemistPoisoned':
      return [
        { audience: event.chemistId, key: 'ChemistSuccess', args: [name(event.targetId)] },
        { audience: event.targetId, key: 'ChemistVisitYouSuccess', args: [] },
      ];

    case 'ChemistTargetAlreadyDead':
      return [
        { audience: event.chemistId, key: 'ChemistTargetDead', args: [name(event.targetId)] },
      ];

    case 'ChemistTargetEmpty':
      return [
        { audience: event.chemistId, key: 'ChemistTargetEmpty', args: [name(event.targetId)] },
      ];

    case 'ChemistDiedVisiting': {
      const target = findById(players, event.targetId);
      const dug = target?.role === ROLE_BIT.GraveDigger;
      return [
        {
          audience: event.chemistId,
          key: dug ? 'ChemistFell' : 'ChemistSK',
          args: [name(event.targetId)],
        },
        {
          audience: event.targetId,
          key: dug ? 'ChemistFellDigger' : 'ChemistVisitYouSK',
          args: [name(event.chemistId)],
        },
      ];
    }

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

    case 'GuardianAngelCleanedDouse':
      return [{ audience: event.gaId, key: 'CleanDoused', args: [name(event.playerId)] }];

    case 'ChemistBackfired':
      return [
        { audience: event.chemistId, key: 'ChemistFail', args: [name(event.targetId)] },
        { audience: event.targetId, key: 'ChemistVisitYouFail', args: [name(event.chemistId)] },
      ];

    // Internal bookkeeping / achievement-only in the original - no player-visible text.
    case 'WolfCubKilled':
    case 'CultConversionFailed':
    case 'SerialKillerRandomKill':
    case 'RoleModelChosen':
    case 'WolfPackAteTwice':
    case 'AlphaWolfLuckyDay':
    case 'HarlotVisited':
    case 'WolfPackHasDrunkMembers':
    case 'HunterMustShoot': // handled separately by the game loop (triggers the final-shot menu)
      return [];

    case 'SeerVision':
      return [
        {
          audience: event.playerId,
          key: 'SeerSees',
          args: [name(event.targetId), displayRole(event.shownRole)],
        },
      ];

    case 'SorcererVision':
      return event.detectedRole !== null
        ? [
            {
              audience: event.playerId,
              key: 'SorcererDetects',
              args: [name(event.targetId), displayRole(event.detectedRole)],
            },
          ]
        : [{ audience: event.playerId, key: 'SorcererNothing', args: [name(event.targetId)] }];

    case 'FoolVision':
      return event.shownRole !== null
        ? [
            {
              audience: event.playerId,
              key: 'FoolSees',
              args: [name(event.targetId), displayRole(event.shownRole)],
            },
          ]
        : [{ audience: event.playerId, key: 'FoolSeesNothing', args: [name(event.targetId)] }];

    case 'OracleVision':
      return event.shownRole !== null
        ? [
            {
              audience: event.playerId,
              key: 'OracleSees',
              args: [name(event.targetId), displayRole(event.shownRole)],
            },
          ]
        : [{ audience: event.playerId, key: 'OracleNothing', args: [name(event.targetId)] }];

    case 'AugurVision':
      return event.shownRole !== null
        ? [{ audience: event.playerId, key: 'AugurSees', args: [displayRole(event.shownRole)] }]
        : [{ audience: event.playerId, key: 'AugurNothing', args: [] }];

    case 'DetectiveSnoop':
      return [
        {
          audience: event.playerId,
          key: 'DetectiveSnoop',
          args: [name(event.targetId), displayRole(event.targetRole)],
        },
      ];

    case 'DetectiveCaught':
      return wolfPackPms(players, name(event.playerId), 'DetectiveCaught');

    case 'CrowCursed':
      // A secret hex - only the Crow is told it landed, the target is never warned.
      return [{ audience: event.crowId, key: 'CrowCursedTarget', args: [name(event.targetId)] }];

    case 'HitmanTargetEliminated':
      return [
        {
          audience: 'group',
          key: 'HitmanContractComplete',
          args: [name(event.hitmanId), name(event.targetId)],
        },
      ];

    case 'PlayerResurrected':
      // A dramatic, publicly visible event - the group sees the "dead" player back among the
      // living, though not who brought them back (mirrors how the Necromancer's own night choice
      // stays private, same as every other night-menu role).
      return [
        { audience: 'group', key: 'PlayerResurrectedMsg', args: [name(event.playerId)] },
        {
          audience: event.necromancerId,
          key: 'NecromancerResurrectSuccess',
          args: [name(event.playerId)],
        },
      ];

    case 'WatchmanReport':
      return [
        {
          audience: event.watchmanId,
          key: 'WatchmanReportMsg',
          args: [name(event.targetId), event.visitorCount],
        },
      ];

    case 'TrackerReport':
      return [
        {
          audience: event.trackerId,
          key: event.leftHome ? 'TrackerLeftHome' : 'TrackerStayedHome',
          args: [name(event.targetId)],
        },
      ];

    case 'PriestessBlessingSaved':
      // Silent to the group, same as a Guardian Angel block - only the Priestess and the saved
      // player themselves learn what happened.
      return [
        { audience: event.priestessId, key: 'PriestessSaved', args: [name(event.targetId)] },
        { audience: event.targetId, key: 'PriestessSavedYou', args: [] },
      ];

    case 'WolfPackBlinded':
      return wolfPackPms(players, '', 'WolfPackBlindedMsg');

    case 'MimicChoseDisguise':
      return [
        { audience: event.mimicId, key: 'MimicDisguiseLocked', args: [name(event.targetId)] },
      ];

    case 'ReflectorActivated':
      return [{ audience: event.reflectorId, key: 'ReflectorActivatedMsg', args: [] }];

    case 'ReflectorReflected':
      // Silent to the group and even to the attacker - same secrecy the Guardian Angel's own
      // blocks get - only the Reflector learns their mirror actually caught someone.
      return [
        {
          audience: event.reflectorId,
          key: 'ReflectorReflectedMsg',
          args: [name(event.attackerId)],
        },
      ];

    case 'ArchangelBulletGranted':
      // PM-only, like every other secret-role-power event above - the streak that earned it is
      // public (everyone saw the deaths), but who holds the Archangel's bullet stays hidden.
      return [{ audience: event.archangelId, key: 'ArchangelBulletReceived', args: [] }];

    case 'ArchangelShotFired':
      // A hit is followed by its own `PlayerDied('Shoot')` event (see `resolveArchangelShot`),
      // which already announces the death to the group - this only PMs the Archangel confirming
      // the target really was a Werewolf. A miss is entirely silent to everyone but them: the
      // sacred bullet does nothing observable to a non-wolf, so their identity stays hidden.
      return [
        {
          audience: event.archangelId,
          key: event.hit ? 'ArchangelShotHit' : 'ArchangelShotMiss',
          args: [name(event.targetId)],
        },
      ];

    case 'TrapperWolfTrapSet':
      // Secret, like every other wolf-subtype ability that isn't the shared pack kill - only the
      // Trapper Wolf learns their ambush is armed; the trapped player and the group learn nothing
      // unless someone actually walks into it.
      return [
        { audience: event.trapperId, key: 'TrapperWolfTrapSetMsg', args: [name(event.targetId)] },
      ];

    case 'ChameleonDisguiseChosen':
      // PM-only confirmation - the disguise itself is invisible to everyone else by design; only
      // a Seer probing them tonight would ever notice, and even then they'd just see the borrowed
      // role, never learning a Chameleon Wolf was behind it.
      return [
        {
          audience: event.chameleonId,
          key: 'ChameleonDisguiseChosenMsg',
          args: [displayRole(event.appearanceRole, t, language)],
        },
      ];

    case 'ViperWolfPoisoned':
      // PM-only, like the other wolf-subtype ability confirmations - the public death itself (with
      // its own `ViperPoisonPublic` flavor, see death-messages.ts) doesn't arrive until "sunset",
      // via the ordinary `PlayerDied('ViperPoison')` event this one has no connection to on the wire.
      return [
        { audience: event.viperId, key: 'ViperWolfPoisonedMsg', args: [name(event.targetId)] },
      ];

    case 'HowlerWolfHowled':
      // PM-only to the Howler themselves - the group learns the *effect* (a neutral, identity-free
      // "today's votes are anonymous" announcement, sent by `GameLoop.runDay()` from
      // `Game.anonymousLynchVotes` directly) but never that a howl caused it.
      return [{ audience: event.howlerId, key: 'HowlerWolfHowledMsg', args: [] }];

    case 'BerserkerWolfEnraged':
      // PM-only - the group already knows a wolf was just lynched (from the ordinary lynch
      // announcement), but not that it awakened anyone's rage or that the pack gets a second kill
      // tonight; only the Berserker Wolf themselves learns that.
      return [{ audience: event.berserkerId, key: 'BerserkerWolfEnragedMsg', args: [] }];

    case 'AvengerRivalLynched':
      // Public: unlike the Hitman's silent contract, the Avenger's whole premise is a *public*
      // vendetta fulfilled by the village's own hand - the group already saw the lynch itself, this
      // adds the reveal that it was secretly someone's long-awaited vengeance. The immediately
      // following `GameEnded('Neutral')` event announces the actual win.
      return [{ audience: 'group', key: 'AvengerRivalLynchedMsg', args: [name(event.avengerId)] }];

    case 'CrownPrinceSucceeded':
      // PM-only: the whole point of the Mayor's power is *choosing* when to reveal for the
      // double-vote bonus - announcing the succession to the group the instant it happens would
      // out the new Mayor before they ever get to make that choice themselves. Only they learn
      // they've inherited the role; the village finds out only if/when they later use it.
      return [{ audience: event.playerId, key: 'CrownPrinceSucceededMsg', args: [] }];
  }
}

/** PMs every wolf-pack member (Wolf/AlphaWolf/WolfCub/Lycan/SnowWolf) the same message. */
function wolfPackPms(
  players: readonly Player[],
  detectiveName: string,
  key: string,
): OutgoingMessage[] {
  const pack = players.filter((p) =>
    [
      ROLE_BIT.Wolf,
      ROLE_BIT.AlphaWolf,
      ROLE_BIT.WolfCub,
      ROLE_BIT.Lycan,
      ROLE_BIT.SnowWolf,
    ].includes(p.role),
  );
  return pack.map((w) => ({ audience: w.id, key, args: [detectiveName] }));
}
