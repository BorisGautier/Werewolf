export interface RankTier {
  level: number;
  titleKey: string;
  defaultTitle: string;
  emoji: string;
  minPoints: number;
}

export const PLAYER_RANKS: readonly RankTier[] = [
  { level: 1, titleKey: 'Rank_Novice', defaultTitle: 'Écuyer Débutant', emoji: '🗡️', minPoints: 0 },
  { level: 2, titleKey: 'Rank_GuardianOfShadows', defaultTitle: 'Gardien des Ombres', emoji: '🛡️', minPoints: 50 },
  { level: 3, titleKey: 'Rank_BlackKnight', defaultTitle: 'Chevalier Noir', emoji: '🖤', minPoints: 150 },
  { level: 4, titleKey: 'Rank_ShadowKnight', defaultTitle: 'Chevalier des Ombres', emoji: '🌑', minPoints: 300 },
  { level: 5, titleKey: 'Rank_EliteKnight', defaultTitle: 'Chevalier Élite', emoji: '⚔️', minPoints: 500 },
  { level: 6, titleKey: 'Rank_DragonSlayer', defaultTitle: 'Chasseur de Dragon', emoji: '🐉', minPoints: 1000 },
  { level: 7, titleKey: 'Rank_ScourgeDestroyer', defaultTitle: 'Destructeur de Fléaux', emoji: '💥', minPoints: 2000 },
  { level: 8, titleKey: 'Rank_WarKing', defaultTitle: 'Roi de Guerre', emoji: '👑', minPoints: 3500 },
  { level: 9, titleKey: 'Rank_SkyMonarch', defaultTitle: 'Monarque des Cieux', emoji: '🌤️', minPoints: 5000 },
  { level: 10, titleKey: 'Rank_WolfGod', defaultTitle: 'Dieu du Loup', emoji: '🐺', minPoints: 7500 },
  { level: 11, titleKey: 'Rank_OlympusLord', defaultTitle: 'Seigneur de l Olympe', emoji: '🌌', minPoints: 10000 },
  { level: 12, titleKey: 'Rank_SupremeSovereign', defaultTitle: 'Souverain Absolu', emoji: '💎', minPoints: 15000 },
];

export function getRankForPoints(points: number): RankTier {
  const currentPoints = Math.max(0, points);
  let current = PLAYER_RANKS[0]!;
  for (const rank of PLAYER_RANKS) {
    if (currentPoints >= rank.minPoints) {
      current = rank;
    } else {
      break;
    }
  }
  return current;
}
