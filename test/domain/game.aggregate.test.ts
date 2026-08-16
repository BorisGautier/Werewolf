import { describe, expect, it } from 'vitest';
import { ROLE_BIT, addFlag, ROLE_VALID } from '../../src/domain/roles/role.js';
import { Game, GameError } from '../../src/domain/game/game.aggregate.js';

function joinedGame(playerCount = 8) {
  const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 5 });
  for (let i = 1; i <= playerCount; i++) {
    game.addPlayer(BigInt(i), `Player${i}`);
  }
  return game;
}

describe('Game (joining phase)', () => {
  it('rejects joins once the game has started, and duplicate joins', () => {
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 5 });
    game.addPlayer(1n, 'A');
    expect(() => game.addPlayer(1n, 'A again')).toThrow(GameError);

    for (let i = 2; i <= 5; i++) game.addPlayer(BigInt(i), `P${i}`);
    game.start();
    expect(() => game.addPlayer(99n, 'Late')).toThrow(GameError);
  });

  it('refuses to start below minPlayers', () => {
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 5 });
    game.addPlayer(1n, 'A');
    expect(game.canStart()).toBe(false);
    expect(() => game.start()).toThrow(GameError);
  });

  it('lets a player flee during joining, freeing up their spot', () => {
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 5 });
    game.addPlayer(1n, 'A');
    expect(game.removePlayer(1n)).toBe(true);
    expect(game.players).toHaveLength(0);
  });
});

describe('Game (role assignment / start)', () => {
  it('assigns every player a real role and moves to Night 1', () => {
    const game = joinedGame(8);
    game.start();

    expect(game.phase).toBe('Night');
    expect(game.dayNumber).toBe(1);
    expect(game.players.every((p) => p.role !== undefined)).toBe(true);
    // Not everyone can still be the Villager placeholder.
    expect(game.players.some((p) => p.role !== ROLE_BIT.Villager)).toBe(true);
  });

  it('respects a disabled-roles configuration when balancing', () => {
    const game = new Game({
      chatId: 1n,
      mode: 'Normal',
      minPlayers: 5,
      disabledRoleFlags: addFlag(ROLE_VALID, ROLE_BIT.Tanner),
    });
    for (let i = 1; i <= 10; i++) game.addPlayer(BigInt(i), `P${i}`);
    game.start();

    expect(game.players.some((p) => p.role === ROLE_BIT.Tanner)).toBe(false);
  });
});

describe('Game (full day/night/lynch cycle)', () => {
  it('walks Night -> Day -> Lynch -> Night and increments dayNumber only entering a new Night', () => {
    const game = joinedGame(6);
    game.start();
    expect(game.dayNumber).toBe(1);

    // Force a non-terminal 1 wolf / 5 villagers layout so nobody's death-free
    // start accidentally already satisfies a win condition.
    const [wolf, ...rest] = game.players;
    wolf!.role = ROLE_BIT.Wolf;
    wolf!.team = 'Wolf';
    for (const p of rest) {
      p.role = ROLE_BIT.Villager;
      p.team = 'Village';
    }

    game.startDay();
    expect(game.phase).toBe('Day');
    expect(game.dayNumber).toBe(1);

    game.startLynch();
    expect(game.phase).toBe('Lynch');

    // Nobody votes -> no lynch, game continues, then a new night begins.
    const result = game.resolveLynch();
    expect(result.resolution.outcome).toBe('NoVotes');
    expect(result.finished).toBe(false);

    game.startNight();
    expect(game.phase).toBe('Night');
    expect(game.dayNumber).toBe(2);
  });

  it('rejects phase transitions out of order', () => {
    const game = joinedGame(6);
    game.start(); // phase: Night
    expect(() => game.startLynch()).toThrow(GameError); // must go through Day first
  });

  it('ends the game once a lynch reduces the village to a losing position', () => {
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 2 });
    game.addPlayer(1n, 'Wolf');
    game.addPlayer(2n, 'Villager');
    game.addPlayer(3n, 'Villager2');
    game.start();

    // Force a known role layout: 1 wolf vs 2 villagers.
    const wolf = game.players.find((p) => p.role === ROLE_BIT.Wolf) ?? game.players[0]!;
    for (const p of game.players) {
      p.role = p.id === wolf.id ? ROLE_BIT.Wolf : ROLE_BIT.Villager;
      p.team = p.id === wolf.id ? 'Wolf' : 'Village';
    }

    game.startDay();
    game.startLynch();

    const villagers = game.players.filter((p) => p.id !== wolf.id);
    // Both villagers vote out one another so only the wolf and one villager remain (1 vs 1 -> Wolf wins).
    villagers[0]!.choice = villagers[1]!.id;
    // Give the wolf a vote too so there's a clear majority (no tie).
    wolf.choice = villagers[1]!.id;

    const result = game.resolveLynch();

    expect(result.resolution.outcome).toBe('Lynched');
    expect(result.finished).toBe(true);
    expect(result.winningTeam).toBe('Wolf');
    expect(game.phase).toBe('Ended');
  });

  it('promotes a Wild Child to Wolf from a lynched role model before evaluating the win condition', () => {
    // Regression test: lynching the last Wolf must not hand Village an instant win when a Wild
    // Child's role model was that Wolf - checkRoleChanges() has to turn the Wild Child into a
    // Wolf *before* the win condition is evaluated, exactly like the original's
    // `CheckRoleChanges(true)` right before `CheckForGameEnd(true)` at the end of LynchCycle.
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 4 });
    game.addPlayer(1n, 'Wolf');
    game.addPlayer(2n, 'WildChild');
    game.addPlayer(3n, 'Villager1');
    game.addPlayer(4n, 'Villager2');
    game.start();

    const [wolf, wildChild, v1, v2] = game.players;
    wolf!.role = ROLE_BIT.Wolf;
    wolf!.team = 'Wolf';
    wildChild!.role = ROLE_BIT.WildChild;
    wildChild!.team = 'Village';
    wildChild!.roleModel = wolf!.id;
    v1!.role = ROLE_BIT.Villager;
    v1!.team = 'Village';
    v2!.role = ROLE_BIT.Villager;
    v2!.team = 'Village';

    game.startDay();
    game.startLynch();
    v1!.choice = wolf!.id;
    v2!.choice = wolf!.id;

    const result = game.resolveLynch();

    expect(
      result.events.some((e) => e.type === 'WildChildTurnedWolf' && e.playerId === wildChild!.id),
    ).toBe(true);
    expect(wildChild!.role).toBe(ROLE_BIT.Wolf);
    // The Wild Child is now the last Wolf standing against 2 villagers - the game must NOT have
    // ended as a Village win.
    expect(result.finished).toBe(false);
    expect(game.phase).not.toBe('Ended');
  });

  it("re-evaluates the win condition after the Hunter's final shot lands the killing blow", () => {
    // Regression test: `game.killPlayer` (the Hunter final-shot entrypoint) must trigger a fresh
    // win-condition check by itself - the caller (GameLoop.handleHunterShots) has no other signal
    // that the shot just finished the game.
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 3 });
    game.addPlayer(1n, 'Hunter');
    game.addPlayer(2n, 'Wolf');
    game.addPlayer(3n, 'Villager');
    game.start();
    const [hunter, wolf, villager] = game.players;
    hunter!.role = ROLE_BIT.Hunter;
    hunter!.team = 'Village';
    hunter!.isDead = true; // the Hunter is dying/dead when their final shot fires
    wolf!.role = ROLE_BIT.Wolf;
    wolf!.team = 'Wolf';
    villager!.role = ROLE_BIT.Villager;
    villager!.team = 'Village';

    // The Hunter's dying shot kills the last Wolf - Village should win right away.
    game.killPlayer(wolf!.id, 'HunterShot', { killerIds: [hunter!.id] });
    const win = game.checkWinCondition();

    expect(win.finished).toBe(true);
    expect(win.winningTeam).toBe('Village');
    expect(game.phase).toBe('Ended');
  });

  it('promotes the Apprentice Seer when killPlayer (the Hunter final-shot entrypoint) kills the Seer', () => {
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 4 });
    game.addPlayer(1n, 'Hunter');
    game.addPlayer(2n, 'AppSeer');
    game.addPlayer(3n, 'Seer');
    game.addPlayer(4n, 'Villager');
    game.start();
    const [hunter, appSeer, seer, villager] = game.players;
    hunter!.role = ROLE_BIT.Hunter;
    hunter!.team = 'Village';
    appSeer!.role = ROLE_BIT.ApprenticeSeer;
    appSeer!.team = 'Village';
    seer!.role = ROLE_BIT.Seer;
    seer!.team = 'Village';
    villager!.role = ROLE_BIT.Villager;
    villager!.team = 'Village';

    const events = game.killPlayer(seer!.id, 'HunterShot', { killerIds: [hunter!.id] });

    expect(appSeer!.role).toBe(ROLE_BIT.Seer);
    expect(
      events.some((e) => e.type === 'ApprenticeSeerPromoted' && e.playerId === appSeer!.id),
    ).toBe(true);
  });

  it('cannot resolve a lynch or advance phases once the game has ended', () => {
    const game = joinedGame(5);
    game.start();
    for (const p of game.players) {
      p.role = ROLE_BIT.Villager;
      p.team = 'Village';
    }
    // Kill everyone but one villager: last one standing -> Village wins.
    const [a, ...rest] = game.players;
    for (const victim of rest) {
      game.killPlayer(victim.id, 'Eat', { killerIds: [a!.id] });
    }
    const result = game.checkWinCondition();

    expect(result.finished).toBe(true);
    expect(game.phase).toBe('Ended');
    expect(() => game.killPlayer(a!.id, 'Eat')).toThrow(GameError);
  });

  it('demotes the Hunter to Villager when their final shot kills the Wise Elder', () => {
    const game = joinedGame(5);
    game.start();
    for (const p of game.players) {
      p.role = ROLE_BIT.Villager;
      p.team = 'Village';
    }
    const hunter = game.players[0]!;
    hunter.role = ROLE_BIT.Hunter;
    const wiseElder = game.players[1]!;
    wiseElder.role = ROLE_BIT.WiseElder;

    const events = game.killPlayer(wiseElder.id, 'HunterShot', { killerIds: [hunter.id] });

    expect(hunter.role).toBe(ROLE_BIT.Villager);
    expect(hunter.team).toBe('Village');
    expect(hunter.changedRolesCount).toBe(1);
    expect(
      events.some((e) => e.type === 'HunterLostPowerToWiseElder' && e.playerId === hunter.id),
    ).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.playerId === wiseElder.id)).toBe(true);
  });

  it("doesn't demote a Hunter who kills anyone other than the Wise Elder", () => {
    const game = joinedGame(5);
    game.start();
    for (const p of game.players) {
      p.role = ROLE_BIT.Villager;
      p.team = 'Village';
    }
    const hunter = game.players[0]!;
    hunter.role = ROLE_BIT.Hunter;
    const target = game.players[1]!;

    game.killPlayer(target.id, 'HunterShot', { killerIds: [hunter.id] });

    expect(hunter.role).toBe(ROLE_BIT.Hunter);
    expect(hunter.changedRolesCount).toBe(0);
  });
});
