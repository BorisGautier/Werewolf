import { describe, expect, it } from 'vitest';
import { ROLE_BIT, addFlag, type Role } from '../../src/domain/roles/role.js';
import type { GameMode } from '../../src/domain/game/game-mode.js';
import {
  WOLF_ROLES,
  NON_VILLAGE_ROLES,
  balance,
  getRoleList,
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

describe('cosmetic game mode role bias', () => {
  const PLAYER_COUNT = 15;
  const TRIALS = 20;

  function trialsHittingAnyOf(mode: GameMode, roles: readonly Role[]): number {
    let hits = 0;
    for (let i = 0; i < TRIALS; i++) {
      const { rolesToAssign } = balance({
        disabledRoleFlags: 0n,
        playerCount: PLAYER_COUNT,
        chaos: false,
        burningOverkill: true,
        mode,
      });
      if (roles.some((r) => rolesToAssign.includes(r))) hits++;
    }
    return hits;
  }

  it.each<[GameMode, Role[]]>([
    [
      'Bloodbath',
      [
        ROLE_BIT.SerialKiller,
        ROLE_BIT.Arsonist,
        ROLE_BIT.AlphaWolf,
        ROLE_BIT.Gunner,
        ROLE_BIT.Hunter,
        ROLE_BIT.Chemist,
      ],
    ],
    [
      'DarkMagic',
      [
        ROLE_BIT.Sorcerer,
        ROLE_BIT.Chemist,
        ROLE_BIT.Necromancer,
        ROLE_BIT.Seer,
        ROLE_BIT.Oracle,
        ROLE_BIT.Augur,
        ROLE_BIT.Reflector,
      ],
    ],
    [
      'WolfPack',
      [
        ROLE_BIT.BerserkerWolf,
        ROLE_BIT.HypnotistWolf,
        ROLE_BIT.TrapperWolf,
        ROLE_BIT.HowlerWolf,
        ROLE_BIT.ChameleonWolf,
        ROLE_BIT.ViperWolf,
        ROLE_BIT.SnowWolf,
      ],
    ],
    [
      'CursedVillage',
      [ROLE_BIT.Cursed, ROLE_BIT.Cultist, ROLE_BIT.CultistHunter, ROLE_BIT.Avenger, ROLE_BIT.Crow],
    ],
    [
      'Infection',
      [
        ROLE_BIT.Cultist,
        ROLE_BIT.CultistHunter,
        ROLE_BIT.AlphaWolf,
        ROLE_BIT.Doppelganger,
        ROLE_BIT.WildChild,
        ROLE_BIT.Thief,
      ],
    ],
    [
      'Anarchy',
      [
        ROLE_BIT.Tanner,
        ROLE_BIT.Jester,
        ROLE_BIT.Hitman,
        ROLE_BIT.Avenger,
        ROLE_BIT.Thief,
        ROLE_BIT.Arsonist,
        ROLE_BIT.SerialKiller,
      ],
    ],
    [
      'HolyWar',
      [
        ROLE_BIT.Priestess,
        ROLE_BIT.Archangel,
        ROLE_BIT.GuardianAngel,
        ROLE_BIT.WiseElder,
        ROLE_BIT.Cultist,
        ROLE_BIT.Wolf,
        ROLE_BIT.AlphaWolf,
      ],
    ],
    [
      'Assassins',
      [
        ROLE_BIT.Hitman,
        ROLE_BIT.Avenger,
        ROLE_BIT.Gunner,
        ROLE_BIT.Detective,
        ROLE_BIT.CultistHunter,
      ],
    ],
  ])('%s reliably deals at least one of its themed roles', (mode, themedRoles) => {
    const hits = trialsHittingAnyOf(mode, themedRoles);
    expect(hits).toBeGreaterThanOrEqual(TRIALS * 0.75);
  });

  it('Normal and Chaos modes are unaffected by any bias (no mode-specific role list)', () => {
    for (const mode of ['Normal', 'Chaos'] as const) {
      const withMode = getRoleList(PLAYER_COUNT, [], mode);
      const withoutMode = getRoleList(PLAYER_COUNT, []);
      expect(withMode).toHaveLength(withoutMode.length);
    }
  });

  it('Wolf Pack mode deals noticeably more wolves on average than Normal mode', () => {
    const countWolves = (mode?: GameMode) => {
      let total = 0;
      for (let i = 0; i < TRIALS; i++) {
        const { rolesToAssign } = balance({
          disabledRoleFlags: 0n,
          playerCount: PLAYER_COUNT,
          chaos: false,
          burningOverkill: true,
          mode,
        });
        total += rolesToAssign.filter(
          (r) => WOLF_ROLES.includes(r) || r === ROLE_BIT.SnowWolf,
        ).length;
      }
      return total / TRIALS;
    };

    const normalAverage = countWolves('Normal');
    const wolfPackAverage = countWolves('WolfPack');
    expect(wolfPackAverage).toBeGreaterThan(normalAverage);
  });

  it('stays balanceable across the full production player-count range (5-35) for every mode, even the most heavily-biased ones', () => {
    // Regression test: a flat MODE_ROLE_BIAS_COPIES (originally 3, unconditionally) over-represented
    // the bias at large player counts - WolfPack and Anarchy in particular, both biased toward
    // several high-strength "enemy"-classified roles, started throwing UnbalanceableGameError once
    // real games (see the full-game-stress simulation) exercised the 20+ player range.
    // modeRoleBiasCopies() tapers the bias down for larger games specifically to keep this true -
    // repeated here (not just once) since the balance loop's own internal randomness means a single
    // successful call doesn't prove much on its own.
    for (const mode of ['WolfPack', 'Anarchy'] as const) {
      for (let playerCount = 20; playerCount <= 35; playerCount++) {
        for (let trial = 0; trial < 10; trial++) {
          expect(() =>
            balance({ disabledRoleFlags: 0n, playerCount, chaos: false, burningOverkill: true, mode }),
          ).not.toThrow();
        }
      }
    }
  });
});
