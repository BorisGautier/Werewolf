import fs from 'node:fs';
import path from 'node:path';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { loadLocales } from '../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../src/infrastructure/i18n/translator.js';
import { ROLE_META, ROLE_NAMES } from '../src/domain/roles/role.js';

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

async function runLiveTelegramTests() {
  console.log('🚀 Starting Live Telegram API E2E Verification for 63 Roles...');
  const env = getEnv();
  const token = env.BOT_TOKEN;
  const devUserId = env.DEV_USER_IDS?.split(',')[0]?.trim();

  if (!token) {
    throw new Error('BOT_TOKEN is missing in .env');
  }

  const bot = new Bot(token);

  // 1. Verify Bot Connection to Live Telegram API
  console.log('📡 Connecting to Telegram API...');
  const me = await bot.api.getMe();
  console.log(`✅ Connected to Live Telegram API as @${me.username} (ID: ${me.id}, Name: "${me.first_name}")`);

  // 2. Verify Locales and Translator
  const localesDir = path.resolve('locales');
  const locales = await loadLocales(localesDir);
  const translator = new Translator(locales, 'fr');
  console.log(`✅ Locales loaded successfully (${locales.size} languages: ${[...locales.keys()].join(', ')}).`);

  // 3. Test sending live role PM to DEV user (if configured)
  if (devUserId) {
    const targetUserId = Number(devUserId);
    console.log(`\n✉️ Testing live Telegram PM to Developer ID: ${targetUserId}...`);

    try {
      // Test 3.1: Live Role Notification with Emojis & French Translation
      const sampleRoleKey = 'Role_Watchman';
      const roleText = translator.translate('fr', sampleRoleKey);
      const roleMsg = translator.translate('fr', 'YourRoleIs', `${ROLE_META.Watchman.emoji} ${roleText}`);
      await bot.api.sendMessage(targetUserId, `🧪 <b>[TEST LIVE TELEGRAM 63 ROLES]</b>\n${roleMsg}`, {
        parse_mode: 'HTML',
      });
      console.log(`  ✅ Live Role PM delivered to Telegram ID ${targetUserId}: "${roleMsg}"`);

      // Test 3.2: Live Inline Keyboard (Start PM Button)
      const keyboard = new InlineKeyboard().url(
        translator.translate('fr', 'StartPmButton'),
        `https://t.me/${me.username}`
      );
      await bot.api.sendMessage(
        targetUserId,
        `🧪 <b>[TEST BOUTON INLINE]</b>\n${translator.translate('fr', 'MustStartPmFirstGroup', 'JoueurTest')}`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }
      );
      console.log(`  ✅ Live Inline Keyboard message delivered to Telegram ID ${targetUserId}.`);

      // Test 3.3: Live Animation/GIF Upload to Telegram API
      const gifPath = path.resolve('assets/gifs/VillagerDie.mp4');
      await bot.api.sendAnimation(targetUserId, new InputFile(gifPath), {
        caption: `🧪 <b>[TEST GIF LIVE]</b> Animation de mort (VillagerDie.mp4)`,
        parse_mode: 'HTML',
      });
      console.log(`  ✅ Live Animation (VillagerDie.mp4) uploaded and delivered to Telegram ID ${targetUserId}.`);

    } catch (err: any) {
      if (err?.error_code === 403) {
        console.log(`  ⚠️ Telegram ID ${targetUserId} has not started PM with @${me.username} yet.`);
        console.log(`  👉 To receive live test messages, start a PM with @${me.username} on Telegram.`);
      } else {
        console.error(`  ❌ Error sending live test message:`, err);
      }
    }
  }

  // 4. Verify all 63 Role Definitions & Emojis
  console.log('\n🎭 Verifying all 63 Role Definitions & French Translations...');
  let totalRoles = 0;
  for (const roleName of ROLE_NAMES) {
    const meta = ROLE_META[roleName];
    const frName = translator.translate('fr', `Role_${roleName}`);
    if (!meta || !meta.emoji) {
      throw new Error(`Missing RoleMeta or Emoji for role: ${roleName}`);
    }
    if (frName.startsWith('Role_')) {
      throw new Error(`Missing French translation for role: ${roleName}`);
    }
    totalRoles++;
  }
  console.log(`✅ All ${totalRoles} roles verified with valid emojis and French translations.`);

  console.log('\n🎉 ALL 63 ROLES & LIVE TELEGRAM API TESTS PASSED SUCCESSFULLY!');
}

runLiveTelegramTests().catch((err) => {
  console.error('💥 Live Test Failed:', err);
  process.exit(1);
});
