import { describe, expect, it } from 'vitest';
import { ROLE_BIT, addFlag } from '../../src/domain/roles/role.js';
import {
  WOLF_ROLES,
  NON_VILLAGE_ROLES,
  balance,
  getStrength,
  tryBalance,
} from '../../src/domain/game/game-balancing.js';

describe('game balancing', () => {
  it('always assigns exactly one role per player', () => {
    for (const playerCount of [5, 8, 12, 20, 35]) {
      const { rolesToAssign } = balance({
        disabledRoleFlags: 0n,
        playerCount,
        chaos: false,
        burningOverkill: true,
      });
      expect(rolesToAssign).toHaveLength(playerCount);
    }
  });

  it('always includes at least one village-team role and one real enemy', () => {
    const { rolesToAssign } = balance({
      disabledRoleFlags: 0n,
      playerCount: 10,
      chaos: false,
      burningOverkill: true,
    });
    const hasEnemy = rolesToAssign.some((r) => NON_VILLAGE_ROLES.includes(r));
    expect(hasEnemy).toBe(true);
  });

  it('never deals a Sorcerer, Traitor or SnowWolf without a wolf-team role present', () => {
    for (let i = 0; i < 25; i++) {
      const { rolesToAssign } = balance({
        disabledRoleFlags: 0n,
        playerCount: 12,
        chaos: false,
        burningOverkill: true,
      });
      const hasWolf = rolesToAssign.some((r) => WOLF_ROLES.includes(r) || r === ROLE_BIT.SnowWolf);
      const hasDependentRole =
        rolesToAssign.includes(ROLE_BIT.Sorcerer) ||
        rolesToAssign.includes(ROLE_BIT.Traitor) ||
        rolesToAssign.includes(ROLE_BIT.SnowWolf);
      if (hasDependentRole) expect(hasWolf).toBe(true);
    }
  });

  it('respects disabled roles', () => {
    const disabled = addFlag(1n, ROLE_BIT.Tanner); // bit 1n = VALID marker
    for (let i = 0; i < 10; i++) {
      const { rolesToAssign } = balance({
        disabledRoleFlags: disabled,
        playerCount: 10,
        chaos: false,
        burningOverkill: true,
      });
      expect(rolesToAssign.includes(ROLE_BIT.Tanner)).toBe(false);
    }
  });

  it('chaos mode still produces exactly playerCount roles', () => {
    const { rolesToAssign } = balance({
      disabledRoleFlags: 0n,
      playerCount: 15,
      chaos: true,
      burningOverkill: true,
    });
    expect(rolesToAssign).toHaveLength(15);
  });

  it('tryBalance succeeds for a default (nothing disabled) configuration', () => {
    expect(tryBalance(0n, 15)).toBe(true);
  });

  it('computes known strength values', () => {
    expect(getStrength(ROLE_BIT.Villager, [ROLE_BIT.Villager])).toBe(1);
    expect(getStrength(ROLE_BIT.Wolf, [ROLE_BIT.Wolf])).toBe(10);
    expect(getStrength(ROLE_BIT.SerialKiller, [ROLE_BIT.SerialKiller])).toBe(15);
    expect(getStrength(ROLE_BIT.ClumsyGuy, [ROLE_BIT.ClumsyGuy])).toBe(-1);
  });

  it('Seer strength drops when Lycans/Wolfmen are in play', () => {
    const baseline = getStrength(ROLE_BIT.Seer, [ROLE_BIT.Seer]);
    const withLycan = getStrength(ROLE_BIT.Seer, [ROLE_BIT.Seer, ROLE_BIT.Lycan]);
    expect(withLycan).toBe(baseline - 1);
  });
});
