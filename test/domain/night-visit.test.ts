import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { visitPlayer } from '../../src/domain/game/night-visit.js';

function ctx(
  players: ReturnType<typeof createPlayer>[],
  overrides: Partial<{ thiefFull: boolean; dayNumber: number; random: () => number }> = {},
) {
  return {
    players,
    dayNumber: overrides.dayNumber ?? 1,
    thiefFull: overrides.thiefFull ?? false,
    ...(overrides.random !== undefined ? { random: overrides.random } : {}),
  };
}

describe('visitPlayer', () => {
  it('returns TargetNull when there is no target', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const { result } = visitPlayer(ctx([wolf]), wolf, undefined);
    expect(result).toBe('TargetNull');
  });

  it('returns AlreadyDead for a dead, non-burning target (Thief excepted when ThiefFull is off)', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    victim.isDead = true;
    const { result } = visitPlayer(ctx([wolf, victim]), wolf, victim);
    expect(result).toBe('AlreadyDead');
  });

  it('a Serial Killer never misses (except visiting a Grave Digger)', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const victim = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const { result } = visitPlayer(ctx([sk, victim]), sk, victim);
    expect(result).toBe('Success');
  });

  it('kills anyone but the Serial Killer who visits a burning player', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const burning = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    burning.burning = true;
    const arsonist = createPlayer(3n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    const { result, events } = visitPlayer(ctx([wolf, burning, arsonist]), wolf, burning);
    expect(result).toBe('VisitorDied');
    expect(wolf.isDead).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'PlayerDied' && e.method === 'VisitBurning' && e.killerIds.includes(3n),
      ),
    ).toBe(true);
  });

  it('kills a wolf-team visitor of the Serial Killer 80% of the time (guarded roll)', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const sk = createPlayer(2n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sk.choice = 1n; // SK chose a target -> wolf can survive on a good roll

    const survived = visitPlayer(ctx([wolf, sk], { random: () => 0.99 }), wolf, sk); // roll = 99, not < 80
    expect(survived.result).toBe('Success');
    expect(wolf.isDead).toBe(false);

    const died = visitPlayer(ctx([wolf, sk], { random: () => 0 }), wolf, sk); // roll = 0 < 80
    expect(died.result).toBe('VisitorDied');
    expect(wolf.isDead).toBe(true);
  });

  it('always kills a non-wolf visitor of the Serial Killer', () => {
    const seer = createPlayer(1n, 'Seer', ROLE_BIT.Seer, 'Village');
    const sk = createPlayer(2n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sk.choice = 1n;

    const { result } = visitPlayer(ctx([seer, sk], { random: () => 0.99 }), seer, sk);
    expect(result).toBe('VisitorDied');
  });

  it('kills the Harlot who visits a wolf', () => {
    const harlot = createPlayer(1n, 'Harlot', ROLE_BIT.Harlot, 'Village');
    const wolf = createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const { result } = visitPlayer(ctx([harlot, wolf]), harlot, wolf);
    expect(result).toBe('VisitorDied');
    expect(harlot.killedByRole).toBe(ROLE_BIT.Wolf);
  });

  it('never kills the Guardian Angel visiting a wolf that was already saved that night', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const wolf = createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    wolf.wasSavedLastNight = true;
    const { result } = visitPlayer(ctx([ga, wolf], { random: () => 0 }), ga, wolf);
    expect(result).toBe('Success');
    expect(ga.isDead).toBe(false);
  });

  it('50/50s the Guardian Angel visiting an unsaved wolf', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const wolf = createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    expect(visitPlayer(ctx([ga, wolf], { random: () => 0 }), ga, wolf).result).toBe('VisitorDied');
    ga.isDead = false; // reset for the second roll
    expect(visitPlayer(ctx([ga, wolf], { random: () => 0.99 }), ga, wolf).result).toBe('Success');
  });

  it('never lets a Grave Digger who did not dig be found "not home"', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    const { result } = visitPlayer(ctx([wolf, gd]), wolf, gd);
    expect(result).toBe('Success');
  });

  it('has the Serial Killer stumble (not fall) into a dug grave and remember the day', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 2;
    const { result } = visitPlayer(ctx([sk, gd], { dayNumber: 5 }), sk, gd);
    expect(result).toBe('Success');
    expect(sk.stumbledGrave).toBe(5);
    expect(sk.isDead).toBe(false);
  });

  it('can kill a non-Arsonist visitor who falls into a dug grave', () => {
    const cultist = createPlayer(1n, 'Cultist', ROLE_BIT.Cultist, 'Cult');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 5; // high fall chance
    const { result } = visitPlayer(ctx([cultist, gd], { random: () => 0 }), cultist, gd);
    expect(result).toBe('VisitorDied');
    expect(cultist.isDead).toBe(true);
  });

  it('can still make the Arsonist fall to their death on a bad roll, just like anyone else', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 5;
    const { result } = visitPlayer(ctx([arsonist, gd], { random: () => 0 }), arsonist, gd);
    expect(result).toBe('VisitorDied');
    expect(arsonist.isDead).toBe(true);
  });

  it('exempts the Arsonist (only) from "Fail" when they avoid the grave trap', () => {
    const gd = createPlayer(1n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 5;
    const arsonist = createPlayer(2n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    const cultist = createPlayer(3n, 'Cultist', ROLE_BIT.Cultist, 'Cult');

    // High roll -> nobody falls in.
    const arsonistOutcome = visitPlayer(ctx([arsonist, gd], { random: () => 0.99 }), arsonist, gd);
    const cultistOutcome = visitPlayer(ctx([cultist, gd], { random: () => 0.99 }), cultist, gd);

    expect(arsonistOutcome.result).toBe('Success');
    expect(cultistOutcome.result).toBe('Fail');
    expect(arsonist.isDead).toBe(false);
    expect(cultist.isDead).toBe(false);
  });

  it('fails a visit to a Harlot/Guardian Angel who is out for the night, unless frozen', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const harlot = createPlayer(2n, 'Harlot', ROLE_BIT.Harlot, 'Village');
    harlot.choice = 3n; // went visiting someone

    expect(visitPlayer(ctx([wolf, harlot]), wolf, harlot).result).toBe('Fail');

    harlot.frozen = true;
    expect(visitPlayer(ctx([wolf, harlot]), wolf, harlot).result).toBe('Success');
  });

  it('treats an abstaining Harlot/Guardian Angel as home (visit succeeds)', () => {
    const wolf = createPlayer(1n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const harlot = createPlayer(2n, 'Harlot', ROLE_BIT.Harlot, 'Village');
    harlot.choice = ABSTAIN;
    expect(visitPlayer(ctx([wolf, harlot]), wolf, harlot).result).toBe('Success');
  });
});
