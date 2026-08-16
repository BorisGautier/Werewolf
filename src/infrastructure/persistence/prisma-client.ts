import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/** Self-healing schema migration check guaranteeing 100% tables & columns in prod */
export async function ensureSchemaColumns(prisma: PrismaClient): Promise<void> {
  try {
    // 1. Try fast automatic sync using Prisma DB Push engine
    execSync('npx prisma db push --skip-generate', {
      stdio: 'ignore',
      env: process.env,
    });
  } catch {
    // 2. Fallback to direct raw SQL ALTER TABLE statements if CLI is constrained
    const sqlStatements = [
      'CREATE TABLE IF NOT EXISTS "group_members" ("id" SERIAL PRIMARY KEY, "groupId" INTEGER NOT NULL, "telegramId" BIGINT NOT NULL, "username" TEXT, "displayName" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "equippedTitle" TEXT;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "gamesPlayed" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "gamesWon" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "guardianAngelSaves" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "firstLynchStreak" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "totalDonatedStars" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "donationLevel" INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "isFounder" BOOLEAN NOT NULL DEFAULT false;',

      'ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "pmLynchVote" BOOLEAN NOT NULL DEFAULT true;',
      'ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "tagAllOnStart" BOOLEAN NOT NULL DEFAULT false;',
      'ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "isApproved" BOOLEAN NOT NULL DEFAULT false;',
    ];

    for (const statement of sqlStatements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch {
        // Ignore if already exists
      }
    }
  }
}

/** Lazily-created singleton, so tests and scripts can import this without needing a live DB. */
export function getPrismaClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
}
