/**
 * Detects which of the single-game-derivable achievements (see `catalog.ts`) a finished game's
 * players just earned. Pure and DB-free by design (matches this project's domain/infrastructure
 * split): the caller (`GameLoop.finish()`) supplies the final `Player[]` roster plus every
 * `GameEvent[]` batch the game emitted (one batch per night/day/lynch resolution, in
 * chronological order - see `GameLoop`'s `eventBatches`), and gets back which new achievement
 * codes each player earned *this game*. Achievements that need history from OTHER games
 * (`Dedicated`, `Explorer`, `BlackSheep`'s streak, ...) are intentionally not here - those are
 * computed from the `game_players`/`game_kills` tables directly in `AchievementRepository`.
 *
 * Not every one of the 102 catalog entries is implemented. What's left out, each marked in-line
 * below, is either a feature this migration explicitly left out of scope (language packs, the
 * donor/dev-only easter eggs, calendar events - see the README/audit) or - down to a single
 * remaining case, #45 `CultFodder` - an achievement that needs to know which cultist a Cult
 * Hunter conversion specifically targeted, which no event carries today.
 * (`GunnerSaves` #48 and `ReallyBadLuck` #86 used to be deferred for a similar reason - a
 * reconstructed near-miss win-condition chain - until `GunnerPreventsWolfWin`/
 * `SerialKillerRandomKill` turned out to already carry everything needed; see those two entries.)
 */

import { ROLE_BIT, type Role } from '../roles/role.js';
import { WOLF_ROLES } from '../game/game-balancing.js';
import type { GameEvent } from '../game/game-event.js';
import type { GameMode } from '../game/game-mode.js';
import type { Player } from '../game/player.js';
import type { Team } from '../game/team.js';
import type { AchievementCode } from './catalog.js';

export interface AchievementEvalContext {
  players: readonly Player[];
  mode: GameMode;
  winningTeam: Team | undefined;
  /** One entry per night/day/lynch resolution, in the order they happened. */
  eventBatches: readonly (readonly GameEvent[])[];
  /** Mirrors the group's `ShowRolesDeath` flag at the time this game was played. */
  showRolesOnDeath: boolean;
}

const BAD_TEAMS: ReadonlySet<Team> = new Set([
  'Wolf',
  'Cult',
  'SerialKiller',
  'Arsonist',
  'Tanner',
]);

function isWolf(role: Role): boolean {
  return WOLF_ROLES.includes(role);
}

/**
 * The id of whoever this game's first lynch resolved on, or `null` if nobody was ever lynched.
 * Shared by the single-game `LackOfTrust` check below and `AchievementRepository`'s cross-game
 * `BlackSheep` streak (which needs the same signal but persisted across games).
 */
export function firstLynchVictimId(eventBatches: readonly (readonly GameEvent[])[]): bigint | null {
  for (const batch of eventBatches) {
    for (const event of batch) {
      if (event.type === 'PlayerDied' && event.method === 'Lynch') return event.playerId;
    }
  }
  return null;
}

class UnlockCollector {
  private readonly unlocks = new Map<bigint, Set<AchievementCode>>();

  grant(playerId: bigint, code: AchievementCode): void {
    const set = this.unlocks.get(playerId) ?? new Set<AchievementCode>();
    set.add(code);
    this.unlocks.set(playerId, set);
  }

  grantAll(playerIds: Iterable<bigint>, code: AchievementCode): void {
    for (const id of playerIds) this.grant(id, code);
  }

  toMap(): Map<bigint, AchievementCode[]> {
    const result = new Map<bigint, AchievementCode[]>();
    for (const [id, set] of this.unlocks) result.set(id, [...set]);
    return result;
  }
}

export function evaluateGameAchievements(
  ctx: AchievementEvalContext,
): Map<bigint, AchievementCode[]> {
  const { players } = ctx;
  const out = new UnlockCollector();
  const allEvents = ctx.eventBatches.flat();
  const deaths = allEvents.filter(
    (e): e is Extract<GameEvent, { type: 'PlayerDied' }> => e.type === 'PlayerDied',
  );
  const findPlayer = (id: bigint) => players.find((p) => p.id === id);

  // #1 WelcomeToHell - play a game.
  out.grantAll(
    players.map((p) => p.id),
    'WelcomeToHell',
  );
  // #2 WelcomeToAsylum - play a chaos game.
  if (ctx.mode === 'Chaos')
    out.grantAll(
      players.map((p) => p.id),
      'WelcomeToAsylum',
    );
  // #3 AlzheimerPatient, #4 OHAIDER, #7 Linguist, #8 NoIdeaWhat, #11 Naughty - language-pack /
  // dev-account features, out of scope for this migration.
  // #5 SpyVsSpy - secret mode (no role reveal).
  if (!ctx.showRolesOnDeath)
    out.grantAll(
      players.map((p) => p.id),
      'SpyVsSpy',
    );
  // #6 Explorer - cross-game group diversity, computed in AchievementRepository.
  // #9 Enochlophobia - 35 player game.
  if (players.length >= 35)
    out.grantAll(
      players.map((p) => p.id),
      'Enochlophobia',
    );
  // #10 Introvert - 5 player game (the minimum).
  if (players.length === 5)
    out.grantAll(
      players.map((p) => p.id),
      'Introvert',
    );
  // #12 Dedicated, #13 Obsessed, #14 HereJohnny, #15 GotYourBack, #19 Survivalist, #51 Veteran -
  // cumulative cross-game counters, computed in AchievementRepository.
  // #16 Masochist - win a game as the Tanner.
  for (const p of players) if (p.role === ROLE_BIT.Tanner && p.won) out.grant(p.id, 'Masochist');
  // #17 Wobble - survive a game as the drunk (10+ players).
  for (const p of players)
    if (p.role === ROLE_BIT.Drunk && !p.isDead && players.length >= 10) out.grant(p.id, 'Wobble');
  // #18 Inconspicuous - never received a single lynch vote all game, and survived (20+ player
  // games only, mirroring the original's `Players.Count < 20` exemption).
  if (players.length >= 20) {
    for (const p of players) if (!p.hasBeenVoted && !p.isDead) out.grant(p.id, 'Inconspicuous');
  }
  // #20 BlackSheep - cross-game "lynched first" streak, computed in AchievementRepository (using
  // the single-game "was this the game's first lynch victim" signal below).
  // #21 Promiscuous - as the Harlot, 5+ distinct visits, never staying home or repeating one.
  for (const p of players) {
    if (!p.hasStayedHome && !p.hasRepeatedVisit && p.playersVisited.size >= 5)
      out.grant(p.id, 'Promiscuous');
  }
  // #22 MasonBrother - two or more surviving masons.
  {
    const masons = players.filter((p) => p.role === ROLE_BIT.Mason && !p.isDead);
    if (masons.length >= 2)
      out.grantAll(
        masons.map((p) => p.id),
        'MasonBrother',
      );
  }
  // #23 DoubleShifter - changed roles twice in the game (cult conversion doesn't bump this
  // counter - see role-changes.ts).
  for (const p of players) if (p.changedRolesCount >= 2) out.grant(p.id, 'DoubleShifter');
  // #24 HeyManNiceShot - the Hunter's dying shot (not a counter-attack) kills a wolf or the SK.
  // A HunterShot death is a dying shot (as opposed to the separate HunterCounterAttack event)
  // precisely when the shooter themselves already has their own death recorded earlier.
  for (const death of deaths) {
    if (death.method !== 'HunterShot') continue;
    const shooterId = death.killerIds[0];
    if (shooterId === undefined) continue;
    const shooterAlreadyDied = deaths.some((d) => d.playerId === shooterId);
    if (!shooterAlreadyDied) continue;
    const victim = findPlayer(death.playerId);
    if (victim && (isWolf(victim.role) || victim.role === ROLE_BIT.SerialKiller))
      out.grant(shooterId, 'HeyManNiceShot');
  }
  // #25 DontStayHome - a wolf kills a Harlot who stayed home (an 'Eat' death, as opposed to
  // 'VisitWolf'/'VisitVictim' - those mean she was out visiting someone).
  for (const death of deaths) {
    if (death.method !== 'Eat') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role === ROLE_BIT.Harlot) out.grantAll(death.killerIds, 'DontStayHome');
  }
  // #26 DoubleVision - two players simultaneously hold the Seer role (a Doppelganger copied it
  // without the original losing it).
  {
    const seers = players.filter((p) => p.role === ROLE_BIT.Seer);
    if (seers.length > 1)
      out.grantAll(
        seers.map((p) => p.id),
        'DoubleVision',
      );
  }
  // #28 ShouldHaveKnown - the Seer's vision lands on the Beholder.
  for (const event of allEvents) {
    if (event.type === 'SeerVision' && event.shownRole === ROLE_BIT.Beholder)
      out.grant(event.playerId, 'ShouldHaveKnown');
  }
  // #27 DoubleKill - be part of the Serial Killer/Hunter standoff-win ending.
  if (ctx.winningTeam === 'SKHunter') {
    for (const p of players)
      if (p.role === ROLE_BIT.SerialKiller || p.role === ROLE_BIT.Hunter)
        out.grant(p.id, 'DoubleKill');
  }
  // #29 LackOfTrust - the Seer is the game's first lynch victim.
  {
    const firstVictimId = firstLynchVictimId(ctx.eventBatches);
    const victim = firstVictimId !== null ? findPlayer(firstVictimId) : undefined;
    if (victim?.role === ROLE_BIT.Seer) out.grant(victim.id, 'LackOfTrust');
  }
  // #30 BloodyNight - 4+ people die in the same night (i.e. within one resolution batch).
  for (const batch of ctx.eventBatches) {
    const nightDeaths = batch.filter(
      (e): e is Extract<GameEvent, { type: 'PlayerDied' }> => e.type === 'PlayerDied' && e.isNight,
    );
    if (nightDeaths.length >= 4)
      out.grantAll(
        nightDeaths.map((d) => d.playerId),
        'BloodyNight',
      );
  }
  // #31 ChangingSides - changed roles in the game, and won.
  for (const p of players) if (p.changedRolesCount >= 1 && p.won) out.grant(p.id, 'ChangingSides');
  // #32 ForbiddenLove - win as a wolf/villager lover couple.
  for (const event of allEvents) {
    if (event.type !== 'LoversCreated') continue;
    const lover1 = findPlayer(event.lover1Id);
    const lover2 = findPlayer(event.lover2Id);
    if (!lover1 || !lover2 || !lover1.won || !lover2.won) continue;
    const teams = new Set([lover1.team, lover2.team]);
    if (teams.has('Wolf') && teams.has('Village')) {
      out.grant(lover1.id, 'ForbiddenLove');
      out.grant(lover2.id, 'ForbiddenLove');
    }
  }
  // #33 Developer - meta (a merged PR), not a gameplay achievement. Out of scope here.
  // #34 FirstStone - first to cast a live lynch vote, 5 times in one game.
  for (const p of players) if (p.firstToVoteCount >= 5) out.grant(p.id, 'FirstStone');
  // #35 SmartGunner - both of the Gunner's bullets hit a wolf/Serial Killer/cultist.
  for (const p of players)
    if (p.role === ROLE_BIT.Gunner && p.bulletHitBaddies >= 2) out.grant(p.id, 'SmartGunner');
  // #36 Streetwise - snooped a different threat 4 nights running as the Detective.
  for (const p of players) if (p.streetwise) out.grant(p.id, 'Streetwise');
  // #37 OnlineDating - auto-picked as a lover because Cupid didn't choose in time.
  for (const event of allEvents) {
    if (event.type !== 'LoversCreated') continue;
    const lover1 = findPlayer(event.lover1Id);
    const lover2 = findPlayer(event.lover2Id);
    if (lover1?.speedDating) out.grant(lover1.id, 'OnlineDating');
    if (lover2?.speedDating) out.grant(lover2.id, 'OnlineDating');
  }
  // #38 BrokenClock - at least two of the Fool's (random) visions turned out correct.
  for (const p of players) if (p.foolCorrectSeeCount >= 2) out.grant(p.id, 'BrokenClock');
  // #39 SoClose - the Tanner was tied for the most lynch votes.
  for (const p of players) if (p.soClose) out.grant(p.id, 'SoClose');
  // #43 TannerOverkill - literally everyone else alive voted to lynch the Tanner.
  for (const p of players) if (p.tannerOverkill) out.grant(p.id, 'TannerOverkill');
  // #40 CultCon - 10+ cultists alive at game end.
  {
    const cultists = players.filter((p) => p.team === 'Cult' && !p.isDead);
    if (cultists.length >= 10)
      out.grantAll(
        cultists.map((p) => p.id),
        'CultCon',
      );
  }
  // #41 SelfLoving - Cupid picks themselves as one of the lovers.
  for (const event of allEvents) {
    if (event.type !== 'LoversCreated') continue;
    const lover1 = findPlayer(event.lover1Id);
    const lover2 = findPlayer(event.lover2Id);
    if (lover1?.role === ROLE_BIT.Cupid) out.grant(lover1.id, 'SelfLoving');
    if (lover2?.role === ROLE_BIT.Cupid) out.grant(lover2.id, 'SelfLoving');
  }
  // #42 ShouldveMentioned - a wolf's pack ate their own lover on any night after the first
  // (approximated the same way as #50 OhShi: batch 0 is night 1).
  for (let i = 1; i < ctx.eventBatches.length; i++) {
    for (const event of ctx.eventBatches[i]!) {
      if (event.type !== 'PlayerDied' || !event.isNight || event.method === 'LoverDied') continue;
      const victim = findPlayer(event.playerId);
      if (victim?.loverId == null) continue;
      for (const killerId of event.killerIds) {
        if (killerId === victim.loverId) {
          const killer = findPlayer(killerId);
          if (killer && isWolf(killer.role)) out.grant(killerId, 'ShouldveMentioned');
        }
      }
    }
  }
  // #44 SerialSamaritan - the Serial Killer kills 3+ wolves in the game.
  {
    const skWolfKills = new Map<bigint, number>();
    for (const death of deaths) {
      if (death.method !== 'SerialKilled') continue;
      const victim = findPlayer(death.playerId);
      if (!victim || !isWolf(victim.role)) continue;
      for (const killerId of death.killerIds)
        skWolfKills.set(killerId, (skWolfKills.get(killerId) ?? 0) + 1);
    }
    for (const [id, count] of skWolfKills) if (count >= 3) out.grant(id, 'SerialSamaritan');
  }
  // #45 CultFodder - needs to know which cultist was picked to attempt the Cult Hunter
  // conversion specifically (as opposed to any other target); not carried by any event. Deferred.
  // #46 LoneWolf - the only wolf in a 10+ player chaos game, and won.
  if (ctx.mode === 'Chaos' && players.length >= 10) {
    const wolves = players.filter((p) => isWolf(p.role));
    if (wolves.length === 1 && wolves[0]!.won) out.grant(wolves[0]!.id, 'LoneWolf');
  }
  // #47 PackHunter - 7+ living wolves at once. Approximated from the final roster (a lower bound
  // if wolves died later in the game after peaking higher).
  {
    const livingWolves = players.filter((p) => isWolf(p.role) && !p.isDead);
    if (livingWolves.length >= 7)
      out.grantAll(
        livingWolves.map((p) => p.id),
        'PackHunter',
      );
  }
  // #48 GunnerSaves - mirrors the original's `CheckForGameEnd` branch: wolves have just caught up
  // to (or are one short of, with two wolves in love) the rest, but a living Gunner's remaining
  // bullet keeps the game from ending to the wolves - `win-condition.ts` already detects exactly
  // this and emits `GunnerPreventsWolfWin`, so this only needs to react to it. Grants every
  // *current* Village-team player rather than a snapshot of who was alive at that exact moment
  // (not retained by any event) - team never changes on death, only via a role transform, so this
  // slightly overgrants only in the rare case a village player transforms teams afterward.
  if (allEvents.some((e) => e.type === 'GunnerPreventsWolfWin')) {
    out.grantAll(
      players.filter((p) => p.team === 'Village').map((p) => p.id),
      'GunnerSaves',
    );
  }
  // #49 LongHaul - real-world wall-clock duration; the pure evaluator has no notion of time, so
  // this is computed in `AchievementRepository.recordGameResult()` from the DB's
  // `startedAt`/`endedAt` instead.
  // #50 OhShi - kill your own lover on the first night (approximated as the first batch).
  if (ctx.eventBatches[0]) {
    for (const event of ctx.eventBatches[0]) {
      if (event.type !== 'PlayerDied') continue;
      const victim = findPlayer(event.playerId);
      if (victim?.loverId != null && event.killerIds.includes(victim.loverId))
        out.grant(victim.loverId, 'OhShi');
    }
  }
  // #52 NoSorcery - a wolf pack eats their own Sorcerer.
  for (const death of deaths) {
    if (death.method !== 'Eat') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role === ROLE_BIT.Sorcerer) out.grantAll(death.killerIds, 'NoSorcery');
  }
  // #53 CultistTracker - the Cultist Hunter kills 3+ cultists in the game.
  {
    const counts = new Map<bigint, number>();
    for (const event of allEvents) {
      if (event.type !== 'CultistHunterKilledCultist') continue;
      counts.set(event.cultistHunterId, (counts.get(event.cultistHunterId) ?? 0) + 1);
    }
    for (const [id, count] of counts) if (count >= 3) out.grant(id, 'CultistTracker');
  }
  // #54 ImNotDrunk - the Clumsy Guy's vote landed where they meant it to, 3+ times.
  for (const p of players)
    if (p.role === ROLE_BIT.ClumsyGuy && p.clumsyCorrectLynchCount >= 3)
      out.grant(p.id, 'ImNotDrunk');
  // #56 DidYouGuardYourself - guarded a wolf who wasn't actually under attack, 3+ times.
  for (const p of players)
    if (p.role === ROLE_BIT.GuardianAngel && p.gaGuardWolfCount >= 3)
      out.grant(p.id, 'DidYouGuardYourself');
  // #55 WuffieCult - the Alpha Wolf successfully bites 3+ victims into wolves. `BittenPlayerTurnedWolf`
  // doesn't carry the biter's id, so this assumes the game's single AlphaWolf did the biting.
  {
    const bites = allEvents.filter((e) => e.type === 'BittenPlayerTurnedWolf').length;
    const alpha = players.find((p) => p.role === ROLE_BIT.AlphaWolf);
    if (alpha && bites >= 3) out.grant(alpha.id, 'WuffieCult');
  }
  // #57 SpoiledRichBrat - the Prince gets lynched (the one-time reveal-survival already used up).
  for (const death of deaths) {
    if (death.method !== 'Lynch') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role === ROLE_BIT.Prince) out.grant(victim.id, 'SpoiledRichBrat');
  }
  // #58 ThreeLittleWolves - the Sorcerer survives with 3+ living wolves at game end.
  {
    const sorcerer = players.find((p) => p.role === ROLE_BIT.Sorcerer && !p.isDead);
    const livingWolves = players.filter((p) => isWolf(p.role) && !p.isDead);
    if (sorcerer && livingWolves.length >= 3) out.grant(sorcerer.id, 'ThreeLittleWolves');
  }
  // #59 President - the Mayor cast 3+ lynch votes after revealing (each worth double).
  for (const p of players)
    if (p.role === ROLE_BIT.Mayor && p.mayorLynchAfterRevealCount >= 3)
      out.grant(p.id, 'President');
  // #60 IHelped - the wolf pack scored two successful attacks in one night; grant to whichever
  // Wolf Cub most recently died before that (mirrors `OrderByDescending(TimeDied)`).
  // #93 IncreaseThePack - same night, and both attacks turned their targets into wolves (bites,
  // not kills) - grant to the Alpha Wolf who did the biting.
  {
    let lastDeadCubId: bigint | null = null;
    for (const batch of ctx.eventBatches) {
      for (const event of batch) {
        if (event.type === 'WolfCubKilled') lastDeadCubId = event.playerId;
        if (event.type !== 'WolfPackAteTwice') continue;
        if (lastDeadCubId !== null) out.grant(lastDeadCubId, 'IHelped');
        if (event.alphaId !== null) {
          const bitesThisBatch = batch.filter((e) => e.type === 'PlayerBitten').length;
          if (bitesThisBatch === 2) out.grant(event.alphaId, 'IncreaseThePack');
        }
      }
    }
  }
  // #61 ItWasABusyNight - visited by 3+ different actions in the same night.
  for (const p of players) if (p.busyNight) out.grant(p.id, 'ItWasABusyNight');
  // #62 StrongestAlpha - the Alpha Wolf successfully infected the Serial Killer.
  for (const p of players) if (p.strongestAlpha) out.grant(p.id, 'StrongestAlpha');
  // #63 AmIYourSeer - as the Fool, the random vision landed on the Beholder, matching the target.
  for (const p of players) if (p.foolCorrectlySeenBH) out.grant(p.id, 'AmIYourSeer');
  // #64 DemotedByTheDeath - the Hunter's final shot kills the Wise Elder (Game.killPlayer demotes
  // them to Villager in the same call, mirroring the Gunner/Chemist equivalents).
  for (const event of allEvents) {
    if (event.type === 'HunterLostPowerToWiseElder') out.grant(event.playerId, 'DemotedByTheDeath');
  }
  // #65 WastedSilver - the Blacksmith spreads their silver dust the same day the Sandman puts
  // everyone to sleep.
  {
    const silverDays = new Set(
      allEvents.filter((e) => e.type === 'BlacksmithSpreadSilver').map((e) => e.dayNumber),
    );
    for (const event of allEvents) {
      if (event.type === 'SandmanUsedSleep' && silverDays.has(event.dayNumber)) {
        const blacksmith = players.find((p) => p.role === ROLE_BIT.Blacksmith);
        if (blacksmith) out.grant(blacksmith.id, 'WastedSilver');
      }
    }
  }
  // #66 Trustworthy - as the Wolf Man, survived and won after the real Seer checked them.
  for (const p of players)
    if (p.role === ROLE_BIT.WolfMan && p.trustworthy && !p.isDead && p.won)
      out.grant(p.id, 'Trustworthy');
  // #67 DeepLove - as the Doppelganger, chose their own lover as role model.
  for (const p of players) {
    if (
      p.originalRole === ROLE_BIT.Doppelganger &&
      p.roleModel !== null &&
      p.roleModel === p.loverId
    ) {
      out.grant(p.id, 'DeepLove');
    }
  }
  // #68 TimeToRetire - the Sorcerer was the last one standing in a "no one wins" ending.
  if (ctx.winningTeam === undefined) {
    const sorcerer = players.find((p) => p.role === ROLE_BIT.Sorcerer && !p.isDead);
    if (sorcerer) out.grant(sorcerer.id, 'TimeToRetire');
  }
  // #69 SeeingBetweenTeams - the two Cupid-created lovers are a Seer/Sorcerer pair.
  for (const event of allEvents) {
    if (event.type !== 'LoversCreated') continue;
    const lover1 = findPlayer(event.lover1Id);
    const lover2 = findPlayer(event.lover2Id);
    const roles = new Set([lover1?.role, lover2?.role]);
    if (roles.has(ROLE_BIT.Seer) && roles.has(ROLE_BIT.Sorcerer)) {
      if (lover1) out.grant(lover1.id, 'SeeingBetweenTeams');
      if (lover2) out.grant(lover2.id, 'SeeingBetweenTeams');
    }
  }
  // #70 JustABeardyGuy - the Wolf Man got bitten by the Alpha Wolf and turned into a real werewolf.
  for (const event of allEvents) {
    if (event.type !== 'BittenPlayerTurnedWolf') continue;
    if (findPlayer(event.playerId)?.originalRole === ROLE_BIT.WolfMan)
      out.grant(event.playerId, 'JustABeardyGuy');
  }
  // #71 ThatCameUnexpected - the Tanner is lynched, wins, and 3 or fewer players remained
  // (approximated from the post-lynch survivor count).
  for (const death of deaths) {
    if (death.method !== 'Lynch') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role !== ROLE_BIT.Tanner || !victim.won) continue;
    const remaining = players.filter((p) => !p.isDead).length;
    if (remaining <= 3) out.grant(victim.id, 'ThatCameUnexpected');
  }
  // #72 NowImBlind - the Oracle failed to get a vision because every other role is already
  // accounted for.
  for (const event of allEvents) {
    if (event.type === 'OracleVision' && event.shownRole === null)
      out.grant(event.playerId, 'NowImBlind');
  }
  // #73 EveryManForHimself, #74 MySweetieSoStrong - the Pacifist's peace declaration cancelled a
  // lynch that already had a majority of votes against them (or their lover).
  for (const p of players) if (p.everyManForHimself) out.grant(p.id, 'EveryManForHimself');
  for (const p of players) if (p.mySweetieSoStrong) out.grant(p.id, 'MySweetieSoStrong');
  // #75 CultLeader - a founding cultist (converted on day 0, i.e. never converted at all) who
  // survives and wins.
  for (const p of players)
    if (p.role === ROLE_BIT.Cultist && p.dayCult === 0 && !p.isDead && p.won)
      out.grant(p.id, 'CultLeader');
  // #76 ThanksJunior - a still-sober wolf can act while the rest of the pack sleeps off eating
  // the Drunk.
  for (const event of allEvents) {
    if (event.type === 'WolfPackHasDrunkMembers') out.grantAll(event.soberWolfIds, 'ThanksJunior');
  }
  // #77 DeathVillage - the game ends with no winner.
  if (ctx.winningTeam === undefined)
    out.grantAll(
      players.map((p) => p.id),
      'DeathVillage',
    );
  // #78 ILostMyWisdom - the Wise Elder changed role (turned wolf via a bite - the only way a Wise
  // Elder's role changes in this port).
  for (const p of players)
    if (p.originalRole === ROLE_BIT.WiseElder && p.changedRolesCount >= 1)
      out.grant(p.id, 'ILostMyWisdom');
  // #79 Affectionate - the Harlot visits their own lover.
  for (const event of allEvents) {
    if (event.type !== 'HarlotVisited') continue;
    const harlot = findPlayer(event.harlotId);
    if (harlot?.loverId === event.targetId) out.grant(harlot.id, 'Affectionate');
  }
  // #80 LuckyDay - the Alpha Wolf bit the Drunk instead of eating them (staying sober, since only
  // the eat path puts the pack to sleep).
  for (const event of allEvents) {
    if (event.type === 'AlphaWolfLuckyDay') out.grant(event.alphaId, 'LuckyDay');
  }
  // #81 ConditionRed - the game's last wolf eats the Traitor (approximated: some wolf ate the
  // Traitor, and only one wolf-team player is left alive at game end).
  for (const death of deaths) {
    if (death.method !== 'Eat') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role !== ROLE_BIT.Traitor) continue;
    const livingWolves = players.filter((p) => isWolf(p.role) && !p.isDead);
    if (livingWolves.length === 1) out.grant(livingWolves[0]!.id, 'ConditionRed');
  }
  // #82 Indestructible - chose themselves as their own role model.
  for (const event of allEvents) {
    if (event.type === 'RoleModelChosen' && event.roleModelId === event.playerId)
      out.grant(event.playerId, 'Indestructible');
  }
  // #83 PsychopathKiller - the Serial Killer wins a 35-player game.
  for (const p of players)
    if (p.role === ROLE_BIT.SerialKiller && p.won && players.length >= 35)
      out.grant(p.id, 'PsychopathKiller');
  // #84 TodaysSpecial - calendar/event-day achievement, out of scope.
  // #85 RomeoAndJuliet - in love with the Tanner, and won by lynching them.
  for (const death of deaths) {
    if (death.method !== 'Lynch') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role !== ROLE_BIT.Tanner || !victim.won) continue;
    const lover = victim.loverId ? findPlayer(victim.loverId) : undefined;
    if (lover?.won) out.grant(lover.id, 'RomeoAndJuliet');
  }
  // #86 ReallyBadLuck - mirrors the original's exact chain: the Serial Killer stumbled a dug
  // grave the night before, so tonight's kill gets randomly re-targeted
  // (`SerialKillerRandomKill`) - and *that* random target just happens to be the one the Guardian
  // Angel is protecting (`GuardianAngelBlockedSerialKiller` for the same id, in the very same
  // night's batch - `resolveSerialKillerNight` always emits both together, never across nights).
  {
    const sk = players.find((p) => p.role === ROLE_BIT.SerialKiller);
    if (sk) {
      const gotReallyBadLuck = ctx.eventBatches.some((batch) => {
        const randomKill = batch.find(
          (e): e is Extract<GameEvent, { type: 'SerialKillerRandomKill' }> =>
            e.type === 'SerialKillerRandomKill',
        );
        if (!randomKill) return false;
        return batch.some(
          (e) =>
            e.type === 'GuardianAngelBlockedSerialKiller' && e.targetId === randomKill.newTargetId,
        );
      });
      if (gotReallyBadLuck) out.grant(sk.id, 'ReallyBadLuck');
    }
  }
  // #87 Domino - a Hunter's shot kills another Hunter (who then gets their own dying shot too).
  for (const death of deaths) {
    if (death.method !== 'HunterShot') continue;
    const victim = findPlayer(death.playerId);
    const shooterId = death.killerIds[0];
    if (victim?.role !== ROLE_BIT.Hunter || shooterId === undefined) continue;
    const shooter = findPlayer(shooterId);
    if (shooter?.role === ROLE_BIT.Hunter) out.grant(shooterId, 'Domino');
  }
  // #88 DoubleShot - the Hunter or Gunner shoots someone on a "bad" team who's in love with
  // another "bad" team player.
  for (const death of deaths) {
    if (death.method !== 'HunterShot' && death.method !== 'Shoot') continue;
    const victim = findPlayer(death.playerId);
    const shooterId = death.killerIds[0];
    if (!victim || shooterId === undefined || !victim.loverId) continue;
    const lover = findPlayer(victim.loverId);
    if (lover && BAD_TEAMS.has(victim.team) && BAD_TEAMS.has(lover.team))
      out.grant(shooterId, 'DoubleShot');
  }
  // #89/#90 PlayingWithTheFire / Firework - the Arsonist burns 5+ / 10+ houses in one night.
  for (const batch of ctx.eventBatches) {
    const burns = batch.filter(
      (e): e is Extract<GameEvent, { type: 'PlayerDied' }> =>
        e.type === 'PlayerDied' && e.method === 'Burn',
    );
    if (burns.length === 0) continue;
    const arsonistId = burns[0]!.killerIds[0];
    if (arsonistId === undefined) continue;
    if (burns.length >= 5) out.grant(arsonistId, 'PlayingWithTheFire');
    if (burns.length >= 10) out.grant(arsonistId, 'Firework');
  }
  // #91 ColdAsIce - the Snow Wolf freezes the Harlot. `PlayerFrozen` doesn't carry the freezer's
  // id, so this assumes the game's single Snow Wolf did the freezing.
  {
    const froze = allEvents.some((e) => {
      if (e.type !== 'PlayerFrozen' || e.cause !== 'SnowWolf') return false;
      return findPlayer(e.playerId)?.role === ROLE_BIT.Harlot;
    });
    const snowWolf = players.find((p) => p.role === ROLE_BIT.SnowWolf);
    if (froze && snowWolf) out.grant(snowWolf.id, 'ColdAsIce');
  }
  // #92 GoodChoiceForYou - the Chemist successfully poisons a target (and survives, implicit in a
  // 'Chemistry' death that isn't their own) 3 times in the game.
  {
    const counts = new Map<bigint, number>();
    for (const death of deaths) {
      if (death.method !== 'Chemistry' || death.killerIds.length === 0) continue;
      const chemistId = death.killerIds[0]!;
      if (death.playerId === chemistId) continue; // the backfire case - the "victim" is the Chemist themselves
      counts.set(chemistId, (counts.get(chemistId) ?? 0) + 1);
    }
    for (const [id, count] of counts) if (count >= 3) out.grant(id, 'GoodChoiceForYou');
  }
  // #94 Firefighter - the Guardian Angel cleans kerosene off 3+ houses in the game.
  {
    const cleans = allEvents.filter((e) => e.type === 'GuardianAngelCleanedDouse').length;
    const ga = players.find((p) => p.role === ROLE_BIT.GuardianAngel);
    if (ga && cleans >= 3) out.grant(ga.id, 'Firefighter');
  }
  // #95 HelpfulParanoia - the Hunter counter-attacks two different attackers.
  {
    const counts = new Map<bigint, number>();
    for (const event of allEvents) {
      if (event.type !== 'HunterCounterAttack') continue;
      counts.set(event.hunterId, (counts.get(event.hunterId) ?? 0) + 1);
    }
    for (const [id, count] of counts) if (count >= 2) out.grant(id, 'HelpfulParanoia');
  }
  // #96 STierHunter - the Hunter kills a wolf AND a cultist in the same night.
  for (const batch of ctx.eventBatches) {
    const kills = new Map<bigint, Set<bigint>>();
    for (const event of batch) {
      if (event.type !== 'PlayerDied') continue;
      const victim = findPlayer(event.playerId);
      if (!victim) continue;
      for (const killerId of event.killerIds) {
        const shooter = findPlayer(killerId);
        if (shooter?.role !== ROLE_BIT.Hunter) continue;
        const set = kills.get(killerId) ?? new Set<bigint>();
        set.add(victim.role);
        kills.set(killerId, set);
      }
    }
    for (const [id, roles] of kills) {
      const hasWolf = [...roles].some((r) => isWolf(r));
      const hasCultist = roles.has(ROLE_BIT.Cultist);
      if (hasWolf && hasCultist) out.grant(id, 'STierHunter');
    }
  }
  // #97 TripleKill - a Serial Killer or wolf kills 3+ people in the same night.
  for (const batch of ctx.eventBatches) {
    const counts = new Map<bigint, number>();
    for (const event of batch) {
      if (event.type !== 'PlayerDied') continue;
      for (const killerId of event.killerIds) counts.set(killerId, (counts.get(killerId) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      if (count < 3) continue;
      const killer = findPlayer(id);
      if (killer && (isWolf(killer.role) || killer.role === ROLE_BIT.SerialKiller))
        out.grant(id, 'TripleKill');
    }
  }
  // #98 ResistTheBeast - the Wild Child, Traitor and Cursed trio all stay human and win with the
  // village.
  if (ctx.winningTeam === 'Village') {
    const wildChild = players.find((p) => p.role === ROLE_BIT.WildChild);
    const traitor = players.find((p) => p.role === ROLE_BIT.Traitor);
    const cursed = players.find((p) => p.role === ROLE_BIT.Cursed);
    if (wildChild?.won && traitor?.won && cursed?.won) {
      out.grant(wildChild.id, 'ResistTheBeast');
      out.grant(traitor.id, 'ResistTheBeast');
      out.grant(cursed.id, 'ResistTheBeast');
    }
  }
  // #99 AtLeastYouTried - the Guardian Angel saves someone at night, who later dies to the
  // Chemist's poison anyway.
  {
    const saved = new Set<bigint>();
    for (const event of allEvents) {
      if (
        event.type === 'GuardianAngelBlockedWolfAttack' ||
        event.type === 'GuardianAngelBlockedSerialKiller' ||
        event.type === 'GuardianAngelSavedFromBurning'
      ) {
        saved.add('targetId' in event ? event.targetId : event.playerId);
      }
    }
    const ga = players.find((p) => p.role === ROLE_BIT.GuardianAngel);
    if (ga) {
      const poisonedAfterSave = deaths.some(
        (d) =>
          d.method === 'Chemistry' && saved.has(d.playerId) && !d.killerIds.includes(d.playerId),
      );
      if (poisonedAfterSave) out.grant(ga.id, 'AtLeastYouTried');
    }
  }
  // #100 LuckyNight - the same player survives both the Chemist's backfired poison and a Harlot
  // visit on the same night.
  for (const batch of ctx.eventBatches) {
    const backfiredTargets = new Set(
      batch
        .filter(
          (e): e is Extract<GameEvent, { type: 'ChemistBackfired' }> =>
            e.type === 'ChemistBackfired',
        )
        .map((e) => e.targetId),
    );
    if (backfiredTargets.size === 0) continue;
    for (const event of batch) {
      if (event.type !== 'HarlotVisited' || !backfiredTargets.has(event.targetId)) continue;
      const target = findPlayer(event.targetId);
      if (target && !target.isDead) out.grant(target.id, 'LuckyNight');
    }
  }
  // #101 InTheMiddleOfTheTrouble - the Guardian Angel blocks a wolf attack (and survives, which
  // is implicit - the GA only gets hurt on a 50% roll while guarding, tracked separately).
  for (const event of allEvents) {
    if (event.type !== 'GuardianAngelBlockedWolfAttack') continue;
    const target = findPlayer(event.targetId);
    if (!target || !isWolf(target.role)) continue;
    const ga = players.find((p) => p.role === ROLE_BIT.GuardianAngel && !p.isDead);
    if (ga) out.grant(ga.id, 'InTheMiddleOfTheTrouble');
  }
  // #102 AmIHallucinating - the Fool's random vision landed on a role the real Seer can never
  // show as-is (WolfMan/Traitor are always disguised by `seerSees`).
  for (const p of players) if (p.hasSeenImpossible) out.grant(p.id, 'AmIHallucinating');

  return out.toMap();
}
