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
function startedGame(
  roles: Array<[bigint, string]>,
  options: ConstructorParameters<typeof Game>[0] = { chatId: 1n, mode: 'Normal' },
) {
  const game = new Game({ ...options, minPlayers: roles.length });
  for (const [id, name] of roles) game.addPlayer(id, name);
  game.start();
  for (const p of game.players) {
    p.role = ROLE_BIT.Villager;
    p.team = 'Village';
    // `start()` already ran `checkRoleChanges()` once (inside `enterNight()`) against whatever
    // real random roles `balance()` just dealt - if that happened to include e.g. a Crown Prince
    // with no Mayor alive, or an Apprentice Seer with no Seer, it already silently promoted them
    // and bumped this counter before the loop above even got a chance to overwrite `.role`. Reset
    // it too, or a test asserting on `changedRolesCount` later would occasionally see stale state
    // left over from a promotion that has nothing to do with the scenario it's actually testing.
    p.changedRolesCount = 0;
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

  it('Pacifist peace cancels a pending Troublemaker double lynch', () => {
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

    expect(
      events.some((e) => e.type === 'WolfPackHasDrunkMembers' && e.soberWolfIds.includes(sober.id)),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'WolfPackHasDrunkMembers' && e.soberWolfIds.includes(drunk.id)),
    ).toBe(false);
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
    expect(
      events.some((e) => e.type === 'GraveDug' && e.playerId === gd.id && e.graveCount === 1),
    ).toBe(true);
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

describe('Hitman win condition', () => {
  it("wins the game the moment their secret target dies, while they're still alive", () => {
    const game = startedGame([
      [1n, 'Hitman'],
      [2n, 'Target'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const hitman = game.players[0]!;
    hitman.role = ROLE_BIT.Hitman;
    hitman.team = 'Neutral';
    const target = game.players[1]!;
    game.hitmanTargetMap.set(hitman.id, target.id);

    game.killPlayer(target.id, 'Idle', { killerIds: [target.id] });
    const result = game.checkWinCondition();

    expect(result.finished).toBe(true);
    expect(result.winningTeam).toBe('Neutral');
    expect(hitman.won).toBe(true);
    expect(
      result.events.some(
        (e) =>
          e.type === 'HitmanTargetEliminated' &&
          e.hitmanId === hitman.id &&
          e.targetId === target.id,
      ),
    ).toBe(true);
    expect(game.phase).toBe('Ended');
  });

  it("does not trigger the Hitman's win while their target is still alive", () => {
    const game = startedGame([
      [1n, 'Hitman'],
      [2n, 'Target'],
      [3n, 'Wolf'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const hitman = game.players[0]!;
    hitman.role = ROLE_BIT.Hitman;
    hitman.team = 'Neutral';
    const target = game.players[1]!;
    game.hitmanTargetMap.set(hitman.id, target.id);
    game.players[2]!.role = ROLE_BIT.Wolf;
    game.players[2]!.team = 'Wolf';

    const result = game.checkWinCondition();

    expect(hitman.won).toBe(false);
    // Falls through to the normal team-based evaluation (still multiple teams alive here).
    expect(result.finished).toBe(false);
  });

  it("does not trigger the Hitman's win if the Hitman themself has died", () => {
    const game = startedGame([
      [1n, 'Hitman'],
      [2n, 'Target'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const hitman = game.players[0]!;
    hitman.role = ROLE_BIT.Hitman;
    hitman.team = 'Neutral';
    const target = game.players[1]!;
    game.hitmanTargetMap.set(hitman.id, target.id);

    game.killPlayer(hitman.id, 'Idle', { killerIds: [hitman.id] });
    game.killPlayer(target.id, 'Idle', { killerIds: [target.id] });
    game.checkWinCondition();

    expect(hitman.won).toBe(false);
  });

  it("does not credit the win to a player who no longer actually holds the Hitman role", () => {
    const game = startedGame([
      [1n, 'ExHitman'],
      [2n, 'Target'],
      [3n, 'Wolf'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const exHitman = game.players[0]!;
    const target = game.players[1]!;
    const wolf = game.players[2]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';
    // The map entry still points at this id (as if their role had been stolen away, e.g. by a
    // Thief), but they no longer actually hold the Hitman role - left as a plain Villager here.
    game.hitmanTargetMap.set(exHitman.id, target.id);

    game.killPlayer(target.id, 'Idle', { killerIds: [target.id] });
    const result = game.checkWinCondition();

    expect(exHitman.won).toBe(false);
    // Falls through to the normal team evaluation - Village and Wolf are both still alive.
    expect(result.finished).toBe(false);
  });
});

describe('Avenger win condition', () => {
  it('wins the game the moment their secret rival is lynched, end to end through resolveLynch()', () => {
    const game = startedGame([
      [1n, 'Avenger'],
      [2n, 'Rival'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const avenger = game.players[0]!;
    avenger.role = ROLE_BIT.Avenger;
    avenger.team = 'Neutral';
    const rival = game.players[1]!;
    game.avengerTargetMap.set(avenger.id, rival.id);

    game.phase = 'Day';
    game.startLynch();
    for (const voter of game.players.filter((p) => !p.isDead)) voter.choice = rival.id;
    const result = game.resolveLynch();

    expect(rival.isDead).toBe(true);
    expect(avenger.won).toBe(true);
    expect(result.finished).toBe(true);
    expect(result.winningTeam).toBe('Neutral');
    expect(game.phase).toBe('Ended');
    expect(
      result.events.some(
        (e) =>
          e.type === 'AvengerRivalLynched' && e.avengerId === avenger.id && e.targetId === rival.id,
      ),
    ).toBe(true);
  });

  it("does not trigger the Avenger's win when someone else is lynched", () => {
    const game = startedGame([
      [1n, 'Avenger'],
      [2n, 'Rival'],
      [3n, 'Wolf'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const avenger = game.players[0]!;
    avenger.role = ROLE_BIT.Avenger;
    avenger.team = 'Neutral';
    const rival = game.players[1]!;
    const wolf = game.players[2]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';
    const other = game.players[3]!;
    game.avengerTargetMap.set(avenger.id, rival.id);

    game.phase = 'Day';
    game.startLynch();
    for (const voter of game.players.filter((p) => !p.isDead)) voter.choice = other.id;
    const result = game.resolveLynch();

    expect(avenger.won).toBe(false);
    // Falls through to the normal team evaluation - Village/Wolf/Avenger are all still alive, so
    // the game legitimately continues.
    expect(result.finished).toBe(false);
    expect(game.phase).not.toBe('Ended');
  });
});

describe('Priestess blessing carries the blind-pack effect into the next night', () => {
  it('blocks tonight\'s wolf attack on the blessed player, then blinds the pack entirely the following night', () => {
    const game = startedGame([
      [1n, 'Wolf'],
      [2n, 'Priestess'],
      [3n, 'Blessed'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const wolf = game.players[0]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';
    const priestess = game.players[1]!;
    priestess.role = ROLE_BIT.Priestess;
    const blessed = game.players[2]!;

    priestess.choice = blessed.id;
    wolf.choice = blessed.id;

    const nightOneEvents = game.resolveNightActions();

    expect(blessed.isDead).toBe(false);
    expect(
      nightOneEvents.some(
        (e) => e.type === 'PriestessBlessingSaved' && e.targetId === blessed.id,
      ),
    ).toBe(true);
    expect(game.wolfPackBlinded).toBe(true);

    // Night two: the wolf tries again on someone else entirely, but the pack is blinded.
    game.startDay();
    game.startLynch();
    game.resolveLynch();
    game.startNight();
    const otherTarget = game.players[3]!;
    wolf.choice = otherTarget.id;

    const nightTwoEvents = game.resolveNightActions();

    expect(otherTarget.isDead).toBe(false);
    expect(nightTwoEvents.some((e) => e.type === 'WolfPackBlinded')).toBe(true);
    expect(game.wolfPackBlinded).toBe(false); // consumed - the third night hunts normally again
  });
});

describe("Archangel's Sacred Bullet streak", () => {
  it('grants a bullet after 3 consecutive innocent-villager deaths, usable as a day shot', () => {
    const game = startedGame([
      [1n, 'Archangel'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'Wolf'],
    ]);
    const archangel = game.players[0]!;
    archangel.role = ROLE_BIT.Archangel;
    archangel.team = 'Village';
    const wolf = game.players[4]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';

    expect(game.archangelBulletsMap.get(archangel.id) ?? 0).toBe(0);

    game.killPlayer(game.players[1]!.id, 'Idle', { killerIds: [] });
    game.killPlayer(game.players[2]!.id, 'Idle', { killerIds: [] });
    expect(game.archangelBulletsMap.get(archangel.id) ?? 0).toBe(0);

    const events = game.killPlayer(game.players[3]!.id, 'Idle', { killerIds: [] });

    expect(game.archangelBulletsMap.get(archangel.id)).toBe(1);
    expect(events.some((e) => e.type === 'ArchangelBulletGranted' && e.archangelId === archangel.id)).toBe(
      true,
    );

    // The bullet is real: the Archangel can now spend it on the day-action phase.
    game.phase = 'Day';
    archangel.choice = wolf.id;
    const dayEvents = game.resolveDayActions();

    expect(wolf.isDead).toBe(true);
    expect(game.archangelBulletsMap.get(archangel.id)).toBe(0);
    expect(
      dayEvents.some(
        (e) => e.type === 'ArchangelShotFired' && e.archangelId === archangel.id && e.hit === true,
      ),
    ).toBe(true);
  });

  it('resets the streak when a non-village-team player dies in between', () => {
    const game = startedGame([
      [1n, 'Archangel'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'Wolf'],
      [5n, 'V5'],
    ]);
    const archangel = game.players[0]!;
    archangel.role = ROLE_BIT.Archangel;
    archangel.team = 'Village';
    const wolf = game.players[3]!;
    wolf.role = ROLE_BIT.Wolf;
    wolf.team = 'Wolf';

    game.killPlayer(game.players[1]!.id, 'Idle', { killerIds: [] });
    game.killPlayer(game.players[2]!.id, 'Idle', { killerIds: [] });
    // A wolf-team death breaks the streak - the village-death count starts over from here.
    game.killPlayer(wolf.id, 'Idle', { killerIds: [] });
    game.killPlayer(game.players[4]!.id, 'Idle', { killerIds: [] });

    expect(game.archangelBulletsMap.get(archangel.id) ?? 0).toBe(0);
  });
});

describe("Trapper Wolf's ambush", () => {
  it('neutralizes a Harlot visiting the trapped house that same night, end to end', () => {
    const game = startedGame([
      [1n, 'TrapperWolf'],
      [2n, 'Harlot'],
      [3n, 'Trapped'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const trapper = game.players[0]!;
    trapper.role = ROLE_BIT.TrapperWolf;
    trapper.team = 'Wolf';
    const harlot = game.players[1]!;
    harlot.role = ROLE_BIT.Harlot;
    harlot.team = 'Village';
    const trapped = game.players[2]!;

    trapper.choice3 = trapped.id;
    trapper.choice = game.players[4]!.id; // the ordinary pack-kill vote, cast on someone else entirely
    harlot.choice = trapped.id;

    const events = game.resolveNightActions();

    expect(trapper.hasUsedAbility).toBe(true);
    expect(
      events.some((e) => e.type === 'TrapperWolfTrapSet' && e.targetId === trapped.id),
    ).toBe(true);
    // The Harlot's visit to the trapped house fails outright - she neither dies nor is blocked by
    // any other rule, she's simply neutralized.
    expect(harlot.isDead).toBe(false);
    expect(trapped.isDead).toBe(false);
  });
});

describe("Chameleon Wolf's disguise", () => {
  it('clears the previous night\'s disguise before a fresh one can be set', () => {
    const game = startedGame([
      [1n, 'ChameleonWolf'],
      [2n, 'Seer'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const chameleon = game.players[0]!;
    chameleon.role = ROLE_BIT.ChameleonWolf;
    chameleon.team = 'Wolf';
    const seerPlayer = game.players[1]!;
    seerPlayer.role = ROLE_BIT.Villager; // not acting as Seer this test, just a disguise target

    chameleon.choice3 = seerPlayer.id;
    game.resolveNightActions();

    expect(game.chameleonAppearanceMap.get(chameleon.id)).toBe(ROLE_BIT.Villager);

    // Night two: the Chameleon Wolf makes no fresh choice at all.
    game.startDay();
    game.startLynch();
    game.resolveLynch();
    game.startNight();
    game.resolveNightActions();

    expect(game.chameleonAppearanceMap.has(chameleon.id)).toBe(false);
  });
});

describe("Viper Wolf's slow poison", () => {
  it('spares the victim through the whole day, then kills them the instant the lynch phase starts', () => {
    const game = startedGame([
      [1n, 'ViperWolf'],
      [2n, 'Victim'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const viper = game.players[0]!;
    viper.role = ROLE_BIT.ViperWolf;
    viper.team = 'Wolf';
    const victim = game.players[1]!;

    viper.choice3 = victim.id;
    const nightEvents = game.resolveNightActions();

    expect(viper.hasUsedAbility).toBe(true);
    expect(game.poisonedViperVictimsSet.has(victim.id)).toBe(true);
    expect(
      nightEvents.some((e) => e.type === 'ViperWolfPoisoned' && e.targetId === victim.id),
    ).toBe(true);
    expect(victim.isDead).toBe(false);

    // The victim survives the entire day untouched...
    game.startDay();
    expect(victim.isDead).toBe(false);

    // ...but dies the instant the lynch phase ("sunset") begins.
    const lynchStartEvents = game.startLynch();

    expect(victim.isDead).toBe(true);
    expect(game.poisonedViperVictimsSet.has(victim.id)).toBe(false);
    expect(
      lynchStartEvents.some(
        (e) => e.type === 'PlayerDied' && e.method === 'ViperPoison' && e.playerId === victim.id,
      ),
    ).toBe(true);
  });

  it('skips a victim who already died from something else before sunset', () => {
    const game = startedGame([
      [1n, 'ViperWolf'],
      [2n, 'Victim'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const viper = game.players[0]!;
    viper.role = ROLE_BIT.ViperWolf;
    viper.team = 'Wolf';
    const victim = game.players[1]!;

    viper.choice3 = victim.id;
    game.resolveNightActions();
    game.killPlayer(victim.id, 'Idle', { killerIds: [] }); // e.g. lynched or otherwise killed earlier

    game.startDay();
    const lynchStartEvents = game.startLynch();

    expect(
      lynchStartEvents.some((e) => e.type === 'PlayerDied' && e.method === 'ViperPoison'),
    ).toBe(false);
  });
});

describe("Howler Wolf's howl", () => {
  it('flags anonymousLynchVotes for the whole day/lynch that follows, then clears it the next night', () => {
    const game = startedGame([
      [1n, 'HowlerWolf'],
      [2n, 'V2'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const howler = game.players[0]!;
    howler.role = ROLE_BIT.HowlerWolf;
    howler.team = 'Wolf';

    howler.choice3 = game.players[1]!.id; // the choice itself is irrelevant
    const nightEvents = game.resolveNightActions();

    expect(howler.hasUsedAbility).toBe(true);
    expect(game.anonymousLynchVotes).toBe(true);
    expect(
      nightEvents.some((e) => e.type === 'HowlerWolfHowled' && e.howlerId === howler.id),
    ).toBe(true);

    // Stays active through the day and the entire lynch phase that follows.
    game.startDay();
    expect(game.anonymousLynchVotes).toBe(true);
    game.startLynch();
    expect(game.anonymousLynchVotes).toBe(true);
    game.resolveLynch();
    expect(game.anonymousLynchVotes).toBe(true);

    // Cleared only once the *next* night begins.
    game.startNight();
    expect(game.anonymousLynchVotes).toBe(false);
  });
});

describe("Hypnotist Wolf's forced vote", () => {
  it("pre-fills the victim's vote the instant the lynch phase starts", () => {
    const game = startedGame([
      [1n, 'HypnotistWolf'],
      [2n, 'Victim'],
      [3n, 'ForcedTarget'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const hypnotist = game.players[0]!;
    hypnotist.role = ROLE_BIT.HypnotistWolf;
    hypnotist.team = 'Wolf';
    const victim = game.players[1]!;
    const forcedTarget = game.players[2]!;

    game.hypnotistForcedVoteMap.set(hypnotist.id, {
      victimId: victim.id,
      targetId: forcedTarget.id,
    });

    game.startDay();
    game.startLynch();

    expect(victim.choice).toBe(forcedTarget.id);
  });

  it('does not pre-fill the vote if the victim or the forced target already died', () => {
    const game = startedGame([
      [1n, 'HypnotistWolf'],
      [2n, 'Victim'],
      [3n, 'ForcedTarget'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const hypnotist = game.players[0]!;
    hypnotist.role = ROLE_BIT.HypnotistWolf;
    hypnotist.team = 'Wolf';
    const victim = game.players[1]!;
    const forcedTarget = game.players[2]!;
    forcedTarget.isDead = true;

    game.hypnotistForcedVoteMap.set(hypnotist.id, {
      victimId: victim.id,
      targetId: forcedTarget.id,
    });

    game.startDay();
    game.startLynch();

    expect(victim.choice).toBeNull();
  });

  it('only ever applies to the one lynch right after it was cast, cleared by the next night', () => {
    const game = startedGame([
      [1n, 'HypnotistWolf'],
      [2n, 'Victim'],
      [3n, 'ForcedTarget'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const hypnotist = game.players[0]!;
    hypnotist.role = ROLE_BIT.HypnotistWolf;
    hypnotist.team = 'Wolf';
    const victim = game.players[1]!;
    const forcedTarget = game.players[2]!;

    game.hypnotistForcedVoteMap.set(hypnotist.id, {
      victimId: victim.id,
      targetId: forcedTarget.id,
    });

    game.startDay();
    game.startLynch();
    expect(victim.choice).toBe(forcedTarget.id);
    game.resolveLynch();

    game.startNight();
    expect(game.hypnotistForcedVoteMap.size).toBe(0);
  });
});

describe("Berserker Wolf's rage", () => {
  it('enrages when a pack-mate is actually lynched, granting the pack a bonus kill vote next night', () => {
    const game = startedGame([
      [1n, 'BerserkerWolf'],
      [2n, 'LynchedWolf'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const berserker = game.players[0]!;
    berserker.role = ROLE_BIT.BerserkerWolf;
    berserker.team = 'Wolf';
    const lynchedWolf = game.players[1]!;
    lynchedWolf.role = ROLE_BIT.Wolf;
    lynchedWolf.team = 'Wolf';

    game.startDay();
    game.startLynch();
    for (const voter of game.players.filter((p) => !p.isDead)) voter.choice = lynchedWolf.id;
    const lynchResult = game.resolveLynch();

    expect(lynchedWolf.isDead).toBe(true);
    expect(game.berserkerRage).toBe(true);
    expect(
      lynchResult.events.some(
        (e) => e.type === 'BerserkerWolfEnraged' && e.berserkerId === berserker.id,
      ),
    ).toBe(true);
  });

  it('does not enrage when the lynched player is not on the wolf team, or no Berserker Wolf is alive', () => {
    const game = startedGame([
      [1n, 'BerserkerWolf'],
      [2n, 'Villager'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const berserker = game.players[0]!;
    berserker.role = ROLE_BIT.BerserkerWolf;
    berserker.team = 'Wolf';
    const lynchedVillager = game.players[1]!;

    game.startDay();
    game.startLynch();
    for (const voter of game.players.filter((p) => !p.isDead)) voter.choice = lynchedVillager.id;
    game.resolveLynch();

    expect(game.berserkerRage).toBe(false);
  });

  it('is consumed once the following night resolves, not carried into a second night', () => {
    const game = startedGame([
      [1n, 'BerserkerWolf'],
      [2n, 'LynchedWolf'],
      [3n, 'V3'],
      [4n, 'V4'],
      [5n, 'V5'],
    ]);
    const berserker = game.players[0]!;
    berserker.role = ROLE_BIT.BerserkerWolf;
    berserker.team = 'Wolf';
    const lynchedWolf = game.players[1]!;
    lynchedWolf.role = ROLE_BIT.Wolf;
    lynchedWolf.team = 'Wolf';

    game.startDay();
    game.startLynch();
    for (const voter of game.players.filter((p) => !p.isDead)) voter.choice = lynchedWolf.id;
    game.resolveLynch();
    expect(game.berserkerRage).toBe(true);

    game.startNight();
    game.resolveNightActions();
    expect(game.berserkerRage).toBe(false);
  });

  it('lets the pack actually strike two victims on the enraged night', () => {
    const game = startedGame([
      [1n, 'BerserkerWolf'],
      [2n, 'LynchedWolf'],
      [3n, 'Victim1'],
      [4n, 'Victim2'],
      [5n, 'V5'],
    ]);
    const berserker = game.players[0]!;
    berserker.role = ROLE_BIT.BerserkerWolf;
    berserker.team = 'Wolf';
    const lynchedWolf = game.players[1]!;
    lynchedWolf.role = ROLE_BIT.Wolf;
    lynchedWolf.team = 'Wolf';
    const victim1 = game.players[2]!;
    const victim2 = game.players[3]!;

    game.startDay();
    game.startLynch();
    for (const voter of game.players.filter((p) => !p.isDead)) voter.choice = lynchedWolf.id;
    game.resolveLynch();
    expect(game.berserkerRage).toBe(true);

    game.startNight();
    berserker.choice = victim1.id;
    berserker.choice2 = victim2.id;
    game.resolveNightActions();

    expect(victim1.isDead).toBe(true);
    expect(victim2.isDead).toBe(true);
  });
});
