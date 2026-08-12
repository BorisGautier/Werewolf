/**
 * JSON replacement for the original per-theme XML files under `Languages/`.
 *
 * Each string key can have several possible phrasings - one is picked at
 * random every time it's used, exactly like the original `GetLocaleString`.
 *
 * `base` names a fallback locale for any key this one doesn't define itself -
 * every non-default language sets it to the default locale's code as a
 * missing-translation safety net (see `fr.json`), so its presence alone
 * doesn't mean "this is a themed pack." `isPack` is what actually marks a
 * themed pack (e.g. a future "fr-halloween") of the language named by `base` -
 * see `Translator.listBaseLocales`/`listPacksForBase`, which is how the
 * `/config` language screen tells real languages apart from packs of one.
 */
export interface LocaleFile {
  code: string;
  name: string;
  isDefault?: boolean;
  base?: string;
  isPack?: boolean;
  strings: Record<string, string[]>;
}
