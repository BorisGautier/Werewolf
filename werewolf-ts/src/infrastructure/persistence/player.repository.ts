import type { PrismaClient } from '@prisma/client';

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
}
