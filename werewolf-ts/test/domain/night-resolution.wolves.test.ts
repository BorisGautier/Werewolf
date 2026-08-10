import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { initialNightState, resolveWolfNight } from '../../src/domain/game/night-resolution.js';

function baseCtx(players: ReturnType<typeof createPlayer>[], random?: () => number) {
  return { players, dayNumber: 1, thiefFull: false, random };
}

describe('resolveWolfNight', () => {
  it('does nothing when there are no voting wolves (all dead or drunk)', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    wolf.isDead = true;
    expect(resolveWolfNight([wolf], initialNightState(), baseCtx([wolf]))).toEqual([]);
  });

  it('eats the plain-majority target', () => {
    const w1 = createPlayer(1n, 'W1', ROLE_BIT.Wolf, 'Wolf');
    const w2 = createPlayer(2n, 'W2', ROLE_BIT.Wolf, 'Wolf');
    const victim = createPlayer(3n, 'V', ROLE_BIT.Villager, 'Village');
    w1.choice = victim.id;
    w2.choice = victim.id;

    const events = resolveWolfNight([w1, w2, victim], initialNightState(), baseCtx([w1, w2, victim]));

    expect(victim.isDead).toBe(true);
    expect(victim.killedByRole).toBe(ROLE_BIT.Wolf);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Eat' && e.playerId === victim.id)).toBe(
      true,
    );
  });

  it('lets the Guardian Angel block a wolf attack', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const ga = createPlayer(3n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    wolf.choice = villager.id;
    ga.choice = villager.id;

    const state = initialNightState();
    state.guardianAngel = ga;
    const events = resolveWolfNight([wolf, villager, ga], state, baseCtx([wolf, villager, ga]));

    expect(villager.isDead).toBe(false);
    expect(villager.wasSavedLastNight).toBe(true);
    expect(events.some((e) => e.type === 'GuardianAngelBlockedWolfAttack')).toBe(true);
  });

  it('unconditionally turns a Cursed villager into a Wolf on a successful bite', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const cursed = createPlayer(2n, 'C', ROLE_BIT.Cursed, 'Village');
    wolf.choice = cursed.id;

    const events = resolveWolfNight([wolf, cursed], initialNightState(), baseCtx([wolf, cursed]));

    expect(cursed.role).toBe(ROLE_BIT.Wolf);
    expect(cursed.team).toBe('Wolf');
    expect(cursed.isDead).toBe(false);
    expect(events.some((e) => e.type === 'CursedTurnedWolf' && e.playerId === cursed.id)).toBe(true);
  });

  it('bites (does not kill) the target when an Alpha Wolf rolls a successful conversion', () => {
    const alpha = createPlayer(1n, 'Alpha', ROLE_BIT.AlphaWolf, 'Wolf');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    alpha.choice = villager.id;

    const events = resolveWolfNight([alpha, villager], initialNightState(), baseCtx([alpha, villager], () => 0)); // roll 0 < 20 -> bitten

    expect(villager.isDead).toBe(false);
    expect(villager.bitten).toBe(true);
    expect(events.some((e) => e.type === 'PlayerBitten' && e.playerId === villager.id)).toBe(true);
  });

  it('eats normally when the Alpha conversion roll fails', () => {
    const alpha = createPlayer(1n, 'Alpha', ROLE_BIT.AlphaWolf, 'Wolf');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    alpha.choice = villager.id;

    resolveWolfNight([alpha, villager], initialNightState(), baseCtx([alpha, villager], () => 0.99)); // roll 99, not < 20

    expect(villager.isDead).toBe(true);
    expect(villager.bitten).toBe(false);
  });

  it('kills the Drunk on a non-bitten attack and puts the whole acting pack to sleep, blocking a second kill', () => {
    const w1 = createPlayer(1n, 'W1', ROLE_BIT.Wolf, 'Wolf');
    const w2 = createPlayer(2n, 'W2', ROLE_BIT.Wolf, 'Wolf');
    const drunk = createPlayer(3n, 'D', ROLE_BIT.Drunk, 'Village');
    const secondVictim = createPlayer(4n, 'V2', ROLE_BIT.Villager, 'Village');
    // Both wolves target the Drunk as their first choice so it wins the vote outright,
    // and also set a (losing) second choice to prove it never gets resolved.
    w1.choice = drunk.id;
    w2.choice = drunk.id;
    w1.choice2 = secondVictim.id;
    w2.choice2 = secondVictim.id;

    const events = resolveWolfNight(
      [w1, w2, drunk, secondVictim],
      initialNightState(),
      baseCtx([w1, w2, drunk, secondVictim]),
    );

    expect(drunk.isDead).toBe(true);
    expect(w1.drunk).toBe(true);
    expect(w2.drunk).toBe(true);
    expect(secondVictim.isDead).toBe(false); // the pack fell asleep before it could act on choice2
    expect(events.some((e) => e.type === 'WolvesGotDrunk')).toBe(true);
  });

  it('lets a Wise Elder survive their first wolf attack, then die on the second', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const elder = createPlayer(2n, 'E', ROLE_BIT.WiseElder, 'Village');
    wolf.choice = elder.id;

    const firstEvents = resolveWolfNight([wolf, elder], initialNightState(), baseCtx([wolf, elder]));
    expect(elder.isDead).toBe(false);
    expect(elder.hasUsedAbility).toBe(true);
    expect(firstEvents.some((e) => e.type === 'WiseElderSurvivedFirstAttack')).toBe(true);

    wolf.choice = elder.id; // reset for a second night's vote
    resolveWolfNight([wolf, elder], initialNightState(), baseCtx([wolf, elder]));
    expect(elder.isDead).toBe(true);
  });

  it('lets a lone wolf attacker die to the Hunter counter-attack, without killing the Hunter', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const hunter = createPlayer(2n, 'H', ROLE_BIT.Hunter, 'Village');
    wolf.choice = hunter.id;

    // chance = 30 + (1 wolf - 1) * 20 = 30. roll 0 < 30 -> hunter fights back.
    const events = resolveWolfNight([wolf, hunter], initialNightState(), baseCtx([wolf, hunter], () => 0));

    expect(wolf.isDead).toBe(true);
    expect(hunter.isDead).toBe(false);
    expect(events.some((e) => e.type === 'HunterCounterAttack' && !e.hunterAlsoDied)).toBe(true);
  });

  it('kills both a wolf and the Hunter when the pack is bigger than one and the counter-attack succeeds', () => {
    const w1 = createPlayer(1n, 'W1', ROLE_BIT.Wolf, 'Wolf');
    const w2 = createPlayer(2n, 'W2', ROLE_BIT.Wolf, 'Wolf');
    const hunter = createPlayer(3n, 'H', ROLE_BIT.Hunter, 'Village');
    w1.choice = hunter.id;
    w2.choice = hunter.id;

    // chance = 30 + (2 - 1) * 20 = 50. roll 0 < 50 -> counter-attack succeeds.
    const events = resolveWolfNight([w1, w2, hunter], initialNightState(), baseCtx([w1, w2, hunter], () => 0));

    expect(hunter.isDead).toBe(true);
    expect(w1.isDead || w2.isDead).toBe(true);
    expect(events.some((e) => e.type === 'HunterCounterAttack' && e.hunterAlsoDied)).toBe(true);
  });

  it('eats the Hunter normally when the counter-attack roll fails', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const hunter = createPlayer(2n, 'H', ROLE_BIT.Hunter, 'Village');
    wolf.choice = hunter.id;

    // chance = 30. roll 99 -> fails -> falls back to a normal wolf-eat.
    const events = resolveWolfNight([wolf, hunter], initialNightState(), baseCtx([wolf, hunter], () => 0.99));

    expect(hunter.isDead).toBe(true);
    // The generic "final shot" mechanic is deliberately suppressed here (hunterFinalShot: false in the
    // original's default kill branch) - the counter-attack coin flip *is* the Hunter's chance to fight
    // back against wolves, so no separate pending shot gets queued on top of a failed one.
    expect(hunter.pendingHunterShot).toBeNull();
    expect(events.some((e) => e.type === 'HunterMustShoot')).toBe(false);
  });

  it('lets the pack spot and kill a Grave Digger who dug at least one grave, independent of the main target', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const gd = createPlayer(3n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 5; // high detection chance
    wolf.choice = villager.id;

    const events = resolveWolfNight(
      [wolf, villager, gd],
      initialNightState(),
      baseCtx([wolf, villager, gd], () => 0),
    );

    expect(villager.isDead).toBe(true); // main target still resolved normally
    expect(gd.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Spotted' && e.playerId === gd.id)).toBe(
      true,
    );
  });

  it("does not risk a Grave Digger who didn't dig", () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const gd = createPlayer(3n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    gd.dugGravesLastNight = 0;
    wolf.choice = villager.id;

    resolveWolfNight([wolf, villager, gd], initialNightState(), baseCtx([wolf, villager, gd], () => 0));

    expect(gd.isDead).toBe(false);
  });

  it('resolves a second victim from choice2 when the pack survives eating the first', () => {
    const w1 = createPlayer(1n, 'W1', ROLE_BIT.Wolf, 'Wolf');
    const w2 = createPlayer(2n, 'W2', ROLE_BIT.Wolf, 'Wolf');
    const v1 = createPlayer(3n, 'V1', ROLE_BIT.Villager, 'Village');
    const v2 = createPlayer(4n, 'V2', ROLE_BIT.Villager, 'Village');
    w1.choice = v1.id;
    w2.choice = v1.id;
    w1.choice2 = v2.id;
    w2.choice2 = v2.id;

    resolveWolfNight([w1, w2, v1, v2], initialNightState(), baseCtx([w1, w2, v1, v2]));

    expect(v1.isDead).toBe(true);
    expect(v2.isDead).toBe(true);
  });
});
