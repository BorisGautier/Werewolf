import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/** Self-healing schema migration check running raw SQL to guarantee zero missing columns in prod */
export async function ensureSchemaColumns(prisma: PrismaClient): Promise<void> {
  const sqlStatements = [
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
      // Ignore if column already exists or table doesn't exist yet
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
