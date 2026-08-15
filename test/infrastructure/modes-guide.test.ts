import { describe, expect, it, vi } from 'vitest';
import { Bot } from 'grammy';
import { registerModesGuideCommands } from '../../src/infrastructure/telegram/modes-guide.js';

describe('modes-guide', () => {
  it('registers /modes command and responds with interactive menu', async () => {
    const bot = new Bot('123456:ABC-DEF1234ghIkl-zyx543210');
    registerModesGuideCommands(bot);

    const commandCall = vi.fn();
    bot.command = vi.fn((name, handler) => {
      commandCall(name, handler);
      return bot;
    });

    registerModesGuideCommands(bot);
    expect(bot.command).toHaveBeenCalledWith(
      ['modes', 'mode', 'helpmodes', 'gamemodes'],
      expect.any(Function),
    );
  });
});
