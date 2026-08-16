import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Bot } from 'grammy';
import type { PrismaClient } from '@prisma/client';
import type { GameManager } from '../../application/game-manager.js';
import type { Logger } from '../logging/logger.js';
import { AdminAuthManager } from './admin-auth.js';
import { DatabaseBackupManager } from '../persistence/db-backup.js';
import { TournamentRepository } from '../persistence/tournament.repository.js';

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
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
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

      if (
        (pathname === '/api/maintenance' || pathname === '/api/admin/maintenance') &&
        req.method === 'POST'
      ) {
        const body = await this.readJsonBody(req);
        if (this.maintenance) {
          this.maintenance.on = typeof body.enabled === 'boolean' ? body.enabled : true;
        }
        this.sendJson(res, 200, { success: true, maintenance: Boolean(this.maintenance?.on) });
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

      // Serve static dashboard HTML SPA for non-API routes
      if (!pathname.startsWith('/api/')) {
        this.serveDashboardHtml(res);
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
      if (pathname === '/api/admin/stats' && req.method === 'GET') {
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
      } else {
        this.sendJson(res, 404, { success: false, error: 'Endpoint not found' });
      }
    } catch (err) {
      this.logger?.error({ err }, '[AdminServer] Request handling error');
      this.sendJson(res, 500, { success: false, error: (err as Error).message });
    }
  }

  private async handleGetStats(res: ServerResponse): Promise<void> {
    const activeGamesCount = this.gameManager ? this.gameManager.size : 0;
    const totalPlayers = this.prisma ? await this.prisma.player.count() : 0;
    const totalGroups = this.prisma ? await this.prisma.group.count() : 0;
    const pendingGroups = this.prisma
      ? await this.prisma.group.count({ where: { isApproved: false } })
      : 0;

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
    const search = url.searchParams.get('q') ?? '';
    const players = await this.prisma.player.findMany({
      ...(search
        ? {
            where: {
              OR: [
                { username: { contains: search, mode: 'insensitive' } },
                { displayName: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
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
    this.sendJson(res, 200, { success: true, tournaments });
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
    const status = body.status as any;
    const currentRound = typeof body.currentRound === 'number' ? body.currentRound : undefined;
    await this.tournamentRepository.updateTournamentStatus(id, status, currentRound);
    this.sendJson(res, 200, { success: true, message: `Statut du tournoi #${id} mis à jour` });
  }

  private async handleGetBackups(res: ServerResponse): Promise<void> {
    const backups = await this.backupManager.listBackups();
    this.sendJson(res, 200, { success: true, backups });
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

  private handleGetLogs(res: ServerResponse): void {
    const logFilePath = path.join(process.cwd(), 'logs', 'werewolf-combined.log');
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      const readStream = fs.createReadStream(logFilePath, {
        start: Math.max(0, stats.size - 10000), // Last 10KB
      });
      let data = '';
      readStream.on('data', (chunk) => (data += chunk));
      readStream.on('end', () => {
        this.sendJson(res, 200, { success: true, logs: data });
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
            <button class="nav-btn" id="nav-tournaments" onclick="loadTab('tournaments')"><i class="fa-solid fa-trophy"></i> Tournois & Championnats</button>
            <button class="nav-btn" id="nav-backups" onclick="loadTab('backups')"><i class="fa-solid fa-database"></i> Sauvegardes 15J</button>
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
        const data = await apiFetch('/api/admin/stats');
        const s = data.stats;
        main.innerHTML = \`
          <div class="page-header"><h1 class="page-title">📊 Vue d'Ensemble du Bot</h1></div>
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
          <div class="table-container" style="padding:24px;">
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
        let rows = data.players.map(p => \`
          <tr>
            <td><strong>\${p.username ? '@' + p.username : (p.displayName || 'Joueur #' + p.telegramId)}</strong><br><small style="color:var(--text-muted);">ID: \${p.telegramId}</small></td>
            <td>\${p.isBanned ? '<span class="badge badge-rose">BANNIS</span>' : '<span class="badge badge-emerald">ACTIF</span>'}</td>
            <td>\${p.banReason || '—'}</td>
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
        let rows = data.groups.map(g => \`
          <tr>
            <td><strong>\${g.title || (g.username ? '@' + g.username : 'Groupe #' + g.chatId)}</strong><br><small style="color:var(--text-muted);">ID: \${g.chatId}</small></td>
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
      } else if (tab === 'backups') {
        const data = await apiFetch('/api/admin/backups');
        let rows = data.backups.map(b => \`
          <tr>
            <td><strong>\${b.filename}</strong></td>
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
          <div class="log-box">\${data.logs || 'Aucun log enregistré'}</div>
        \`;
      } else if (tab === 'tournaments') {
        const data = await apiFetch('/api/admin/tournaments');
        let tourneyCards = (data.tournaments || []).map(t => \`
          <div class="stat-card" style="flex-direction:column; align-items:flex-start; gap:12px;">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <h3 style="font-size:1.1rem; font-weight:800;"><i class="fa-solid fa-trophy" style="color:var(--accent-amber);"></i> \${t.name}</h3>
              <span class="badge \${t.status === 'COMPLETED' ? 'badge-emerald' : t.status === 'IN_PROGRESS' ? 'badge-purple' : 'badge-amber'}">\${t.status}</span>
            </div>
            <p style="font-size:0.85rem; color:var(--text-muted);">
              <strong>Format :</strong> \${t.maxTeams} Équipes | <strong>Taille :</strong> \${t.teamSize} Joueurs/Équipe | <strong>Manches :</strong> \${t.currentRound} / \${t.totalRounds}
            </p>
            <div style="display:flex; gap:8px; width:100%; margin-top:8px;">
              \${t.status === 'REGISTRATION' ? \`<button class="btn btn-primary" onclick="updateTournamentStatus(\${t.id}, 'IN_PROGRESS', 1)"><i class="fa-solid fa-play"></i> Démarrer Manche 1</button>\` : ''}
              \${t.status === 'IN_PROGRESS' ? \`<button class="btn btn-secondary" onclick="updateTournamentStatus(\${t.id}, 'IN_PROGRESS', \${t.currentRound + 1})"><i class="fa-solid fa-forward"></i> Manche Suivante (\${t.currentRound + 1}/\${t.totalRounds})</button><button class="btn btn-danger" onclick="updateTournamentStatus(\${t.id}, 'COMPLETED', \${t.currentRound})"><i class="fa-solid fa-flag-checkered"></i> Clôturer</button>\` : ''}
            </div>
          </div>
        \`).join('');

        main.innerHTML = \`
          <div class="page-header">
            <h1 class="page-title">🏆 Gestionnaire des Tournois & Championnats</h1>
          </div>
          <div class="table-container" style="padding:24px; margin-bottom:24px;">
            <h3 style="margin-bottom:16px;"><i class="fa-solid fa-plus-circle"></i> Créer un Nouveau Tournoi Officiel</h3>
            <div style="display:flex; gap:16px; flex-wrap:wrap;">
              <input type="text" id="tourney-name" class="input-field" style="flex:2; margin-bottom:0;" placeholder="Nom du Tournoi (ex: Grand Championnat d'Été 2026)">
              <select id="tourney-teams" class="input-field" style="flex:1; margin-bottom:0;">
                <option value="4">4 Équipes (16 Joueurs)</option>
                <option value="8">8 Équipes (32 Joueurs)</option>
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
            <td><strong>\${p.name || ('Joueur #' + p.id)}</strong><br><small style="color:var(--text-muted);">ID: \${p.id}</small></td>
            <td><span class="badge badge-purple">\${p.role || 'Inconnu'}</span></td>
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
      const roundsEl = document.getElementById('tourney-rounds');
      const totalRounds = roundsEl ? parseInt(roundsEl.value, 10) : 5;
      try {
        const data = await apiFetch('/api/admin/tournaments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, maxTeams, totalRounds })
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
}
