/**
 * Port of `UpdateHandler`'s `AddCount`/`SpamDetection`/`SpamBanList` (`Werewolf Control`): an
 * in-memory, per-Telegram-user flood guard over bot-command messages, independent of any
 * particular group. The original runs this as a DB-backed cross-node background sweep (`Dictionary
 * <long, SpamDetector>` + a 2-second polling loop); this port collapses it to a single in-process
 * rolling window per user - there's only one bot process here, so there's nothing to synchronize.
 *
 * A user who sends `THRESHOLD` or more commands within `WINDOW_MS` gets a warning; two more
 * breaches (mirrors the original's `Warns >= 3`) trigger an actual ban via
 * `AdminRepository.banForSpam` (called by whoever owns this guard - see `bot.ts`). `markBanned`
 * then short-circuits every further command from that user, in memory, until the ban's `expiresAt`
 * (or forever, for a `null` expiry) - this doesn't survive a process restart, unlike the DB-backed
 * `GlobalBan` row `banForSpam` also writes, but a fresh process re-detects continued flooding
 * within one `WINDOW_MS` regardless.
 */

const WINDOW_MS = 60_000;
const THRESHOLD = 10;
const WARNINGS_BEFORE_BAN = 2;

interface UserState {
  timestamps: number[];
  warnCount: number;
  bannedUntil: number | null; // ms epoch; null (with bannedUntil set) is only ever used as "permanent" via Infinity below
}

export type SpamVerdict = 'ok' | 'warn' | 'ban';

export class SpamGuard {
  private readonly users = new Map<bigint, UserState>();

  /** True while a ban this guard issued is still in effect. */
  isBanned(telegramId: bigint, now = Date.now()): boolean {
    const state = this.users.get(telegramId);
    if (!state?.bannedUntil) return false;
    if (state.bannedUntil === Infinity) return true;
    return now < state.bannedUntil;
  }

  /** Records a command from `telegramId` and returns whether it's business as usual, a warning, or a ban. */
  record(telegramId: bigint, now = Date.now()): SpamVerdict {
    let state = this.users.get(telegramId);
    if (!state) {
      state = { timestamps: [], warnCount: 0, bannedUntil: null };
      this.users.set(telegramId, state);
    }

    state.timestamps.push(now);
    state.timestamps = state.timestamps.filter((t) => t > now - WINDOW_MS);
    if (state.timestamps.length < THRESHOLD) return 'ok';

    // A breach - reset the window so a single burst doesn't re-trigger on every subsequent message.
    state.timestamps = [];
    state.warnCount++;
    if (state.warnCount <= WARNINGS_BEFORE_BAN) return 'warn';
    return 'ban';
  }

  /** Records that `telegramId` has just been banned (by the caller, via `AdminRepository.banForSpam`). */
  markBanned(telegramId: bigint, expiresAt: Date | null): void {
    const state = this.users.get(telegramId) ?? { timestamps: [], warnCount: 0, bannedUntil: null };
    state.bannedUntil = expiresAt ? expiresAt.getTime() : Infinity;
    this.users.set(telegramId, state);
  }
}
