# Operations Center (sidebar → Health)

## Setup
1. Run `diagnostics-schema.sql` first, then `ops-schema.sql`, in the Supabase SQL editor.
2. Use the same `CRON_SECRET` as Logs. The hourly cron `/lms-admin/api/ops/sync` is in `vercel.json`.
   - Vercel Hobby only allows daily crons, so change both crons to `0 0 * * *` on that plan.
3. Go to Health → Settings → Infrastructure providers and add what you actually use:
   - **supabase**: set `projectRef`, plus a Management API token (read-only is enough). Add `dbQuotaGb` and `storageQuotaGb` from your plan. They are entered by hand because Supabase has no API that returns plan limits.
   - **vercel**: set `projectId` (and `teamId` if the project is in a team), plus a Vercel token. This provides deployment history and state. Vercel has no public usage API, so enter usage as manual metrics.
   - **render**: set `serviceId`, plus an API key. This provides service state and deploy history.
   - **http**: set any `https://` health URL (backend, CDN, AI service, SMS gateway). This provides the up/down state, latency and uptime %.
   - **manual**: for any other service. Enter metrics as JSON, e.g. `[{"metric":"egress_gb_month","value":120,"quota":250,"unit":"GB"}]`. They are shown as "Manual estimate".
4. Notifications: WARNING and CRITICAL alerts are sent to `LMS_ALERT_WEBHOOK_URL` (Slack, Discord or a WhatsApp gateway), the same webhook used for security alerts.

## Rules
- **No fake numbers:** anything without a source shows "Not available". Provider values show their source and age, and data older than 2× the sync interval is marked "⚠ Data may be stale".
- **Health score:** the formula is documented in `src/lib/ops/health.ts`. The UI shows every deduction and the change since the last hour.
- **Data sources:** heartbeats use the existing `device_status` table (written by `/api/device/ping`). Resource usage comes from the app's 15-minute `APP_HEARTBEAT`, which is stored as one row per device. Errors, crashes and performance data come from the Logs telemetry.
- **Retention (configurable):**
  - device metrics: 7 days
  - hourly aggregates: 30 days
  - daily aggregates: 365 days
  - resolved alerts: 90 days
  - closed incidents: 365 days
- **Access:** reuses the Logs roles.
  - Viewer: view dashboards.
  - Developer: also sees infrastructure.
  - Debug Admin: also manages alerts and incidents.
  - Super Admin: also manages providers, rules, costs and settings.
  - Users limited to certain schools see only those schools, and no infrastructure.
