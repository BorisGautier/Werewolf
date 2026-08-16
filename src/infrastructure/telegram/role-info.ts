import type { RoleName } from '../../domain/roles/role.js';

/**
 * Port of `HelpCommands.cs`'s `/rolelist` + `Helpers.cs`'s `GetAbout` (the original resolves
 * `/about<trigger>` by looking up a locale string literally keyed `About<Trigger>` - `UpdateHandler`
 * dispatches anything starting with "about" to it). Triggers mirror the original's abbreviations
 * (`ww` for Wolf, `ga` for Guardian Angel, `dg` for Doppelganger, ...) rather than the full role
 * name, since that's the exact command surface existing players already know. `Spumpkin` is
 * intentionally absent - the original never shipped an `/about` entry for it either.
 */
export const ABOUT_ROLE_BY_TRIGGER: Readonly<Record<string, RoleName>> = {
  vg: 'Villager',
  ww: 'Wolf',
  drunk: 'Drunk',
  seer: 'Seer',
  cursed: 'Cursed',
  harlot: 'Harlot',
  bh: 'Beholder',
  gunner: 'Gunner',
  traitor: 'Traitor',
  ga: 'GuardianAngel',
  detective: 'Detective',
  apps: 'ApprenticeSeer',
  cult: 'Cultist',
  ch: 'CultistHunter',
  wc: 'WildChild',
  fool: 'Fool',
  mason: 'Mason',
  dg: 'Doppelganger',
  cupid: 'Cupid',
  hunter: 'Hunter',
  sk: 'SerialKiller',
  tanner: 'Tanner',
  mayor: 'Mayor',
  prince: 'Prince',
  sorcerer: 'Sorcerer',
  clumsy: 'ClumsyGuy',
  blacksmith: 'Blacksmith',
  alphawolf: 'AlphaWolf',
  wolfcub: 'WolfCub',
  sandman: 'Sandman',
  oracle: 'Oracle',
  wolfman: 'WolfMan',
  lycan: 'Lycan',
  pacifist: 'Pacifist',
  wiseelder: 'WiseElder',
  thief: 'Thief',
  troublemaker: 'Troublemaker',
  chemist: 'Chemist',
  snowwolf: 'SnowWolf',
  gravedigger: 'GraveDigger',
  arsonist: 'Arsonist',
  augur: 'Augur',
  watchman: 'Watchman',
  judge: 'Judge',
  archivist: 'Archivist',
  tracker: 'Tracker',
  priestess: 'Priestess',
  mimic: 'Mimic',
  crownprince: 'CrownPrince',
  archangel: 'Archangel',
  trapperwolf: 'TrapperWolf',
  chameleonwolf: 'ChameleonWolf',
  viperwolf: 'ViperWolf',
  howlerwolf: 'HowlerWolf',
  hypnotistwolf: 'HypnotistWolf',
  berserkerwolf: 'BerserkerWolf',
  necromancer: 'Necromancer',
  jester: 'Jester',
  hitman: 'Hitman',
  reflector: 'Reflector',
  avenger: 'Avenger',
  crow: 'Crow',
};

/** The locale key `Helpers.GetAbout` would resolve for this role's `/about<trigger>` text. */
export function aboutLocaleKey(role: RoleName): string {
  return `About${role}`;
}

/** Resolves any `/about<trigger>`, `/about<roleName>`, `/<trigger>`, or `/<roleName>` command string. */
export function resolveRoleFromTrigger(input: string): RoleName | null {
  const clean = input.toLowerCase().replace(/^\/?about/, '');
  if (ABOUT_ROLE_BY_TRIGGER[clean]) return ABOUT_ROLE_BY_TRIGGER[clean]!;
  const roleEntry = Object.values(ABOUT_ROLE_BY_TRIGGER).find((r) => r.toLowerCase() === clean);
  return roleEntry ?? null;
}
