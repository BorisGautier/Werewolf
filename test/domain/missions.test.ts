import { describe, expect, it } from 'vitest';
import { createPlayer } from '../../src/domain/game/player.js';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import {
  MISSION_DEFS,
  checkMissionCompleted,
  computeMissionBonus,
  findMissionDef,
  pickMissionForPlayer,
  selectFeasibleMissions,
} from '../../src/domain/game/missions.js';

function villagers(n: number) {
  return Array.from({ length: n }, (_, i) =>
    createPlayer(BigInt(i + 1), `V${i + 1}`, ROLE_BIT.Villager, 'Village'),
  );
}

describe('MISSION_DEFS', () => {
  it('has exactly 30 missions, every one with a unique id and a plausible minPlayers', () => {
    expect(MISSION_DEFS).toHaveLength(30);
    const ids = MISSION_DEFS.map((m) => m.id);
    expect(new Set(ids).size).toBe(30);
    for (const def of MISSION_DEFS) {
      expect(def.minPlayers).toBeGreaterThanOrEqual(5);
      expect(def.points).toBeGreaterThan(0);
    }
  });
});

describe('selectFeasibleMissions', () => {
  it('excludes every mission whose minPlayers exceeds the current game size', () => {
    const pool = selectFeasibleMissions(villagers(5));
    for (const def of pool) expect(def.minPlayers).toBeLessThanOrEqual(5);
    // Sanity: at least one of the genuinely large-game-only missions is excluded here.
    expect(pool.some((d) => d.id === 'veteran')).toBe(false);
    expect(pool.some((d) => d.id === 'marathoner')).toBe(false);
  });

  it('includes the high-threshold missions once the headcount clears their minPlayers', () => {
    const pool = selectFeasibleMissions(villagers(15));
    expect(pool.some((d) => d.id === 'veteran')).toBe(true);
    expect(pool.some((d) => d.id === 'marathoner')).toBe(true);
  });

  it('excludes doubleSurvivor unless a Troublemaker was actually dealt this game', () => {
    const withoutTroublemaker = villagers(10);
    expect(selectFeasibleMissions(withoutTroublemaker).some((d) => d.id === 'doubleSurvivor')).toBe(
      false,
    );

    const withTroublemaker = villagers(10);
    withTroublemaker[0]!.role = ROLE_BIT.Troublemaker;
    withTroublemaker[0]!.originalRole = ROLE_BIT.Troublemaker;
    expect(selectFeasibleMissions(withTroublemaker).some((d) => d.id === 'doubleSurvivor')).toBe(
      true,
    );
  });

  it('excludes chaosSurvivor unless the game has at least 3 killer roles dealt AND meets its own headcount floor', () => {
    const players = villagers(12);
    players[0]!.originalRole = ROLE_BIT.Wolf;
    players[1]!.originalRole = ROLE_BIT.SerialKiller;
    // Only 2 killer roles so far - still infeasible.
    expect(selectFeasibleMissions(players).some((d) => d.id === 'chaosSurvivor')).toBe(false);

    players[2]!.originalRole = ROLE_BIT.Arsonist;
    expect(selectFeasibleMissions(players).some((d) => d.id === 'chaosSurvivor')).toBe(true);
  });
});

describe('pickMissionForPlayer', () => {
  it('deterministically returns the mission at the rolled index of the feasible pool', () => {
    const players = villagers(5);
    const pool = selectFeasibleMissions(players);
    const picked = pickMissionForPlayer(players, new Set(), () => 0);
    expect(picked).toEqual(pool[0]);
  });

  it('returns null when the game is too small for even the easiest mission', () => {
    const players = villagers(2);
    expect(pickMissionForPlayer(players)).toBeNull();
  });

  it('never picks a mission an admin has globally disabled', () => {
    const players = villagers(5);
    const pool = selectFeasibleMissions(players);
    const disabledIds = new Set(pool.map((d) => d.id).slice(0, pool.length - 1));
    const lastAllowedId = pool[pool.length - 1]!.id;

    const picked = pickMissionForPlayer(players, disabledIds, () => 0.999999);
    expect(picked?.id).toBe(lastAllowedId);
  });

  it('returns null when every feasible mission has been disabled', () => {
    const players = villagers(5);
    const allIds = new Set(selectFeasibleMissions(players).map((d) => d.id));
    expect(pickMissionForPlayer(players, allIds)).toBeNull();
  });
});

describe('checkMissionCompleted / computeMissionBonus', () => {
  it('awards nothing to a player who never accepted a mission, even if its condition holds', () => {
    const [alive] = villagers(1) as [ReturnType<typeof createPlayer>];
    alive.missionId = null; // never accepted
    const bonus = computeMissionBonus([alive], new Set());
    expect(bonus.has(alive.id)).toBe(false);
  });

  it("awards the survivor mission's points to an accepted, still-alive player", () => {
    const alive = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    alive.missionId = 'survivor';
    const bonus = computeMissionBonus([alive], new Set());
    expect(bonus.get(alive.id)).toBe(findMissionDef('survivor')!.points);
  });

  it('does not award the survivor mission to an accepted player who died', () => {
    const dead = createPlayer(1n, 'Bob', ROLE_BIT.Villager, 'Village');
    dead.missionId = 'survivor';
    dead.isDead = true;
    const bonus = computeMissionBonus([dead], new Set());
    expect(bonus.has(dead.id)).toBe(false);
  });

  it("resolves 'silent' against the game's claimsMap rather than any Player field", () => {
    const def = findMissionDef('silent')!;
    const claimed = createPlayer(1n, 'Claimed', ROLE_BIT.Villager, 'Village');
    const quiet = createPlayer(2n, 'Quiet', ROLE_BIT.Villager, 'Village');
    const claimedIds = new Set([claimed.id]);

    expect(checkMissionCompleted(def, claimed, [claimed, quiet], claimedIds)).toBe(false);
    expect(checkMissionCompleted(def, quiet, [claimed, quiet], claimedIds)).toBe(true);
  });

  it('unsinkable only completes once dayDied is null or at least 3', () => {
    const def = findMissionDef('unsinkable')!;
    const stillAlive = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const diedNight1 = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    diedNight1.isDead = true;
    diedNight1.dayDied = 1;
    const diedNight3 = createPlayer(3n, 'C', ROLE_BIT.Villager, 'Village');
    diedNight3.isDead = true;
    diedNight3.dayDied = 3;

    const all = [stillAlive, diedNight1, diedNight3];
    expect(def.isCompleted(stillAlive, all)).toBe(true);
    expect(def.isCompleted(diedNight1, all)).toBe(false);
    expect(def.isCompleted(diedNight3, all)).toBe(true);
  });

  it('lastStanding only completes when 3 or fewer players are alive at the end', () => {
    const def = findMissionDef('lastStanding')!;
    const players = villagers(5);
    // 4 alive, 1 dead - not down to the final 3 yet.
    players[4]!.isDead = true;
    expect(def.isCompleted(players[0]!, players)).toBe(false);

    players[3]!.isDead = true;
    // 3 alive now.
    expect(def.isCompleted(players[0]!, players)).toBe(true);
    // A dead player never qualifies, even once the survivor count is low enough.
    expect(def.isCompleted(players[4]!, players)).toBe(false);
  });

  it('closeCall needs at least one escaped top-vote round, untouchable needs at least two', () => {
    const closeCall = findMissionDef('closeCall')!;
    const untouchable = findMissionDef('untouchable')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');

    expect(closeCall.isCompleted(p, [p])).toBe(false);
    expect(untouchable.isCompleted(p, [p])).toBe(false);

    p.escapedTopVoteLynchCount = 1;
    expect(closeCall.isCompleted(p, [p])).toBe(true);
    expect(untouchable.isCompleted(p, [p])).toBe(false);

    p.escapedTopVoteLynchCount = 2;
    expect(untouchable.isCompleted(p, [p])).toBe(true);
  });

  it('ghost completes exactly when hasBeenVoted stays false all game', () => {
    const def = findMissionDef('ghost')!;
    const untouched = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const voted = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    voted.hasBeenVoted = true;

    expect(def.isCompleted(untouched, [untouched, voted])).toBe(true);
    expect(def.isCompleted(voted, [untouched, voted])).toBe(false);
  });

  it('target needs 3+ distinct voters against them AND surviving to the end', () => {
    const def = findMissionDef('target')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    p.everVotedAgainstBy = new Set([2n, 3n]);
    expect(def.isCompleted(p, [p])).toBe(false); // only 2 distinct voters

    p.everVotedAgainstBy.add(4n);
    expect(def.isCompleted(p, [p])).toBe(true);

    p.isDead = true;
    expect(def.isCompleted(p, [p])).toBe(false); // didn't survive it
  });

  it('scout only rewards one of the first 3 entries in the join-order array', () => {
    const def = findMissionDef('scout')!;
    const players = villagers(6);
    expect(def.isCompleted(players[0]!, players)).toBe(true);
    expect(def.isCompleted(players[2]!, players)).toBe(true);
    expect(def.isCompleted(players[3]!, players)).toBe(false);
  });

  it('champion/martyr/resistant partition survival x victory correctly', () => {
    const champion = findMissionDef('champion')!;
    const martyr = findMissionDef('martyr')!;
    const resistant = findMissionDef('resistant')!;

    const wonAlive = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    wonAlive.won = true;
    const wonDead = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    wonDead.won = true;
    wonDead.isDead = true;
    const lostAlive = createPlayer(3n, 'C', ROLE_BIT.Wolf, 'Wolf');

    expect(champion.isCompleted(wonAlive, [])).toBe(true);
    expect(champion.isCompleted(wonDead, [])).toBe(false);
    expect(martyr.isCompleted(wonDead, [])).toBe(true);
    expect(martyr.isCompleted(wonAlive, [])).toBe(false);
    expect(resistant.isCompleted(lostAlive, [])).toBe(true);
    expect(resistant.isCompleted(wonAlive, [])).toBe(false);
  });
});
