export type VillageWeather = 'Clear' | 'FullMoon' | 'ThickFog' | 'Eclipse' | 'Thunderstorm';

export interface WeatherInfo {
  type: VillageWeather;
  emoji: string;
  titleFr: string;
  titleEn: string;
  descFr: string;
  descEn: string;
}

export const WEATHER_DETAILS: Record<VillageWeather, WeatherInfo> = {
  Clear: {
    type: 'Clear',
    emoji: '🌌',
    titleFr: 'Nuit Étoilée et Paisible',
    titleEn: 'Peaceful Starry Night',
    descFr: 'Le ciel est dégagé sur le village. Les étoiles brillent sereinement.',
    descEn: 'The sky over the village is clear. Stars shine serenely.',
  },
  FullMoon: {
    type: 'FullMoon',
    emoji: '🌕',
    titleFr: 'Pleine Lune Magique',
    titleEn: 'Magical Full Moon',
    descFr:
      "La lune brille d'une clarté surnaturelle... L'énergie des Loups et des créatures de la nuit est décuplée !",
    descEn:
      'The moon shines with supernatural clarity... The energy of wolves and night creatures surges!',
  },
  ThickFog: {
    type: 'ThickFog',
    emoji: '🌫️',
    titleFr: 'Brouillard Épais et Mystérieux',
    titleEn: 'Thick Mysterious Fog',
    descFr:
      "Un brouillard dense s'étend sur Thiercelieux. Les silhouettes s'estompent dans l'ombre...",
    descEn: 'A dense fog creeps over the village. Silhouettes fade in the shadows...',
  },
  Eclipse: {
    type: 'Eclipse',
    emoji: '⚡',
    titleFr: 'Éclipse Obscure',
    titleEn: 'Dark Eclipse',
    descFr:
      'Une éclipse mystique plonge le village dans le secret... Les votes de lynchage restent anonymes !',
    descEn: 'A mystical eclipse shrouds the village... Lynch votes will be anonymous!',
  },
  Thunderstorm: {
    type: 'Thunderstorm',
    emoji: '🌩️',
    titleFr: 'Orage et Tempête',
    titleEn: 'Thunderstorm & Tempests',
    descFr:
      "Le vent hurle et les éclairs fendent la nuit ! Les nuits et les jours s'enchaînent à toute vitesse.",
    descEn: 'Wind howls and lightning splits the night! Phases pass swiftly.',
  },
};

export function getRandomWeather(): VillageWeather {
  const rand = Math.random();
  if (rand < 0.5) return 'Clear';
  if (rand < 0.65) return 'FullMoon';
  if (rand < 0.78) return 'ThickFog';
  if (rand < 0.89) return 'Eclipse';
  return 'Thunderstorm';
}
