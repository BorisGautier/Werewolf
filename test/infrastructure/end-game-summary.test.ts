import { beforeEach, describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { buildEndGameSummary } from '../../src/infrastructure/telegram/end-game-summary.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';

/** Matches `mentionHtml()`'s output - every non-bot player name is now a real Telegram
 * text-mention, not plain text (see `src/infrastructure/telegram/mention.ts`). */
function mention(id: bigint, name: string): string {
  return `<a href="tg://user?id=${id}">${name}</a>`;
}

let translator: Translator;

beforeEach(async () => {
  const locales = await loadLocales();
  translator = new Translator(locales, getDefaultLocale(locales));
});

describe('buildEndGameSummary', () => {
  it('NONE mode lists just the alive count and every player name, oldest death first', () => {
    const a = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'Bob', ROLE_BIT.Wolf, 'Wolf');
    b.isDead = true;
    b.timeDied = new Date(2024, 0, 1);

    const text = buildEndGameSummary([a, b], 'NONE', 'en', translator, null);

    expect(text).toBe(`Players Alive: 1 / 2\n${mention(2n, 'Bob')}\n${mention(1n, 'Alice')}`);
  });

  it('ALL mode lists every player with status, role, and outcome', () => {
    const alive = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    alive.won = true;
    const dead = createPlayer(2n, 'Bob', ROLE_BIT.Wolf, 'Wolf');
    dead.isDead = true;
    dead.timeDied = new Date(2024, 0, 1);
    dead.won = false;
    const fled = createPlayer(3n, 'Carol', ROLE_BIT.Seer, 'Village');
    fled.isDead = true;
    fled.fled = true;
    fled.timeDied = new Date(2024, 0, 2);

    const text = buildEndGameSummary([alive, dead, fled], 'ALL', 'en', translator, null);

    expect(text).toContain('Players Alive: 1 / 3');
    expect(text).toContain(`${mention(2n, 'Bob')}: 💀 Dead - 🐺 Wolf Lost`);
    expect(text).toContain(`${mention(3n, 'Carol')}: Ran away - 👳 Seer Lost`);
    expect(text).toContain(`${mention(1n, 'Alice')}: 🙂 Alive - 👱 Villager Won`);
  });

  it('LIVING mode lists only survivors, grouped with their team label', () => {
    const alive = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    alive.won = true;
    const dead = createPlayer(2n, 'Bob', ROLE_BIT.Wolf, 'Wolf');
    dead.isDead = true;

    const text = buildEndGameSummary([alive, dead], 'LIVING', 'en', translator, null);

    expect(text).toContain('Remaining living players, roles, and team:');
    expect(text).toContain(`${mention(1n, 'Alice')}: 👱 Villager Village Team  Won`);
    expect(text).not.toContain('Bob');
  });

  it('marks a lover with a heart', () => {
    const alice = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    alice.inLove = true;

    const text = buildEndGameSummary([alice], 'LIVING', 'en', translator, null);

    expect(text).toContain('❤️');
  });

  it('appends the game duration when given, formatted as hh:mm:ss', () => {
    const alice = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    const durationMs = (2 * 3600 + 5 * 60 + 9) * 1000;

    const text = buildEndGameSummary([alice], 'NONE', 'en', translator, durationMs);

    expect(text.endsWith('Game Length: 02:05:09')).toBe(true);
  });

  it('omits the duration line entirely when null', () => {
    const alice = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    const text = buildEndGameSummary([alice], 'NONE', 'en', translator, null);
    expect(text).not.toContain('Game Length');
  });

  it("appends a donor badge to a player's name when one is provided", () => {
    const alice = createPlayer(1n, 'Alice', ROLE_BIT.Villager, 'Village');
    const bob = createPlayer(2n, 'Bob', ROLE_BIT.Villager, 'Village');
    const badges = new Map([[1n, ' 🥇']]);

    const text = buildEndGameSummary([alice, bob], 'NONE', 'en', translator, null, badges);

    expect(text).toContain(`${mention(1n, 'Alice')} 🥇`);
    expect(text).not.toContain('Bob 🥇');
    expect(text).toContain(mention(2n, 'Bob'));
  });
});
