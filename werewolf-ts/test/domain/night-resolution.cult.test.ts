import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { initialNightState, resolveCultNight } from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], dayNumber = 3, random?: () => number) {
  return { players, dayNumber, thiefFull: false, random };
}

describe('resolveCultNight', () => {
  it('does nothing without any acting (alive, unfrozen, chosen) cultist', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    cultist.frozen = true;
    expect(resolveCultNight([cultist], initialNightState(), baseCtx([cultist]))).toEqual([]);
  });

  it('converts a default-chance role (e.g. Villager) on a successful roll', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    cultist.choice = villager.id;

    const events = resolveCultNight([cultist, villager], initialNightState(), baseCtx([cultist, villager], 3, () => 0));

    expect(villager.role).toBe(ROLE_BIT.Cultist);
    expect(villager.team).toBe('Cult');
    expect(villager.dayCult).toBe(3);
    expect(events.some((e) => e.type === 'PlayerConvertedToCult' && e.playerId === villager.id)).toBe(true);
  });

  it('picks the most-voted target among several acting cultists', () => {
    const c1 = createPlayer(1n, 'C1', ROLE_BIT.Cultist, 'Cult');
    const c2 = createPlayer(2n, 'C2', ROLE_BIT.Cultist, 'Cult');
    const popular = createPlayer(3n, 'Popular', ROLE_BIT.Villager, 'Village');
    const unpopular = createPlayer(4n, 'Unpopular', ROLE_BIT.Villager, 'Village');
    c1.choice = popular.id;
    c2.choice = popular.id;

    resolveCultNight([c1, c2, popular, unpopular], initialNightState(), baseCtx([c1, c2, popular, unpopular], 3, () => 0));

    expect(popular.role).toBe(ROLE_BIT.Cultist);
    expect(unpopular.role).toBe(ROLE_BIT.Villager);
  });

  it('the most recently converted cultist (highest dayCult) is the one who visits, and who dies to a Cultist Hunter', () => {
    const founder = createPlayer(1n, 'Founder', ROLE_BIT.Cultist, 'Cult'); // dayCult 0
    const newest = createPlayer(2n, 'Newest', ROLE_BIT.Cultist, 'Cult');
    newest.dayCult = 2;
    const ch = createPlayer(3n, 'CH', ROLE_BIT.CultistHunter, 'Village');
    founder.choice = ch.id; // it doesn't matter which cultist casts the vote, only who visits (the newbie)

    resolveCultNight([founder, newest, ch], initialNightState(), baseCtx([founder, newest, ch]));

    // The Cultist Hunter kills whoever actually visited them - proves `newest`, not `founder`, was the visitor.
    expect(newest.isDead).toBe(true);
    expect(founder.isDead).toBe(false);
  });

  it('fails to convert on an unsuccessful roll, without changing the target', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const seer = createPlayer(2n, 'Seer', ROLE_BIT.Seer, 'Village'); // 40% chance
    cultist.choice = seer.id;

    resolveCultNight([cultist, seer], initialNightState(), baseCtx([cultist, seer], 3, () => 0.99));

    expect(seer.role).toBe(ROLE_BIT.Seer);
  });

  it('never converts a Doppelganger, Thief, or Spumpkin regardless of roll', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const doppel = createPlayer(2n, 'D', ROLE_BIT.Doppelganger, 'Thief');
    cultist.choice = doppel.id;

    resolveCultNight([cultist, doppel], initialNightState(), baseCtx([cultist, doppel], 3, () => 0));

    expect(doppel.role).toBe(ROLE_BIT.Doppelganger);
  });

  it('kills the newbie when the Cultist Hunter is the target', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const ch = createPlayer(2n, 'CH', ROLE_BIT.CultistHunter, 'Village');
    cultist.choice = ch.id;

    const events = resolveCultNight([cultist, ch], initialNightState(), baseCtx([cultist, ch]));

    expect(cultist.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Hunt' && e.playerId === cultist.id)).toBe(
      true,
    );
  });

  it('converts the Hunter on the conversion roll, before ever considering the kill-cult roll', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const hunter = createPlayer(2n, 'H', ROLE_BIT.Hunter, 'Village');
    cultist.choice = hunter.id;

    resolveCultNight([cultist, hunter], initialNightState(), baseCtx([cultist, hunter], 3, () => 0));

    expect(hunter.role).toBe(ROLE_BIT.Cultist);
    expect(cultist.isDead).toBe(false);
  });

  it('lets the Hunter kill the newbie when conversion fails but the kill-roll succeeds', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const hunter = createPlayer(2n, 'H', ROLE_BIT.Hunter, 'Village');
    cultist.choice = hunter.id;

    let call = 0;
    const random = () => (call++ === 0 ? 0.99 : 0); // conversion roll fails (99), kill roll succeeds (0)
    const events = resolveCultNight([cultist, hunter], initialNightState(), baseCtx([cultist, hunter], 3, random));

    expect(hunter.role).toBe(ROLE_BIT.Hunter);
    expect(cultist.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'HunterCult')).toBe(true);
  });

  it('kills the newbie visiting a wolf who stayed home, but not one who went out hunting', () => {
    const cultist1 = createPlayer(1n, 'C1', ROLE_BIT.Cultist, 'Cult');
    const wolf1 = createPlayer(2n, 'W1', ROLE_BIT.Wolf, 'Wolf');
    cultist1.choice = wolf1.id;

    const stayHomeState = initialNightState();
    stayHomeState.wolvesThatActed = [wolf1]; // present but with no valid choice -> "stayed home"
    const eventsStayedHome = resolveCultNight([cultist1, wolf1], stayHomeState, baseCtx([cultist1, wolf1]));
    expect(cultist1.isDead).toBe(true);
    expect(eventsStayedHome.some((e) => e.type === 'PlayerDied' && e.method === 'VisitWolf')).toBe(true);

    const cultist2 = createPlayer(3n, 'C2', ROLE_BIT.Cultist, 'Cult');
    const wolf2 = createPlayer(4n, 'W2', ROLE_BIT.Wolf, 'Wolf');
    cultist2.choice = wolf2.id;
    wolf2.choice = 999n; // the wolf actually went hunting

    const wentHuntingState = initialNightState();
    wentHuntingState.wolvesThatActed = [wolf2];
    resolveCultNight([cultist2, wolf2], wentHuntingState, baseCtx([cultist2, wolf2]));
    expect(cultist2.isDead).toBe(false);
  });

  it('kills the newbie visiting a Snow Wolf who stayed home (did not go freezing)', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const snowWolf = createPlayer(2n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    cultist.choice = snowWolf.id;
    // snowWolf.choice left unset -> stayed home

    const events = resolveCultNight([cultist, snowWolf], initialNightState(), baseCtx([cultist, snowWolf]));

    expect(cultist.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'VisitWolf')).toBe(true);
  });

  it('spares the newbie visiting a Snow Wolf who went out freezing someone', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const snowWolf = createPlayer(2n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    cultist.choice = snowWolf.id;
    snowWolf.choice = 999n;

    resolveCultNight([cultist, snowWolf], initialNightState(), baseCtx([cultist, snowWolf]));

    expect(cultist.isDead).toBe(false);
  });

  it('always fails to convert an Arsonist who is out actively dousing/sparking (no attempt at all)', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const arsonist = createPlayer(2n, 'A', ROLE_BIT.Arsonist, 'Arsonist');
    arsonist.choice = 999n; // actively out
    cultist.choice = arsonist.id;

    const events = resolveCultNight([cultist, arsonist], initialNightState(), baseCtx([cultist, arsonist], 3, () => 0));

    expect(arsonist.role).toBe(ROLE_BIT.Arsonist);
    expect(events.some((e) => e.type === 'CultConversionFailed' || e.type === 'PlayerConvertedToCult')).toBe(false);
  });

  it('attempts (and always fails) to convert an Arsonist who stayed home or is frozen', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const arsonist = createPlayer(2n, 'A', ROLE_BIT.Arsonist, 'Arsonist');
    arsonist.choice = ABSTAIN;
    cultist.choice = arsonist.id;

    const events = resolveCultNight([cultist, arsonist], initialNightState(), baseCtx([cultist, arsonist], 3, () => 0));

    expect(arsonist.role).toBe(ROLE_BIT.Arsonist); // 0% chance - never actually converts
    expect(events.some((e) => e.type === 'CultConversionFailed')).toBe(true);
  });
});
