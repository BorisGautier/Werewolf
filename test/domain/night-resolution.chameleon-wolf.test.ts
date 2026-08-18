import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveChameleonWolfNight } from '../../src/domain/game/night-resolution.js';
import { resolveClairvoyanceNight } from '../../src/domain/game/clairvoyance.js';

describe('resolveChameleonWolfNight', () => {
  it('does nothing when the Chameleon Wolf is dead, frozen, targets itself, has no choice, or abstains', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    dead.isDead = true;
    dead.choice3 = target.id;
    expect(resolveChameleonWolfNight([dead, target])).toEqual([]);

    const frozen = createPlayer(1n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    frozen.frozen = true;
    frozen.choice3 = target.id;
    expect(resolveChameleonWolfNight([frozen, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    expect(resolveChameleonWolfNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    abstained.choice3 = ABSTAIN;
    expect(resolveChameleonWolfNight([abstained, target])).toEqual([]);

    const selfTargeting = createPlayer(1n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    selfTargeting.choice3 = selfTargeting.id;
    expect(resolveChameleonWolfNight([selfTargeting, target])).toEqual([]);
  });

  it('presents the chosen target\'s role, and is not gated by hasUsedAbility (repeatable every night)', () => {
    const chameleon = createPlayer(1n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    const seer = createPlayer(2n, 'S', ROLE_BIT.Seer, 'Village');
    chameleon.choice3 = seer.id;

    const events = resolveChameleonWolfNight([chameleon, seer]);

    expect(events).toEqual([
      { type: 'ChameleonDisguiseChosen', chameleonId: chameleon.id, appearanceRole: ROLE_BIT.Seer },
    ]);
    expect(chameleon.hasUsedAbility).toBe(false);

    // A second night, a second (different) choice - nothing stops them from picking again.
    const villager = createPlayer(3n, 'V', ROLE_BIT.Villager, 'Village');
    chameleon.choice3 = villager.id;
    const secondNightEvents = resolveChameleonWolfNight([chameleon, seer, villager]);

    expect(secondNightEvents).toEqual([
      {
        type: 'ChameleonDisguiseChosen',
        chameleonId: chameleon.id,
        appearanceRole: ROLE_BIT.Villager,
      },
    ]);
  });
});

describe('resolveClairvoyanceNight - Chameleon Wolf interaction', () => {
  it("shows the real Seer the Chameleon Wolf's borrowed role when a disguise is active tonight", () => {
    const seer = createPlayer(1n, 'S', ROLE_BIT.Seer, 'Village');
    const chameleon = createPlayer(2n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    seer.choice = chameleon.id;

    const chameleonAppearanceMap = new Map([[chameleon.id, ROLE_BIT.Villager]]);
    const events = resolveClairvoyanceNight(
      [seer, chameleon],
      [],
      () => 0.99, // avoid seerSees()'s random Traitor illusion branch
      new Map(),
      chameleonAppearanceMap,
    );

    const vision = events.find((e) => e.type === 'SeerVision');
    expect(vision).toMatchObject({ targetId: chameleon.id, shownRole: ROLE_BIT.Villager });
  });

  it('shows the true Chameleon Wolf role when no disguise is active tonight', () => {
    const seer = createPlayer(1n, 'S', ROLE_BIT.Seer, 'Village');
    const chameleon = createPlayer(2n, 'CW', ROLE_BIT.ChameleonWolf, 'Wolf');
    seer.choice = chameleon.id;

    const events = resolveClairvoyanceNight([seer, chameleon], [], () => 0.99, new Map(), new Map());

    const vision = events.find((e) => e.type === 'SeerVision');
    expect(vision).toMatchObject({ targetId: chameleon.id, shownRole: ROLE_BIT.ChameleonWolf });
  });
});
