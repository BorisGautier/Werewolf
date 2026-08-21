import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer, type Player } from '../../src/domain/game/player.js';
import type { GameEvent } from '../../src/domain/game/game-event.js';
import {
  calculateRolePerformanceBonus,
  type RolePerformanceContext,
} from '../../src/domain/role-performance.js';

function ctx(
  players: Player[],
  eventBatches: readonly (readonly GameEvent[])[] = [],
): RolePerformanceContext {
  return { players, eventBatches };
}

describe('calculateRolePerformanceBonus', () => {
  it('gives no bonus/malus to passive roles with no real decision', () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');
    const mason = createPlayer(2n, 'M', ROLE_BIT.Mason, 'Village');
    const result = calculateRolePerformanceBonus(ctx([villager, mason]));
    expect(result.get(1n) ?? 0).toBe(0);
    expect(result.get(2n) ?? 0).toBe(0);
  });

  it('rewards a Seer for a vision that landed on a real wolf', () => {
    const seer = createPlayer(1n, 'S', ROLE_BIT.Seer, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const events: GameEvent[] = [
      { type: 'SeerVision', playerId: 1n, targetId: 2n, shownRole: wolf.role },
    ];
    const result = calculateRolePerformanceBonus(ctx([seer, wolf], [events]));
    expect(result.get(1n)).toBe(4);
  });

  it('does not reward the Seer for a vision on a villager', () => {
    const seer = createPlayer(1n, 'S', ROLE_BIT.Seer, 'Village');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const events: GameEvent[] = [
      { type: 'SeerVision', playerId: 1n, targetId: 2n, shownRole: villager.role },
    ];
    const result = calculateRolePerformanceBonus(ctx([seer, villager], [events]));
    expect(result.get(1n) ?? 0).toBe(0);
  });

  it('rewards the Hunter for a dying shot on a wolf and penalizes one on a villager', () => {
    const hunter1 = createPlayer(1n, 'H1', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'Wolf', ROLE_BIT.Wolf, 'Wolf');
    const goodBatch: GameEvent[] = [
      { type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: false },
    ];
    const goodResult = calculateRolePerformanceBonus(ctx([hunter1, wolf], [goodBatch]));
    expect(goodResult.get(1n)).toBe(5);

    const hunter2 = createPlayer(3n, 'H2', ROLE_BIT.Hunter, 'Village');
    const villager = createPlayer(4n, 'V', ROLE_BIT.Villager, 'Village');
    const badBatch: GameEvent[] = [
      { type: 'PlayerDied', playerId: 4n, method: 'HunterShot', killerIds: [3n], isNight: false },
    ];
    const badResult = calculateRolePerformanceBonus(ctx([hunter2, villager], [badBatch]));
    expect(badResult.get(3n)).toBe(-5);
  });

  it('rewards the Gunner per bullet that hit a baddie and penalizes wasted bullets', () => {
    const gunner = createPlayer(1n, 'G', ROLE_BIT.Gunner, 'Village');
    gunner.bullet = 0; // both bullets fired
    gunner.bulletHitBaddies = 1; // only one hit a real threat
    const result = calculateRolePerformanceBonus(ctx([gunner]));
    expect(result.get(1n)).toBe(4 - 3); // +4 for the hit, -3 for the wasted shot
  });

  it('rewards the Guardian Angel for a real save and penalizes guarding an unattacked wolf', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const events: GameEvent[] = [
      { type: 'GuardianAngelBlockedWolfAttack', targetId: 99n, wolfIds: [50n] },
    ];
    const saveResult = calculateRolePerformanceBonus(ctx([ga], [events]));
    expect(saveResult.get(1n)).toBe(5);

    const ga2 = createPlayer(2n, 'GA2', ROLE_BIT.GuardianAngel, 'Village');
    ga2.gaGuardWolfCount = 1;
    const wasteResult = calculateRolePerformanceBonus(ctx([ga2]));
    expect(wasteResult.get(2n)).toBe(-4);
  });

  it('rewards the Chemist for a real poison kill and penalizes a backfire', () => {
    const chemist = createPlayer(1n, 'C', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    const events: GameEvent[] = [
      { type: 'PlayerDied', playerId: 2n, method: 'Chemistry', killerIds: [1n], isNight: true },
    ];
    const result = calculateRolePerformanceBonus(ctx([chemist, target], [events]));
    expect(result.get(1n)).toBe(5);

    const chemist2 = createPlayer(3n, 'C2', ROLE_BIT.Chemist, 'Village');
    const backfireEvents: GameEvent[] = [{ type: 'ChemistBackfired', chemistId: 3n, targetId: 4n }];
    const backfireResult = calculateRolePerformanceBonus(ctx([chemist2], [backfireEvents]));
    expect(backfireResult.get(3n)).toBe(-5);
  });

  it('caps the total bonus/malus per player', () => {
    const archangel = createPlayer(1n, 'A', ROLE_BIT.Archangel, 'Village');
    const events: GameEvent[] = Array.from({ length: 10 }, (_, i) => ({
      type: 'ArchangelShotFired' as const,
      archangelId: 1n,
      targetId: BigInt(i + 2),
      hit: true,
    }));
    const result = calculateRolePerformanceBonus(ctx([archangel], [events]));
    expect(result.get(1n)).toBe(15);
  });

  it('rewards Hitman, Reflector and Avenger for their signature single-event win conditions', () => {
    const hitman = createPlayer(1n, 'Hi', ROLE_BIT.Hitman, 'Neutral');
    const reflector = createPlayer(2n, 'R', ROLE_BIT.Reflector, 'Neutral');
    const avenger = createPlayer(3n, 'Av', ROLE_BIT.Avenger, 'Neutral');
    const events: GameEvent[] = [
      { type: 'HitmanTargetEliminated', hitmanId: 1n, targetId: 99n },
      { type: 'ReflectorReflected', reflectorId: 2n, attackerId: 98n },
      { type: 'AvengerRivalLynched', avengerId: 3n, targetId: 97n },
    ];
    const result = calculateRolePerformanceBonus(ctx([hitman, reflector, avenger], [events]));
    expect(result.get(1n)).toBe(6);
    expect(result.get(2n)).toBe(5);
    expect(result.get(3n)).toBe(6);
  });
});
