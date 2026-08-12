import { describe, expect, it } from 'vitest';
import {
  ROLE_BIT,
  ROLE_NAMES,
  addFlag,
  getUniqueRoles,
  hasFlag,
  removeFlag,
  roleName,
} from '../../src/domain/roles/role.js';

describe('role flags', () => {
  it('assigns each role a distinct power-of-two bit starting at 2^1', () => {
    ROLE_NAMES.forEach((name, index) => {
      expect(ROLE_BIT[name]).toBe(1n << BigInt(index + 1));
    });
  });

  it('round-trips a bit back to its role name', () => {
    expect(roleName(ROLE_BIT.Seer)).toBe('Seer');
    expect(roleName(ROLE_BIT.Spumpkin)).toBe('Spumpkin');
  });

  it('combines and decomposes flags losslessly', () => {
    let flags = 0n;
    flags = addFlag(flags, ROLE_BIT.Seer);
    flags = addFlag(flags, ROLE_BIT.Wolf);

    expect(hasFlag(flags, ROLE_BIT.Seer)).toBe(true);
    expect(hasFlag(flags, ROLE_BIT.Cupid)).toBe(false);
    expect(getUniqueRoles(flags).sort()).toEqual([ROLE_BIT.Seer, ROLE_BIT.Wolf].sort());

    flags = removeFlag(flags, ROLE_BIT.Seer);
    expect(hasFlag(flags, ROLE_BIT.Seer)).toBe(false);
    expect(hasFlag(flags, ROLE_BIT.Wolf)).toBe(true);
  });

  it('supports the highest bit (Spumpkin, 2^43) without precision loss', () => {
    const flags = addFlag(0n, ROLE_BIT.Spumpkin);
    expect(hasFlag(flags, ROLE_BIT.Spumpkin)).toBe(true);
    expect(ROLE_BIT.Spumpkin).toBe(8796093022208n);
  });
});
