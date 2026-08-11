import { describe, expect, it } from 'vitest';
import { DONATION_TIERS, donationLevelForTotal, donorBadge } from '../../src/infrastructure/persistence/player.repository.js';

describe('donationLevelForTotal', () => {
  it('is level 0 below the first tier', () => {
    expect(donationLevelForTotal(0)).toBe(0);
    expect(donationLevelForTotal(9)).toBe(0);
  });

  it('reaches level 1 exactly at the first tier threshold', () => {
    expect(donationLevelForTotal(DONATION_TIERS[0]!)).toBe(1);
    expect(donationLevelForTotal(DONATION_TIERS[0]! + 1)).toBe(1);
  });

  it('climbs one level per tier crossed, cumulatively', () => {
    expect(donationLevelForTotal(DONATION_TIERS[1]!)).toBe(2);
    expect(donationLevelForTotal(DONATION_TIERS[2]!)).toBe(3);
  });

  it('never exceeds the number of defined tiers, however large the total', () => {
    expect(donationLevelForTotal(1_000_000)).toBe(DONATION_TIERS.length);
  });
});

describe('donorBadge', () => {
  it('is empty below the first tier', () => {
    expect(donorBadge(0)).toBe('');
  });

  it('picks bronze/silver/gold for levels 1/2/3', () => {
    expect(donorBadge(1)).toBe(' 🥉');
    expect(donorBadge(2)).toBe(' 🥈');
    expect(donorBadge(3)).toBe(' 🥇');
  });

  it('stays gold for any level past the highest defined tier', () => {
    expect(donorBadge(99)).toBe(' 🥇');
  });
});
