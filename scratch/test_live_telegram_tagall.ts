import fs from 'node:fs';
import { Bot } from 'grammy';

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

async function testLiveTagAll() {
  console.log('======================================================================');
  console.log('📢 TESTING LIVE TELEGRAM TAGALL / AUTOMATIC MEMBER TAGGING');
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

  console.log(`1️⃣ Testing TagAll Telegram Notification...`);
  const mentions = [`@BorisGautier`, `<a href="tg://user?id=${targetUserId}">Boris</a>`];
  const tagMessage =
    `📢 <b>APPEL DU VILLAGE ! REJOIGNEZ LA PARTIE DE LOUPS-GAROUS !</b> 🐺\n\n` +
    `Une nouvelle partie vient de démarrer ! Les joueurs enregistrés sont tagués :\n${mentions.join(' ')}`;

  await bot.api.sendMessage(targetUserId, tagMessage, { parse_mode: 'HTML' });
  console.log('   ✅ Sent TagAll Live Test Message to Telegram!');

  console.log('\n======================================================================');
  console.log('🎉 LIVE TELEGRAM TAGALL TEST COMPLETED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

testLiveTagAll().catch((err) => {
  console.error('❌ Error during live tagall test:', err);
  process.exit(1);
});
