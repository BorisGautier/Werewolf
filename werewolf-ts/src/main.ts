import 'dotenv/config';
import { run } from '@grammyjs/runner';
import { GameManager } from './application/game-manager.js';
import { loadEnv } from './infrastructure/config/env.js';
import { getDefaultLocale, loadLocales } from './infrastructure/i18n/locale-loader.js';
import { Translator } from './infrastructure/i18n/translator.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { AchievementRepository } from './infrastructure/persistence/achievement.repository.js';
import { AdminRepository } from './infrastructure/persistence/admin.repository.js';
import { GameRepository } from './infrastructure/persistence/game.repository.js';
import { GifPackRepository } from './infrastructure/persistence/gif-pack.repository.js';
import { GroupRepository } from './infrastructure/persistence/group.repository.js';
import { NotifyGameRepository } from './infrastructure/persistence/notify-game.repository.js';
import { PlayerRepository } from './infrastructure/persistence/player.repository.js';
import { createBot } from './infrastructure/telegram/bot.js';
import { disconnectPrisma, getPrismaClient } from './infrastructure/persistence/prisma-client.js';
import { startCronJobs } from './infrastructure/cron/scheduler.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  // Fail fast if the DB is unreachable rather than starting the bot half-broken.
  const prisma = getPrismaClient();
  await prisma.$connect();
  logger.info('Connected to database');

  const locales = await loadLocales();
  const translator = new Translator(locales, getDefaultLocale(locales));

  const achievementRepository = new AchievementRepository(prisma);
  await achievementRepository.seed();
  logger.info('Achievement catalog seeded');

  const bot = createBot(env, logger, {
    translator,
    gameManager: new GameManager(),
    groupRepository: new GroupRepository(prisma),
    playerRepository: new PlayerRepository(prisma),
    gameRepository: new GameRepository(prisma),
    adminRepository: new AdminRepository(prisma),
    notifyGameRepository: new NotifyGameRepository(prisma),
    achievementRepository,
    gifPackRepository: new GifPackRepository(prisma),
  });
  await bot.init();
  logger.info({ username: bot.botInfo.username }, 'Bot initialized');

  const runner = run(bot);
  const stopCronJobs = startCronJobs(prisma, logger);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    stopCronJobs();
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
