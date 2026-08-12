import { describe, expect, it } from 'vitest';
import { GameAlreadyRunningError, GameManager } from '../../src/application/game-manager.js';

describe('GameManager', () => {
  it('creates and retrieves a game by chat id', () => {
    const manager = new GameManager();
    const game = manager.create(1n, { mode: 'Normal' });

    expect(manager.get(1n)).toBe(game);
    expect(manager.has(1n)).toBe(true);
    expect(manager.size).toBe(1);
  });

  it('refuses to create a second game for the same chat', () => {
    const manager = new GameManager();
    manager.create(1n, { mode: 'Normal' });
    expect(() => manager.create(1n, { mode: 'Normal' })).toThrow(GameAlreadyRunningError);
  });

  it('removes a game, freeing up the chat id', () => {
    const manager = new GameManager();
    manager.create(1n, { mode: 'Normal' });
    manager.remove(1n);

    expect(manager.has(1n)).toBe(false);
    expect(manager.get(1n)).toBeUndefined();
    expect(() => manager.create(1n, { mode: 'Normal' })).not.toThrow();
  });

  it('lists active chat ids', () => {
    const manager = new GameManager();
    manager.create(1n, { mode: 'Normal' });
    manager.create(2n, { mode: 'Chaos' });

    expect(manager.activeChatIds().sort()).toEqual([1n, 2n]);
  });

  it('finds the game a player is in, regardless of which chat it runs in', () => {
    const manager = new GameManager();
    const game1 = manager.create(1n, { mode: 'Normal' });
    const game2 = manager.create(2n, { mode: 'Normal' });
    game1.addPlayer(100n, 'Alice');
    game2.addPlayer(200n, 'Bob');

    expect(manager.findByPlayer(100n)).toBe(game1);
    expect(manager.findByPlayer(200n)).toBe(game2);
    expect(manager.findByPlayer(999n)).toBeUndefined();
  });
});
