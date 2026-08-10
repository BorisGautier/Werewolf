import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../logging/logger.js';
import { expireBans, purgeStaleGames, rotateDailyStats } from './jobs.js';

/** Starts the bot's background maintenance jobs. Returns a function that stops them all. */
export function startCronJobs(prisma: PrismaClient, logger: Logger): () => void {
  const tasks = [
    // Once a day, just after midnight UTC - rolls up the day that just ended.
    cron.schedule('5 0 * * *', () => {
      void rotateDailyStats(prisma, logger).catch((err: unknown) => logger.error({ err }, 'rotateDailyStats failed'));
    }),
    // Hourly - lifts temp bans as soon as they expire.
    cron.schedule('0 * * * *', () => {
      void expireBans(prisma, logger).catch((err: unknown) => logger.error({ err }, 'expireBans failed'));
    }),
    // Hourly, offset by 30 minutes - cleans up games orphaned by a crashed/redeployed process.
    cron.schedule('30 * * * *', () => {
      void purgeStaleGames(prisma, logger).catch((err: unknown) => logger.error({ err }, 'purgeStaleGames failed'));
    }),
  ];

  logger.info({ jobs: tasks.length }, 'Cron jobs started');
  return () => {
    for (const task of tasks) task.stop();
  };
}
