/**
 * #345 — placeholder companies are never filing targets. Daylite's import
 * brought over stand-in company records ("UNKNOWN", "TBD", "N/A" …) that
 * contacts were parked under; filing an email "under UNKNOWN" files it
 * nowhere. Every place that builds a filing suggestion or candidate (the
 * rules pipeline's sender-rule / identity / number steps, the AI candidate
 * list, the Link/Change… company search, a Peak/Customers Gmail label) skips
 * them, and the Organize view reads an old suggestion that points at one as
 * "nothing suggested yet". The company record itself is never touched.
 *
 * Pure, no imports — safe in the client bundle.
 */

/** The whole name, trimmed, is one of these (any case). */
export const PLACEHOLDER_COMPANY_RE = /^(unknown|ukn|tbd|n\/?a|none|test)$/i;

export function isPlaceholderCompany(name: string | null | undefined): boolean {
  return PLACEHOLDER_COMPANY_RE.test(String(name ?? "").trim());
}

/** The reason an emptied suggestion shows (the pipeline's own "nothing yet" line). */
export const NO_MATCH_REASON = "No match yet — choose a customer";

type FilingLike = {
  customerId: string | null;
  work: unknown;
  siteId?: string | null;
  noise: boolean;
  strength: "strong" | "weak";
  reason: string;
};

/**
 * A filing as the Organize view should read it: a customer that is a
 * placeholder (`isPlaceholderId`) is dropped, with its venue. A work record
 * (quote / project / lead) stays — it is real even when its customer isn't;
 * with nothing left the row reads as "No match yet" (weak). Returns the same
 * object when there is nothing to drop.
 */
export function withoutPlaceholderCustomer<F extends FilingLike>(f: F, isPlaceholderId: (id: string) => boolean): F {
  if (!f.customerId || !isPlaceholderId(f.customerId)) return f;
  const out: F = { ...f, customerId: null };
  delete out.siteId;
  if (!f.work && !f.noise) {
    out.strength = "weak";
    out.reason = NO_MATCH_REASON;
  }
  return out;
}
