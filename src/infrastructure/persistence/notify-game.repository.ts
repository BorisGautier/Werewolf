import type { PrismaClient } from '@prisma/client';

/**
 * Wraps `notify_games` - the `/nextgame` waitlist. `groupId` here is the group's Telegram chat
 * id (not the `Group` table's own `id`), mirroring the original's raw `GroupId` column.
 */
export class NotifyGameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Returns false (no-op) if this user was already waiting for this group. */
  async add(userId: bigint, groupTelegramId: bigint): Promise<boolean> {
    const existing = await this.prisma.notifyGame.findUnique({
      where: { userId_groupId: { userId, groupId: groupTelegramId } },
    });
    if (existing) return false;
    await this.prisma.notifyGame.create({ data: { userId, groupId: groupTelegramId } });
    return true;
  }

  /** Returns false if this user wasn't on the waitlist to begin with. */
  async remove(userId: bigint, groupTelegramId: bigint): Promise<boolean> {
    const result = await this.prisma.notifyGame.deleteMany({ where: { userId, groupId: groupTelegramId } });
    return result.count > 0;
  }

  async listWaiting(groupTelegramId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.notifyGame.findMany({
      where: { groupId: groupTelegramId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** Called once a lobby actually locks in and deals roles - mirrors `Werewolf.cs`'s cleanup. */
  async clearForGroup(groupTelegramId: bigint): Promise<void> {
    await this.prisma.notifyGame.deleteMany({ where: { groupId: groupTelegramId } });
  }
}
