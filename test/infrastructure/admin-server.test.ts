import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { AdminServer } from '../../src/infrastructure/web/admin-server.js';
import { AdminAuthManager } from '../../src/infrastructure/web/admin-auth.js';

describe('AdminServer REST API & Dashboard', () => {
  const authManager = new AdminAuthManager('test-secret-key-99', 'test-password');
  const server = new AdminServer({
    port: 4099,
    authManager,
  });

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('serves landing HTML page on root GET request', async () => {
    const res = await fetch('http://localhost:4099/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('EpicWolf Game');
    expect(html).toContain('Loup-Garou Telegram');
  });

  it('serves admin dashboard HTML page on /admin GET request', async () => {
    const res = await fetch('http://localhost:4099/admin');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Admin Control Center');
  });

  it('rejects invalid login credentials', async () => {
    const res = await fetch('http://localhost:4099/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrongpassword' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });

  it('authenticates valid login and issues JWT token', async () => {
    const res = await fetch('http://localhost:4099/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.token).toBeTruthy();
  });

  it('blocks unauthorized access without token', async () => {
    const res = await fetch('http://localhost:4099/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('allows access to protected API endpoints with valid Bearer token', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.stats.activeGames).toBeDefined();
    expect(body.stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('lists live active games', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/games', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.games)).toBe(true);
  });

  it('lists the full leaderboard (empty/graceful without a DB configured)', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/leaderboard', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.players)).toBe(true);
    expect(body.page).toBe(0);
  });

  it('lists finished-game history (empty/graceful without a DB configured)', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/game-history', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.games)).toBe(true);
    expect(body.page).toBe(0);
  });

  it('404s a tournament detail lookup without a DB configured', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/tournaments/1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });

  it('lists the full mission catalog, every one enabled by default without a DB configured', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/missions', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.missions).toHaveLength(30);
    expect(body.missions.every((m: any) => m.enabled === true)).toBe(true);
    expect(body.missions.every((m: any) => m.attempts === 0 && m.successRate === null)).toBe(true);
  });

  it('lists mission top performers (empty/graceful without a DB configured)', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/missions/top-performers', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.performers).toEqual([]);
  });

  it('rejects toggling a mission when no mission repository is available', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/missions/survivor/toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });

  it('rejects toggling access without a token', async () => {
    const res = await fetch('http://localhost:4099/api/admin/missions/survivor/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(401);
  });

  it('reports game analytics (empty/graceful without a DB configured)', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/game-analytics', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.gamesPerDay)).toBe(true);
    expect(Array.isArray(body.winsByTeam)).toBe(true);
  });

  it('reports DB stats (empty/graceful without a DB configured)', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/db-stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.tables)).toBe(true);
    expect(body.databaseSizeBytes).toBe(0);
  });

  it('lists database backups', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/backups', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.backups)).toBe(true);
  });

  it('handles group approval requests', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4099/api/admin/groups/-10012345/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve: true }),
    });
    // Returns 400 when Prisma DB is not wired into isolated test server instance
    expect([200, 400]).toContain(res.status);
  });

  it('rejects toggling maintenance mode without a token', async () => {
    const res = await fetch('http://localhost:4099/api/admin/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(401);
  });

  it('toggles maintenance mode with a valid token', async () => {
    const maintenance = { on: false };
    const maintenanceServer = new AdminServer({
      port: 4098,
      authManager,
      maintenance,
    });
    await maintenanceServer.start();
    try {
      const token = authManager.generateToken('admin');
      const res = await fetch('http://localhost:4098/api/admin/maintenance', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.maintenance).toBe(true);
      expect(maintenance.on).toBe(true);
    } finally {
      await maintenanceServer.stop();
    }
  });

  it('does not send an Access-Control-Allow-Origin header for an unlisted origin', async () => {
    const res = await fetch('http://localhost:4099/api/admin/stats', {
      headers: {
        Authorization: `Bearer ${authManager.generateToken('admin')}`,
        Origin: 'https://evil.example.com',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('hides internal error details from 500 responses', async () => {
    const res = await fetch('http://localhost:4099/api/admin/groups//ban', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authManager.generateToken('admin')}`,
        'Content-Type': 'application/json',
      },
      body: 'not valid json{{{',
    });
    if (res.status === 500) {
      const body = (await res.json()) as any;
      expect(body.error).toBe('Internal server error');
    } else {
      expect([400, 404]).toContain(res.status);
    }
  });
});

describe('AdminServer - mission management with a wired repository', () => {
  const authManager = new AdminAuthManager('test-secret-key-99', 'test-password');
  const missionRepository = {
    getDisabledMissionIds: async () => new Set(['ghost']),
    getMissionStats: async () => [{ missionId: 'survivor', attempts: 10, successes: 7 }],
    getTopPerformers: async () => [
      {
        playerId: 42n,
        username: 'alice',
        displayName: 'Alice',
        attempts: 10,
        successes: 7,
        successRate: 70,
      },
    ],
    setMissionEnabled: vi.fn(async () => {}),
    recordCompletion: async () => {},
  } as unknown as import('../../src/infrastructure/persistence/mission.repository.js').MissionRepository;
  const server = new AdminServer({ port: 4097, authManager, missionRepository });

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('reflects the disabled set and per-mission stats in the catalog', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4097/api/admin/missions', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as any;

    const ghost = body.missions.find((m: any) => m.id === 'ghost');
    expect(ghost.enabled).toBe(false);
    const survivor = body.missions.find((m: any) => m.id === 'survivor');
    expect(survivor.attempts).toBe(10);
    expect(survivor.successRate).toBe(70);
  });

  it('lists real top performers', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4097/api/admin/missions/top-performers', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as any;

    expect(body.performers).toEqual([
      { playerId: '42', displayName: '@alice', attempts: 10, successes: 7, successRate: 70 },
    ]);
  });

  it('toggles a known mission through the repository', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4097/api/admin/missions/ghost/toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    expect(missionRepository.setMissionEnabled).toHaveBeenCalledWith('ghost', true);
  });

  it('rejects toggling an unknown mission id', async () => {
    const token = authManager.generateToken('admin');
    const res = await fetch('http://localhost:4097/api/admin/missions/not-a-real-mission/toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe('AdminAuthManager production safety', () => {
  it('throws when JWT_SECRET/ADMIN_PASSWORD are unset in production', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.JWT_SECRET;
    const prevPassword = process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_PASSWORD;
    try {
      expect(() => new AdminAuthManager()).toThrow();
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prevPassword;
    }
  });

  it('reads the JWT_SECRET/ADMIN_PASSWORD env vars actually used in deployment', async () => {
    const prevSecret = process.env.JWT_SECRET;
    const prevPassword = process.env.ADMIN_PASSWORD;
    process.env.JWT_SECRET = 'env-secret';
    process.env.ADMIN_PASSWORD = 'env-password';
    try {
      const manager = new AdminAuthManager();
      expect(manager.verifyPassword('env-password')).toBe(true);
      expect(manager.verifyPassword('wrong')).toBe(false);
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prevPassword;
    }
  });
});
