import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import {
  findActingGuardianAngel,
  initialNightState,
  resolveSnowWolfNight,
} from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], random?: () => number) {
  return { players, dayNumber: 1, thiefFull: false, ...(random !== undefined ? { random } : {}) };
}

describe('resolveSnowWolfNight', () => {
  it('does nothing when the Snow Wolf is dead, absent, or has not chosen', () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');
    const events = resolveSnowWolfNight([villager], initialNightState(), baseCtx([villager]));
    expect(events).toEqual([]);
  });

  it('does nothing when the Blacksmith spread silver tonight, even with a valid choice pending', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    sw.choice = target.id;

    const state = initialNightState();
    state.silverSpread = true;
    const events = resolveSnowWolfNight([sw, target], state, baseCtx([sw, target]));

    expect(events).toEqual([]);
    expect(target.frozen).toBe(false);
  });

  it('freezes the Serial Killer instead of killing them, on a successful visit', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const sk = createPlayer(2n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sw.choice = sk.id;
    sk.choice = 99n; // SK must have picked their own target for the visit to be able to succeed

    const events = resolveSnowWolfNight(
      [sw, sk],
      initialNightState(),
      baseCtx([sw, sk], () => 0.99),
    );

    expect(sk.frozen).toBe(true);
    expect(sk.isDead).toBe(false);
    expect(sw.isDead).toBe(false);
    expect(
      events.some(
        (e) =>
          e.type === 'PlayerFrozen' &&
          e.playerId === sk.id &&
          e.snowWolfId === sw.id &&
          e.flavor === 'SerialKiller',
      ),
    ).toBe(true);
  });

  it('kills the Snow Wolf visiting a Serial Killer who has not committed to a target', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const sk = createPlayer(2n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sw.choice = sk.id; // sk.choice left unset (null)

    const events = resolveSnowWolfNight([sw, sk], initialNightState(), baseCtx([sw, sk]));

    expect(sw.isDead).toBe(true);
    expect(sk.frozen).toBe(false);
    expect(
      events.some(
        (e) => e.type === 'PlayerDied' && e.playerId === sw.id && e.method === 'VisitKiller',
      ),
    ).toBe(true);
  });

  it("lets the Guardian Angel block the freeze when protecting the Snow Wolf's target", () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const ga = createPlayer(3n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    sw.choice = villager.id;
    ga.choice = villager.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveSnowWolfNight([sw, villager, ga], state, baseCtx([sw, villager, ga]));

    expect(villager.frozen).toBe(false);
    expect(villager.wasSavedLastNight).toBe(true);
    expect(events.some((e) => e.type === 'GuardianAngelBlockedFreeze')).toBe(true);
  });

  it('50/50s a Hunter target between freezing them and the Hunter shooting the Snow Wolf', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const hunter = createPlayer(2n, 'H', ROLE_BIT.Hunter, 'Village');
    sw.choice = hunter.id;

    const frozen = resolveSnowWolfNight(
      [sw, hunter],
      initialNightState(),
      baseCtx([sw, hunter], () => 0),
    );
    expect(hunter.frozen).toBe(true);
    expect(sw.isDead).toBe(false);
    expect(frozen.some((e) => e.type === 'PlayerFrozen' && e.playerId === hunter.id)).toBe(true);

    const sw2 = createPlayer(3n, 'SW2', ROLE_BIT.SnowWolf, 'Wolf');
    const hunter2 = createPlayer(4n, 'H2', ROLE_BIT.Hunter, 'Village');
    sw2.choice = hunter2.id;
    const shot = resolveSnowWolfNight(
      [sw2, hunter2],
      initialNightState(),
      baseCtx([sw2, hunter2], () => 0.99),
    );
    expect(hunter2.frozen).toBe(false);
    expect(sw2.isDead).toBe(true);
    expect(
      shot.some(
        (e) => e.type === 'PlayerDied' && e.playerId === sw2.id && e.method === 'HunterShot',
      ),
    ).toBe(true);
  });

  it('freezes any other role by default, and nulls out the shared Guardian Angel state if the GA itself is frozen', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const ga = createPlayer(2n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const otherTarget = createPlayer(3n, 'Other', ROLE_BIT.Villager, 'Village');
    ga.choice = otherTarget.id; // GA is protecting someone else, not itself
    sw.choice = ga.id; // Snow Wolf targets the GA directly

    const state = initialNightState();
    state.guardianAngel = ga;
    resolveSnowWolfNight([sw, ga, otherTarget], state, baseCtx([sw, ga, otherTarget]));

    expect(ga.frozen).toBe(true);
    expect(state.guardianAngel).toBeNull();
  });

  it('undoes a Grave Digger dig when freezing them, rewinding lastGraveDigAt', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 2;
    sw.choice = gd.id;

    const state = initialNightState();
    const previousDig = new Date('2024-01-01T00:00:00Z');
    state.lastGraveDigAt = new Date('2024-01-02T00:00:00Z');
    state.secondLastGraveDigAt = previousDig;

    const events = resolveSnowWolfNight([sw, gd], state, baseCtx([sw, gd]));

    expect(gd.frozen).toBe(true);
    expect(gd.dugGravesLastNight).toBe(0);
    expect(state.lastGraveDigAt).toBe(previousDig);
    expect(events.some((e) => e.type === 'PlayerFrozen' && e.flavor === 'GraveDiggerDug')).toBe(
      true,
    );
  });

  it("does not touch grave-digging state when freezing a Grave Digger who didn't dig", () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 0;
    sw.choice = gd.id;

    const state = initialNightState();
    const lastDig = new Date('2024-01-02T00:00:00Z');
    state.lastGraveDigAt = lastDig;

    const events = resolveSnowWolfNight([sw, gd], state, baseCtx([sw, gd]));

    expect(gd.frozen).toBe(true);
    expect(state.lastGraveDigAt).toBe(lastDig);
    expect(events.some((e) => e.type === 'PlayerFrozen' && e.flavor === 'Default')).toBe(true);
  });

  it('picks the Thief-specific flavor only in a ThiefFull game, otherwise the default flavor', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const thief = createPlayer(2n, 'T', ROLE_BIT.Thief, 'Thief');
    sw.choice = thief.id;

    const notFull = resolveSnowWolfNight([sw, thief], initialNightState(), {
      players: [sw, thief],
      dayNumber: 1,
      thiefFull: false,
    });
    expect(notFull.some((e) => e.type === 'PlayerFrozen' && e.flavor === 'Default')).toBe(true);

    const sw2 = createPlayer(3n, 'SW2', ROLE_BIT.SnowWolf, 'Wolf');
    const thief2 = createPlayer(4n, 'T2', ROLE_BIT.Thief, 'Thief');
    sw2.choice = thief2.id;
    const full = resolveSnowWolfNight([sw2, thief2], initialNightState(), {
      players: [sw2, thief2],
      dayNumber: 1,
      thiefFull: true,
    });
    expect(full.some((e) => e.type === 'PlayerFrozen' && e.flavor === 'Thief')).toBe(true);
  });

  it('picks the Harlot/Chemist/Cultist/CultistHunter/Seeing/Arsonist flavors by role', () => {
    const cases: [
      ReturnType<typeof createPlayer>,
      'Harlot' | 'Chemist' | 'Cultist' | 'CultistHunter' | 'Seeing' | 'Arsonist',
    ][] = [
      [createPlayer(1n, 'Ha', ROLE_BIT.Harlot, 'Village'), 'Harlot'],
      [createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village'), 'Chemist'],
      [createPlayer(1n, 'Cu', ROLE_BIT.Cultist, 'Cult'), 'Cultist'],
      [createPlayer(1n, 'CH', ROLE_BIT.CultistHunter, 'Village'), 'CultistHunter'],
      [createPlayer(1n, 'Se', ROLE_BIT.Seer, 'Village'), 'Seeing'],
      [createPlayer(1n, 'Ar', ROLE_BIT.Arsonist, 'Arsonist'), 'Arsonist'],
    ];
    for (const [target, expectedFlavor] of cases) {
      const sw = createPlayer(99n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
      sw.choice = target.id;
      const events = resolveSnowWolfNight([sw, target], initialNightState(), baseCtx([sw, target]));
      expect(events.some((e) => e.type === 'PlayerFrozen' && e.flavor === expectedFlavor)).toBe(
        true,
      );
    }
  });

  it('picks the GuardianAngel flavor and still nulls out the shared GA state when freezing the GA itself', () => {
    const sw = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const ga = createPlayer(2n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    ga.choice = 3n;
    sw.choice = ga.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveSnowWolfNight([sw, ga], state, baseCtx([sw, ga]));

    expect(events.some((e) => e.type === 'PlayerFrozen' && e.flavor === 'GuardianAngel')).toBe(
      true,
    );
    expect(state.guardianAngel).toBeNull();
  });
});

describe('findActingGuardianAngel', () => {
  it('finds the alive Guardian Angel who made a real choice', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    ga.choice = 5n;
    expect(findActingGuardianAngel([ga])?.id).toBe(1n);
  });

  it('ignores a dead Guardian Angel or one who has not chosen / abstained', () => {
    const dead = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    dead.isDead = true;
    dead.choice = 5n;
    expect(findActingGuardianAngel([dead])).toBeNull();

    const unset = createPlayer(2n, 'GA2', ROLE_BIT.GuardianAngel, 'Village');
    expect(findActingGuardianAngel([unset])).toBeNull();

    const abstained = createPlayer(3n, 'GA3', ROLE_BIT.GuardianAngel, 'Village');
    abstained.choice = ABSTAIN;
    expect(findActingGuardianAngel([abstained])).toBeNull();
  });
});
