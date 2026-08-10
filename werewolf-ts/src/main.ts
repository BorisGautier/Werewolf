import 'dotenv/config';
import { run } from '@grammyjs/runner';
import { loadEnv } from './infrastructure/config/env.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { createBot } from './infrastructure/telegram/bot.js';
import { disconnectPrisma, getPrismaClient } from './infrastructure/persistence/prisma-client.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  // Fail fast if the DB is unreachable rather than starting the bot half-broken.
  const prisma = getPrismaClient();
  await prisma.$connect();
  logger.info('Connected to database');

  const bot = createBot(env, logger);
  await bot.init();
  logger.info({ username: bot.botInfo.username }, 'Bot initialized');

  const runner = run(bot);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    if (runner.isRunning()) await runner.stop();
    await disconnectPrisma();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('werewolf-ts is running (long polling)');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during startup', err);
  process.exit(1);
});
