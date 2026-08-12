/**
 * End-to-end stress simulation: deals real games (via `balance()`, same as
 * production), then drives every single night/day/lynch menu by feeding
 * `GameLoop.handleCallback()` a valid button for whoever was actually
 * offered one - exactly the callback data a real Telegram client would send
 * when a player taps a button. No mocking of domain logic: only
 * `bot.api.sendMessage`/`sendAnimation` are stubbed (there is no live
 * Telegram connection here - see REQUIREMENTS.md for why that part can't be
 * exercised in this environment), and every stubbed send that carries an
 * inline keyboard immediately "clicks" a button so the game keeps running
 * unattended through to a win condition.
 *
 * This is not a correctness oracle for *individual* role interactions -
 * those are covered by the focused unit tests elsewhere under `test/`. Its
 * job is different: hammer the full state machine across thousands of
 * random player counts and role mixes to catch what only shows up at
 * integration scale - an unhandled exception, a phase that never resolves
 * (`vi.runAllTimersAsync()`'s own loop-limit guard catches infinite
 * setTimeout chains), or a game that ends without a `winningTeam`.
 *
 * Night/day menus are always answered with an independent random valid
 * choice per player - that alone gives every role's resolver a wide spread
 * of targets across thousands of games. The lynch vote gets more deliberate
 * treatment via `votingBias`, because purely random per-player voting
 * rarely *concentrates* votes the way real players do, and several distinct
 * lynch resolutions (`Tied`, `NoVotes`, `PrinceSurvived`, `TannerWinByLynch`)
 * only ever happen under a concentrated or split vote - see the six
 * `votingBias` campaigns below, which exist specifically to hit each one at
 * least once rather than hoping raw randomness stumbles onto them.
 *
 * Scale (game count per campaign) is intentionally small by default so
 * `npm test` stays fast; override with `SIM_SCALE=200 npx vitest run
 * test/simulation` (run with a couple hundred to a couple thousand for a
 * multiple-thousand-game sweep - that's what backs the audit's "every role,
 * every win condition, every lynch outcome" claims).
 */
import { randomInt } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { GameManager } from '../../src/application/game-manager.js';
import { Game } from '../../src/domain/game/game.aggregate.js';
import { ROLE_BIT, ROLE_NAMES, roleName, type RoleName } from '../../src/domain/roles/role.js';
import { alivePlayers } from '../../src/domain/game/player.js';
import { getTeamForRole } from '../../src/domain/game/team.js';
import { GameLoop } from '../../src/infrastructure/telegram/game-loop.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';
import type { GroupRepository, GroupWithConfig } from '../../src/infrastructure/persistence/group.repository.js';
import type { GameRepository } from '../../src/infrastructure/persistence/game.repository.js';
import type { AchievementRepository } from '../../src/infrastructure/persistence/achievement.repository.js';
import type { Logger } from '../../src/infrastructure/logging/logger.js';

const SCALE = Number(process.env.SIM_SCALE ?? 1);
/** Real seconds (advanced instantly via fake timers) - kept nonzero so timer-dependent
 * code (e.g. the day-1 min-duration override) exercises real setTimeout chains. */
const TIMER_SECONDS = 3;

/** Every `winningTeam` the domain layer can ever produce - see `win-condition.ts`'s `end(...)`
 * calls and `lynch.ts`'s direct `declareWinner(players, 'Tanner')`. */
const ALL_WIN_TEAMS = ['Village', 'Wolf', 'Tanner', 'Cult', 'SerialKiller', 'Arsonist', 'Lovers', 'NoOne', 'SKHunter'] as const;
/** Every `LynchResolution['outcome']` from `lynch.ts`. `Lynched` isn't separately tracked here -
 * it's the overwhelmingly common case every `concentrate`-biased game produces, so its coverage
 * is implicit in "thousands of concentrate-campaign games didn't crash". */
const TRACKED_LYNCH_OUTCOMES = ['Tied', 'NoVotes', 'PacifistPeace', 'PrinceSurvived', 'TannerWinByLynch'] as const;
const LYNCH_OUTCOME_KEY: Record<(typeof TRACKED_LYNCH_OUTCOMES)[number], string> = {
  Tied: 'LynchTied',
  NoVotes: 'NoOneCastLynch',
  PacifistPeace: 'PacifistNoLynchNow',
  PrinceSurvived: 'PrinceSurvivedLynch',
  TannerWinByLynch: '', // inferred from winningTeam === 'Tanner' instead - see below.
};
/** Reverse of `LYNCH_OUTCOME_KEY` - translation key -> outcome name, so the `translate()` spy
 * below can record outcome names (what the report and assertions key off) rather than raw
 * locale keys. */
const OUTCOME_BY_KEY = new Map(
  Object.entries(LYNCH_OUTCOME_KEY)
    .filter(([, key]) => key)
    .map(([outcome, key]) => [key, outcome]),
);

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

/** How the simulated group votes on a lynch. Night/day menus always get an independent random
 * valid choice per player regardless of this - only the group-wide lynch vote is biased, since
 * that's the only decision point where "everyone picks independently at random" structurally
 * can't reach several real outcomes (a clean majority, a tie, universal abstention). */
type VotingBias =
  | { kind: 'random' }
  | { kind: 'concentrate' } // everyone votes the same (randomly chosen) target - hunts a clean `Lynched`/`PrinceSurvived`.
  | { kind: 'split' } // the group splits evenly between two targets - hunts `Tied`.
  | { kind: 'abstain' } // nobody casts a real vote - hunts `NoVotes`.
  | { kind: 'targetRole'; role: RoleName }; // everyone votes whoever currently holds this role, if alive - hunts `TannerWinByLynch`/`PrinceSurvived` reliably.

interface SimResult {
  playerCount: number;
  chaos: boolean;
  bias: string;
  roles: string[];
  winningTeam?: string;
  /** `game.phase` at the moment the timer queue drained - diagnostic for the `noWinner` case:
   * distinguishes "the loop is stuck mid-phase and something silently stopped scheduling more
   * work" (phase !== 'Ended') from "the game finished but nobody was ever marked as winningTeam"
   * (phase === 'Ended', which `checkWinCondition()`'s code shows should be structurally
   * impossible - `finished: true` is only ever returned alongside a `winningTeam`). */
  finalPhase: string;
  aliveCount: number;
  dayNumber: number;
  lynchOutcomesSeen: Set<string>;
  crashed: boolean;
  errors: unknown[];
  stalled: boolean;
}

/** Flattens a grammy `InlineKeyboard`-shaped `reply_markup` into its buttons. */
function buttonsOf(replyMarkup: unknown): { text: string; callback_data: string }[] {
  const kb = replyMarkup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
  return kb?.inline_keyboard?.flat() ?? [];
}

interface RunOneGameOptions {
  /** Deals these exact roles (in order, one per player) instead of using `balance()` - for
   * deterministic-ish scenario tests that need a specific role on the table rather than hoping
   * the balancer's weighting happens to include it. */
  forceRoles?: RoleName[];
  randomLynchOnTie?: boolean;
}

async function runOneGame(
  chatId: bigint,
  playerCount: number,
  chaos: boolean,
  bias: VotingBias,
  runOpts: RunOneGameOptions = {},
): Promise<SimResult> {
  // Re-installed fresh per game rather than once for the whole test: sinon's fake-timer
  // implementation (what `vi.useFakeTimers()` wraps) accumulates internal bookkeeping for every
  // timer ever created across the test's lifetime, which made a single multi-thousand-game test
  // degrade super-linearly - resetting it here keeps each game's cost roughly constant.
  vi.useFakeTimers();

  const errors: unknown[] = [];
  const logger = {
    info: () => {},
    warn: () => {},
    error: (obj: unknown) => errors.push(obj),
  } as unknown as Logger;

  const lynchOutcomesSeen = new Set<string>();
  // Shadow the shared translator's `translate` for the duration of this one game, to observe
  // which lynch-resolution message keys actually fired - a precise, non-invasive way to confirm
  // e.g. a `Tied` vote really did resolve as `Tied` rather than trusting the bias alone.
  const originalTranslate = translator.translate.bind(translator);
  translator.translate = ((localeCode: string, key: string, ...args: unknown[]) => {
    const outcome = OUTCOME_BY_KEY.get(key);
    if (outcome) lynchOutcomesSeen.add(outcome);
    return originalTranslate(localeCode, key, ...args);
  }) as Translator['translate'];

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
  const game: Game = gameManager.create(chatId, {
    mode: 'Normal',
    minPlayers: 5,
    maxPlayers: 35,
    burningOverkill: true,
    ...(runOpts.randomLynchOnTie !== undefined ? { randomLynchOnTie: runOpts.randomLynchOnTie } : {}),
  });
  for (let i = 1; i <= playerCount; i++) {
    game.addPlayer(BigInt(i), `Player${i}`);
  }

  function chooseLynchVotes(buttons: { text: string; callback_data: string }[]): Map<bigint, string> {
    const alive = alivePlayers(game.players);
    const nonAbstain = buttons.filter((b) => !b.callback_data.endsWith(':abstain'));
    const votes = new Map<bigint, string>();

    switch (bias.kind) {
      case 'abstain': {
        const abstainBtn = buttons.find((b) => b.callback_data.endsWith(':abstain')) ?? buttons[0]!;
        for (const p of alive) votes.set(p.id, abstainBtn.callback_data);
        break;
      }
      case 'concentrate': {
        const pick = nonAbstain[randomInt(nonAbstain.length || 1)] ?? buttons[0]!;
        for (const p of alive) votes.set(p.id, pick.callback_data);
        break;
      }
      case 'split': {
        if (nonAbstain.length >= 2) {
          const [a, b] = nonAbstain;
          alive.forEach((p, i) => votes.set(p.id, (i % 2 === 0 ? a : b)!.callback_data));
        } else {
          const pick = nonAbstain[0] ?? buttons[0]!;
          for (const p of alive) votes.set(p.id, pick.callback_data);
        }
        break;
      }
      case 'targetRole': {
        const target = alive.find((p) => roleName(p.role) === bias.role);
        const btn = target ? buttons.find((b) => b.callback_data === `vote:${target.id.toString()}`) : undefined;
        if (btn) {
          for (const p of alive) votes.set(p.id, btn.callback_data);
        } else {
          for (const p of alive) votes.set(p.id, buttons[randomInt(buttons.length)]!.callback_data);
        }
        break;
      }
      case 'random':
      default:
        for (const p of alive) votes.set(p.id, buttons[randomInt(buttons.length)]!.callback_data);
    }
    return votes;
  }

  // `sendMessage` closes over `loop` below by reference - safe even though it's declared
  // afterward, since `sendMessage` itself is only ever invoked once `loop` is assigned.
  const sendMessage = vi.fn(async (recipientChatId: number, _text: string, options?: { reply_markup?: unknown }) => {
    const buttons = buttonsOf(options?.reply_markup);
    if (buttons.length === 0) return { message_id: 1 };

    if (BigInt(recipientChatId) === chatId) {
      // Sent to the group chat: this is the lynch-vote menu everyone sees.
      for (const [playerId, data] of chooseLynchVotes(buttons)) {
        await loop.handleCallback(playerId, chatId, data);
      }
    } else {
      // A PM: the recipient chat id *is* the player's telegram id. Night/day/ability menus
      // always get an independent random valid choice, regardless of the lynch `bias`.
      const pick = buttons[randomInt(buttons.length)]!;
      await loop.handleCallback(BigInt(recipientChatId), BigInt(recipientChatId), pick.callback_data);
    }
    return { message_id: 1 };
  });
  const bot = { api: { sendMessage, sendAnimation: vi.fn(async () => ({ message_id: 1 })) } } as unknown as Bot;

  const loop = new GameLoop(bot, gameManager, groups, gameRepo, achievements, translator, logger);

  game.start({ chaos });
  if (runOpts.forceRoles) {
    // Overwrite the balancer's pick with an exact, deliberately chosen role set - see
    // `RunOneGameOptions.forceRoles`'s doc comment.
    runOpts.forceRoles.forEach((name, i) => {
      const role = ROLE_BIT[name];
      game.players[i]!.role = role;
      game.players[i]!.team = getTeamForRole(role);
    });
  }
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

  translator.translate = originalTranslate;

  const winningTeam = game.winningTeam;
  if (winningTeam === 'Tanner') lynchOutcomesSeen.add('TannerWinByLynch');

  return {
    playerCount,
    chaos,
    bias: bias.kind === 'targetRole' ? `targetRole:${bias.role}` : bias.kind,
    roles,
    ...(winningTeam !== undefined ? { winningTeam } : {}),
    finalPhase: game.phase,
    aliveCount: alivePlayers(game.players).length,
    dayNumber: game.dayNumber,
    lynchOutcomesSeen,
    crashed: errors.length > 0 && !stalled,
    errors,
    stalled,
  };
}

/** A campaign is a batch of games sharing a voting bias - lets the report attribute a rare
 * outcome (or a crash) to the strategy that surfaced it. */
interface Campaign {
  name: string;
  count: number;
  bias: VotingBias;
}

/** Ceiling on games per `it()` block. Even with a fresh `vi.useFakeTimers()` per game (see
 * `runOneGame`), per-game cost still climbs the longer a single test runs - some vitest/vi
 * bookkeeping accumulates within one test's lifetime that only a fresh `beforeEach`/`afterEach`
 * cycle between separate `it()`s resets (splitting the old single giant test into one `it()` per
 * campaign already bought a 4x speedup; sharding further keeps every individual test comfortably
 * inside its timeout even at high `SIM_SCALE`). */
const MAX_GAMES_PER_TEST = 1000;

function buildCampaigns(): Campaign[] {
  const raw: Campaign[] = [
    { name: 'random', count: 30 * SCALE, bias: { kind: 'random' } },
    { name: 'concentrate', count: 10 * SCALE, bias: { kind: 'concentrate' } },
    { name: 'split', count: 6 * SCALE, bias: { kind: 'split' } },
    { name: 'abstain', count: 4 * SCALE, bias: { kind: 'abstain' } },
    { name: 'target-tanner', count: 4 * SCALE, bias: { kind: 'targetRole', role: 'Tanner' } },
    { name: 'target-prince', count: 4 * SCALE, bias: { kind: 'targetRole', role: 'Prince' } },
  ];

  const sharded: Campaign[] = [];
  for (const campaign of raw) {
    if (campaign.count <= MAX_GAMES_PER_TEST) {
      sharded.push(campaign);
      continue;
    }
    const shardCount = Math.ceil(campaign.count / MAX_GAMES_PER_TEST);
    let remaining = campaign.count;
    for (let shard = 1; shard <= shardCount; shard++) {
      const count = Math.min(MAX_GAMES_PER_TEST, remaining);
      sharded.push({ name: `${campaign.name} [${shard}/${shardCount}]`, count, bias: campaign.bias });
      remaining -= count;
    }
  }
  return sharded;
}

describe('full game stress simulation', () => {
  const campaigns = buildCampaigns();
  const totalGames = campaigns.reduce((sum, c) => sum + c.count, 0);
  // Shared across the per-campaign tests below and read by the final summary test - `it()`
  // blocks in the same `describe` run sequentially in one worker, so this is safe.
  const results: SimResult[] = [];
  const seenRoles = new Set<string>();
  let gameIndex = 0;

  // One `it()` per campaign instead of a single loop over all of them: running many thousands of
  // games inside one `it()` made per-game cost climb (vitest/mock bookkeeping - `vi.fn()`,
  // `useFakeTimers()` - accumulates *something* over a test's lifetime that a fresh `beforeEach`/
  // `afterEach` cycle between separate `it()`s resets), so splitting keeps each test in the fast,
  // roughly-linear regime instead of degrading super-linearly across the whole campaign.
  for (const campaign of campaigns) {
    it(
      `campaign "${campaign.name}": plays ${campaign.count} games`,
      async () => {
        for (let i = 0; i < campaign.count; i++) {
          const playerCount = 5 + (gameIndex % 31); // cycle 5..35 (the production max) for broad size coverage
          const chaos = gameIndex % 3 === 0;
          const result = await runOneGame(BigInt(1_000_000 + gameIndex), playerCount, chaos, campaign.bias);
          results.push(result);
          for (const r of result.roles) seenRoles.add(r);
          gameIndex++;
        }
        const campaignResults = results.slice(-campaign.count);
        const campaignCrashes = campaignResults.filter((r) => r.crashed);
        expect(
          campaignCrashes,
          `${campaignCrashes.length} game(s) crashed in campaign "${campaign.name}"`,
        ).toHaveLength(0);
      },
      // A few thousand simulated games can take a while even with fake timers (lots of microtask
      // churn) - give each campaign a lot more headroom than vitest's 5s default.
      600_000,
    );
  }

  it(
    `summary: ${totalGames} games across ${campaigns.length} voting strategies played with no crash, no stall, and a winner every time`,
    () => {
      const crashes = results.filter((r) => r.crashed);
      const stalls = results.filter((r) => r.stalled);
      const noWinner = results.filter((r) => !r.crashed && !r.stalled && !r.winningTeam);
      const missingRoles = ROLE_NAMES.filter((name) => !seenRoles.has(name));

      const winTeamCounts = new Map<string, number>();
      for (const r of results) {
        if (!r.winningTeam) continue;
        winTeamCounts.set(r.winningTeam, (winTeamCounts.get(r.winningTeam) ?? 0) + 1);
      }
      const missingWinTeams = ALL_WIN_TEAMS.filter((team) => !winTeamCounts.has(team));

      const lynchOutcomeCounts = new Map<string, number>();
      for (const r of results) {
        for (const outcome of r.lynchOutcomesSeen) {
          lynchOutcomeCounts.set(outcome, (lynchOutcomeCounts.get(outcome) ?? 0) + 1);
        }
      }
      const missingLynchOutcomes = TRACKED_LYNCH_OUTCOMES.filter((outcome) => !lynchOutcomeCounts.has(outcome));

      // eslint-disable-next-line no-console
      console.log(
        [
          `Simulated ${results.length} games across campaigns: ${campaigns.map((c) => `${c.name}=${c.count}`).join(', ')} (sizes 5-35).`,
          `Crashes: ${crashes.length}. Stalls: ${stalls.length}. Ended with no winningTeam: ${noWinner.length}.`,
          `Roles dealt: ${seenRoles.size}/${ROLE_NAMES.length}${missingRoles.length ? ` (never dealt: ${missingRoles.join(', ')} - see REQUIREMENTS.md, expected for Spumpkin)` : ''}.`,
          `Winning teams: ${[...winTeamCounts.entries()].map(([team, n]) => `${team}=${n}`).join(', ')}${missingWinTeams.length ? ` (never seen: ${missingWinTeams.join(', ')})` : ''}.`,
          `Lynch outcomes: ${[...lynchOutcomeCounts.entries()].map(([o, n]) => `${o}=${n}`).join(', ')}${missingLynchOutcomes.length ? ` (never seen: ${missingLynchOutcomes.join(', ')})` : ''}.`,
          ...crashes.map((c) => {
            const errObj = (c.errors[0] as { err?: unknown })?.err ?? c.errors[0];
            const stack = errObj instanceof Error ? errObj.stack : String(errObj);
            return `  CRASH bias=${c.bias} size=${c.playerCount} chaos=${c.chaos} roles=[${c.roles.join(',')}]:\n${stack}`;
          }),
          ...stalls.map((c) => `  STALL bias=${c.bias} size=${c.playerCount} chaos=${c.chaos} roles=[${c.roles.join(',')}]`),
          ...noWinner.map(
            (c) =>
              `  NO WINNER bias=${c.bias} size=${c.playerCount} chaos=${c.chaos} finalPhase=${c.finalPhase} alive=${c.aliveCount} day=${c.dayNumber} roles=[${c.roles.join(',')}]`,
          ),
        ].join('\n'),
      );

      expect(crashes, `${crashes.length} game(s) crashed - see console output above for role compositions`).toHaveLength(0);
      expect(stalls, `${stalls.length} game(s) never reached a resolution - see console output above`).toHaveLength(0);
      expect(noWinner, `${noWinner.length} game(s) ended without a winning team`).toHaveLength(0);

      // `Tanner`/`TannerWinByLynch` and `Tied` are proven separately by the dedicated scenario
      // tests below instead of relied on here: a live Pacifist always declares peace the moment
      // it's offered (this harness always uses every day-ability the instant it's available),
      // which eats the very first lynch of any game that deals one, and `randomLynchOnTie`
      // defaults to `true` (matching real production groups unless an admin opts out via
      // `/config`) so a genuine `Tied` almost never survives as `Tied` in the general campaign.
      // Neither is a campaign design flaw worth "fixing" by scaling further - it's just not
      // where those two outcomes are reliably reachable, so they get their own targeted test.
      const expectedElsewhere = new Set(['Tanner']);
      const campaignMissingWinTeams = missingWinTeams.filter((t) => !expectedElsewhere.has(t));
      const campaignMissingLynchOutcomes = missingLynchOutcomes.filter((o) => o !== 'Tied' && o !== 'TannerWinByLynch');

      // Only enforced at real scale (SIM_SCALE >= 20 or so) - at the tiny default CI count these
      // rare outcomes aren't guaranteed to land even with biasing.
      if (SCALE >= 20) {
        expect(campaignMissingWinTeams, `winning teams never observed: ${campaignMissingWinTeams.join(', ')}`).toHaveLength(0);
        expect(
          campaignMissingLynchOutcomes,
          `lynch outcomes never observed: ${campaignMissingLynchOutcomes.join(', ')}`,
        ).toHaveLength(0);
      }
    },
  );

  // The two outcomes above structurally can't be relied on from the general campaign (see the
  // comment there) - proven directly instead, with a hand-picked role set and repeated attempts
  // to absorb the part that's still left to chance (whether the Tanner survives the night, e.g.).
  it('resolves a tied lynch vote as `Tied` when randomLynchOnTie is disabled', async () => {
    let sawTied = false;
    for (let i = 0; i < 15 && !sawTied; i++) {
      const result = await runOneGame(
        BigInt(2_000_000 + i),
        6,
        false,
        { kind: 'split' },
        { randomLynchOnTie: false, forceRoles: ['Villager', 'Villager', 'Villager', 'Villager', 'Villager', 'Wolf'] },
      );
      expect(result.crashed, `game crashed: ${JSON.stringify(result.errors[0])}`).toBe(false);
      expect(result.stalled).toBe(false);
      if (result.lynchOutcomesSeen.has('Tied')) sawTied = true;
    }
    expect(sawTied, 'a 3-3 split lynch with randomLynchOnTie:false never resolved as Tied across 15 attempts').toBe(true);
  });

  it('resolves TannerWinByLynch when the group votes the Tanner out', async () => {
    let sawTannerWin = false;
    for (let i = 0; i < 30 && !sawTannerWin; i++) {
      const result = await runOneGame(
        BigInt(3_000_000 + i),
        5,
        false,
        { kind: 'targetRole', role: 'Tanner' },
        { forceRoles: ['Tanner', 'Wolf', 'Villager', 'Villager', 'Villager'] },
      );
      expect(result.crashed, `game crashed: ${JSON.stringify(result.errors[0])}`).toBe(false);
      expect(result.stalled).toBe(false);
      if (result.winningTeam === 'Tanner') sawTannerWin = true;
    }
    expect(
      sawTannerWin,
      'the Tanner never won by lynch across 30 attempts even when the whole group voted them out every round',
    ).toBe(true);
  });
});
