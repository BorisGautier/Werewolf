/**
 * Port of the `#region Seer / Fool` and `#region Augur` blocks - the
 * "information" roles. Unlike almost everything else in `night-resolution.ts`,
 * these mostly don't mutate game state at all: the original's code for them
 * is just `Send(...)` calls. What *is* real domain logic - and genuinely
 * worth a pure, tested function rather than leaving to the presentation
 * layer - is which role gets reported: the Seer's and Fool's disguises for
 * certain roles, the Sorcerer's narrow wolf/Seer/Snow-Wolf-only detection,
 * and the Augur's "never show the same (still-relevant) role twice" memory.
 */

import { ROLE_BIT, type Role } from '../roles/role.js';
import { WOLF_ROLES } from './game-balancing.js';
import { shuffle } from '../shared/shuffle.js';
import type { Player } from './player.js';
import type { GameEvent } from './game-event.js';
import { seerChecks, seerWolfFinds } from '../../infrastructure/monitoring/metrics.js';

/**
 * Port of the Seer's role-disguise `switch` in the `#region Seer / Fool`
 * block. A Beholder is seen accurately (that branch is achievement-only in
 * the original). Everything else not listed here is also seen accurately.
 */
export function seerSees(targetRole: Role, random: () => number = Math.random): Role {
  seerChecks.inc();
  let seen: Role;
  switch (targetRole) {
    case ROLE_BIT.Traitor:
      seen = Math.floor(random() * 100) < 50 ? ROLE_BIT.Wolf : ROLE_BIT.Villager;
      break;
    case ROLE_BIT.WolfCub:
    case ROLE_BIT.AlphaWolf:
      seen = ROLE_BIT.Wolf; // the Seer can't tell wolf sub-types apart
      break;
    case ROLE_BIT.WolfMan:
      seen = ROLE_BIT.Wolf; // deceptively shown as a wolf despite being village-aligned
      break;
    case ROLE_BIT.Lycan:
      seen = ROLE_BIT.Villager; // deceptively shown as a villager despite being wolf-aligned
      break;
    default:
      seen = targetRole;
      break;
  }
  if (seen === ROLE_BIT.Wolf || WOLF_ROLES.includes(seen)) {
    seerWolfFinds.inc();
  }
  return seen;
}

/**
 * Port of the Sorcerer's detection `switch`. Returns the role to report, or
 * `null` for "SorcererOther" (no magical threat detected).
 */
export function sorcererDetects(targetRole: Role): Role | null {
  if (
    targetRole === ROLE_BIT.AlphaWolf ||
    targetRole === ROLE_BIT.Wolf ||
    targetRole === ROLE_BIT.WolfCub
  ) {
    return ROLE_BIT.Wolf;
  }
  if (targetRole === ROLE_BIT.Seer) return ROLE_BIT.Seer;
  if (targetRole === ROLE_BIT.SnowWolf) return ROLE_BIT.SnowWolf;
  return null;
}

/**
 * Port of the Fool's "sees a random role" block: a random role among alive
 * players (excluding the Fool and any Seer), with wolf sub-types disguised
 * as generic Wolf like the real Seer does. Returns `null` if there's no
 * other eligible player (mirrors `possibleRoles.Any()` being false).
 */
export function foolSeesRandomRole(players: readonly Player[], foolId: bigint): Role | null {
  const possibleRoles = players
    .filter((p) => !p.isDead && p.id !== foolId && p.role !== ROLE_BIT.Seer)
    .map((p) => p.role);
  if (possibleRoles.length === 0) return null;

  shuffle(possibleRoles);
  const seen = possibleRoles[0]!;
  return WOLF_ROLES.includes(seen) ? ROLE_BIT.Wolf : seen;
}

/**
 * Port of the Oracle's "negative Seer" block: a random role among alive
 * players that is *not* the target's own role (excluding the Oracle
 * itself). Returns `null` if there's no eligible role left.
 */
export function oracleSeesRandomRole(
  players: readonly Player[],
  oracleId: bigint,
  targetRole: Role,
): Role | null {
  const possibleRoles = players
    .filter((p) => !p.isDead && p.id !== oracleId && p.role !== targetRole)
    .map((p) => p.role);
  if (possibleRoles.length === 0) return null;

  shuffle(possibleRoles);
  return possibleRoles[0]!;
}

/**
 * Port of the Augur's block: picks a role from the game's full candidate
 * pool (`possibleRoles`, from `balance()`) that the Augur hasn't already
 * been shown and that either nobody has, or someone who died *this very
 * night* had (`!y.IsDead || y.DiedLastNight`) - showing a role that's
 * completely gone from the game would be pointless. Mutates `augur.sawRoles`
 * to remember it. Returns `null` if every eligible role has already been
 * shown (mirrors "AugurSeesNothing").
 */
export function augurSees(
  players: readonly Player[],
  augur: Player,
  possibleRoles: readonly Role[],
): Role | null {
  const isNotInGame = (role: Role): boolean =>
    !augur.sawRoles.includes(role) &&
    !players.some((p) => (!p.isDead || p.diedLastNight) && p.role === role);

  const shuffled = [...possibleRoles];
  shuffle(shuffled);
  let roleToSee = shuffled.find(isNotInGame);
  if (!roleToSee) return null;

  // If the Seer is about to be promoted from Apprentice Seer, show that instead - showing "Seer" as
  // gone from the game would be misleading if an Apprentice is standing by to take the name over.
  const hasAliveApprenticeSeer = players.some(
    (p) => !p.isDead && p.role === ROLE_BIT.ApprenticeSeer,
  );
  const hasAliveSeer = players.some((p) => !p.isDead && p.role === ROLE_BIT.Seer);
  if (roleToSee === ROLE_BIT.Seer && hasAliveApprenticeSeer && !hasAliveSeer) {
    roleToSee = ROLE_BIT.ApprenticeSeer;
  }

  augur.sawRoles.push(roleToSee);
  return roleToSee;
}

/**
 * Port of the `#region Seer / Fool` and `#region Augur` blocks' *side effects* - unlike the pure
 * calculators above, this is what actually reads each informational role's nightly `.choice`,
 * applies the disguises, and reports back (as `GameEvent`s the infra layer turns into PMs). Also
 * the only place several achievement-tracking fields get touched: `Player.trustworthy` (the real
 * Seer checking a Wolf Man), and the Fool's `foolCorrectSeeCount`/`foolCorrectlySeenBH`/
 * `hasSeenImpossible`.
 */
export function resolveClairvoyanceNight(
  players: readonly Player[],
  possibleRoles: readonly Role[],
  random: () => number = Math.random,
): GameEvent[] {
  const events: GameEvent[] = [];

  for (const seer of players.filter((p) => p.role === ROLE_BIT.Seer && !p.isDead && !p.frozen)) {
    const target = players.find((p) => p.id === seer.choice);
    if (!target) continue;
    if (target.role === ROLE_BIT.WolfMan) target.trustworthy = true;
    events.push({
      type: 'SeerVision',
      playerId: seer.id,
      targetId: target.id,
      shownRole: seerSees(target.role, random),
    });
  }

  const sorcerer = players.find((p) => p.role === ROLE_BIT.Sorcerer && !p.isDead && !p.frozen);
  if (sorcerer) {
    const target = players.find((p) => p.id === sorcerer.choice);
    if (target) {
      events.push({
        type: 'SorcererVision',
        playerId: sorcerer.id,
        targetId: target.id,
        detectedRole: sorcererDetects(target.role),
      });
    }
  }

  const fool = players.find((p) => p.role === ROLE_BIT.Fool && !p.isDead && !p.frozen);
  if (fool) {
    const target = players.find((p) => p.id === fool.choice);
    if (target) {
      const seen = foolSeesRandomRole(players, fool.id);
      if (seen !== null) {
        const isCorrect =
          seen === target.role || (seen === ROLE_BIT.Wolf && WOLF_ROLES.includes(target.role));
        if (isCorrect) fool.foolCorrectSeeCount++;
        if (seen === ROLE_BIT.Beholder && target.role === ROLE_BIT.Beholder)
          fool.foolCorrectlySeenBH = true;
        if (seen === ROLE_BIT.WolfMan || seen === ROLE_BIT.Traitor) fool.hasSeenImpossible = true;
      }
      events.push({ type: 'FoolVision', playerId: fool.id, targetId: target.id, shownRole: seen });
    }
  }

  const oracle = players.find((p) => p.role === ROLE_BIT.Oracle && !p.isDead && !p.frozen);
  if (oracle) {
    const target = players.find((p) => p.id === oracle.choice);
    if (target) {
      events.push({
        type: 'OracleVision',
        playerId: oracle.id,
        targetId: target.id,
        shownRole: oracleSeesRandomRole(players, oracle.id, target.role),
      });
    }
  }

  const augur = players.find((p) => p.role === ROLE_BIT.Augur && !p.isDead && !p.frozen);
  if (augur) {
    events.push({
      type: 'AugurVision',
      playerId: augur.id,
      shownRole: augurSees(players, augur, possibleRoles),
    });
  }

  return events;
}
