/**
 * Port of the maintenance work `StatsRotation/Program.cs` and the original's
 * scattered ban-expiry/game-cleanup logic used to do as separate always-on
 * processes. Consolidated into three plain, individually-testable functions
 * here; `scheduler.ts` is what actually runs them on a schedule.
 *
 * Deliberately NOT ported: the original's website-backed GlobalStats/
 * GroupStats tables (best survivor, most-killed-first-night, ...) - those
 * fed a companion stats website (tgwerewolf.com) that's out of scope for
 * this migration (see README). `DailyStat` here is a simpler local rollup
 * instead - just enough for an operator to see usage trends.
 */

import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../logging/logger.js';
import type { Env } from '../config/env.js';
import { DailySummaryNotifier } from '../notifications/daily-summary.js';
import { DatabaseBackupManager } from '../persistence/db-backup.js';
import {
  bansExpired,
  cronJobDuration,
  cronJobFailures,
  cronJobRuns,
  dailyStatsRotations,
  gamesAbandoned,
} from '../monitoring/metrics.js';

/**
 * Rolls up yesterday's finished games into one `DailyStat` row per group
 * (plus one group-less row for the whole-bot total), mirroring the
 * original's daily counts. Idempotent - safe to re-run for the same day.
 */
export async function rotateDailyStats(
  prisma: PrismaClient,
  logger: Logger,
  env?: Env,
): Promise<void> {
  const jobName = 'rotateDailyStats';
  const startTime = Date.now();
  cronJobRuns.labels(jobName).inc();

  logger.debug({ job: jobName }, 'Cron job starting: rotate daily stats');

  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const finishedYesterday = await prisma.game.findMany({
      where: { endedAt: { gte: dayStart, lt: dayEnd } },
      select: { groupId: true, players: { select: { playerId: true } } },
    });

    const byGroup = new Map<number, { games: number; players: Set<number> }>();
    const overall = { games: 0, players: new Set<number>() };
    for (const game of finishedYesterday) {
      overall.games++;
      for (const p of game.players) overall.players.add(p.playerId);

      const bucket = byGroup.get(game.groupId) ?? { games: 0, players: new Set<number>() };
      bucket.games++;
      for (const p of game.players) bucket.players.add(p.playerId);
      byGroup.set(game.groupId, bucket);
    }

    const existingOverall = await prisma.dailyStat.findFirst({
      where: { date: dayStart, groupId: null },
    });
    if (existingOverall) {
      await prisma.dailyStat.update({
        where: { id: existingOverall.id },
        data: { gamesPlayed: overall.games, playersSeen: overall.players.size },
      });
    } else {
      await prisma.dailyStat.create({
        data: {
          date: dayStart,
          groupId: null,
          gamesPlayed: overall.games,
          playersSeen: overall.players.size,
        },
      });
    }

    for (const [groupId, bucket] of byGroup) {
      await prisma.dailyStat.upsert({
        where: { date_groupId: { date: dayStart, groupId } },
        create: {
          date: dayStart,
          groupId,
          gamesPlayed: bucket.games,
          playersSeen: bucket.players.size,
        },
        update: { gamesPlayed: bucket.games, playersSeen: bucket.players.size },
      });
    }

    const elapsed = Date.now() - startTime;
    cronJobDuration.labels(jobName).observe(elapsed / 1000);
    dailyStatsRotations.inc();

    if (env) {
      const summaryNotifier = new DailySummaryNotifier(prisma, env, logger);
      void summaryNotifier.generateAndSendDailySummary().catch((err) => {
        logger.error({ err }, 'Failed to dispatch daily summary notification');
      });
    }

    logger.info(
      {
        job: jobName,
        date: dayStart.toISOString(),
        groups: byGroup.size,
        games: overall.games,
        uniquePlayers: overall.players.size,
        elapsedMs: elapsed,
      },
      'Cron job completed: daily stats rotated successfully',
    );
  } catch (err) {
    const elapsed = Date.now() - startTime;
    cronJobFailures.labels(jobName).inc();
    cronJobDuration.labels(jobName).observe(elapsed / 1000);
    logger.error({ err, job: jobName, elapsedMs: elapsed }, 'Cron job failed: rotateDailyStats');
    throw err;
  }
}

/**
 * Lifts a player's ban once every `GlobalBan` row that applied to them has expired. A manual ban
 * with no `expiresAt` never expires on its own (mirrors the original treating `null` as permanent).
 */
export async function expireBans(prisma: PrismaClient, logger: Logger): Promise<void> {
  const jobName = 'expireBans';
  const startTime = Date.now();
  cronJobRuns.labels(jobName).inc();

  try {
    const now = new Date();
    const expired = await prisma.globalBan.findMany({
      where: { expiresAt: { lt: now } },
      select: { telegramId: true },
      distinct: ['telegramId'],
    });

    if (expired.length > 0) {
      logger.debug(
        { job: jobName, candidates: expired.length },
        'Checking expired bans for candidates',
      );
    }

    let lifted = 0;
    for (const { telegramId } of expired) {
      const stillBanned = await prisma.globalBan.findFirst({
        where: { telegramId, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      });
      if (stillBanned) continue;

      const result = await prisma.player.updateMany({
        where: { telegramId, isBanned: true },
        data: { isBanned: false, banReason: null },
      });
      lifted += result.count;

      if (result.count > 0) {
        logger.info(
          { telegramId: telegramId.toString(), job: jobName },
          'Player ban lifted after expiry',
        );
      }
    }

    const elapsed = Date.now() - startTime;
    cronJobDuration.labels(jobName).observe(elapsed / 1000);

    if (lifted > 0) {
      bansExpired.inc(lifted);
      logger.info(
        { lifted, job: jobName, elapsedMs: elapsed },
        'Cron job: expired bans lifted successfully',
      );
    } else {
      logger.debug(
        { job: jobName, elapsedMs: elapsed, candidates: expired.length },
        'Cron job: no bans to lift',
      );
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    cronJobFailures.labels(jobName).inc();
    cronJobDuration.labels(jobName).observe(elapsed / 1000);
    logger.error({ err, job: jobName, elapsedMs: elapsed }, 'Cron job failed: expireBans');
    throw err;
  }
}

/**
 * Marks games abandoned if they never got a proper `endedAt` (the bot process that was running
 * them crashed or was redeployed mid-game) - "purge dead games" from the original task list. Only
 * touches rows old enough that they couldn't possibly still be a legitimately long-running game.
 */
export async function purgeStaleGames(
  prisma: PrismaClient,
  logger: Logger,
  maxAgeHours = 12,
): Promise<void> {
  const jobName = 'purgeStaleGames';
  const startTime = Date.now();
  cronJobRuns.labels(jobName).inc();

  logger.debug({ job: jobName, maxAgeHours }, 'Cron job starting: purge stale games');

  try {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    const result = await prisma.game.updateMany({
      where: { endedAt: null, startedAt: { lt: cutoff } },
      data: { endedAt: new Date() },
    });

    const elapsed = Date.now() - startTime;
    cronJobDuration.labels(jobName).observe(elapsed / 1000);

    if (result.count > 0) {
      gamesAbandoned.inc(result.count);
      logger.warn(
        {
          job: jobName,
          purged: result.count,
          maxAgeHours,
          cutoff: cutoff.toISOString(),
          elapsedMs: elapsed,
        },
        'Cron job: stale abandoned games purged — these games likely crashed mid-session',
      );
    } else {
      logger.debug(
        { job: jobName, maxAgeHours, elapsedMs: elapsed },
        'Cron job: no stale games found',
      );
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    cronJobFailures.labels(jobName).inc();
    cronJobDuration.labels(jobName).observe(elapsed / 1000);
    logger.error({ err, job: jobName, elapsedMs: elapsed }, 'Cron job failed: purgeStaleGames');
    throw err;
  }
}

/**
 * Creates a daily PostgreSQL database backup with 15-day retention.
 */
export async function runDailyDatabaseBackup(logger: Logger): Promise<void> {
  const jobName = 'runDailyDatabaseBackup';
  const startTime = Date.now();
  cronJobRuns.labels(jobName).inc();
  logger.info({ job: jobName }, 'Cron job starting: daily database backup');

  try {
    const backupManager = new DatabaseBackupManager({ logger, retentionDays: 15 });
    const backup = await backupManager.createBackup();
    const elapsed = Date.now() - startTime;
    cronJobDuration.labels(jobName).observe(elapsed / 1000);
    logger.info(
      { job: jobName, filename: backup.filename, sizeBytes: backup.sizeBytes, elapsedMs: elapsed },
      'Cron job finished: daily database backup completed',
    );
  } catch (err) {
    const elapsed = Date.now() - startTime;
    cronJobFailures.labels(jobName).inc();
    cronJobDuration.labels(jobName).observe(elapsed / 1000);
    logger.error(
      { err, job: jobName, elapsedMs: elapsed },
      'Cron job failed: runDailyDatabaseBackup',
    );
  }
}
