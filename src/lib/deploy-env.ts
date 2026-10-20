/**
 * #353 review I2 — is this a Vercel deploy other than production (a preview, or `vercel dev`)? Previews share the
 * production database (project memory: preview deploys write live records), so a background or one-time write that
 * should land only from production asks this first. Unset VERCEL_ENV (local dev, the test harness) is not a preview.
 * Pure: pass `env` to test it.
 */
export function isPreviewDeploy(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.VERCEL_ENV || "").trim();
  return v !== "" && v !== "production";
}
