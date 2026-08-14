import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const projectRoot = 'd:/Projets/NodeJS/Werewolf';
const outputDir = path.join(projectRoot, 'assets/gifs');

const images = {
  StartGame: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/start_game_art_1786719438693.png',
  StartChaosGame: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/start_chaos_game_art_1786719459551.png',
  SeerVision: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/seer_vision_art_1786719473551.png',
  CupidLovers: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/cupid_lovers_art_1786719488030.png',
  CultConvert: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/cult_convert_art_1786719502546.png',
  GAGuard: 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/ga_guard_art_1786719517816.png',
};

const filterGraph = [
  'scale=512:512',
  'zoompan=z=\'1.02+0.03*sin(2*PI*on/75)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=75:s=512x512:fps=25',
  'colorbalance=rs=0.05:gs=0.0:bs=0.05',
  'eq=contrast=\'1.05+0.03*sin(4*PI*n/75)\''
].join(',');

for (const [name, imgPath] of Object.entries(images)) {
  const outputFile = path.join(outputDir, `${name}.mp4`);
  console.log(`🎬 Rendering ${name}.mp4...`);
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
    console.log(`   ✅ Rendered ${name}.mp4`);
  } catch (err) {
    console.error(`   ❌ Failed rendering ${name}:`, err);
  }
}

console.log('🎉 Pack rendering complete!');
