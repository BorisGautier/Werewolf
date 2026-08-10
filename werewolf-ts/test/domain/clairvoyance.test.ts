import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import {
  augurSees,
  foolSeesRandomRole,
  oracleSeesRandomRole,
  seerSees,
  sorcererDetects,
} from '../../src/domain/game/clairvoyance.js';

describe('seerSees', () => {
  it('sees most roles accurately, including the Beholder', () => {
    expect(seerSees(ROLE_BIT.Villager)).toBe(ROLE_BIT.Villager);
    expect(seerSees(ROLE_BIT.Beholder)).toBe(ROLE_BIT.Beholder);
    expect(seerSees(ROLE_BIT.Wolf)).toBe(ROLE_BIT.Wolf);
  });

  it('disguises Wolf Cub and Alpha Wolf as generic Wolf', () => {
    expect(seerSees(ROLE_BIT.WolfCub)).toBe(ROLE_BIT.Wolf);
    expect(seerSees(ROLE_BIT.AlphaWolf)).toBe(ROLE_BIT.Wolf);
  });

  it('deceptively shows the WolfMan as a Wolf and the Lycan as a Villager', () => {
    expect(seerSees(ROLE_BIT.WolfMan)).toBe(ROLE_BIT.Wolf);
    expect(seerSees(ROLE_BIT.Lycan)).toBe(ROLE_BIT.Villager);
  });

  it("splits the Traitor 50/50 between Wolf and Villager based on the roll", () => {
    expect(seerSees(ROLE_BIT.Traitor, () => 0)).toBe(ROLE_BIT.Wolf);
    expect(seerSees(ROLE_BIT.Traitor, () => 0.99)).toBe(ROLE_BIT.Villager);
  });
});

describe('sorcererDetects', () => {
  it('detects classic wolves and the Alpha Wolf as generic Wolf', () => {
    expect(sorcererDetects(ROLE_BIT.Wolf)).toBe(ROLE_BIT.Wolf);
    expect(sorcererDetects(ROLE_BIT.AlphaWolf)).toBe(ROLE_BIT.Wolf);
    expect(sorcererDetects(ROLE_BIT.WolfCub)).toBe(ROLE_BIT.Wolf);
  });

  it('detects the Seer and the Snow Wolf specifically', () => {
    expect(sorcererDetects(ROLE_BIT.Seer)).toBe(ROLE_BIT.Seer);
    expect(sorcererDetects(ROLE_BIT.SnowWolf)).toBe(ROLE_BIT.SnowWolf);
  });

  it('detects nothing for every other role, including the Lycan', () => {
    expect(sorcererDetects(ROLE_BIT.Lycan)).toBeNull();
    expect(sorcererDetects(ROLE_BIT.Villager)).toBeNull();
  });
});

describe('foolSeesRandomRole', () => {
  it('returns null with no other eligible player', () => {
    const fool = createPlayer(1n, 'F', ROLE_BIT.Fool, 'Village');
    expect(foolSeesRandomRole([fool], fool.id)).toBeNull();
  });

  it('never returns the Fool itself or a Seer, and disguises wolf sub-types as generic Wolf', () => {
    const fool = createPlayer(1n, 'F', ROLE_BIT.Fool, 'Village');
    const seer = createPlayer(2n, 'S', ROLE_BIT.Seer, 'Village');
    const cub = createPlayer(3n, 'Cub', ROLE_BIT.WolfCub, 'Wolf');

    for (let i = 0; i < 20; i++) {
      const seen = foolSeesRandomRole([fool, seer, cub], fool.id);
      expect(seen).toBe(ROLE_BIT.Wolf); // the only eligible player left is the Wolf Cub, seen as generic Wolf
    }
  });

  it('excludes dead players', () => {
    const fool = createPlayer(1n, 'F', ROLE_BIT.Fool, 'Village');
    const dead = createPlayer(2n, 'D', ROLE_BIT.Villager, 'Village');
    dead.isDead = true;
    expect(foolSeesRandomRole([fool, dead], fool.id)).toBeNull();
  });
});

describe('oracleSeesRandomRole', () => {
  it('returns null with no eligible role left', () => {
    const oracle = createPlayer(1n, 'O', ROLE_BIT.Oracle, 'Village');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    expect(oracleSeesRandomRole([oracle, villager], oracle.id, ROLE_BIT.Villager)).toBeNull();
  });

  it('never returns the target role itself', () => {
    const oracle = createPlayer(1n, 'O', ROLE_BIT.Oracle, 'Village');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    const wolf = createPlayer(3n, 'W', ROLE_BIT.Wolf, 'Wolf');

    for (let i = 0; i < 20; i++) {
      expect(oracleSeesRandomRole([oracle, villager, wolf], oracle.id, ROLE_BIT.Villager)).toBe(ROLE_BIT.Wolf);
    }
  });
});

describe('augurSees', () => {
  it('shows a role not yet seen and not currently represented among the living (or freshly dead)', () => {
    const augur = createPlayer(1n, 'A', ROLE_BIT.Augur, 'Village');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');

    const seen = augurSees([augur, villager], augur, [ROLE_BIT.Villager, ROLE_BIT.Wolf]);

    expect(seen).toBe(ROLE_BIT.Wolf); // Villager is in play, Wolf isn't
    expect(augur.sawRoles).toContain(ROLE_BIT.Wolf);
  });

  it('counts a role as "in the game" if someone with it died this very night', () => {
    const augur = createPlayer(1n, 'A', ROLE_BIT.Augur, 'Village');
    const freshlyDeadWolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    freshlyDeadWolf.isDead = true;
    freshlyDeadWolf.diedLastNight = true;

    const seen = augurSees([augur, freshlyDeadWolf], augur, [ROLE_BIT.Wolf]);
    expect(seen).toBeNull(); // Wolf still "counts" as in the game tonight
  });

  it('never repeats a role already shown, and reports nothing once every role is exhausted', () => {
    const augur = createPlayer(1n, 'A', ROLE_BIT.Augur, 'Village');
    augur.sawRoles = [ROLE_BIT.Wolf];

    expect(augurSees([augur], augur, [ROLE_BIT.Wolf])).toBeNull();
  });

  it('shows Apprentice Seer instead of Seer if the Seer is about to be replaced', () => {
    const augur = createPlayer(1n, 'A', ROLE_BIT.Augur, 'Village');
    const appSeer = createPlayer(2n, 'AS', ROLE_BIT.ApprenticeSeer, 'Village');

    const seen = augurSees([augur, appSeer], augur, [ROLE_BIT.Seer]);

    expect(seen).toBe(ROLE_BIT.ApprenticeSeer);
  });
});
