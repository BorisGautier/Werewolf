-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('NORMAL', 'CHAOS');

-- CreateEnum
CREATE TYPE "GroupModePreference" AS ENUM ('PLAYER_CHOICE', 'NORMAL', 'CHAOS');

-- CreateEnum
CREATE TYPE "GamePhase" AS ENUM ('DAY', 'LYNCH', 'NIGHT');

-- CreateEnum
CREATE TYPE "ShowRolesEndMode" AS ENUM ('NONE', 'LIVING', 'ALL');

-- CreateEnum
CREATE TYPE "Team" AS ENUM ('VILLAGE', 'CULT', 'WOLF', 'TANNER', 'NEUTRAL', 'SERIAL_KILLER', 'LOVERS', 'ARSONIST', 'SK_HUNTER', 'NO_ONE', 'THIEF');

-- CreateEnum
CREATE TYPE "KillMethod" AS ENUM ('NONE', 'LYNCH', 'EAT', 'SHOOT', 'VISIT_WOLF', 'VISIT_VICTIM', 'GUARD_WOLF', 'DETECTED', 'FLEE', 'HUNT', 'HUNTER_SHOT', 'LOVER_DIED', 'SERIAL_KILLED', 'HUNTER_CULT', 'GUARD_KILLER', 'VISIT_KILLER', 'IDLE', 'SUICIDE', 'STEAL_KILLER', 'CHEMISTRY', 'FALL_GRAVE', 'SPOTTED', 'BURN', 'VISIT_BURNING');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('Villager', 'Drunk', 'Harlot', 'Seer', 'Traitor', 'GuardianAngel', 'Detective', 'Wolf', 'Cursed', 'Gunner', 'Tanner', 'Fool', 'WildChild', 'Beholder', 'ApprenticeSeer', 'Cultist', 'CultistHunter', 'Mason', 'Doppelganger', 'Cupid', 'Hunter', 'SerialKiller', 'Sorcerer', 'AlphaWolf', 'WolfCub', 'Blacksmith', 'ClumsyGuy', 'Mayor', 'Prince', 'Lycan', 'Pacifist', 'WiseElder', 'Oracle', 'Sandman', 'WolfMan', 'Thief', 'Troublemaker', 'Chemist', 'SnowWolf', 'GraveDigger', 'Augur', 'Arsonist', 'Spumpkin');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('DEV', 'GLOBAL_ADMIN', 'LANG_ADMIN');

-- CreateEnum
CREATE TYPE "BanScope" AS ENUM ('SPAM', 'MANUAL');

-- CreateTable
CREATE TABLE "players" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "title" TEXT,
    "username" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "mode" "GroupModePreference" NOT NULL DEFAULT 'PLAYER_CHOICE',
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
    "showRolesEnd" "ShowRolesEndMode" NOT NULL DEFAULT 'ALL',
    "showIds" BOOLEAN NOT NULL DEFAULT false,
    "shufflePlayerList" BOOLEAN NOT NULL DEFAULT false,
    "randomMode" BOOLEAN NOT NULL DEFAULT false,
    "secretLynch" BOOLEAN NOT NULL DEFAULT false,
    "secretLynchShowVotes" BOOLEAN NOT NULL DEFAULT false,
    "secretLynchShowVoters" BOOLEAN NOT NULL DEFAULT false,
    "botInGroup" BOOLEAN NOT NULL DEFAULT true,
    "memberCount" INTEGER,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "inviteLink" TEXT,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "defaultGifPackId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_gif_packs" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_gif_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_disabled_roles" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "role" "RoleName" NOT NULL,

    CONSTRAINT "group_disabled_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "groupTitleSnapshot" TEXT,
    "mode" "GameMode" NOT NULL DEFAULT 'NORMAL',
    "winnerTeam" "Team",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_players" (
    "id" SERIAL NOT NULL,
    "gameId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "role" "RoleName" NOT NULL,
    "team" "Team" NOT NULL,
    "survived" BOOLEAN NOT NULL DEFAULT false,
    "won" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_kills" (
    "id" SERIAL NOT NULL,
    "gameId" INTEGER NOT NULL,
    "victimId" INTEGER NOT NULL,
    "killerId" INTEGER,
    "method" "KillMethod" NOT NULL,
    "phase" "GamePhase" NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_kills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "player_achievements" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "achievementCode" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "role" "AdminRole" NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_bans" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" "BanScope" NOT NULL DEFAULT 'MANUAL',
    "bannedBy" BIGINT,
    "bannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "global_bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_games" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "groupId" BIGINT NOT NULL,

    CONSTRAINT "notify_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "groupId" INTEGER,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "playersSeen" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_telegramId_key" ON "players"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "groups_telegramId_key" ON "groups"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_gif_packs_ownerId_key" ON "custom_gif_packs"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "group_disabled_roles_groupId_role_key" ON "group_disabled_roles"("groupId", "role");

-- CreateIndex
CREATE INDEX "games_groupId_idx" ON "games"("groupId");

-- CreateIndex
CREATE INDEX "game_players_gameId_idx" ON "game_players"("gameId");

-- CreateIndex
CREATE INDEX "game_players_playerId_idx" ON "game_players"("playerId");

-- CreateIndex
CREATE INDEX "game_kills_gameId_idx" ON "game_kills"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "player_achievements_playerId_achievementCode_key" ON "player_achievements"("playerId", "achievementCode");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_telegramId_role_key" ON "admin_users"("telegramId", "role");

-- CreateIndex
CREATE INDEX "global_bans_telegramId_idx" ON "global_bans"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "notify_games_userId_groupId_key" ON "notify_games"("userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_date_groupId_key" ON "daily_stats"("date", "groupId");

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_defaultGifPackId_fkey" FOREIGN KEY ("defaultGifPackId") REFERENCES "custom_gif_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_gif_packs" ADD CONSTRAINT "custom_gif_packs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_disabled_roles" ADD CONSTRAINT "group_disabled_roles_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_kills" ADD CONSTRAINT "game_kills_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_kills" ADD CONSTRAINT "game_kills_victimId_fkey" FOREIGN KEY ("victimId") REFERENCES "game_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_kills" ADD CONSTRAINT "game_kills_killerId_fkey" FOREIGN KEY ("killerId") REFERENCES "game_players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_achievementCode_fkey" FOREIGN KEY ("achievementCode") REFERENCES "achievements"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_telegramId_fkey" FOREIGN KEY ("telegramId") REFERENCES "players"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_bans" ADD CONSTRAINT "global_bans_telegramId_fkey" FOREIGN KEY ("telegramId") REFERENCES "players"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
