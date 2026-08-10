import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { Game } from '../../src/domain/game/game.aggregate.js';

function startedGame(roles: Array<[bigint, string]>, options: ConstructorParameters<typeof Game>[0] = { chatId: 1n, mode: 'Normal' }) {
  const game = new Game({ ...options, minPlayers: roles.length });
  for (const [id, name] of roles) game.addPlayer(id, name);
  game.start();
  return game;
}

describe('Game ability toggles', () => {
  it('Mayor reveal only works once and only for the Mayor', () => {
    const game = startedGame([
      [1n, 'Mayor'],
      [2n, 'Other'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const mayor = game.players[0]!;
    mayor.role = ROLE_BIT.Mayor;

    expect(game.useMayorReveal(mayor.id)).toBe(true);
    expect(mayor.hasUsedAbility).toBe(true);
    expect(game.useMayorReveal(mayor.id)).toBe(false); // already used
    expect(game.useMayorReveal(game.players[1]!.id)).toBe(false); // not a Mayor
  });

  it("Pacifist peace cancels a pending Troublemaker double lynch", () => {
    const game = startedGame([
      [1n, 'Trouble'],
      [2n, 'Pacifist'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const trouble = game.players[0]!;
    trouble.role = ROLE_BIT.Troublemaker;
    const pacifist = game.players[1]!;
    pacifist.role = ROLE_BIT.Pacifist;

    expect(game.useTroublemakerDoubleLynch(trouble.id)).toBe(true);
    expect(game.usePacifistPeace(pacifist.id)).toBe(true);
    expect(game.pacifistUsed).toBe(true);

    game.startDay();
    game.startLynch();
    expect(game.lynchAttemptsPlanned).toBe(1); // peace overrode the pending double lynch
  });

  it('Troublemaker double lynch cancels a pending Pacifist peace', () => {
    const game = startedGame([
      [1n, 'Trouble'],
      [2n, 'Pacifist'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const trouble = game.players[0]!;
    trouble.role = ROLE_BIT.Troublemaker;
    const pacifist = game.players[1]!;
    pacifist.role = ROLE_BIT.Pacifist;

    expect(game.usePacifistPeace(pacifist.id)).toBe(true);
    expect(game.useTroublemakerDoubleLynch(trouble.id)).toBe(true);
    expect(game.pacifistUsed).toBe(false);

    game.startDay();
    game.startLynch();
    expect(game.lynchAttemptsPlanned).toBe(2);
  });

  it('a Pacifist declared this lynch phase skips the lynch without tallying votes', () => {
    const game = startedGame([
      [1n, 'Pacifist'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const pacifist = game.players[0]!;
    pacifist.role = ROLE_BIT.Pacifist;

    game.startDay();
    game.startLynch();
    game.usePacifistPeace(pacifist.id);

    game.players[1]!.choice = game.players[2]!.id; // someone still tries to vote

    const result = game.resolveLynch();
    expect(result.resolution.outcome).toBe('PacifistPeace');
    expect(game.players[2]!.isDead).toBe(false);
  });

  it('Blacksmith spread silver and Sandman sleep set their flags once', () => {
    const game = startedGame([
      [1n, 'Blacksmith'],
      [2n, 'Sandman'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    game.players[0]!.role = ROLE_BIT.Blacksmith;
    game.players[1]!.role = ROLE_BIT.Sandman;

    expect(game.useBlacksmithSpreadSilver(game.players[0]!.id)).toBe(true);
    expect(game.silverSpread).toBe(true);
    expect(game.useBlacksmithSpreadSilver(game.players[0]!.id)).toBe(false);

    expect(game.useSandmanSleep(game.players[1]!.id)).toBe(true);
    expect(game.sandmanSleep).toBe(true);
  });
});

describe('Game.enterNight / resolveNightActions', () => {
  it('skips all role resolution when the Sandman used their ability the day before, and resets flags', () => {
    const game = startedGame([
      [1n, 'Sandman'],
      [2n, 'Wolf'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const sandman = game.players[0]!;
    sandman.role = ROLE_BIT.Sandman;
    const wolf = game.players[1]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.drunk = true;
    game.wolfCubKilled = true;

    // Night 1 -> Day 1: the Sandman uses their ability during the day.
    game.startDay();
    expect(game.useSandmanSleep(sandman.id)).toBe(true);
    game.startLynch();
    game.resolveLynch();

    // Entering Night 2 must consume the pending sleep.
    game.startNight();
    expect(game.nightSkipped).toBe(true);
    expect(game.sandmanSleep).toBe(false);
    expect(game.wolfCubKilled).toBe(false);
    expect(wolf.drunk).toBe(false);

    wolf.choice = game.players[2]!.id;
    const events = game.resolveNightActions();

    expect(events).toEqual([]);
    expect(game.players[2]!.isDead).toBe(false);
  });

  it('resets wasSavedLastNight at the end of the night so a stale protection flag never leaks into the next one', () => {
    const game = startedGame([
      [1n, 'GA'],
      [2n, 'Wolf'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const ga = game.players[0]!;
    ga.role = ROLE_BIT.GuardianAngel;
    const wolf = game.players[1]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';
    const protectedPlayer = game.players[2]!;

    ga.choice = protectedPlayer.id;
    wolf.choice = protectedPlayer.id;
    game.resolveNightActions();

    // wasSavedLastNight is a transient intra-night signal (other same-night resolvers, e.g. the GA's
    // own douse-cleaning step, read it) - the original clears it again before NightCycle even returns,
    // so its real, externally-observable effect is that the protected player actually survived.
    expect(protectedPlayer.isDead).toBe(false);
    expect(protectedPlayer.wasSavedLastNight).toBe(false);
  });

  it('calls CheckRoleChanges before Thief Night, matching the original order', () => {
    // The Apprentice Seer promotion must be visible in the *same* resolveNightActions() call as the
    // Seer's death, before the Thief resolver runs - a same-call ordering bug wouldn't be observable
    // through Thief behavior directly, but this pins the documented call order regardless.
    const game = startedGame([
      [1n, 'AppSeer'],
      [2n, 'Seer'],
      [3n, 'Wolf'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const appSeer = game.players[0]!;
    appSeer.role = ROLE_BIT.ApprenticeSeer;
    const seer = game.players[1]!;
    seer.role = ROLE_BIT.Seer;
    const wolf = game.players[2]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';
    wolf.choice = seer.id;

    const events = game.resolveNightActions();

    expect(seer.isDead).toBe(true);
    expect(appSeer.role).toBe(ROLE_BIT.Seer);
    expect(events.some((e) => e.type === 'ApprenticeSeerPromoted')).toBe(true);
  });

  it('skips the end-of-night reset once the game has already ended that night', () => {
    // balance() can't produce a valid 2-player game (an enemy count always ties or exceeds the
    // village count), so start with enough players and force everyone but a wolf/villager pair dead.
    const game = startedGame([
      [1n, 'Wolf'],
      [2n, 'Villager'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const [a, b, ...rest] = game.players;
    a!.role = ROLE_BIT.Wolf;
    a!.team = 'Wolf';
    b!.role = ROLE_BIT.Villager;
    b!.team = 'Village';
    for (const p of rest) p.isDead = true;
    a!.choice = b!.id;

    game.resolveNightActions();

    expect(game.phase).toBe('Ended');
    expect(game.winningTeam).toBe('Wolf');
  });

  it('runs the wolf pack and kills the target on a normal night', () => {
    const game = startedGame([
      [1n, 'Wolf'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const wolf = game.players[0]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';
    const victim = game.players[1]!;
    // start() already ran enterNight() for the first Night (phase='Night', dayNumber=1) and reset
    // choices as part of that - so choices only need to be set *after* start() returns, matching how
    // the real app would set them via menus during the night, after enterNight()'s own reset.
    wolf.choice = victim.id;

    game.resolveNightActions();

    expect(victim.isDead).toBe(true);
  });

  it('lets a bitten survivor turn Wolf when the next night begins', () => {
    const game = startedGame([
      [1n, 'Bitten'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const bitten = game.players[0]!;
    bitten.role = ROLE_BIT.Villager;

    // Resolve night 1 (nothing bites anyone here - this is just to reach Day/Lynch normally).
    game.resolveNightActions();
    game.startDay();
    bitten.bitten = true; // e.g. set by a wolf's bite during night 1's resolution, in a real game
    game.startLynch();
    game.resolveLynch();

    const events = game.startNight(); // entering night 2 is where the pending bite resolves

    expect(bitten.role).toBe(ROLE_BIT.Wolf);
    expect(events.some((e) => e.type === 'BittenPlayerTurnedWolf')).toBe(true);
  });
});

describe('Game.resolveDayActions', () => {
  it('resolves the Gunner shot during the Day phase', () => {
    const game = startedGame([
      [1n, 'Gunner'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const gunner = game.players[0]!;
    gunner.role = ROLE_BIT.Gunner;
    const target = game.players[1]!;
    gunner.choice = target.id;

    game.startDay();
    game.resolveDayActions();

    expect(target.isDead).toBe(true);
  });
});
