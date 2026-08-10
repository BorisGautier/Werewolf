/** Port of `Werewolf Node/Helpers/Extensions.cs`'s `GetPlayerForRole`/`GetPlayersForRoles`/`GetPlayersForTeam`. */

import type { Role } from '../roles/role.js';
import type { Player } from './player.js';
import type { Team } from './team.js';

function timeDiedSortKey(p: Player): number {
  // A player who hasn't died sorts as "most recent" (mirrors TimeDied defaulting to DateTime.MaxValue).
  return p.timeDied === null ? Infinity : p.timeDied.getTime();
}

/**
 * If `aliveOnly` is false and there are multiple players with this role, returns the alive one,
 * or - if none are alive - the one who died most recently.
 */
export function getPlayerForRole(
  players: readonly Player[],
  role: Role,
  aliveOnly = true,
  exceptId?: bigint,
): Player | undefined {
  const candidates = players.filter(
    (p) => p.role === role && (!aliveOnly || !p.isDead) && p.id !== exceptId,
  );
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => timeDiedSortKey(b) - timeDiedSortKey(a))[0];
}

export function getPlayersForRoles(
  players: readonly Player[],
  roles: readonly Role[],
  aliveOnly = true,
  exceptId?: bigint,
): Player[] {
  return players.filter((p) => roles.includes(p.role) && (!aliveOnly || !p.isDead) && p.id !== exceptId);
}

export function getPlayersForTeam(
  players: readonly Player[],
  team: Team,
  aliveOnly = true,
  exceptId?: bigint,
): Player[] {
  return players.filter((p) => p.team === team && (!aliveOnly || !p.isDead) && p.id !== exceptId);
}
