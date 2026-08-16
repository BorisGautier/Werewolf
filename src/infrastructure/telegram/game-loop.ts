/**
 * Port of `Werewolf.cs`'s main loop - `while (IsRunning) { NightCycle();
 * DayCycle(); LynchCycle(); }` - once role assignment (`GameLobbyManager`)
 * hands a running `Game` off to this module. Drives real timers (via
 * `setTimeout`, not the original's blocking `Thread.Sleep` loop), sends
 * every role's menu over PM, collects choices via callback queries routed
 * through `handleCallback()`, and turns the domain layer's `GameEvent[]`
 * into chat messages via `describeEvent`.
 *
 * Deliberately simplified vs. the original in a couple of documented ways:
 * no early-exit-once-everyone's-answered (each phase always runs its full
 * timer - callbacks just mutate player state, which is read back once the
 * timer fires), and menu target filtering is "good enough to avoid
 * obviously wrong picks" rather than exhaustively mirroring every one of
 * `SendNightActions`'s per-role `targetBase` tweaks (see `role-menus.ts`).
 */

import { Bot, GrammyError, InlineKeyboard } from 'grammy';
import { GameManager } from '../../application/game-manager.js';
import { Game } from '../../domain/game/game.aggregate.js';
import type { GamePhase } from '../../domain/game/game-phase.js';
import { ROLE_BIT, roleName, type Role, type RoleName } from '../../domain/roles/role.js';
import { WOLF_ROLES } from '../../domain/game/game-balancing.js';
import { ABSTAIN, SPARK, alivePlayers, type Player } from '../../domain/game/player.js';
import type { GameEvent } from '../../domain/game/game-event.js';
import type { Team } from '../../domain/game/team.js';
import { WEATHER_DETAILS } from '../../domain/game/village-weather.js';
import { generateGazette, LAST_GAZETTES_BY_CHAT } from '../../domain/gazette/gazette-generator.js';
import {
  evaluateGameAchievements,
  firstLynchVictimId,
} from '../../domain/achievements/evaluate.js';
import { ACHIEVEMENTS, type AchievementCode } from '../../domain/achievements/catalog.js';
import type { GroupWithConfig } from '../persistence/group.repository.js';
import { AchievementRepository } from '../persistence/achievement.repository.js';
import { GameRepository } from '../persistence/game.repository.js';
import { GroupRepository } from '../persistence/group.repository.js';
import { GifPackRepository, type GifCategory } from '../persistence/gif-pack.repository.js';
import { donorBadge, type PlayerRepository } from '../persistence/player.repository.js';
import { Translator, MissingLocaleStringError } from '../i18n/translator.js';
import type { Logger } from '../logging/logger.js';
import { describeEvent } from './messages.js';
import { LocalGifPack } from './local-gif-pack.js';
import {
  dayOneTargets,
  DAY_ABILITY_ROLES,
  DAY_TARGET_ROLES,
  NIGHT_TARGET_ROLES,
  nightTargets,
} from './role-menus.js';
import { buildEndGameSummary } from './end-game-summary.js';
import { calculateGamePoints } from '../../domain/scoring.js';
import {
  archivistReports,
  botNightActions,
  dayPhaseDuration,
  daysStarted,
  daysResolved,
  gameDrawsTotal,
  gameDurationSeconds,
  gamesEnded,
  gameRoundsTotal,
  gazetteGenerations,
  gifSends,
  hitmanKills,
  judgePardons,
  lynchesResolved,
  lynchesStarted,
  lynchPhaseDuration,
  lynchTies,
  mimicUsages,
  necromancerResurrections,
  nightPhaseDuration,
  nightsResolved,
  nightsStarted,
  pacifistPeaces,
  skipVoteActions,
  witchPoisonPotions,
  witchSavePotions,
} from '../monitoring/metrics.js';

const NIGHT_ONE_MIN_SECONDS = 120;

/** Guardian Angel event types that count as a "save" for the GotYourBack achievement. */
const GA_SAVE_EVENT_TYPES: ReadonlySet<GameEvent['type']> = new Set([
  'GuardianAngelBlockedWolfAttack',
  'GuardianAngelBlockedSerialKiller',
  'GuardianAngelBlockedFreeze',
  'GuardianAngelSavedFromBurning',
]);

export class GameLoop {
  private readonly gameIds = new Map<bigint, number>();
  /** Every night/day/lynch resolution's events, one batch per call to `broadcast()` - the
   * history `evaluateGameAchievements()` needs at game end (see `finish()`). Cleared there. */
  private readonly eventBatches = new Map<bigint, GameEvent[][]>();
  /** One entry per chat currently waiting out a night/day/lynch timer, letting `/skipvote`
   * (see `skipVote()`) resolve it immediately instead of waiting for `setTimeout` to fire. */
  private readonly phaseSkips = new Map<bigint, () => void>();
  /** Chat ids force-stopped via `killGame()` mid-phase - consumed the next time the loop checks in
   * (right after its current phase's wait window closes), so it bails out instead of resolving/
   * announcing/recursing into the next phase. */
  private readonly killedChats = new Set<bigint>();
  private readonly mutedPlayers = new Map<bigint, Set<bigint>>();

  constructor(
    private readonly bot: Bot,
    private readonly games: GameManager,
    private readonly groups: GroupRepository,
    private readonly gameRepo: GameRepository,
    private readonly achievements: AchievementRepository,
    private readonly t: Translator,
    private readonly logger: Logger,
    private readonly players?: PlayerRepository,
    private readonly gifPacks?: GifPackRepository,
    private readonly localGifPack: LocalGifPack = new LocalGifPack(),
  ) {}

  getGame(chatId: bigint): Game | undefined {
    return this.games.get(chatId);
  }

  /**
   * Entry point: `game` is already in its first Night (dealt by `GameLobbyManager.finishJoining`,
   * which is also who already created the `games` DB row - `gameId` is that row's id, so `finish()`
   * updates it instead of creating a second, empty one).
   */
  start(game: Game, gameId: number): void {
    this.gameIds.set(game.chatId, gameId);
    void this.runNight(game).catch((err: unknown) => {
      this.logger.error({ err, chatId: game.chatId.toString() }, 'Game loop crashed');
    });
  }

  /**
   * Port of `Werewolf.cs`'s `/skipvote`: forces whichever night/day/lynch timer this chat is
   * currently waiting out to resolve immediately, same as if it had just naturally elapsed.
   * Returns false if no phase is currently in its wait window (e.g. between phases, or no game).
   */
  /**
   * Port of `/killgame` (the original's `Werewolf.Kill()` + `Program.RemoveGame`): force-stops
   * whatever phase this chat's game is currently in, with no resolution or announcement - unlike a
   * normal game end, this is an abrupt admin override. Frees the chat up for a new game right away;
   * the loop itself notices and unwinds the next time it checks in (see `killedChats`), typically
   * within moments since this also wakes up any phase currently waiting out its timer. Returns
   * false if no game is running in this chat.
   */
  killGame(chatId: bigint): boolean {
    if (!this.games.has(chatId)) return false;
    this.killedChats.add(chatId);
    this.games.remove(chatId);
    this.gameIds.delete(chatId);
    this.eventBatches.delete(chatId);
    this.skipVote(chatId);
    void this.unmuteAllDead(chatId);
    return true;
  }

  /** Consumes (and reports) a pending `killGame()` for this chat - checked right after each
   * phase's wait window closes, before the loop would otherwise resolve/announce/recurse. */
  private consumeKilled(chatId: bigint): boolean {
    return this.killedChats.delete(chatId);
  }

  skipVote(chatId: bigint): boolean {
    const resolve = this.phaseSkips.get(chatId);
    if (!resolve) return false;
    resolve();
    return true;
  }

  /** Indirection around `game.phase === 'Ended'` so TS doesn't narrow the literal type across the
   * call - see the comment at its call site in `handleHunterShots()`. */
  private hasEnded(game: Game): boolean {
    return game.phase === 'Ended';
  }

  private async phaseSleep(chatId: bigint, ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.phaseSkips.set(chatId, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.phaseSkips.delete(chatId);
  }

  // ---------------------------------------------------------------- Night

  private async runNight(game: Game): Promise<void> {
    const group = await this.groups.getOrCreate(game.chatId, null, null);

    if (game.phase === 'Lynch') {
      const startEvents = game.startNight();
      await this.broadcast(game, group, startEvents, 'Night');
    }

    nightsStarted.inc();
    this.logger.info(
      { chatId: game.chatId.toString(), dayNumber: game.dayNumber, mode: game.mode },
      'Night phase started',
    );

    if (!game.nightSkipped) {
      const seconds = this.nightSeconds(game, group);
      nightPhaseDuration.observe(seconds);
      await this.send(game.chatId, group.language, 'NightBeginsTimed', game.dayNumber, seconds);
      if (game.dayNumber === 1) {
        const weather = WEATHER_DETAILS[game.weather];
        const isFr = group.language === 'fr';
        const weatherTitle = isFr ? weather.titleFr : weather.titleEn;
        const weatherDesc = isFr ? weather.descFr : weather.descEn;
        const weatherMsg = `${weather.emoji} <b>MÉTÉO DU VILLAGE : ${weatherTitle}</b>\n<i>${weatherDesc}</i>`;
        await this.sendRaw(game.chatId, weatherMsg);
      }
      await this.sendGifCategory(game.chatId, group, 'NightStart');
      await this.sendNightMenus(game, group.language);
      await this.processBotNightActions(game);
      await this.phaseSleep(game.chatId, seconds * 1000);
    }
    if (this.consumeKilled(game.chatId)) return;

    const events = game.resolveNightActions();
    nightsResolved.inc();
    this.logger.info(
      { chatId: game.chatId.toString(), dayNumber: game.dayNumber, eventsCount: events.length },
      'Night phase resolved',
    );
    await this.broadcast(game, group, events, 'Night');
    if (await this.handleHunterShots(game, group, events, 'Night')) return;
    if (game.phase === 'Ended') return this.finish(game);

    await this.runDay(game);
  }

  private nightSeconds(game: Game, group: GroupWithConfig): number {
    const base = group.nightTimerSeconds;
    if (game.dayNumber !== 1) return base;
    // Mirrors the original's day-1 extension for Cupid/Wild Child/Doppelganger/a not-full Thief.
    const needsExtraTime = game.players.some((p) =>
      [ROLE_BIT.Cupid, ROLE_BIT.Doppelganger, ROLE_BIT.WildChild, ROLE_BIT.Thief].includes(p.role),
    );
    return needsExtraTime ? Math.max(base, NIGHT_ONE_MIN_SECONDS) : base;
  }

  private async sendNightMenus(game: Game, language: string): Promise<void> {
    for (const actor of alivePlayers(game.players)) {
      if (actor.drunk || actor.frozen) continue;

      if (actor.role === ROLE_BIT.Arsonist) {
        await this.sendArsonistMenu(actor, game.players, language);
        continue;
      }
      if (actor.role === ROLE_BIT.Archivist) {
        archivistReports.inc();
        await this.sendArchivistReport(actor, game.players, game.dayNumber, language);
        continue;
      }
      if (
        game.dayNumber === 1 &&
        (actor.role === ROLE_BIT.WildChild || actor.role === ROLE_BIT.Doppelganger)
      ) {
        await this.sendRoleModelMenu(actor, game.players, language);
        continue;
      }
      if (game.dayNumber === 1 && actor.role === ROLE_BIT.Cupid) {
        await this.sendCupidFirstMenu(actor, game.players, language);
        continue;
      }
      if (!NIGHT_TARGET_ROLES.includes(actor.role)) continue;

      // The Blacksmith spread silver today: the wolf pack (and the Snow Wolf) get no menu at
      // all tonight, mirroring the original never building their `AskEat`/`AskFreeze` prompt.
      if (
        game.silverSpread &&
        (actor.role === ROLE_BIT.SnowWolf || WOLF_ROLES.includes(actor.role))
      )
        continue;

      const targets = nightTargets(game.players, actor);
      if (targets.length === 0) continue;

      const promptKey = NIGHT_PROMPT_KEY[roleName(actor.role)] ?? 'AskTarget';
      await this.sendPm(
        actor.id,
        language,
        promptKey,
        targetKeyboard(targets, 'nt', language, this.t),
      );

      if (WOLF_ROLES.includes(actor.role) && game.wolfCubKilled) {
        await this.sendPm(
          actor.id,
          language,
          'AskWolfPack',
          targetKeyboard(targets, 'nt2', language, this.t),
        );
      }
    }

    // Mirrors the tail of the original's `SendNightActions()`: drunk/frozen/burning only ever
    // gated *this* night's menu (already decided above) - every resolver keys off `.choice`
    // staying null for whoever got skipped, so it's safe to clear the flags here for next time.
    // Without this, a Snow Wolf freeze or a wolf-pack drunk stupor would otherwise never expire.
    for (const p of game.players) {
      p.drunk = false;
      p.frozen = false;
      p.burning = false;
    }
  }

  private async sendArsonistMenu(
    actor: Player,
    players: readonly Player[],
    language: string,
  ): Promise<void> {
    const targets = nightTargets(players, actor);
    const keyboard = targetKeyboard(targets, 'nt', language, this.t);
    const dousedCount = alivePlayers(players).filter((p) => p.doused).length;
    if (dousedCount > 0) keyboard.text(this.t.translate(language, 'SparkButton'), 'spark').row();
    await this.sendPm(actor.id, language, 'AskArsonist', keyboard);
  }

  private async sendArchivistReport(
    actor: Player,
    players: readonly Player[],
    dayNumber: number,
    language: string,
  ): Promise<void> {
    const alive = alivePlayers(players);
    const villageCount = alive.filter((p) => p.team === 'Village').length;
    const wolfCount = alive.filter((p) => p.team === 'Wolf').length;
    const neutralCount = alive.filter((p) => p.team !== 'Village' && p.team !== 'Wolf').length;

    const reportMsg =
      language === 'fr'
        ? `📜 <b>Registres de l'Archiviste (Nuit ${dayNumber}) :</b>\n\n• 👱 <b>Villageois vivants :</b> ${villageCount}\n• 🐺 <b>Loups-Garous vivants :</b> ${wolfCount}\n• 🔮 <b>Rôles Neutres / Solos vivants :</b> ${neutralCount}`
        : `📜 <b>Archivist Records (Night ${dayNumber}):</b>\n\n• 👱 <b>Living Villagers:</b> ${villageCount}\n• 🐺 <b>Living Werewolves:</b> ${wolfCount}\n• 🔮 <b>Living Neutrals / Solos:</b> ${neutralCount}`;

    await this.sendPmRaw(actor.id, reportMsg);
  }

  private async sendPmRaw(telegramId: bigint, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatNumber(telegramId), text, { parse_mode: 'HTML' });
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }

  private async sendRoleModelMenu(
    actor: Player,
    players: readonly Player[],
    language: string,
  ): Promise<void> {
    const targets = dayOneTargets(players, actor);
    if (targets.length === 0) return;
    const keyboard = targetKeyboard(targets, 'nrm', language, this.t, false);
    const key = actor.role === ROLE_BIT.WildChild ? 'AskWildChild' : 'AskDoppelganger';
    await this.sendPm(actor.id, language, key, keyboard);
  }

  private async sendCupidFirstMenu(
    actor: Player,
    players: readonly Player[],
    language: string,
  ): Promise<void> {
    const targets = dayOneTargets(players, actor);
    if (targets.length === 0) return;
    await this.sendPm(
      actor.id,
      language,
      'AskCupidFirst',
      targetKeyboard(targets, 'cupid1', language, this.t, false),
    );
  }

  // ------------------------------------------------------------------ Day

  private async runDay(game: Game): Promise<void> {
    const group = await this.groups.getOrCreate(game.chatId, null, null);
    game.startDay();
    daysStarted.inc();
    gameRoundsTotal.labels(game.mode).inc();
    this.logger.info(
      { chatId: game.chatId.toString(), dayNumber: game.dayNumber, mode: game.mode },
      'Day phase started',
    );

    const seconds = group.dayTimerSeconds;
    dayPhaseDuration.observe(seconds);
    await this.send(
      game.chatId,
      group.language,
      'DayTime',
      game.dayNumber,
      formatDuration(seconds),
    );
    await this.sendGifCategory(game.chatId, group, 'DayStart');
    await this.sendDayMenus(game, group.language);

    await this.phaseSleep(game.chatId, seconds * 1000);
    if (this.consumeKilled(game.chatId)) return;

    const events = game.resolveDayActions();
    daysResolved.inc();
    this.logger.info(
      { chatId: game.chatId.toString(), dayNumber: game.dayNumber, eventsCount: events.length },
      'Day phase resolved',
    );
    await this.broadcast(game, group, events, 'Day');
    if (await this.handleHunterShots(game, group, events, 'Day')) return;
    if (game.phase === 'Ended') return this.finish(game);

    await this.runLynch(game);
  }

  private async sendDayMenus(game: Game, language: string): Promise<void> {
    for (const actor of alivePlayers(game.players)) {
      if (DAY_ABILITY_ROLES.includes(actor.role) && !actor.hasUsedAbility) {
        const key = ABILITY_BUTTON_KEY[roleName(actor.role)]!;
        await this.sendPm(actor.id, language, key, abilityKeyboard(actor.role, language, this.t));
        continue;
      }
      if (!DAY_TARGET_ROLES.includes(actor.role)) continue;

      const targets = alivePlayers(game.players).filter((p) => p.id !== actor.id);
      if (targets.length === 0) continue;
      const promptKey = DAY_PROMPT_KEY[roleName(actor.role)] ?? 'AskTarget';
      await this.sendPm(
        actor.id,
        language,
        promptKey,
        targetKeyboard(targets, 'dt', language, this.t),
      );
    }
  }

  // ---------------------------------------------------------------- Lynch

  private async runLynch(game: Game): Promise<void> {
    const group = await this.groups.getOrCreate(game.chatId, null, null);
    game.startLynch();
    lynchesStarted.inc();
    this.logger.info(
      { chatId: game.chatId.toString(), dayNumber: game.dayNumber, mode: game.mode },
      'Lynch phase started',
    );

    await this.sendGifCategory(game.chatId, group, 'LynchStart');
    const attempts = game.lynchAttemptsPlanned;
    const seconds = group.lynchTimerSeconds;
    lynchPhaseDuration.observe(seconds);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        game.restartLynchVote();
        await this.send(game.chatId, group.language, 'TroubleDoubleLynchSecondVote');
      }

      await this.sendLynchVoteMenu(game, group, seconds);
      void this.processBotLynchVotes(game);
      await this.phaseSleep(game.chatId, seconds * 1000);
      if (this.consumeKilled(game.chatId)) return;

      let judgePardon = false;
      let judgeId: bigint | undefined;
      const judge = game.players.find(
        (p) => !p.isDead && p.role === ROLE_BIT.Judge && !p.hasUsedAbility,
      );

      if (judge) {
        const maxVotes = Math.max(0, ...game.players.map((p) => p.votes));
        const tied = game.players.filter((p) => p.votes === maxVotes && maxVotes > 0);
        if (tied.length === 1 && tied[0]!.id !== judge.id) {
          const condemned = tied[0]!;
          judge.choice = null;
          const pardonKeyboard = new InlineKeyboard()
            .text(
              group.language === 'fr' ? '⚖️ Accorder la Grâce' : '⚖️ Grant Pardon',
              'judge_pardon',
            )
            .row()
            .text(group.language === 'fr' ? '❌ Laisser exécuter' : '❌ Let Execute', 'judge_skip');

          const promptMsg =
            group.language === 'fr'
              ? `⚖️ <b>DROIT DE GRÂCE DU JUGE !</b>\n\nLe village vient de condamner <b>${condemned.name}</b> au gibet avec ${condemned.votes} vote(s) !\n\nVoulez-vous exercer votre Droit de Grâce (unique) pour annuler cette exécution ?`
              : `⚖️ <b>JUDGE'S PARDON!</b>\n\nThe village has condemned <b>${condemned.name}</b> to the gallows with ${condemned.votes} vote(s)!\n\nDo you want to use your unique Right of Pardon to save them?`;

          await this.bot.api
            .sendMessage(chatNumber(judge.id), promptMsg, {
              parse_mode: 'HTML',
              reply_markup: pardonKeyboard,
            })
            .catch(() => null);

          if (judge.isBot) {
            if (Math.random() < 0.35) judge.choice = 1n;
          } else {
            await this.phaseSleep(game.chatId, 10000);
          }

          if (judge.choice === 1n) {
            judgePardon = true;
            judgeId = judge.id;
          }
        }
      }

      const result = game.resolveLynch(
        judgePardon && judgeId !== undefined ? { judgePardon: true, judgeId } : undefined,
      );
      await this.sendSecretLynchSummary(game, group);
      await this.broadcastLynchOutcome(game, group.language, result.resolution);
      await this.broadcast(game, group, result.events, 'Lynch');
      if (await this.handleHunterShots(game, group, result.events, 'Lynch')) return;
      if (game.phase === 'Ended') return this.finish(game);
    }

    await this.runNight(game);
  }

  private async sendLynchVoteMenu(
    game: Game,
    group: GroupWithConfig,
    seconds: number,
  ): Promise<void> {
    const alive = alivePlayers(game.players);
    const keyboard = targetKeyboard(alive, 'vote', group.language, this.t);
    await this.send(game.chatId, group.language, 'LynchTime', formatDuration(seconds));

    if (group.pmLynchVote) {
      await this.send(game.chatId, group.language, 'PmLynchVoteStarted');
      for (const actor of alive) {
        const targetsForActor = alive.filter((p) => p.id !== actor.id);
        const actorKeyboard = targetKeyboard(targetsForActor, 'vote', group.language, this.t);
        await this.sendPm(actor.id, group.language, 'AskTarget', actorKeyboard);
      }
    } else {
      await this.bot.api.sendMessage(
        chatNumber(game.chatId),
        this.t.translate(group.language, 'AskTarget'),
        {
          reply_markup: keyboard,
        },
      );
    }
  }

  private async broadcastLynchOutcome(
    game: Game,
    language: string,
    resolution: { outcome: string; playerId?: bigint },
  ): Promise<void> {
    lynchesResolved.labels(resolution.outcome).inc();
    switch (resolution.outcome) {
      case 'Tied':
        lynchTies.inc();
        await this.send(game.chatId, language, 'LynchTied');
        return;
      case 'NoVotes':
        await this.send(game.chatId, language, 'NoOneCastLynch');
        return;
      case 'PacifistPeace':
        pacifistPeaces.inc();
        await this.send(game.chatId, language, 'PacifistNoLynchNow');
        return;
      case 'PrinceSurvived': {
        const prince = resolution.playerId ? findName(game.players, resolution.playerId) : '';
        await this.send(game.chatId, language, 'PrinceSurvivedLynch', prince);
        return;
      }
      case 'JudgePardoned': {
        judgePardons.inc();
        const victim = resolution.playerId ? findName(game.players, resolution.playerId) : '';
        const judgeId = (resolution as any).judgeId;
        const judgeName = judgeId ? findName(game.players, judgeId) : '';
        const msg =
          language === 'fr'
            ? `⚖️ <b>DROIT DE GRÂCE DU JUGE !</b>\n\n<i>Le Juge <b>${judgeName}</b> a frappé le tribunal de son marteau ! Il exerce son Droit de Grâce et annule l'exécution de <b>${victim}</b> ! Personne ne sera pendu aujourd'hui.</i>`
            : `⚖️ <b>JUDGE'S PARDON!</b>\n\n<i>Judge <b>${judgeName}</b> strikes the gavel! Exercising the Right of Pardon, the execution of <b>${victim}</b> is cancelled! No one will be lynched today.</i>`;
        await this.bot.api
          .sendMessage(chatNumber(game.chatId), msg, { parse_mode: 'HTML' })
          .catch(() => null);
        const grp = await this.groups.getOrCreate(game.chatId, null, null);
        void this.sendGifCategory?.(game.chatId, grp, 'JudgePardon');
        return;
      }
      default:
        return; // 'Lynched'/'TannerWinByLynch' are fully covered by the PlayerDied event.
    }
  }

  // --------------------------------------------------------- Hunter shots

  /** Returns true if the game ended while resolving a pending shot (caller should stop the loop). */
  private async handleHunterShots(
    game: Game,
    group: GroupWithConfig,
    events: readonly GameEvent[],
    phase: 'Night' | 'Day' | 'Lynch',
  ): Promise<boolean> {
    const shooters = events.filter(
      (e): e is Extract<GameEvent, { type: 'HunterMustShoot' }> => e.type === 'HunterMustShoot',
    );
    for (const shot of shooters) {
      // The same resolution that produced this shot (e.g. a lynch that both killed the Hunter
      // *and* immediately decided the win condition) may have already ended the game - nothing
      // left to affect, and `killPlayer()` below would reject on a phase that's already 'Ended'.
      // The caller's own post-call `if (game.phase === 'Ended') return this.finish(game);` still
      // runs right after this returns `false`, so the game-end flow is handled correctly either way.
      // (Routed through `hasEnded()` rather than comparing `game.phase` directly - a plain
      // `=== 'Ended'` here would make TS narrow the literal type for the rest of the loop body,
      // wrongly flagging the still-necessary re-check after `killPlayer()`/`checkWinCondition()`
      // below as unreachable, even though those calls can genuinely flip the phase.)
      if (this.hasEnded(game)) break;

      const hunter = game.players.find((p) => p.id === shot.hunterId);
      if (!hunter) continue;

      const targets = alivePlayers(game.players);
      if (targets.length === 0) continue;

      hunter.choice = null;
      await this.sendPm(
        hunter.id,
        group.language,
        'AskHunterShot',
        targetKeyboard(targets, 'shoot', group.language, this.t, false),
      );
      await sleep(group.dayTimerSeconds * 1000);
      hunter.pendingHunterShot = null; // the window's closed - a late "shoot:" callback shouldn't land

      const targetId = hunter.choice;
      if (targetId === null || targetId === ABSTAIN) continue;
      const target = game.players.find((p) => p.id === targetId);
      if (!target || target.isDead) continue;

      const killEvents = game.killPlayer(targetId, shot.method, { killerIds: [hunter.id] });
      await this.send(game.chatId, group.language, 'HunterShotFired', hunter.name, target.name);
      await this.broadcast(game, group, killEvents, phase);

      // Mirrors `CheckForGameEnd()` right after the original's `HunterFinalShot` resolves - the
      // shot itself (not just the death that triggered it) can be the killing blow that ends the
      // game, e.g. the last Wolf standing.
      const win = game.checkWinCondition();
      await this.broadcast(game, group, win.events, phase);

      if (this.hasEnded(game)) {
        await this.finish(game);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- Finish

  private async finish(game: Game): Promise<void> {
    const gameId = this.gameIds.get(game.chatId);
    this.gameIds.delete(game.chatId);
    const batches = this.eventBatches.get(game.chatId) ?? [];
    this.eventBatches.delete(game.chatId);

    let startedAt: Date | undefined;
    const scoresMap = new Map<bigint, number>();
    if (gameId !== undefined) {
      try {
        startedAt = await this.gameRepo.finalizeGame(gameId, game.winningTeam, game.players);
        const durationMs = Date.now() - startedAt.getTime();
        gameDurationSeconds.labels(game.mode).observe(durationMs / 1000);
        gamesEnded.labels(game.mode, (game.winningTeam as string) ?? 'NoWinner').inc();
        if (!game.winningTeam || (game.winningTeam as string) === 'NoWinner') {
          gameDrawsTotal.inc();
        }

        this.logger.info(
          {
            chatId: game.chatId.toString(),
            gameId,
            mode: game.mode,
            winningTeam: game.winningTeam,
            durationSeconds: Math.round(durationMs / 1000),
            playerCount: game.players.length,
          },
          'Game finished and recorded in DB',
        );
      } catch (err) {
        this.logger.error(
          { err, chatId: game.chatId.toString(), gameId },
          'Failed to persist finished game',
        );
      }
      try {
        await this.awardAchievements(game, batches, startedAt);
      } catch (err) {
        this.logger.error(
          { err, chatId: game.chatId.toString(), gameId },
          'Failed to award achievements',
        );
      }

      if (this.players) {
        try {
          const scores = calculateGamePoints(
            game.players,
            game.winningTeam ?? null,
            firstLynchVictimId(batches),
          );
          const grp = await this.groups.getOrCreate(game.chatId, null, null);
          const lang = grp.language;
          for (const score of scores) {
            scoresMap.set(score.playerId, score.points);
            const res = await this.players.awardPoints(score.playerId, score.points, score.won);
            if (res.promoted) {
              const title = this.t.translate(lang, res.newRank.titleKey);
              const displayTitle = title.startsWith('Rank_') ? res.newRank.defaultTitle : title;
              const promoMsg = this.t.translate(
                lang,
                'RankPromotionNotice',
                res.newRank.emoji,
                displayTitle,
                res.newPoints,
              );
              try {
                await this.bot.api.sendMessage(Number(score.playerId), promoMsg, {
                  parse_mode: 'HTML',
                });
              } catch {
                // Ignore if player hasn't started PM
              }
            }
          }
        } catch (err) {
          this.logger.error(
            { err, chatId: game.chatId.toString(), gameId },
            'Failed to award leaderboard points',
          );
        }
      }
    }

    try {
      const group = await this.groups.getOrCreate(game.chatId, null, null);
      const durationMs = startedAt ? Date.now() - startedAt.getTime() : null;
      const donorBadges = await this.donorBadges(game.players.map((p) => p.id));
      const summary = buildEndGameSummary(
        game.players,
        group.showRolesEnd,
        group.language,
        this.t,
        durationMs,
        donorBadges,
        scoresMap,
      );
      await this.sendRaw(game.chatId, summary);

      try {
        const gazette = generateGazette(game, batches, group.language);
        LAST_GAZETTES_BY_CHAT.set(game.chatId.toString(), gazette);
        const gazetteMsg = `${gazette.title}\n\n${gazette.lines.join('\n')}`;
        await this.sendRaw(game.chatId, gazetteMsg);
        gazetteGenerations.inc();
      } catch (err) {
        this.logger.error(
          { err, chatId: game.chatId.toString() },
          'Failed to generate village gazette',
        );
      }
    } catch (err) {
      this.logger.error(
        { err, chatId: game.chatId.toString() },
        'Failed to send end-of-game summary',
      );
    }

    await this.unmuteAllDead(game.chatId);
    this.games.remove(game.chatId);
  }

  /**
   * Evaluates and persists every achievement this just-finished game earned - both the
   * single-game ones (`evaluateGameAchievements`, pure) and the cross-game ones
   * (`AchievementRepository.recordGameResult`, DB-backed) - then PMs each player who unlocked
   * something new.
   */
  private async awardAchievements(
    game: Game,
    batches: readonly (readonly GameEvent[])[],
    startedAt: Date | undefined,
  ): Promise<void> {
    const group = await this.groups.getOrCreate(game.chatId, null, null);
    const allEvents = batches.flat();

    const singleGame = evaluateGameAchievements({
      players: game.players,
      mode: game.mode,
      winningTeam: game.winningTeam,
      eventBatches: batches,
      showRolesOnDeath: group.showRolesOnDeath,
    });

    const guardianAngel = game.players.find((p) => p.role === ROLE_BIT.GuardianAngel);
    const gaSaves = allEvents.filter((e) => GA_SAVE_EVENT_TYPES.has(e.type)).length;

    const newUnlocks = new Map<bigint, AchievementCode[]>();
    for (const [playerId, codes] of singleGame) {
      for (const code of codes) {
        if (await this.achievements.unlock(playerId, code)) {
          const list = newUnlocks.get(playerId) ?? [];
          list.push(code);
          newUnlocks.set(playerId, list);
        }
      }
    }

    const longHaul = startedAt
      ? {
          durationMs: Date.now() - startedAt.getTime(),
          survivingTelegramIds: game.players.filter((p) => !p.isDead && !p.fled).map((p) => p.id),
        }
      : null;

    const crossGameUnlocks = await this.achievements.recordGameResult(
      game.players.map((p) => p.id),
      firstLynchVictimId(batches),
      guardianAngel && gaSaves > 0
        ? { telegramId: guardianAngel.id, savesThisGame: gaSaves }
        : null,
      longHaul,
    );
    for (const [playerId, codes] of crossGameUnlocks) {
      const list = newUnlocks.get(playerId) ?? [];
      list.push(...codes);
      newUnlocks.set(playerId, list);
    }

    for (const [playerId, codes] of newUnlocks) {
      for (const code of codes) await this.announceAchievement(playerId, group.language, code);
    }
  }

  private async announceAchievement(
    telegramId: bigint,
    language: string,
    code: AchievementCode,
  ): Promise<void> {
    const meta = ACHIEVEMENTS[code];
    try {
      await this.bot.api.sendMessage(
        chatNumber(telegramId),
        this.t.translate(language, 'AchievementUnlocked', meta.name, meta.description),
      );
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }

  // ------------------------------------------------------------- Callbacks

  /**
   * Single entry point for every night/day/lynch inline-button press. `chatId` is the chat the
   * button was pressed in (a player's own PM for night/day menus, the group chat for lynch votes) -
   * used only to find the right game for lynch votes; every other action looks the game up by
   * player id instead, since those buttons arrive over PM.
   */
  async handleCallback(playerId: bigint, chatId: bigint, data: string): Promise<string | null> {
    const [action, ...rest] = data.split(':');
    const expectedPhase: GamePhase | undefined =
      action === 'vote'
        ? 'Lynch'
        : action?.startsWith('nt') || action?.startsWith('dt')
          ? 'Night'
          : undefined;
    const game = this.games.findByPlayer(playerId, expectedPhase) ?? this.games.get(chatId);
    if (!game) return null;

    const language = (await this.groups.getOrCreate(game.chatId, null, null)).language;
    const key = await this.dispatchCallback(game, playerId, language, action!, rest);
    return key ? this.t.translate(language, key) : null;
  }

  private async dispatchCallback(
    game: Game,
    playerId: bigint,
    language: string,
    action: string,
    rest: string[],
  ): Promise<string | null> {
    switch (action) {
      case 'vote':
        if (game.phase !== 'Lynch') return null;
        return this.applyLynchVote(game, playerId, rest[0]!);
      case 'nt':
        if (game.phase !== 'Night') return null;
        return this.applyChoice(game, playerId, 'choice', rest[0]!);
      case 'nt2':
        if (game.phase !== 'Night') return null;
        return this.applyChoice(game, playerId, 'choice2', rest[0]!);
      case 'dt':
        if (game.phase !== 'Day') return null;
        return this.applyChoice(game, playerId, 'choice', rest[0]!);
      case 'shoot': {
        // The Hunter is already dead by the time this menu is offered (it's their final act), so
        // this can't go through applyChoice() - that rejects dead actors for every other menu.
        const hunter = game.players.find(
          (p) => p.id === playerId && p.isDead && p.pendingHunterShot !== null,
        );
        if (!hunter) return null;
        hunter.choice = rest[0] === 'abstain' ? ABSTAIN : BigInt(rest[0]!);
        return 'ChoiceRecorded';
      }
      case 'spark': {
        if (game.phase !== 'Night') return null;
        const actor = game.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Arsonist);
        if (!actor) return null;
        actor.choice = SPARK;
        return 'ChoiceRecorded';
      }
      case 'nrm': {
        if (game.phase !== 'Night') return null;
        const actor = game.players.find((p) => p.id === playerId);
        if (!actor || (actor.role !== ROLE_BIT.WildChild && actor.role !== ROLE_BIT.Doppelganger))
          return null;
        actor.roleModel = BigInt(rest[0]!);
        return 'ChoiceRecorded';
      }
      case 'ability':
        if (game.phase !== 'Day') return null;
        return await this.applyAbility(game, playerId, rest[0] as RoleName);
      case 'cupid1': {
        if (game.phase !== 'Night') return null;
        const cupid = game.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Cupid);
        if (!cupid) return null;
        const lover1 = game.players.find((p) => p.id === BigInt(rest[0]!));
        if (!lover1) return null;
        const targets = dayOneTargets(game.players, cupid).filter((p) => p.id !== lover1.id);
        if (targets.length > 0) {
          await this.sendPm(
            cupid.id,
            language,
            'AskCupidSecond',
            targetKeyboard(targets, `cupid2:${lover1.id.toString()}`, language, this.t, false),
          );
        }
        return 'ChoiceRecorded';
      }
      case 'cupid2': {
        if (game.phase !== 'Night') return null;
        const cupid = game.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Cupid);
        if (!cupid) return null;
        const lover1 = game.players.find((p) => p.id === BigInt(rest[0]!));
        const lover2 = game.players.find((p) => p.id === BigInt(rest[1]!));
        if (!lover1 || !lover2 || lover1.id === lover2.id) return null;
        lover1.inLove = true;
        lover2.inLove = true;
        lover1.loverId = lover2.id;
        lover2.loverId = lover1.id;
        return 'ChoiceRecorded';
      }
      default:
        return null;
    }
  }

  private applyChoice(
    game: Game,
    playerId: bigint,
    field: 'choice' | 'choice2',
    rawTarget: string,
  ): string | null {
    const actor = game.players.find((p) => p.id === playerId);
    if (!actor || actor.isDead) return null;
    actor[field] = rawTarget === 'abstain' ? ABSTAIN : BigInt(rawTarget);
    return 'ChoiceRecorded';
  }

  /**
   * Mirrors the original's live per-vote group announcement: who voted for whom normally, or -
   * under `AllowSecretLynch` (the group's `secretLynch` flag) - just a running "X/Y have voted"
   * count instead, so the target stays hidden until the reveal in `sendSecretLynchSummary()`.
   * Abstains don't announce anything, matching the fact the original's announcement code only
   * ever names a concrete target.
   */
  private async applyLynchVote(
    game: Game,
    playerId: bigint,
    rawTarget: string,
  ): Promise<string | null> {
    const voter = game.players.find((p) => p.id === playerId);
    if (!voter || voter.isDead) return null;
    const result = this.applyChoice(game, playerId, 'choice', rawTarget);
    if (result !== 'ChoiceRecorded') return result;
    game.registerLynchVoteCast(playerId);

    const group = await this.groups.getOrCreate(game.chatId, null, null);
    if (group.secretLynch) {
      const voted = alivePlayers(game.players).filter((p) => p.choice !== null).length;
      await this.send(
        game.chatId,
        group.language,
        'PlayerVoteCounts',
        voted,
        alivePlayers(game.players).length,
      );
    } else if (rawTarget === 'abstain') {
      await this.send(game.chatId, group.language, 'PlayerVotedLynchAbstain', voter.name);
    } else {
      const target = game.players.find((p) => p.id === BigInt(rawTarget));
      if (target)
        await this.send(game.chatId, group.language, 'PlayerVotedLynch', voter.name, target.name);
    }

    const alive = alivePlayers(game.players);
    if (
      alive.length > 0 &&
      alive.every((p) => p.choice !== null) &&
      game.players.some((p) => p.isBot)
    ) {
      this.skipVote(game.chatId);
    }

    return result;
  }

  /**
   * Mirrors the original's post-vote reveal: with `secretLynch` on, individual votes stay hidden
   * until now. `secretLynchShowVotes` gates whether a breakdown is shown at all; if it is,
   * `secretLynchShowVoters` further gates whether it names who voted for whom, or just a count.
   * Read right after `game.resolveLynch()` - the tally resets at the top of the next attempt.
   */
  private async sendSecretLynchSummary(game: Game, group: GroupWithConfig): Promise<void> {
    if (!group.secretLynch || !group.secretLynchShowVotes) return;

    const voted = game.players.filter((p) => p.votes > 0).sort((a, b) => b.votes - a.votes);
    if (voted.length === 0) return;

    const lines = voted.map((p) => {
      if (group.secretLynchShowVoters) {
        const voters = [...p.votedBy].map((id) => findName(game.players, id)).join(', ');
        return this.t.translate(group.language, 'SecretLynchResultEach', p.votes, p.name, voters);
      }
      return this.t.translate(group.language, 'SecretLynchResultNumber', p.votes, p.name);
    });
    await this.send(game.chatId, group.language, 'SecretLynchResultFull', lines.join('\n'));
  }

  private async applyAbility(game: Game, playerId: bigint, role: RoleName): Promise<string | null> {
    const player = game.players.find((p) => p.id === playerId && !p.isDead);
    if (!player || roleName(player.role) !== role) return null;
    const group = await this.groups.getOrCreate(game.chatId, null, null);

    switch (role) {
      case 'Mayor': {
        if (!game.useMayorReveal(playerId)) return 'AbilityAlreadyUsed';
        await this.send(game.chatId, group.language, 'MayorRevealedMsg', player.name);
        return 'MayorRevealedMsg';
      }
      case 'Pacifist': {
        if (!game.usePacifistPeace(playerId)) return 'AbilityAlreadyUsed';
        await this.send(game.chatId, group.language, 'PacifistDeclaredMsg', player.name);
        return 'PacifistDeclaredMsg';
      }
      case 'Blacksmith': {
        const events = game.useBlacksmithSpreadSilver(playerId);
        if (events.length === 0) return 'AbilityAlreadyUsed';
        this.logEvents(game.chatId, events);
        await this.send(game.chatId, group.language, 'BlacksmithSpreadMsg', player.name);
        return 'BlacksmithSpreadMsg';
      }
      case 'Sandman': {
        const events = game.useSandmanSleep(playerId);
        if (events.length === 0) return 'AbilityAlreadyUsed';
        this.logEvents(game.chatId, events);
        await this.send(game.chatId, group.language, 'SandmanUsedMsg', player.name);
        return 'SandmanUsedMsg';
      }
      case 'Troublemaker': {
        if (!game.useTroublemakerDoubleLynch(playerId)) return 'AbilityAlreadyUsed';
        await this.send(game.chatId, group.language, 'TroubleDoubleLynchNow', player.name);
        return 'TroubleDoubleLynchNow';
      }
      default:
        return null;
    }
  }

  // --------------------------------------------------------------- Sending

  /** Records a batch of events for `evaluateGameAchievements()` at game end, without sending anything. */
  private logEvents(chatId: bigint, events: readonly GameEvent[]): void {
    const batches = this.eventBatches.get(chatId) ?? [];
    batches.push([...events]);
    this.eventBatches.set(chatId, batches);
  }

  private async broadcast(
    game: Game,
    group: GroupWithConfig,
    events: readonly GameEvent[],
    phase: 'Night' | 'Day' | 'Lynch',
  ): Promise<void> {
    this.logEvents(game.chatId, events);

    for (const event of events) {
      for (const msg of describeEvent(
        event,
        game.players,
        group.showRolesOnDeath,
        this.t,
        group.language,
      )) {
        if (msg.audience === 'group') {
          await this.send(game.chatId, group.language, msg.key, ...msg.args);
        } else {
          await this.send(msg.audience, group.language, msg.key, ...msg.args);
        }
      }
      await this.sendGifForEvent(game, group, event);
      await this.recordKillEvent(game, phase, event);
    }
    await this.syncMuteDead(game, group);
  }

  private async syncMuteDead(game: Game, group: GroupWithConfig): Promise<void> {
    if (!group.muteDead) return;
    let mutedSet = this.mutedPlayers.get(game.chatId);
    if (!mutedSet) {
      mutedSet = new Set<bigint>();
      this.mutedPlayers.set(game.chatId, mutedSet);
    }

    for (const player of game.players) {
      if (player.isDead && !player.isBot && player.id > 0n && !mutedSet.has(player.id)) {
        try {
          await this.bot.api.restrictChatMember(chatNumber(game.chatId), Number(player.id), {
            can_send_messages: false,
          });
          mutedSet.add(player.id);
        } catch (err) {
          // Always mark player as processed to prevent retrying restrictChatMember on every cycle
          mutedSet.add(player.id);
          if (
            err instanceof GrammyError &&
            (err.description.includes("can't remove chat owner") ||
              err.description.includes('PARTICIPANT_ID_INVALID') ||
              err.description.includes('not enough rights') ||
              err.description.includes('user is an administrator'))
          ) {
            continue;
          }
          this.logger.warn(
            { err, chatId: game.chatId.toString(), playerId: player.id.toString() },
            'Failed to mute dead player in Telegram group',
          );
        }
      }
    }
  }

  private async unmuteAllDead(chatId: bigint): Promise<void> {
    const mutedSet = this.mutedPlayers.get(chatId);
    if (!mutedSet || mutedSet.size === 0) {
      this.mutedPlayers.delete(chatId);
      return;
    }

    for (const playerId of mutedSet) {
      try {
        await this.bot.api.restrictChatMember(chatNumber(chatId), Number(playerId), {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
      } catch (err) {
        this.logger.warn(
          { err, chatId: chatId.toString(), playerId: playerId.toString() },
          'Failed to unmute dead player in Telegram group',
        );
      }
    }
    this.mutedPlayers.delete(chatId);
  }

  private async processBotNightActions(game: Game): Promise<void> {
    const aliveBots = alivePlayers(game.players).filter(
      (p) => p.isBot && !p.isDead && p.choice === null,
    );
    if (aliveBots.length === 0) return;

    for (const botPlayer of aliveBots) {
      botNightActions.inc();
      const otherAlive = alivePlayers(game.players).filter((p) => p.id !== botPlayer.id);
      if (otherAlive.length === 0) continue;

      if (
        game.dayNumber === 1 &&
        (botPlayer.role === ROLE_BIT.WildChild || botPlayer.role === ROLE_BIT.Doppelganger) &&
        botPlayer.roleModel === null
      ) {
        const target = otherAlive[Math.floor(Math.random() * otherAlive.length)]!;
        botPlayer.roleModel = target.id;
        continue;
      }

      if (game.dayNumber === 1 && botPlayer.role === ROLE_BIT.Cupid && !botPlayer.hasUsedAbility) {
        if (otherAlive.length >= 2) {
          const lover1 = otherAlive[0]!;
          const lover2 = otherAlive[1]!;
          lover1.inLove = true;
          lover2.inLove = true;
          lover1.loverId = lover2.id;
          lover2.loverId = lover1.id;
          botPlayer.hasUsedAbility = true;
        }
        continue;
      }

      if (botPlayer.role === ROLE_BIT.Arsonist) {
        const doused = game.players.some((p) => p.doused && !p.isDead);
        if (doused && Math.random() < 0.5) {
          botPlayer.choice = SPARK;
        } else {
          const target = otherAlive[Math.floor(Math.random() * otherAlive.length)]!;
          botPlayer.choice = target.id;
        }
        continue;
      }

      const target = otherAlive[Math.floor(Math.random() * otherAlive.length)]!;
      botPlayer.choice = target.id;
    }
  }

  private async processBotLynchVotes(game: Game): Promise<void> {
    const aliveBots = alivePlayers(game.players).filter(
      (p) => p.isBot && !p.isDead && p.choice === null,
    );
    if (aliveBots.length === 0) return;

    await Promise.all(
      aliveBots.map(async (botPlayer) => {
        const delay = Math.floor(Math.random() * 2000) + 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (game.phase !== 'Lynch' || botPlayer.isDead || botPlayer.choice !== null) return;

        const otherAlive = alivePlayers(game.players).filter((p) => p.id !== botPlayer.id);
        const shouldAbstain = Math.random() < 0.1;
        let rawTarget = 'abstain';
        if (shouldAbstain) {
          skipVoteActions.inc();
        } else if (otherAlive.length > 0) {
          const target = otherAlive[Math.floor(Math.random() * otherAlive.length)]!;
          rawTarget = target.id.toString();
        }

        await this.applyLynchVote(game, botPlayer.id, rawTarget);
      }),
    );
  }

  async sendGifCategory(
    chatId: bigint,
    group: GroupWithConfig,
    category: GifCategory,
  ): Promise<void> {
    try {
      gifSends.labels(category).inc();
    } catch {
      // ignore
    }
    const fileId = this.gifPacks
      ? await this.gifPacks.getApprovedFileId(category, group.defaultGifPackId)
      : null;
    const media = fileId ?? this.localGifPack.resolve(category);
    if (!media) return;

    try {
      await this.bot.api.sendAnimation(chatNumber(chatId), media);
    } catch (err) {
      this.logger.warn(
        { err, chatId: chatId.toString(), category },
        'Failed to send gif animation',
      );
    }
  }

  /**
   * Port of the original's custom-gif-pack broadcasting: alongside the text announcement, send
   * whichever video/animation the group's default pack (or, for a death, the dying player's own
   * approved pack) has configured for this event. Falls back to a bundled default under
   * `assets/gifs/` (see `LocalGifPack`) when no approved custom pack covers this category - a
   * no-op (today's text-only behavior, unchanged) until either one is actually supplied.
   */
  private async sendGifForEvent(
    game: Game,
    group: GroupWithConfig,
    event: GameEvent,
  ): Promise<void> {
    this.recordRoleAbilityMetrics(event);
    let category: GifCategory | null = null;
    let playerId: bigint | undefined;

    if (event.type === 'PlayerDied') {
      category =
        event.method === 'Burn'
          ? 'BurnToDeath'
          : event.method === 'SerialKilled'
            ? 'SKKilled'
            : 'VillagerDie';
      playerId = event.playerId;
    } else if (event.type === 'GameEnded') {
      category = WIN_TEAM_GIF_CATEGORY[event.winningTeam] ?? null;
    }
    if (!category) return;

    const fileId = this.gifPacks
      ? await this.gifPacks.getApprovedFileId(category, group.defaultGifPackId, playerId)
      : null;
    const media = fileId ?? this.localGifPack.resolve(category);
    if (!media) return;

    try {
      await this.bot.api.sendAnimation(chatNumber(game.chatId), media);
    } catch (err) {
      this.logger.warn(
        { err, chatId: game.chatId.toString(), category },
        'Failed to send gif pack animation',
      );
    }
  }

  private recordRoleAbilityMetrics(event: GameEvent): void {
    const type = event.type as string;
    if (event.type === 'PlayerDied') {
      const method = (event as any).method as string;
      if (method === 'WitchPotion') witchPoisonPotions.inc();
      if (method === 'Hitman') hitmanKills.inc();
    } else if (type === 'WitchSavedPlayer') {
      witchSavePotions.inc();
    } else if (type === 'PlayerResurrected') {
      necromancerResurrections.inc();
    } else if (type === 'MimicCopiedRole') {
      mimicUsages.inc();
    }
  }

  /** Persists `PlayerDied`/`LoverDiedOfGrief` events as `GameKill` rows - see `GameRepository.recordKill`. */
  private async recordKillEvent(
    game: Game,
    phase: 'Night' | 'Day' | 'Lynch',
    event: GameEvent,
  ): Promise<void> {
    const gameId = this.gameIds.get(game.chatId);
    if (gameId === undefined) return;

    if (event.type === 'PlayerDied') {
      await this.gameRepo.recordKill(
        gameId,
        event.playerId,
        event.killerIds,
        event.method,
        phase,
        game.dayNumber,
      );
    } else if (event.type === 'LoverDiedOfGrief') {
      await this.gameRepo.recordKill(
        gameId,
        event.playerId,
        [],
        'LoverDied',
        phase,
        game.dayNumber,
      );
    }
  }

  private async send(
    chatId: bigint,
    language: string,
    key: string,
    ...args: unknown[]
  ): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatNumber(chatId), this.t.translate(language, key, ...args));
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }

  /**
   * Looks up each player's donor badge (🥉/🥈/🥇, or none) for display in the end-of-game recap -
   * mirrors `Extensions.cs`'s `GetName()` appending a medal wherever a player's name is shown, for
   * whichever donation tier `player.DonationLevel` has reached. Returns an empty map (no badges)
   * if this `GameLoop` wasn't wired up with a `PlayerRepository` (e.g. in tests that don't need it).
   */
  private async donorBadges(playerIds: readonly bigint[]): Promise<Map<bigint, string>> {
    const badges = new Map<bigint, string>();
    if (!this.players) return badges;
    for (const id of playerIds) {
      const dbPlayer = await this.players.findByTelegramId(id);
      const badge = donorBadge(dbPlayer?.donationLevel ?? 0);
      if (badge) badges.set(id, badge);
    }
    return badges;
  }

  /** Sends an already-built message verbatim (e.g. `buildEndGameSummary`'s output) instead of translating a key. */
  private async sendRaw(chatId: bigint, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatNumber(chatId), text, { parse_mode: 'HTML' });
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }

  private async sendPm(
    telegramId: bigint,
    language: string,
    key: string,
    keyboard: InlineKeyboard,
  ): Promise<void> {
    try {
      let text: string;
      try {
        text = this.t.translate(language, key);
      } catch (err) {
        if (err instanceof MissingLocaleStringError && key !== 'AskTarget') {
          text = this.t.translate(language, 'AskTarget');
        } else {
          throw err;
        }
      }
      await this.bot.api.sendMessage(chatNumber(telegramId), text, { reply_markup: keyboard });
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }
}

/** Maps a `GameEnded` winning team to its custom-gif-pack category - mirrors `CustomGifData`'s
 * per-outcome fields. Team outcomes with no original equivalent (this port's `SKHunter` standoff
 * win, `Neutral`/`Thief`) are left out - they simply never trigger a gif, same as today. */
const WIN_TEAM_GIF_CATEGORY: Partial<Record<Team, GifCategory>> = {
  Village: 'VillagersWin',
  Wolf: 'WolvesWin',
  Tanner: 'TannerWin',
  Cult: 'CultWins',
  SerialKiller: 'SerialKillerWins',
  Arsonist: 'ArsonistWins',
  Lovers: 'LoversWin',
  NoOne: 'NoWinner',
};

const NIGHT_PROMPT_KEY: Partial<Record<RoleName, string>> = {
  Seer: 'AskSeer',
  Sorcerer: 'AskSorcerer',
  Oracle: 'AskOracle',
  Fool: 'AskFool',
  GuardianAngel: 'AskGuardianAngel',
  Harlot: 'AskHarlot',
  SnowWolf: 'AskSnowWolf',
  Wolf: 'AskWolfPack',
  AlphaWolf: 'AskWolfPack',
  WolfCub: 'AskWolfPack',
  TrapperWolf: 'AskWolfPack',
  ChameleonWolf: 'AskWolfPack',
  ViperWolf: 'AskWolfPack',
  HowlerWolf: 'AskWolfPack',
  HypnotistWolf: 'AskWolfPack',
  BerserkerWolf: 'AskWolfPack',
  Lycan: 'AskWolfPack',
  SerialKiller: 'AskSerialKiller',
  CultistHunter: 'AskCultistHunter',
  Cultist: 'AskCultist',
  Chemist: 'AskChemist',
  Thief: 'AskThief',
  GraveDigger: 'AskGraveDigger',
  Augur: 'AskAugur',
  Watchman: 'AskWatchman',
  Tracker: 'AskTracker',
  Priestess: 'AskPriestess',
  Mimic: 'AskMimic',
  Archangel: 'AskArchangel',
  Necromancer: 'AskNecromancer',
  Reflector: 'AskReflector',
  Crow: 'AskCrow',
};

const DAY_PROMPT_KEY: Partial<Record<RoleName, string>> = {
  Gunner: 'AskGunner',
  Spumpkin: 'AskSpumpkin',
  Detective: 'AskDetective',
};

const ABILITY_BUTTON_KEY: Partial<Record<RoleName, string>> = {
  Mayor: 'MayorButton',
  Pacifist: 'PacifistButton',
  Blacksmith: 'BlacksmithButton',
  Sandman: 'SandmanButton',
  Troublemaker: 'TroublemakerButton',
};

function findName(players: readonly Player[], id: bigint): string {
  return players.find((p) => p.id === id)?.name ?? '???';
}

function chatNumber(id: bigint): number {
  return Number(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(seconds: number): string {
  return `${seconds}s`;
}

function targetKeyboard(
  targets: readonly Player[],
  dataPrefix: string,
  language: string,
  t: Translator,
  includeAbstain = true,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  targets.forEach((p, index) => {
    keyboard.text(p.name, `${dataPrefix}:${p.id.toString()}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (targets.length % 2 === 1) keyboard.row();
  if (includeAbstain) {
    keyboard.text(t.translate(language, 'AbstainButton'), `${dataPrefix}:abstain`);
  }
  return keyboard;
}

function abilityKeyboard(role: Role, language: string, t: Translator): InlineKeyboard {
  const name = roleName(role);
  const key = ABILITY_BUTTON_KEY[name]!;
  return new InlineKeyboard().text(t.translate(language, key), `ability:${name}`);
}
