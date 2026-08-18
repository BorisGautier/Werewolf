import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveViperWolfNight } from '../../src/domain/game/night-resolution.js';

describe('resolveViperWolfNight', () => {
  it('does nothing when the Viper Wolf is dead, frozen, has already used it, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    dead.isDead = true;
    dead.choice3 = target.id;
    expect(resolveViperWolfNight([dead, target])).toEqual([]);

    const frozen = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    frozen.frozen = true;
    frozen.choice3 = target.id;
    expect(resolveViperWolfNight([frozen, target])).toEqual([]);

    const alreadyUsed = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    alreadyUsed.hasUsedAbility = true;
    alreadyUsed.choice3 = target.id;
    expect(resolveViperWolfNight([alreadyUsed, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    expect(resolveViperWolfNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    abstained.choice3 = ABSTAIN;
    expect(resolveViperWolfNight([abstained, target])).toEqual([]);
  });

  it('does not poison an already-dead target', () => {
    const viper = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.isDead = true;
    viper.choice3 = target.id;

    expect(resolveViperWolfNight([viper, target])).toEqual([]);
    expect(viper.hasUsedAbility).toBe(false);
  });

  it('poisons the target without killing them immediately, and consumes the one-time ability', () => {
    const viper = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    viper.choice3 = target.id;

    const events = resolveViperWolfNight([viper, target]);

    expect(viper.hasUsedAbility).toBe(true);
    expect(target.isDead).toBe(false);
    expect(events).toEqual([{ type: 'ViperWolfPoisoned', viperId: viper.id, targetId: target.id }]);
  });

  it('ignores an ordinary pack-kill `choice`, only reading the dedicated `choice3` slot', () => {
    const viper = createPlayer(1n, 'VW', ROLE_BIT.ViperWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    viper.choice = target.id;

    expect(resolveViperWolfNight([viper, target])).toEqual([]);
  });
});
