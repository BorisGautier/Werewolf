/**
 * Port of `/config`'s interactive settings menu (`AdminCommands.cs`'s `Config` +
 * `UpdateHandler.GetConfigMenu`/`HandleConfigCallback`). PM'd to the admin who
 * requested it; every button press edits that same message in place.
 */

import { InlineKeyboard } from 'grammy';
import { ROLE_META, ROLE_NAMES, type RoleName } from '../../domain/roles/role.js';
import { GroupRepository, type GroupWithConfig } from '../persistence/group.repository.js';
import type { Translator } from '../i18n/translator.js';

const DISABLEABLE_ROLES: readonly RoleName[] = ROLE_NAMES.filter((name) => ROLE_META[name].canBeDisabled);
const ROLES_PER_PAGE = 8;

const TIMER_PRESETS = [30, 60, 90, 120, 150, 180, 240, 300] as const;
const EXTEND_PRESETS = [0, 30, 60, 90, 120] as const;
const MAX_PLAYER_PRESETS = [10, 15, 20, 25, 30, 35] as const;

/** A boolean `Group` column exposed as a single on/off button on the options page. */
interface ToggleField {
  code: string;
  field: keyof Pick<
    GroupWithConfig,
    | 'thiefFull'
    | 'burningOverkill'
    | 'showRolesOnDeath'
    | 'showIds'
    | 'shufflePlayerList'
    | 'randomMode'
    | 'secretLynch'
    | 'secretLynchShowVotes'
    | 'secretLynchShowVoters'
    | 'pmLynchVote'
    | 'allowExtend'
    | 'allowFlee'
    | 'allowNsfw'
    | 'allowTanner'
    | 'allowFool'
    | 'allowCult'
    | 'allowThief'
    | 'allowArsonist'
    | 'muteDead'
    | 'tagAllOnStart'
  >;
  labelKey: string;
}

const TOGGLE_FIELDS: readonly ToggleField[] = [
  { code: 'tf', field: 'thiefFull', labelKey: 'CfgThiefFull' },
  { code: 'bo', field: 'burningOverkill', labelKey: 'CfgBurningOverkill' },
  { code: 'srd', field: 'showRolesOnDeath', labelKey: 'CfgShowRolesOnDeath' },
  { code: 'sid', field: 'showIds', labelKey: 'CfgShowIds' },
  { code: 'spl', field: 'shufflePlayerList', labelKey: 'CfgShufflePlayerList' },
  { code: 'rm', field: 'randomMode', labelKey: 'CfgRandomMode' },
  { code: 'sl', field: 'secretLynch', labelKey: 'CfgSecretLynch' },
  { code: 'slv', field: 'secretLynchShowVotes', labelKey: 'CfgSecretLynchShowVotes' },
  { code: 'slr', field: 'secretLynchShowVoters', labelKey: 'CfgSecretLynchShowVoters' },
  { code: 'pml', field: 'pmLynchVote', labelKey: 'CfgPmLynchVote' },
  { code: 'ae', field: 'allowExtend', labelKey: 'CfgAllowExtend' },
  { code: 'af', field: 'allowFlee', labelKey: 'CfgAllowFlee' },
  { code: 'ans', field: 'allowNsfw', labelKey: 'CfgAllowNsfw' },
  { code: 'at', field: 'allowTanner', labelKey: 'CfgAllowTanner' },
  { code: 'afo', field: 'allowFool', labelKey: 'CfgAllowFool' },
  { code: 'aco', field: 'allowCult', labelKey: 'CfgAllowCult' },
  { code: 'ath', field: 'allowThief', labelKey: 'CfgAllowThief' },
  { code: 'aar', field: 'allowArsonist', labelKey: 'CfgAllowArsonist' },
  { code: 'tas', field: 'tagAllOnStart', labelKey: 'CfgTagAllOnStart' },
  { code: 'md', field: 'muteDead', labelKey: 'CfgMuteDead' },
];

export interface MenuScreen {
  text: string;
  keyboard: InlineKeyboard;
}

export class ConfigMenu {
  constructor(
    private readonly groups: GroupRepository,
    private readonly t: Translator,
  ) {}

  /** Renders the initial screen shown when `/config` is run. */
  async open(groupTelegramId: bigint): Promise<MenuScreen> {
    const group = await this.groups.getOrCreate(groupTelegramId, null, null);
    return this.mainScreen(group);
  }

  /**
   * `data` is everything after the `cfg:<groupTelegramId>:` prefix (already stripped and parsed
   * by the caller). Returns the next screen to render, or `null` if the action didn't change
   * anything worth re-rendering (shouldn't normally happen, but keeps the caller's edit a no-op
   * instead of erroring if it does).
   */
  async handleAction(groupTelegramId: bigint, action: string, rest: string[]): Promise<MenuScreen | null> {
    const group = await this.groups.getOrCreate(groupTelegramId, null, null);

    switch (action) {
      case 'main':
        return this.mainScreen(group);

      case 'roles':
        return this.rolesScreen(group, Number(rest[0] ?? 0));

      case 'role': {
        const role = rest[0] as RoleName;
        const page = Number(rest[1] ?? 0);
        const isDisabled = group.disabledRoles.some((r) => r.role === role);
        await this.groups.setRoleDisabled(group.id, role, !isDisabled);
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.rolesScreen(refreshed, page);
      }

      case 'options':
        return this.optionsScreen(group);

      case 'opt': {
        const toggle = TOGGLE_FIELDS.find((f) => f.code === rest[0]);
        if (!toggle) return null;
        await this.groups.updateConfig(groupTelegramId, { [toggle.field]: !group[toggle.field] });
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.optionsScreen(refreshed);
      }

      case 'mode':
        return this.modeScreen(group);

      case 'setmode': {
        const value = rest[0] as 'PLAYER_CHOICE' | 'NORMAL' | 'CHAOS';
        await this.groups.updateConfig(groupTelegramId, { mode: value });
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.modeScreen(refreshed);
      }

      case 'showrolesend':
        return this.showRolesEndScreen(group);

      case 'setshowrolesend': {
        const value = rest[0] as 'NONE' | 'LIVING' | 'ALL';
        await this.groups.updateConfig(groupTelegramId, { showRolesEnd: value });
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.showRolesEndScreen(refreshed);
      }

      case 'timers':
        return this.timersScreen(group);

      case 'timer': {
        const field = rest[0] as 'dayTimerSeconds' | 'nightTimerSeconds' | 'lynchTimerSeconds';
        const seconds = Number(rest[1]);
        await this.groups.updateConfig(groupTelegramId, { [field]: seconds });
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.timersScreen(refreshed);
      }

      case 'extend': {
        const seconds = Number(rest[0]);
        await this.groups.updateConfig(groupTelegramId, { maxExtendSeconds: seconds });
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.timersScreen(refreshed);
      }

      case 'maxplayers':
        return this.maxPlayersScreen(group);

      case 'setmaxplayers': {
        const n = Number(rest[0]);
        await this.groups.updateConfig(groupTelegramId, { maxPlayers: n });
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.maxPlayersScreen(refreshed);
      }

      case 'lang':
        return this.languageScreen(group);

      case 'langpacks':
        return this.langPacksScreen(group, rest[0] ?? group.language);

      case 'setlang': {
        const code = rest[0];
        if (!code) return null;
        await this.groups.updateConfig(groupTelegramId, { language: code });
        const refreshed = await this.groups.getOrCreate(groupTelegramId, null, null);
        return this.mainScreen(refreshed);
      }

      default:
        return null;
    }
  }

  private mainScreen(group: GroupWithConfig): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const keyboard = new InlineKeyboard()
      .text(this.t.translate(lang, 'CfgMenuRoles'), `cfg:${gid}:roles:0`)
      .text(this.t.translate(lang, 'CfgMenuOptions'), `cfg:${gid}:options`)
      .row()
      .text(this.t.translate(lang, 'CfgMenuMode'), `cfg:${gid}:mode`)
      .text(this.t.translate(lang, 'CfgMenuTimers'), `cfg:${gid}:timers`)
      .row()
      .text(this.t.translate(lang, 'CfgMenuMaxPlayers'), `cfg:${gid}:maxplayers`)
      .text(this.t.translate(lang, 'CfgMenuShowRolesEnd'), `cfg:${gid}:showrolesend`)
      .row()
      .text(this.t.translate(lang, 'CfgMenuLanguage'), `cfg:${gid}:lang`);
    return { text: this.t.translate(lang, 'CfgMainTitle', group.title ?? gid), keyboard };
  }

  private rolesScreen(group: GroupWithConfig, page: number): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const disabledSet = new Set(group.disabledRoles.map((r) => r.role));
    const totalPages = Math.ceil(DISABLEABLE_ROLES.length / ROLES_PER_PAGE);
    const clampedPage = Math.max(0, Math.min(page, totalPages - 1));
    const pageRoles = DISABLEABLE_ROLES.slice(clampedPage * ROLES_PER_PAGE, (clampedPage + 1) * ROLES_PER_PAGE);

    const keyboard = new InlineKeyboard();
    for (const role of pageRoles) {
      const enabled = !disabledSet.has(role);
      const label = `${enabled ? '✅' : '❌'} ${ROLE_META[role].emoji} ${role}`;
      keyboard.text(label, `cfg:${gid}:role:${role}:${clampedPage}`).row();
    }
    const nav = new InlineKeyboard();
    if (clampedPage > 0) nav.text('◀️', `cfg:${gid}:roles:${clampedPage - 1}`);
    nav.text(`${clampedPage + 1}/${totalPages}`, `cfg:${gid}:roles:${clampedPage}`);
    if (clampedPage < totalPages - 1) nav.text('▶️', `cfg:${gid}:roles:${clampedPage + 1}`);
    keyboard.append(nav).row().text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:main`);

    return { text: this.t.translate(lang, 'CfgRolesTitle'), keyboard };
  }

  private optionsScreen(group: GroupWithConfig): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const keyboard = new InlineKeyboard();
    for (const toggle of TOGGLE_FIELDS) {
      const on = group[toggle.field];
      const label = `${on ? '✅' : '❌'} ${this.t.translate(lang, toggle.labelKey)}`;
      keyboard.text(label, `cfg:${gid}:opt:${toggle.code}`).row();
    }
    keyboard.text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:main`);
    return { text: this.t.translate(lang, 'CfgOptionsTitle'), keyboard };
  }

  private modeScreen(group: GroupWithConfig): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const mark = (value: string) => (group.mode === value ? '✅ ' : '');
    const keyboard = new InlineKeyboard()
      .text(`${mark('PLAYER_CHOICE')}${this.t.translate(lang, 'CfgModePlayerChoice')}`, `cfg:${gid}:setmode:PLAYER_CHOICE`)
      .row()
      .text(`${mark('NORMAL')}${this.t.translate(lang, 'CfgModeNormal')}`, `cfg:${gid}:setmode:NORMAL`)
      .row()
      .text(`${mark('CHAOS')}${this.t.translate(lang, 'CfgModeChaos')}`, `cfg:${gid}:setmode:CHAOS`)
      .row()
      .text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:main`);
    return { text: this.t.translate(lang, 'CfgModeTitle'), keyboard };
  }

  private showRolesEndScreen(group: GroupWithConfig): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const mark = (value: string) => (group.showRolesEnd === value ? '✅ ' : '');
    const keyboard = new InlineKeyboard()
      .text(`${mark('NONE')}${this.t.translate(lang, 'CfgShowRolesEndNone')}`, `cfg:${gid}:setshowrolesend:NONE`)
      .row()
      .text(`${mark('LIVING')}${this.t.translate(lang, 'CfgShowRolesEndLiving')}`, `cfg:${gid}:setshowrolesend:LIVING`)
      .row()
      .text(`${mark('ALL')}${this.t.translate(lang, 'CfgShowRolesEndAll')}`, `cfg:${gid}:setshowrolesend:ALL`)
      .row()
      .text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:main`);
    return { text: this.t.translate(lang, 'CfgShowRolesEndTitle'), keyboard };
  }

  private timersScreen(group: GroupWithConfig): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const keyboard = new InlineKeyboard();

    const timerRow = (field: 'dayTimerSeconds' | 'nightTimerSeconds' | 'lynchTimerSeconds', current: number) => {
      for (const seconds of TIMER_PRESETS) {
        const label = seconds === current ? `[${seconds}]` : `${seconds}`;
        keyboard.text(label, `cfg:${gid}:timer:${field}:${seconds}`);
      }
      keyboard.row();
    };

    keyboard.text(`— ${this.t.translate(lang, 'CfgTimerDay')} —`, `cfg:${gid}:timers`).row();
    timerRow('dayTimerSeconds', group.dayTimerSeconds);
    keyboard.text(`— ${this.t.translate(lang, 'CfgTimerNight')} —`, `cfg:${gid}:timers`).row();
    timerRow('nightTimerSeconds', group.nightTimerSeconds);
    keyboard.text(`— ${this.t.translate(lang, 'CfgTimerLynch')} —`, `cfg:${gid}:timers`).row();
    timerRow('lynchTimerSeconds', group.lynchTimerSeconds);

    keyboard.text(`— ${this.t.translate(lang, 'CfgTimerExtend')} —`, `cfg:${gid}:timers`).row();
    for (const seconds of EXTEND_PRESETS) {
      const label = seconds === group.maxExtendSeconds ? `[${seconds}]` : `${seconds}`;
      keyboard.text(label, `cfg:${gid}:extend:${seconds}`);
    }
    keyboard.row().text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:main`);

    return { text: this.t.translate(lang, 'CfgTimersTitle'), keyboard };
  }

  private maxPlayersScreen(group: GroupWithConfig): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const keyboard = new InlineKeyboard();
    for (const n of MAX_PLAYER_PRESETS) {
      const label = n === group.maxPlayers ? `[${n}]` : `${n}`;
      keyboard.text(label, `cfg:${gid}:setmaxplayers:${n}`);
    }
    keyboard.row().text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:main`);
    return { text: this.t.translate(lang, 'CfgMaxPlayersTitle', group.maxPlayers), keyboard };
  }

  /**
   * Step 1 of language-pack selection (see `translator.ts`'s `listBaseLocales`): pick the base
   * language. Only `en`/`fr` are shipped today, but this reads the loaded locale set rather than
   * a hardcoded list, so a future third base language needs no code change here.
   */
  private languageScreen(group: GroupWithConfig): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const currentBase = this.t.baseOf(group.language);
    const keyboard = new InlineKeyboard();
    for (const base of this.t.listBaseLocales()) {
      const mark = base.code === currentBase ? '✅ ' : '';
      keyboard.text(`${mark}${base.name}`, `cfg:${gid}:langpacks:${base.code}`).row();
    }
    keyboard.text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:main`);
    return { text: this.t.translate(lang, 'CfgLanguageTitle'), keyboard };
  }

  /**
   * Step 2: pick a pack of `baseCode` (or "Default", i.e. `baseCode` itself with no pack) - empty
   * beyond "Default" until someone actually ships a `locales/<baseCode>-<pack>.json`.
   */
  private langPacksScreen(group: GroupWithConfig, baseCode: string): MenuScreen {
    const lang = group.language;
    const gid = group.telegramId.toString();
    const packs = this.t.listPacksForBase(baseCode);
    const keyboard = new InlineKeyboard();
    const defaultMark = group.language === baseCode ? '✅ ' : '';
    keyboard.text(`${defaultMark}${this.t.translate(lang, 'CfgLangPackDefault')}`, `cfg:${gid}:setlang:${baseCode}`).row();
    for (const pack of packs) {
      const mark = pack.code === group.language ? '✅ ' : '';
      keyboard.text(`${mark}${pack.name}`, `cfg:${gid}:setlang:${pack.code}`).row();
    }
    keyboard.text(this.t.translate(lang, 'CfgBack'), `cfg:${gid}:lang`);
    return { text: this.t.translate(lang, 'CfgLangPackTitle'), keyboard };
  }
}
