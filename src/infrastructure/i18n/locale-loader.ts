import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocaleFile } from './locale-file.types.js';

const DEFAULT_LOCALES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../locales',
);

export async function loadLocales(
  dir: string = DEFAULT_LOCALES_DIR,
): Promise<Map<string, LocaleFile>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const locales = new Map<string, LocaleFile>();

  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf-8');
    const parsed = JSON.parse(raw) as LocaleFile;
    locales.set(parsed.code, parsed);
  }

  if (![...locales.values()].some((l) => l.isDefault)) {
    throw new Error(
      'No locale is marked as isDefault: true - one master fallback language is required.',
    );
  }

  for (const locale of locales.values()) {
    if (locale.base && !locales.has(locale.base)) {
      throw new Error(
        `Locale "${locale.code}" declares base "${locale.base}", which isn't among the loaded locales.`,
      );
    }
  }

  return locales;
}

export function getDefaultLocale(locales: Map<string, LocaleFile>): LocaleFile {
  const found = [...locales.values()].find((l) => l.isDefault);
  if (!found) throw new Error('No default locale loaded.');
  return found;
}
