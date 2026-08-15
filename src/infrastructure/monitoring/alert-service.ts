import type { Bot } from 'grammy';
import type { Env } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import {
  adminAlertsSent,
  botErrors,
  transientNetworkErrors,
} from './metrics.js';

export class AlertService {
  private lastAlertTime = new Map<string, number>();

  constructor(
    private readonly bot: Bot,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  /**
   * Notifies the admin via Telegram PM if an error occurs.
   * Features a 60-second cooldown per error signature to prevent notification flooding during network hiccups.
   */
  async notifyAdmin(errorTitle: string, details: string, errorKey = 'generic'): Promise<void> {
    const adminId = this.env.errorChatId ?? (this.env.devUserIds.length > 0 ? this.env.devUserIds[0] : undefined);
    if (!adminId) {
      this.logger.warn(
        { errorTitle, errorKey },
        'Admin alert skipped — no ERROR_CHAT_ID or DEV_USER_IDS configured',
      );
      return;
    }

    const now = Date.now();
    const last = this.lastAlertTime.get(errorKey) ?? 0;
    if (now - last < 60_000) {
      this.logger.debug(
        { errorKey, cooldownRemainingMs: 60_000 - (now - last) },
        'Admin alert throttled — within 60s cooldown window',
      );
      return;
    }
    this.lastAlertTime.set(errorKey, now);

    const timeStr = new Date().toLocaleString('fr-FR', { timeZone: 'UTC' });
    const cleanDetails = details.length > 3000 ? details.slice(0, 3000) + '...' : details;

    const alertMessage =
      `🚨 <b>[WEREWOLF BOT MONITORING ALERT]</b>\n\n` +
      `📌 <b>Incident :</b> ${errorTitle}\n` +
      `🕒 <b>Horodatage (UTC) :</b> ${timeStr}\n\n` +
      `<code>${cleanDetails}</code>`;

    this.logger.info(
      { errorTitle, errorKey, adminId: adminId.toString() },
      'Sending monitoring alert to admin via Telegram PM',
    );

    try {
      await this.bot.api.sendMessage(Number(adminId), alertMessage, { parse_mode: 'HTML' });
      adminAlertsSent.inc();
      this.logger.info({ errorTitle, errorKey }, 'Admin monitoring alert sent via Telegram');
    } catch (err) {
      this.logger.error({ err, errorTitle, errorKey }, 'Failed to send monitoring alert via Telegram');
      botErrors.labels('alertService', 'sendMessageFailed').inc();
    }

    // Concurrent Dispatch to Slack Webhook if configured
    if (this.env.slackWebhookUrl) {
      void this.sendSlackAlert(errorTitle, cleanDetails, timeStr);
    }

    // Concurrent Dispatch to Mailgun if configured
    if (this.env.mailgunApiKey && this.env.mailgunDomain && this.env.mailgunToEmail) {
      void this.sendMailgunAlert(errorTitle, cleanDetails, timeStr);
    }
  }

  /**
   * Dispatches an alert to Slack via Webhook.
   */
  private async sendSlackAlert(errorTitle: string, cleanDetails: string, timeStr: string): Promise<void> {
    try {
      const payload = {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '🚨 Werewolf Bot Monitoring Incident', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Incident:*\n${errorTitle}` },
              { type: 'mrkdwn', text: `*Horodatage (UTC):*\n${timeStr}` },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `\`\`\`${cleanDetails.slice(0, 2000)}\`\`\`` },
          },
        ],
      };

      const res = await fetch(this.env.slackWebhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        this.logger.warn({ status: res.status, errorTitle }, 'Slack webhook returned non-OK status');
      } else {
        this.logger.info({ errorTitle }, 'Slack alert sent successfully');
      }
    } catch (err) {
      this.logger.error({ err, errorTitle }, 'Failed to send Slack webhook alert');
    }
  }

  /**
   * Dispatches an alert email via Mailgun REST API.
   */
  private async sendMailgunAlert(errorTitle: string, cleanDetails: string, timeStr: string): Promise<void> {
    try {
      const domain = this.env.mailgunDomain!;
      const apiKey = this.env.mailgunApiKey!;
      const toEmail = this.env.mailgunToEmail!;
      const url = `https://api.mailgun.net/v3/${domain}/messages`;

      const formData = new URLSearchParams();
      formData.append('from', `Werewolf Bot Monitoring <alerts@${domain}>`);
      formData.append('to', toEmail);
      formData.append('subject', `[ALERT] ${errorTitle}`);
      formData.append(
        'html',
        `<h2>🚨 Werewolf Bot Monitoring Alert</h2>` +
          `<p><strong>Incident :</strong> ${errorTitle}</p>` +
          `<p><strong>Horodatage (UTC) :</strong> ${timeStr}</p>` +
          `<pre style="background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto;">${cleanDetails}</pre>`,
      );

      const authHeader = 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        this.logger.warn({ status: res.status, errorTitle }, 'Mailgun API returned non-OK status');
      } else {
        this.logger.info({ errorTitle, toEmail }, 'Mailgun alert email sent successfully');
      }
    } catch (err) {
      this.logger.error({ err, errorTitle }, 'Failed to send Mailgun email alert');
    }
  }

  /**
   * Evaluates errors caught during bot execution or runner long-polling.
   * Filters out transient network glitches (ECONNRESET, ETIMEDOUT, ENOTFOUND, EPIPE)
   * while logging clean warnings and routing true exceptions to admin alerts.
   */
  handleBotError(err: unknown, source: string): void {
    const errorObj = err as any;
    const innerError = errorObj?.error ?? errorObj;
    const errorCode = innerError?.code ?? innerError?.errno ?? errorObj?.code;
    const errorName = innerError?.name as string | undefined;
    const errorMessage = typeof innerError?.message === 'string' ? (innerError.message as string) : '';

    // Transient socket / long-polling drops that grammY runner automatically retries
    if (
      errorCode === 'ECONNRESET' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ENOTFOUND' ||
      errorCode === 'EPIPE' ||
      errorName === 'FetchError' ||
      errorMessage.includes('ECONNRESET')
    ) {
      const code = errorCode ?? errorName ?? 'UNKNOWN_NETWORK';
      transientNetworkErrors.labels(code).inc();
      this.logger.warn(
        { source, code, errorName },
        'Transient network connection reset during getUpdates — grammY runner will auto-retry',
      );
      return;
    }

    // Critical operational error: log full stack & dispatch admin alert
    botErrors.labels(source, errorCode ?? 'unknown').inc();
    this.logger.error(
      { err: innerError, source, errorCode, errorName },
      `Critical bot error caught in ${source} — dispatching admin alert`,
    );
    const message = innerError?.stack ?? innerError?.message ?? String(innerError);
    void this.notifyAdmin(`Erreur Critique (${source})`, message, source);
  }
}
