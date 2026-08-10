import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import { SKIP_VOTE, resetLynchState, resolveLynchVotes } from '../../src/domain/game/lynch.js';

function villagers(n: number, startId = 1) {
  return Array.from({ length: n }, (_, i) => createPlayer(BigInt(startId + i), `V${i}`, ROLE_BIT.Villager, 'Village'));
}

describe('resolveLynchVotes', () => {
  it('lynches the player with the most votes', () => {
    const [a, b, c] = villagers(3);
    a!.choice = c!.id;
    b!.choice = c!.id;

    const { resolution } = resolveLynchVotes([a!, b!, c!], { lynchAttempt: 1 });

    expect(resolution).toEqual({ outcome: 'Lynched', playerId: c!.id });
    expect(c!.isDead).toBe(true);
  });

  it('ignores explicit skip votes and unset choices', () => {
    const [a, b, c] = villagers(3);
    a!.choice = SKIP_VOTE;
    b!.choice = null;

    const { resolution } = resolveLynchVotes([a!, b!, c!], { lynchAttempt: 1 });

    expect(resolution.outcome).toBe('NoVotes');
  });

  it('reports a tie without random-picking unless randomLynchOnTie is set', () => {
    const [a, b, c, d] = villagers(4);
    a!.choice = c!.id;
    b!.choice = d!.id;

    const { resolution } = resolveLynchVotes([a!, b!, c!, d!], { lynchAttempt: 1 });

    expect(resolution).toEqual({ outcome: 'Tied', tiedPlayerIds: [c!.id, d!.id] });
    expect(c!.isDead).toBe(false);
    expect(d!.isDead).toBe(false);
  });

  it('random-picks among tied players when randomLynchOnTie is enabled', () => {
    const [a, b, c, d] = villagers(4);
    a!.choice = c!.id;
    b!.choice = d!.id;

    const { resolution } = resolveLynchVotes([a!, b!, c!, d!], {
      lynchAttempt: 1,
      randomLynchOnTie: true,
      random: () => 0, // picks the first tied player
    });

    expect(resolution).toEqual({ outcome: 'Lynched', playerId: c!.id });
  });

  it('lets the Prince survive their first lynch instead of dying', () => {
    const prince = createPlayer(1n, 'Prince', ROLE_BIT.Prince, 'Village');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    villager.choice = prince.id;

    const { resolution } = resolveLynchVotes([prince, villager], { lynchAttempt: 1 });

    expect(resolution).toEqual({ outcome: 'PrinceSurvived', playerId: prince.id });
    expect(prince.isDead).toBe(false);
    expect(prince.hasUsedAbility).toBe(true);
  });

  it('a lynched Tanner ends the game immediately as a Tanner win', () => {
    const tanner = createPlayer(1n, 'Tanner', ROLE_BIT.Tanner, 'Tanner');
    const villager = createPlayer(2n, 'V', ROLE_BIT.Villager, 'Village');
    villager.choice = tanner.id;

    const { resolution, events } = resolveLynchVotes([tanner, villager], { lynchAttempt: 1 });

    expect(resolution).toEqual({ outcome: 'TannerWinByLynch', playerId: tanner.id });
    expect(tanner.isDead).toBe(true);
    expect(tanner.won).toBe(true);
    expect(events.some((e) => e.type === 'GameEnded' && e.winningTeam === 'Tanner')).toBe(true);
  });

  it("counts a revealed Mayor's vote twice", () => {
    const mayor = createPlayer(1n, 'Mayor', ROLE_BIT.Mayor, 'Village');
    mayor.hasUsedAbility = true; // already revealed
    const target = createPlayer(2n, 'Target', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(3n, 'Other', ROLE_BIT.Villager, 'Village');
    mayor.choice = target.id;
    other.choice = target.id;

    resolveLynchVotes([mayor, target, other], { lynchAttempt: 1 });

    expect(target.votes).toBe(3); // mayor's vote (x2) + other's vote
  });

  it('idle-kills a player who fails to vote twice in a row, only on the first attempt', () => {
    const idler = createPlayer(1n, 'Idler', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(2n, 'Other', ROLE_BIT.Villager, 'Village');
    idler.nonVoteCount = 1; // already missed one round
    other.choice = other.id; // irrelevant, just needs a valid target

    const { events } = resolveLynchVotes([idler, other], { lynchAttempt: 1 });

    expect(idler.isDead).toBe(true);
    expect(idler.diedByFleeOrIdle).toBe(true);
    expect(events.some((e) => e.type === 'PlayerDied' && e.playerId === idler.id && e.method === 'Idle')).toBe(true);
  });

  it('does not idle-kill on the second lynch attempt (double-lynch round)', () => {
    const idler = createPlayer(1n, 'Idler', ROLE_BIT.Villager, 'Village');
    idler.nonVoteCount = 1;

    resolveLynchVotes([idler], { lynchAttempt: 2 });

    expect(idler.isDead).toBe(false);
  });
});

describe('resetLynchState', () => {
  it('clears votes and voter sets for every player', () => {
    const p = createPlayer(1n, 'P', ROLE_BIT.Villager, 'Village');
    p.votes = 3;
    p.votedBy.add(2n);

    resetLynchState([p]);

    expect(p.votes).toBe(0);
    expect(p.votedBy.size).toBe(0);
  });
});
