import type { PrismaClient } from '@prisma/client';

export interface MissionPerformer {
  playerId: bigint;
  username: string | null;
  displayName: string | null;
  attempts: number;
  successes: number;
  /** 0-100, rounded to one decimal place. */
  successRate: number;
}

export interface MissionStat {
  missionId: string;
  attempts: number;
  successes: number;
}

/** Wraps the `disabled_missions` and `mission_completions` tables - global (not per-group) admin
 * control over which of `missions.ts`'s `MISSION_DEFS` can still be offered, plus the completion
 * log that powers the admin dashboard's "top mission performers" view. */
export class MissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getDisabledMissionIds(): Promise<Set<string>> {
    const rows = await this.prisma.disabledMission.findMany({ select: { missionId: true } });
    return new Set(rows.map((r) => r.missionId));
  }

  async setMissionEnabled(missionId: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.prisma.disabledMission.deleteMany({ where: { missionId } });
    } else {
      await this.prisma.disabledMission.upsert({
        where: { missionId },
        create: { missionId },
        update: {},
      });
    }
  }

  /** Only ever called for a mission the player actually accepted (see `Player.missionId`) - a
   * declined or never-answered offer never reaches here, since it's never scoreable. */
  async recordCompletion(
    playerId: bigint,
    missionId: string,
    succeeded: boolean,
    gameId: number | null,
  ): Promise<void> {
    await this.prisma.missionCompletion.create({
      data: { playerId, missionId, succeeded, gameId },
    });
  }

  /** Per-mission attempt/success counts across every game ever played - powers the admin
   * dashboard's management table alongside each mission's enabled/disabled toggle. */
  async getMissionStats(): Promise<MissionStat[]> {
    const rows = await this.prisma.missionCompletion.groupBy({
      by: ['missionId', 'succeeded'],
      _count: { _all: true },
    });
    const byMission = new Map<string, MissionStat>();
    for (const row of rows) {
      const existing = byMission.get(row.missionId) ?? {
        missionId: row.missionId,
        attempts: 0,
        successes: 0,
      };
      existing.attempts += row._count._all;
      if (row.succeeded) existing.successes += row._count._all;
      byMission.set(row.missionId, existing);
    }
    return [...byMission.values()];
  }

  /** Real players with the highest mission success rate, ranked by rate then by volume of
   * attempts (a 1-for-1 shouldn't outrank a proven 18-for-20) - only players with at least
   * `minAttempts` completed missions are considered, so a single lucky attempt can't top the list. */
  async getTopPerformers(minAttempts = 3, limit = 20): Promise<MissionPerformer[]> {
    const rows = await this.prisma.missionCompletion.groupBy({
      by: ['playerId', 'succeeded'],
      _count: { _all: true },
    });
    const byPlayer = new Map<bigint, { attempts: number; successes: number }>();
    for (const row of rows) {
      const existing = byPlayer.get(row.playerId) ?? { attempts: 0, successes: 0 };
      existing.attempts += row._count._all;
      if (row.succeeded) existing.successes += row._count._all;
      byPlayer.set(row.playerId, existing);
    }

    const qualifying = [...byPlayer.entries()].filter(([, stats]) => stats.attempts >= minAttempts);
    const players = await this.prisma.player.findMany({
      where: { telegramId: { in: qualifying.map(([id]) => id) } },
      select: { telegramId: true, username: true, displayName: true },
    });
    const playerInfo = new Map(players.map((p) => [p.telegramId, p]));

    return qualifying
      .map(([playerId, stats]) => ({
        playerId,
        username: playerInfo.get(playerId)?.username ?? null,
        displayName: playerInfo.get(playerId)?.displayName ?? null,
        attempts: stats.attempts,
        successes: stats.successes,
        successRate: Math.round((stats.successes / stats.attempts) * 1000) / 10,
      }))
      .sort((a, b) => b.successRate - a.successRate || b.attempts - a.attempts)
      .slice(0, limit);
  }
}
