import { describe, expect, it, vi } from 'vitest';
import { MissionRepository } from '../../src/infrastructure/persistence/mission.repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

function makePrisma(overrides: Partial<AnyPrisma> = {}): AnyPrisma {
  return {
    disabledMission: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    missionCompletion: {
      create: vi.fn(async () => ({})),
      groupBy: vi.fn(async () => []),
    },
    player: {
      findMany: vi.fn(async () => []),
    },
    ...overrides,
  };
}

describe('MissionRepository', () => {
  it('getDisabledMissionIds returns the set of currently-disabled mission ids', async () => {
    const prisma = makePrisma({
      disabledMission: {
        findMany: vi.fn(async () => [{ missionId: 'survivor' }, { missionId: 'ghost' }]),
      },
    });
    const repo = new MissionRepository(prisma);

    const ids = await repo.getDisabledMissionIds();

    expect(ids).toEqual(new Set(['survivor', 'ghost']));
  });

  it('setMissionEnabled(false) upserts a disabled row', async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = makePrisma({ disabledMission: { upsert, deleteMany: vi.fn() } });
    const repo = new MissionRepository(prisma);

    await repo.setMissionEnabled('ghost', false);

    expect(upsert).toHaveBeenCalledWith({
      where: { missionId: 'ghost' },
      create: { missionId: 'ghost' },
      update: {},
    });
  });

  it('setMissionEnabled(true) deletes any existing disabled row', async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const prisma = makePrisma({ disabledMission: { deleteMany, upsert: vi.fn() } });
    const repo = new MissionRepository(prisma);

    await repo.setMissionEnabled('ghost', true);

    expect(deleteMany).toHaveBeenCalledWith({ where: { missionId: 'ghost' } });
  });

  it('recordCompletion writes one row with the given outcome', async () => {
    const create = vi.fn(async () => ({}));
    const prisma = makePrisma({ missionCompletion: { create, groupBy: vi.fn() } });
    const repo = new MissionRepository(prisma);

    await repo.recordCompletion(123n, 'survivor', true, 42);

    expect(create).toHaveBeenCalledWith({
      data: { playerId: 123n, missionId: 'survivor', succeeded: true, gameId: 42 },
    });
  });

  it('getMissionStats aggregates attempts/successes per mission from grouped rows', async () => {
    const prisma = makePrisma({
      missionCompletion: {
        groupBy: vi.fn(async () => [
          { missionId: 'survivor', succeeded: true, _count: { _all: 7 } },
          { missionId: 'survivor', succeeded: false, _count: { _all: 3 } },
          { missionId: 'ghost', succeeded: true, _count: { _all: 2 } },
        ]),
        create: vi.fn(),
      },
    });
    const repo = new MissionRepository(prisma);

    const stats = await repo.getMissionStats();

    expect(stats).toContainEqual({ missionId: 'survivor', attempts: 10, successes: 7 });
    expect(stats).toContainEqual({ missionId: 'ghost', attempts: 2, successes: 2 });
  });

  it('getTopPerformers ranks by success rate then by attempt volume, excluding players below minAttempts', async () => {
    const prisma = makePrisma({
      missionCompletion: {
        groupBy: vi.fn(async () => [
          // Player 1: 8/10 = 80%, high volume.
          { playerId: 1n, succeeded: true, _count: { _all: 8 } },
          { playerId: 1n, succeeded: false, _count: { _all: 2 } },
          // Player 2: 1/1 = 100%, but below the minAttempts floor - excluded.
          { playerId: 2n, succeeded: true, _count: { _all: 1 } },
          // Player 3: 3/3 = 100%, qualifies and should outrank player 1 despite fewer attempts.
          { playerId: 3n, succeeded: true, _count: { _all: 3 } },
        ]),
        create: vi.fn(),
      },
      player: {
        findMany: vi.fn(async () => [
          { telegramId: 1n, username: 'alice', displayName: 'Alice' },
          { telegramId: 3n, username: null, displayName: 'Carol' },
        ]),
      },
    });
    const repo = new MissionRepository(prisma);

    const top = await repo.getTopPerformers(2, 10);

    expect(top).toHaveLength(2);
    expect(top[0]).toMatchObject({ playerId: 3n, successRate: 100, attempts: 3 });
    expect(top[1]).toMatchObject({ playerId: 1n, successRate: 80, attempts: 10 });
  });
});
