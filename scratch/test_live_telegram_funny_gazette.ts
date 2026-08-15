import fs from 'node:fs';
import { Bot } from 'grammy';
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

async function testFunnyGazette() {
  console.log('======================================================================');
  console.log('🗞️ TESTING LIVE HILARIOUS GAZETTE WITH PLAYER NAMES');
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

  const game = new Game(BigInt(777), { minPlayers: 5, maxPlayers: 10 });
  game.addPlayer(BigInt(1), 'BorisGautier');
  game.addPlayer(BigInt(2), 'SophieTheWitch');
  game.addPlayer(BigInt(3), 'AlexTheWolf');
  game.addPlayer(BigInt(4), 'JeanTheHunter');
  game.addPlayer(BigInt(5), 'MarieTheSeer');
  game.winningTeam = 'Village';

  // Mark player 2 & 3 as dead
  game.players[1]!.isDead = true;
  game.players[2]!.isDead = true;

  const events: GameEvent[] = [
    { type: 'PlayerDied', playerId: BigInt(2), method: 'Eat', killerIds: [BigInt(3)], isNight: true },
    { type: 'PlayerDied', playerId: BigInt(3), method: 'Lynch', killerIds: [], isNight: false },
    { type: 'PlayerDied', playerId: BigInt(4), method: 'Shoot', killerIds: [BigInt(4)], isNight: true },
  ];

  const frGazette = generateGazette(game, [events], 'fr');
  const enGazette = generateGazette(game, [events], 'en');

  console.log('1️⃣ Sending Hilarious French Gazette...');
  await bot.api.sendMessage(targetUserId, `${frGazette.title}\n\n${frGazette.lines.join('\n')}`, { parse_mode: 'HTML' });
  console.log('   ✅ Sent FR Gazette with player names');

  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n2️⃣ Sending Hilarious English Gazette...');
  await bot.api.sendMessage(targetUserId, `${enGazette.title}\n\n${enGazette.lines.join('\n')}`, { parse_mode: 'HTML' });
  console.log('   ✅ Sent EN Gazette with player names');

  console.log('\n======================================================================');
  console.log('🎉 FUNNY GAZETTE TELEGRAM TEST COMPLETED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

testFunnyGazette().catch((err) => {
  console.error('❌ Error during funny gazette test:', err);
  process.exit(1);
});
