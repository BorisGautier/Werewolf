import type { Bot } from 'grammy';
import {
  AiPlayerAgent,
  type AiGameContext,
  type ChatMessageEntry,
} from '../../domain/ai/ai-player-agent.js';
import type { GameLoop } from './game-loop.js';
import type { Game } from '../../domain/game/game.aggregate.js';
import type { Player } from '../../domain/game/player.js';
import { roleName } from '../../domain/roles/role.js';
import { getTeamForRole } from '../../domain/game/team.js';
import { escapeHtml } from './mention.js';

/** Floor between two AI-generated (paid Gemini call) chat replies in the same group - independent
 * of the random 40% trigger chance below, so a user spamming plain text can't fan out many
 * concurrent API calls just by sending messages faster than the reply delay resolves them. */
const MIN_MS_BETWEEN_AI_REPLIES = 4000;

export class GroupChatListener {
  private readonly chatHistories = new Map<string, ChatMessageEntry[]>();
  private readonly lastAiReplyAt = new Map<string, number>();
  private readonly aiAgent: AiPlayerAgent;
  private tickerInterval?: NodeJS.Timeout | undefined;

  constructor(geminiApiKey?: string | undefined) {
    this.aiAgent = new AiPlayerAgent(geminiApiKey);
  }

  /**
   * Registers the group chat text message listener and autonomous conversation ticker.
   */
  register(bot: Bot, gameLoop: GameLoop): void {
    // 1. Reactive listener on human chat messages
    bot.on('message:text', async (ctx, next) => {
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
        const cleanName = b.name.replaceAll('🤖', '').replaceAll('(IA)', '').trim().toLowerCase();
        return lowerText.includes(cleanName);
      });

      let selectedBot = mentionedBot;
      let shouldRespond = false;

      if (selectedBot) {
        shouldRespond = true;
      } else if (Math.random() < 0.4) {
        // 40% chance to immediately respond to human messages
        selectedBot = livingBots[Math.floor(Math.random() * livingBots.length)];
        shouldRespond = true;
      }

      const lastReply = this.lastAiReplyAt.get(key) ?? 0;
      if (shouldRespond && Date.now() - lastReply < MIN_MS_BETWEEN_AI_REPLIES) {
        shouldRespond = false;
      }

      if (shouldRespond && selectedBot) {
        this.lastAiReplyAt.set(key, Date.now());
        const targetBot = selectedBot;
        const messageId = ctx.message.message_id;

        // Simulate realistic typing delay (2.5s - 4.5s)
        const delayMs = 2500 + Math.floor(Math.random() * 2000);
        setTimeout(() => {
          void (async () => {
            try {
              const livingPlayerNames = game.players.filter((p) => !p.isDead).map((p) => p.name);

              const gameContext = this.buildGameContext(game, targetBot);

              const responseText = await this.aiAgent.generateChatMessage({
                botName: targetBot.name,
                botRole: targetBot.role,
                isAlive: !targetBot.isDead,
                chatHistory: history,
                targetMessage: newEntry,
                livingPlayerNames,
                gameContext,
              });

              if (responseText && game.phase === phase) {
                const formattedName = targetBot.name.includes('🤖')
                  ? targetBot.name
                  : `🤖 ${targetBot.name}`;

                // Record bot message in history so other bots can reply to it!
                history.push({
                  senderId: targetBot.id,
                  senderName: formattedName,
                  text: responseText,
                  timestamp: Date.now(),
                });

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

    // 2. Start autonomous background ticker for spontaneous AI-to-AI / AI-to-group chat
    this.startAutonomousTicker(bot, gameLoop);
  }

  /**
   * Periodically triggers spontaneous chat from living AI players during Day/Lynch phases,
   * even when no human is typing!
   */
  private startAutonomousTicker(bot: Bot, gameLoop: GameLoop): void {
    if (this.tickerInterval) clearInterval(this.tickerInterval);

    // Ticker runs every 12 to 16 seconds
    this.tickerInterval = setInterval(() => {
      void (async () => {
        for (const [chatIdStr, history] of this.chatHistories.entries()) {
          try {
            const chatId = BigInt(chatIdStr);
            const game = gameLoop.getGame(chatId);
            if (!game) continue;

            const phase = game.phase;
            if (phase !== 'Day' && phase !== 'Lynch') continue;

            const livingBots = game.players.filter((p) => p.isBot && !p.isDead);
            if (livingBots.length === 0) continue;

            // 60% chance to spontaneously speak during each 14s window
            if (Math.random() > 0.6) continue;
            const lastReply = this.lastAiReplyAt.get(chatIdStr) ?? 0;
            if (Date.now() - lastReply < MIN_MS_BETWEEN_AI_REPLIES) continue;
            this.lastAiReplyAt.set(chatIdStr, Date.now());

            const botToSpeak = livingBots[Math.floor(Math.random() * livingBots.length)]!;
            const livingPlayerNames = game.players.filter((p) => !p.isDead).map((p) => p.name);

            // Find last message to optionally reply to
            const lastEntry = history.length > 0 ? history[history.length - 1] : undefined;
            const gameContext = this.buildGameContext(game, botToSpeak);

            const responseText = await this.aiAgent.generateChatMessage({
              botName: botToSpeak.name,
              botRole: botToSpeak.role,
              isAlive: !botToSpeak.isDead,
              chatHistory: history,
              targetMessage: lastEntry,
              livingPlayerNames,
              gameContext,
            });

            if (responseText && game.phase === phase) {
              const formattedName = botToSpeak.name.includes('🤖')
                ? botToSpeak.name
                : `🤖 ${botToSpeak.name}`;

              // Record bot's spontaneous message in history
              history.push({
                senderId: botToSpeak.id,
                senderName: formattedName,
                text: responseText,
                timestamp: Date.now(),
              });

              await bot.api
                .sendMessage(
                  Number(chatId),
                  `<b>${formattedName}</b> : ${escapeHtml(responseText)}`,
                  { parse_mode: 'HTML' },
                )
                .catch(() => null);
            }
          } catch {
            // Ignore background ticker errors silently
          }
        }
      })();
    }, 14000);
  }

  private buildGameContext(game: Game, botPlayer: Player): AiGameContext {
    const recentDeaths = game.players
      .filter((p) => p.isDead)
      .map((p) => `${p.name} (${roleName(p.role)})`);

    const knownInformation: string[] = [];
    const botTeam = getTeamForRole(botPlayer.role);

    if (botTeam === 'Wolf') {
      const wolfTeammates = game.players
        .filter((p) => !p.isDead && p.id !== botPlayer.id && getTeamForRole(p.role) === 'Wolf')
        .map((p) => p.name);
      if (wolfTeammates.length > 0) {
        knownInformation.push(`Tes co-équipiers Loups vivants sont : ${wolfTeammates.join(', ')}`);
      }
    } else if (roleName(botPlayer.role) === 'Tanner') {
      knownInformation.push(
        `Tu es le Tanneur. Ton BUT UNIQUE est de te faire lyncher par le village pour GAGNER la partie !`,
      );
    }

    return {
      recentDeaths,
      knownInformation,
    };
  }

  /**
   * Clears the chat history buffer for an ended game session and stops ticker.
   */
  clearSession(chatId: bigint): void {
    this.chatHistories.delete(chatId.toString());
    this.lastAiReplyAt.delete(chatId.toString());
  }

  destroy(): void {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = undefined;
    }
  }
}
