import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import {
  nonNumericWords,
  numericIdTargets,
  replyTarget,
  resolveEntityTargets,
  resolveGroupArg,
} from '../../src/infrastructure/telegram/moderation-targets.js';
import type { PlayerRepository } from '../../src/infrastructure/persistence/player.repository.js';
import type { GroupRepository } from '../../src/infrastructure/persistence/group.repository.js';

function fakeCtx(overrides: { text?: string; entities?: unknown[]; replyFrom?: { id: number; first_name: string } }): Context {
  return {
    message: {
      text: overrides.text,
      entities: overrides.entities,
      reply_to_message: overrides.replyFrom ? { from: overrides.replyFrom } : undefined,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Context;
}

describe('numericIdTargets', () => {
  it('extracts whitespace-separated numeric tokens', () => {
    expect(numericIdTargets('123 456 abc 789')).toEqual([123n, 456n, 789n]);
  });

  it('returns an empty array for undefined or empty text', () => {
    expect(numericIdTargets(undefined)).toEqual([]);
    expect(numericIdTargets('')).toEqual([]);
  });
});

describe('nonNumericWords', () => {
  it('keeps only the non-numeric tokens, joined back together', () => {
    expect(nonNumericWords('123 spamming a lot 456')).toBe('spamming a lot');
  });

  it('returns an empty string when everything is numeric', () => {
    expect(nonNumericWords('123 456')).toBe('');
  });
});

describe('replyTarget', () => {
  it('resolves the sender of the replied-to message', () => {
    const ctx = fakeCtx({ replyFrom: { id: 42, first_name: 'Alice' } });
    expect(replyTarget(ctx)).toEqual({ id: 42n, name: 'Alice' });
  });

  it('returns null when the command was not sent as a reply', () => {
    expect(replyTarget(fakeCtx({}))).toBeNull();
  });
});

describe('resolveEntityTargets', () => {
  it('resolves a text_mention directly from the entity', async () => {
    const ctx = fakeCtx({
      text: 'smite them',
      entities: [{ type: 'text_mention', user: { id: 7, first_name: 'Bob' } }],
    });
    const players = { findByUsername: vi.fn() } as unknown as PlayerRepository;

    expect(await resolveEntityTargets(ctx, players)).toEqual([{ id: 7n, name: 'Bob' }]);
    expect(players.findByUsername).not.toHaveBeenCalled();
  });

  it('resolves an @mention via a username lookup', async () => {
    const ctx = fakeCtx({
      text: '/smite @carol please',
      entities: [{ type: 'mention', offset: 7, length: 6 }],
    });
    const players = {
      findByUsername: vi.fn(async () => ({ telegramId: 9n, displayName: 'Carol' })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as PlayerRepository;

    expect(await resolveEntityTargets(ctx, players)).toEqual([{ id: 9n, name: 'Carol' }]);
    expect(players.findByUsername).toHaveBeenCalledWith('carol');
  });

  it('drops an @mention for a username the bot has never seen', async () => {
    const ctx = fakeCtx({
      text: '/smite @unknown',
      entities: [{ type: 'mention', offset: 7, length: 8 }],
    });
    const players = { findByUsername: vi.fn(async () => null) } as unknown as PlayerRepository;

    expect(await resolveEntityTargets(ctx, players)).toEqual([]);
  });
});

describe('resolveGroupArg', () => {
  function fakeGroups(overrides: Partial<GroupRepository> = {}): GroupRepository {
    return {
      findByTelegramId: vi.fn(async () => null),
      findByUsername: vi.fn(async () => null),
      findByInviteLinkSuffix: vi.fn(async () => null),
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as GroupRepository;
  }

  it('resolves a raw numeric telegram id via findByTelegramId', async () => {
    const groups = fakeGroups({ findByTelegramId: vi.fn(async () => ({ id: 1 }) as never) });
    expect(await resolveGroupArg(groups, '-100123456')).toEqual({ id: 1 });
    expect(groups.findByTelegramId).toHaveBeenCalledWith(-100123456n);
  });

  it('resolves an @username via findByUsername', async () => {
    const groups = fakeGroups({ findByUsername: vi.fn(async () => ({ id: 2 }) as never) });
    expect(await resolveGroupArg(groups, '@somegroup')).toEqual({ id: 2 });
    expect(groups.findByUsername).toHaveBeenCalledWith('somegroup');
  });

  it('resolves an invite link by its trailing hash via findByInviteLinkSuffix', async () => {
    const groups = fakeGroups({ findByInviteLinkSuffix: vi.fn(async () => ({ id: 3 }) as never) });
    expect(await resolveGroupArg(groups, 'https://t.me/+AbCdEf1234')).toEqual({ id: 3 });
    expect(groups.findByInviteLinkSuffix).toHaveBeenCalledWith('me/+AbCdEf1234');
  });

  it('returns null for an argument that looks like neither an id, a username, nor a link', async () => {
    const groups = fakeGroups();
    expect(await resolveGroupArg(groups, 'not a valid group ref')).toBeNull();
  });
});
