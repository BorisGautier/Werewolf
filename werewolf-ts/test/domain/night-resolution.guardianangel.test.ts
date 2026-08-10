import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { SPARK, createPlayer } from '../../src/domain/game/player.js';
import { initialNightState, resolveGuardianAngelNight } from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], random?: () => number) {
  return { players, dayNumber: 1, thiefFull: false, ...(random !== undefined ? { random } : {}) };
}

describe('resolveGuardianAngelNight', () => {
  it('does nothing without an acting Guardian Angel', () => {
    expect(resolveGuardianAngelNight([], initialNightState(), baseCtx([]))).toEqual([]);
  });

  it('cleans a douse off a target who was not otherwise attacked tonight', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.doused = true;
    ga.choice = target.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveGuardianAngelNight([ga, target], state, baseCtx([ga, target]));

    expect(target.doused).toBe(false);
    expect(events.some((e) => e.type === 'GuardianAngelCleanedDouse' && e.playerId === target.id)).toBe(true);
  });

  it('clears a douse when the save was specifically from an Arsonist spark', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.doused = true;
    target.wasSavedLastNight = true; // e.g. set by resolveArsonistNight earlier in the same night
    const arsonist = createPlayer(3n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    arsonist.choice = SPARK;
    ga.choice = target.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveGuardianAngelNight([ga, target, arsonist], state, baseCtx([ga, target, arsonist]));

    expect(target.doused).toBe(false);
    expect(events.some((e) => e.type === 'GuardianAngelCleanedDouse')).toBe(true);
  });

  it('does NOT clean a douse when the target was saved from a non-fire attack (wolf/SK)', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.doused = true;
    target.wasSavedLastNight = true; // saved from e.g. a wolf attack, NOT from fire
    // No Arsonist sparking tonight.
    ga.choice = target.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveGuardianAngelNight([ga, target], state, baseCtx([ga, target]));

    expect(target.doused).toBe(true); // untouched - this is the asymmetric branch
    expect(events.some((e) => e.type === 'GuardianAngelCleanedDouse')).toBe(false);
  });

  it('does not act while frozen', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    ga.frozen = true;
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.doused = true;
    ga.choice = target.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    resolveGuardianAngelNight([ga, target], state, baseCtx([ga, target]));

    expect(target.doused).toBe(true);
  });

  it('still resolves for a Guardian Angel who died earlier this same night', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    ga.isDead = true;
    ga.diedLastNight = true;
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.doused = true;
    ga.choice = target.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    resolveGuardianAngelNight([ga, target], state, baseCtx([ga, target]));

    expect(target.doused).toBe(false);
  });
});
