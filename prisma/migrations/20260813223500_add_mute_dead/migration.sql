-- Migration: add muteDead to groups table
ALTER TABLE "groups" ADD COLUMN "muteDead" BOOLEAN NOT NULL DEFAULT false;
