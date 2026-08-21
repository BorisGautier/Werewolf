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
  type MissionContext,
} from '../../src/domain/game/missions.js';

function villagers(n: number) {
  return Array.from({ length: n }, (_, i) =>
    createPlayer(BigInt(i + 1), `V${i + 1}`, ROLE_BIT.Villager, 'Village'),
  );
}

function ctx(overrides: Partial<MissionContext> = {}): MissionContext {
  return { claimedIds: new Set(), voteLog: [], finalDay: 1, ...overrides };
}

describe('MISSION_DEFS', () => {
  it('has exactly 60 missions (30 generic + 30 player-targeted), every one with a unique id and a plausible minPlayers', () => {
    expect(MISSION_DEFS).toHaveLength(60);
    const ids = MISSION_DEFS.map((m) => m.id);
    expect(new Set(ids).size).toBe(60);
    for (const def of MISSION_DEFS) {
      expect(def.minPlayers).toBeGreaterThanOrEqual(5);
      expect(def.points).toBeGreaterThan(0);
      // Every def has exactly one of the two completion-check shapes, matching its own flag.
      if (def.requiresTarget) {
        expect(def.isCompletedWithTarget).toBeTypeOf('function');
      } else {
        expect(def.isCompleted).toBeTypeOf('function');
      }
    }
  });

  it('has exactly 30 player-targeted missions', () => {
    expect(MISSION_DEFS.filter((m) => m.requiresTarget)).toHaveLength(30);
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
    const picked = pickMissionForPlayer(players[0]!.id, players, new Set(), () => 0);
    expect(picked?.def).toEqual(pool[0]);
  });

  it('returns null when the game is too small for even the easiest mission', () => {
    const players = villagers(2);
    expect(pickMissionForPlayer(players[0]!.id, players)).toBeNull();
  });

  it('never picks a mission an admin has globally disabled', () => {
    const players = villagers(5);
    const pool = selectFeasibleMissions(players);
    const disabledIds = new Set(pool.map((d) => d.id).slice(0, pool.length - 1));
    const lastAllowedId = pool[pool.length - 1]!.id;

    const picked = pickMissionForPlayer(players[0]!.id, players, disabledIds, () => 0.999999);
    expect(picked?.def.id).toBe(lastAllowedId);
  });

  it('returns null when every feasible mission has been disabled', () => {
    const players = villagers(5);
    const allIds = new Set(selectFeasibleMissions(players).map((d) => d.id));
    expect(pickMissionForPlayer(players[0]!.id, players, allIds)).toBeNull();
  });

  it('draws a target for a requiresTarget mission, always excluding the recipient themselves', () => {
    const players = villagers(6);
    const recipient = players[0]!;
    // Force the pool down to a single, targeted mission so the outcome is deterministic.
    const targetedId = MISSION_DEFS.find((d) => d.requiresTarget)!.id;
    const disabledIds = new Set(MISSION_DEFS.filter((d) => d.id !== targetedId).map((d) => d.id));

    for (let i = 0; i < 20; i++) {
      const offer = pickMissionForPlayer(recipient.id, players, disabledIds, Math.random);
      expect(offer).not.toBeNull();
      expect(offer!.def.id).toBe(targetedId);
      expect(offer!.targetId).not.toBeNull();
      expect(offer!.targetId).not.toBe(recipient.id);
    }
  });

  it('never draws a target for a generic (non-targeted) mission', () => {
    const players = villagers(5);
    const genericId = 'survivor';
    const disabledIds = new Set(MISSION_DEFS.filter((d) => d.id !== genericId).map((d) => d.id));
    const offer = pickMissionForPlayer(players[0]!.id, players, disabledIds, () => 0);
    expect(offer?.def.id).toBe(genericId);
    expect(offer?.targetId).toBeNull();
  });
});

describe('checkMissionCompleted / computeMissionBonus', () => {
  it('awards nothing to a player who never accepted a mission, even if its condition holds', () => {
    const [alive] = villagers(1) as [ReturnType<typeof createPlayer>];
    alive.missionId = null; // never accepted
    const bonus = computeMissionBonus([alive], ctx());
    expect(bonus.has(alive.id)).toBe(false);
  });

  it("awards the survivor mission's points to an accepted, still-alive player", () => {
    const alive = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    alive.missionId = 'survivor';
    const bonus = computeMissionBonus([alive], ctx());
    expect(bonus.get(alive.id)).toBe(findMissionDef('survivor')!.points);
  });

  it('does not award the survivor mission to an accepted player who died', () => {
    const dead = createPlayer(1n, 'Bob', ROLE_BIT.Villager, 'Village');
    dead.missionId = 'survivor';
    dead.isDead = true;
    const bonus = computeMissionBonus([dead], ctx());
    expect(bonus.has(dead.id)).toBe(false);
  });

  it("resolves 'silent' against the game's claimsMap rather than any Player field", () => {
    const def = findMissionDef('silent')!;
    const claimed = createPlayer(1n, 'Claimed', ROLE_BIT.Villager, 'Village');
    const quiet = createPlayer(2n, 'Quiet', ROLE_BIT.Villager, 'Village');
    const claimedIds = new Set([claimed.id]);

    expect(checkMissionCompleted(def, claimed, [claimed, quiet], ctx({ claimedIds }))).toBe(false);
    expect(checkMissionCompleted(def, quiet, [claimed, quiet], ctx({ claimedIds }))).toBe(true);
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
    expect(def.isCompleted!(stillAlive, all)).toBe(true);
    expect(def.isCompleted!(diedNight1, all)).toBe(false);
    expect(def.isCompleted!(diedNight3, all)).toBe(true);
  });

  it('lastStanding only completes when 3 or fewer players are alive at the end', () => {
    const def = findMissionDef('lastStanding')!;
    const players = villagers(5);
    // 4 alive, 1 dead - not down to the final 3 yet.
    players[4]!.isDead = true;
    expect(def.isCompleted!(players[0]!, players)).toBe(false);

    players[3]!.isDead = true;
    // 3 alive now.
    expect(def.isCompleted!(players[0]!, players)).toBe(true);
    // A dead player never qualifies, even once the survivor count is low enough.
    expect(def.isCompleted!(players[4]!, players)).toBe(false);
  });

  it('closeCall needs at least one escaped top-vote round, untouchable needs at least two', () => {
    const closeCall = findMissionDef('closeCall')!;
    const untouchable = findMissionDef('untouchable')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');

    expect(closeCall.isCompleted!(p, [p])).toBe(false);
    expect(untouchable.isCompleted!(p, [p])).toBe(false);

    p.escapedTopVoteLynchCount = 1;
    expect(closeCall.isCompleted!(p, [p])).toBe(true);
    expect(untouchable.isCompleted!(p, [p])).toBe(false);

    p.escapedTopVoteLynchCount = 2;
    expect(untouchable.isCompleted!(p, [p])).toBe(true);
  });

  it('ghost completes exactly when hasBeenVoted stays false all game', () => {
    const def = findMissionDef('ghost')!;
    const untouched = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const voted = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    voted.hasBeenVoted = true;

    expect(def.isCompleted!(untouched, [untouched, voted])).toBe(true);
    expect(def.isCompleted!(voted, [untouched, voted])).toBe(false);
  });

  it('target needs 3+ distinct voters against them AND surviving to the end', () => {
    const def = findMissionDef('target')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    p.everVotedAgainstBy = new Set([2n, 3n]);
    expect(def.isCompleted!(p, [p])).toBe(false); // only 2 distinct voters

    p.everVotedAgainstBy.add(4n);
    expect(def.isCompleted!(p, [p])).toBe(true);

    p.isDead = true;
    expect(def.isCompleted!(p, [p])).toBe(false); // didn't survive it
  });

  it('scout only rewards one of the first 3 entries in the join-order array', () => {
    const def = findMissionDef('scout')!;
    const players = villagers(6);
    expect(def.isCompleted!(players[0]!, players)).toBe(true);
    expect(def.isCompleted!(players[2]!, players)).toBe(true);
    expect(def.isCompleted!(players[3]!, players)).toBe(false);
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

    expect(champion.isCompleted!(wonAlive, [])).toBe(true);
    expect(champion.isCompleted!(wonDead, [])).toBe(false);
    expect(martyr.isCompleted!(wonDead, [])).toBe(true);
    expect(martyr.isCompleted!(wonAlive, [])).toBe(false);
    expect(resistant.isCompleted!(lostAlive, [])).toBe(true);
    expect(resistant.isCompleted!(wonAlive, [])).toBe(false);
  });
});

describe('player-targeted missions', () => {
  it('awards nothing if the recipient accepted a targeted mission but the target is unresolvable', () => {
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    p.missionId = 'bodyguard';
    p.missionTargetId = 999n; // not in the roster
    const bonus = computeMissionBonus([p], ctx());
    expect(bonus.has(p.id)).toBe(false);
  });

  it('bodyguard rewards the recipient exactly when the target survives to the end', () => {
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    p.missionId = 'bodyguard';
    p.missionTargetId = target.id;

    expect(computeMissionBonus([p, target], ctx()).has(p.id)).toBe(true);

    target.isDead = true;
    expect(computeMissionBonus([p, target], ctx()).has(p.id)).toBe(false);
  });

  it('rivalJure (outlived) rewards surviving the target, or dying strictly later than them', () => {
    const def = findMissionDef('rivalJure')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    const t = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(false); // target still alive

    t.isDead = true;
    t.dayDied = 2;
    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(true); // p alive, t dead

    p.isDead = true;
    p.dayDied = 1;
    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(false); // p died before t

    p.dayDied = 3;
    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(true); // p died after t
  });

  it('manhunt only completes when the target specifically died by lynch, not any other death', () => {
    const def = findMissionDef('manhunt')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    const t = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    t.isDead = true;
    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(false);

    t.diedByLynch = true;
    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(true);
  });

  it('nightShadow only completes when the target died specifically at night', () => {
    const def = findMissionDef('nightShadow')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    const t = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    t.isDead = true;
    t.diedAtNight = false;
    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(false);

    t.diedAtNight = true;
    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(true);
  });

  it('plot needs at least 2 votes cast by the recipient against the target, read from the vote log', () => {
    const def = findMissionDef('plot')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    const t = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(false);
    expect(
      def.isCompletedWithTarget!(
        p,
        t,
        [p, t],
        ctx({ voteLog: [{ day: 1, voterId: p.id, targetId: t.id }] }),
      ),
    ).toBe(false);
    expect(
      def.isCompletedWithTarget!(
        p,
        t,
        [p, t],
        ctx({
          voteLog: [
            { day: 1, voterId: p.id, targetId: t.id },
            { day: 2, voterId: p.id, targetId: t.id },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('loner completes only when the target never once voted for the recipient', () => {
    const def = findMissionDef('loner')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    const t = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    expect(def.isCompletedWithTarget!(p, t, [p, t], ctx())).toBe(true); // no votes at all yet
    expect(
      def.isCompletedWithTarget!(
        p,
        t,
        [p, t],
        ctx({ voteLog: [{ day: 1, voterId: t.id, targetId: p.id }] }),
      ),
    ).toBe(false);
  });

  it('sameWavelength needs the recipient and target voting for the same 3rd party on 2+ shared days', () => {
    const def = findMissionDef('sameWavelength')!;
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    const t = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    const third = 3n;

    const oneMatch = ctx({
      voteLog: [
        { day: 1, voterId: p.id, targetId: third },
        { day: 1, voterId: t.id, targetId: third },
      ],
    });
    expect(def.isCompletedWithTarget!(p, t, [p, t], oneMatch)).toBe(false);

    const twoMatches = ctx({
      voteLog: [
        { day: 1, voterId: p.id, targetId: third },
        { day: 1, voterId: t.id, targetId: third },
        { day: 2, voterId: p.id, targetId: third },
        { day: 2, voterId: t.id, targetId: third },
      ],
    });
    expect(def.isCompletedWithTarget!(p, t, [p, t], twoMatches)).toBe(true);
  });
});
