import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveMimicNight } from '../../src/domain/game/night-resolution.js';
import { resolveClairvoyanceNight } from '../../src/domain/game/clairvoyance.js';

describe('resolveMimicNight', () => {
  it('does nothing when the Mimic is dead, frozen, has already chosen, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'M', ROLE_BIT.Mimic, 'Village');
    dead.isDead = true;
    dead.choice = target.id;
    expect(resolveMimicNight([dead, target])).toEqual([]);

    const frozen = createPlayer(1n, 'M', ROLE_BIT.Mimic, 'Village');
    frozen.frozen = true;
    frozen.choice = target.id;
    expect(resolveMimicNight([frozen, target])).toEqual([]);

    const alreadyChose = createPlayer(1n, 'M', ROLE_BIT.Mimic, 'Village');
    alreadyChose.hasUsedAbility = true;
    alreadyChose.choice = target.id;
    expect(resolveMimicNight([alreadyChose, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'M', ROLE_BIT.Mimic, 'Village');
    expect(resolveMimicNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'M', ROLE_BIT.Mimic, 'Village');
    abstained.choice = ABSTAIN;
    expect(resolveMimicNight([abstained, target])).toEqual([]);
  });

  it('locks in the chosen disguise and consumes the one-time choice', () => {
    const mimic = createPlayer(1n, 'M', ROLE_BIT.Mimic, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Seer, 'Village');
    mimic.choice = target.id;

    const events = resolveMimicNight([mimic, target]);

    expect(mimic.hasUsedAbility).toBe(true);
    expect(events).toEqual([
      { type: 'MimicChoseDisguise', mimicId: mimic.id, targetId: target.id },
    ]);
  });

  it('ignores a second choice once the disguise is already locked in', () => {
    const mimic = createPlayer(1n, 'M', ROLE_BIT.Mimic, 'Village');
    const target1 = createPlayer(2n, 'T1', ROLE_BIT.Seer, 'Village');
    const target2 = createPlayer(3n, 'T2', ROLE_BIT.Wolf, 'Wolf');

    mimic.choice = target1.id;
    resolveMimicNight([mimic, target1, target2]);

    mimic.choice = target2.id;
    expect(resolveMimicNight([mimic, target1, target2])).toEqual([]);
  });
});

describe('resolveClairvoyanceNight - Mimic interaction', () => {
  it("shows the real Seer the Mimic's imitated role, not 'Mimic' itself", () => {
    const seer = createPlayer(1n, 'S', ROLE_BIT.Seer, 'Village');
    const mimic = createPlayer(2n, 'M', ROLE_BIT.Mimic, 'Village');
    const imitated = createPlayer(3n, 'I', ROLE_BIT.Wolf, 'Wolf');
    seer.choice = mimic.id;

    const mimicTargetMap = new Map([[mimic.id, imitated.id]]);
    const events = resolveClairvoyanceNight(
      [seer, mimic, imitated],
      [],
      () => 0.99, // avoid seerSees()'s random Traitor/WolfMan illusion branch
      mimicTargetMap,
    );

    const vision = events.find((e) => e.type === 'SeerVision');
    expect(vision).toMatchObject({ targetId: mimic.id, shownRole: ROLE_BIT.Wolf });
  });

  it("shows the Mimic's own role when nobody imitated has been locked in yet", () => {
    const seer = createPlayer(1n, 'S', ROLE_BIT.Seer, 'Village');
    const mimic = createPlayer(2n, 'M', ROLE_BIT.Mimic, 'Village');
    seer.choice = mimic.id;

    const events = resolveClairvoyanceNight([seer, mimic], [], () => 0.99, new Map());

    const vision = events.find((e) => e.type === 'SeerVision');
    expect(vision).toMatchObject({ targetId: mimic.id, shownRole: ROLE_BIT.Mimic });
  });
});
