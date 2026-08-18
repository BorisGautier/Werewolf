/**
 * Port of `Werewolf.cs`'s `VisitPlayer` - the shared "does this visit
 * succeed, fail, or get the visitor killed" resolver used by nearly every
 * night-active role (Wolves, Serial Killer, Snow Wolf, Harlot, Guardian
 * Angel, Arsonist, Thief).
 *
 * `beingVisitedSameNightCount` (feeding the `ItWasABusyNight` achievement -
 * see `Game.enterNight()` for the per-night reset/threshold check) is the
 * one piece of original state this mirrors purely for achievement tracking;
 * it has no effect on any other game logic, same as in the original.
 */

import { ROLE_BIT } from '../roles/role.js';
import { WOLF_ROLES } from './game-balancing.js';
import { killPlayer } from './kill.js';
import { getPlayerForRole } from './player-query.js';
import { ABSTAIN, type Player } from './player.js';
import type { GameEvent } from './game-event.js';

export type VisitResult = 'Success' | 'VisitorDied' | 'Fail' | 'AlreadyDead' | 'TargetNull';

export interface VisitContext {
  players: Player[];
  dayNumber: number;
  thiefFull: boolean;
  random?: () => number;
  /** Ids of every Reflector whose mirror is currently raised (see `Game.reflectorActiveSet`) -
   * anyone who visits one of them here dies instead of succeeding, mirroring the Serial Killer's
   * own "visiting me is fatal" branch below, but for *any* visitor rather than a hardcoded role. */
  reflectorActive?: ReadonlySet<bigint>;
  /** The id of whoever the Trapper Wolf ambushed tonight (see `resolveTrapperWolfNight` -
   * a once-per-game ability). Any non-wolf visitor to this player has their action neutralized
   * outright; the pack itself is immune to its own teammate's trap. */
  trappedTargetId?: bigint | null;
}

export interface VisitOutcome {
  result: VisitResult;
  events: GameEvent[];
}

export function visitPlayer(
  ctx: VisitContext,
  visitor: Player,
  visited: Player | undefined,
): VisitOutcome {
  const { players, dayNumber, thiefFull } = ctx;
  const random = ctx.random ?? Math.random;
  const events: GameEvent[] = [];
  const roll = () => Math.floor(random() * 100);

  if (!visited) return { result: 'TargetNull', events };
  visited.beingVisitedSameNightCount++;

  if (visited.isDead && !visited.burning && (thiefFull || visitor.role !== ROLE_BIT.Thief)) {
    return { result: 'AlreadyDead', events };
  }

  // The Reflector's raised mirror sends any visit - friendly or hostile - straight back at
  // whoever made it, before any of the role-specific branches below even get a chance to run.
  // Doesn't apply to the Reflector visiting someone else, only to being visited themselves, and a
  // self-visit (shouldn't normally happen) is ignored rather than killing them off their own mirror.
  if (ctx.reflectorActive?.has(visited.id) && visitor.id !== visited.id) {
    events.push(
      ...killPlayer(players, visitor.id, 'VisitKiller', {
        killerIds: [visited.id],
        diedByVisitingKiller: true,
      }),
      { type: 'ReflectorReflected', reflectorId: visited.id, attackerId: visitor.id },
    );
    return { result: 'VisitorDied', events };
  }

  // The Trapper Wolf's ambush: anyone but the pack itself who visits the trapped house tonight has
  // their action neutralized outright - checked before every role-specific branch below, including
  // the Serial Killer's usual "never misses" guarantee.
  if (
    ctx.trappedTargetId === visited.id &&
    !WOLF_ROLES.includes(visitor.role) &&
    visitor.role !== ROLE_BIT.SnowWolf
  ) {
    return { result: 'Fail', events };
  }

  // A Serial Killer never misses their target (they might stumble into a dug grave, handled below).
  if (visitor.role === ROLE_BIT.SerialKiller && visited.role !== ROLE_BIT.GraveDigger) {
    return { result: visited.isDead ? 'AlreadyDead' : 'Success', events };
  }

  // If the visited person is burning, everyone but the Serial Killer burns with them.
  if (visited.burning) {
    if (visitor.role === ROLE_BIT.SerialKiller) return { result: 'AlreadyDead', events };
    const arsonist = getPlayerForRole(players, ROLE_BIT.Arsonist, false);
    events.push(
      ...killPlayer(players, visitor.id, 'VisitBurning', {
        killerIds: arsonist ? [arsonist.id] : [],
        diedByVisitingVictim: true,
      }),
    );
    return { result: 'VisitorDied', events };
  }

  // If the visited person is a Serial Killer, say goodbye to your lives - unless you're a wolf and very lucky.
  if (visited.role === ROLE_BIT.SerialKiller) {
    const isWolfTeamVisitor =
      WOLF_ROLES.includes(visitor.role) || visitor.role === ROLE_BIT.SnowWolf;
    if (
      !isWolfTeamVisitor ||
      visited.choice === null ||
      visited.choice === ABSTAIN ||
      visited.frozen ||
      roll() < 80
    ) {
      events.push(
        ...killPlayer(players, visitor.id, 'VisitKiller', {
          killerIds: [visited.id],
          diedByVisitingKiller: true,
        }),
      );
      return { result: 'VisitorDied', events };
    }
    return { result: 'Success', events };
  }

  if (visitor.role === ROLE_BIT.Thief && !thiefFull) return { result: 'Success', events };

  // A Snow Wolf can only maybe-not-freeze a Serial Killer (handled above); otherwise it always "succeeds".
  if (visitor.role === ROLE_BIT.SnowWolf) return { result: 'Success', events };

  // If the visited player is a wolf, only certain visiting roles are at risk.
  const visitedIsWolfTeam = WOLF_ROLES.includes(visited.role) || visited.role === ROLE_BIT.SnowWolf;
  const riskyVisitorOfWolf =
    visitor.role === ROLE_BIT.Harlot ||
    visitor.role === ROLE_BIT.GuardianAngel ||
    (thiefFull && visitor.role === ROLE_BIT.Thief);
  if (visitedIsWolfTeam && riskyVisitorOfWolf) {
    if (visitor.role === ROLE_BIT.Harlot) {
      events.push(
        ...killPlayer(players, visitor.id, 'VisitWolf', {
          killerIds: [visited.id],
          diedByVisitingKiller: true,
          killedByRole: ROLE_BIT.Wolf,
        }),
      );
      return { result: 'VisitorDied', events };
    }
    if (visitor.role === ROLE_BIT.GuardianAngel) {
      if (visited.wasSavedLastNight) {
        // The wolf was already under attack tonight - the Guardian Angel never dies visiting them.
        return { result: 'Success', events };
      }
      if (roll() < 50) {
        events.push(
          ...killPlayer(players, visitor.id, 'GuardWolf', {
            killerIds: [visited.id],
            diedByVisitingKiller: true,
            killedByRole: ROLE_BIT.Wolf,
          }),
        );
        return { result: 'VisitorDied', events };
      }
      return { result: 'Success', events };
    }
    if (visitor.role === ROLE_BIT.Thief) return { result: 'Fail', events };
  }

  // If the visited player is a Grave Digger, prepare for parkour!
  if (visited.role === ROLE_BIT.GraveDigger) {
    if (visited.dugGravesLastNight < 1) return { result: 'Success', events };

    if (visitor.role === ROLE_BIT.SerialKiller) {
      visitor.stumbledGrave = dayNumber;
      return { result: 'Success', events };
    }

    // The Guardian Angel won't fall in if they protected the Grave Digger tonight.
    if (visitor.role === ROLE_BIT.GuardianAngel && visited.wasSavedLastNight) {
      return { result: 'Success', events };
    }

    let fallChance = graveDiggerDetectionChance(visited.dugGravesLastNight);
    if (visitor.team === 'Village') fallChance /= 2;

    if (roll() < fallChance) {
      events.push(
        ...killPlayer(players, visitor.id, 'FallGrave', {
          killerIds: [visited.id],
          diedByVisitingKiller: true,
          triggerHunterShot: false,
        }),
      );
      return { result: 'VisitorDied', events };
    }

    // An Arsonist who's a lucky guy and avoided the trap can still act - falls through to the Arsonist
    // check right below, which unconditionally returns Success for them.
    if (visitor.role !== ROLE_BIT.Arsonist) return { result: 'Fail', events };
  }

  // An Arsonist doesn't care whether the Harlot/Guardian Angel/Grave Digger are home.
  if (visitor.role === ROLE_BIT.Arsonist) return { result: 'Success', events };

  // The Harlot/Guardian Angel are "not home" if they've chosen to visit someone themselves and aren't frozen.
  const visitedIsOutForTheNight =
    (visited.role === ROLE_BIT.Harlot ||
      (visited.role === ROLE_BIT.GuardianAngel && !WOLF_ROLES.includes(visitor.role))) &&
    visited.choice !== null &&
    visited.choice !== ABSTAIN &&
    !visited.frozen;
  if (visitedIsOutForTheNight) {
    if (visitor.role === ROLE_BIT.Thief && !thiefFull) return { result: 'Success', events };
    return { result: 'Fail', events };
  }

  return { result: 'Success', events };
}

/**
 * Shared "how easy is this Grave Digger to catch" formula: the base used both
 * for a visitor falling into their grave (`VisitPlayer`, halved for Village
 * team visitors) and for the wolf pack spotting them (halved unconditionally
 * - see `resolveWolfNight`'s Grave Digger check).
 */
export function graveDiggerDetectionChance(dugGravesLastNight: number): number {
  return 20 + (30 - 30 * Math.pow(0.5, dugGravesLastNight - 1));
}
