import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveHowlerWolfNight } from '../../src/domain/game/night-resolution.js';

describe('resolveHowlerWolfNight', () => {
  it('does nothing when the Howler Wolf is dead, frozen, has already used it, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'HW', ROLE_BIT.HowlerWolf, 'Wolf');
    dead.isDead = true;
    dead.choice3 = target.id;
    expect(resolveHowlerWolfNight([dead, target])).toEqual([]);

    const frozen = createPlayer(1n, 'HW', ROLE_BIT.HowlerWolf, 'Wolf');
    frozen.frozen = true;
    frozen.choice3 = target.id;
    expect(resolveHowlerWolfNight([frozen, target])).toEqual([]);

    const alreadyUsed = createPlayer(1n, 'HW', ROLE_BIT.HowlerWolf, 'Wolf');
    alreadyUsed.hasUsedAbility = true;
    alreadyUsed.choice3 = target.id;
    expect(resolveHowlerWolfNight([alreadyUsed, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'HW', ROLE_BIT.HowlerWolf, 'Wolf');
    expect(resolveHowlerWolfNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'HW', ROLE_BIT.HowlerWolf, 'Wolf');
    abstained.choice3 = ABSTAIN;
    expect(resolveHowlerWolfNight([abstained, target])).toEqual([]);
  });

  it('howls and consumes the one-time ability regardless of which player was picked', () => {
    const howler = createPlayer(1n, 'HW', ROLE_BIT.HowlerWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    howler.choice3 = target.id;

    const events = resolveHowlerWolfNight([howler, target]);

    expect(howler.hasUsedAbility).toBe(true);
    expect(events).toEqual([{ type: 'HowlerWolfHowled', howlerId: howler.id }]);
  });

  it('ignores an ordinary pack-kill `choice`, only reading the dedicated `choice3` slot', () => {
    const howler = createPlayer(1n, 'HW', ROLE_BIT.HowlerWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    howler.choice = target.id;

    expect(resolveHowlerWolfNight([howler, target])).toEqual([]);
  });
});
