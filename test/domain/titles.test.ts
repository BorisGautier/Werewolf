import { describe, expect, it } from 'vitest';
import { TITLE_CATALOG, getTitleById } from '../../src/domain/titles/title.js';

describe('Titles Domain Catalog', () => {
  it('contains 10 epic titles', () => {
    expect(TITLE_CATALOG).toHaveLength(10);
  });

  it('retrieves title by valid ID', () => {
    const title = getTitleById('untouchable');
    expect(title).toBeDefined();
    expect(title?.emoji).toBe('👑');
    expect(title?.defaultTitle).toBe("L'Intouchable");
  });

  it('returns undefined for non-existent title ID', () => {
    const title = getTitleById('unknown_id');
    expect(title).toBeUndefined();
  });
});
