/**
 * Port of the end-of-game recap `DoGameEnd` appends after the win announcement (`Werewolf.cs`,
 * the `switch (DbGroup.ShowRolesEnd) { case "None": ...; case "All": ...; default: ... }` block
 * right after `db.SaveChanges()`), plus the trailing `EndTime` line. Gated by the group's
 * `showRolesEnd` setting:
 *  - NONE: just the alive/total count and every player's name, oldest death first.
 *  - ALL: every player (dead or alive), their status, role, love heart, and win/loss outcome.
 *  - LIVING (the original's `default` branch): only the survivors, with their team.
 */

import { ROLE_META, roleName } from '../../domain/roles/role.js';
import type { Player } from '../../domain/game/player.js';
import type { Translator } from '../i18n/translator.js';

export type ShowRolesEndMode = 'NONE' | 'LIVING' | 'ALL';

function displayRole(role: Player['role'], language: string, t: Translator): string {
  const name = roleName(role);
  const localized = t.translate(language, `Role_${name}`);
  const label = localized.startsWith('Role_') ? name : localized;
  return `${ROLE_META[name].emoji} ${label}`;
}

/** Mirrors `_timePlayed.Value.ToString(@"hh\:mm\:ss")`. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function buildEndGameSummary(
  players: readonly Player[],
  showRolesEnd: ShowRolesEndMode,
  language: string,
  t: Translator,
  durationMs: number | null,
  donorBadges: ReadonlyMap<bigint, string> = new Map(),
  playerScores: ReadonlyMap<bigint, number> = new Map(),
): string {
  const byTimeDied = [...players].sort((a, b) => {
    const at = a.timeDied?.getTime() ?? Infinity;
    const bt = b.timeDied?.getTime() ?? Infinity;
    return at - bt;
  });
  const aliveCount = players.filter((p) => !p.isDead).length;
  const outcomeKey = (p: Player) => t.translate(language, p.won ? 'Won' : 'Lost');
  const displayName = (p: Player) => `${p.name}${donorBadges.get(p.id) ?? ''}`;
  const ptsSuffix = (p: Player) => {
    const pts = playerScores.get(p.id);
    if (pts === undefined) return '';
    return pts >= 0 ? ` (+${pts} pts)` : ` (${pts} pts)`;
  };

  const lines: string[] = [];
  if (showRolesEnd === 'NONE') {
    lines.push(`${t.translate(language, 'PlayersAlive')}: ${aliveCount} / ${players.length}`);
    for (const p of byTimeDied) lines.push(`${displayName(p)}${ptsSuffix(p)}`);
  } else if (showRolesEnd === 'ALL') {
    lines.push(`${t.translate(language, 'PlayersAlive')}: ${aliveCount} / ${players.length}`);
    for (const p of byTimeDied) {
      const status = p.isDead ? t.translate(language, p.fled ? 'RanAway' : 'Dead') : t.translate(language, 'Alive');
      const heart = p.inLove ? '❤️' : '';
      lines.push(`${displayName(p)}: ${status} - ${displayRole(p.role, language, t)}${heart} ${outcomeKey(p)}${ptsSuffix(p)}`);
    }
  } else {
    lines.push(t.translate(language, 'RemainingPlayersEnd'));
    const alive = players.filter((p) => !p.isDead).sort((a, b) => a.team.localeCompare(b.team));
    for (const p of alive) {
      const heart = p.inLove ? '❤️' : '';
      const teamLabel = t.translate(language, `${p.team}TeamEnd`);
      lines.push(`${displayName(p)}: ${displayRole(p.role, language, t)} ${teamLabel} ${heart} ${outcomeKey(p)}${ptsSuffix(p)}`);
    }
  }

  let text = lines.join('\n');
  if (durationMs !== null) {
    text += `\n${t.translate(language, 'EndTime', formatDuration(durationMs))}`;
  }
  return text;
}
