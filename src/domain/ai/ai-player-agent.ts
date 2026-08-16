import { ROLE_META, type Role } from '../roles/role.js';

export interface ChatMessageEntry {
  senderId: bigint;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface BotPersona {
  name: string;
  personality: string;
  style: string;
}

export const BOT_PERSONAS: Record<string, BotPersona> = {
  Alex: {
    name: 'Alex',
    personality: 'Impulsif, confiant, rapide à accuser',
    style: 'Utilise des phrases courtes, directes et du vocabulaire dynamique.',
  },
  Beatrice: {
    name: 'Beatrice',
    personality: 'Réfléchie, prudente, pose des questions constructives',
    style: "S'exprime calmement avec méthode et analyse les votes passés.",
  },
  Clement: {
    name: 'Clement',
    personality: 'Provocateur, ironique, sème le doute',
    style: 'Utilise des piques humoristiques et remet en cause les vérités établies.',
  },
  Diana: {
    name: 'Diana',
    personality: "Analytique, s'appuie sur la logique et les statistiques",
    style: 'Rationnelle et concise, relève les incohérences de discours.',
  },
  Enzo: {
    name: 'Enzo',
    personality: 'Expressif, passionné, se défend avec véhémence',
    style: 'Réagit fortement si accusé, réclame des preuves.',
  },
  Florence: {
    name: 'Florence',
    personality: 'Bienveillante en apparence, stratège discrète',
    style: "Tente d'apaiser le débat ou d'orienter doucement l'attention.",
  },
  Gabriel: {
    name: 'Gabriel',
    personality: 'Discret, synthétique, intervient aux moments clés',
    style: 'Phrases très courtes, va droit au but.',
  },
  Helene: {
    name: 'Helene',
    personality: 'Sceptique, remet en doute les déclarations des rôles',
    style: 'Demande des confirmations avant de donner sa confiance.',
  },
};

export class AiPlayerAgent {
  private readonly geminiApiKey?: string | undefined;

  constructor(geminiApiKey?: string | undefined) {
    this.geminiApiKey = geminiApiKey;
  }

  /**
   * Generates a chat message response for an AI player during the Day phase.
   */
  async generateChatMessage(params: {
    botName: string;
    botRole: Role;
    isAlive: boolean;
    chatHistory: readonly ChatMessageEntry[];
    targetMessage?: ChatMessageEntry | undefined;
    livingPlayerNames: readonly string[];
  }): Promise<string> {
    const { botName, botRole, chatHistory, targetMessage, livingPlayerNames } = params;
    const cleanName = botName.replaceAll('🤖', '').replaceAll('(IA)', '').trim();
    const persona = BOT_PERSONAS[cleanName] ?? {
      name: cleanName,
      personality: 'Joueur de Loup-Garou classique',
      style: 'Répond naturellement au groupe',
    };

    const meta = ROLE_META[botRole];

    if (this.geminiApiKey) {
      try {
        const prompt = this.buildGeminiPrompt({
          persona,
          roleName: meta.name,
          roleTeam: meta.team,
          chatHistory,
          targetMessage,
          livingPlayerNames,
        });

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.geminiApiKey}`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 100,
              temperature: 0.8,
            },
          }),
        });

        if (response.ok) {
          const json = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) {
            return text.replace(/^["']|["']$/g, '');
          }
        }
      } catch {
        // Fallback to heuristic response if API call fails
      }
    }

    return this.generateHeuristicResponse({
      cleanName,
      persona,
      targetMessage,
      livingPlayerNames,
    });
  }

  private buildGeminiPrompt(params: {
    persona: BotPersona;
    roleName: string;
    roleTeam: string;
    chatHistory: readonly ChatMessageEntry[];
    targetMessage?: ChatMessageEntry | undefined;
    livingPlayerNames: readonly string[];
  }): string {
    const recentMessages = params.chatHistory
      .slice(-10)
      .map((m) => `${m.senderName}: "${m.text}"`)
      .join('\n');

    return (
      `Tu es "${params.persona.name}", un joueur dans une partie en ligne de Loup-Garou sur Telegram.\n` +
      `Ta personnalité : ${params.persona.personality}.\n` +
      `Ton style de rédaction : ${params.persona.style}.\n` +
      `Ton rôle secret : ${params.roleName} (Camp: ${params.roleTeam}). RÈGLE ABSOLUE: Tu ne dois JAMAIS avouer être un Loup-Garou ou Tueur s'il s'agit de ton rôle !\n` +
      `Joueurs encore vivants : ${params.livingPlayerNames.join(', ')}.\n\n` +
      `Derniers messages dans le groupe :\n${recentMessages || "(Aucun message pour l'instant)"}\n\n` +
      (params.targetMessage
        ? `Message auquel tu réponds directement (de ${params.targetMessage.senderName}) : "${params.targetMessage.text}"\n`
        : '') +
      `Rédige UNE SEULE phrase courte (max 20 mots) en Français naturel avec du réalisme, du bluff ou une accusation/défense selon ton rôle et ta personnalité. Ne mets aucun préfixe de nom.`
    );
  }

  private generateHeuristicResponse(params: {
    cleanName: string;
    persona: BotPersona;
    targetMessage?: ChatMessageEntry | undefined;
    livingPlayerNames: readonly string[];
  }): string {
    const { targetMessage, livingPlayerNames } = params;
    const otherPlayers = livingPlayerNames.filter((n) => !n.includes(params.cleanName));
    const randomTarget =
      otherPlayers[Math.floor(Math.random() * otherPlayers.length)] ?? "quelqu'un";

    if (targetMessage) {
      const lower = targetMessage.text.toLowerCase();
      if (
        lower.includes('loup') ||
        lower.includes('suspect') ||
        lower.includes('vote') ||
        lower.includes('accuse')
      ) {
        const accuseDefenses = [
          `Pas du tout ${targetMessage.senderName}, je cherche juste à comprendre les votes !`,
          `Pourquoi tu m'accuses ${targetMessage.senderName} ? Qu'est-ce que tu caches de ton côté ?`,
          `Attention ${targetMessage.senderName}, accuser sans preuves ça profite souvent aux Loups !`,
          `Je suis 100% Innocent, ne vous trompez pas de cible le village.`,
        ];
        return accuseDefenses[Math.floor(Math.random() * accuseDefenses.length)]!;
      }

      if (lower.includes('voyante') || lower.includes('catin') || lower.includes('role')) {
        const roleReactions = [
          `Attention aux faux claims de rôle, restons prudents !`,
          `Est-ce que quelqu'un peut confirmer ce claim ?`,
          `Intéressant... voyons si les votes confirment cette version.`,
        ];
        return roleReactions[Math.floor(Math.random() * roleReactions.length)]!;
      }
    }

    const spontaneousPhrases = [
      `Personnellement, je trouve que ${randomTarget} est particulièrement silencieux aujourd'hui.`,
      `Observons bien qui vote contre qui avant de trancher.`,
      `Le village doit rester soudé, ne votons pas au hasard !`,
      `Je me demande bien qui est allé rendre visite à qui cette nuit...`,
      `Ne laissez pas les imposteurs diriger le vote du jour !`,
    ];
    return spontaneousPhrases[Math.floor(Math.random() * spontaneousPhrases.length)]!;
  }
}
