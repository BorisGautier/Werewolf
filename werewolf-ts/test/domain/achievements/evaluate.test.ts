import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../../src/domain/roles/role.js';
import { createPlayer, type Player } from '../../../src/domain/game/player.js';
import type { GameEvent } from '../../../src/domain/game/game-event.js';
import { evaluateGameAchievements, type AchievementEvalContext } from '../../../src/domain/achievements/evaluate.js';

function ctx(players: Player[], overrides: Partial<AchievementEvalContext> = {}): AchievementEvalContext {
  return { players, mode: 'Normal', winningTeam: 'Village', eventBatches: [], showRolesOnDeath: true, ...overrides };
}

function unlocksFor(map: Map<bigint, string[]>, id: bigint): string[] {
  return map.get(id) ?? [];
}

describe('evaluateGameAchievements', () => {
  it('grants WelcomeToHell to everyone, and WelcomeToAsylum only in chaos mode', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'B', ROLE_BIT.Wolf, 'Wolf');

    const normal = evaluateGameAchievements(ctx([a, b]));
    expect(unlocksFor(normal, 1n)).toContain('WelcomeToHell');
    expect(unlocksFor(normal, 1n)).not.toContain('WelcomeToAsylum');

    const chaos = evaluateGameAchievements(ctx([a, b], { mode: 'Chaos' }));
    expect(unlocksFor(chaos, 1n)).toContain('WelcomeToAsylum');
    expect(unlocksFor(chaos, 2n)).toContain('WelcomeToAsylum');
  });

  it('grants SpyVsSpy only when roles are hidden on death', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    expect(unlocksFor(evaluateGameAchievements(ctx([a], { showRolesOnDeath: false })), 1n)).toContain('SpyVsSpy');
    expect(unlocksFor(evaluateGameAchievements(ctx([a], { showRolesOnDeath: true })), 1n)).not.toContain('SpyVsSpy');
  });

  it('grants Enochlophobia for 35+ players and Introvert for exactly 5', () => {
    const many = Array.from({ length: 35 }, (_, i) => createPlayer(BigInt(i + 1), `P${i}`, ROLE_BIT.Villager, 'Village'));
    expect(unlocksFor(evaluateGameAchievements(ctx(many)), 1n)).toContain('Enochlophobia');

    const five = Array.from({ length: 5 }, (_, i) => createPlayer(BigInt(i + 1), `P${i}`, ROLE_BIT.Villager, 'Village'));
    expect(unlocksFor(evaluateGameAchievements(ctx(five)), 1n)).toContain('Introvert');
  });

  it('grants Masochist to a winning Tanner and Wobble to a surviving Drunk in a 10+ game', () => {
    const tanner = createPlayer(1n, 'T', ROLE_BIT.Tanner, 'Tanner');
    tanner.won = true;
    const drunk = createPlayer(2n, 'D', ROLE_BIT.Drunk, 'Village');
    const rest = Array.from({ length: 8 }, (_, i) => createPlayer(BigInt(i + 3), `P${i}`, ROLE_BIT.Villager, 'Village'));

    const result = evaluateGameAchievements(ctx([tanner, drunk, ...rest]));
    expect(unlocksFor(result, 1n)).toContain('Masochist');
    expect(unlocksFor(result, 2n)).toContain('Wobble');
  });

  it('grants MasonBrother to both masons when 2+ survive', () => {
    const m1 = createPlayer(1n, 'M1', ROLE_BIT.Mason, 'Village');
    const m2 = createPlayer(2n, 'M2', ROLE_BIT.Mason, 'Village');
    const result = evaluateGameAchievements(ctx([m1, m2]));
    expect(unlocksFor(result, 1n)).toContain('MasonBrother');
    expect(unlocksFor(result, 2n)).toContain('MasonBrother');
  });

  it('grants DoubleShifter for 2+ role changes, and ChangingSides only if they also won', () => {
    const shifter = createPlayer(1n, 'S', ROLE_BIT.Villager, 'Village');
    shifter.changedRolesCount = 2;
    const winner = createPlayer(2n, 'W', ROLE_BIT.Villager, 'Village');
    winner.changedRolesCount = 1;
    winner.won = true;

    const result = evaluateGameAchievements(ctx([shifter, winner]));
    expect(unlocksFor(result, 1n)).toContain('DoubleShifter');
    expect(unlocksFor(result, 2n)).toContain('ChangingSides');
    expect(unlocksFor(result, 1n)).not.toContain('ChangingSides');
  });

  it('grants HeyManNiceShot for a Hunter dying-shot kill on a wolf, not for a counter-attack', () => {
    const hunter = createPlayer(1n, 'H', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const events: GameEvent[][] = [
      [
        { type: 'PlayerDied', playerId: 1n, method: 'Eat', killerIds: [2n], isNight: true }, // the hunter dies first
        { type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: true }, // then their dying shot
      ],
    ];
    const result = evaluateGameAchievements(ctx([hunter, wolf], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('HeyManNiceShot');
  });

  it('does not grant HeyManNiceShot for a live counter-attack (shooter has no prior death)', () => {
    const hunter = createPlayer(1n, 'H', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: true }]];
    const result = evaluateGameAchievements(ctx([hunter, wolf], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).not.toContain('HeyManNiceShot');
  });

  it('grants DontStayHome to the wolf pack when a Harlot is eaten at home', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const harlot = createPlayer(2n, 'Ha', ROLE_BIT.Harlot, 'Village');
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 2n, method: 'Eat', killerIds: [1n], isNight: true }]];
    const result = evaluateGameAchievements(ctx([wolf, harlot], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('DontStayHome');
  });

  it('grants DoubleKill to the SK and Hunter on an SKHunter team win', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const hunter = createPlayer(2n, 'H', ROLE_BIT.Hunter, 'Village');
    const result = evaluateGameAchievements(ctx([sk, hunter], { winningTeam: 'SKHunter' }));
    expect(unlocksFor(result, 1n)).toContain('DoubleKill');
    expect(unlocksFor(result, 2n)).toContain('DoubleKill');
  });

  it('grants LackOfTrust to a Seer who is the game\'s first lynch victim', () => {
    const seer = createPlayer(1n, 'S', ROLE_BIT.Seer, 'Village');
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 1n, method: 'Lynch', killerIds: [], isNight: false }]];
    const result = evaluateGameAchievements(ctx([seer], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('LackOfTrust');
  });

  it('grants BloodyNight to all 4+ victims of the same night', () => {
    const players = Array.from({ length: 4 }, (_, i) => createPlayer(BigInt(i + 1), `P${i}`, ROLE_BIT.Villager, 'Village'));
    const events: GameEvent[][] = [
      players.map((p) => ({ type: 'PlayerDied', playerId: p.id, method: 'Eat', killerIds: [], isNight: true }) as GameEvent),
    ];
    const result = evaluateGameAchievements(ctx(players, { eventBatches: events }));
    for (const p of players) expect(unlocksFor(result, p.id)).toContain('BloodyNight');
  });

  it('grants ForbiddenLove to a winning wolf/villager lover pair', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    wolf.won = true;
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    villager.won = true;
    const events: GameEvent[][] = [[{ type: 'LoversCreated', lover1Id: 1n, lover2Id: 2n }]];
    const result = evaluateGameAchievements(ctx([wolf, villager], { winningTeam: 'Wolf', eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('ForbiddenLove');
    expect(unlocksFor(result, 2n)).toContain('ForbiddenLove');
  });

  it('grants CultCon when 10+ cultists survive', () => {
    const cultists = Array.from({ length: 10 }, (_, i) => createPlayer(BigInt(i + 1), `C${i}`, ROLE_BIT.Cultist, 'Cult'));
    const result = evaluateGameAchievements(ctx(cultists, { winningTeam: 'Cult' }));
    for (const c of cultists) expect(unlocksFor(result, c.id)).toContain('CultCon');
  });

  it('grants SelfLoving when Cupid picks themselves as a lover', () => {
    const cupid = createPlayer(1n, 'C', ROLE_BIT.Cupid, 'Village');
    const other = createPlayer(2n, 'O', ROLE_BIT.Villager, 'Village');
    const events: GameEvent[][] = [[{ type: 'LoversCreated', lover1Id: 1n, lover2Id: 2n }]];
    const result = evaluateGameAchievements(ctx([cupid, other], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('SelfLoving');
  });

  it('grants SerialSamaritan to a Serial Killer who kills 3 wolves', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    const wolves = Array.from({ length: 3 }, (_, i) => createPlayer(BigInt(i + 2), `W${i}`, ROLE_BIT.Wolf, 'Wolf'));
    const events: GameEvent[][] = wolves.map((w) => [
      { type: 'PlayerDied', playerId: w.id, method: 'SerialKilled', killerIds: [1n], isNight: true } as GameEvent,
    ]);
    const result = evaluateGameAchievements(ctx([sk, ...wolves], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('SerialSamaritan');
  });

  it('grants LoneWolf to the sole wolf in a 10+ player chaos game who wins', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    wolf.won = true;
    const villagers = Array.from({ length: 9 }, (_, i) => createPlayer(BigInt(i + 2), `V${i}`, ROLE_BIT.Villager, 'Village'));
    const result = evaluateGameAchievements(ctx([wolf, ...villagers], { mode: 'Chaos', winningTeam: 'Wolf' }));
    expect(unlocksFor(result, 1n)).toContain('LoneWolf');
  });

  it('grants PackHunter for 7+ living wolves', () => {
    const wolves = Array.from({ length: 7 }, (_, i) => createPlayer(BigInt(i + 1), `W${i}`, ROLE_BIT.Wolf, 'Wolf'));
    const result = evaluateGameAchievements(ctx(wolves, { winningTeam: 'Wolf' }));
    for (const w of wolves) expect(unlocksFor(result, w.id)).toContain('PackHunter');
  });

  it('grants OhShi when a wolf eats their own lover on the first night', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const lover = createPlayer(2n, 'L', ROLE_BIT.Villager, 'Village');
    lover.loverId = 1n;
    wolf.loverId = 2n;
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 2n, method: 'Eat', killerIds: [1n], isNight: true }]];
    const result = evaluateGameAchievements(ctx([wolf, lover], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('OhShi');
  });

  it('grants NoSorcery to the pack when they eat their own Sorcerer', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const sorcerer = createPlayer(2n, 'S', ROLE_BIT.Sorcerer, 'Wolf');
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 2n, method: 'Eat', killerIds: [1n], isNight: true }]];
    const result = evaluateGameAchievements(ctx([wolf, sorcerer], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('NoSorcery');
  });

  it('grants CultistTracker for 3+ cultist kills', () => {
    const hunter = createPlayer(1n, 'CH', ROLE_BIT.CultistHunter, 'Village');
    const events: GameEvent[][] = [
      [{ type: 'CultistHunterKilledCultist', cultistHunterId: 1n, cultistId: 2n }],
      [{ type: 'CultistHunterKilledCultist', cultistHunterId: 1n, cultistId: 3n }],
      [{ type: 'CultistHunterKilledCultist', cultistHunterId: 1n, cultistId: 4n }],
    ];
    const result = evaluateGameAchievements(ctx([hunter], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('CultistTracker');
  });

  it('grants WuffieCult to the Alpha Wolf after 3 successful bites', () => {
    const alpha = createPlayer(1n, 'A', ROLE_BIT.AlphaWolf, 'Wolf');
    const events: GameEvent[][] = [
      [{ type: 'BittenPlayerTurnedWolf', playerId: 2n }],
      [{ type: 'BittenPlayerTurnedWolf', playerId: 3n }],
      [{ type: 'BittenPlayerTurnedWolf', playerId: 4n }],
    ];
    const result = evaluateGameAchievements(ctx([alpha], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('WuffieCult');
  });

  it('grants SpoiledRichBrat to a Prince who ends up lynched', () => {
    const prince = createPlayer(1n, 'P', ROLE_BIT.Prince, 'Village');
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 1n, method: 'Lynch', killerIds: [], isNight: false }]];
    const result = evaluateGameAchievements(ctx([prince], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('SpoiledRichBrat');
  });

  it('grants ThreeLittleWolves to a surviving Sorcerer with 3+ living wolves', () => {
    const sorcerer = createPlayer(1n, 'S', ROLE_BIT.Sorcerer, 'Wolf');
    const wolves = Array.from({ length: 3 }, (_, i) => createPlayer(BigInt(i + 2), `W${i}`, ROLE_BIT.Wolf, 'Wolf'));
    const result = evaluateGameAchievements(ctx([sorcerer, ...wolves], { winningTeam: 'Wolf' }));
    expect(unlocksFor(result, 1n)).toContain('ThreeLittleWolves');
  });

  it('grants ThatCameUnexpected to a winning Tanner lynched with 3 or fewer players left', () => {
    const tanner = createPlayer(1n, 'T', ROLE_BIT.Tanner, 'Tanner');
    tanner.won = true;
    tanner.isDead = true;
    const p2 = createPlayer(2n, 'P2', ROLE_BIT.Villager, 'Village');
    const p3 = createPlayer(3n, 'P3', ROLE_BIT.Villager, 'Village');
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 1n, method: 'Lynch', killerIds: [], isNight: false }]];
    const result = evaluateGameAchievements(ctx([tanner, p2, p3], { winningTeam: 'Tanner', eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('ThatCameUnexpected');
  });

  it('grants CultLeader to a founding cultist who survives and wins', () => {
    const founder = createPlayer(1n, 'C', ROLE_BIT.Cultist, 'Cult');
    founder.won = true;
    founder.dayCult = 0;
    const converted = createPlayer(2n, 'C2', ROLE_BIT.Cultist, 'Cult');
    converted.won = true;
    converted.dayCult = 2;
    const result = evaluateGameAchievements(ctx([founder, converted], { winningTeam: 'Cult' }));
    expect(unlocksFor(result, 1n)).toContain('CultLeader');
    expect(unlocksFor(result, 2n)).not.toContain('CultLeader');
  });

  it('grants DeathVillage to everyone when there is no winning team', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const result = evaluateGameAchievements(ctx([a], { winningTeam: undefined }));
    expect(unlocksFor(result, 1n)).toContain('DeathVillage');
  });

  it('grants ConditionRed to the last living wolf who ate the Traitor', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const traitor = createPlayer(2n, 'T', ROLE_BIT.Traitor, 'Village');
    traitor.isDead = true;
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 2n, method: 'Eat', killerIds: [1n], isNight: true }]];
    const result = evaluateGameAchievements(ctx([wolf, traitor], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('ConditionRed');
  });

  it('grants Indestructible when a role model choice targets oneself', () => {
    const wc = createPlayer(1n, 'WC', ROLE_BIT.WildChild, 'Village');
    const events: GameEvent[][] = [[{ type: 'RoleModelChosen', playerId: 1n, roleModelId: 1n }]];
    const result = evaluateGameAchievements(ctx([wc], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('Indestructible');
  });

  it('grants PsychopathKiller to a winning Serial Killer in a 35-player game', () => {
    const sk = createPlayer(1n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sk.won = true;
    const rest = Array.from({ length: 34 }, (_, i) => createPlayer(BigInt(i + 2), `P${i}`, ROLE_BIT.Villager, 'Village'));
    const result = evaluateGameAchievements(ctx([sk, ...rest], { winningTeam: 'SerialKiller' }));
    expect(unlocksFor(result, 1n)).toContain('PsychopathKiller');
  });

  it('grants RomeoAndJuliet to a winning lover of a lynched, winning Tanner', () => {
    const tanner = createPlayer(1n, 'T', ROLE_BIT.Tanner, 'Tanner');
    tanner.won = true;
    tanner.loverId = 2n;
    const lover = createPlayer(2n, 'L', ROLE_BIT.Villager, 'Village');
    lover.won = true;
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 1n, method: 'Lynch', killerIds: [], isNight: false }]];
    const result = evaluateGameAchievements(ctx([tanner, lover], { winningTeam: 'Tanner', eventBatches: events }));
    expect(unlocksFor(result, 2n)).toContain('RomeoAndJuliet');
  });

  it('grants Domino when a Hunter\'s shot kills another Hunter', () => {
    const shooter = createPlayer(1n, 'H1', ROLE_BIT.Hunter, 'Village');
    const victim = createPlayer(2n, 'H2', ROLE_BIT.Hunter, 'Village');
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: false }]];
    const result = evaluateGameAchievements(ctx([shooter, victim], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('Domino');
  });

  it('grants DoubleShot when a bad-team player kills their bad-team lover', () => {
    const shooter = createPlayer(1n, 'H', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    wolf.loverId = 3n;
    const sk = createPlayer(3n, 'SK', ROLE_BIT.SerialKiller, 'SerialKiller');
    sk.loverId = 2n;
    const events: GameEvent[][] = [[{ type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: false }]];
    const result = evaluateGameAchievements(ctx([shooter, wolf, sk], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('DoubleShot');
  });

  it('grants PlayingWithTheFire and Firework based on how many houses burned in one night', () => {
    const arsonist = createPlayer(1n, 'A', ROLE_BIT.Arsonist, 'Arsonist');
    const five = Array.from({ length: 5 }, (_, i) => ({
      type: 'PlayerDied',
      playerId: BigInt(i + 2),
      method: 'Burn',
      killerIds: [1n],
      isNight: true,
    })) as GameEvent[];
    const result5 = evaluateGameAchievements(ctx([arsonist], { eventBatches: [five] }));
    expect(unlocksFor(result5, 1n)).toContain('PlayingWithTheFire');
    expect(unlocksFor(result5, 1n)).not.toContain('Firework');

    const ten = Array.from({ length: 10 }, (_, i) => ({
      type: 'PlayerDied',
      playerId: BigInt(i + 2),
      method: 'Burn',
      killerIds: [1n],
      isNight: true,
    })) as GameEvent[];
    const result10 = evaluateGameAchievements(ctx([arsonist], { eventBatches: [ten] }));
    expect(unlocksFor(result10, 1n)).toContain('Firework');
  });

  it('grants ColdAsIce to the Snow Wolf who freezes the Harlot', () => {
    const snowWolf = createPlayer(1n, 'SW', ROLE_BIT.SnowWolf, 'Wolf');
    const harlot = createPlayer(2n, 'Ha', ROLE_BIT.Harlot, 'Village');
    const events: GameEvent[][] = [[{ type: 'PlayerFrozen', playerId: 2n, cause: 'SnowWolf' }]];
    const result = evaluateGameAchievements(ctx([snowWolf, harlot], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('ColdAsIce');
  });

  it('grants Firefighter to the Guardian Angel after cleaning 3 houses', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const events: GameEvent[][] = [
      [{ type: 'GuardianAngelCleanedDouse', playerId: 2n }],
      [{ type: 'GuardianAngelCleanedDouse', playerId: 3n }],
      [{ type: 'GuardianAngelCleanedDouse', playerId: 4n }],
    ];
    const result = evaluateGameAchievements(ctx([ga], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('Firefighter');
  });

  it('grants HelpfulParanoia to a Hunter who counter-attacks twice', () => {
    const hunter = createPlayer(1n, 'H', ROLE_BIT.Hunter, 'Village');
    const events: GameEvent[][] = [
      [{ type: 'HunterCounterAttack', hunterId: 1n, shotWolfId: 2n, hunterAlsoDied: false }],
      [{ type: 'HunterCounterAttack', hunterId: 1n, shotWolfId: 3n, hunterAlsoDied: false }],
    ];
    const result = evaluateGameAchievements(ctx([hunter], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('HelpfulParanoia');
  });

  it('grants STierHunter for killing a wolf and a cultist the same night', () => {
    const hunter = createPlayer(1n, 'H', ROLE_BIT.Hunter, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const cultist = createPlayer(3n, 'C', ROLE_BIT.Cultist, 'Cult');
    const events: GameEvent[][] = [
      [
        { type: 'PlayerDied', playerId: 2n, method: 'HunterShot', killerIds: [1n], isNight: true },
        { type: 'PlayerDied', playerId: 3n, method: 'HunterShot', killerIds: [1n], isNight: true },
      ],
    ];
    const result = evaluateGameAchievements(ctx([hunter, wolf, cultist], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('STierHunter');
  });

  it('grants TripleKill to a wolf who kills 3+ in one night', () => {
    const wolf = createPlayer(1n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const events: GameEvent[][] = [
      [
        { type: 'PlayerDied', playerId: 2n, method: 'Eat', killerIds: [1n], isNight: true },
        { type: 'PlayerDied', playerId: 3n, method: 'Eat', killerIds: [1n], isNight: true },
        { type: 'PlayerDied', playerId: 4n, method: 'Eat', killerIds: [1n], isNight: true },
      ],
    ];
    const result = evaluateGameAchievements(ctx([wolf], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('TripleKill');
  });

  it('grants ResistTheBeast to the WildChild/Traitor/Cursed trio when they win with the village', () => {
    const wc = createPlayer(1n, 'WC', ROLE_BIT.WildChild, 'Village');
    wc.won = true;
    const traitor = createPlayer(2n, 'T', ROLE_BIT.Traitor, 'Village');
    traitor.won = true;
    const cursed = createPlayer(3n, 'C', ROLE_BIT.Cursed, 'Village');
    cursed.won = true;
    const result = evaluateGameAchievements(ctx([wc, traitor, cursed], { winningTeam: 'Village' }));
    expect(unlocksFor(result, 1n)).toContain('ResistTheBeast');
    expect(unlocksFor(result, 2n)).toContain('ResistTheBeast');
    expect(unlocksFor(result, 3n)).toContain('ResistTheBeast');
  });

  it('grants AtLeastYouTried when a GA-saved player later dies to Chemist poison', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const events: GameEvent[][] = [
      [{ type: 'GuardianAngelBlockedWolfAttack', targetId: 2n }],
      [{ type: 'PlayerDied', playerId: 2n, method: 'Chemistry', killerIds: [3n], isNight: true }],
    ];
    const result = evaluateGameAchievements(ctx([ga], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('AtLeastYouTried');
  });

  it('grants InTheMiddleOfTheTrouble to the living Guardian Angel who blocked a wolf attack', () => {
    const ga = createPlayer(1n, 'GA', ROLE_BIT.GuardianAngel, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    const events: GameEvent[][] = [[{ type: 'GuardianAngelBlockedWolfAttack', targetId: 2n }]];
    const result = evaluateGameAchievements(ctx([ga, wolf], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('InTheMiddleOfTheTrouble');
  });

  it('grants DemotedByTheDeath when the Hunter\'s final shot demotes them for killing the Wise Elder', () => {
    const hunter = createPlayer(1n, 'H', ROLE_BIT.Villager, 'Village'); // already demoted by the time this fires
    const events: GameEvent[][] = [[{ type: 'HunterLostPowerToWiseElder', playerId: 1n }]];
    const result = evaluateGameAchievements(ctx([hunter], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('DemotedByTheDeath');
  });

  it('grants WastedSilver to the Blacksmith when Sandman sleep lands the same day as their silver spread', () => {
    const blacksmith = createPlayer(1n, 'B', ROLE_BIT.Blacksmith, 'Village');
    const sandman = createPlayer(2n, 'S', ROLE_BIT.Sandman, 'Village');
    const events: GameEvent[][] = [
      [{ type: 'BlacksmithSpreadSilver', playerId: 1n, dayNumber: 3 }],
      [{ type: 'SandmanUsedSleep', playerId: 2n, dayNumber: 3 }],
    ];
    const result = evaluateGameAchievements(ctx([blacksmith, sandman], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).toContain('WastedSilver');
  });

  it('does not grant WastedSilver when the Blacksmith and Sandman act on different days', () => {
    const blacksmith = createPlayer(1n, 'B', ROLE_BIT.Blacksmith, 'Village');
    const sandman = createPlayer(2n, 'S', ROLE_BIT.Sandman, 'Village');
    const events: GameEvent[][] = [
      [{ type: 'BlacksmithSpreadSilver', playerId: 1n, dayNumber: 2 }],
      [{ type: 'SandmanUsedSleep', playerId: 2n, dayNumber: 3 }],
    ];
    const result = evaluateGameAchievements(ctx([blacksmith, sandman], { eventBatches: events }));
    expect(unlocksFor(result, 1n)).not.toContain('WastedSilver');
  });
});
