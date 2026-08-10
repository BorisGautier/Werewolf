import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { SPARK, createPlayer } from '../../src/domain/game/player.js';
import { initialNightState, resolveArsonistNight } from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], random?: () => number) {
  return { players, dayNumber: 1, thiefFull: false, random };
}

describe('resolveArsonistNight', () => {
  it('does nothing when there is no living Arsonist', () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');
    expect(resolveArsonistNight([villager], initialNightState(), baseCtx([villager]))).toEqual([]);
  });

  it('douses the chosen target on a successful visit', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    arsonist.choice = target.id;

    const events = resolveArsonistNight([arsonist, target], initialNightState(), baseCtx([arsonist, target]));

    expect(target.doused).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDoused' && e.playerId === target.id)).toBe(true);
  });

  it('douses a Harlot even when she is out for the night (the Arsonist ignores "not home")', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    const harlot = createPlayer(2n, 'H', ROLE_BIT.Harlot, 'Village');
    harlot.choice = 99n; // out visiting someone else
    arsonist.choice = harlot.id;

    resolveArsonistNight([arsonist, harlot], initialNightState(), baseCtx([arsonist, harlot]));

    expect(harlot.doused).toBe(true);
  });

  it('cannot douse an already-dead target (visit fails as AlreadyDead)', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    const deadVillager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    deadVillager.isDead = true;
    arsonist.choice = deadVillager.id;

    resolveArsonistNight([arsonist, deadVillager], initialNightState(), baseCtx([arsonist, deadVillager]));

    expect(deadVillager.doused).toBe(false);
  });

  it('acts even while frozen ("fire beats ice")', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    arsonist.frozen = true;
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    arsonist.choice = target.id;

    resolveArsonistNight([arsonist, target], initialNightState(), baseCtx([arsonist, target]));

    expect(target.doused).toBe(true);
  });

  it('sparks: burns every doused player (except itself) and marks them as burning', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    arsonist.choice = SPARK;
    const v1 = createPlayer(2n, 'V1', ROLE_BIT.Villager, 'Village');
    v1.doused = true;
    const v2 = createPlayer(3n, 'V2', ROLE_BIT.Villager, 'Village');
    v2.doused = true;
    const notDoused = createPlayer(4n, 'V3', ROLE_BIT.Villager, 'Village');

    const events = resolveArsonistNight(
      [arsonist, v1, v2, notDoused],
      initialNightState(),
      baseCtx([arsonist, v1, v2, notDoused]),
    );

    expect(v1.isDead).toBe(true);
    expect(v1.burning).toBe(true);
    expect(v1.doused).toBe(false);
    expect(v2.isDead).toBe(true);
    expect(v2.burning).toBe(true);
    expect(notDoused.isDead).toBe(false);
    expect(events.filter((e) => e.type === 'PlayerDied' && e.method === 'Burn')).toHaveLength(2);
  });

  it('lets the Guardian Angel save one doused player from a spark, without stopping the others from burning', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    arsonist.choice = SPARK;
    const saved = createPlayer(2n, 'Saved', ROLE_BIT.Villager, 'Village');
    saved.doused = true;
    const burned = createPlayer(3n, 'Burned', ROLE_BIT.Villager, 'Village');
    burned.doused = true;
    const ga = createPlayer(4n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    ga.choice = saved.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveArsonistNight(
      [arsonist, saved, burned, ga],
      state,
      baseCtx([arsonist, saved, burned, ga]),
    );

    expect(saved.isDead).toBe(false);
    expect(saved.wasSavedLastNight).toBe(true);
    expect(saved.doused).toBe(true); // GA saved them from burning tonight, they're still doused
    expect(burned.isDead).toBe(true);
    expect(events.some((e) => e.type === 'GuardianAngelSavedFromBurning' && e.playerId === saved.id)).toBe(true);
  });

  it('does not kill the lover of a burning victim who is burning simultaneously', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Arsonist');
    arsonist.choice = SPARK;
    const a = createPlayer(2n, 'A', ROLE_BIT.Villager, 'Village');
    a.doused = true;
    a.inLove = true;
    a.loverId = 3n;
    const b = createPlayer(3n, 'B', ROLE_BIT.Villager, 'Village');
    b.doused = true;
    b.inLove = true;
    b.loverId = 2n;

    resolveArsonistNight([arsonist, a, b], initialNightState(), baseCtx([arsonist, a, b]));

    expect(a.isDead).toBe(true);
    expect(b.isDead).toBe(true);
    // Both died from the fire itself, not from a "lover died of grief" chain reaction on top.
    expect(a.killedByRole).toBe(ROLE_BIT.Arsonist);
    expect(b.killedByRole).toBe(ROLE_BIT.Arsonist);
  });
});
