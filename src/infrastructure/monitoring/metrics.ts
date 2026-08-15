/**
 * Centralized Prometheus metrics registry for the Werewolf Telegram bot.
 *
 * Provides 200+ metrics across all layers:
 *   - Game lifecycle (starts, ends, phases, rounds)
 *   - Player activity (joins, eliminations, votes, roles)
 *   - Role abilities (per-role ability usage & outcomes)
 *   - Night resolution (per-attack type, blocks, saves)
 *   - Lynch cycle (votes cast, outcomes, ties, judge pardons)
 *   - Telegram bot (commands, callbacks, errors, API latency)
 *   - Persistence (DB query counts & latency per repository)
 *   - Cron jobs (runtime & outcomes)
 *   - System health (uptime, memory, event-loop lag)
 *   - Achievements (unlocks per code)
 *   - Moderation (reports, bans, spam)
 *
 * Starts an HTTP server on METRICS_PORT (default 9090) exposing /metrics
 * for Prometheus / Grafana / OpenTelemetry scraping.
 */

import { createServer } from 'node:http';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import type { WinstonLogger } from '../logging/winston-logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const registry = new Registry();
registry.setDefaultLabels({ app: 'werewolf-bot' });

// Collect default Node.js process metrics (memory, cpu, event loop, etc.)
collectDefaultMetrics({ register: registry, prefix: 'nodejs_' });

// ─────────────────────────────────────────────────────────────────────────────
// Helper factory functions
// ─────────────────────────────────────────────────────────────────────────────

function counter(name: string, help: string, labelNames: string[] = []): Counter {
  return new Counter({ name, help, labelNames, registers: [registry] });
}

function gauge(name: string, help: string, labelNames: string[] = []): Gauge {
  return new Gauge({ name, help, labelNames, registers: [registry] });
}

function histogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): Histogram {
  return new Histogram({
    name,
    help,
    labelNames,
    buckets: buckets ?? [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ① GAME LIFECYCLE METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Number of games currently active (in any phase). */
export const activeGames = gauge('werewolf_active_games_total', 'Number of games currently active', ['mode']);

/** Total number of games started, by mode. */
export const gamesStarted = counter('werewolf_games_started_total', 'Total games started', ['mode']);

/** Total number of games ended, by mode and winning team. */
export const gamesEnded = counter('werewolf_games_ended_total', 'Total games ended', ['mode', 'winning_team']);

/** Total number of games killed by an admin without completion. */
export const gamesKilled = counter('werewolf_games_killed_total', 'Total games force-killed by admin');

/** Total number of games abandoned (detected by stale purge cron). */
export const gamesAbandoned = counter('werewolf_games_abandoned_total', 'Total stale games purged');

/** Total game duration from start to end, in seconds. */
export const gameDurationSeconds = histogram(
  'werewolf_game_duration_seconds',
  'Game duration from start to finish in seconds',
  ['mode'],
  [30, 60, 120, 180, 300, 600, 900, 1800, 3600],
);

/** Total number of complete game rounds (night+day+lynch cycles). */
export const gameRoundsTotal = counter('werewolf_game_rounds_total', 'Total game rounds (day+night cycles) completed', ['mode']);

/** Total number of games that ended with no winner. */
export const gameDrawsTotal = counter('werewolf_game_draws_total', 'Total games that ended with no winner');

// ─────────────────────────────────────────────────────────────────────────────
// ② LOBBY & PLAYER METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total players who joined a lobby. */
export const playersJoined = counter('werewolf_players_joined_total', 'Total player joins across all game lobbies');

/** Total players who fled (left the lobby before the game started). */
export const playersFled = counter('werewolf_players_fled_total', 'Total players who left a lobby before game start');

/** Total players eliminated during the game, by method. */
export const playersEliminated = counter(
  'werewolf_players_eliminated_total',
  'Total player eliminations by method',
  ['method'],
);

/** Total players who were bots during game sessions. */
export const botPlayersAdded = counter('werewolf_bot_players_added_total', 'Total bot players added to games', ['mode']);

/** Distribution of player count at game start. */
export const playerCountAtStart = histogram(
  'werewolf_player_count_at_start',
  'Number of players when a game starts',
  ['mode'],
  [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25],
);

/** Total bot-only (100% bots) games started. */
export const botOnlyGamesStarted = counter('werewolf_bot_only_games_started_total', 'Total bot-only games started');

/** Total times next-game notifications were triggered. */
export const nextGameNotifications = counter('werewolf_next_game_notifications_total', 'Total next-game notification sends');

/** Total force-starts by admins. */
export const forceStarts = counter('werewolf_force_starts_total', 'Total game force-starts by admin');

/** Total lobby extend calls. */
export const lobbyExtensions = counter('werewolf_lobby_extensions_total', 'Total lobby timer extensions');

// ─────────────────────────────────────────────────────────────────────────────
// ③ NIGHT PHASE METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total night cycles started. */
export const nightsStarted = counter('werewolf_nights_started_total', 'Total night phases started');

/** Total night cycles resolved. */
export const nightsResolved = counter('werewolf_nights_resolved_total', 'Total night phases resolved');

/** Total wolf attacks (kill attempts). */
export const wolfAttacksTotal = counter('werewolf_wolf_attacks_total', 'Total wolf pack kill attempts');

/** Total wolf attacks that were blocked (by GA, Witch save, etc.). */
export const wolfAttacksBlocked = counter(
  'werewolf_wolf_attacks_blocked_total',
  'Total wolf attacks blocked',
  ['blocker'],
);

/** Total wolf attacks that resulted in a kill. */
export const wolfKillsTotal = counter('werewolf_wolf_kills_total', 'Total successful wolf pack kills');

/** Total snow wolf freeze attempts. */
export const snowWolfFreezeAttempts = counter('werewolf_snow_wolf_freeze_attempts_total', 'Total Snow Wolf freeze attempts');

/** Total snow wolf freezes that succeeded. */
export const snowWolfFreezeSuccess = counter('werewolf_snow_wolf_freeze_success_total', 'Total successful Snow Wolf freezes');

/** Total serial killer strikes. */
export const serialKillerStrikes = counter('werewolf_serial_killer_strikes_total', 'Total Serial Killer night kills');

/** Total serial killer strikes blocked. */
export const serialKillerBlocked = counter('werewolf_serial_killer_blocked_total', 'Total Serial Killer kills blocked');

/** Total arsonist dousings (mark targets). */
export const arsonistDousings = counter('werewolf_arsonist_dousings_total', 'Total Arsonist target dousings');

/** Total arsonist burn-all activations. */
export const arsonistBurns = counter('werewolf_arsonist_burns_total', 'Total Arsonist burn-all activations');

/** Total players killed by arsonist burns. */
export const arsonistBurnKills = counter('werewolf_arsonist_burn_kills_total', 'Total players killed by Arsonist burning');

/** Total Guardian Angel protections assigned. */
export const guardianAngelProtections = counter(
  'werewolf_guardian_angel_protections_total',
  'Total Guardian Angel protection assignments',
);

/** Total times Guardian Angel actually saved someone. */
export const guardianAngelSaves = counter(
  'werewolf_guardian_angel_saves_total',
  'Total Guardian Angel successful saves',
  ['from'],
);

/** Total Harlot visits. */
export const harlotVisits = counter('werewolf_harlot_visits_total', 'Total Harlot night visits');

/** Total Harlot visits that resulted in Harlot death (visited a wolf). */
export const harlotDeaths = counter('werewolf_harlot_deaths_total', 'Total Harlot deaths from visiting wolves');

/** Total Seer clairvoyance checks. */
export const seerChecks = counter('werewolf_seer_checks_total', 'Total Seer/Clairvoyant role checks');

/** Total Seer checks that revealed a wolf. */
export const seerWolfFinds = counter('werewolf_seer_wolf_finds_total', 'Total Seer checks that found a wolf');

/** Total Witch potion usages (save). */
export const witchSavePotions = counter('werewolf_witch_save_potions_total', 'Total Witch healing potion usages');

/** Total Witch poison usages (kill). */
export const witchPoisonPotions = counter('werewolf_witch_poison_potions_total', 'Total Witch poison usages');

/** Total Chemist drunk-applications. */
export const chemistDrunkApplications = counter(
  'werewolf_chemist_drunk_applications_total',
  'Total Chemist ability applications',
);

/** Total Cult conversions. */
export const cultConversions = counter('werewolf_cult_conversions_total', 'Total Cult recruitment conversions');

/** Total Cultist Hunter detections. */
export const cultistHunterDetections = counter(
  'werewolf_cultist_hunter_detections_total',
  'Total Cultist Hunter cult detections',
);

/** Total Thief role steals. */
export const thiefRoleSteal = counter('werewolf_thief_role_steals_total', 'Total Thief role steals');

/** Total Necromancer resurrections. */
export const necromancerResurrections = counter('werewolf_necromancer_resurrections_total', 'Total Necromancer resurrections');

/** Total Doppelganger role-model assignments. */
export const doppelgangerAssignments = counter(
  'werewolf_doppelganger_assignments_total',
  'Total Doppelganger role-model selections',
);

/** Total Wild Child role-model assignments. */
export const wildChildAssignments = counter(
  'werewolf_wild_child_assignments_total',
  'Total Wild Child role-model selections',
);

/** Total Wild Child transformations to wolf. */
export const wildChildTransformations = counter(
  'werewolf_wild_child_transformations_total',
  'Total Wild Child transformations into wolves',
);

/** Total Cupid lover pair linkages. */
export const cupidLoverLinks = counter('werewolf_cupid_lover_links_total', 'Total Cupid lover pair creations');

/** Total Lovers deaths from partner elimination. */
export const loversSuicides = counter('werewolf_lovers_suicides_total', 'Total lover suicides after partner death');

/** Total Sandman sleep activations. */
export const sandmanSleepActivations = counter(
  'werewolf_sandman_sleep_activations_total',
  'Total Sandman sleep (skip night) activations',
);

/** Total Blacksmith silver-spread activations. */
export const blacksmithSilverSpreads = counter(
  'werewolf_blacksmith_silver_spreads_total',
  'Total Blacksmith silver spread activations',
);

/** Total Spumpkin detonations. */
export const spumpkinDetonations = counter('werewolf_spumpkin_detonations_total', 'Total Spumpkin bomb detonations');

/** Total Archivist report deliveries. */
export const archivistReports = counter('werewolf_archivist_reports_total', 'Total Archivist nightly reports delivered');

/** Total Mimic ability usages. */
export const mimicUsages = counter('werewolf_mimic_usages_total', 'Total Mimic ability activations');

/** Total Hitman contract kills. */
export const hitmanKills = counter('werewolf_hitman_kills_total', 'Total Hitman contract kills');

/** Total bot night actions taken. */
export const botNightActions = counter('werewolf_bot_night_actions_total', 'Total automated bot night actions', ['role']);

/** Night phase duration in seconds. */
export const nightPhaseDuration = histogram(
  'werewolf_night_phase_duration_seconds',
  'Night phase duration in seconds',
  [],
  [10, 20, 30, 60, 90, 120, 180],
);

// ─────────────────────────────────────────────────────────────────────────────
// ④ DAY PHASE METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total day phases started. */
export const daysStarted = counter('werewolf_days_started_total', 'Total day phases started');

/** Total day phases resolved. */
export const daysResolved = counter('werewolf_days_resolved_total', 'Total day phases resolved');

/** Total Gunner shots fired. */
export const gunnerShots = counter('werewolf_gunner_shots_total', 'Total Gunner shots fired');

/** Total Gunner shots that hit (killed the target). */
export const gunnerHits = counter('werewolf_gunner_hits_total', 'Total Gunner shots that killed a wolf');

/** Total Gunner shots that backfired. */
export const gunnerBackfires = counter('werewolf_gunner_backfires_total', 'Total Gunner shots that backfired');

/** Total Detective snoops. */
export const detectiveSnoops = counter('werewolf_detective_snoops_total', 'Total Detective role reveals');

/** Day phase duration in seconds. */
export const dayPhaseDuration = histogram(
  'werewolf_day_phase_duration_seconds',
  'Day phase duration in seconds',
  [],
  [5, 10, 20, 30, 60, 90],
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ LYNCH CYCLE METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total lynch cycles started. */
export const lynchesStarted = counter('werewolf_lynches_started_total', 'Total lynch phases started');

/** Total lynch cycles resolved, by outcome. */
export const lynchesResolved = counter('werewolf_lynches_resolved_total', 'Total lynch resolutions', ['outcome']);

/** Total lynch votes cast (human players). */
export const lynchVotesCast = counter('werewolf_lynch_votes_cast_total', 'Total lynch votes cast by human players');

/** Total lynch votes cast by bots. */
export const lynchBotVotes = counter('werewolf_lynch_bot_votes_total', 'Total lynch votes cast by bot players');

/** Total lynch ties (no majority). */
export const lynchTies = counter('werewolf_lynch_ties_total', 'Total lynch votes that ended in a tie');

/** Total Judge pardons. */
export const judgePardons = counter('werewolf_judge_pardons_total', 'Total Judge pardon activations');

/** Total Pacifist peace declarations. */
export const pacifistPeaces = counter('werewolf_pacifist_peace_total', 'Total Pacifist peace declarations (lynch skipped)');

/** Total Mayor announcements. */
export const mayorAnnouncements = counter('werewolf_mayor_announcements_total', 'Total Mayor public announcements');

/** Total Troublemaker double-lynch activations. */
export const troublemakerDoubleLynches = counter(
  'werewolf_troublemaker_double_lynch_total',
  'Total Troublemaker double-lynch activations',
);

/** Total players who abstained (voted ABSTAIN). */
export const lynchAbstentions = counter('werewolf_lynch_abstentions_total', 'Total lynch abstain votes');

/** Lynch phase duration in seconds. */
export const lynchPhaseDuration = histogram(
  'werewolf_lynch_phase_duration_seconds',
  'Lynch phase duration in seconds',
  [],
  [5, 10, 20, 30, 60, 90],
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ WIN CONDITIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Total wins per team. */
export const teamWins = counter('werewolf_team_wins_total', 'Total wins per team', ['team']);

/** Total wins by role (for special solos). */
export const soloWins = counter('werewolf_solo_wins_total', 'Total solo-role wins', ['role']);

/** Total lover-pair wins. */
export const loversWins = counter('werewolf_lovers_wins_total', 'Total Lovers pair wins');

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ ROLE DISTRIBUTION METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total times each role was assigned across all games. */
export const roleAssignments = counter(
  'werewolf_role_assignments_total',
  'Total times each role was assigned',
  ['role'],
);

/** Total times each role resulted in a win for its player. */
export const roleWins = counter('werewolf_role_wins_total', 'Total wins per role', ['role']);

/** Total deaths per role. */
export const roleDeaths = counter('werewolf_role_deaths_total', 'Total deaths per role', ['role']);

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ TELEGRAM BOT / COMMAND METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total Telegram commands processed, by command. */
export const commandsProcessed = counter(
  'werewolf_telegram_commands_total',
  'Total Telegram commands processed',
  ['command'],
);

/** Total Telegram callback queries processed. */
export const callbacksProcessed = counter(
  'werewolf_telegram_callbacks_total',
  'Total Telegram callback queries processed',
  ['type'],
);

/** Total Telegram API errors, by error code. */
export const telegramApiErrors = counter(
  'werewolf_telegram_api_errors_total',
  'Total Telegram API errors',
  ['code', 'method'],
);

/** Total bot errors (unhandled rejections, uncaught exceptions). */
export const botErrors = counter('werewolf_bot_errors_total', 'Total bot-level errors', ['source', 'type']);

/** Total transient network errors (ECONNRESET, ETIMEDOUT, etc.) */
export const transientNetworkErrors = counter(
  'werewolf_transient_network_errors_total',
  'Total transient network errors during getUpdates',
  ['code'],
);

/** Total admin alerts sent. */
export const adminAlertsSent = counter('werewolf_admin_alerts_sent_total', 'Total monitoring alerts sent to admin');

/** Total times a bot PM couldn't be sent (user hasn't started PM). */
export const pmFailures = counter('werewolf_pm_failures_total', 'Total private message failures (user blocked bot)');

/** Total GIF sends per category. */
export const gifSends = counter('werewolf_gif_sends_total', 'Total animated GIF sends', ['category']);

/** Telegram API call latency. */
export const telegramApiLatency = histogram(
  'werewolf_telegram_api_latency_seconds',
  'Telegram API call latency in seconds',
  ['method'],
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
);

/** Time from command receipt to response. */
export const commandResponseTime = histogram(
  'werewolf_command_response_time_seconds',
  'Command processing time from receipt to response',
  ['command'],
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ PERSISTENCE / DATABASE METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total database queries, by repository and operation. */
export const dbQueries = counter('werewolf_db_queries_total', 'Total database queries', ['repository', 'operation']);

/** Total database query errors. */
export const dbErrors = counter('werewolf_db_errors_total', 'Total database query errors', ['repository', 'operation']);

/** Database query duration. */
export const dbQueryDuration = histogram(
  'werewolf_db_query_duration_seconds',
  'Database query duration in seconds',
  ['repository', 'operation'],
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
);

/** Total database automated & manual backups created. */
export const dbBackupsTotal = counter('werewolf_db_backups_total', 'Total database backups created');

/** Total achievement unlocks, by code. */
export const achievementUnlocks = counter(
  'werewolf_achievement_unlocks_total',
  'Total achievement unlocks',
  ['code'],
);

/** Total achievement seeds at startup. */
export const achievementSeedOps = counter('werewolf_achievement_seed_ops_total', 'Total achievement catalog seed operations');

/** Total player upserts. */
export const playerUpserts = counter('werewolf_player_upserts_total', 'Total player upsert operations');

/** Total game records saved. */
export const gameRecordsSaved = counter('werewolf_game_records_saved_total', 'Total game records persisted to database');

/** Total kill records saved. */
export const killRecordsSaved = counter('werewolf_kill_records_saved_total', 'Total kill records persisted');

// ─────────────────────────────────────────────────────────────────────────────
// ⑩ CRON JOB METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total cron job executions, by job name. */
export const cronJobRuns = counter('werewolf_cron_job_runs_total', 'Total cron job executions', ['job']);

/** Total cron job failures, by job name. */
export const cronJobFailures = counter('werewolf_cron_job_failures_total', 'Total cron job failures', ['job']);

/** Cron job duration. */
export const cronJobDuration = histogram(
  'werewolf_cron_job_duration_seconds',
  'Cron job execution duration in seconds',
  ['job'],
);

/** Total bans expired by cron. */
export const bansExpired = counter('werewolf_bans_expired_total', 'Total bans lifted by expiry cron');

/** Total daily stats rotation runs. */
export const dailyStatsRotations = counter('werewolf_daily_stats_rotations_total', 'Total daily stats rotation runs');

// ─────────────────────────────────────────────────────────────────────────────
// ⑪ MODERATION METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Total player reports filed. */
export const playerReports = counter('werewolf_player_reports_total', 'Total player reports filed');

/** Total bans applied (manual + spam). */
export const bansApplied = counter('werewolf_bans_applied_total', 'Total bans applied', ['type']);

/** Total spam detections by SpamGuard. */
export const spamDetections = counter('werewolf_spam_detections_total', 'Total spam events detected');

/** Total group bans. */
export const groupBans = counter('werewolf_group_bans_total', 'Total groups banned');

/** Total smite (force-eliminate) actions. */
export const smiteActions = counter('werewolf_smite_actions_total', 'Total admin smite actions');

/** Total skip-vote admin actions. */
export const skipVoteActions = counter('werewolf_skip_vote_actions_total', 'Total admin skip-vote actions');

// ─────────────────────────────────────────────────────────────────────────────
// ⑫ SYSTEM & HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

/** Bot process uptime in seconds. */
export const botUptime = gauge('werewolf_bot_uptime_seconds', 'Bot process uptime in seconds');

/** Number of active game lobbies currently open. */
export const activeLobbies = gauge('werewolf_active_lobbies', 'Number of currently open game lobbies');

/** Number of groups the bot is currently active in. */
export const activeGroups = gauge('werewolf_active_groups', 'Number of groups with active sessions');

/** Total unique groups that have ever started a game. */
export const totalGroupsSeen = counter('werewolf_total_groups_seen', 'Total distinct groups that started a game');

/** Total unique players ever seen. */
export const totalPlayersSeen = counter('werewolf_total_players_seen', 'Total distinct players ever seen');

/** i18n translation misses. */
export const translationMisses = counter(
  'werewolf_translation_misses_total',
  'Total missing locale translation keys',
  ['key', 'language'],
);

/** Config menu interactions. */
export const configMenuInteractions = counter(
  'werewolf_config_menu_interactions_total',
  'Total config menu interactions',
  ['action'],
);

/** Donation events. */
export const donationEvents = counter('werewolf_donation_events_total', 'Total player donation events');

/** Donation stars total received. */
export const donationStarsTotal = counter('werewolf_donation_stars_total', 'Total Telegram Stars donated');

/** Gazette generation calls. */
export const gazetteGenerations = counter('werewolf_gazette_generations_total', 'Total gazette (post-game summary) generations');

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Metrics Server
// ─────────────────────────────────────────────────────────────────────────────

let uptimeInterval: NodeJS.Timeout | null = null;
const startTime = Date.now();

/**
 * Starts the Prometheus /metrics HTTP server.
 * Default port: 9090 (configurable via METRICS_PORT env var).
 */
export function startMetricsServer(logger: WinstonLogger, port = 9090): void {
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      try {
        const metrics = await registry.metrics();
        res.writeHead(200, { 'Content-Type': registry.contentType });
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end('Internal server error');
        logger.error({ err }, 'Failed to collect Prometheus metrics');
      }
    } else if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000) }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn({ port }, `Prometheus metrics port ${port} is already in use. Metrics server disabled.`);
    } else {
      logger.error({ err }, 'Prometheus metrics server error');
    }
  });

  server.listen(port, () => {
    logger.info(
      {
        port,
        endpoints: [`http://localhost:${port}/metrics`, `http://localhost:${port}/health`],
      },
      'Prometheus metrics server started',
    );
  });

  // Update uptime gauge every 5 seconds
  uptimeInterval = setInterval(() => {
    botUptime.set(Math.floor((Date.now() - startTime) / 1000));
  }, 5000);
}

export function stopMetricsServer(): void {
  if (uptimeInterval) clearInterval(uptimeInterval);
}
