/**
 * Mission mode: an optional, opt-in secondary objective offered to each player alongside their
 * role at game start (see `GameLobbyManager.notifyMission()`). Missions are entirely additive -
 * they never touch win conditions or role balancing, only a bonus layered into
 * `calculateGamePoints()` (see `computeMissionBonus()` below), mirroring how the TeamDuel and
 * role-performance bonuses already stack on top of the base score.
 *
 * Scoped to a single game: nothing here is persisted or read back across games, and a player is
 * always free to decline (see `Player.missionOfferedId` vs `Player.missionId`).
 *
 * Draw is genuinely random *with* replacement per player (`pickMissionForPlayer`) - several
 * players can and will end up with the same mission in the same game, by design.
 */

import { getTeamForRole } from './team.js';
import type { Player } from './player.js';
import { ROLE_BIT, type Role } from '../roles/role.js';

export interface MissionDef {
  id: string;
  points: number;
  /** The smallest player count this mission is even plausible for - filtered out below this so
   * nobody gets offered something like "survive to Day 5" in a 5-player game. These are rough
   * pacing estimates (roughly players/2.5 per day of plausible game length), not a guarantee -
   * see `selectFeasibleMissions()`'s doc comment. */
  minPlayers: number;
  /** Extra feasibility check against the roles actually dealt this game (checked once, at
   * assignment time, after `Game.start()` has already balanced and dealt roles) - for missions
   * tied to a specific role or role mix being in play at all, not just headcount. */
  isFeasible?: (players: readonly Player[]) => boolean;
  isCompleted: (player: Player, players: readonly Player[]) => boolean;
}

/** Wolf-team roles plus the two solo killers (Serial Killer, Arsonist) - the "killer roles" the
 * `chaosSurvivor` mission's flavor text refers to. */
function isKillerRole(role: Role): boolean {
  return (
    getTeamForRole(role) === 'Wolf' || role === ROLE_BIT.SerialKiller || role === ROLE_BIT.Arsonist
  );
}

export const MISSION_DEFS: readonly MissionDef[] = [
  { id: 'survivor', points: 15, minPlayers: 5, isCompleted: (p) => !p.isDead },
  {
    id: 'unsinkable',
    points: 12,
    minPlayers: 8,
    isCompleted: (p) => p.dayDied === null || p.dayDied >= 3,
  },
  {
    id: 'lastStanding',
    points: 15,
    minPlayers: 7,
    isCompleted: (p, all) => !p.isDead && all.filter((x) => !x.isDead).length <= 3,
  },
  {
    id: 'sleepless',
    points: 5,
    minPlayers: 5,
    isCompleted: (p) => p.dayDied === null || p.dayDied >= 2,
  },
  {
    id: 'veteran',
    points: 18,
    minPlayers: 13,
    isCompleted: (p) => p.dayDied === null || p.dayDied >= 5,
  },
  {
    id: 'closeCall',
    points: 15,
    minPlayers: 5,
    isCompleted: (p) => p.escapedTopVoteLynchCount >= 1,
  },
  { id: 'executioner', points: 10, minPlayers: 5, isCompleted: (p) => p.everVotedForLynchedVictim },
  { id: 'wolfHunter', points: 10, minPlayers: 5, isCompleted: (p) => p.everVotedForWolf },
  { id: 'vigilante', points: 10, minPlayers: 5, isCompleted: (p) => p.everVotedOppositeCamp },
  { id: 'earlyVoter', points: 8, minPlayers: 5, isCompleted: (p) => p.firstToVoteCount >= 2 },
  {
    id: 'peacekeeper',
    points: 8,
    minPlayers: 5,
    isCompleted: (p) => p.abstainCount >= 2 && !p.diedByFleeOrIdle,
  },
  { id: 'bandwagon', points: 8, minPlayers: 8, isCompleted: (p) => p.majorityVoteCount >= 3 },
  { id: 'ghost', points: 15, minPlayers: 5, isCompleted: (p) => !p.hasBeenVoted },
  {
    id: 'target',
    points: 12,
    minPlayers: 6,
    isCompleted: (p) => !p.isDead && p.everVotedAgainstBy.size >= 3,
  },
  { id: 'maverick', points: 8, minPlayers: 8, isCompleted: (p) => p.minorityVoteCount >= 3 },
  {
    id: 'untouchable',
    points: 14,
    minPlayers: 10,
    isCompleted: (p) => p.escapedTopVoteLynchCount >= 2,
  },
  {
    id: 'silent',
    points: 10,
    minPlayers: 5,
    isCompleted: (_p, _all) => true, // resolved specially, see note in `checkMissionCompleted()`
  },
  { id: 'steadfast', points: 8, minPlayers: 5, isCompleted: (p) => p.voteChangedCount === 0 },
  { id: 'scout', points: 5, minPlayers: 5, isCompleted: (p, all) => all.indexOf(p) < 3 },
  { id: 'punctual', points: 10, minPlayers: 5, isCompleted: (p) => !p.everMissedVote },
  { id: 'everPresent', points: 8, minPlayers: 5, isCompleted: (p) => !p.diedByFleeOrIdle },
  {
    id: 'marathoner',
    points: 15,
    minPlayers: 15,
    isCompleted: (p) => p.dayDied === null || p.dayDied >= 6,
  },
  {
    id: 'doubleSurvivor',
    points: 10,
    minPlayers: 5,
    isFeasible: (players) => players.some((p) => p.originalRole === ROLE_BIT.Troublemaker),
    isCompleted: (p) => p.survivedForcedSecondLynch,
  },
  {
    id: 'lastSecond',
    points: 5,
    minPlayers: 5,
    isCompleted: (p) => p.votedInLastSecondsOfPhase,
  },
  { id: 'champion', points: 15, minPlayers: 5, isCompleted: (p) => p.won && !p.isDead },
  { id: 'martyr', points: 12, minPlayers: 5, isCompleted: (p) => p.won && p.isDead },
  { id: 'resistant', points: 10, minPlayers: 5, isCompleted: (p) => !p.won && !p.isDead },
  {
    id: 'chaosSurvivor',
    points: 12,
    minPlayers: 12,
    isFeasible: (players) =>
      players.filter((p) => isKillerRole(p.originalRole)).length >= 3 && players.length >= 12,
    isCompleted: (p) => !p.isDead,
  },
  {
    id: 'stealthWinner',
    points: 10,
    minPlayers: 5,
    isCompleted: (p) => p.won && !p.hasBeenVoted,
  },
  { id: 'prophet', points: 10, minPlayers: 5, isCompleted: (p) => p.votedOppositeCampDay1 },
] as const;

/** `silent` (never used `/claims`) needs data that lives outside `Player` (`Game.claimsMap`) -
 * checked here rather than in `MissionDef.isCompleted`, which only ever sees `Player[]`. */
export function checkMissionCompleted(
  def: MissionDef,
  player: Player,
  players: readonly Player[],
  claimedIds: ReadonlySet<bigint>,
): boolean {
  if (def.id === 'silent') return !claimedIds.has(player.id);
  return def.isCompleted(player, players);
}

/** The pool a given game can actually offer missions from - filtered by headcount and, for the
 * handful tied to a specific role mix, by what was actually dealt this game. Estimates, not
 * guarantees: a 6-player game *could* theoretically stall to Day 5, it just almost never does -
 * these thresholds exist to stop the *common* frustration of an obviously dead-on-arrival goal,
 * not to model exact pacing (that could be calibrated later from the stress-test simulation's
 * real day-count distributions per player-count bucket). */
export function selectFeasibleMissions(
  players: readonly Player[],
  disabledIds: ReadonlySet<string> = new Set(),
): readonly MissionDef[] {
  return MISSION_DEFS.filter(
    (def) =>
      !disabledIds.has(def.id) &&
      players.length >= def.minPlayers &&
      (def.isFeasible === undefined || def.isFeasible(players)),
  );
}

/** Picks one mission at random for a single player from this game's feasible pool - called once
 * per player, independently, so duplicates across players are expected and fine. `disabledIds`
 * are missions an admin has globally turned off (see `MissionRepository`) - never offered to
 * anyone, in any group, until re-enabled. */
export function pickMissionForPlayer(
  players: readonly Player[],
  disabledIds: ReadonlySet<string> = new Set(),
  random: () => number = Math.random,
): MissionDef | null {
  const pool = selectFeasibleMissions(players, disabledIds);
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)]!;
}

export function findMissionDef(id: string): MissionDef | undefined {
  return MISSION_DEFS.find((m) => m.id === id);
}

/** Computes the end-of-game mission bonus for every player who accepted one (`missionId` set)
 * and completed it - `0`/absent for everyone else, mirroring `computeDuelBonus()`'s shape so it
 * plugs into `calculateGamePoints()` the same way. */
export function computeMissionBonus(
  players: readonly Player[],
  claimedIds: ReadonlySet<bigint>,
): Map<bigint, number> {
  const bonus = new Map<bigint, number>();
  for (const player of players) {
    if (!player.missionId) continue;
    const def = findMissionDef(player.missionId);
    if (!def) continue;
    if (checkMissionCompleted(def, player, players, claimedIds)) {
      bonus.set(player.id, def.points);
    }
  }
  return bonus;
}
