import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { killPlayer } from '../../src/domain/game/kill.js';

describe('killPlayer', () => {
  it('marks the victim dead and records who killed them', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const victim = createPlayer(2n, 'Victim', ROLE_BIT.Villager, 'Village');
    const players = [wolf, victim];

    const events = killPlayer(players, 2n, 'Eat', { killerIds: [1n] });

    expect(victim.isDead).toBe(true);
    expect(victim.diedLastNight).toBe(true);
    expect(victim.killedByRole).toBe(ROLE_BIT.Wolf);
    expect(wolf.killedLastNight).toBe(1);
    expect(events).toContainEqual({ type: 'PlayerDied', playerId: 2n, method: 'Eat', killerIds: [1n], isNight: true });
  });

  it('kills the surviving lover too, and skips it for idle/flee deaths', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    a.inLove = true;
    a.loverId = 2n;
    b.inLove = true;
    b.loverId = 1n;
    const wolf = createPlayer(3n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const players = [a, b, wolf];

    const events = killPlayer(players, 1n, 'Eat', { killerIds: [3n] });

    expect(a.isDead).toBe(true);
    expect(b.isDead).toBe(true);
    expect(events.some((e) => e.type === 'LoverDiedOfGrief' && e.playerId === 2n)).toBe(true);
  });

  it('does not trigger the lover chain for idle/flee deaths', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    a.inLove = true;
    a.loverId = 2n;
    b.inLove = true;
    b.loverId = 1n;
    const players = [a, b];

    killPlayer(players, 1n, 'Idle');

    expect(a.isDead).toBe(true);
    expect(a.diedByFleeOrIdle).toBe(true);
    expect(b.isDead).toBe(false);
  });

  it('flags a pending Hunter shot on death, unless suppressed', () => {
    const hunter = createPlayer(1n, 'Hunter', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const players = [hunter, wolf];

    const events = killPlayer(players, 1n, 'Eat', { killerIds: [2n] });

    expect(hunter.pendingHunterShot).toEqual({ method: 'Eat', delayed: true });
    expect(events.some((e) => e.type === 'HunterMustShoot')).toBe(true);
  });

  it('emits WolfCubKilled when the victim is a Wolf Cub', () => {
    const cub = createPlayer(1n, 'Cub', ROLE_BIT.WolfCub, 'Wolf');
    const players = [cub];

    const events = killPlayer(players, 1n, 'Lynch');

    expect(events.some((e) => e.type === 'WolfCubKilled')).toBe(true);
  });
});
