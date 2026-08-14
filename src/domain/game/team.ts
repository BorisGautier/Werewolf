import { ROLE_BIT, type Role } from '../roles/role.js';

/** Port of `Werewolf Node/Models/IPlayer.cs` `ITeam`. */
export type Team =
  | 'Village'
  | 'Cult'
  | 'Wolf'
  | 'Tanner'
  | 'Neutral'
  | 'SerialKiller'
  | 'Lovers'
  | 'Arsonist'
  | 'SKHunter'
  | 'NoOne'
  | 'Thief';

const VILLAGE_ROLES: readonly Role[] = [
  ROLE_BIT.Villager,
  ROLE_BIT.Cursed,
  ROLE_BIT.Drunk,
  ROLE_BIT.Beholder,
  ROLE_BIT.ApprenticeSeer,
  ROLE_BIT.Traitor,
  ROLE_BIT.Mason,
  ROLE_BIT.Hunter,
  ROLE_BIT.Mayor,
  ROLE_BIT.ClumsyGuy,
  ROLE_BIT.Prince,
  ROLE_BIT.WolfMan,
  ROLE_BIT.Pacifist,
  ROLE_BIT.WiseElder,
  ROLE_BIT.Blacksmith,
  ROLE_BIT.Troublemaker,
  ROLE_BIT.Fool,
  ROLE_BIT.Harlot,
  ROLE_BIT.CultistHunter,
  ROLE_BIT.Seer,
  ROLE_BIT.GuardianAngel,
  ROLE_BIT.WildChild,
  ROLE_BIT.Cupid,
  ROLE_BIT.Sandman,
  ROLE_BIT.Oracle,
  ROLE_BIT.Chemist,
  ROLE_BIT.Detective,
  ROLE_BIT.Gunner,
  ROLE_BIT.Spumpkin,
  ROLE_BIT.Augur,
  ROLE_BIT.GraveDigger,
  ROLE_BIT.Watchman,
  ROLE_BIT.Judge,
  ROLE_BIT.Archivist,
  ROLE_BIT.Tracker,
  ROLE_BIT.Priestess,
  ROLE_BIT.Mimic,
  ROLE_BIT.CrownPrince,
  ROLE_BIT.Archangel,
];

const THIEF_TEAM_ROLES: readonly Role[] = [ROLE_BIT.Doppelganger, ROLE_BIT.Thief];

const WOLF_TEAM_ROLES: readonly Role[] = [
  ROLE_BIT.Sorcerer,
  ROLE_BIT.AlphaWolf,
  ROLE_BIT.WolfCub,
  ROLE_BIT.Wolf,
  ROLE_BIT.Lycan,
  ROLE_BIT.SnowWolf,
  ROLE_BIT.TrapperWolf,
  ROLE_BIT.ChameleonWolf,
  ROLE_BIT.ViperWolf,
  ROLE_BIT.HowlerWolf,
  ROLE_BIT.HypnotistWolf,
  ROLE_BIT.BerserkerWolf,
];

/** Port of `Werewolf.cs`'s `SetTeam`: derives a player's team from their current role. */
export function getTeamForRole(role: Role): Team {
  if (VILLAGE_ROLES.includes(role)) return 'Village';
  if (THIEF_TEAM_ROLES.includes(role)) return 'Thief';
  if (WOLF_TEAM_ROLES.includes(role)) return 'Wolf';
  if (role === ROLE_BIT.Tanner || role === ROLE_BIT.Jester) return 'Tanner';
  if (role === ROLE_BIT.Cultist) return 'Cult';
  if (role === ROLE_BIT.SerialKiller) return 'SerialKiller';
  if (role === ROLE_BIT.Arsonist) return 'Arsonist';
  if (
    role === ROLE_BIT.Necromancer ||
    role === ROLE_BIT.Hitman ||
    role === ROLE_BIT.Reflector ||
    role === ROLE_BIT.Avenger ||
    role === ROLE_BIT.Crow
  ) {
    return 'Neutral';
  }
  throw new RangeError(`No team mapping for role: ${role.toString()}`);
}
