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

  it('/tournoi <id> shows live standings instead of the tournament list', async () => {
    const mockRepo: any = {
      getTournamentById: vi.fn(async () => ({
        id: 1,
        name: 'Tournoi Pro #1',
        status: 'IN_PROGRESS',
        currentRound: 2,
        totalRounds: 5,
      })),
      getTeamStandings: vi.fn(async () => [
        { name: 'Alpha', totalPoints: 120, wins: 4, members: [{}, {}, {}, {}] },
        { name: 'Beta', totalPoints: 80, wins: 2, members: [{}, {}, {}, {}] },
      ]),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { match: '1', reply: vi.fn() };

    await handler['handleTournoiMenu'](mockCtx);

    expect(mockRepo.getTeamStandings).toHaveBeenCalledWith(1);
    const replyText = mockCtx.reply.mock.calls[0][0];
    expect(replyText).toContain('Alpha');
    expect(replyText).toContain('120 pts');
    expect(replyText).toContain('Beta');
  });
});

describe('awardTournamentPoints', () => {
  function fakePrisma(overrides: Record<string, any> = {}) {
    return {
      tournamentTeamMember: {
        findFirst: vi.fn(async () => null),
        update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
      tournamentTeam: {
        update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
      tournamentPointLog: {
        create: vi.fn(async ({ data }: any) => ({ id: 1, ...data, createdAt: new Date() })),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      ...overrides,
    } as any;
  }

  it('adds points and a win to the team + member when registered to an IN_PROGRESS tournament', async () => {
    const membership = {
      id: 101,
      teamId: 10,
      playerId: 555n,
      team: { id: 10, tournamentId: 1, tournament: { id: 1, status: 'IN_PROGRESS' } },
    };
    const prisma = fakePrisma({
      tournamentTeamMember: {
        findFirst: vi.fn(async () => membership),
        update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
    });
    const repo = new TournamentRepository(prisma);

    await repo.awardTournamentPoints(555n, 25, true);

    expect(prisma.tournamentTeam.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({ totalPoints: { increment: 25 }, wins: { increment: 1 } }),
      }),
    );
    expect(prisma.tournamentTeamMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101 },
        data: { pointsContributed: { increment: 25 } },
      }),
    );
  });

  it('is a no-op for a player who is not on any tournament team', async () => {
    const prisma = fakePrisma();
    const repo = new TournamentRepository(prisma);

    await repo.awardTournamentPoints(999n, 25, false);

    expect(prisma.tournamentTeam.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the player's team is registered but the tournament hasn't started yet", async () => {
    const membership = {
      id: 101,
      teamId: 10,
      playerId: 555n,
      team: { id: 10, tournamentId: 1, tournament: { id: 1, status: 'REGISTRATION' } },
    };
    const prisma = fakePrisma({
      tournamentTeamMember: { findFirst: vi.fn(async () => membership), update: vi.fn() },
    });
    const repo = new TournamentRepository(prisma);

    await repo.awardTournamentPoints(555n, 25, false);

    expect(prisma.tournamentTeam.update).not.toHaveBeenCalled();
  });

  it('is a no-op for a player on an unregistered (tournamentId: null) team', async () => {
    const membership = {
      id: 101,
      teamId: 10,
      playerId: 555n,
      team: { id: 10, tournamentId: null, tournament: null },
    };
    const prisma = fakePrisma({
      tournamentTeamMember: { findFirst: vi.fn(async () => membership), update: vi.fn() },
    });
    const repo = new TournamentRepository(prisma);

    await repo.awardTournamentPoints(555n, 25, false);

    expect(prisma.tournamentTeam.update).not.toHaveBeenCalled();
  });
});

describe('/inscrirefournoi (register team to tournament)', () => {
  function baseTeam(overrides: Record<string, any> = {}) {
    return {
      id: 10,
      name: 'Les Alpha Wolves',
      tournamentId: null,
      members: [
        { playerId: 1n, isCaptain: true },
        { playerId: 2n, isCaptain: false },
        { playerId: 3n, isCaptain: false },
        { playerId: 4n, isCaptain: false },
      ],
      ...overrides,
    };
  }

  function baseTournament(overrides: Record<string, any> = {}) {
    return {
      id: 1,
      name: "Championnat d'Été",
      status: 'REGISTRATION',
      teamSize: 4,
      maxTeams: 8,
      teams: [],
      ...overrides,
    };
  }

  it("only the team's captain may register it", async () => {
    const mockRepo: any = {
      findTeamByPlayerId: vi.fn(async () => baseTeam()),
      getTournamentDetails: vi.fn(async () => baseTournament()),
      registerTeamToTournament: vi.fn(),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { from: { id: 2 }, match: '1', reply: vi.fn() };

    await handler['handleInscrireTournoi'](mockCtx);

    expect(mockRepo.registerTeamToTournament).not.toHaveBeenCalled();
    expect(mockCtx.reply.mock.calls[0][0]).toContain('Capitaine');
  });

  it('refuses registration once the tournament has left REGISTRATION', async () => {
    const mockRepo: any = {
      findTeamByPlayerId: vi.fn(async () => baseTeam()),
      getTournamentDetails: vi.fn(async () => baseTournament({ status: 'IN_PROGRESS' })),
      registerTeamToTournament: vi.fn(),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { from: { id: 1 }, match: '1', reply: vi.fn() };

    await handler['handleInscrireTournoi'](mockCtx);

    expect(mockRepo.registerTeamToTournament).not.toHaveBeenCalled();
  });

  it('refuses a team whose size does not match the tournament requirement', async () => {
    const mockRepo: any = {
      findTeamByPlayerId: vi.fn(async () =>
        baseTeam({ members: [{ playerId: 1n, isCaptain: true }, { playerId: 2n }] }),
      ),
      getTournamentDetails: vi.fn(async () => baseTournament()),
      registerTeamToTournament: vi.fn(),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { from: { id: 1 }, match: '1', reply: vi.fn() };

    await handler['handleInscrireTournoi'](mockCtx);

    expect(mockRepo.registerTeamToTournament).not.toHaveBeenCalled();
  });

  it('refuses once the tournament already has maxTeams registered', async () => {
    const mockRepo: any = {
      findTeamByPlayerId: vi.fn(async () => baseTeam()),
      getTournamentDetails: vi.fn(async () => baseTournament({ maxTeams: 1, teams: [{ id: 99 }] })),
      registerTeamToTournament: vi.fn(),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { from: { id: 1 }, match: '1', reply: vi.fn() };

    await handler['handleInscrireTournoi'](mockCtx);

    expect(mockRepo.registerTeamToTournament).not.toHaveBeenCalled();
  });

  it('registers a full, captain-led team to an open tournament', async () => {
    const mockRepo: any = {
      findTeamByPlayerId: vi.fn(async () => baseTeam()),
      getTournamentDetails: vi.fn(async () => baseTournament()),
      registerTeamToTournament: vi.fn(async () => {}),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { from: { id: 1 }, match: '1', reply: vi.fn() };

    await handler['handleInscrireTournoi'](mockCtx);

    expect(mockRepo.registerTeamToTournament).toHaveBeenCalledWith(10, 1);
    expect(mockCtx.reply.mock.calls[0][0]).toContain('officiellement inscrite');
  });
});

describe('one team per player', () => {
  it('/creerequipe refuses if the caller is already on a team', async () => {
    const mockRepo: any = {
      findTeamByPlayerId: vi.fn(async () => ({ id: 10, name: 'Les Alpha Wolves' })),
      createTeam: vi.fn(),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { from: { id: 1 }, match: 'Nouvelle Equipe', reply: vi.fn() };

    await handler['handleCreerEquipe'](mockCtx);

    expect(mockRepo.createTeam).not.toHaveBeenCalled();
    expect(mockCtx.reply.mock.calls[0][0]).toContain('Alpha Wolves');
  });

  it('/rejoindreequipe refuses if the caller is already on a (different) team', async () => {
    const mockRepo: any = {
      findTeamByPlayerId: vi.fn(async () => ({ id: 10, name: 'Les Alpha Wolves' })),
      findTeamByCode: vi.fn(),
      joinTeam: vi.fn(),
    };
    const handler = new TournamentCommandHandler(mockRepo);
    const mockCtx: any = { from: { id: 1 }, match: 'TAG9999', reply: vi.fn() };

    await handler['handleRejoindreEquipe'](mockCtx);

    expect(mockRepo.findTeamByCode).not.toHaveBeenCalled();
    expect(mockRepo.joinTeam).not.toHaveBeenCalled();
  });
});
