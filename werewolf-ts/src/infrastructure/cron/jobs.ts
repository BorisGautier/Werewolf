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

/**
 * Rolls up yesterday's finished games into one `DailyStat` row per group
 * (plus one group-less row for the whole-bot total), mirroring the
 * original's daily counts. Idempotent - safe to re-run for the same day.
 */
export async function rotateDailyStats(prisma: PrismaClient, logger: Logger): Promise<void> {
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

  const existingOverall = await prisma.dailyStat.findFirst({ where: { date: dayStart, groupId: null } });
  if (existingOverall) {
    await prisma.dailyStat.update({
      where: { id: existingOverall.id },
      data: { gamesPlayed: overall.games, playersSeen: overall.players.size },
    });
  } else {
    await prisma.dailyStat.create({
      data: { date: dayStart, groupId: null, gamesPlayed: overall.games, playersSeen: overall.players.size },
    });
  }

  for (const [groupId, bucket] of byGroup) {
    await prisma.dailyStat.upsert({
      where: { date_groupId: { date: dayStart, groupId } },
      create: { date: dayStart, groupId, gamesPlayed: bucket.games, playersSeen: bucket.players.size },
      update: { gamesPlayed: bucket.games, playersSeen: bucket.players.size },
    });
  }

  logger.info({ date: dayStart.toISOString(), groups: byGroup.size, games: overall.games }, 'Rotated daily stats');
}

/**
 * Lifts a player's ban once every `GlobalBan` row that applied to them has expired. A manual ban
 * with no `expiresAt` never expires on its own (mirrors the original treating `null` as permanent).
 */
export async function expireBans(prisma: PrismaClient, logger: Logger): Promise<void> {
  const now = new Date();
  const expired = await prisma.globalBan.findMany({
    where: { expiresAt: { lt: now } },
    select: { telegramId: true },
    distinct: ['telegramId'],
  });

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
  }

  if (lifted > 0) logger.info({ lifted }, 'Lifted expired bans');
}

/**
 * Marks games abandoned if they never got a proper `endedAt` (the bot process that was running
 * them crashed or was redeployed mid-game) - "purge dead games" from the original task list. Only
 * touches rows old enough that they couldn't possibly still be a legitimately long-running game.
 */
export async function purgeStaleGames(prisma: PrismaClient, logger: Logger, maxAgeHours = 12): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const result = await prisma.game.updateMany({
    where: { endedAt: null, startedAt: { lt: cutoff } },
    data: { endedAt: new Date() },
  });
  if (result.count > 0) logger.info({ purged: result.count, maxAgeHours }, 'Purged stale unfinished games');
}
