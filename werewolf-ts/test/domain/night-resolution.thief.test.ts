import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { resolveThiefNight } from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], dayNumber = 1, random?: () => number) {
  return { players, dayNumber, thiefFull: false, ...(random !== undefined ? { random } : {}) };
}

describe('resolveThiefNight (non-ThiefFull)', () => {
  it('does nothing without a living Thief', () => {
    expect(resolveThiefNight([], 1, false, baseCtx([]))).toEqual([]);
  });

  it('only steals on the first night', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    const target = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    thief.choice = target.id;

    resolveThiefNight([thief, target], 2, false, baseCtx([thief, target], 2));

    expect(thief.role).toBe(ROLE_BIT.Thief);
  });

  it("swaps roles with the chosen target on night 1, becoming a Villager themselves", () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    const seer = createPlayer(2n, 'S', ROLE_BIT.Seer, 'Village');
    thief.choice = seer.id;

    const events = resolveThiefNight([thief, seer], 1, false, baseCtx([thief, seer], 1));

    expect(thief.role).toBe(ROLE_BIT.Seer);
    expect(thief.team).toBe('Village');
    expect(seer.role).toBe(ROLE_BIT.Villager);
    expect(events.some((e) => e.type === 'RoleStolen' && e.stolenRole === ROLE_BIT.Seer)).toBe(true);
  });

  it('carries over bullet count and hasUsedAbility from the stolen role', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    const gunner = createPlayer(2n, 'G', ROLE_BIT.Gunner, 'Village');
    gunner.bullet = 1;
    gunner.hasUsedAbility = true;
    thief.choice = gunner.id;

    resolveThiefNight([thief, gunner], 1, false, baseCtx([thief, gunner], 1));

    expect(thief.role).toBe(ROLE_BIT.Gunner);
    expect(thief.bullet).toBe(1);
    expect(thief.hasUsedAbility).toBe(true);
  });

  it('redirects to a random living player if the chosen target is already dead', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    const dead = createPlayer(2n, 'D', ROLE_BIT.Seer, 'Village');
    dead.isDead = true;
    const alive = createPlayer(3n, 'A', ROLE_BIT.Detective, 'Village');
    thief.choice = dead.id;

    resolveThiefNight([thief, dead, alive], 1, false, baseCtx([thief, dead, alive], 1, () => 0));

    expect(thief.role).toBe(ROLE_BIT.Detective);
    expect(alive.role).toBe(ROLE_BIT.Villager);
    expect(dead.role).toBe(ROLE_BIT.Seer); // untouched
  });

  it('does nothing without a chosen target', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    resolveThiefNight([thief], 1, false, baseCtx([thief], 1));
    expect(thief.role).toBe(ROLE_BIT.Thief);
  });
});

describe('resolveThiefNight (ThiefFull)', () => {
  it('can steal on any night, gated by a 50% roll', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    thief.choice = villager.id;

    resolveThiefNight([thief, villager], 3, true, baseCtx([thief, villager], 3, () => 0));
    expect(thief.role).toBe(ROLE_BIT.Villager);
    expect(villager.role).toBe(ROLE_BIT.Thief); // ThiefFull: the target becomes a Thief, not a plain Villager
  });

  it('fails to steal on a bad roll', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    thief.choice = villager.id;

    resolveThiefNight([thief, villager], 3, true, baseCtx([thief, villager], 3, () => 0.99));
    expect(thief.role).toBe(ROLE_BIT.Thief);
  });

  it('can never target a wolf-team role, a Cultist, or a Snow Wolf', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    thief.choice = wolf.id;

    resolveThiefNight([thief, wolf], 3, true, baseCtx([thief, wolf], 3, () => 0));
    expect(thief.role).toBe(ROLE_BIT.Thief);
  });

  it('does not act while frozen', () => {
    const thief = createPlayer(1n, 'T', ROLE_BIT.Thief, 'Thief');
    thief.frozen = true;
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    thief.choice = villager.id;

    resolveThiefNight([thief, villager], 3, true, baseCtx([thief, villager], 3, () => 0));
    expect(thief.role).toBe(ROLE_BIT.Thief);
  });
});
