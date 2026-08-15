import type { Bot } from 'grammy';
import type { Env } from '../config/env.js';
import type { Logger } from '../logging/logger.js';

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
    if (!adminId) return;

    const now = Date.now();
    const last = this.lastAlertTime.get(errorKey) ?? 0;
    if (now - last < 60_000) {
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

    try {
      await this.bot.api.sendMessage(Number(adminId), alertMessage, { parse_mode: 'HTML' });
    } catch (err) {
      this.logger.error({ err }, 'Failed to send monitoring alert to admin');
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

    // Transient socket / long-polling drops that grammY runner automatically retries
    if (
      errorCode === 'ECONNRESET' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ENOTFOUND' ||
      errorCode === 'EPIPE' ||
      innerError?.name === 'FetchError' ||
      (typeof innerError?.message === 'string' && innerError.message.includes('ECONNRESET'))
    ) {
      this.logger.warn({ source, code: errorCode }, 'Transient network connection reset during getUpdates (auto-retrying)');
      return;
    }

    // Critical operational error: log full stack & dispatch admin alert
    this.logger.error({ err: innerError, source }, `Critical bot error in ${source}`);
    const message = innerError?.stack ?? innerError?.message ?? String(innerError);
    void this.notifyAdmin(`Erreur Critique (${source})`, message, source);
  }
}
