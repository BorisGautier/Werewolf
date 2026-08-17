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
});
