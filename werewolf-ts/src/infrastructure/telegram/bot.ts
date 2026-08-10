import { Bot, GrammyError, HttpError } from 'grammy';
import { GameManager } from '../../application/game-manager.js';
import type { Env } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { Translator } from '../i18n/translator.js';
import { GameRepository } from '../persistence/game.repository.js';
import { GroupRepository } from '../persistence/group.repository.js';
import { PlayerRepository } from '../persistence/player.repository.js';
import { GameLobbyManager } from './game-lobby.js';

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
 * Wires up the join-lobby command family (`/startgame`, `/startchaos`,
 * `/join`, `/forcestart`, `/players`, `/flee` - see `game-lobby.ts` for the
 * actual port of `Werewolf Node/Werewolf.cs`'s join logic) on top of the
 * bootstrap commands (`/ping`, `/version`). The night/day/lynch loop that
 * follows role assignment is task #25 and isn't wired up yet.
 */
export function createBot(env: Env, logger: Logger, deps: BotDependencies): Bot {
  const bot = new Bot(env.botToken);
  const lobby = new GameLobbyManager(
    bot,
    deps.gameManager,
    deps.groupRepository,
    deps.playerRepository,
    deps.gameRepository,
    deps.translator,
    logger,
  );

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
