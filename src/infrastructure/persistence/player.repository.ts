import type { PrismaClient } from '@prisma/client';
import { getRankForPoints, type RankTier } from '../../domain/scoring/rank.js';

export interface PlayerUpsertData {
  username?: string | null;
  displayName?: string | null;
  languageCode?: string | null;
}

/**
 * Cumulative Telegram Stars thresholds unlocking each donation tier - mirrors the original's
 * donation levels (`InlineCommand.cs`/`Extensions.cs`): 10 unlocks the custom gif pack feature,
 * 50 and 100 are cosmetic badge tiers only. Index in this array + 1 is the resulting level.
 */
export const DONATION_TIERS: readonly number[] = [10, 50, 100];

export function donationLevelForTotal(totalStars: number): number {
  let level = 0;
  for (const threshold of DONATION_TIERS) {
    if (totalStars >= threshold) level += 1;
  }
  return level;
}

/**
 * Port of `Extensions.cs`'s `GetName()` badge suffix: a medal for whichever donation tier a
 * player has reached (🥉 10+, 🥈 50+, 🥇 100+ stars), or `''` below the first tier. A leading
 * space is included so callers can just append it to a name.
 */
export function donorBadge(donationLevel: number): string {
  if (donationLevel >= 3) return ' 🥇';
  if (donationLevel >= 2) return ' 🥈';
  if (donationLevel >= 1) return ' 🥉';
  return '';
}

export interface RecordDonationResult {
  totalStars: number;
  level: number;
  leveledUp: boolean;
}

/** Wraps the `players` table - one row per Telegram user who has ever interacted with the bot. */
export class PlayerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(telegramId: bigint, data: PlayerUpsertData = {}) {
    return this.prisma.player.upsert({
      where: { telegramId },
      create: { telegramId, ...data },
      update: { ...data },
    });
  }

  async findByTelegramId(telegramId: bigint) {
    return this.prisma.player.findUnique({ where: { telegramId } });
  }

  /** Resolves an `@mention` entity (which only gives a username, not an id) to a known player. */
  async findByUsername(username: string) {
    return this.prisma.player.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } });
  }

  async markHasStartedPm(telegramId: bigint): Promise<void> {
    await this.prisma.player.update({ where: { telegramId }, data: { hasStartedPm: true } });
  }

  async setLanguage(telegramId: bigint, languageCode: string): Promise<void> {
    await this.prisma.player.update({ where: { telegramId }, data: { languageCode } });
  }

  async isBanned(telegramId: bigint): Promise<boolean> {
    const player = await this.prisma.player.findUnique({ where: { telegramId }, select: { isBanned: true } });
    return player?.isBanned ?? false;
  }

  /** Adds `stars` to the player's lifetime total and recomputes their donation tier from it. */
  async recordDonation(telegramId: bigint, stars: number): Promise<RecordDonationResult> {
    const before = await this.prisma.player.findUnique({ where: { telegramId }, select: { donationLevel: true } });
    const updated = await this.prisma.player.update({
      where: { telegramId },
      data: { totalDonatedStars: { increment: stars } },
    });
    const level = donationLevelForTotal(updated.totalDonatedStars);
    if (level !== updated.donationLevel) {
      await this.prisma.player.update({ where: { telegramId }, data: { donationLevel: level } });
    }
    return { totalStars: updated.totalDonatedStars, level, leveledUp: level > (before?.donationLevel ?? 0) };
  }

  /** `/adddonation` dev override: sets a player's lifetime total (and recomputed level) directly. */
  async setDonatedTotal(telegramId: bigint, totalStars: number): Promise<RecordDonationResult> {
    const level = donationLevelForTotal(totalStars);
    await this.prisma.player.update({ where: { telegramId }, data: { totalDonatedStars: totalStars, donationLevel: level } });
    return { totalStars, level, leveledUp: false };
  }

  /**
   * Records an AFK strike for a player. On the 3rd strike, resets strike count and suspends
   * the player for 24 hours.
   */
  async recordAfkStrike(telegramId: bigint): Promise<{ afkCount: number; isSuspended: boolean; suspendedUntil: Date | null }> {
    const player = await this.upsert(telegramId);
    const newCount = player.afkCount + 1;
    if (newCount >= 3) {
      const suspendedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await this.prisma.player.update({
        where: { telegramId },
        data: { afkCount: 0, suspendedUntil },
      });
      return { afkCount: 3, isSuspended: true, suspendedUntil };
    } else {
      await this.prisma.player.update({
        where: { telegramId },
        data: { afkCount: newCount },
      });
      return { afkCount: newCount, isSuspended: false, suspendedUntil: player.suspendedUntil };
    }
  }

  /** Checks whether the player is currently suspended from joining games (24h AFK ban). */
  async checkSuspension(telegramId: bigint): Promise<{ isSuspended: boolean; suspendedUntil: Date | null }> {
    const player = await this.prisma.player.findUnique({
      where: { telegramId },
      select: { suspendedUntil: true },
    });
    if (!player?.suspendedUntil) return { isSuspended: false, suspendedUntil: null };
    const isSuspended = player.suspendedUntil.getTime() > Date.now();
    return { isSuspended, suspendedUntil: isSuspended ? player.suspendedUntil : null };
  }

  /** Resets AFK strike count to 0. */
  async clearAfkStrikes(telegramId: bigint): Promise<void> {
    await this.prisma.player.update({ where: { telegramId }, data: { afkCount: 0 } });
  }

  /** Awards leaderboard points and records game stats. Returns promotion info if rank leveled up. */
  async awardPoints(
    telegramId: bigint,
    deltaPoints: number,
    won: boolean,
  ): Promise<{ oldPoints: number; newPoints: number; oldRank: RankTier; newRank: RankTier; promoted: boolean }> {
    await this.upsert(telegramId);
    const existing = await this.findByTelegramId(telegramId);
    const oldPoints = existing?.points ?? 0;
    const oldRank = getRankForPoints(oldPoints);

    const updated = await this.prisma.player.update({
      where: { telegramId },
      data: {
        points: { increment: deltaPoints },
        gamesPlayed: { increment: 1 },
        ...(won ? { gamesWon: { increment: 1 } } : {}),
      },
    });

    const newPoints = updated.points;
    const newRank = getRankForPoints(newPoints);
    const promoted = newRank.level > oldRank.level;

    return { oldPoints, newPoints, oldRank, newRank, promoted };
  }

  /** Returns top ranked players ordered by points descending. */
  async getTopPlayers(limit = 10) {
    return this.prisma.player.findMany({
      take: limit,
      orderBy: [{ points: 'desc' }, { gamesWon: 'desc' }],
      select: {
        id: true,
        telegramId: true,
        username: true,
        displayName: true,
        points: true,
        gamesPlayed: true,
        gamesWon: true,
        donationLevel: true,
      },
    });
  }

  /** Finds a player's global leaderboard rank. */
  async getPlayerRank(telegramId: bigint): Promise<{ rank: number; points: number; gamesPlayed: number; gamesWon: number } | null> {
    const target = await this.prisma.player.findUnique({
      where: { telegramId },
      select: { points: true, gamesPlayed: true, gamesWon: true },
    });
    if (!target) return null;

    const higherCount = await this.prisma.player.count({
      where: { points: { gt: target.points } },
    });
    return {
      rank: higherCount + 1,
      points: target.points,
      gamesPlayed: target.gamesPlayed,
      gamesWon: target.gamesWon,
    };
  }
}

