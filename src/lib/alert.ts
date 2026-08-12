import { logger } from './logger';

/**
 * ============================================================================
 *  alert.ts — best-effort out-of-band security alerting.
 *
 *  Proactively notifies admins the MOMENT a device trips a security tripwire
 *  (expiry tamper, remote kill) instead of waiting for someone to open the
 *  monitoring dashboard. Configure a Slack/Discord/generic incoming webhook via
 *  LMS_ALERT_WEBHOOK_URL; if unset, alerting is a silent no-op (the DB timeline +
 *  flag remain the source of truth regardless).
 *
 *  Contract: NEVER throws and NEVER blocks the device request meaningfully — it is
 *  awaited with a hard timeout and every failure is swallowed to a warn log, so a
 *  slow/broken webhook can never 500 a heartbeat or delay the fleet. Only fires on
 *  RARE events (a tamper flip / first kill delivery), so the small await is bounded.
 * ============================================================================
 */

export type AlertKind = 'EXPIRY_TAMPER' | 'REMOTE_KILL';

const ALERT_TIMEOUT_MS = 3000;

export async function sendSecurityAlert(
  kind: AlertKind,
  summary: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const url = process.env.LMS_ALERT_WEBHOOK_URL;
  if (!url) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `text` renders in Slack/Discord; `event` is the structured payload for generic sinks.
      body: JSON.stringify({
        text: `🚨 LMS ${kind}: ${summary}`,
        event: { kind, summary, ...detail, at: new Date().toISOString() },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ event: 'ALERT_WEBHOOK_NON_2XX', kind, status: res.status });
    }
  } catch (e) {
    logger.warn({ event: 'ALERT_WEBHOOK_FAILED', kind, error: e instanceof Error ? e.message : String(e) });
  } finally {
    clearTimeout(timer);
  }
}
