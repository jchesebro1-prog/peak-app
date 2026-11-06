/**
 * Estimator live save — the change key (server-only: node:crypto). A hash of the fields a live save writes, minus the
 * derived ones, so status moves, people changes, approvals and header autosaves never raise a false conflict, and any
 * writer that changes the spec is caught without auditing it. The client only ever holds the string.
 */
import { createHash } from "node:crypto";

export type LiveKeyFields = { spec?: unknown; vendorQuotes?: unknown; pdfOptions?: unknown; paymentTerms?: unknown; boxSale?: unknown };

/** JSON with sorted object keys: jsonb reorders keys, so a plain stringify would change across a round trip. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined ? "null" : stable(x))).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

export function liveKey(q: LiveKeyFields): string {
  const body = stable({ spec: q.spec ?? null, vendorQuotes: q.vendorQuotes ?? [], pdfOptions: q.pdfOptions ?? null, paymentTerms: q.paymentTerms ?? null, boxSale: q.boxSale === true });
  return createHash("sha1").update(body).digest("hex");
}
