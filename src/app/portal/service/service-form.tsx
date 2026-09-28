"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { PortalService } from "@/lib/portal-service-scope";
import type { ServiceCustomerView } from "@/lib/portal-service-pricing";
import { generateServiceAction, priceServiceAction } from "./actions";

/**
 * The `/portal/service` intake (#248 Task 3, spec §2). Service is URL state
 * (the three pills are plain links — switching service re-renders the page
 * server-side with a fresh scope, since pre-filled counts come from a
 * different history per service/level); venue ticks and counts are local
 * state, debounced 300 ms into a live server re-price with a sequence guard
 * so a stale response can never overwrite a newer one. Generate wraps
 * `generateServiceAction`, which redirects to the #245 `/portal` banner on
 * success — only a refusal ever comes back here.
 *
 * Verbatim copy (#248 global constraints) is duplicated as local constants
 * rather than imported — a "use client" module can't pull named values out
 * of a module that (transitively) touches the DB, only types (see
 * ../catalog/quote/cart-client.tsx's REVIEW_LINE/TAX_LINE for the same
 * pattern).
 */

const REVIEW_LINE = "All quotes are subject to Peak review and approval.";
const TAX_LINE = "Plus applicable sales tax.";
const PICK_VENUE_COPY = "Pick at least one venue.";
const CURTAINS_HINT = "Enter the number of curtains (1–200).";
const LINE_SETS_HINT = "Enter the number of line sets (1–300).";
const PREVIEW_PRICE_HINT = "Preview — customers see live prices here.";

export type ServiceFormVenue = {
  venueId: string;
  label: string;
  source: "job" | "quote" | null;
  sourceYear: number | null;
  /** Pre-checked from the URL/quote the page resolved (spec §1). */
  selected: boolean;
  /** Pre-filled from history, or null when the customer must type it. */
  count: number | null;
};

type Row = { venueId: string; label: string; hint: string; selected: boolean; text: string };

const CSS = `
  .psv-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
  .psv-title { font-size: 22px; font-weight: 600; letter-spacing: -.015em; }
  .psv-sub { font-size: 13px; color: #5b616e; margin-top: 4px; }
  .psv-link { font-size: 13px; font-weight: 600; color: var(--accent); text-decoration: none; }
  .psv-picker { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  .psv-pill { font: 600 12.5px var(--font-ui); padding: 9px 14px; border-radius: 20px; border: 1px solid #e4e7ec; background: #fff; color: #5b616e; text-decoration: none; display: inline-block; }
  .psv-pill-on { border-color: var(--accent); background: var(--accent); color: #fff; }
  .psv-card { background: #fff; border: 1px solid #e4e7ec; border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 18px; overflow: hidden; }
  .psv-card-head { padding: 14px 20px 11px; border-bottom: 1px solid #f0f1f4; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .psv-card-title { font-size: 14.5px; font-weight: 600; }
  .psv-muted { font-size: 11.5px; color: #9aa0ab; }
  .psv-row { display: grid; grid-template-columns: auto minmax(0, 1fr) 118px; gap: 12px; align-items: center; padding: 13px 20px; border-bottom: 1px solid #f5f6f8; }
  .psv-row:last-child { border-bottom: none; }
  .psv-check { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
  .psv-check:disabled { cursor: not-allowed; }
  .psv-venue-label { font-size: 13.5px; font-weight: 600; }
  .psv-venue-hint { font-size: 11.5px; color: #9aa0ab; margin-top: 2px; }
  .psv-count { width: 100%; box-sizing: border-box; font: 600 13.5px var(--font-mono); padding: 9px 10px; border: 1px solid #d6d9e0; border-radius: 8px; text-align: right; color: #16181d; }
  .psv-count:disabled { background: #f7f8fa; color: #c3c7ce; }
  .psv-empty { padding: 22px 20px; text-align: center; font-size: 12.5px; color: #9aa0ab; }
  .psv-sum { padding: 16px 20px 18px; display: flex; flex-direction: column; gap: 8px; }
  .psv-line { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #5b616e; }
  .psv-line span:last-child { font-family: var(--font-mono); color: #16181d; }
  .psv-total { display: flex; justify-content: space-between; gap: 12px; align-items: center; background: var(--accent); color: #fff; border-radius: 8px; padding: 12px 14px; margin-top: 4px; }
  .psv-total span:first-child { font-size: 13.5px; font-weight: 700; }
  .psv-total span:last-child { font-family: var(--font-mono); font-size: 17px; font-weight: 600; }
  .psv-fine { font-size: 11.5px; color: #8c919c; line-height: 1.55; }
  .psv-err { margin: 0 20px 14px; padding: 10px 12px; font-size: 12.5px; font-weight: 600; color: #a33a2b; background: #fdf0ee; border: 1px solid #f3d2cc; border-radius: 8px; }
  .psv-go { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: flex-end; padding: 0 20px 18px; }
  .psv-go-why { font-size: 12.5px; color: #8c919c; }
  .psv-btn { font: 600 14px var(--font-ui); color: #fff; background: var(--accent); border: none; border-radius: 10px; padding: 12px 20px; cursor: pointer; }
  .psv-btn:disabled { opacity: .45; cursor: not-allowed; }
  @media (max-width: 640px) {
    .psv-row { grid-template-columns: auto minmax(0, 1fr); }
    .psv-count { grid-column: 1 / -1; margin-left: 30px; width: calc(100% - 30px); text-align: left; }
  }
`;

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function sourceHint(v: ServiceFormVenue, service: PortalService): string {
  if (v.source === "job") return `From your ${v.sourceYear ?? ""} ${service.kind === "flame" ? "test" : "inspection"}`.trim();
  if (v.source === "quote") return `From your ${v.sourceYear ?? ""} quote`.trim();
  return service.kind === "flame" ? CURTAINS_HINT : LINE_SETS_HINT;
}

function buildRows(venues: ServiceFormVenue[], service: PortalService): Row[] {
  return venues.map((v) => ({
    venueId: v.venueId,
    label: v.label,
    hint: sourceHint(v, service),
    selected: v.selected,
    text: v.count != null ? String(v.count) : "",
  }));
}

function serviceKeyOf(service: PortalService): string {
  return service.kind === "flame" ? "flame" : `inspection:${service.level}`;
}

/** Row text → the whole-number count the server sees; blank/non-numeric
 *  reads as 0 (out of range), which the server refuses with its exact range
 *  copy rather than this client guessing at validation. */
function toCount(text: string): number {
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? n : 0;
}

function pillHref(kind: "flame" | "inspection", level: 1 | 2, previewCid: string): string {
  const p = new URLSearchParams();
  p.set("type", kind);
  if (kind === "inspection") p.set("level", String(level));
  if (previewCid) p.set("preview", previewCid);
  return "/portal/service?" + p.toString();
}

export function ServiceForm({
  service,
  venues,
  initialView,
  initialError,
  preview,
  previewCid = "",
}: {
  service: PortalService;
  venues: ServiceFormVenue[];
  initialView: ServiceCustomerView | null;
  initialError: string | null;
  preview: boolean;
  previewCid?: string;
}) {
  const router = useRouter();
  const serviceKey = serviceKeyOf(service);

  const [rows, setRows] = useState(() => buildRows(venues, service));
  const [view, setView] = useState(initialView);
  const [error, setError] = useState(initialError || "");
  // Re-seed local state whenever the SERVER's own scope changes underneath
  // us (a service-pill navigation — a different history, a different
  // default view) rather than trusting a stale local edit to survive it.
  const [seenKey, setSeenKey] = useState(serviceKey);
  if (seenKey !== serviceKey) {
    setSeenKey(serviceKey);
    setRows(buildRows(venues, service));
    setView(initialView);
    setError(initialError || "");
  }

  const [pricing, startPricing] = useTransition();
  const [generating, startGenerate] = useTransition();
  const [genError, setGenError] = useState("");

  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  function reprice(nextRows: Row[]) {
    if (preview) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const mySeq = ++seqRef.current;
      const req = {
        service,
        venues: nextRows.filter((r) => r.selected).map((r) => ({ venueId: r.venueId, count: toCount(r.text) })),
      };
      startPricing(async () => {
        try {
          const r = await priceServiceAction(req);
          if (seqRef.current !== mySeq) return; // a later request has since landed
          if (r.ok) {
            setView(r.view);
            setError("");
          } else {
            setView(null);
            setError(r.error);
          }
        } catch {
          if (seqRef.current !== mySeq) return;
          setView(null);
          setError("Couldn't price your request — check your connection and try again.");
        }
      });
    }, 300);
  }

  function updateRow(venueId: string, patch: Partial<Row>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.venueId === venueId ? { ...r, ...patch } : r));
      reprice(next);
      return next;
    });
  }

  function generate() {
    setGenError("");
    const req = {
      service,
      venues: rows.filter((r) => r.selected).map((r) => ({ venueId: r.venueId, count: toCount(r.text) })),
    };
    startGenerate(async () => {
      try {
        // Success redirects to /portal; only a refusal comes back.
        const r = await generateServiceAction(req);
        if (r && !r.ok) {
          setGenError(r.error);
          router.refresh();
        }
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e && String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
        setGenError("Couldn't generate your quote — check your connection and try again.");
      }
    });
  }

  const countLabel = service.kind === "flame" ? "Curtains" : "Line sets";
  const busy = pricing || generating;
  const blocked = preview ? PREVIEW_PRICE_HINT : !view ? error || PICK_VENUE_COPY : null;

  return (
    <>
      <style>{CSS}</style>
      <div className="psv-head">
        <div>
          <div className="psv-title">Request a service quote</div>
          <div className="psv-sub">Pick the venues, we&rsquo;ll price it the same way our own team would.</div>
        </div>
        <Link href={preview ? `/portal?preview=${encodeURIComponent(previewCid)}` : "/portal"} className="psv-link">
          ← Your dashboard
        </Link>
      </div>

      <div className="psv-picker">
        <Link href={pillHref("flame", 1, previewCid)} className={"psv-pill" + (service.kind === "flame" ? " psv-pill-on" : "")}>
          Flame test
        </Link>
        <Link
          href={pillHref("inspection", 1, previewCid)}
          className={"psv-pill" + (service.kind === "inspection" && service.level === 1 ? " psv-pill-on" : "")}
        >
          Inspection — Annual (L1)
        </Link>
        <Link
          href={pillHref("inspection", 2, previewCid)}
          className={"psv-pill" + (service.kind === "inspection" && service.level === 2 ? " psv-pill-on" : "")}
        >
          Inspection — Five-year (L2)
        </Link>
      </div>

      <div className="psv-card">
        <div className="psv-card-head">
          <div className="psv-card-title">Venues</div>
          <div className="psv-muted">
            {rows.filter((r) => r.selected).length} of {rows.length} picked
          </div>
        </div>
        {rows.length ? (
          rows.map((r) => (
            <div className="psv-row" key={r.venueId}>
              <input
                type="checkbox"
                className="psv-check"
                checked={r.selected}
                disabled={preview}
                aria-label={`Include ${r.label}`}
                onChange={(e) => updateRow(r.venueId, { selected: e.target.checked })}
              />
              <div style={{ minWidth: 0 }}>
                <div className="psv-venue-label">{r.label}</div>
                <div className="psv-venue-hint">{r.hint}</div>
              </div>
              <input
                inputMode="numeric"
                className="psv-count"
                aria-label={`${countLabel} — ${r.label}`}
                placeholder={countLabel}
                value={r.text}
                disabled={preview || !r.selected}
                onChange={(e) => {
                  const t = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                  updateRow(r.venueId, { text: t });
                }}
              />
            </div>
          ))
        ) : (
          <div className="psv-empty">No venues on file yet — mention your venue in a quote request and we&rsquo;ll add it.</div>
        )}
      </div>

      <div className="psv-card">
        <div className="psv-sum">
          {view ? (
            <>
              {view.lines.map((l, i) => (
                <div className="psv-line" key={i}>
                  <span>{l.label}</span>
                  <span>{money(l.amount)}</span>
                </div>
              ))}
              <div className="psv-line">
                <span>Travel</span>
                <span>{money(view.travel)}</span>
              </div>
              <div className="psv-total">
                <span>Total</span>
                <span>{money(view.total)}</span>
              </div>
            </>
          ) : (
            <div className="psv-empty" style={{ padding: "6px 0 2px" }}>
              {preview ? PREVIEW_PRICE_HINT : error || "Tick at least one venue to see pricing."}
            </div>
          )}
          <div className="psv-fine">
            {REVIEW_LINE} {TAX_LINE}
          </div>
        </div>
        {genError && (
          <div className="psv-err" role="alert">
            {genError}
          </div>
        )}
        <div className="psv-go">
          {blocked && <span className="psv-go-why">{blocked}</span>}
          <button type="button" className="psv-btn" disabled={!!blocked || busy} onClick={generate}>
            {generating ? "Generating…" : "Generate quote"}
          </button>
        </div>
      </div>
    </>
  );
}
