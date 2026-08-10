import { describe, expect, it } from 'vitest';
import { deathFlavorKey } from '../../src/infrastructure/telegram/death-messages.js';

describe('deathFlavorKey', () => {
  it('picks a role-specific eaten variant for a known role, with no role-reveal arg', () => {
    expect(deathFlavorKey('Eat', 'Seer', false)).toEqual({ key: 'SeerEaten', includeRoleArg: false });
  });

  it('falls back to DefaultEaten (with a role-reveal arg) for a role with no specific variant', () => {
    expect(deathFlavorKey('Eat', 'Villager', false)).toEqual({ key: 'DefaultEaten', includeRoleArg: true });
  });

  it('picks a role-specific serial-killed variant, falling back to DefaultKilled otherwise', () => {
    expect(deathFlavorKey('SerialKilled', 'Mayor', false)).toEqual({ key: 'MayorKilled', includeRoleArg: false });
    expect(deathFlavorKey('SerialKilled', 'Thief', false)).toEqual({ key: 'DefaultKilled', includeRoleArg: true });
  });

  it('treats every wolf role the same for a grave-digger fall-in, distinct from other roles', () => {
    for (const wolfRole of ['Wolf', 'AlphaWolf', 'Lycan', 'WolfCub'] as const) {
      expect(deathFlavorKey('FallGrave', wolfRole, false)).toEqual({ key: 'WolfFellPublic', includeRoleArg: true });
    }
    expect(deathFlavorKey('FallGrave', 'Cultist', false)).toEqual({ key: 'CultistFellPublic', includeRoleArg: false });
    expect(deathFlavorKey('FallGrave', 'Villager', false)).toEqual({ key: 'DefaultFellPublic', includeRoleArg: true });
  });

  it('distinguishes wolves burning at their target from anyone else burning', () => {
    expect(deathFlavorKey('VisitBurning', 'Wolf', false)).toEqual({ key: 'WolfVisitBurn', includeRoleArg: true });
    expect(deathFlavorKey('VisitBurning', 'Villager', false)).toEqual({ key: 'DefaultVisitBurn', includeRoleArg: true });
  });

  it('distinguishes the Chemist accidentally poisoning themselves from a successful kill', () => {
    expect(deathFlavorKey('Chemistry', 'Villager', true)).toEqual({ key: 'ChemistFailPublic', includeRoleArg: false });
    expect(deathFlavorKey('Chemistry', 'Villager', false)).toEqual({ key: 'ChemistSuccessPublic', includeRoleArg: true });
  });

  it('returns null for methods without their own flavor text (falls back to the generic message)', () => {
    expect(deathFlavorKey('Lynch', 'Villager', false)).toBeNull();
    expect(deathFlavorKey('Flee', 'Villager', false)).toBeNull();
    expect(deathFlavorKey('Idle', 'Villager', false)).toBeNull();
  });
});
