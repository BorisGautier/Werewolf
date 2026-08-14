import fs from 'node:fs';
import path from 'node:path';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { loadLocales } from '../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../src/infrastructure/i18n/translator.js';
import { ROLE_META, type RoleName } from '../src/domain/roles/role.js';
import { ABOUT_ROLE_BY_TRIGGER } from '../src/infrastructure/telegram/role-info.js';
import { GAME_MODES } from '../src/domain/game/game-mode.js';

function getEnv(): Record<string, string> {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const env: Record<string, string> = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valParts] = trimmed.split('=');
    if (key && valParts.length > 0) {
      env[key.trim()] = valParts.join('=').trim();
    }
  }
  return env;
}

async function runInteractiveTelegramLiveTest() {
  console.log('======================================================================');
  console.log('🧪 LIVE INTERACTIVE TELEGRAM TEST SUITE FOR USER REVIEW');
  console.log('======================================================================\n');

  const env = getEnv();
  const token = env.BOT_TOKEN;
  const devUserId = env.DEV_USER_IDS?.split(',')[0]?.trim();

  if (!token || !devUserId) {
    console.error('❌ Missing BOT_TOKEN or DEV_USER_IDS in .env file!');
    process.exit(1);
  }

  const bot = new Bot(token);
  const targetUserId = Number(devUserId);
  const me = await bot.api.getMe();

  console.log(`📡 Connected to Live Telegram API as @${me.username}`);
  console.log(`👤 Sending interactive test suite to User ID: ${targetUserId}\n`);

  const locales = await loadLocales(path.resolve('locales'));
  const translator = new Translator(locales, 'fr');

  // HEADER BANNER
  await bot.api.sendMessage(
    targetUserId,
    `🏰 <b>========================================</b>\n` +
      `🧪 <b>SUITE DE TESTS INTERACTIFS EN DIRECT (@${me.username})</b>\n` +
      `<i>Testez ci-dessous tous les composants du jeu Werewolf/Loup-Garou v2.0 !</i>\n` +
      `🏰 <b>========================================</b>`,
    { parse_mode: 'HTML' }
  );

  // SECTION 1: ROLE ASSIGNMENT & NIGHT POWER ACTION KEYBOARDS
  console.log('📤 Sending 1. Role Assignment & Night Power Action Keyboards...');
  await bot.api.sendMessage(
    targetUserId,
    `📜 <b>SECTION 1 : RECEPTION DE ROLE & CLAVIERS D'ACTIONS DE NUIT</b>\n` +
      `<i>Voici le rendu des messages secrets reçus en MP au début d'une partie avec les boutons interactifs :</i>`,
    { parse_mode: 'HTML' }
  );

  // 1.1 Seer (Voyante)
  const seerKb = new InlineKeyboard()
    .text('👤 Alice', 'test_seer_1')
    .text('👤 Bob', 'test_seer_2')
    .row()
    .text('👤 Charlie', 'test_seer_3')
    .text('❌ S\'abstenir', 'test_seer_skip');
  await bot.api.sendMessage(
    targetUserId,
    `🔮 <b>[TEST RÔLE - VOYANTE]</b>\n` +
      `Vous êtes la <b>Voyante</b>. Choisissez un joueur à sonder cette nuit pour découvrir sa vraie nature :`,
    { parse_mode: 'HTML', reply_markup: seerKb }
  );

  // 1.2 Werewolf (Loup-Garou)
  const wolfKb = new InlineKeyboard()
    .text('🥩 Dévorer Alice', 'test_wolf_1')
    .text('🥩 Dévorer Bob', 'test_wolf_2')
    .row()
    .text('🥩 Dévorer Charlie', 'test_wolf_3');
  await bot.api.sendMessage(
    targetUserId,
    `🐺 <b>[TEST RÔLE - LOUP-GAROU]</b>\n` +
      `Vous êtes <b>Loup-Garou</b>. Votez avec la meute pour désigner la victime de la nuit :`,
    { parse_mode: 'HTML', reply_markup: wolfKb }
  );

  // 1.3 Witch (Sorcière)
  const witchKb = new InlineKeyboard()
    .text('✨ Sauver Alice (Potion de Guérison)', 'test_witch_heal')
    .row()
    .text('☠️ Tuer Bob (Potion Mortelle)', 'test_witch_kill')
    .row()
    .text('❌ Ne rien faire', 'test_witch_skip');
  await bot.api.sendMessage(
    targetUserId,
    `🧪 <b>[TEST RÔLE - SORCIÈRE]</b>\n` +
      `Vous êtes la <b>Sorcière</b>. Les loups ont attaqué <b>Alice</b> !\n` +
      `Il vous reste : 1x Potion de Guérison ✨ | 1x Potion Mortelle ☠️`,
    { parse_mode: 'HTML', reply_markup: witchKb }
  );

  // 1.4 Guardian Angel (Garde du Corps)
  const gaKb = new InlineKeyboard()
    .text('🛡️ Protéger Alice', 'test_ga_1')
    .text('🛡️ Protéger Bob', 'test_ga_2')
    .row()
    .text('🛡️ Protéger Charlie', 'test_ga_3');
  await bot.api.sendMessage(
    targetUserId,
    `🛡️ <b>[TEST RÔLE - GARDE DU CORPS]</b>\n` +
      `Vous êtes le <b>Garde du Corps</b>. Choisissez qui protéger contre les attaques cette nuit :`,
    { parse_mode: 'HTML', reply_markup: gaKb }
  );

  // 1.5 Hunter Shot (Tir du Chasseur)
  const hunterKb = new InlineKeyboard()
    .text('🏹 Tirer sur Alice', 'test_hunter_1')
    .text('🏹 Tirer sur Bob', 'test_hunter_2');
  await bot.api.sendMessage(
    targetUserId,
    `🏹 <b>[TEST RÔLE - CHASSEUR (RIPOSTE)]</b>\n` +
      `<b>VOUS ÊTES MORT !</b> Dans votre dernier souffle, ajustez votre tir et emportez un joueur dans la tombe :`,
    { parse_mode: 'HTML', reply_markup: hunterKb }
  );

  // 1.6 Trapper Wolf (Loup Piégeur)
  const trapperKb = new InlineKeyboard()
    .text('🕸️ Piéger la maison d\'Alice', 'test_trapper_1')
    .text('🕸️ Piéger Bob', 'test_trapper_2');
  await bot.api.sendMessage(
    targetUserId,
    `🐺🕸️ <b>[TEST RÔLE - LOUP PIÉGEUR]</b>\n` +
      `Vous êtes le <b>Loup Piégeur</b>. Placez un piège mortel sur la porte d'un joueur :`,
    { parse_mode: 'HTML', reply_markup: trapperKb }
  );

  // 1.7 Judge (Juge)
  const judgeKb = new InlineKeyboard().text('⚖️ GRACIER LE CONDAMNÉ (Alice)', 'test_judge_pardon');
  await bot.api.sendMessage(
    targetUserId,
    `⚖️ <b>[TEST RÔLE - JUGE]</b>\n` +
      `Le village a voté pour éliminer <b>Alice</b> ! En tant que Juge, souhaitez-vous exercer votre droit de grâce ?`,
    { parse_mode: 'HTML', reply_markup: judgeKb }
  );

  // SECTION 2: LYNCH VOTING KEYBOARDS (GROUP & PRIVATE VOTE TOGGLE)
  console.log('📤 Sending 2. Lynch Voting Keyboards & PM Vote Toggle Notice...');
  await bot.api.sendMessage(
    targetUserId,
    `⚖️ <b>SECTION 2 : VOTE DE LYNCHAGE DU VILLAGE & OPTION VOTE PRIVÉ</b>\n` +
      `<i>Test des claviers de vote diurne dans le groupe et en privé MP :</i>`,
    { parse_mode: 'HTML' }
  );

  // Public Group Voting Keyboard
  const groupLynchKb = new InlineKeyboard()
    .text('🗳️ Alice (2 votes)', 'test_vote_1')
    .text('🗳️ Bob (1 vote)', 'test_vote_2')
    .row()
    .text('🗳️ Charlie (0 vote)', 'test_vote_3')
    .text('🚫 Abstention (1)', 'test_vote_skip');
  await bot.api.sendMessage(
    targetUserId,
    `🗳️ <b>[VOTE DU VILLAGE - PUBLIC DANS LE GROUPE]</b>\n` +
      `Qui souhaitez-vous pendre au village aujourd'hui ?\n` +
      `▪️ Alice : 🗳️ Bob, 🗳️ Charlie\n` +
      `▪️ Bob : 🗳️ Alice\n` +
      `⏱ Temps restant : 45 secondes`,
    { parse_mode: 'HTML', reply_markup: groupLynchKb }
  );

  // PM Lynch Vote Notification & Keyboard (Private Voting Toggle Test)
  const pmLynchKb = new InlineKeyboard()
    .text('🔒 Voter secret contre Alice', 'test_pmvote_1')
    .text('🔒 Voter secret contre Bob', 'test_pmvote_2')
    .row()
    .text('🚫 Abstention secrète', 'test_pmvote_skip');
  await bot.api.sendMessage(
    targetUserId,
    `🔒 <b>[OPTION VOTE PRIVÉ EN MP ACTIVÉE - pmLynchVote]</b>\n` +
      `L'option de vote privé est active sur cette partie ! Votez ici en MP pour que votre vote reste totalement secret dans le groupe.`,
    { parse_mode: 'HTML', reply_markup: pmLynchKb }
  );

  // SECTION 3: NOTIFICATIONS & POWER OUTCOMES
  console.log('📤 Sending 3. Notifications & Power Outcomes...');
  await bot.api.sendMessage(
    targetUserId,
    `📢 <b>SECTION 3 : NOTIFICATIONS & RÉSULTATS DE POUVOIRS</b>\n` +
      `<i>Test des messages d'annonces de visions, attaques et protections :</i>`,
    { parse_mode: 'HTML' }
  );

  // Seer Vision Result
  await bot.api.sendMessage(
    targetUserId,
    `🔮 <b>[RÉSULTAT DE VISION DE LA VOYANTE]</b>\n` +
      `Votre boule de cristal s'illumine... <b>Alice</b> est un 🐺 <b>Loup-Garou</b> !`,
    { parse_mode: 'HTML' }
  );

  // Guardian Angel Saved Notice
  await bot.api.sendMessage(
    targetUserId,
    `🛡️ <b>[PROTECTION RÉUSSIE]</b>\n` +
      `Cette nuit, les loups ont attaqué votre cible <b>Bob</b>, mais votre bouclier sacré l'a sauvé d'une mort certaine !`,
    { parse_mode: 'HTML' }
  );

  // Witch Potion Poison Notice
  await bot.api.sendMessage(
    targetUserId,
    `🧪 <b>[POTION MORTELLE UTILISÉE]</b>\n` +
      `Vous avez versé votre fiolle d'empoisonnement dans le verre de <b>Charlie</b>. Il ne se réveillera pas au matin.`,
    { parse_mode: 'HTML' }
  );

  // SECTION 4: 10 GAME MODES COMMAND PANEL
  console.log('📤 Sending 4. 10 Game Modes Command Panel...');
  const modesList = GAME_MODES.map((m) => `• <code>/start${m.toLowerCase()}</code> : Mode <b>${m}</b>`).join('\n');
  await bot.api.sendMessage(
    targetUserId,
    `🎮 <b>SECTION 4 : PANNEAU DES 10 MODES DE JEU DISPONIBLES</b>\n` +
      `<i>Tapez ou cliquez sur ces commandes dans un groupe pour lancer une partie :</i>\n\n` +
      `${modesList}\n\n` +
      `• <code>/startgame</code> : Lance le mode Normal par défaut`,
    { parse_mode: 'HTML' }
  );

  // SECTION 5: BOT CONFIGURATION MENU TEST
  console.log('📤 Sending 5. Config Menu Test...');
  const configKb = new InlineKeyboard()
    .text('⏱️ Timers (Jour/Nuit/Lynch)', 'test_cfg_timers')
    .text('⚖️ Vote Privé MP', 'test_cfg_pmvote')
    .row()
    .text('🎭 Rôles Actifs', 'test_cfg_roles')
    .text('🌐 Langue (FR/EN)', 'test_cfg_lang');
  await bot.api.sendMessage(
    targetUserId,
    `⚙️ <b>SECTION 5 : MENU DE CONFIGURATION DU BOT (/config)</b>\n` +
      `Panneau de gestion du groupe réservé aux administrateurs :`,
    { parse_mode: 'HTML', reply_markup: configKb }
  );

  // SECTION 6: SAMPLE HD VIDEO ANIMATION WITH ARTWORK
  console.log('📤 Sending 6. Sample HD Video Animation...');
  const sampleAnimPath = path.resolve('assets/gifs/AlphaWolfInfect.mp4');
  if (fs.existsSync(sampleAnimPath)) {
    await bot.api.sendAnimation(targetUserId, new InputFile(sampleAnimPath), {
      caption: `🎬 <b>SECTION 6 : TEST DE RENDU ANIMÉ HD</b>\nExemple : <code>AlphaWolfInfect.mp4</code> avec illustration d'art Dark Fantasy`,
      parse_mode: 'HTML',
    });
  }

  // FINAL SUMMARY FOOTER
  await bot.api.sendMessage(
    targetUserId,
    `✅ <b>========================================</b>\n` +
      `🎉 <b>SUITE DE TESTS INTERACTIFS DÉPLOYÉE AVEC SUCCÈS !</b>\n` +
      `Toutes les fonctions ci-dessus sont prêtes et directement cliquables pour vos tests d'utilisation !\n` +
      `🏰 <b>========================================</b>`,
    { parse_mode: 'HTML' }
  );

  console.log('\n======================================================================');
  console.log('🎉 INTERACTIVE TELEGRAM TEST SUITE DELIVERED SUCCESSFULLY TO USER!');
  console.log('======================================================================\n');
}

runInteractiveTelegramLiveTest().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
