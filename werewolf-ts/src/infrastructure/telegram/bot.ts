import { Bot, GrammyError, HttpError, InlineKeyboard, type Context } from 'grammy';
import { GameManager } from '../../application/game-manager.js';
import type { Env } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { Translator } from '../i18n/translator.js';
import { AdminRepository } from '../persistence/admin.repository.js';
import { GameRepository } from '../persistence/game.repository.js';
import { GroupRepository } from '../persistence/group.repository.js';
import { NotifyGameRepository } from '../persistence/notify-game.repository.js';
import { PlayerRepository } from '../persistence/player.repository.js';
import { GameLobbyManager } from './game-lobby.js';
import { GameLoop } from './game-loop.js';
import { ConfigMenu } from './config-menu.js';
import { nonNumericWords, numericIdTargets, replyTarget, resolveEntityTargets } from './moderation-targets.js';
import { ABOUT_ROLE_BY_TRIGGER, aboutLocaleKey } from './role-info.js';
import { ROLE_META } from '../../domain/roles/role.js';

export interface BotDependencies {
  translator: Translator;
  gameManager: GameManager;
  groupRepository: GroupRepository;
  playerRepository: PlayerRepository;
  gameRepository: GameRepository;
  adminRepository: AdminRepository;
  notifyGameRepository: NotifyGameRepository;
}

const INVITE_LINK_PATTERN = /^(https?:\/\/)?t(elegram)?\.me\/(\+|joinchat\/)([a-zA-Z0-9_-]+)$/;

/**
 * Composition root for the Telegram bot itself.
 *
 * Wires up: the bootstrap commands (`/ping`, `/version`); the general
 * commands (`/start`, `/help`, `/setlang`, `/stats` - simplified from
 * `GeneralCommands.cs`, whose website-backed stats/donation/multi-language
 * XML-pack machinery doesn't apply to this single-process, two-locale
 * fork); the join-lobby command family (`/startgame`, `/startchaos`,
 * `/join`, `/forcestart`, `/players`, `/flee` - see `game-lobby.ts`); and
 * the night/day/lynch loop's callback buttons (see `game-loop.ts`).
 */
export function createBot(env: Env, logger: Logger, deps: BotDependencies): Bot {
  const bot = new Bot(env.botToken);
  const gameLoop = new GameLoop(bot, deps.gameManager, deps.groupRepository, deps.gameRepository, deps.translator, logger);
  const lobby = new GameLobbyManager(
    bot,
    deps.gameManager,
    deps.groupRepository,
    deps.playerRepository,
    deps.gameRepository,
    deps.translator,
    logger,
    gameLoop,
    deps.notifyGameRepository,
  );
  const configMenu = new ConfigMenu(deps.groupRepository, deps.translator);

  // Registered before the generic `callback_query:data` catch-all further down (which doesn't
  // call next()) so its own `stopwaiting:...` callback data actually gets a chance to match.
  registerWaitlistCommands(bot, deps);

  bot.catch((error) => {
    const { ctx } = error;
    const err = error.error;
    if (err instanceof GrammyError) {
      logger.error({ err, updateId: ctx.update.update_id }, 'Telegram API error while handling update');
    } else if (err instanceof HttpError) {
      logger.error({ err, updateId: ctx.update.update_id }, 'Network error while contacting Telegram');
    } else {
      logger.error({ err, updateId: ctx.update.update_id }, 'Unhandled error while handling update');
    }
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
  });

  bot.command('version', async (ctx) => {
    await ctx.reply('werewolf-ts v0.1.0 (migration in progress)');
  });

  bot.command('start', async (ctx) => {
    if (!ctx.from || !ctx.chat || ctx.chat.type !== 'private') return;
    const telegramId = BigInt(ctx.from.id);
    await deps.playerRepository.upsert(telegramId, {
      displayName: `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim(),
      username: ctx.from.username ?? null,
    });
    await deps.playerRepository.markHasStartedPm(telegramId);
    const player = await deps.playerRepository.findByTelegramId(telegramId);
    await ctx.reply(deps.translator.translate(player?.languageCode ?? 'en', 'WelcomeMessage'));
  });

  bot.command('help', async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    await ctx.reply(deps.translator.translate(player?.languageCode ?? 'en', 'HelpMessage'));
  });

  bot.command('setlang', async (ctx) => {
    if (!ctx.from) return;
    const keyboard = new InlineKeyboard().text('English', 'setlang:en').text('Français', 'setlang:fr');
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    try {
      await ctx.api.sendMessage(ctx.from.id, deps.translator.translate(language, 'SetLangPrompt'), {
        reply_markup: keyboard,
      });
      if (ctx.chat && ctx.chat.type !== 'private') {
        await ctx.reply(deps.translator.translate(language, 'SetLangSentPrivate'));
      }
    } catch (err) {
      if (!(err instanceof GrammyError)) throw err;
    }
  });

  bot.callbackQuery(/^setlang:(en|fr)$/, async (ctx) => {
    if (!ctx.from) return;
    const language = ctx.match[1]!;
    await deps.playerRepository.setLanguage(BigInt(ctx.from.id), language);
    await ctx.answerCallbackQuery({ text: deps.translator.translate(language, 'SetLangConfirmed', language) });
  });

  bot.command('stats', async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();

    const playerStats = await deps.gameRepository.getPlayerStats(BigInt(ctx.from.id));
    const lines = [
      deps.translator.translate(language, 'StatsHeader'),
      deps.translator.translate(language, 'StatsPlayerLine', name, playerStats.played, playerStats.won),
    ];

    if (ctx.chat && ctx.chat.type !== 'private') {
      const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
      const groupStats = await deps.gameRepository.getGroupStats(group.id);
      lines.push(deps.translator.translate(language, 'StatsGroupLine', groupStats.played));
    }

    await ctx.reply(lines.join('\n'));
  });

  bot.command(['startgame', 'startchaos'], async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const mode = ctx.message?.text?.startsWith('/startchaos') ? 'Chaos' : 'Normal';
    const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
    await lobby.startGame(BigInt(ctx.chat.id), ctx.chat.title ?? null, { id: BigInt(ctx.from.id), name }, mode);
  });

  bot.command('join', async (ctx) => {
    if (!ctx.from) return;
    if (!ctx.chat || ctx.chat.type === 'private') {
      const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
      await ctx.reply(deps.translator.translate(player?.languageCode ?? 'en', 'JoinFromGroup'));
      return;
    }
    await lobby.join(BigInt(ctx.chat.id), {
      id: BigInt(ctx.from.id),
      firstName: ctx.from.first_name,
      ...(ctx.from.last_name !== undefined ? { lastName: ctx.from.last_name } : {}),
      ...(ctx.from.username !== undefined ? { username: ctx.from.username } : {}),
    });
  });

  bot.callbackQuery(lobby.joinButtonCallbackData, async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    await ctx.answerCallbackQuery();
    await lobby.join(BigInt(ctx.chat.id), {
      id: BigInt(ctx.from.id),
      firstName: ctx.from.first_name,
      ...(ctx.from.last_name !== undefined ? { lastName: ctx.from.last_name } : {}),
      ...(ctx.from.username !== undefined ? { username: ctx.from.username } : {}),
    });
  });

  bot.command('config', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const member = await ctx.getAuthor();
    const isAdmin = member.status === 'creator' || member.status === 'administrator';
    if (!isAdmin) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    const screen = await configMenu.open(BigInt(ctx.chat.id));
    try {
      await ctx.api.sendMessage(ctx.from.id, screen.text, { reply_markup: screen.keyboard });
      await ctx.reply(deps.translator.translate(group.language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(group.language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });

  bot.callbackQuery(/^cfg:(-?\d+):(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const groupTelegramId = BigInt(ctx.match[1]!);
    const [action, ...rest] = ctx.match[2]!.split(':');

    const member = await ctx.api.getChatMember(Number(groupTelegramId), ctx.from.id).catch(() => null);
    const isAdmin = member?.status === 'creator' || member?.status === 'administrator';
    if (!isAdmin) {
      await ctx.answerCallbackQuery();
      return;
    }

    const screen = await configMenu.handleAction(groupTelegramId, action!, rest);
    if (screen) await ctx.editMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery();
  });

  // Every night/day/lynch menu button (see game-loop.ts) - registered after the join button so
  // that more specific handler only intercepts its own exact callback data, and this one gets
  // everything else.
  bot.on('callback_query:data', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const text = await gameLoop.handleCallback(BigInt(ctx.from.id), BigInt(ctx.chat.id), ctx.callbackQuery.data);
    await ctx.answerCallbackQuery(text ? { text } : undefined);
  });

  bot.command('forcestart', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const member = await ctx.getAuthor();
    const isAdmin = member.status === 'creator' || member.status === 'administrator';
    await lobby.forceStart(BigInt(ctx.chat.id), isAdmin);
  });

  bot.command('players', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    await lobby.showPlayers(BigInt(ctx.chat.id));
  });

  bot.command('flee', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
    await lobby.flee(BigInt(ctx.chat.id), { id: BigInt(ctx.from.id), name });
  });

  registerModerationCommands(bot, env, deps, lobby);
  registerRoleInfoCommands(bot, deps);

  return bot;
}

/**
 * Port of `GeneralCommands.cs`'s `/nextgame` and `GameCommands.cs`'s `/stopwaiting`: a player
 * asks to be PM'd once a new game starts in a group that currently has none running (`GameLoop`/
 * `GameLobbyManager` deliver the actual notification and cleanup - see `notifyWaitingPlayers`).
 */
function registerWaitlistCommands(bot: Bot, deps: BotDependencies): void {
  bot.command('nextgame', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    const keyboard = new InlineKeyboard().text(
      deps.translator.translate(group.language, 'Cancel'),
      `stopwaiting:${ctx.chat.id}`,
    );

    const added = await deps.notifyGameRepository.add(BigInt(ctx.from.id), BigInt(ctx.chat.id));
    const key = added ? 'AddedToWaitList' : 'AlreadyOnWaitList';
    try {
      await ctx.api.sendMessage(ctx.from.id, deps.translator.translate(group.language, key, group.title ?? ''), {
        reply_markup: keyboard,
      });
    } catch (err) {
      if (!(err instanceof GrammyError)) throw err;
    }
  });

  bot.command('stopwaiting', async (ctx) => {
    if (!ctx.from) return;
    const language = (await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id)))?.languageCode ?? 'en';

    let groupId: bigint | null = null;
    let groupTitle = '';
    if (ctx.chat && ctx.chat.type !== 'private') {
      groupId = BigInt(ctx.chat.id);
      groupTitle = ctx.chat.title ?? '';
    } else {
      const arg = (ctx.match as string | undefined)?.trim();
      const group = arg?.startsWith('@')
        ? await deps.groupRepository.findByUsername(arg.slice(1))
        : arg && /^-?\d+$/.test(arg)
          ? await deps.groupRepository.findByTelegramId(BigInt(arg))
          : null;
      if (group) {
        groupId = group.telegramId;
        groupTitle = group.title ?? '';
      }
    }

    if (groupId === null) {
      await ctx.reply(deps.translator.translate(language, 'GroupNotFound'));
      return;
    }

    await deps.notifyGameRepository.remove(BigInt(ctx.from.id), groupId);
    await ctx.api.sendMessage(ctx.from.id, deps.translator.translate(language, 'DeletedFromWaitList', groupTitle));
  });

  bot.callbackQuery(/^stopwaiting:(-?\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const groupId = BigInt(ctx.match[1]!);
    const group = await deps.groupRepository.findByTelegramId(groupId);
    const language = group?.language ?? 'en';

    await deps.notifyGameRepository.remove(BigInt(ctx.from.id), groupId);
    await ctx.answerCallbackQuery({ text: deps.translator.translate(language, 'DeletedFromWaitList', group?.title ?? '') });
  });
}

/** `/rolelist` (an index of every `/about<trigger>` command) and the `/about<trigger>` commands themselves. */
function registerRoleInfoCommands(bot: Bot, deps: BotDependencies): void {
  bot.command('rolelist', async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    const lines = Object.entries(ABOUT_ROLE_BY_TRIGGER).map(
      ([trigger, role]) => `/about${trigger} - ${ROLE_META[role].emoji} ${role}`,
    );
    try {
      await ctx.api.sendMessage(ctx.from.id, lines.join('\n'));
      if (ctx.chat && ctx.chat.type !== 'private') await ctx.reply(deps.translator.translate(language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });

  bot.command(Object.keys(ABOUT_ROLE_BY_TRIGGER), async (ctx) => {
    if (!ctx.from || !ctx.message?.text) return;
    const trigger = ctx.message.text.slice(1).split(/[ @]/)[0]!.toLowerCase();
    const role = ABOUT_ROLE_BY_TRIGGER[trigger];
    if (!role) return;

    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    try {
      await ctx.api.sendMessage(ctx.from.id, deps.translator.translate(language, aboutLocaleKey(role)));
      if (ctx.chat && ctx.chat.type !== 'private') await ctx.reply(deps.translator.translate(language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });
}

/**
 * Port of `AdminCommands.cs`/`DevCommands.cs`'s moderation surface: `/smite` (group-admin,
 * removes a disruptive player from the running game), `/permban`/`/remban`/`/getbans`/`/getban`
 * (global-admin, the cross-group `GlobalBan` blocklist), and `/setlink`/`/remlink` (group-admin,
 * the group's invite link shown by `/players` etc.). Deliberately not ported: the gif-pack
 * review/approval commands and the multi-node `/updatestatus` (both out of scope - see README).
 */
function registerModerationCommands(bot: Bot, env: Env, deps: BotDependencies, lobby: GameLobbyManager): void {
  async function isGroupAdmin(ctx: Context): Promise<boolean> {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    const member = await ctx.getAuthor();
    return member.status === 'creator' || member.status === 'administrator';
  }

  async function isGlobalAdmin(telegramId: bigint): Promise<boolean> {
    if (env.devUserIds.includes(telegramId)) return true;
    return deps.adminRepository.isGlobalAdmin(telegramId);
  }

  bot.command('smite', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    if (targets.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }
    for (const target of targets) {
      await lobby.smite(BigInt(ctx.chat.id), target);
    }
  });

  bot.command('setlink', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    if (ctx.chat.username) {
      await ctx.reply(deps.translator.translate(group.language, 'SetLinkAlreadySet', ctx.chat.username));
      return;
    }

    const link = (ctx.match as string | undefined)?.trim();
    if (!link) {
      await ctx.reply(deps.translator.translate(group.language, 'SetLinkMissingArg'));
      return;
    }
    if (!INVITE_LINK_PATTERN.test(link)) {
      await ctx.reply(deps.translator.translate(group.language, 'SetLinkInvalid'));
      return;
    }

    await deps.groupRepository.updateConfig(BigInt(ctx.chat.id), { inviteLink: link });
    await ctx.reply(deps.translator.translate(group.language, 'SetLinkConfirmed', link));
  });

  bot.command('remlink', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    await deps.groupRepository.updateConfig(BigInt(ctx.chat.id), { inviteLink: null });
    await ctx.reply(deps.translator.translate(group.language, 'RemLinkConfirmed'));
  });

  bot.command('getidles', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    const ids = new Set<bigint>(numericIdTargets(ctx.match as string | undefined));
    for (const entity of ctx.message?.entities ?? []) {
      if (entity.type === 'text_mention' && entity.user) ids.add(BigInt(entity.user.id));
    }
    const reply = replyTarget(ctx);
    if (reply) ids.add(reply.id);

    if (ids.size === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    const lines: string[] = [];
    for (const id of ids) {
      const [overall, inGroup] = await Promise.all([
        deps.gameRepository.getIdleKills24Hours(id),
        deps.gameRepository.getIdleKills24Hours(id, group.id),
      ]);
      lines.push(deps.translator.translate(group.language, 'IdleCount', id.toString(), overall));
      lines.push(deps.translator.translate(group.language, 'GroupIdleCount', inGroup));
    }
    await ctx.reply(lines.join('\n'));
  });

  bot.command('permban', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }
    const reason = nonNumericWords(ctx.match as string | undefined) || 'No reason given';

    if (targets.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    for (const target of targets) {
      await deps.adminRepository.ban(target.id, reason, BigInt(ctx.from.id));
      await lobby.smite(BigInt(ctx.chat.id), target);
      await ctx.reply(deps.translator.translate(group.language, 'BanConfirmed', target.name));
    }
  });

  bot.command('remban', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);

    if (targets.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    for (const target of targets) {
      const unbanned = await deps.adminRepository.unban(target.id);
      const key = unbanned ? 'UnbanConfirmed' : 'UnbanNotFound';
      await ctx.reply(deps.translator.translate(group.language, key, target.name));
    }
  });

  bot.command('getbans', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    const bans = await deps.adminRepository.listActiveBans();
    if (bans.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'GetBansEmpty'));
      return;
    }

    const lines = [deps.translator.translate(group.language, 'GetBansHeader')];
    for (const ban of bans) {
      lines.push(
        deps.translator.translate(group.language, 'GetBansLine', ban.playerName ?? ban.telegramId.toString(), ban.telegramId.toString(), ban.reason),
      );
    }
    await ctx.reply(lines.join('\n'));
  });

  bot.command('getban', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null);
    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);
    const target = targets[0];
    if (!target) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    const ban = await deps.adminRepository.getBan(target.id);
    if (!ban) {
      await ctx.reply(deps.translator.translate(group.language, 'GetBanNotBanned', target.name));
      return;
    }
    const expires = ban.expiresAt ? ban.expiresAt.toISOString() : deps.translator.translate(group.language, 'GetBanPermanent');
    await ctx.reply(
      deps.translator.translate(group.language, 'GetBanStatus', target.name, ban.reason, ban.bannedBy?.toString() ?? '?', expires),
    );
  });
}
