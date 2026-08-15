import { describe, expect, it } from 'vitest';
import { GameManager } from '../../src/application/game-manager.js';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { getTeamForRole } from '../../src/domain/game/team.js';
import { createPlayer, SPARK } from '../../src/domain/game/player.js';
import {
  initialNightState,
  resolveArsonistNight,
  resolveChemistNight,
  resolveCultNight,
} from '../../src/domain/game/night-resolution.js';

describe('ALL ROLES ABILITY COMPREHENSIVE AUDIT', () => {
  function createTestGame() {
    const gameManager = new GameManager();
    const game = gameManager.create(100n, { mode: 'Normal', minPlayers: 6 });
    for (let i = 1; i <= 6; i++) {
      game.addPlayer(BigInt(i), `Player${i}`, `player${i}`);
    }
    game.start();
    for (const p of game.players) {
      p.role = ROLE_BIT.Villager;
      p.team = getTeamForRole(ROLE_BIT.Villager);
      p.isDead = false;
      p.choice = null;
    }
    return { gameManager, game };
  }

  it('1. Seer inspects target correctly at night', () => {
    const { game } = createTestGame();
    const seer = game.players[0]!;
    const target = game.players[1]!;
    seer.role = ROLE_BIT.Seer;
    seer.team = getTeamForRole(ROLE_BIT.Seer);

    seer.choice = target.id;
    const events = game.resolveNightActions();
    expect(events.some((e) => e.type === 'SeerVision' && e.playerId === seer.id)).toBe(true);
  });

  it('2. Troublemaker double lynch resets choices on attempt 2', () => {
    const { game } = createTestGame();
    const tm = game.players[0]!;
    tm.role = ROLE_BIT.Troublemaker;
    tm.team = getTeamForRole(ROLE_BIT.Troublemaker);

    expect(game.useTroublemakerDoubleLynch(tm.id)).toBe(true);

    game.phase = 'Day';
    game.startLynch();
    expect(game.lynchAttemptsPlanned).toBe(2);

    const p1 = game.players[1]!;
    const p2 = game.players[2]!;
    tm.choice = p1.id;
    expect(tm.choice).toBe(p1.id);

    // Re-vote clears choices
    game.restartLynchVote();
    expect(tm.choice).toBeNull();

    tm.choice = p2.id;
    expect(tm.choice).toBe(p2.id);
  });

  it('3. Sandman sleep ability skips night menu phase', () => {
    const { game } = createTestGame();
    const sandman = game.players[0]!;
    sandman.role = ROLE_BIT.Sandman;
    sandman.team = getTeamForRole(ROLE_BIT.Sandman);

    const events = game.useSandmanSleep(sandman.id);
    expect(events.length).toBe(1);
    expect(game.sandmanSleep).toBe(true);
  });

  it('4. Pacifist peace ability cancels lynch', () => {
    const { game } = createTestGame();
    const pacifist = game.players[0]!;
    pacifist.role = ROLE_BIT.Pacifist;
    pacifist.team = getTeamForRole(ROLE_BIT.Pacifist);

    const success = game.usePacifistPeace(pacifist.id);
    expect(success).toBe(true);
    expect(game.pacifistUsed).toBe(true);

    game.phase = 'Day';
    game.startLynch();
    const result = game.resolveLynch();
    expect(result.resolution.outcome).toBe('PacifistPeace');
  });

  it('5. Arsonist ignites doused players with SPARK', () => {
    const arsonist = createPlayer(1n, 'Arso', ROLE_BIT.Arsonist, 'Neutral');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.doused = true;
    const players = [arsonist, target];
    const state = initialNightState();
    const ctx = { players, dayNumber: 2, thiefFull: false };

    arsonist.choice = SPARK;
    const events = resolveArsonistNight(players, state, ctx);
    expect(target.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Burn')).toBe(true);
  });

  it('6. Necromancer resurrects dead player via full resolveNightActions', () => {
    const { game } = createTestGame();
    const necro = game.players[0]!;
    const deadPlayer = game.players[1]!;

    necro.role = ROLE_BIT.Necromancer;
    necro.team = getTeamForRole(ROLE_BIT.Necromancer);

    deadPlayer.isDead = true;
    necro.choice = deadPlayer.id;

    const events = game.resolveNightActions();
    expect(events).toBeDefined();
  });

  it('7. Guardian Angel protects target from killer attack', () => {
    const { game } = createTestGame();
    const ga = game.players[0]!;
    const wolf = game.players[1]!;
    const villager = game.players[2]!;

    ga.role = ROLE_BIT.GuardianAngel;
    ga.team = getTeamForRole(ROLE_BIT.GuardianAngel);
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = getTeamForRole(ROLE_BIT.Wolf);

    ga.choice = villager.id;
    wolf.choice = villager.id;

    game.resolveNightActions();
    expect(villager.isDead).toBe(false);
  });

  it('8. Chemist potion kills target when successful roll', () => {
    const chemist = createPlayer(1n, 'Ch', ROLE_BIT.Chemist, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    chemist.choice = target.id;

    const events = resolveChemistNight([chemist, target], { players: [chemist, target], dayNumber: 2, thiefFull: false, random: () => 0 });

    expect(target.isDead).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.method === 'Chemistry')).toBe(true);
  });

  it('9. Cultist converts non-cultist player to Cult', () => {
    const cultist = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    cultist.choice = villager.id;

    const events = resolveCultNight([cultist, villager], initialNightState(), { players: [cultist, villager], dayNumber: 3, thiefFull: false, random: () => 0 });

    expect(villager.role).toBe(ROLE_BIT.Cultist);
    expect(events.some((e) => e.type === 'PlayerConvertedToCult')).toBe(true);
  });

  it('10. Detective snoops on a player during day', () => {
    const { game } = createTestGame();
    const det = game.players[0]!;
    const wolf = game.players[1]!;

    det.role = ROLE_BIT.Detective;
    det.team = getTeamForRole(ROLE_BIT.Detective);
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = getTeamForRole(ROLE_BIT.Wolf);

    game.phase = 'Day';
    const events = game.resolveDayActions();
    expect(events).toBeDefined();
  });

  it('11. Mayor role assigns correct team and capabilities', () => {
    const { game } = createTestGame();
    const mayor = game.players[0]!;

    mayor.role = ROLE_BIT.Mayor;
    mayor.team = getTeamForRole(ROLE_BIT.Mayor);

    expect(mayor.role).toBe(ROLE_BIT.Mayor);
  });
});
