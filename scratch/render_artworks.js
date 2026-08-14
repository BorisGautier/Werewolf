import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const projectRoot = 'd:/Projets/NodeJS/Werewolf';
const outputDir = path.join(projectRoot, 'assets/gifs');

const artworks = {
  WolfWin: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/wolf_win_art_1786720063117.png',
  WolvesWin: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/wolf_win_art_1786720063117.png',
  NightStart: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/night_start_art_1786720077344.png',
  DayStart: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/day_start_art_1786720093040.png',
  LynchStart: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/lynch_start_art_1786720108613.png',
  WolfAttack: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/wolf_attack_art_1786720122065.png',
  HunterShot: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/hunter_shot_art_1786720135921.png',
};

const filterGraph = [
  'scale=512:512',
  'zoompan=z=\'1.03+0.04*sin(2*PI*on/75)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=75:s=512x512:fps=25',
  'colorbalance=rs=0.08:gs=0.0:bs=0.05',
  'eq=contrast=\'1.08+0.04*sin(4*PI*n/75)\''
].join(',');

for (const [name, imgPath] of Object.entries(artworks)) {
  const outputFile = path.join(outputDir, `${name}.mp4`);
  console.log(`🎬 Rendering artwork animation for ${name}.mp4...`);
  try {
    execFileSync(ffmpeg, [
      '-y',
      '-loop', '1',
      '-i', imgPath,
      '-vf', filterGraph,
      '-t', '3',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-an',
      outputFile
    ], { stdio: 'ignore' });
    console.log(`   ✅ Rendered ${name}.mp4 with HD artwork!`);
  } catch (err) {
    console.error(`   ❌ Failed rendering ${name}:`, err);
  }
}

console.log('🎉 Artwork rendering complete!');
