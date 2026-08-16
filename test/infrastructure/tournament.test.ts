import { describe, expect, it, vi } from 'vitest';
import { TournamentRepository } from '../../src/infrastructure/persistence/tournament.repository.js';
import { TournamentCommandHandler } from '../../src/infrastructure/telegram/tournament-commands.js';

describe('Tournament Mode System', () => {
  it('creates and lists tournaments in memory repository mock', async () => {
    const mockTournaments: any[] = [];
    const prismaMock: any = {
      tournament: {
        create: vi.fn(async ({ data }: any) => {
          const t = { id: 1, ...data, createdAt: new Date(), updatedAt: new Date() };
          mockTournaments.push(t);
          return t;
        }),
        findMany: vi.fn(async () => mockTournaments),
        findUnique: vi.fn(
          async ({ where }: any) => mockTournaments.find((t) => t.id === where.id) || null,
        ),
        update: vi.fn(async ({ where, data }: any) => {
          const t = mockTournaments.find((x) => x.id === where.id);
          if (t) Object.assign(t, data);
          return t;
        }),
      },
      tournamentTeam: {
        create: vi.fn(async ({ data }: any) => ({
          id: 10,
          ...data,
          totalPoints: 0,
          wins: 0,
          members: [{ id: 100, playerId: data.members.create.playerId, isCaptain: true }],
        })),
        findUnique: vi.fn(async ({ where }: any) => ({
          id: 10,
          name: 'Les Alpha Wolves',
          code: where.code,
          members: [{ id: 100, playerId: 12345n, isCaptain: true }],
        })),
        createMember: vi.fn(async () => ({ id: 101 })),
      },
      tournamentTeamMember: {
        create: vi.fn(async ({ data }: any) => ({ id: 101, ...data })),
      },
    };

    const repo = new TournamentRepository(prismaMock);

    const created = await repo.createTournament("Championnat d'Été 2026", 4, 4, 5);
    expect(created.name).toBe("Championnat d'Été 2026");
    expect(created.maxTeams).toBe(4);
    expect(created.totalRounds).toBe(5);

    const list = await repo.listTournaments();
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe(1);

    const team = await repo.createTeam('Les Alpha Wolves', 'TAG9999', 12345n);
    expect(team.name).toBe('Les Alpha Wolves');
    expect(team.code).toBe('TAG9999');

    await repo.updateTournamentStatus(1, 'IN_PROGRESS', 1);
    const updatedList = await repo.listTournaments();
    expect(updatedList[0]!.status).toBe('IN_PROGRESS');
    expect(updatedList[0]!.currentRound).toBe(1);
  });

  it('handles Telegram /tournoi command rendering', async () => {
    const mockRepo: any = {
      listTournaments: vi.fn(async () => [
        { id: 1, name: 'Tournoi Pro #1', status: 'REGISTRATION', currentRound: 0, totalRounds: 5 },
      ]),
    };
    const handler = new TournamentCommandHandler(mockRepo);

    const mockCtx: any = {
      reply: vi.fn(),
    };

    await handler['handleTournoiMenu'](mockCtx);
    expect(mockCtx.reply).toHaveBeenCalled();
    const replyText = mockCtx.reply.mock.calls[0][0];
    expect(replyText).toContain('Tournoi Pro #1');
    expect(replyText).toContain('REGISTRATION');
  });
});
