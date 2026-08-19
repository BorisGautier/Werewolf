import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { Game, GameError } from '../../src/domain/game/game.aggregate.js';

/** A 6-player TeamDuel game, roles pinned to plain Villagers (see the equivalent helper in
 * `game.aggregate.abilities.test.ts` for why - a random role interacting with the scenario would
 * make assertions flaky). Squads are whatever `start()`'s shuffle-based draft produced; tests that
 * need a specific split override `duelSquad` afterwards. */
function startedDuelGame(playerCount = 6) {
  const game = new Game({ chatId: 1n, mode: 'TeamDuel', minPlayers: playerCount });
  for (let i = 1; i <= playerCount; i++) game.addPlayer(BigInt(i), `P${i}`);
  game.start();
  for (const p of game.players) {
    p.role = ROLE_BIT.Villager;
    p.team = 'Village';
    p.changedRolesCount = 0;
  }
  return game;
}

describe('TeamDuel squad draft', () => {
  it('splits an even headcount into two equal squads, each with exactly one captain', () => {
    const game = startedDuelGame(8);

    const squadA = game.players.filter((p) => p.duelSquad === 'A');
    const squadB = game.players.filter((p) => p.duelSquad === 'B');
    expect(squadA).toHaveLength(4);
    expect(squadB).toHaveLength(4);
    expect(squadA.filter((p) => p.isDuelCaptain)).toHaveLength(1);
    expect(squadB.filter((p) => p.isDuelCaptain)).toHaveLength(1);
  });

  it('refuses to start with an odd player count', () => {
    const game = new Game({ chatId: 1n, mode: 'TeamDuel', minPlayers: 5 });
    for (let i = 1; i <= 7; i++) game.addPlayer(BigInt(i), `P${i}`);

    expect(() => game.start()).toThrow(GameError);
    expect(() => game.start()).toThrow(/even number/);
  });

  it('refuses to start below the TeamDuel minimum, even with an even count', () => {
    const game = new Game({ chatId: 1n, mode: 'TeamDuel', minPlayers: 4 });
    for (let i = 1; i <= 4; i++) game.addPlayer(BigInt(i), `P${i}`);

    expect(() => game.start()).toThrow(GameError);
    expect(() => game.start()).toThrow(/at least/);
  });

  it('leaves every player with duelSquad: null outside of TeamDuel mode', () => {
    const game = new Game({ chatId: 1n, mode: 'Normal', minPlayers: 5 });
    for (let i = 1; i <= 5; i++) game.addPlayer(BigInt(i), `P${i}`);
    game.start();

    expect(game.players.every((p) => p.duelSquad === null)).toBe(true);
    expect(game.players.every((p) => !p.isDuelCaptain)).toBe(true);
  });
});

describe('TeamDuel win condition', () => {
  it('declares the surviving squad the winner the instant the other squad is fully eliminated', () => {
    const game = startedDuelGame(6);
    for (const p of game.players) p.duelSquad = null;
    const [a1, a2, a3, b1, b2, b3] = game.players;
    for (const p of [a1!, a2!, a3!]) p.duelSquad = 'A';
    for (const p of [b1!, b2!, b3!]) p.duelSquad = 'B';

    game.killPlayer(a1!.id, 'Idle', { killerIds: [a1!.id] });
    game.killPlayer(a2!.id, 'Idle', { killerIds: [a2!.id] });
    let result = game.checkWinCondition();
    expect(result.finished).toBe(false); // a3 still alive, squad A isn't wiped yet

    game.killPlayer(a3!.id, 'Idle', { killerIds: [a3!.id] });
    result = game.checkWinCondition();

    expect(result.finished).toBe(true);
    expect(game.phase).toBe('Ended');
    expect(
      result.events.some(
        (e) =>
          e.type === 'DuelSquadWon' &&
          e.squad === 'B' &&
          e.survivorIds.length === 3 &&
          [b1!.id, b2!.id, b3!.id].every((id) => e.survivorIds.includes(id)),
      ),
    ).toBe(true);
    // Every Squad B member wins, including any who might have died along the way - mirrors the
    // classic team-win semantics of markWinners() (a dead Villager still "wins" a Village game).
    expect(b1!.won).toBe(true);
    expect(b2!.won).toBe(true);
    expect(b3!.won).toBe(true);
    // Squad A - the losing squad - never gets credited, dead or not.
    expect(a1!.won).toBe(false);
    expect(a2!.won).toBe(false);
    expect(a3!.won).toBe(false);
  });

  it('still credits a Squad B member who already died earlier once Squad A is wiped out', () => {
    const game = startedDuelGame(6);
    for (const p of game.players) p.duelSquad = null;
    const [a1, a2, a3, b1, b2, b3] = game.players;
    for (const p of [a1!, a2!, a3!]) p.duelSquad = 'A';
    for (const p of [b1!, b2!, b3!]) p.duelSquad = 'B';

    // Squad B already lost a member, but still has 2 survivors against Squad A's soon-to-be zero.
    game.killPlayer(b1!.id, 'Idle', { killerIds: [b1!.id] });
    game.killPlayer(a1!.id, 'Idle', { killerIds: [a1!.id] });
    game.killPlayer(a2!.id, 'Idle', { killerIds: [a2!.id] });
    game.killPlayer(a3!.id, 'Idle', { killerIds: [a3!.id] });

    const result = game.checkWinCondition();

    expect(result.finished).toBe(true);
    expect(b1!.won).toBe(true); // dead, but still on the winning squad
    expect(b2!.won).toBe(true);
    expect(b3!.won).toBe(true);
  });

  it('does not end the game while both squads still have survivors', () => {
    const game = startedDuelGame(6);
    for (const p of game.players) p.duelSquad = null;
    const [a1, , , b1] = game.players;
    a1!.duelSquad = 'A';
    game.players[1]!.duelSquad = 'A';
    game.players[2]!.duelSquad = 'A';
    b1!.duelSquad = 'B';
    game.players[4]!.duelSquad = 'B';
    game.players[5]!.duelSquad = 'B';

    game.killPlayer(a1!.id, 'Idle', { killerIds: [a1!.id] });
    const result = game.checkWinCondition();

    expect(result.finished).toBe(false);
    expect(game.phase).not.toBe('Ended');
  });

  it('ends the game as a draw when both squads are wiped out in the same resolution, instead of never finishing', () => {
    // Regression test: a night kill and a lynch can land in the same resolution and take the
    // last member of *both* squads out simultaneously - `checkDuelWinCondition()` used to treat
    // that as "still contested" (`return null`) rather than "over", so the loop kept scheduling
    // night after night forever with zero living players on either side. Confirmed via the stress
    // simulation: real games were observed reaching day 3000+ stuck in this exact state.
    const game = startedDuelGame(6);
    for (const p of game.players) p.duelSquad = null;
    const [a1, a2, a3, b1, b2, b3] = game.players;
    for (const p of [a1!, a2!, a3!]) p.duelSquad = 'A';
    for (const p of [b1!, b2!, b3!]) p.duelSquad = 'B';
    for (const p of game.players) game.killPlayer(p.id, 'Idle', { killerIds: [p.id] });

    const result = game.checkWinCondition();

    expect(result.finished).toBe(true);
    expect(game.phase).toBe('Ended');
    expect(result.events.some((e) => e.type === 'DuelMutualWipeout')).toBe(true);
    // A draw - nobody's on the winning side, `player.won` never gets set for anyone.
    expect(game.players.every((p) => !p.won)).toBe(true);
    expect(game.winningTeam).toBeUndefined();
  });

  it('is idempotent once a Duel has already ended', () => {
    const game = startedDuelGame(6);
    for (const p of game.players) p.duelSquad = null;
    const [a1, a2, a3, b1, b2, b3] = game.players;
    for (const p of [a1!, a2!, a3!]) p.duelSquad = 'A';
    for (const p of [b1!, b2!, b3!]) p.duelSquad = 'B';
    for (const p of [a1!, a2!, a3!]) game.killPlayer(p.id, 'Idle', { killerIds: [p.id] });
    game.checkWinCondition();

    const second = game.checkWinCondition();

    expect(second.finished).toBe(true);
    expect(second.events).toHaveLength(0); // no duplicate DuelSquadWon event on the re-check
  });
});
