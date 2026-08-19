import { describe, expect, it, vi } from 'vitest';
import { startCronJobs } from '../../src/infrastructure/cron/scheduler.js';

function fakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as import('../../src/infrastructure/logging/logger.js').Logger;
}

describe('startCronJobs', () => {
  it('registers the daily database backup job alongside the other maintenance jobs', () => {
    // Regression test: `runDailyDatabaseBackup` (src/infrastructure/cron/jobs.ts) worked fine on
    // its own, but was never actually wired into the scheduler - so it had never run
    // automatically in any deployment. This asserts it's really registered, not just present in
    // jobs.ts.
    const logger = fakeLogger();
    const prisma = {} as unknown as import('@prisma/client').PrismaClient;

    const stop = startCronJobs(prisma, logger);
    try {
      const registeredCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[1] === 'Cron jobs registered and running',
      );
      expect(registeredCall).toBeDefined();
      const meta = registeredCall![0] as { jobs: number; schedules: string[] };
      expect(meta.jobs).toBe(4);
      expect(meta.schedules.some((s) => s.includes('daily DB backup'))).toBe(true);
    } finally {
      stop();
    }
  });
});
