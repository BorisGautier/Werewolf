export interface PlayerTitle {
  id: string;
  emoji: string;
  titleKey: string;
  defaultTitle: string;
  descriptionKey: string;
  defaultDescription: string;
}

export const TITLE_CATALOG: readonly PlayerTitle[] = [
  {
    id: 'untouchable',
    emoji: '👑',
    titleKey: 'Title_Untouchable',
    defaultTitle: "L'Intouchable",
    descriptionKey: 'TitleDesc_Untouchable',
    defaultDescription: 'Survivre à 5 parties consécutives sans mourir.',
  },
  {
    id: 'mad_chemist',
    emoji: '🧪',
    titleKey: 'Title_MadChemist',
    defaultTitle: 'Le Chimiste Fou',
    descriptionKey: 'TitleDesc_MadChemist',
    defaultDescription: 'Éliminer 3 Loups-Garous avec la Potion Mortelle de la Sorcière ou du Chimiste.',
  },
  {
    id: 'broken_heart',
    emoji: '💔',
    titleKey: 'Title_BrokenHeart',
    defaultTitle: 'Cœur Brisé',
    descriptionKey: 'TitleDesc_BrokenHeart',
    defaultDescription: 'Mourir de chagrin 3 fois en tant qu’Amoureux.',
  },
  {
    id: 'pyromaniac',
    emoji: '🔥',
    titleKey: 'Title_Pyromaniac',
    defaultTitle: 'Le Maître du Bûcher',
    descriptionKey: 'TitleDesc_Pyromaniac',
    defaultDescription: 'Brûler au moins 3 personnes simultanément en tant qu’Incendiaire.',
  },
  {
    id: 'silent_executioner',
    emoji: '🩸',
    titleKey: 'Title_SilentExecutioner',
    defaultTitle: "L'Exécuteur Silencieux",
    descriptionKey: 'TitleDesc_SilentExecutioner',
    defaultDescription: 'Remporter 3 parties en tant que Tueur en Série.',
  },
  {
    id: 'master_jester',
    emoji: '🤡',
    titleKey: 'Title_MasterJester',
    defaultTitle: 'Le Grand Farceur',
    descriptionKey: 'TitleDesc_MasterJester',
    defaultDescription: 'Se faire lyncher par le village et gagner en tant que Bouffon ou Tanneur.',
  },
  {
    id: 'iron_shield',
    emoji: '🛡️',
    titleKey: 'Title_IronShield',
    defaultTitle: "L'Ange Inflexible",
    descriptionKey: 'TitleDesc_IronShield',
    defaultDescription: 'Protéger avec succès 3 victimes contre les attaques des Loups en tant qu’Ange Gardien.',
  },
  {
    id: 'sharpshooter',
    emoji: '🎯',
    titleKey: 'Title_Sharpshooter',
    defaultTitle: "Tireur d'Élite",
    descriptionKey: 'TitleDesc_Sharpshooter',
    defaultDescription: 'Abattre 2 Loups-Garous avec son fusil en tant que Chasseur ou Fusilier.',
  },
  {
    id: 'alpha_legend',
    emoji: '🐺',
    titleKey: 'Title_AlphaLegend',
    defaultTitle: 'Maître de la Meute',
    descriptionKey: 'TitleDesc_AlphaLegend',
    defaultDescription: 'Obtenir 10 victoires au total avec le camp des Loups-Garous.',
  },
  {
    id: 'shadow_seer',
    emoji: '🔮',
    titleKey: 'Title_ShadowSeer',
    defaultTitle: "L'Ombre de la Vérité",
    descriptionKey: 'TitleDesc_ShadowSeer',
    defaultDescription: 'Découvrir la vraie nature de 5 Loups-Garous en tant que Voyante.',
  },
];

export function getTitleById(id: string): PlayerTitle | undefined {
  return TITLE_CATALOG.find((t) => t.id === id);
}
