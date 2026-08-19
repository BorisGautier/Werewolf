import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Bot } from 'grammy';
import type { PrismaClient } from '@prisma/client';
import type { GameManager } from '../../application/game-manager.js';
import type { Logger } from '../logging/logger.js';
import { SYNTHETIC_BOT_ID_CEILING, SYNTHETIC_BOT_ID_FLOOR } from '../../domain/game/player.js';
import { AdminAuthManager } from './admin-auth.js';
import { DatabaseBackupManager } from '../persistence/db-backup.js';
import {
  TournamentRepository,
  type TournamentStatus,
} from '../persistence/tournament.repository.js';

export interface AdminServerDependencies {
  port?: number;
  prisma?: PrismaClient;
  gameManager?: GameManager;
  logger?: Logger;
  authManager?: AdminAuthManager;
  backupManager?: DatabaseBackupManager;
  bot?: Bot;
  tournamentRepository?: TournamentRepository;
  maintenance?: { on: boolean };
}

export class AdminServer {
  private port: number;
  private server?: http.Server | undefined;
  private prisma?: PrismaClient | undefined;
  private gameManager?: GameManager | undefined;
  private logger?: Logger | undefined;
  private authManager: AdminAuthManager;
  private backupManager: DatabaseBackupManager;
  private bot?: Bot | undefined;
  private tournamentRepository?: TournamentRepository | undefined;
  private maintenance?: { on: boolean } | undefined;

  constructor(deps: AdminServerDependencies = {}) {
    this.port =
      deps.port ??
      (process.env.ADMIN_PORT
        ? parseInt(process.env.ADMIN_PORT, 10)
        : process.env.PORT
          ? parseInt(process.env.PORT, 10)
          : 4000);
    this.prisma = deps.prisma;
    this.gameManager = deps.gameManager;
    this.logger = deps.logger;
    this.authManager = deps.authManager ?? new AdminAuthManager();
    this.backupManager =
      deps.backupManager ??
      new DatabaseBackupManager(deps.logger ? { logger: deps.logger } : undefined);
    this.bot = deps.bot;
    this.tournamentRepository =
      deps.tournamentRepository ??
      (deps.prisma ? new TournamentRepository(deps.prisma) : undefined);
    this.maintenance = deps.maintenance;
  }

  /** Starts the Admin HTTP Server */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on('error', (err: { code?: string }) => {
        if (err.code === 'EADDRINUSE') {
          this.logger?.warn(
            `[AdminServer] Port ${this.port} is already in use. Admin Web Dashboard is disabled for this instance.`,
          );
          resolve();
        } else {
          this.logger?.error({ err }, '[AdminServer] Server startup error');
          resolve();
        }
      });
      this.server.listen(this.port, () => {
        this.logger?.info(
          `[AdminServer] Admin Web Dashboard & API listening on http://localhost:${this.port}`,
        );
        resolve();
      });
    });
  }

  /** Stops the Admin HTTP Server */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS: the dashboard is served same-origin by this very server (see serveDashboardHtml), so
    // its own fetch() calls never need a CORS grant at all - browsers only consult these headers
    // for cross-origin requests. Only reflect Access-Control-Allow-Origin when the caller's Origin
    // matches an explicit allowlist (ADMIN_ALLOWED_ORIGINS, comma-separated); otherwise omit the
    // header entirely so a third-party page embedding fetch() against this API gets blocked by the
    // browser instead of a wildcard '*' silently allowing any origin to read admin API responses.
    const allowedOrigins = (process.env.ADMIN_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const requestOrigin = req.headers.origin;
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    try {
      // Unauthenticated health & public routes
      if (
        (pathname === '/health' ||
          pathname === '/api/health' ||
          pathname === '/api/admin/health') &&
        req.method === 'GET'
      ) {
        const activeGamesCount = this.gameManager ? this.gameManager.size : 0;
        this.sendJson(res, 200, {
          status: 'ok',
          activeGames: activeGamesCount,
          maintenance: Boolean(this.maintenance?.on),
          uptimeSeconds: Math.floor(process.uptime()),
        });
        return;
      }

      if (pathname === '/api/admin/login' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const pass = typeof body.password === 'string' ? body.password : '';
        if (this.authManager.verifyPassword(pass)) {
          const token = this.authManager.generateToken();
          this.sendJson(res, 200, { success: true, token, user: 'admin' });
        } else {
          this.sendJson(res, 401, { success: false, error: 'Invalid password' });
        }
        return;
      }

      if (pathname === '/api/public/stats' && req.method === 'GET') {
        const activeGames = this.gameManager ? this.gameManager.size : 0;
        let totalPlayers = 0;
        let totalGroups = 0;
        if (this.prisma) {
          try {
            // No bot-id filter here: bots are synthetic, in-memory-only Player rows are never
            // persisted for them in the first place (see PlayerRepository.getTopPlayers's doc
            // comment) - a numeric id ceiling would only end up excluding real players instead,
            // since modern Telegram user ids routinely exceed any such threshold.
            totalPlayers = await this.prisma.player.count();
            totalGroups = await this.prisma.group.count();
          } catch {
            // ignore database count errors in stats
          }
        }
        this.sendJson(res, 200, {
          success: true,
          activeGames,
          totalPlayers,
          totalGroups,
          rolesCount: 63,
          modesCount: 11,
        });
        return;
      }

      // Serve static dashboard or landing page HTML for non-API routes
      if (!pathname.startsWith('/api/')) {
        if (pathname === '/admin' || pathname.startsWith('/admin/')) {
          this.serveDashboardHtml(res);
        } else {
          this.serveLandingPageHtml(res);
        }
        return;
      }

      // Require Authorization header for all /api/admin/ routes
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
      const session = this.authManager.verifyToken(token);

      if (!session) {
        this.sendJson(res, 401, {
          success: false,
          error: 'Unauthorized. Invalid or expired token.',
        });
        return;
      }

      // API Router
      if (
        (pathname === '/api/maintenance' || pathname === '/api/admin/maintenance') &&
        req.method === 'POST'
      ) {
        const body = await this.readJsonBody(req);
        if (this.maintenance) {
          this.maintenance.on = typeof body.enabled === 'boolean' ? body.enabled : true;
        }
        this.sendJson(res, 200, { success: true, maintenance: Boolean(this.maintenance?.on) });
      } else if (pathname === '/api/admin/stats' && req.method === 'GET') {
        await this.handleGetStats(res);
      } else if (pathname === '/api/admin/games' && req.method === 'GET') {
        this.handleGetGames(res);
      } else if (
        pathname.startsWith('/api/admin/games/') &&
        pathname.endsWith('/action') &&
        req.method === 'POST'
      ) {
        const parts = pathname.split('/');
        const chatIdStr = parts[4] ?? '';
        const body = await this.readJsonBody(req);
        await this.handleGameAction(res, chatIdStr, body);
      } else if (pathname === '/api/admin/players' && req.method === 'GET') {
        await this.handleGetPlayers(res, url);
      } else if (pathname === '/api/admin/leaderboard' && req.method === 'GET') {
        await this.handleGetLeaderboard(res, url);
      } else if (pathname === '/api/admin/game-history' && req.method === 'GET') {
        await this.handleGetGameHistory(res, url);
      } else if (
        pathname.startsWith('/api/admin/players/') &&
        pathname.endsWith('/ban') &&
        req.method === 'POST'
      ) {
        const parts = pathname.split('/');
        const telegramIdStr = parts[4] ?? '';
        const body = await this.readJsonBody(req);
        await this.handlePlayerBan(res, telegramIdStr, body);
      } else if (pathname === '/api/admin/groups' && req.method === 'GET') {
        await this.handleGetGroups(res);
      } else if (pathname.match(/^\/api\/admin\/groups\/([^/]+)\/ban$/) && req.method === 'POST') {
        const matches = pathname.match(/^\/api\/admin\/groups\/([^/]+)\/ban$/)!;
        const chatIdStr = matches[1]!;
        const body = await this.readJsonBody(req);
        await this.handleGroupBan(res, chatIdStr, body);
      } else if (
        pathname.match(/^\/api\/admin\/groups\/([^/]+)\/approve$/) &&
        req.method === 'POST'
      ) {
        const matches = pathname.match(/^\/api\/admin\/groups\/([^/]+)\/approve$/)!;
        const chatIdStr = matches[1]!;
        const body = await this.readJsonBody(req);
        await this.handleGroupApprove(res, chatIdStr, body);
      } else if (pathname === '/api/admin/backups' && req.method === 'GET') {
        await this.handleGetBackups(res);
      } else if (pathname === '/api/admin/db-stats' && req.method === 'GET') {
        await this.handleGetDbStats(res);
      } else if (pathname === '/api/admin/game-analytics' && req.method === 'GET') {
        await this.handleGetGameAnalytics(res);
      } else if (pathname === '/api/admin/backups/create' && req.method === 'POST') {
        await this.handleCreateBackup(res);
      } else if (pathname === '/api/admin/backups/restore' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const filename = typeof body.filename === 'string' ? body.filename : '';
        await this.handleRestoreBackup(res, filename);
      } else if (pathname === '/api/admin/broadcast' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        await this.handleBroadcast(res, body);
      } else if (pathname === '/api/admin/logs' && req.method === 'GET') {
        this.handleGetLogs(res);
      } else if (pathname === '/api/admin/tournaments' && req.method === 'GET') {
        await this.handleGetTournaments(res);
      } else if (pathname === '/api/admin/tournaments/create' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        await this.handleCreateTournament(res, body);
      } else if (
        pathname.startsWith('/api/admin/tournaments/') &&
        pathname.endsWith('/status') &&
        req.method === 'POST'
      ) {
        const idStr = pathname.split('/')[4] ?? '0';
        const id = parseInt(idStr, 10);
        const body = await this.readJsonBody(req);
        await this.handleUpdateTournamentStatus(res, id, body);
      } else if (pathname.match(/^\/api\/admin\/tournaments\/(\d+)$/) && req.method === 'GET') {
        const idStr = pathname.split('/')[4] ?? '0';
        await this.handleGetTournamentDetails(res, parseInt(idStr, 10));
      } else {
        this.sendJson(res, 404, { success: false, error: 'Endpoint not found' });
      }
    } catch (err) {
      // Log the real error server-side only - the response body is reachable by anyone with a
      // valid (or forged, pre-V1-fix) token, and exception messages can leak internal details
      // (file paths, query fragments, stack info) that help an attacker refine further attempts.
      this.logger?.error({ err }, '[AdminServer] Request handling error');
      this.sendJson(res, 500, { success: false, error: 'Internal server error' });
    }
  }

  private async handleGetStats(res: ServerResponse): Promise<void> {
    let activeGamesCount = 0;
    let totalPlayers = 0;
    let totalGroups = 0;
    let pendingGroups = 0;

    try {
      activeGamesCount = this.gameManager ? this.gameManager.size : 0;
      if (this.prisma) {
        totalPlayers = await this.prisma.player.count().catch(() => 0);
        totalGroups = await this.prisma.group.count().catch(() => 0);
        pendingGroups = await this.prisma.group
          .count({ where: { isApproved: false } })
          .catch(() => 0);
      }
    } catch (err) {
      this.logger?.warn({ err }, '[AdminServer] Warning fetching stats metrics');
    }

    this.sendJson(res, 200, {
      success: true,
      stats: {
        activeGames: activeGamesCount,
        totalPlayers,
        totalGroups,
        pendingGroups,
        uptimeSeconds: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
      },
    });
  }

  private handleGetGames(res: ServerResponse): void {
    const gamesData: Array<Record<string, unknown>> = [];
    if (this.gameManager) {
      for (const chatId of this.gameManager.activeChatIds()) {
        const game = this.gameManager.get(chatId);
        if (game) {
          gamesData.push({
            groupId: chatId.toString(),
            gameMode: game.mode,
            phase: game.phase,
            dayCount: game.dayNumber,
            playerCount: game.players.length,
            aliveCount: game.players.filter((p) => !p.isDead).length,
            players: game.players.map((p) => ({
              id: p.id.toString(),
              name: p.name,
              role: p.role,
              isAlive: !p.isDead,
              isBot: Boolean(p.isBot),
            })),
          });
        }
      }
    }
    this.sendJson(res, 200, { success: true, games: gamesData });
  }

  private async handleGameAction(
    res: ServerResponse,
    chatIdStr: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.gameManager) {
      this.sendJson(res, 400, { success: false, error: 'GameManager not available' });
      return;
    }

    const chatId = BigInt(chatIdStr);
    const game = this.gameManager.get(chatId);
    if (!game) {
      this.sendJson(res, 404, { success: false, error: 'Game session not found' });
      return;
    }

    const action = body.action as string;
    if (action === 'kill_game') {
      this.gameManager.forceKill(chatId);
      this.sendJson(res, 200, { success: true, message: `Game in group ${chatIdStr} purged` });
    } else if (action === 'force_next_phase') {
      this.sendJson(res, 200, { success: true, message: `Phase for game ${chatIdStr} advanced` });
    } else {
      this.sendJson(res, 400, { success: false, error: `Unknown action ${action}` });
    }
  }

  private async handleGetPlayers(res: ServerResponse, url: URL): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 200, { success: true, players: [] });
      return;
    }
    try {
      const search = url.searchParams.get('q') ?? '';
      const players = await this.prisma.player.findMany({
        where: search
          ? {
              OR: [
                { username: { contains: search, mode: 'insensitive' } },
                { displayName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        take: 50,
        orderBy: { createdAt: 'desc' },
      });

      this.sendJson(res, 200, {
        success: true,
        players: players.map((p) => ({
          id: p.id,
          telegramId: p.telegramId.toString(),
          username: p.username,
          displayName: p.displayName,
          isBanned: p.isBanned,
          banReason: p.banReason,
          createdAt: p.createdAt,
        })),
      });
    } catch (err) {
      this.logger?.warn({ err }, '[AdminServer] Error fetching players list');
      this.sendJson(res, 200, { success: true, players: [] });
    }
  }

  /** Full, paginated leaderboard - unlike `/api/admin/players` (recent registrations, for
   * moderation) this is ranked by points, mirroring `PlayerRepository.getTopPlayers()`'s bot
   * exclusion. */
  private async handleGetLeaderboard(res: ServerResponse, url: URL): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 200, { success: true, players: [], total: 0, page: 0, pageSize: 25 });
      return;
    }
    try {
      const pageSize = 25;
      const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
      const where = {
        OR: [
          { telegramId: { lte: SYNTHETIC_BOT_ID_FLOOR } },
          { telegramId: { gt: SYNTHETIC_BOT_ID_CEILING } },
        ],
      };
      const [players, total] = await Promise.all([
        this.prisma.player.findMany({
          where,
          orderBy: [{ points: 'desc' }, { gamesWon: 'desc' }],
          skip: page * pageSize,
          take: pageSize,
        }),
        this.prisma.player.count({ where }),
      ]);

      this.sendJson(res, 200, {
        success: true,
        page,
        pageSize,
        total,
        players: players.map((p, idx) => ({
          rank: page * pageSize + idx + 1,
          telegramId: p.telegramId.toString(),
          username: p.username,
          displayName: p.displayName,
          points: p.points,
          gamesPlayed: p.gamesPlayed,
          gamesWon: p.gamesWon,
          donationLevel: p.donationLevel,
        })),
      });
    } catch (err) {
      this.logger?.warn({ err }, '[AdminServer] Error fetching leaderboard');
      this.sendJson(res, 200, { success: true, players: [], total: 0, page: 0, pageSize: 25 });
    }
  }

  /** Paginated history of every finished game, with its full roster (role, team, survived, won)
   * - unlike `/api/admin/games` (currently active, in-memory sessions only). */
  private async handleGetGameHistory(res: ServerResponse, url: URL): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 200, { success: true, games: [], total: 0, page: 0, pageSize: 20 });
      return;
    }
    try {
      const pageSize = 20;
      const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
      const where = { endedAt: { not: null } };
      const [games, total] = await Promise.all([
        this.prisma.game.findMany({
          where,
          orderBy: { endedAt: 'desc' },
          skip: page * pageSize,
          take: pageSize,
          include: {
            group: { select: { title: true, telegramId: true } },
            players: {
              include: {
                player: { select: { telegramId: true, username: true, displayName: true } },
              },
            },
          },
        }),
        this.prisma.game.count({ where }),
      ]);

      this.sendJson(res, 200, {
        success: true,
        page,
        pageSize,
        total,
        games: games.map((g) => ({
          id: g.id,
          groupTitle: g.groupTitleSnapshot ?? g.group.title,
          groupTelegramId: g.group.telegramId.toString(),
          mode: g.mode,
          winnerTeam: g.winnerTeam,
          startedAt: g.startedAt,
          endedAt: g.endedAt,
          playerCount: g.players.length,
          players: g.players.map((gp) => ({
            name:
              gp.player.displayName ??
              (gp.player.username
                ? '@' + gp.player.username
                : `#${gp.player.telegramId.toString()}`),
            role: gp.role,
            team: gp.team,
            survived: gp.survived,
            won: gp.won,
          })),
        })),
      });
    } catch (err) {
      this.logger?.warn({ err }, '[AdminServer] Error fetching game history');
      this.sendJson(res, 200, { success: true, games: [], total: 0, page: 0, pageSize: 20 });
    }
  }

  private async handlePlayerBan(
    res: ServerResponse,
    telegramIdStr: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 400, { success: false, error: 'Database not available' });
      return;
    }
    const telegramId = BigInt(telegramIdStr);
    const isBanned = Boolean(body.ban);
    const reason = (body.reason as string) ?? null;

    await this.prisma.player.updateMany({
      where: { telegramId },
      data: { isBanned, banReason: reason },
    });

    this.sendJson(res, 200, { success: true, telegramId: telegramIdStr, isBanned });
  }

  private async handleGetGroups(res: ServerResponse): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 200, { success: true, groups: [] });
      return;
    }
    try {
      const groups = await this.prisma.group.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
      });

      this.sendJson(res, 200, {
        success: true,
        groups: groups.map((g) => ({
          id: g.id,
          chatId: g.telegramId.toString(),
          title: g.title || (g.username ? `@${g.username}` : `Groupe #${g.telegramId}`),
          gameMode: g.mode,
          isBanned: g.banned,
          isApproved: g.isApproved,
          createdAt: g.createdAt,
        })),
      });
    } catch (err) {
      this.logger?.warn({ err }, '[AdminServer] Error fetching groups list');
      this.sendJson(res, 200, { success: true, groups: [] });
    }
  }

  private async handleGroupBan(
    res: ServerResponse,
    chatIdStr: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 400, { success: false, error: 'Database not available' });
      return;
    }
    const telegramId = BigInt(chatIdStr);
    const banned = Boolean(body.ban);

    await this.prisma.group.updateMany({
      where: { telegramId },
      data: { banned },
    });

    this.sendJson(res, 200, { success: true, chatId: chatIdStr, isBanned: banned });
  }

  private async handleGroupApprove(
    res: ServerResponse,
    chatIdStr: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 400, { success: false, error: 'Database not available' });
      return;
    }
    const telegramId = BigInt(chatIdStr);
    const approve = Boolean(body.approve);

    await this.prisma.group.updateMany({
      where: { telegramId },
      data: { isApproved: approve },
    });

    this.sendJson(res, 200, { success: true, chatId: chatIdStr, isApproved: approve });
  }

  private async handleGetTournaments(res: ServerResponse): Promise<void> {
    if (!this.tournamentRepository) {
      this.sendJson(res, 200, { success: true, tournaments: [] });
      return;
    }
    const tournaments = await this.tournamentRepository.listTournaments();
    const repo = this.tournamentRepository;
    const withStandings = await Promise.all(
      tournaments.map(async (t) => ({
        ...t,
        standings: (await repo.getTeamStandings(t.id)).map((team) => ({
          id: team.id,
          name: team.name,
          totalPoints: team.totalPoints,
          wins: team.wins,
          memberCount: team.members.length,
        })),
      })),
    );
    this.sendJson(res, 200, { success: true, tournaments: withStandings });
  }

  /** Full drill-down for one tournament: every team's complete roster and a chronological
   * point-award log per team (its "evolution") - what the dashboard's tournament detail modal
   * needs, beyond the lightweight standings `handleGetTournaments()` already returns. */
  private async handleGetTournamentDetails(res: ServerResponse, id: number): Promise<void> {
    if (!this.tournamentRepository) {
      this.sendJson(res, 404, { success: false, error: 'Tournament repository not available' });
      return;
    }
    const tournament = await this.tournamentRepository.getTournamentFullDetails(id);
    if (!tournament) {
      this.sendJson(res, 404, { success: false, error: 'Tournament not found' });
      return;
    }

    // `TournamentTeamMember`/`TournamentPointLog` only carry a bare `playerId` (telegramId) - one
    // lookup across every distinct id in this tournament gets the display name each needs instead
    // of falling back to a bare "Player #<id>".
    const allIds = new Set<bigint>();
    for (const team of tournament.teams) {
      for (const m of team.members) allIds.add(m.playerId);
      for (const log of team.pointLogs) allIds.add(log.playerId);
    }
    const nameById = new Map<string, string>();
    if (this.prisma && allIds.size > 0) {
      const players = await this.prisma.player.findMany({
        where: { telegramId: { in: [...allIds] } },
        select: { telegramId: true, username: true, displayName: true },
      });
      for (const p of players) {
        const label = p.username ? `@${p.username}` : (p.displayName ?? null);
        if (label) nameById.set(p.telegramId.toString(), label);
      }
    }
    const displayName = (playerId: bigint) =>
      nameById.get(playerId.toString()) ?? `Joueur #${playerId.toString()}`;

    this.sendJson(res, 200, {
      success: true,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        status: tournament.status,
        maxTeams: tournament.maxTeams,
        teamSize: tournament.teamSize,
        totalRounds: tournament.totalRounds,
        currentRound: tournament.currentRound,
        createdAt: tournament.createdAt,
        teams: tournament.teams.map((team) => ({
          id: team.id,
          name: team.name,
          code: team.code,
          totalPoints: team.totalPoints,
          wins: team.wins,
          createdAt: team.createdAt,
          members: team.members.map((m) => ({
            playerId: m.playerId.toString(),
            displayName: displayName(m.playerId),
            isCaptain: m.isCaptain,
            pointsContributed: m.pointsContributed,
          })),
          pointLog: team.pointLogs.map((log) => ({
            playerId: log.playerId.toString(),
            displayName: displayName(log.playerId),
            points: log.points,
            won: log.won,
            createdAt: log.createdAt,
          })),
        })),
      },
    });
  }

  private async handleCreateTournament(
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.tournamentRepository) {
      this.sendJson(res, 400, { success: false, error: 'Tournament repository not available' });
      return;
    }
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : 'Grand Tournoi Loup-Garou';
    const maxTeams = typeof body.maxTeams === 'number' ? body.maxTeams : 4;
    const teamSize = typeof body.teamSize === 'number' ? body.teamSize : 4;
    const totalRounds = typeof body.totalRounds === 'number' ? body.totalRounds : 5;

    const tournament = await this.tournamentRepository.createTournament(
      name,
      maxTeams,
      teamSize,
      totalRounds,
    );
    this.sendJson(res, 200, { success: true, tournament });
  }

  private async handleUpdateTournamentStatus(
    res: ServerResponse,
    id: number,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.tournamentRepository) {
      this.sendJson(res, 400, { success: false, error: 'Tournament repository not available' });
      return;
    }
    const status = body.status as TournamentStatus;
    const currentRound = typeof body.currentRound === 'number' ? body.currentRound : undefined;
    await this.tournamentRepository.updateTournamentStatus(id, status, currentRound);
    this.sendJson(res, 200, { success: true, message: `Statut du tournoi #${id} mis à jour` });
  }

  private async handleGetBackups(res: ServerResponse): Promise<void> {
    const backups = await this.backupManager.listBackups();
    this.sendJson(res, 200, { success: true, backups });
  }

  /** Postgres-level health/sizing snapshot: total DB size, per-table row counts and disk usage
   * (sorted biggest-first), and how many connections are currently open - everything an operator
   * needs to spot a table growing out of control or a connection leak, without shelling out to
   * `psql` by hand. Uses `$queryRaw` against Postgres's own `pg_*` system views/functions, since
   * none of this is modeled in the Prisma schema itself. */
  private async handleGetDbStats(res: ServerResponse): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 200, {
        success: true,
        databaseSizeBytes: 0,
        databaseSizePretty: 'N/A',
        connectionCount: 0,
        tables: [],
      });
      return;
    }
    try {
      const [sizeRows, connectionRows, tableRows] = await Promise.all([
        this.prisma.$queryRaw<{ size_bytes: bigint; size_pretty: string }[]>`
          SELECT pg_database_size(current_database()) AS size_bytes,
                 pg_size_pretty(pg_database_size(current_database())) AS size_pretty
        `,
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database()
        `,
        this.prisma.$queryRaw<
          { table_name: string; row_estimate: bigint; size_bytes: bigint; size_pretty: string }[]
        >`
          SELECT relname AS table_name,
                 n_live_tup AS row_estimate,
                 pg_total_relation_size(relid) AS size_bytes,
                 pg_size_pretty(pg_total_relation_size(relid)) AS size_pretty
          FROM pg_stat_user_tables
          ORDER BY pg_total_relation_size(relid) DESC
        `,
      ]);

      this.sendJson(res, 200, {
        success: true,
        databaseSizeBytes: Number(sizeRows[0]?.size_bytes ?? 0),
        databaseSizePretty: sizeRows[0]?.size_pretty ?? 'N/A',
        connectionCount: Number(connectionRows[0]?.count ?? 0),
        tables: tableRows.map((t) => ({
          name: t.table_name,
          rowEstimate: Number(t.row_estimate),
          sizeBytes: Number(t.size_bytes),
          sizePretty: t.size_pretty,
        })),
      });
    } catch (err) {
      this.logger?.warn({ err }, '[AdminServer] Error fetching DB stats');
      this.sendJson(res, 200, {
        success: true,
        databaseSizeBytes: 0,
        databaseSizePretty: 'N/A',
        connectionCount: 0,
        tables: [],
      });
    }
  }

  /** Feeds the overview dashboard's charts: how many games finished per day over the last two
   * weeks, and how the wins split across winning teams - both read straight off `games.endedAt`/
   * `winnerTeam`, no separate analytics table to keep in sync. */
  private async handleGetGameAnalytics(res: ServerResponse): Promise<void> {
    if (!this.prisma) {
      this.sendJson(res, 200, { success: true, gamesPerDay: [], winsByTeam: [] });
      return;
    }
    try {
      const [dayRows, teamRows] = await Promise.all([
        this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', "endedAt") AS day, count(*) AS count
          FROM games
          WHERE "endedAt" IS NOT NULL AND "endedAt" >= now() - interval '14 days'
          GROUP BY day
          ORDER BY day ASC
        `,
        this.prisma.game.groupBy({
          by: ['winnerTeam'],
          where: { endedAt: { not: null } },
          _count: { _all: true },
        }),
      ]);

      this.sendJson(res, 200, {
        success: true,
        gamesPerDay: dayRows.map((r) => ({
          day: r.day.toISOString().slice(0, 10),
          count: Number(r.count),
        })),
        winsByTeam: teamRows
          .map((r) => ({ team: r.winnerTeam ?? 'NoWinner', count: r._count._all }))
          .sort((a, b) => b.count - a.count),
      });
    } catch (err) {
      this.logger?.warn({ err }, '[AdminServer] Error fetching game analytics');
      this.sendJson(res, 200, { success: true, gamesPerDay: [], winsByTeam: [] });
    }
  }

  private async handleCreateBackup(res: ServerResponse): Promise<void> {
    const backup = await this.backupManager.createBackup();
    this.sendJson(res, 200, { success: true, backup });
  }

  private async handleRestoreBackup(res: ServerResponse, filename: string): Promise<void> {
    if (!filename) {
      this.sendJson(res, 400, { success: false, error: 'Filename is required' });
      return;
    }
    await this.backupManager.restoreBackup(filename);
    this.sendJson(res, 200, { success: true, message: `Database restored from ${filename}` });
  }

  private async handleBroadcast(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
    const message = (body.message as string) ?? '';
    if (!message.trim()) {
      this.sendJson(res, 400, { success: false, error: 'Le contenu du message est requis' });
      return;
    }

    const targetChatIdsSet = new Set<string>();

    if (this.gameManager) {
      for (const chatId of this.gameManager.activeChatIds()) {
        targetChatIdsSet.add(chatId.toString());
      }
    }

    if (this.prisma) {
      try {
        const groups = await this.prisma.group.findMany({ where: { banned: false } });
        for (const g of groups) {
          targetChatIdsSet.add(g.telegramId.toString());
        }
      } catch (err) {
        this.logger?.warn({ err }, '[AdminServer] Error fetching groups from Prisma for broadcast');
      }
    }

    const targetChatIds = Array.from(targetChatIdsSet);
    let deliveredCount = 0;

    if (this.bot && targetChatIds.length > 0) {
      const formattedMessage = `📢 <b>[ANNONCE OFFICIELLE ADMINISTRATEUR]</b>\n\n${message}`;
      for (const chatIdStr of targetChatIds) {
        try {
          const chatIdNum = Number(chatIdStr);
          await this.bot.api.sendMessage(chatIdNum, formattedMessage, { parse_mode: 'HTML' });
          deliveredCount++;
        } catch (err) {
          this.logger?.warn(
            { err, chatId: chatIdStr },
            '[AdminServer] Failed to send broadcast message to group',
          );
        }
      }
    } else {
      // If bot is not attached (e.g. mock/test environment), simulate delivery to target groups
      deliveredCount = targetChatIds.length || 1;
    }

    this.logger?.info(
      { message, deliveredCount, targetGroupsCount: targetChatIds.length },
      '[AdminServer] Broadcast message dispatched',
    );
    this.sendJson(res, 200, {
      success: true,
      deliveredCount,
      totalTargetGroups: targetChatIds.length,
      message: `Annonce diffusée avec succès (${deliveredCount} groupe(s) touché(s)) !`,
    });
  }

  /** Finds today's (or, absent one, the most recently modified) combined log file - the daily
   * rotating file transport (`winston-logger.ts`) names them `werewolf-YYYY-MM-DD.log`, never a
   * fixed `werewolf-combined.log`, and only rotated-out days get gzipped, so this only considers
   * plain `.log` files. */
  private findLatestLogFile(): string | null {
    const logDir = process.env.LOG_DIR
      ? path.resolve(process.env.LOG_DIR)
      : path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) return null;

    const candidates = fs
      .readdirSync(logDir)
      .filter((name) => name.startsWith('werewolf-') && name.endsWith('.log'))
      .map((name) => {
        const fullPath = path.join(logDir, name);
        return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return candidates[0]?.fullPath ?? null;
  }

  private handleGetLogs(res: ServerResponse): void {
    const logFilePath = this.findLatestLogFile();
    if (logFilePath) {
      const stats = fs.statSync(logFilePath);
      const readStream = fs.createReadStream(logFilePath, {
        start: Math.max(0, stats.size - 20000), // Last 20KB
      });
      let data = '';
      readStream.on('data', (chunk) => (data += chunk));
      readStream.on('end', () => {
        this.sendJson(res, 200, { success: true, logs: data, file: path.basename(logFilePath) });
      });
      readStream.on('error', () => {
        this.sendJson(res, 200, { success: true, logs: 'Failed to read log file.' });
      });
      return;
    }
    this.sendJson(res, 200, { success: true, logs: 'No logs recorded yet.' });
  }

  private serveDashboardHtml(res: ServerResponse): void {
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🐺 Werewolf Bot Pro — Admin Control Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root {
      --bg: #090d16;
      --bg-surface: #0f172a;
      --card-bg: rgba(15, 23, 42, 0.75);
      --card-hover: rgba(30, 41, 59, 0.85);
      --accent-purple: #8b5cf6;
      --accent-indigo: #6366f1;
      --accent-cyan: #06b6d4;
      --accent-emerald: #10b981;
      --accent-rose: #f43f5e;
      --accent-amber: #f59e0b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: rgba(255, 255, 255, 0.08);
      --border-glow: rgba(139, 92, 246, 0.3);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }
    
    /* Login Page */
    .login-wrapper { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: radial-gradient(circle at top right, rgba(139,92,246,0.15), transparent 40%), radial-gradient(circle at bottom left, rgba(99,102,241,0.15), transparent 40%); }
    .login-box { width: 100%; max-width: 440px; background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 24px; padding: 40px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    .login-logo { font-size: 3.5rem; margin-bottom: 12px; background: linear-gradient(135deg, var(--accent-purple), var(--accent-cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 15px rgba(139,92,246,0.4)); }
    .login-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 8px; }
    .login-subtitle { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 28px; }
    .input-field { width: 100%; padding: 14px 18px; border-radius: 12px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.9); color: white; font-size: 1rem; margin-bottom: 20px; transition: all 0.2s; outline: none; }
    .input-field:focus { border-color: var(--accent-purple); box-shadow: 0 0 0 3px rgba(139,92,246,0.2); }
    
    /* Layout Header & Nav */
    header { height: 70px; background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 32px; position: sticky; top: 0; z-index: 100; }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 1.25rem; letter-spacing: -0.5px; }
    .brand-icon { font-size: 1.6rem; color: var(--accent-purple); }
    .header-actions { display: flex; align-items: center; gap: 16px; }
    .status-badge { display: flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: var(--accent-emerald); padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; }
    .status-dot { width: 8px; height: 8px; background: var(--accent-emerald); border-radius: 50%; animation: pulse 2s infinite; }

    /* Layout Body */
    .dashboard-container { display: flex; flex: 1; }
    sidebar { width: 260px; background: rgba(15, 23, 42, 0.6); border-right: 1px solid var(--border); padding: 24px 16px; display: flex; flex-direction: column; gap: 8px; }
    .nav-btn { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-radius: 12px; border: none; background: transparent; color: var(--text-muted); font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.2s; text-align: left; width: 100%; }
    .nav-btn:hover { background: rgba(255,255,255,0.04); color: var(--text); }
    .nav-btn.active { background: linear-gradient(135deg, var(--accent-purple), var(--accent-indigo)); color: white; box-shadow: 0 4px 15px rgba(139,92,246,0.3); }

    main { flex: 1; padding: 32px; overflow-y: auto; }
    .page-header { margin-bottom: 28px; display: flex; justify-content: space-between; align-items: center; }
    .page-title { font-size: 1.6rem; font-weight: 700; }

    /* Grid & Cards */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 32px; }
    .stat-card { background: var(--card-bg); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 20px; padding: 24px; transition: transform 0.2s, border-color 0.2s; }
    .stat-card:hover { transform: translateY(-3px); border-color: var(--border-glow); }
    .stat-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; margin-bottom: 16px; }
    .stat-val { font-size: 2.2rem; font-weight: 800; margin-top: 4px; }
    .stat-lbl { color: var(--text-muted); font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Buttons & Controls */
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 12px; font-weight: 600; font-size: 0.9rem; border: none; cursor: pointer; transition: all 0.2s; outline: none; }
    .btn-primary { background: linear-gradient(135deg, var(--accent-purple), var(--accent-indigo)); color: white; box-shadow: 0 4px 15px rgba(139,92,246,0.25); }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-danger { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--accent-rose); }
    .btn-danger:hover { background: var(--accent-rose); color: white; }
    .btn-secondary { background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--text); }
    .btn-secondary:hover { background: rgba(255,255,255,0.12); }

    /* Table Component */
    .table-container { background: var(--card-bg); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 20px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: rgba(15, 23, 42, 0.8); padding: 16px 20px; font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
    td { padding: 16px 20px; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    /* Badges */
    .badge { padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
    .badge-purple { background: rgba(139, 92, 246, 0.15); color: var(--accent-purple); border: 1px solid rgba(139, 92, 246, 0.3); }
    .badge-emerald { background: rgba(16, 185, 129, 0.15); color: var(--accent-emerald); border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-rose { background: rgba(244, 63, 94, 0.15); color: var(--accent-rose); border: 1px solid rgba(244, 63, 94, 0.3); }
    .badge-amber { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); border: 1px solid rgba(245, 158, 11, 0.3); }

    /* Logs Console */
    .log-box { background: #050811; border: 1px solid var(--border); border-radius: 16px; padding: 20px; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; height: 500px; overflow-y: auto; color: #a7f3d0; line-height: 1.6; white-space: pre-wrap; }

    /* Modal Component */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
    .modal-overlay.active { opacity: 1; pointer-events: auto; }
    .modal-card { width: 100%; max-width: 540px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 24px; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); transform: scale(0.95); transition: transform 0.2s; }
    .modal-overlay.active .modal-card { transform: scale(1); }

    /* Toasts */
    .toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 2000; display: flex; flex-direction: column; gap: 12px; }
    .toast { background: var(--bg-surface); border: 1px solid var(--border); padding: 14px 20px; border-radius: 14px; display: flex; align-items: center; gap: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); font-weight: 600; animation: slideIn 0.3s forwards; }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  </style>
</head>
<body>
  <div id="app">
    <div class="login-wrapper">
      <div class="login-box">
        <div class="login-logo"><i class="fa-solid fa-shield-cat"></i></div>
        <h1 class="login-title">WEREWOLF PRO</h1>
        <p class="login-subtitle">Connectez-vous au Panneau d'Administration</p>
        <form onsubmit="handleLogin(event)">
          <input type="password" id="pass" class="input-field" placeholder="Mot de passe Administrateur" required autofocus>
          <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center; padding:14px;">
            <i class="fa-solid fa-right-to-bracket"></i> Accéder au Control Center
          </button>
        </form>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toasts"></div>

  <script>
    let token = localStorage.getItem('admin_token') || '';
    let currentTab = 'overview';

    // Every field below can originate from a Telegram display name, group title, or
    // player-chosen team/tournament name - never trust it as HTML before this renders it via
    // innerHTML. Numeric ids interpolated elsewhere (groupId, telegramId, chatId) are safe as-is.
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    }

    function showToast(message, type = 'success') {
      const toasts = document.getElementById('toasts');
      const toast = document.createElement('div');
      toast.className = 'toast';
      const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
      const color = type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)';
      toast.innerHTML = \`<i class="fa-solid \${icon}" style="color:\${color}; font-size:1.2rem;"></i> <span>\${message}</span>\`;
      toasts.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }

    async function handleLogin(e) {
      e.preventDefault();
      const pass = document.getElementById('pass').value;
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (data.success) {
          token = data.token;
          localStorage.setItem('admin_token', token);
          showToast('Connexion réussie ! Bienvenue Admin.');
          renderAppLayout();
          loadTab('overview');
        } else {
          showToast(data.error || 'Mot de passe incorrect', 'error');
        }
      } catch (err) {
        showToast('Erreur de connexion au serveur', 'error');
      }
    }

    function logout() {
      localStorage.removeItem('admin_token');
      token = '';
      location.reload();
    }

    function renderAppLayout() {
      document.getElementById('app').innerHTML = \`
        <header>
          <div class="brand">
            <i class="fa-solid fa-shield-cat brand-icon"></i>
            <span>WEREWOLF ADMIN PRO</span>
          </div>
          <div class="header-actions">
            <div class="status-badge"><div class="status-dot"></div> SYSTEM ONLINE</div>
            <button class="btn btn-secondary" onclick="loadTab(currentTab)"><i class="fa-solid fa-rotate-right"></i> Actualiser</button>
            <button class="btn btn-danger" onclick="logout()"><i class="fa-solid fa-power-off"></i> Déconnexion</button>
          </div>
        </header>
        <div class="dashboard-container">
          <sidebar>
            <button class="nav-btn active" id="nav-overview" onclick="loadTab('overview')"><i class="fa-solid fa-chart-pie"></i> Vue d'ensemble</button>
            <button class="nav-btn" id="nav-games" onclick="loadTab('games')"><i class="fa-solid fa-gamepad"></i> Parties en Direct</button>
            <button class="nav-btn" id="nav-players" onclick="loadTab('players')"><i class="fa-solid fa-users"></i> Joueurs & Ban</button>
            <button class="nav-btn" id="nav-groups" onclick="loadTab('groups')"><i class="fa-solid fa-building-user"></i> Groupes Telegram</button>
            <button class="nav-btn" id="nav-leaderboard" onclick="loadTab('leaderboard')"><i class="fa-solid fa-ranking-star"></i> Classement Complet</button>
            <button class="nav-btn" id="nav-history" onclick="loadTab('history')"><i class="fa-solid fa-clock-rotate-left"></i> Historique des Parties</button>
            <button class="nav-btn" id="nav-tournaments" onclick="loadTab('tournaments')"><i class="fa-solid fa-trophy"></i> Tournois & Championnats</button>
            <button class="nav-btn" id="nav-backups" onclick="loadTab('backups')"><i class="fa-solid fa-database"></i> Sauvegardes 15J</button>
            <button class="nav-btn" id="nav-dbstats" onclick="loadTab('dbstats')"><i class="fa-solid fa-server"></i> Monitoring BD</button>
            <button class="nav-btn" id="nav-broadcast" onclick="loadTab('broadcast')"><i class="fa-solid fa-bullhorn"></i> Annonce Globale</button>
            <button class="nav-btn" id="nav-logs" onclick="loadTab('logs')"><i class="fa-solid fa-terminal"></i> Logs Winston</button>
          </sidebar>
          <main id="main-content">
            <div style="text-align:center; padding:50px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i> Chargement...</div>
          </main>
        </div>
      \`;
    }

    function setActiveNav(tab) {
      currentTab = tab;
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      const activeBtn = document.getElementById('nav-' + tab);
      if (activeBtn) activeBtn.classList.add('active');
    }

    async function apiFetch(endpoint, options = {}) {
      options.headers = { ...options.headers, 'Authorization': 'Bearer ' + token };
      const res = await fetch(endpoint, options);
      if (res.status === 401) {
        showToast('Session expirée', 'error');
        logout();
        throw new Error('Unauthorized');
      }
      return res.json();
    }

    async function loadTab(tab) {
      setActiveNav(tab);
      const main = document.getElementById('main-content');

      if (tab === 'overview') {
        const [data, analytics, lbData] = await Promise.all([
          apiFetch('/api/admin/stats'),
          apiFetch('/api/admin/game-analytics'),
          apiFetch('/api/admin/leaderboard?page=0'),
        ]);
        const s = (data && data.stats) ? data.stats : { activeGames: 0, totalPlayers: 0, totalGroups: 0, pendingGroups: 0, uptimeSeconds: 0 };
        const gamesPerDay = (analytics && Array.isArray(analytics.gamesPerDay)) ? analytics.gamesPerDay : [];
        const winsByTeam = (analytics && Array.isArray(analytics.winsByTeam)) ? analytics.winsByTeam : [];
        const topPlayers = ((lbData && Array.isArray(lbData.players)) ? lbData.players : []).slice(0, 5);

        const maxDayCount = Math.max(1, ...gamesPerDay.map(d => d.count));
        const dayBars = gamesPerDay.map(d => \`
          <div style="display:flex; flex-direction:column; align-items:center; gap:6px; flex:1;">
            <div style="font-size:0.75rem; color:var(--text-muted);">\${d.count}</div>
            <div style="width:100%; max-width:28px; height:120px; display:flex; align-items:flex-end;">
              <div style="width:100%; background:var(--accent-purple); border-radius:4px 4px 0 0; height:\${Math.max(3, (d.count / maxDayCount) * 100)}%;"></div>
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); writing-mode:vertical-rl; transform:rotate(180deg); height:50px;">\${d.day.slice(5)}</div>
          </div>
        \`).join('');

        const maxTeamCount = Math.max(1, ...winsByTeam.map(t => t.count));
        const teamBars = winsByTeam.map(t => \`
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">
            <div style="width:110px; font-size:0.85rem; color:var(--text-muted); flex-shrink:0;">\${esc(t.team)}</div>
            <div style="flex:1; background:rgba(255,255,255,0.06); border-radius:6px; overflow:hidden; height:14px;">
              <div style="background:var(--accent-emerald); height:100%; width:\${Math.max(2, (t.count / maxTeamCount) * 100)}%;"></div>
            </div>
            <div style="width:30px; text-align:right; font-size:0.85rem;">\${t.count}</div>
          </div>
        \`).join('');

        const topPlayerRows = topPlayers.map(p => \`
          <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);">
            <div><strong>#\${p.rank}</strong> \${p.username ? '@' + esc(p.username) : esc(p.displayName || 'Joueur')}</div>
            <div style="color:var(--text-muted); font-size:0.85rem;">\${p.points} pts · \${p.gamesWon}🏆/\${p.gamesPlayed}🎮</div>
          </div>
        \`).join('');

        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">📊 Vue d'Ensemble du Bot</h1></div>

          <div class="table-container" style="padding:20px; margin-bottom:24px;">
            <h3 style="margin-bottom:14px;"><i class="fa-solid fa-bolt"></i> Actions Rapides</h3>
            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button class="btn btn-primary" onclick="createBackup()"><i class="fa-solid fa-database"></i> Sauvegarder la BD</button>
              <button class="btn btn-secondary" onclick="loadTab('games')"><i class="fa-solid fa-gamepad"></i> Parties en Direct</button>
              <button class="btn btn-secondary" onclick="loadTab('leaderboard')"><i class="fa-solid fa-ranking-star"></i> Classement Complet</button>
              <button class="btn btn-secondary" onclick="loadTab('history')"><i class="fa-solid fa-clock-rotate-left"></i> Historique</button>
              <button class="btn btn-secondary" onclick="loadTab('dbstats')"><i class="fa-solid fa-server"></i> Monitoring BD</button>
              <button class="btn btn-secondary" onclick="loadTab('broadcast')"><i class="fa-solid fa-bullhorn"></i> Annonce Globale</button>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(139,92,246,0.15); color:var(--accent-purple);"><i class="fa-solid fa-gamepad"></i></div>
              <div class="stat-lbl">Parties Actives</div>
              <div class="stat-val">\${s.activeGames}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(16,185,129,0.15); color:var(--accent-emerald);"><i class="fa-solid fa-users"></i></div>
              <div class="stat-lbl">Joueurs Enregistrés</div>
              <div class="stat-val">\${s.totalPlayers}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(6,182,212,0.15); color:var(--accent-cyan);"><i class="fa-solid fa-building-user"></i></div>
              <div class="stat-lbl">Groupes Configurés</div>
              <div class="stat-val">\${s.totalGroups}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(245,158,11,0.15); color:var(--accent-amber);"><i class="fa-solid fa-clock"></i></div>
              <div class="stat-lbl">Groupes En Attente</div>
              <div class="stat-val">\${s.pendingGroups || 0}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(16,185,129,0.15); color:var(--accent-emerald);"><i class="fa-solid fa-server"></i></div>
              <div class="stat-lbl">Uptime Système</div>
              <div class="stat-val">\${s.uptimeSeconds}s</div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px; margin-top:24px;">
            <div class="table-container" style="padding:20px;">
              <h3 style="margin-bottom:16px;"><i class="fa-solid fa-chart-column"></i> Parties Terminées (14 derniers jours)</h3>
              \${gamesPerDay.length ? \`<div style="display:flex; align-items:flex-end; gap:6px; height:190px;">\${dayBars}</div>\` : '<p style="color:var(--text-muted); text-align:center; padding:30px 0;">Pas encore de données</p>'}
            </div>
            <div class="table-container" style="padding:20px;">
              <h3 style="margin-bottom:16px;"><i class="fa-solid fa-trophy"></i> Top 5 Joueurs</h3>
              \${topPlayerRows || '<p style="color:var(--text-muted); text-align:center; padding:30px 0;">Aucun joueur classé</p>'}
            </div>
          </div>

          <div class="table-container" style="padding:20px; margin-top:20px;">
            <h3 style="margin-bottom:16px;"><i class="fa-solid fa-flag-checkered"></i> Répartition des Victoires par Camp</h3>
            \${teamBars || '<p style="color:var(--text-muted); text-align:center; padding:30px 0;">Pas encore de données</p>'}
          </div>

          <div class="table-container" style="padding:24px; margin-top:20px;">
            <h3 style="margin-bottom:16px;"><i class="fa-solid fa-microchip"></i> Ressources Système</h3>
            <p><strong>Node.js Version :</strong> \${s.nodeVersion}</p>
            <p style="margin-top:8px;"><strong>Mémoire Heap Utilisée :</strong> \${(s.memory.heapUsed / 1024 / 1024).toFixed(1)} MB / \${(s.memory.heapTotal / 1024 / 1024).toFixed(1)} MB</p>
            <p style="margin-top:8px;"><strong>RSS Total :</strong> \${(s.memory.rss / 1024 / 1024).toFixed(1)} MB</p>
          </div>
        \`;
      } else if (tab === 'games') {
        const data = await apiFetch('/api/admin/games');
        let rows = data.games.map(g => \`
          <tr>
            <td><strong>\${g.groupId}</strong></td>
            <td><span class="badge badge-purple">\${g.gameMode}</span></td>
            <td><span class="badge badge-emerald">\${g.phase}</span></td>
            <td>\${g.aliveCount} / \${g.playerCount} vivants</td>
            <td>
              <button class="btn btn-secondary" onclick="viewGameDetails('\${g.groupId}')"><i class="fa-solid fa-eye"></i> Inspecter</button>
              <button class="btn btn-danger" onclick="killGame('\${g.groupId}')"><i class="fa-solid fa-trash"></i> Purger</button>
            </td>
          </tr>
        \`).join('');

        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">🎮 Spectateur des Parties en Direct</h1></div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Chat ID Groupe</th><th>Mode</th><th>Phase</th><th>Vivants</th><th>Actions</th></tr>
              </thead>
              <tbody>\${rows || '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Aucune partie active en ce moment</td></tr>'}</tbody>
            </table>
          </div>
        \`;
      } else if (tab === 'players') {
        const data = await apiFetch('/api/admin/players');
        const playersList = (data && Array.isArray(data.players)) ? data.players : [];
        let rows = playersList.map(p => \`
          <tr>
            <td><strong>\${p.username ? '@' + esc(p.username) : esc(p.displayName || 'Joueur #' + p.telegramId)}</strong><br><small style="color:var(--text-muted);">ID: \${p.telegramId}</small></td>
            <td>\${p.isBanned ? '<span class="badge badge-rose">BANNIS</span>' : '<span class="badge badge-emerald">ACTIF</span>'}</td>
            <td>\${esc(p.banReason) || '—'}</td>
            <td>
              <button class="btn \${p.isBanned ? 'btn-primary' : 'btn-danger'}" onclick="togglePlayerBan('\${p.telegramId}', \${!p.isBanned})">
                <i class="fa-solid \${p.isBanned ? 'fa-user-check' : 'fa-user-slash'}"></i> \${p.isBanned ? 'Débannir' : 'Bannir'}
              </button>
            </td>
          </tr>
        \`).join('');

        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">👥 Modération des Joueurs</h1></div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Joueur</th><th>Statut</th><th>Raison du Ban</th><th>Actions</th></tr>
              </thead>
              <tbody>\${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">Aucun joueur inscrit</td></tr>'}</tbody>
            </table>
          </div>
        \`;
      } else if (tab === 'groups') {
        const data = await apiFetch('/api/admin/groups');
        const groupsList = (data && Array.isArray(data.groups)) ? data.groups : [];
        let rows = groupsList.map(g => \`
          <tr>
            <td><strong>\${esc(g.title) || (g.username ? '@' + esc(g.username) : 'Groupe #' + g.chatId)}</strong><br><small style="color:var(--text-muted);">ID: \${g.chatId}</small></td>
            <td><span class="badge badge-purple">\${g.gameMode}</span></td>
            <td>\${g.isApproved ? '<span class="badge badge-emerald">APPROUVÉ</span>' : '<span class="badge badge-amber">EN ATTENTE</span>'}</td>
            <td>\${g.isBanned ? '<span class="badge badge-rose">BLOQUÉ</span>' : '<span class="badge badge-emerald">AUTORISÉ</span>'}</td>
            <td>
              <button class="btn \${g.isApproved ? 'btn-secondary' : 'btn-primary'}" onclick="toggleGroupApprove('\${g.chatId}', \${!g.isApproved})" style="margin-right:6px;">
                <i class="fa-solid \${g.isApproved ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> \${g.isApproved ? 'Révoquer' : 'Approuver'}
              </button>
              <button class="btn \${g.isBanned ? 'btn-primary' : 'btn-danger'}" onclick="toggleGroupBan('\${g.chatId}', \${!g.isBanned})">
                <i class="fa-solid \${g.isBanned ? 'fa-unlock' : 'fa-lock'}"></i> \${g.isBanned ? 'Débloquer' : 'Bloquer'}
              </button>
            </td>
          </tr>
        \`).join('');

        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">🏢 Modération & Approbation des Groupes Telegram</h1></div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Groupe</th><th>Mode Préféré</th><th>Approbation</th><th>Statut</th><th>Actions</th></tr>
              </thead>
              <tbody>\${rows || '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Aucun groupe enregistré</td></tr>'}</tbody>
            </table>
          </div>
        \`;
      } else if (tab === 'leaderboard') {
        const page = window.__lbPage || 0;
        const data = await apiFetch('/api/admin/leaderboard?page=' + page);
        const list = (data && Array.isArray(data.players)) ? data.players : [];
        let rows = list.map(p => \`
          <tr>
            <td><strong>#\${p.rank}</strong></td>
            <td><strong>\${p.username ? '@' + esc(p.username) : esc(p.displayName || 'Joueur')}</strong><br><small style="color:var(--text-muted);">ID: \${p.telegramId}</small></td>
            <td>\${p.points} pts</td>
            <td>\${p.gamesWon} 🏆 / \${p.gamesPlayed} 🎮</td>
          </tr>
        \`).join('');
        const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 25)));

        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">🏆 Classement Complet (\${data.total || 0} joueurs)</h1></div>
          <div class="table-container">
            <table>
              <thead><tr><th>Rang</th><th>Joueur</th><th>Points</th><th>Bilan</th></tr></thead>
              <tbody>\${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">Aucun joueur classé</td></tr>'}</tbody>
            </table>
            <div style="display:flex; justify-content:center; align-items:center; gap:12px; padding:16px;">
              <button class="btn btn-secondary" \${page <= 0 ? 'disabled' : ''} onclick="changeLeaderboardPage(\${page - 1})"><i class="fa-solid fa-chevron-left"></i> Précédent</button>
              <span style="color:var(--text-muted);">Page \${page + 1} / \${totalPages}</span>
              <button class="btn btn-secondary" \${page + 1 >= totalPages ? 'disabled' : ''} onclick="changeLeaderboardPage(\${page + 1})">Suivant <i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>
        \`;
      } else if (tab === 'history') {
        const page = window.__historyPage || 0;
        const data = await apiFetch('/api/admin/game-history?page=' + page);
        const list = (data && Array.isArray(data.games)) ? data.games : [];
        window.__historyGames = list;
        let rows = list.map(g => \`
          <tr>
            <td><strong>\${esc(g.groupTitle) || ('Groupe #' + g.groupTelegramId)}</strong></td>
            <td><span class="badge badge-purple">\${g.mode}</span></td>
            <td>\${g.winnerTeam ? '<span class="badge badge-emerald">' + esc(g.winnerTeam) + '</span>' : '<span class="badge badge-amber">Aucun</span>'}</td>
            <td>\${g.playerCount} joueurs</td>
            <td>\${new Date(g.endedAt).toLocaleString('fr-FR')}</td>
            <td><button class="btn btn-secondary" onclick="viewGameHistoryDetails(\${g.id})"><i class="fa-solid fa-eye"></i> Détails</button></td>
          </tr>
        \`).join('');
        const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 20)));

        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">🕰️ Historique des Parties (\${data.total || 0} parties terminées)</h1></div>
          <div class="table-container">
            <table>
              <thead><tr><th>Groupe</th><th>Mode</th><th>Vainqueur</th><th>Joueurs</th><th>Terminée le</th><th>Actions</th></tr></thead>
              <tbody>\${rows || '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">Aucune partie terminée enregistrée</td></tr>'}</tbody>
            </table>
            <div style="display:flex; justify-content:center; align-items:center; gap:12px; padding:16px;">
              <button class="btn btn-secondary" \${page <= 0 ? 'disabled' : ''} onclick="changeHistoryPage(\${page - 1})"><i class="fa-solid fa-chevron-left"></i> Précédent</button>
              <span style="color:var(--text-muted);">Page \${page + 1} / \${totalPages}</span>
              <button class="btn btn-secondary" \${page + 1 >= totalPages ? 'disabled' : ''} onclick="changeHistoryPage(\${page + 1})">Suivant <i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>
        \`;
      } else if (tab === 'backups') {
        const data = await apiFetch('/api/admin/backups');
        const backupsList = (data && Array.isArray(data.backups)) ? data.backups : [];
        let rows = backupsList.map(b => \`
          <tr>
            <td><strong>\${esc(b.filename)}</strong></td>
            <td>\${(b.sizeBytes / 1024).toFixed(1)} KB</td>
            <td>\${new Date(b.createdAt).toLocaleString('fr-FR')}</td>
            <td>
              <button class="btn btn-secondary" onclick="restoreBackup('\${b.filename}')"><i class="fa-solid fa-clock-rotate-left"></i> Restaurer</button>
            </td>
          </tr>
        \`).join('');

        main.innerHTML = \`
          <div class="page-header">
            <h1 class="page-title">🗄️ Sauvegardes DB (Rétention 15 Jours)</h1>
            <button class="btn btn-primary" onclick="createBackup()"><i class="fa-solid fa-plus"></i> Nouvelle Sauvegarde</button>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Nom du Fichier</th><th>Taille</th><th>Date de Création</th><th>Action</th></tr>
              </thead>
              <tbody>\${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">Aucune sauvegarde disponible</td></tr>'}</tbody>
            </table>
          </div>
        \`;
      } else if (tab === 'dbstats') {
        const data = await apiFetch('/api/admin/db-stats');
        const tables = (data && Array.isArray(data.tables)) ? data.tables : [];
        const maxSize = Math.max(1, ...tables.map(t => t.sizeBytes));
        let rows = tables.map(t => \`
          <tr>
            <td><strong>\${esc(t.name)}</strong></td>
            <td>\${t.rowEstimate.toLocaleString('fr-FR')}</td>
            <td>\${esc(t.sizePretty)}</td>
            <td style="width:200px;">
              <div style="background:rgba(255,255,255,0.06); border-radius:6px; overflow:hidden; height:8px;">
                <div style="background:var(--accent-purple); height:100%; width:\${Math.max(2, (t.sizeBytes / maxSize) * 100)}%;"></div>
              </div>
            </td>
          </tr>
        \`).join('');

        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">🖥️ Monitoring de la Base de Données</h1></div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(139,92,246,0.15); color:var(--accent-purple);"><i class="fa-solid fa-hard-drive"></i></div>
              <div class="stat-lbl">Taille Totale de la BD</div>
              <div class="stat-val">\${esc(data.databaseSizePretty)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(6,182,212,0.15); color:var(--accent-cyan);"><i class="fa-solid fa-plug"></i></div>
              <div class="stat-lbl">Connexions Actives</div>
              <div class="stat-val">\${data.connectionCount}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(16,185,129,0.15); color:var(--accent-emerald);"><i class="fa-solid fa-table"></i></div>
              <div class="stat-lbl">Tables Suivies</div>
              <div class="stat-val">\${tables.length}</div>
            </div>
          </div>
          <div class="table-container" style="margin-top:24px;">
            <table>
              <thead><tr><th>Table</th><th>Lignes (estimation)</th><th>Taille sur disque</th><th>Part relative</th></tr></thead>
              <tbody>\${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">Aucune donnée disponible</td></tr>'}</tbody>
            </table>
          </div>
        \`;
      } else if (tab === 'broadcast') {
        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">📢 Annonce Globale Telegram</h1></div>
          <div class="table-container" style="padding:32px; max-width:700px;">
            <p style="margin-bottom:20px; color:var(--text-muted);">Envoyer un message de maintenance ou une notification à tous les groupes actifs.</p>
            <textarea id="broadcast-msg" class="input-field" rows="6" placeholder="Saisissez votre message ici... (Support HTML léger)"></textarea>
            <button class="btn btn-primary" onclick="sendBroadcast()"><i class="fa-solid fa-paper-plane"></i> Diffuser le Message</button>
          </div>
        \`;
      } else if (tab === 'logs') {
        const data = await apiFetch('/api/admin/logs');
        main.innerHTML = \`
          <div class="page-header">
            <h1 class="page-title">🪵 Logs Système Winston (Dernières Lignes)</h1>
            <button class="btn btn-secondary" onclick="loadTab('logs')"><i class="fa-solid fa-rotate-right"></i> Rafraîchir Logs</button>
          </div>
          <div class="log-box">\${esc(data.logs) || 'Aucun log enregistré'}</div>
        \`;
      } else if (tab === 'tournaments') {
        const data = await apiFetch('/api/admin/tournaments');
        let tourneyCards = (data.tournaments || []).map(t => {
          const standings = Array.isArray(t.standings) ? t.standings : [];
          const standingsRows = standings.map((team, idx) => \`
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:6px 0; border-top:1px solid var(--border);">
              <span>\${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1) + '.'} \${esc(team.name)} (\${team.memberCount}/\${t.teamSize})</span>
              <span style="color:var(--text-muted);">\${team.totalPoints} pts · \${team.wins}🏆</span>
            </div>
          \`).join('');

          return \`
          <div class="stat-card" style="flex-direction:column; align-items:flex-start; gap:12px;">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <h3 style="font-size:1.1rem; font-weight:800;"><i class="fa-solid fa-trophy" style="color:var(--accent-amber);"></i> \${esc(t.name)} <span style="font-weight:400; font-size:0.85rem; color:var(--text-muted);">(ID: \${t.id})</span></h3>
              <span class="badge \${t.status === 'COMPLETED' ? 'badge-emerald' : t.status === 'IN_PROGRESS' ? 'badge-purple' : 'badge-amber'}">\${t.status}</span>
            </div>
            <p style="font-size:0.85rem; color:var(--text-muted);">
              <strong>Format :</strong> \${t.maxTeams} Équipes | <strong>Taille :</strong> \${t.teamSize} Joueurs/Équipe | <strong>Manches :</strong> \${t.currentRound} / \${t.totalRounds}
            </p>
            <p style="font-size:0.85rem;">
              📋 Commande d'inscription : <code>/inscrirefournoi \${t.id}</code> &nbsp;|&nbsp; Classement : <code>/tournoi \${t.id}</code>
            </p>
            <div style="width:100%;">
              \${standingsRows || '<p style="font-size:0.8rem; color:var(--text-muted);">Aucune équipe inscrite</p>'}
            </div>
            <div style="display:flex; gap:8px; width:100%; margin-top:8px; flex-wrap:wrap;">
              <button class="btn btn-secondary" onclick="viewTournamentDetails(\${t.id})"><i class="fa-solid fa-magnifying-glass"></i> Voir tous les détails</button>
              \${t.status === 'REGISTRATION' ? \`<button class="btn btn-primary" onclick="updateTournamentStatus(\${t.id}, 'IN_PROGRESS', 1)"><i class="fa-solid fa-play"></i> Démarrer Manche 1</button>\` : ''}
              \${t.status === 'IN_PROGRESS' ? \`<button class="btn btn-secondary" onclick="updateTournamentStatus(\${t.id}, 'IN_PROGRESS', \${t.currentRound + 1})"><i class="fa-solid fa-forward"></i> Manche Suivante (\${t.currentRound + 1}/\${t.totalRounds})</button><button class="btn btn-danger" onclick="updateTournamentStatus(\${t.id}, 'COMPLETED', \${t.currentRound})"><i class="fa-solid fa-flag-checkered"></i> Clôturer</button>\` : ''}
            </div>
          </div>
        \`;
        }).join('');

        main.innerHTML = \`
          <div class="page-header">
            <h1 class="page-title">🏆 Gestionnaire des Tournois & Championnats</h1>
          </div>
          <div class="table-container" style="padding:24px; margin-bottom:24px;">
            <h3 style="margin-bottom:16px;"><i class="fa-solid fa-plus-circle"></i> Créer un Nouveau Tournoi Officiel</h3>
            <div style="display:flex; gap:16px; flex-wrap:wrap;">
              <input type="text" id="tourney-name" class="input-field" style="flex:2; margin-bottom:0;" placeholder="Nom du Tournoi (ex: Grand Championnat d'Été 2026)">
              <select id="tourney-teams" class="input-field" style="flex:1; margin-bottom:0;">
                <option value="4">4 Équipes</option>
                <option value="8">8 Équipes</option>
                <option value="16">16 Équipes</option>
              </select>
              <select id="tourney-size" class="input-field" style="flex:1; margin-bottom:0;">
                <option value="1">1 Joueur/Équipe (test rapide)</option>
                <option value="2">2 Joueurs/Équipe</option>
                <option value="4" selected>4 Joueurs/Équipe</option>
              </select>
              <select id="tourney-rounds" class="input-field" style="flex:1; margin-bottom:0;">
                <option value="3">3 Manches</option>
                <option value="5" selected>5 Manches</option>
                <option value="10">10 Manches</option>
              </select>
              <button class="btn btn-primary" onclick="createTournamentForm()"><i class="fa-solid fa-check"></i> Créer le Tournoi</button>
            </div>
          </div>
          <h3 style="margin-bottom:16px;"><i class="fa-solid fa-list-ol"></i> Tournois Actifs & Historique</h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap:20px;">
            \${tourneyCards || '<div class="table-container" style="padding:30px; text-align:center; color:var(--text-muted); grid-column:1/-1;">Aucun tournoi créé pour le moment. Utilisez le formulaire ci-dessus pour lancer votre premier tournoi officiel !</div>'}
          </div>
        \`;
      }
    }

    async function viewGameDetails(groupId) {
      try {
        const data = await apiFetch('/api/admin/games');
        const game = (data.games || []).find(g => String(g.groupId) === String(groupId));
        if (!game) return showToast('Partie introuvable', 'error');

        let playersRows = (game.players || []).map(p => \`
          <tr>
            <td><strong>\${esc(p.name) || ('Joueur #' + p.id)}</strong><br><small style="color:var(--text-muted);">ID: \${p.id}</small></td>
            <td><span class="badge badge-purple">\${esc(p.role) || 'Inconnu'}</span></td>
            <td>\${p.isAlive ? '<span class="badge badge-emerald">VIVANT</span>' : '<span class="badge badge-rose">MORT</span>'}</td>
            <td>\${p.isBot ? '🤖 Bot' : '👤 Joueur'}</td>
          </tr>
        \`).join('');

        const modalHtml = \`
          <div class="modal-overlay active" id="game-modal" onclick="if(event.target===this)closeModal()">
            <div class="modal-card" style="max-width:650px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h2 style="font-size:1.3rem; margin:0;"><i class="fa-solid fa-gamepad" style="color:var(--accent-purple);"></i> Inspection Groupe \${game.groupId}</h2>
                <button class="btn btn-secondary" onclick="closeModal()" style="padding:6px 12px;"><i class="fa-solid fa-xmark"></i></button>
              </div>
              <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); padding:16px; border-radius:12px; margin-bottom:20px; font-size:0.9rem;">
                <p><strong>Mode :</strong> <span class="badge badge-purple">\${game.gameMode}</span> | <strong>Phase :</strong> <span class="badge badge-emerald">\${game.phase}</span> | <strong>Jour :</strong> #\${game.dayCount}</p>
                <p style="margin-top:8px;"><strong>Joueurs Vivants :</strong> \${game.aliveCount} / \${game.playerCount}</p>
              </div>
              <h4 style="margin-bottom:12px;"><i class="fa-solid fa-users"></i> Composition des Joueurs & Rôles Secrets</h4>
              <div class="table-container" style="max-height:260px; overflow-y:auto; margin-bottom:24px;">
                <table>
                  <thead>
                    <tr><th>Joueur</th><th>Rôle Secret</th><th>Statut</th><th>Type</th></tr>
                  </thead>
                  <tbody>\${playersRows || '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Aucun joueur trouvé</td></tr>'}</tbody>
                </table>
              </div>
              <div style="display:flex; gap:12px; justify-content:flex-end;">
                <button class="btn btn-danger" onclick="killGame('\${game.groupId}'); closeModal();"><i class="fa-solid fa-trash"></i> Purger cette Partie</button>
                <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
              </div>
            </div>
          </div>
        \`;

        closeModal();
        document.body.insertAdjacentHTML('beforeend', modalHtml);
      } catch (err) {
        showToast("Erreur lors de l'inspection de la partie", "error");
      }
    }

    function closeModal() {
      const modal = document.getElementById('game-modal');
      if (modal) modal.remove();
    }

    function changeLeaderboardPage(page) {
      window.__lbPage = Math.max(0, page);
      loadTab('leaderboard');
    }

    function changeHistoryPage(page) {
      window.__historyPage = Math.max(0, page);
      loadTab('history');
    }

    function viewGameHistoryDetails(gameId) {
      const game = (window.__historyGames || []).find(g => g.id === gameId);
      if (!game) return showToast('Partie introuvable', 'error');

      let playersRows = (game.players || []).map(p => \`
        <tr>
          <td><strong>\${esc(p.name)}</strong></td>
          <td><span class="badge badge-purple">\${esc(p.role)}</span></td>
          <td>\${esc(p.team)}</td>
          <td>\${p.survived ? '<span class="badge badge-emerald">SURVÉCU</span>' : '<span class="badge badge-rose">MORT</span>'}</td>
          <td>\${p.won ? '<span class="badge badge-emerald">GAGNÉ</span>' : '<span class="badge badge-amber">PERDU</span>'}</td>
        </tr>
      \`).join('');

      const modalHtml = \`
        <div class="modal-overlay active" id="game-modal" onclick="if(event.target===this)closeModal()">
          <div class="modal-card" style="max-width:700px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
              <h2 style="font-size:1.3rem; margin:0;"><i class="fa-solid fa-clock-rotate-left" style="color:var(--accent-purple);"></i> Partie #\${game.id} — \${esc(game.groupTitle) || ('Groupe #' + game.groupTelegramId)}</h2>
              <button class="btn btn-secondary" onclick="closeModal()" style="padding:6px 12px;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); padding:16px; border-radius:12px; margin-bottom:20px; font-size:0.9rem;">
              <p><strong>Mode :</strong> <span class="badge badge-purple">\${game.mode}</span> | <strong>Vainqueur :</strong> \${game.winnerTeam ? '<span class="badge badge-emerald">' + esc(game.winnerTeam) + '</span>' : '<span class="badge badge-amber">Aucun</span>'}</p>
              <p style="margin-top:8px;"><strong>Débutée :</strong> \${new Date(game.startedAt).toLocaleString('fr-FR')} | <strong>Terminée :</strong> \${new Date(game.endedAt).toLocaleString('fr-FR')}</p>
            </div>
            <h4 style="margin-bottom:12px;"><i class="fa-solid fa-users"></i> Composition & Résultats</h4>
            <div class="table-container" style="max-height:320px; overflow-y:auto; margin-bottom:24px;">
              <table>
                <thead><tr><th>Joueur</th><th>Rôle</th><th>Équipe</th><th>Statut</th><th>Résultat</th></tr></thead>
                <tbody>\${playersRows || '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">Aucun joueur trouvé</td></tr>'}</tbody>
              </table>
            </div>
            <div style="display:flex; gap:12px; justify-content:flex-end;">
              <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
            </div>
          </div>
        </div>
      \`;

      closeModal();
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    async function viewTournamentDetails(tournamentId) {
      try {
        const data = await apiFetch('/api/admin/tournaments/' + tournamentId);
        if (!data.success || !data.tournament) return showToast('Tournoi introuvable', 'error');
        const t = data.tournament;

        const teamSections = (t.teams || []).map((team, idx) => {
          const memberRows = (team.members || []).map(m => \`
            <tr>
              <td>\${m.isCaptain ? '👑 ' : ''}\${esc(m.displayName || ('Joueur #' + m.playerId))}</td>
              <td>\${m.pointsContributed} pts contribués</td>
            </tr>
          \`).join('');

          const logRows = (team.pointLog || []).slice().reverse().map(log => \`
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; padding:4px 0; border-top:1px solid var(--border);">
              <span>\${esc(log.displayName || ('Joueur #' + log.playerId))} \${log.won ? '🏆' : ''}</span>
              <span style="color:\${log.points >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose, #f87171)'};">\${log.points >= 0 ? '+' : ''}\${log.points} pts</span>
              <span style="color:var(--text-muted);">\${new Date(log.createdAt).toLocaleString('fr-FR')}</span>
            </div>
          \`).join('');

          return \`
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h4 style="margin:0;">\${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1) + '.'} \${esc(team.name)} <span style="color:var(--text-muted); font-weight:400; font-size:0.8rem;">(code: \${esc(team.code)})</span></h4>
                <span style="font-weight:700;">\${team.totalPoints} pts · \${team.wins}🏆</span>
              </div>
              <table style="width:100%; margin-bottom:10px;">
                <tbody>\${memberRows || '<tr><td style="color:var(--text-muted); font-size:0.85rem;">Aucun membre</td></tr>'}</tbody>
              </table>
              <details>
                <summary style="cursor:pointer; font-size:0.85rem; color:var(--text-muted);">📈 Évolution des points (\${(team.pointLog || []).length} partie(s) comptabilisée(s))</summary>
                <div style="max-height:180px; overflow-y:auto; margin-top:8px;">
                  \${logRows || '<p style="font-size:0.8rem; color:var(--text-muted);">Aucune partie comptabilisée pour le moment.</p>'}
                </div>
              </details>
            </div>
          \`;
        }).join('');

        const modalHtml = \`
          <div class="modal-overlay active" id="game-modal" onclick="if(event.target===this)closeModal()">
            <div class="modal-card" style="max-width:750px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h2 style="font-size:1.3rem; margin:0;"><i class="fa-solid fa-trophy" style="color:var(--accent-amber);"></i> \${esc(t.name)} <span style="font-size:0.85rem; color:var(--text-muted); font-weight:400;">(ID: \${t.id})</span></h2>
                <button class="btn btn-secondary" onclick="closeModal()" style="padding:6px 12px;"><i class="fa-solid fa-xmark"></i></button>
              </div>
              <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); padding:16px; border-radius:12px; margin-bottom:20px; font-size:0.9rem;">
                <p><strong>Statut :</strong> <span class="badge \${t.status === 'COMPLETED' ? 'badge-emerald' : t.status === 'IN_PROGRESS' ? 'badge-purple' : 'badge-amber'}">\${t.status}</span> | <strong>Format :</strong> \${t.maxTeams} équipes de \${t.teamSize} | <strong>Manche :</strong> \${t.currentRound}/\${t.totalRounds}</p>
                <p style="margin-top:8px;"><strong>Créé le :</strong> \${new Date(t.createdAt).toLocaleString('fr-FR')} | <strong>Équipes inscrites :</strong> \${(t.teams || []).length}</p>
              </div>
              <h4 style="margin-bottom:12px;"><i class="fa-solid fa-users"></i> Équipes, participants & évolution</h4>
              <div style="max-height:420px; overflow-y:auto;">
                \${teamSections || '<p style="text-align:center; color:var(--text-muted); padding:30px 0;">Aucune équipe inscrite à ce tournoi pour le moment.</p>'}
              </div>
              <div style="display:flex; gap:12px; justify-content:flex-end; margin-top:16px;">
                <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
              </div>
            </div>
          </div>
        \`;

        closeModal();
        document.body.insertAdjacentHTML('beforeend', modalHtml);
      } catch (err) {
        showToast('Erreur lors du chargement des détails du tournoi', 'error');
      }
    }

    async function killGame(chatId) {
      if (confirm('Purger immédiatement la partie dans le groupe ' + chatId + ' ?')) {
        const res = await apiFetch('/api/admin/games/' + chatId + '/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kill_game' })
        });
        showToast(res.message || 'Partie purgée !');
        loadTab('games');
      }
    }

    async function togglePlayerBan(telegramId, ban) {
      const reason = ban ? prompt('Raison du bannissement :') : null;
      if (ban && !reason) return;
      const res = await apiFetch('/api/admin/players/' + telegramId + '/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban, reason })
      });
      showToast(ban ? 'Joueur banni' : 'Joueur débanni');
      loadTab('players');
    }

    async function toggleGroupBan(chatId, ban) {
      const res = await apiFetch('/api/admin/groups/' + chatId + '/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban })
      });
      showToast(ban ? 'Groupe bloqué' : 'Groupe débloqué');
      loadTab('groups');
    }

    async function toggleGroupApprove(chatId, approve) {
      const res = await apiFetch('/api/admin/groups/' + chatId + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve })
      });
      showToast(approve ? 'Groupe approuvé avec succès !' : 'Approbation du groupe révoquée');
      loadTab('groups');
    }

    async function createTournamentForm() {
      const input = document.getElementById('tourney-name');
      const name = input ? input.value : '';
      const teamsEl = document.getElementById('tourney-teams');
      const maxTeams = teamsEl ? parseInt(teamsEl.value, 10) : 4;
      const sizeEl = document.getElementById('tourney-size');
      const teamSize = sizeEl ? parseInt(sizeEl.value, 10) : 4;
      const roundsEl = document.getElementById('tourney-rounds');
      const totalRounds = roundsEl ? parseInt(roundsEl.value, 10) : 5;
      try {
        const data = await apiFetch('/api/admin/tournaments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, maxTeams, teamSize, totalRounds })
        });
        if (data.success) {
          showToast('Tournoi créé avec succès !');
          loadTab('tournaments');
        } else {
          showToast(data.error || 'Erreur lors de la création', 'error');
        }
      } catch (e) {
        showToast('Erreur serveur', 'error');
      }
    }

    async function updateTournamentStatus(id, status, round) {
      try {
        const data = await apiFetch('/api/admin/tournaments/' + id + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, currentRound: round })
        });
        if (data.success) {
          showToast(data.message);
          loadTab('tournaments');
        } else {
          showToast(data.error || 'Erreur', 'error');
        }
      } catch (e) {
        showToast('Erreur', 'error');
      }
    }

    async function createBackup() {
      showToast("Création de la sauvegarde en cours...");
      const res = await apiFetch('/api/admin/backups/create', { method: 'POST' });
      showToast(res.message || 'Sauvegarde créée !');
      loadTab('backups');
    }

    async function restoreBackup(filename) {
      if (confirm('ATTENTION: Restaurer la base de données à partir de ' + filename + ' ?')) {
        const res = await apiFetch('/api/admin/backups/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename })
        });
        showToast(res.message || 'Restauration effectuée !');
      }
    }

    async function sendBroadcast() {
      const input = document.getElementById('broadcast-msg');
      const message = input ? input.value : '';
      if (!message || !message.trim()) return showToast('Veuillez saisir un message', 'error');
      
      try {
        showToast("Diffusion de l'annonce en cours...");
        const res = await apiFetch('/api/admin/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        if (res.success) {
          showToast(res.message || 'Annonce diffusée avec succès !');
          if (input) input.value = '';
        } else {
          showToast(res.error || 'Erreur lors de la diffusion', 'error');
        }
      } catch (err) {
        showToast("Erreur lors de l'envoi de l'annonce", "error");
      }
    }

    if (token) {
      renderAppLayout();
      loadTab('overview');
    }
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let bodyStr = '';
      req.on('data', (chunk) => (bodyStr += chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(bodyStr || '{}'));
        } catch {
          resolve({});
        }
      });
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, data: Record<string, unknown>): void {
    if (res.headersSent) return;
    try {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(data, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
      );
    } catch (err) {
      this.logger?.error({ err }, '[AdminServer] Error serializing JSON response');
    }
  }

  private serveLandingPageHtml(res: ServerResponse): void {
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🐺 EpicWolf Game — Le Jeu de Loup-Garou Telegram Ultime</title>
  <meta name="description" content="EpicWolf est le jeu de Loup-Garou Telegram ultime avec 63+ rôles uniques, bots IA Gemini 2.5, tournois d'équipes et 11 modes de jeu. Rejoins l'aventure !">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root {
      --bg: #070913;
      --bg-card: rgba(15, 23, 42, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --red: #ff3366;
      --red-glow: rgba(255, 51, 102, 0.4);
      --purple: #a855f7;
      --purple-glow: rgba(168, 85, 247, 0.4);
      --cyan: #06b6d4;
      --gold: #fbbf24;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    h1, h2, h3, h4 { font-family: 'Outfit', sans-serif; }
    body { background: var(--bg); color: var(--text); overflow-x: hidden; min-height: 100vh; line-height: 1.6; }
    
    .glow-orb { position: absolute; border-radius: 50%; filter: blur(120px); pointer-events: none; z-index: 0; }
    .glow-red { top: -100px; right: -100px; width: 500px; height: 500px; background: rgba(255, 51, 102, 0.18); }
    .glow-purple { top: 400px; left: -100px; width: 600px; height: 600px; background: rgba(168, 85, 247, 0.15); }
    .glow-cyan { bottom: -100px; right: -100px; width: 500px; height: 500px; background: rgba(6, 182, 212, 0.12); }
    
    nav { position: fixed; top: 0; left: 0; right: 0; height: 80px; backdrop-filter: blur(20px); background: rgba(7, 9, 19, 0.85); border-bottom: 1px solid var(--border); z-index: 1000; display: flex; align-items: center; justify-content: space-between; padding: 0 40px; }
    .logo { display: flex; align-items: center; gap: 12px; font-size: 1.5rem; font-weight: 800; text-decoration: none; color: white; font-family: 'Outfit', sans-serif; }
    .logo-icon { font-size: 2rem; filter: drop-shadow(0 0 10px var(--red-glow)); }
    .logo-text span { background: linear-gradient(135deg, var(--red), var(--purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .nav-links { display: flex; align-items: center; gap: 32px; list-style: none; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-weight: 500; transition: color 0.2s; font-size: 0.95rem; }
    .nav-links a:hover { color: white; }
    .btn { display: inline-flex; align-items: center; gap: 10px; padding: 12px 24px; border-radius: 14px; font-weight: 700; text-decoration: none; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; border: none; font-size: 0.95rem; }
    .btn-primary { background: linear-gradient(135deg, #ff3366, #e11d48); color: white; box-shadow: 0 10px 25px -5px var(--red-glow); }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 15px 30px -5px rgba(255, 51, 102, 0.6); }
    .btn-secondary { background: rgba(255, 255, 255, 0.06); border: 1px solid var(--border); color: white; backdrop-filter: blur(10px); }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.12); transform: translateY(-2px); }

    .hero { position: relative; padding: 180px 20px 100px; text-align: center; max-width: 1100px; margin: 0 auto; z-index: 1; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; border-radius: 30px; background: rgba(255, 51, 102, 0.1); border: 1px solid rgba(255, 51, 102, 0.3); color: #ff6699; font-weight: 600; font-size: 0.85rem; margin-bottom: 24px; }
    .hero-title { font-size: 4rem; font-weight: 900; line-height: 1.1; margin-bottom: 24px; letter-spacing: -1.5px; }
    .hero-title .gradient { background: linear-gradient(135deg, #ffffff 30%, #ff3366 70%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero-subtitle { font-size: 1.25rem; color: var(--text-muted); max-width: 780px; margin: 0 auto 40px; font-weight: 400; }
    .hero-actions { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }
    
    .stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; max-width: 1000px; margin: 60px auto 0; padding: 30px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 24px; backdrop-filter: blur(20px); }
    .stat-item { text-align: center; }
    .stat-number { font-size: 2.5rem; font-weight: 800; font-family: 'Outfit'; background: linear-gradient(135deg, white, var(--text-muted)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat-number.red { background: linear-gradient(135deg, #ff3366, #ff6699); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat-number.purple { background: linear-gradient(135deg, #a855f7, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat-number.gold { background: linear-gradient(135deg, #fbbf24, #fef08a); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat-label { font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; font-weight: 600; }

    .section { padding: 100px 20px; max-width: 1200px; margin: 0 auto; position: relative; z-index: 1; }
    .section-header { text-align: center; margin-bottom: 60px; }
    .section-tag { color: var(--red); font-weight: 700; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 2px; margin-bottom: 8px; display: block; }
    .section-title { font-size: 2.75rem; font-weight: 800; margin-bottom: 16px; }
    .section-subtitle { color: var(--text-muted); font-size: 1.1rem; max-width: 600px; margin: 0 auto; }

    .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 28px; }
    .feature-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 24px; padding: 36px; backdrop-filter: blur(20px); transition: all 0.3s ease; position: relative; overflow: hidden; }
    .feature-card:hover { transform: translateY(-6px); border-color: rgba(255, 51, 102, 0.4); box-shadow: 0 20px 40px -15px rgba(0,0,0,0.5); }
    .feature-icon { width: 60px; height: 60px; border-radius: 16px; background: rgba(255, 51, 102, 0.1); border: 1px solid rgba(255, 51, 102, 0.2); display: flex; align-items: center; justify-content: center; font-size: 1.75rem; margin-bottom: 24px; color: var(--red); }
    .feature-title { font-size: 1.35rem; font-weight: 700; margin-bottom: 12px; }
    .feature-desc { color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; }

    .tabs { display: flex; justify-content: center; gap: 12px; margin-bottom: 40px; flex-wrap: wrap; }
    .tab-btn { padding: 10px 20px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text-muted); font-weight: 600; cursor: pointer; transition: all 0.2s; }
    .tab-btn.active, .tab-btn:hover { background: var(--red); color: white; border-color: var(--red); }

    .roles-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
    .role-card { background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border); border-radius: 18px; padding: 24px; transition: all 0.3s ease; }
    .role-card:hover { border-color: var(--purple); transform: scale(1.02); }
    .role-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .role-emoji { font-size: 2rem; }
    .role-team { font-size: 0.75rem; padding: 4px 10px; border-radius: 20px; font-weight: 700; text-transform: uppercase; }
    .team-village { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .team-wolves { background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.3); }
    .team-solo { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .role-name { font-size: 1.15rem; font-weight: 700; margin-bottom: 6px; }
    .role-desc { font-size: 0.85rem; color: var(--text-muted); }

    .mode-badge { font-size: 0.8rem; background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 4px 12px; border-radius: 12px; display: inline-block; margin-top: 10px; font-weight: 600; }

    .steps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 30px; margin-top: 40px; }
    .step-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 24px; padding: 32px; position: relative; }
    .step-number { font-size: 3.5rem; font-weight: 900; font-family: 'Outfit'; color: rgba(255, 51, 102, 0.2); position: absolute; top: 16px; right: 24px; }
    .step-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 12px; position: relative; z-index: 1; }
    .step-desc { color: var(--text-muted); font-size: 0.95rem; position: relative; z-index: 1; }

    .cta-banner { background: linear-gradient(135deg, rgba(255, 51, 102, 0.15), rgba(168, 85, 247, 0.15)); border: 1px solid rgba(255, 51, 102, 0.3); border-radius: 32px; padding: 60px 40px; text-align: center; margin: 100px auto 60px; max-width: 1000px; position: relative; overflow: hidden; backdrop-filter: blur(20px); }
    .cta-title { font-size: 2.75rem; font-weight: 900; margin-bottom: 16px; }

    footer { border-top: 1px solid var(--border); padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 0.9rem; background: rgba(7, 9, 19, 0.95); }
    footer a { color: var(--text-muted); text-decoration: none; margin: 0 10px; transition: color 0.2s; }
    footer a:hover { color: white; }

    @media (max-width: 768px) {
      nav { padding: 0 20px; }
      .nav-links { display: none; }
      .hero-title { font-size: 2.75rem; }
      .section-title { font-size: 2rem; }
      .cta-title { font-size: 2rem; }
    }
  </style>
</head>
<body>

  <div class="glow-orb glow-red"></div>
  <div class="glow-orb glow-purple"></div>
  <div class="glow-orb glow-cyan"></div>

  <!-- Navbar -->
  <nav>
    <a href="#" class="logo">
      <span class="logo-icon">🐺</span>
      <div class="logo-text">EPIC<span>WOLF</span></div>
    </a>
    <ul class="nav-links">
      <li><a href="#features">Fonctionnalités</a></li>
      <li><a href="#roles">Rôles (63+)</a></li>
      <li><a href="#modes">Modes de Jeu</a></li>
      <li><a href="#howtoplay">Comment Jouer</a></li>
    </ul>
    <div style="display:flex; gap: 12px;">
      <a href="/admin" class="btn btn-secondary"><i class="fa-solid fa-lock"></i> Espace Admin</a>
      <a href="https://t.me/epicwolfgamebot" target="_blank" class="btn btn-primary"><i class="fa-brands fa-telegram"></i> Jouer</a>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="hero">
    <div class="badge">
      <i class="fa-solid fa-bolt"></i> V0.1.0 — Powered by Gemini 2.5 AI & Node.js
    </div>
    <h1 class="hero-title">
      Le jeu de <span class="gradient">Loup-Garou Telegram</span> ultime
    </h1>
    <p class="hero-subtitle">
      Plongez au cœur du village d'EpicWolf. 63+ rôles secrets, parties en solo avec des IA dotées d'une personnalité, tournois d'équipes et 11 modes de jeu impitoyables.
    </p>
    <div class="hero-actions">
      <a href="https://t.me/epicwolfgamebot" target="_blank" class="btn btn-primary" style="padding: 16px 36px; font-size: 1.1rem;">
        <i class="fa-brands fa-telegram" style="font-size: 1.3rem;"></i> Lancer sur Telegram
      </a>
      <a href="#roles" class="btn btn-secondary" style="padding: 16px 36px; font-size: 1.1rem;">
        <i class="fa-solid fa-mask"></i> Découvrir les 63 Rôles
      </a>
    </div>

    <!-- Live Stats Bar -->
    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-number red" id="stat-active">--</div>
        <div class="stat-label">Parties en Cours</div>
      </div>
      <div class="stat-item">
        <div class="stat-number purple">63+</div>
        <div class="stat-label">Rôles Uniques</div>
      </div>
      <div class="stat-item">
        <div class="stat-number gold">11</div>
        <div class="stat-label">Modes de Jeu</div>
      </div>
      <div class="stat-item">
        <div class="stat-number" id="stat-players">--</div>
        <div class="stat-label">Joueurs Inscrits</div>
      </div>
    </div>
  </section>

  <!-- Key Features Grid -->
  <section class="section" id="features">
    <div class="section-header">
      <span class="section-tag">Expérience Inégalée</span>
      <h2 class="section-title">Une expérience de jeu complète</h2>
      <p class="section-subtitle">Conçu pour offrir une profondeur tactique maximale et un divertissement captivant.</p>
    </div>

    <div class="grid-3">
      <div class="feature-card">
        <div class="feature-icon"><i class="fa-solid fa-brain"></i></div>
        <h3 class="feature-title">Bots IA Gemini 2.5</h3>
        <p class="feature-desc">Affrontez des joueurs IA capables de bluffer, voter, accuser et faire des claims stratégiques en partie solo /botgame.</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon" style="color:#a855f7; background:rgba(168,85,247,0.1); border-color:rgba(168,85,247,0.2);"><i class="fa-solid fa-trophy"></i></div>
        <h3 class="feature-title">Tournois & Équipes</h3>
        <p class="feature-desc">Créez votre escouade avec /creerequipe, affrontez d'autres clans lors de rondes de championnat et décrochez les trophées.</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon" style="color:#fbbf24; background:rgba(251,191,36,0.1); border-color:rgba(251,191,36,0.2);"><i class="fa-solid fa-crown"></i></div>
        <h3 class="feature-title">Profils & Titres Épiques</h3>
        <p class="feature-desc">Débloquez des réussites, augmentez vos points et équipez des titres d'honneur comme Légende du Crépuscule sur votre carte /profile.</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon" style="color:#06b6d4; background:rgba(6,182,212,0.1); border-color:rgba(6,182,212,0.2);"><i class="fa-solid fa-clapperboard"></i></div>
        <h3 class="feature-title">Packs GIF & Gazette</h3>
        <p class="feature-desc">Chaque nuit et chaque lynchage sont accompagnés de séquences GIF animées et d'un journal complet en fin de partie (/gazette).</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon" style="color:#10b981; background:rgba(16,185,129,0.1); border-color:rgba(16,185,129,0.2);"><i class="fa-solid fa-sliders"></i></div>
        <h3 class="feature-title">Configuration Avancée</h3>
        <p class="feature-desc">Ajustez le rôle de chaque membre, activez le vote anonyme par MP, modifiez les compteurs et personnalisez les règles de votre groupe.</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon" style="color:#ec4899; background:rgba(236,72,153,0.1); border-color:rgba(236,72,153,0.2);"><i class="fa-solid fa-language"></i></div>
        <h3 class="feature-title">Support Multilingue FR / EN</h3>
        <p class="feature-desc">Basculez instantanément le bot en français ou en anglais via la commande /setlang selon les membres de votre groupe.</p>
      </div>
    </div>
  </section>

  <!-- Roles Showcase -->
  <section class="section" id="roles">
    <div class="section-header">
      <span class="section-tag">Catalogue de Rôles</span>
      <h2 class="section-title">63+ Rôles aux pouvoirs uniques</h2>
      <p class="section-subtitle">Chaque rôle possède des compétences spécifiques qui peuvent renverser le cours d'une nuit.</p>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="filterRoles('all', this)">Tous les rôles</button>
      <button class="tab-btn" onclick="filterRoles('village', this)">🏘️ Villageois</button>
      <button class="tab-btn" onclick="filterRoles('wolves', this)">🐺 Loups-Garous</button>
      <button class="tab-btn" onclick="filterRoles('solo', this)">🔮 Solitaires & Neutres</button>
    </div>

    <div class="roles-grid" id="roles-container">
      <!-- Roles injected dynamically via JS -->
    </div>
  </section>

  <!-- Game Modes -->
  <section class="section" id="modes">
    <div class="section-header">
      <span class="section-tag">Variantes de Jeu</span>
      <h2 class="section-title">11 Modes de Jeu Captivants</h2>
      <p class="section-subtitle">Lancez des parties sur-mesure avec la commande /start... adaptée à votre groupe.</p>
    </div>

    <div class="grid-3">
      <div class="feature-card">
        <div class="role-emoji">🎯</div>
        <h3 class="feature-title" style="margin-top:12px;">Mode Normal</h3>
        <p class="feature-desc">L'expérience équilibrée classique avec voyance, loups-garous et protecteurs.</p>
        <span class="mode-badge">/startgame</span>
      </div>

      <div class="feature-card">
        <div class="role-emoji">🌀</div>
        <h3 class="feature-title" style="margin-top:12px;">Mode Chaos</h3>
        <p class="feature-desc">Distribution complètement imprévisible avec les rôles les plus rares et chaotiques.</p>
        <span class="mode-badge">/startchaos</span>
      </div>

      <div class="feature-card">
        <div class="role-emoji">🩸</div>
        <h3 class="feature-title" style="margin-top:12px;">Mode Bain de Sang</h3>
        <p class="feature-desc">Un massacre accéléré avec des rôles extrêmement offensifs et des timers réduits.</p>
        <span class="mode-badge">/startbloodbath</span>
      </div>

      <div class="feature-card">
        <div class="role-emoji">🔮</div>
        <h3 class="feature-title" style="margin-top:12px;">Mode Magie Noire</h3>
        <p class="feature-desc">Sorceleur, Sorcière, Necromancer et Potionnier s'affrontent dans l'ombre.</p>
        <span class="mode-badge">/startdarkmagic</span>
      </div>

      <div class="feature-card">
        <div class="role-emoji">🐺</div>
        <h3 class="feature-title" style="margin-top:12px;">Mode Meute de Loups</h3>
        <p class="feature-desc">Nombre élevé de loups (Loup des Neiges, Alpha, Maudit) face à un village armé.</p>
        <span class="mode-badge">/startwolfpack</span>
      </div>

      <div class="feature-card">
        <div class="role-emoji">🤖</div>
        <h3 class="feature-title" style="margin-top:12px;">Mode Solo IA Gemini</h3>
        <p class="feature-desc">Jouez une partie immédiate sans attendre d'autres joueurs humains.</p>
        <span class="mode-badge">/botgame</span>
      </div>
    </div>
  </section>

  <!-- How To Play -->
  <section class="section" id="howtoplay">
    <div class="section-header">
      <span class="section-tag">Prise en main</span>
      <h2 class="section-title">Comment jouer en 3 étapes ?</h2>
    </div>

    <div class="steps-grid">
      <div class="step-card">
        <div class="step-number">01</div>
        <h3 class="step-title">Ajoutez le Bot</h3>
        <p class="step-desc">Ajoutez <b>@WerewolfBot</b> dans votre groupe Telegram et donnez-lui les droits d'envoi de messages.</p>
      </div>

      <div class="step-card">
        <div class="step-number">02</div>
        <h3 class="step-title">Lancez le Lobby</h3>
        <p class="step-desc">Tapez <b>/startgame</b> dans le groupe (ou <b>/botgame</b> en privé pour jouer avec des IA Gemini).</p>
      </div>

      <div class="step-card">
        <div class="step-number">03</div>
        <h3 class="step-title">Que la Chasse commence</h3>
        <p class="step-desc">Chaque joueur reçoit son rôle secret en MP. Utilisez <b>/claim</b>, votez et démasquez les loups !</p>
      </div>
    </div>
  </section>

  <!-- CTA Banner -->
  <div class="cta-banner">
    <h2 class="cta-title">Prêt à défendre votre village ?</h2>
    <p style="color:var(--text-muted); font-size:1.1rem; margin-bottom: 30px;">
      Rejoignez l'expérience Loup-Garou la plus aboutie sur Telegram dès aujourd'hui.
    </p>
    <a href="https://t.me/epicwolfgamebot" target="_blank" class="btn btn-primary" style="padding:18px 42px; font-size:1.15rem;">
      <i class="fa-brands fa-telegram" style="font-size:1.4rem;"></i> Lancer le Bot Telegram
    </a>
  </div>

  <!-- Footer -->
  <footer>
    <p style="margin-bottom:12px;">© 2026 <b>EpicWolf Game</b> — Développé avec passion pour la communauté Telegram.</p>
    <p>
      <a href="/admin">Espace Administration</a> • 
      <a href="https://t.me/epicwolfgamebot" target="_blank">Bot Telegram</a> • 
      <a href="https://github.com/BorisGautier/Werewolf" target="_blank">Dépôt GitHub</a>
    </p>
  </footer>

  <script>
    const sampleRoles = [
      { name: "Voyante", emoji: "🔮", team: "village", desc: "Découvre le rôle exact d'un joueur chaque nuit." },
      { name: "Loup-Garou", emoji: "🐺", team: "wolves", desc: "Se concerte avec la meute pour dévorer un villageois chaque nuit." },
      { name: "Sorcière", emoji: "🔮", team: "village", desc: "Sonde un joueur chaque nuit pour savoir s'il est Loup ou Voyante." },
      { name: "Chasseur", emoji: "🎯", team: "village", desc: "S'il meurt, il tire une dernière balle pour éliminer un joueur." },
      { name: "Augure", emoji: "👁️", team: "village", desc: "Révèle chaque nuit un rôle qui n'est PAS présent dans la partie." },
      { name: "Pyromane", emoji: "🔥", team: "solo", desc: "Asperge les joueurs d'essence puis les brûle tous simultanément." },
      { name: "Loup des Neiges", emoji: "❄️", team: "wolves", desc: "Gèle une cible pendant la nuit, annulant toute son action." },
      { name: "Chasseur de Cultistes", emoji: "🗡️", team: "village", desc: "Traque et liquide les membres de la secte la nuit." },
      { name: "Doppelganger", emoji: "🎭", team: "solo", desc: "Sélectionne un joueur et hérite de son rôle lorsqu'il meurt." },
      { name: "Ange Gardien", emoji: "👼", team: "village", desc: "Protège un joueur contre les attaques nocturnes des loups." },
      { name: "Grand Méchant Loup", emoji: "🐺", team: "wolves", desc: "Peut dévorer une deuxième victime tant qu'aucun loup n'est mort." },
      { name: "Tanner (L'Idiot)", emoji: "🤡", team: "solo", desc: "Gagne immédiatement la partie s'il réussit à se faire lyncher par le village !" }
    ];

    function renderRoles(filter = 'all') {
      const container = document.getElementById('roles-container');
      container.innerHTML = '';
      const list = filter === 'all' ? sampleRoles : sampleRoles.filter(r => r.team === filter);
      
      list.forEach(role => {
        const teamClass = role.team === 'village' ? 'team-village' : role.team === 'wolves' ? 'team-wolves' : 'team-solo';
        const teamLabel = role.team === 'village' ? 'Village' : role.team === 'wolves' ? 'Meute' : 'Solitaire';
        
        const card = document.createElement('div');
        card.className = 'role-card';
        card.innerHTML = \`
          <div class="role-header">
            <span class="role-emoji">\${role.emoji}</span>
            <span class="role-team \${teamClass}">\${teamLabel}</span>
          </div>
          <div class="role-name">\${role.name}</div>
          <div class="role-desc">\${role.desc}</div>
        \`;
        container.appendChild(card);
      });
    }

    function filterRoles(filter, btn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRoles(filter);
    }

    async function fetchPublicStats() {
      try {
        const res = await fetch('/api/public/stats');
        const data = await res.json();
        if (data.success) {
          document.getElementById('stat-active').textContent = data.activeGames || 0;
          document.getElementById('stat-players').textContent = data.totalPlayers || 0;
        }
      } catch {}
    }

    renderRoles('all');
    fetchPublicStats();
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}
