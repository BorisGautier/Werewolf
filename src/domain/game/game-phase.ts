/**
 * Explicit phase state machine, replacing the original's `IsJoining`/
 * `IsRunning` booleans (`Werewolf.cs`) and its `GameTime { Day, Lynch, Night }`
 * enum with a single source of truth.
 */
export type GamePhase = 'Joining' | 'Night' | 'Day' | 'Lynch' | 'Ended';
