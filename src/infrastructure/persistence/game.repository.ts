import type { PrismaClient } from '@prisma/client';
import type { Player } from '../../domain/game/player.js';
import type { Team } from '../../domain/game/team.js';
import type { GameMode } from '../../domain/game/game-mode.js';
import type { KillMethod } from '../../domain/game/kill-method.js';
import { killMethodToPrisma, killPhaseToPrisma, roleToPrisma, teamToPrisma } from './mappers.js';
import { gameRecordsSaved, killRecordsSaved } from '../monitoring/metrics.js';

/** Wraps the `games`/`game_players`/`game_kills` tables - the history/stats record written as a game plays out. */
export class GameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createGame(
    groupDbId: number,
    groupTitleSnapshot: string | null,
    mode: GameMode,
  ): Promise<number> {
    const game = await this.prisma.game.create({
      data: {
        groupId: groupDbId,
        groupTitleSnapshot,
        mode: mode === 'Chaos' ? 'CHAOS' : 'NORMAL',
      },
    });
    gameRecordsSaved.inc();
    return game.id;
  }

  /** One GamePlayer row per player, matched to their DB Player row via telegramId -> playerDbId. */
  async recordPlayers(
    gameId: number,
    players: readonly Player[],
    playerDbIdByTelegramId: ReadonlyMap<bigint, number>,
  ): Promise<void> {
    const rows = players.flatMap((p) => {
      const playerDbId = playerDbIdByTelegramId.get(p.id);
      if (playerDbId === undefined) return [];
      return [
        { gameId, playerId: playerDbId, role: roleToPrisma(p.role), team: teamToPrisma(p.team) },
      ];
    });
    if (rows.length > 0) await this.prisma.gamePlayer.createMany({ data: rows });
  }

  /** Returns the game's `startedAt` so the caller can compute wall-clock duration (LongHaul). */
  async finalizeGame(
    gameId: number,
    winnerTeam: Team | undefined,
    players: readonly Player[],
  ): Promise<Date> {
    const updated = await this.prisma.game.update({
      where: { id: gameId },
      data: { endedAt: new Date(), winnerTeam: winnerTeam ? teamToPrisma(winnerTeam) : null },
    });

    for (const p of players) {
      await this.prisma.gamePlayer.updateMany({
        where: { gameId, player: { telegramId: p.id } },
        data: { survived: !p.isDead, won: p.won },
      });
    }

    return updated.startedAt;
  }

  /**
   * One row per death, matched to the game's already-recorded `GamePlayer` rows via telegramId.
   * Powers `/getidles` (idle kills in the last 24h) and any future per-kill history/stats.
   * Silently no-ops if the victim (or, for a multi-killer death, none of the killers) was never
   * recorded via `recordPlayers` - shouldn't happen in practice, but a missing history row is far
   * better than crashing the game loop over it.
   */
  async recordKill(
    gameId: number,
    victimTelegramId: bigint,
    killerTelegramIds: readonly bigint[],
    method: KillMethod,
    phase: 'Night' | 'Day' | 'Lynch',
    dayNumber: number,
  ): Promise<void> {
    const relevantIds = [victimTelegramId, ...killerTelegramIds];
    const gamePlayers = await this.prisma.gamePlayer.findMany({
      where: { gameId, player: { telegramId: { in: relevantIds } } },
      include: { player: true },
    });
    const victim = gamePlayers.find((gp) => gp.player.telegramId === victimTelegramId);
    if (!victim) return;
    const killer = gamePlayers.find((gp) => killerTelegramIds.includes(gp.player.telegramId));

    await this.prisma.gameKill.create({
      data: {
        gameId,
        victimId: victim.id,
        killerId: killer?.id ?? null,
        method: killMethodToPrisma(method),
        phase: killPhaseToPrisma(phase),
        dayNumber,
      },
    });
    killRecordsSaved.inc();
  }

  /** Powers `/getidles`: how many times this player has been killed for idling (not voting) recently. */
  async getIdleKills24Hours(telegramId: bigint, groupDbId?: number): Promise<number> {
    return this.prisma.gameKill.count({
      where: {
        method: 'IDLE',
        victim: { player: { telegramId } },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        ...(groupDbId !== undefined ? { game: { groupId: groupDbId } } : {}),
      },
    });
  }

  /** Powers `/stats`: how many finished games this player has been in, and how many they won. */
  async getPlayerStats(telegramId: bigint): Promise<{ played: number; won: number }> {
    const [played, won] = await Promise.all([
      this.prisma.gamePlayer.count({
        where: { player: { telegramId }, game: { endedAt: { not: null } } },
      }),
      this.prisma.gamePlayer.count({ where: { player: { telegramId }, won: true } }),
    ]);
    return { played, won };
  }

  /** Powers `/stats` in a group: how many finished games this group has hosted. */
  async getGroupStats(groupDbId: number): Promise<{ played: number }> {
    const played = await this.prisma.game.count({
      where: { groupId: groupDbId, endedAt: { not: null } },
    });
    return { played };
  }
}
