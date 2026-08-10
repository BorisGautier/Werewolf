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
 * Not every one of the 102 catalog entries is implemented. Three kinds are deliberately skipped,
 * each marked in-line below:
 *   - features this migration explicitly left out of scope (language packs, the donor/dev-only
 *     easter eggs, calendar events - see the README/audit)
 *   - achievements whose trigger a `GameEvent` simply doesn't carry enough data for yet (e.g.
 *     `WolfCubKilled` has no `playerId`, so "2 kills after the cub died" can't be tied back to
 *     *which* cub); extending the event payload is a small, isolated follow-up
 *   - a couple of real *mechanics* gaps found while wiring this up (e.g. the Hunter's final shot
 *     doesn't yet demote them like the Chemist/Gunner do against the Wise Elder) - noted so
 *     they're not silently lost
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

const BAD_TEAMS: ReadonlySet<Team> = new Set(['Wolf', 'Cult', 'SerialKiller', 'Arsonist', 'Tanner']);

function isWolf(role: Role): boolean {
  return WOLF_ROLES.includes(role);
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

export function evaluateGameAchievements(ctx: AchievementEvalContext): Map<bigint, AchievementCode[]> {
  const { players } = ctx;
  const out = new UnlockCollector();
  const allEvents = ctx.eventBatches.flat();
  const deaths = allEvents.filter((e): e is Extract<GameEvent, { type: 'PlayerDied' }> => e.type === 'PlayerDied');
  const findPlayer = (id: bigint) => players.find((p) => p.id === id);

  // #1 WelcomeToHell - play a game.
  out.grantAll(
    players.map((p) => p.id),
    'WelcomeToHell',
  );
  // #2 WelcomeToAsylum - play a chaos game.
  if (ctx.mode === 'Chaos') out.grantAll(players.map((p) => p.id), 'WelcomeToAsylum');
  // #3 AlzheimerPatient, #4 OHAIDER, #7 Linguist, #8 NoIdeaWhat, #11 Naughty - language-pack /
  // dev-account features, out of scope for this migration.
  // #5 SpyVsSpy - secret mode (no role reveal).
  if (!ctx.showRolesOnDeath) out.grantAll(players.map((p) => p.id), 'SpyVsSpy');
  // #6 Explorer - cross-game group diversity, computed in AchievementRepository.
  // #9 Enochlophobia - 35 player game.
  if (players.length >= 35) out.grantAll(players.map((p) => p.id), 'Enochlophobia');
  // #10 Introvert - 5 player game (the minimum).
  if (players.length === 5) out.grantAll(players.map((p) => p.id), 'Introvert');
  // #12 Dedicated, #13 Obsessed, #14 HereJohnny, #15 GotYourBack, #19 Survivalist, #51 Veteran -
  // cumulative cross-game counters, computed in AchievementRepository.
  // #16 Masochist - win a game as the Tanner.
  for (const p of players) if (p.role === ROLE_BIT.Tanner && p.won) out.grant(p.id, 'Masochist');
  // #17 Wobble - survive a game as the drunk (10+ players).
  for (const p of players) if (p.role === ROLE_BIT.Drunk && !p.isDead && players.length >= 10) out.grant(p.id, 'Wobble');
  // #18 Inconspicuous - needs a whole-game "votes ever received" tally; `Player.votes` only
  // holds the most recent lynch's count. Deferred - would need a new per-game counter threaded
  // through lynch.ts.
  // #20 BlackSheep - cross-game "lynched first" streak, computed in AchievementRepository (using
  // the single-game "was this the game's first lynch victim" signal below).
  // #21 Promiscuous - needs the Harlot's full night-by-night visit history, which isn't tracked
  // (only the current night's choice survives). Deferred.
  // #22 MasonBrother - two or more surviving masons.
  {
    const masons = players.filter((p) => p.role === ROLE_BIT.Mason && !p.isDead);
    if (masons.length >= 2) out.grantAll(masons.map((p) => p.id), 'MasonBrother');
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
    if (victim && (isWolf(victim.role) || victim.role === ROLE_BIT.SerialKiller)) out.grant(shooterId, 'HeyManNiceShot');
  }
  // #25 DontStayHome - a wolf kills a Harlot who stayed home (an 'Eat' death, as opposed to
  // 'VisitWolf'/'VisitVictim' - those mean she was out visiting someone).
  for (const death of deaths) {
    if (death.method !== 'Eat') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role === ROLE_BIT.Harlot) out.grantAll(death.killerIds, 'DontStayHome');
  }
  // #26 DoubleVision, #28 ShouldHaveKnown - no event captures a Seer's night-by-night targets/
  // results (informational-only, matching messages.ts's own documented scope). Deferred.
  // #27 DoubleKill - be part of the Serial Killer/Hunter standoff-win ending.
  if (ctx.winningTeam === 'SKHunter') {
    for (const p of players) if (p.role === ROLE_BIT.SerialKiller || p.role === ROLE_BIT.Hunter) out.grant(p.id, 'DoubleKill');
  }
  // #29 LackOfTrust - the Seer is the game's first lynch victim.
  {
    const firstLynch = deaths.find((d) => d.method === 'Lynch');
    if (firstLynch) {
      const victim = findPlayer(firstLynch.playerId);
      if (victim?.role === ROLE_BIT.Seer) out.grant(victim.id, 'LackOfTrust');
    }
  }
  // #30 BloodyNight - 4+ people die in the same night (i.e. within one resolution batch).
  for (const batch of ctx.eventBatches) {
    const nightDeaths = batch.filter((e): e is Extract<GameEvent, { type: 'PlayerDied' }> => e.type === 'PlayerDied' && e.isNight);
    if (nightDeaths.length >= 4) out.grantAll(nightDeaths.map((d) => d.playerId), 'BloodyNight');
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
  // #34 FirstStone, #35 SmartGunner - need per-shot/per-vote instrumentation this migration
  // doesn't keep (votes reset every lynch attempt, and the Gunner's shots aren't logged
  // individually beyond the resulting death). Deferred.
  // #36 Streetwise - needs the Detective's night-by-night investigation results, which (like the
  // Seer) are informational-only and not tracked as events. Deferred.
  // #37 OnlineDating - needs to distinguish a Cupid-chosen pairing from a bot-auto-picked one;
  // `LoversCreated` doesn't carry that distinction. Deferred.
  // #38 BrokenClock - needs the Fool's night-by-night (randomized) vision results. Deferred.
  // #39 SoClose, #43 TannerOverkill - need the final lynch's per-player vote tally, which isn't
  // preserved once the phase resolves. Deferred.
  // #40 CultCon - 10+ cultists alive at game end.
  {
    const cultists = players.filter((p) => p.team === 'Cult' && !p.isDead);
    if (cultists.length >= 10) out.grantAll(cultists.map((p) => p.id), 'CultCon');
  }
  // #41 SelfLoving - Cupid picks themselves as one of the lovers.
  for (const event of allEvents) {
    if (event.type !== 'LoversCreated') continue;
    const lover1 = findPlayer(event.lover1Id);
    const lover2 = findPlayer(event.lover2Id);
    if (lover1?.role === ROLE_BIT.Cupid) out.grant(lover1.id, 'SelfLoving');
    if (lover2?.role === ROLE_BIT.Cupid) out.grant(lover2.id, 'SelfLoving');
  }
  // #42 ShouldveMentioned - needs to know it wasn't the first night specifically; deferred since
  // batch 0 isn't reliably "night 1" once Joining-phase batches are mixed in by the caller.
  // #44 SerialSamaritan - the Serial Killer kills 3+ wolves in the game.
  {
    const skWolfKills = new Map<bigint, number>();
    for (const death of deaths) {
      if (death.method !== 'SerialKilled') continue;
      const victim = findPlayer(death.playerId);
      if (!victim || !isWolf(victim.role)) continue;
      for (const killerId of death.killerIds) skWolfKills.set(killerId, (skWolfKills.get(killerId) ?? 0) + 1);
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
    if (livingWolves.length >= 7) out.grantAll(livingWolves.map((p) => p.id), 'PackHunter');
  }
  // #48 GunnerSaves - needs to reconstruct a near-miss win-condition check (wolves == villagers,
  // but the Gunner's remaining bullet keeps the game going); not a signal any event carries.
  // Deferred.
  // #49 LongHaul - real-world wall-clock duration; the pure evaluator has no notion of time (see
  // GameLoop for `startedAt`/`endedAt` if this gets picked up later). Deferred.
  // #50 OhShi - kill your own lover on the first night (approximated as the first batch).
  if (ctx.eventBatches[0]) {
    for (const event of ctx.eventBatches[0]) {
      if (event.type !== 'PlayerDied') continue;
      const victim = findPlayer(event.playerId);
      if (victim?.loverId != null && event.killerIds.includes(victim.loverId)) out.grant(victim.loverId, 'OhShi');
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
  // #54 ImNotDrunk, #56 DidYouGuardYourself - need per-lynch-vote-correctness and per-guard-target
  // history this migration doesn't retain. Deferred.
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
  // #59 President - needs to count the Mayor's post-reveal lynch votes specifically. Deferred.
  // #60 IHelped, #93 IncreaseThePack - `WolfCubKilled` doesn't carry a `playerId`/pack id, so
  // "after this specific cub died" can't be tied to anything. Deferred (small event-payload fix
  // would unblock both).
  // #61 ItWasABusyNight - needs a per-visit-role log (who visited whom each night), which the
  // domain layer resolves internally but doesn't expose as events. Deferred.
  // #62 StrongestAlpha - "infect the serial killer" - the Alpha Wolf's bite only ever targets
  // wolf-pack victims in this port (there's no SK-specific infection branch), so this can never
  // fire; not a gap worth chasing for a single achievement.
  // #63 AmIYourSeer - needs the Fool's specific (randomized) vision result. Deferred (see #38).
  // #64 DemotedByTheDeath - real mechanics gap: the Hunter's final shot doesn't demote them like
  // the Chemist/Gunner do when the target is the Wise Elder (see night-resolution.ts's Chemist
  // block and day-actions.ts's Gunner block for the pattern this would follow).
  // #65 WastedSilver - the Blacksmith/Sandman day abilities resolve straight to a translated
  // string in game-loop.ts without emitting a GameEvent, so there's nothing to correlate here.
  // Deferred.
  // #66 Trustworthy, #67 DeepLove, #68 TimeToRetire, #69 SeeingBetweenTeams, #70 JustABeardyGuy -
  // need per-role Seer-check history or Doppelganger role-model choices that aren't tracked as
  // events (RoleModelChosen only fires for WildChild/Doppelganger's initial pick - see #82 below
  // for the one sub-case that IS covered).
  // #71 ThatCameUnexpected - the Tanner is lynched, wins, and 3 or fewer players remained
  // (approximated from the post-lynch survivor count).
  for (const death of deaths) {
    if (death.method !== 'Lynch') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role !== ROLE_BIT.Tanner || !victim.won) continue;
    const remaining = players.filter((p) => !p.isDead).length;
    if (remaining <= 3) out.grant(victim.id, 'ThatCameUnexpected');
  }
  // #72 NowImBlind - needs the Oracle's specific vision outcome. Deferred (see #38).
  // #73 EveryManForHimself, #74 MySweetieSoStrong - need the lynch-vote tally at the moment the
  // Pacifist's peace declaration cancelled it. Deferred (see #39).
  // #75 CultLeader - a founding cultist (converted on day 0, i.e. never converted at all) who
  // survives and wins.
  for (const p of players) if (p.role === ROLE_BIT.Cultist && p.dayCult === 0 && !p.isDead && p.won) out.grant(p.id, 'CultLeader');
  // #76 ThanksJunior - needs to know the pack was drunk and this specific wolf still tried to
  // eat; the domain's drunk-pack skip doesn't emit a distinguishing event. Deferred.
  // #77 DeathVillage - the game ends with no winner.
  if (ctx.winningTeam === undefined)
    out.grantAll(
      players.map((p) => p.id),
      'DeathVillage',
    );
  // #78 ILostMyWisdom - needs to know the Wise Elder specifically *changed role* (as opposed to
  // just dying); `changedRolesCount` doesn't distinguish who/why. Deferred (a targeted check
  // could use role !== WiseElder && changedRolesCount >= 1, but nothing marks the *original*
  // role, so it's not reliable enough to ship).
  // #79 Affectionate, #80 LuckyDay - need per-night visit-target/infection history not retained
  // once resolved. Deferred.
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
    if (event.type === 'RoleModelChosen' && event.roleModelId === event.playerId) out.grant(event.playerId, 'Indestructible');
  }
  // #83 PsychopathKiller - the Serial Killer wins a 35-player game.
  for (const p of players) if (p.role === ROLE_BIT.SerialKiller && p.won && players.length >= 35) out.grant(p.id, 'PsychopathKiller');
  // #84 TodaysSpecial - calendar/event-day achievement, out of scope.
  // #85 RomeoAndJuliet - in love with the Tanner, and won by lynching them.
  for (const death of deaths) {
    if (death.method !== 'Lynch') continue;
    const victim = findPlayer(death.playerId);
    if (victim?.role !== ROLE_BIT.Tanner || !victim.won) continue;
    const lover = victim.loverId ? findPlayer(victim.loverId) : undefined;
    if (lover?.won) out.grant(lover.id, 'RomeoAndJuliet');
  }
  // #86 ReallyBadLuck - a very specific SK-stumble/random-kill/GA-block chain; none of it is
  // tied together by a single event today. Deferred.
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
    if (lover && BAD_TEAMS.has(victim.team) && BAD_TEAMS.has(lover.team)) out.grant(shooterId, 'DoubleShot');
  }
  // #89/#90 PlayingWithTheFire / Firework - the Arsonist burns 5+ / 10+ houses in one night.
  for (const batch of ctx.eventBatches) {
    const burns = batch.filter((e): e is Extract<GameEvent, { type: 'PlayerDied' }> => e.type === 'PlayerDied' && e.method === 'Burn');
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
  // #92 GoodChoiceForYou - needs the Chemist's per-visit survival history across the game.
  // Deferred.
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
      if (killer && (isWolf(killer.role) || killer.role === ROLE_BIT.SerialKiller)) out.grant(id, 'TripleKill');
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
        (d) => d.method === 'Chemistry' && saved.has(d.playerId) && !d.killerIds.includes(d.playerId),
      );
      if (poisonedAfterSave) out.grant(ga.id, 'AtLeastYouTried');
    }
  }
  // #100 LuckyNight - needs to know the Harlot visited a specific player the same night the
  // Chemist visited them too; visit targets aren't retained after resolution. Deferred.
  // #101 InTheMiddleOfTheTrouble - the Guardian Angel blocks a wolf attack (and survives, which
  // is implicit - the GA only gets hurt on a 50% roll while guarding, tracked separately).
  for (const event of allEvents) {
    if (event.type !== 'GuardianAngelBlockedWolfAttack') continue;
    const target = findPlayer(event.targetId);
    if (!target || !isWolf(target.role)) continue;
    const ga = players.find((p) => p.role === ROLE_BIT.GuardianAngel && !p.isDead);
    if (ga) out.grant(ga.id, 'InTheMiddleOfTheTrouble');
  }
  // #102 AmIHallucinating - needs the Fool's specific vision outcome vs. what the Seer could
  // ever see. Deferred (see #38).

  return out.toMap();
}
