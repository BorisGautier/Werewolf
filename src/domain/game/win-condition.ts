/**
 * Port of `Werewolf.cs`'s `CheckForGameEnd` + `DoGameEnd`.
 *
 * Kept pure and IO-free: no messages are sent, no achievements are granted,
 * no DB rows are written here - the caller turns the returned `GameEvent[]`
 * into chat messages/persistence. `Player.won` is still set directly (it's
 * core rules state, not presentation), matching the original's `DoGameEnd`.
 */

import { ROLE_BIT, type Role } from '../roles/role.js';
import { killPlayer } from './kill.js';
import type { GameEvent } from './game-event.js';
import { alivePlayers, type Player } from './player.js';
import { getTeamForRole, type Team } from './team.js';
import { promoteToWolf } from './transform.js';

const CLASSIC_WOLF_ROLES: readonly Role[] = [
  ROLE_BIT.Wolf,
  ROLE_BIT.AlphaWolf,
  ROLE_BIT.WolfCub,
  ROLE_BIT.Lycan,
  ROLE_BIT.TrapperWolf,
  ROLE_BIT.ChameleonWolf,
  ROLE_BIT.ViperWolf,
  ROLE_BIT.HowlerWolf,
  ROLE_BIT.HypnotistWolf,
  ROLE_BIT.BerserkerWolf,
];

const NO_ONE_SOLO_ROLES: readonly Role[] = [ROLE_BIT.Sorcerer, ROLE_BIT.Tanner, ROLE_BIT.Thief, ROLE_BIT.Doppelganger];

function isClassicWolf(role: Role): boolean {
  return CLASSIC_WOLF_ROLES.includes(role);
}

function isWolfOrSnowWolf(role: Role): boolean {
  return isClassicWolf(role) || role === ROLE_BIT.SnowWolf;
}

export interface WinConditionContext {
  /** Mirrors `checkbitten`: when true, a bitten player about to turn wolf blocks any end-of-game resolution. */
  checkBitten?: boolean;
  /** Injectable RNG in [0, 1) for the Hunter-vs-Wolf standoff coin flip - defaults to Math.random. */
  random?: () => number;
  /** Mirrors `Settings.HunterKillWolfChanceBase` (30). */
  hunterKillWolfChancePercent?: number;
}

export interface WinConditionResult {
  finished: boolean;
  winningTeam?: Team;
  events: GameEvent[];
}

export function evaluateWinCondition(players: Player[], context: WinConditionContext = {}): WinConditionResult {
  const checkBitten = context.checkBitten ?? false;
  const random = context.random ?? Math.random;
  const hunterKillWolfChancePercent = context.hunterKillWolfChancePercent ?? 30;
  const events: GameEvent[] = [];

  const alive = alivePlayers(players);

  // A lone Traitor/SnowWolf is promoted to full Wolf once no "real" wolf is left alive.
  if (alive.every((p) => !isClassicWolf(p.role))) {
    const snowWolf = alive.find((p) => p.role === ROLE_BIT.SnowWolf);
    if (snowWolf) {
      if (!checkBitten || alive.every((p) => !p.bitten)) {
        promoteToWolf(snowWolf);
        events.push({ type: 'SnowWolfBecameWolf', playerId: snowWolf.id });
      } else {
        return { finished: false, events };
      }
    } else {
      const traitor = alive.find((p) => p.role === ROLE_BIT.Traitor);
      if (traitor) {
        if (!checkBitten || alive.every((p) => !p.bitten)) {
          promoteToWolf(traitor);
          events.push({ type: 'TraitorBecameWolf', playerId: traitor.id });
        } else {
          return { finished: false, events };
        }
      }
    }
  }

  function end(winningTeam: Team): WinConditionResult {
    events.push(declareWinner(players, winningTeam));
    return { finished: true, winningTeam, events };
  }

  if (alive.length === 0) return end('NoOne');

  if (alive.length === 1) {
    const p = alive[0]!;
    if (NO_ONE_SOLO_ROLES.includes(p.role)) return end('NoOne');
    return end(p.team);
  }

  if (alive.length === 2) {
    if (alive.every((p) => p.inLove)) return end('Lovers');

    if (alive.every((p) => NO_ONE_SOLO_ROLES.includes(p.role))) return end('NoOne');

    const hunter = alive.find((p) => p.role === ROLE_BIT.Hunter);
    if (hunter) {
      const other = alive.find((p) => p.id !== hunter.id);
      if (!other) return end('Village');
      if (other.role === ROLE_BIT.SerialKiller) return end('SKHunter');
      if (isWolfOrSnowWolf(other.role)) {
        if (Math.floor(random() * 100) < hunterKillWolfChancePercent) {
          events.push({ type: 'HunterKilledWolfInStandoff', hunterId: hunter.id, wolfId: other.id });
          events.push(...killPlayer(players, other.id, 'HunterShot', { killerIds: [hunter.id], isNight: false }));
          return end('Village');
        } else {
          events.push({ type: 'WolfKilledHunterInStandoff', wolfId: other.id, hunterId: hunter.id });
          events.push(
            ...killPlayer(players, hunter.id, 'Eat', {
              killerIds: [other.id],
              isNight: false,
              triggerHunterShot: false,
            }),
          );
          return end('Wolf');
        }
      }
    }

    if (alive.some((p) => p.role === ROLE_BIT.SerialKiller)) return end('SerialKiller');

    if (alive.some((p) => p.role === ROLE_BIT.Arsonist) && !alive.some((p) => p.role === ROLE_BIT.Gunner && p.bullet > 0)) {
      return end('Arsonist');
    }

    const cultist = alive.find((p) => p.role === ROLE_BIT.Cultist);
    if (cultist) {
      const other = alive.find((p) => p.id !== cultist.id);
      if (!other) return end('Cult'); // two cultists left

      if (isWolfOrSnowWolf(other.role)) return end('Wolf');

      if (other.role === ROLE_BIT.CultistHunter) {
        events.push({ type: 'CultistHunterKilledCultist', cultistHunterId: other.id, cultistId: cultist.id });
        return end('Village');
      }

      if (other.role !== ROLE_BIT.Doppelganger && other.role !== ROLE_BIT.Thief) {
        other.role = ROLE_BIT.Cultist;
        other.team = getTeamForRole(ROLE_BIT.Cultist);
        events.push({ type: 'CultistAutoConverted', playerId: other.id });
      }
      return end('Cult');
    }
    // No branch matched - fall through to the generic checks below.
  }

  if (alive.length === 3) {
    if (alive.every((p) => [ROLE_BIT.Sorcerer, ROLE_BIT.Thief, ROLE_BIT.Doppelganger].includes(p.role))) {
      return end('NoOne');
    }
  }

  if (alive.some((p) => p.team === 'SerialKiller')) return { finished: false, events };
  if (alive.some((p) => p.team === 'Arsonist')) return { finished: false, events };

  if (alive.every((p) => p.team === 'Cult')) return end('Cult');

  const wolfCount = alive.filter((p) => isWolfOrSnowWolf(p.role)).length;
  const otherCount = alive.filter((p) => !isWolfOrSnowWolf(p.role)).length;
  if (wolfCount >= otherCount) {
    const armedGunner = alive.some((p) => p.role === ROLE_BIT.Gunner && p.bullet > 0);
    if (armedGunner) {
      const wolves = alive.filter((p) => isWolfOrSnowWolf(p.role));
      const others = alive.filter((p) => !isWolfOrSnowWolf(p.role));
      const gunnerMakesTheDifference =
        wolves.length === others.length ||
        (wolves.length === others.length + 1 && wolves.filter((p) => p.inLove).length === 2);
      if (gunnerMakesTheDifference) {
        events.push({ type: 'GunnerPreventsWolfWin' });
        return { finished: false, events };
      }
    }
    return end('Wolf');
  }

  const noMoreThreats = alive.every(
    (p) =>
      !isWolfOrSnowWolf(p.role) &&
      p.role !== ROLE_BIT.Cultist &&
      p.role !== ROLE_BIT.SerialKiller &&
      p.role !== ROLE_BIT.Arsonist,
  );
  if (noMoreThreats && (!checkBitten || alive.every((p) => !p.bitten))) {
    return end('Village');
  }

  return { finished: false, events };
}

/**
 * Marks the winners for `winningTeam` (port of `DoGameEnd`'s winner-marking,
 * minus achievements/DB persistence) and returns the corresponding event.
 * Exported so other resolution paths that end the game outright (e.g. a
 * lynched Tanner) can reuse the exact same winner-marking rules.
 */
export function declareWinner(players: readonly Player[], winningTeam: Team): GameEvent {
  markWinners(players, winningTeam);
  return { type: 'GameEnded', winningTeam };
}

function markWinners(players: readonly Player[], winningTeam: Team): void {
  if (winningTeam === 'Lovers') {
    for (const p of players) {
      if (p.inLove) p.won = true;
    }
    return;
  }

  for (const p of players) {
    if (p.team !== winningTeam) continue;
    if ((winningTeam === 'SerialKiller' || winningTeam === 'Arsonist') && p.isDead) continue;
    if (winningTeam === 'Tanner' && !p.diedLastNight) continue;

    p.won = true;
    if (p.inLove && p.loverId !== null) {
      const lover = players.find((x) => x.id === p.loverId);
      if (lover) lover.won = true;
    }
  }
}
