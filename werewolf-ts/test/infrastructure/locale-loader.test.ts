import { describe, expect, it } from 'vitest';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';

describe('loadLocales (real locales/ directory)', () => {
  it('loads en.json as the default locale and fr.json alongside it', async () => {
    const locales = await loadLocales();
    expect(locales.has('en')).toBe(true);
    expect(locales.has('fr')).toBe(true);

    const defaultLocale = getDefaultLocale(locales);
    expect(defaultLocale.code).toBe('en');
  });

  it('can translate a key in every shipped locale without throwing', async () => {
    const locales = await loadLocales();
    const defaultLocale = getDefaultLocale(locales);
    const t = new Translator(locales, defaultLocale);

    for (const code of locales.keys()) {
      expect(() => t.translate(code, 'PlayerStartedGame', 'Alice')).not.toThrow();
    }
  });
});
