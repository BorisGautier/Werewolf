import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { evaluateWinCondition } from '../../src/domain/game/win-condition.js';

describe('evaluateWinCondition', () => {
  it('does not end the game while multiple teams are still alive in a balanced game', () => {
    const players = [
      createPlayer(1n, 'V1', ROLE_BIT.Villager, 'Village'),
      createPlayer(2n, 'V2', ROLE_BIT.Villager, 'Village'),
      createPlayer(3n, 'V3', ROLE_BIT.Villager, 'Village'),
      createPlayer(4n, 'Wolf', ROLE_BIT.Wolf, 'Wolf'),
    ];

    const result = evaluateWinCondition(players);
    expect(result.finished).toBe(false);
  });

  it('ends in a Village win once every wolf/threat is gone, and marks winners', () => {
    const players = [
      createPlayer(1n, 'V1', ROLE_BIT.Villager, 'Village'),
      createPlayer(2n, 'V2', ROLE_BIT.Villager, 'Village'),
    ];

    const result = evaluateWinCondition(players);
    expect(result.finished).toBe(true);
    expect(result.winningTeam).toBe('Village');
    expect(players[0]!.won).toBe(true);
    expect(players[1]!.won).toBe(true);
  });

  it('ends in a Wolf win once wolves are at least as numerous as everyone else', () => {
    const players = [
      createPlayer(1n, 'V1', ROLE_BIT.Villager, 'Village'),
      createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf'),
    ];

    const result = evaluateWinCondition(players);
    expect(result.finished).toBe(true);
    expect(result.winningTeam).toBe('Wolf');
  });

  it('an armed Gunner can prevent a Wolf win when they make the difference', () => {
    const players = [
      createPlayer(1n, 'Gunner', ROLE_BIT.Gunner, 'Village'),
      createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf'),
    ];
    players[0]!.bullet = 2;

    const result = evaluateWinCondition(players);
    expect(result.finished).toBe(false);
    expect(result.events.some((e) => e.type === 'GunnerPreventsWolfWin')).toBe(true);
  });

  it('a lone Tanner, Sorcerer, Thief or Doppelganger ends the game with no winner', () => {
    const players = [createPlayer(1n, 'Tanner', ROLE_BIT.Tanner, 'Tanner')];
    const result = evaluateWinCondition(players);
    expect(result.finished).toBe(true);
    expect(result.winningTeam).toBe('NoOne');
  });

  it('a lone survivor of any other team wins for their team', () => {
    const players = [createPlayer(1n, 'Villager', ROLE_BIT.Villager, 'Village')];
    const result = evaluateWinCondition(players);
    expect(result.winningTeam).toBe('Village');
    expect(players[0]!.won).toBe(true);
  });

  it('two surviving lovers win together regardless of role', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const villager = createPlayer(2n, 'Villager', ROLE_BIT.Villager, 'Village');
    wolf.inLove = true;
    wolf.loverId = 2n;
    villager.inLove = true;
    villager.loverId = 1n;

    const result = evaluateWinCondition([wolf, villager]);
    expect(result.winningTeam).toBe('Lovers');
    expect(wolf.won).toBe(true);
    expect(villager.won).toBe(true);
  });

  it('promotes a lone Traitor to Wolf once no classic wolf remains alive', () => {
    const traitor = createPlayer(1n, 'Traitor', ROLE_BIT.Traitor, 'Village');
    const villager = createPlayer(2n, 'Villager', ROLE_BIT.Villager, 'Village');
    const players = [traitor, villager];

    const result = evaluateWinCondition(players);

    expect(traitor.role).toBe(ROLE_BIT.Wolf);
    expect(traitor.team).toBe('Wolf');
    expect(result.events.some((e) => e.type === 'TraitorBecameWolf')).toBe(true);
    // With the traitor now a wolf, 1 wolf vs 1 villager is an immediate Wolf win.
    expect(result.winningTeam).toBe('Wolf');
  });

  it('blocks resolution when checkBitten is set and a bitten player is about to turn', () => {
    const traitor = createPlayer(1n, 'Traitor', ROLE_BIT.Traitor, 'Village');
    const villager = createPlayer(2n, 'Villager', ROLE_BIT.Villager, 'Village');
    villager.bitten = true;
    const players = [traitor, villager];

    const result = evaluateWinCondition(players, { checkBitten: true });

    expect(result.finished).toBe(false);
    expect(traitor.role).toBe(ROLE_BIT.Traitor); // not yet promoted
  });

  it('runs the Hunter-vs-Wolf standoff and kills the wolf on a successful roll', () => {
    const hunter = createPlayer(1n, 'Hunter', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');

    const result = evaluateWinCondition([hunter, wolf], { random: () => 0 }); // 0 < 30 -> hunter wins

    expect(wolf.isDead).toBe(true);
    expect(result.winningTeam).toBe('Village');
  });

  it('runs the Hunter-vs-Wolf standoff and kills the hunter on a failed roll', () => {
    const hunter = createPlayer(1n, 'Hunter', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');

    const result = evaluateWinCondition([hunter, wolf], { random: () => 0.99 }); // 99 >= 30 -> wolf wins

    expect(hunter.isDead).toBe(true);
    expect(result.winningTeam).toBe('Wolf');
  });

  it('ends with an SKHunter result when the last two are the Hunter and the Serial Killer', () => {
    const hunter = createPlayer(1n, 'Hunter', ROLE_BIT.Hunter, 'Village');
    const sk = createPlayer(2n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');

    const result = evaluateWinCondition([hunter, sk]);

    expect(result.winningTeam).toBe('SKHunter');
    expect(hunter.isDead).toBe(false);
    expect(sk.isDead).toBe(false);
  });

  it('auto-converts the last non-wolf, non-CultistHunter survivor to the cult', () => {
    const cultist = createPlayer(1n, 'Cultist', ROLE_BIT.Cultist, 'Cult');
    const villager = createPlayer(2n, 'Villager', ROLE_BIT.Villager, 'Village');

    const result = evaluateWinCondition([cultist, villager]);

    expect(villager.role).toBe(ROLE_BIT.Cultist);
    expect(villager.team).toBe('Cult');
    expect(result.winningTeam).toBe('Cult');
  });

  it('lets the CultistHunter defeat the last Cultist and win for the Village', () => {
    const cultist = createPlayer(1n, 'Cultist', ROLE_BIT.Cultist, 'Cult');
    const ch = createPlayer(2n, 'CH', ROLE_BIT.CultistHunter, 'Village');

    const result = evaluateWinCondition([cultist, ch]);

    expect(result.winningTeam).toBe('Village');
    expect(result.events.some((e) => e.type === 'CultistHunterKilledCultist')).toBe(true);
  });

  it('keeps the game running while a lone Serial Killer or Arsonist has more than one player left', () => {
    const players = [
      createPlayer(1n, 'V1', ROLE_BIT.Villager, 'Village'),
      createPlayer(2n, 'V2', ROLE_BIT.Villager, 'Village'),
      createPlayer(3n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller'),
    ];

    const result = evaluateWinCondition(players);
    expect(result.finished).toBe(false);
  });
});
