/**
 * Aggregate root tying together role assignment, phase transitions, lynch
 * voting and win-condition checks - the parts of `Werewolf.cs`'s main loop
 * (`while (IsRunning) { GameDay++; NightCycle(); DayCycle(); LynchCycle(); }`)
 * that are pure state transitions.
 *
 * Deliberately NOT included here: resolving individual roles' night actions
 * (Seer looking, Wolves voting a victim, Guardian Angel protecting, ...) and
 * anything involving Telegram menus or timers - those belong to the
 * application/infrastructure layers, built on top of this aggregate.
 */

import { balance, type BalanceOptions } from './game-balancing.js';
import { killPlayer, type KillOptions } from './kill.js';
import { resetLynchState, resolveLynchVotes, type LynchOptions, type LynchResult } from './lynch.js';
import { evaluateWinCondition, type WinConditionContext, type WinConditionResult } from './win-condition.js';
import type { GameEvent } from './game-event.js';
import type { GameMode } from './game-mode.js';
import type { GamePhase } from './game-phase.js';
import { createPlayer, type Player } from './player.js';
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

  private readonly disabledRoleFlags: RoleFlags;
  private readonly burningOverkill: boolean;
  private readonly randomLynchOnTie: boolean;
  private readonly minPlayers: number;
  private readonly maxPlayers: number;
  private lynchAttempt = 0;

  constructor(options: GameOptions) {
    this.chatId = options.chatId;
    this.mode = options.mode;
    this.disabledRoleFlags = options.disabledRoleFlags ?? 0n;
    this.burningOverkill = options.burningOverkill ?? false;
    this.randomLynchOnTie = options.randomLynchOnTie ?? true;
    this.minPlayers = options.minPlayers ?? 5;
    this.maxPlayers = options.maxPlayers ?? 35;
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
  start(balanceOptions: Partial<Pick<BalanceOptions, 'chaos'>> = {}): void {
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

    this.enterNight();
  }

  /** Mirrors the `Time = GameTime.Day` transition in `DayCycle()`. */
  startDay(): void {
    this.assertPhase('Night');
    this.phase = 'Day';
  }

  /** Mirrors the `Time = GameTime.Lynch` transition + per-round reset at the top of `LynchCycle()`. */
  startLynch(): void {
    this.assertPhase('Day');
    this.phase = 'Lynch';
    this.lynchAttempt = 0;
    resetLynchState(this.players);
  }

  /** Tallies votes and resolves the lynch. Call again (after resetting choices) for a forced double lynch. */
  resolveLynch(): LynchResult & WinConditionResult {
    this.assertPhase('Lynch');
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
    resetLynchState(this.players);
  }

  /** Mirrors the `Time = GameTime.Night; GameDay++` at the top of each loop iteration. */
  startNight(): void {
    this.assertPhase('Lynch');
    this.enterNight();
  }

  private enterNight(): void {
    this.dayNumber++;
    this.phase = 'Night';
  }

  killPlayer(victimId: bigint, method: KillMethod, options: KillOptions = {}): GameEvent[] {
    if (this.phase === 'Ended') throw new GameError('The game has already ended.', 'GAME_OVER');
    return killPlayer(this.players, victimId, method, options);
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
