import { describe, expect, it } from 'vitest';
import { Translator, MissingLocaleStringError } from '../../src/infrastructure/i18n/translator.js';
import type { LocaleFile } from '../../src/infrastructure/i18n/locale-file.types.js';

const en: LocaleFile = {
  code: 'en',
  name: 'English',
  isDefault: true,
  strings: {
    Greeting: ['Hello {0}!'],
    OnlyInEnglish: ['fallback works'],
  },
};

const fr: LocaleFile = {
  code: 'fr',
  name: 'Français',
  base: 'en',
  strings: {
    Greeting: ['Salut {0} !'],
  },
};

const locales = new Map<string, LocaleFile>([
  ['en', en],
  ['fr', fr],
]);

describe('Translator', () => {
  it('substitutes positional placeholders', () => {
    const t = new Translator(locales, en);
    expect(t.translate('en', 'Greeting', 'Alice')).toBe('Hello Alice!');
    expect(t.translate('fr', 'Greeting', 'Alice')).toBe('Salut Alice !');
  });

  it('falls back to the default locale when a key is missing from the requested one and its base', () => {
    const t = new Translator(locales, en);
    expect(t.translate('fr', 'OnlyInEnglish')).toBe('fallback works');
  });

  it('throws a descriptive error when a key exists nowhere', () => {
    const t = new Translator(locales, en);
    expect(() => t.translate('fr', 'DoesNotExist')).toThrow(MissingLocaleStringError);
  });

  // `fr` above sets `base: 'en'` purely as a missing-translation safety net (same as the real
  // fr.json) - it's still a real base language, not a pack, since it has no `isPack` flag.
  it('lists locales with no isPack flag as base locales, base fallback notwithstanding', () => {
    const t = new Translator(locales, en);
    expect(t.listBaseLocales().map((l) => l.code).sort()).toEqual(['en', 'fr']);
  });

  it('lists a pack registered against a base, and resolves its base back via baseOf', () => {
    const packed = new Map(locales);
    packed.set('fr-spooky', { code: 'fr-spooky', name: 'Français (Spooky)', base: 'fr', isPack: true, strings: {} });
    const t = new Translator(packed, en);

    expect(t.listBaseLocales().map((l) => l.code).sort()).toEqual(['en', 'fr']);
    expect(t.listPacksForBase('fr')).toEqual([{ code: 'fr-spooky', name: 'Français (Spooky)' }]);
    expect(t.listPacksForBase('en')).toEqual([]);
    expect(t.baseOf('fr-spooky')).toBe('fr');
    expect(t.baseOf('fr')).toBe('fr');
    expect(t.baseOf('unknown-code')).toBe('unknown-code');
  });
});
