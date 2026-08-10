import { Bot, GrammyError, HttpError } from 'grammy';
import type { Env } from '../config/env.js';
import type { Logger } from '../logging/logger.js';

/**
 * Composition root for the Telegram bot itself.
 *
 * This intentionally only wires up bootstrap-level commands (`/ping`,
 * `/version`) for now - the full command surface (startgame, join, config,
 * admin/dev commands...) from `Werewolf Control/Commands/*.cs` is ported
 * incrementally on top of this, one Composer module per command family, the
 * same way the original split GameCommands/AdminCommands/DevCommands/etc.
 */
export function createBot(env: Env, logger: Logger): Bot {
  const bot = new Bot(env.botToken);

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

  return bot;
}
