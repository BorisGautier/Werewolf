-- Migration: Reconciles the migration history with `schema.prisma`. Several tables/columns were
-- added to the schema by earlier work (the tournament feature, /tagall's group-member tracking,
-- the 20-new-roles batch) but their corresponding migrations were never generated/committed -
-- `db push` (or equivalent) must have been used against dev at some point instead of `migrate
-- dev`, so local environments already had these objects while the versioned migration history
-- did not. This surfaced as migration `20260820000000_add_tournament_point_log` failing with
-- "relation tournament_teams does not exist" on any environment whose database was built purely
-- by replaying migrations (a fresh CI database, or a production database that's never drifted).
--
-- Written defensively (IF NOT EXISTS / IF EXISTS / ADD VALUE IF NOT EXISTS) throughout, since
-- this environment's actual production database state relative to this drift isn't observable
-- from here - it should succeed unchanged whether the target already has some of these objects
-- (from its own past drift) or none of them (a genuinely fresh database).

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum: the 20 roles added across this project's "20 new roles" + wolf-subtype work.
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Watchman';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Judge';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Archivist';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Tracker';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Priestess';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Mimic';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'CrownPrince';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Archangel';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'TrapperWolf';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'ChameleonWolf';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'ViperWolf';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'HowlerWolf';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'HypnotistWolf';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'BerserkerWolf';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Necromancer';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Jester';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Hitman';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Reflector';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Avenger';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'Crow';

-- AlterTable
ALTER TABLE "groups" ALTER COLUMN "muteDead" SET DEFAULT true;

-- AlterTable: never read by any generated Prisma type (current schema has no `updatedAt` field
-- on PlayerReport), safe to drop wherever it still lingers.
ALTER TABLE "player_reports" DROP COLUMN IF EXISTS "updatedAt";

-- CreateTable
CREATE TABLE IF NOT EXISTS "group_members" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tournaments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "maxTeams" INTEGER NOT NULL DEFAULT 4,
    "teamSize" INTEGER NOT NULL DEFAULT 4,
    "totalRounds" INTEGER NOT NULL DEFAULT 5,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "createdById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tournament_teams" (
    "id" SERIAL NOT NULL,
    "tournamentId" INTEGER,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "code" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tournament_point_logs" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "playerId" BIGINT NOT NULL,
    "points" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_point_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tournament_team_members" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "playerId" BIGINT NOT NULL,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "pointsContributed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tournament_rounds" (
    "id" SERIAL NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "group_members_groupId_idx" ON "group_members"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "group_members_groupId_telegramId_key" ON "group_members"("groupId", "telegramId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_teams_code_key" ON "tournament_teams"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tournament_point_logs_teamId_createdAt_idx" ON "tournament_point_logs"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_team_members_teamId_playerId_key" ON "tournament_team_members"("teamId", "playerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "player_reports_reporterId_idx" ON "player_reports"("reporterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "player_reports_reportedId_idx" ON "player_reports"("reportedId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "tournament_teams" ADD CONSTRAINT "tournament_teams_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "tournament_point_logs" ADD CONSTRAINT "tournament_point_logs_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "tournament_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "tournament_team_members" ADD CONSTRAINT "tournament_team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "tournament_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "tournament_rounds" ADD CONSTRAINT "tournament_rounds_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
