import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlayerRepository } from '../../src/infrastructure/persistence/player.repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

function makePlayer(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    telegramId: 1000n,
    username: 'alice',
    displayName: 'Alice',
    languageCode: 'en',
    hasStartedPm: true,
    isBanned: false,
    banReason: null,
    totalDonatedStars: 0,
    donationLevel: 0,
    firstLynchStreak: 0,
    afkCount: 0,
    suspendedUntil: null,
    points: 0,
    gamesPlayed: 0,
    gamesWon: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrisma(playerOverrides: Record<string, unknown> = {}): AnyPrisma {
  const player = makePlayer(playerOverrides);
  return {
    player: {
      upsert: vi.fn(async () => player),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => player),
      findMany: vi.fn(async () => [player]),
      count: vi.fn(async () => 0),
    },
  };
}

describe('PlayerRepository - AFK suspension logic', () => {
  it('increments afkCount and does NOT suspend on 1st strike', async () => {
    const prisma = makePrisma({ afkCount: 0 });
    const repo = new PlayerRepository(prisma);

    const result = await repo.recordAfkStrike(1000n);

    expect(result.isSuspended).toBe(false);
    expect(result.afkCount).toBe(1);
    // Only update once (not the suspension path)
    expect(prisma.player.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ afkCount: 1 }) }),
    );
  });

  it('increments afkCount to 2 on 2nd strike, still NOT suspended', async () => {
    const prisma = makePrisma({ afkCount: 1 });
    const repo = new PlayerRepository(prisma);

    const result = await repo.recordAfkStrike(1000n);

    expect(result.isSuspended).toBe(false);
    expect(result.afkCount).toBe(2);
  });

  it('resets afkCount to 0 and suspends for 24h on 3rd strike', async () => {
    const before = Date.now();
    const prisma = makePrisma({ afkCount: 2 });
    const repo = new PlayerRepository(prisma);

    const result = await repo.recordAfkStrike(1000n);

    expect(result.isSuspended).toBe(true);
    expect(result.afkCount).toBe(3);
    expect(result.suspendedUntil).toBeInstanceOf(Date);
    // Should be approximately 24h from now
    const expectedMs = 24 * 60 * 60 * 1000;
    expect(result.suspendedUntil!.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 100);

    expect(prisma.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ afkCount: 0 }),
      }),
    );
  });
});

describe('PlayerRepository - checkSuspension', () => {
  it('returns isSuspended=false when player has no suspendedUntil', async () => {
    const prisma = makePrisma({ suspendedUntil: null });
    const repo = new PlayerRepository(prisma);

    const result = await repo.checkSuspension(1000n);
    expect(result.isSuspended).toBe(false);
    expect(result.suspendedUntil).toBeNull();
  });

  it('returns isSuspended=true when suspendedUntil is in the future', async () => {
    const future = new Date(Date.now() + 10 * 60 * 60 * 1000); // 10h from now
    const prisma = {
      player: {
        findUnique: vi.fn(async () => ({ suspendedUntil: future })),
      },
    };
    const repo = new PlayerRepository(prisma as AnyPrisma);

    const result = await repo.checkSuspension(1000n);
    expect(result.isSuspended).toBe(true);
    expect(result.suspendedUntil).toEqual(future);
  });

  it('returns isSuspended=false when suspendedUntil is in the past (suspension expired)', async () => {
    const past = new Date(Date.now() - 60 * 1000); // 1 minute ago
    const prisma = {
      player: {
        findUnique: vi.fn(async () => ({ suspendedUntil: past })),
      },
    };
    const repo = new PlayerRepository(prisma as AnyPrisma);

    const result = await repo.checkSuspension(1000n);
    expect(result.isSuspended).toBe(false);
    expect(result.suspendedUntil).toBeNull();
  });
});

describe('PlayerRepository - awardPoints', () => {
  it('calls update with incremented points and gamesPlayed, adds gamesWon when won=true', async () => {
    const prisma = makePrisma();
    const repo = new PlayerRepository(prisma);

    await repo.awardPoints(1000n, 25, true);

    expect(prisma.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { telegramId: 1000n },
        data: expect.objectContaining({
          points: { increment: 25 },
          gamesPlayed: { increment: 1 },
          gamesWon: { increment: 1 },
        }),
      }),
    );
  });

  it('does NOT increment gamesWon when won=false', async () => {
    const prisma = makePrisma();
    const repo = new PlayerRepository(prisma);

    await repo.awardPoints(1000n, 5, false);

    const call = prisma.player.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty('gamesWon');
    expect(call.data).toHaveProperty('points', { increment: 5 });
  });
});

describe('PlayerRepository - getPlayerRank', () => {
  it('returns null when player does not exist', async () => {
    const prisma = {
      player: {
        upsert: vi.fn(async () => makePlayer()),
        findUnique: vi.fn(async () => null),
        count: vi.fn(async () => 0),
      },
    };
    const repo = new PlayerRepository(prisma as AnyPrisma);

    const result = await repo.getPlayerRank(9999n);
    expect(result).toBeNull();
  });

  it('returns rank 1 when no other player has more points', async () => {
    const playerData = { points: 100, gamesPlayed: 5, gamesWon: 3 };
    const prisma = {
      player: {
        upsert: vi.fn(async () => makePlayer()),
        findUnique: vi.fn(async () => playerData),
        count: vi.fn(async () => 0), // 0 players with more points
      },
    };
    const repo = new PlayerRepository(prisma as AnyPrisma);

    const result = await repo.getPlayerRank(1000n);
    expect(result).toEqual({ rank: 1, points: 100, gamesPlayed: 5, gamesWon: 3 });
  });

  it('returns rank 5 when 4 other players have more points', async () => {
    const playerData = { points: 50, gamesPlayed: 3, gamesWon: 1 };
    const prisma = {
      player: {
        upsert: vi.fn(async () => makePlayer()),
        findUnique: vi.fn(async () => playerData),
        count: vi.fn(async () => 4), // 4 players with more points
      },
    };
    const repo = new PlayerRepository(prisma as AnyPrisma);

    const result = await repo.getPlayerRank(1000n);
    expect(result).toEqual({ rank: 5, points: 50, gamesPlayed: 3, gamesWon: 1 });
  });
});
