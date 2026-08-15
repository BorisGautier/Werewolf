/**
 * In-memory registry of active games, keyed by Telegram chat id. Mirrors
 * what `Werewolf Node/Program.cs`'s `HashSet<Werewolf> Games` did in the
 * original, minus the distributed multi-process bookkeeping (this is a
 * single-process monolith by design - see the project README).
 */

import { Game, type GameOptions } from '../domain/game/game.aggregate.js';
import type { Logger } from '../infrastructure/logging/logger.js';
import {
  activeGames,
  gamesKilled,
  playerCountAtStart,
} from '../infrastructure/monitoring/metrics.js';

export class GameAlreadyRunningError extends Error {
  constructor(public readonly chatId: bigint) {
    super(`A game is already running in chat ${chatId.toString()}.`);
    this.name = 'GameAlreadyRunningError';
  }
}

export class GameManager {
  private readonly games = new Map<bigint, Game>();
  private readonly logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  get(chatId: bigint): Game | undefined {
    return this.games.get(chatId);
  }

  has(chatId: bigint): boolean {
    return this.games.has(chatId);
  }

  create(chatId: bigint, options: Omit<GameOptions, 'chatId'>): Game {
    if (this.games.has(chatId)) {
      this.logger?.warn(
        { chatId: chatId.toString(), mode: options.mode },
        'Game creation refused — game already running in this chat',
      );
      throw new GameAlreadyRunningError(chatId);
    }
    const game = new Game({ ...options, chatId });
    this.games.set(chatId, game);

    this.logger?.info(
      {
        chatId: chatId.toString(),
        mode: options.mode,
        activeGames: this.games.size,
        minPlayers: options.minPlayers,
        maxPlayers: options.maxPlayers,
      },
      'Game created and registered in GameManager',
    );

    // Update Prometheus gauge
    activeGames.labels(options.mode).inc();

    return game;
  }

  remove(chatId: bigint): void {
    const game = this.games.get(chatId);
    if (game) {
      this.logger?.debug(
        { chatId: chatId.toString(), mode: game.mode, dayNumber: game.dayNumber },
        'Game removed from GameManager registry',
      );
      activeGames.labels(game.mode).dec();
    }
    this.games.delete(chatId);
  }

  /**
   * Finds whichever active game a player is currently in - mirrors `GetPlayerNode`. Needed because
   * a player's night/day menu callbacks arrive over their private chat, not the group's, so there's
   * no chat id to look the game up by directly.
   */
  findByPlayer(playerId: bigint, preferredPhase?: Game['phase']): Game | undefined {
    let fallback: Game | undefined;
    for (const game of this.games.values()) {
      if (game.players.some((p) => p.id === playerId)) {
        if (!preferredPhase || game.phase === preferredPhase) return game;
        fallback ??= game;
      }
    }
    if (!fallback) {
      this.logger?.debug(
        { playerId: playerId.toString(), preferredPhase },
        'No active game found for player',
      );
    }
    return fallback;
  }

  activeChatIds(): bigint[] {
    return [...this.games.keys()];
  }

  /**
   * Admin force-kill: removes game from registry and records metrics.
   */
  forceKill(chatId: bigint): boolean {
    const game = this.games.get(chatId);
    if (!game) {
      this.logger?.warn({ chatId: chatId.toString() }, 'Force-kill called but no game found');
      return false;
    }
    this.logger?.warn(
      { chatId: chatId.toString(), mode: game.mode, dayNumber: game.dayNumber, phase: game.phase },
      'Game force-killed by admin via GameManager',
    );
    gamesKilled.inc();
    activeGames.labels(game.mode).dec();
    this.games.delete(chatId);
    return true;
  }

  /**
   * Records player-count distribution metric when a game officially starts.
   */
  recordGameStart(chatId: bigint): void {
    const game = this.games.get(chatId);
    if (game) {
      playerCountAtStart.labels(game.mode).observe(game.players.length);
      this.logger?.info(
        { chatId: chatId.toString(), mode: game.mode, playerCount: game.players.length },
        'Game start player count recorded',
      );
    }
  }

  get size(): number {
    return this.games.size;
  }
}
