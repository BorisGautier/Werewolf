import { describe, expect, it } from 'vitest';
import { resolveGameMode } from '../../src/infrastructure/persistence/group.repository.js';

describe('resolveGameMode', () => {
  it("defers to the command's mode when the group hasn't forced one (PLAYER_CHOICE)", () => {
    const group = { mode: 'PLAYER_CHOICE' as const, randomMode: false };
    expect(resolveGameMode(group, 'Normal')).toBe('Normal');
    expect(resolveGameMode(group, 'Chaos')).toBe('Chaos');
  });

  it('forces the configured mode regardless of which command was used', () => {
    expect(resolveGameMode({ mode: 'CHAOS' as const, randomMode: false }, 'Normal')).toBe('Chaos');
    expect(resolveGameMode({ mode: 'NORMAL' as const, randomMode: false }, 'Chaos')).toBe('Normal');
  });

  it('randomMode overrides everything, including a forced mode', () => {
    const group = { mode: 'NORMAL' as const, randomMode: true };
    const results = new Set(Array.from({ length: 50 }, () => resolveGameMode(group, 'Chaos')));
    expect([...results].every((m) => m === 'Normal' || m === 'Chaos')).toBe(true);
  });
});
