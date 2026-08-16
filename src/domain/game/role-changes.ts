/**
 * Port of `CheckRoleChanges`, `ValidateSpecialRoleChoices`, `CheckWildChild`,
 * `CheckDoppelganger`, `CreateLovers`, `NotifyLovers` and `AddLover`.
 *
 * `checkRoleChanges` is the recurring "did anyone's role need to flip"
 * check the original runs after nearly every death (Apprentice Seer
 * promotion, Wild Child/Doppelganger transformation on their role model's
 * death). `validateSpecialRoleChoices` is the day-1-only setup/safety-net
 * pass: it assigns a random role model to the Wild Child/Doppelganger if
 * they never got to pick one, and makes sure exactly two players end up
 * "in love" even if Cupid's own choice (made through a Telegram menu -
 * outside this domain layer) never resolved to a valid pair.
 */

import { ROLE_BIT } from '../roles/role.js';
import type { GameEvent } from './game-event.js';
import type { Player } from './player.js';
import { getTeamForRole } from './team.js';
import { promoteToWolf } from './transform.js';
import {
  cupidLoverLinks,
  doppelgangerAssignments,
  wildChildAssignments,
  wildChildTransformations,
} from '../../infrastructure/monitoring/metrics.js';

function chooseRandomPlayerId(
  players: readonly Player[],
  excludeId: bigint | null,
  aliveOnly: boolean,
  random: () => number,
): bigint | null {
  const possible = players.filter((p) => p.id !== excludeId && (!aliveOnly || !p.isDead));
  if (possible.length === 0) return null;
  return possible[Math.floor(random() * possible.length)]!.id;
}

function checkWildChild(players: Player[], checkBitten: boolean): GameEvent[] {
  const wc = players.find((p) => p.role === ROLE_BIT.WildChild && !p.isDead);
  if (!wc || (checkBitten && wc.bitten)) return [];

  const roleModel = players.find((p) => p.id === wc.roleModel);
  if (roleModel?.isDead) {
    promoteToWolf(wc);
    wildChildTransformations.inc();
    return [{ type: 'WildChildTurnedWolf', playerId: wc.id, roleModelId: roleModel.id }];
  }
  return [];
}

function checkDoppelganger(players: Player[], checkBitten: boolean): GameEvent[] {
  const dg = players.find((p) => p.role === ROLE_BIT.Doppelganger && !p.isDead);
  if (!dg || (checkBitten && dg.bitten)) return [];

  const roleModel = players.find((p) => p.id === dg.roleModel);
  if (roleModel?.isDead) {
    dg.role = roleModel.role;
    dg.team = getTeamForRole(roleModel.role);
    dg.changedRolesCount++;
    dg.roleModel = roleModel.roleModel;
    dg.hasUsedAbility = false;
    if (roleModel.role === ROLE_BIT.Spumpkin || roleModel.role === ROLE_BIT.Gunner) {
      dg.bullet = 2;
    }
    return [
      {
        type: 'DoppelgangerTransformed',
        playerId: dg.id,
        newRole: roleModel.role,
        roleModelId: roleModel.id,
      },
    ];
  }
  return [];
}

export function checkRoleChanges(players: Player[], checkBitten = false): GameEvent[] {
  const events: GameEvent[] = [];

  const apprentice = players.find((p) => p.role === ROLE_BIT.ApprenticeSeer && !p.isDead);
  if (apprentice && (!checkBitten || !apprentice.bitten)) {
    const seerAlive = players.some((p) => p.role === ROLE_BIT.Seer && !p.isDead);
    if (!seerAlive) {
      apprentice.role = ROLE_BIT.Seer;
      apprentice.team = getTeamForRole(ROLE_BIT.Seer);
      apprentice.changedRolesCount++;
      events.push({ type: 'ApprenticeSeerPromoted', playerId: apprentice.id });
    }
  }

  events.push(...checkWildChild(players, checkBitten));
  events.push(...checkDoppelganger(players, checkBitten));

  return events;
}

function addLover(
  players: readonly Player[],
  existingId: bigint | null,
  random: () => number,
): Player | null {
  const loverId = chooseRandomPlayerId(players, existingId, false, random);
  const lover = players.find((p) => p.id === loverId);
  if (!lover) return null;

  lover.inLove = true;
  lover.speedDating = true;
  if (existingId !== null) {
    const existing = players.find((p) => p.id === existingId);
    if (existing) {
      existing.loverId = lover.id;
      lover.loverId = existing.id;
    }
  }
  return lover;
}

function createLovers(players: Player[], random: () => number): void {
  const inLove = players.filter((p) => p.inLove);

  if (inLove.length === 2) return;

  if (inLove.length > 2) {
    const [l1, l2] = inLove;
    l1!.loverId = l2!.id;
    l2!.loverId = l1!.id;
    for (const extra of inLove.slice(2)) {
      extra.inLove = false;
      extra.loverId = null;
    }
    return;
  }

  const existing = players.find((p) => p.inLove) ?? addLover(players, null, random);
  if (existing) addLover(players, existing.id, random);
}

function notifyLovers(players: Player[], random: () => number): GameEvent[] {
  let inLove = players.filter((p) => p.inLove);
  if (inLove.length !== 2) {
    createLovers(players, random);
    inLove = players.filter((p) => p.inLove);
  }
  if (inLove.length === 2) {
    cupidLoverLinks.inc();
    return [{ type: 'LoversCreated', lover1Id: inLove[0]!.id, lover2Id: inLove[1]!.id }];
  }
  return [];
}

export function validateSpecialRoleChoices(
  players: Player[],
  dayNumber: number,
  random: () => number,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (dayNumber !== 1) return events;

  const wildChild = players.find((p) => p.role === ROLE_BIT.WildChild);
  if (wildChild && wildChild.roleModel === null) {
    const choiceId = chooseRandomPlayerId(players, wildChild.id, false, random);
    if (choiceId !== null) {
      wildChild.roleModel = choiceId;
      wildChildAssignments.inc();
      events.push({ type: 'RoleModelChosen', playerId: wildChild.id, roleModelId: choiceId });
    }
  }

  const doppelganger = players.find((p) => p.role === ROLE_BIT.Doppelganger);
  if (doppelganger && doppelganger.roleModel === null) {
    const choiceId = chooseRandomPlayerId(players, doppelganger.id, false, random);
    if (choiceId !== null) {
      doppelganger.roleModel = choiceId;
      doppelgangerAssignments.inc();
      events.push({ type: 'RoleModelChosen', playerId: doppelganger.id, roleModelId: choiceId });
    }
  }

  if (players.some((p) => p.role === ROLE_BIT.Cupid)) {
    events.push(...notifyLovers(players, random));
  }

  return events;
}
