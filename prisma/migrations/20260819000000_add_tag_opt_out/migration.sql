-- Migration: Add a per-player opt-out flag for /tagall community-call pings.
ALTER TABLE "players" ADD COLUMN "tagOptOut" BOOLEAN NOT NULL DEFAULT false;
