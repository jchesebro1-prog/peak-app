"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { IDENTITY, deriveInitials, fallbackColor, firstName } from "@/lib/team";
import type { DesignRecord, DesignRevision } from "@/lib/stores/designs";
import {
  SHORT,
  SYSCOLOR,
  TIERS,
  compute,
  gridSets,
  hydrateAState,
  moneyRound,
  shortMoney,
  tierSystems,
  tierTotals,
  venueOf,
  type FabricOption,
  type SysKey,
  type TierKey,
} from "../quick/engine";
import { PlanSvg, buildPlan } from "../quick/plan-svg";
import {
  getAccentHex,
  getAccentHexServer,
  getTierDefs,
  getTierDefsServer,
  subscribeAccent,
  subscribeTierDefs,
} from "../quick/tierdefs-store";
import {
  approveDesignAction,
  claimDesignReviewAction,
  promoteDesignAction,
  requestDesignChangesAction,
  submitDesignReviewAction,
} from "./actions";

/* ---- accent derivations (Design.dc.html values) ---- */
const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 13%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #16181d)";
const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 30%, #fff)";
const MONO = "var(--font-mono)";
const UI = "var(--font-ui)";
const DAY = 86400000;

function timeAgoMs(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const d = Math.floor(diff / DAY);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function colorOf(name: string | null | undefined): string {
  if (!name) return "#6b7079";
  return (IDENTITY[name] && IDENTITY[name].color) || fallbackColor(name);
}
function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  return (IDENTITY[name] && IDENTITY[name].initials) || deriveInitials(name);
}

const REVIEW_PILL: Record<string, { ink: string; soft: string; bd: string; label: string }> = {
  in_review: { ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", label: "In review" },
  approved: { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", label: "Approved" },
  changes: { ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", label: "Changes" },
};

type RosterEntry = { name: string; initials: string; color: string };

export default function DesignClient({
  me,
  canApprove,
  designs: initialDesigns,
  selectedId,
  roster,
  fabrics,
  reviewerNames,
  engagementsForDesign,
}: {
  me: string;
  canApprove: boolean;
  designs: DesignRecord[];
  selectedId: string | null;
  roster: RosterEntry[];
  fabrics: FabricOption[];
  reviewerNames: string[];
  /** Reverse lookup (derived server-side, not stored) — every engagement, if any, this design feeds. */
  engagementsForDesign: Record<string, Array<{ id: string; name: string }>>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Server-fed list with client-side deltas layered on top (promotes remove a
  // card immediately; review actions patch one record) — derived, no effects.
  const [removedIds, setRemovedIds] = useState<Record<string, boolean>>({});
  const [patched, setPatched] = useState<Record<string, DesignRecord>>({});
  const designs = useMemo(
    () => initialDesigns.filter((d) => !removedIds[d.id]).map((d) => patched[d.id] || d),
    [initialDesigns, removedIds, patched]
  );

  const [scope, setScope] = useState<string>("all"); // 'mine' | 'all' | owner name
  const [promoteToast, setPromoteToast] = useState(false);
  const [promotedId, setPromotedId] = useState<string | null>(null);
  const [rcOpen, setRcOpen] = useState(false);
  const [rcNote, setRcNote] = useState("");
  const [reviewerSel, setReviewerSel] = useState("queue");
  const tierDefs = useSyncExternalStore(subscribeTierDefs, getTierDefs, getTierDefsServer);
  const accentHex = useSyncExternalStore(subscribeAccent, getAccentHex, getAccentHexServer);

  /* ------------------------------ scope filter ------------------------------ */

  const raw = useMemo(() => {
    if (scope === "mine") return designs.filter((d) => d.owner === me);
    if (scope !== "all") return designs.filter((d) => d.owner === scope);
    return designs;
  }, [designs, scope, me]);

  const totalBudget = raw.reduce((a, d) => a + (d.budget || 0), 0);
  const avgBudget = raw.length ? totalBudget / raw.length : 0;
  // A design's budget is either a parametric tier estimate or (when quoteId is
  // set) a Grid-BOM list-price sum — two different bases. Summing across all
  // designs is still useful as a rough total, but flag it when the mix occurs
  // rather than implying every dollar in it is a tier estimate.
  const hasGridLinkedBudget = raw.some((d) => d.quoteId);
  const venueCount = useMemo(() => {
    const venues: Record<string, number> = {};
    raw.forEach((d) => {
      const v = d.venue || "—";
      venues[v] = (venues[v] || 0) + 1;
    });
    return Object.keys(venues).length;
  }, [raw]);

  const stats = [
    { label: "Active designs", value: String(raw.length), sub: "in the sandbox" },
    { label: "Total budgetary", value: shortMoney(totalBudget), sub: hasGridLinkedBudget ? "mixes Grid list-price & tier est." : "across all designs" },
    { label: "Avg design", value: shortMoney(avgBudget), sub: "estimated value" },
    { label: "Venue types", value: String(venueCount), sub: "distinct contexts" },
  ];

  const ownerOptions = [{ value: "all", label: "All teammates" }].concat(
    roster.map((p) => ({ value: p.name, label: p.name === me ? p.name + " (me)" : p.name }))
  );
  const ownerSelectValue = scope === "mine" ? me : scope;

  /* -------------------------------- promote -------------------------------- */

  const promoteDesign = (id: string) => {
    startTransition(async () => {
      const res = await promoteDesignAction(id);
      if (!res.ok) return;
      setRemovedIds((m) => ({ ...m, [id]: true }));
      setPromotedId(res.quoteId);
      setPromoteToast(true);
      if (selectedId === id) router.replace("/design/designs", { scroll: false });
      else router.refresh();
    });
  };

  /* ----------------------------- selected detail ----------------------------- */

  const sel = selectedId ? designs.find((d) => d.id === selectedId) || null : null;

  const updateRecord = (rec: DesignRecord) => setPatched((m) => ({ ...m, [rec.id]: rec }));

  const doReview = (fn: () => Promise<{ ok: boolean; record?: DesignRecord; error?: string }>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok && res.record) updateRecord(res.record);
    });
  };

  const detail = useMemo(() => {
    if (!sel || !sel.config) return null;
    const s = hydrateAState(sel, 10);
    const C = compute(s);
    const tierKey = (s.tier || "better") as TierKey;
    const td = TIERS.find((t) => t.key === tierKey) || TIERS[1];
    const systems = tierSystems(C, s, tierKey, tierDefs, fabrics);
    const tot = tierTotals(systems, td, 0, 0, 0);
    const rows = systems
      .filter((x) => x.on)
      .map((x) => ({
        key: x.key,
        name: SHORT[x.key as SysKey],
        dot: x.dot,
        lines: x.items.length,
        sub: x.rev * (x.tierFixed ? 1 : td.priceMul),
      }));
    const plan = buildPlan(s, gridSets(s, tierDefs), C.electrics, accentHex);
    return { s, tierLabel: td.label, rows, matRev: tot.matRev, plan };
  }, [sel, tierDefs, fabrics, accentHex]);

  /* --------------------------------- styles --------------------------------- */

  const segActive: CSSProperties = { fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: "#16181d", background: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,.08)" };
  const segIdle: CSSProperties = { fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: "#787d87", background: "transparent", border: "none", borderRadius: 7, padding: "8px 14px", cursor: "pointer" };

  const venueChip: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#5b616e", background: "#f7f8fa", border: "1px solid #e8eaee", padding: "3px 9px", borderRadius: 20 };
  const budgetaryChip: CSSProperties = { fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: ".07em", color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, padding: "2px 7px", borderRadius: 5 };

  const reviewPill = (state: string | undefined): CSSProperties | null => {
    const m = state ? REVIEW_PILL[state] : null;
    if (!m) return null;
    return { display: "inline-block", fontSize: 9.5, fontWeight: 600, color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, padding: "2px 8px", borderRadius: 20 };
  };

  /* ------------------------------ review banner ------------------------------ */

  const review = sel ? sel.review || { state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "" } : null;
  const isOwner = sel ? sel.owner === me : false;
  const rbMeta: Record<string, { bg: string; bd: string; ink: string; icon: string; title: string }> = {
    none: { bg: "#f4f5f7", bd: "#e4e7ec", ink: "#5b616e", icon: "○", title: "Not submitted for review" },
    in_review: { bg: "#eef3fc", bd: "#d4ddf3", ink: "#3155a8", icon: "◴", title: "In review" },
    approved: { bg: "#ecf6f0", bd: "#cce9da", ink: "#1f7a52", icon: "✓", title: "Approved" },
    changes: { bg: "#fcefe9", bd: "#f0d6cd", ink: "#b4543a", icon: "↩", title: "Changes requested" },
  };
  const rmd = review ? rbMeta[review.state] || rbMeta.none : rbMeta.none;
  let rbSub = "";
  if (review) {
    if (review.state === "none") rbSub = "Submit this design for a reviewer’s approval.";
    else if (review.state === "in_review")
      rbSub = review.reviewer ? "With " + firstName(review.reviewer) + " for approval" : "In the shared queue — awaiting a reviewer";
    else if (review.state === "approved") rbSub = "Approved by " + firstName(review.decidedBy || review.reviewer || "");
    else rbSub = review.note ? "“" + review.note + "” — " + firstName(review.decidedBy || "") : "Returned by " + firstName(review.decidedBy || "");
  }
  const rbCanSubmit = !!(review && isOwner && (review.state === "none" || review.state === "changes"));
  const rbSubmitLabel = review && review.state === "changes" ? "Resubmit for review" : "Submit for review";
  const rbCanDecide = !!(review && canApprove && review.state === "in_review" && !isOwner);
  const rbCanClaim = !!(review && canApprove && review.state === "in_review" && !review.reviewer && !isOwner);
  const reviewerOptions = [{ value: "queue", label: "Shared queue (any reviewer)" }].concat(
    reviewerNames.filter((n) => n !== me && n !== (sel ? sel.owner : "")).map((n) => ({ value: n, label: n }))
  );

  const revisions: DesignRevision[] = (sel && sel.revisions) || [];

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="pk-content" style={{ fontFamily: UI, color: "#16181d" }}>
      {/* heading */}
      <div className="dd-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", rowGap: 14, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
            <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Design Dashboard</span>
            <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: ".08em", color: ACCENT_INK, border: `1px solid ${ACCENT_BORDER_LT}`, background: ACCENT_SOFT, padding: "2px 7px", borderRadius: 5 }}>SANDBOX</span>
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            Budgetary system designs — explored freely, separate from Quotes until you promote them.
          </div>
        </div>
        <Link href="/design/quick" className="dd-accent-btn" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, padding: "12px 17px", borderRadius: 9, textDecoration: "none", boxShadow: `0 1px 3px ${ACCENT_SOFT}`, flexShrink: 0 }}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New design
        </Link>
      </div>

      {/* stat tiles */}
      <div className="dd-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "16px 17px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>{s.label}</div>
            <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em", marginTop: 10 }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 7 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ===== selected design detail ===== */}
      {sel && review && (
        <div style={{ background: "#fff", border: "1px solid #ececf0", borderTop: `3px solid ${ACCENT}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "16px 20px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={venueChip}>{sel.venue || "—"}</span>
              <span style={budgetaryChip}>BUDGETARY</span>
              {reviewPill(review.state) && <span style={reviewPill(review.state)!}>{REVIEW_PILL[review.state].label}</span>}
              <span style={{ flex: 1 }} />
              <Link href="/design/designs" title="Close details" style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e4e7ec", background: "#fff", borderRadius: 7, color: "#5b616e", fontSize: 14, lineHeight: 1, textDecoration: "none" }}>
                ×
              </Link>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", rowGap: 10, marginTop: 11 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{sel.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#aab0bb", marginTop: 5 }}>
                  {sel.id} · {sel.width || "?"}&apos; × {sel.depth || "?"}&apos; × {sel.grid || "?"}&apos; · {(sel.size || "medium").replace(/^./, (c) => c.toUpperCase())}
                </div>
                {engagementsForDesign[sel.id] && engagementsForDesign[sel.id].length === 1 && (
                  <Link
                    href={`/design/engagements/${encodeURIComponent(engagementsForDesign[sel.id][0].id)}`}
                    style={{ display: "inline-block", marginTop: 7, fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
                  >
                    Part of {engagementsForDesign[sel.id][0].name} →
                  </Link>
                )}
                {engagementsForDesign[sel.id] && engagementsForDesign[sel.id].length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 7 }}>
                    {engagementsForDesign[sel.id].map((eng, i) => (
                      <span key={eng.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {i > 0 && <span style={{ fontSize: 11.5, color: "#aab0bb" }}>·</span>}
                        <Link
                          href={`/design/engagements/${encodeURIComponent(eng.id)}`}
                          style={{ display: "inline-block", fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
                        >
                          Part of {eng.name} →
                        </Link>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
                  <span title={sel.owner} style={{ width: 24, height: 24, borderRadius: "50%", background: colorOf(sel.owner), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 600, flexShrink: 0 }}>
                    {initialsOf(sel.owner)}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: "#5b616e" }}>{sel.owner || "Unassigned"}</span>
                  {sel.customer && <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>· {sel.customer}</span>}
                  <span style={{ fontSize: 11, color: "#aab0bb" }}>· edited {timeAgoMs(sel.updatedAt)}</span>
                  {revisions.length > 0 && <span style={{ fontSize: 11, color: "#aab0bb" }}>· {revisions.length} revision{revisions.length === 1 ? "" : "s"}</span>}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end" }}>
                  <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, letterSpacing: "-.01em" }}>{shortMoney(sel.budget || 0)}</span>
                  <span style={{ fontSize: 11, color: "#9aa0ab" }}>
                    {sel.quoteId ? "from linked Grid design" : `est. · ${(sel.tier || "better").replace(/^./, (c) => c.toUpperCase())}`}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                  <Link href={`/design/quick?design=${encodeURIComponent(sel.id)}`} className="dd-accent-btn" style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: ACCENT, padding: "9px 14px", borderRadius: 8, textDecoration: "none" }}>
                    Open in Quick Design
                  </Link>
                  <button onClick={() => promoteDesign(sel.id)} className="dd-accent-btn" style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", padding: "9px 14px", borderRadius: 8, cursor: "pointer" }}>
                    Add to Quotes →
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* review banner */}
          <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", rowGap: 10, padding: "11px 20px", background: rmd.bg, borderTop: `1px solid ${rmd.bd}` }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#fff", border: `1px solid ${rmd.bd}`, color: rmd.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{rmd.icon}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: rmd.ink }}>{rmd.title}</div>
              <div style={{ fontSize: 12, color: "#5b616e", marginTop: 1 }}>{rbSub}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              {rbCanSubmit && (
                <>
                  <select value={reviewerSel} onChange={(e) => setReviewerSel(e.target.value)} style={{ fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
                    {reviewerOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => doReview(() => submitDesignReviewAction(sel.id, reviewerSel !== "queue" ? reviewerSel : null))} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "#3155a8", border: "none", borderRadius: 8, padding: "9px 15px", cursor: "pointer", fontFamily: UI }}>
                    {rbSubmitLabel}
                  </button>
                </>
              )}
              {rbCanClaim && (
                <button onClick={() => doReview(() => claimDesignReviewAction(sel.id))} style={{ fontSize: 12.5, fontWeight: 600, color: "#3155a8", background: "#e9eefb", border: "1px solid #d4ddf3", borderRadius: 8, padding: "8px 13px", cursor: "pointer", fontFamily: UI }}>
                  Claim review
                </button>
              )}
              {rbCanDecide && (
                <>
                  <button onClick={() => { setRcOpen(true); setRcNote(""); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 13px", cursor: "pointer", fontFamily: UI }}>
                    Request changes
                  </button>
                  <button onClick={() => doReview(() => approveDesignAction(sel.id))} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "#1f7a52", border: "none", borderRadius: 8, padding: "9px 15px", cursor: "pointer", fontFamily: UI }}>
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>

          {/* systems / BOM summary + plan preview */}
          <div className="dd-detail-cols" style={{ display: "grid", gridTemplateColumns: detail ? "minmax(0,1fr) minmax(0,1fr)" : "1fr", gap: 18, padding: "16px 20px 18px", borderTop: "1px solid #f0f1f4" }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>
                {detail ? detail.tierLabel + " materials · by system" : "Systems"}
              </div>
              {detail ? (
                <>
                  {detail.rows.map((r) => (
                    <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid #f3f4f7" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: r.dot }} />
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</span>
                        <span style={{ fontSize: 11, color: "#aab0bb", whiteSpace: "nowrap" }}>{r.lines} line{r.lines === 1 ? "" : "s"}</span>
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600 }}>{moneyRound(r.sub)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0 0" }}>
                    <span style={{ fontSize: 12, color: "#5b616e" }}>Materials &amp; equipment</span>
                    <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{moneyRound(detail.matRev)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#aab0bb", lineHeight: 1.5, marginTop: 8 }}>
                    Recomputed live from the saved configuration — install, freight and contingency roll up in Quick Design.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {(sel.systems || []).map((nm) => {
                      const key = (Object.keys(SHORT) as SysKey[]).find((k) => SHORT[k] === nm);
                      return (
                        <span key={nm} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#16181d", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "6px 10px" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: key ? SYSCOLOR[key] : "#d6d9e0", flexShrink: 0 }} />
                          {nm}
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: "#aab0bb", lineHeight: 1.5, marginTop: 10 }}>
                    No drawing payload saved yet — open in Quick Design to configure and price this design.
                  </div>
                </>
              )}
              {/* deferred plan editor panel */}
              <div style={{ marginTop: 14, background: ACCENT_SOFT, border: `1.5px dashed ${ACCENT}`, borderRadius: 11, padding: "14px 15px" }}>
                <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: ".07em", color: ACCENT_INK, textTransform: "uppercase", marginBottom: 5 }}>Plan drawing</div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>Plan drawing editor arrives with the spatial-estimating work</div>
                <div style={{ fontSize: 11.5, color: "#5b616e", lineHeight: 1.5, marginTop: 4 }}>
                  {detail
                    ? "Freehand placement and imported floor plans land with spatial estimating — the generated plan alongside tracks the saved dimensions in the meantime."
                    : "Freehand placement and imported floor plans land with spatial estimating — open in Quick Design for the live generated plan in the meantime."}
                </div>
              </div>
            </div>
            {detail && (
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>
                  Plan preview · {venueOf(detail.s).label}
                </div>
                <div style={{ background: "#fbfbfc", border: "1px solid #f0f1f4", borderRadius: 12, padding: 14 }}>
                  <PlanSvg plan={detail.plan} accent={accentHex} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* active designs controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 11, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Active designs</span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: "#9aa0ab" }}>{raw.length}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3 }}>
            <button onClick={() => setScope("mine")} style={scope === "mine" ? segActive : segIdle}>My work</button>
            <button onClick={() => setScope("all")} style={scope === "all" ? segActive : segIdle}>Everyone</button>
          </div>
          <select className="dd-sel" value={ownerSelectValue} onChange={(e) => { const v = e.target.value; setScope(v === me ? "mine" : v); }}>
            {ownerOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {raw.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px dashed #d6d9e0", borderRadius: 13, padding: "52px 20px", textAlign: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: ACCENT_SOFT, color: ACCENT_INK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, lineHeight: 1, margin: "0 auto 14px" }}>+</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No active designs yet</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.5, maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>
            Start a budgetary design in the sandbox — explore systems and pricing without touching your quote pipeline.
          </div>
          <Link href="/design/quick" className="dd-accent-btn" style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 18, fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, padding: "11px 18px", borderRadius: 9, textDecoration: "none" }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> New design
          </Link>
        </div>
      ) : (
        <div className="dd-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {raw.map((d) => {
            const pill = reviewPill(d.review && d.review.state);
            return (
              <div key={d.id} style={{ display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #ececf0", borderTop: `3px solid ${ACCENT}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", overflow: "hidden" }}>
                <div style={{ padding: "15px 16px 0", flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={venueChip}>{d.venue || "—"}</span>
                    <span style={budgetaryChip}>BUDGETARY</span>
                  </div>
                  <Link href={`/design/designs?id=${encodeURIComponent(d.id)}`} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 38, fontSize: 14.5, fontWeight: 600, lineHeight: 1.3, marginTop: 12, color: "#16181d", textDecoration: "none" }}>
                    {d.name}
                  </Link>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#aab0bb", marginTop: 5 }}>
                    {d.id} · {d.width || "?"}&apos; × {d.depth || "?"}&apos; × {d.grid || "?"}&apos;
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 15 }}>
                    <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, letterSpacing: "-.01em" }}>{shortMoney(d.budget || 0)}</span>
                    <span style={{ fontSize: 11, color: "#9aa0ab" }}>
                      {d.quoteId ? "from linked Grid design" : `est. · ${(d.tier || "better").replace(/^./, (c) => c.toUpperCase())}`}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 7 }}>
                    {(d.systems || []).length} systems · edited {timeAgoMs(d.updatedAt)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingBottom: 14, borderBottom: "1px solid #f2f3f5" }}>
                    <span title={d.owner} style={{ width: 24, height: 24, borderRadius: "50%", background: colorOf(d.owner), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 600, flexShrink: 0 }}>
                      {initialsOf(d.owner)}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 500, color: "#5b616e" }}>{d.owner || "Unassigned"}</span>
                    {pill && (
                      <span style={{ ...pill, marginLeft: "auto" }}>{REVIEW_PILL[d.review!.state].label}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px" }}>
                  <Link href={`/design/quick?design=${encodeURIComponent(d.id)}`} className="dd-open-link" style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e", textDecoration: "none", padding: "9px 14px", borderRadius: 8, border: "1px solid #e4e7ec", background: "#fff" }}>
                    Open
                  </Link>
                  <button onClick={() => promoteDesign(d.id)} className="dd-accent-btn" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", padding: "10px 12px", borderRadius: 8, cursor: "pointer" }}>
                    Add to Quotes →
                  </button>
                </div>
              </div>
            );
          })}

          <Link href="/design/quick" className="dd-newtile" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9, background: "transparent", border: "1.5px dashed #d6d9e0", borderRadius: 12, textDecoration: "none", color: "#9aa0ab", minHeight: 210 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: "#f1f2f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, lineHeight: 1 }}>+</span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>New design</span>
            <span style={{ fontSize: 11.5, textAlign: "center", lineHeight: 1.4, maxWidth: 150 }}>Build &amp; price freely in the sandbox</span>
          </Link>
        </div>
      )}

      {/* promote toast */}
      {promoteToast && (
        <div style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 13, background: "#16181d", color: "#fff", padding: "13px 16px", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,.22)", zIndex: 60, maxWidth: "92vw" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fd29a", flexShrink: 0 }} />
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>
            Added to Quotes as <b style={{ fontFamily: MONO }}>{promotedId}</b> — flagged for requote
          </span>
          <Link href={`/estimator?id=${encodeURIComponent(promotedId || "")}`} style={{ fontSize: 13, fontWeight: 600, color: "#fff", textDecoration: "underline", whiteSpace: "nowrap" }}>
            Requote now
          </Link>
          <button onClick={() => setPromoteToast(false)} style={{ width: 24, height: 24, border: "none", background: "#2b2e35", borderRadius: 6, color: "#cfd3da", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
            ×
          </button>
        </div>
      )}

      {/* request-changes modal */}
      {rcOpen && sel && (
        <div onClick={() => { setRcOpen(false); setRcNote(""); }} style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, zIndex: 90 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", background: "#fff", borderRadius: 15, boxShadow: "0 24px 70px rgba(0,0,0,.34)", overflow: "hidden", color: "#16181d" }}>
            <div style={{ padding: "17px 22px", borderBottom: "1px solid #f0f1f4", fontSize: 16, fontWeight: 600 }}>Request changes</div>
            <div style={{ padding: "20px 22px" }}>
              <div style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 11, lineHeight: 1.5 }}>
                Tell the designer what needs to change before this can be approved.
              </div>
              <textarea
                value={rcNote}
                onChange={(e) => setRcNote(e.target.value)}
                placeholder="e.g. Trim the grid height and re-check the budgetary fixture count."
                style={{ width: "100%", minHeight: 96, border: "1px solid #e4e7ec", borderRadius: 9, padding: "11px 13px", fontSize: 13.5, fontFamily: UI, resize: "vertical", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 9, padding: "14px 22px", borderTop: "1px solid #f0f1f4" }}>
              <button onClick={() => { setRcOpen(false); setRcNote(""); }} style={{ fontSize: 13, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer", padding: "10px 12px", fontFamily: UI }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!rcNote.trim()) return;
                  const note = rcNote.trim();
                  setRcOpen(false);
                  setRcNote("");
                  doReview(() => requestDesignChangesAction(sel.id, note));
                }}
                style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "#b4543a", border: "none", borderRadius: 9, padding: "10px 18px", cursor: "pointer", fontFamily: UI }}
              >
                Send back for changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
