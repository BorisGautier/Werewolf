/** Conversions between the pure domain types and Prisma's generated enums. */

import {
  Team as PrismaTeam,
  KillMethod as PrismaKillMethod,
  RoleName as PrismaRoleName,
  GamePhase as PrismaGamePhase,
} from '@prisma/client';
import { roleName, type Role } from '../../domain/roles/role.js';
import type { Team } from '../../domain/game/team.js';
import type { KillMethod } from '../../domain/game/kill-method.js';

const TEAM_TO_PRISMA: Record<Team, PrismaTeam> = {
  Village: PrismaTeam.VILLAGE,
  Cult: PrismaTeam.CULT,
  Wolf: PrismaTeam.WOLF,
  Tanner: PrismaTeam.TANNER,
  Neutral: PrismaTeam.NEUTRAL,
  SerialKiller: PrismaTeam.SERIAL_KILLER,
  Lovers: PrismaTeam.LOVERS,
  Arsonist: PrismaTeam.ARSONIST,
  SKHunter: PrismaTeam.SK_HUNTER,
  NoOne: PrismaTeam.NO_ONE,
  Thief: PrismaTeam.THIEF,
};

export function teamToPrisma(team: Team): PrismaTeam {
  return TEAM_TO_PRISMA[team];
}

const KILL_METHOD_TO_PRISMA: Record<KillMethod, PrismaKillMethod> = {
  None: PrismaKillMethod.NONE,
  Lynch: PrismaKillMethod.LYNCH,
  Eat: PrismaKillMethod.EAT,
  Shoot: PrismaKillMethod.SHOOT,
  VisitWolf: PrismaKillMethod.VISIT_WOLF,
  VisitVictim: PrismaKillMethod.VISIT_VICTIM,
  GuardWolf: PrismaKillMethod.GUARD_WOLF,
  Detected: PrismaKillMethod.DETECTED,
  Flee: PrismaKillMethod.FLEE,
  Hunt: PrismaKillMethod.HUNT,
  HunterShot: PrismaKillMethod.HUNTER_SHOT,
  LoverDied: PrismaKillMethod.LOVER_DIED,
  SerialKilled: PrismaKillMethod.SERIAL_KILLED,
  HunterCult: PrismaKillMethod.HUNTER_CULT,
  GuardKiller: PrismaKillMethod.GUARD_KILLER,
  VisitKiller: PrismaKillMethod.VISIT_KILLER,
  Idle: PrismaKillMethod.IDLE,
  Suicide: PrismaKillMethod.SUICIDE,
  StealKiller: PrismaKillMethod.STEAL_KILLER,
  Chemistry: PrismaKillMethod.CHEMISTRY,
  FallGrave: PrismaKillMethod.FALL_GRAVE,
  Spotted: PrismaKillMethod.SPOTTED,
  Burn: PrismaKillMethod.BURN,
  VisitBurning: PrismaKillMethod.VISIT_BURNING,
};

export function killMethodToPrisma(method: KillMethod): PrismaKillMethod {
  return KILL_METHOD_TO_PRISMA[method];
}

/** The domain's RoleName strings (from `roleName(bit)`) already match Prisma's RoleName enum values 1:1. */
export function roleToPrisma(role: Role): PrismaRoleName {
  return roleName(role) as PrismaRoleName;
}

const KILL_PHASE_TO_PRISMA: Record<'Night' | 'Day' | 'Lynch', PrismaGamePhase> = {
  Night: PrismaGamePhase.NIGHT,
  Day: PrismaGamePhase.DAY,
  Lynch: PrismaGamePhase.LYNCH,
};

/** A kill can only ever happen during Night/Day/Lynch, never Joining/Ended - see `GameKill.phase`. */
export function killPhaseToPrisma(phase: 'Night' | 'Day' | 'Lynch'): PrismaGamePhase {
  return KILL_PHASE_TO_PRISMA[phase];
}
