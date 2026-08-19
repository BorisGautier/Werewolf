import { describe, expect, it } from 'vitest';
import { calculateGamePoints, computeDuelBonus } from '../../src/domain/scoring.js';
import type { Player } from '../../src/domain/game/player.js';
import type { GameEvent } from '../../src/domain/game/game-event.js';
import type { Team } from '../../src/domain/game/team.js';
import { ROLE_BIT } from '../../src/domain/roles/role.js';

function createMockPlayer(
  id: bigint,
  name: string,
  team: Team,
  isDead = false,
  duelSquad: 'A' | 'B' | null = null,
): Player {
  return {
    id,
    name,
    role: ROLE_BIT.Villager,
    team,
    isDead,
    isBot: false,
    duelSquad,
  } as unknown as Player;
}

describe('calculateGamePoints', () => {
  it('calculates points for a Village win correctly', () => {
    const p1 = createMockPlayer(1n, 'Alice', 'Village', false);
    const p2 = createMockPlayer(2n, 'Bob', 'Village', true);
    const p3 = createMockPlayer(3n, 'Wolfy', 'Wolf', true);

    const results = calculateGamePoints([p1, p2, p3], 'Village', 2n);

    const aliceResult = results.find((r) => r.playerId === 1n)!;
    expect(aliceResult.won).toBe(true);
    expect(aliceResult.points).toBe(25); // 5 participation + 20 living village win

    const bobResult = results.find((r) => r.playerId === 2n)!;
    expect(bobResult.won).toBe(true);
    expect(bobResult.points).toBe(17); // 5 participation + 10 dead village win + 2 first lynch consolation

    const wolfResult = results.find((r) => r.playerId === 3n)!;
    expect(wolfResult.won).toBe(false);
    expect(wolfResult.points).toBe(-5); // 5 participation - 10 defeat penalty
  });

  it('calculates points for a Wolf win correctly', () => {
    const p1 = createMockPlayer(1n, 'Wolfy', 'Wolf', false);
    const p2 = createMockPlayer(2n, 'Villager', 'Village', true);

    const results = calculateGamePoints([p1, p2], 'Wolf');

    const wolfResult = results.find((r) => r.playerId === 1n)!;
    expect(wolfResult.won).toBe(true);
    expect(wolfResult.points).toBe(30); // 5 participation + 25 living wolf win

    const villagerResult = results.find((r) => r.playerId === 2n)!;
    expect(villagerResult.won).toBe(false);
    expect(villagerResult.points).toBe(-5); // 5 participation - 10 defeat penalty
  });

  it('applies AFK penalty when player is marked AFK', () => {
    const p1 = createMockPlayer(1n, 'AFKGuy', 'Village', false);
    const afkSet = new Set<bigint>([1n]);

    const results = calculateGamePoints([p1], 'Wolf', null, afkSet);
    const result = results[0]!;

    expect(result.breakdown.afkPenalty).toBe(-15);
    expect(result.points).toBe(-20); // 5 participation - 10 defeat - 15 AFK penalty
  });

  it('waives the defeat penalty and grants a bigger consolation for a Night 1 death', () => {
    const p1 = createMockPlayer(1n, 'EarlyVictim', 'Village', true);
    const earlyDeathIds = new Set<bigint>([1n]);

    const results = calculateGamePoints([p1], 'Wolf', null, undefined, earlyDeathIds);
    const result = results[0]!;

    expect(result.breakdown.defeatPenalty).toBe(0);
    expect(result.breakdown.consolation).toBe(5);
    expect(result.points).toBe(10); // 5 participation + 0 defeat + 5 consolation
  });

  it('still applies the normal defeat penalty for a death that is not an early Night 1 kill', () => {
    const p1 = createMockPlayer(1n, 'LateVictim', 'Village', true);

    const results = calculateGamePoints([p1], 'Wolf', null, undefined, new Set());
    const result = results[0]!;

    expect(result.breakdown.defeatPenalty).toBe(-10);
    expect(result.points).toBe(-5);
  });

  it('adds the role-performance bonus/malus on top of the win/lose score', () => {
    const p1 = createMockPlayer(1n, 'Alice', 'Village', false);
    const rolePerformanceBonus = new Map<bigint, number>([[1n, 4]]);

    const results = calculateGamePoints(
      [p1],
      'Village',
      null,
      undefined,
      undefined,
      rolePerformanceBonus,
    );
    const result = results[0]!;

    expect(result.breakdown.rolePerformance).toBe(4);
    expect(result.points).toBe(29); // 5 participation + 20 living village win + 4 role performance
  });

  it('adds the TeamDuel bonus on top of the generic winner score', () => {
    const p1 = createMockPlayer(1n, 'Alice', 'Village', false);
    const duelBonus = new Map<bigint, number>([[1n, 25]]);

    // winningTeam is null for a Duel win (see calculateGamePoints's doc comment) - player.won
    // being true is what makes them a winner here, same as a real TeamDuel game would produce.
    const p1Winner = { ...p1, won: true } as unknown as Player;
    const results = calculateGamePoints(
      [p1Winner],
      null,
      null,
      undefined,
      undefined,
      undefined,
      duelBonus,
    );
    const result = results[0]!;

    expect(result.breakdown.duelBonus).toBe(25);
    expect(result.points).toBe(50); // 5 participation + 20 generic winner + 25 duel bonus
  });
});

describe('computeDuelBonus', () => {
  function duelWonBatch(squad: 'A' | 'B', survivorIds: bigint[]): GameEvent[][] {
    return [[{ type: 'DuelSquadWon', squad, survivorIds }]];
  }

  it('is empty for a game that never emitted a DuelSquadWon event', () => {
    const p1 = createMockPlayer(1n, 'Alice', 'Village', false, 'A');
    expect(computeDuelBonus([p1], [[]])).toEqual(new Map());
  });

  it('gives every winning-squad member a base bonus, higher for survivors than the fallen', () => {
    const survivor = createMockPlayer(1n, 'Survivor', 'Village', false, 'A');
    const fallen = createMockPlayer(2n, 'Fallen', 'Wolf', true, 'A');
    const loser = createMockPlayer(3n, 'Loser', 'Village', true, 'B');

    const bonus = computeDuelBonus([survivor, fallen, loser], duelWonBatch('A', [survivor.id]));

    expect(bonus.get(survivor.id)).toBe(20); // alive: base 20, margin = 5*(1-1) = 0
    expect(bonus.get(fallen.id)).toBe(8); // dead: base 8, same margin
    expect(bonus.has(loser.id)).toBe(false); // not on the winning squad at all
  });

  it('scales the margin bonus with how many survivors the winning squad ended with', () => {
    const s1 = createMockPlayer(1n, 'S1', 'Village', false, 'A');
    const s2 = createMockPlayer(2n, 'S2', 'Wolf', false, 'A');
    const s3 = createMockPlayer(3n, 'S3', 'Village', false, 'A');

    const bonus = computeDuelBonus([s1, s2, s3], duelWonBatch('A', [s1.id, s2.id, s3.id]));

    // base 20 + margin 5*(3-1)=10 => 30 each
    expect(bonus.get(s1.id)).toBe(30);
    expect(bonus.get(s2.id)).toBe(30);
    expect(bonus.get(s3.id)).toBe(30);
  });
});
