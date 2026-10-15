import { headers } from "next/headers";
import { printOriginFor } from "@/lib/quote-pdf/origin";

/** The request's print origin (the cover's link line uses it too); refused before anything is touched. Server-only. */
export async function requestWhere(): Promise<{ origin: string; host: string | null; proto: string | null } | { error: string }> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto");
  const where = printOriginFor(process.env, host, proto);
  return "error" in where ? { error: where.error } : { origin: where.origin, host, proto };
}
