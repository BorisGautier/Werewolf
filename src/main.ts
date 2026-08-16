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
import { AlertService } from './infrastructure/monitoring/alert-service.js';
import {
  startMetricsServer,
  stopMetricsServer,
  botUptime,
} from './infrastructure/monitoring/metrics.js';
import { AdminServer } from './infrastructure/web/admin-server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  logger.info(
    {
      nodeEnv: env.nodeEnv,
      logLevel: env.logLevel,
      version: '0.1.0',
      pid: process.pid,
    },
    'Starting Werewolf Bot',
  );

  // ── Prometheus metrics server ───────────────────────────────────────────────
  const metricsPort = parseInt(process.env.METRICS_PORT ?? '9090', 10);
  startMetricsServer(logger, metricsPort);

  // ── Database connection ─────────────────────────────────────────────────────
  logger.info('Connecting to database...');
  const prisma = getPrismaClient();
  try {
    await prisma.$connect();
    logger.info(
      { databaseUrl: env.databaseUrl.replace(/:[^:@]+@/, ':***@') },
      'Connected to database successfully',
    );
  } catch (err) {
    logger.error({ err }, 'Failed to connect to database — aborting startup');
    process.exit(1);
  }

  // ── i18n ────────────────────────────────────────────────────────────────────
  logger.info('Loading locales...');
  const locales = await loadLocales();
  const translator = new Translator(locales, getDefaultLocale(locales));
  logger.info({ locales: Object.keys(locales) }, 'Locales loaded');

  // ── Achievements catalog seed ───────────────────────────────────────────────
  logger.info('Seeding achievement catalog...');
  const achievementRepository = new AchievementRepository(prisma);
  await achievementRepository.seed();
  logger.info('Achievement catalog seeded successfully');

  // ── Bot creation ────────────────────────────────────────────────────────────
  logger.info('Creating Telegram bot...');
  const gameManager = new GameManager();
  const maintenance = { on: false };
  const bot = createBot(env, logger, {
    translator,
    gameManager,
    groupRepository: new GroupRepository(prisma),
    playerRepository: new PlayerRepository(prisma),
    gameRepository: new GameRepository(prisma),
    adminRepository: new AdminRepository(prisma),
    notifyGameRepository: new NotifyGameRepository(prisma),
    achievementRepository,
    gifPackRepository: new GifPackRepository(prisma),
    prisma,
    maintenance,
  });

  // ── Admin Web Dashboard Server ──────────────────────────────────────────────
  const adminServer = new AdminServer({ prisma, gameManager, logger, bot, maintenance });
  await adminServer.start();

  // ── Bot initialization ──────────────────────────────────────────────────────
  logger.info('Initializing Telegram bot...');
  try {
    await bot.init();
    logger.info(
      {
        username: bot.botInfo.username,
        id: bot.botInfo.id,
        firstName: bot.botInfo.first_name,
      },
      'Bot initialized successfully',
    );
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Telegram bot (check BOT_TOKEN or network)');
    throw err;
  }

  // ── Error monitoring ────────────────────────────────────────────────────────
  const alertService = new AlertService(bot, env, logger);

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise rejection');
    alertService.handleBotError(reason, 'unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception in main process');
    alertService.handleBotError(err, 'uncaughtException');
  });

  // ── Cron jobs ───────────────────────────────────────────────────────────────
  logger.info('Starting background cron jobs...');
  const runner = run(bot);
  const stopCronJobs = startCronJobs(prisma, logger, env);
  logger.info('Background cron jobs started');

  // ── Uptime metric heartbeat ─────────────────────────────────────────────────
  botUptime.set(0);

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.warn({ signal }, 'Shutdown signal received — initiating graceful shutdown...');
    await adminServer.stop();
    stopCronJobs();
    stopMetricsServer();
    if (runner.isRunning()) {
      logger.info('Stopping grammY runner...');
      await runner.stop();
    }
    logger.info('Disconnecting from database...');
    await disconnectPrisma();
    logger.info({ signal }, 'Graceful shutdown complete');
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info(
    {
      username: bot.botInfo.username,
      metricsUrl: `http://localhost:${metricsPort}/metrics`,
      healthUrl: `http://localhost:${metricsPort}/health`,
    },
    'werewolf-ts is running (long polling)',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during startup', err);
  process.exit(1);
});
