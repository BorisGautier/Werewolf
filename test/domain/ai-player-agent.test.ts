import { describe, expect, it } from 'vitest';
import { AiPlayerAgent } from '../../src/domain/ai/ai-player-agent.js';
import { ROLE_BIT } from '../../src/domain/roles/role.js';

describe('AiPlayerAgent', () => {
  it('generates heuristic chat message responses when no Gemini API key is provided', async () => {
    const agent = new AiPlayerAgent();
    const response = await agent.generateChatMessage({
      botName: '🤖 Alex (IA)',
      botRole: ROLE_BIT.Villager,
      isAlive: true,
      chatHistory: [
        {
          senderId: 1001n,
          senderName: 'Marc',
          text: "Alex est très suspect aujourd'hui !",
          timestamp: Date.now(),
        },
      ],
      targetMessage: {
        senderId: 1001n,
        senderName: 'Marc',
        text: "Alex est très suspect aujourd'hui !",
        timestamp: Date.now(),
      },
      livingPlayerNames: ['Marc', '🤖 Alex (IA)', '🤖 Beatrice (IA)'],
    });

    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(5);
    expect(response).not.toContain('undefined');
  });

  it('generates spontaneous heuristic messages when no target message is provided', async () => {
    const agent = new AiPlayerAgent();
    const response = await agent.generateChatMessage({
      botName: '🤖 Beatrice (IA)',
      botRole: ROLE_BIT.Seer,
      isAlive: true,
      chatHistory: [],
      livingPlayerNames: ['Marc', '🤖 Beatrice (IA)'],
    });

    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(5);
  });

  it('replies in English (not the hardcoded French default) for an English-configured group, both with and without a target message', async () => {
    const agent = new AiPlayerAgent();

    // Every branch of the heuristic responder is deterministically reachable via Math.random
    // seeding would be brittle - instead this samples many times so all branches get exercised,
    // and asserts none of them ever produced a French-only phrase.
    const frenchTells = ['Je ', 'je claim', 'loup', 'Loup', "quelqu'un", 'coéquipiers'];
    for (let i = 0; i < 40; i++) {
      const response = await agent.generateChatMessage({
        botName: '🤖 Alex (IA)',
        botRole: ROLE_BIT.Wolf,
        isAlive: true,
        chatHistory: [],
        targetMessage:
          i % 2 === 0
            ? { senderId: 1001n, senderName: 'Marc', text: 'why are you so suspicious?', timestamp: Date.now() }
            : undefined,
        livingPlayerNames: ['Marc', '🤖 Alex (IA)', '🤖 Beatrice (IA)'],
        gameContext: { knownInformation: ['Your living Wolf teammates are: Beatrice'] },
        language: 'en',
      });

      for (const tell of frenchTells) {
        expect(response).not.toContain(tell);
      }
    }
  });
});
