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
});
