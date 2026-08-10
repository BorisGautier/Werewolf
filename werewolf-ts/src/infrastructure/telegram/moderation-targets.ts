import type { Context } from 'grammy';
import type { PlayerRepository } from '../persistence/player.repository.js';

export interface ModTarget {
  id: bigint;
  name: string;
}

/**
 * Resolves `@username` and text-mention entities on a command message to concrete Telegram ids -
 * mirrors the original's `case MessageEntityType.Mention` / `TextMention` handling repeated
 * across `/smite`, `/permban`, `/remban`. A text-mention already carries the full user object; a
 * plain `@mention` only gives a username, so it needs a DB lookup (and is silently dropped if
 * that player has never interacted with the bot, same as the original's `?? 0` / null checks).
 */
export async function resolveEntityTargets(ctx: Context, players: PlayerRepository): Promise<ModTarget[]> {
  const text = ctx.message?.text ?? '';
  const targets: ModTarget[] = [];
  for (const entity of ctx.message?.entities ?? []) {
    if (entity.type === 'text_mention' && entity.user) {
      targets.push({ id: BigInt(entity.user.id), name: entity.user.first_name });
    } else if (entity.type === 'mention') {
      const username = text.slice(entity.offset + 1, entity.offset + entity.length);
      const player = await players.findByUsername(username);
      if (player) targets.push({ id: player.telegramId, name: player.displayName ?? username });
    }
  }
  return targets;
}

/** The sender of the replied-to message, if this command was sent as a reply. */
export function replyTarget(ctx: Context): ModTarget | null {
  const from = ctx.message?.reply_to_message?.from;
  if (!from) return null;
  return { id: BigInt(from.id), name: from.first_name };
}

/** Whitespace-separated numeric tokens from the raw command argument text (raw ids, `/smite <id>`). */
export function numericIdTargets(argText: string | undefined): bigint[] {
  if (!argText) return [];
  return argText
    .split(/\s+/)
    .filter((token) => /^-?\d+$/.test(token))
    .map((token) => BigInt(token));
}

/** Everything in the argument text that ISN'T a bare number - used as the ban reason. */
export function nonNumericWords(argText: string | undefined): string {
  if (!argText) return '';
  return argText
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^-?\d+$/.test(token))
    .join(' ');
}
