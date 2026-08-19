import type {
  PrismaClient,
  Tournament,
  TournamentTeam,
  TournamentTeamMember,
} from '@prisma/client';

export type TournamentStatus = 'REGISTRATION' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type TournamentWithTeams = Tournament & {
  teams: (TournamentTeam & {
    members: TournamentTeamMember[];
  })[];
};

export class TournamentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createTournament(
    name: string,
    maxTeams = 4,
    teamSize = 4,
    totalRounds = 5,
    createdById?: bigint,
  ): Promise<Tournament> {
    return this.prisma.tournament.create({
      data: {
        name,
        maxTeams,
        teamSize,
        totalRounds,
        createdById: createdById ?? null,
        status: 'REGISTRATION',
      },
    });
  }

  async listTournaments(): Promise<Tournament[]> {
    return this.prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getTournamentDetails(id: number): Promise<TournamentWithTeams | null> {
    return this.prisma.tournament.findUnique({
      where: { id },
      include: {
        teams: {
          include: {
            members: true,
          },
          orderBy: { totalPoints: 'desc' },
        },
      },
    });
  }

  async createTeam(
    name: string,
    code: string,
    captainPlayerId: bigint,
    tag?: string,
  ): Promise<TournamentTeam> {
    return this.prisma.tournamentTeam.create({
      data: {
        name,
        code,
        tag: tag ?? null,
        members: {
          create: {
            playerId: captainPlayerId,
            isCaptain: true,
          },
        },
      },
    });
  }

  async findTeamByCode(code: string) {
    return this.prisma.tournamentTeam.findUnique({
      where: { code },
      include: { members: true },
    });
  }

  async joinTeam(teamId: number, playerId: bigint): Promise<TournamentTeamMember> {
    return this.prisma.tournamentTeamMember.create({
      data: {
        teamId,
        playerId,
        isCaptain: false,
      },
    });
  }

  async registerTeamToTournament(teamId: number, tournamentId: number): Promise<void> {
    await this.prisma.tournamentTeam.update({
      where: { id: teamId },
      data: { tournamentId },
    });
  }

  async addPointsToTeam(teamId: number, points: number, isWin = false): Promise<void> {
    await this.prisma.tournamentTeam.update({
      where: { id: teamId },
      data: {
        totalPoints: { increment: points },
        ...(isWin ? { wins: { increment: 1 } } : {}),
      },
    });
  }

  async updateTournamentStatus(
    id: number,
    status: TournamentStatus,
    currentRound?: number,
  ): Promise<void> {
    await this.prisma.tournament.update({
      where: { id },
      data: {
        status,
        ...(currentRound !== undefined ? { currentRound } : {}),
      },
    });
  }

  /** The team a player currently belongs to (a player can only ever be on one team at a time -
   * enforced at join/create time, see `TournamentCommandHandler`), or `null` if they aren't on
   * one. Needed both to resolve "the caller's team" for `/inscrirefournoi` and to find which
   * team(s) should earn tournament points once one of their members finishes a real game. */
  async findTeamByPlayerId(playerId: bigint) {
    const membership = await this.prisma.tournamentTeamMember.findFirst({
      where: { playerId },
      include: { team: { include: { members: true, tournament: true } } },
    });
    return membership?.team ?? null;
  }

  async getTournamentById(id: number): Promise<Tournament | null> {
    return this.prisma.tournament.findUnique({ where: { id } });
  }

  /**
   * A team's competitive points come from its members' *normal* in-game performance while the
   * team is registered to an `IN_PROGRESS` tournament - Werewolf games aren't 1v1 matches a
   * bracket could schedule, so "which team played better" is measured across every real game a
   * member takes part in during the tournament window, not a single head-to-head round. Called
   * once per real (non-bot) player at the end of every finished game (see `GameLoop.finish()`);
   * a no-op for anyone not on a registered, in-progress tournament team.
   */
  async awardTournamentPoints(playerId: bigint, points: number, won: boolean): Promise<void> {
    const membership = await this.prisma.tournamentTeamMember.findFirst({
      where: { playerId },
      include: { team: { include: { tournament: true } } },
    });
    if (!membership || !membership.team.tournamentId) return;
    if (membership.team.tournament?.status !== 'IN_PROGRESS') return;

    await this.prisma.$transaction([
      this.prisma.tournamentTeam.update({
        where: { id: membership.team.id },
        data: {
          totalPoints: { increment: points },
          ...(won ? { wins: { increment: 1 } } : {}),
        },
      }),
      this.prisma.tournamentTeamMember.update({
        where: { id: membership.id },
        data: { pointsContributed: { increment: points } },
      }),
      this.prisma.tournamentPointLog.create({
        data: { teamId: membership.team.id, playerId, points, won },
      }),
    ]);
  }

  /** Standings for a specific tournament, best team first - powers `/tournoi <id>` and the admin
   * dashboard's per-tournament breakdown. */
  async getTeamStandings(tournamentId: number) {
    return this.prisma.tournamentTeam.findMany({
      where: { tournamentId },
      include: { members: true },
      orderBy: [{ totalPoints: 'desc' }, { wins: 'desc' }],
    });
  }

  /**
   * Everything the admin dashboard's tournament detail modal needs in one call: the tournament
   * itself, every team with its full member roster, and a chronological point-award log per team
   * - the log is what lets the UI draw an actual "who's been climbing" evolution view instead of
   * just today's snapshot totals.
   */
  async getTournamentFullDetails(id: number) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        teams: {
          include: {
            members: true,
            pointLogs: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: [{ totalPoints: 'desc' }, { wins: 'desc' }],
        },
      },
    });
    return tournament;
  }
}
