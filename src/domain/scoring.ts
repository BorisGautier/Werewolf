import type { Team } from './game/team.js';
import type { Player } from './game/player.js';

export interface PlayerScoreResult {
  playerId: bigint;
  points: number;
  won: boolean;
  breakdown: {
    participation: number;
    victoryBonus: number;
    consolation: number;
    afkPenalty: number;
  };
}

/**
 * Calculates leaderboard points earned by players in a finished game.
 */
export function calculateGamePoints(
  players: Player[],
  winningTeam: Team | null,
  firstLynchVictimId?: bigint | null,
  afkPlayerIds?: Set<bigint>,
): PlayerScoreResult[] {
  return players.map((player) => {
    let won = false;
    let victoryBonus = 0;
    const participation = 5; // +5 pts for completing a game
    let consolation = 0;
    let afkPenalty = 0;

    // Check if player was AFK in this game
    if (afkPlayerIds?.has(player.id)) {
      afkPenalty = -10;
    }

    // First lynch victim consolation bonus
    if (firstLynchVictimId && player.id === firstLynchVictimId) {
      consolation = 2;
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
    }

    const totalPoints = Math.max(0, participation + victoryBonus + consolation + afkPenalty);

    return {
      playerId: player.id,
      points: totalPoints,
      won,
      breakdown: {
        participation,
        victoryBonus,
        consolation,
        afkPenalty,
      },
    };
  });
}
