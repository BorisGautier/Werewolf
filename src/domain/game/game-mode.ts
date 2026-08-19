export type GameMode =
  | 'Normal'
  | 'Chaos'
  | 'Bloodbath'
  | 'DarkMagic'
  | 'WolfPack'
  | 'CursedVillage'
  | 'Infection'
  | 'Anarchy'
  | 'HolyWar'
  | 'Assassins'
  | 'TeamDuel';

export const GAME_MODES: readonly GameMode[] = [
  'Normal',
  'Chaos',
  'Bloodbath',
  'DarkMagic',
  'WolfPack',
  'CursedVillage',
  'Infection',
  'Anarchy',
  'HolyWar',
  'Assassins',
  'TeamDuel',
];

/** Minimum players for `TeamDuel` - below this, one death would too often decide the whole match
 * on the spot, leaving no room for the mode's whole point (team strategy over several rounds of
 * night/day/lynch). Also enforces an even player count so the two squads split evenly - see
 * `GameLobbyManager.finishJoining()`. */
export const TEAM_DUEL_MIN_PLAYERS = 6;
