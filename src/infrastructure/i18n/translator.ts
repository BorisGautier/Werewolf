import type { LocaleFile } from './locale-file.types.js';
import { translationMisses } from '../monitoring/metrics.js';

export class MissingLocaleStringError extends Error {
  constructor(key: string) {
    super(
      `No locale string found for key "${key}" in the requested locale, its base, or the default locale.`,
    );
    this.name = 'MissingLocaleStringError';
  }
}

/**
 * Port of `Werewolf.cs`'s `GetLocaleString`: resolves a key through
 * requested-locale -> locale.base -> default-locale, picks one of the
 * possible phrasings at random, then substitutes `{0}`, `{1}`, ... positional
 * placeholders (mirrors .NET's `String.Format`).
 */
export class Translator {
  constructor(
    private readonly locales: Map<string, LocaleFile>,
    private readonly defaultLocale: LocaleFile,
  ) {}

  translate(localeCode: string, key: string, ...args: unknown[]): string {
    const values = this.resolveValues(localeCode, key);
    const choice = values[Math.floor(Math.random() * values.length)]!;
    return formatPlaceholders(choice, args);
  }

  /** Every loaded locale that is itself a real language, not a themed pack of one (`isPack` not
   * set - see `LocaleFile`'s doc comment) - e.g. `en`, `fr`. Powers the language-selection
   * screen's first step. */
  listBaseLocales(): { code: string; name: string }[] {
    return [...this.locales.values()]
      .filter((l) => !l.isPack)
      .map((l) => ({ code: l.code, name: l.name }));
  }

  /** Every loaded pack registered against `baseCode` (`isPack` set and `base === baseCode`) -
   * empty until someone actually ships a `locales/<baseCode>-<pack>.json`. Powers the
   * pack-selection step. */
  listPacksForBase(baseCode: string): { code: string; name: string }[] {
    return [...this.locales.values()]
      .filter((l) => l.isPack && l.base === baseCode)
      .map((l) => ({ code: l.code, name: l.name }));
  }

  /** `localeCode`'s base language - itself if it isn't a pack, or is unknown. Lets a screen
   * recover "which base is this pack a variant of" from a stored code. */
  baseOf(localeCode: string): string {
    const locale = this.locales.get(localeCode);
    return locale?.isPack && locale.base ? locale.base : localeCode;
  }

  private resolveValues(localeCode: string, key: string): string[] {
    const locale = this.locales.get(localeCode);

    const direct = locale?.strings[key];
    if (direct && direct.length > 0) return direct;

    if (locale?.base) {
      const base = this.locales.get(locale.base);
      const fromBase = base?.strings[key];
      if (fromBase && fromBase.length > 0) return fromBase;
    }

    const fromDefault = this.defaultLocale.strings[key];
    if (fromDefault && fromDefault.length > 0) return fromDefault;

    try {
      translationMisses.labels(key).inc();
    } catch {
      // ignore
    }

    throw new MissingLocaleStringError(key);
  }
}

function formatPlaceholders(template: string, args: unknown[]): string {
  return template
    .replace(/\{(\d+)\}/g, (match, index: string) => {
      const value = args[Number(index)];
      return value === undefined ? match : String(value);
    })
    .replaceAll('\\n', '\n');
}
