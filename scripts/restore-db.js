#!/usr/bin/env node

/**
 * CLI tool for restoring PostgreSQL backups.
 * Usage: node scripts/restore-db.js [filename]
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const filename = process.argv[2];
const backupDir = path.join(process.cwd(), 'backups');

if (!filename) {
  console.log('Usage: node scripts/restore-db.js <backup_filename.sql.gz>');
  console.log('\nAvailable backups:');
  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir);
    for (const f of files) {
      console.log(` - ${f}`);
    }
  } else {
    console.log(' (No backups directory found)');
  }
  process.exit(1);
}

const filepath = path.join(backupDir, filename);
if (!fs.existsSync(filepath)) {
  console.error(`Error: Backup file not found at ${filepath}`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Error: DATABASE_URL environment variable is required.');
  process.exit(1);
}

console.log(`[DB Restore] Restoring ${filename} to ${dbUrl.replace(/:[^:@]+@/, ':****@')}...`);

try {
  if (filename.endsWith('.sql.gz')) {
    execSync(`gzip -dc "${filepath}" | psql "${dbUrl}"`, { stdio: 'inherit' });
  } else {
    execSync(`psql "${dbUrl}" < "${filepath}"`, { stdio: 'inherit' });
  }
  console.log('✅ Restoration completed successfully!');
} catch (err) {
  console.error('❌ Restore failed:', err.message);
  process.exit(1);
}
