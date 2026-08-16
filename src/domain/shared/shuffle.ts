import { randomInt } from 'node:crypto';

/** Cryptographically-random in-place Fisher-Yates shuffle. */
export function shuffle<T>(list: T[]): void {
  for (let n = list.length; n > 1;) {
    const k = randomInt(n);
    n--;
    const tmp = list[k]!;
    list[k] = list[n]!;
    list[n] = tmp;
  }
}
