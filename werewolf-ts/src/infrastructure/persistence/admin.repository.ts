import type { PrismaClient } from '@prisma/client';

export interface BanRecord {
  telegramId: bigint;
  reason: string;
  bannedBy: bigint | null;
  bannedAt: Date;
  expiresAt: Date | null;
  playerName: string | null;
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

  /**
   * Creates the ban record and marks the player banned, creating a stub `Player` row if this
   * telegramId has never interacted with the bot before (mirrors the original always being able
   * to ban an id it's never seen, e.g. from a raw numeric arg).
   */
  async ban(telegramId: bigint, reason: string, bannedBy: bigint, expiresAt: Date | null = null): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.globalBan.create({ data: { telegramId, reason, bannedBy, expiresAt } }),
      this.prisma.player.upsert({
        where: { telegramId },
        create: { telegramId, isBanned: true, banReason: reason, bannedBy },
        update: { isBanned: true, banReason: reason, bannedBy },
      }),
    ]);
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
  player: { displayName: string | null } | null;
}

function toBanRecord(ban: BanRow): BanRecord {
  return {
    telegramId: ban.telegramId,
    reason: ban.reason,
    bannedBy: ban.bannedBy,
    bannedAt: ban.bannedAt,
    expiresAt: ban.expiresAt,
    playerName: ban.player?.displayName ?? null,
  };
}
