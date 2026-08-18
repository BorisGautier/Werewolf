import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import {
  findPriestessBlessing,
  initialNightState,
  resolveWolfNight,
} from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], random?: () => number) {
  return { players, dayNumber: 1, thiefFull: false, ...(random !== undefined ? { random } : {}) };
}

describe('findPriestessBlessing', () => {
  it('returns null when the Priestess is dead, frozen, has already used their ability, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'P', ROLE_BIT.Priestess, 'Village');
    dead.isDead = true;
    dead.choice = target.id;
    expect(findPriestessBlessing([dead, target])).toBeNull();

    const frozen = createPlayer(1n, 'P', ROLE_BIT.Priestess, 'Village');
    frozen.frozen = true;
    frozen.choice = target.id;
    expect(findPriestessBlessing([frozen, target])).toBeNull();

    const used = createPlayer(1n, 'P', ROLE_BIT.Priestess, 'Village');
    used.hasUsedAbility = true;
    used.choice = target.id;
    expect(findPriestessBlessing([used, target])).toBeNull();

    const noChoice = createPlayer(1n, 'P', ROLE_BIT.Priestess, 'Village');
    expect(findPriestessBlessing([noChoice, target])).toBeNull();

    const abstained = createPlayer(1n, 'P', ROLE_BIT.Priestess, 'Village');
    abstained.choice = ABSTAIN;
    expect(findPriestessBlessing([abstained, target])).toBeNull();
  });

  it('returns the blessing and consumes the once-per-game ability on a valid choice', () => {
    const priestess = createPlayer(1n, 'P', ROLE_BIT.Priestess, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    priestess.choice = target.id;

    const result = findPriestessBlessing([priestess, target]);

    expect(result).toEqual({ priestessId: priestess.id, targetId: target.id });
    expect(priestess.hasUsedAbility).toBe(true);
  });
});

describe('resolveWolfNight - Priestess interaction', () => {
  it('saves a blessed target from a wolf attack and flags the pack to be blinded next night', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const blessed = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    wolf.choice = blessed.id;

    const state = initialNightState();
    state.priestessBlessed = { priestessId: 99n, targetId: blessed.id };

    const events = resolveWolfNight([wolf, blessed], state, baseCtx([wolf, blessed]));

    expect(blessed.isDead).toBe(false);
    expect(blessed.wasSavedLastNight).toBe(true);
    expect(state.triggerWolfBlindNextNight).toBe(true);
    expect(events).toContainEqual({
      type: 'PriestessBlessingSaved',
      priestessId: 99n,
      targetId: blessed.id,
    });
  });

  it('does not save a player the Priestess blessed for someone else', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const someoneElse = createPlayer(3n, 'E', ROLE_BIT.Villager, 'Village');
    wolf.choice = victim.id;

    const state = initialNightState();
    state.priestessBlessed = { priestessId: 99n, targetId: someoneElse.id };

    resolveWolfNight([wolf, victim, someoneElse], state, baseCtx([wolf, victim, someoneElse]));

    expect(victim.isDead).toBe(true);
    expect(state.triggerWolfBlindNextNight).toBe(false);
  });

  it('blinds the pack entirely (no attack attempted) when wolfPackBlinded is set', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    wolf.choice = target.id;

    const state = initialNightState();
    state.wolfPackBlinded = true;

    const events = resolveWolfNight([wolf, target], state, baseCtx([wolf, target]));

    expect(target.isDead).toBe(false);
    expect(events).toEqual([{ type: 'WolfPackBlinded' }]);
  });
});
