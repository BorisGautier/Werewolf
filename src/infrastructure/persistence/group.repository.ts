import type { Group, GroupDisabledRole, PrismaClient } from '@prisma/client';
import { ROLE_BIT, ROLE_VALID, type RoleFlags } from '../../domain/roles/role.js';
import type { GameMode } from '../../domain/game/game-mode.js';
import { activeGroups, totalGroupsSeen } from '../monitoring/metrics.js';

export type GroupWithConfig = Group & { disabledRoles: GroupDisabledRole[] };

/** Wraps the `groups` table (per-Telegram-group config) and its `group_disabled_roles` join table. */
export class GroupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreate(
    telegramId: bigint,
    title?: string | null,
    username?: string | null,
  ): Promise<GroupWithConfig> {
    const titleValue = title ?? null;
    const usernameValue = username ?? null;
    totalGroupsSeen.inc();
    return this.prisma.group.upsert({
      where: { telegramId },
      create: { telegramId, title: titleValue, username: usernameValue },
      update: {
        ...(titleValue ? { title: titleValue } : {}),
        ...(usernameValue ? { username: usernameValue } : {}),
        botInGroup: true,
      },
      include: { disabledRoles: true },
    });
  }

  async findByTelegramId(telegramId: bigint): Promise<GroupWithConfig | null> {
    activeGroups.inc();
    return this.prisma.group.findUnique({
      where: { telegramId },
      include: { disabledRoles: true },
    });
  }

  /** Resolves the `@groupname` argument some DM commands (e.g. `/stopwaiting`) accept. */
  async findByUsername(username: string): Promise<GroupWithConfig | null> {
    return this.prisma.group.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      include: { disabledRoles: true },
    });
  }

  /** Resolves an invite-link argument (e.g. `/leavegroup`) by matching its trailing hash. */
  async findByInviteLinkSuffix(hash: string): Promise<GroupWithConfig | null> {
    return this.prisma.group.findFirst({
      where: { inviteLink: { endsWith: hash } },
      include: { disabledRoles: true },
    });
  }

  async updateConfig(telegramId: bigint, data: Partial<Group>): Promise<void> {
    await this.prisma.group.update({ where: { telegramId }, data });
  }

  async setRoleDisabled(
    groupId: number,
    role: GroupDisabledRole['role'],
    disabled: boolean,
  ): Promise<void> {
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

  async approveGroup(telegramId: bigint, isApproved: boolean): Promise<void> {
    await this.prisma.group.update({ where: { telegramId }, data: { isApproved } });
  }

  /** `/usegifpack`: opts (or un-opts, via `null`) this group into an approved custom gif pack. */
  async setDefaultGifPack(telegramId: bigint, gifPackId: number | null): Promise<void> {
    await this.prisma.group.update({
      where: { telegramId },
      data: { defaultGifPackId: gifPackId },
    });
  }

  /** Captures/registers any user who speaks or joins in this group. */
  async registerMember(
    telegramGroupId: bigint,
    user: { telegramId: bigint; username?: string | null; displayName?: string | null },
  ): Promise<void> {
    const group = await this.getOrCreate(telegramGroupId);
    await this.prisma.groupMember.upsert({
      where: { groupId_telegramId: { groupId: group.id, telegramId: user.telegramId } },
      create: {
        groupId: group.id,
        telegramId: user.telegramId,
        username: user.username ?? null,
        displayName: user.displayName ?? null,
      },
      update: {
        username: user.username ?? null,
        displayName: user.displayName ?? null,
      },
    });
  }

  /** Gets all registered members of this specific group chat. */
  async getGroupMembers(telegramGroupId: bigint, limit = 100) {
    const group = await this.prisma.group.findUnique({ where: { telegramId: telegramGroupId } });
    if (!group) return [];
    return this.prisma.groupMember.findMany({
      where: { groupId: group.id },
      take: limit,
    });
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

/**
 * Resolves which mode a new game should actually start in - mirrors the original's
 * `GameMode = RandomMode ? modes.ElementAt(R.Next(...)) : (DbGroup.Mode == "Player" ? gameMode :
 * modes.FirstOrDefault(...))`. `commandMode` is whichever of /startgame or /startchaos was used;
 * it's only consulted when the group hasn't forced a mode via /config (PLAYER_CHOICE, the default).
 */
export function resolveGameMode(
  group: Pick<Group, 'mode' | 'randomMode'>,
  commandMode: GameMode,
): GameMode {
  if (group.randomMode) return Math.random() < 0.5 ? 'Normal' : 'Chaos';
  if (commandMode !== 'Normal') return commandMode;
  if (group.mode === 'NORMAL') return 'Normal';
  if (group.mode === 'CHAOS') return 'Chaos';
  return commandMode;
}
