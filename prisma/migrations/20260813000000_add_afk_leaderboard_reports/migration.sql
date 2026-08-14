-- Migration: add AFK tracking, leaderboard points, and player reports
-- Add AFK and suspension fields to players
ALTER TABLE "players" ADD COLUMN "afkCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "suspendedUntil" TIMESTAMP(3);

-- Add leaderboard fields to players
ALTER TABLE "players" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "gamesPlayed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "gamesWon" INTEGER NOT NULL DEFAULT 0;

-- Create ReportStatus enum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

-- Create PlayerReport table
CREATE TABLE "player_reports" (
    "id" SERIAL NOT NULL,
    "reporterId" BIGINT NOT NULL,
    "reportedId" BIGINT NOT NULL,
    "groupId" BIGINT,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_reports_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "players"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "players"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
