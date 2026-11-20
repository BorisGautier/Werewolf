/**
 * Secret redaction for everything the bot writes out (logs, console, admin alerts).
 *
 * Why: grammY / node-fetch errors embed the full Telegram API URL
 * (`https://api.telegram.org/bot<id>:<token>/getUpdates`), so a simple network
 * failure used to leak the bot token into Docker logs, Graylog, Slack and e-mail.
 */

import { format } from 'node:util';

const TELEGRAM_TOKEN = /\b(bot)?(\d{6,}):[A-Za-z0-9_-]{30,}\b/g;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi;

export const REDACTED_TOKEN = '<token-masque>';

/** Masks Telegram bot tokens and credentials embedded in URLs. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(
      TELEGRAM_TOKEN,
      (_m, bot: string | undefined, id: string) => `${bot ?? ''}${id}:${REDACTED_TOKEN}`,
    )
    .replace(URL_CREDENTIALS, '$1:***@');
}

/** Recursively redacts strings inside plain objects / arrays / errors (copy, never mutates). */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (value instanceof Error) {
    const copy = new Error(redactSecrets(value.message));
    copy.name = value.name;
    if (value.stack) copy.stack = redactSecrets(value.stack);
    return copy;
  }
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, depth + 1);
  return out;
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consolePatched = false;

/**
 * Wraps console.* so third-party libraries writing directly to the console
 * (e.g. `[grammY runner] Error while fetching updates`) cannot leak secrets.
 */
export function installConsoleRedaction(target: Console = console): void {
  if (target === console && consolePatched) return;
  for (const method of CONSOLE_METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]): void => {
      original(redactSecrets(format(...args)));
    };
  }
  if (target === console) consolePatched = true;
}
