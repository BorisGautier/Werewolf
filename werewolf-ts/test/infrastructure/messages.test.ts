import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { describeEvent } from '../../src/infrastructure/telegram/messages.js';

describe('describeEvent - PlayerDied flavor text', () => {
  it("builds the Harlot's found-the-wolves'-victim message with the found victim's name, not a role reveal", () => {
    const harlot = createPlayer(1n, 'Harlot', ROLE_BIT.Harlot, 'Village');
    const foundVictim = createPlayer(2n, 'Victim', ROLE_BIT.Villager, 'Village');
    harlot.killedByRole = ROLE_BIT.Wolf; // the found victim was killed by wolves

    const messages = describeEvent(
      { type: 'PlayerDied', playerId: 1n, method: 'VisitVictim', killerIds: [2n], isNight: true },
      [harlot, foundVictim],
      true,
    );

    expect(messages).toEqual([
      { audience: 'group', key: 'HarlotFuckedVictimPublic', args: ['Harlot', 'Victim'] },
    ]);
  });

  it("builds the Harlot's found-the-Serial-Killer's-victim message when the found victim died to the SK", () => {
    const harlot = createPlayer(1n, 'Harlot', ROLE_BIT.Harlot, 'Village');
    const foundVictim = createPlayer(2n, 'Victim', ROLE_BIT.Villager, 'Village');
    harlot.killedByRole = ROLE_BIT.SerialKiller;

    const messages = describeEvent(
      { type: 'PlayerDied', playerId: 1n, method: 'VisitVictim', killerIds: [2n], isNight: true },
      [harlot, foundVictim],
      true,
    );

    expect(messages).toEqual([
      { audience: 'group', key: 'HarlotFuckedKilledPublic', args: ['Harlot', 'Victim'] },
    ]);
  });

  it('picks the role-specific VisitKiller flavor for a Guardian Angel who died guarding the Serial Killer', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');

    const messages = describeEvent(
      { type: 'PlayerDied', playerId: 1n, method: 'VisitKiller', killerIds: [2n], isNight: true },
      [ga],
      true,
    );

    expect(messages).toEqual([{ audience: 'group', key: 'GAGuardedKiller', args: ['GA'] }]);
  });

  it('distinguishes the Serial Killer spotting a digging Grave Digger from the wolf pack spotting them', () => {
    const gdBySK = createPlayer(1n, 'GD1', ROLE_BIT.GraveDigger, 'Village');
    gdBySK.killedByRole = ROLE_BIT.SerialKiller;
    const gdByWolves = createPlayer(2n, 'GD2', ROLE_BIT.GraveDigger, 'Village');
    gdByWolves.killedByRole = ROLE_BIT.Wolf;

    const skMessages = describeEvent(
      { type: 'PlayerDied', playerId: 1n, method: 'Spotted', killerIds: [3n], isNight: true },
      [gdBySK],
      true,
    );
    const wolfMessages = describeEvent(
      { type: 'PlayerDied', playerId: 2n, method: 'Spotted', killerIds: [4n], isNight: true },
      [gdByWolves],
      true,
    );

    expect(skMessages).toEqual([{ audience: 'group', key: 'KillerSpottedDiggerPublic', args: ['GD1'] }]);
    expect(wolfMessages).toEqual([{ audience: 'group', key: 'WolvesSpottedDiggerPublic', args: ['GD2'] }]);
  });

  it('falls back to the generic reveal for a method/role combo with no dedicated flavor text', () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent(
      { type: 'PlayerDied', playerId: 1n, method: 'VisitKiller', killerIds: [2n], isNight: true },
      [villager],
      true,
    );

    expect(messages).toEqual([
      { audience: 'group', key: 'PlayerFoundDeadWithRole', args: ['V', '👱 Villager'] },
    ]);
  });
});

describe('describeEvent - Guardian Angel PMs', () => {
  it('tells both the GA and the target when a non-fire attack is blocked', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent({ type: 'GuardianAngelSaved', gaId: 1n, targetId: 2n }, [ga, target], true);

    expect(messages).toEqual([
      { audience: 1n, key: 'GuardSaved', args: ['T'] },
      { audience: 2n, key: 'GuardSavedYou', args: [] },
    ]);
  });

  it('picks the fire-specific pair for a fire save', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent(
      { type: 'GuardianAngelSavedTargetFromFire', gaId: 1n, targetId: 2n },
      [ga, target],
      true,
    );

    expect(messages).toEqual([
      { audience: 1n, key: 'GuardSavedFromFire', args: ['T'] },
      { audience: 2n, key: 'GuardSavedYouFromFire', args: [] },
    ]);
  });

  it("tells the Snow Wolf (not the GA) when a freeze is blocked", () => {
    const messages = describeEvent(
      { type: 'GuardianAngelBlockedFreeze', targetId: 2n, snowWolfId: 3n },
      [createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village')],
      true,
    );

    expect(messages).toEqual([{ audience: 3n, key: 'GuardBlockedSnowWolf', args: ['T'] }]);
  });

  it('picks GuardWolf/GuardKiller/GAFell for the GA dying while protecting, by the target role', () => {
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const sk = createPlayer(3n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const gd = createPlayer(4n, 'GD', ROLE_BIT.GraveDigger, 'Village');

    expect(describeEvent({ type: 'GuardianAngelDiedProtecting', gaId: 1n, targetId: 2n }, [wolf], true)).toEqual([
      { audience: 1n, key: 'GuardWolf', args: [] },
    ]);
    expect(describeEvent({ type: 'GuardianAngelDiedProtecting', gaId: 1n, targetId: 3n }, [sk], true)).toEqual([
      { audience: 1n, key: 'GuardKiller', args: [] },
    ]);
    expect(describeEvent({ type: 'GuardianAngelDiedProtecting', gaId: 1n, targetId: 4n }, [gd], true)).toEqual([
      { audience: 1n, key: 'GAFell', args: ['GD'] },
    ]);
  });

  it('the four attacker-side "blocked" flag events carry no message of their own (silent state-flagging)', () => {
    expect(describeEvent({ type: 'GuardianAngelBlockedWolfAttack', targetId: 2n }, [], true)).toEqual([]);
    expect(describeEvent({ type: 'GuardianAngelBlockedSerialKiller', targetId: 2n }, [], true)).toEqual([]);
    expect(describeEvent({ type: 'GuardianAngelSavedFromBurning', playerId: 2n }, [], true)).toEqual([]);
  });
});

describe('describeEvent - freeze flavor and Chemist PMs', () => {
  it("tells the frozen player their role-specific flavor and confirms the freeze to the Snow Wolf", () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Harlot, 'Village');
    const messages = describeEvent(
      { type: 'PlayerFrozen', playerId: 2n, cause: 'SnowWolf', snowWolfId: 1n, flavor: 'Harlot' },
      [target],
      true,
    );

    expect(messages).toEqual([
      { audience: 2n, key: 'HarlotFrozen', args: [] },
      { audience: 1n, key: 'SuccessfulFreeze', args: ['T'] },
    ]);
  });

  it('poisons: tells both the Chemist and the target on success', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent({ type: 'ChemistPoisoned', chemistId: 1n, targetId: 2n }, [chemist, target], true);

    expect(messages).toEqual([
      { audience: 1n, key: 'ChemistSuccess', args: ['T'] },
      { audience: 2n, key: 'ChemistVisitYouSuccess', args: [] },
    ]);
  });

  it('backfire: tells both the Chemist and the target, with the Chemist named for the target', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent({ type: 'ChemistBackfired', chemistId: 1n, targetId: 2n }, [chemist, target], true);

    expect(messages).toEqual([
      { audience: 1n, key: 'ChemistFail', args: ['T'] },
      { audience: 2n, key: 'ChemistVisitYouFail', args: ['Ch'] },
    ]);
  });

  it('died-visiting: picks the Grave Digger pair vs the Serial Killer pair by target role', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    const sk = createPlayer(3n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');

    expect(describeEvent({ type: 'ChemistDiedVisiting', chemistId: 1n, targetId: 2n }, [chemist, gd], true)).toEqual([
      { audience: 1n, key: 'ChemistFell', args: ['GD'] },
      { audience: 2n, key: 'ChemistFellDigger', args: ['Ch'] },
    ]);
    expect(describeEvent({ type: 'ChemistDiedVisiting', chemistId: 1n, targetId: 3n }, [chemist, sk], true)).toEqual([
      { audience: 1n, key: 'ChemistSK', args: ['SK'] },
      { audience: 3n, key: 'ChemistVisitYouSK', args: ['Ch'] },
    ]);
  });
});
