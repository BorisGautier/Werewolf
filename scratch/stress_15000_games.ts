import { randomInt } from 'node:crypto';
import path from 'node:path';
import { GameManager } from '../src/application/game-manager.js';
import { Game } from '../src/domain/game/game.aggregate.js';
import { ROLE_BIT, ROLE_NAMES, roleName, type RoleName } from '../src/domain/roles/role.js';
import { alivePlayers } from '../src/domain/game/player.js';
import { getTeamForRole } from '../src/domain/game/team.js';
import { GameLoop } from '../src/infrastructure/telegram/game-loop.js';
import { getDefaultLocale, loadLocales } from '../src/infrastructure/i18n/locale-loader.js';
import { Translator } from '../src/infrastructure/i18n/translator.js';
import type { GroupRepository, GroupWithConfig } from '../src/infrastructure/persistence/group.repository.js';
import type { GameRepository } from '../src/infrastructure/persistence/game.repository.js';
import type { AchievementRepository } from '../src/infrastructure/persistence/achievement.repository.js';
import type { Logger } from '../src/infrastructure/logging/logger.js';

function fakeGroup(): GroupWithConfig {
  return {
    id: 1,
    telegramId: 1n,
    title: 'Stress Group',
    username: null,
    language: 'en',
    mode: 'NORMAL',
    dayTimerSeconds: 1,
    nightTimerSeconds: 1,
    lynchTimerSeconds: 1,
    maxExtendSeconds: 0,
    maxPlayers: 35,
    allowExtend: false,
    allowFlee: true,
    allowNsfw: false,
    allowTanner: true,
    allowFool: true,
    allowCult: true,
    allowThief: true,
    allowArsonist: true,
    thiefFull: false,
    burningOverkill: true,
    showRolesOnDeath: true,
    showRolesEnd: 'ALL',
    showIds: false,
    shufflePlayerList: false,
    randomMode: false,
    secretLynch: false,
    secretLynchShowVotes: false,
    secretLynchShowVoters: false,
    botInGroup: true,
    banned: false,
    memberCount: null,
    preferred: false,
    inviteLink: null,
    defaultGifPackId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    disabledRoles: [],
  };
}

type VotingBias =
  | { kind: 'random' }
  | { kind: 'concentrate' }
  | { kind: 'split' }
  | { kind: 'abstain' }
  | { kind: 'targetRole'; role: RoleName };

function buttonsOf(replyMarkup: unknown): { text: string; callback_data: string }[] {
  const kb = replyMarkup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
  return kb?.inline_keyboard?.flat() ?? [];
}

async function runOneGame(
  chatId: bigint,
  playerCount: number,
  chaos: boolean,
  bias: VotingBias,
  translator: Translator
) {
  const group = fakeGroup();
  const groups = {
    getOrCreate: async () => group,
    findByTelegramId: async () => group,
  } as unknown as GroupRepository;

  const gameRepo = {
    createGame: async () => 1,
    recordPlayers: async () => {},
    finalizeGame: async () => new Date(),
    recordKill: async () => {},
  } as unknown as GameRepository;

  const achievements = {
    unlock: async () => false,
    recordGameResult: async () => new Map(),
  } as unknown as AchievementRepository;

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as Logger;

  const gameManager = new GameManager();
  const game: Game = gameManager.create(chatId, {
    mode: chaos ? 'Chaos' : 'Normal',
    minPlayers: 5,
    maxPlayers: 35,
    burningOverkill: true,
  });

  for (let i = 1; i <= playerCount; i++) {
    game.addPlayer(BigInt(i), `Player${i}`);
  }

  function chooseLynchVotes(buttons: { text: string; callback_data: string }[]): Map<bigint, string> {
    const alive = alivePlayers(game.players);
    const nonAbstain = buttons.filter((b) => !b.callback_data.endsWith(':abstain'));
    const votes = new Map<bigint, string>();

    switch (bias.kind) {
      case 'abstain': {
        const abstainBtn = buttons.find((b) => b.callback_data.endsWith(':abstain')) ?? buttons[0]!;
        for (const p of alive) votes.set(p.id, abstainBtn.callback_data);
        break;
      }
      case 'concentrate': {
        const pick = nonAbstain[randomInt(nonAbstain.length || 1)] ?? buttons[0]!;
        for (const p of alive) votes.set(p.id, pick.callback_data);
        break;
      }
      case 'split': {
        if (nonAbstain.length >= 2) {
          const [a, b] = nonAbstain;
          alive.forEach((p, i) => votes.set(p.id, (i % 2 === 0 ? a : b)!.callback_data));
        } else {
          const pick = nonAbstain[0] ?? buttons[0]!;
          for (const p of alive) votes.set(p.id, pick.callback_data);
        }
        break;
      }
      case 'targetRole': {
        const target = alive.find((p) => roleName(p.role) === bias.role);
        const btn = target ? buttons.find((b) => b.callback_data === `vote:${target.id.toString()}`) : undefined;
        if (btn) {
          for (const p of alive) votes.set(p.id, btn.callback_data);
        } else {
          for (const p of alive) votes.set(p.id, buttons[randomInt(buttons.length)]!.callback_data);
        }
        break;
      }
      case 'random':
      default:
        for (const p of alive) votes.set(p.id, buttons[randomInt(buttons.length)]!.callback_data);
    }
    return votes;
  }

  const sendMessage = async (recipientChatId: number, _text: string, options?: { reply_markup?: unknown }) => {
    const buttons = buttonsOf(options?.reply_markup);
    if (buttons.length === 0) return { message_id: 1 };

    if (BigInt(recipientChatId) === chatId) {
      for (const [playerId, data] of chooseLynchVotes(buttons)) {
        await loop.handleCallback(playerId, chatId, data);
      }
    } else {
      const pick = buttons[randomInt(buttons.length)]!;
      await loop.handleCallback(BigInt(recipientChatId), BigInt(recipientChatId), pick.callback_data);
    }
    return { message_id: 1 };
  };

  const bot = { api: { sendMessage, sendAnimation: async () => ({ message_id: 1 }) } } as unknown as any;
  const loop = new GameLoop(bot, gameManager, groups, gameRepo, achievements, translator, logger);

  game.start({ chaos });
  loop.start(game, 1);

  // Fast drive phase resolution until game finishes
  let safety = 0;
  while (game.phase !== 'Ended' && safety < 100) {
    safety++;
    if (game.phase === 'Night') {
      await loop.skipVote(chatId, game.players[0]!.id);
    } else if (game.phase === 'Day') {
      await loop.forceSkipDay(chatId);
    } else if (game.phase === 'Lynch') {
      await loop.forceSkipLynch(chatId);
    }
  }

  return {
    winningTeam: game.winningTeam,
    dealtRoles: game.players.map((p) => roleName(p.role)),
    ended: game.phase === 'Ended',
  };
}

async function main() {
  console.log('🚀 Starting 15,000 Games Ultra-Stress Simulation across all 63 roles...');
  const locales = await loadLocales(path.resolve('locales'));
  const translator = new Translator(locales, 'en');

  const TOTAL_GAMES = 15000;
  const biases: VotingBias[] = [
    { kind: 'random' },
    { kind: 'concentrate' },
    { kind: 'split' },
    { kind: 'abstain' },
    { kind: 'targetRole', role: 'Tanner' },
    { kind: 'targetRole', role: 'Prince' },
  ];

  let totalCrashes = 0;
  let totalStalls = 0;
  const dealtRoleSet = new Set<string>();
  const winningTeamCounts: Record<string, number> = {};

  const startTime = Date.now();

  for (let i = 1; i <= TOTAL_GAMES; i++) {
    const playerCount = randomInt(5, 36);
    const chaos = randomInt(0, 2) === 1;
    const bias = biases[randomInt(biases.length)]!;

    try {
      const res = await runOneGame(BigInt(i), playerCount, chaos, bias, translator);
      if (!res.ended) {
        totalStalls++;
      } else {
        const team = res.winningTeam ?? 'NoWinner';
        winningTeamCounts[team] = (winningTeamCounts[team] ?? 0) + 1;
      }
      for (const r of res.dealtRoles) {
        dealtRoleSet.add(r);
      }
    } catch (err) {
      console.error(`💥 Crash on game #${i}:`, err);
      totalCrashes++;
    }

    if (i % 3000 === 0 || i === TOTAL_GAMES) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`📊 Progress: ${i}/${TOTAL_GAMES} games simulated (${elapsed}s elapsed) | Crashes: ${totalCrashes} | Stalls: ${totalStalls} | Roles Dealt: ${dealtRoleSet.size}/63`);
    }
  }

  console.log('\n=================== 15,000 GAMES SIMULATION SUMMARY ===================');
  console.log(`✅ Total Games Executed : ${TOTAL_GAMES}`);
  console.log(`❌ Crashes               : ${totalCrashes}`);
  console.log(`⏳ Stalls                : ${totalStalls}`);
  console.log(`🎭 Total Unique Roles    : ${dealtRoleSet.size}/63 roles dealt`);
  console.log('🏆 Winning Teams Breakout:');
  for (const [team, count] of Object.entries(winningTeamCounts)) {
    console.log(`   - ${team.padEnd(15)}: ${count} wins (${((count / TOTAL_GAMES) * 100).toFixed(1)}%)`);
  }
  console.log('=======================================================================\n');

  if (totalCrashes === 0 && totalStalls === 0) {
    console.log('🎉 100% SUCCESS! ALL 15,000 GAMES PASSED WITH ZERO CRASHES AND ZERO STALLS!');
  } else {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
