import { describe, expect, it } from 'vitest';
import { deathFlavorKey } from '../../src/infrastructure/telegram/death-messages.js';

describe('deathFlavorKey', () => {
  it('picks a role-specific eaten variant for a known role, with no role-reveal arg', () => {
    expect(deathFlavorKey('Eat', 'Seer', false, null)).toEqual({ key: 'SeerEaten', includeRoleArg: false });
  });

  it('falls back to DefaultEaten (with a role-reveal arg) for a role with no specific variant', () => {
    expect(deathFlavorKey('Eat', 'Villager', false, null)).toEqual({ key: 'DefaultEaten', includeRoleArg: true });
  });

  it('picks a role-specific serial-killed variant, falling back to DefaultKilled otherwise', () => {
    expect(deathFlavorKey('SerialKilled', 'Mayor', false, null)).toEqual({ key: 'MayorKilled', includeRoleArg: false });
    expect(deathFlavorKey('SerialKilled', 'Thief', false, null)).toEqual({ key: 'DefaultKilled', includeRoleArg: true });
  });

  it('treats every wolf role the same for a grave-digger fall-in, distinct from other roles', () => {
    for (const wolfRole of ['Wolf', 'AlphaWolf', 'Lycan', 'WolfCub'] as const) {
      expect(deathFlavorKey('FallGrave', wolfRole, false, null)).toEqual({ key: 'WolfFellPublic', includeRoleArg: true });
    }
    expect(deathFlavorKey('FallGrave', 'Cultist', false, null)).toEqual({ key: 'CultistFellPublic', includeRoleArg: false });
    expect(deathFlavorKey('FallGrave', 'Villager', false, null)).toEqual({ key: 'DefaultFellPublic', includeRoleArg: true });
  });

  it('distinguishes wolves burning at their target from anyone else burning', () => {
    expect(deathFlavorKey('VisitBurning', 'Wolf', false, null)).toEqual({ key: 'WolfVisitBurn', includeRoleArg: true });
    expect(deathFlavorKey('VisitBurning', 'Villager', false, null)).toEqual({ key: 'DefaultVisitBurn', includeRoleArg: true });
  });

  it('distinguishes the Chemist accidentally poisoning themselves from a successful kill', () => {
    expect(deathFlavorKey('Chemistry', 'Villager', true, null)).toEqual({ key: 'ChemistFailPublic', includeRoleArg: false });
    expect(deathFlavorKey('Chemistry', 'Villager', false, null)).toEqual({ key: 'ChemistSuccessPublic', includeRoleArg: true });
  });

  it('returns null for methods without their own flavor text (falls back to the generic message)', () => {
    expect(deathFlavorKey('Lynch', 'Villager', false, null)).toBeNull();
    expect(deathFlavorKey('Flee', 'Villager', false, null)).toBeNull();
    expect(deathFlavorKey('Idle', 'Villager', false, null)).toBeNull();
  });

  it('picks a role-specific variant for dying while visiting the Serial Killer', () => {
    expect(deathFlavorKey('VisitKiller', 'Wolf', false, null)).toEqual({ key: 'SerialKillerKilledWolf', includeRoleArg: false });
    expect(deathFlavorKey('VisitKiller', 'CultistHunter', false, null)).toEqual({ key: 'SerialKillerKilledCH', includeRoleArg: false });
    expect(deathFlavorKey('VisitKiller', 'Thief', false, null)).toEqual({ key: 'ThiefStoleKiller', includeRoleArg: false });
    expect(deathFlavorKey('VisitKiller', 'Harlot', false, null)).toEqual({ key: 'HarlotFuckKillerPublic', includeRoleArg: false });
    expect(deathFlavorKey('VisitKiller', 'GuardianAngel', false, null)).toEqual({ key: 'GAGuardedKiller', includeRoleArg: false });
    expect(deathFlavorKey('VisitKiller', 'Cultist', false, null)).toEqual({ key: 'CultConvertKillerPublic', includeRoleArg: false });
    expect(deathFlavorKey('VisitKiller', 'Villager', false, null)).toBeNull();
  });

  it('picks a role-specific variant for dying while visiting a wolf', () => {
    expect(deathFlavorKey('VisitWolf', 'Harlot', false, null)).toEqual({ key: 'HarlotFuckedWolfPublic', includeRoleArg: false });
    expect(deathFlavorKey('VisitWolf', 'Cultist', false, null)).toEqual({ key: 'CultConvertWolfPublic', includeRoleArg: false });
    expect(deathFlavorKey('VisitWolf', 'Villager', false, null)).toBeNull();
  });

  it('always attributes a Guardian Angel guarding a wolf to GAGuardedWolf', () => {
    expect(deathFlavorKey('GuardWolf', 'GuardianAngel', false, null)).toEqual({ key: 'GAGuardedWolf', includeRoleArg: false });
  });

  it('attributes a hunted Cultist to HunterKilledCultist regardless of which hunt path caught them', () => {
    expect(deathFlavorKey('Hunt', 'Cultist', false, null)).toEqual({ key: 'HunterKilledCultist', includeRoleArg: false });
    expect(deathFlavorKey('Hunt', 'Villager', false, null)).toBeNull();
  });

  it('attributes a Cultist caught trying to convert the Hunter to HunterKilledVisiter, with a role-reveal arg', () => {
    expect(deathFlavorKey('HunterCult', 'Cultist', false, null)).toEqual({ key: 'HunterKilledVisiter', includeRoleArg: true });
    expect(deathFlavorKey('HunterCult', 'Villager', false, null)).toBeNull();
  });

  it('distinguishes the Serial Killer spotting a digging Grave Digger from the wolf pack spotting them', () => {
    expect(deathFlavorKey('Spotted', 'GraveDigger', false, 'SerialKiller')).toEqual({
      key: 'KillerSpottedDiggerPublic',
      includeRoleArg: false,
    });
    expect(deathFlavorKey('Spotted', 'GraveDigger', false, 'Wolf')).toEqual({
      key: 'WolvesSpottedDiggerPublic',
      includeRoleArg: false,
    });
    expect(deathFlavorKey('Spotted', 'Villager', false, 'Wolf')).toBeNull();
  });
});
