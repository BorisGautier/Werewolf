import { describe, expect, it } from 'vitest';
import { ROLE_NAMES } from '../../src/domain/roles/role.js';
import { ABOUT_ROLE_BY_TRIGGER, aboutLocaleKey } from '../../src/infrastructure/telegram/role-info.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';

describe('ABOUT_ROLE_BY_TRIGGER', () => {
  it('maps every trigger to a real role name', () => {
    for (const role of Object.values(ABOUT_ROLE_BY_TRIGGER)) {
      expect(ROLE_NAMES).toContain(role);
    }
  });

  it('covers every role except Spumpkin (which the original never shipped an /about for)', () => {
    const covered = new Set(Object.values(ABOUT_ROLE_BY_TRIGGER));
    const uncovered = ROLE_NAMES.filter((r) => !covered.has(r));
    expect(uncovered).toEqual(['Spumpkin']);
  });

  it('has a non-empty English locale string for every mapped role', async () => {
    const locales = await loadLocales();
    const translator = new Translator(locales, getDefaultLocale(locales));

    for (const role of Object.values(ABOUT_ROLE_BY_TRIGGER)) {
      const text = translator.translate('en', aboutLocaleKey(role));
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
