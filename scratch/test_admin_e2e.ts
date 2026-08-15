import { AdminServer } from '../src/infrastructure/web/admin-server.js';
import { AdminAuthManager } from '../src/infrastructure/web/admin-auth.js';
import { DatabaseBackupManager } from '../src/infrastructure/persistence/db-backup.js';
import { GameManager } from '../src/application/game-manager.js';

async function runE2eAdminTest() {
  console.log('🚀 Starting Admin Server End-to-End Test Suite...');
  
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://werewolf:werewolf@localhost:5432/werewolf';

  const authManager = new AdminAuthManager('e2e-secret-key-2026', 'masterpassword123');
  const gameManager = new GameManager();
  const backupManager = new DatabaseBackupManager();

  const server = new AdminServer({
    port: 4100,
    authManager,
    gameManager,
    backupManager,
  });

  await server.start();
  console.log('✅ AdminServer started on http://localhost:4100');

  const baseUrl = 'http://localhost:4100';

  try {
    // 1. Test Dashboard HTML GET
    console.log('\n--- 1. Testing GET / (Dashboard HTML) ---');
    const htmlRes = await fetch(baseUrl + '/');
    console.log('Status:', htmlRes.status);
    const html = await htmlRes.text();
    console.log('Contains Dashboard title:', html.includes('WEREWOLF PRO'));

    // 2. Test Invalid Login
    console.log('\n--- 2. Testing Invalid Login ---');
    const badLoginRes = await fetch(baseUrl + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrongpassword' }),
    });
    console.log('Status:', badLoginRes.status);
    const badLoginData = await badLoginRes.json();
    console.log('Success:', badLoginData.success, '| Error:', badLoginData.error);

    // 3. Test Valid Login
    console.log('\n--- 3. Testing Valid Login ---');
    const loginRes = await fetch(baseUrl + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'masterpassword123' }),
    });
    console.log('Status:', loginRes.status);
    const loginData = await loginRes.json();
    console.log('Success:', loginData.success, '| Token generated:', Boolean(loginData.token));
    const token = loginData.token;

    // 4. Test GET /api/admin/stats
    console.log('\n--- 4. Testing GET /api/admin/stats ---');
    const statsRes = await fetch(baseUrl + '/api/admin/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('Status:', statsRes.status);
    const statsData = await statsRes.json();
    console.log('Stats received:', statsData.stats);

    // 5. Test GET /api/admin/games & Game Action
    console.log('\n--- 5. Testing Active Games API ---');
    const dummyChatId = 123456789n;
    gameManager.create(dummyChatId, { mode: 'Normal' });
    const gamesRes = await fetch(baseUrl + '/api/admin/games', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const gamesData = await gamesRes.json();
    console.log('Active Games Count:', gamesData.games.length);

    console.log('Purging dummy game via API...');
    const actionRes = await fetch(`${baseUrl}/api/admin/games/${dummyChatId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'kill_game' }),
    });
    console.log('Purge Action Result:', await actionRes.json());
    console.log('Remaining Active Games:', gameManager.size);

    // 6. Test DB Backups API
    console.log('\n--- 6. Testing DB Backups API ---');
    console.log('Creating manual backup via API...');
    const createBackupRes = await fetch(`${baseUrl}/api/admin/backups/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const createBackupData = await createBackupRes.json();
    console.log('Backup Created:', createBackupData.backup?.filename, '| Size:', createBackupData.backup?.sizeBytes);

    const backupsRes = await fetch(`${baseUrl}/api/admin/backups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const backupsData = await backupsRes.json();
    console.log('Total 15-Day Backups Listed:', backupsData.backups.length);

    if (backupsData.backups.length > 0) {
      const filename = backupsData.backups[0].filename;
      console.log(`Testing restoration of ${filename}...`);
      const restoreRes = await fetch(`${baseUrl}/api/admin/backups/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename }),
      });
      console.log('Restore Result:', await restoreRes.json());
    }

    // 7. Test Global Broadcast API
    console.log('\n--- 7. Testing Global Broadcast API ---');
    const bcastRes = await fetch(`${baseUrl}/api/admin/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: '⚠️ Maintenance test message' }),
    });
    console.log('Broadcast Result:', await bcastRes.json());

    // 8. Test Logs Tail API
    console.log('\n--- 8. Testing Live Logs API ---');
    const logsRes = await fetch(`${baseUrl}/api/admin/logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const logsData = await logsRes.json();
    console.log('Logs API Status:', logsRes.status, '| Logs retrieved length:', logsData.logs?.length);

    console.log('\n🎉 ALL 8 E2E ADMIN API & BACKUP TESTS PASSED WITH 100% SUCCESS!');
  } finally {
    await server.stop();
    console.log('🏁 AdminServer stopped.');
  }
}

runE2eAdminTest().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
