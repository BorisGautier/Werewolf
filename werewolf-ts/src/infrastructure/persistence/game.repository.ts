import type { PrismaClient } from '@prisma/client';
import type { Player } from '../../domain/game/player.js';
import type { Team } from '../../domain/game/team.js';
import type { GameMode } from '../../domain/game/game-mode.js';
import { roleToPrisma, teamToPrisma } from './mappers.js';

/** Wraps the `games`/`game_players` tables - a lightweight history/stats record, written once at game start and once at game end (per-kill history isn't tracked yet, see README). */
export class GameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createGame(groupDbId: number, groupTitleSnapshot: string | null, mode: GameMode): Promise<number> {
    const game = await this.prisma.game.create({
      data: {
        groupId: groupDbId,
        groupTitleSnapshot,
        mode: mode === 'Chaos' ? 'CHAOS' : 'NORMAL',
      },
    });
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
      return [{ gameId, playerId: playerDbId, role: roleToPrisma(p.role), team: teamToPrisma(p.team) }];
    });
    if (rows.length > 0) await this.prisma.gamePlayer.createMany({ data: rows });
  }

  async finalizeGame(gameId: number, winnerTeam: Team | undefined, players: readonly Player[]): Promise<void> {
    await this.prisma.game.update({
      where: { id: gameId },
      data: { endedAt: new Date(), winnerTeam: winnerTeam ? teamToPrisma(winnerTeam) : null },
    });

    for (const p of players) {
      await this.prisma.gamePlayer.updateMany({
        where: { gameId, player: { telegramId: p.id } },
        data: { survived: !p.isDead, won: p.won },
      });
    }
  }
}
