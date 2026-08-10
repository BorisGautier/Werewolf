import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { GameManager } from '../../src/application/game-manager.js';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { GameLoop } from '../../src/infrastructure/telegram/game-loop.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';
import type { GroupRepository, GroupWithConfig } from '../../src/infrastructure/persistence/group.repository.js';
import type { GameRepository } from '../../src/infrastructure/persistence/game.repository.js';

let translator: Translator;

beforeEach(async () => {
  const locales = await loadLocales();
  translator = new Translator(locales, getDefaultLocale(locales));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function fakeGroup(overrides: Partial<GroupWithConfig> = {}): GroupWithConfig {
  return {
    id: 1,
    telegramId: 1n,
    title: 'Test Group',
    username: null,
    language: 'en',
    mode: 'NORMAL',
    dayTimerSeconds: 5,
    nightTimerSeconds: 5,
    lynchTimerSeconds: 5,
    maxExtendSeconds: 0,
    maxPlayers: 35,
    allowExtend: false,
    allowFlee: true,
    allowNsfw: false,
    allowTanner: true,
    allowFool: true,
    allowCult: true,
    allowThief: true,
    allowArsonist: true,
    thiefFull: false,
    burningOverkill: false,
    showRolesOnDeath: true,
    showIds: false,
    shufflePlayerList: false,
    randomMode: false,
    secretLynch: false,
    secretLynchShowVotes: false,
    secretLynchShowVoters: false,
    botInGroup: true,
    memberCount: null,
    preferred: false,
    inviteLink: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    disabledRoles: [],
    ...overrides,
  };
}

function createHarness() {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  const bot = { api: { sendMessage } } as unknown as Bot;

  const gameManager = new GameManager();

  const group = fakeGroup();
  const groups = {
    getOrCreate: vi.fn(async () => group),
    findByTelegramId: vi.fn(async () => group),
  } as unknown as GroupRepository;

  const gameRepo = {
    createGame: vi.fn(async () => 42),
    recordPlayers: vi.fn(async () => {}),
    finalizeGame: vi.fn(async () => {}),
    recordKill: vi.fn(async () => {}),
  } as unknown as GameRepository;

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('../../src/infrastructure/logging/logger.js').Logger;

  const loop = new GameLoop(bot, gameManager, groups, gameRepo, translator, logger);

  return { loop, bot, sendMessage, gameManager, groups, gameRepo, group, logger };
}

/** A 5-player game (1 Wolf, 4 Villagers) already dealt and in Night 1, matching what
 * GameLobbyManager.finishJoining() hands off to the loop. */
function dealtGame(gameManager: GameManager, chatId = 1n) {
  const game = gameManager.create(chatId, { mode: 'Normal', minPlayers: 5 });
  game.addPlayer(1n, 'Wolfy');
  game.addPlayer(2n, 'Villager2');
  game.addPlayer(3n, 'Villager3');
  game.addPlayer(4n, 'Villager4');
  game.addPlayer(5n, 'Villager5');
  game.start();
  for (const p of game.players) {
    p.role = ROLE_BIT.Villager;
    p.team = 'Village';
  }
  game.players[0]!.role = ROLE_BIT.Wolf;
  game.players[0]!.team = 'Wolf';
  return game;
}

describe('GameLoop', () => {
  it('sends night menus, resolves the wolf kill via a callback choice, and advances to Day', async () => {
    const { loop, gameManager, sendMessage } = createHarness();
    const game = dealtGame(gameManager);
    const wolf = game.players[0]!;
    const victim = game.players[1]!;

    loop.start(game, 42);
    await vi.advanceTimersByTimeAsync(0); // let the initial menu-sending microtasks flush

    const confirmation = await loop.handleCallback(wolf.id, wolf.id, `nt:${victim.id.toString()}`);
    expect(confirmation).toBeTruthy();
    expect(wolf.choice).toBe(victim.id);

    await vi.advanceTimersByTimeAsync(5000); // night timer

    expect(victim.isDead).toBe(true);
    expect(game.phase).toBe('Day');
    expect(sendMessage).toHaveBeenCalled();
  });

  it("a lynch vote via callback gets tallied and the lynched player's death is announced", async () => {
    const { loop, gameManager, sendMessage } = createHarness();
    const game = dealtGame(gameManager);
    const wolf = game.players[0]!;

    loop.start(game, 42);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000); // night resolves, no kill (wolf never chose)
    await vi.advanceTimersByTimeAsync(0); // day menus flush
    await vi.advanceTimersByTimeAsync(5000); // day resolves, into Lynch

    expect(game.phase).toBe('Lynch');

    const villagers = game.players.filter((p) => p.id !== wolf.id);
    for (const voter of villagers) {
      const confirmation = await loop.handleCallback(voter.id, game.chatId, `vote:${wolf.id.toString()}`);
      expect(confirmation).toBeTruthy();
    }

    await vi.advanceTimersByTimeAsync(5000); // lynch resolves

    expect(wolf.isDead).toBe(true);
    expect(sendMessage.mock.calls.some((call) => typeof call[1] === 'string' && call[1].includes('lynched'))).toBe(true);
  });

  it('finalizes and removes the game from the registry once it ends, without creating a second DB row', async () => {
    const { loop, gameManager, gameRepo } = createHarness();
    const game = dealtGame(gameManager);
    const wolf = game.players[0]!;

    loop.start(game, 42);
    await vi.advanceTimersByTimeAsync(0);

    // Kill every villager one night at a time until only the wolf remains and the game ends. Each
    // full Night -> Day -> Lynch cycle is 3 of these phase steps, and it takes 3 cycles to whittle
    // 4 villagers down to 1 (the win condition needs wolves >= everyone else), so budget generously.
    // Every survivor votes for the same villager each lynch (never the wolf, and an explicit vote -
    // not an abstain, which counts the same as not voting) so nobody gets idle-killed for silently
    // never participating, and the wolf itself never risks getting lynched.
    for (let i = 0; i < 20 && gameManager.get(game.chatId) !== undefined; i++) {
      if (game.phase === 'Night') {
        const target = game.players.find((p) => !p.isDead && p.id !== wolf.id);
        if (target) await loop.handleCallback(wolf.id, wolf.id, `nt:${target.id.toString()}`);
        await vi.advanceTimersByTimeAsync(5000);
      } else if (game.phase === 'Day') {
        await vi.advanceTimersByTimeAsync(5000);
      } else if (game.phase === 'Lynch') {
        const voteTarget = game.players.find((p) => !p.isDead && p.id !== wolf.id);
        if (voteTarget) {
          for (const voter of game.players.filter((p) => !p.isDead)) {
            await loop.handleCallback(voter.id, game.chatId, `vote:${voteTarget.id.toString()}`);
          }
        }
        await vi.advanceTimersByTimeAsync(5000);
      } else {
        break;
      }
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(gameManager.has(game.chatId)).toBe(false);
    expect(gameRepo.createGame).not.toHaveBeenCalled(); // the lobby already created row #42, not the loop
    expect(gameRepo.finalizeGame).toHaveBeenCalledWith(42, game.winningTeam, game.players);
    expect(game.winningTeam).toBe('Wolf');
  });

  it('rejects a night-target callback from a player not in any active game', async () => {
    const { loop } = createHarness();
    const result = await loop.handleCallback(999n, 999n, 'nt:1');
    expect(result).toBeNull();
  });

  it('an ability callback for the wrong role is rejected', async () => {
    const { loop, gameManager } = createHarness();
    const game = dealtGame(gameManager);
    // Advance into Day so ability buttons would be valid if the role matched.
    loop.start(game, 42);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);

    const wolf = game.players[0]!; // not a Mayor
    const result = await loop.handleCallback(wolf.id, wolf.id, 'ability:Mayor');
    expect(result).toBeNull();
  });

  it("a lynched Hunter still gets their final shot, even though applyChoice() would normally reject a dead actor", async () => {
    const { loop, gameManager } = createHarness();
    const game = gameManager.create(1n, { mode: 'Normal', minPlayers: 6 });
    game.addPlayer(1n, 'Hunty');
    game.addPlayer(2n, 'Villager2');
    game.addPlayer(3n, 'Villager3');
    game.addPlayer(4n, 'Villager4');
    game.addPlayer(5n, 'Villager5');
    game.addPlayer(6n, 'Wolfy');
    game.start();
    for (const p of game.players) {
      p.role = ROLE_BIT.Villager;
      p.team = 'Village';
    }
    const hunter = game.players[0]!;
    hunter.role = ROLE_BIT.Hunter;
    const finalTarget = game.players[1]!;
    // A live threat keeps the win condition from ending the game after night 1 (before the lynch
    // this test cares about ever happens) - "no more threats" would otherwise trigger an instant
    // Village win with only Villagers and a Hunter in play.
    game.players[5]!.role = ROLE_BIT.Wolf;
    game.players[5]!.team = 'Wolf';

    loop.start(game, 42);
    await vi.advanceTimersByTimeAsync(0); // night 1 menus
    await vi.advanceTimersByTimeAsync(5000); // night 1 resolves, nobody dies
    await vi.advanceTimersByTimeAsync(0); // day menus
    await vi.advanceTimersByTimeAsync(5000); // day resolves, into Lynch

    // Everyone votes to lynch the Hunter.
    for (const voter of game.players.filter((p) => !p.isDead)) {
      await loop.handleCallback(voter.id, game.chatId, `vote:${hunter.id.toString()}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000); // lynch resolves - the Hunter dies and must shoot

    expect(hunter.isDead).toBe(true);
    expect(hunter.pendingHunterShot).not.toBeNull();

    // A "dead player" callback like applyChoice() would normally reject must still work here.
    const confirmation = await loop.handleCallback(hunter.id, hunter.id, `shoot:${finalTarget.id.toString()}`);
    expect(confirmation).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5000); // the shot window

    expect(finalTarget.isDead).toBe(true);
    expect(hunter.pendingHunterShot).toBeNull();
  });
});
