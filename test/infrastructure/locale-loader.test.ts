import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('loadLocales (language packs, temp directory)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('loads a pack alongside its base language, keyed by its own code', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'werewolf-locales-'));
    await writeFile(
      path.join(dir, 'en.json'),
      JSON.stringify({ code: 'en', name: 'English', isDefault: true, strings: {} }),
    );
    await writeFile(
      path.join(dir, 'en-spooky.json'),
      JSON.stringify({
        code: 'en-spooky',
        name: 'English (Spooky)',
        base: 'en',
        isPack: true,
        strings: {},
      }),
    );

    const locales = await loadLocales(dir);
    expect(locales.has('en')).toBe(true);
    expect(locales.has('en-spooky')).toBe(true);
    expect(locales.get('en-spooky')!.base).toBe('en');
  });

  it("rejects a pack whose base isn't among the loaded locales", async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'werewolf-locales-'));
    await writeFile(
      path.join(dir, 'en.json'),
      JSON.stringify({ code: 'en', name: 'English', isDefault: true, strings: {} }),
    );
    await writeFile(
      path.join(dir, 'orphan.json'),
      JSON.stringify({ code: 'orphan', name: 'Orphan Pack', base: 'nonexistent', strings: {} }),
    );

    await expect(loadLocales(dir)).rejects.toThrow(/declares base "nonexistent"/);
  });
});
