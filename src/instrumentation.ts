/**
 * Server boot hook (Next.js instrumentation — on by default in Next 16).
 *
 * Starts the in-process Gmail sync timer (D74, Jeff 2026-07-19: "sync should
 * be server side so it is always current"): on any long-lived Node server —
 * `next dev`, `next start`, the LAN box — the inbox stays fresh with no tab
 * open. Every tick funnels into checkMailIfStale's atomic per-mailbox claims,
 * so this composes safely with the inbox client tick and the /api/gmail/sync
 * cron route (Vercel serverless, where boot timers don't survive freezing).
 * Inert when the Gmail gate is off (dev without Google creds).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { gmailEnabled, AUTO_SYNC_MIN_AGE_MS } = await import("@/lib/gmail/config");
  if (!gmailEnabled()) return;

  // Singleton across dev rebuilds/HMR — never stack timers.
  const g = globalThis as typeof globalThis & {
    __peakGmailSyncTimer?: ReturnType<typeof setInterval>;
  };
  if (g.__peakGmailSyncTimer) return;

  const { checkMailIfStale } = await import("@/lib/stores/comms");
  g.__peakGmailSyncTimer = setInterval(() => {
    checkMailIfStale(AUTO_SYNC_MIN_AGE_MS).catch((err) => {
      console.error("[gmail] server sync tick failed:", err);
    });
  }, AUTO_SYNC_MIN_AGE_MS);
  console.log("[gmail] server-side sync timer started");
}
