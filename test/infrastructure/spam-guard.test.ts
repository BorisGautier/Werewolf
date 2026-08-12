import { describe, expect, it } from 'vitest';
import { SpamGuard } from '../../src/infrastructure/telegram/spam-guard.js';

describe('SpamGuard', () => {
  it('returns ok for normal, low-frequency command usage', () => {
    const guard = new SpamGuard();
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += 5000;
      expect(guard.record(1n, now)).toBe('ok');
    }
  });

  it('warns once a user sends 10+ commands within a minute', () => {
    const guard = new SpamGuard();
    const now = 0;
    for (let i = 0; i < 9; i++) expect(guard.record(1n, now + i)).toBe('ok');
    expect(guard.record(1n, now + 9)).toBe('warn');
  });

  it('warns twice, then bans on the third breach', () => {
    const guard = new SpamGuard();
    let t = 0;
    const flood = () => {
      for (let i = 0; i < 9; i++) guard.record(1n, t++);
      return guard.record(1n, t++);
    };
    expect(flood()).toBe('warn');
    expect(flood()).toBe('warn');
    expect(flood()).toBe('ban');
  });

  it('does not count commands outside the rolling 60s window', () => {
    const guard = new SpamGuard();
    for (let i = 0; i < 9; i++) expect(guard.record(1n, i * 1000)).toBe('ok');
    // The 10th command lands 61s after the first - the window has rolled past those 9.
    expect(guard.record(1n, 70_000)).toBe('ok');
  });

  it('tracks each user independently', () => {
    const guard = new SpamGuard();
    const now = 0;
    for (let i = 0; i < 9; i++) guard.record(1n, now + i);
    expect(guard.record(2n, now)).toBe('ok');
  });

  it('isBanned reflects a temporary ban until it expires', () => {
    const guard = new SpamGuard();
    expect(guard.isBanned(1n, 0)).toBe(false);
    guard.markBanned(1n, new Date(1000));
    expect(guard.isBanned(1n, 500)).toBe(true);
    expect(guard.isBanned(1n, 1500)).toBe(false);
  });

  it('isBanned treats a null expiry as permanent', () => {
    const guard = new SpamGuard();
    guard.markBanned(1n, null);
    expect(guard.isBanned(1n, Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
