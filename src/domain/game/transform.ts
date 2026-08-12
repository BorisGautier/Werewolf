/**
 * Minimal, state-only slice of `Werewolf.cs`'s `Transform` (full version also
 * handles messaging/team notifications/role-model bookkeeping - infra
 * concerns layered on top later). Shared by every place a role change
 * happens outright: the Traitor/Snow Wolf end-game promotion, a bitten
 * player turning at the start of the next night, a Cursed villager bitten by
 * wolves, etc.
 */

import { ROLE_BIT } from '../roles/role.js';
import { getTeamForRole } from './team.js';
import type { Player } from './player.js';

export function promoteToWolf(player: Player): void {
  player.role = ROLE_BIT.Wolf;
  player.team = getTeamForRole(ROLE_BIT.Wolf);
  player.changedRolesCount++;
}

export function promoteToCultist(player: Player, dayNumber: number): void {
  player.role = ROLE_BIT.Cultist;
  player.team = getTeamForRole(ROLE_BIT.Cultist);
  player.changedRolesCount++;
  player.dayCult = dayNumber;
}
