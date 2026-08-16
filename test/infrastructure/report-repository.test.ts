import { describe, expect, it, vi } from 'vitest';
import { ReportRepository } from '../../src/infrastructure/persistence/report.repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

function makePrismaReport() {
  return {
    playerReport: {
      create: vi.fn(async (args: AnyPrisma) => ({
        id: 1,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findMany: vi.fn(async () => [
        {
          id: 1,
          reporterId: 100n,
          reportedId: 200n,
          groupId: null,
          reason: 'Cheating',
          status: 'PENDING',
          createdAt: new Date(),
          reporter: { username: 'alice', displayName: 'Alice', telegramId: 100n },
          reported: { username: 'bob', displayName: 'Bob', telegramId: 200n },
        },
      ]),
      update: vi.fn(async (args: AnyPrisma) => ({ id: args.where.id, status: args.data.status })),
    },
  };
}

describe('ReportRepository', () => {
  it('createReport saves data with PENDING status', async () => {
    const prisma = makePrismaReport();
    const repo = new ReportRepository(prisma as AnyPrisma);

    const result = await repo.createReport({
      reporterId: 100n,
      reportedId: 200n,
      groupId: 300n,
      reason: 'This player is cheating!',
    });

    expect(prisma.playerReport.create).toHaveBeenCalledOnce();
    expect(prisma.playerReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reporterId: 100n,
          reportedId: 200n,
          groupId: 300n,
          reason: 'This player is cheating!',
          status: 'PENDING',
        }),
      }),
    );
    expect(result.status).toBe('PENDING');
  });

  it('createReport saves null groupId when not provided', async () => {
    const prisma = makePrismaReport();
    const repo = new ReportRepository(prisma as AnyPrisma);

    await repo.createReport({ reporterId: 100n, reportedId: 200n, reason: 'Reason' });

    expect(prisma.playerReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ groupId: null }),
      }),
    );
  });

  it('getPendingReports queries with PENDING status filter and includes reporter/reported', async () => {
    const prisma = makePrismaReport();
    const repo = new ReportRepository(prisma as AnyPrisma);

    const results = await repo.getPendingReports(10);

    expect(prisma.playerReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
        take: 10,
        include: expect.objectContaining({
          reporter: expect.anything(),
          reported: expect.anything(),
        }),
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.reason).toBe('Cheating');
  });

  it('getPendingReports defaults to limit=20', async () => {
    const prisma = makePrismaReport();
    const repo = new ReportRepository(prisma as AnyPrisma);

    await repo.getPendingReports();

    expect(prisma.playerReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });

  it('updateReportStatus updates the status to RESOLVED', async () => {
    const prisma = makePrismaReport();
    const repo = new ReportRepository(prisma as AnyPrisma);

    const result = await repo.updateReportStatus(1, 'RESOLVED');

    expect(prisma.playerReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { status: 'RESOLVED' },
      }),
    );
    expect(result.status).toBe('RESOLVED');
  });

  it('updateReportStatus can set status to DISMISSED', async () => {
    const prisma = makePrismaReport();
    const repo = new ReportRepository(prisma as AnyPrisma);

    await repo.updateReportStatus(5, 'DISMISSED');

    expect(prisma.playerReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: { status: 'DISMISSED' },
      }),
    );
  });
});
