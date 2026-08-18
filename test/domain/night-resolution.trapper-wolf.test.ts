import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveTrapperWolfNight } from '../../src/domain/game/night-resolution.js';
import { visitPlayer, type VisitContext } from '../../src/domain/game/night-visit.js';

describe('resolveTrapperWolfNight', () => {
  it('does nothing when the Trapper Wolf is dead, frozen, has already used it, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'TW', ROLE_BIT.TrapperWolf, 'Wolf');
    dead.isDead = true;
    dead.choice3 = target.id;
    expect(resolveTrapperWolfNight([dead, target])).toEqual([]);

    const frozen = createPlayer(1n, 'TW', ROLE_BIT.TrapperWolf, 'Wolf');
    frozen.frozen = true;
    frozen.choice3 = target.id;
    expect(resolveTrapperWolfNight([frozen, target])).toEqual([]);

    const alreadyUsed = createPlayer(1n, 'TW', ROLE_BIT.TrapperWolf, 'Wolf');
    alreadyUsed.hasUsedAbility = true;
    alreadyUsed.choice3 = target.id;
    expect(resolveTrapperWolfNight([alreadyUsed, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'TW', ROLE_BIT.TrapperWolf, 'Wolf');
    expect(resolveTrapperWolfNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'TW', ROLE_BIT.TrapperWolf, 'Wolf');
    abstained.choice3 = ABSTAIN;
    expect(resolveTrapperWolfNight([abstained, target])).toEqual([]);
  });

  it('ignores an ordinary pack-kill `choice`, only reading the dedicated `choice3` slot', () => {
    const trapper = createPlayer(1n, 'TW', ROLE_BIT.TrapperWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    trapper.choice = target.id; // the shared pack-vote field - must not trigger the trap

    expect(resolveTrapperWolfNight([trapper, target])).toEqual([]);
    expect(trapper.hasUsedAbility).toBe(false);
  });

  it('arms the trap and consumes the one-time ability', () => {
    const trapper = createPlayer(1n, 'TW', ROLE_BIT.TrapperWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    trapper.choice3 = target.id;

    const events = resolveTrapperWolfNight([trapper, target]);

    expect(trapper.hasUsedAbility).toBe(true);
    expect(events).toEqual([{ type: 'TrapperWolfTrapSet', trapperId: trapper.id, targetId: target.id }]);
  });
});

describe('visitPlayer - Trapper Wolf ambush', () => {
  function ctxWithTrap(players: ReturnType<typeof createPlayer>[], trappedId: bigint): VisitContext {
    return { players, dayNumber: 1, thiefFull: true, trappedTargetId: trappedId };
  }

  it('neutralizes a non-wolf visitor to the trapped house', () => {
    const trapped = createPlayer(1n, 'T', ROLE_BIT.GuardianAngel, 'Village');
    const harlot = createPlayer(2n, 'H', ROLE_BIT.Harlot, 'Village');
    const players = [trapped, harlot];

    const outcome = visitPlayer(ctxWithTrap(players, trapped.id), harlot, trapped);

    expect(outcome.result).toBe('Fail');
    expect(outcome.events).toEqual([]);
    expect(harlot.isDead).toBe(false);
    expect(trapped.isDead).toBe(false);
  });

  it('does not neutralize the wolf pack visiting its own trapped target', () => {
    const trapped = createPlayer(1n, 'T', ROLE_BIT.Villager, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const players = [trapped, wolf];

    const outcome = visitPlayer(ctxWithTrap(players, trapped.id), wolf, trapped);

    expect(outcome.result).toBe('Success');
    expect(trapped.isDead).toBe(false); // visitPlayer only reports the outcome; killing is the caller's job
  });

  it('does not neutralize a Snow Wolf visiting the trapped target', () => {
    const trapped = createPlayer(1n, 'T', ROLE_BIT.Villager, 'Village');
    const snowWolf = createPlayer(2n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const players = [trapped, snowWolf];

    const outcome = visitPlayer(ctxWithTrap(players, trapped.id), snowWolf, trapped);

    expect(outcome.result).toBe('Success');
  });

  it('leaves visits to a non-trapped player unaffected', () => {
    const trapped = createPlayer(1n, 'T', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(2n, 'O', ROLE_BIT.Villager, 'Village');
    const harlot = createPlayer(3n, 'H', ROLE_BIT.Harlot, 'Village');
    const players = [trapped, other, harlot];

    const outcome = visitPlayer(ctxWithTrap(players, trapped.id), harlot, other);

    expect(outcome.result).toBe('Success');
  });
});
