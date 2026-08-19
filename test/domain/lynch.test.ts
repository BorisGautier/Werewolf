import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { createPlayer } from '../../src/domain/game/player.js';
import {
  SKIP_VOTE,
  resetLynchState,
  resolveClumsyGuyVote,
  resolveLynchVotes,
} from '../../src/domain/game/lynch.js';

function villagers(n: number, startId = 1) {
  return Array.from({ length: n }, (_, i) =>
    createPlayer(BigInt(startId + i), `V${i}`, ROLE_BIT.Villager, 'Village'),
  );
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

  it("applies a Crow's curse as +2 penalty votes, deciding a tie, then clears the curse so it doesn't linger", () => {
    const [a, b, c, d] = villagers(4);
    a!.choice = c!.id; // 1 vote for c
    b!.choice = d!.id; // 1 vote for d
    c!.isCursedByCrow = true; // +2 penalty votes breaks what would otherwise be a 1-1 tie against c

    const { resolution } = resolveLynchVotes([a!, b!, c!, d!], { lynchAttempt: 1 });

    expect(resolution).toEqual({ outcome: 'Lynched', playerId: c!.id });
    expect(c!.isCursedByCrow).toBe(false); // one-shot - cleared once applied
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
    expect(
      events.some((e) => e.type === 'PlayerDied' && e.playerId === idler.id && e.method === 'Idle'),
    ).toBe(true);
  });

  it('does not idle-kill on the second lynch attempt (double-lynch round)', () => {
    const idler = createPlayer(1n, 'Idler', ROLE_BIT.Villager, 'Village');
    idler.nonVoteCount = 1;

    resolveLynchVotes([idler], { lynchAttempt: 2 });

    expect(idler.isDead).toBe(false);
  });

  it('marks a lynch target as hasBeenVoted the moment anyone votes for them', () => {
    const voter = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    voter.choice = target.id;

    resolveLynchVotes([voter, target], { lynchAttempt: 1 });

    expect(target.hasBeenVoted).toBe(true);
    expect(voter.hasBeenVoted).toBe(false);
  });

  it("counts a revealed Mayor's vote toward mayorLynchAfterRevealCount", () => {
    const mayor = createPlayer(1n, 'Mayor', ROLE_BIT.Mayor, 'Village');
    mayor.hasUsedAbility = true;
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    mayor.choice = target.id;

    resolveLynchVotes([mayor, target], { lynchAttempt: 1 });

    expect(mayor.mayorLynchAfterRevealCount).toBe(1);
  });

  it('marks a tied Tanner soClose', () => {
    const tanner = createPlayer(1n, 'Tanner', ROLE_BIT.Tanner, 'Tanner');
    const other = createPlayer(2n, 'O', ROLE_BIT.Villager, 'Village');
    const v1 = createPlayer(3n, 'V1', ROLE_BIT.Villager, 'Village');
    const v2 = createPlayer(4n, 'V2', ROLE_BIT.Villager, 'Village');
    v1.choice = tanner.id;
    v2.choice = other.id;

    const { resolution } = resolveLynchVotes([tanner, other, v1, v2], { lynchAttempt: 1 });

    expect(resolution.outcome).toBe('Tied');
    expect(tanner.soClose).toBe(true);
    expect(other.soClose).toBe(false); // not a Tanner
  });

  it('marks tannerOverkill when literally every other living player voted for the Tanner', () => {
    const tanner = createPlayer(1n, 'Tanner', ROLE_BIT.Tanner, 'Tanner');
    const v1 = createPlayer(2n, 'V1', ROLE_BIT.Villager, 'Village');
    const v2 = createPlayer(3n, 'V2', ROLE_BIT.Villager, 'Village');
    v1.choice = tanner.id;
    v2.choice = tanner.id;

    resolveLynchVotes([tanner, v1, v2], { lynchAttempt: 1 });

    expect(tanner.tannerOverkill).toBe(true);
  });

  it('does not mark tannerOverkill when only some voters chose the Tanner', () => {
    const tanner = createPlayer(1n, 'Tanner', ROLE_BIT.Tanner, 'Tanner');
    const v1 = createPlayer(2n, 'V1', ROLE_BIT.Villager, 'Village');
    const v2 = createPlayer(3n, 'V2', ROLE_BIT.Villager, 'Village');
    const v3 = createPlayer(4n, 'V3', ROLE_BIT.Villager, 'Village');
    v1.choice = tanner.id;
    v2.choice = tanner.id;
    v3.choice = v1.id;

    resolveLynchVotes([tanner, v1, v2, v3], { lynchAttempt: 1 });

    expect(tanner.tannerOverkill).toBe(false);
  });
});

describe('resolveClumsyGuyVote', () => {
  // Rolled immediately when a Clumsy Guy casts a vote (see `Game.resolveClumsyGuyVote()`) -
  // not deferred until `resolveLynchVotes()` tallies at the end of the voting window - so the
  // group's live "X voted to lynch Y" announcement always names the real target.
  it("fumbles the Clumsy Guy's vote onto a random living player on a successful roll", () => {
    const clumsy = createPlayer(1n, 'Clumsy', ROLE_BIT.ClumsyGuy, 'Village');
    const intended = createPlayer(2n, 'Intended', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(3n, 'Other', ROLE_BIT.Villager, 'Village');
    clumsy.choice = intended.id;

    // First roll (fumble check, 0 < 50) triggers the fumble; second roll picks the last of the two
    // *other* living players (index 1 of [intended, other], i.e. "other" - self is excluded).
    let call = 0;
    const random = () => (call++ === 0 ? 0 : 0.99);
    resolveClumsyGuyVote(clumsy, [clumsy, intended, other], random);

    expect(clumsy.choice).toBe(other.id);
  });

  it("does not fumble the Clumsy Guy's vote on a failed roll", () => {
    const clumsy = createPlayer(1n, 'Clumsy', ROLE_BIT.ClumsyGuy, 'Village');
    const intended = createPlayer(2n, 'Intended', ROLE_BIT.Villager, 'Village');
    clumsy.choice = intended.id;

    resolveClumsyGuyVote(clumsy, [clumsy, intended], () => 0.99);

    expect(clumsy.choice).toBe(intended.id);
  });

  it('never fumbles an abstaining Clumsy Guy', () => {
    const clumsy = createPlayer(1n, 'Clumsy', ROLE_BIT.ClumsyGuy, 'Village');
    const other = createPlayer(2n, 'Other', ROLE_BIT.Villager, 'Village');
    clumsy.choice = SKIP_VOTE;

    resolveClumsyGuyVote(clumsy, [clumsy, other], () => 0);

    expect(clumsy.choice).toBe(SKIP_VOTE);
  });

  it('is a no-op for anyone who is not a Clumsy Guy', () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    villager.choice = target.id;

    resolveClumsyGuyVote(villager, [villager, target], () => 0);

    expect(villager.choice).toBe(target.id);
  });

  it("counts a Clumsy Guy's vote as correct on a no-fumble roll, and on a fumble that lands back on the same target", () => {
    const clumsy = createPlayer(1n, 'Clumsy', ROLE_BIT.ClumsyGuy, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    clumsy.choice = target.id;

    resolveClumsyGuyVote(clumsy, [clumsy, target], () => 0.99); // no fumble
    expect(clumsy.clumsyCorrectLynchCount).toBe(1);

    clumsy.choice = target.id;
    resolveClumsyGuyVote(clumsy, [clumsy, target], () => 0); // fumbles, only target to pick from
    expect(clumsy.clumsyCorrectLynchCount).toBe(2);
  });

  it("does not count a Clumsy Guy's vote as correct when a fumble lands on someone else", () => {
    const clumsy = createPlayer(1n, 'Clumsy', ROLE_BIT.ClumsyGuy, 'Village');
    const intended = createPlayer(2n, 'Intended', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(3n, 'Other', ROLE_BIT.Villager, 'Village');
    clumsy.choice = intended.id;

    let call = 0;
    const random = () => (call++ === 0 ? 0 : 0.99); // fumble, then pick the last of the two others
    resolveClumsyGuyVote(clumsy, [clumsy, intended, other], random);

    expect(clumsy.clumsyCorrectLynchCount).toBe(0);
  });
});

describe("resolveLynchVotes - Avenger's rival goal", () => {
  it('wins when their secret rival (via avengerTargetMap) is actually lynched', () => {
    const avenger = createPlayer(1n, 'A', ROLE_BIT.Avenger, 'Neutral');
    const rival = createPlayer(2n, 'R', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(3n, 'O', ROLE_BIT.Villager, 'Village');
    avenger.choice = rival.id;
    other.choice = rival.id;
    const avengerTargetMap = new Map([[avenger.id, rival.id]]);

    const { events } = resolveLynchVotes([avenger, rival, other], {
      lynchAttempt: 1,
      avengerTargetMap,
    });

    expect(avenger.won).toBe(true);
    expect(rival.isDead).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'AvengerRivalLynched' && e.avengerId === avenger.id && e.targetId === rival.id,
      ),
    ).toBe(true);
  });

  it('does not win when someone else entirely is lynched', () => {
    const avenger = createPlayer(1n, 'A', ROLE_BIT.Avenger, 'Neutral');
    const rival = createPlayer(2n, 'R', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(3n, 'O', ROLE_BIT.Villager, 'Village');
    avenger.choice = other.id;
    rival.choice = other.id;
    const avengerTargetMap = new Map([[avenger.id, rival.id]]);

    resolveLynchVotes([avenger, rival, other], { lynchAttempt: 1, avengerTargetMap });

    expect(avenger.won).toBe(false);
  });

  it('does not win without an avengerTargetMap at all (defensive default)', () => {
    const avenger = createPlayer(1n, 'A', ROLE_BIT.Avenger, 'Neutral');
    const rival = createPlayer(2n, 'R', ROLE_BIT.Villager, 'Village');
    avenger.choice = rival.id;

    resolveLynchVotes([avenger, rival], { lynchAttempt: 1 });

    expect(avenger.won).toBe(false);
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

describe('resolveLynchVotes - mission-mode tracking', () => {
  it("flags a vote for a Wolf-team player and for anyone outside the voter's own team", () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    villager.choice = wolf.id;

    resolveLynchVotes([villager, wolf], { lynchAttempt: 1 });

    expect(villager.everVotedForWolf).toBe(true);
    expect(villager.everVotedOppositeCamp).toBe(true);
  });

  it('does not flag a same-team vote as a wolf vote or an opposite-camp vote', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    a.choice = b.id;

    resolveLynchVotes([a, b], { lynchAttempt: 1 });

    expect(a.everVotedForWolf).toBe(false);
    expect(a.everVotedOppositeCamp).toBe(false);
  });

  it('only flags votedOppositeCampDay1 when dayNumber is explicitly 1', () => {
    const villager = createPlayer(1n, 'V', ROLE_BIT.Villager, 'Village');
    const wolf = createPlayer(2n, 'W', ROLE_BIT.Wolf, 'Wolf');
    villager.choice = wolf.id;

    resolveLynchVotes([villager, wolf], { lynchAttempt: 1, dayNumber: 2 });
    expect(villager.votedOppositeCampDay1).toBe(false);

    villager.choice = wolf.id;
    resolveLynchVotes([villager, wolf], { lynchAttempt: 1, dayNumber: 1 });
    expect(villager.votedOppositeCampDay1).toBe(true);
  });

  it('marks the killer(s) of a resolved lynch as having voted for the eventual victim', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    const target = createPlayer(3n, 'T', ROLE_BIT.Villager, 'Village');
    a.choice = target.id;
    b.choice = target.id;

    resolveLynchVotes([a, b, target], { lynchAttempt: 1 });

    expect(a.everVotedForLynchedVictim).toBe(true);
    expect(b.everVotedForLynchedVictim).toBe(true);
  });

  it("tracks majority vs minority vote counts against the round's actual top target", () => {
    const majority1 = createPlayer(1n, 'M1', ROLE_BIT.Villager, 'Village');
    const majority2 = createPlayer(2n, 'M2', ROLE_BIT.Villager, 'Village');
    const minority = createPlayer(3n, 'Min', ROLE_BIT.Villager, 'Village');
    const target = createPlayer(4n, 'T', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(5n, 'O', ROLE_BIT.Villager, 'Village');
    majority1.choice = target.id;
    majority2.choice = target.id;
    minority.choice = other.id;

    resolveLynchVotes([majority1, majority2, minority, target, other], { lynchAttempt: 1 });

    expect(majority1.majorityVoteCount).toBe(1);
    expect(majority2.majorityVoteCount).toBe(1);
    expect(minority.minorityVoteCount).toBe(1);
    expect(minority.majorityVoteCount).toBe(0);
  });

  it('increments escapedTopVoteLynchCount for a tied player who lives, not for one who dies', () => {
    const [a, b, c, d] = villagers(4);
    a!.choice = c!.id;
    b!.choice = d!.id;

    // A genuine 1-1 tie with no random tiebreak - neither c nor d dies, both "escaped".
    resolveLynchVotes([a!, b!, c!, d!], { lynchAttempt: 1 });

    expect(c!.escapedTopVoteLynchCount).toBe(1);
    expect(d!.escapedTopVoteLynchCount).toBe(1);
  });

  it('does not credit escapedTopVoteLynchCount to a player who was actually lynched', () => {
    const a = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const b = createPlayer(2n, 'B', ROLE_BIT.Villager, 'Village');
    const target = createPlayer(3n, 'T', ROLE_BIT.Villager, 'Village');
    a.choice = target.id;
    b.choice = target.id;

    resolveLynchVotes([a, b, target], { lynchAttempt: 1 });

    expect(target.isDead).toBe(true);
    expect(target.escapedTopVoteLynchCount).toBe(0);
  });

  it('accumulates everVotedAgainstBy across the whole game, unlike votedBy which resetLynchState clears', () => {
    const voter1 = createPlayer(1n, 'V1', ROLE_BIT.Villager, 'Village');
    const voter2 = createPlayer(2n, 'V2', ROLE_BIT.Villager, 'Village');
    const target = createPlayer(3n, 'T', ROLE_BIT.Villager, 'Village');
    voter1.choice = target.id;

    resolveLynchVotes([voter1, voter2, target], { lynchAttempt: 1 });
    resetLynchState([voter1, voter2, target]);
    voter2.choice = target.id;
    resolveLynchVotes([voter1, voter2, target], { lynchAttempt: 1 });

    expect(target.votedBy.size).toBe(1); // reset before the second round
    expect(target.everVotedAgainstBy.size).toBe(2); // accumulated across both rounds
  });

  it('counts abstains via abstainCount and a genuine no-vote via everMissedVote', () => {
    const abstainer = createPlayer(1n, 'A', ROLE_BIT.Villager, 'Village');
    const silent = createPlayer(2n, 'S', ROLE_BIT.Villager, 'Village');
    const other = createPlayer(3n, 'O', ROLE_BIT.Villager, 'Village');
    abstainer.choice = SKIP_VOTE;
    silent.choice = null;
    other.choice = other.id;

    resolveLynchVotes([abstainer, silent, other], { lynchAttempt: 1 });

    expect(abstainer.abstainCount).toBe(1);
    expect(abstainer.everMissedVote).toBe(false);
    expect(silent.everMissedVote).toBe(true);
    expect(silent.abstainCount).toBe(0);
  });
});
