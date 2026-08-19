-- CreateTable
CREATE TABLE "disabled_missions" (
    "id" SERIAL NOT NULL,
    "missionId" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disabled_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_completions" (
    "id" SERIAL NOT NULL,
    "playerId" BIGINT NOT NULL,
    "missionId" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "gameId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disabled_missions_missionId_key" ON "disabled_missions"("missionId");

-- CreateIndex
CREATE INDEX "mission_completions_playerId_idx" ON "mission_completions"("playerId");

-- CreateIndex
CREATE INDEX "mission_completions_missionId_idx" ON "mission_completions"("missionId");

