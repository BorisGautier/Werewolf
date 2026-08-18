import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveReflectorNight } from '../../src/domain/game/night-resolution.js';
import { visitPlayer, type VisitContext } from '../../src/domain/game/night-visit.js';

describe('resolveReflectorNight', () => {
  it('does nothing when the Reflector is dead, frozen, has already used it, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    dead.isDead = true;
    dead.choice = target.id;
    expect(resolveReflectorNight([dead, target])).toEqual([]);

    const frozen = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    frozen.frozen = true;
    frozen.choice = target.id;
    expect(resolveReflectorNight([frozen, target])).toEqual([]);

    const alreadyUsed = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    alreadyUsed.hasUsedAbility = true;
    alreadyUsed.choice = target.id;
    expect(resolveReflectorNight([alreadyUsed, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    expect(resolveReflectorNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    abstained.choice = ABSTAIN;
    expect(resolveReflectorNight([abstained, target])).toEqual([]);
  });

  it('activates the mirror and consumes the one-time ability', () => {
    const reflector = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    reflector.choice = target.id;

    const events = resolveReflectorNight([reflector, target]);

    expect(reflector.hasUsedAbility).toBe(true);
    expect(events).toEqual([{ type: 'ReflectorActivated', reflectorId: reflector.id }]);
  });

  it('does not activate a second time once already raised', () => {
    const reflector = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    reflector.choice = target.id;
    resolveReflectorNight([reflector, target]);

    reflector.choice = target.id;
    expect(resolveReflectorNight([reflector, target])).toEqual([]);
  });
});

describe('visitPlayer - Reflector mirror', () => {
  function baseCtx(players: ReturnType<typeof createPlayer>[], reflectorId: bigint): VisitContext {
    return {
      players,
      dayNumber: 1,
      thiefFull: true,
      reflectorActive: new Set([reflectorId]),
    };
  }

  it('kills the visitor and reports ReflectorReflected when a wolf visits an active Reflector', () => {
    const reflector = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const players = [reflector, wolf];

    const outcome = visitPlayer(baseCtx(players, reflector.id), wolf, reflector);

    expect(outcome.result).toBe('VisitorDied');
    expect(wolf.isDead).toBe(true);
    expect(reflector.isDead).toBe(false);
    expect(outcome.events).toContainEqual({
      type: 'ReflectorReflected',
      reflectorId: reflector.id,
      attackerId: wolf.id,
    });
  });

  it('leaves the Reflector unaffected when they visit themselves', () => {
    const reflector = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    const players = [reflector];

    const outcome = visitPlayer(baseCtx(players, reflector.id), reflector, reflector);

    expect(outcome.result).not.toBe('VisitorDied');
    expect(reflector.isDead).toBe(false);
  });

  it('behaves normally when the Reflector has not activated their mirror', () => {
    const reflector = createPlayer(1n, 'R', ROLE_BIT.Reflector, 'Neutral');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const players = [reflector, wolf];

    const outcome = visitPlayer(
      { players, dayNumber: 1, thiefFull: true, reflectorActive: new Set() },
      wolf,
      reflector,
    );

    expect(outcome.result).toBe('Success');
    expect(wolf.isDead).toBe(false);
  });
});
