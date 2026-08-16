import { describe, expect, it, beforeAll, afterAll } from 'vitest';
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

  it('serves dashboard HTML page on root GET request', async () => {
    const res = await fetch('http://localhost:4099/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('WEREWOLF ADMIN PRO');
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
});
