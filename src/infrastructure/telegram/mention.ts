/**
 * Shared helpers for turning a player's name into a real, notifying Telegram mention (an HTML
 * `text_mention` entity via `tg://user?id=...`) instead of plain text, so every message the bot
 * sends actually pings/links the player it's talking about - mirrors what `/claim` and the lobby's
 * "who joined" announcement already did, generalized for reuse everywhere else.
 */

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** A `tg://user?id=` text-mention always works (no public @username required) as long as the
 * numeric id is a real Telegram user id the bot has seen before - which every non-bot `Player.id`
 * is, since it's captured straight off `ctx.from.id`. */
export function mentionHtml(id: bigint | number, name: string): string {
  return `<a href="tg://user?id=${id}">${escapeHtml(name)}</a>`;
}

/** Same as `mentionHtml`, but falls back to plain (escaped) text for synthetic AI/bot players,
 * whose `id` isn't a real Telegram account and so can't be linked/tagged. */
export function mentionOrPlain(id: bigint | number, name: string, isBot?: boolean): string {
  return isBot ? escapeHtml(name) : mentionHtml(id, name);
}
