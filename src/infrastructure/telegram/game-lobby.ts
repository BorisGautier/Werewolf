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

import { Bot, InlineKeyboard } from 'grammy';
import { GameAlreadyRunningError, GameManager } from '../../application/game-manager.js';
import { Game, GameError } from '../../domain/game/game.aggregate.js';
import type { GameMode } from '../../domain/game/game-mode.js';
import { ROLE_BIT, ROLE_META, roleName } from '../../domain/roles/role.js';
import { WOLF_ROLES } from '../../domain/game/game-balancing.js';
import { GameRepository } from '../persistence/game.repository.js';
import {
  groupToGameOptions,
  GroupRepository,
  resolveGameMode,
} from '../persistence/group.repository.js';
import { NotifyGameRepository } from '../persistence/notify-game.repository.js';
import { donorBadge, PlayerRepository } from '../persistence/player.repository.js';
import type { Translator } from '../i18n/translator.js';
import { groupBans } from '../monitoring/metrics.js';
import type { Logger } from '../logging/logger.js';
import type { GameLoop } from './game-loop.js';
import { aboutLocaleKey } from './role-info.js';
import { mentionHtml, mentionOrPlain } from './mention.js';
import {
  activeLobbies,
  botPlayersAdded,
  forceStarts,
  gamesStarted,
  lobbyExtensions,
  nextGameNotifications,
  playersFled,
  playersJoined,
  pmFailures,
  smiteActions,
} from '../monitoring/metrics.js';

const WARNING_SECONDS: readonly number[] = [60, 30, 10];
const ANNOUNCE_JOINED_EVERY_SECONDS = 30;
const JOIN_BUTTON_CALLBACK = 'werewolf:join';

interface LobbySession {
  game: Game;
  chatId: bigint;
  language: string;
  secondsLeft: number;
  forceStarted: boolean;
  playersJoinedSinceAnnounce: { id: bigint; name: string }[];
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
    starter: { id: bigint; name: string; username?: string },
    requestedMode: GameMode,
  ): Promise<void> {
    const group = await this.groups.getOrCreate(chatId, chatTitle, null);
    const language = group.language;

    // Mirrors `StartGame`'s `if (grp.CreatedBy == "BAN")` check: a `/bangroup`'d group never gets
    // to start another game, even after re-inviting the bot - it just leaves again on sight.
    if (group.banned) {
      groupBans.inc();
      try {
        await this.bot.api.leaveChat(chatNumber(chatId));
      } catch (err) {
        this.logger.warn({ err, chatId: chatId.toString() }, 'Failed to leave a banned group');
      }
      return;
    }

    if (!group.isApproved) {
      const msg =
        language === 'fr'
          ? "⚠️ <b>Groupe Non Approuvé</b>\n\nCe groupe n'a pas encore été autorisé par les administrateurs. Un administrateur doit approuver votre groupe dans le Control Center Admin avant de pouvoir lancer une partie."
          : '⚠️ <b>Group Not Approved</b>\n\nThis group has not been authorized by platform administrators yet. An admin must approve your group in the Admin Control Center before games can be started.';
      await this.bot.api.sendMessage(chatNumber(chatId), msg, { parse_mode: 'HTML' });
      return;
    }

    if (this.sessions.has(chatId)) {
      await this.join(chatId, {
        id: starter.id,
        firstName: starter.name,
        ...(starter.username ? { username: starter.username } : {}),
      });
      return;
    }

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

    // Automatically join the player who started the game
    await this.players.upsert(starter.id, { displayName: starter.name });
    const isBanned = await this.players.isBanned(starter.id);
    const suspension = await this.players.checkSuspension(starter.id);
    const groupName = formatGroupTitle(group.title, language, mode);
    if (!isBanned && !suspension.isSuspended) {
      try {
        game.addPlayer(starter.id, starter.name);
        await this.sendToUser(starter.id, language, 'YouJoined', groupName);
      } catch {
        // Ignore if auto-join fails
      }
    }

    const keyboard = new InlineKeyboard().text(
      this.t.translate(language, 'JoinButton'),
      JOIN_BUTTON_CALLBACK,
    );
    const messageKey = mode === 'Chaos' ? 'PlayerStartedChaosGame' : 'PlayerStartedGame';
    await this.bot.api.sendMessage(
      chatNumber(chatId),
      this.t.translate(language, messageKey, mentionHtml(starter.id, starter.name)),
      {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      },
    );

    await this.notifyWaitingPlayers(chatId, groupName, language, starter.id);

    if (group.tagAllOnStart) {
      await this.tagAllMembers(chatId, language);
    }

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
    activeLobbies.inc();

    this.logger.info(
      {
        chatId: chatId.toString(),
        starterId: starter.id.toString(),
        mode,
        joinTimeSeconds: this.joinTimeSeconds,
      },
      'Lobby opened successfully',
    );
  }

  /**
   * PMs everyone on this group's `/nextgame` waitlist that a new lobby just opened - mirrors
   * `Helpers.cs`'s `notify` loop. Their waitlist row isn't cleared here (they might still be
   * offline and miss the join window) - it's only cleared once a lobby actually locks in and
   * deals roles, in `finishJoining()`, matching the original's `Werewolf.cs` cleanup point.
   */
  private async notifyWaitingPlayers(
    chatId: bigint,
    groupTitle: string,
    language: string,
    starterId: bigint,
  ): Promise<void> {
    const waiting = await this.notifyGames.listWaiting(chatId);
    for (const userId of waiting) {
      if (userId === starterId) continue;
      const sent = await this.sendToUser(userId, language, 'NotifyNewGame', groupTitle);
      if (sent) {
        nextGameNotifications.inc();
      }
    }
  }

  async tagAllMembers(chatId: bigint, language: string): Promise<void> {
    const isFr = language === 'fr';
    const waitingUsers = await this.notifyGames.listWaiting(chatId);
    const groupPlayers = await this.players.getGroupPlayers(chatId, 100);
    const registeredMembers = await this.groups.getGroupMembers(chatId, 100);

    const userMap = new Map<bigint, { username?: string | null; displayName?: string | null }>();

    for (const id of waitingUsers) {
      const p = await this.players.findByTelegramId(id);
      if (p) userMap.set(id, { username: p.username, displayName: p.displayName });
    }

    for (const p of groupPlayers) {
      userMap.set(p.telegramId, { username: p.username, displayName: p.displayName });
    }

    for (const m of registeredMembers) {
      userMap.set(m.telegramId, { username: m.username, displayName: m.displayName });
    }

    if (userMap.size === 0) return;

    const mentions: string[] = [];
    for (const [id, info] of userMap.entries()) {
      if (info.username) {
        mentions.push(`@${info.username}`);
      } else {
        const pName = info.displayName ?? (isFr ? 'Membre' : 'Member');
        mentions.push(`<a href="tg://user?id=${id}">${pName}</a>`);
      }
    }

    if (mentions.length > 0) {
      const header = isFr
        ? `📢 <b>APPEL DE LA COMMUNAUTÉ ! REJOIGNEZ LA PARTIE !</b> 🐺\n\n`
        : `📢 <b>COMMUNITY CALL! JOIN THE GAME!</b> 🐺\n\n`;
      const message = `${header}${mentions.join(' ')}`;
      await this.bot.api.sendMessage(chatNumber(chatId), message, { parse_mode: 'HTML' });
    }
  }

  async join(
    chatId: bigint,
    telegramUser: { id: bigint; firstName: string; lastName?: string; username?: string },
  ): Promise<void> {
    const session = this.sessions.get(chatId);
    const group = await this.groups.getOrCreate(chatId, null, null);
    const language = session?.language ?? group.language;

    if (!session) {
      await this.send(chatId, language, 'NoGameRunning');
      return;
    }

    const name = `${telegramUser.firstName} ${telegramUser.lastName ?? ''}`
      .replace(/\n/g, '')
      .trim();

    if (session.game.players.some((p) => p.id === telegramUser.id)) {
      return; // Already in lobby
    }

    let uniqueName = name;
    let counter = 2;
    while (session.game.players.some((p) => p.name === uniqueName)) {
      if (telegramUser.username && counter === 2) {
        uniqueName = `${name} (@${telegramUser.username})`;
      } else {
        uniqueName = `${name} (${counter})`;
      }
      counter++;
    }

    await this.players.upsert(telegramUser.id, {
      displayName: name,
      username: telegramUser.username ?? null,
    });
    if (await this.players.isBanned(telegramUser.id)) return;

    const suspension = await this.players.checkSuspension(telegramUser.id);
    if (suspension.isSuspended) {
      await this.sendToUser(telegramUser.id, language, 'PlayerSuspendedAfk');
      return;
    }

    try {
      session.game.addPlayer(telegramUser.id, uniqueName);
      playersJoined.inc();
      this.logger.info(
        {
          chatId: chatId.toString(),
          playerId: telegramUser.id.toString(),
          uniqueName,
          lobbyPlayers: session.game.players.length,
        },
        'Player joined game lobby',
      );
    } catch (err) {
      if (err instanceof GameError && err.code === 'ALREADY_JOINED') return;
      if (err instanceof GameError && err.code === 'GROUP_FULL') {
        this.logger.warn(
          { chatId: chatId.toString(), playerId: telegramUser.id.toString() },
          'Player join failed — group full',
        );
        await this.send(chatId, language, 'PlayerLimitReached');
        return;
      }
      if (err instanceof GameError && err.code === 'NOT_JOINING') {
        await this.send(chatId, language, 'NoGameRunning');
        return;
      }
      throw err;
    }

    session.playersJoinedSinceAnnounce.push({ id: telegramUser.id, name: uniqueName });
    const sentPm = await this.sendToUser(
      telegramUser.id,
      language,
      'YouJoined',
      formatGroupTitle(group.title, language, session.game.mode),
    );
    if (!sentPm) {
      pmFailures.inc();
      const botUsername = this.bot.botInfo?.username ?? '';
      const keyboard = botUsername
        ? new InlineKeyboard().url(
            this.t.translate(language, 'StartPmButton'),
            `https://t.me/${botUsername}`,
          )
        : undefined;
      await this.bot.api
        .sendMessage(
          chatNumber(chatId),
          this.t.translate(language, 'MustStartPmFirstGroup', mentionHtml(telegramUser.id, name)),
          { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) },
        )
        .catch(() => null);
    }
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
    forceStarts.inc();
    this.logger.info(
      { chatId: chatId.toString(), playersCount: session.game.players.length },
      'Game lobby force-started by admin',
    );
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
  async extend(
    chatId: bigint,
    playerId: bigint,
    isAdmin: boolean,
    requestedSeconds: number,
  ): Promise<void> {
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

    const maxExtend = group.maxExtendSeconds > 0 ? group.maxExtendSeconds : 60;
    const seconds =
      Math.abs(requestedSeconds) > maxExtend
        ? maxExtend * Math.sign(requestedSeconds)
        : requestedSeconds;

    session.secondsLeft = Math.max(session.secondsLeft + seconds, 0);
    session.haveExtended.add(playerId);
    lobbyExtensions.inc();

    this.logger.info(
      {
        chatId: chatId.toString(),
        playerId: playerId.toString(),
        isAdmin,
        secondsAdded: seconds,
        newSecondsLeft: session.secondsLeft,
      },
      'Lobby countdown extended',
    );

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
            return `${mentionOrPlain(p.id, p.name, p.isBot)}${donorBadge(dbPlayer?.donationLevel ?? 0)}`;
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
    playersFled.inc();
    this.logger.info(
      {
        chatId: chatId.toString(),
        playerId: player.id.toString(),
        playerName: player.name,
        phase: game.phase,
      },
      'Player fled game',
    );
    await this.send(chatId, language, 'FledGame', mentionHtml(player.id, player.name));
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
    if (removed) {
      smiteActions.inc();
      this.logger.warn(
        { chatId: chatId.toString(), targetId: target.id.toString(), targetName: target.name },
        'Player smitten by admin',
      );
      await this.send(chatId, group.language, 'PlayerSmitten', mentionHtml(target.id, target.name));
    }
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

    if (
      session.secondsLeft % ANNOUNCE_JOINED_EVERY_SECONDS === 0 &&
      session.playersJoinedSinceAnnounce.length > 0
    ) {
      await this.send(
        chatId,
        session.language,
        'HaveJoined',
        session.playersJoinedSinceAnnounce.map((p) => mentionHtml(p.id, p.name)).join(', '),
      );
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
    activeLobbies.dec();

    if (!session.game.canStart()) {
      this.logger.info(
        { chatId: session.chatId.toString(), playerCount: session.game.players.length },
        'Game lobby cancelled — not enough players',
      );
      await this.send(session.chatId, session.language, 'NotEnoughPlayers');
      this.games.remove(session.chatId);
      return;
    }

    await this.send(session.chatId, session.language, 'GameStarting');

    session.game.start();
    gamesStarted.labels(session.game.mode).inc();
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
      session.game.players.map((p) =>
        p.isBot ? Promise.resolve(true) : this.notifyRole(p, session.game, session.language),
      ),
    );
    const undelivered = session.game.players
      .filter((p, index) => !p.isBot && !delivered[index])
      .map((p) => mentionHtml(p.id, p.name));
    if (undelivered.length > 0) {
      pmFailures.inc(undelivered.length);
      const botUsername = this.bot.botInfo?.username ?? '';
      const keyboard = botUsername
        ? new InlineKeyboard().url(
            this.t.translate(session.language, 'StartPmButton'),
            `https://t.me/${botUsername}`,
          )
        : undefined;
      await this.bot.api
        .sendMessage(
          chatNumber(session.chatId),
          this.t.translate(session.language, 'PMFailed', undelivered.join(', ')),
          { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) },
        )
        .catch(() => null);
    }

    // The night/day loop sends its own richer "Night N falls, you have X seconds" message right
    // as it takes over - no need to also announce a bare NightFalls here.
    this.logger.info(
      {
        chatId: session.chatId.toString(),
        gameId,
        mode: session.game.mode,
        players: session.game.players.length,
      },
      'Game started, handing off to the night/day loop',
    );
    const grp = await this.groups.getOrCreate(session.chatId, null, null);
    void this.gameLoop.sendGifCategory?.(
      session.chatId,
      grp,
      session.game.mode === 'Chaos' ? 'StartChaosGame' : 'StartGame',
    );
    this.gameLoop.start(session.game, gameId);
  }

  private async notifyRole(
    player: { id: bigint; role: bigint; name: string },
    game: Game,
    language: string,
  ): Promise<boolean> {
    const telegramId = player.id;
    const role = player.role;
    const name = roleName(role);
    const localized = this.t.translate(language, `Role_${name}`);
    const displayName = localized.startsWith('Role_') ? name : localized;
    const emoji = ROLE_META[name].emoji;

    let description = '';
    try {
      const descLocalized = this.t.translate(language, aboutLocaleKey(name));
      if (descLocalized && descLocalized.length > 0) {
        description = `\n\n📖 <b>${language === 'fr' ? 'Description du rôle' : 'Role description'} :</b>\n${descLocalized}`;
      }
    } catch {
      // Ignore missing role description key
    }

    let teamInfo = '';
    if (role === ROLE_BIT.Mason) {
      const coMasons = game.players.filter((p) => p.id !== player.id && p.role === ROLE_BIT.Mason);
      if (coMasons.length > 0) {
        const names = coMasons.map((p) => mentionOrPlain(p.id, p.name, p.isBot)).join(', ');
        teamInfo =
          language === 'fr'
            ? `\n\n👷 <b>Vos confrères Maçons sont :</b> ${names}`
            : `\n\n👷 <b>Your fellow Masons are:</b> ${names}`;
      } else {
        teamInfo =
          language === 'fr'
            ? `\n\n👷 <b>Vous êtes le seul Maçon de cette partie.</b>`
            : `\n\n👷 <b>You are the only Mason in this game.</b>`;
      }
    } else if (WOLF_ROLES.includes(role) || role === ROLE_BIT.SnowWolf) {
      const pack = game.players.filter(
        (p) => p.id !== player.id && (WOLF_ROLES.includes(p.role) || p.role === ROLE_BIT.SnowWolf),
      );
      if (pack.length > 0) {
        const names = pack
          .map(
            (p) =>
              `${mentionOrPlain(p.id, p.name, p.isBot)} (${ROLE_META[roleName(p.role)].emoji} ${this.t.translate(language, `Role_${roleName(p.role)}`)})`,
          )
          .join('\n• ');
        teamInfo =
          language === 'fr'
            ? `\n\n🐺 <b>Vos camarades Loups-Garous sont :</b>\n• ${names}`
            : `\n\n🐺 <b>Your fellow Werewolves are:</b>\n• ${names}`;
      } else {
        teamInfo =
          language === 'fr'
            ? `\n\n🐺 <b>Vous êtes le seul Loup-Garou au départ.</b>`
            : `\n\n🐺 <b>You are the only Werewolf at the start.</b>`;
      }
    } else if (role === ROLE_BIT.Cultist) {
      const cult = game.players.filter((p) => p.id !== player.id && p.role === ROLE_BIT.Cultist);
      if (cult.length > 0) {
        const names = cult.map((p) => mentionOrPlain(p.id, p.name, p.isBot)).join(', ');
        teamInfo =
          language === 'fr'
            ? `\n\n🔮 <b>Vos Frères du Culte sont :</b> ${names}`
            : `\n\n🔮 <b>Your fellow Cultists are:</b> ${names}`;
      }
    } else if (role === ROLE_BIT.Hitman && game.hitmanTargetMap.has(player.id)) {
      const targetId = game.hitmanTargetMap.get(player.id)!;
      const targetPlayer = game.players.find((p) => p.id === targetId);
      const targetName = targetPlayer
        ? mentionOrPlain(targetPlayer.id, targetPlayer.name, targetPlayer.isBot)
        : '???';
      teamInfo =
        language === 'fr'
          ? `\n\n🎯 <b>Votre cible d'assassinat est :</b> ${targetName}`
          : `\n\n🎯 <b>Your assassination target is:</b> ${targetName}`;
    } else if (role === ROLE_BIT.Avenger && game.avengerTargetMap.has(player.id)) {
      const targetId = game.avengerTargetMap.get(player.id)!;
      const targetPlayer = game.players.find((p) => p.id === targetId);
      const targetName = targetPlayer
        ? mentionOrPlain(targetPlayer.id, targetPlayer.name, targetPlayer.isBot)
        : '???';
      teamInfo =
        language === 'fr'
          ? `\n\n💀 <b>Votre rival juré est :</b> ${targetName}`
          : `\n\n💀 <b>Your sworn rival is:</b> ${targetName}`;
    }

    const roleMsg = `${this.t.translate(language, 'YourRoleIs', `${emoji} ${displayName}`)}${description}${teamInfo}`;

    try {
      await this.bot.api.sendMessage(chatNumber(telegramId), roleMsg, { parse_mode: 'HTML' });
      return true;
    } catch (err) {
      this.logger.warn(
        { telegramId: telegramId.toString(), err: (err as Error).message },
        'Could not PM role to player',
      );
      return false;
    }
  }

  async addBotPlayers(chatId: bigint, count = 4): Promise<number> {
    const session = this.sessions.get(chatId);
    if (!session) return 0;

    const botNames = [
      '🤖 Alex (IA)',
      '🤖 Beatrice (IA)',
      '🤖 Clement (IA)',
      '🤖 Diana (IA)',
      '🤖 Enzo (IA)',
      '🤖 Florence (IA)',
      '🤖 Gabriel (IA)',
      '🤖 Helene (IA)',
      '🤖 Ismael (IA)',
      '🤖 Julia (IA)',
    ];

    let addedCount = 0;
    const existingCount = session.game.players.length;
    const startId = 990001n + BigInt(existingCount);

    for (let i = 0; i < count; i++) {
      if (session.game.players.length >= 35) break;
      const botId = startId + BigInt(i);
      const name = botNames[i % botNames.length]!;
      try {
        session.game.addPlayer(botId, name, true);
        addedCount++;
      } catch {
        break;
      }
    }
    if (addedCount > 0) {
      botPlayersAdded.labels(session.game.mode).inc(addedCount);
      playersJoined.inc(addedCount);
      this.logger.info(
        { chatId: chatId.toString(), addedCount, totalInLobby: session.game.players.length },
        'Bot players added to lobby',
      );
    }
    return addedCount;
  }

  private async send(
    chatId: bigint,
    language: string,
    key: string,
    ...args: unknown[]
  ): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatNumber(chatId), this.t.translate(language, key, ...args), {
        parse_mode: 'HTML',
      });
    } catch (err) {
      this.logger.error(
        { chatId: chatId.toString(), err: (err as Error).message },
        'Failed to send group message',
      );
    }
  }

  private async sendToUser(
    telegramId: bigint,
    language: string,
    key: string,
    ...args: unknown[]
  ): Promise<boolean> {
    try {
      await this.bot.api.sendMessage(
        chatNumber(telegramId),
        this.t.translate(language, key, ...args),
        { parse_mode: 'HTML' },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        { telegramId: telegramId.toString(), err: (err as Error).message },
        'Could not PM user',
      );
      return false;
    }
  }
}

function formatGroupTitle(
  title: string | null | undefined,
  language: string,
  mode?: string,
): string {
  const modeLabel =
    mode === 'Chaos'
      ? 'CHAOS'
      : mode === 'Bloodbath'
        ? 'Bain de Sang'
        : language === 'fr'
          ? 'Loup-Garou'
          : 'Werewolf';
  const trimmed = title?.trim();
  if (trimmed) return `${modeLabel} (${trimmed})`;
  return modeLabel;
}

function chatNumber(id: bigint): number {
  return Number(id);
}
