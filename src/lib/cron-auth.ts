/** The cron contract (D74): disabled until CRON_SECRET exists; Vercel Cron sends `Bearer <secret>`. */
export function cronAuthFailure(header: string | null, secret: string | undefined): { status: 401 | 503; error: string } | null {
  if (!secret) return { status: 503, error: "cron not configured" };
  if (header !== "Bearer " + secret) return { status: 401, error: "unauthorized" };
  return null;
}
