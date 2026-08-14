import { describe, expect, it } from 'vitest';
import { calculateGamePoints } from '../../src/domain/scoring.js';
import type { Player } from '../../src/domain/game/player.js';
import type { Team } from '../../src/domain/game/team.js';
import { ROLE_BIT } from '../../src/domain/roles/role.js';

function createMockPlayer(id: bigint, name: string, team: Team, isDead = false): Player {
  return {
    id,
    name,
    role: ROLE_BIT.Villager,
    team,
    isDead,
    isBot: false,
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
    expect(wolfResult.points).toBe(5); // 5 participation
  });

  it('calculates points for a Wolf win correctly', () => {
    const p1 = createMockPlayer(1n, 'Wolfy', 'Wolf', false);
    const p2 = createMockPlayer(2n, 'Villager', 'Village', true);

    const results = calculateGamePoints([p1, p2], 'Wolf');

    const wolfResult = results.find((r) => r.playerId === 1n)!;
    expect(wolfResult.won).toBe(true);
    expect(wolfResult.points).toBe(30); // 5 participation + 25 living wolf win
  });

  it('applies AFK penalty when player is marked AFK', () => {
    const p1 = createMockPlayer(1n, 'AFKGuy', 'Village', false);
    const afkSet = new Set<bigint>([1n]);

    const results = calculateGamePoints([p1], 'Village', null, afkSet);
    const result = results[0]!;

    expect(result.breakdown.afkPenalty).toBe(-10);
    expect(result.points).toBe(15); // 5 participation + 20 win - 10 AFK penalty
  });
});
