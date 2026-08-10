import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { resolveChemistNight, resolveHarlotNight } from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], random?: () => number) {
  return { players, dayNumber: 2, thiefFull: false, ...(random !== undefined ? { random } : {}) };
}

describe('resolveChemistNight', () => {
  it('does nothing without a living, unfrozen Chemist', () => {
    expect(resolveChemistNight([], baseCtx([]))).toEqual([]);
  });

  it('kills the target on a successful roll and resets HasUsedAbility', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    chemist.hasUsedAbility = true;
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    chemist.choice = target.id;

    const events = resolveChemistNight([chemist, target], baseCtx([chemist, target], () => 0));

    expect(target.isDead).toBe(true);
    expect(chemist.isDead).toBe(false);
    expect(chemist.hasUsedAbility).toBe(false);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Chemistry' && e.playerId === target.id)).toBe(
      true,
    );
  });

  it('demotes the Chemist to Villager when their potion kills the Wise Elder', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.WiseElder, 'Village');
    chemist.choice = target.id;

    const events = resolveChemistNight([chemist, target], baseCtx([chemist, target], () => 0));

    expect(target.isDead).toBe(true);
    expect(chemist.role).toBe(ROLE_BIT.Villager);
    expect(chemist.team).toBe('Village');
    expect(chemist.changedRolesCount).toBe(1);
    expect(events.some((e) => e.type === 'ChemistLostPowerToWiseElder' && e.playerId === chemist.id)).toBe(true);
  });

  it('kills the Chemist themselves on a failed roll', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    chemist.choice = target.id;

    const events = resolveChemistNight([chemist, target], baseCtx([chemist, target], () => 0.99));

    expect(chemist.isDead).toBe(true);
    expect(target.isDead).toBe(false);
    expect(
      events.some(
        (e) => e.type === 'PlayerDied' && e.method === 'Chemistry' && e.playerId === chemist.id && e.killerIds[0] === chemist.id,
      ),
    ).toBe(true);
  });
});

describe('resolveHarlotNight', () => {
  it('does nothing without a living, unfrozen Harlot', () => {
    expect(resolveHarlotNight([], baseCtx([]))).toEqual([]);
  });

  it('dies visiting someone freshly eaten by wolves that same night', () => {
    const harlot = createPlayer(1n, 'H', ROLE_BIT.Harlot, 'Village');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    // Simulate the victim already having been eaten by wolves earlier this same NightCycle.
    victim.isDead = true;
    victim.diedLastNight = true;
    victim.killedByRole = ROLE_BIT.Wolf;
    victim.diedByVisitingKiller = false;
    victim.diedByVisitingVictim = false;
    harlot.choice = victim.id;

    const events = resolveHarlotNight([harlot, victim], baseCtx([harlot, victim]));

    expect(harlot.isDead).toBe(true);
    expect(harlot.killedByRole).toBe(ROLE_BIT.Wolf);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'VisitVictim' && e.playerId === harlot.id)).toBe(
      true,
    );
  });

  it('dies visiting someone freshly killed by the Serial Killer that same night', () => {
    const harlot = createPlayer(1n, 'H', ROLE_BIT.Harlot, 'Village');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    victim.isDead = true;
    victim.diedLastNight = true;
    victim.killedByRole = ROLE_BIT.SerialKiller;
    harlot.choice = victim.id;

    resolveHarlotNight([harlot, victim], baseCtx([harlot, victim]));

    expect(harlot.isDead).toBe(true);
  });

  it('survives visiting someone who died from a non-wolf, non-SK cause', () => {
    const harlot = createPlayer(1n, 'H', ROLE_BIT.Harlot, 'Village');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    victim.isDead = true;
    victim.diedLastNight = true;
    victim.killedByRole = ROLE_BIT.Arsonist;
    harlot.choice = victim.id;

    resolveHarlotNight([harlot, victim], baseCtx([harlot, victim]));

    expect(harlot.isDead).toBe(false);
  });

  it('survives visiting someone who died on a previous night (not this one)', () => {
    const harlot = createPlayer(1n, 'H', ROLE_BIT.Harlot, 'Village');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    victim.isDead = true;
    victim.diedLastNight = false; // died before tonight
    victim.killedByRole = ROLE_BIT.Wolf;
    harlot.choice = victim.id;

    resolveHarlotNight([harlot, victim], baseCtx([harlot, victim]));

    expect(harlot.isDead).toBe(false);
  });

  it('survives visiting a target already flagged as died-by-visiting (avoids double consequences)', () => {
    const harlot = createPlayer(1n, 'H', ROLE_BIT.Harlot, 'Village');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    victim.isDead = true;
    victim.diedLastNight = true;
    victim.killedByRole = ROLE_BIT.Wolf;
    victim.diedByVisitingKiller = true; // e.g. died visiting the wolves themselves
    harlot.choice = victim.id;

    resolveHarlotNight([harlot, victim], baseCtx([harlot, victim]));

    expect(harlot.isDead).toBe(false);
  });
});
