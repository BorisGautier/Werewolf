import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const projectRoot = 'd:/Projets/NodeJS/Werewolf';
const outputDir = path.join(projectRoot, 'assets/gifs');

const baseImage = 'C:/Users/tchou/.gemini/antigravity-ide/brain/64084d76-b2c6-4a8f-974f-c07e9437a485/necromancer_resurrect_art_1786719287997.png';
const outputFile = path.join(outputDir, 'NecromancerResurrect.mp4');

const filterGraph = [
  'scale=512:512',
  'zoompan=z=\'1.0+0.06*sin(2*PI*on/75)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=75:s=512x512:fps=25',
  'colorbalance=rs=0.1:gs=-0.05:bs=0.2',
  'eq=contrast=\'1.1+0.05*sin(4*PI*n/75)\':brightness=\'0.02*sin(6*PI*n/75)\''
].join(',');

console.log('🎬 Rendering NecromancerResurrect.mp4...');

execFileSync(ffmpeg, [
  '-y',
  '-loop', '1',
  '-i', baseImage,
  '-vf', filterGraph,
  '-t', '3',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-an',
  outputFile
], { stdio: 'inherit' });

console.log('✅ Rendered NecromancerResurrect.mp4 successfully!');
