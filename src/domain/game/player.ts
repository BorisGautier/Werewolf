import type { Role } from '../roles/role.js';
import type { Team } from './team.js';
import type { KillMethod } from './kill-method.js';

/** Sentinel for "explicitly chose to abstain / not act", mirroring the original's `Choice == -1`. `null` means "hasn't chosen yet" (mirrors `Choice == 0`). */
export const ABSTAIN: bigint = -1n;

/** Sentinel for the Arsonist's "spark" action (burn every doused player), mirroring `Choice == -2`. */
export const SPARK: bigint = -2n;

/**
 * Port of the gameplay-relevant fields of `Werewolf Node/Models/IPlayer.cs`, plus the subset of
 * the original's achievement-tracking counters/flags that turned out to need real-time state
 * (can't be reconstructed from the `GameEvent` log alone) - see the bottom of the interface.
 */
export interface Player {
  id: bigint;
  name: string;
  role: Role;
  /** The role they were dealt at game start, never rewritten - several achievements care what a
   * player *started* as even after a Thief/Doppelganger swap, an infection, or a Wise Elder demotion. */
  originalRole: Role;
  team: Team;
  isBot?: boolean;

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
  /** Thief/Doppelganger/Hitman/Avenger mechanic: id of the target player. */
  roleModel: bigint | null;
  targetId: bigint | null;
  isCursedByCrow: boolean;

  // --- Achievement-tracking counters/flags (mirrors the original's per-player achievement fields) ---
  /** Ever received at least one lynch vote, across any attempt this game (Inconspicuous). */
  hasBeenVoted: boolean;
  /** Fool mechanic: how many nights their random vision happened to match the target's real role. */
  foolCorrectSeeCount: number;
  /** Fool mechanic: their random vision was specifically the Beholder, matching the target. */
  foolCorrectlySeenBH: boolean;
  /** Fool mechanic: their random vision landed on a role the real Seer can never show as-is (WolfMan/Traitor). */
  hasSeenImpossible: boolean;
  /** WolfMan mechanic: the real Seer checked them at some point. */
  trustworthy: boolean;
  /** Cupid mechanic: they were auto-picked as a lover because Cupid didn't choose in time. */
  speedDating: boolean;
  /** Gunner mechanic: how many of their two shots killed a wolf/Serial Killer/cultist. */
  bulletHitBaddies: number;
  /** Guardian Angel mechanic: how many times they guarded a wolf who wasn't actually under attack. */
  gaGuardWolfCount: number;
  /** Mayor mechanic: lynch votes cast after revealing (each worth double). */
  mayorLynchAfterRevealCount: number;
  /** Clumsy Guy mechanic: lynch votes that landed where they meant them to (not fumbled, or fumbled onto the same target by chance). */
  clumsyCorrectLynchCount: number;
  /** How many times they were the target of a night visit so far *this* night - reset every night. */
  beingVisitedSameNightCount: number;
  /** Ever visited by 3+ different actions in the same night. */
  busyNight: boolean;
  /** Alpha Wolf mechanic: successfully infected the Serial Killer. */
  strongestAlpha: boolean;
  /** Lynch mechanic: how many times they were the first to cast a vote this game (FirstStone). */
  firstToVoteCount: number;
  /** Detective mechanic: ids of bad-team targets correctly snooped in a row (a re-snoop of the
   * same target, or a non-bad-team snoop, resets the streak - see `resolveDetectiveSnoop`). */
  correctSnoopedIds: bigint[];
  /** Detective mechanic: the streak above reached 4 (Streetwise). */
  streetwise: boolean;
  /** Tanner mechanic: tied for the most lynch votes (SoClose). */
  soClose: boolean;
  /** Tanner mechanic: literally everyone else alive voted to lynch them (TannerOverkill). */
  tannerOverkill: boolean;
  /** Pacifist mechanic: saved themselves from a majority-vote lynch by declaring peace (EveryManForHimself). */
  everyManForHimself: boolean;
  /** Pacifist's lover mechanic: saved from a majority-vote lynch by the Pacifist declaring peace (MySweetieSoStrong). */
  mySweetieSoStrong: boolean;
  /** Harlot mechanic: distinct players visited across the game (Promiscuous). */
  playersVisited: Set<bigint>;
  /** Harlot mechanic: ever stayed home (didn't pick a target) on a night they could act. */
  hasStayedHome: boolean;
  /** Harlot mechanic: ever visited the same player more than once. */
  hasRepeatedVisit: boolean;
}

export function createPlayer(id: bigint, name: string, role: Role, team: Team, isBot = false): Player {
  return {
    id,
    name,
    role,
    originalRole: role,
    team,
    isBot,
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
    targetId: null,
    isCursedByCrow: false,
    hasBeenVoted: false,
    foolCorrectSeeCount: 0,
    foolCorrectlySeenBH: false,
    hasSeenImpossible: false,
    trustworthy: false,
    speedDating: false,
    bulletHitBaddies: 0,
    gaGuardWolfCount: 0,
    mayorLynchAfterRevealCount: 0,
    clumsyCorrectLynchCount: 0,
    beingVisitedSameNightCount: 0,
    busyNight: false,
    strongestAlpha: false,
    firstToVoteCount: 0,
    correctSnoopedIds: [],
    streetwise: false,
    soClose: false,
    tannerOverkill: false,
    everyManForHimself: false,
    mySweetieSoStrong: false,
    playersVisited: new Set(),
    hasStayedHome: false,
    hasRepeatedVisit: false,
  };
}

export function alivePlayers(players: readonly Player[]): Player[] {
  return players.filter((p) => !p.isDead);
}

export function findById(players: readonly Player[], id: bigint): Player | undefined {
  return players.find((p) => p.id === id);
}
