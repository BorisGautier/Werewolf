import fs from 'node:fs';
import { Bot, InlineKeyboard } from 'grammy';
import { getRankForPoints } from '../src/domain/scoring/rank.js';
import { TITLE_CATALOG } from '../src/domain/titles/title.js';
import { ACHIEVEMENTS } from '../src/domain/achievements/catalog.js';

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

async function runLiveTelegramFullTest() {
  console.log('======================================================================');
  console.log('🚀 LIVE TELEGRAM TEST: QUESTS, TITLES, GAZETTE & PROFILES');
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

  console.log(`🎯 Target Telegram User ID: ${targetUserId}\n`);

  // 1. Send Quest Unlock Notification MP
  console.log('1️⃣ Testing Quest / Achievement Unlock Notification PM...');
  const sampleQuests = [
    ACHIEVEMENTS.PlayingWithTheFire,
    ACHIEVEMENTS.ForbiddenLove,
    ACHIEVEMENTS.DoubleKill,
    ACHIEVEMENTS.GotYourBack,
  ];

  for (const quest of sampleQuests) {
    const questMsg =
      `🏆 <b>QUÊTE ACCOMPLIE ! / ACHIEVEMENT UNLOCKED!</b>\n\n` +
      `🎯 <b>${quest.name}</b>\n` +
      `📝 <i>${quest.description}</i>\n\n` +
      `⭐ <b>+100 Points de Classement accordés !</b>\n` +
      `👑 Nouveau Titre Épique Débloqué dans /titles !`;

    await bot.api.sendMessage(targetUserId, questMsg, { parse_mode: 'HTML' });
    console.log(`   ✅ Sent Quest Unlock PM: "${quest.name}"`);
    await new Promise((r) => setTimeout(r, 1200));
  }

  // 2. Send Live Epic Titles Management Keyboard (/titles)
  console.log('\n2️⃣ Testing Live /titles Keyboard...');
  const keyboard = new InlineKeyboard();
  TITLE_CATALOG.forEach((t, i) => {
    const isEquipped = i === 0;
    const btnText = `${isEquipped ? '✅ ' : ''}${t.emoji} ${t.defaultTitle}`;
    keyboard.text(btnText, `settitle:${t.id}`);
    if (i % 2 === 1) keyboard.row();
  });
  keyboard.row().text('❌ Retirer mon titre', 'settitle:none');

  const titlesMsg =
    `👑 <b>GESTION DES TITRES ÉPIQUES</b>\n\n` +
    `Choisis le titre que tu souhaites afficher sur ta carte de profil et dans le classement :`;

  await bot.api.sendMessage(targetUserId, titlesMsg, { reply_markup: keyboard, parse_mode: 'HTML' });
  console.log('   ✅ Sent /titles interactive Inline Keyboard PM');
  await new Promise((r) => setTimeout(r, 1200));

  // 3. Send Live Profile Card (/profile)
  console.log('\n3️⃣ Testing Live /profile Card...');
  const rank = getRankForPoints(3500); // Roi de Guerre
  const profileMsg = [
    `👤 <b>CARTE DE PROFIL — BORIS GAUTIER</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🏅 <b>Rang :</b> ${rank.emoji} ${rank.defaultTitle}`,
    `👑 <b>Titre Équipé :</b> 👑 L'Intouchable`,
    `⭐ <b>Points de Classement :</b> 3540 pts`,
    `🎮 <b>Parties Jouées :</b> 142`,
    `🏆 <b>Victoires :</b> 98 (69.0% winrate)`,
    `💎 <b>Palier Donateur :</b> 🥇 Donateur Or`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💡 Utilise /titles pour changer ton titre équipé !`,
  ].join('\n');

  await bot.api.sendMessage(targetUserId, profileMsg, { parse_mode: 'HTML' });
  console.log('   ✅ Sent /profile visual card PM');
  await new Promise((r) => setTimeout(r, 1200));

  // 4. Send Live Village Gazette (/gazette)
  console.log('\n4️⃣ Testing Live /gazette Theatrical Story...');
  const gazetteMsg =
    `📜 <b>LA GAZETTE DU VILLAGE — ÉDITION DU SOIR</b> 🗞️\n\n` +
    `<i>Le soleil s'est couché sur Thiercelieux... Une bataille d'esprits et de crocs s'est jouée entre 12 habitants.</i>\n\n` +
    `🩸 <b>Attaques Nocturnes :</b> La meute de loups a frappé 2 fois dans les ombres de la nuit.\n` +
    `⚖️ <b>Justice Populaire :</b> Le village en colère a mené 3 condamnation(s) à la potence.\n` +
    `⚡️ <b>Pouvoirs Sombre & Potions :</b> La sorcellerie et les balles ont fait 1 victime(s) supplémentaire(s).\n\n` +
    `✨ <b>DÉNOUEMENT :</b> Les villageois ont triomphé ! Les démons ont été démasqués et la paix règne de nouveau.`;

  await bot.api.sendMessage(targetUserId, gazetteMsg, { parse_mode: 'HTML' });
  console.log('   ✅ Sent /gazette theatrical story PM');

  console.log('\n======================================================================');
  console.log('🎉 ALL LIVE TELEGRAM TESTS COMPLETED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

runLiveTelegramFullTest().catch((err) => {
  console.error('❌ Error during live Telegram test:', err);
  process.exit(1);
});
