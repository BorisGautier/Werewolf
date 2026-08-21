import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { describeEvent } from '../../src/infrastructure/telegram/messages.js';

/** Matches `mentionHtml()`'s output - every non-bot player name in a message is now a real
 * Telegram text-mention, not plain text (see `src/infrastructure/telegram/mention.ts`). */
function mention(id: bigint, name: string): string {
  return `<a href="tg://user?id=${id}">${name}</a>`;
}

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
      {
        audience: 'group',
        key: 'HarlotFuckedVictimPublic',
        args: [mention(1n, 'Harlot'), mention(2n, 'Victim')],
      },
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
      {
        audience: 'group',
        key: 'HarlotFuckedKilledPublic',
        args: [mention(1n, 'Harlot'), mention(2n, 'Victim')],
      },
    ]);
  });

  it('picks the role-specific VisitKiller flavor for a Guardian Angel who died guarding the Serial Killer', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');

    const messages = describeEvent(
      { type: 'PlayerDied', playerId: 1n, method: 'VisitKiller', killerIds: [2n], isNight: true },
      [ga],
      true,
    );

    expect(messages).toEqual([
      { audience: 'group', key: 'GAGuardedKiller', args: [mention(1n, 'GA')] },
    ]);
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

    expect(skMessages).toEqual([
      { audience: 'group', key: 'KillerSpottedDiggerPublic', args: [mention(1n, 'GD1')] },
    ]);
    expect(wolfMessages).toEqual([
      { audience: 'group', key: 'WolvesSpottedDiggerPublic', args: [mention(2n, 'GD2')] },
    ]);
  });

  it('always outs the shooter (name + role) on a Shoot kill, even with roles hidden on death', () => {
    const gunner = createPlayer(1n, 'Gunner', ROLE_BIT.Gunner, 'Village');
    const victim = createPlayer(2n, 'Victim', ROLE_BIT.Villager, 'Village');

    const hidden = describeEvent(
      { type: 'PlayerDied', playerId: 2n, method: 'Shoot', killerIds: [1n], isNight: false },
      [gunner, victim],
      false,
    );
    expect(hidden).toEqual([
      {
        audience: 'group',
        key: 'PlayerShotPublic',
        args: [mention(1n, 'Gunner'), '🔫 Gunner', mention(2n, 'Victim')],
      },
    ]);

    const shown = describeEvent(
      { type: 'PlayerDied', playerId: 2n, method: 'Shoot', killerIds: [1n], isNight: false },
      [gunner, victim],
      true,
    );
    expect(shown).toEqual([
      {
        audience: 'group',
        key: 'PlayerShotPublicWithRole',
        args: [mention(1n, 'Gunner'), '🔫 Gunner', mention(2n, 'Victim'), '👱 Villager'],
      },
    ]);
  });

  it('works for any Shoot-capable role, not just the Gunner (e.g. the Archangel)', () => {
    const archangel = createPlayer(1n, 'Angel', ROLE_BIT.Archangel, 'Village');
    const wolf = createPlayer(2n, 'Wolfy', ROLE_BIT.Wolf, 'Wolf');

    const messages = describeEvent(
      { type: 'PlayerDied', playerId: 2n, method: 'Shoot', killerIds: [1n], isNight: false },
      [archangel, wolf],
      false,
    );

    expect(messages).toEqual([
      {
        audience: 'group',
        key: 'PlayerShotPublic',
        args: [mention(1n, 'Angel'), '👼⚡️ Archangel', mention(2n, 'Wolfy')],
      },
    ]);
  });

  it('gives a HunterShot death dramatic flavor text instead of the passive "found dead" fallback', () => {
    const victim = createPlayer(2n, 'Victim', ROLE_BIT.Wolf, 'Wolf');

    const hidden = describeEvent(
      { type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: true },
      [victim],
      false,
    );
    expect(hidden).toEqual([
      { audience: 'group', key: 'HunterShotDeathPublic', args: [mention(2n, 'Victim')] },
    ]);

    const shown = describeEvent(
      { type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: true },
      [victim],
      true,
    );
    expect(shown).toEqual([
      {
        audience: 'group',
        key: 'HunterShotDeathPublicWithRole',
        args: [mention(2n, 'Victim'), '🐺 Wolf'],
      },
    ]);
  });

  it('falls back to the generic reveal for a method/role combo with no dedicated flavor text', () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent(
      { type: 'PlayerDied', playerId: 1n, method: 'VisitKiller', killerIds: [2n], isNight: true },
      [villager],
      true,
    );

    expect(messages).toEqual([
      {
        audience: 'group',
        key: 'PlayerFoundDeadWithRole',
        args: [mention(1n, 'V'), '👱 Villager'],
      },
    ]);
  });
});

describe('describeEvent - Guardian Angel PMs', () => {
  it('tells both the GA and the target when a non-fire attack is blocked', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent(
      { type: 'GuardianAngelSaved', gaId: 1n, targetId: 2n },
      [ga, target],
      true,
    );

    expect(messages).toEqual([
      { audience: 1n, key: 'GuardSaved', args: [mention(2n, 'T')] },
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
      { audience: 1n, key: 'GuardSavedFromFire', args: [mention(2n, 'T')] },
      { audience: 2n, key: 'GuardSavedYouFromFire', args: [] },
    ]);
  });

  it('tells the Snow Wolf (not the GA) when a freeze is blocked', () => {
    const messages = describeEvent(
      { type: 'GuardianAngelBlockedFreeze', targetId: 2n, snowWolfId: 3n },
      [createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village')],
      true,
    );

    expect(messages).toEqual([
      { audience: 3n, key: 'GuardBlockedSnowWolf', args: [mention(2n, 'T')] },
    ]);
  });

  it('picks GuardWolf/GuardKiller/GAFell for the GA dying while protecting, by the target role', () => {
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const sk = createPlayer(3n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const gd = createPlayer(4n, 'GD', ROLE_BIT.GraveDigger, 'Village');

    expect(
      describeEvent({ type: 'GuardianAngelDiedProtecting', gaId: 1n, targetId: 2n }, [wolf], true),
    ).toEqual([{ audience: 1n, key: 'GuardWolf', args: [] }]);
    expect(
      describeEvent({ type: 'GuardianAngelDiedProtecting', gaId: 1n, targetId: 3n }, [sk], true),
    ).toEqual([{ audience: 1n, key: 'GuardKiller', args: [] }]);
    expect(
      describeEvent({ type: 'GuardianAngelDiedProtecting', gaId: 1n, targetId: 4n }, [gd], true),
    ).toEqual([{ audience: 1n, key: 'GAFell', args: [mention(4n, 'GD')] }]);
  });

  it('tells each blocked attacker privately that their target was saved by a Guardian Angel', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    expect(
      describeEvent(
        { type: 'GuardianAngelBlockedWolfAttack', targetId: 2n, wolfIds: [10n, 11n] },
        [target],
        true,
      ),
    ).toEqual([
      { audience: 10n, key: 'WolfAttackBlockedByGuardian', args: [mention(2n, 'T')] },
      { audience: 11n, key: 'WolfAttackBlockedByGuardian', args: [mention(2n, 'T')] },
    ]);
    expect(
      describeEvent(
        { type: 'GuardianAngelBlockedSerialKiller', targetId: 2n, serialKillerId: 20n },
        [target],
        true,
      ),
    ).toEqual([{ audience: 20n, key: 'SerialKillerBlockedByGuardian', args: [mention(2n, 'T')] }]);
    expect(
      describeEvent(
        { type: 'GuardianAngelSavedFromBurning', playerId: 2n, arsonistId: 30n },
        [target],
        true,
      ),
    ).toEqual([{ audience: 30n, key: 'ArsonistTargetSavedByGuardian', args: [mention(2n, 'T')] }]);
  });
});

describe('describeEvent - freeze flavor and Chemist PMs', () => {
  it('tells the frozen player their role-specific flavor and confirms the freeze to the Snow Wolf', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Harlot, 'Village');
    const messages = describeEvent(
      { type: 'PlayerFrozen', playerId: 2n, cause: 'SnowWolf', snowWolfId: 1n, flavor: 'Harlot' },
      [target],
      true,
    );

    expect(messages).toEqual([
      { audience: 2n, key: 'HarlotFrozen', args: [] },
      { audience: 1n, key: 'SuccessfulFreeze', args: [mention(2n, 'T')] },
    ]);
  });

  it('poisons: tells both the Chemist and the target on success', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent(
      { type: 'ChemistPoisoned', chemistId: 1n, targetId: 2n },
      [chemist, target],
      true,
    );

    expect(messages).toEqual([
      { audience: 1n, key: 'ChemistSuccess', args: [mention(2n, 'T')] },
      { audience: 2n, key: 'ChemistVisitYouSuccess', args: [] },
    ]);
  });

  it('backfire: tells both the Chemist and the target, with the Chemist named for the target', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const messages = describeEvent(
      { type: 'ChemistBackfired', chemistId: 1n, targetId: 2n },
      [chemist, target],
      true,
    );

    expect(messages).toEqual([
      { audience: 1n, key: 'ChemistFail', args: [mention(2n, 'T')] },
      { audience: 2n, key: 'ChemistVisitYouFail', args: [mention(1n, 'Ch')] },
    ]);
  });

  it('died-visiting: picks the Grave Digger pair vs the Serial Killer pair by target role', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const gd = createPlayer(2n, 'GD', ROLE_BIT.GraveDigger, 'Village');
    const sk = createPlayer(3n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');

    expect(
      describeEvent(
        { type: 'ChemistDiedVisiting', chemistId: 1n, targetId: 2n },
        [chemist, gd],
        true,
      ),
    ).toEqual([
      { audience: 1n, key: 'ChemistFell', args: [mention(2n, 'GD')] },
      { audience: 2n, key: 'ChemistFellDigger', args: [mention(1n, 'Ch')] },
    ]);
    expect(
      describeEvent(
        { type: 'ChemistDiedVisiting', chemistId: 1n, targetId: 3n },
        [chemist, sk],
        true,
      ),
    ).toEqual([
      { audience: 1n, key: 'ChemistSK', args: [mention(3n, 'SK')] },
      { audience: 3n, key: 'ChemistVisitYouSK', args: [mention(1n, 'Ch')] },
    ]);
  });
});

describe('describeEvent - previously-silent action feedback', () => {
  it("tells Cupid privately who they paired, on top of the lovers' own PMs", () => {
    const cupid = createPlayer(1n, 'Cupid', ROLE_BIT.Cupid, 'Village');
    const a = createPlayer(2n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(3n, 'B', ROLE_BIT.Villager, 'Village');

    expect(
      describeEvent({ type: 'LoversCreated', lover1Id: 2n, lover2Id: 3n }, [cupid, a, b], true),
    ).toEqual([
      { audience: 2n, key: 'YouAreInLove', args: [mention(3n, 'B')] },
      { audience: 3n, key: 'YouAreInLove', args: [mention(2n, 'A')] },
      { audience: 1n, key: 'CupidPairingConfirmed', args: [mention(2n, 'A'), mention(3n, 'B')] },
    ]);
  });

  it('never double-messages Cupid if the random fallback happens to pair Cupid themselves', () => {
    const cupid = createPlayer(1n, 'Cupid', ROLE_BIT.Cupid, 'Village');
    const other = createPlayer(2n, 'Other', ROLE_BIT.Villager, 'Village');

    expect(
      describeEvent({ type: 'LoversCreated', lover1Id: 1n, lover2Id: 2n }, [cupid, other], true),
    ).toEqual([
      { audience: 1n, key: 'YouAreInLove', args: [mention(2n, 'Other')] },
      { audience: 2n, key: 'YouAreInLove', args: [mention(1n, 'Cupid')] },
    ]);
  });

  it('tells the recruiting Cultist both a successful and a failed conversion attempt', () => {
    expect(
      describeEvent(
        { type: 'PlayerConvertedToCult', playerId: 2n, newbieId: 1n },
        [
          createPlayer(1n, 'Newbie', ROLE_BIT.Cultist, 'Cult'),
          createPlayer(2n, 'T', ROLE_BIT.Cultist, 'Cult'),
        ],
        true,
      ),
    ).toEqual([
      { audience: 2n, key: 'ConvertedToCult', args: [] },
      { audience: 1n, key: 'CultConversionSucceeded', args: [mention(2n, 'T')] },
    ]);

    expect(
      describeEvent(
        { type: 'CultConversionFailed', targetId: 2n, newbieId: 1n },
        [
          createPlayer(1n, 'Newbie', ROLE_BIT.Cultist, 'Cult'),
          createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village'),
        ],
        true,
      ),
    ).toEqual([{ audience: 1n, key: 'CultConversionFailedMsg', args: [mention(2n, 'T')] }]);
  });

  it('tells the Necromancer their resurrection ritual failed', () => {
    expect(
      describeEvent({ type: 'NecromancerResurrectFailed', necromancerId: 1n }, [], true),
    ).toEqual([{ audience: 1n, key: 'NecromancerResurrectFailedMsg', args: [] }]);
  });

  it('confirms the Harlot which player they visited', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    expect(
      describeEvent({ type: 'HarlotVisited', harlotId: 1n, targetId: 2n }, [target], true),
    ).toEqual([{ audience: 1n, key: 'HarlotVisitConfirmed', args: [mention(2n, 'T')] }]);
  });

  it('confirms the Wild Child/Doppelganger their role model, for the day-1 forced-random fallback', () => {
    const model = createPlayer(2n, 'M', ROLE_BIT.Villager, 'Village');
    expect(
      describeEvent({ type: 'RoleModelChosen', playerId: 1n, roleModelId: 2n }, [model], true),
    ).toEqual([{ audience: 1n, key: 'RoleModelChosenMsg', args: [mention(2n, 'M')] }]);
  });
});
