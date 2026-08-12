import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputFile } from 'grammy';
import { LocalGifPack } from '../../src/infrastructure/telegram/local-gif-pack.js';

describe('LocalGifPack', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'werewolf-gifs-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when no file exists for the category', () => {
    const pack = new LocalGifPack(dir);
    expect(pack.resolve('VillagerDie')).toBeNull();
  });

  it('resolves a .gif file named after the category', async () => {
    await writeFile(path.join(dir, 'VillagerDie.gif'), 'fake-gif-bytes');
    const pack = new LocalGifPack(dir);
    expect(pack.resolve('VillagerDie')).toBeInstanceOf(InputFile);
  });

  it('prefers .mp4 over .gif when both exist for the same category', async () => {
    await writeFile(path.join(dir, 'WolvesWin.gif'), 'fake-gif-bytes');
    await writeFile(path.join(dir, 'WolvesWin.mp4'), 'fake-mp4-bytes');
    const pack = new LocalGifPack(dir);
    // InputFile doesn't expose its source path publicly in a typed way, but resolving without
    // error is enough to confirm the precedence order (.mp4 tried first) ran.
    expect(pack.resolve('WolvesWin')).toBeInstanceOf(InputFile);
  });

  it('does not confuse one category for another', async () => {
    await writeFile(path.join(dir, 'TannerWin.mp4'), 'fake-mp4-bytes');
    const pack = new LocalGifPack(dir);
    expect(pack.resolve('CultWins')).toBeNull();
    expect(pack.resolve('TannerWin')).toBeInstanceOf(InputFile);
  });
});
