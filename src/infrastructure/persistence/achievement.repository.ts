import type { PrismaClient } from '@prisma/client';
import { ACHIEVEMENTS, type AchievementCode } from '../../domain/achievements/catalog.js';
import { achievementSeedOps, achievementUnlocks } from '../monitoring/metrics.js';

export interface UnlockedAchievement {
  code: AchievementCode;
  name: string;
  description: string;
  unlockedAt: Date;
}

/** Threshold-based cross-game achievements - "play/survive/kill N times across every game". */
const CUMULATIVE_THRESHOLDS: ReadonlyArray<{ code: AchievementCode; threshold: number }> = [
  { code: 'Dedicated', threshold: 100 },
  { code: 'Obsessed', threshold: 1000 },
  { code: 'Veteran', threshold: 500 },
];

/**
 * Wraps `achievements`/`player_achievements` (the catalog and unlock records) plus the two new
 * cumulative `Player` counters (`guardianAngelSaves`, `firstLynchStreak`) that cross-game
 * achievements need but can't be derived from `game_kills` (a "save" isn't a death) or from a
 * single finished game alone (a streak needs to remember prior games).
 *
 * Single-game achievements are detected by the pure `evaluateGameAchievements()` in
 * `domain/achievements/evaluate.ts` - this repository only handles what genuinely needs the
 * database: seeding the catalog, persisting unlocks, and the handful of achievements that need
 * history from *other* games (`Dedicated`, `Explorer`, `BlackSheep`, `HereJohnny`, `GotYourBack`).
 */
export class AchievementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Idempotently ensures every catalog entry has a matching row - call once at bot startup. */
  async seed(): Promise<void> {
    for (const meta of Object.values(ACHIEVEMENTS)) {
      await this.prisma.achievement.upsert({
        where: { code: meta.code },
        create: { code: meta.code, name: meta.name, description: meta.description },
        update: { name: meta.name, description: meta.description },
      });
    }
    achievementSeedOps.inc();
  }

  /** Records the unlock if new; returns false if the player already had it (or doesn't exist). */
  async unlock(telegramId: bigint, code: AchievementCode): Promise<boolean> {
    const player = await this.prisma.player.findUnique({ where: { telegramId } });
    if (!player) return false;

    const existing = await this.prisma.playerAchievement.findUnique({
      where: { playerId_achievementCode: { playerId: player.id, achievementCode: code } },
    });
    if (existing) return false;

    await this.prisma.playerAchievement.create({
      data: { playerId: player.id, achievementCode: code },
    });
    achievementUnlocks.labels(code).inc();
    return true;
  }

  async remove(telegramId: bigint, code: AchievementCode): Promise<boolean> {
    const player = await this.prisma.player.findUnique({ where: { telegramId } });
    if (!player) return false;
    const result = await this.prisma.playerAchievement.deleteMany({
      where: { playerId: player.id, achievementCode: code },
    });
    return result.count > 0;
  }

  /**
   * `/moveachv`: copies every achievement `fromTelegramId` has unlocked onto `toTelegramId`
   * (e.g. a player who accidentally played under the wrong Telegram account). Already-unlocked
   * codes on the target are left alone; returns how many were newly copied.
   */
  async transferAll(fromTelegramId: bigint, toTelegramId: bigint): Promise<number> {
    const unlocked = await this.listForPlayer(fromTelegramId);
    let moved = 0;
    for (const { code } of unlocked) {
      if (await this.unlock(toTelegramId, code)) moved++;
    }
    return moved;
  }

  async listForPlayer(telegramId: bigint): Promise<UnlockedAchievement[]> {
    const rows = await this.prisma.playerAchievement.findMany({
      where: { player: { telegramId } },
      include: { achievement: true },
      orderBy: { unlockedAt: 'asc' },
    });
    return rows.map((row) => ({
      code: row.achievementCode as AchievementCode,
      name: row.achievement.name,
      description: row.achievement.description,
      unlockedAt: row.unlockedAt,
    }));
  }

  /**
   * Everything DB-dependent that needs to run once a game finishes, beyond the single-game
   * `evaluateGameAchievements()` result the caller already has: cumulative games-played/survived/
   * killed thresholds, group diversity (`Explorer`), the Guardian Angel's running save count
   * (`GotYourBack`), and the `BlackSheep` "lynched first N games running" streak. Returns the
   * newly-unlocked codes per player, for the caller to announce - already-unlocked codes are
   * silently skipped (an achievement only ever unlocks once).
   *
   * `firstLynchVictimTelegramId` and `guardianAngelSavesThisGame` come from the single-game event
   * log the caller (`GameLoop`) already has - see `firstLynchVictimId()` in `evaluate.ts`.
   *
   * `longHaul` carries what the pure evaluator can't see (wall-clock time): the game's real-world
   * duration plus which players were still alive and hadn't fled by the end - an approximation of
   * the original's "still alive at the 1-hour mark", checked periodically as the game went rather
   * than only at the end (see `CheckLongHaul` - a player alive at the 1-hour mark who then died
   * before the game ended would still have earned it there; here they wouldn't).
   */
  async recordGameResult(
    telegramIds: readonly bigint[],
    firstLynchVictimTelegramId: bigint | null,
    guardianAngel: { telegramId: bigint; savesThisGame: number } | null,
    longHaul: { durationMs: number; survivingTelegramIds: readonly bigint[] } | null = null,
  ): Promise<Map<bigint, AchievementCode[]>> {
    const newUnlocks = new Map<bigint, AchievementCode[]>();
    const add = (telegramId: bigint, code: AchievementCode) => {
      const list = newUnlocks.get(telegramId) ?? [];
      list.push(code);
      newUnlocks.set(telegramId, list);
    };

    if (longHaul && longHaul.durationMs >= 60 * 60 * 1000) {
      for (const telegramId of longHaul.survivingTelegramIds) {
        if (await this.unlock(telegramId, 'LongHaul')) add(telegramId, 'LongHaul');
      }
    }

    for (const telegramId of telegramIds) {
      const player = await this.prisma.player.findUnique({ where: { telegramId } });
      if (!player) continue;

      const [played, survived, skKills] = await Promise.all([
        this.prisma.gamePlayer.count({
          where: { playerId: player.id, game: { endedAt: { not: null } } },
        }),
        this.prisma.gamePlayer.count({
          where: { playerId: player.id, survived: true, game: { endedAt: { not: null } } },
        }),
        this.prisma.gameKill.count({
          where: { killer: { playerId: player.id, role: 'SerialKiller' } },
        }),
      ]);

      for (const { code, threshold } of CUMULATIVE_THRESHOLDS) {
        if (played >= threshold && (await this.unlock(telegramId, code))) add(telegramId, code);
      }
      if (survived >= 100 && (await this.unlock(telegramId, 'Survivalist')))
        add(telegramId, 'Survivalist');
      if (skKills >= 50 && (await this.unlock(telegramId, 'HereJohnny')))
        add(telegramId, 'HereJohnny');

      if (await this.checkExplorer(player.id)) {
        if (await this.unlock(telegramId, 'Explorer')) add(telegramId, 'Explorer');
      }

      const wasFirstLynched = firstLynchVictimTelegramId === telegramId;
      const newStreak = wasFirstLynched ? player.firstLynchStreak + 1 : 0;
      await this.prisma.player.update({
        where: { telegramId },
        data: { firstLynchStreak: newStreak },
      });
      if (newStreak >= 3 && (await this.unlock(telegramId, 'BlackSheep')))
        add(telegramId, 'BlackSheep');
    }

    if (guardianAngel && guardianAngel.savesThisGame > 0) {
      const updated = await this.prisma.player.update({
        where: { telegramId: guardianAngel.telegramId },
        data: { guardianAngelSaves: { increment: guardianAngel.savesThisGame } },
      });
      if (
        updated.guardianAngelSaves >= 50 &&
        (await this.unlock(guardianAngel.telegramId, 'GotYourBack'))
      ) {
        add(guardianAngel.telegramId, 'GotYourBack');
      }
    }

    return newUnlocks;
  }

  /** At least 2 finished games each in 10+ different groups. */
  private async checkExplorer(playerDbId: number): Promise<boolean> {
    const rows = await this.prisma.gamePlayer.findMany({
      where: { playerId: playerDbId, game: { endedAt: { not: null } } },
      select: { game: { select: { groupId: true } } },
    });
    const perGroup = new Map<number, number>();
    for (const row of rows)
      perGroup.set(row.game.groupId, (perGroup.get(row.game.groupId) ?? 0) + 1);
    const qualifyingGroups = [...perGroup.values()].filter((count) => count >= 2).length;
    return qualifyingGroups >= 10;
  }
}
