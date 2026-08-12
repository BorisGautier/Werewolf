/**
 * End-to-end stress simulation: deals real games (via `balance()`, same as
 * production), then drives every single night/day/lynch menu by feeding
 * `GameLoop.handleCallback()` a randomly-chosen *valid* button for whoever
 * was actually offered one - exactly the callback data a real Telegram
 * client would send when a player taps a button. No mocking of domain
 * logic: only `bot.api.sendMessage`/`sendAnimation` are stubbed (there is
 * no live Telegram connection here - see REQUIREMENTS.md for why that part
 * can't be exercised in this environment), and every stubbed send that
 * carries an inline keyboard immediately "clicks" one of its buttons so the
 * game keeps running unattended through to a win condition.
 *
 * This is not a correctness oracle for *individual* role interactions -
 * those are covered by the focused unit tests elsewhere under `test/`. Its
 * job is different: hammer the full state machine across hundreds of random
 * player counts and role mixes to catch what only shows up at
 * integration scale - an unhandled exception, a phase that never resolves
 * (`vi.runAllTimersAsync()`'s own loop-limit guard catches infinite
 * setTimeout chains), or a game that ends without a `winningTeam`.
 *
 * Iteration count is intentionally small by default so `npm test` stays
 * fast; override with `SIM_GAMES=500 npx vitest run test/simulation` for a
 * much deeper sweep (that's what backs the audit's playability claims).
 */
import { randomInt } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { GameManager } from '../../src/application/game-manager.js';
import { Game } from '../../src/domain/game/game.aggregate.js';
import { ROLE_NAMES, roleName } from '../../src/domain/roles/role.js';
import { alivePlayers } from '../../src/domain/game/player.js';
import { GameLoop } from '../../src/infrastructure/telegram/game-loop.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';
import type { GroupRepository, GroupWithConfig } from '../../src/infrastructure/persistence/group.repository.js';
import type { GameRepository } from '../../src/infrastructure/persistence/game.repository.js';
import type { AchievementRepository } from '../../src/infrastructure/persistence/achievement.repository.js';
import type { Logger } from '../../src/infrastructure/logging/logger.js';

const ITERATIONS = Number(process.env.SIM_GAMES ?? 40);
/** Real seconds (advanced instantly via fake timers) - kept nonzero so timer-dependent
 * code (e.g. the day-1 min-duration override) exercises real setTimeout chains. */
const TIMER_SECONDS = 3;

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
    title: 'Sim Group',
    username: null,
    language: 'en',
    mode: 'NORMAL',
    dayTimerSeconds: TIMER_SECONDS,
    nightTimerSeconds: TIMER_SECONDS,
    lynchTimerSeconds: TIMER_SECONDS,
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
    burningOverkill: true,
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

interface SimResult {
  playerCount: number;
  chaos: boolean;
  roles: string[];
  winningTeam?: string;
  crashed: boolean;
  errors: unknown[];
  stalled: boolean;
}

/** Flattens a grammy `InlineKeyboard`-shaped `reply_markup` into its buttons. */
function buttonsOf(replyMarkup: unknown): { text: string; callback_data: string }[] {
  const kb = replyMarkup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
  return kb?.inline_keyboard?.flat() ?? [];
}

async function runOneGame(chatId: bigint, playerCount: number, chaos: boolean): Promise<SimResult> {
  const errors: unknown[] = [];
  const logger = {
    info: () => {},
    warn: () => {},
    error: (obj: unknown) => errors.push(obj),
  } as unknown as Logger;

  const group = fakeGroup();
  const groups = {
    getOrCreate: vi.fn(async () => group),
    findByTelegramId: vi.fn(async () => group),
  } as unknown as GroupRepository;

  const gameRepo = {
    createGame: vi.fn(async () => 1),
    recordPlayers: vi.fn(async () => {}),
    finalizeGame: vi.fn(async () => new Date()),
    recordKill: vi.fn(async () => {}),
  } as unknown as GameRepository;

  const achievements = {
    unlock: vi.fn(async () => false),
    recordGameResult: vi.fn(async () => new Map()),
  } as unknown as AchievementRepository;

  const gameManager = new GameManager();
  const game: Game = gameManager.create(chatId, { mode: 'Normal', minPlayers: 5, burningOverkill: true });
  for (let i = 1; i <= playerCount; i++) {
    game.addPlayer(BigInt(i), `Player${i}`);
  }

  // `sendMessage` closes over `loop` below by reference - safe even though it's declared
  // afterward, since `sendMessage` itself is only ever invoked once `loop` is assigned.
  const sendMessage = vi.fn(async (recipientChatId: number, _text: string, options?: { reply_markup?: unknown }) => {
    const buttons = buttonsOf(options?.reply_markup);
    if (buttons.length === 0) return { message_id: 1 };

    if (BigInt(recipientChatId) === chatId) {
      // Sent to the group chat: this is the lynch-vote menu everyone sees, so every living
      // player "clicks" their own independently-chosen button on it.
      for (const p of alivePlayers(game.players)) {
        const pick = buttons[randomInt(buttons.length)]!;
        await loop.handleCallback(p.id, chatId, pick.callback_data);
      }
    } else {
      // A PM: the recipient chat id *is* the player's telegram id.
      const pick = buttons[randomInt(buttons.length)]!;
      await loop.handleCallback(BigInt(recipientChatId), BigInt(recipientChatId), pick.callback_data);
    }
    return { message_id: 1 };
  });
  const bot = { api: { sendMessage, sendAnimation: vi.fn(async () => ({ message_id: 1 })) } } as unknown as Bot;

  const loop = new GameLoop(bot, gameManager, groups, gameRepo, achievements, translator, logger);

  game.start({ chaos });
  const roles = game.players.map((p) => roleName(p.role));

  loop.start(game, 1);
  await vi.advanceTimersByTimeAsync(0);

  let stalled = false;
  try {
    await vi.runAllTimersAsync();
  } catch (err) {
    // vitest's fake-timer loop-limit guard trips on a runaway setTimeout chain - i.e. the
    // game never reached a phase with nothing left to schedule. Treat as a stall, not a crash.
    stalled = true;
    errors.push(err);
  }

  return {
    playerCount,
    chaos,
    roles,
    winningTeam: game.winningTeam,
    crashed: errors.length > 0 && !stalled,
    errors,
    stalled,
  };
}

describe('full game stress simulation', () => {
  it(
    `plays ${ITERATIONS} complete random games end-to-end without a live Telegram connection`,
    async () => {
      const results: SimResult[] = [];
      const seenRoles = new Set<string>();

      for (let i = 0; i < ITERATIONS; i++) {
        const playerCount = 5 + (i % 26); // cycle 5..30 for broad size coverage
        const chaos = i % 3 === 0;
        const result = await runOneGame(BigInt(1_000_000 + i), playerCount, chaos);
        results.push(result);
        for (const r of result.roles) seenRoles.add(r);
      }

      const crashes = results.filter((r) => r.crashed);
      const stalls = results.filter((r) => r.stalled);
      const noWinner = results.filter((r) => !r.crashed && !r.stalled && !r.winningTeam);
      const missingRoles = ROLE_NAMES.filter((name) => !seenRoles.has(name));
      const winTeamCounts = new Map<string, number>();
      for (const r of results) {
        if (!r.winningTeam) continue;
        winTeamCounts.set(r.winningTeam, (winTeamCounts.get(r.winningTeam) ?? 0) + 1);
      }

      // eslint-disable-next-line no-console
      console.log(
        [
          `Simulated ${results.length} games (sizes 5-30, ${results.filter((r) => r.chaos).length} chaos mode).`,
          `Crashes: ${crashes.length}. Stalls: ${stalls.length}. Ended with no winningTeam: ${noWinner.length}.`,
          `Roles exercised: ${seenRoles.size}/${ROLE_NAMES.length}${missingRoles.length ? ` (never dealt: ${missingRoles.join(', ')})` : ''}.`,
          `Winning teams: ${[...winTeamCounts.entries()].map(([team, n]) => `${team}=${n}`).join(', ')}.`,
          ...crashes.map((c) => {
            const errObj = (c.errors[0] as { err?: unknown })?.err ?? c.errors[0];
            const stack = errObj instanceof Error ? errObj.stack : String(errObj);
            return `  CRASH size=${c.playerCount} chaos=${c.chaos} roles=[${c.roles.join(',')}]:\n${stack}`;
          }),
          ...stalls.map((c) => `  STALL size=${c.playerCount} chaos=${c.chaos} roles=[${c.roles.join(',')}]`),
          ...noWinner.map((c) => `  NO WINNER size=${c.playerCount} chaos=${c.chaos} roles=[${c.roles.join(',')}]`),
        ].join('\n'),
      );

      expect(crashes, `${crashes.length} game(s) crashed - see console output above for role compositions`).toHaveLength(0);
      expect(stalls, `${stalls.length} game(s) never reached a resolution - see console output above`).toHaveLength(0);
      expect(noWinner, `${noWinner.length} game(s) ended without a winning team`).toHaveLength(0);
    },
    // A few hundred simulated games can take a while even with fake timers (lots of microtask
    // churn) - give this test more headroom than vitest's 5s default.
    120_000,
  );
});
