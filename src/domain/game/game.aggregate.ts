/**
 * Aggregate root tying together role assignment, phase transitions, night
 * resolution, lynch voting, day abilities and win-condition checks - the
 * parts of `Werewolf.cs`'s main loop
 * (`while (IsRunning) { GameDay++; NightCycle(); DayCycle(); LynchCycle(); }`)
 * that are pure state, with no Telegram/menu/timer concerns.
 *
 * `enterNight()`/`resolveNightActions()` are deliberately two separate calls
 * rather than one: in the original, choices get collected via Telegram menus
 * over a ~90 second window that sits *between* "night begins" (the reset at
 * the top of `NightCycle`) and "night resolves" (everything from Snow Wolf
 * onward) - a real-world time gap a single function can't represent. The
 * app/infrastructure layer is expected to call `start()`/`startNight()`,
 * send its menus, wait, then call `resolveNightActions()`.
 */

import { randomInt } from 'node:crypto';
import { balance, WOLF_ROLES, type BalanceOptions } from './game-balancing.js';
import { killPlayer, type KillOptions } from './kill.js';
import {
  resetLynchState,
  resolveLynchVotes,
  type LynchOptions,
  type LynchResult,
} from './lynch.js';
import {
  evaluateWinCondition,
  type WinConditionContext,
  type WinConditionResult,
} from './win-condition.js';
import { resolveClairvoyanceNight } from './clairvoyance.js';
import {
  resolveArchangelShot,
  resolveDetectiveSnoop,
  resolveGunnerShot,
  resolveSpumpkinDetonate,
} from './day-actions.js';
import {
  findActingGuardianAngel,
  findPriestessBlessing,
  initialNightState,
  resolveArsonistNight,
  resolveChameleonWolfNight,
  resolveChemistNight,
  resolveCrowNight,
  resolveCultistHunterNight,
  resolveCultNight,
  resolveGuardianAngelNight,
  resolveHarlotNight,
  resolveHowlerWolfNight,
  resolveMimicNight,
  resolveNecromancerNight,
  resolveReflectorNight,
  resolveSerialKillerNight,
  resolveSnowWolfNight,
  resolveThiefNight,
  resolveTrackerNight,
  resolveTrapperWolfNight,
  resolveViperWolfNight,
  resolveWatchmanNight,
  resolveWolfNight,
} from './night-resolution.js';
import type { VisitContext } from './night-visit.js';
import { checkRoleChanges, validateSpecialRoleChoices } from './role-changes.js';
import { promoteToWolf } from './transform.js';
import type { GameEvent } from './game-event.js';
import type { GameMode } from './game-mode.js';
import type { GamePhase } from './game-phase.js';
import { ABSTAIN, alivePlayers, createPlayer, type Player } from './player.js';
import { ROLE_BIT, roleName, type Role, type RoleFlags } from '../roles/role.js';
import { getTeamForRole, type Team } from './team.js';
import { shuffle } from '../shared/shuffle.js';
import type { KillMethod } from './kill-method.js';
import {
  blacksmithSilverSpreads,
  botOnlyGamesStarted,
  loversWins,
  mayorAnnouncements,
  pacifistPeaces,
  roleAssignments,
  roleWins,
  sandmanSleepActivations,
  soloWins,
  teamWins,
  troublemakerDoubleLynches,
} from '../../infrastructure/monitoring/metrics.js';

export class GameError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_JOINING'
      | 'ALREADY_JOINED'
      | 'GROUP_FULL'
      | 'NOT_ENOUGH_PLAYERS'
      | 'WRONG_PHASE'
      | 'GAME_OVER',
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export interface GameOptions {
  chatId: bigint;
  mode: GameMode;
  disabledRoleFlags?: RoleFlags;
  burningOverkill?: boolean;
  randomLynchOnTie?: boolean;
  minPlayers?: number;
  maxPlayers?: number;
  /** Mirrors `ThiefFull`: lets the Thief steal every night instead of only night 1. */
  thiefFull?: boolean;
}

import { getRandomWeather, type VillageWeather } from './village-weather.js';

export class Game {
  readonly chatId: bigint;
  readonly mode: GameMode;
  weather: VillageWeather = getRandomWeather();
  phase: GamePhase = 'Joining';
  dayNumber = 0;
  players: Player[] = [];
  wolfCubKilled = false;
  winningTeam?: Team;
  /** The full candidate role pool this game was balanced from (useful for Beholder-style "possible roles" hints). */
  possibleRoles: Role[] = [];

  /** Mirrors `_silverSpread`: the Blacksmith protected the whole village from wolves tonight. */
  silverSpread = false;
  /** A Priestess's blessing blocked a wolf attack last night - the pack skips their hunt entirely
   * tonight as the lingering consequence (see `NightState.wolfPackBlinded` in night-resolution.ts). */
  wolfPackBlinded = false;
  /** Mirrors `_sandmanSleep`: the Sandman put the whole village (and the night's events) to sleep. */
  sandmanSleep = false;
  /** Mirrors `_pacifistUsed`: the Pacifist has declared peace - the next lynch resolution is skipped. */
  pacifistUsed = false;
  /** State properties for 20 new roles */
  mimicTargetMap = new Map<bigint, bigint>();
  hitmanTargetMap = new Map<bigint, bigint>();
  avengerTargetMap = new Map<bigint, bigint>();
  chameleonAppearanceMap = new Map<bigint, Role>();
  hypnotistForcedVoteMap = new Map<bigint, { victimId: bigint; targetId: bigint }>();
  berserkerRage = false;
  anonymousLynchVotes = false;
  reflectorActiveSet = new Set<bigint>();
  poisonedViperVictimsSet = new Set<bigint>();
  archangelBulletsMap = new Map<bigint, number>();
  consecutiveVillageDeaths = 0;
  claimsMap = new Map<bigint, string>();
  /** Mirrors `_doubleLynch` as captured by `startLynch()`: how many lynch attempts this Lynch phase gets. */
  lynchAttemptsPlanned = 1;
  private doubleLynchPending = false;
  /** Mirrors `NoOneCastLynch`: whether anyone has cast a live lynch vote yet this attempt (FirstStone). */
  private noOneCastLynchVoteYet = true;

  /** Mirrors `lastGrave`/`secondLastGrave`: when the Grave Digger last (and second-last) dug, across nights. */
  private lastGraveDigAt: Date | null = null;
  private secondLastGraveDigAt: Date | null = null;

  private readonly disabledRoleFlags: RoleFlags;
  private readonly burningOverkill: boolean;
  private readonly randomLynchOnTie: boolean;
  private readonly minPlayers: number;
  private readonly maxPlayers: number;
  private readonly thiefFull: boolean;
  private lynchAttempt = 0;

  constructor(options: GameOptions) {
    this.chatId = options.chatId;
    this.mode = options.mode;
    this.disabledRoleFlags = options.disabledRoleFlags ?? 0n;
    this.burningOverkill = options.burningOverkill ?? false;
    this.randomLynchOnTie = options.randomLynchOnTie ?? true;
    this.minPlayers = options.minPlayers ?? 5;
    this.maxPlayers = options.maxPlayers ?? 35;
    this.thiefFull = options.thiefFull ?? false;
  }

  addPlayer(id: bigint, name: string, isBot = false): Player {
    if (this.phase !== 'Joining')
      throw new GameError('Cannot join once the game has started.', 'NOT_JOINING');
    if (this.players.some((p) => p.id === id)) {
      throw new GameError('This player already joined.', 'ALREADY_JOINED');
    }
    if (this.players.length >= this.maxPlayers) {
      throw new GameError('This group is full.', 'GROUP_FULL');
    }
    // Villager/Village is a placeholder until assignRolesAndStart() deals real roles.
    const player = createPlayer(id, name, ROLE_BIT.Villager, 'Village', isBot);
    this.players.push(player);
    return player;
  }

  /** Mirrors `/flee`: removes a player during joining, or marks them fled mid-game. */
  removePlayer(id: bigint): boolean {
    if (this.phase === 'Joining') {
      const index = this.players.findIndex((p) => p.id === id);
      if (index === -1) return false;
      this.players.splice(index, 1);
      return true;
    }
    const player = this.players.find((p) => p.id === id);
    if (!player || player.isDead || player.fled) return false;
    player.fled = true;
    const events = killPlayer(this.players, id, 'Flee', { triggerHunterShot: false });
    return events.length > 0;
  }

  canStart(): boolean {
    return this.phase === 'Joining' && this.players.length >= this.minPlayers;
  }

  /**
   * Deals roles (via `balance()`) and moves the game into its first Night.
   * Mirrors `AssignRoles()` + the `Time = GameTime.Night; GameDay++` that
   * kicks off the original's main loop.
   */
  start(balanceOptions: Partial<Pick<BalanceOptions, 'chaos'>> = {}): GameEvent[] {
    if (this.phase !== 'Joining') throw new GameError('The game already started.', 'WRONG_PHASE');
    if (!this.canStart()) {
      throw new GameError(
        `Not enough players joined (need at least ${this.minPlayers}).`,
        'NOT_ENOUGH_PLAYERS',
      );
    }

    const { rolesToAssign, possibleRoles } = balance({
      disabledRoleFlags: this.disabledRoleFlags,
      playerCount: this.players.length,
      chaos: balanceOptions.chaos ?? this.mode === 'Chaos',
      burningOverkill: this.burningOverkill,
      mode: this.mode,
    });

    shuffle(this.players);
    shuffle(rolesToAssign);

    this.players.forEach((player, index) => {
      const role = rolesToAssign[index]!;
      player.role = role;
      player.team = getTeamForRole(role);
      try {
        roleAssignments.labels(roleName(role)).inc();
      } catch {
        // ignore
      }
    });
    if (this.players.every((p) => p.isBot)) {
      botOnlyGamesStarted.inc();
    }
    this.possibleRoles = possibleRoles;

    this.players.forEach((player) => {
      if (player.role === ROLE_BIT.Hitman) {
        const targets = this.players.filter((p) => p.id !== player.id);
        if (targets.length > 0) {
          const target = targets[randomInt(targets.length)]!;
          this.hitmanTargetMap.set(player.id, target.id);
        }
      }
      if (player.role === ROLE_BIT.Avenger) {
        const targets = this.players.filter((p) => p.id !== player.id);
        if (targets.length > 0) {
          const target = targets[randomInt(targets.length)]!;
          this.avengerTargetMap.set(player.id, target.id);
        }
      }
    });

    return this.enterNight();
  }

  /** Mirrors the `Time = GameTime.Day` transition in `DayCycle()`. */
  startDay(): void {
    this.assertPhase('Night');
    this.phase = 'Day';
  }

  /**
   * Mirrors the `Time = GameTime.Lynch` transition + per-round reset at the
   * top of `LynchCycle()`. Also captures whether the Troublemaker forced a
   * double lynch today - mirrors `bool doubleLynch = _doubleLynch; _doubleLynch = false;`,
   * captured once per Lynch phase, not re-checked per attempt.
   */
  startLynch(): GameEvent[] {
    this.assertPhase('Day');
    this.phase = 'Lynch';
    this.lynchAttempt = 0;
    this.lynchAttemptsPlanned = this.doubleLynchPending ? 2 : 1;
    this.doubleLynchPending = false;
    this.noOneCastLynchVoteYet = true;
    resetLynchState(this.players);

    // The Hypnotist Wolf's forced vote (populated directly by the `hyp2` callback in
    // game-loop.ts - no domain resolver, mirroring Cupid's own infra-only pairing) pre-fills the
    // victim's vote the instant voting opens. The map itself stays populated through the whole
    // lynch - `GameLoop.applyChoice()` checks it to stop the victim from overriding it - and is
    // only cleared at the top of the *next* `enterNight()`, so it can't leak into a later lynch.
    for (const { victimId, targetId } of this.hypnotistForcedVoteMap.values()) {
      const victim = this.players.find((p) => p.id === victimId);
      const target = this.players.find((p) => p.id === targetId);
      if (victim && !victim.isDead && target && !target.isDead) {
        victim.choice = target.id;
      }
    }

    // The Viper Wolf's poison finally lands "at sunset" - the day/lynch boundary - having spared
    // the victim through the entire day it was injected on (see `resolveViperWolfNight`).
    const events: GameEvent[] = [];
    if (this.poisonedViperVictimsSet.size > 0) {
      const viperIds = this.players
        .filter((p) => p.role === ROLE_BIT.ViperWolf)
        .map((p) => p.id);
      for (const victimId of this.poisonedViperVictimsSet) {
        const victim = this.players.find((p) => p.id === victimId);
        if (!victim || victim.isDead) continue;
        events.push(...this.killPlayer(victimId, 'ViperPoison', { killerIds: viperIds }));
      }
      this.poisonedViperVictimsSet.clear();
    }

    return events;
  }

  /**
   * Called by the app layer when a live (non-abstain) lynch vote is cast - mirrors the original's
   * inline `NoOneCastLynch` check feeding `FirstStone` (be the first to vote 5 times in a game).
   * A no-op after the first vote of each attempt.
   */
  registerLynchVoteCast(voterId: bigint): void {
    if (!this.noOneCastLynchVoteYet) return;
    this.noOneCastLynchVoteYet = false;
    const voter = this.players.find((p) => p.id === voterId);
    if (voter) voter.firstToVoteCount++;
  }

  /**
   * Tallies votes and resolves the lynch. Call again (after
   * `restartLynchVote()`) up to `lynchAttemptsPlanned` times.
   *
   * If the Pacifist has declared peace since the last resolution, this
   * mirrors the original's `if (_pacifistUsed) { ...; _pacifistUsed = false; return; }`
   * guard (checked both at the top of each attempt and mid-vote in the
   * original's timer loop - since this function only runs once, at "the vote
   * window has closed", either timing collapses to the same net effect: no
   * lynch happens this attempt).
   */
  resolveLynch(options?: Partial<LynchOptions>): LynchResult & WinConditionResult {
    this.assertPhase('Lynch');

    if (this.pacifistUsed) {
      this.pacifistUsed = false;
      // Mirrors the original's EveryManForHimself/MySweetieSoStrong check: did the Pacifist's
      // declaration cancel a lynch that already had a majority of votes cast against them (or
      // their lover)?
      const alive = alivePlayers(this.players);
      const pacifist = alive.find((p) => p.role === ROLE_BIT.Pacifist);
      if (pacifist) {
        const votesFor = (id: bigint) => this.players.filter((p) => p.choice === id).length;
        if (votesFor(pacifist.id) > alive.length / 2) {
          pacifist.everyManForHimself = true;
        } else if (pacifist.loverId !== null && votesFor(pacifist.loverId) > alive.length / 2) {
          const lover = this.players.find((p) => p.id === pacifist.loverId);
          if (lover) lover.mySweetieSoStrong = true;
        }
      }
      const win = this.checkWinCondition({ checkBitten: true });
      return {
        resolution: { outcome: 'PacifistPeace' },
        ...win,
      };
    }

    this.lynchAttempt++;
    const lynchOptions: LynchOptions = {
      lynchAttempt: this.lynchAttempt,
      randomLynchOnTie: this.randomLynchOnTie,
      avengerTargetMap: this.avengerTargetMap,
      ...options,
    };
    const lynchResult = resolveLynchVotes(this.players, lynchOptions);
    const archangelEvents = this.trackArchangelStreak(lynchResult.events);

    // The Berserker Wolf's rage: a Werewolf pack-mate actually lynched (not pardoned, not a
    // survived Prince) enrages any living Berserker Wolf, granting the pack a second kill target
    // next night - consumed exactly like `wolfCubKilled` is (see `resolveNightActions()`), just
    // triggered by a lynch instead of a night death.
    const resolution = lynchResult.resolution;
    const berserkerEvents: GameEvent[] = [];
    if (resolution.outcome === 'Lynched') {
      const lynched = this.players.find((p) => p.id === resolution.playerId);
      const berserker = this.players.find((p) => p.role === ROLE_BIT.BerserkerWolf && !p.isDead);
      if (lynched && berserker && getTeamForRole(lynched.role) === 'Wolf') {
        this.berserkerRage = true;
        berserkerEvents.push({ type: 'BerserkerWolfEnraged', berserkerId: berserker.id });
      }
    }

    // Mirrors `CheckRoleChanges(true)` right before `CheckForGameEnd(true)` at the end of the
    // original's LynchCycle: an idle-kill or the lynch itself may have just killed the Seer or a
    // Wild Child/Doppelganger's role model, and that promotion/transformation has to land before
    // the win condition is evaluated below - otherwise a freshly-promoted Apprentice Seer (etc.)
    // could be missed in a same-round victory check.
    const roleChangeEvents = checkRoleChanges(this.players, true);

    // A lynched Tanner ends the game immediately and unconditionally - `resolveLynchVotes()`
    // already marked the winners on the players and pushed a `GameEnded` event for it, but
    // `evaluateWinCondition()` (what `checkWinCondition()` below calls) has no Tanner branch of
    // its own, so without this `this.phase` would never flip to 'Ended': the loop would announce
    // the Tanner's win and then carry on into another night as if nothing had happened.
    if (lynchResult.resolution.outcome === 'TannerWinByLynch') {
      this.phase = 'Ended';
      this.winningTeam = 'Tanner';
      return {
        ...lynchResult,
        finished: true,
        winningTeam: 'Tanner',
        events: [...lynchResult.events, ...archangelEvents, ...berserkerEvents, ...roleChangeEvents],
      };
    }

    const win = this.checkWinCondition({ checkBitten: true });
    return {
      ...lynchResult,
      ...win,
      events: [
        ...lynchResult.events,
        ...archangelEvents,
        ...berserkerEvents,
        ...roleChangeEvents,
        ...win.events,
      ],
    };
  }

  /** Starts a fresh vote (e.g. for a Troublemaker-forced double lynch) without leaving the Lynch phase. */
  restartLynchVote(): void {
    this.assertPhase('Lynch');
    this.noOneCastLynchVoteYet = true;
    resetLynchState(this.players);
  }

  /** Mirrors the `Time = GameTime.Night; GameDay++` at the top of each loop iteration. */
  startNight(): GameEvent[] {
    this.assertPhase('Lynch');
    return this.enterNight();
  }

  /**
   * Set by `enterNight()` when the Sandman put the village to sleep -
   * callers should skip sending night menus and never call
   * `resolveNightActions()` for a night where this is true (it's a no-op
   * regardless, but skipping avoids pointless menu traffic).
   */
  nightSkipped = false;

  /**
   * Mirrors the very top of `NightCycle` - the part that always runs the
   * instant Night begins, *before* any menus are sent: resetting per-night
   * scratch state, resolving a pending Bitten -> Wolf transformation from
   * the night before, and the Sandman-sleep gate (`if (_sandmanSleep) {...
   * return;}`). Real per-role resolution (`resolveNightActions`) happens
   * later, once the app layer's menu/timer window has actually collected
   * everyone's choices - there's a real-world time gap between the two that
   * a single function can't represent.
   */
  private enterNight(): GameEvent[] {
    this.dayNumber++;
    this.phase = 'Night';
    const events: GameEvent[] = [];

    // A Howler Wolf's anonymity only ever covers the one lynch immediately after their howl - by
    // the time the *next* night begins, that lynch is long over, so this is where it's consumed.
    this.anonymousLynchVotes = false;
    // Same one-lynch-only lifecycle for a Hypnotist Wolf's forced vote.
    this.hypnotistForcedVoteMap.clear();

    for (const p of this.players) {
      p.choice = null;
      p.choice2 = null;
      p.choice3 = null;
      p.votes = 0;
      p.diedLastNight = false;
      p.killedLastNight = 0;
    }
    for (const p of this.players) {
      if (!p.bitten) continue;
      p.bitten = false;
      if (!p.isDead && !WOLF_ROLES.includes(p.role) && p.role !== ROLE_BIT.SnowWolf) {
        promoteToWolf(p);
        events.push({ type: 'BittenPlayerTurnedWolf', playerId: p.id });
      }
    }
    events.push(...checkRoleChanges(this.players));

    this.nightSkipped = this.sandmanSleep;
    if (this.sandmanSleep) {
      this.sandmanSleep = false;
      this.silverSpread = false;
      this.wolfCubKilled = false;
      this.berserkerRage = false;
      for (const p of this.players) p.drunk = false;
    } else {
      // Mirrors the original's ThanksJunior check: if part of the pack is still sleeping off last
      // night's drunken meal, whoever's sober can still try to eat while the rest snores through it.
      const aliveWolves = this.players.filter(
        (p) => !p.isDead && (WOLF_ROLES.includes(p.role) || p.role === ROLE_BIT.SnowWolf),
      );
      if (aliveWolves.some((p) => p.drunk)) {
        const soberWolfIds = aliveWolves.filter((p) => !p.drunk).map((p) => p.id);
        if (soberWolfIds.length > 0) events.push({ type: 'WolfPackHasDrunkMembers', soberWolfIds });
      }
      events.push(...this.digGraves());
    }

    return events;
  }

  /**
   * Mirrors the Grave Digger's automatic digging in `SendNightActions`: no menu, no choice - the
   * instant night begins, they're told (and the game records) how many players have died since
   * they last dug. Skipped entirely on a Sandman-slept night, same as every other night action.
   */
  private digGraves(): GameEvent[] {
    const gravedigger = this.players.find(
      (p) => p.role === ROLE_BIT.GraveDigger && !p.isDead && !p.drunk,
    );
    if (!gravedigger) return [];

    const diedSinceLastDig = this.players.filter(
      (p) =>
        p.isDead &&
        p.timeDied !== null &&
        !p.diedByFleeOrIdle &&
        (this.lastGraveDigAt === null || p.timeDied > this.lastGraveDigAt),
    );
    gravedigger.dugGravesLastNight = diedSinceLastDig.length;
    gravedigger.choice = ABSTAIN;
    this.secondLastGraveDigAt = this.lastGraveDigAt;
    this.lastGraveDigAt = new Date();
    return [
      { type: 'GraveDug', playerId: gravedigger.id, graveCount: gravedigger.dugGravesLastNight },
    ];
  }

  /**
   * The five "click a button, flip a flag" day abilities from `HandleReply`.
   * Each returns whether the ability actually triggered (false if the
   * player isn't who/what they claim, or already used it this game).
   */

  /** Mirrors the Mayor's "reveal" button: doubles their lynch vote from now on. */
  useMayorReveal(playerId: bigint): boolean {
    const mayor = this.players.find(
      (p) => p.id === playerId && p.role === ROLE_BIT.Mayor && !p.isDead,
    );
    if (!mayor || mayor.hasUsedAbility) return false;
    mayor.hasUsedAbility = true;
    mayorAnnouncements.inc();
    return true;
  }

  usePacifistPeace(playerId: bigint): boolean {
    const pacifist = this.players.find(
      (p) => p.id === playerId && p.role === ROLE_BIT.Pacifist && !p.isDead,
    );
    if (!pacifist || pacifist.hasUsedAbility) return false;
    pacifist.hasUsedAbility = true;
    this.pacifistUsed = true;
    this.doubleLynchPending = false;
    pacifistPeaces.inc();
    return true;
  }

  useBlacksmithSpreadSilver(playerId: bigint): GameEvent[] {
    const blacksmith = this.players.find(
      (p) => p.id === playerId && p.role === ROLE_BIT.Blacksmith && !p.isDead,
    );
    if (!blacksmith || blacksmith.hasUsedAbility) return [];
    blacksmith.hasUsedAbility = true;
    this.silverSpread = true;
    blacksmithSilverSpreads.inc();
    return [{ type: 'BlacksmithSpreadSilver', playerId, dayNumber: this.dayNumber }];
  }

  useSandmanSleep(playerId: bigint): GameEvent[] {
    const sandman = this.players.find(
      (p) => p.id === playerId && p.role === ROLE_BIT.Sandman && !p.isDead,
    );
    if (!sandman || sandman.hasUsedAbility) return [];
    sandman.hasUsedAbility = true;
    this.sandmanSleep = true;
    sandmanSleepActivations.inc();
    return [{ type: 'SandmanUsedSleep', playerId, dayNumber: this.dayNumber }];
  }

  useTroublemakerDoubleLynch(playerId: bigint): boolean {
    const troublemaker = this.players.find(
      (p) => p.id === playerId && p.role === ROLE_BIT.Troublemaker && !p.isDead,
    );
    if (!troublemaker || troublemaker.hasUsedAbility) return false;
    troublemaker.hasUsedAbility = true;
    this.doubleLynchPending = true;
    if (this.phase === 'Lynch') {
      this.lynchAttemptsPlanned = 2;
    }
    this.pacifistUsed = false;
    troublemakerDoubleLynches.inc();
    return true;
  }

  /**
   * Runs the night's per-role resolution in the original's exact order,
   * mirroring the body of `NightCycle` *after* `SendNightActions`'s menu/
   * timer window closes. Call `startNight()`/`start()` first (which runs
   * `enterNight()` and does the reset/Sandman-gate check), let the app layer
   * collect choices via menus, then call this. No-op (besides returning
   * `[]`) if `nightSkipped` is true.
   */
  resolveNightActions(options: { random?: () => number } = {}): GameEvent[] {
    this.assertPhase('Night');
    if (this.nightSkipped) return [];
    const random = options.random ?? Math.random;
    const events: GameEvent[] = [];

    events.push(...validateSpecialRoleChoices(this.players, this.dayNumber, random));

    const state = initialNightState(this.lastGraveDigAt, this.secondLastGraveDigAt);
    state.guardianAngel = findActingGuardianAngel(this.players);
    state.silverSpread = this.silverSpread;
    this.silverSpread = false; // consumed for tonight - mirrors the original resetting `_silverSpread` once menus for this night are settled
    state.priestessBlessed = findPriestessBlessing(this.players);
    state.wolfPackBlinded = this.wolfPackBlinded;
    this.wolfPackBlinded = false; // consumed for tonight - same one-night lifecycle as silverSpread

    // Must run before `visitCtx` is built below: `reflectorActiveSet` needs to already include a
    // Reflector who raises their mirror tonight before any visitPlayer() call (SnowWolf/Arsonist/
    // Wolf onward) can check it - otherwise their very first night of protection wouldn't apply
    // until the *next* one.
    const reflectorEvents = resolveReflectorNight(this.players);
    for (const e of reflectorEvents) {
      if (e.type === 'ReflectorActivated') this.reflectorActiveSet.add(e.reflectorId);
    }
    events.push(...reflectorEvents);

    // Same "must run before visitCtx" reasoning as the Reflector above - the trap has to be armed
    // before any of tonight's visits (SnowWolf/Arsonist/Wolf onward) can be checked against it. The
    // trap itself only lasts this one night, unlike the Reflector's permanent mirror.
    let trappedTargetId: bigint | null = null;
    const trapperEvents = resolveTrapperWolfNight(this.players);
    for (const e of trapperEvents) {
      if (e.type === 'TrapperWolfTrapSet') trappedTargetId = e.targetId;
    }
    events.push(...trapperEvents);

    // The Viper Wolf's poison doesn't touch visitCtx at all - it's a delayed, unconditional kill
    // (see `startLynch()`), so it can resolve any time before the night ends.
    const viperEvents = resolveViperWolfNight(this.players);
    for (const e of viperEvents) {
      if (e.type === 'ViperWolfPoisoned') this.poisonedViperVictimsSet.add(e.targetId);
    }
    events.push(...viperEvents);

    // Same reasoning: no visit resolution needed, just flips `Game.anonymousLynchVotes` on for the
    // immediately following lynch (consumed/reset at the top of the *next* `enterNight()`, so it
    // stays active for that entire lynch phase).
    const howlerEvents = resolveHowlerWolfNight(this.players);
    for (const e of howlerEvents) {
      if (e.type === 'HowlerWolfHowled') this.anonymousLynchVotes = true;
    }
    events.push(...howlerEvents);

    const visitCtx: VisitContext = {
      players: this.players,
      dayNumber: this.dayNumber,
      thiefFull: this.thiefFull,
      random,
      reflectorActive: this.reflectorActiveSet,
      trappedTargetId,
    };

    events.push(...resolveSnowWolfNight(this.players, state, visitCtx));
    // A Snow Wolf freezing a Grave Digger who dug tonight rewinds the state's copy of `lastGraveDigAt`
    // (see night-resolution.ts) - mirror that back onto the persisted timestamp used next night.
    this.lastGraveDigAt = state.lastGraveDigAt;
    events.push(...resolveArsonistNight(this.players, state, visitCtx));

    this.wolfCubKilled = false; // mirrors `WolfCubKilled = false;` right before the Wolf Night block
    // The Berserker Wolf's rage only ever grants the one night's bonus kill it was set for (the
    // night right after the lynch that triggered it, per `resolveLynch()`) - once tonight's menus
    // have already been sent with that in mind, it's consumed here rather than re-derived like
    // `wolfCubKilled` above, since nothing during Wolf Night resolution itself can retrigger it.
    this.berserkerRage = false;
    const wolfEvents = resolveWolfNight(this.players, state, visitCtx);
    if (wolfEvents.some((e) => e.type === 'WolfCubKilled')) this.wolfCubKilled = true;
    events.push(...wolfEvents);
    // A Priestess's blessing that blocked an attack tonight blinds the pack next night too -
    // carry that forward the same way `lastGraveDigAt` is mirrored back above.
    if (state.triggerWolfBlindNextNight) this.wolfPackBlinded = true;

    events.push(...resolveSerialKillerNight(this.players, state, visitCtx));
    events.push(...resolveCultistHunterNight(this.players, visitCtx));
    events.push(...resolveCultNight(this.players, state, visitCtx));
    events.push(...resolveChemistNight(this.players, visitCtx));
    events.push(...resolveHarlotNight(this.players, visitCtx));
    events.push(...resolveCrowNight(this.players));

    // Must run before resolveClairvoyanceNight - a Seer targeting the Mimic the very night the
    // Mimic locks in their disguise needs to see it applied already, not next night.
    const mimicEvents = resolveMimicNight(this.players);
    for (const e of mimicEvents) {
      if (e.type === 'MimicChoseDisguise') this.mimicTargetMap.set(e.mimicId, e.targetId);
    }
    events.push(...mimicEvents);

    // Unlike the Mimic's permanent disguise, the Chameleon Wolf's only lasts the one night they
    // actively present it - clear any stale entry from a previous night before (maybe) setting a
    // fresh one, so skipping a night truly means no disguise, not "whatever I picked last time".
    this.chameleonAppearanceMap.clear();
    const chameleonEvents = resolveChameleonWolfNight(this.players);
    for (const e of chameleonEvents) {
      if (e.type === 'ChameleonDisguiseChosen') {
        this.chameleonAppearanceMap.set(e.chameleonId, e.appearanceRole);
      }
    }
    events.push(...chameleonEvents);

    events.push(
      ...resolveClairvoyanceNight(
        this.players,
        this.possibleRoles,
        random,
        this.mimicTargetMap,
        this.chameleonAppearanceMap,
      ),
    );

    events.push(...resolveGuardianAngelNight(this.players, state, visitCtx));

    events.push(...resolveNecromancerNight(this.players));

    // Mirrors the original's call order exactly: CheckRoleChanges() runs *before* Thief Night, not after.
    events.push(...checkRoleChanges(this.players));

    events.push(...resolveThiefNight(this.players, this.dayNumber, this.thiefFull, visitCtx));

    // Watchman/Tracker are pure observers of tonight's final state (visit counts, who acted) -
    // resolved last, after every other visit/choice-producing step above, and before the
    // end-of-night loop below wipes that same state for the next night.
    events.push(...resolveWatchmanNight(this.players));
    events.push(...resolveTrackerNight(this.players));

    events.push(...this.trackArchangelStreak(events));

    // Mirrors the tail of NightCycle: `if (CheckForGameEnd()) return;` gates the final per-night
    // reset - if the game just ended, there's no next night to reset state for.
    const win = this.checkWinCondition({ checkBitten: false });
    events.push(...win.events);
    if (win.finished) return events;

    for (const p of this.players) {
      p.diedLastNight = false;
      p.killedLastNight = 0;
      p.wasSavedLastNight = false;
      p.choice = null;
      p.votes = 0;
      if (p.beingVisitedSameNightCount >= 3) p.busyNight = true;
      p.beingVisitedSameNightCount = 0;
    }

    return events;
  }

  /** Mirrors the Gunner/Spumpkin day-action block at the end of `DayCycle`. */
  resolveDayActions(options: { random?: () => number } = {}): GameEvent[] {
    this.assertPhase('Day');
    const random = options.random ?? Math.random;
    const events: GameEvent[] = [
      ...resolveGunnerShot(this.players),
      ...resolveSpumpkinDetonate(this.players, random),
      ...resolveDetectiveSnoop(this.players, random),
      ...resolveArchangelShot(this.players, this.archangelBulletsMap),
    ];
    events.push(...this.trackArchangelStreak(events));
    return events;
  }

  /**
   * "Si 3 villageois innocents meurent consécutivement, [l'Archangel] reçoit une Balle Sacrée" -
   * scans a batch of freshly-resolved events for `PlayerDied`, extending or resetting
   * `consecutiveVillageDeaths` per victim (any death not on the Village team breaks the streak,
   * including one caused by the Archangel's own successful shot). Called after every death-producing
   * resolution step (night, day actions, lynch, the Hunter's final shot) so the streak tracks deaths
   * from every source, not just wolf kills. Returns the `ArchangelBulletGranted` event(s) to append,
   * one per living Archangel, mirroring the derive-from-event pattern used throughout this file.
   */
  private trackArchangelStreak(events: GameEvent[]): GameEvent[] {
    const granted: GameEvent[] = [];

    for (const event of events) {
      if (event.type !== 'PlayerDied') continue;
      const victim = this.players.find((p) => p.id === event.playerId);
      if (!victim) continue;

      if (getTeamForRole(victim.role) !== 'Village') {
        this.consecutiveVillageDeaths = 0;
        continue;
      }

      this.consecutiveVillageDeaths++;
      if (this.consecutiveVillageDeaths < 3) continue;

      this.consecutiveVillageDeaths = 0;
      for (const archangel of this.players) {
        if (archangel.role !== ROLE_BIT.Archangel || archangel.isDead) continue;
        this.archangelBulletsMap.set(archangel.id, (this.archangelBulletsMap.get(archangel.id) ?? 0) + 1);
        granted.push({ type: 'ArchangelBulletGranted', archangelId: archangel.id });
      }
    }

    return granted;
  }

  /**
   * The generic post-hoc kill entrypoint - in practice only ever called for the Hunter's final
   * dying shot (`GameLoop.handleHunterShots`). If that shot lands on the Wise Elder, the guilt
   * costs the Hunter their role entirely, mirroring the Gunner (`day-actions.ts`) and Chemist
   * (`night-resolution.ts`) equivalents against the same target.
   *
   * Mirrors the `CheckRoleChanges()` call the original makes right after resolving the shot
   * (`HunterFinalShot`, "In case the hunter shot someone's role model / the seer / ..."): the
   * target dying here can itself promote an Apprentice Seer or transform a Wild Child/Doppelganger,
   * and that has to be reflected before the caller re-checks the win condition.
   */
  killPlayer(victimId: bigint, method: KillMethod, options: KillOptions = {}): GameEvent[] {
    if (this.phase === 'Ended') throw new GameError('The game has already ended.', 'GAME_OVER');

    const events: GameEvent[] = [];
    const victim = this.players.find((p) => p.id === victimId);
    const killerId = options.killerIds?.[0];
    const killer = killerId !== undefined ? this.players.find((p) => p.id === killerId) : undefined;
    if (victim?.role === ROLE_BIT.WiseElder && killer?.role === ROLE_BIT.Hunter) {
      killer.role = ROLE_BIT.Villager;
      killer.team = getTeamForRole(ROLE_BIT.Villager);
      killer.changedRolesCount++;
      events.push({ type: 'HunterLostPowerToWiseElder', playerId: killer.id });
    }

    events.push(...killPlayer(this.players, victimId, method, options));
    events.push(...this.trackArchangelStreak(events));
    events.push(...checkRoleChanges(this.players));
    return events;
  }

  checkWinCondition(context: WinConditionContext = {}): WinConditionResult {
    // Idempotent once the game has actually ended: without this, a second call after a Hitman win
    // would skip the Hitman branch below (`!hitman.won` is now false, since the first call already
    // set it) and fall through to `evaluateWinCondition()`, which has no idea what a Hitman win even
    // is and would report `finished: false` - flipping an already-decided game back to "still
    // going" from the caller's point of view, even though `this.phase` never actually left 'Ended'.
    if (this.phase === 'Ended') {
      return {
        finished: true,
        ...(this.winningTeam !== undefined && { winningTeam: this.winningTeam }),
        events: [],
      };
    }

    // Hitman: a secret personal win condition that can trigger off ANY kill source (night, lynch,
    // Hunter's dying shot, ...), so it's checked here rather than folded into
    // evaluateWinCondition()'s team-based logic - Hitman's team is 'Neutral', shared with
    // Necromancer/Reflector/Avenger/Crow, and there's no per-role guard there (unlike Tanner's
    // "only the one who just died" check) to stop a blanket team win from wrongly crowning all of
    // them. Only the Hitman who actually landed their contract wins here - the `role ===
    // ROLE_BIT.Hitman` check matters because `hitmanTargetMap` is keyed by the id assigned the
    // role at game start, not by "whoever currently holds it": a Thief who later steals the
    // Hitman's role (Hitman isn't wolf-team, so `nightTargets()` doesn't exclude them from a
    // Thief's pool) would otherwise still get wrongly credited with the original contract even
    // though they're no longer the Hitman, while the new Thief-turned-Hitman could never win at
    // all (they have no map entry of their own).
    for (const [hitmanId, targetId] of this.hitmanTargetMap) {
      const hitman = this.players.find((p) => p.id === hitmanId);
      const target = this.players.find((p) => p.id === targetId);
      if (hitman && hitman.role === ROLE_BIT.Hitman && !hitman.isDead && !hitman.won && target?.isDead) {
        hitman.won = true;
        this.phase = 'Ended';
        this.winningTeam = 'Neutral';
        try {
          teamWins.labels('Neutral').inc();
          roleWins.labels('Hitman').inc();
        } catch {
          // ignore
        }
        return {
          finished: true,
          winningTeam: 'Neutral',
          events: [
            { type: 'HitmanTargetEliminated', hitmanId: hitman.id, targetId: target.id },
            { type: 'GameEnded', winningTeam: 'Neutral' },
          ],
        };
      }
    }

    // Avenger: the same "secret personal Neutral-team win, can't use evaluateWinCondition()'s
    // blanket team logic" reasoning as Hitman above - `avenger.won` is already set the instant
    // their rival is lynched (see lynch.ts's resolveLynchVotes()); this just turns that into a
    // real game-ending state the very next time the win condition is checked.
    const avengerWon = this.players.some((p) => p.role === ROLE_BIT.Avenger && !p.isDead && p.won);
    if (avengerWon) {
      this.phase = 'Ended';
      this.winningTeam = 'Neutral';
      try {
        teamWins.labels('Neutral').inc();
        roleWins.labels('Avenger').inc();
      } catch {
        // ignore
      }
      return {
        finished: true,
        winningTeam: 'Neutral',
        events: [{ type: 'GameEnded', winningTeam: 'Neutral' }],
      };
    }

    const result = evaluateWinCondition(this.players, context);
    if (result.finished) {
      this.phase = 'Ended';
      if (result.winningTeam) {
        this.winningTeam = result.winningTeam;
        try {
          teamWins.labels(result.winningTeam).inc();
        } catch {
          // ignore
        }
        if (['Tanner', 'SerialKiller', 'Arsonist', 'Cultist'].includes(result.winningTeam)) {
          try {
            soloWins.labels(result.winningTeam).inc();
          } catch {
            // ignore
          }
        }
        if (result.winningTeam === 'Lovers') {
          loversWins.inc();
        }
        for (const p of this.players) {
          if (!p.isDead && p.won) {
            try {
              roleWins.labels(roleName(p.role)).inc();
            } catch {
              // ignore
            }
          }
        }
      }
    }
    return result;
  }

  private assertPhase(expected: GamePhase): void {
    if (this.phase !== expected) {
      throw new GameError(
        `Expected phase ${expected} but the game is in ${this.phase}.`,
        'WRONG_PHASE',
      );
    }
  }
}
