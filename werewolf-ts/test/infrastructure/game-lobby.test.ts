import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { GameManager } from '../../src/application/game-manager.js';
import { GameLobbyManager } from '../../src/infrastructure/telegram/game-lobby.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';
import type { GroupRepository, GroupWithConfig } from '../../src/infrastructure/persistence/group.repository.js';
import type { PlayerRepository } from '../../src/infrastructure/persistence/player.repository.js';
import type { GameRepository } from '../../src/infrastructure/persistence/game.repository.js';

let translator: Translator;

beforeEach(async () => {
  const locales = await loadLocales();
  translator = new Translator(locales, getDefaultLocale(locales));
});

afterEach(() => {
  vi.useRealTimers();
});

function fakeGroup(telegramId: bigint, title: string | null): GroupWithConfig {
  return {
    id: Number(telegramId),
    telegramId,
    title,
    username: null,
    language: 'en',
    mode: 'NORMAL',
    dayTimerSeconds: 120,
    nightTimerSeconds: 60,
    lynchTimerSeconds: 60,
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
  };
}

function createHarness(joinTimeSeconds = 5) {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  const bot = { api: { sendMessage } } as unknown as Bot;

  const gameManager = new GameManager();

  const groupsStore = new Map<string, GroupWithConfig>();
  const groups = {
    getOrCreate: vi.fn(async (telegramId: bigint, title?: string | null) => {
      const key = telegramId.toString();
      let g = groupsStore.get(key);
      if (!g) {
        g = fakeGroup(telegramId, title ?? null);
        groupsStore.set(key, g);
      }
      return g;
    }),
    findByTelegramId: vi.fn(async (telegramId: bigint) => groupsStore.get(telegramId.toString()) ?? null),
  } as unknown as GroupRepository;

  const playersStore = new Map<string, { id: number; telegramId: bigint }>();
  const players = {
    upsert: vi.fn(async (telegramId: bigint) => {
      const key = telegramId.toString();
      let p = playersStore.get(key);
      if (!p) {
        p = { id: playersStore.size + 1, telegramId };
        playersStore.set(key, p);
      }
      return p;
    }),
    findByTelegramId: vi.fn(async (telegramId: bigint) => playersStore.get(telegramId.toString()) ?? null),
    isBanned: vi.fn(async () => false),
  } as unknown as PlayerRepository;

  const gameRepo = {
    createGame: vi.fn(async () => 1),
    recordPlayers: vi.fn(async () => {}),
    finalizeGame: vi.fn(async () => {}),
  } as unknown as GameRepository;

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('../../src/infrastructure/logging/logger.js').Logger;

  const gameLoop = { start: vi.fn() } as unknown as import('../../src/infrastructure/telegram/game-loop.js').GameLoop;

  const lobby = new GameLobbyManager(bot, gameManager, groups, players, gameRepo, translator, logger, gameLoop, joinTimeSeconds);

  return { lobby, bot, sendMessage, gameManager, groups, players, gameRepo, gameLoop };
}

function user(id: number, firstName: string) {
  return { id: BigInt(id), firstName };
}

describe('GameLobbyManager', () => {
  it('starts a lobby with a join button and lets players join', async () => {
    const { lobby, sendMessage, gameManager } = createHarness();
    const chatId = 100n;

    await lobby.startGame(chatId, 'My Group', { id: 1n, name: 'Starter' }, 'Normal');

    expect(sendMessage).toHaveBeenCalledWith(
      100,
      expect.stringContaining('Starter'),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );

    await lobby.join(chatId, user(2, 'Alice'));
    await lobby.join(chatId, user(3, 'Bob'));

    const game = gameManager.get(chatId)!;
    expect(game.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('sends GameAlreadyRunning instead of creating a second game for the same chat', async () => {
    const { lobby, sendMessage, gameManager } = createHarness();
    const chatId = 101n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    sendMessage.mockClear();
    await lobby.startGame(chatId, 'Group', { id: 4n, name: 'Other' }, 'Normal');

    expect(sendMessage).toHaveBeenCalledWith(101, expect.stringContaining('already running'));
    expect(gameManager.size).toBe(1);
  });

  it('rejects a second player joining with the same display name', async () => {
    const { lobby, sendMessage, gameManager } = createHarness();
    const chatId = 102n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    sendMessage.mockClear();
    await lobby.join(chatId, user(3, 'Alice'));

    expect(sendMessage).toHaveBeenCalledWith(102, expect.stringContaining('Alice'));
    expect(gameManager.get(chatId)!.players).toHaveLength(1);
  });

  it('removes a player who flees during the joining lobby', async () => {
    const { lobby, gameManager } = createHarness();
    const chatId = 103n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    expect(gameManager.get(chatId)!.players).toHaveLength(1);

    await lobby.flee(chatId, { id: 2n, name: 'Alice' });
    expect(gameManager.get(chatId)!.players).toHaveLength(0);
  });

  it('cancels the game if too few players joined by the time the countdown ends', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, gameManager } = createHarness(1);
    const chatId = 104n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    sendMessage.mockClear();

    await vi.advanceTimersByTimeAsync(1000);

    expect(sendMessage).toHaveBeenCalledWith(104, expect.stringContaining('cancelled'));
    expect(gameManager.has(chatId)).toBe(false);
  });

  it('force-starting deals roles, PMs every player, and hands the game off to the night loop', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, gameManager, gameRepo } = createHarness(100);
    const chatId = 105n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    for (let i = 2; i <= 6; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }
    expect(gameManager.get(chatId)!.players).toHaveLength(5);

    await lobby.forceStart(chatId, true);
    sendMessage.mockClear();
    await vi.advanceTimersByTimeAsync(1000);

    const game = gameManager.get(chatId)!;
    expect(game.phase).toBe('Night');
    expect(game.dayNumber).toBe(1);
    expect(gameRepo.createGame).toHaveBeenCalledTimes(1);
    expect(gameRepo.recordPlayers).toHaveBeenCalledTimes(1);
    // 5 role PMs + the "Night falls" group message.
    expect(sendMessage.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("a non-admin can't force-start the game", async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, gameManager } = createHarness(100);
    const chatId = 106n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    sendMessage.mockClear();
    await lobby.forceStart(chatId, false);

    expect(sendMessage).toHaveBeenCalledWith(106, expect.stringContaining('admin'));
    expect(gameManager.get(chatId)!.phase).toBe('Joining');
  });
});
