import type { PrismaClient } from '@prisma/client';

export interface PlayerUpsertData {
  username?: string | null;
  displayName?: string | null;
  languageCode?: string | null;
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
}
