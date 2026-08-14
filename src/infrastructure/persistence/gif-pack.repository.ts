import type { PrismaClient } from '@prisma/client';

/**
 * The fourteen announcement types a custom gif pack can cover - mirrors `CustomGifData`'s
 * fields. `VillagerDie` is the generic "someone died at night" clip; `BurnToDeath` and `SKKilled`
 * are its Arsonist/Serial-Killer-specific overrides.
 */
export type GifCategory =
  | 'VillagerDie'
  | 'WolfWin'
  | 'WolvesWin'
  | 'VillagersWin'
  | 'NoWinner'
  | 'StartGame'
  | 'StartChaosGame'
  | 'TannerWin'
  | 'CultWins'
  | 'SerialKillerWins'
  | 'LoversWin'
  | 'SKKilled'
  | 'ArsonistWins'
  | 'BurnToDeath'
  | 'NightStart'
  | 'DayStart'
  | 'LynchStart'
  | 'WolfAttack'
  | 'HunterShot'
  | 'WitchPotionKill'
  | 'WitchPotionSave'
  | 'SeerVision'
  | 'FoolVision'
  | 'ApprenticeSeerPromote'
  | 'CultConvert'
  | 'CultHunterKill'
  | 'GAGuard'
  | 'HarlotVisit'
  | 'HarlotVisitedWolf'
  | 'HarlotTargetEaten'
  | 'CupidLovers'
  | 'LoverDied'
  | 'WildChildTransform'
  | 'DoppelgangerSwap'
  | 'WolfCubDeath'
  | 'AlphaWolfInfect'
  | 'GraveDiggerDig'
  | 'GraveDiggerFall'
  | 'ArsonistDouse'
  | 'ArsonistSpark'
  | 'AugurBirds'
  | 'SnowWolfFreeze'
  | 'SandmanSleep'
  | 'BlacksmithSilver'
  | 'TroublemakerBrawl'
  | 'PacifistPeace'
  | 'MayorReveal'
  | 'PrinceSurvived'
  | 'WatchmanWatch'
  | 'JudgePardon'
  | 'ArchivistRecords'
  | 'TrackerTrack'
  | 'PriestessBless'
  | 'MimicImitate'
  | 'CrownPrincePromote'
  | 'ArchangelBullet'
  | 'TrapperWolfTrap'
  | 'ChameleonWolfDisguise'
  | 'ViperWolfPoison'
  | 'HowlerWolfHowl'
  | 'HypnotistWolfMindControl'
  | 'BerserkerWolfRage'
  | 'NecromancerResurrect'
  | 'JesterWin'
  | 'HitmanTargetEliminated'
  | 'ReflectorReflect'
  | 'AvengerRivalLynched'
  | 'CrowCurse';

export const GIF_CATEGORIES: readonly GifCategory[] = [
  'VillagerDie',
  'WolfWin',
  'WolvesWin',
  'VillagersWin',
  'NoWinner',
  'StartGame',
  'StartChaosGame',
  'TannerWin',
  'CultWins',
  'SerialKillerWins',
  'LoversWin',
  'SKKilled',
  'ArsonistWins',
  'BurnToDeath',
  'NightStart',
  'DayStart',
  'LynchStart',
  'WolfAttack',
  'HunterShot',
  'WitchPotionKill',
  'WitchPotionSave',
  'SeerVision',
  'FoolVision',
  'ApprenticeSeerPromote',
  'CultConvert',
  'CultHunterKill',
  'GAGuard',
  'HarlotVisit',
  'HarlotVisitedWolf',
  'HarlotTargetEaten',
  'CupidLovers',
  'LoverDied',
  'WildChildTransform',
  'DoppelgangerSwap',
  'WolfCubDeath',
  'AlphaWolfInfect',
  'GraveDiggerDig',
  'GraveDiggerFall',
  'ArsonistDouse',
  'ArsonistSpark',
  'AugurBirds',
  'SnowWolfFreeze',
  'SandmanSleep',
  'BlacksmithSilver',
  'TroublemakerBrawl',
  'PacifistPeace',
  'MayorReveal',
  'PrinceSurvived',
  'WatchmanWatch',
  'JudgePardon',
  'ArchivistRecords',
  'TrackerTrack',
  'PriestessBless',
  'MimicImitate',
  'CrownPrincePromote',
  'ArchangelBullet',
  'TrapperWolfTrap',
  'ChameleonWolfDisguise',
  'ViperWolfPoison',
  'HowlerWolfHowl',
  'HypnotistWolfMindControl',
  'BerserkerWolfRage',
  'NecromancerResurrect',
  'JesterWin',
  'HitmanTargetEliminated',
  'ReflectorReflect',
  'AvengerRivalLynched',
  'CrowCurse',
];

/** Prisma column name for each category - `villagerDie`, `wolfWin`, ... (camelCase of the enum). */
function column(category: GifCategory): string {
  return category.charAt(0).toLowerCase() + category.slice(1);
}

export interface GifPackSummary {
  id: number;
  ownerTelegramId: bigint;
  submitted: boolean;
  approved: boolean;
  nsfw: boolean;
  fileIds: Partial<Record<GifCategory, string>>;
}

/**
 * Wraps `custom_gif_packs` - one row per player who has ever submitted a custom gif pack (port of
 * `CustomGifData`). No pack ships pre-populated in this migration (no access to the original's
 * CDN) - every field starts `null`, and `getApprovedFileId` simply returns `null` until a real
 * pack is submitted and approved, which is exactly today's (gif-less) behavior.
 */
export class GifPackRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Creates the pack row on first use; `submitted` flips true so it shows up for review. */
  async submitGif(telegramId: bigint, category: GifCategory, fileId: string): Promise<boolean> {
    const player = await this.prisma.player.findUnique({ where: { telegramId } });
    if (!player) return false;

    await this.prisma.customGifPack.upsert({
      where: { ownerId: player.id },
      create: { ownerId: player.id, submitted: true, [column(category)]: fileId },
      update: { submitted: true, approved: false, [column(category)]: fileId },
    });
    return true;
  }

  async setNsfw(telegramId: bigint, nsfw: boolean): Promise<boolean> {
    const player = await this.prisma.player.findUnique({ where: { telegramId } });
    if (!player) return false;
    const updated = await this.prisma.customGifPack.updateMany({ where: { ownerId: player.id }, data: { nsfw } });
    return updated.count > 0;
  }

  async approve(telegramId: bigint, approvedBy: bigint): Promise<boolean> {
    const player = await this.prisma.player.findUnique({ where: { telegramId } });
    if (!player) return false;
    const updated = await this.prisma.customGifPack.updateMany({
      where: { ownerId: player.id },
      data: { approved: true, approvedBy },
    });
    return updated.count > 0;
  }

  async disapprove(telegramId: bigint): Promise<boolean> {
    const player = await this.prisma.player.findUnique({ where: { telegramId } });
    if (!player) return false;
    const updated = await this.prisma.customGifPack.updateMany({
      where: { ownerId: player.id },
      data: { approved: false, submitted: false },
    });
    return updated.count > 0;
  }

  async findOwnPack(telegramId: bigint): Promise<GifPackSummary | null> {
    const player = await this.prisma.player.findUnique({ where: { telegramId }, include: { gifPack: true } });
    return player?.gifPack ? toSummary(player.telegramId, player.gifPack) : null;
  }

  /** The pack's DB id, if `telegramId` owns one and it's approved - for `/usegifpack`. */
  async findApprovedPackId(telegramId: bigint): Promise<number | null> {
    const player = await this.prisma.player.findUnique({ where: { telegramId }, include: { gifPack: true } });
    return player?.gifPack?.approved ? player.gifPack.id : null;
  }

  /** Submitted-but-undecided packs, for `/reviewgifs`. */
  async listPending(): Promise<GifPackSummary[]> {
    const rows = await this.prisma.customGifPack.findMany({
      where: { submitted: true, approved: false },
      include: { owner: true },
    });
    return rows.map((row) => toSummary(row.owner.telegramId, row));
  }

  /**
   * The `file_id` to send for `category`, given a group (its `defaultGifPackId`, if set) and
   * optionally a specific player's own approved pack (e.g. the player who just died) - the player
   * pack wins if both exist and both have that category filled in, mirroring the original
   * preferring a purchasing player's own pack over the group default. Returns `null` whenever no
   * approved pack covers this category - the caller falls back to text-only, unchanged from today.
   */
  async getApprovedFileId(
    category: GifCategory,
    groupDefaultPackId: number | null,
    playerTelegramId?: bigint,
  ): Promise<string | null> {
    if (playerTelegramId !== undefined) {
      const player = await this.prisma.player.findUnique({ where: { telegramId: playerTelegramId }, include: { gifPack: true } });
      const fromPlayer = player?.gifPack?.approved ? (player.gifPack as unknown as Record<string, string | null>)[column(category)] : null;
      if (fromPlayer) return fromPlayer;
    }
    if (groupDefaultPackId === null) return null;
    const pack = await this.prisma.customGifPack.findUnique({ where: { id: groupDefaultPackId } });
    if (!pack?.approved) return null;
    return (pack as unknown as Record<string, string | null>)[column(category)] ?? null;
  }
}

function toSummary(ownerTelegramId: bigint, pack: Record<string, unknown>): GifPackSummary {
  const fileIds: Partial<Record<GifCategory, string>> = {};
  for (const category of GIF_CATEGORIES) {
    const value = pack[column(category)];
    if (typeof value === 'string') fileIds[category] = value;
  }
  return {
    id: pack.id as number,
    ownerTelegramId,
    submitted: pack.submitted as boolean,
    approved: pack.approved as boolean,
    nsfw: pack.nsfw as boolean,
    fileIds,
  };
}
