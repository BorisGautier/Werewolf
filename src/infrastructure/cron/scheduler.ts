import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../logging/logger.js';
import { expireBans, purgeStaleGames, rotateDailyStats } from './jobs.js';
import { cronJobFailures, cronJobRuns } from '../monitoring/metrics.js';

/** Starts the bot's background maintenance jobs. Returns a function that stops them all. */
export function startCronJobs(prisma: PrismaClient, logger: Logger): () => void {
  logger.debug('Registering background cron job schedules');

  const tasks = [
    // Once a day, just after midnight UTC - rolls up the day that just ended.
    cron.schedule('5 0 * * *', () => {
      cronJobRuns.labels('rotateDailyStats').inc();
      logger.info({ job: 'rotateDailyStats', schedule: '5 0 * * *' }, 'Cron triggered: daily stats rotation starting');
      void rotateDailyStats(prisma, logger).catch((err: unknown) => {
        cronJobFailures.labels('rotateDailyStats').inc();
        logger.error({ err, job: 'rotateDailyStats' }, 'Cron job error: rotateDailyStats failed');
      });
    }),

    // Every minute - mirrors the original's `BanMonitor` loop (a 1-minute `Thread.Sleep`, despite
    // its own stale "refresh every 20 minutes" comment) so a spam ban's shortest tier (12h) doesn't
    // leave someone locked out up to an hour past when it actually expired.
    cron.schedule('* * * * *', () => {
      void expireBans(prisma, logger).catch((err: unknown) => {
        cronJobFailures.labels('expireBans').inc();
        logger.error({ err, job: 'expireBans' }, 'Cron job error: expireBans failed');
      });
    }),

    // Hourly, offset by 30 minutes - cleans up games orphaned by a crashed/redeployed process.
    cron.schedule('30 * * * *', () => {
      cronJobRuns.labels('purgeStaleGames').inc();
      logger.info({ job: 'purgeStaleGames', schedule: '30 * * * *' }, 'Cron triggered: stale game purge starting');
      void purgeStaleGames(prisma, logger).catch((err: unknown) => {
        cronJobFailures.labels('purgeStaleGames').inc();
        logger.error({ err, job: 'purgeStaleGames' }, 'Cron job error: purgeStaleGames failed');
      });
    }),
  ];

  logger.info(
    { jobs: tasks.length, schedules: ['5 0 * * * (daily stats)', '* * * * * (ban expiry)', '30 * * * * (stale games)'] },
    'Cron jobs registered and running',
  );

  return () => {
    logger.info('Stopping all cron jobs...');
    for (const task of tasks) task.stop();
    logger.info('All cron jobs stopped');
  };
}
