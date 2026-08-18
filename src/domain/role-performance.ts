/**
 * Per-role performance bonus/malus, layered on top of `calculateGamePoints()`'s win/lose score.
 * Rewards a role for playing ITS OWN decision well (a Seer spotting a real wolf, a Hunter's dying
 * shot landing on a threat instead of an innocent, ...) independent of whether their team
 * ultimately won the game - and penalizes a costly misplay the same way.
 *
 * Only roles with a real decision point AND a detectable good/bad outcome participate. Passive or
 * no-choice roles (Villager, Mason, Prince, WiseElder, Lycan, ...) always net 0 here - by design,
 * not because they were forgotten - since there is no decision to grade. A few active roles are
 * also deliberately left out because no current `GameEvent` distinguishes a good use of their
 * ability from a bad one (Thief, Troublemaker, Watchman, Tracker, GraveDigger, Mimic, Judge,
 * Archivist, ChameleonWolf, BerserkerWolf, HypnotistWolf, SnowWolf, Crow, Sandman) - adding that
 * would mean inventing a judgment call the original game design never made.
 *
 * Deliberately modest and capped per player (`PER_PLAYER_CAP`) so this stays a garnish on top of
 * the win/lose score, never competitive with it.
 */

import { ROLE_BIT, type Role } from './roles/role.js';
import { WOLF_ROLES } from './game/game-balancing.js';
import type { GameEvent } from './game/game-event.js';
import type { Player } from './game/player.js';

export interface RolePerformanceContext {
  players: readonly Player[];
  eventBatches: readonly (readonly GameEvent[])[];
}

const PER_PLAYER_CAP = 15;

function isWolf(role: Role): boolean {
  return WOLF_ROLES.includes(role);
}

class BonusLedger {
  private readonly totals = new Map<bigint, number>();

  add(playerId: bigint, amount: number): void {
    this.totals.set(playerId, (this.totals.get(playerId) ?? 0) + amount);
  }

  toMap(): Map<bigint, number> {
    const out = new Map<bigint, number>();
    for (const [id, total] of this.totals) {
      out.set(id, Math.max(-PER_PLAYER_CAP, Math.min(PER_PLAYER_CAP, total)));
    }
    return out;
  }
}

export function calculateRolePerformanceBonus(ctx: RolePerformanceContext): Map<bigint, number> {
  const { players } = ctx;
  const ledger = new BonusLedger();
  const allEvents = ctx.eventBatches.flat();
  const findPlayer = (id: bigint) => players.find((p) => p.id === id);
  const findByRole = (role: Role) => players.find((p) => p.role === role);
  const deaths = allEvents.filter(
    (e): e is Extract<GameEvent, { type: 'PlayerDied' }> => e.type === 'PlayerDied',
  );

  // Seer / Sorcerer / Augur - a vision that actually landed on a real wolf.
  for (const event of allEvents) {
    if (event.type === 'SeerVision' && isWolf(event.shownRole)) ledger.add(event.playerId, 4);
    if (
      event.type === 'SorcererVision' &&
      event.detectedRole !== null &&
      isWolf(event.detectedRole)
    )
      ledger.add(event.playerId, 4);
    if (event.type === 'AugurVision' && event.shownRole !== null && isWolf(event.shownRole))
      ledger.add(event.playerId, 4);
  }

  // Fool - their random vision happening to be correct (still worth a small nod, same spirit as
  // the existing BrokenClock achievement).
  for (const p of players) {
    if (p.role === ROLE_BIT.Fool && p.foolCorrectSeeCount > 0) ledger.add(p.id, 3);
  }

  // Detective - built a real streak of correct threat snoops.
  for (const p of players) {
    if (p.role !== ROLE_BIT.Detective) continue;
    if (p.streetwise) ledger.add(p.id, 5);
    else if (p.correctSnoopedIds.length > 0) ledger.add(p.id, 3);
  }

  // Harlot - stayed active (real risk) and survived, instead of playing it safe every night.
  for (const p of players) {
    if (p.role === ROLE_BIT.Harlot && !p.isDead && p.playersVisited.size >= 3) ledger.add(p.id, 3);
  }

  // Guardian Angel - a real save is a clean bonus; guarding a wolf who was never under attack
  // (gaGuardWolfCount) is a wasted/misread guard.
  for (const event of allEvents) {
    if (
      event.type === 'GuardianAngelBlockedWolfAttack' ||
      event.type === 'GuardianAngelBlockedSerialKiller' ||
      event.type === 'GuardianAngelSavedFromBurning'
    ) {
      const ga = findByRole(ROLE_BIT.GuardianAngel);
      if (ga) ledger.add(ga.id, 5);
    }
  }
  for (const p of players) {
    if (p.role === ROLE_BIT.GuardianAngel && p.gaGuardWolfCount > 0)
      ledger.add(p.id, -4 * Math.min(p.gaGuardWolfCount, 2));
  }

  // Gunner - bullets that hit a real threat vs bullets that didn't.
  for (const p of players) {
    if (p.role !== ROLE_BIT.Gunner) continue;
    if (p.bulletHitBaddies > 0) ledger.add(p.id, 4 * p.bulletHitBaddies);
    const fired = 2 - p.bullet;
    const wasted = Math.max(0, fired - p.bulletHitBaddies);
    if (wasted > 0) ledger.add(p.id, -3 * wasted);
  }

  // Hunter - the dying shot (or a counter-attack, always aimed at the real attacker) landing on a
  // wolf/threat vs an innocent villager.
  for (const death of deaths) {
    if (death.method !== 'HunterShot') continue;
    const shooterId = death.killerIds[0];
    if (shooterId === undefined) continue;
    const victim = findPlayer(death.playerId);
    if (!victim) continue;
    if (isWolf(victim.role) || victim.team === 'SerialKiller' || victim.team === 'Cult')
      ledger.add(shooterId, 5);
    else if (victim.team === 'Village') ledger.add(shooterId, -5);
  }
  for (const event of allEvents) {
    if (event.type === 'HunterCounterAttack') ledger.add(event.hunterId, 4);
  }

  // Serial Killer - kills that happened to thin out the wolf pack (SerialSamaritan-style), a
  // small extra credit on top of their (already generous) solo-win bonus.
  for (const death of deaths) {
    if (death.method !== 'SerialKilled') continue;
    const victim = findPlayer(death.playerId);
    if (victim && isWolf(victim.role)) {
      for (const killerId of death.killerIds) ledger.add(killerId, 2);
    }
  }

  // Chemist - a poison that actually killed someone else vs one that backfired on themselves.
  for (const death of deaths) {
    if (death.method !== 'Chemistry' || death.killerIds.length === 0) continue;
    const chemistId = death.killerIds[0]!;
    if (death.playerId !== chemistId) ledger.add(chemistId, 5);
  }
  for (const event of allEvents) {
    if (event.type === 'ChemistBackfired') ledger.add(event.chemistId, -5);
  }

  // Alpha Wolf - infecting the Serial Killer and successful bites are the role's whole gimmick.
  for (const p of players) {
    if (p.role === ROLE_BIT.AlphaWolf && p.strongestAlpha) ledger.add(p.id, 6);
  }
  {
    const alpha = findByRole(ROLE_BIT.AlphaWolf);
    if (alpha) {
      const bites = allEvents.filter((e) => e.type === 'BittenPlayerTurnedWolf').length;
      if (bites > 0) ledger.add(alpha.id, 3 * Math.min(bites, 2));
    }
  }

  // Viper Wolf - a poison that actually landed a kill.
  {
    const viper = findByRole(ROLE_BIT.ViperWolf);
    if (viper) {
      for (const death of deaths) {
        if (death.method === 'ViperPoison' && death.killerIds.includes(viper.id))
          ledger.add(viper.id, 5);
      }
    }
  }

  // Trapper Wolf - a set trap whose target actually ended up dead.
  for (const event of allEvents) {
    if (event.type !== 'TrapperWolfTrapSet') continue;
    if (deaths.some((d) => d.playerId === event.targetId)) ledger.add(event.trapperId, 4);
  }

  // Cultist Hunter - real cultist kills.
  {
    const counts = new Map<bigint, number>();
    for (const event of allEvents) {
      if (event.type !== 'CultistHunterKilledCultist') continue;
      counts.set(event.cultistHunterId, (counts.get(event.cultistHunterId) ?? 0) + 1);
    }
    for (const [id, count] of counts) ledger.add(id, 3 * count);
  }

  // Necromancer / Priestess - a resurrection or a blessing that actually saved someone are both
  // unambiguous wins for the role.
  for (const event of allEvents) {
    if (event.type === 'PlayerResurrected') ledger.add(event.necromancerId, 5);
    if (event.type === 'PriestessBlessingSaved') ledger.add(event.priestessId, 5);
  }

  // Archangel - the bonus bullet either lands or it doesn't.
  for (const event of allEvents) {
    if (event.type === 'ArchangelShotFired') ledger.add(event.archangelId, event.hit ? 5 : -5);
  }

  // Hitman / Reflector / Avenger - each role's entire win condition is a single clean event.
  for (const event of allEvents) {
    if (event.type === 'HitmanTargetEliminated') ledger.add(event.hitmanId, 6);
    if (event.type === 'ReflectorReflected') ledger.add(event.reflectorId, 5);
    if (event.type === 'AvengerRivalLynched') ledger.add(event.avengerId, 6);
  }

  // Pacifist - actually cancelled a majority-vote lynch (on themselves or their lover).
  for (const p of players) {
    if (p.everyManForHimself) ledger.add(p.id, 5);
    if (p.mySweetieSoStrong) ledger.add(p.id, 5);
  }

  // Wolf Man - survived being checked by the real Seer without getting burned, and won.
  for (const p of players) {
    if (p.role === ROLE_BIT.WolfMan && p.trustworthy && !p.isDead && p.won) ledger.add(p.id, 4);
  }

  // Cupid - a deliberate (not speed-dating) pairing that both lovers survived to see through.
  for (const event of allEvents) {
    if (event.type !== 'LoversCreated') continue;
    const cupid = findByRole(ROLE_BIT.Cupid);
    if (!cupid) continue;
    const lover1 = findPlayer(event.lover1Id);
    const lover2 = findPlayer(event.lover2Id);
    if (lover1?.speedDating || lover2?.speedDating) continue;
    if (lover1 && lover2 && !lover1.isDead && !lover2.isDead) ledger.add(cupid.id, 4);
  }

  // Mayor / Clumsy Guy - already tracked by dedicated counters.
  for (const p of players) {
    if (p.role === ROLE_BIT.Mayor && p.mayorLynchAfterRevealCount > 0)
      ledger.add(p.id, 2 * Math.min(p.mayorLynchAfterRevealCount, 3));
    if (p.role === ROLE_BIT.ClumsyGuy && p.clumsyCorrectLynchCount > 0)
      ledger.add(p.id, 2 * Math.min(p.clumsyCorrectLynchCount, 3));
  }

  return ledger.toMap();
}
