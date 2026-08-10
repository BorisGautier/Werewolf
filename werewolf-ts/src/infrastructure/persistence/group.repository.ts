import type { Group, GroupDisabledRole, PrismaClient } from '@prisma/client';
import { ROLE_BIT, ROLE_VALID, type RoleFlags } from '../../domain/roles/role.js';
import type { GameMode } from '../../domain/game/game-mode.js';

export type GroupWithConfig = Group & { disabledRoles: GroupDisabledRole[] };

/** Wraps the `groups` table (per-Telegram-group config) and its `group_disabled_roles` join table. */
export class GroupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreate(telegramId: bigint, title?: string | null, username?: string | null): Promise<GroupWithConfig> {
    const titleValue = title ?? null;
    const usernameValue = username ?? null;
    return this.prisma.group.upsert({
      where: { telegramId },
      create: { telegramId, title: titleValue, username: usernameValue },
      update: { title: titleValue, username: usernameValue, botInGroup: true },
      include: { disabledRoles: true },
    });
  }

  async findByTelegramId(telegramId: bigint): Promise<GroupWithConfig | null> {
    return this.prisma.group.findUnique({ where: { telegramId }, include: { disabledRoles: true } });
  }

  async updateConfig(telegramId: bigint, data: Partial<Group>): Promise<void> {
    await this.prisma.group.update({ where: { telegramId }, data });
  }

  async setRoleDisabled(groupId: number, role: GroupDisabledRole['role'], disabled: boolean): Promise<void> {
    if (disabled) {
      await this.prisma.groupDisabledRole.upsert({
        where: { groupId_role: { groupId, role } },
        create: { groupId, role },
        update: {},
      });
    } else {
      await this.prisma.groupDisabledRole.deleteMany({ where: { groupId, role } });
    }
  }

  async markBotLeft(telegramId: bigint): Promise<void> {
    await this.prisma.group.update({ where: { telegramId }, data: { botInGroup: false } });
  }
}

/** The `Game` construction options a `GroupWithConfig` maps to (mode/timers are read separately per call site). */
export interface GroupGameOptions {
  disabledRoleFlags: RoleFlags;
  burningOverkill: boolean;
  thiefFull: boolean;
  maxPlayers: number;
}

export function groupToGameOptions(group: GroupWithConfig): GroupGameOptions {
  let disabledRoleFlags: RoleFlags = ROLE_VALID;
  for (const { role } of group.disabledRoles) {
    disabledRoleFlags |= ROLE_BIT[role];
  }
  if (!group.allowTanner) disabledRoleFlags |= ROLE_BIT.Tanner;
  if (!group.allowFool) disabledRoleFlags |= ROLE_BIT.Fool;
  if (!group.allowCult) disabledRoleFlags |= ROLE_BIT.Cultist;
  if (!group.allowThief) disabledRoleFlags |= ROLE_BIT.Thief;
  if (!group.allowArsonist) disabledRoleFlags |= ROLE_BIT.Arsonist;

  return {
    disabledRoleFlags,
    burningOverkill: group.burningOverkill,
    thiefFull: group.thiefFull,
    maxPlayers: group.maxPlayers,
  };
}

export function gameModeToDomain(mode: Group['mode']): GameMode {
  return mode === 'CHAOS' ? 'Chaos' : 'Normal';
}
