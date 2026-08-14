import type { PrismaClient, ReportStatus } from '@prisma/client';

export interface CreateReportData {
  reporterId: bigint;
  reportedId: bigint;
  groupId?: bigint | null;
  reason: string;
}

export class ReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Creates a new player report in the database. */
  async createReport(data: CreateReportData) {
    return this.prisma.playerReport.create({
      data: {
        reporterId: data.reporterId,
        reportedId: data.reportedId,
        groupId: data.groupId ?? null,
        reason: data.reason,
        status: 'PENDING',
      },
    });
  }

  /** Gets all pending reports for admin review. */
  async getPendingReports(limit = 20) {
    return this.prisma.playerReport.findMany({
      where: { status: 'PENDING' },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { username: true, displayName: true, telegramId: true } },
        reported: { select: { username: true, displayName: true, telegramId: true } },
      },
    });
  }

  /** Updates status of a report (RESOLVED or DISMISSED). */
  async updateReportStatus(reportId: number, status: ReportStatus) {
    return this.prisma.playerReport.update({
      where: { id: reportId },
      data: { status },
    });
  }
}
