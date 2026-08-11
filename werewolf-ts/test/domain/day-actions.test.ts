import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { resolveDetectiveSnoop, resolveGunnerShot, resolveSpumpkinDetonate } from '../../src/domain/game/day-actions.js';

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

  it('counts a shot against a wolf/SK/cultist/arsonist toward bulletHitBaddies, but not a shot against a villager', () => {
    const gunner = createPlayer(1n, 'G', ROLE_BIT.Gunner, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    gunner.choice = wolf.id;

    resolveGunnerShot([gunner, wolf]);

    expect(gunner.bulletHitBaddies).toBe(1);
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

describe('resolveDetectiveSnoop', () => {
  it('does nothing without an acting Detective', () => {
    expect(resolveDetectiveSnoop([])).toEqual([]);
  });

  it('accurately reveals the target role and never fumbles the identity (unlike the Seer)', () => {
    const detective = createPlayer(1n, 'D', ROLE_BIT.Detective, 'Village');
    const wolfMan = createPlayer(2n, 'WM', ROLE_BIT.WolfMan, 'Village');
    detective.choice = wolfMan.id;

    const events = resolveDetectiveSnoop([detective, wolfMan], () => 0.99); // >= 40% roll: not caught

    expect(events).toEqual([{ type: 'DetectiveSnoop', playerId: detective.id, targetId: wolfMan.id, targetRole: ROLE_BIT.WolfMan }]);
  });

  it('tips off the wolf pack on a successful roll (< 40%)', () => {
    const detective = createPlayer(1n, 'D', ROLE_BIT.Detective, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    detective.choice = target.id;

    const events = resolveDetectiveSnoop([detective, target], () => 0);

    expect(events.some((e) => e.type === 'DetectiveCaught' && e.playerId === detective.id)).toBe(true);
  });

  it('builds a streak on repeated *different* threats, unlocking streetwise at 4', () => {
    const detective = createPlayer(1n, 'D', ROLE_BIT.Detective, 'Village');
    const wolves = [
      createPlayer(2n, 'W1', ROLE_BIT.Wolf, 'Wolf'),
      createPlayer(3n, 'W2', ROLE_BIT.Wolf, 'Wolf'),
      createPlayer(4n, 'W3', ROLE_BIT.Wolf, 'Wolf'),
      createPlayer(5n, 'W4', ROLE_BIT.Wolf, 'Wolf'),
    ];
    const players = [detective, ...wolves];

    for (const wolf of wolves) {
      detective.choice = wolf.id;
      resolveDetectiveSnoop(players, () => 0.99);
    }

    expect(detective.streetwise).toBe(true);
    expect(detective.correctSnoopedIds).toEqual([]); // cleared after unlocking
  });

  it('resets the streak on a re-snoop of the same target', () => {
    const detective = createPlayer(1n, 'D', ROLE_BIT.Detective, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    detective.choice = wolf.id;

    resolveDetectiveSnoop([detective, wolf], () => 0.99);
    resolveDetectiveSnoop([detective, wolf], () => 0.99);

    expect(detective.correctSnoopedIds).toEqual([wolf.id]);
    expect(detective.streetwise).toBe(false);
  });

  it('resets the streak entirely on a non-threat snoop', () => {
    const detective = createPlayer(1n, 'D', ROLE_BIT.Detective, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const villager = createPlayer(3n, 'V', ROLE_BIT.Villager, 'Village');

    detective.choice = wolf.id;
    resolveDetectiveSnoop([detective, wolf, villager], () => 0.99);
    detective.choice = villager.id;
    resolveDetectiveSnoop([detective, wolf, villager], () => 0.99);

    expect(detective.correctSnoopedIds).toEqual([]);
  });
});
