import type { Team } from './game/team.js';
import type { Player } from './game/player.js';

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
  };
}

/**
 * Calculates leaderboard points earned by players in a finished game.
 *
 * `earlyDeathIds` waives the defeat penalty and grants a bigger consolation bonus for players
 * killed during Night 1, before they ever got a real chance to act (a scripted-random death is
 * bad luck, not a loss they earned). `rolePerformanceBonus` layers a small role-specific
 * bonus/malus on top (see `role-performance.ts`) - additive, never a replacement for the
 * win/lose score above.
 */
export function calculateGamePoints(
  players: Player[],
  winningTeam: Team | null,
  firstLynchVictimId?: bigint | null,
  afkPlayerIds?: Set<bigint>,
  earlyDeathIds?: Set<bigint>,
  rolePerformanceBonus?: ReadonlyMap<bigint, number>,
): PlayerScoreResult[] {
  return players.map((player) => {
    let won = false;
    let victoryBonus = 0;
    let defeatPenalty = 0;
    const participation = 5; // +5 pts for completing a game
    let consolation = 0;
    let afkPenalty = 0;
    const rolePerformance = rolePerformanceBonus?.get(player.id) ?? 0;

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
      participation + victoryBonus + defeatPenalty + consolation + afkPenalty + rolePerformance;

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
      },
    };
  });
}
