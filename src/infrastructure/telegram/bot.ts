import { exec } from 'node:child_process';
import * as os from 'node:os';
import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy';
import { GameManager } from '../../application/game-manager.js';
import type { Env } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { Translator } from '../i18n/translator.js';
import type { GameMode } from '../../domain/game/game-mode.js';
import { getRankForPoints } from '../../domain/scoring/rank.js';
import { TITLE_CATALOG, getTitleById } from '../../domain/titles/title.js';
import { LAST_GAZETTES_BY_CHAT } from '../../domain/gazette/gazette-generator.js';
import { AchievementRepository } from '../persistence/achievement.repository.js';
import { AdminRepository } from '../persistence/admin.repository.js';
import { GameRepository } from '../persistence/game.repository.js';
import { GIF_CATEGORIES, GifPackRepository } from '../persistence/gif-pack.repository.js';
import { GroupRepository } from '../persistence/group.repository.js';
import { NotifyGameRepository } from '../persistence/notify-game.repository.js';
import { DONATION_TIERS, PlayerRepository, donorBadge } from '../persistence/player.repository.js';
import { GameLobbyManager } from './game-lobby.js';
import { GameLoop } from './game-loop.js';
import { AlertService } from '../monitoring/alert-service.js';
import { registerModesGuideCommands } from './modes-guide.js';
import { ConfigMenu } from './config-menu.js';
import { runWithTraceContext } from '../monitoring/tracing.js';
import {
  nonNumericWords,
  numericIdTargets,
  replyTarget,
  resolveEntityTargets,
  resolveGroupArg,
} from './moderation-targets.js';
import { ABOUT_ROLE_BY_TRIGGER, aboutLocaleKey, resolveRoleFromTrigger } from './role-info.js';
import { ROLE_META, roleName } from '../../domain/roles/role.js';
import { ACHIEVEMENT_CODES, ACHIEVEMENTS } from '../../domain/achievements/catalog.js';
import { SpamGuard } from './spam-guard.js';
import {
  bansApplied,
  callbacksProcessed,
  commandResponseTime,
  commandsProcessed,
  playerReports,
  spamDetections,
  telegramApiErrors,
  telegramApiLatency,
} from '../monitoring/metrics.js';

/** Mirrors `AdminRepository.banForSpam`'s tier order: index 0 is the 1st spam ban, etc. - anything
 * past the array (4th ban onward) is permanent. */
const SPAM_BAN_DURATION_KEYS = [
  'SpamBanDuration12h',
  'SpamBanDuration24h',
  'SpamBanDuration3d',
] as const;
function spamBanDurationKey(tempBanCount: number): string {
  return SPAM_BAN_DURATION_KEYS[tempBanCount - 1] ?? 'SpamBanPermanent';
}

/**
 * Whether the sender of `ctx`'s message is a group admin - `ctx.chat` must already be known to be
 * a non-private chat. Mirrors the original's `AllowAnonymousAdmins` handling
 * (`UpdateHandler.cs`'s `isAnonymousAdmin` check): a message sent "as the group" via Telegram's
 * anonymous-admin feature has `sender_chat.id === chat.id`, and `ctx.from` in that case is the
 * `GroupAnonymousBot` system account, which never has a real `ChatMember` status - so it has to be
 * trusted directly instead of going through `getChatMember`/`getAuthor`.
 */
export async function isGroupAdminOrAnonymous(ctx: Context): Promise<boolean> {
  if (ctx.chat && ctx.senderChat?.id === ctx.chat.id) return true;
  const member = await ctx.getAuthor();
  return member.status === 'creator' || member.status === 'administrator';
}

import { ReportRepository } from '../persistence/report.repository.js';
import { TournamentRepository } from '../persistence/tournament.repository.js';
import { TournamentCommandHandler } from './tournament-commands.js';

export interface BotDependencies {
  translator: Translator;
  gameManager: GameManager;
  groupRepository: GroupRepository;
  playerRepository: PlayerRepository;
  gameRepository: GameRepository;
  adminRepository: AdminRepository;
  notifyGameRepository: NotifyGameRepository;
  achievementRepository: AchievementRepository;
  gifPackRepository: GifPackRepository;
  reportRepository?: ReportRepository;
  tournamentRepository?: TournamentRepository;
  prisma?: any;
  maintenance?: { on: boolean };
}

const INVITE_LINK_PATTERN = /^(https?:\/\/)?t(elegram)?\.me\/(\+|joinchat\/)([a-zA-Z0-9_-]+)$/;

/**
 * Composition root for the Telegram bot itself.
 *
 * Wires up: the bootstrap commands (`/ping`, `/version`); the general
 * commands (`/start`, `/help`, `/setlang`, `/stats` - simplified from
 * `GeneralCommands.cs`, whose website-backed stats/donation/multi-language
 * XML-pack machinery doesn't apply to this single-process, two-locale
 * fork); the join-lobby command family (`/startgame`, `/startchaos`,
 * `/join`, `/forcestart`, `/players`, `/flee` - see `game-lobby.ts`); and
 * the night/day/lynch loop's callback buttons (see `game-loop.ts`).
 */
export function createBot(env: Env, logger: Logger, deps: BotDependencies): Bot {
  const bot = new Bot(env.botToken);
  const startTime = new Date();
  /** Toggled by the dev-only `/maintenance` command; blocks new games while true. */
  const maintenance = deps.maintenance ?? { on: false };
  const gameLoop = new GameLoop(
    bot,
    deps.gameManager,
    deps.groupRepository,
    deps.gameRepository,
    deps.achievementRepository,
    deps.translator,
    logger,
    deps.playerRepository,
    deps.gifPackRepository,
  );
  const lobby = new GameLobbyManager(
    bot,
    deps.gameManager,
    deps.groupRepository,
    deps.playerRepository,
    deps.gameRepository,
    deps.translator,
    logger,
    gameLoop,
    deps.notifyGameRepository,
  );

  const tournamentRepo =
    deps.tournamentRepository ?? (deps.prisma ? new TournamentRepository(deps.prisma) : null);
  if (tournamentRepo) {
    const tournamentHandler = new TournamentCommandHandler(tournamentRepo, deps.playerRepository);
    tournamentHandler.registerCommands(bot);
  }
  const configMenu = new ConfigMenu(deps.groupRepository, deps.translator);

  bot.use(async (ctx, next) => {
    const start = Date.now();
    return runWithTraceContext(
      {
        ...(ctx.update?.update_id !== undefined ? { updateId: ctx.update.update_id } : {}),
        ...(ctx.from?.id !== undefined ? { userId: BigInt(ctx.from.id) } : {}),
        ...(ctx.chat?.id !== undefined ? { chatId: BigInt(ctx.chat.id) } : {}),
      },
      async () => {
        try {
          await next();
        } catch (err) {
          telegramApiErrors.inc();
          throw err;
        } finally {
          const duration = (Date.now() - start) / 1000;
          commandResponseTime.observe(duration);
          telegramApiLatency.observe(duration);
        }
      },
    );
  });

  // Auto-capture Telegram group title and username into database whenever a group interacts with the bot
  bot.use(async (ctx, next) => {
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      const chatId = BigInt(ctx.chat.id);
      const title = 'title' in ctx.chat ? (ctx.chat.title as string | null) : null;
      const username = 'username' in ctx.chat ? (ctx.chat.username as string | null) : null;
      if (title || username) {
        deps.groupRepository.getOrCreate(chatId, title, username).catch(() => {});
      }
    }
    return next();
  });

  // Port of `AddCount`/`SpamDetection`/`SpamBanList`: flags a Telegram user flooding the bot with
  // commands, warns them, then bans them (escalating duration) if they keep going. Registered
  // before every command handler below so a banned/flooding user's message never reaches one.
  const spamGuard = new SpamGuard();
  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id;
    const text = ctx.message?.text;
    if (
      fromId === undefined ||
      text === undefined ||
      !(text.startsWith('/') || text.startsWith('!'))
    ) {
      return next();
    }
    const cmdMatch = text.match(/^[/!]([a-zA-Z0-9_]+)/);
    const commandName = cmdMatch ? cmdMatch[1]! : 'unknown';
    commandsProcessed.labels(commandName).inc();

    const telegramId = BigInt(fromId);
    if (spamGuard.isBanned(telegramId)) return;

    const verdict = spamGuard.record(telegramId);
    if (verdict === 'ok') return next();

    spamDetections.inc();
    const player = await deps.playerRepository.findByTelegramId(telegramId);
    const language = player?.languageCode ?? 'en';
    if (verdict === 'warn') {
      await ctx.reply(deps.translator.translate(language, 'SpamWarning'));
      return;
    }

    const { expiresAt, tempBanCount } = await deps.adminRepository.banForSpam(telegramId);
    bansApplied.inc();
    spamGuard.markBanned(telegramId, expiresAt);
    const duration = deps.translator.translate(language, spamBanDurationKey(tempBanCount));
    await ctx.reply(deps.translator.translate(language, 'SpamBanned', duration));
  });

  // Automatically capture and register any member who sends a message in a group
  bot.use(async (ctx, next) => {
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') && ctx.from) {
      void deps.groupRepository.registerMember(BigInt(ctx.chat.id), {
        telegramId: BigInt(ctx.from.id),
        username: ctx.from.username ?? null,
        displayName: ctx.from.first_name,
      });
    }
    return next();
  });

  // Registered before the generic `callback_query:data` catch-all further down (which doesn't
  // call next()) so its own `stopwaiting:...` callback data actually gets a chance to match.
  registerWaitlistCommands(bot, deps);
  registerModesGuideCommands(bot);

  const alertService = new AlertService(bot, env, logger);

  bot.catch((error) => {
    alertService.handleBotError(error.error, `Update #${error.ctx.update.update_id}`);
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
  });

  bot.command(['testscenarios', 'testsuite', 'auditsuite'], async (ctx) => {
    if (!ctx.from || !env.devUserIds.includes(BigInt(ctx.from.id))) return;
    await ctx.reply('🧪 Running Automated Scenario Audit Suite...');
    const runner = new (await import('../testing/scenario-runner.js')).ScenarioRunner();
    const results = await runner.runAllScenarios();
    const report = results
      .map((r) => `${r.passed ? '✅' : '❌'} <b>${r.name}</b>\n└─ ${r.details}`)
      .join('\n\n');
    await ctx.reply(`📊 <b>SCENARIO TEST REPORT</b>\n\n${report}`, { parse_mode: 'HTML' });
  });

  bot.command('testgif', async (ctx) => {
    if (!ctx.from) return;
    if (!env.devUserIds.includes(BigInt(ctx.from.id))) return;
    const category = (
      (ctx.match as string | undefined) ?? ''
    ).trim() as import('../persistence/gif-pack.repository.js').GifCategory;
    const validCategories = GIF_CATEGORIES as readonly string[];
    if (!category || !validCategories.includes(category)) {
      await ctx.reply(
        `Usage: /testgif <category>\n\nAvailable categories:\n${GIF_CATEGORIES.join('\n')}`,
      );
      return;
    }
    const localPack = new (await import('./local-gif-pack.js')).LocalGifPack();
    const file = localPack.resolve(
      category as import('../persistence/gif-pack.repository.js').GifCategory,
    );
    if (!file) {
      await ctx.reply(`❌ No GIF found for category "${category}" in assets/gifs/`);
      return;
    }
    await ctx.replyWithAnimation(file, {
      caption: `✅ Test GIF: <b>${category}</b>`,
      parse_mode: 'HTML',
    });
  });

  bot.command('version', async (ctx) => {
    await ctx.reply('werewolf-ts v0.1.0 (migration in progress)');
  });

  bot.command(['start', 'myrole', 'role'], async (ctx) => {
    if (!ctx.from || !ctx.chat || ctx.chat.type !== 'private') return;
    const telegramId = BigInt(ctx.from.id);
    await deps.playerRepository.upsert(telegramId, {
      displayName: `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim(),
      username: ctx.from.username ?? null,
    });
    await deps.playerRepository.markHasStartedPm(telegramId);
    const player = await deps.playerRepository.findByTelegramId(telegramId);
    const lang = player?.languageCode ?? 'en';

    if (ctx.message?.text?.startsWith('/start') && !ctx.message.text.includes('myrole')) {
      await ctx.reply(deps.translator.translate(lang, 'WelcomeMessage'));
    }

    const activeGame = deps.gameManager.findByPlayer(telegramId);
    if (activeGame && activeGame.phase !== 'Joining') {
      const p = activeGame.players.find((x) => x.id === telegramId);
      if (p) {
        const name = roleName(p.role);
        const localized = deps.translator.translate(lang, `Role_${name}`);
        const displayName = localized.startsWith('Role_') ? name : localized;
        const emoji = ROLE_META[name].emoji;
        const rank = getRankForPoints(player?.points ?? 0);
        const rankTitle = deps.translator.translate(lang, rank.titleKey);
        const displayRankTitle = rankTitle.startsWith('Rank_') ? rank.defaultTitle : rankTitle;
        await ctx.reply(
          deps.translator.translate(lang, 'YourRoleIs', `${emoji} ${displayName}`) +
            `\n🏅 <b>${deps.translator.translate(lang, 'YourRankIs')}:</b> ${rank.emoji} ${displayRankTitle} (${player?.points ?? 0} pts)`,
          { parse_mode: 'HTML' },
        );
      }
    }
  });

  bot.command('help', async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    await ctx.reply(deps.translator.translate(player?.languageCode ?? 'en', 'HelpMessage'));
  });

  bot.command('setlang', async (ctx) => {
    if (!ctx.from) return;
    const keyboard = new InlineKeyboard()
      .text('English', 'setlang:en')
      .text('Français', 'setlang:fr');
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    try {
      await ctx.api.sendMessage(ctx.from.id, deps.translator.translate(language, 'SetLangPrompt'), {
        reply_markup: keyboard,
      });
      if (ctx.chat && ctx.chat.type !== 'private') {
        await ctx.reply(deps.translator.translate(language, 'SetLangSentPrivate'));
      }
    } catch (err) {
      if (!(err instanceof GrammyError)) throw err;
    }
  });

  bot.callbackQuery(/^setlang:(en|fr)$/, async (ctx) => {
    if (!ctx.from) return;
    const language = ctx.match[1]!;
    await deps.playerRepository.setLanguage(BigInt(ctx.from.id), language);
    await ctx.answerCallbackQuery({
      text: deps.translator.translate(language, 'SetLangConfirmed', language),
    });
  });

  bot.command('stats', async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();

    const playerStats = await deps.gameRepository.getPlayerStats(BigInt(ctx.from.id));
    const rank = getRankForPoints(player?.points ?? 0);
    const rankTitle = deps.translator.translate(language, rank.titleKey);
    const displayRankTitle = rankTitle.startsWith('Rank_') ? rank.defaultTitle : rankTitle;

    const lines = [
      deps.translator.translate(language, 'StatsHeader'),
      deps.translator.translate(
        language,
        'StatsPlayerLine',
        name,
        playerStats.played,
        playerStats.won,
      ),
      `🏅 <b>${deps.translator.translate(language, 'YourRankIs')}:</b> ${rank.emoji} ${displayRankTitle} (${player?.points ?? 0} pts)`,
    ];

    if (ctx.chat && ctx.chat.type !== 'private') {
      const group = await deps.groupRepository.getOrCreate(
        BigInt(ctx.chat.id),
        ctx.chat.title ?? null,
        null,
      );
      const groupStats = await deps.gameRepository.getGroupStats(group.id);
      lines.push(deps.translator.translate(language, 'StatsGroupLine', groupStats.played));
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command(['leaderboard', 'top', 'classement'], async (ctx) => {
    if (!ctx.from) return;
    const callerId = BigInt(ctx.from.id);
    const caller = await deps.playerRepository.findByTelegramId(callerId);
    const language = caller?.languageCode ?? 'en';

    const topPlayers = await deps.playerRepository.getTopPlayers(10);
    const lines = [deps.translator.translate(language, 'LeaderboardTitle') + '\n'];

    topPlayers.forEach((p, idx) => {
      const pName = (p.displayName ?? p.username ?? 'Player') + donorBadge(p.donationLevel);
      const rank = getRankForPoints(p.points);
      const rankTitle = deps.translator.translate(language, rank.titleKey);
      const displayRankTitle = rankTitle.startsWith('Rank_') ? rank.defaultTitle : rankTitle;
      lines.push(
        `${idx + 1}. <b>${pName}</b> - ${rank.emoji} <i>${displayRankTitle}</i> (${p.points} pts | ${p.gamesWon}🏆/${p.gamesPlayed}🎮)`,
      );
    });

    const userRank = await deps.playerRepository.getPlayerRank(callerId);
    if (userRank && userRank.rank > 10) {
      const callerRank = getRankForPoints(caller?.points ?? 0);
      const callerRankTitle = deps.translator.translate(language, callerRank.titleKey);
      const displayCallerRank = callerRankTitle.startsWith('Rank_')
        ? callerRank.defaultTitle
        : callerRankTitle;
      lines.push(
        `\n📌 <b>Votre Rang :</b> #${userRank.rank} - ${callerRank.emoji} ${displayCallerRank} (${userRank.points} pts)`,
      );
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command(['profile', 'profil'], async (ctx) => {
    if (!ctx.from) return;
    const targetUserId = BigInt(ctx.from.id);
    const player = await deps.playerRepository.findByTelegramId(targetUserId);
    const language = player?.languageCode ?? 'fr';
    const isFr = language === 'fr';

    const playerStats = await deps.gameRepository.getPlayerStats(targetUserId);
    const rank = getRankForPoints(player?.points ?? 0);
    const rankTitle = deps.translator.translate(language, rank.titleKey);
    const displayRankTitle = rankTitle.startsWith('Rank_') ? rank.defaultTitle : rankTitle;

    const equippedTitleObj = player?.equippedTitle ? getTitleById(player.equippedTitle) : null;
    const titleText = equippedTitleObj
      ? `${equippedTitleObj.emoji} ${equippedTitleObj.defaultTitle}`
      : isFr
        ? 'Aucun'
        : 'None';

    const winrate =
      playerStats.played > 0 ? ((playerStats.won / playerStats.played) * 100).toFixed(1) : '0.0';

    const cardLines = [
      `👤 <b>CARTE DE PROFIL — ${ctx.from.first_name.toUpperCase()}</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `🏅 <b>Rang :</b> ${rank.emoji} ${displayRankTitle}`,
      `👑 <b>Titre Équipé :</b> ${titleText}`,
      `⭐ <b>Points de Classement :</b> ${player?.points ?? 0} pts`,
      `🎮 <b>Parties Jouées :</b> ${playerStats.played}`,
      `🏆 <b>Victoires :</b> ${playerStats.won} (${winrate}% winrate)`,
      `💎 <b>Palier Donateur :</b> ${donorBadge(player?.donationLevel ?? 0) || (isFr ? 'Membre' : 'Member')}`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      isFr
        ? `💡 Utilise /titles pour changer ton titre équipé !`
        : `💡 Use /titles to change your equipped title!`,
    ];

    await ctx.reply(cardLines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('gazette', async (ctx) => {
    const chatId = ctx.chat?.id ? ctx.chat.id.toString() : '';
    const gazette = LAST_GAZETTES_BY_CHAT.get(chatId);
    if (!gazette) {
      await ctx.reply(
        '📜 <i>Aucune gazette récente pour ce groupe. Jouez une partie pour éditer la première gazette !</i>',
        { parse_mode: 'HTML' },
      );
      return;
    }
    await ctx.reply(`${gazette.title}\n\n${gazette.lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.command(['titles', 'titres'], async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'fr';
    const isFr = language === 'fr';

    const keyboard = new InlineKeyboard();
    TITLE_CATALOG.forEach((t, i) => {
      const isEquipped = player?.equippedTitle === t.id;
      const btnText = `${isEquipped ? '✅ ' : ''}${t.emoji} ${t.defaultTitle}`;
      keyboard.text(btnText, `settitle:${t.id}`);
      if (i % 2 === 1) keyboard.row();
    });
    keyboard.row().text(isFr ? '❌ Retirer mon titre' : '❌ Unequip Title', 'settitle:none');

    const msg = isFr
      ? `👑 <b>GESTION DES TITRES ÉPIQUES</b>\n\nChoisis le titre que tu souhaites afficher sur ta carte de profil et dans le classement :`
      : `👑 <b>EQUIP YOUR TITLE</b>\n\nChoose the title you wish to display on your profile card and leaderboard:`;

    try {
      await ctx.api.sendMessage(ctx.from.id, msg, { reply_markup: keyboard, parse_mode: 'HTML' });
      if (ctx.chat && ctx.chat.type !== 'private') {
        await ctx.reply(
          isFr
            ? 'Regarde tes messages privés pour gérer tes titres !'
            : 'Check your private messages to manage your titles!',
        );
      }
    } catch {
      await ctx.reply(
        isFr
          ? "Démarre d'abord une conversation avec moi en MP pour gérer tes titres !"
          : 'Start a PM with me first to manage your titles!',
      );
    }
  });

  bot.callbackQuery(/^settitle:(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    callbacksProcessed.labels('settitle').inc();
    const titleId = ctx.match[1]!;
    const newTitle = titleId === 'none' ? null : titleId;
    await deps.playerRepository.setEquippedTitle(BigInt(ctx.from.id), newTitle);

    const titleObj = newTitle ? getTitleById(newTitle) : null;
    const text = titleObj
      ? `Titre équipé : ${titleObj.emoji} ${titleObj.defaultTitle} !`
      : 'Titre retiré.';
    await ctx.answerCallbackQuery({ text });
    await ctx.editMessageText(
      `✅ <b>${text}</b>\n\nUtilise /profile pour admirer ta nouvelle carte de profil !`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command('tagall', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    const callerId = BigInt(ctx.from?.id ?? 0);
    const group = await deps.groupRepository.findByTelegramId(BigInt(ctx.chat.id));
    const language = group?.language ?? 'fr';

    try {
      const member = await ctx.api.getChatMember(ctx.chat.id, Number(callerId));
      const isAdmin = member.status === 'administrator' || member.status === 'creator';
      if (!isAdmin) {
        await ctx.reply(
          language === 'fr'
            ? 'Seuls les administrateurs du groupe peuvent utiliser /tagall.'
            : 'Only group administrators can use /tagall.',
        );
        return;
      }
      await lobby.tagAllMembers(BigInt(ctx.chat.id), language);
    } catch {
      await lobby.tagAllMembers(BigInt(ctx.chat.id), language);
    }
  });

  bot.command('claim', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    const chatId = ctx.chat ? BigInt(ctx.chat.id) : 0n;

    let game = chatId !== 0n ? gameLoop.getGame(chatId) : undefined;
    if (!game) {
      game = deps.gameManager.findByPlayer(userId);
    }

    const isFr = ctx.from.language_code === 'fr';

    if (!game || game.phase === 'Ended' || game.phase === 'Joining') {
      await ctx.reply(
        isFr ? "Il n'y a pas de partie active en cours." : 'There is no active game currently.',
      );
      return;
    }

    const player = game.players.find((p) => p.id === userId);
    if (!player || player.isDead) {
      await ctx.reply(
        isFr
          ? 'Seuls les joueurs vivants de la partie peuvent effectuer un claim.'
          : 'Only living players in the game can claim a role.',
      );
      return;
    }

    const text = (ctx.message?.text ?? '').split(' ').slice(1).join(' ').trim();
    if (!text) {
      await ctx.reply(
        isFr
          ? 'Usage : /claim <rôle> (ex: /claim Voyante, /claim Villageois)'
          : 'Usage: /claim <role> (e.g. /claim Seer, /claim Villager)',
      );
      return;
    }

    const claimedRole = text.charAt(0).toUpperCase() + text.slice(1);
    game.claimsMap.set(userId, claimedRole);

    const announcement = isFr
      ? `📢 <b>CLAIM :</b> <a href="tg://user?id=${userId}">${player.name}</a> affirme être <b>${claimedRole}</b> !`
      : `📢 <b>CLAIM:</b> <a href="tg://user?id=${userId}">${player.name}</a> claims to be <b>${claimedRole}</b>!`;

    await ctx.api.sendMessage(Number(game.chatId), announcement, { parse_mode: 'HTML' });
  });

  bot.command('claims', async (ctx) => {
    if (!ctx.chat) return;
    const chatId = BigInt(ctx.chat.id);
    const game =
      gameLoop.getGame(chatId) ??
      (ctx.from ? deps.gameManager.findByPlayer(BigInt(ctx.from.id)) : undefined);

    if (!game || game.phase === 'Ended' || game.phase === 'Joining') {
      await ctx.reply("Il n'y a pas de partie en cours dans ce groupe.");
      return;
    }

    const lines: string[] = [];
    for (const p of game.players) {
      const claim = game.claimsMap.get(p.id);
      const status = p.isDead ? '💀 mort' : '🙂 en vie';
      if (claim) {
        lines.push(`• <b>${p.name}</b> (${status}) : <b>${claim}</b>`);
      } else {
        lines.push(`• <b>${p.name}</b> (${status}) : <i>(Aucun claim)</i>`);
      }
    }

    const title = '📜 <b>RELEVÉ DES CLAIMS DE LA PARTIE :</b>\n\n';
    await ctx.reply(title + lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('report', async (ctx) => {
    if (!ctx.from) return;
    const reporterId = BigInt(ctx.from.id);
    const reporter = await deps.playerRepository.findByTelegramId(reporterId);
    const language = reporter?.languageCode ?? 'en';

    let reportedId: bigint | null = null;
    let reportedName = 'Player';
    let reason = '';

    if (ctx.message?.reply_to_message?.from) {
      reportedId = BigInt(ctx.message.reply_to_message.from.id);
      reportedName = ctx.message.reply_to_message.from.first_name;
      const parts = (ctx.message.text ?? '').split(' ').slice(1);
      reason = parts.join(' ').trim();
    } else {
      const parts = (ctx.message?.text ?? '').split(' ').slice(1);
      if (parts.length >= 2) {
        const targetStr = parts[0]!;
        reason = parts.slice(1).join(' ').trim();

        if (targetStr.startsWith('@')) {
          const username = targetStr.slice(1);
          const targetPlayer = await deps.playerRepository.findByUsername(username);
          if (targetPlayer) {
            reportedId = targetPlayer.telegramId;
            reportedName = targetPlayer.displayName ?? username;
          }
        } else if (/^\d+$/.test(targetStr)) {
          reportedId = BigInt(targetStr);
          const targetPlayer = await deps.playerRepository.findByTelegramId(reportedId);
          if (targetPlayer) reportedName = targetPlayer.displayName ?? targetStr;
        }
      }
    }

    if (!reportedId || !reason) {
      await ctx.reply(deps.translator.translate(language, 'ReportUsage'));
      return;
    }

    if (reporterId === reportedId) {
      await ctx.reply(deps.translator.translate(language, 'ReportCannotReportSelf'));
      return;
    }

    const groupId = ctx.chat?.type !== 'private' ? BigInt(ctx.chat.id) : null;
    playerReports.inc();
    await deps.reportRepository?.createReport({
      reporterId,
      reportedId,
      groupId,
      reason,
    });

    const adminIds = await deps.adminRepository.listGlobalAdminIds();
    const reporterName = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
    const alertMsg = deps.translator.translate(
      'en',
      'ReportAdminNotification',
      reporterName,
      reporterId.toString(),
      reportedName,
      reportedId.toString(),
      reason,
    );

    for (const adminId of adminIds) {
      try {
        await ctx.api.sendMessage(Number(adminId), alertMsg, { parse_mode: 'HTML' });
      } catch {
        // Ignore if admin hasn't started PM
      }
    }

    await ctx.reply(deps.translator.translate(language, 'ReportReceived', reportedName));
  });

  bot.command('accuse', async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.match?.trim();
    if (!text) {
      await ctx.reply(
        "🎭 Usage : /accuse @joueur [motif] (ex: /accuse @Gautier Il a l'air louche)",
      );
      return;
    }

    const parts = text.split(' ');
    const accused = parts[0]!;
    const motive = parts.slice(1).join(' ').trim() || undefined;
    const accuser = ctx.from.first_name;

    const templates = [
      `🎭 <b>TIRADE D'ACCUSATION SPECTACULAIRE !</b> 📜\n\n<i>${accuser} pointe un doigt accusateur et tremblant vers <b>${accused}</b> !</i>\n\n💬 « Regardez-le ! Ses mains tremblent comme les feuilles d'un saule pleureur ! ${motive ? `Il affirme que "${motive}", mais ` : ''}Hier soir, je l'ai vu rôder près de la porcherie... <b>${accused} est un Loup-Garou, c'est une certitude !</b> » 🐺🔥`,
      `🏛️ <b>DISCOURS DE LA POTENCE !</b> ⚖️\n\n<i>${accuser} monte sur une caisse en bois et harangue la foule au sujet de <b>${accused}</b> !</i>\n\n💬 « Oyez, oyez, braves habitants ! ${accused} tente de nous amadouer${motive ? ` en prétextant : "${motive}"` : ''}, mais les ombres ne mentent pas ! Son silence est bien trop suspect pour être innocent ! Aux armes, Village ! » ⚔️🩸`,
      `🔥 <b>L'INQUISITION DU VILLAGE A PARLÉ !</b> 🔍\n\n<i>${accuser} jette une poignée de sel rituel aux pieds de <b>${accused}</b> !</i>\n\n💬 « Arrière, démon ! ${motive ? `Tu dis que "${motive}" ? Tes mensonges` : 'Tes grognements nocturnes'} ne tromperont personne ! Le feu de la vérité brûlera ton déguisement de loup ! » 🐺✨`,
      `🌾 <b>RUMEUR ET TRAHISON À THIERCELIEUX !</b> 📢\n\n<i>${accuser} murmure théâtralement aux oreilles des villageois en observant <b>${accused}</b>...</i>\n\n💬 « Avez-vous vu le sang sous ses ongles ? ${motive ? `Il prétend "${motive}", mais ` : ''}Je mettrais ma tête à couper que ${accused} a croqué un pauvre villageois cette nuit ! » 🩸🍖`,
    ];

    const randomIndex = Math.floor(Math.random() * templates.length);
    const msg = templates[randomIndex]!;

    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  bot.command('reports', async (ctx) => {
    if (!ctx.from) return;
    if (!(await deps.adminRepository.isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const pending = await deps.reportRepository?.getPendingReports(10);
    if (!pending || pending.length === 0) {
      await ctx.reply('No pending reports.');
      return;
    }

    const lines = ['⚠️ <b>Pending Player Reports:</b>\n'];
    for (const r of pending) {
      const reporter = r.reporter?.displayName ?? r.reporterId.toString();
      const reported = r.reported?.displayName ?? r.reportedId.toString();
      lines.push(`• <b>#${r.id}</b>: ${reporter} ➡️ ${reported} - <i>${r.reason}</i>`);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  const START_COMMAND_MODE_MAP: Record<string, GameMode> = {
    startgame: 'Normal',
    startnormal: 'Normal',
    startchaos: 'Chaos',
    startbloodbath: 'Bloodbath',
    startdarkmagic: 'DarkMagic',
    startwolfpack: 'WolfPack',
    startcursed: 'CursedVillage',
    startinfection: 'Infection',
    startanarchy: 'Anarchy',
    startholywar: 'HolyWar',
    startassassins: 'Assassins',
  };

  bot.command(
    [
      'startgame',
      'startnormal',
      'startchaos',
      'startbloodbath',
      'startdarkmagic',
      'startwolfpack',
      'startcursed',
      'startinfection',
      'startanarchy',
      'startholywar',
      'startassassins',
    ],
    async (ctx) => {
      if (!ctx.chat || !ctx.from) return;
      if (ctx.chat.type === 'private') {
        const lang = ctx.from.language_code === 'fr' ? 'fr' : 'en';
        const msg =
          lang === 'fr'
            ? "⚠️ <b>Partie en Groupe Nécessaire</b>\n\nLes parties de Loup-Garou se jouent dans un <b>groupe Telegram</b> !\n1. Ajoutez le bot à votre groupe.\n2. Donnez-lui la permission d'envoyer des messages (ou mettez-le administrateur).\n3. Tapez <code>/startgame</code> (ou <code>/botgame</code> pour jouer avec des IA) dans le groupe !"
            : '⚠️ <b>Group Play Required</b>\n\nWerewolf games must be played inside a <b>Telegram Group</b>!\n1. Add the bot to your Telegram group.\n2. Ensure the bot can send messages.\n3. Type <code>/startgame</code> (or <code>/botgame</code> for AI bots) in the group!';
        await ctx.reply(msg, { parse_mode: 'HTML' });
        return;
      }
      if (maintenance.on) {
        await ctx.reply(
          'Sorry, we are about to start maintenance.  Please check @greywolfdev for more information.',
        );
        return;
      }
      const cmdText =
        ctx.message?.text?.split(' ')[0]?.replace('/', '').split('@')[0]?.toLowerCase() ??
        'startgame';
      const mode: GameMode = START_COMMAND_MODE_MAP[cmdText] ?? 'Normal';
      const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
      await lobby.startGame(
        BigInt(ctx.chat.id),
        ctx.chat.title ?? null,
        { id: BigInt(ctx.from.id), name },
        mode,
      );
    },
  );

  bot.command('join', async (ctx) => {
    if (!ctx.from) return;
    if (!ctx.chat || ctx.chat.type === 'private') {
      const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
      await ctx.reply(deps.translator.translate(player?.languageCode ?? 'en', 'JoinFromGroup'));
      return;
    }
    await lobby.join(BigInt(ctx.chat.id), {
      id: BigInt(ctx.from.id),
      firstName: ctx.from.first_name,
      ...(ctx.from.last_name !== undefined ? { lastName: ctx.from.last_name } : {}),
      ...(ctx.from.username !== undefined ? { username: ctx.from.username } : {}),
    });
  });

  bot.callbackQuery(lobby.joinButtonCallbackData, async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    await ctx.answerCallbackQuery();
    await lobby.join(BigInt(ctx.chat.id), {
      id: BigInt(ctx.from.id),
      firstName: ctx.from.first_name,
      ...(ctx.from.last_name !== undefined ? { lastName: ctx.from.last_name } : {}),
      ...(ctx.from.username !== undefined ? { username: ctx.from.username } : {}),
    });
  });

  bot.command('config', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdminOrAnonymous(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const screen = await configMenu.open(BigInt(ctx.chat.id));
    try {
      await ctx.api.sendMessage(ctx.from.id, screen.text, { reply_markup: screen.keyboard });
      await ctx.reply(deps.translator.translate(group.language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(group.language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });

  bot.callbackQuery(/^cfg:(-?\d+):(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const groupTelegramId = BigInt(ctx.match[1]!);
    const [action, ...rest] = ctx.match[2]!.split(':');

    const member = await ctx.api
      .getChatMember(Number(groupTelegramId), ctx.from.id)
      .catch(() => null);
    const isAdmin = member?.status === 'creator' || member?.status === 'administrator';
    if (!isAdmin) {
      await ctx.answerCallbackQuery();
      return;
    }

    const screen = await configMenu.handleAction(groupTelegramId, action!, rest);
    if (screen) await ctx.editMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery();
  });

  // Every night/day/lynch menu button (see game-loop.ts) - registered after the join button so
  // that more specific handler only intercepts its own exact callback data, and this one gets
  // everything else.
  bot.on('callback_query:data', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const text = await gameLoop.handleCallback(
      BigInt(ctx.from.id),
      BigInt(ctx.chat.id),
      ctx.callbackQuery.data,
    );
    await ctx.answerCallbackQuery({ text: text ?? '✅ Choix enregistré !' }).catch(() => null);
    if (text) {
      if (ctx.chat.type === 'private') {
        await ctx.editMessageText(`✅ <b>${text}</b>`, { parse_mode: 'HTML' }).catch(async () => {
          await ctx.editMessageReplyMarkup(undefined).catch(() => null);
        });
      } else {
        await ctx.editMessageReplyMarkup(undefined).catch(() => null);
      }
    }
  });

  bot.command('forcestart', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const isAdmin = await isGroupAdminOrAnonymous(ctx);
    await lobby.forceStart(BigInt(ctx.chat.id), isAdmin);
  });

  bot.command('players', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    await lobby.showPlayers(BigInt(ctx.chat.id));
  });

  bot.command('flee', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
    await lobby.flee(BigInt(ctx.chat.id), { id: BigInt(ctx.from.id), name });
  });

  bot.command(['addbots', 'addbot'], async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    const count = parseInt((ctx.match as string | undefined) ?? '', 10) || 4;
    const added = await lobby.addBotPlayers(BigInt(ctx.chat.id), count);
    if (added > 0) {
      await ctx.reply(`🤖 <b>${added} joueur(s) IA</b> ont été ajouté(s) à la partie !`, {
        parse_mode: 'HTML',
      });
    } else {
      await ctx.reply(
        `⚠️ Lance d'abord une partie avec /startgame pour pouvoir ajouter des bots !`,
      );
    }
  });

  bot.command('botgame', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const name = `${ctx.from.first_name} ${ctx.from.last_name ?? ''}`.trim();
    await lobby.startGame(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      { id: BigInt(ctx.from.id), name },
      'Normal',
    );
    const added = await lobby.addBotPlayers(BigInt(ctx.chat.id), 5);
    await ctx.reply(`🎮 <b>Partie IA démarrée avec toi + ${added} joueurs virtuels (IA) !</b>`, {
      parse_mode: 'HTML',
    });
    await lobby.forceStart(BigInt(ctx.chat.id), true);
  });

  bot.command('extend', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const isAdmin = await isGroupAdminOrAnonymous(ctx);
    const parsed = parseInt((ctx.match as string | undefined) ?? '', 10);
    const seconds = Number.isFinite(parsed) ? parsed : 30;

    if (seconds < 0 && !isAdmin) {
      const group = await deps.groupRepository.getOrCreate(
        BigInt(ctx.chat.id),
        ctx.chat.title ?? null,
        null,
      );
      await ctx.reply(deps.translator.translate(group.language, 'GroupAdminOnly'));
      return;
    }

    await lobby.extend(BigInt(ctx.chat.id), BigInt(ctx.from.id), isAdmin, seconds);
  });

  registerModerationCommands(bot, env, deps, lobby, gameLoop);
  registerRoleInfoCommands(bot, deps);
  registerAchievementCommands(bot, env, deps);
  registerUtilityCommands(bot, deps);
  registerDevCommands(bot, env, logger, deps, gameLoop, deps.gameManager, maintenance, startTime);
  registerGifCommands(bot, env, deps);
  registerDonationCommands(bot, env, deps);

  return bot;
}

/**
 * Port of `GeneralCommands.cs`'s `/nextgame` and `GameCommands.cs`'s `/stopwaiting`: a player
 * asks to be PM'd once a new game starts in a group that currently has none running (`GameLoop`/
 * `GameLobbyManager` deliver the actual notification and cleanup - see `notifyWaitingPlayers`).
 */
function registerWaitlistCommands(bot: Bot, deps: BotDependencies): void {
  bot.command(['nextgame', 'next', 'waitlist'], async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const keyboard = new InlineKeyboard().text(
      deps.translator.translate(group.language, 'Cancel'),
      `stopwaiting:${ctx.chat.id}`,
    );

    const added = await deps.notifyGameRepository.add(BigInt(ctx.from.id), BigInt(ctx.chat.id));
    const key = added ? 'AddedToWaitList' : 'AlreadyOnWaitList';
    try {
      await ctx.api.sendMessage(
        ctx.from.id,
        deps.translator.translate(group.language, key, group.title ?? ''),
        {
          reply_markup: keyboard,
        },
      );
    } catch (err) {
      if (!(err instanceof GrammyError)) throw err;
    }
  });

  bot.command('stopwaiting', async (ctx) => {
    if (!ctx.from) return;
    const language =
      (await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id)))?.languageCode ?? 'en';

    let groupId: bigint | null = null;
    let groupTitle = '';
    if (ctx.chat && ctx.chat.type !== 'private') {
      groupId = BigInt(ctx.chat.id);
      groupTitle = ctx.chat.title ?? '';
    } else {
      const arg = (ctx.match as string | undefined)?.trim();
      const group = arg?.startsWith('@')
        ? await deps.groupRepository.findByUsername(arg.slice(1))
        : arg && /^-?\d+$/.test(arg)
          ? await deps.groupRepository.findByTelegramId(BigInt(arg))
          : null;
      if (group) {
        groupId = group.telegramId;
        groupTitle = group.title ?? '';
      }
    }

    if (groupId === null) {
      await ctx.reply(deps.translator.translate(language, 'GroupNotFound'));
      return;
    }

    await deps.notifyGameRepository.remove(BigInt(ctx.from.id), groupId);
    await ctx.api.sendMessage(
      ctx.from.id,
      deps.translator.translate(language, 'DeletedFromWaitList', groupTitle),
    );
  });

  bot.callbackQuery(/^stopwaiting:(-?\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const groupId = BigInt(ctx.match[1]!);
    const group = await deps.groupRepository.findByTelegramId(groupId);
    const language = group?.language ?? 'en';

    await deps.notifyGameRepository.remove(BigInt(ctx.from.id), groupId);
    await ctx.answerCallbackQuery({
      text: deps.translator.translate(language, 'DeletedFromWaitList', group?.title ?? ''),
    });
  });
}

/** `/rolelist` (an index of every `/about<trigger>` command) and the `/about<trigger>` commands themselves. */
function registerRoleInfoCommands(bot: Bot, deps: BotDependencies): void {
  bot.command('rolelist', async (ctx) => {
    if (!ctx.from) return;
    const isGroup = ctx.chat && ctx.chat.type !== 'private';
    const group = isGroup
      ? await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null)
      : null;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = group?.language ?? player?.languageCode ?? 'en';
    const lines = Object.entries(ABOUT_ROLE_BY_TRIGGER).map(
      ([trigger, role]) => `/about${trigger} - ${ROLE_META[role].emoji} ${role}`,
    );
    try {
      await ctx.api.sendMessage(ctx.from.id, lines.join('\n'));
      if (isGroup) await ctx.reply(deps.translator.translate(language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });

  const roleCommandNames = Object.keys(ABOUT_ROLE_BY_TRIGGER).flatMap((t) => [
    t,
    `about${t}`,
    ABOUT_ROLE_BY_TRIGGER[t]!.toLowerCase(),
    `about${ABOUT_ROLE_BY_TRIGGER[t]!.toLowerCase()}`,
  ]);

  bot.command(roleCommandNames, async (ctx) => {
    if (!ctx.from || !ctx.message?.text) return;
    const commandText = ctx.message.text.slice(1).split(/[ @]/)[0]!;
    const role = resolveRoleFromTrigger(commandText);
    if (!role) return;

    const isGroup = ctx.chat && ctx.chat.type !== 'private';
    const group = isGroup
      ? await deps.groupRepository.getOrCreate(BigInt(ctx.chat.id), ctx.chat.title ?? null, null)
      : null;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = group?.language ?? player?.languageCode ?? 'en';
    try {
      await ctx.api.sendMessage(
        ctx.from.id,
        deps.translator.translate(language, aboutLocaleKey(role)),
      );
      if (isGroup) await ctx.reply(deps.translator.translate(language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });
}

/**
 * Port of `AdminCommands.cs`/`DevCommands.cs`'s moderation surface: `/smite` (group-admin,
 * removes a disruptive player from the running game), `/permban`/`/remban`/`/getbans`/`/getban`
 * (global-admin, the cross-group `GlobalBan` blocklist), and `/setlink`/`/remlink` (group-admin,
 * the group's invite link shown by `/players` etc.). Deliberately not ported: the gif-pack
 * review/approval commands and the multi-node `/updatestatus` (both out of scope - see README).
 */
function registerModerationCommands(
  bot: Bot,
  env: Env,
  deps: BotDependencies,
  lobby: GameLobbyManager,
  gameLoop: GameLoop,
): void {
  async function isGroupAdmin(ctx: Context): Promise<boolean> {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    return isGroupAdminOrAnonymous(ctx);
  }
  const isGlobalAdmin = (telegramId: bigint) => isGlobalAdminCheck(env, deps, telegramId);

  bot.command('smite', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    if (targets.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }
    for (const target of targets) {
      await lobby.smite(BigInt(ctx.chat.id), target);
    }
  });

  bot.command('setlink', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    if (ctx.chat.username) {
      await ctx.reply(
        deps.translator.translate(group.language, 'SetLinkAlreadySet', ctx.chat.username),
      );
      return;
    }

    const link = (ctx.match as string | undefined)?.trim();
    if (!link) {
      await ctx.reply(deps.translator.translate(group.language, 'SetLinkMissingArg'));
      return;
    }
    if (!INVITE_LINK_PATTERN.test(link)) {
      await ctx.reply(deps.translator.translate(group.language, 'SetLinkInvalid'));
      return;
    }

    await deps.groupRepository.updateConfig(BigInt(ctx.chat.id), { inviteLink: link });
    await ctx.reply(deps.translator.translate(group.language, 'SetLinkConfirmed', link));
  });

  bot.command('remlink', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    await deps.groupRepository.updateConfig(BigInt(ctx.chat.id), { inviteLink: null });
    await ctx.reply(deps.translator.translate(group.language, 'RemLinkConfirmed'));
  });

  bot.command('getidles', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdmin(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const ids = new Set<bigint>(numericIdTargets(ctx.match as string | undefined));
    for (const entity of ctx.message?.entities ?? []) {
      if (entity.type === 'text_mention' && entity.user) ids.add(BigInt(entity.user.id));
    }
    const reply = replyTarget(ctx);
    if (reply) ids.add(reply.id);

    if (ids.size === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    const lines: string[] = [];
    for (const id of ids) {
      const [overall, inGroup] = await Promise.all([
        deps.gameRepository.getIdleKills24Hours(id),
        deps.gameRepository.getIdleKills24Hours(id, group.id),
      ]);
      lines.push(deps.translator.translate(group.language, 'IdleCount', id.toString(), overall));
      lines.push(deps.translator.translate(group.language, 'GroupIdleCount', inGroup));
    }
    await ctx.reply(lines.join('\n'));
  });

  bot.command('permban', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }
    const reason = nonNumericWords(ctx.match as string | undefined) || 'No reason given';

    if (targets.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    for (const target of targets) {
      await deps.adminRepository.ban(target.id, reason, BigInt(ctx.from.id));
      bansApplied.inc();
      await lobby.smite(BigInt(ctx.chat.id), target);
      await ctx.reply(deps.translator.translate(group.language, 'BanConfirmed', target.name));
    }
  });

  bot.command('remban', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);

    if (targets.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    for (const target of targets) {
      const unbanned = await deps.adminRepository.unban(target.id);
      const key = unbanned ? 'UnbanConfirmed' : 'UnbanNotFound';
      await ctx.reply(deps.translator.translate(group.language, key, target.name));
    }
  });

  bot.command('killgame', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const killed = gameLoop.killGame(BigInt(ctx.chat.id));
    await ctx.reply(
      deps.translator.translate(group.language, killed ? 'GameKilledMsg' : 'NoGameRunning'),
    );
  });

  bot.command('getbans', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const bans = await deps.adminRepository.listActiveBans();
    if (bans.length === 0) {
      await ctx.reply(deps.translator.translate(group.language, 'GetBansEmpty'));
      return;
    }

    // Mirrors the original's three-section /getbans layout: spam bans (temporary, in-memory list)
    // separate from global bans, themselves split into expiring-soonest-first vs permanent.
    const line = (ban: (typeof bans)[number]) =>
      deps.translator.translate(
        group.language,
        'GetBansLine',
        ban.playerName ?? ban.telegramId.toString(),
        ban.telegramId.toString(),
        ban.reason,
      );

    const spam = bans.filter((b) => b.scope === 'SPAM');
    const manual = bans.filter((b) => b.scope !== 'SPAM');
    const expiring = manual
      .filter((b) => b.expiresAt !== null)
      .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime());
    const permanent = manual.filter((b) => b.expiresAt === null);

    const lines = [deps.translator.translate(group.language, 'GetBansHeader')];
    if (spam.length > 0) {
      lines.push('', deps.translator.translate(group.language, 'GetBansSpamHeader'));
      for (const ban of spam) lines.push(line(ban));
    }
    if (expiring.length > 0) {
      lines.push('', deps.translator.translate(group.language, 'GetBansExpiringHeader'));
      for (const ban of expiring) lines.push(line(ban));
    }
    if (permanent.length > 0) {
      lines.push('', deps.translator.translate(group.language, 'GetBansPermanentHeader'));
      for (const ban of permanent) lines.push(line(ban));
    }
    await ctx.reply(lines.join('\n'));
  });

  bot.command('getban', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);
    const target = targets[0];
    if (!target) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    const ban = await deps.adminRepository.getBan(target.id);
    if (!ban) {
      await ctx.reply(deps.translator.translate(group.language, 'GetBanNotBanned', target.name));
      return;
    }
    const expires = ban.expiresAt
      ? ban.expiresAt.toISOString()
      : deps.translator.translate(group.language, 'GetBanPermanent');
    const firstSeen = ban.firstSeen
      ? ban.firstSeen.toISOString()
      : deps.translator.translate(group.language, 'GetBanUnknown');
    await ctx.reply(
      deps.translator.translate(
        group.language,
        'GetBanStatus',
        target.name,
        ban.reason,
        ban.bannedBy?.toString() ?? '?',
        expires,
        firstSeen,
      ),
    );
  });

  bot.command('user', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isGlobalAdmin(BigInt(ctx.from.id)))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    for (const id of numericIdTargets(ctx.match as string | undefined)) {
      targets.push({ id, name: id.toString() });
    }
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);
    const target = targets[0];
    if (!target) {
      await ctx.reply(deps.translator.translate(group.language, 'ModTargetMissing'));
      return;
    }

    const player = await deps.playerRepository.findByTelegramId(target.id);
    if (!player) {
      await ctx.reply(deps.translator.translate(group.language, 'UserNotFound'));
      return;
    }

    const { played, won } = await deps.gameRepository.getPlayerStats(target.id);
    const ban = await deps.adminRepository.getBan(target.id);
    const banStatus = ban
      ? deps.translator.translate(
          group.language,
          'UserProfileBanned',
          ban.reason,
          ban.expiresAt
            ? ban.expiresAt.toISOString()
            : deps.translator.translate(group.language, 'GetBanPermanent'),
        )
      : deps.translator.translate(group.language, 'UserProfileNotBanned');

    await ctx.reply(
      deps.translator.translate(
        group.language,
        'UserProfile',
        player.displayName ?? target.name,
        player.username ?? '-',
        player.languageCode ?? '-',
        `${played} (won: ${won})`,
        player.donationLevel.toString(),
        player.createdAt.toISOString(),
        player.tempBanCount.toString(),
        banStatus,
      ),
    );
  });
}

async function isGlobalAdminCheck(
  env: Env,
  deps: BotDependencies,
  telegramId: bigint,
): Promise<boolean> {
  if (env.devUserIds.includes(telegramId)) return true;
  return deps.adminRepository.isGlobalAdmin(telegramId);
}

/**
 * `/achv` (list your own unlocked achievements) and the `DevOnly` `/addach`/`/remach` overrides.
 * The original's own `/achv` was a disabled stub that just said "Please use /stats" - achievements
 * were only ever browsable on the companion website, which is out of scope for this migration
 * (see README). Since the website isn't coming, `/achv` is a real, working command here instead -
 * otherwise the whole achievement system would be invisible to players beyond the unlock PM.
 */
function registerAchievementCommands(bot: Bot, env: Env, deps: BotDependencies): void {
  bot.command('achv', async (ctx) => {
    if (!ctx.from) return;
    const language =
      (await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id)))?.languageCode ?? 'en';
    const unlocked = await deps.achievementRepository.listForPlayer(BigInt(ctx.from.id));

    if (unlocked.length === 0) {
      await ctx.reply(deps.translator.translate(language, 'AchvEmpty'));
      return;
    }

    const lines = [
      deps.translator.translate(language, 'AchvHeader', unlocked.length, ACHIEVEMENT_CODES.length),
    ];
    for (const a of unlocked)
      lines.push(deps.translator.translate(language, 'AchvLine', a.name, a.description));

    try {
      await ctx.api.sendMessage(ctx.from.id, lines.join('\n'));
      if (ctx.chat && ctx.chat.type !== 'private')
        await ctx.reply(deps.translator.translate(language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });

  bot.command(['addach', 'remach'], async (ctx) => {
    if (!ctx.from) return;
    if (!(await isGlobalAdminCheck(env, deps, BigInt(ctx.from.id)))) return;
    const isAdd = ctx.message?.text?.startsWith('/addach') ?? true;

    const language =
      (await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id)))?.languageCode ?? 'en';
    const words = ((ctx.match as string | undefined) ?? '').trim().split(/\s+/).filter(Boolean);
    const codeWord = words[words.length - 1] ?? '';
    const idArgText = words.slice(0, -1).join(' ');

    const targets = await resolveEntityTargets(ctx, deps.playerRepository);
    const reply = replyTarget(ctx);
    if (reply) targets.push(reply);
    for (const id of numericIdTargets(idArgText)) targets.push({ id, name: id.toString() });
    const target = targets[0];
    if (!target) {
      await ctx.reply(deps.translator.translate(language, 'ModTargetMissing'));
      return;
    }

    const code = ACHIEVEMENT_CODES.find((c) => c.toLowerCase() === codeWord.toLowerCase());
    if (!code) {
      await ctx.reply(deps.translator.translate(language, 'AchUnknownCode', codeWord || '?'));
      return;
    }

    if (isAdd) {
      const added = await deps.achievementRepository.unlock(target.id, code);
      const key = added ? 'AchAdded' : 'AchAlreadyHad';
      await ctx.reply(
        deps.translator.translate(language, key, ACHIEVEMENTS[code].name, target.name),
      );
    } else {
      const removed = await deps.achievementRepository.remove(target.id, code);
      const key = removed ? 'AchRemoved' : 'AchDidntHave';
      await ctx.reply(
        deps.translator.translate(language, key, ACHIEVEMENTS[code].name, target.name),
      );
    }
  });
}

/** `/chatid` and `/myidles` - self-service utility commands any player can run, no admin check. */
function registerUtilityCommands(bot: Bot, deps: BotDependencies): void {
  bot.command('chatid', async (ctx) => {
    if (!ctx.chat) return;
    await ctx.reply(ctx.chat.id.toString());
  });

  bot.command('myidles', async (ctx) => {
    if (!ctx.from) return;
    const isGroup = ctx.chat != null && ctx.chat.type !== 'private';
    const group = isGroup
      ? await deps.groupRepository.getOrCreate(BigInt(ctx.chat!.id), ctx.chat!.title ?? null, null)
      : null;
    const language =
      group?.language ??
      (await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id)))?.languageCode ??
      'en';

    const [overall, inGroup] = await Promise.all([
      deps.gameRepository.getIdleKills24Hours(BigInt(ctx.from.id)),
      group
        ? deps.gameRepository.getIdleKills24Hours(BigInt(ctx.from.id), group.id)
        : Promise.resolve(0),
    ]);

    let reply = deps.translator.translate(language, 'IdleCount', ctx.from.id.toString(), overall);
    if (group) reply += ' ' + deps.translator.translate(language, 'GroupIdleCount', inGroup);

    try {
      await ctx.api.sendMessage(ctx.from.id, reply);
      if (isGroup) await ctx.reply(deps.translator.translate(language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Port of `DevCommands.cs`'s remaining dev-only surface, minus everything that's about the
 * original's multi-node/multi-process topology (`/stopnode`, `/killnode`, `/replacenodes`,
 * `/broadcast`'s per-node loop, `/sql` - see README for why `/sql` in particular is skipped) or
 * the companion website (`/checkgroups`). Like the original's dev commands, these reply with raw
 * (untranslated) English - they're operator tooling, not player-facing.
 */
function registerDevCommands(
  bot: Bot,
  env: Env,
  logger: Logger,
  deps: BotDependencies,
  gameLoop: GameLoop,
  gameManager: GameManager,
  maintenance: { on: boolean },
  startTime: Date,
): void {
  const isDev = (telegramId: bigint) => env.devUserIds.includes(telegramId);

  bot.command('leavegroup', async (ctx) => {
    if (!ctx.from) return;
    if (!(await isGlobalAdminCheck(env, deps, BigInt(ctx.from.id)))) return;

    const arg = (ctx.match as string | undefined)?.trim();
    if (!arg) {
      await ctx.reply('Use /leavegroup <id|link|username>');
      return;
    }
    const group = await resolveGroupArg(deps.groupRepository, arg);
    if (!group) {
      await ctx.reply("Couldn't find the group. Is the id/link valid?");
      return;
    }

    try {
      await ctx.api.sendMessage(
        Number(group.telegramId),
        "Para said I can't play with you guys anymore, you are a bad influence! *runs out the door*",
      );
      await ctx.api.leaveChat(Number(group.telegramId));
    } catch (err) {
      await ctx.reply(`An error occurred.\n${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    await ctx.reply(`Bot successfully left from group${group.title ? ` ${group.title}.` : '.'}`);
  });

  bot.command('bangroup', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;

    const arg = (ctx.match as string | undefined)?.trim();
    if (!arg) {
      await ctx.reply('Use /bangroup <id|link|username>');
      return;
    }
    const group = await resolveGroupArg(deps.groupRepository, arg);
    if (!group) {
      await ctx.reply("Couldn't find the group. Is the id/link valid?");
      return;
    }

    await deps.groupRepository.updateConfig(group.telegramId, { banned: true });
    try {
      await ctx.api.leaveChat(Number(group.telegramId));
    } catch (err) {
      logger.warn(
        { err, chatId: group.telegramId.toString() },
        'Failed to leave a group just banned via /bangroup',
      );
    }
    await ctx.reply(
      `Group${group.title ? ` ${group.title}` : ''} banned - the bot will refuse to play there and leave on sight.`,
    );
  });

  bot.command('getroles', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const arg = (ctx.match as string | undefined)?.trim();
    const group = arg ? await resolveGroupArg(deps.groupRepository, arg) : null;
    const game = group ? gameManager.get(group.telegramId) : undefined;
    if (!game) {
      await ctx.reply('No active game found for that group.');
      return;
    }
    await ctx.reply(game.players.map((p) => `${p.name}: ${roleName(p.role)}`).join('\n'));
  });

  bot.command('skipvote', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!isDev(BigInt(ctx.from.id))) return;
    const skipped = gameLoop.skipVote(BigInt(ctx.chat.id));
    await ctx.reply(
      skipped
        ? 'Skipping current phase timer...'
        : 'No phase is currently waiting on a timer here.',
    );
  });

  bot.command('whois', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const arg = (ctx.match as string | undefined)?.trim();
    if (!arg || !/^-?\d+$/.test(arg)) {
      await ctx.reply('Use /whois <telegram id>');
      return;
    }
    const player = await deps.playerRepository.findByTelegramId(BigInt(arg));
    if (player) await ctx.reply(`User: ${player.displayName}\nUserName: @${player.username ?? ''}`);
  });

  bot.command('moveachv', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const words = ((ctx.match as string | undefined) ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length !== 2 || !/^-?\d+$/.test(words[0]!) || !/^-?\d+$/.test(words[1]!)) {
      await ctx.reply('Command syntax: /moveachv FROM_USERID TO_USERID');
      return;
    }
    const from = BigInt(words[0]!);
    const to = BigInt(words[1]!);
    const moved = await deps.achievementRepository.transferAll(from, to);
    await ctx.reply(`Moved ${moved} achievement(s) from ${from.toString()} to ${to.toString()}.`);
  });

  bot.command('maintenance', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    maintenance.on = !maintenance.on;
    await ctx.reply(`Maintenance Mode: ${maintenance.on}`);
  });

  bot.command('runinfo', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const chatIds = gameManager.activeChatIds();
    const playerCount = chatIds.reduce(
      (sum, id) => sum + (gameManager.get(id)?.players.length ?? 0),
      0,
    );
    await ctx.reply(
      `Run information\nUptime: ${formatUptime(Date.now() - startTime.getTime())}\n` +
        `Current Games: ${chatIds.length}\nCurrent Players: ${playerCount}`,
    );
  });

  bot.command('usage', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const mem = process.memoryUsage();
    const load = os.loadavg();
    await ctx.reply(
      `CPU load (1m/5m/15m): ${load.map((n) => n.toFixed(2)).join(' / ')}\n` +
        `RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB, Heap used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB\n` +
        `Free system memory: ${(os.freemem() / 1024 / 1024).toFixed(0)}MB`,
    );
  });

  bot.command('update', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    await ctx.reply(
      'Pulling latest code and rebuilding - the process will restart shortly if this succeeds...',
    );
    exec('git pull && npm run build', { cwd: process.cwd() }, (err) => {
      if (err) {
        logger.error({ err }, 'Update failed');
        return;
      }
      process.exit(0);
    });
  });

  bot.command('notifyban', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const arg = (ctx.match as string | undefined)?.trim();
    if (!arg || !/^-?\d+$/.test(arg)) return;
    await ctx.api.sendMessage(
      Number(BigInt(arg)),
      'You have been banned.  You may appeal your ban in @werewolfbanappeal',
    );
  });

  bot.command('notifyspam', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const arg = (ctx.match as string | undefined)?.trim();
    if (!arg || !/^-?\d+$/.test(arg)) return;
    await ctx.api.sendMessage(Number(BigInt(arg)), "Please don't spam me like that");
  });
}

/**
 * Port of `GifCommands.cs`'s custom-gif-pack workflow, adapted for a `file_id`-based store
 * instead of the original's CDN uploads: `/customgif` (submission status + instructions),
 * `/setgif <category>` (reply to a video/animation to submit it), `/reviewgifs`/`/approvegifs`/
 * `/disapprovegifs` (dev-only moderation, mirrors the original's admin approval queue), and
 * `/usegifpack` (group-admin opt-in to a specific approved pack - the group-side equivalent of
 * the original's per-group default gif pack setting). Not ported: `/dumpgifs`/`/fixgifs` (raw
 * CDN file management with no meaning in a `file_id` store) and `/learngif` (a dev toggle to
 * scrape gif ids out of arbitrary messages sent to the bot - `/setgif`'s explicit reply-based
 * submission replaces the need for it).
 */
function registerGifCommands(bot: Bot, env: Env, deps: BotDependencies): void {
  const isDev = (telegramId: bigint) => env.devUserIds.includes(telegramId);

  bot.command('customgif', async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    if ((player?.donationLevel ?? 0) < 1) {
      await ctx.reply(deps.translator.translate(language, 'GifPackDonationRequired'));
      return;
    }
    const pack = await deps.gifPackRepository.findOwnPack(BigInt(ctx.from.id));

    const status = !pack
      ? 'GifPackNone'
      : pack.approved
        ? 'GifPackApproved'
        : pack.submitted
          ? 'GifPackPending'
          : 'GifPackNone';
    const filled = pack ? Object.keys(pack.fileIds).length : 0;
    const lines = [
      deps.translator.translate(language, status),
      deps.translator.translate(language, 'GifPackFilledCount', filled, GIF_CATEGORIES.length),
      deps.translator.translate(language, 'GifPackHowTo', GIF_CATEGORIES.join(', ')),
    ];

    try {
      await ctx.api.sendMessage(ctx.from.id, lines.join('\n'));
      if (ctx.chat && ctx.chat.type !== 'private')
        await ctx.reply(deps.translator.translate(language, 'CheckYourPM'));
    } catch (err) {
      if (err instanceof GrammyError) {
        await ctx.reply(deps.translator.translate(language, 'CantPMYou'));
        return;
      }
      throw err;
    }
  });

  bot.command('setgif', async (ctx) => {
    if (!ctx.from) return;
    const player = await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id));
    const language = player?.languageCode ?? 'en';
    if ((player?.donationLevel ?? 0) < 1) {
      await ctx.reply(deps.translator.translate(language, 'GifPackDonationRequired'));
      return;
    }

    const categoryArg = ((ctx.match as string | undefined) ?? '').trim();
    const category = GIF_CATEGORIES.find((c) => c.toLowerCase() === categoryArg.toLowerCase());
    if (!category) {
      await ctx.reply(
        deps.translator.translate(language, 'GifPackUnknownCategory', GIF_CATEGORIES.join(', ')),
      );
      return;
    }

    const media = ctx.message?.reply_to_message?.animation ?? ctx.message?.reply_to_message?.video;
    if (!media) {
      await ctx.reply(deps.translator.translate(language, 'GifPackReplyRequired'));
      return;
    }

    await deps.gifPackRepository.submitGif(BigInt(ctx.from.id), category, media.file_id);
    await ctx.reply(deps.translator.translate(language, 'GifPackSubmitted', category));
  });

  bot.command('reviewgifs', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const pending = await deps.gifPackRepository.listPending();
    if (pending.length === 0) {
      await ctx.reply('No pending gif pack submissions.');
      return;
    }
    const lines = pending.map(
      (p) =>
        `${p.ownerTelegramId.toString()}: ${Object.keys(p.fileIds).length}/${GIF_CATEGORIES.length} categories${p.nsfw ? ' [NSFW]' : ''}`,
    );
    await ctx.reply(['Pending gif pack submissions:', ...lines].join('\n'));
  });

  bot.command(['approvegifs', 'disapprovegifs'], async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const isApprove = ctx.message?.text?.startsWith('/approvegifs') ?? true;
    const arg = (ctx.match as string | undefined)?.trim();
    if (!arg || !/^-?\d+$/.test(arg)) {
      await ctx.reply(`Use /${isApprove ? 'approvegifs' : 'disapprovegifs'} <telegram id>`);
      return;
    }
    const target = BigInt(arg);
    const ok = isApprove
      ? await deps.gifPackRepository.approve(target, BigInt(ctx.from.id))
      : await deps.gifPackRepository.disapprove(target);
    await ctx.reply(
      ok
        ? `Gif pack ${isApprove ? 'approved' : 'disapproved'} for ${arg}.`
        : `No gif pack submission found for ${arg}.`,
    );
  });

  bot.command('usegifpack', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return;
    if (!(await isGroupAdminOrAnonymous(ctx))) return;

    const group = await deps.groupRepository.getOrCreate(
      BigInt(ctx.chat.id),
      ctx.chat.title ?? null,
      null,
    );
    const arg = (ctx.match as string | undefined)?.trim();

    if (!arg || arg.toLowerCase() === 'none') {
      await deps.groupRepository.setDefaultGifPack(BigInt(ctx.chat.id), null);
      await ctx.reply(deps.translator.translate(group.language, 'GifPackGroupCleared'));
      return;
    }
    if (!/^-?\d+$/.test(arg)) {
      await ctx.reply(deps.translator.translate(group.language, 'GifPackUsageUsePack'));
      return;
    }

    const packId = await deps.gifPackRepository.findApprovedPackId(BigInt(arg));
    if (packId === null) {
      await ctx.reply(deps.translator.translate(group.language, 'GifPackNotApproved'));
      return;
    }
    await deps.groupRepository.setDefaultGifPack(BigInt(ctx.chat.id), packId);
    await ctx.reply(deps.translator.translate(group.language, 'GifPackGroupSet'));
  });
}

/** Prefix identifying our own invoices in `invoice_payload`, so `pre_checkout_query` never blindly
 * approves a payload it didn't generate. */
const DONATE_PAYLOAD_PREFIX = 'donate:';

/**
 * Port of the original's PayPal-donation flow (`InlineCommand.cs`/`Extensions.cs`), replaced with
 * Telegram Stars' native payment support (currency `XTR`, no external payment provider/account
 * needed - `provider_token` is simply left empty). `/donate <amount>` sends a Stars invoice;
 * `pre_checkout_query` approves it; `message:successful_payment` credits the total and recomputes
 * the player's donation tier (see `DONATION_TIERS` in `player.repository.ts`) - level 1 (10 stars)
 * unlocks the custom gif pack feature (see `registerGifCommands`), 2 and 3 are cosmetic-only.
 */
function registerDonationCommands(bot: Bot, env: Env, deps: BotDependencies): void {
  const isDev = (telegramId: bigint) => env.devUserIds.includes(telegramId);

  bot.command('donate', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    await deps.playerRepository.upsert(BigInt(ctx.from.id), {
      username: ctx.from.username ?? null,
    });
    const language =
      (await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id)))?.languageCode ?? 'en';

    const arg = (ctx.match as string | undefined)?.trim();
    const amount = arg ? Number.parseInt(arg, 10) : NaN;
    if (!arg || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
      await ctx.reply(
        deps.translator.translate(language, 'DonateHelp', DONATION_TIERS.join(' / ')),
      );
      return;
    }

    await ctx.api.sendInvoice(
      ctx.chat.id,
      deps.translator.translate(language, 'DonateInvoiceTitle'),
      deps.translator.translate(language, 'DonateInvoiceDescription', amount),
      `${DONATE_PAYLOAD_PREFIX}${ctx.from.id}:${amount}`,
      'XTR',
      [{ label: deps.translator.translate(language, 'DonateInvoiceLabel'), amount }],
    );
  });

  bot.on('pre_checkout_query', async (ctx) => {
    const ok = ctx.preCheckoutQuery.invoice_payload.startsWith(DONATE_PAYLOAD_PREFIX);
    await ctx.answerPreCheckoutQuery(ok);
  });

  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    if (!payment.invoice_payload.startsWith(DONATE_PAYLOAD_PREFIX)) return;

    const language =
      (await deps.playerRepository.findByTelegramId(BigInt(ctx.from.id)))?.languageCode ?? 'en';
    const result = await deps.playerRepository.recordDonation(
      BigInt(ctx.from.id),
      payment.total_amount,
    );

    await ctx.reply(
      deps.translator.translate(language, 'DonateThanks', payment.total_amount, result.totalStars),
    );
    if (result.leveledUp) {
      await ctx.reply(deps.translator.translate(language, 'DonateLeveledUp', result.level));
    }
  });

  /** `/adddonation <telegram id> <total stars>` - dev override to set a player's lifetime total */
  bot.command('adddonation', async (ctx) => {
    if (!ctx.from || !isDev(BigInt(ctx.from.id))) return;
    const words = ((ctx.match as string | undefined) ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length !== 2 || !/^-?\d+$/.test(words[0]!) || !/^\d+$/.test(words[1]!)) {
      await ctx.reply('Command syntax: /adddonation TELEGRAM_ID TOTAL_STARS');
      return;
    }
    const target = BigInt(words[0]!);
    const totalStars = Number.parseInt(words[1]!, 10);
    const result = await deps.playerRepository.setDonatedTotal(target, totalStars);
    await ctx.reply(
      `${target.toString()} now has ${result.totalStars} lifetime stars (level ${result.level}).`,
    );
  });

  // Register Telegram Bot Command Menu for Auto-Complete UI (Scoped & Prioritized)
  const groupCommands = [
    { command: 'startgame', description: '🐺 Lancer une partie classique' },
    { command: 'botgame', description: '🤖 Partie solo avec 5 bots IA Gemini 2.5' },
    { command: 'join', description: '✋ Rejoindre la partie en attente' },
    { command: 'forcestart', description: '⚡ Lancer la partie sans attendre' },
    { command: 'claim', description: '📢 Déclarer publiquement son rôle (ex: /claim Voyante)' },
    { command: 'claims', description: '📜 Récapitulatif de tous les claims de la partie' },
    { command: 'players', description: '👥 Liste des joueurs vivants & morts' },
    { command: 'leaderboard', description: '🏆 Classement mondial des meilleurs joueurs' },
    { command: 'profile', description: '👤 Voir sa carte de profil et son rang' },
    { command: 'titles', description: "👑 Choisir et équiper son titre d'honneur" },
    { command: 'setlang', description: '🌐 Changer la langue du bot (FR / EN)' },
    { command: 'config', description: '⚙️ Configurer les options et rôles du groupe' },
    { command: 'modes', description: '📘 Consulter le guide des modes de jeu' },
    { command: 'stats', description: '📊 Voir tes statistiques de jeu' },
    { command: 'rolelist', description: '📜 Guide et description de tous les rôles' },
    { command: 'accuse', description: '👉 Accuser publiquement un joueur' },
    { command: 'tournoi', description: '🏆 Menu principal des tournois' },
    { command: 'creerequipe', description: '🛡️ Créer une équipe de tournoi' },
    { command: 'rejoindreequipe', description: '🤝 Rejoindre une équipe de tournoi' },
    { command: 'monequipe', description: '🚩 Consulter son équipe de tournoi' },
    { command: 'inscrirefournoi', description: '📝 Inscrire son équipe au tournoi' },
    { command: 'startchaos', description: '🌀 Mode Chaos (rôles chaotiques)' },
    { command: 'flee', description: '🏃 Quitter le lobby avant le démarrage' },
    { command: 'extend', description: "⏳ Prolonger le temps d'attente du lobby" },
    { command: 'help', description: "❓ Obtenir de l'aide et les règles" },
    { command: 'gazette', description: '📜 Lire le journal de la dernière partie' },
    { command: 'report', description: '🚨 Signaler un joueur en fin de partie' },
    { command: 'waitlist', description: '🔔 Recevoir une alerte quand une partie démarre' },
  ];

  const privateCommands = [
    { command: 'start', description: '🚀 Démarrer le bot' },
    { command: 'role', description: '🕵️ Consulter son rôle secret en privé' },
    { command: 'profile', description: '👤 Voir sa carte de profil et son rang' },
    { command: 'titles', description: "👑 Choisir et équiper son titre d'honneur" },
    { command: 'leaderboard', description: '🏆 Classement mondial des meilleurs joueurs' },
    { command: 'stats', description: '📊 Voir tes statistiques de jeu' },
    { command: 'setlang', description: '🌐 Changer la langue du bot (FR / EN)' },
    { command: 'help', description: "❓ Obtenir de l'aide et les règles" },
    { command: 'donate', description: "⭐ Faire un don d'Étoiles et devenir Donateur" },
  ];

  void Promise.all([
    bot.api.setMyCommands(groupCommands, { scope: { type: 'all_group_chats' } }),
    bot.api.setMyCommands(privateCommands, { scope: { type: 'all_private_chats' } }),
    bot.api.setMyCommands(groupCommands),
  ]).catch(() => {
    // Ignore network errors on startup
  });
}
