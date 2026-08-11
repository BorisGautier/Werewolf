import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import { isGroupAdminOrAnonymous } from '../../src/infrastructure/telegram/bot.js';

function fakeCtx(opts: { senderChatId?: number; authorStatus: string }): Context {
  return {
    chat: { id: -100, type: 'supergroup' },
    senderChat: opts.senderChatId !== undefined ? { id: opts.senderChatId } : undefined,
    getAuthor: vi.fn().mockResolvedValue({ status: opts.authorStatus }),
  } as unknown as Context;
}

describe('isGroupAdminOrAnonymous', () => {
  it('trusts a message sent "as the group" (anonymous admin) without checking ChatMember status', async () => {
    // GroupAnonymousBot never has a real admin status, so getAuthor() would normally say no here -
    // the sender_chat match must short-circuit before that check.
    const ctx = fakeCtx({ senderChatId: -100, authorStatus: 'member' });
    expect(await isGroupAdminOrAnonymous(ctx)).toBe(true);
  });

  it('falls back to the real ChatMember status for an ordinary (non-anonymous) message', async () => {
    const admin = fakeCtx({ authorStatus: 'administrator' });
    expect(await isGroupAdminOrAnonymous(admin)).toBe(true);

    const creator = fakeCtx({ authorStatus: 'creator' });
    expect(await isGroupAdminOrAnonymous(creator)).toBe(true);

    const member = fakeCtx({ authorStatus: 'member' });
    expect(await isGroupAdminOrAnonymous(member)).toBe(false);
  });

  it("a sender_chat that isn't this chat (e.g. a linked channel post) doesn't count as anonymous-admin", async () => {
    const ctx = fakeCtx({ senderChatId: -999, authorStatus: 'member' });
    expect(await isGroupAdminOrAnonymous(ctx)).toBe(false);
  });
});
