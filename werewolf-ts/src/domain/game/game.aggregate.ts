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

import { balance, WOLF_ROLES, type BalanceOptions } from './game-balancing.js';
import { killPlayer, type KillOptions } from './kill.js';
import { resetLynchState, resolveLynchVotes, type LynchOptions, type LynchResult } from './lynch.js';
import { evaluateWinCondition, type WinConditionContext, type WinConditionResult } from './win-condition.js';
import { resolveClairvoyanceNight } from './clairvoyance.js';
import { resolveDetectiveSnoop, resolveGunnerShot, resolveSpumpkinDetonate } from './day-actions.js';
import {
  findActingGuardianAngel,
  initialNightState,
  resolveArsonistNight,
  resolveChemistNight,
  resolveCultistHunterNight,
  resolveCultNight,
  resolveGuardianAngelNight,
  resolveHarlotNight,
  resolveSerialKillerNight,
  resolveSnowWolfNight,
  resolveThiefNight,
  resolveWolfNight,
} from './night-resolution.js';
import type { VisitContext } from './night-visit.js';
import { checkRoleChanges, validateSpecialRoleChoices } from './role-changes.js';
import { promoteToWolf } from './transform.js';
import type { GameEvent } from './game-event.js';
import type { GameMode } from './game-mode.js';
import type { GamePhase } from './game-phase.js';
import { ABSTAIN, alivePlayers, createPlayer, type Player } from './player.js';
import { ROLE_BIT, type Role, type RoleFlags } from '../roles/role.js';
import { getTeamForRole, type Team } from './team.js';
import { shuffle } from '../shared/shuffle.js';
import type { KillMethod } from './kill-method.js';

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

export class Game {
  readonly chatId: bigint;
  readonly mode: GameMode;
  phase: GamePhase = 'Joining';
  dayNumber = 0;
  players: Player[] = [];
  wolfCubKilled = false;
  winningTeam?: Team;
  /** The full candidate role pool this game was balanced from (useful for Beholder-style "possible roles" hints). */
  possibleRoles: Role[] = [];

  /** Mirrors `_silverSpread`: the Blacksmith protected the whole village from wolves tonight. */
  silverSpread = false;
  /** Mirrors `_sandmanSleep`: the Sandman put the whole village (and the night's events) to sleep. */
  sandmanSleep = false;
  /** Mirrors `_pacifistUsed`: the Pacifist has declared peace - the next lynch resolution is skipped. */
  pacifistUsed = false;
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

  addPlayer(id: bigint, name: string): Player {
    if (this.phase !== 'Joining') throw new GameError('Cannot join once the game has started.', 'NOT_JOINING');
    if (this.players.some((p) => p.id === id)) {
      throw new GameError('This player already joined.', 'ALREADY_JOINED');
    }
    if (this.players.length >= this.maxPlayers) {
      throw new GameError('This group is full.', 'GROUP_FULL');
    }
    // Villager/Village is a placeholder until assignRolesAndStart() deals real roles.
    const player = createPlayer(id, name, ROLE_BIT.Villager, 'Village');
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
      throw new GameError(`Not enough players joined (need at least ${this.minPlayers}).`, 'NOT_ENOUGH_PLAYERS');
    }

    const { rolesToAssign, possibleRoles } = balance({
      disabledRoleFlags: this.disabledRoleFlags,
      playerCount: this.players.length,
      chaos: balanceOptions.chaos ?? this.mode === 'Chaos',
      burningOverkill: this.burningOverkill,
    });

    shuffle(this.players);
    shuffle(rolesToAssign);

    this.players.forEach((player, index) => {
      const role = rolesToAssign[index]!;
      player.role = role;
      player.team = getTeamForRole(role);
    });
    this.possibleRoles = possibleRoles;

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
  startLynch(): void {
    this.assertPhase('Day');
    this.phase = 'Lynch';
    this.lynchAttempt = 0;
    this.lynchAttemptsPlanned = this.doubleLynchPending ? 2 : 1;
    this.doubleLynchPending = false;
    this.noOneCastLynchVoteYet = true;
    resetLynchState(this.players);
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
  resolveLynch(): LynchResult & WinConditionResult {
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
    };
    const lynchResult = resolveLynchVotes(this.players, lynchOptions);

    const win = this.checkWinCondition({ checkBitten: true });
    return { ...lynchResult, ...win, events: [...lynchResult.events, ...win.events] };
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

    for (const p of this.players) {
      p.choice = null;
      p.choice2 = null;
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
    const gravedigger = this.players.find((p) => p.role === ROLE_BIT.GraveDigger && !p.isDead && !p.drunk);
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
    return [{ type: 'GraveDug', playerId: gravedigger.id, graveCount: gravedigger.dugGravesLastNight }];
  }

  /**
   * The five "click a button, flip a flag" day abilities from `HandleReply`.
   * Each returns whether the ability actually triggered (false if the
   * player isn't who/what they claim, or already used it this game).
   */

  /** Mirrors the Mayor's "reveal" button: doubles their lynch vote from now on. */
  useMayorReveal(playerId: bigint): boolean {
    const mayor = this.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Mayor && !p.isDead);
    if (!mayor || mayor.hasUsedAbility) return false;
    mayor.hasUsedAbility = true;
    return true;
  }

  /** Mirrors the Pacifist's "peace" button: cancels the next lynch, overriding a pending Troublemaker double lynch. */
  usePacifistPeace(playerId: bigint): boolean {
    const pacifist = this.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Pacifist && !p.isDead);
    if (!pacifist || pacifist.hasUsedAbility) return false;
    pacifist.hasUsedAbility = true;
    this.pacifistUsed = true;
    this.doubleLynchPending = false;
    return true;
  }

  /**
   * Mirrors the Blacksmith's "spread silver" button: protects the village from being eaten by
   * wolves tonight. Returns the resulting events (empty if the ability didn't fire) rather than
   * a bare boolean so `WastedSilver` (Blacksmith and Sandman both act the same day) can be
   * detected from the day's event batch alone.
   */
  useBlacksmithSpreadSilver(playerId: bigint): GameEvent[] {
    const blacksmith = this.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Blacksmith && !p.isDead);
    if (!blacksmith || blacksmith.hasUsedAbility) return [];
    blacksmith.hasUsedAbility = true;
    this.silverSpread = true;
    return [{ type: 'BlacksmithSpreadSilver', playerId, dayNumber: this.dayNumber }];
  }

  /** Mirrors the Sandman's "sleep" button: the whole village (and every role's action) skips tonight. */
  useSandmanSleep(playerId: bigint): GameEvent[] {
    const sandman = this.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Sandman && !p.isDead);
    if (!sandman || sandman.hasUsedAbility) return [];
    sandman.hasUsedAbility = true;
    this.sandmanSleep = true;
    return [{ type: 'SandmanUsedSleep', playerId, dayNumber: this.dayNumber }];
  }

  /** Mirrors the Troublemaker's "double lynch" button: forces two lynch attempts today, overriding a pending Pacifist peace. */
  useTroublemakerDoubleLynch(playerId: bigint): boolean {
    const troublemaker = this.players.find((p) => p.id === playerId && p.role === ROLE_BIT.Troublemaker && !p.isDead);
    if (!troublemaker || troublemaker.hasUsedAbility) return false;
    troublemaker.hasUsedAbility = true;
    this.doubleLynchPending = true;
    this.pacifistUsed = false;
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
    const visitCtx: VisitContext = { players: this.players, dayNumber: this.dayNumber, thiefFull: this.thiefFull, random };

    events.push(...resolveSnowWolfNight(this.players, state, visitCtx));
    // A Snow Wolf freezing a Grave Digger who dug tonight rewinds the state's copy of `lastGraveDigAt`
    // (see night-resolution.ts) - mirror that back onto the persisted timestamp used next night.
    this.lastGraveDigAt = state.lastGraveDigAt;
    events.push(...resolveArsonistNight(this.players, state, visitCtx));

    this.wolfCubKilled = false; // mirrors `WolfCubKilled = false;` right before the Wolf Night block
    const wolfEvents = resolveWolfNight(this.players, state, visitCtx);
    if (wolfEvents.some((e) => e.type === 'WolfCubKilled')) this.wolfCubKilled = true;
    events.push(...wolfEvents);

    events.push(...resolveSerialKillerNight(this.players, state, visitCtx));
    events.push(...resolveCultistHunterNight(this.players, visitCtx));
    events.push(...resolveCultNight(this.players, state, visitCtx));
    events.push(...resolveChemistNight(this.players, visitCtx));
    events.push(...resolveHarlotNight(this.players, visitCtx));

    events.push(...resolveClairvoyanceNight(this.players, this.possibleRoles, random));

    events.push(...resolveGuardianAngelNight(this.players, state, visitCtx));

    // Mirrors the original's call order exactly: CheckRoleChanges() runs *before* Thief Night, not after.
    events.push(...checkRoleChanges(this.players));

    events.push(...resolveThiefNight(this.players, this.dayNumber, this.thiefFull, visitCtx));

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
    return [
      ...resolveGunnerShot(this.players),
      ...resolveSpumpkinDetonate(this.players, random),
      ...resolveDetectiveSnoop(this.players, random),
    ];
  }

  /**
   * The generic post-hoc kill entrypoint - in practice only ever called for the Hunter's final
   * dying shot (`GameLoop.handleHunterShots`). If that shot lands on the Wise Elder, the guilt
   * costs the Hunter their role entirely, mirroring the Gunner (`day-actions.ts`) and Chemist
   * (`night-resolution.ts`) equivalents against the same target.
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
    return events;
  }

  checkWinCondition(context: WinConditionContext = {}): WinConditionResult {
    const result = evaluateWinCondition(this.players, context);
    if (result.finished) {
      this.phase = 'Ended';
      if (result.winningTeam) this.winningTeam = result.winningTeam;
    }
    return result;
  }

  private assertPhase(expected: GamePhase): void {
    if (this.phase !== expected) {
      throw new GameError(`Expected phase ${expected} but the game is in ${this.phase}.`, 'WRONG_PHASE');
    }
  }
}
