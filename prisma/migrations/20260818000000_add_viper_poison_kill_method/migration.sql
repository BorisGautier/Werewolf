-- Migration: Add VIPER_POISON to the KillMethod enum (Viper Wolf's delayed poison, resolved at the day/lynch boundary)
ALTER TYPE "KillMethod" ADD VALUE IF NOT EXISTS 'VIPER_POISON';
