import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { GameManager } from '../../src/application/game-manager.js';
import { GameLobbyManager } from '../../src/infrastructure/telegram/game-lobby.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';
import type {
  GroupRepository,
  GroupWithConfig,
} from '../../src/infrastructure/persistence/group.repository.js';
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

function fakeGroup(
  telegramId: bigint,
  title: string | null,
  overrides: Partial<GroupWithConfig> = {},
): GroupWithConfig {
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
  } as any as GroupWithConfig;
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
    findByTelegramId: vi.fn(
      async (telegramId: bigint) => groupsStore.get(telegramId.toString()) ?? null,
    ),
    getGroupMembers: vi.fn(async () => []),
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
    findByTelegramId: vi.fn(
      async (telegramId: bigint) => playersStore.get(telegramId.toString()) ?? null,
    ),
    isBanned: vi.fn(async () => false),
    checkSuspension: vi.fn(async () => ({ isSuspended: false, suspendedUntil: null })),
    getGroupPlayers: vi.fn(async () => []),
    getTagOptOutIds: vi.fn(async () => new Set<bigint>()),
  } as unknown as PlayerRepository;

  const gameRepo = {
    createGame: vi.fn(async () => 1),
    recordPlayers: vi.fn(async () => {}),
    finalizeGame: vi.fn(async () => {}),
  } as unknown as GameRepository;

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as import('../../src/infrastructure/logging/logger.js').Logger;

  const gameLoop = {
    start: vi.fn(),
  } as unknown as import('../../src/infrastructure/telegram/game-loop.js').GameLoop;

  const notifyGames = {
    listWaiting: vi.fn(async () => []),
    clearForGroup: vi.fn(async () => {}),
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  } as unknown as import('../../src/infrastructure/persistence/notify-game.repository.js').NotifyGameRepository;

  const lobby = new GameLobbyManager(
    bot,
    gameManager,
    groups,
    players,
    gameRepo,
    translator,
    logger,
    gameLoop,
    notifyGames,
    joinTimeSeconds,
  );

  return {
    lobby,
    bot,
    sendMessage,
    leaveChat,
    gameManager,
    groups,
    groupsStore,
    players,
    gameRepo,
    gameLoop,
    notifyGames,
  };
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
    expect(sendMessage).toHaveBeenCalledWith(101, expect.stringContaining('already running'), {
      parse_mode: 'HTML',
    });
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

    // Alice's join just pushed the 1s countdown out by JOIN_EXTEND_SECONDS (30s) - advance past
    // the actual new deadline rather than the original bare joinTimeSeconds.
    await vi.advanceTimersByTimeAsync(31_000);

    expect(sendMessage).toHaveBeenCalledWith(104, expect.stringContaining('cancelled'), {
      parse_mode: 'HTML',
    });
    expect(gameManager.has(chatId)).toBe(false);
  });

  it('extends the join countdown by 30 seconds every time a player joins', async () => {
    vi.useFakeTimers();
    const { lobby, gameManager } = createHarness(10);
    const chatId = 116n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');

    // 10s base countdown - still open with 1s left to go.
    await vi.advanceTimersByTimeAsync(9000);
    expect(gameManager.has(chatId)).toBe(true);

    // A join right before the original deadline should push it 30s further out (1s + 30s = 31s left).
    await lobby.join(chatId, user(2, 'Alice'));
    await vi.advanceTimersByTimeAsync(30_000); // the original countdown would've ended long ago
    expect(gameManager.has(chatId)).toBe(true); // still open thanks to the +30s extension

    await vi.advanceTimersByTimeAsync(1000); // the last second of the extension elapses
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

  it('publicly announces the squad draft when a TeamDuel game starts, but not for a normal game', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, gameManager, groupsStore } = createHarness(100);
    const chatId = 106n;
    // Group defaults to a forced 'NORMAL' mode preference in this harness (see fakeGroup) - a
    // real group only lets /startgame vs /startchaos through via PLAYER_CHOICE, so TeamDuel needs
    // that here too, or resolveGameMode() would silently downgrade it back to Normal.
    groupsStore.set(
      chatId.toString(),
      fakeGroup(chatId, 'Group', { mode: 'PLAYER_CHOICE', language: 'fr' }),
    );

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'TeamDuel');
    for (let i = 2; i <= 6; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }
    expect(gameManager.get(chatId)!.players).toHaveLength(6);

    await lobby.forceStart(chatId, true);
    await vi.advanceTimersByTimeAsync(1000);

    const squadMsg = sendMessage.mock.calls.find(
      (call) => typeof call[1] === 'string' && call[1].includes('RÉPARTITION DES ÉQUIPES'),
    );
    expect(squadMsg).toBeDefined();
    const text = squadMsg![1] as string;
    expect(text).toContain('Équipe A');
    expect(text).toContain('Équipe B');
    // Every player's name appears somewhere in the announcement (split across the two squads).
    for (let i = 1; i <= 6; i++) {
      const name = i === 1 ? 'Starter' : `Player${i}`;
      expect(text).toContain(name);
    }
  });

  it('never announces a squad draft for a Normal game', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage } = createHarness(100);
    const chatId = 107n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    for (let i = 2; i <= 5; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }
    await lobby.forceStart(chatId, true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(
      sendMessage.mock.calls.some(
        (call) => typeof call[1] === 'string' && call[1].includes('RÉPARTITION DES ÉQUIPES'),
      ),
    ).toBe(false);
  });

  it('tags community members one message at a time, skipping anyone opted out', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, groups, players } = createHarness();
    const chatId = 200n;

    (groups.getGroupMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { telegramId: 10n, username: 'alice', displayName: 'Alice' },
      { telegramId: 11n, username: null, displayName: 'Bob' },
      { telegramId: 12n, username: 'carol', displayName: 'Carol' },
    ]);
    (players.getTagOptOutIds as ReturnType<typeof vi.fn>).mockResolvedValue(new Set([11n]));

    const done = lobby.tagAllMembers(chatId, 'en');
    await vi.advanceTimersByTimeAsync(5000);
    await done;

    const texts = sendMessage.mock.calls.map((call) => call[1]);
    // Header + one message per non-opted-out member (Bob, id 11n, is filtered out).
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain('COMMUNITY CALL');
    expect(texts).toContain('@alice');
    expect(texts).toContain('@carol');
    expect(texts.some((t) => t.includes('Bob'))).toBe(false);
  });

  it('announces the full player roster once the game actually starts', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, gameManager } = createHarness(100);
    const chatId = 106n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    for (let i = 2; i <= 5; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }
    await lobby.forceStart(chatId, true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(gameManager.get(chatId)!.players).toHaveLength(5);
    expect(
      sendMessage.mock.calls.some(
        (call) => typeof call[1] === 'string' && call[1].startsWith('Players in this game (5):'),
      ),
    ).toBe(true);
  });

  it('PMs everyone on the /nextgame waitlist (except the starter) when a new lobby opens', async () => {
    const { lobby, sendMessage, notifyGames } = createHarness();
    const chatId = 109n;
    notifyGames.listWaiting = vi.fn(async () => [1n, 99n]);

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');

    // The starter (1n) is on the waitlist too but shouldn't be PM'd about their own game.
    expect(sendMessage).toHaveBeenCalledWith(99, expect.stringContaining('Group'), {
      parse_mode: 'HTML',
    });
    expect(sendMessage).not.toHaveBeenCalledWith(
      1,
      expect.stringContaining('A new game has started'),
      expect.anything(),
    );
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
    groupsStore.set(
      chatId.toString(),
      fakeGroup(chatId, 'Group', { allowExtend: true, maxExtendSeconds: 20 }),
    );

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    for (let i = 2; i <= 6; i++) {
      await lobby.join(chatId, user(i, `Player${i}`));
    }

    await vi.advanceTimersByTimeAsync(10000); // 50s left
    await lobby.extend(chatId, 2n, false, 100); // clamped to +20

    await vi.advanceTimersByTimeAsync(65000); // would've finished the lobby without the extension
    expect(gameManager.get(chatId)!.phase).toBe('Joining');
  });

  it('honors a group configured for the maximum 300-second extend cap, without clamping it down', async () => {
    vi.useFakeTimers();
    const { lobby, groupsStore, sendMessage } = createHarness(60);
    const chatId = 117n;
    groupsStore.set(
      chatId.toString(),
      fakeGroup(chatId, 'Group', { allowExtend: true, maxExtendSeconds: 300 }),
    );

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    sendMessage.mockClear();

    await lobby.extend(chatId, 2n, false, 300); // not clamped - 300 is within maxExtendSeconds

    expect(sendMessage).toHaveBeenCalledWith(
      117,
      expect.stringContaining('300'),
      expect.anything(),
    );
  });

  it('extend rejects a second request from the same non-admin player', async () => {
    vi.useFakeTimers();
    const { lobby, sendMessage, groupsStore } = createHarness(60);
    const chatId = 112n;
    groupsStore.set(
      chatId.toString(),
      fakeGroup(chatId, 'Group', { allowExtend: true, maxExtendSeconds: 20 }),
    );

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));

    await lobby.extend(chatId, 2n, false, 10);
    sendMessage.mockClear();
    await lobby.extend(chatId, 2n, false, 10);

    expect(sendMessage).toHaveBeenCalledWith(112, expect.stringContaining('extended'), {
      parse_mode: 'HTML',
    });
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

    expect(sendMessage).toHaveBeenCalledWith(113, expect.stringContaining('admin'), {
      parse_mode: 'HTML',
    });
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
    expect(sendMessage).toHaveBeenCalledWith(115, expect.stringContaining('disabled'), {
      parse_mode: 'HTML',
    });
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

    expect(sendMessage).toHaveBeenCalledWith(106, expect.stringContaining('admin'), {
      parse_mode: 'HTML',
    });
    expect(gameManager.get(chatId)!.phase).toBe('Joining');
  });

  it("/players appends a donor badge to a player's name, matching their donation tier", async () => {
    const { lobby, sendMessage, players } = createHarness();
    const chatId = 109n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    await lobby.join(chatId, user(2, 'Alice'));
    await lobby.join(chatId, user(3, 'Bob'));

    (players.findByTelegramId as ReturnType<typeof vi.fn>).mockImplementation(
      async (telegramId: bigint) =>
        telegramId === 2n ? { donationLevel: 3 } : { donationLevel: 0 },
    );
    sendMessage.mockClear();
    await lobby.showPlayers(chatId);

    expect(sendMessage).toHaveBeenCalledWith(
      109,
      expect.stringContaining('<a href="tg://user?id=2">Alice</a> 🥇'),
      { parse_mode: 'HTML' },
    );
    expect(sendMessage).not.toHaveBeenCalledWith(
      109,
      expect.stringContaining('Bob</a> 🥇'),
      expect.anything(),
    );
  });

  it('/players shows plain names when nobody has donated', async () => {
    const { lobby, sendMessage } = createHarness();
    const chatId = 110n;

    await lobby.startGame(chatId, 'Group', { id: 1n, name: 'Starter' }, 'Normal');
    sendMessage.mockClear();
    await lobby.showPlayers(chatId);

    const call = sendMessage.mock.calls.find((c) => c[0] === 110);
    expect(call?.[1]).not.toMatch(/🥉|🥈|🥇/);
  });
});
