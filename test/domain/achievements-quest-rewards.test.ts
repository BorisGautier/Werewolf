import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_CODES, ACHIEVEMENTS } from '../../src/domain/achievements/catalog.js';
import { getRankForPoints, PLAYER_RANKS } from '../../src/domain/scoring/rank.js';
import { TITLE_CATALOG, getTitleById } from '../../src/domain/titles/title.js';

describe('Quests & Achievements Reward System', () => {
  describe('Catalog & Metadata Verification', () => {
    it('verifies all 102 achievements exist with valid metadata', () => {
      expect(ACHIEVEMENT_CODES.length).toBe(102);
      for (const code of ACHIEVEMENT_CODES) {
        const meta = ACHIEVEMENTS[code as keyof typeof ACHIEVEMENTS];
        expect(meta).toBeDefined();
        expect(meta.code).toBe(code);
        expect(meta.name.length).toBeGreaterThan(0);
        expect(meta.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Rank Tier Progression System', () => {
    it('contains exactly 12 epic rank tiers in ascending order', () => {
      expect(PLAYER_RANKS).toHaveLength(12);
      for (let i = 1; i < PLAYER_RANKS.length; i++) {
        expect(PLAYER_RANKS[i]!.minPoints).toBeGreaterThan(PLAYER_RANKS[i - 1]!.minPoints);
      }
    });

    it('assigns Écuyer Débutant for 0 points', () => {
      const rank = getRankForPoints(0);
      expect(rank.defaultTitle).toBe('Écuyer Débutant');
      expect(rank.level).toBe(1);
    });

    it('promotes to Gardien des Ombres at 50 points', () => {
      const rank = getRankForPoints(50);
      expect(rank.defaultTitle).toBe('Gardien des Ombres');
      expect(rank.level).toBe(2);
    });

    it('promotes to Chevalier Noir at 150 points', () => {
      const rank = getRankForPoints(150);
      expect(rank.defaultTitle).toBe('Chevalier Noir');
      expect(rank.level).toBe(3);
    });

    it('promotes to Souverain Absolu at 15000+ points', () => {
      const rank = getRankForPoints(20000);
      expect(rank.defaultTitle).toBe('Souverain Absolu');
      expect(rank.level).toBe(12);
    });
  });

  describe('Unlockable Titles Integration', () => {
    it('has 10 unique epic titles with emojis', () => {
      expect(TITLE_CATALOG).toHaveLength(10);
      const ids = new Set(TITLE_CATALOG.map((t) => t.id));
      expect(ids.size).toBe(10);
    });

    it('retrieves correct title details for untouchable, chemist, and lovers', () => {
      expect(getTitleById('untouchable')?.defaultTitle).toBe("L'Intouchable");
      expect(getTitleById('mad_chemist')?.defaultTitle).toBe('Le Chimiste Fou');
      expect(getTitleById('broken_heart')?.defaultTitle).toBe('Cœur Brisé');
    });
  });
});
