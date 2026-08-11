/**
 * Port of the "joining" half of `Werewolf Node/Werewolf.cs` (the constructor,
 * `GameTimer`'s join-countdown loop, `AddPlayer`, `RemovePlayer`, `ForceStart`)
 * plus `Werewolf Control/Commands/GameCommands.cs`'s command handlers, minus
 * the gif/image system (out of scope for this migration - see README) and the
 * achievements/custom-gif-pack bookkeeping.
 *
 * What happens after roles are dealt (`AssignRoles()` onward - the actual
 * night/day/lynch loop with its menus and timers) is deliberately not here -
 * that's task #25. `finishJoining()` deals roles, persists the game, PMs
 * everyone their role and then stops managing the chat; the `Game` stays
 * registered in `GameManager` for the night/day loop to pick up.
 */

import { Bot, GrammyError, InlineKeyboard } from 'grammy';
import { GameAlreadyRunningError, GameManager } from '../../application/game-manager.js';
import { Game, GameError } from '../../domain/game/game.aggregate.js';
import type { GameMode } from '../../domain/game/game-mode.js';
import { ROLE_META, roleName } from '../../domain/roles/role.js';
import { GameRepository } from '../persistence/game.repository.js';
import { groupToGameOptions, GroupRepository, resolveGameMode } from '../persistence/group.repository.js';
import { NotifyGameRepository } from '../persistence/notify-game.repository.js';
import { donorBadge, PlayerRepository } from '../persistence/player.repository.js';
import type { Translator } from '../i18n/translator.js';
import type { Logger } from '../logging/logger.js';
import type { GameLoop } from './game-loop.js';

const WARNING_SECONDS: readonly number[] = [60, 30, 10];
const ANNOUNCE_JOINED_EVERY_SECONDS = 30;
const JOIN_BUTTON_CALLBACK = 'werewolf:join';

interface LobbySession {
  game: Game;
  chatId: bigint;
  language: string;
  secondsLeft: number;
  forceStarted: boolean;
  playersJoinedSinceAnnounce: string[];
  interval: ReturnType<typeof setInterval>;
  /** Non-admins may only /extend the join countdown once each - mirrors `HaveExtended`. */
  haveExtended: Set<bigint>;
}

export class GameLobbyManager {
  private readonly sessions = new Map<bigint, LobbySession>();

  constructor(
    private readonly bot: Bot,
    private readonly games: GameManager,
    private readonly groups: GroupRepository,
    private readonly players: PlayerRepository,
    private readonly gameRepo: GameRepository,
    private readonly t: Translator,
    private readonly logger: Logger,
    private readonly gameLoop: GameLoop,
    private readonly notifyGames: NotifyGameRepository,
    private readonly joinTimeSeconds = 180,
  ) {}

  get joinButtonCallbackData(): string {
    return JOIN_BUTTON_CALLBACK;
  }

  async startGame(
    chatId: bigint,
    chatTitle: string | null,
    starter: { id: bigint; name: string },
    requestedMode: GameMode,
  ): Promise<void> {
    const group = await this.groups.getOrCreate(chatId, chatTitle, null);
    const language = group.language;

    if (this.games.has(chatId)) {
      await this.send(chatId, language, 'GameAlreadyRunning');
      return;
    }

    // The group's /config mode preference (force Normal/Chaos, or pick randomly) overrides which
    // of /startgame vs /startchaos was actually typed - mirrors the original's DbGroup.Mode check.
    const mode = resolveGameMode(group, requestedMode);

    const options = groupToGameOptions(group);
    let game: Game;
    try {
      game = this.games.create(chatId, {
        mode,
        disabledRoleFlags: options.disabledRoleFlags,
        burningOverkill: options.burningOverkill,
        thiefFull: options.thiefFull,
        maxPlayers: options.maxPlayers,
      });
    } catch (err) {
      if (err instanceof GameAlreadyRunningError) {
        await this.send(chatId, language, 'GameAlreadyRunning');
        return;
      }
      throw err;
    }

    const keyboard = new InlineKeyboard().text(this.t.translate(language, 'JoinButton'), JOIN_BUTTON_CALLBACK);
    const messageKey = mode === 'Chaos' ? 'PlayerStartedChaosGame' : 'PlayerStartedGame';
    await this.bot.api.sendMessage(chatNumber(chatId), this.t.translate(language, messageKey, starter.name), {
      reply_markup: keyboard,
    });

    await this.notifyWaitingPlayers(chatId, group.title ?? '', language, starter.id);

    const session: LobbySession = {
      game,
      chatId,
      language,
      secondsLeft: this.joinTimeSeconds,
      forceStarted: false,
      playersJoinedSinceAnnounce: [],
      interval: setInterval(() => void this.tick(chatId), 1000),
      haveExtended: new Set(),
    };
    this.sessions.set(chatId, session);
  }

  /**
   * PMs everyone on this group's `/nextgame` waitlist that a new lobby just opened - mirrors
   * `Helpers.cs`'s `notify` loop. Their waitlist row isn't cleared here (they might still be
   * offline and miss the join window) - it's only cleared once a lobby actually locks in and
   * deals roles, in `finishJoining()`, matching the original's `Werewolf.cs` cleanup point.
   */
  private async notifyWaitingPlayers(chatId: bigint, groupTitle: string, language: string, starterId: bigint): Promise<void> {
    const waiting = await this.notifyGames.listWaiting(chatId);
    for (const userId of waiting) {
      if (userId === starterId) continue;
      await this.sendToUser(userId, language, 'NotifyNewGame', groupTitle);
    }
  }

  async join(chatId: bigint, telegramUser: { id: bigint; firstName: string; lastName?: string; username?: string }): Promise<void> {
    const session = this.sessions.get(chatId);
    const group = await this.groups.getOrCreate(chatId, null, null);
    const language = session?.language ?? group.language;

    if (!session) {
      await this.send(chatId, language, 'NoGameRunning');
      return;
    }

    const name = `${telegramUser.firstName} ${telegramUser.lastName ?? ''}`.replace(/\n/g, '').trim();

    if (session.game.players.some((p) => p.name === name)) {
      await this.send(chatId, language, 'NameExists', name);
      return;
    }

    await this.players.upsert(telegramUser.id, {
      displayName: name,
      username: telegramUser.username ?? null,
    });
    if (await this.players.isBanned(telegramUser.id)) return;

    try {
      session.game.addPlayer(telegramUser.id, name);
    } catch (err) {
      if (err instanceof GameError && err.code === 'ALREADY_JOINED') return;
      if (err instanceof GameError && err.code === 'GROUP_FULL') {
        await this.send(chatId, language, 'PlayerLimitReached');
        return;
      }
      if (err instanceof GameError && err.code === 'NOT_JOINING') {
        await this.send(chatId, language, 'NoGameRunning');
        return;
      }
      throw err;
    }

    session.playersJoinedSinceAnnounce.push(name);
    await this.sendToUser(telegramUser.id, language, 'YouJoined', group.title ?? '');
  }

  async forceStart(chatId: bigint, isAdmin: boolean): Promise<void> {
    const session = this.sessions.get(chatId);
    const group = await this.groups.getOrCreate(chatId, null, null);
    const language = session?.language ?? group.language;

    if (!session) {
      await this.send(chatId, language, 'NoGameRunning');
      return;
    }
    if (!isAdmin) {
      await this.send(chatId, language, 'ForceStartNotAdmin');
      return;
    }

    session.forceStarted = true;
    await this.send(chatId, language, 'ForceStarted');
  }

  /**
   * Mirrors `/extend`: while still in the join countdown, a player already in the lobby (or a
   * group/global admin) can push the join deadline further out. Each non-admin player only gets
   * to do this once per game (`HaveExtended`); admins can do it repeatedly. Requires the group's
   * `AllowExtend` setting unless the caller is an admin, and is clamped to the group's
   * `MaxExtend` in either direction - `seconds` may be negative to shorten the countdown, which
   * `bot.ts` only allows admins to request in the first place.
   */
  async extend(chatId: bigint, playerId: bigint, isAdmin: boolean, requestedSeconds: number): Promise<void> {
    const session = this.sessions.get(chatId);
    const group = await this.groups.getOrCreate(chatId, null, null);
    const language = session?.language ?? group.language;

    if (!session) {
      await this.send(chatId, language, 'NoGameRunning');
      return;
    }
    if (!isAdmin && !session.game.players.some((p) => p.id === playerId)) {
      await this.send(chatId, language, 'NotPlaying');
      return;
    }
    if (!isAdmin && !group.allowExtend) {
      await this.send(chatId, language, 'GroupAdminOnly');
      return;
    }
    if (!isAdmin && session.haveExtended.has(playerId)) {
      await this.send(chatId, language, 'CantExtend');
      return;
    }

    const maxExtend = group.maxExtendSeconds;
    const seconds = Math.abs(requestedSeconds) > maxExtend ? maxExtend * Math.sign(requestedSeconds) : requestedSeconds;

    session.secondsLeft = Math.max(session.secondsLeft + seconds, 0);
    session.haveExtended.add(playerId);

    const key = seconds >= 0 ? 'SecondsAdded' : 'SecondsRemoved';
    await this.send(chatId, language, key, Math.abs(seconds), session.secondsLeft);
  }

  async showPlayers(chatId: bigint): Promise<void> {
    const session = this.sessions.get(chatId);
    const group = await this.groups.getOrCreate(chatId, null, null);
    const language = session?.language ?? group.language;

    const game = this.games.get(chatId);
    if (!game) {
      await this.send(chatId, language, 'NoGameRunning');
      return;
    }

    // Mirrors `Extensions.cs`'s `GetName()` appending a donor-tier medal wherever a player's name
    // is shown - here in the /players roster.
    const names =
      (
        await Promise.all(
          game.players.map(async (p) => {
            const dbPlayer = await this.players.findByTelegramId(p.id);
            return `${p.name}${donorBadge(dbPlayer?.donationLevel ?? 0)}`;
          }),
        )
      ).join('\n') || '-';
    await this.send(chatId, language, 'PlayersInGame', game.players.length, names);
  }

  /**
   * Mirrors `/flee`: removes the player from the joining lobby, or - for a game already in
   * progress - marks them fled (`Game.removePlayer` already implements both, mirroring
   * `RemovePlayer`'s lover-death-chain-triggering kill). The night/day loop (task #25) still
   * owns announcing the fled player's role/death to the group once it exists.
   *
   * `AllowFlee` only gates fleeing a game that's already dealt roles - leaving the joining
   * lobby is always allowed, mirroring `RemovePlayer`'s `!IsJoining && IsRunning` check.
   */
  async flee(chatId: bigint, player: { id: bigint; name: string }): Promise<void> {
    const group = await this.groups.getOrCreate(chatId, null, null);
    const language = group.language;

    const game = this.games.get(chatId);
    if (!game) {
      await this.send(chatId, language, 'NoGameRunning');
      return;
    }
    if (game.phase !== 'Joining' && !group.allowFlee) {
      await this.send(chatId, language, 'FleeDisabled');
      return;
    }

    const removed = game.removePlayer(player.id);
    if (!removed) {
      await this.send(chatId, language, 'NotPlaying');
      return;
    }
    await this.send(chatId, language, 'FledGame', player.name);
  }

  /**
   * Mirrors `/smite` (`SmitePlayer` in the original): a group admin forcibly removing someone
   * else, reusing the same `Game.removePlayer` path as `/flee` (lobby removal, or a mid-game
   * kill for a running game) - unlike `/flee` this isn't gated by `AllowFlee`, since it's a
   * moderation action rather than a player's own choice to leave.
   */
  async smite(chatId: bigint, target: { id: bigint; name: string }): Promise<boolean> {
    const group = await this.groups.getOrCreate(chatId, null, null);
    const game = this.games.get(chatId);
    if (!game) return false;

    const removed = game.removePlayer(target.id);
    if (removed) await this.send(chatId, group.language, 'PlayerSmitten', target.name);
    return removed;
  }

  private async tick(chatId: bigint): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.secondsLeft--;

    if (session.forceStarted || session.secondsLeft <= 0) {
      clearInterval(session.interval);
      await this.finishJoining(session);
      return;
    }

    if (session.secondsLeft % ANNOUNCE_JOINED_EVERY_SECONDS === 0 && session.playersJoinedSinceAnnounce.length > 0) {
      await this.send(chatId, session.language, 'HaveJoined', session.playersJoinedSinceAnnounce.join(', '));
      session.playersJoinedSinceAnnounce = [];
    }

    if (WARNING_SECONDS.includes(session.secondsLeft)) {
      if (session.secondsLeft === 60) {
        await this.send(chatId, session.language, 'MinuteLeftToJoin');
      } else {
        await this.send(chatId, session.language, 'SecondsLeftToJoin', session.secondsLeft);
      }
    }
  }

  private async finishJoining(session: LobbySession): Promise<void> {
    this.sessions.delete(session.chatId);

    if (!session.game.canStart()) {
      await this.send(session.chatId, session.language, 'NotEnoughPlayers');
      this.games.remove(session.chatId);
      return;
    }

    await this.send(session.chatId, session.language, 'GameStarting');

    session.game.start();
    await this.notifyGames.clearForGroup(session.chatId);

    const group = await this.groups.getOrCreate(session.chatId, null, null);
    const gameId = await this.gameRepo.createGame(group.id, group.title, session.game.mode);
    const playerDbIdByTelegramId = new Map<bigint, number>();
    for (const p of session.game.players) {
      const dbPlayer = await this.players.findByTelegramId(p.id);
      if (dbPlayer) playerDbIdByTelegramId.set(p.id, dbPlayer.id);
    }
    await this.gameRepo.recordPlayers(gameId, session.game.players, playerDbIdByTelegramId);

    const delivered = await Promise.all(
      session.game.players.map((p) => this.notifyRole(p.id, session.language, p.role)),
    );
    const undelivered = session.game.players.filter((_, index) => !delivered[index]).map((p) => p.name);
    if (undelivered.length > 0) {
      await this.send(session.chatId, session.language, 'PMFailed', undelivered.join(', '));
    }

    // The night/day loop sends its own richer "Night N falls, you have X seconds" message right
    // as it takes over - no need to also announce a bare NightFalls here.
    this.logger.info(
      { chatId: session.chatId.toString(), gameId, players: session.game.players.length },
      'Game started, handing off to the night/day loop',
    );
    this.gameLoop.start(session.game, gameId);
  }

  private async notifyRole(telegramId: bigint, language: string, role: bigint): Promise<boolean> {
    const name = roleName(role);
    const emoji = ROLE_META[name].emoji;
    try {
      await this.bot.api.sendMessage(chatNumber(telegramId), this.t.translate(language, 'YourRoleIs', `${emoji} ${name}`));
      return true;
    } catch (err) {
      if (err instanceof GrammyError) {
        this.logger.warn({ telegramId: telegramId.toString(), err: err.message }, 'Could not PM role to player');
        return false;
      }
      throw err;
    }
  }

  private async send(chatId: bigint, language: string, key: string, ...args: unknown[]): Promise<void> {
    await this.bot.api.sendMessage(chatNumber(chatId), this.t.translate(language, key, ...args));
  }

  private async sendToUser(telegramId: bigint, language: string, key: string, ...args: unknown[]): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatNumber(telegramId), this.t.translate(language, key, ...args));
    } catch (err) {
      if (err instanceof GrammyError) return;
      throw err;
    }
  }
}

function chatNumber(id: bigint): number {
  return Number(id);
}
