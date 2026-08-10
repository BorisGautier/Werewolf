/**
 * In-memory registry of active games, keyed by Telegram chat id. Mirrors
 * what `Werewolf Node/Program.cs`'s `HashSet<Werewolf> Games` did in the
 * original, minus the distributed multi-process bookkeeping (this is a
 * single-process monolith by design - see the project README).
 */

import { Game, type GameOptions } from '../domain/game/game.aggregate.js';

export class GameAlreadyRunningError extends Error {
  constructor(public readonly chatId: bigint) {
    super(`A game is already running in chat ${chatId.toString()}.`);
    this.name = 'GameAlreadyRunningError';
  }
}

export class GameManager {
  private readonly games = new Map<bigint, Game>();

  get(chatId: bigint): Game | undefined {
    return this.games.get(chatId);
  }

  has(chatId: bigint): boolean {
    return this.games.has(chatId);
  }

  create(chatId: bigint, options: Omit<GameOptions, 'chatId'>): Game {
    if (this.games.has(chatId)) throw new GameAlreadyRunningError(chatId);
    const game = new Game({ ...options, chatId });
    this.games.set(chatId, game);
    return game;
  }

  remove(chatId: bigint): void {
    this.games.delete(chatId);
  }

  activeChatIds(): bigint[] {
    return [...this.games.keys()];
  }

  get size(): number {
    return this.games.size;
  }
}
