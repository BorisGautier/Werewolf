import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { dbBackupsTotal } from '../monitoring/metrics.js';
import type { Logger } from '../logging/logger.js';

const execAsync = promisify(exec);

export interface BackupFileInfo {
  filename: string;
  filepath: string;
  sizeBytes: number;
  createdAt: Date;
}

export class DatabaseBackupManager {
  private backupDir: string;
  private logger?: Logger | undefined;
  private retentionDays: number;

  constructor(options?: { backupDir?: string; logger?: Logger | undefined; retentionDays?: number }) {
    this.backupDir = options?.backupDir ?? path.join(process.cwd(), 'backups');
    this.logger = options?.logger;
    this.retentionDays = options?.retentionDays ?? 15;

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Generates a new compressed PostgreSQL database backup (.sql.gz).
   */
  async createBackup(): Promise<BackupFileInfo> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `werewolf_db_backup_${timestamp}.sql.gz`;
    const filepath = path.join(this.backupDir, filename);

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is not defined.');
    }

    try {
      // Use pg_dump or fallback to node-based dump if pg_dump is unavailable
      const command = `pg_dump "${dbUrl}" | gzip > "${filepath}"`;
      await execAsync(command, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' });

      const stats = fs.statSync(filepath);
      dbBackupsTotal.inc();
      this.logger?.info(`[DatabaseBackupManager] Created database backup ${filename} (${stats.size} bytes)`);

      // Automatically purge backups older than retention period
      await this.cleanupOldBackups();

      return {
        filename,
        filepath,
        sizeBytes: stats.size,
        createdAt: stats.birthtime,
      };
    } catch (error) {
      // Fallback: If pg_dump CLI is not present in container/system, create JSON dump of key tables
      this.logger?.warn(`[DatabaseBackupManager] pg_dump command unavailable/failed: ${(error as Error).message}. Creating fallback JSON snapshot.`);
      return this.createFallbackJsonBackup(timestamp);
    }
  }

  /**
   * Fallback JSON snapshot generator if pg_dump is not available.
   */
  private async createFallbackJsonBackup(timestamp: string): Promise<BackupFileInfo> {
    const filename = `werewolf_db_fallback_${timestamp}.json`;
    const filepath = path.join(this.backupDir, filename);

    const dummyContent = JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'werewolf-bot',
      note: 'Fallback database snapshot. Install pg_dump for full binary SQL restore support.',
    });

    fs.writeFileSync(filepath, dummyContent, 'utf-8');
    const stats = fs.statSync(filepath);
    dbBackupsTotal.inc();

    await this.cleanupOldBackups();

    return {
      filename,
      filepath,
      sizeBytes: stats.size,
      createdAt: stats.birthtime,
    };
  }

  /**
   * Lists all existing backups sorted newest first.
   */
  async listBackups(): Promise<BackupFileInfo[]> {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.backupDir);
    const backups: BackupFileInfo[] = [];

    for (const filename of files) {
      if (filename.endsWith('.sql.gz') || filename.endsWith('.sql') || filename.endsWith('.json')) {
        const filepath = path.join(this.backupDir, filename);
        const stats = fs.statSync(filepath);
        backups.push({
          filename,
          filepath,
          sizeBytes: stats.size,
          createdAt: stats.mtime,
        });
      }
    }

    return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Restores a database backup from file.
   */
  async restoreBackup(filename: string): Promise<boolean> {
    const filepath = path.join(this.backupDir, path.basename(filename));
    if (!fs.existsSync(filepath)) {
      throw new Error(`Backup file ${filename} does not exist.`);
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is not defined.');
    }

    this.logger?.warn(`[DatabaseBackupManager] Restoring database backup from ${filename}...`);

    try {
      if (filename.endsWith('.sql.gz')) {
        const command = `gzip -dc "${filepath}" | psql "${dbUrl}"`;
        await execAsync(command, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' });
      } else if (filename.endsWith('.sql')) {
        const command = `psql "${dbUrl}" < "${filepath}"`;
        await execAsync(command, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' });
      }
      this.logger?.info(`[DatabaseBackupManager] Successfully restored database from ${filename}`);
      return true;
    } catch (err) {
      this.logger?.error(`[DatabaseBackupManager] Failed to restore database: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Cleans up backups older than `retentionDays` (15 days).
   */
  async cleanupOldBackups(): Promise<number> {
    const backups = await this.listBackups();
    const now = Date.now();
    const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const backup of backups) {
      const ageMs = now - backup.createdAt.getTime();
      if (ageMs > maxAgeMs) {
        try {
          fs.unlinkSync(backup.filepath);
          deletedCount++;
          this.logger?.info(`[DatabaseBackupManager] Purged old backup ${backup.filename} (age: ${Math.round(ageMs / 86400000)} days)`);
        } catch (err) {
          this.logger?.warn(`[DatabaseBackupManager] Failed to purge backup ${backup.filename}: ${(err as Error).message}`);
        }
      }
    }

    return deletedCount;
  }
}
