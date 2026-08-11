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
