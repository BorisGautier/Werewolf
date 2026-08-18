import { describe, expect, it } from 'vitest';
import {
  GIF_CATEGORIES,
  type GifCategory,
} from '../../src/infrastructure/persistence/gif-pack.repository.js';
import { KILL_METHOD_GIF_CATEGORY, WIN_TEAM_GIF_CATEGORY } from '../../src/infrastructure/telegram/game-loop.js';
import { LocalGifPack } from '../../src/infrastructure/telegram/local-gif-pack.js';
import type { KillMethod } from '../../src/domain/game/kill-method.js';
import type { Team } from '../../src/domain/game/team.js';

/** Every `KillMethod` that intentionally has no dedicated clip - these fall back to the generic
 * `VillagerDie` in `sendGifForEvent()`. Keeping this list explicit (instead of just asserting
 * "every method not in the map") means a newly-added `KillMethod` that *should* get its own gif
 * fails this test until someone consciously adds it here or to the real map. */
const KILL_METHODS_WITHOUT_DEDICATED_GIF: readonly KillMethod[] = [
  'None',
  'Lynch',
  'VisitWolf',
  'VisitVictim',
  'GuardWolf',
  'Detected',
  'Flee',
  // A grieving lover's death fires as PlayerDied('LoverDied') right alongside its own
  // LoverDiedOfGrief event - GameLoop suppresses the PlayerDied-triggered gif entirely there so
  // the LoverDiedOfGrief -> 'LoverDied' clip isn't doubled up with a redundant generic one.
  'LoverDied',
  'GuardKiller',
  'VisitKiller',
  'Idle',
  'Suicide',
  'StealKiller',
  'Spotted',
  'VisitBurning',
];

const ALL_KILL_METHODS: readonly KillMethod[] = [
  ...KILL_METHODS_WITHOUT_DEDICATED_GIF,
  ...(Object.keys(KILL_METHOD_GIF_CATEGORY) as KillMethod[]),
];

describe('GIF category catalog', () => {
  it('contains exactly the full catalog of GIF categories, with no duplicates', () => {
    expect(GIF_CATEGORIES.length).toBeGreaterThanOrEqual(67);
    const categorySet = new Set(GIF_CATEGORIES);
    expect(categorySet.size).toBe(GIF_CATEGORIES.length);
  });

  it('has a bundled local asset file for every declared category', () => {
    const localPack = new LocalGifPack();
    const missing = GIF_CATEGORIES.filter((category) => localPack.resolve(category) === null);
    expect(missing).toEqual([]);
  });
});

describe('KILL_METHOD_GIF_CATEGORY - death animations actually used by GameLoop', () => {
  it('maps every KillMethod exactly once, either to a dedicated category or the documented fallback list', () => {
    // Guards against a new KillMethod being added to kill-method.ts without anyone deciding
    // whether it deserves its own gif - this test file needs updating either way, on purpose.
    expect(new Set(ALL_KILL_METHODS).size).toBe(ALL_KILL_METHODS.length);
  });

  it('maps the death methods with bundled dedicated clips to their real category', () => {
    expect(KILL_METHOD_GIF_CATEGORY.Burn).toBe('BurnToDeath');
    expect(KILL_METHOD_GIF_CATEGORY.SerialKilled).toBe('SKKilled');
    expect(KILL_METHOD_GIF_CATEGORY.Eat).toBe('WolfAttack');
    expect(KILL_METHOD_GIF_CATEGORY.HunterShot).toBe('HunterShot');
    expect(KILL_METHOD_GIF_CATEGORY.Chemistry).toBe('WitchPotionKill');
    expect(KILL_METHOD_GIF_CATEGORY.FallGrave).toBe('GraveDiggerFall');
    expect(KILL_METHOD_GIF_CATEGORY.HunterCult).toBe('CultHunterKill');
    expect(KILL_METHOD_GIF_CATEGORY.Hunt).toBe('CultHunterKill');
  });

  it('only ever maps to a category that actually exists in the catalog', () => {
    for (const category of Object.values(KILL_METHOD_GIF_CATEGORY)) {
      expect(GIF_CATEGORIES).toContain(category as GifCategory);
    }
  });
});

describe('WIN_TEAM_GIF_CATEGORY - victory animations actually used by GameLoop', () => {
  const expected: Partial<Record<Team, GifCategory>> = {
    Village: 'VillagersWin',
    Wolf: 'WolvesWin',
    Tanner: 'TannerWin',
    Cult: 'CultWins',
    SerialKiller: 'SerialKillerWins',
    Arsonist: 'ArsonistWins',
    Lovers: 'LoversWin',
    NoOne: 'NoWinner',
  };

  it('matches the documented team -> category mapping exactly', () => {
    expect(WIN_TEAM_GIF_CATEGORY).toEqual(expected);
  });

  it('only ever maps to a category that actually exists in the catalog', () => {
    for (const category of Object.values(WIN_TEAM_GIF_CATEGORY)) {
      expect(GIF_CATEGORIES).toContain(category as GifCategory);
    }
  });
});
