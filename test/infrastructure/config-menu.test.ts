import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigMenu } from '../../src/infrastructure/telegram/config-menu.js';
import { getDefaultLocale, loadLocales } from '../../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../../src/infrastructure/i18n/translator.js';
import type { GroupRepository, GroupWithConfig } from '../../src/infrastructure/persistence/group.repository.js';

let translator: Translator;

beforeEach(async () => {
  const locales = await loadLocales();
  translator = new Translator(locales, getDefaultLocale(locales));
});

function fakeGroup(overrides: Partial<GroupWithConfig> = {}): GroupWithConfig {
  return {
    id: 1,
    telegramId: -100n,
    title: 'Test Group',
    username: null,
    language: 'en',
    mode: 'PLAYER_CHOICE',
    dayTimerSeconds: 120,
    nightTimerSeconds: 60,
    lynchTimerSeconds: 60,
    maxExtendSeconds: 0,
    maxPlayers: 35,
    allowExtend: false,
    allowFlee: true,
    allowNsfw: false,
    allowTanner: true,
    allowFool: true,
    allowCult: true,
    allowThief: true,
    allowArsonist: true,
    thiefFull: false,
    burningOverkill: false,
    showRolesOnDeath: true,
    showRolesEnd: 'ALL',
    showIds: false,
    shufflePlayerList: false,
    randomMode: false,
    secretLynch: false,
    secretLynchShowVotes: false,
    secretLynchShowVoters: false,
    muteDead: false,
    botInGroup: true,
    banned: false,
    memberCount: null,
    preferred: false,
    inviteLink: null,
    defaultGifPackId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    disabledRoles: [],
    ...overrides,
  };
}

function createHarness() {
  let group = fakeGroup();
  const groups = {
    getOrCreate: vi.fn(async () => group),
    setRoleDisabled: vi.fn(async (_groupId: number, role: string, disabled: boolean) => {
      group = {
        ...group,
        disabledRoles: disabled
          ? [...group.disabledRoles, { id: group.disabledRoles.length + 1, groupId: group.id, role: role as never }]
          : group.disabledRoles.filter((r) => r.role !== role),
      };
    }),
    updateConfig: vi.fn(async (_telegramId: bigint, data: Partial<GroupWithConfig>) => {
      group = { ...group, ...data };
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as GroupRepository;

  const menu = new ConfigMenu(groups, translator);
  return { menu, groups, getGroup: () => group };
}

describe('ConfigMenu', () => {
  it('opens the main screen with category buttons', async () => {
    const { menu } = createHarness();
    const screen = await menu.open(-100n);
    expect(screen.text).toContain('Test Group');
    const data = screen.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(data.some((t) => t.includes('Roles'))).toBe(true);
    expect(data.some((t) => t.includes('Options'))).toBe(true);
  });

  it('toggles a role on and off', async () => {
    const { menu, getGroup } = createHarness();
    await menu.handleAction(-100n, 'role', ['Seer', '0']);
    expect(getGroup().disabledRoles.map((r) => r.role)).toEqual(['Seer']);

    await menu.handleAction(-100n, 'role', ['Seer', '0']);
    expect(getGroup().disabledRoles).toHaveLength(0);
  });

  it('toggles a boolean option', async () => {
    const { menu, getGroup } = createHarness();
    expect(getGroup().thiefFull).toBe(false);
    await menu.handleAction(-100n, 'opt', ['tf']);
    expect(getGroup().thiefFull).toBe(true);
  });

  it('toggles the muteDead boolean option', async () => {
    const { menu, getGroup } = createHarness();
    expect(getGroup().muteDead).toBe(false);
    await menu.handleAction(-100n, 'opt', ['md']);
    expect(getGroup().muteDead).toBe(true);
  });

  it('returns null for an unknown option code instead of crashing', async () => {
    const { menu } = createHarness();
    const result = await menu.handleAction(-100n, 'opt', ['nonexistent']);
    expect(result).toBeNull();
  });

  it('sets the mode preference', async () => {
    const { menu, getGroup } = createHarness();
    await menu.handleAction(-100n, 'setmode', ['CHAOS']);
    expect(getGroup().mode).toBe('CHAOS');
  });

  it('sets the end-game recap detail level', async () => {
    const { menu, getGroup } = createHarness();
    expect(getGroup().showRolesEnd).toBe('ALL');
    await menu.handleAction(-100n, 'setshowrolesend', ['NONE']);
    expect(getGroup().showRolesEnd).toBe('NONE');
  });

  it('sets a phase timer', async () => {
    const { menu, getGroup } = createHarness();
    await menu.handleAction(-100n, 'timer', ['nightTimerSeconds', '180']);
    expect(getGroup().nightTimerSeconds).toBe(180);
  });

  it('sets the max player count', async () => {
    const { menu, getGroup } = createHarness();
    await menu.handleAction(-100n, 'setmaxplayers', ['15']);
    expect(getGroup().maxPlayers).toBe(15);
  });

  it('clamps the roles page within bounds', async () => {
    const { menu } = createHarness();
    const tooFar = await menu.handleAction(-100n, 'roles', ['999']);
    const negative = await menu.handleAction(-100n, 'roles', ['-5']);
    expect(tooFar).not.toBeNull();
    expect(negative).not.toBeNull();
  });

  it('lists every loaded base language on the language screen', async () => {
    const { menu } = createHarness();
    const screen = await menu.handleAction(-100n, 'lang', []);
    const data = screen!.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(data.some((t) => t.includes('English'))).toBe(true);
    expect(data.some((t) => t.includes('Français'))).toBe(true);
  });

  it("offers only Default for a base language with no shipped packs, and marks it selected", async () => {
    const { menu } = createHarness();
    const screen = await menu.handleAction(-100n, 'langpacks', ['en']);
    const data = screen!.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(data.some((t) => t.includes('Default'))).toBe(true);
    expect(data.some((t) => t.startsWith('✅'))).toBe(true);
  });

  it('sets the group language and returns to the main screen', async () => {
    const { menu, getGroup } = createHarness();
    const screen = await menu.handleAction(-100n, 'setlang', ['fr']);
    expect(getGroup().language).toBe('fr');
    expect(screen!.text).toContain('Test Group');
  });
});
