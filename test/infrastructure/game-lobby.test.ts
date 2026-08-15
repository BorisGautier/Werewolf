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

function fakeGroup(telegramId: bigint, title: string | null, overrides: Partial<GroupWithConfig> = {}): GroupWithConfig {
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
    showRolesEnd: 'ALL',
    showIds: false,
    shufflePlayerList: false,
    randomMode: false,
    secretLynch: false,
    secretLynchShowVotes: false,
    secretLynchShowVoters: false,
    botInGroup: true,
    banned: false,
    isApproved: true,
    memberCount: null,
    preferred: false,
    inviteLink: null,
    defaultGifPackId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    disabledRoles: [],
    ...overrides,
  };
}

function createHarness(joinTimeSeconds = 5) {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  const leaveChat = vi.fn().mockResolvedValue(true);
  const bot = { api: { sendMessage, leaveChat } } as unknown as Bot;

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
    checkSuspension: vi.fn(async () => ({ isSuspended: false, suspendedUntil: null })),
  } as unknown as PlayerRepository;

  const gameRepo = {
    createGame: vi.fn(async () => 1),
    recordPlayers: vi.fn(async () => {}),
    finalizeGame: vi.fn(async () => {}),
  } as unknown as GameRepository;

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import('../../src/infrastructure/logging/logger.js').Logger;

  const gameLoop = { start: vi.fn() } as unknown as import('../../src/infrastructure/telegram/game-loop.js').GameLoop;

  const notifyGames = {
    listWaiting: vi.fn(async () => []),
    clearForGroup: vi.fn(async () => {}),
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  } as unknown as import('../../src/infrastructure/persistence/notify-game.repository.js').NotifyGameRepository;

  const lobby = new GameLobbyManager(bot, gameManager, groups, players, gameRepo, translator, logger, gameLoop, notifyGames, joinTimeSeconds);

  return { lobby, bot, sendMessage, leaveChat, gameManager, groups, groupsStore, players, gameRepo, gameLoop, notifyGames };
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
    expect(game.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob', 'Starter']);
  });

  it('auto-joins a second player who types /startgame while joining, and sends GameAlreadyRunning once in progress', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, gameManager } = createHarness();
    const chatId = 101n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.startGame(chatId, 'Group', { id: 4n, name: 'Other' }, 'Normal');
    expect(gameManager.get(chatId)!.players).toHaveLength(2);

    for (let i = 5; i <= 7; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }
    await lobby.forceStart(chatId, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(gameManager.get(chatId)!.phase).toBe('Night');

    sendMessage.mockClear();
    await lobby.startGame(chatId, 'Group', { id: 99n, name: 'Late' }, 'Normal');
    expect(sendMessage).toHaveBeenCalledWith(101, expect.stringContaining('already running'));
  });

  it("refuses to start a game and leaves a group that's been /bangroup'd, even without creating a game", async () => {
    const { lobby, sendMessage, leaveChat, gameManager, groupsStore } = createHarness();
    const chatId = 111n;
    groupsStore.set(chatId.toString(), fakeGroup(chatId, 'Banned Group', { banned: true }));

    await lobby.startGame(chatId, 'Banned Group', { id: 1n, name: 'Starter' }, 'Normal');

    expect(leaveChat).toHaveBeenCalledWith(111);
    expect(gameManager.has(chatId)).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('disambiguates a second player joining with the same display name', async () => {
    const { lobby, gameManager } = createHarness();
    const chatId = 102n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    await lobby.join(chatId, user(3, 'Alice'));

    const players = gameManager.get(chatId)!.players;
    expect(players).toHaveLength(3);
    expect(players.map((p) => p.name)).toContain('Alice (2)');
  });

  it('removes a player who flees during the joining lobby', async () => {
    const { lobby, gameManager } = createHarness();
    const chatId = 103n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    expect(gameManager.get(chatId)!.players).toHaveLength(2);

    await lobby.flee(chatId, { id: 2n, name: 'Alice' });
    expect(gameManager.get(chatId)!.players).toHaveLength(1);
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
    for (let i = 2; i <= 5; i++) {
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

  it('PMs everyone on the /nextgame waitlist (except the starter) when a new lobby opens', async () => {
    const { lobby, sendMessage, notifyGames } = createHarness();
    const chatId = 109n;
    notifyGames.listWaiting = vi.fn(async () => [1n, 99n]);

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');

    // The starter (1n) is on the waitlist too but shouldn't be PM'd about their own game.
    expect(sendMessage).toHaveBeenCalledWith(99, expect.stringContaining('Group'));
    expect(sendMessage).not.toHaveBeenCalledWith(1, expect.stringContaining('A new game has started'));
  });

  it('clears the /nextgame waitlist once a lobby locks in and deals roles', async () => {
    vi.useFakeTimers();
    const { lobby, gameManager, notifyGames } = createHarness(100);
    const chatId = 110n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    for (let i = 2; i <= 6; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }
    await lobby.forceStart(chatId, true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(gameManager.get(chatId)!.phase).toBe('Night');
    expect(notifyGames.clearForGroup).toHaveBeenCalledWith(chatId);
  });

  it('extend pushes the join countdown out for a player in the lobby, up to MaxExtend', async () => {
    vi.useFakeTimers();
    const { lobby, gameManager, groupsStore } = createHarness(60);
    const chatId = 111n;
    groupsStore.set(chatId.toString(), fakeGroup(chatId, 'Group', { allowExtend: true, maxExtendSeconds: 20 }));

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    for (let i = 2; i <= 6; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }

    await vi.advanceTimersByTimeAsync(10000); // 50s left
    await lobby.extend(chatId, 2n, false, 100); // clamped to +20

    await vi.advanceTimersByTimeAsync(65000); // would've finished the lobby without the extension
    expect(gameManager.get(chatId)!.phase).toBe('Joining');
  });

  it("extend rejects a second request from the same non-admin player", async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, groupsStore } = createHarness(60);
    const chatId = 112n;
    groupsStore.set(chatId.toString(), fakeGroup(chatId, 'Group', { allowExtend: true, maxExtendSeconds: 20 }));

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));

    await lobby.extend(chatId, 2n, false, 10);
    sendMessage.mockClear();
    await lobby.extend(chatId, 2n, false, 10);

    expect(sendMessage).toHaveBeenCalledWith(112, expect.stringContaining('extended'));
  });

  it('extend refuses a non-admin when AllowExtend is off', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, groupsStore } = createHarness(60);
    const chatId = 113n;
    groupsStore.set(chatId.toString(), fakeGroup(chatId, 'Group', { allowExtend: false }));

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    sendMessage.mockClear();

    await lobby.extend(chatId, 2n, false, 10);

    expect(sendMessage).toHaveBeenCalledWith(113, expect.stringContaining('admin'));
  });

  it('flee is always allowed while still in the joining lobby, even with AllowFlee off', async () => {
    const { lobby, gameManager, groupsStore } = createHarness();
    const chatId = 114n;
    groupsStore.set(chatId.toString(), fakeGroup(chatId, 'Group', { allowFlee: false }));

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));

    await lobby.flee(chatId, { id: 2n, name: 'Alice' });
    expect(gameManager.get(chatId)!.players).toHaveLength(1);
  });

  it('flee refuses to leave a running game when AllowFlee is off', async () => {
    vi.useFakeTimers();
    const { lobby, gameManager, sendMessage, groupsStore } = createHarness(100);
    const chatId = 115n;
    groupsStore.set(chatId.toString(), fakeGroup(chatId, 'Group', { allowFlee: false }));

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    for (let i = 2; i <= 5; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }
    await lobby.forceStart(chatId, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(gameManager.get(chatId)!.phase).toBe('Night');

    const playersBefore = gameManager.get(chatId)!.players.length;
    sendMessage.mockClear();
    await lobby.flee(chatId, { id: 2n, name: 'Player2' });

    expect(gameManager.get(chatId)!.players).toHaveLength(playersBefore);
    expect(sendMessage).toHaveBeenCalledWith(115, expect.stringContaining('disabled'));
  });

  it('smite removes a player from the joining lobby', async () => {
    const { lobby, gameManager } = createHarness();
    const chatId = 107n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    expect(gameManager.get(chatId)!.players).toHaveLength(2);

    const removed = await lobby.smite(chatId, { id: 2n, name: 'Alice' });
    expect(removed).toBe(true);
    expect(gameManager.get(chatId)!.players).toHaveLength(1);
  });

  it('smite reports false when there is no game running or the target is not playing', async () => {
    const { lobby } = createHarness();
    const chatId = 108n;

    expect(await lobby.smite(chatId, { id: 1n, name: 'Nobody' })).toBe(false);
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

  it("/players appends a donor badge to a player's name, matching their donation tier", async () => {
    const { lobby, sendMessage, players } = createHarness();
    const chatId = 109n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    await lobby.join(chatId, user(3, 'Bob'));

    (players.findByTelegramId as ReturnType<typeof vi.fn>).mockImplementation(async (telegramId: bigint) =>
      telegramId === 2n ? { donationLevel: 3 } : { donationLevel: 0 },
    );
    sendMessage.mockClear();
    await lobby.showPlayers(chatId);

    expect(sendMessage).toHaveBeenCalledWith(109, expect.stringContaining('Alice 🥇'));
    expect(sendMessage).not.toHaveBeenCalledWith(109, expect.stringContaining('Bob 🥇'));
  });

  it("/players shows plain names when nobody has donated", async () => {
    const { lobby, sendMessage } = createHarness();
    const chatId = 110n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    sendMessage.mockClear();
    await lobby.showPlayers(chatId);

    const call = sendMessage.mock.calls.find((c) => c[0] === 110);
    expect(call?.[1]).not.toMatch(/🥉|🥈|🥇/);
  });
});
