import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

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
