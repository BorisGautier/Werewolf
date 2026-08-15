import fs from 'node:fs';
import { Bot, InlineKeyboard } from 'grammy';
import { getRankForPoints } from '../src/domain/scoring/rank.js';
import { TITLE_CATALOG } from '../src/domain/titles/title.js';
import { generateGazette } from '../src/domain/gazette/gazette-generator.js';
import { Game } from '../src/domain/game/game.aggregate.js';
import type { GameEvent } from '../src/domain/game/game-event.js';

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

async function runBilingualTest() {
  console.log('======================================================================');
  console.log('🌍 BILINGUAL (FR / EN) LIVE TELEGRAM VERIFICATION');
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

  // 1. Send French Profile & English Profile
  console.log('1️⃣ Sending Profile Cards (FR & EN)...');
  const rank = getRankForPoints(3500);

  const frProfile = [
    `👤 <b>CARTE DE PROFIL — BORIS GAUTIER (FR)</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🏅 <b>Rang :</b> ${rank.emoji} ${rank.defaultTitle}`,
    `👑 <b>Titre Équipé :</b> 👑 L'Intouchable`,
    `⭐ <b>Points de Classement :</b> 3540 pts`,
    `🎮 <b>Parties Jouées :</b> 142`,
    `🏆 <b>Victoires :</b> 98 (69.0% winrate)`,
    `💎 <b>Palier Donateur :</b> Membre`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💡 Utilise /titles pour changer ton titre équipé !`,
  ].join('\n');

  const enProfile = [
    `👤 <b>PROFILE CARD — BORIS GAUTIER (EN)</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🏅 <b>Rank:</b> ${rank.emoji} War King`,
    `👑 <b>Equipped Title:</b> 👑 Untouchable`,
    `⭐ <b>Ranking Points:</b> 3540 pts`,
    `🎮 <b>Games Played:</b> 142`,
    `🏆 <b>Victories:</b> 98 (69.0% winrate)`,
    `💎 <b>Donor Tier:</b> Member`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💡 Use /titles to change your equipped title!`,
  ].join('\n');

  await bot.api.sendMessage(targetUserId, frProfile, { parse_mode: 'HTML' });
  await new Promise((r) => setTimeout(r, 1000));
  await bot.api.sendMessage(targetUserId, enProfile, { parse_mode: 'HTML' });
  console.log('   ✅ Sent FR & EN Profile Cards');

  // 2. Send French & English Gazette
  console.log('\n2️⃣ Sending Village Gazette (FR & EN)...');
  const dummyGame = new Game(BigInt(100), { minPlayers: 5, maxPlayers: 10 });
  dummyGame.addPlayer(BigInt(1), 'Alice');
  dummyGame.addPlayer(BigInt(2), 'Bob');
  dummyGame.winningTeam = 'Village';

  const events: GameEvent[] = [
    { type: 'PlayerDied', playerId: BigInt(2), method: 'Eat', killerIds: [BigInt(3)], isNight: true },
    { type: 'PlayerDied', playerId: BigInt(3), method: 'Lynch', killerIds: [], isNight: false },
  ];

  const frGazette = generateGazette(dummyGame, [events], 'fr');
  const enGazette = generateGazette(dummyGame, [events], 'en');

  await bot.api.sendMessage(targetUserId, `${frGazette.title}\n\n${frGazette.lines.join('\n')}`, { parse_mode: 'HTML' });
  await new Promise((r) => setTimeout(r, 1000));
  await bot.api.sendMessage(targetUserId, `${enGazette.title}\n\n${enGazette.lines.join('\n')}`, { parse_mode: 'HTML' });
  console.log('   ✅ Sent FR & EN Gazette Stories');

  // 3. Send French & English Title Keyboards
  console.log('\n3️⃣ Sending Titles Management Menu (FR & EN)...');
  const frKb = new InlineKeyboard().text('👑 👑 L\'Intouchable', 'settitle:untouchable').row().text('❌ Retirer mon titre', 'settitle:none');
  const enKb = new InlineKeyboard().text('👑 👑 Untouchable', 'settitle:untouchable').row().text('❌ Unequip Title', 'settitle:none');

  await bot.api.sendMessage(targetUserId, `👑 <b>GESTION DES TITRES ÉPIQUES (FR)</b>\n\nChoisis le titre que tu souhaites afficher :`, { reply_markup: frKb, parse_mode: 'HTML' });
  await new Promise((r) => setTimeout(r, 1000));
  await bot.api.sendMessage(targetUserId, `👑 <b>EQUIP YOUR TITLE (EN)</b>\n\nChoose the title you wish to display:`, { reply_markup: enKb, parse_mode: 'HTML' });
  console.log('   ✅ Sent FR & EN Titles Management Keyboards');

  console.log('\n======================================================================');
  console.log('🎉 BILINGUAL TELEGRAM TEST COMPLETED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

runBilingualTest().catch((err) => {
  console.error('❌ Error during bilingual test:', err);
  process.exit(1);
});
