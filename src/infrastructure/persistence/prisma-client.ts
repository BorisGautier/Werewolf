import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/** Self-healing schema migration check running raw SQL DDL to guarantee 100% tables & columns in prod */
export async function ensureSchemaColumns(prisma: PrismaClient): Promise<void> {
  const ddlStatements = [
    // 1. Players table (Parent)
    `CREATE TABLE IF NOT EXISTS "players" (
      "id" SERIAL PRIMARY KEY,
      "telegramId" BIGINT UNIQUE NOT NULL,
      "username" TEXT,
      "displayName" TEXT,
      "languageCode" TEXT,
      "hasStartedPm" BOOLEAN NOT NULL DEFAULT false,
      "isBanned" BOOLEAN NOT NULL DEFAULT false,
      "banReason" TEXT,
      "bannedBy" BIGINT,
      "tempBanCount" INTEGER NOT NULL DEFAULT 0,
      "totalDonatedStars" INTEGER NOT NULL DEFAULT 0,
      "donationLevel" INTEGER NOT NULL DEFAULT 0,
      "isFounder" BOOLEAN NOT NULL DEFAULT false,
      "guardianAngelSaves" INTEGER NOT NULL DEFAULT 0,
      "firstLynchStreak" INTEGER NOT NULL DEFAULT 0,
      "afkCount" INTEGER NOT NULL DEFAULT 0,
      "suspendedUntil" TIMESTAMP(3),
      "points" INTEGER NOT NULL DEFAULT 0,
      "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
      "gamesWon" INTEGER NOT NULL DEFAULT 0,
      "equippedTitle" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 2. Groups table (Parent)
    `CREATE TABLE IF NOT EXISTS "groups" (
      "id" SERIAL PRIMARY KEY,
      "telegramId" BIGINT UNIQUE NOT NULL,
      "title" TEXT,
      "username" TEXT,
      "language" TEXT NOT NULL DEFAULT 'en',
      "mode" TEXT NOT NULL DEFAULT 'PLAYER_CHOICE',
      "dayTimerSeconds" INTEGER NOT NULL DEFAULT 120,
      "nightTimerSeconds" INTEGER NOT NULL DEFAULT 60,
      "lynchTimerSeconds" INTEGER NOT NULL DEFAULT 60,
      "maxExtendSeconds" INTEGER NOT NULL DEFAULT 0,
      "maxPlayers" INTEGER NOT NULL DEFAULT 35,
      "allowExtend" BOOLEAN NOT NULL DEFAULT false,
      "allowFlee" BOOLEAN NOT NULL DEFAULT true,
      "allowNsfw" BOOLEAN NOT NULL DEFAULT false,
      "allowTanner" BOOLEAN NOT NULL DEFAULT true,
      "allowFool" BOOLEAN NOT NULL DEFAULT true,
      "allowCult" BOOLEAN NOT NULL DEFAULT true,
      "allowThief" BOOLEAN NOT NULL DEFAULT true,
      "allowArsonist" BOOLEAN NOT NULL DEFAULT true,
      "thiefFull" BOOLEAN NOT NULL DEFAULT false,
      "burningOverkill" BOOLEAN NOT NULL DEFAULT false,
      "showRolesOnDeath" BOOLEAN NOT NULL DEFAULT true,
      "showRolesEnd" TEXT NOT NULL DEFAULT 'ALL',
      "showIds" BOOLEAN NOT NULL DEFAULT false,
      "shufflePlayerList" BOOLEAN NOT NULL DEFAULT false,
      "randomMode" BOOLEAN NOT NULL DEFAULT false,
      "secretLynch" BOOLEAN NOT NULL DEFAULT false,
      "secretLynchShowVotes" BOOLEAN NOT NULL DEFAULT false,
      "secretLynchShowVoters" BOOLEAN NOT NULL DEFAULT false,
      "pmLynchVote" BOOLEAN NOT NULL DEFAULT true,
      "muteDead" BOOLEAN NOT NULL DEFAULT true,
      "tagAllOnStart" BOOLEAN NOT NULL DEFAULT false,
      "botInGroup" BOOLEAN NOT NULL DEFAULT true,
      "memberCount" INTEGER,
      "preferred" BOOLEAN NOT NULL DEFAULT false,
      "inviteLink" TEXT,
      "banned" BOOLEAN NOT NULL DEFAULT false,
      "isApproved" BOOLEAN NOT NULL DEFAULT false,
      "defaultGifPackId" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 3. Group Members table
    `CREATE TABLE IF NOT EXISTS "group_members" (
      "id" SERIAL PRIMARY KEY,
      "groupId" INTEGER NOT NULL,
      "telegramId" BIGINT NOT NULL,
      "username" TEXT,
      "displayName" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "group_members_groupId_telegramId_key" ON "group_members"("groupId", "telegramId");`,
    `CREATE INDEX IF NOT EXISTS "group_members_groupId_idx" ON "group_members"("groupId");`,

    // 4. Custom Gif Packs
    `CREATE TABLE IF NOT EXISTS "custom_gif_packs" (
      "id" SERIAL PRIMARY KEY,
      "ownerId" INTEGER UNIQUE NOT NULL,
      "submitted" BOOLEAN NOT NULL DEFAULT false,
      "approved" BOOLEAN NOT NULL DEFAULT false,
      "nsfw" BOOLEAN NOT NULL DEFAULT false,
      "approvedBy" BIGINT,
      "villagerDie" TEXT,
      "wolfWin" TEXT,
      "wolvesWin" TEXT,
      "villagersWin" TEXT,
      "noWinner" TEXT,
      "startGame" TEXT,
      "startChaosGame" TEXT,
      "tannerWin" TEXT,
      "cultWins" TEXT,
      "serialKillerWins" TEXT,
      "loversWin" TEXT,
      "skKilled" TEXT,
      "arsonistWins" TEXT,
      "burnToDeath" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 5. Group Disabled Roles
    `CREATE TABLE IF NOT EXISTS "group_disabled_roles" (
      "id" SERIAL PRIMARY KEY,
      "groupId" INTEGER NOT NULL,
      "role" TEXT NOT NULL
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "group_disabled_roles_groupId_role_key" ON "group_disabled_roles"("groupId", "role");`,

    // 6. Games table
    `CREATE TABLE IF NOT EXISTS "games" (
      "id" SERIAL PRIMARY KEY,
      "groupId" INTEGER NOT NULL,
      "groupTitleSnapshot" TEXT,
      "mode" TEXT NOT NULL DEFAULT 'NORMAL',
      "winnerTeam" TEXT,
      "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endedAt" TIMESTAMP(3)
    );`,

    // 7. Game Players table
    `CREATE TABLE IF NOT EXISTS "game_players" (
      "id" SERIAL PRIMARY KEY,
      "gameId" INTEGER NOT NULL,
      "playerId" INTEGER NOT NULL,
      "role" TEXT NOT NULL,
      "team" TEXT NOT NULL,
      "survived" BOOLEAN NOT NULL DEFAULT false,
      "won" BOOLEAN NOT NULL DEFAULT false
    );`,

    // 8. Game Kills table
    `CREATE TABLE IF NOT EXISTS "game_kills" (
      "id" SERIAL PRIMARY KEY,
      "gameId" INTEGER NOT NULL,
      "victimId" INTEGER NOT NULL,
      "killerId" INTEGER,
      "method" TEXT NOT NULL,
      "phase" TEXT NOT NULL,
      "dayNumber" INTEGER NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 9. Achievements table
    `CREATE TABLE IF NOT EXISTS "achievements" (
      "code" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "description" TEXT NOT NULL
    );`,

    // 10. Player Achievements table
    `CREATE TABLE IF NOT EXISTS "player_achievements" (
      "id" SERIAL PRIMARY KEY,
      "playerId" INTEGER NOT NULL,
      "achievementCode" TEXT NOT NULL,
      "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "player_achievements_playerId_achievementCode_key" ON "player_achievements"("playerId", "achievementCode");`,

    // 11. Admin Users table
    `CREATE TABLE IF NOT EXISTS "admin_users" (
      "id" SERIAL PRIMARY KEY,
      "telegramId" BIGINT NOT NULL,
      "role" TEXT NOT NULL
    );`,

    // 12. Global Bans table
    `CREATE TABLE IF NOT EXISTS "global_bans" (
      "id" SERIAL PRIMARY KEY,
      "telegramId" BIGINT NOT NULL,
      "reason" TEXT NOT NULL,
      "scope" TEXT NOT NULL DEFAULT 'MANUAL',
      "bannedBy" BIGINT,
      "bannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" TIMESTAMP(3)
    );`,

    // 13. Notify Games table
    `CREATE TABLE IF NOT EXISTS "notify_games" (
      "id" SERIAL PRIMARY KEY,
      "userId" BIGINT NOT NULL,
      "groupId" BIGINT NOT NULL
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "notify_games_userId_groupId_key" ON "notify_games"("userId", "groupId");`,

    // 14. Daily Stats table
    `CREATE TABLE IF NOT EXISTS "daily_stats" (
      "id" SERIAL PRIMARY KEY,
      "date" DATE NOT NULL,
      "groupId" INTEGER,
      "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
      "playersSeen" INTEGER NOT NULL DEFAULT 0
    );`,

    // 15. Player Reports table
    `CREATE TABLE IF NOT EXISTS "player_reports" (
      "id" SERIAL PRIMARY KEY,
      "reporterId" BIGINT NOT NULL,
      "reportedId" BIGINT NOT NULL,
      "groupId" BIGINT,
      "reason" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 16. Tournaments table
    `CREATE TABLE IF NOT EXISTS "tournaments" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'DRAFT',
      "maxTeams" INTEGER NOT NULL DEFAULT 4,
      "teamSize" INTEGER NOT NULL DEFAULT 4,
      "totalRounds" INTEGER NOT NULL DEFAULT 5,
      "currentRound" INTEGER NOT NULL DEFAULT 0,
      "createdById" BIGINT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 17. Tournament Teams table
    `CREATE TABLE IF NOT EXISTS "tournament_teams" (
      "id" SERIAL PRIMARY KEY,
      "tournamentId" INTEGER,
      "name" TEXT NOT NULL,
      "tag" TEXT,
      "code" TEXT UNIQUE NOT NULL,
      "totalPoints" INTEGER NOT NULL DEFAULT 0,
      "wins" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 18. Tournament Team Members table
    `CREATE TABLE IF NOT EXISTS "tournament_team_members" (
      "id" SERIAL PRIMARY KEY,
      "teamId" INTEGER NOT NULL,
      "playerId" BIGINT NOT NULL,
      "isCaptain" BOOLEAN NOT NULL DEFAULT false,
      "pointsContributed" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 19. Tournament Rounds table
    `CREATE TABLE IF NOT EXISTS "tournament_rounds" (
      "id" SERIAL PRIMARY KEY,
      "tournamentId" INTEGER NOT NULL,
      "roundNumber" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // Column ADD checks for existing tables
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
    'ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "muteDead" BOOLEAN NOT NULL DEFAULT true;',

    ...[
      'Villager',
      'Drunk',
      'Harlot',
      'Seer',
      'Traitor',
      'GuardianAngel',
      'Detective',
      'Wolf',
      'Cursed',
      'Gunner',
      'Tanner',
      'Fool',
      'WildChild',
      'Beholder',
      'ApprenticeSeer',
      'Cultist',
      'CultistHunter',
      'Mason',
      'Doppelganger',
      'Cupid',
      'Hunter',
      'SerialKiller',
      'Sorcerer',
      'AlphaWolf',
      'WolfCub',
      'Blacksmith',
      'ClumsyGuy',
      'Mayor',
      'Prince',
      'Lycan',
      'Pacifist',
      'WiseElder',
      'Oracle',
      'Sandman',
      'WolfMan',
      'Thief',
      'Troublemaker',
      'Chemist',
      'SnowWolf',
      'GraveDigger',
      'Augur',
      'Arsonist',
      'Spumpkin',
      'Watchman',
      'Judge',
      'Archivist',
      'Tracker',
      'Priestess',
      'Mimic',
      'CrownPrince',
      'Archangel',
      'TrapperWolf',
      'ChameleonWolf',
      'ViperWolf',
      'HowlerWolf',
      'HypnotistWolf',
      'BerserkerWolf',
      'Necromancer',
      'Jester',
      'Hitman',
      'Reflector',
      'Avenger',
      'Crow',
    ].map((role) => `ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS '${role}';`),
  ];

  for (const statement of ddlStatements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (err) {
      console.warn(
        `[ensureSchemaColumns] Notice on statement (${statement.slice(0, 40)}...):`,
        err,
      );
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
