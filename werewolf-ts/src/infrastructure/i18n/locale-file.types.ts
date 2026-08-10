/**
 * JSON replacement for the original per-theme XML files under `Languages/`.
 *
 * Each string key can have several possible phrasings - one is picked at
 * random every time it's used, exactly like the original `GetLocaleString`.
 * `base` lets a themed pack (e.g. a future "fr-halloween") fall back to its
 * parent language for any key it doesn't override itself.
 */
export interface LocaleFile {
  code: string;
  name: string;
  isDefault?: boolean;
  base?: string;
  strings: Record<string, string[]>;
}
