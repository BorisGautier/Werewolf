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
import type { VoteLogEntry } from './lynch.js';
import { ROLE_BIT, type Role } from '../roles/role.js';

/** Data a mission's completion check needs beyond the final `Player[]` roster - only ever built
 * once, at game end (see `computeMissionBonus()`), and threaded through unchanged. */
export interface MissionContext {
  /** Ids of players who used `/claims` at least once this game (`Game.claimsMap`'s keys). */
  claimedIds: ReadonlySet<bigint>;
  /** Every lynch vote cast across the whole game (`Game.voteLog`) - the source of truth for
   * player-targeted "voted for/with X" missions below. */
  voteLog: readonly VoteLogEntry[];
  /** `Game.dayNumber` at the moment the game ended - lets a still-alive player's "survived
   * through Day N" missions credit them for the game's actual final day, not just their (null)
   * `dayDied`. */
  finalDay: number;
}

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
  /** Player-targeted mission (see the second half of `MISSION_DEFS` below): a random *other*
   * player is drawn alongside this definition at offer time (`pickMissionForPlayer`) and named
   * in the mission's text - completion depends on both the recipient and that specific target,
   * so `isCompletedWithTarget` is used instead of `isCompleted`. Purely one-way: the target
   * never learns they were picked, and never gets a mirrored mission of their own from this. */
  requiresTarget?: boolean;
  isCompleted?: (player: Player, players: readonly Player[]) => boolean;
  isCompletedWithTarget?: (
    player: Player,
    target: Player,
    players: readonly Player[],
    ctx: MissionContext,
  ) => boolean;
}

/** How many days `player` was actually around for - their own death day, or the game's final day
 * if they made it to the end. Shared by every "survive N days" / "outlive by N days" mission. */
function daysSurvived(player: Player, finalDay: number): number {
  return player.dayDied ?? finalDay;
}

/** Did `player` outlive `target` - either `target` died while `player` was still around, or
 * `player` died on a later day than `target` did. `target` must actually be dead; two players
 * both surviving to the end isn't "outliving" either way. */
function outlived(player: Player, target: Player): boolean {
  if (!target.isDead) return false;
  if (!player.isDead) return true;
  return (player.dayDied ?? Infinity) >= (target.dayDied ?? -Infinity);
}

/** Was `player` still alive at the moment `target` died - unlike `outlived()`, doesn't care what
 * happened to `player` afterward (they could go on to die later the same game and this still
 * holds), just that they hadn't already died *before* `target` did. */
function aliveWhenTargetDied(player: Player, target: Player): boolean {
  if (!target.isDead) return false;
  return player.dayDied === null || (target.dayDied !== null && player.dayDied >= target.dayDied);
}

function votesCastBy(ctx: MissionContext, voterId: bigint): readonly VoteLogEntry[] {
  return ctx.voteLog.filter((v) => v.voterId === voterId);
}

function voteCountAgainst(ctx: MissionContext, voterId: bigint, targetId: bigint): number {
  return votesCastBy(ctx, voterId).filter((v) => v.targetId === targetId).length;
}

/** Every day both players cast a real (non-abstain) lynch vote - the shared vantage point
 * "voted the same/differently" missions compare each other's target against. */
function daysBothVoted(
  ctx: MissionContext,
  aId: bigint,
  bId: bigint,
): { day: number; aTarget: bigint; bTarget: bigint }[] {
  const results: { day: number; aTarget: bigint; bTarget: bigint }[] = [];
  for (const aVote of votesCastBy(ctx, aId)) {
    if (aVote.targetId === null) continue;
    const bVote = votesCastBy(ctx, bId).find((v) => v.day === aVote.day);
    if (bVote && bVote.targetId !== null) {
      results.push({ day: aVote.day, aTarget: aVote.targetId, bTarget: bVote.targetId });
    }
  }
  return results;
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

  // --- Player-targeted missions: a random *other* player is drawn alongside the definition at
  // offer time (see `pickMissionForPlayer`) and named directly in the mission's text. One-way -
  // the target is never told, and never receives a mirrored mission of their own from this. ---
  {
    id: 'rivalJure',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: outlived,
  },
  {
    id: 'raceAgainstDeath',
    points: 10,
    minPlayers: 8,
    requiresTarget: true,
    isCompletedWithTarget: (_p, t) => t.dayDied !== null && t.dayDied < 3,
  },
  {
    id: 'longevity',
    points: 12,
    minPlayers: 8,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) =>
      t.isDead && t.dayDied !== null && daysSurvived(p, ctx.finalDay) - t.dayDied >= 2,
  },
  {
    id: 'commonFall',
    points: 8,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) =>
      p.isDead && t.isDead && p.dayDied !== null && p.dayDied === t.dayDied,
  },
  {
    id: 'outlastTarget',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => !p.isDead && t.isDead,
  },
  {
    id: 'onlyOneReturns',
    points: 10,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.isDead || t.isDead,
  },
  {
    id: 'bodyguard',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (_p, t) => !t.isDead,
  },
  {
    id: 'faithful',
    points: 10,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) => voteCountAgainst(ctx, p.id, t.id) === 0,
  },
  {
    id: 'unsinkableDuo',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => !p.isDead && !t.isDead,
  },
  {
    id: 'sameFate',
    points: 12,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.won && t.won,
  },
  {
    id: 'secretSaver',
    points: 12,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (_p, t) => t.escapedTopVoteLynchCount >= 1,
  },
  {
    id: 'travelBuddy',
    points: 10,
    minPlayers: 8,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) =>
      daysSurvived(p, ctx.finalDay) >= 3 && daysSurvived(t, ctx.finalDay) >= 3,
  },
  {
    id: 'manhunt',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (_p, t) => t.diedByLynch,
  },
  {
    id: 'plot',
    points: 8,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) => voteCountAgainst(ctx, p.id, t.id) >= 2,
  },
  {
    id: 'quickExecution',
    points: 12,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (_p, t) => t.dayDied !== null && t.dayDied < 2,
  },
  {
    id: 'nightShadow',
    points: 10,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (_p, t) => t.isDead && t.diedAtNight,
  },
  {
    id: 'persistentTracker',
    points: 12,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) =>
      t.diedByLynch &&
      t.dayDied !== null &&
      ctx.voteLog.some((v) => v.day === t.dayDied && v.voterId === p.id && v.targetId === t.id),
  },
  {
    id: 'insistentVoter',
    points: 10,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) => {
      const votesWhileAlive = votesCastBy(ctx, p.id).filter(
        (v) => v.targetId !== null && (t.dayDied === null || v.day <= t.dayDied),
      );
      return votesWhileAlive.length > 0 && votesWhileAlive.every((v) => v.targetId === t.id);
    },
  },
  {
    id: 'sameWavelength',
    points: 8,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) =>
      daysBothVoted(ctx, p.id, t.id).filter((d) => d.aTarget === d.bTarget).length >= 2,
  },
  {
    id: 'freeElectron',
    points: 10,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) => {
      const both = daysBothVoted(ctx, p.id, t.id);
      return both.length > 0 && both.every((d) => d.aTarget !== d.bTarget);
    },
  },
  {
    id: 'onHerHeels',
    points: 8,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) => {
      const votesAgainstTarget = ctx.voteLog.filter((v) => v.targetId === t.id);
      if (votesAgainstTarget.length === 0) return false;
      const firstDay = Math.min(...votesAgainstTarget.map((v) => v.day));
      return ctx.voteLog.some(
        (v) => v.day === firstDay && v.voterId === p.id && v.targetId === t.id,
      );
    },
  },
  {
    id: 'loner',
    points: 8,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) =>
      !ctx.voteLog.some((v) => v.voterId === t.id && v.targetId === p.id),
  },
  {
    id: 'blindTrust',
    points: 8,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) =>
      ctx.voteLog.some((v) => v.voterId === t.id && v.targetId === p.id),
  },
  {
    id: 'rightHand',
    points: 10,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t, _all, ctx) => {
      const pVote = ctx.voteLog.find((v) => v.day === ctx.finalDay && v.voterId === p.id);
      const tVote = ctx.voteLog.find((v) => v.day === ctx.finalDay && v.voterId === t.id);
      return !!pVote && !!tVote && pVote.targetId !== null && pVote.targetId === tVote.targetId;
    },
  },
  {
    id: 'swornEnemies',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.won && p.team !== t.team,
  },
  {
    id: 'revengeAccomplished',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.won && outlived(p, t),
  },
  {
    id: 'sacrifice',
    points: 12,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.isDead && !t.isDead,
  },
  {
    id: 'mirrorFate',
    points: 8,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.isDead === t.isDead,
  },
  {
    id: 'triumphOver',
    points: 12,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.won && !t.won,
  },
  {
    id: 'heir',
    points: 15,
    minPlayers: 5,
    requiresTarget: true,
    isCompletedWithTarget: (p, t) => p.won && aliveWhenTargetDied(p, t),
  },
] as const;

/** `silent` (never used `/claims`) needs data that lives outside `Player` (`Game.claimsMap`) -
 * checked here rather than in `MissionDef.isCompleted`, which only ever sees `Player[]`. */
export function checkMissionCompleted(
  def: MissionDef,
  player: Player,
  players: readonly Player[],
  ctx: MissionContext,
): boolean {
  if (def.id === 'silent') return !ctx.claimedIds.has(player.id);
  if (def.requiresTarget) {
    if (!def.isCompletedWithTarget || player.missionTargetId === null) return false;
    const target = players.find((p) => p.id === player.missionTargetId);
    if (!target) return false;
    return def.isCompletedWithTarget(player, target, players, ctx);
  }
  return def.isCompleted?.(player, players) ?? false;
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

/** A mission drawn for one player - `targetId` is only ever set for a `requiresTarget` mission,
 * naming which *other* player it was drawn against. */
export interface MissionOffer {
  def: MissionDef;
  targetId: bigint | null;
}

/** Picks one mission at random for a single player from this game's feasible pool - called once
 * per player, independently, so duplicates across players (and shared targets) are expected and
 * fine. `disabledIds` are missions an admin has globally turned off (see `MissionRepository`) -
 * never offered to anyone, in any group, until re-enabled. For a `requiresTarget` mission, also
 * draws a random *other* player (bots included - they're valid targets, just never recipients)
 * as the target; `recipientId` is only ever excluded from being its own target. */
export function pickMissionForPlayer(
  recipientId: bigint,
  players: readonly Player[],
  disabledIds: ReadonlySet<string> = new Set(),
  random: () => number = Math.random,
): MissionOffer | null {
  const pool = selectFeasibleMissions(players, disabledIds);
  if (pool.length === 0) return null;
  const def = pool[Math.floor(random() * pool.length)]!;
  if (!def.requiresTarget) return { def, targetId: null };

  const candidates = players.filter((p) => p.id !== recipientId);
  if (candidates.length === 0) return null;
  const target = candidates[Math.floor(random() * candidates.length)]!;
  return { def, targetId: target.id };
}

export function findMissionDef(id: string): MissionDef | undefined {
  return MISSION_DEFS.find((m) => m.id === id);
}

/** Computes the end-of-game mission bonus for every player who accepted one (`missionId` set)
 * and completed it - `0`/absent for everyone else, mirroring `computeDuelBonus()`'s shape so it
 * plugs into `calculateGamePoints()` the same way. */
export function computeMissionBonus(
  players: readonly Player[],
  ctx: MissionContext,
): Map<bigint, number> {
  const bonus = new Map<bigint, number>();
  for (const player of players) {
    if (!player.missionId) continue;
    const def = findMissionDef(player.missionId);
    if (!def) continue;
    if (checkMissionCompleted(def, player, players, ctx)) {
      bonus.set(player.id, def.points);
    }
  }
  return bonus;
}
