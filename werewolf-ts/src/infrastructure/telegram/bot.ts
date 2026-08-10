import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy';
import { GameManager } from '../../application/game-manager.js';
import type { Env } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { Translator } from '../i18n/translator.js';
import { GameRepository } from '../persistence/game.repository.js';
import { GroupRepository } from '../persistence/group.repository.js';
import { PlayerRepository } from '../persistence/player.repository.js';
import { GameLobbyManager } from './game-lobby.js';
import { GameLoop } from './game-loop.js';
import { ConfigMenu } from './config-menu.js';

export interface BotDependencies {
  translator: Translator;
  gameManager: GameManager;
  groupRepository: GroupRepository;
  playerRepository: PlayerRepository;
  gameRepository: GameRepository;
}

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
  );
  const configMenu = new ConfigMenu(deps.groupRepository, deps.translator);

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

  return bot;
}
