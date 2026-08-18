import { InlineKeyboard, type Bot, type Context } from 'grammy';
import type { GameMode } from '../../domain/game/game-mode.js';

interface ModeInfo {
  title: string;
  command: string;
  emoji: string;
  atmosphere: string;
  description: string;
  keyRoles: string;
}

const MODES_DATA_FR: Record<GameMode, ModeInfo> = {
  Normal: {
    emoji: '📜',
    title: 'Mode Normal',
    command: '/startgame (ou /start)',
    atmosphere: 'Équilibré, tactique et authentique',
    description:
      'Le mode Werewolf classique et équilibré. Un algorithme ajuste automatiquement les forces entre le Village et les Loups/Tueurs selon le nombre de participants.',
    keyRoles: 'Villageois, Voyante, Ange Gardien, Loups-Garous, Catin, Chasseur.',
  },
  Chaos: {
    emoji: '🎲',
    title: 'Mode Chaos',
    command: '/startchaos',
    atmosphere: 'Folie totale, imprévisible et hilarant',
    description:
      "Aucun algorithme d'équilibrage ! Tous les rôles sont attribués 100% au hasard. Il peut y avoir 3 Tueurs en série, 0 Voyante ou une meute géante.",
    keyRoles: "N'importe quel rôle parmi les 63 disponibles !",
  },
  Bloodbath: {
    emoji: '🩸',
    title: 'Mode Bain de Sang',
    command: '/startbloodbath',
    atmosphere: 'Ultra-agressif et hécatombe rapide',
    description:
      "Taux maximal de rôles tueurs et armés. Les nuits sont extrêmement mortelles et les parties s'enchaînent à toute vitesse !",
    keyRoles: 'Tueur en série, Pyromane, Loup Alpha, Franc-Tireur, Chasseur, Chimiste.',
  },
  DarkMagic: {
    emoji: '🔮',
    title: 'Mode Magie Noire',
    command: '/startdarkmagic',
    atmosphere: 'Sortilèges, résurrections et mystique',
    description:
      "Les forces occultes dominent le village. Les pouvoirs magiques et divinatoires s'affrontent sous la lune.",
    keyRoles: 'Sorcière, Chimiste, Nécromancien, Voyante, Oracle, Augure, Miroir Réflecteur.',
  },
  WolfPack: {
    emoji: '🐺',
    title: 'Mode Meute Sauvage',
    command: '/startwolfpack',
    atmosphere: 'Traque féroce et survie du Village',
    description:
      'Les Loups-Garous règnent en maîtres avec tous leurs sous-rôles spéciaux les plus redoutables.',
    keyRoles: 'Loup Berserker, Loup Hypnotiseur, Loup Piégeur, Loup Hurleur, Loup des Neiges.',
  },
  CursedVillage: {
    emoji: '💀',
    title: 'Mode Village Maudit',
    command: '/startcursedvillage',
    atmosphere: 'Paranoïa, malédictions et trahisons',
    description:
      "Une brume maléfique s'abat sur le village. Les malédictions et esprits vengeurs empoisonnent le vote du jour.",
    keyRoles: 'Maudits, Cultistes, Esprits vengeurs, Vengeur, Corbeau Maudisseur.',
  },
  Infection: {
    emoji: '🧪',
    title: 'Mode Contagion',
    command: '/startinfection',
    atmosphere: 'Mutations et conversions nocturnes',
    description:
      'Les forces de conversion sont décuplées ! La composition des équipes évolue continuellement pendant la nuit.',
    keyRoles: 'Culte, Loup Alpha (mordeur), Sosie, Enfant Sauvage, Voleur.',
  },
  Anarchy: {
    emoji: '💥',
    title: 'Mode Anarchie',
    command: '/startanarchy',
    atmosphere: 'Chacun pour soi, bluff et coups bas',
    description:
      "Concentration maximale de rôles neutres solitaires. Aucune alliance n'est sûre, le chacun pour soi est de mise !",
    keyRoles: 'Tanneur, Bouffon, Assassin à Gages, Vengeur, Voleur, Pyromane.',
  },
  HolyWar: {
    emoji: '⚔️',
    title: 'Mode Sainte Guerre',
    command: '/startholywar',
    atmosphere: 'Lumière divine contre Ténèbres',
    description:
      'Affrontement sacré entre les protecteurs divins du Village et les forces ténébreuses du Culte et des Loups.',
    keyRoles: 'Prêtresse de Lumière, Ange Exterminateur, Ange Gardien, Sage Ancien.',
  },
  Assassins: {
    emoji: '🎯',
    title: 'Mode Ombres & Assassins',
    command: '/startassassins',
    atmosphere: 'Contrats secrets, filatures et exécutions',
    description:
      'Chaque joueur reçoit une cible secrète ou un contrat à remplir. Qui éliminera sa cible en premier ?',
    keyRoles: 'Assassin à Gages, Vengeur, Franc-Tireur, Détective, Chasseur de Cultistes.',
  },
};

import type { GameLobbyManager } from './game-lobby.js';

export function registerModesGuideCommands(bot: Bot, lobby?: GameLobbyManager): void {
  bot.command(['modes', 'mode', 'helpmodes', 'gamemodes'], async (ctx: Context) => {
    const keyboard = buildModesKeyboard();

    const title =
      `🎮 <b>MANUEL INTERACTIF DES MODES DE JEU WEREWOLF</b> 🎮\n\n` +
      `Le bot propose <b>10 modes de jeu uniques</b> ! Chaque mode possède son propre style, son ambiance et sa distribution de rôles.\n\n` +
      `👇 <i>Cliquez sur n'importe quel mode ci-dessous pour découvrir ses détails, ses rôles phares et la commande pour le lancer :</i>`;

    await ctx.reply(title, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery(/^mode_info:(.+)$/, async (ctx: Context) => {
    const modeKey = ctx.match![1] as GameMode;
    const data = MODES_DATA_FR[modeKey];
    if (!data) return ctx.answerCallbackQuery();

    const text =
      `${data.emoji} <b>${data.title.toUpperCase()}</b>\n\n` +
      `🎯 <b>Commande pour lancer :</b> <code>${data.command}</code>\n` +
      `✨ <b>Ambiance :</b> <i>${data.atmosphere}</i>\n\n` +
      `📖 <b>Description :</b>\n${data.description}\n\n` +
      `🎭 <b>Rôles clés :</b>\n${data.keyRoles}`;

    const keyboard = new InlineKeyboard()
      .text(`▶️ Lancer en Mode ${data.title}`, `mode_start:${modeKey}`)
      .row()
      .text('« Retour aux modes', 'mode_list_back');

    await ctx.answerCallbackQuery();
    await ctx
      .editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => null);
  });

  bot.callbackQuery(/^mode_start:(.+)$/, async (ctx: Context) => {
    if (!ctx.chat || !ctx.from || !lobby) return ctx.answerCallbackQuery();
    const modeKey = ctx.match![1] as GameMode;
    await ctx.answerCallbackQuery({ text: `Lancement du Mode ${modeKey}...` });

    if (ctx.chat.type === 'private') {
      await ctx.reply(
        `⚠️ <b>Partie en Groupe Nécessaire</b>\n\nPour jouer en mode <b>${modeKey}</b>, invite le bot dans un groupe Telegram et tape <code>/startgame</code> ou clique sur le bouton de lancement depuis le groupe !`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
    await lobby.startGame(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      { id: BigInt(ctx.from.id), name },
      modeKey,
    );
  });

  bot.callbackQuery('mode_list_back', async (ctx: Context) => {
    const keyboard = buildModesKeyboard();
    const title =
      `🎮 <b>MANUEL INTERACTIF DES MODES DE JEU WEREWOLF</b> 🎮\n\n` +
      `Le bot propose <b>10 modes de jeu uniques</b> ! Cliquez sur un mode ci-dessous pour découvrir ses spécificités :`;

    await ctx.answerCallbackQuery();
    await ctx
      .editMessageText(title, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => null);
  });
}

function buildModesKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📜 Normal', 'mode_info:Normal')
    .text('🎲 Chaos', 'mode_info:Chaos')
    .row()
    .text('🩸 Bain de Sang', 'mode_info:Bloodbath')
    .text('🔮 Magie Noire', 'mode_info:DarkMagic')
    .row()
    .text('🐺 Meute Sauvage', 'mode_info:WolfPack')
    .text('💀 Village Maudit', 'mode_info:CursedVillage')
    .row()
    .text('🧪 Contagion', 'mode_info:Infection')
    .text('💥 Anarchie', 'mode_info:Anarchy')
    .row()
    .text('⚔️ Sainte Guerre', 'mode_info:HolyWar')
    .text('🎯 Assassins', 'mode_info:Assassins');
}
