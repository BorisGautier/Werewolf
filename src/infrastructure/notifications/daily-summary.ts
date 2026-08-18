import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../logging/logger.js';
import type { Env } from '../config/env.js';
import { SYNTHETIC_BOT_ID_FLOOR } from '../../domain/game/player.js';

export interface DailySummaryStats {
  date: string;
  gamesPlayed: number;
  playersSeen: number;
  activeGroups: number;
  newPlayers: number;
  tournamentsActive: number;
}

export class DailySummaryNotifier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  /**
   * Generates yesterday's statistics summary and dispatches to Slack, Email, and Telegram.
   */
  async generateAndSendDailySummary(): Promise<DailySummaryStats> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const [gamesCount, uniquePlayers, newPlayers, activeGroups, tournamentsActive] =
      await Promise.all([
        this.prisma.game.count({ where: { endedAt: { gte: dayStart, lt: dayEnd } } }),
        this.prisma.gamePlayer.findMany({
          where: { game: { endedAt: { gte: dayStart, lt: dayEnd } } },
          select: { playerId: true },
          distinct: ['playerId'],
        }),
        this.prisma.player.count({
          where: {
            createdAt: { gte: dayStart, lt: dayEnd },
            telegramId: { lt: SYNTHETIC_BOT_ID_FLOOR },
          },
        }),
        this.prisma.game.findMany({
          where: { endedAt: { gte: dayStart, lt: dayEnd } },
          select: { groupId: true },
          distinct: ['groupId'],
        }),
        this.prisma.tournament.count({ where: { status: 'IN_PROGRESS' } }),
      ]);

    const stats: DailySummaryStats = {
      date: dayStart.toISOString().split('T')[0] ?? dayStart.toISOString(),
      gamesPlayed: gamesCount,
      playersSeen: uniquePlayers.length,
      activeGroups: activeGroups.length,
      newPlayers,
      tournamentsActive,
    };

    this.logger.info({ stats }, 'Daily summary calculated successfully');

    await Promise.allSettled([this.sendSlackSummary(stats), this.sendMailgunSummary(stats)]);

    return stats;
  }

  private async sendSlackSummary(stats: DailySummaryStats): Promise<void> {
    const slackUrl = this.env.slackWebhookUrl;
    if (!slackUrl) {
      this.logger.debug('Slack daily summary skipped — no SLACK_WEBHOOK_URL configured');
      return;
    }

    const payload = {
      text: `📊 *BILAN QUOTIDIEN WEREWOLF BOT (${stats.date})*`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📊 Bilan Quotidien Werewolf (${stats.date})`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*🎮 Parties Jouées :* ${stats.gamesPlayed}` },
            { type: 'mrkdwn', text: `*👥 Joueurs Uniques :* ${stats.playersSeen}` },
            { type: 'mrkdwn', text: `*🏰 Groupes Actifs :* ${stats.activeGroups}` },
            { type: 'mrkdwn', text: `*✨ Nouveaux Joueurs :* ${stats.newPlayers}` },
            { type: 'mrkdwn', text: `*🏆 Tournois en cours :* ${stats.tournamentsActive}` },
            {
              type: 'mrkdwn',
              text: `*🌐 Admin Dashboard :* <https://epicwolf.borisgauty.com/admin|Accéder à l'Admin>`,
            },
          ],
        },
      ],
    };

    try {
      const res = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        this.logger.info('Daily summary sent to Slack successfully');
      } else {
        this.logger.warn({ status: res.status }, 'Failed to send daily summary to Slack');
      }
    } catch (err) {
      this.logger.error({ err }, 'Error sending daily summary to Slack');
    }
  }

  private async sendMailgunSummary(stats: DailySummaryStats): Promise<void> {
    const apiKey = this.env.mailgunApiKey;
    const domain = this.env.mailgunDomain;
    const toEmail = this.env.mailgunToEmail;

    if (!apiKey || !domain || !toEmail) {
      this.logger.debug('Mailgun email summary skipped — missing Mailgun env variables');
      return;
    }

    const body = new URLSearchParams({
      from: `Werewolf Bot <noreply@${domain}>`,
      to: toEmail,
      subject: `📊 [Werewolf Bot] Bilan Quotidien du ${stats.date}`,
      html: `
        <h2>📊 Bilan Quotidien Werewolf Bot - ${stats.date}</h2>
        <ul>
          <li><b>🎮 Parties Jouées :</b> ${stats.gamesPlayed}</li>
          <li><b>👥 Joueurs Uniques :</b> ${stats.playersSeen}</li>
          <li><b>🏰 Groupes Actifs :</b> ${stats.activeGroups}</li>
          <li><b>✨ Nouveaux Joueurs :</b> ${stats.newPlayers}</li>
          <li><b>🏆 Tournois en cours :</b> ${stats.tournamentsActive}</li>
        </ul>
        <p><a href="https://epicwolf.borisgauty.com/admin" style="background:#4f46e5;color:white;padding:10px 18px;text-decoration:none;border-radius:6px;">Accéder à l'Admin Web</a></p>
      `,
    });

    try {
      const auth = Buffer.from(`api:${apiKey}`).toString('base64');
      const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (res.ok) {
        this.logger.info('Daily summary email sent via Mailgun successfully');
      } else {
        this.logger.warn({ status: res.status }, 'Failed to send daily summary email via Mailgun');
      }
    } catch (err) {
      this.logger.error({ err }, 'Error sending daily summary email');
    }
  }
}
