import { describe, expect, it } from 'vitest';
import { ROLE_BIT } from '../../src/domain/roles/role.js';
import { ABSTAIN, createPlayer } from '../../src/domain/game/player.js';
import { resolveTrackerNight, resolveWatchmanNight } from '../../src/domain/game/night-resolution.js';

describe('resolveWatchmanNight', () => {
  it('does nothing when the Watchman is dead, frozen, absent, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'W', ROLE_BIT.Watchman, 'Village');
    dead.isDead = true;
    dead.choice = target.id;
    expect(resolveWatchmanNight([dead, target])).toEqual([]);

    const frozen = createPlayer(1n, 'W', ROLE_BIT.Watchman, 'Village');
    frozen.frozen = true;
    frozen.choice = target.id;
    expect(resolveWatchmanNight([frozen, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'W', ROLE_BIT.Watchman, 'Village');
    expect(resolveWatchmanNight([noChoice, target])).toEqual([]);

    const abstained = createPlayer(1n, 'W', ROLE_BIT.Watchman, 'Village');
    abstained.choice = ABSTAIN;
    expect(resolveWatchmanNight([abstained, target])).toEqual([]);
  });

  it("reports the exact visitor count already tallied on the target's beingVisitedSameNightCount", () => {
    const watchman = createPlayer(1n, 'W', ROLE_BIT.Watchman, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    target.beingVisitedSameNightCount = 3;
    watchman.choice = target.id;

    const events = resolveWatchmanNight([watchman, target]);

    expect(events).toEqual([
      { type: 'WatchmanReport', watchmanId: watchman.id, targetId: target.id, visitorCount: 3 },
    ]);
  });

  it('reports zero when nobody visited the target tonight', () => {
    const watchman = createPlayer(1n, 'W', ROLE_BIT.Watchman, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    watchman.choice = target.id;

    const events = resolveWatchmanNight([watchman, target]);

    expect(events).toEqual([
      { type: 'WatchmanReport', watchmanId: watchman.id, targetId: target.id, visitorCount: 0 },
    ]);
  });
});

describe('resolveTrackerNight', () => {
  it('does nothing when the Tracker is dead, frozen, absent, or has not chosen', () => {
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');

    const dead = createPlayer(1n, 'Tr', ROLE_BIT.Tracker, 'Village');
    dead.isDead = true;
    dead.choice = target.id;
    expect(resolveTrackerNight([dead, target])).toEqual([]);

    const noChoice = createPlayer(1n, 'Tr', ROLE_BIT.Tracker, 'Village');
    expect(resolveTrackerNight([noChoice, target])).toEqual([]);
  });

  it('reports that the target left home when they made an active choice tonight', () => {
    const tracker = createPlayer(1n, 'Tr', ROLE_BIT.Tracker, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Seer, 'Village');
    target.choice = 99n;
    tracker.choice = target.id;

    const events = resolveTrackerNight([tracker, target]);

    expect(events).toEqual([
      { type: 'TrackerReport', trackerId: tracker.id, targetId: target.id, leftHome: true },
    ]);
  });

  it('reports that the target stayed home when they made no choice, or explicitly abstained', () => {
    const tracker = createPlayer(1n, 'Tr', ROLE_BIT.Tracker, 'Village');
    const target = createPlayer(2n, 'T', ROLE_BIT.Villager, 'Village');
    tracker.choice = target.id;

    expect(resolveTrackerNight([tracker, target])).toEqual([
      { type: 'TrackerReport', trackerId: tracker.id, targetId: target.id, leftHome: false },
    ]);

    target.choice = ABSTAIN;
    expect(resolveTrackerNight([tracker, target])).toEqual([
      { type: 'TrackerReport', trackerId: tracker.id, targetId: target.id, leftHome: false },
    ]);
  });
});
