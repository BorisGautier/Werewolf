import type { Bot, Context } from 'grammy';
import { AiPlayerAgent, type ChatMessageEntry } from '../../domain/ai/ai-player-agent.js';
import type { GameLoop } from './game-loop.js';

export class GroupChatListener {
  private readonly chatHistories = new Map<string, ChatMessageEntry[]>();
  private readonly aiAgent: AiPlayerAgent;

  constructor(geminiApiKey?: string | undefined) {
    this.aiAgent = new AiPlayerAgent(geminiApiKey);
  }

  /**
   * Registers the group chat text message listener.
   */
  register(bot: Bot, gameLoop: GameLoop): void {
    bot.on('message:text', async (ctx: Context, next) => {
      // Ignore private chats, bots, or command messages
      if (
        !ctx.chat ||
        ctx.chat.type === 'private' ||
        !ctx.from ||
        ctx.from.is_bot ||
        ctx.message?.text?.startsWith('/')
      ) {
        return next();
      }

      const chatId = BigInt(ctx.chat.id);
      const game = gameLoop.getGame(chatId);
      if (!game) return next();

      const phase = game.phase;
      // Only process chat messages during Day or Lynch discussion phases
      if (phase !== 'Day' && phase !== 'Lynch') return next();

      const text = ctx.message.text.trim();
      const senderName = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
      const senderId = BigInt(ctx.from.id);

      const key = chatId.toString();
      // Record message in group chat history
      const history = this.chatHistories.get(key) ?? [];
      const newEntry: ChatMessageEntry = {
        senderId,
        senderName,
        text,
        timestamp: Date.now(),
      };
      history.push(newEntry);
      if (history.length > 30) history.shift();
      this.chatHistories.set(key, history);

      // Find living AI players in this game
      const livingBots = game.players.filter((p) => p.isBot && !p.isDead);
      if (livingBots.length === 0) return next();

      // Check if any bot is mentioned by name in the text
      const lowerText = text.toLowerCase();
      const mentionedBot = livingBots.find((b) => {
        const cleanName = b.name
          .replaceAll('🤖', '')
          .replaceAll('(IA)', '')
          .trim()
          .toLowerCase();
        return lowerText.includes(cleanName);
      });

      let selectedBot = mentionedBot;
      let shouldRespond = false;

      if (selectedBot) {
        shouldRespond = true;
      } else {
        // 30% random chance for a bot to spontaneously join the conversation
        if (Math.random() < 0.3) {
          selectedBot = livingBots[Math.floor(Math.random() * livingBots.length)];
          shouldRespond = true;
        }
      }

      if (shouldRespond && selectedBot) {
        const targetBot = selectedBot;
        const messageId = ctx.message.message_id;

        // Simulate realistic typing delay (2.5s - 5s)
        const delayMs = 2500 + Math.floor(Math.random() * 2500);
        setTimeout(() => {
          void (async () => {
            try {
              const livingPlayerNames = game.players
                .filter((p) => !p.isDead)
                .map((p) => p.name);

              const responseText = await this.aiAgent.generateChatMessage({
                botName: targetBot.name,
                botRole: targetBot.role,
                isAlive: !targetBot.isDead,
                chatHistory: history,
                targetMessage: newEntry,
                livingPlayerNames,
              });

              if (responseText && game.phase === phase) {
                const formattedName = targetBot.name.includes('🤖')
                  ? targetBot.name
                  : `🤖 ${targetBot.name}`;

                await ctx.api
                  .sendMessage(
                    ctx.chat!.id,
                    `<b>${formattedName}</b> : ${escapeHtml(responseText)}`,
                    {
                      parse_mode: 'HTML',
                      reply_parameters: { message_id: messageId },
                    },
                  )
                  .catch(() => null);
              }
            } catch {
              // Ignore background bot chat errors silently
            }
          })();
        }, delayMs);
      }

      return next();
    });
  }

  /**
   * Clears the chat history buffer for an ended game session.
   */
  clearSession(chatId: bigint): void {
    this.chatHistories.delete(chatId.toString());
  }
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
