import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { checkRoleChanges, validateSpecialRoleChoices } from '../../src/domain/game/role-changes.js';

describe('checkRoleChanges', () => {
  it('promotes the Apprentice Seer to Seer once the Seer dies', () => {
    const apprentice = createPlayer(1n, 'AS', ROLE_BIT.ApprenticeSeer, 'Village');
    const deadSeer = createPlayer(2n, 'Seer', ROLE_BIT.Seer, 'Village');
    deadSeer.isDead = true;

    const events = checkRoleChanges([apprentice, deadSeer]);

    expect(apprentice.role).toBe(ROLE_BIT.Seer);
    expect(events.some((e) => e.type === 'ApprenticeSeerPromoted')).toBe(true);
  });

  it('does not promote the Apprentice Seer while the real Seer is still alive', () => {
    const apprentice = createPlayer(1n, 'AS', ROLE_BIT.ApprenticeSeer, 'Village');
    const seer = createPlayer(2n, 'Seer', ROLE_BIT.Seer, 'Village');

    checkRoleChanges([apprentice, seer]);

    expect(apprentice.role).toBe(ROLE_BIT.ApprenticeSeer);
  });

  it('blocks the Apprentice Seer promotion when checkBitten is set and they are bitten', () => {
    const apprentice = createPlayer(1n, 'AS', ROLE_BIT.ApprenticeSeer, 'Village');
    apprentice.bitten = true;
    const deadSeer = createPlayer(2n, 'Seer', ROLE_BIT.Seer, 'Village');
    deadSeer.isDead = true;

    checkRoleChanges([apprentice, deadSeer], true);

    expect(apprentice.role).toBe(ROLE_BIT.ApprenticeSeer);
  });

  it('turns the Wild Child into a Wolf once their role model dies', () => {
    const wc = createPlayer(1n, 'WC', ROLE_BIT.WildChild, 'Village');
    const model = createPlayer(2n, 'Model', ROLE_BIT.Villager, 'Village');
    wc.roleModel = model.id;
    model.isDead = true;

    const events = checkRoleChanges([wc, model]);

    expect(wc.role).toBe(ROLE_BIT.Wolf);
    expect(wc.team).toBe('Wolf');
    expect(events.some((e) => e.type === 'WildChildTurnedWolf')).toBe(true);
  });

  it("does not turn the Wild Child while their role model is alive", () => {
    const wc = createPlayer(1n, 'WC', ROLE_BIT.WildChild, 'Village');
    const model = createPlayer(2n, 'Model', ROLE_BIT.Villager, 'Village');
    wc.roleModel = model.id;

    checkRoleChanges([wc, model]);

    expect(wc.role).toBe(ROLE_BIT.WildChild);
  });

  it('transforms the Doppelganger into their dead role model\'s exact role', () => {
    const dg = createPlayer(1n, 'DG', ROLE_BIT.Doppelganger, 'Thief');
    const model = createPlayer(2n, 'Model', ROLE_BIT.Seer, 'Village');
    dg.roleModel = model.id;
    model.isDead = true;

    const events = checkRoleChanges([dg, model]);

    expect(dg.role).toBe(ROLE_BIT.Seer);
    expect(dg.team).toBe('Village');
    expect(dg.hasUsedAbility).toBe(false);
    expect(events.some((e) => e.type === 'DoppelgangerTransformed' && e.newRole === ROLE_BIT.Seer)).toBe(true);
  });

  it('restores a full 2-bullet count when the Doppelganger copies a Gunner or Spumpkin', () => {
    const dg = createPlayer(1n, 'DG', ROLE_BIT.Doppelganger, 'Thief');
    dg.bullet = 0;
    const model = createPlayer(2n, 'Model', ROLE_BIT.Gunner, 'Village');
    model.bullet = 0; // the model had already used their bullets
    dg.roleModel = model.id;
    model.isDead = true;

    checkRoleChanges([dg, model]);

    expect(dg.role).toBe(ROLE_BIT.Gunner);
    expect(dg.bullet).toBe(2);
  });

  it('carries over the role model chain (roleModel of the copied role)', () => {
    const dg = createPlayer(1n, 'DG', ROLE_BIT.Doppelganger, 'Thief');
    const model = createPlayer(2n, 'Model', ROLE_BIT.WildChild, 'Village');
    model.roleModel = 999n;
    dg.roleModel = model.id;
    model.isDead = true;

    checkRoleChanges([dg, model]);

    expect(dg.roleModel).toBe(999n);
  });
});

describe('validateSpecialRoleChoices', () => {
  it('does nothing after day 1', () => {
    const wc = createPlayer(1n, 'WC', ROLE_BIT.WildChild, 'Village');
    const other = createPlayer(2n, 'O', ROLE_BIT.Villager, 'Village');

    validateSpecialRoleChoices([wc, other], 2, () => 0);

    expect(wc.roleModel).toBeNull();
  });

  it('assigns a random role model to a Wild Child who never picked one', () => {
    const wc = createPlayer(1n, 'WC', ROLE_BIT.WildChild, 'Village');
    const other = createPlayer(2n, 'O', ROLE_BIT.Villager, 'Village');

    const events = validateSpecialRoleChoices([wc, other], 1, () => 0);

    expect(wc.roleModel).toBe(other.id);
    expect(events.some((e) => e.type === 'RoleModelChosen' && e.playerId === wc.id)).toBe(true);
  });

  it('does not overwrite a role model the Wild Child already has', () => {
    const wc = createPlayer(1n, 'WC', ROLE_BIT.WildChild, 'Village');
    const other = createPlayer(2n, 'O', ROLE_BIT.Villager, 'Village');
    wc.roleModel = other.id;

    validateSpecialRoleChoices([wc, other], 1, () => 0.99);

    expect(wc.roleModel).toBe(other.id);
  });

  it('ensures exactly two lovers exist when a Cupid is in the game and nobody is in love yet', () => {
    const cupid = createPlayer(1n, 'Cupid', ROLE_BIT.Cupid, 'Village');
    const a = createPlayer(2n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(3n, 'B', ROLE_BIT.Villager, 'Village');

    const events = validateSpecialRoleChoices([cupid, a, b], 1, () => 0);

    const lovers = [cupid, a, b].filter((p) => p.inLove);
    expect(lovers).toHaveLength(2);
    expect(lovers[0]!.loverId).toBe(lovers[1]!.id);
    expect(lovers[1]!.loverId).toBe(lovers[0]!.id);
    expect(events.some((e) => e.type === 'LoversCreated')).toBe(true);
  });

  it('trims extra lovers down to exactly two if somehow more than two are in love', () => {
    const cupid = createPlayer(1n, 'Cupid', ROLE_BIT.Cupid, 'Village');
    const a = createPlayer(2n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(3n, 'B', ROLE_BIT.Villager, 'Village');
    const c = createPlayer(4n, 'C', ROLE_BIT.Villager, 'Village');
    a.inLove = true;
    b.inLove = true;
    c.inLove = true;

    validateSpecialRoleChoices([cupid, a, b, c], 1, () => 0);

    expect(a.inLove).toBe(true);
    expect(b.inLove).toBe(true);
    expect(c.inLove).toBe(false);
    expect(c.loverId).toBeNull();
  });

  it('leaves an already-valid pair of lovers untouched', () => {
    const cupid = createPlayer(1n, 'Cupid', ROLE_BIT.Cupid, 'Village');
    const a = createPlayer(2n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(3n, 'B', ROLE_BIT.Villager, 'Village');
    a.inLove = true;
    a.loverId = b.id;
    b.inLove = true;
    b.loverId = a.id;

    validateSpecialRoleChoices([cupid, a, b], 1, () => 0.5);

    expect(a.loverId).toBe(b.id);
    expect(b.loverId).toBe(a.id);
  });

  it('does nothing about lovers when there is no Cupid in the game', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');

    validateSpecialRoleChoices([a, b], 1, () => 0);

    expect(a.inLove).toBe(false);
    expect(b.inLove).toBe(false);
  });
});
