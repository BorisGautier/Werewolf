import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseBackupManager } from '../../src/infrastructure/persistence/db-backup.js';

describe('DatabaseBackupManager', () => {
  const testDir = path.join(process.cwd(), 'scratch', 'test_backups');

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://werewolf:werewolf@localhost:5432/werewolf';
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates backup file directory if not exists', () => {
    const manager = new DatabaseBackupManager({ backupDir: testDir });
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('creates a fallback backup when pg_dump fails or is missing', async () => {
    const manager = new DatabaseBackupManager({ backupDir: testDir });
    const backup = await manager.createBackup();

    expect(backup.filename).toBeTruthy();
    expect(fs.existsSync(backup.filepath)).toBe(true);
    expect(backup.sizeBytes).toBeGreaterThan(0);
  });

  it('lists existing backups in chronological order', async () => {
    const manager = new DatabaseBackupManager({ backupDir: testDir });
    
    // Write two dummy backups
    fs.writeFileSync(path.join(testDir, 'werewolf_db_backup_1.sql.gz'), 'dummy 1');
    fs.writeFileSync(path.join(testDir, 'werewolf_db_backup_2.sql.gz'), 'dummy 2');

    const backups = await manager.listBackups();
    expect(backups.length).toBe(2);
  });

  it('purges backups older than retention days', async () => {
    const manager = new DatabaseBackupManager({ backupDir: testDir, retentionDays: 15 });

    const oldFile = path.join(testDir, 'werewolf_db_backup_old.sql.gz');
    fs.writeFileSync(oldFile, 'old backup content');

    // Set mtime to 20 days ago
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, twentyDaysAgo, twentyDaysAgo);

    const deleted = await manager.cleanupOldBackups();
    expect(deleted).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
  });
});
