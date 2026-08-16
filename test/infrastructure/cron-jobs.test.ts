import { describe, expect, it, vi } from 'vitest';
import {
  expireBans,
  purgeStaleGames,
  rotateDailyStats,
} from '../../src/infrastructure/cron/jobs.js';

function fakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as import('../../src/infrastructure/logging/logger.js').Logger;
}

describe('rotateDailyStats', () => {
  it('rolls up finished games per group plus one group-less overall row', async () => {
    const created: unknown[] = [];
    const prisma = {
      game: {
        findMany: vi.fn(async () => [
          { groupId: 1, players: [{ playerId: 10 }, { playerId: 11 }] },
          { groupId: 1, players: [{ playerId: 10 }] },
          { groupId: 2, players: [{ playerId: 20 }] },
        ]),
      },
      dailyStat: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async (args: unknown) => created.push(args)),
        update: vi.fn(async () => {}),
        upsert: vi.fn(async (args: unknown) => created.push(args)),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await rotateDailyStats(prisma, fakeLogger());

    expect(prisma.dailyStat.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ groupId: null, gamesPlayed: 3, playersSeen: 3 }),
      }),
    );
    expect(prisma.dailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date_groupId: expect.objectContaining({ groupId: 1 }) },
        create: expect.objectContaining({ groupId: 1, gamesPlayed: 2, playersSeen: 2 }),
      }),
    );
    expect(prisma.dailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date_groupId: expect.objectContaining({ groupId: 2 }) },
        create: expect.objectContaining({ groupId: 2, gamesPlayed: 1, playersSeen: 1 }),
      }),
    );
  });

  it('updates instead of creating the overall row when one already exists for the day', async () => {
    const prisma = {
      game: { findMany: vi.fn(async () => []) },
      dailyStat: {
        findFirst: vi.fn(async () => ({ id: 99 })),
        create: vi.fn(async () => {}),
        update: vi.fn(async () => {}),
        upsert: vi.fn(async () => {}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await rotateDailyStats(prisma, fakeLogger());

    expect(prisma.dailyStat.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { gamesPlayed: 0, playersSeen: 0 },
    });
    expect(prisma.dailyStat.create).not.toHaveBeenCalled();
  });
});

describe('expireBans', () => {
  it("lifts a player's ban once every ban that applied to them has expired", async () => {
    const prisma = {
      globalBan: {
        findMany: vi.fn(async () => [{ telegramId: 1n }]),
        findFirst: vi.fn(async () => null), // no other still-active ban
      },
      player: { updateMany: vi.fn(async () => ({ count: 1 })) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expireBans(prisma, fakeLogger());

    expect(prisma.player.updateMany).toHaveBeenCalledWith({
      where: { telegramId: 1n, isBanned: true },
      data: { isBanned: false, banReason: null },
    });
  });

  it('leaves the ban in place if the player has another still-active ban', async () => {
    const prisma = {
      globalBan: {
        findMany: vi.fn(async () => [{ telegramId: 1n }]),
        findFirst: vi.fn(async () => ({ id: 5, telegramId: 1n })), // another active ban exists
      },
      player: { updateMany: vi.fn(async () => ({ count: 0 })) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expireBans(prisma, fakeLogger());

    expect(prisma.player.updateMany).not.toHaveBeenCalled();
  });
});

describe('purgeStaleGames', () => {
  it('marks games without an endedAt older than the cutoff as abandoned', async () => {
    const prisma = {
      game: { updateMany: vi.fn(async () => ({ count: 3 })) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = fakeLogger();

    await purgeStaleGames(prisma, logger, 12);

    expect(prisma.game.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ endedAt: null }),
        data: expect.objectContaining({ endedAt: expect.any(Date) }),
      }),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('stays quiet when nothing needed purging', async () => {
    const prisma = {
      game: { updateMany: vi.fn(async () => ({ count: 0 })) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = fakeLogger();

    await purgeStaleGames(prisma, logger);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
