import fs from 'node:fs';
import { Bot } from 'grammy';
import { PLAYER_RANKS, getRankForPoints } from '../src/domain/scoring/rank.js';

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

async function testRankPromotionPm() {
  console.log('======================================================================');
  console.log('🏅 TESTING RANK PROMOTION TELEGRAM NOTIFICATIONS');
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

  console.log(`🎯 Sending sample Promotion PM Notification to Telegram User ID: ${targetUserId}...\n`);

  const sampleRanks = [
    getRankForPoints(150),  // Chevalier Noir
    getRankForPoints(500),  // Chevalier Élite
    getRankForPoints(1000), // Chasseur de Dragon
    getRankForPoints(3500), // Roi de Guerre
    getRankForPoints(7500), // Dieu du Loup
  ];

  for (const rank of sampleRanks) {
    const promoMsg =
      `🎉 <b>FÉLICITATIONS ! PROMOTION DE RANG !</b> 🎉\n\n` +
      `Vous avez accumulé <b>${rank.minPoints} points</b> et vous franchissez un nouveau palier !\n` +
      `Votre nouveau rang est : <b>${rank.emoji} ${rank.defaultTitle}</b> ! 🏆`;

    await bot.api.sendMessage(targetUserId, promoMsg, { parse_mode: 'HTML' });
    console.log(`   ✅ Sent Promotion PM for: ${rank.emoji} ${rank.defaultTitle} (${rank.minPoints} pts)`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n======================================================================');
  console.log('🎉 RANK PROMOTION TELEGRAM TEST COMPLETED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

testRankPromotionPm().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
