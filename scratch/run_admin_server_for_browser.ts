import { AdminServer } from '../src/infrastructure/web/admin-server.js';
import { AdminAuthManager } from '../src/infrastructure/web/admin-auth.js';
import { DatabaseBackupManager } from '../src/infrastructure/persistence/db-backup.js';
import { GameManager } from '../src/application/game-manager.js';

async function main() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://werewolf:werewolf@localhost:5432/werewolf';

  const authManager = new AdminAuthManager('browser-secret-2026', 'admin123');
  const gameManager = new GameManager();
  const backupManager = new DatabaseBackupManager();

  // Create a dummy game for live spectator test
  const dummyChatId = -100987654321n;
  gameManager.create(dummyChatId, { mode: 'Chaos' });

  const server = new AdminServer({
    port: 4000,
    authManager,
    gameManager,
    backupManager,
  });

  await server.start();
  console.log('🚀 AdminServer live on http://localhost:4000 for browser subagent testing...');

  // Keep process alive for 3 minutes
  await new Promise((resolve) => setTimeout(resolve, 180_000));
  await server.stop();
}

main().catch(console.error);
