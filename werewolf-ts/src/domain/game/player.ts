import type { Role } from '../roles/role.js';
import type { Team } from './team.js';
import type { KillMethod } from './kill-method.js';

/** Sentinel for "explicitly chose to abstain / not act", mirroring the original's `Choice == -1`. `null` means "hasn't chosen yet" (mirrors `Choice == 0`). */
export const ABSTAIN: bigint = -1n;

/** Sentinel for the Arsonist's "spark" action (burn every doused player), mirroring `Choice == -2`. */
export const SPARK: bigint = -2n;

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

  /** Arsonist mechanic: doused tonight, will burn to death next time the Arsonist sparks. */
  doused: boolean;
  /** Arsonist mechanic: doused and set alight - dies to anyone who visits them, except the Serial Killer. */
  burning: boolean;
  /** Grave Digger mechanic: how many graves they dug last night (0 = didn't dig / stayed home). */
  dugGravesLastNight: number;
  /** Serial Killer mechanic: the day number they last stumbled into a dug grave (0 = never). */
  stumbledGrave: number;
  /** Cult mechanic: the day number they were converted (0 for the founding cultist(s)) - the highest value acts as the pack's "newbie" visitor each night. */
  dayCult: number;
  /** Augur mechanic: roles they've already been shown, so they never see the same one twice. */
  sawRoles: Role[];
  /** Thief/Doppelganger mechanic: id of the player whose role this one copied/stole, if any. */
  roleModel: bigint | null;
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
    doused: false,
    burning: false,
    dugGravesLastNight: 0,
    stumbledGrave: 0,
    dayCult: 0,
    sawRoles: [],
    roleModel: null,
  };
}

export function alivePlayers(players: readonly Player[]): Player[] {
  return players.filter((p) => !p.isDead);
}

export function findById(players: readonly Player[], id: bigint): Player | undefined {
  return players.find((p) => p.id === id);
}
