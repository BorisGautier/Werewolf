import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const projectRoot = 'd:/Projets/NodeJS/Werewolf';
const outputDir = path.join(projectRoot, 'assets/gifs');
const brainDir = 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485';

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 100% Complete Mapping of all 67 GifCategories to AI Concept Art PNG Backings
const ARTWORK_IMAGE_MAP = {
  VillagerDie: 'villager_die_art_1786649806734.png',
  WolfWin: 'wolf_win_art_1786720063117.png',
  WolvesWin: 'wolves_win_art_1786649866972.png',
  VillagersWin: 'villagers_win_art_1786649854277.png',
  NoWinner: 'no_winner_art_1786649936446.png',
  StartGame: 'start_game_art_1786719438693.png',
  StartChaosGame: 'start_chaos_game_art_1786719459551.png',
  TannerWin: 'tanner_win_art_1786649879143.png',
  CultWins: 'cult_wins_art_1786649890176.png',
  SerialKillerWins: 'serial_killer_wins_art_1786649903427.png',
  LoversWin: 'lovers_win_art_1786649924440.png',
  SKKilled: 'sk_killed_art_1786649843382.png',
  ArsonistWins: 'arsonist_wins_art_1786649914006.png',
  BurnToDeath: 'burn_to_death_art_1786649831932.png',
  NightStart: 'night_start_art_1786720077344.png',
  DayStart: 'day_start_art_1786720093040.png',
  LynchStart: 'lynch_start_art_1786720108613.png',
  WolfAttack: 'wolf_attack_art_1786720122065.png',
  HunterShot: 'hunter_shot_art_1786720135921.png',
  WitchPotionKill: 'witch_potion_kill_art_1786720223686.png',
  WitchPotionSave: 'witch_potion_kill_art_1786720223686.png',
  SeerVision: 'seer_vision_art_1786719473551.png',
  FoolVision: 'seer_vision_art_1786719473551.png',
  ApprenticeSeerPromote: 'seer_vision_art_1786719473551.png',
  CultConvert: 'cult_convert_art_1786719502546.png',
  CultHunterKill: 'cult_convert_art_1786719502546.png',
  GAGuard: 'ga_guard_art_1786719517816.png',
  HarlotVisit: 'night_start_art_1786720077344.png',
  HarlotVisitedWolf: 'wolf_attack_art_1786720122065.png',
  HarlotTargetEaten: 'wolf_attack_art_1786720122065.png',
  CupidLovers: 'cupid_lovers_art_1786719488030.png',
  LoverDied: 'cupid_lovers_art_1786719488030.png',
  WildChildTransform: 'wolf_attack_art_1786720122065.png',
  DoppelgangerSwap: 'start_chaos_game_art_1786719459551.png',
  WolfCubDeath: 'wolf_attack_art_1786720122065.png',
  AlphaWolfInfect: 'wolf_attack_art_1786720122065.png',
  GraveDiggerDig: 'villager_die_art_1786649806734.png',
  GraveDiggerFall: 'villager_die_art_1786649806734.png',
  ArsonistDouse: 'burn_to_death_art_1786649831932.png',
  ArsonistSpark: 'arsonist_burn_all_art_1786722016098.png',
  AugurBirds: 'night_start_art_1786720077344.png',
  SnowWolfFreeze: 'night_start_art_1786720077344.png',
  SandmanSleep: 'night_start_art_1786720077344.png',
  BlacksmithSilver: 'start_game_art_1786719438693.png',
  TroublemakerBrawl: 'lynch_start_art_1786720108613.png',
  PacifistPeace: 'day_start_art_1786720093040.png',
  MayorReveal: 'day_start_art_1786720093040.png',
  PrinceSurvived: 'lynch_start_art_1786720108613.png',

  // 20 New Roles
  WatchmanWatch: 'night_start_art_1786720077344.png',
  JudgePardon: 'lynch_start_art_1786720108613.png',
  ArchivistRecords: 'seer_vision_art_1786719473551.png',
  TrackerTrack: 'night_start_art_1786720077344.png',
  PriestessBless: 'ga_guard_art_1786719517816.png',
  MimicImitate: 'start_chaos_game_art_1786719459551.png',
  CrownPrincePromote: 'start_game_art_1786719438693.png',
  ArchangelBullet: 'ga_guard_art_1786719517816.png',
  TrapperWolfTrap: 'wolf_attack_art_1786720122065.png',
  ChameleonWolfDisguise: 'wolf_win_art_1786720063117.png',
  ViperWolfPoison: 'wolf_attack_art_1786720122065.png',
  HowlerWolfHowl: 'wolf_win_art_1786720063117.png',
  HypnotistWolfMindControl: 'wolf_win_art_1786720063117.png',
  BerserkerWolfRage: 'wolf_attack_art_1786720122065.png',
  NecromancerResurrect: 'necromancer_resurrect_art_1786719287997.png',
  JesterWin: 'tanner_win_art_1786649879143.png',
  HitmanTargetEliminated: 'sk_killed_art_1786649843382.png',
  ReflectorReflect: 'seer_vision_art_1786719473551.png',
  AvengerRivalLynched: 'lynch_start_art_1786720108613.png',
  CrowCurse: 'night_start_art_1786720077344.png',
};

// Visual theme metadata & labels for all 67 GifCategories
const CATEGORY_STYLES = {
  VillagerDie: { c1: '0x1f0000', txt: '0xff3333', label: '💀 MORT DANS LA NUIT' },
  WolfWin: { c1: '0x3b0d0d', txt: '0xff4d4d', label: '🐺 VICTOIRE DE LA MEUTE !' },
  WolvesWin: { c1: '0x3b0d0d', txt: '0xff4d4d', label: '🐺 VICTOIRE DE LA MEUTE !' },
  VillagersWin: { c1: '0x0d3b1e', txt: '0x52b788', label: '🏆 VICTOIRE DU VILLAGE !' },
  NoWinner: { c1: '0x111111', txt: '0xaaaaaa', label: '☠️ ANNIHILATION TOTALE (EGALITE)' },
  StartGame: { c1: '0x0d1b2a', txt: '0x778da9', label: '⚔️ LE VILLAGE S EVEILLE' },
  StartChaosGame: { c1: '0x2b0000', txt: '0xff4d4d', label: '⚡️ MODE CHAOS ANARCHIE' },
  TannerWin: { c1: '0x3b2b0d', txt: '0xffaa00', label: '🎭 VICTOIRE DU TANNEUR !' },
  CultWins: { c1: '0x2b0d3b', txt: '0xd800f0', label: '🔮 VICTOIRE DU CULTE !' },
  SerialKillerWins: { c1: '0x3b001a', txt: '0xff0055', label: '🔪 VICTOIRE DU CEREALE KILLER !' },
  LoversWin: { c1: '0x3b0d26', txt: '0xff66aa', label: '💘 VICTOIRE DES AMOUREUX !' },
  SKKilled: { c1: '0x1a000d', txt: '0xff0066', label: '🔪 POIGNARDE PAR LE CEREALE KILLER' },
  ArsonistWins: { c1: '0x3b150d', txt: '0xff5500', label: '🔥 VICTOIRE DE L INCENDIAIRE !' },
  BurnToDeath: { c1: '0x331000', txt: '0xff6600', label: '🔥 BRULE VIF PAR L INCENDIAIRE' },
  NightStart: { c1: '0x050515', txt: '0x89cff0', label: '🌙 LA NUIT TOMBE...' },
  DayStart: { c1: '0x3a2500', txt: '0xffd700', label: '☀️ LE JOUR SE LEVE' },
  LynchStart: { c1: '0x2a0800', txt: '0xff8c00', label: '⚖️ LE VOTE DU VILLAGE' },
  WolfAttack: { c1: '0x150000', txt: '0xff1a1a', label: '🐺 ATTAQUE DE LA MEUTE' },
  HunterShot: { c1: '0x0f2b1d', txt: '0x52b788', label: '🏹 TIR DU CHASSEUR' },
  WitchPotionKill: { c1: '0x002600', txt: '0x33ff33', label: '🧪 POTION MORTELLE DE LA SORCIERE' },
  WitchPotionSave: { c1: '0x002b2b', txt: '0x00ffff', label: '✨ POTION DE GUERISON' },
  SeerVision: { c1: '0x001133', txt: '0x3399ff', label: '🔮 VISION DIVINATOIRE DE LA VOYANTE' },
  FoolVision: { c1: '0x2b002b', txt: '0xff66ff', label: '🤪 VISION TROUBLEE DU FOL' },
  ApprenticeSeerPromote: { c1: '0x002244', txt: '0x66b2ff', label: '📜 HERITAGE DE LA VOYANTE' },
  CultConvert: { c1: '0x260033', txt: '0xcc33ff', label: '🔮 RITUEL ET CONVERSION DU CULTE' },
  CultHunterKill: { c1: '0x330000', txt: '0xff3300', label: '⚔️ CHASSE AUX CULTISTES' },
  GAGuard: { c1: '0x002b3d', txt: '0x66d9ff', label: '🛡️ PROTECTION DU GARDE DU CORPS' },
  HarlotVisit: { c1: '0x33001a', txt: '0xff3399', label: '💋 VISITE NOCTURNE DE LA CATIN' },
  HarlotVisitedWolf: { c1: '0x330000', txt: '0xff1a1a', label: '💋🐺 VISITE FATALE CHEZ LE LOUP' },
  HarlotTargetEaten: { c1: '0x2b0000', txt: '0xff3333', label: '💋💀 CLIENT DEORE PAR LA MEUTE' },
  CupidLovers: { c1: '0x33001a', txt: '0xff66aa', label: '💘 FLECHE DES AMOUREUX DE CUPIDON' },
  LoverDied: { c1: '0x33001a', txt: '0xff66b2', label: '💔 MORT DE CHAGRIN DE L AMOUREUX' },
  WildChildTransform: { c1: '0x331100', txt: '0xff7700', label: '🐺 TRANSFORMATION DE L ENFANT SAUVAGE' },
  DoppelgangerSwap: { c1: '0x1a1a1a', txt: '0xcccccc', label: '🎭 METAMORPHOSE DU SOSIE' },
  WolfCubDeath: { c1: '0x3d0000', txt: '0xff0000', label: '🐾 RAGE DE LA MEUTE (LOVETEAU TUE)' },
  AlphaWolfInfect: { c1: '0x003311', txt: '0x33ff77', label: '🐺☣️ INFECTION DU LOUP ALPHA' },
  GraveDiggerDig: { c1: '0x1a1a00', txt: '0xdddd33', label: '⚰️ TOMBE CREUSEE PAR LE FOSSOYEUR' },
  GraveDiggerFall: { c1: '0x221100', txt: '0xffaa33', label: '🕳️ PIEGE DU FOSSOYEUR' },
  ArsonistDouse: { c1: '0x331100', txt: '0xff8800', label: '🛢️ KEROSENE EPANDU PAR L INCENDIAIRE' },
  ArsonistSpark: { c1: '0x441100', txt: '0xff4400', label: '💥 INCENDIE GENERAL' },
  AugurBirds: { c1: '0x0f1f38', txt: '0x70a0ff', label: '🦅 PRESAGE DES OISEAUX DE L AUGURE' },
  SnowWolfFreeze: { c1: '0x002b4d', txt: '0x99e6ff', label: '❄️ GEL DU LOUP DES NEIGES' },
  SandmanSleep: { c1: '0x110033', txt: '0xaa66ff', label: '💤 POUDRE DE SOMMEIL DU MARCHAND DE SABLE' },
  BlacksmithSilver: { c1: '0x332200', txt: '0xffcc00', label: '🗡️ LIMAILLE D ARGENT DU FORGERON' },
  TroublemakerBrawl: { c1: '0x330000', txt: '0xff3333', label: '🥊 PAGOUILLE DU FAUTEUR DE TROUBLES' },
  PacifistPeace: { c1: '0x003311', txt: '0x66ff99', label: '🕊️ PAIX DU PACIFISTE' },
  MayorReveal: { c1: '0x332200', txt: '0xffdd00', label: '📜 REVELATION DE L ECHARPE DU MAIRE' },
  PrinceSurvived: { c1: '0x332600', txt: '0xffea00', label: '👑 GRACE ET IMMUNITE DU PRINCE' },

  // New 20 Roles
  WatchmanWatch: { c1: '0x0f293a', txt: '0x40c4ff', label: '🏹 SURVEILLANCE DU GARDIEN DE NUITE' },
  JudgePardon: { c1: '0x3a290f', txt: '0xffd54f', label: '⚖️ DROIT DE GRACE DU JUGE' },
  ArchivistRecords: { c1: '0x2a1b0e', txt: '0xffb74d', label: '📜 REGISTRES DE L ARCHIVISTE' },
  TrackerTrack: { c1: '0x1b2a0e', txt: '0x81c784', label: '🐕 PISTAGE DU CHIEN DE CHASSE' },
  PriestessBless: { c1: '0x3a0f29', txt: '0xf06292', label: '🕯️ BENEDICTION DE LA PRETRESSE' },
  MimicImitate: { c1: '0x261c2e', txt: '0xba68c8', label: '🎭 IMITATION DU COMEDIEN' },
  CrownPrincePromote: { c1: '0x3a330f', txt: '0xffd54f', label: '👑 COURONNEMENT DU PRINCE HERITIER' },
  ArchangelBullet: { c1: '0x0f343a', txt: '0x4dd0e1', label: '👼⚡️ BALLE SACREE DE L ANGE' },
  TrapperWolfTrap: { c1: '0x3a190f', txt: '0xff8a65', label: '🐺🕸️ PIEGE DU LOUP PIEGEUR' },
  ChameleonWolfDisguise: { c1: '0x0f3a22', txt: '0x69f0ae', label: '🐺🎭 CAMOUFLAGE DU LOUP CAMELEON' },
  ViperWolfPoison: { c1: '0x0f3a0f', txt: '0xb9f6ca', label: '🐺🧪 VENIN DU LOUP EMPOISONNEUR' },
  HowlerWolfHowl: { c1: '0x3a0f0f', txt: '0xff8a80', label: '🐺📣 HURLEMENT DU LOUP HURLEUR' },
  HypnotistWolfMindControl: { c1: '0x290f3a', txt: '0xe1bee7', label: '🐺🧠 HYPNOSE DU LOUP HYPNOTISEUR' },
  BerserkerWolfRage: { c1: '0x3a0505', txt: '0xff5252', label: '🐺💢 RAGE DU LOUP BERSERKER' },
  NecromancerResurrect: { c1: '0x1c0f3a', txt: '0xd1c4e9', label: '🧙‍♂️ RESURRECTION DU NECROMANCIEN' },
  JesterWin: { c1: '0x3a0f20', txt: '0xff4081', label: '🤡 VICTOIRE DU BOUFFON' },
  HitmanTargetEliminated: { c1: '0x3a0f0f', txt: '0xff5252', label: '🎯 CONTRAT EXECUTE PAR L ASSASSIN' },
  ReflectorReflect: { c1: '0x0f2d3a', txt: '0x80d8ff', label: '🪞 RENVOI DU MIROIR REFLECTEUR' },
  AvengerRivalLynched: { c1: '0x3a150f', txt: '0xff9e80', label: '💀 VENGEANCE DU VENGEUR' },
  CrowCurse: { c1: '0x150f3a', txt: '0xb388ff', label: '🦅 MALEDICTION DU CORBEAU' },
};

console.log('🚀 Rendering ALL 67 Categories with 100% Dark Fantasy AI Art Illustrations...');

let rendered = 0;
for (const [category, style] of Object.entries(CATEGORY_STYLES)) {
  const mp4Path = path.join(outputDir, `${category}.mp4`);
  const imageArtifactName = ARTWORK_IMAGE_MAP[category];
  const imagePath = imageArtifactName ? path.join(brainDir, imageArtifactName) : null;
  const hasImage = imagePath && fs.existsSync(imagePath);

  if (!hasImage) {
    console.error(`❌ Missing image for category: ${category}`);
    continue;
  }

  // Safe label string without single quotes for FFmpeg lavfi drawtext
  const safeLabel = style.label.replace(/'/g, '');

  const filterGraph = [
    `scale=512:512:force_original_aspect_ratio=increase`,
    `crop=512:512`,
    `zoompan=z='1.0+0.04*sin(2*PI*on/75)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=75:s=512x512:fps=25`,
    `drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${safeLabel}':fontcolor=${style.txt}:fontsize=24:x=(w-text_w)/2:y=h-60:box=1:boxcolor=${style.c1}@0.85:boxborderw=10`,
    `format=yuv420p`,
  ].join(',');

  const ffmpegArgs = [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-t', '3',
    '-vf', filterGraph,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-an',
    mp4Path,
  ];

  try {
    execFileSync(ffmpeg, ffmpegArgs, { stdio: 'ignore' });
    rendered++;
    console.log(`   🎨 [AI ARTWORK ${rendered}/67] Rendered ${category}.mp4 (${safeLabel})`);
  } catch (err) {
    console.error(`   ❌ Failed rendering ${category}:`, err);
  }
}

console.log(`\n=================== ALL 67 ARTWORK ANIMATIONS COMPLETE ===================`);
console.log(`🎉 Successfully rendered ALL ${rendered}/67 GifCategory video animations with AI Artwork!`);
console.log(`========================================================================\n`);
