import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveCrowNight } from '../../src/domain/game/night-resolution.js';

describe('resolveCrowNight', () => {
  it('does nothing when the Crow is dead, frozen, absent, or has not chosen', () => {
    const dead = createPlayer(1n, 'Crow', ROLE_BIT.Crow, 'Neutral');
    dead.isDead = true;
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    expect(resolveCrowNight([dead, target])).toEqual([]);
    expect(target.isCursedByCrow).toBe(false);

    const frozen = createPlayer(1n, 'Crow', ROLE_BIT.Crow, 'Neutral');
    frozen.frozen = true;
    frozen.choice = target.id;
    expect(resolveCrowNight([frozen, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'Crow', ROLE_BIT.Crow, 'Neutral');
    expect(resolveCrowNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'Crow', ROLE_BIT.Crow, 'Neutral');
    abstained.choice = ABSTAIN;
    expect(resolveCrowNight([abstained, target])).toEqual([]);
  });

  it('curses a chosen living target and reports it only to the Crow', () => {
    const crow = createPlayer(1n, 'Crow', ROLE_BIT.Crow, 'Neutral');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    crow.choice = target.id;

    const events = resolveCrowNight([crow, target]);

    expect(target.isCursedByCrow).toBe(true);
    expect(events).toEqual([{ type: 'CrowCursed', crowId: crow.id, targetId: target.id }]);
  });

  it('does not curse a target who is already dead', () => {
    const crow = createPlayer(1n, 'Crow', ROLE_BIT.Crow, 'Neutral');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.isDead = true;
    crow.choice = target.id;

    expect(resolveCrowNight([crow, target])).toEqual([]);
    expect(target.isCursedByCrow).toBe(false);
  });
});
