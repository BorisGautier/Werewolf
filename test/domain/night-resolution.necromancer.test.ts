import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveNecromancerNight } from '../../src/domain/game/night-resolution.js';

describe('resolveNecromancerNight', () => {
  it('does nothing when the Necromancer is dead, frozen, has already used their ability, or has not chosen', () => {
    const deadPlayer = createPlayer(2n, 'Dead', ROLE_BIT.Villager, 'Village');
    deadPlayer.isDead = true;

    const dead = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    dead.isDead = true;
    dead.choice = deadPlayer.id;
    expect(resolveNecromancerNight([dead, deadPlayer])).toEqual([]);
    expect(deadPlayer.isDead).toBe(true);

    const frozen = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    frozen.frozen = true;
    frozen.choice = deadPlayer.id;
    expect(resolveNecromancerNight([frozen, deadPlayer])).toEqual([]);

    const alreadyUsed = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    alreadyUsed.hasUsedAbility = true;
    alreadyUsed.choice = deadPlayer.id;
    expect(resolveNecromancerNight([alreadyUsed, deadPlayer])).toEqual([]);

    const noChoice = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    expect(resolveNecromancerNight([noChoice, deadPlayer])).toEqual([]);

    const abstained = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    abstained.choice = ABSTAIN;
    expect(resolveNecromancerNight([abstained, deadPlayer])).toEqual([]);
  });

  it('does nothing when the chosen target is still alive', () => {
    const necro = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    const alive = createPlayer(2n, 'Alive', ROLE_BIT.Villager, 'Village');
    necro.choice = alive.id;

    expect(resolveNecromancerNight([necro, alive])).toEqual([]);
    expect(necro.hasUsedAbility).toBe(false);
  });

  it('resurrects a dead target, switches their team to Neutral, and consumes the once-per-game ability', () => {
    const necro = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    const zombie = createPlayer(2n, 'Zombie', ROLE_BIT.Seer, 'Village');
    zombie.isDead = true;
    zombie.diedLastNight = true;
    zombie.timeDied = new Date();
    zombie.killedByRole = ROLE_BIT.Wolf;
    necro.choice = zombie.id;

    const events = resolveNecromancerNight([necro, zombie]);

    expect(zombie.isDead).toBe(false);
    expect(zombie.team).toBe('Neutral');
    expect(zombie.diedLastNight).toBe(false);
    expect(zombie.timeDied).toBeNull();
    expect(zombie.killedByRole).toBeNull();
    expect(necro.hasUsedAbility).toBe(true);
    expect(events).toEqual([
      { type: 'PlayerResurrected', necromancerId: necro.id, playerId: zombie.id },
    ]);
  });

  it('cannot be used a second time in the same game', () => {
    const necro = createPlayer(1n, 'Necro', ROLE_BIT.Necromancer, 'Neutral');
    const zombie1 = createPlayer(2n, 'Z1', ROLE_BIT.Villager, 'Village');
    zombie1.isDead = true;
    const zombie2 = createPlayer(3n, 'Z2', ROLE_BIT.Villager, 'Village');
    zombie2.isDead = true;

    necro.choice = zombie1.id;
    resolveNecromancerNight([necro, zombie1, zombie2]);
    expect(zombie1.isDead).toBe(false);

    necro.choice = zombie2.id;
    const secondAttempt = resolveNecromancerNight([necro, zombie1, zombie2]);
    expect(secondAttempt).toEqual([]);
    expect(zombie2.isDead).toBe(true);
  });
});
