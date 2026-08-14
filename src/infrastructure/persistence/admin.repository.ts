import type { BanScope, PrismaClient } from '@prisma/client';

/** Mirrors the original's escalating temp-ban durations (`SpamDetection`'s `switch (count)`): 12h,
 * 1 day, 3 days, then permanent from the 4th spam ban onward. `null` means permanent. */
const SPAM_BAN_DURATIONS_MS: readonly (number | null)[] = [
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
];

export interface SpamBanResult {
  expiresAt: Date | null;
  tempBanCount: number;
}

export interface BanRecord {
  telegramId: bigint;
  reason: string;
  bannedBy: bigint | null;
  bannedAt: Date;
  expiresAt: Date | null;
  playerName: string | null;
  scope: BanScope;
  /** The banned player's own `createdAt` (first time they ever interacted with the bot) - mirrors
   * the original's `/getban` "Player first seen" line. `null` for an id the bot has never seen
   * outside of this ban (e.g. banned by raw numeric id, no stub `Player` row created). */
  firstSeen: Date | null;
}

/**
 * Wraps `admin_users` (the original's hardcoded Devs/LangAdmins arrays + `Admin` table, unified
 * here into one table) and `global_bans` (`/permban`, `/remban`, `/getbans`, `/getban`).
 */
export class AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** GlobalAdminOnly commands accept either a DEV or a GLOBAL_ADMIN grant. */
  async isGlobalAdmin(telegramId: bigint): Promise<boolean> {
    const grant = await this.prisma.adminUser.findFirst({
      where: { telegramId, role: { in: ['DEV', 'GLOBAL_ADMIN'] } },
    });
    return grant !== null;
  }

  /** List all admin Telegram IDs (DEV and GLOBAL_ADMIN) to send report alerts. */
  async listGlobalAdminIds(): Promise<bigint[]> {
    const admins = await this.prisma.adminUser.findMany({
      where: { role: { in: ['DEV', 'GLOBAL_ADMIN'] } },
      select: { telegramId: true },
    });
    return admins.map((a) => a.telegramId);
  }

  /**
   * Creates the ban record and marks the player banned, creating a stub `Player` row if this
   * telegramId has never interacted with the bot before (mirrors the original always being able
   * to ban an id it's never seen, e.g. from a raw numeric arg). `bannedBy` is `null` for bans with
   * no human admin behind them (e.g. the automated spam guard).
   */
  async ban(
    telegramId: bigint,
    reason: string,
    bannedBy: bigint | null,
    expiresAt: Date | null = null,
    scope: BanScope = 'MANUAL',
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.globalBan.create({ data: { telegramId, reason, bannedBy, expiresAt, scope } }),
      this.prisma.player.upsert({
        where: { telegramId },
        create: { telegramId, isBanned: true, banReason: reason, bannedBy },
        update: { isBanned: true, banReason: reason, bannedBy },
      }),
    ]);
  }

  /**
   * Bans a player caught flooding the bot with commands (`SpamGuard`, wired into `bot.ts`) with an
   * escalating duration keyed off their persisted `tempBanCount` - mirrors `SpamDetection`'s
   * `switch (count)` in the original (12h / 1 day / 3 days / permanent from the 4th ban on).
   */
  async banForSpam(telegramId: bigint): Promise<SpamBanResult> {
    const player = await this.prisma.player.upsert({
      where: { telegramId },
      create: { telegramId, tempBanCount: 1 },
      update: { tempBanCount: { increment: 1 } },
      select: { tempBanCount: true },
    });
    const durationMs = SPAM_BAN_DURATIONS_MS[player.tempBanCount - 1] ?? null;
    const expiresAt = durationMs === null ? null : new Date(Date.now() + durationMs);
    await this.ban(telegramId, 'Spam / Flood', null, expiresAt, 'SPAM');
    return { expiresAt, tempBanCount: player.tempBanCount };
  }

  /** Returns false if the player had no ban record to remove. */
  async unban(telegramId: bigint): Promise<boolean> {
    const result = await this.prisma.globalBan.deleteMany({ where: { telegramId } });
    if (result.count === 0) return false;
    await this.prisma.player.updateMany({ where: { telegramId }, data: { isBanned: false, banReason: null } });
    return true;
  }

  async listActiveBans(): Promise<BanRecord[]> {
    const bans = await this.prisma.globalBan.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { player: true },
      orderBy: { bannedAt: 'desc' },
    });
    return bans.map(toBanRecord);
  }

  async getBan(telegramId: bigint): Promise<BanRecord | null> {
    const ban = await this.prisma.globalBan.findFirst({
      where: { telegramId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { player: true },
      orderBy: { bannedAt: 'desc' },
    });
    return ban ? toBanRecord(ban) : null;
  }
}

interface BanRow {
  telegramId: bigint;
  reason: string;
  bannedBy: bigint | null;
  bannedAt: Date;
  expiresAt: Date | null;
  scope: BanScope;
  player: { displayName: string | null; createdAt: Date } | null;
}

function toBanRecord(ban: BanRow): BanRecord {
  return {
    telegramId: ban.telegramId,
    reason: ban.reason,
    bannedBy: ban.bannedBy,
    bannedAt: ban.bannedAt,
    expiresAt: ban.expiresAt,
    playerName: ban.player?.displayName ?? null,
    scope: ban.scope,
    firstSeen: ban.player?.createdAt ?? null,
  };
}
