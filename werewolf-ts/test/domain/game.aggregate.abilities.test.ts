import { describe, expect, it } from 'vitest';
import { ROLE_BIT, ROLE_VALID } from '../../src/domain/roles/role.js';
import { Game } from '../../src/domain/game/game.aggregate.js';

/**
 * Starts a game and then pins every player to a plain Villager. balance()
 * assigns roles randomly on start(), and leaving any player's role to
 * chance (e.g. a stray Cupid, AlphaWolf, WiseElder, Hunter, ...) can
 * interact with whatever scenario a test sets up - a random Cupid pairing
 * two players as lovers, a random AlphaWolf giving the pack a bite chance
 * instead of a kill, a random WiseElder surviving a wolf attack, and so on
 * - making assertions flaky. Tests override whichever players' roles
 * actually matter for their scenario after calling this helper.
 */
function startedGame(roles: Array<[bigint, string]>, options: ConstructorParameters<typeof Game>[0] = { chatId: 1n, mode: 'Normal' }) {
  const game = new Game({ ...options, minPlayers: roles.length });
  for (const [id, name] of roles) game.addPlayer(id, name);
  game.start();
  for (const p of game.players) {
    p.role = ROLE_BIT.Villager;
    p.team = 'Village';
  }
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

  it('marks EveryManForHimself when the Pacifist declares peace with a majority of votes already against them', () => {
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
    // 3 of 5 alive players (a majority) already vote for the Pacifist before peace is declared.
    game.players[1]!.choice = pacifist.id;
    game.players[2]!.choice = pacifist.id;
    game.players[3]!.choice = pacifist.id;
    game.usePacifistPeace(pacifist.id);

    game.resolveLynch();

    expect(pacifist.everyManForHimself).toBe(true);
  });

  it("marks MySweetieSoStrong on the Pacifist's lover when peace saves the lover instead", () => {
    const game = startedGame([
      [1n, 'Pacifist'],
      [2n, 'Lover'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const pacifist = game.players[0]!;
    const lover = game.players[1]!;
    pacifist.role = ROLE_BIT.Pacifist;
    pacifist.loverId = lover.id;
    lover.loverId = pacifist.id;
    lover.inLove = true;
    pacifist.inLove = true;

    game.startDay();
    game.startLynch();
    game.players[2]!.choice = lover.id;
    game.players[3]!.choice = lover.id;
    game.players[4]!.choice = lover.id;
    game.usePacifistPeace(pacifist.id);

    game.resolveLynch();

    expect(lover.mySweetieSoStrong).toBe(true);
    expect(pacifist.everyManForHimself).toBe(false);
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

    expect(game.useBlacksmithSpreadSilver(game.players[0]!.id)).toEqual([
      { type: 'BlacksmithSpreadSilver', playerId: game.players[0]!.id, dayNumber: game.dayNumber },
    ]);
    expect(game.silverSpread).toBe(true);
    expect(game.useBlacksmithSpreadSilver(game.players[0]!.id)).toEqual([]);

    expect(game.useSandmanSleep(game.players[1]!.id)).toEqual([
      { type: 'SandmanUsedSleep', playerId: game.players[1]!.id, dayNumber: game.dayNumber },
    ]);
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
    wolf.team = 'Wolf';
    wolf.drunk = true;
    game.wolfCubKilled = true;

    // Night 1 -> Day 1: the Sandman uses their ability during the day.
    game.startDay();
    expect(game.useSandmanSleep(sandman.id)).toHaveLength(1);
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
    // A live Wolf must remain in play, or Village would already win at the end of night 1 (no more
    // threats), which would end the game before Day/Lynch/Night 2 ever happen.
    game.players[1]!.role = ROLE_BIT.Wolf;
    game.players[1]!.team = 'Wolf';

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

  it('emits WolfPackHasDrunkMembers listing whoever is still sober when part of the pack is drunk', () => {
    const game = startedGame([
      [1n, 'SoberWolf'],
      [2n, 'DrunkWolf'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const sober = game.players[0]!;
    const drunk = game.players[1]!;
    sober.role = ROLE_BIT.Wolf;
    sober.team = 'Wolf';
    drunk.role = ROLE_BIT.Wolf;
    drunk.team = 'Wolf';
    drunk.drunk = true;

    game.startDay();
    game.startLynch();
    game.resolveLynch();
    const events = game.startNight();

    expect(events.some((e) => e.type === 'WolfPackHasDrunkMembers' && e.soberWolfIds.includes(sober.id))).toBe(true);
    expect(events.some((e) => e.type === 'WolfPackHasDrunkMembers' && e.soberWolfIds.includes(drunk.id))).toBe(false);
  });

  it('does not emit WolfPackHasDrunkMembers when nobody in the pack is drunk', () => {
    const game = startedGame([
      [1n, 'Wolf'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    game.players[0]!.role = ROLE_BIT.Wolf;
    game.players[0]!.team = 'Wolf';

    game.startDay();
    game.startLynch();
    game.resolveLynch();
    const events = game.startNight();

    expect(events.some((e) => e.type === 'WolfPackHasDrunkMembers')).toBe(false);
  });

  it('automatically digs graves for a living Grave Digger, counting deaths since the last dig', () => {
    // Disable Grave Digger for the initial balance() - if it randomly landed on some other player
    // pre-override, that player's automatic dig during night 1's enterNight() would set the game's
    // lastGraveDigAt to "start of night 1", *before* the wolf's kill that same night. Node's Date
    // has only millisecond resolution, so that kill can land in the very same millisecond and get
    // filtered out as "not after lastGraveDigAt" - flaky. Keeping the role out of the pool until we
    // explicitly assign it below avoids the whole scenario.
    const game = startedGame(
      [
        [1n, 'GD'],
        [2n, 'Wolf'],
        [3n, 'V3'],
        [4n, 'V4'],
        [5n, 'V5'],
      ],
      { chatId: 1n, mode: 'Normal', disabledRoleFlags: ROLE_VALID | ROLE_BIT.GraveDigger },
    );
    const gd = game.players[0]!;
    gd.role = ROLE_BIT.GraveDigger;
    gd.team = 'Village';
    const wolf = game.players[1]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';
    const victim = game.players[2]!;

    // Night 1 already ran as part of start(), before the Grave Digger role was pinned above, so it
    // never counted - matches the original: a group with no configured Grave Digger never touches
    // lastGrave either.
    expect(gd.dugGravesLastNight).toBe(0);

    wolf.choice = victim.id;
    game.resolveNightActions();
    expect(victim.isDead).toBe(true);

    game.startDay();
    game.startLynch();
    game.resolveLynch();

    const events = game.startNight(); // entering night 2 - this is where the dig actually gets counted

    expect(gd.dugGravesLastNight).toBe(1);
    expect(gd.choice).toBe(-1n);
    expect(events.some((e) => e.type === 'GraveDug' && e.playerId === gd.id && e.graveCount === 1)).toBe(true);
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
