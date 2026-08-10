import type { Role } from '../roles/role.js';
import type { Team } from './team.js';
import type { KillMethod } from './kill-method.js';

/**
 * Port of the gameplay-relevant fields of `Werewolf Node/Models/IPlayer.cs`.
 *
 * Deliberately excludes the ~40 achievement-tracking booleans/counters from
 * the original (e.g. `HasStayedHome`, `FoolCorrectSeeCount`) - those are a
 * cosmetic layer on top of the rules engine and can be reintroduced later
 * without touching the core state machine.
 */
export interface Player {
  id: bigint;
  name: string;
  role: Role;
  team: Team;

  isDead: boolean;
  diedLastNight: boolean;
  timeDied: Date | null;
  killedByRole: Role | null;
  diedByVisitingKiller: boolean;
  diedByVisitingVictim: boolean;
  diedByFleeOrIdle: boolean;
  killedLastNight: number;

  /** Set once, resolved (and cleared as "pending") the moment their final shot is taken. */
  pendingHunterShot: { method: KillMethod; delayed: boolean } | null;

  hasUsedAbility: boolean;
  /** Primary night/day-action target, mirrors `Choice`. */
  choice: bigint | null;
  /** Secondary target (e.g. Cupid's second lover), mirrors `Choice2`. */
  choice2: bigint | null;

  votes: number;
  votedBy: Set<bigint>;
  nonVoteCount: number;

  bullet: number;
  drunk: boolean;
  frozen: boolean;
  fled: boolean;
  hasPm: boolean;

  inLove: boolean;
  loverId: bigint | null;
  /** Deferred lover-death message, shown to the survivor once the phase ends (mirrors `LoverMsg`). */
  loverDiedMessage: string | null;

  bitten: boolean;
  wasSavedLastNight: boolean;
  won: boolean;

  changedRolesCount: number;
}

export function createPlayer(id: bigint, name: string, role: Role, team: Team): Player {
  return {
    id,
    name,
    role,
    team,
    isDead: false,
    diedLastNight: false,
    timeDied: null,
    killedByRole: null,
    diedByVisitingKiller: false,
    diedByVisitingVictim: false,
    diedByFleeOrIdle: false,
    killedLastNight: 0,
    pendingHunterShot: null,
    hasUsedAbility: false,
    choice: null,
    choice2: null,
    votes: 0,
    votedBy: new Set(),
    nonVoteCount: 0,
    bullet: 2,
    drunk: false,
    frozen: false,
    fled: false,
    hasPm: false,
    inLove: false,
    loverId: null,
    loverDiedMessage: null,
    bitten: false,
    wasSavedLastNight: false,
    won: false,
    changedRolesCount: 0,
  };
}

export function alivePlayers(players: readonly Player[]): Player[] {
  return players.filter((p) => !p.isDead);
}

export function findById(players: readonly Player[], id: bigint): Player | undefined {
  return players.find((p) => p.id === id);
}
