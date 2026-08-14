import { describe, expect, it } from 'vitest';
import { generateGazette } from '../../src/domain/gazette/gazette-generator.js';
import { Game } from '../../src/domain/game/game.aggregate.js';
import type { GameEvent } from '../../src/domain/game/game-event.js';

describe('Gazette Generator', () => {
  it('generates a theatrical story in French by default', () => {
    const game = new Game(BigInt(100), { minPlayers: 5, maxPlayers: 10 });
    game.addPlayer(BigInt(1), 'Alice');
    game.addPlayer(BigInt(2), 'Bob');
    game.winningTeam = 'Village';

    const events: GameEvent[] = [
      { type: 'PlayerDied', playerId: BigInt(2), method: 'Lynch', killerIds: [], isNight: false },
    ];

    const gazette = generateGazette(game, [events], 'fr');

    expect(gazette.title).toContain('LA GAZETTE DU VILLAGE');
    expect(gazette.lines.some((l) => l.includes('Justice Populaire'))).toBe(true);
    expect(gazette.lines.some((l) => l.includes('Les villageois ont triomphé'))).toBe(true);
  });

  it('generates a story in English when language is en', () => {
    const game = new Game(BigInt(100), { minPlayers: 5, maxPlayers: 10 });
    game.addPlayer(BigInt(1), 'Alice');
    game.winningTeam = 'Wolves';

    const events: GameEvent[] = [
      { type: 'PlayerDied', playerId: BigInt(1), method: 'Eat', killerIds: [BigInt(2)], isNight: true },
    ];

    const gazette = generateGazette(game, [events], 'en');

    expect(gazette.title).toContain('THE VILLAGE GAZETTE');
    expect(gazette.lines.some((l) => l.includes('Nightly Raids'))).toBe(true);
    expect(gazette.lines.some((l) => l.includes('The wolves devoured the entire village'))).toBe(true);
  });
});
