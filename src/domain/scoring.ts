import type { Team } from './game/team.js';
import type { Player } from './game/player.js';
import type { GameEvent } from './game/game-event.js';

export interface PlayerScoreResult {
  playerId: bigint;
  points: number;
  won: boolean;
  breakdown: {
    participation: number;
    victoryBonus: number;
    defeatPenalty: number;
    consolation: number;
    afkPenalty: number;
    rolePerformance: number;
    duelBonus: number;
  };
}

/**
 * Calculates leaderboard points earned by players in a finished game.
 *
 * `earlyDeathIds` waives the defeat penalty and grants a bigger consolation bonus for players
 * killed during Night 1, before they ever got a real chance to act (a scripted-random death is
 * bad luck, not a loss they earned). `rolePerformanceBonus` layers a small role-specific
 * bonus/malus on top (see `role-performance.ts`) - additive, never a replacement for the
 * win/lose score above. `duelBonus` (see `computeDuelBonus()` below) does the same for `TeamDuel`
 * wins, on top of the generic winner `victoryBonus` a null `winningTeam` already falls back to -
 * the user explicitly wanted a Duel win to feel more consequential than a regular one, not just
 * land in that generic bucket.
 */
export function calculateGamePoints(
  players: Player[],
  winningTeam: Team | null,
  firstLynchVictimId?: bigint | null,
  afkPlayerIds?: Set<bigint>,
  earlyDeathIds?: Set<bigint>,
  rolePerformanceBonus?: ReadonlyMap<bigint, number>,
  duelBonus?: ReadonlyMap<bigint, number>,
): PlayerScoreResult[] {
  return players.map((player) => {
    let won = false;
    let victoryBonus = 0;
    let defeatPenalty = 0;
    const participation = 5; // +5 pts for completing a game
    let consolation = 0;
    let afkPenalty = 0;
    const rolePerformance = rolePerformanceBonus?.get(player.id) ?? 0;
    const duel = duelBonus?.get(player.id) ?? 0;

    // Check if player was AFK in this game
    if (afkPlayerIds?.has(player.id)) {
      afkPenalty = -15;
    }

    // First lynch victim consolation bonus
    if (firstLynchVictimId && player.id === firstLynchVictimId) {
      consolation = 2;
    }
    // Killed on Night 1, before ever getting a real turn - bigger consolation, wins out over the
    // first-lynch-victim bonus above (the two can't both apply to the same player: one is a night
    // kill, the other a day lynch).
    if (earlyDeathIds?.has(player.id)) {
      consolation = Math.max(consolation, 5);
    }

    const isWinner = player.won || (winningTeam !== null && player.team === winningTeam);
    if (isWinner) {
      won = true;
      if (winningTeam === 'Village') {
        victoryBonus = player.isDead ? 10 : 20;
      } else if (winningTeam === 'Wolf') {
        victoryBonus = player.isDead ? 15 : 25;
      } else if (
        winningTeam === 'Tanner' ||
        winningTeam === 'SerialKiller' ||
        winningTeam === 'Cult' ||
        winningTeam === 'Arsonist' ||
        winningTeam === 'Lovers'
      ) {
        victoryBonus = 35; // Special / Solo role victory
      } else {
        victoryBonus = player.isDead ? 10 : 20;
      }
    } else {
      // Waive the defeat penalty for an early Night 1 death - they never got a chance to play.
      defeatPenalty = earlyDeathIds?.has(player.id) ? 0 : -10;
    }

    const totalPoints =
      participation +
      victoryBonus +
      defeatPenalty +
      consolation +
      afkPenalty +
      rolePerformance +
      duel;

    return {
      playerId: player.id,
      points: totalPoints,
      won,
      breakdown: {
        participation,
        victoryBonus,
        defeatPenalty,
        consolation,
        afkPenalty,
        rolePerformance,
        duelBonus: duel,
      },
    };
  });
}

/**
 * `TeamDuel`'s own leaderboard bonus, meant to be passed straight into `calculateGamePoints()`
 * above. Every member of the winning squad gets a flat base (more if they survived to see it than
 * if they died along the way) plus a shared "how decisively did we win" margin bonus scaled by the
 * winning squad's final survivor count - a 4-0 sweep should feel more rewarding than eking out a
 * win with a single survivor left. Returns an empty map for any game that never emitted a
 * `DuelSquadWon` event, i.e. every non-`TeamDuel` game.
 */
export function computeDuelBonus(
  players: readonly Player[],
  eventBatches: readonly (readonly GameEvent[])[],
): Map<bigint, number> {
  const bonus = new Map<bigint, number>();
  const duelWon = eventBatches
    .flat()
    .find((e): e is Extract<GameEvent, { type: 'DuelSquadWon' }> => e.type === 'DuelSquadWon');
  if (!duelWon) return bonus;

  const marginBonus = 5 * Math.max(0, duelWon.survivorIds.length - 1);
  for (const p of players) {
    if (p.duelSquad !== duelWon.squad) continue;
    bonus.set(p.id, (p.isDead ? 8 : 20) + marginBonus);
  }
  return bonus;
}
