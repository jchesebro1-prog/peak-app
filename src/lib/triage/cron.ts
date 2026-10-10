import type { Slot } from "./types";

/** Same contract as /api/gmail/sync (D74): disabled until CRON_SECRET exists; Vercel Cron sends `Bearer <secret>`. */
export function cronAuthFailure(header: string | null, secret: string | undefined): { status: 401 | 503; error: string } | null {
  if (!secret) return { status: 503, error: "cron not configured" };
  if (header !== "Bearer " + secret) return { status: 401, error: "unauthorized" };
  return null;
}

export function parseSlotParam(v: string | null): Slot | null {
  return v === "morning" || v === "midday" ? v : null;
}
