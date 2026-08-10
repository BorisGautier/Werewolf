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
import { ROLE_BIT, roleName, type Role, type RoleName } from '../../domain/roles/role.js';
import { WOLF_ROLES } from '../../domain/game/game-balancing.js';
import { ABSTAIN, SPARK, alivePlayers, type Player } from '../../domain/game/player.js';
import type { GameEvent } from '../../domain/game/game-event.js';
import type { GroupWithConfig } from '../persistence/group.repository.js';
import { GameRepository } from '../persistence/game.repository.js';
import { GroupRepository } from '../persistence/group.repository.js';
import type { Translator } from '../i18n/translator.js';
import type { Logger } from '../logging/logger.js';
import { describeEvent } from './messages.js';
import { dayOneTargets, DAY_ABILITY_ROLES, DAY_TARGET_ROLES, NIGHT_TARGET_ROLES, nightTargets } from './role-menus.js';

const NIGHT_ONE_MIN_SECONDS = 120;

export class GameLoop {
  private readonly gameIds = new Map<bigint, number>();

  constructor(
    private readonly bot: Bot,
    private readonly games: GameManager,
    private readonly groups: GroupRepository,
    private readonly gameRepo: GameRepository,
    private readonly t: Translator,
    private readonly logger: Logger,
  ) {}

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

  // ---------------------------------------------------------------- Night

  private async runNight(game: Game): Promise<void> {
    const group = await this.groups.getOrCreate(game.chatId, null, null);

    // The very first night is already entered by GameLobbyManager's game.start() before this loop
    // ever sees the game (so game.phase is already 'Night' the first time runNight() runs) - every
    // subsequent night is entered here, coming from a finished Lynch phase.
    if (game.phase === 'Lynch') game.startNight();

    if (!game.nightSkipped) {
      const seconds = this.nightSeconds(game, group);
      await this.send(game.chatId, group.language, 'NightBeginsTimed', game.dayNumber, seconds);
      await this.sendNightMenus(game, group.language);
      await sleep(seconds * 1000);
    }

    const events = game.resolveNightActions();
    await this.broadcast(game, group, events);
    if (await this.handleHunterShots(game, group, events)) return;
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
      if (game.dayNumber === 1 && (actor.role === ROLE_BIT.WildChild || actor.role === ROLE_BIT.Doppelganger)) {
        await this.sendRoleModelMenu(actor, game.players, language);
        continue;
      }
      if (game.dayNumber === 1 && actor.role === ROLE_BIT.Cupid) {
        await this.sendCupidFirstMenu(actor, game.players, language);
        continue;
      }
      if (!NIGHT_TARGET_ROLES.includes(actor.role)) continue;

      const targets = nightTargets(game.players, actor);
      if (targets.length === 0) continue;

      const promptKey = NIGHT_PROMPT_KEY[roleName(actor.role)] ?? 'AskTarget';
      await this.sendPm(actor.id, language, promptKey, targetKeyboard(targets, 'nt', language, this.t));

      if (WOLF_ROLES.includes(actor.role) && game.wolfCubKilled) {
        await this.sendPm(actor.id, language, 'AskWolfPack', targetKeyboard(targets, 'nt2', language, this.t));
      }
    }
  }

  private async sendArsonistMenu(actor: Player, players: readonly Player[], language: string): Promise<void> {
    const targets = nightTargets(players, actor);
    const keyboard = targetKeyboard(targets, 'nt', language, this.t);
    const dousedCount = alivePlayers(players).filter((p) => p.doused).length;
    if (dousedCount > 0) keyboard.text(this.t.translate(language, 'SparkButton'), 'spark').row();
    await this.sendPm(actor.id, language, 'AskArsonist', keyboard);
  }

  private async sendRoleModelMenu(actor: Player, players: readonly Player[], language: string): Promise<void> {
    const targets = dayOneTargets(players, actor);
    if (targets.length === 0) return;
    const keyboard = targetKeyboard(targets, 'nrm', language, this.t, false);
    const key = actor.role === ROLE_BIT.WildChild ? 'AskWildChild' : 'AskDoppelganger';
    await this.sendPm(actor.id, language, key, keyboard);
  }

  private async sendCupidFirstMenu(actor: Player, players: readonly Player[], language: string): Promise<void> {
    const targets = dayOneTargets(players, actor);
    if (targets.length === 0) return;
    await this.sendPm(actor.id, language, 'AskCupidFirst', targetKeyboard(targets, 'cupid1', language, this.t, false));
  }

  // ------------------------------------------------------------------ Day

  private async runDay(game: Game): Promise<void> {
    const group = await this.groups.getOrCreate(game.chatId, null, null);
    game.startDay();
    const seconds = group.dayTimerSeconds;
    await this.send(game.chatId, group.language, 'DayTime', seconds);
    await this.sendDayMenus(game, group.language);

    await sleep(seconds * 1000);

    const events = game.resolveDayActions();
    await this.broadcast(game, group, events);
    if (await this.handleHunterShots(game, group, events)) return;
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
      await this.sendPm(actor.id, language, promptKey, targetKeyboard(targets, 'dt', language, this.t));
    }
  }

  // ---------------------------------------------------------------- Lynch

  private async runLynch(game: Game): Promise<void> {
    const group = await this.groups.getOrCreate(game.chatId, null, null);
    game.startLynch();
    const attempts = game.lynchAttemptsPlanned;
    const seconds = group.lynchTimerSeconds;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) game.restartLynchVote();

      await this.sendLynchVoteMenu(game, group.language, seconds);
      await sleep(seconds * 1000);

      const result = game.resolveLynch();
      await this.broadcastLynchOutcome(game, group.language, result.resolution);
      await this.broadcast(game, group, result.events);
      if (await this.handleHunterShots(game, group, result.events)) return;
      if (game.phase === 'Ended') return this.finish(game);
    }

    await this.runNight(game);
  }

  private async sendLynchVoteMenu(game: Game, language: string, seconds: number): Promise<void> {
    const alive = alivePlayers(game.players);
    const keyboard = targetKeyboard(alive, 'vote', language, this.t);
    await this.send(game.chatId, language, 'LynchTime', formatDuration(seconds));
    await this.bot.api.sendMessage(chatNumber(game.chatId), this.t.translate(language, 'AskTarget'), {
      reply_markup: keyboard,
    });
  }

  private async broadcastLynchOutcome(
    game: Game,
    language: string,
    resolution: { outcome: string; playerId?: bigint },
  ): Promise<void> {
    switch (resolution.outcome) {
      case 'Tied':
        await this.send(game.chatId, language, 'LynchTied');
        return;
      case 'NoVotes':
        await this.send(game.chatId, language, 'NoOneCastLynch');
        return;
      case 'PacifistPeace':
        await this.send(game.chatId, language, 'PacifistNoLynchNow');
        return;
      case 'PrinceSurvived': {
        const prince = resolution.playerId ? findName(game.players, resolution.playerId) : '';
        await this.send(game.chatId, language, 'PrinceSurvivedLynch', prince);
        return;
      }
      default:
        return; // 'Lynched'/'TannerWinByLynch' are fully covered by the PlayerDied event.
    }
  }

  // --------------------------------------------------------- Hunter shots

  /** Returns true if the game ended while resolving a pending shot (caller should stop the loop). */
  private async handleHunterShots(game: Game, group: GroupWithConfig, events: readonly GameEvent[]): Promise<boolean> {
    const shooters = events.filter(
      (e): e is Extract<GameEvent, { type: 'HunterMustShoot' }> => e.type === 'HunterMustShoot',
    );
    for (const shot of shooters) {
      const hunter = game.players.find((p) => p.id === shot.hunterId);
      if (!hunter) continue;

      const targets = alivePlayers(game.players);
      if (targets.length === 0) continue;

      hunter.choice = null;
      await this.sendPm(hunter.id, group.language, 'AskHunterShot', targetKeyboard(targets, 'shoot', group.language, this.t, false));
      await sleep(group.dayTimerSeconds * 1000);
      hunter.pendingHunterShot = null; // the window's closed - a late "shoot:" callback shouldn't land

      const targetId = hunter.choice;
      if (targetId === null || targetId === ABSTAIN) continue;
      const target = game.players.find((p) => p.id === targetId);
      if (!target || target.isDead) continue;

      const killEvents = game.killPlayer(targetId, shot.method, { killerIds: [hunter.id] });
      await this.send(game.chatId, group.language, 'HunterShotFired', hunter.name, target.name);
      await this.broadcast(game, group, killEvents);

      if (game.phase === 'Ended') {
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
    if (gameId !== undefined) {
      try {
        await this.gameRepo.finalizeGame(gameId, game.winningTeam, game.players);
      } catch (err) {
        this.logger.error({ err, chatId: game.chatId.toString(), gameId }, 'Failed to persist finished game');
      }
    }
    this.games.remove(game.chatId);
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
    const game = action === 'vote' ? this.games.get(chatId) : this.games.findByPlayer(playerId);
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
        return this.applyChoice(game, playerId, 'choice', rest[0]!);
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
        const hunter = game.players.find((p) => p.id === playerId && p.isDead && p.pendingHunterShot !== null);
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
        if (!actor || (actor.role !== ROLE_BIT.WildChild && actor.role !== ROLE_BIT.Doppelganger)) return null;
        actor.roleModel = BigInt(rest[0]!);
        return 'ChoiceRecorded';
      }
      case 'ability':
        if (game.phase !== 'Day') return null;
        return this.applyAbility(game, playerId, rest[0] as RoleName);
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

  private applyChoice(game: Game, playerId: bigint, field: 'choice' | 'choice2', rawTarget: string): string | null {
    const actor = game.players.find((p) => p.id === playerId);
    if (!actor || actor.isDead) return null;
    actor[field] = rawTarget === 'abstain' ? ABSTAIN : BigInt(rawTarget);
    return 'ChoiceRecorded';
  }

  private applyAbility(game: Game, playerId: bigint, role: RoleName): string | null {
    const player = game.players.find((p) => p.id === playerId && !p.isDead);
    if (!player || roleName(player.role) !== role) return null;
    switch (role) {
      case 'Mayor':
        return game.useMayorReveal(playerId) ? 'MayorRevealedMsg' : 'AbilityAlreadyUsed';
      case 'Pacifist':
        return game.usePacifistPeace(playerId) ? 'PacifistDeclaredMsg' : 'AbilityAlreadyUsed';
      case 'Blacksmith':
        return game.useBlacksmithSpreadSilver(playerId) ? 'BlacksmithSpreadMsg' : 'AbilityAlreadyUsed';
      case 'Sandman':
        return game.useSandmanSleep(playerId) ? 'SandmanUsedMsg' : 'AbilityAlreadyUsed';
      case 'Troublemaker':
        return game.useTroublemakerDoubleLynch(playerId) ? 'TroubleDoubleLynchNow' : 'AbilityAlreadyUsed';
      default:
        return null;
    }
  }

  // --------------------------------------------------------------- Sending

  private async broadcast(game: Game, group: GroupWithConfig, events: readonly GameEvent[]): Promise<void> {
    for (const event of events) {
      for (const msg of describeEvent(event, game.players, group.showRolesOnDeath)) {
        if (msg.audience === 'group') {
          await this.send(game.chatId, group.language, msg.key, ...msg.args);
        } else {
          await this.send(msg.audience, group.language, msg.key, ...msg.args);
        }
      }
    }
  }

  private async send(chatId: bigint, language: string, key: string, ...args: unknown[]): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatNumber(chatId), this.t.translate(language, key, ...args));
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }

  private async sendPm(telegramId: bigint, language: string, key: string, keyboard: InlineKeyboard): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatNumber(telegramId), this.t.translate(language, key), { reply_markup: keyboard });
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }
}

const NIGHT_PROMPT_KEY: Partial<Record<RoleName, string>> = {
  Seer: 'AskSeer',
  Sorcerer: 'AskSorcerer',
  Oracle: 'AskOracle',
  GuardianAngel: 'AskGuardianAngel',
  Harlot: 'AskHarlot',
  SnowWolf: 'AskSnowWolf',
  Wolf: 'AskWolfPack',
  AlphaWolf: 'AskWolfPack',
  WolfCub: 'AskWolfPack',
  Lycan: 'AskWolfPack',
  SerialKiller: 'AskSerialKiller',
  CultistHunter: 'AskCultistHunter',
  Cultist: 'AskCultist',
  Chemist: 'AskChemist',
  Thief: 'AskThief',
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
