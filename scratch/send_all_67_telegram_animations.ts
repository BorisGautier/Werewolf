import fs from 'node:fs';
import path from 'node:path';
import { Bot, InputFile } from 'grammy';
import { GIF_CATEGORIES } from '../src/infrastructure/persistence/gif-pack.repository.js';

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

async function sendAll67AnimationsToTelegram() {
  console.log('======================================================================');
  console.log('🎬 TELEGRAM MEDIA SUITE - SENDING ALL 67 ANIMATIONS TO TELEGRAM DM');
  console.log('======================================================================\n');

  const env = getEnv();
  const token = env.BOT_TOKEN;
  const devUserId = env.DEV_USER_IDS?.split(',')[0]?.trim();

  if (!token || !devUserId) {
    console.error('❌ Missing BOT_TOKEN or DEV_USER_IDS in .env file!');
    process.exit(1);
  }

  const bot = new Bot(token);
  const me = await bot.api.getMe();
  const targetUserId = Number(devUserId);

  console.log(`📡 Connected as @${me.username} (Bot ID: ${me.id})`);
  console.log(`🎯 Target Telegram User ID: ${targetUserId}`);
  console.log(`📦 Total GifCategories to send: ${GIF_CATEGORIES.length}\n`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < GIF_CATEGORIES.length; i++) {
    const category = GIF_CATEGORIES[i];
    const mp4Path = path.resolve(`assets/gifs/${category}.mp4`);

    if (!fs.existsSync(mp4Path)) {
      console.error(`❌ [${i + 1}/${GIF_CATEGORIES.length}] Missing video file: assets/gifs/${category}.mp4`);
      failed++;
      continue;
    }

    try {
      const caption = `🎬 <b>[ANIMATION ${i + 1}/67]</b> : <code>${category}.mp4</code>\nCatégorie : <b>${category}</b>`;
      await bot.api.sendAnimation(targetUserId, new InputFile(mp4Path), {
        caption,
        parse_mode: 'HTML',
      });
      sent++;
      console.log(`   ✅ [${sent}/67] Delivered ${category}.mp4 to Telegram DM!`);
    } catch (err: any) {
      console.error(`   ❌ Failed sending ${category}.mp4:`, err?.message || err);
      failed++;
    }

    // Delay 1.2s between sends to avoid Telegram API rate limit
    await new Promise((res) => setTimeout(res, 1200));
  }

  console.log('\n======================================================================');
  console.log(`🎉 COMPLETED: Sent ${sent}/${GIF_CATEGORIES.length} animations to Telegram DM! (Failed: ${failed})`);
  console.log('======================================================================\n');
}

sendAll67AnimationsToTelegram().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
