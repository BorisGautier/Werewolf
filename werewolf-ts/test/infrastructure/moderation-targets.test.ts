import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import {
  nonNumericWords,
  numericIdTargets,
  replyTarget,
  resolveEntityTargets,
} from '../../src/infrastructure/telegram/moderation-targets.js';
import type { PlayerRepository } from '../../src/infrastructure/persistence/player.repository.js';

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
