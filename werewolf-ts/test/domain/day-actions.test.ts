import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { resolveGunnerShot, resolveSpumpkinDetonate } from '../../src/domain/game/day-actions.js';

describe('resolveGunnerShot', () => {
  it('does nothing without an acting Gunner', () => {
    expect(resolveGunnerShot([])).toEqual([]);
  });

  it('spends a bullet, marks the ability used, and kills the target', () => {
    const gunner = createPlayer(1n, 'G', ROLE_BIT.Gunner, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    gunner.choice = target.id;

    const events = resolveGunnerShot([gunner, target]);

    expect(gunner.bullet).toBe(1);
    expect(gunner.hasUsedAbility).toBe(true);
    expect(target.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Shoot' && e.playerId === target.id)).toBe(
      true,
    );
  });

  it('still kills the Wise Elder, but costs the Gunner their role and remaining bullets', () => {
    const gunner = createPlayer(1n, 'G', ROLE_BIT.Gunner, 'Village');
    gunner.bullet = 2;
    const elder = createPlayer(2n, 'E', ROLE_BIT.WiseElder, 'Village');
    gunner.choice = elder.id;

    const events = resolveGunnerShot([gunner, elder]);

    expect(elder.isDead).toBe(true);
    expect(gunner.role).toBe(ROLE_BIT.Villager);
    expect(gunner.bullet).toBe(0);
    expect(events.some((e) => e.type === 'GunnerLostPowerToWiseElder')).toBe(true);
  });
});

describe('resolveSpumpkinDetonate', () => {
  it('does nothing without an acting Spumpkin', () => {
    expect(resolveSpumpkinDetonate([])).toEqual([]);
  });

  it('kills both the target and itself on a successful roll', () => {
    const spumpkin = createPlayer(1n, 'S', ROLE_BIT.Spumpkin, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    spumpkin.choice = target.id;

    const events = resolveSpumpkinDetonate([spumpkin, target], () => 0);

    expect(spumpkin.isDead).toBe(true);
    expect(target.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'None' && e.playerId === spumpkin.id)).toBe(
      true,
    );
  });

  it('does nothing on a failed roll', () => {
    const spumpkin = createPlayer(1n, 'S', ROLE_BIT.Spumpkin, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    spumpkin.choice = target.id;

    resolveSpumpkinDetonate([spumpkin, target], () => 0.99);

    expect(spumpkin.isDead).toBe(false);
    expect(target.isDead).toBe(false);
  });
});
