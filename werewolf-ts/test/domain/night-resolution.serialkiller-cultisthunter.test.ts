import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import {
  initialNightState,
  resolveCultistHunterNight,
  resolveSerialKillerNight,
} from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], dayNumber = 1, random?: () => number) {
  return { players, dayNumber, thiefFull: false, random };
}

describe('resolveSerialKillerNight', () => {
  it('does nothing when there is no living, unfrozen Serial Killer', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sk.frozen = true;
    expect(resolveSerialKillerNight([sk], initialNightState(), baseCtx([sk]))).toEqual([]);
  });

  it('kills the chosen target', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    sk.choice = victim.id;

    const events = resolveSerialKillerNight([sk, victim], initialNightState(), baseCtx([sk, victim]));

    expect(victim.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'SerialKilled')).toBe(true);
  });

  it('lets the Guardian Angel block the kill, except for the Harlot', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const ga = createPlayer(3n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    sk.choice = villager.id;
    ga.choice = villager.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveSerialKillerNight([sk, villager, ga], state, baseCtx([sk, villager, ga]));

    expect(villager.isDead).toBe(false);
    expect(villager.wasSavedLastNight).toBe(true);
    expect(events.some((e) => e.type === 'GuardianAngelBlockedSerialKiller')).toBe(true);
  });

  it('cannot be blocked by the Guardian Angel when the target is the Harlot', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const harlot = createPlayer(2n, 'H', ROLE_BIT.Harlot, 'Village');
    const ga = createPlayer(3n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    sk.choice = harlot.id;
    ga.choice = harlot.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    resolveSerialKillerNight([sk, harlot, ga], state, baseCtx([sk, harlot, ga]));

    expect(harlot.isDead).toBe(true);
  });

  it('redirects to a random target the night after stumbling into a dug grave, on a successful roll', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sk.stumbledGrave = 4; // stumbled on day 4
    const intended = createPlayer(2n, 'Intended', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(3n, 'Other', ROLE_BIT.Villager, 'Village');
    sk.choice = intended.id;

    // dayNumber must be stumbledGrave + 1 = 5 for the redirect check to even trigger. First roll (0) triggers
    // the redirect (0 < 50); second roll (0.99) picks the last of the two eligible targets ("other"), since
    // the original target is *not* excluded from the redirect pool and could in principle be re-picked.
    let call = 0;
    const random = () => (call++ === 0 ? 0 : 0.99);
    const events = resolveSerialKillerNight(
      [sk, intended, other],
      initialNightState(),
      baseCtx([sk, intended, other], 5, random),
    );

    expect(intended.isDead).toBe(false);
    expect(other.isDead).toBe(true);
    expect(events.some((e) => e.type === 'SerialKillerRandomKill')).toBe(true);
  });

  it('does not redirect on the wrong day or a failed roll', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sk.stumbledGrave = 4;
    const intended = createPlayer(2n, 'Intended', ROLE_BIT.Villager, 'Village');
    sk.choice = intended.id;

    // dayNumber 6 != stumbledGrave(4) + 1 -> no redirect regardless of roll.
    resolveSerialKillerNight([sk, intended], initialNightState(), baseCtx([sk, intended], 6, () => 0));
    expect(intended.isDead).toBe(true);
  });

  it('gives the Serial Killer an independent chance to spot and kill a Grave Digger', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 5;
    // sk.choice left unset - no main target, but the grave-digger-spotting check still runs.

    const events = resolveSerialKillerNight([sk, gd], initialNightState(), baseCtx([sk, gd], 1, () => 0));

    expect(gd.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Spotted' && e.playerId === gd.id)).toBe(
      true,
    );
  });
});

describe('resolveCultistHunterNight', () => {
  it('does nothing when there is no living, unfrozen Cultist Hunter', () => {
    expect(resolveCultistHunterNight([], baseCtx([]))).toEqual([]);
  });

  it('kills a hunted Cultist', () => {
    const hunter = createPlayer(1n, 'CH', ROLE_BIT.CultistHunter, 'Village');
    const cultist = createPlayer(2n, 'C', ROLE_BIT.Cultist, 'Cult');
    hunter.choice = cultist.id;

    const events = resolveCultistHunterNight([hunter, cultist], baseCtx([hunter, cultist]));

    expect(cultist.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Hunt' && e.playerId === cultist.id)).toBe(
      true,
    );
  });

  it('does nothing to a target who is not actually a Cultist', () => {
    const hunter = createPlayer(1n, 'CH', ROLE_BIT.CultistHunter, 'Village');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    hunter.choice = villager.id;

    resolveCultistHunterNight([hunter, villager], baseCtx([hunter, villager]));

    expect(villager.isDead).toBe(false);
  });
});
