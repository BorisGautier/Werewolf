import { Bot } from 'grammy';
import dotenv from 'dotenv';
dotenv.config();

async function checkConnection() {
  const token = process.env.BOT_TOKEN;
  console.log('Testing Telegram Bot Token:', token ? `${token.substring(0, 10)}...` : 'MISSING');
  
  if (!token) {
    console.error('❌ BOT_TOKEN is missing in .env file!');
    return;
  }

  const bot = new Bot(token);
  try {
    const me = await bot.api.getMe();
    console.log(`✅ Success! Bot connected to Telegram: @${me.username} (${me.first_name}) [ID: ${me.id}]`);
  } catch (err: any) {
    console.error('❌ Failed to connect to Telegram API:', err.message);
    if (err.code === 'ENOTFOUND') {
      console.error('💡 Cause: DNS / Network failure reaching api.telegram.org. Check your internet connection or DNS settings.');
    }
  }
}

checkConnection();
