import type { LocaleFile } from './locale-file.types.js';

export class MissingLocaleStringError extends Error {
  constructor(key: string) {
    super(`No locale string found for key "${key}" in the requested locale, its base, or the default locale.`);
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
