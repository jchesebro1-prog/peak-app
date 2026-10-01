/**
 * Quote review limits (#242) — per-person self-approval.
 *
 * Jeff (2026-09-27): a quote at or under a definable limit is approved by its
 * owner automatically. Limits are per PERSON (the quote OWNER's limit is the
 * one used) and per REVIEW KIND: system estimates split on whether any labor
 * line is on the quote (custom items, allowances and discounts don't change
 * it); flame tests / repairs / inspections split on auto-priced vs a
 * hand-typed total (#217 priceOverride); rentals and consulting have one each.
 *
 * Pure and CLIENT-SAFE. The approval gate (stores/quotes.ts
 * decideApprovalGate), the builders' chips, the quotes hub, the Settings card
 * and the banner sentence all read these rules, so they cannot disagree.
 * Imports only other pure modules — never a store, @/db, settings, users or
 * session (review-limits-server.ts is the server half).
 */
import { normalizePriceOverride } from "@/lib/service-pricing";
import { isLaborSku } from "@/lib/design/wire-labor";
import { firstName } from "@/lib/team";
import { approvalSnapshotMatches } from "@/lib/approval-snapshot";
import { money } from "@/lib/format";

/* ---------------- kinds ---------------- */

export const REVIEW_KINDS = [
  { key: "system_plain", group: "System estimate", sub: "No labor", phrase: "system estimates without labor" },
  { key: "system_labor", group: "System estimate", sub: "With labor", phrase: "system estimates with labor" },
  { key: "flame_auto", group: "Flame test", sub: "Auto-priced", phrase: "auto-priced flame tests" },
  { key: "flame_typed", group: "Flame test", sub: "Typed total", phrase: "flame tests with a typed total" },
  { key: "repair_auto", group: "Repair", sub: "Auto-priced", phrase: "auto-priced repairs" },
  { key: "repair_typed", group: "Repair", sub: "Typed total", phrase: "repairs with a typed total" },
  { key: "inspection_auto", group: "Inspection", sub: "Auto-priced", phrase: "auto-priced inspections" },
  { key: "inspection_typed", group: "Inspection", sub: "Typed total", phrase: "inspections with a typed total" },
  { key: "rental", group: "Rental", sub: "", phrase: "rentals" },
  { key: "consulting", group: "Consulting", sub: "", phrase: "consulting quotes" },
] as const;

export type ReviewKind = (typeof REVIEW_KINDS)[number]["key"];
export const REVIEW_KIND_KEYS: readonly ReviewKind[] = REVIEW_KINDS.map((k) => k.key);

export function isReviewKind(v: unknown): v is ReviewKind {
  return typeof v === "string" && (REVIEW_KIND_KEYS as readonly string[]).includes(v);
}

/** The Settings column label, e.g. "System estimate — no labor". */
export function reviewKindColumn(kind: ReviewKind): string {
  const k = REVIEW_KINDS.find((x) => x.key === kind);
  if (!k) return kind;
  return k.sub ? `${k.group} — ${k.sub.toLowerCase()}` : k.group;
}

/** The banner phrase, e.g. "system estimates without labor". */
export function reviewKindPhrase(kind: string): string {
  return REVIEW_KINDS.find((x) => x.key === kind)?.phrase ?? "this kind of quote";
}

/* ---------------- stored shape ---------------- */

/** Same ceiling as a typed service total (#217 PRICE_OVERRIDE_MAX). */
export const REVIEW_LIMIT_MAX = 10_000_000;
/** Whole dollars (auto-approve at or under), or "none" = No limit. A
 *  missing key is blank = always needs review. */
export type ReviewLimit = number | "none";
/** Settings `reviewLimits`: { [users.id]: { [kind]: limit } }. */
export type ReviewLimits = Record<string, Partial<Record<ReviewKind, ReviewLimit>>>;
/** Written on an `auto_limit` approval: what it was granted against.
 *  `triggeredBy` / `trigger` (#242 final) name who moved the quote to sent/won
 *  when the grant was written — absent on snapshots written before them. */
export type AutoApprovalSnapshot = {
  kind: ReviewKind;
  limit: ReviewLimit;
  value: number;
  triggeredBy?: string;
  trigger?: "sent" | "won";
};

/* ---------------- structural inputs (QuoteReview / Quote satisfy them) ---------------- */

export type ReviewLike = {
  state: string;
  method?: string | null;
  decidedBy?: string | null;
  auto?: AutoApprovalSnapshot | null;
  approvedAgainst?: { sell: number; linesKey: string } | null;
};
export type ReviewableQuote = {
  quoteType?: string | null;
  value: number;
  owner?: string | null;
  preparedBy?: string | null;
  status?: string;
  spec?: unknown;
  flameTest?: unknown;
  repair?: unknown;
  inspection?: unknown;
  review?: ReviewLike | null;
};
type KindInput = Pick<ReviewableQuote, "quoteType" | "spec" | "flameTest" | "repair" | "inspection">;
export type RosterEntry = {
  id: string;
  name: string;
  status: string;
  /** #284: the person holds the `approve` permission (live roster). */
  canApprove?: boolean;
};
export type ReviewLimitContext = { limits: ReviewLimits; roster: readonly RosterEntry[] };
export const NO_REVIEW_LIMITS: ReviewLimitContext = { limits: {}, roster: [] };

/* ---------------- what's on the quote ---------------- */

type LineLike = {
  sku?: unknown;
  qty?: unknown;
  price?: unknown;
  ext?: unknown;
  extSellOverride?: unknown;
  labor?: unknown;
  option?: unknown;
};
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** estimator/pricing.ts lineExtSellOf, restated so lib never imports an app route module. */
function estimatorExtSell(it: LineLike): number {
  return typeof it.extSellOverride === "number" && Number.isFinite(it.extSellOverride)
    ? Math.max(0, it.extSellOverride)
    : num(it.qty) * num(it.price);
}

/**
 * Does this quote carry any labor line? The one rule the chip and the gate share.
 * - Estimator (`spec.sections`): the lines estimator/pricing.ts totals() sums
 *   into `lab` — an item of a kind:"labor" section or a labor:true item, not
 *   an optional (`option`) line, with a positive extended sell.
 * - The Grid (`spec.lines`, incl. D94's flat lines): #232's `labor:<system>`
 *   lines, which grid-quote.ts writes only when the amount is > 0.
 * - A promoted Quick design (`spec.fromDesign`, stores/designs.ts): no lines;
 *   its budget (tierTotals) always prices installation, so it counts.
 * Custom items, allowances and discounts never count. No spec → no labor.
 */
export function hasLaborLine(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as { sections?: unknown; lines?: unknown; fromDesign?: unknown };
  if (Array.isArray(s.sections)) {
    return s.sections.some((sec) => {
      const so = (sec && typeof sec === "object" ? sec : {}) as { kind?: unknown; items?: unknown };
      const items = Array.isArray(so.items) ? (so.items as LineLike[]) : [];
      return items.some((it) => !!it && !it.option && (so.kind === "labor" || !!it.labor) && estimatorExtSell(it) > 0);
    });
  }
  if (Array.isArray(s.lines)) {
    return (s.lines as LineLike[]).some((l) => !!l && isLaborSku(l.sku) && num(l.ext) > 0);
  }
  return typeof s.fromDesign === "string" && s.fromDesign !== "";
}

/**
 * Is this service subdoc's total hand-typed (#217 priceOverride)? A
 * `priceOverrideSeeded` override is the D286 reopen-seed of an old off-grid
 * sent price — nobody typed it (D366) — so it reads as auto-priced. Same rule
 * as renewal-outreach.ts priorHandSetPrice. A flame venue's testingOverride
 * (D365) is a cost input, not a typed total.
 */
export function hasTypedTotal(sub: unknown): boolean {
  if (!sub || typeof sub !== "object") return false;
  const d = sub as { priceOverride?: unknown; priceOverrideSeeded?: unknown };
  if (d.priceOverrideSeeded === true) return false;
  return normalizePriceOverride(d.priceOverride) != null;
}

/** The review kind of a quote. Unknown / missing / "system" types are system estimates. */
export function reviewKindOf(q: KindInput): ReviewKind {
  switch (q.quoteType) {
    case "flame_test":
      return hasTypedTotal(q.flameTest) ? "flame_typed" : "flame_auto";
    case "repair":
      return hasTypedTotal(q.repair) ? "repair_typed" : "repair_auto";
    case "inspection":
      return hasTypedTotal(q.inspection) ? "inspection_typed" : "inspection_auto";
    case "rental":
      return "rental";
    case "consulting":
      return "consulting";
    default:
      return hasLaborLine(q.spec) ? "system_labor" : "system_plain";
  }
}

/* ---------------- owner ---------------- */

/** The quote's owner name, falling back to preparedBy. */
export function quoteOwnerName(q: Pick<ReviewableQuote, "owner" | "preparedBy">): string {
  return (q.owner || "").trim() || (q.preparedBy || "").trim();
}

/** Owner name → users.id: active users only, trimmed and case-insensitive,
 *  exactly one match (two active people with one name → nobody). */
export function resolveOwnerId(name: string, roster: readonly RosterEntry[]): string | null {
  const needle = (name || "").trim().toLowerCase();
  if (!needle) return null;
  const hits = roster.filter((u) => u.status === "active" && (u.name || "").trim().toLowerCase() === needle);
  return hits.length === 1 ? hits[0].id : null;
}

/* ---------------- evaluation ---------------- */

export type ReviewLimitEval = {
  kind: ReviewKind;
  ownerName: string;
  /** null = the owner is not on the active roster (or is ambiguous). */
  ownerId: string | null;
  /** null = blank (always needs review). */
  limit: ReviewLimit | null;
  value: number;
  fits: boolean;
};
export type AutoApprovalEval = ReviewLimitEval & { ownerId: string; limit: ReviewLimit; fits: true };

function limitOf(v: unknown): ReviewLimit | null {
  if (v === "none") return "none";
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** The quote against its owner's CURRENT limit for its kind. */
export function evaluateReviewLimit(q: ReviewableQuote, ctx: ReviewLimitContext): ReviewLimitEval {
  const kind = reviewKindOf(q);
  const ownerName = quoteOwnerName(q);
  const ownerId = resolveOwnerId(ownerName, ctx.roster);
  const limit = ownerId ? limitOf(ctx.limits[ownerId]?.[kind]) : null;
  const finite = typeof q.value === "number" && Number.isFinite(q.value);
  const value = finite ? q.value : 0;
  const fits = ownerId != null && limit != null && finite && (limit === "none" || value <= limit);
  return { kind, ownerName, ownerId, limit, value, fits };
}

/** The evaluation when the gate may auto-approve now: the quote fits, and no
 *  reviewer has asked for changes (an in-app "changes" decision blocks it,
 *  exactly as it blocks attestation — canAttestApproval, #60). */
export function canAutoApprove(q: ReviewableQuote, ctx: ReviewLimitContext): AutoApprovalEval | null {
  if (q.review?.state === "changes") return null;
  const ev = evaluateReviewLimit(q, ctx);
  return ev.fits ? (ev as AutoApprovalEval) : null;
}

/**
 * #284/#287 — the approver moving a quote approves it at the gated
 * transition. Jeff (2026-10-01): an approver may send any quote, not only
 * their own ("Jena created it but I edited and I want to review and send
 * it"). Non-null when the ACTOR — not the owner — is one active roster entry
 * holding `approve`; an actor off the roster is never an approver here.
 * `method` is "self" when the actor owns the quote (quoteOwnerName), else
 * "in_app". Changes requested blocks only "self" (same block as attest /
 * auto, #60): a non-owner approver deciding to send is a fresh approver
 * decision and may override another approver's send-back.
 */
export function approverOnTransition(
  q: ReviewableQuote,
  ctx: ReviewLimitContext,
  actor: string | null
): { by: string; method: "self" | "in_app" } | null {
  const who = (actor || "").trim();
  const id = resolveOwnerId(who, ctx.roster);
  if (!id || !ctx.roster.find((u) => u.id === id)?.canApprove) return null;
  const owner = quoteOwnerName(q).toLowerCase();
  const self = owner !== "" && owner === who.toLowerCase();
  if (self && q.review?.state === "changes") return null;
  return { by: who, method: self ? "self" : "in_app" };
}

/**
 * Is the quote unchanged against its auto-approval snapshot? Same kind, a
 * value at or under the snapshot's, and the same owner (the stamp's
 * decidedBy). A missing snapshot or owner counts as changed.
 */
export function autoSnapshotUnchanged(q: ReviewableQuote): boolean {
  const r = q.review;
  const a = r?.auto;
  if (!r || !a) return false;
  const owner = quoteOwnerName(q).toLowerCase();
  const stamped = (r.decidedBy || "").trim().toLowerCase();
  if (!owner || owner !== stamped) return false;
  if (typeof q.value !== "number" || !Number.isFinite(q.value) || q.value > a.value) return false;
  return reviewKindOf(q) === a.kind;
}

/** Does the quote's approval count right now? In-app, attested, self and
 *  legacy approvals: hold while the quote matches its #284 snapshot
 *  (approval-snapshot.ts); no snapshot = legacy, holds. An auto_limit approval holds while the
 *  quote is unchanged against its snapshot (autoSnapshotUnchanged) — even if
 *  the owner's limit was lowered or the owner left the roster afterwards: a
 *  lowered limit governs NEW grants only. Once the quote changed (value
 *  raised past the snapshot, labor added, owner changed) it is re-checked
 *  against the owner's CURRENT limit. */
export function approvalHolds(q: ReviewableQuote, ctx: ReviewLimitContext): boolean {
  const r = q.review;
  if (!r || r.state !== "approved") return false;
  if (r.method !== "auto_limit") return approvalSnapshotMatches(q);
  return autoSnapshotUnchanged(q) || evaluateReviewLimit(q, ctx).fits;
}

/** The auto-approval record should be rewritten when the current evaluation
 *  fits but the QUOTE no longer matches its snapshot — its kind, owner or
 *  value changed. A limit changed in Settings on an unchanged quote is not a
 *  reason (#242 final): the grant keeps its original decidedAt and limit. The
 *  rewrite happens at the next gated transition (decideApprovalGate), so until
 *  then the banner describes the last grant. */
export function autoSnapshotStale(q: ReviewableQuote, ev: AutoApprovalEval): boolean {
  const r = q.review;
  const a = r?.auto;
  if (!r || r.method !== "auto_limit" || !a) return true;
  return (
    a.kind !== ev.kind ||
    ev.value !== a.value ||
    (r.decidedBy || "").trim().toLowerCase() !== ev.ownerName.trim().toLowerCase()
  );
}

/** An auto_limit approval that no longer holds (approvalHolds) — the quote
 *  reads as needing review everywhere, and its owner may submit it for review
 *  or attest it again, even once it was sent (#242 final), so it can still
 *  reach Won through a real approval. */
export function isStaleAutoApproval(q: ReviewableQuote, ctx: ReviewLimitContext): boolean {
  const r = q.review;
  return !!r && r.state === "approved" && r.method === "auto_limit" && !approvalHolds(q, ctx);
}

/* ---------------- chip ---------------- */

export type ReviewLimitChipData = {
  tone: "within" | "over";
  /** The full sentence (builders, the Estimator bar, a pill's tooltip). */
  text: string;
  /** The hub-row pill label. */
  short: string;
  /** An auto_limit approval that no longer holds — read as not approved. */
  staleAuto: boolean;
};

/**
 * What the builders and the quotes hub show. Nothing on a won/lost quote, on
 * an in-app / attested / legacy approval, on a changes-requested quote, or
 * when the owner has no limit for the kind — except a stale auto approval,
 * which always shows so nobody mistakes it for an approval.
 */
export function reviewLimitChip(q: ReviewableQuote, ctx: ReviewLimitContext, viewerName: string): ReviewLimitChipData | null {
  if (q.status === "won" || q.status === "lost") return null;
  const r = q.review;
  const approved = r?.state === "approved";
  if (approved && r?.method !== "auto_limit") return null;
  if (r?.state === "changes") return null;
  const ev = evaluateReviewLimit(q, ctx);
  const holds = approved && approvalHolds(q, ctx);
  // An unchanged auto approval stands on its own snapshot after a limit is
  // lowered; the banner describes that grant, so no "over" chip contradicts it.
  if (holds && !ev.fits) return null;
  const staleAuto = approved && !holds;
  if (ev.ownerId == null || ev.limit == null) {
    return staleAuto
      ? { tone: "over", text: "No review limit covers this quote any more — needs review", short: "Needs review", staleAuto: true }
      : null;
  }
  const mine = ev.ownerName.trim().toLowerCase() === (viewerName || "").trim().toLowerCase();
  const whose = mine ? "your" : `${firstName(ev.ownerName)}'s`;
  if (ev.fits) return { tone: "within", text: `Within ${whose} limit — approves automatically`, short: "Within limit", staleAuto: false };
  const cap = ev.limit === "none" ? "" : `${money(ev.limit)} `;
  return { tone: "over", text: `Over ${whose} ${cap}limit — needs review`, short: `Over ${cap}limit`, staleAuto };
}

/* ---------------- storage + the Settings cell text ---------------- */

/** Server-side clean-up of a stored or submitted map: whole dollars, capped at
 *  REVIEW_LIMIT_MAX, "none" kept, negatives / non-numbers / unknown kinds /
 *  empty rows dropped; with `knownUserIds`, unknown people dropped too. */
export function sanitizeReviewLimits(raw: unknown, knownUserIds: ReadonlySet<string> | null): ReviewLimits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ReviewLimits = {};
  for (const [uid, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!uid || uid.length > 64) continue;
    if (knownUserIds && !knownUserIds.has(uid)) continue;
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const src = row as Record<string, unknown>;
    const clean: Partial<Record<ReviewKind, ReviewLimit>> = {};
    for (const k of REVIEW_KIND_KEYS) {
      const v = src[k];
      if (v === "none") clean[k] = "none";
      else if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[k] = Math.min(Math.round(v), REVIEW_LIMIT_MAX);
    }
    if (Object.keys(clean).length) out[uid] = clean;
  }
  return out;
}

/** The stored blob as read (no roster filter — an archived person's row is kept). */
export function reviewLimitsFrom(stored: unknown): ReviewLimits {
  return sanitizeReviewLimits(stored, null);
}

const NO_LIMIT_RE = /^(no limit|none|unlimited|∞)$/i;

/** One Settings cell: "" → blank, "No limit" (none/unlimited/∞) → "none",
 *  "$25,000" / "1500.60" → whole dollars. Anything else is refused. */
export function parseLimitInput(text: string): { ok: true; limit: ReviewLimit | null } | { ok: false; error: string } {
  const t = (text || "").trim();
  if (!t) return { ok: true, limit: null };
  if (NO_LIMIT_RE.test(t)) return { ok: true, limit: "none" };
  const digits = t.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) {
    return { ok: false, error: `"${t}" isn't a dollar amount — type a number like 25,000, No limit, or leave it blank.` };
  }
  const n = Math.round(Number(digits));
  if (n > REVIEW_LIMIT_MAX) return { ok: false, error: `Limits top out at ${money(REVIEW_LIMIT_MAX)}.` };
  return { ok: true, limit: n };
}

export function formatLimitInput(limit: ReviewLimit | null | undefined): string {
  if (limit == null) return "";
  if (limit === "none") return "No limit";
  return money(limit);
}

/**
 * The Settings card's save: `cells` holds the rows the card showed (one per
 * active person, every kind as typed text). A shown row REPLACES that
 * person's stored row (all blank → removed); rows the card didn't show
 * (archived people) are kept as stored. A bad cell refuses the whole save,
 * naming the person and the column.
 */
export function applyLimitCells(
  stored: ReviewLimits,
  cells: Record<string, Partial<Record<ReviewKind, string>>>,
  nameOf: (userId: string) => string
): { ok: true; limits: ReviewLimits } | { ok: false; error: string } {
  const next: ReviewLimits = { ...stored };
  for (const [uid, row] of Object.entries(cells)) {
    const out: Partial<Record<ReviewKind, ReviewLimit>> = {};
    for (const k of REVIEW_KIND_KEYS) {
      const p = parseLimitInput(row[k] ?? "");
      if (!p.ok) return { ok: false, error: `${nameOf(uid)} · ${reviewKindColumn(k)}: ${p.error}` };
      if (p.limit !== null) out[k] = p.limit;
    }
    if (Object.keys(out).length) next[uid] = out;
    else delete next[uid];
  }
  return { ok: true, limits: next };
}
