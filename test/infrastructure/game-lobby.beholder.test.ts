import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { describeBeholderReveal } from '../../src/infrastructure/telegram/game-lobby.js';

describe('describeBeholderReveal', () => {
  it("reveals the real Seer's identity to the Beholder, in French", () => {
    const beholder = createPlayer(1n, 'B', ROLE_BIT.Beholder, 'Village');
    const seer = createPlayer(2n, 'Alice', ROLE_BIT.Seer, 'Village');
    const villager = createPlayer(3n, 'V', ROLE_BIT.Villager, 'Village');

    const text = describeBeholderReveal(beholder.id, [beholder, seer, villager], 'fr');

    expect(text).toContain('Alice');
    expect(text).toContain('Voyante');
  });

  it("reveals the real Seer's identity to the Beholder, in English", () => {
    const beholder = createPlayer(1n, 'B', ROLE_BIT.Beholder, 'Village');
    const seer = createPlayer(2n, 'Alice', ROLE_BIT.Seer, 'Village');

    const text = describeBeholderReveal(beholder.id, [beholder, seer], 'en');

    expect(text).toContain('Alice');
    expect(text).toContain('Seer');
  });

  it('never confuses the Fool for the real Seer', () => {
    const beholder = createPlayer(1n, 'B', ROLE_BIT.Beholder, 'Village');
    const fool = createPlayer(2n, 'Fool', ROLE_BIT.Fool, 'Village');
    const realSeer = createPlayer(3n, 'RealSeer', ROLE_BIT.Seer, 'Village');

    const text = describeBeholderReveal(beholder.id, [beholder, fool, realSeer], 'en');

    expect(text).toContain('RealSeer');
    expect(text).not.toContain('>Fool<');
  });

  it('falls back to a "no Seer in this game" message when none is dealt', () => {
    const beholder = createPlayer(1n, 'B', ROLE_BIT.Beholder, 'Village');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');

    const text = describeBeholderReveal(beholder.id, [beholder, villager], 'en');

    expect(text).toContain('no Seer');
  });

  it('never reveals itself as the Seer even if the Beholder somehow shares the search pool', () => {
    const beholder = createPlayer(1n, 'B', ROLE_BIT.Beholder, 'Village');

    const text = describeBeholderReveal(beholder.id, [beholder], 'en');

    expect(text).toContain('no Seer');
  });
});
