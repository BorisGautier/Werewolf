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
}
