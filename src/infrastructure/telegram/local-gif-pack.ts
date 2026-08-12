/**
 * Bundled default GIFs, shipped in the repo instead of submitted by a donor - the fallback
 * `sendGifForEvent()` (`game-loop.ts`) reaches for once it's confirmed no approved custom pack
 * (player's own, or the group's default) covers a category. One file per `GifCategory`, named
 * after it (`VillagerDie.gif`, `WolfWin.mp4`, ...) so dropping a new file in is the entire
 * "installation" step - no DB row, no `/setgif`, no approval queue.
 *
 * Resolved relative to this module's own compiled location (mirrors `locale-loader.ts`'s
 * `DEFAULT_LOCALES_DIR`) rather than `process.cwd()`, so it finds the same `assets/gifs/`
 * whether running via `tsx` from `src/` or the compiled `dist/` in Docker - both sit at the same
 * depth under the project root.
 *
 * Deliberately uses *synchronous* fs calls, even though `GameLoop` is otherwise all-async: this
 * runs inline inside `broadcast()`'s per-event loop, which the whole test suite drives through
 * `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`/`runAllTimersAsync()`. Those only
 * guarantee draining *fake* timers and their directly-chained microtasks - a real `fs.promises`
 * call resolves via libuv's actual event loop, outside fake-timer control, so an async version
 * here left the whole night/day/lynch chain stalled mid-flight in every test (and the simulation
 * harness) that reached this code. A same-tick sync check has no such gap, and checking a
 * handful of small local files is cheap enough that blocking briefly is a non-issue.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputFile } from 'grammy';
import type { GifCategory } from '../persistence/gif-pack.repository.js';

const DEFAULT_GIFS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/gifs');

/** Telegram accepts either for `sendAnimation` - tried in this order per category (first match wins). */
const EXTENSIONS = ['.mp4', '.gif', '.webm'];

export class LocalGifPack {
  constructor(private readonly dir: string = DEFAULT_GIFS_DIR) {}

  /** The local file for `category`, if one was bundled - `null` means "nothing to fall back to". */
  resolve(category: GifCategory): InputFile | null {
    for (const ext of EXTENSIONS) {
      const filePath = path.join(this.dir, `${category}${ext}`);
      if (existsSync(filePath)) return new InputFile(filePath);
    }
    return null;
  }
}
