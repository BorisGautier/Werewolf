-- Migration: Add an append-only point-award log per tournament team, so the admin dashboard can
-- show a team's points evolving over time instead of only the current cumulative total.
CREATE TABLE "tournament_point_logs" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "playerId" BIGINT NOT NULL,
    "points" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_point_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tournament_point_logs_teamId_createdAt_idx" ON "tournament_point_logs"("teamId", "createdAt");

ALTER TABLE "tournament_point_logs" ADD CONSTRAINT "tournament_point_logs_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "tournament_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
