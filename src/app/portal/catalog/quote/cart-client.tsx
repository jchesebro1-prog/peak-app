"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { CustomerQuoteView, SellLine } from "@/lib/portal-pricing";
import { cartReviewReasonLine } from "@/lib/portal-quote-mode";
import { generateQuote, removeCartLine, setCartVenue, updateCartLine } from "../actions";
import { PANEL_CSS } from "../panel-css";
import { money, QtyStepper } from "../panel-ui";

/**
 * The portal cart (#245 Task 12, spec §3.4). Everything shown is the server's
 * sell-only view (`CustomerQuoteView`); every edit is a server action followed
 * by a refresh, so the numbers on screen are always the server's. Freight
 * reads as an amount + the venue's miles — never a %.
 */

export type CartVenue = { id: string; label: string };

const REVIEW_LINE = "All quotes are subject to Peak review and approval.";
const TAX_LINE = "Plus applicable sales tax.";

const CSS = `
  .pq-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .pq-title { font-size: 22px; font-weight: 600; letter-spacing: -.015em; }
  .pq-sub { font-size: 13px; color: #5b616e; margin-top: 4px; }
  .pq-card { background: #fff; border: 1px solid #e4e7ec; border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 18px; overflow: hidden; }
  .pq-card-head { padding: 14px 20px 11px; border-bottom: 1px solid #f0f1f4; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .pq-card-title { font-size: 14.5px; font-weight: 600; }
  .pq-muted { font-size: 11.5px; color: #9aa0ab; }
  .pq-venue { padding: 14px 20px 16px; display: flex; flex-direction: column; gap: 6px; }
  .pq-venue label { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8c919c; }
  .pq-venue select { font: 500 14px var(--font-ui); color: #16181d; padding: 10px 12px; border: 1px solid #d6d9e0; border-radius: 9px; background: #fff; max-width: 480px; }
  .pq-venue-need { font-size: 12px; color: #a0522d; font-weight: 600; }
  .pq-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 16px; padding: 14px 20px; border-bottom: 1px solid #f5f6f8; align-items: center; }
  .pq-line:last-child { border-bottom: none; }
  .pq-line-title { font-size: 13.5px; font-weight: 600; line-height: 1.35; }
  .pq-line-sku { font-family: var(--font-mono); font-size: 10.5px; color: #aab0bb; margin-top: 2px; }
  .pq-line-detail { font-size: 12px; color: #5b616e; margin-top: 4px; line-height: 1.45; }
  .pq-line-unit { font-size: 12px; color: #5b616e; margin-top: 4px; }
  .pq-por { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #8a6d1f; background: #fbf3dd; border: 1px solid #f0e2bd; border-radius: 5px; padding: 2px 7px; }
  .pq-confirm { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #3155a8; background: #e9eefb; border: 1px solid #d4ddf3; border-radius: 5px; padding: 2px 7px; margin-left: 6px; }
  .pq-gone { color: #9aa0ab; }
  .pq-gone .pq-line-title { color: #8c919c; }
  .pq-right { display: flex; align-items: center; gap: 12px; justify-content: flex-end; }
  .pq-right .ps-qty { height: 36px; }
  .pq-right .ps-qty button { width: 32px; font-size: 16px; }
  .pq-right .ps-qty input { width: 52px; font-size: 13px; }
  .pq-ext { font-family: var(--font-mono); font-size: 13.5px; font-weight: 600; min-width: 92px; text-align: right; }
  .pq-x { border: none; background: transparent; color: #9aa0ab; font-size: 18px; line-height: 1; cursor: pointer; padding: 6px 8px; border-radius: 6px; }
  .pq-x:hover:not(:disabled) { color: #16181d; background: #f1f2f5; }
  .pq-x:disabled { cursor: default; opacity: .5; }
  .pq-empty { padding: 34px 20px; text-align: center; font-size: 13.5px; color: #5b616e; }
  .pq-sum { padding: 16px 20px 18px; display: flex; flex-direction: column; gap: 8px; }
  .pq-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #5b616e; }
  .pq-row span:last-child { font-family: var(--font-mono); color: #16181d; }
  .pq-total { display: flex; justify-content: space-between; gap: 12px; align-items: center; background: var(--accent); color: #fff; border-radius: 8px; padding: 12px 14px; margin-top: 4px; }
  .pq-total span:first-child { font-size: 13.5px; font-weight: 700; }
  .pq-total span:last-child { font-family: var(--font-mono); font-size: 17px; font-weight: 600; }
  .pq-mode { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
  .pq-badge { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; border-radius: 6px; padding: 3px 9px; border: 1px solid; }
  .pq-firm { color: #1f7a52; background: #eaf6ef; border-color: #cce9da; }
  .pq-review { color: #8a6d1f; background: #fbf3dd; border-color: #f0e2bd; }
  .pq-reason { font-size: 12.5px; color: #5b616e; }
  .pq-fine { font-size: 11.5px; color: #8c919c; line-height: 1.55; }
  .pq-go { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: flex-end; padding: 0 20px 18px; }
  .pq-go-why { font-size: 12.5px; color: #8c919c; }
  .pq-btn { font: 600 14px var(--font-ui); color: #fff; background: var(--accent); border: none; border-radius: 10px; padding: 12px 20px; cursor: pointer; }
  .pq-btn:disabled { opacity: .45; cursor: not-allowed; }
  .pq-err { margin: 0 20px 14px; padding: 10px 12px; font-size: 12.5px; font-weight: 600; color: #a33a2b; background: #fdf0ee; border: 1px solid #f3d2cc; border-radius: 8px; }
  .pq-link { font-size: 13px; font-weight: 600; color: var(--accent); text-decoration: none; }
  @media (max-width: 640px) {
    .pq-line { grid-template-columns: minmax(0, 1fr); }
    .pq-right { justify-content: space-between; }
  }
`;

function unitLabel(l: SellLine): string {
  if (l.unitPrice == null) return "";
  return `${money(l.unitPrice)} ${l.unit && l.unit !== "ea" ? "/ " + l.unit : "each"}`;
}

function CartLineRow({
  line,
  readOnly,
  busy,
  onQty,
  onRemove,
}: {
  line: SellLine;
  readOnly: boolean;
  busy: boolean;
  onQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
}) {
  const [qty, setQty] = useState(line.qty);
  const [seen, setSeen] = useState(line.qty);
  if (seen !== line.qty) {
    setSeen(line.qty);
    setQty(line.qty);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const change = (n: number) => {
    setQty(n);
    if (timer.current) clearTimeout(timer.current);
    // Typed quantities settle for 400 ms before the server re-prices.
    timer.current = setTimeout(() => onQty(line.lineId, n), 400);
  };

  if (line.unavailable) {
    return (
      <div className="pq-line pq-gone">
        <div>
          <div className="pq-line-title">No longer available</div>
          {line.sku && <div className="pq-line-sku">{line.sku}</div>}
          <div className="pq-line-detail">Left out when you generate — remove it or ask us for an alternative.</div>
        </div>
        <div className="pq-right">
          {!readOnly && (
            <button type="button" className="pq-x" aria-label="Remove" title="Remove" disabled={busy} onClick={() => onRemove(line.lineId)}>
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  const ext = line.unitPrice == null ? null : Math.round(line.unitPrice * qty * 100) / 100;
  return (
    <div className="pq-line">
      <div style={{ minWidth: 0 }}>
        <div className="pq-line-title">{line.title}</div>
        {line.sku && line.kind !== "curtain" && <div className="pq-line-sku">{line.sku}</div>}
        {line.detail && <div className="pq-line-detail">{line.detail}</div>}
        <div className="pq-line-unit">
          {line.por ? <span className="pq-por">Price on request</span> : unitLabel(line)}
          {line.kind === "curtain" && <span className="pq-confirm">Confirmed by Peak</span>}
        </div>
      </div>
      <div className="pq-right">
        <QtyStepper value={qty} onChange={change} disabled={readOnly || busy} label={`Quantity — ${line.title}`} />
        <div className="pq-ext">{ext == null ? "—" : money(ext)}</div>
        {!readOnly && (
          <button type="button" className="pq-x" aria-label={`Remove ${line.title}`} title="Remove" disabled={busy} onClick={() => onRemove(line.lineId)}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function CartClient({
  view,
  venues,
  locationId,
  readOnly,
  blocked,
  catalogHref,
}: {
  view: CustomerQuoteView;
  venues: CartVenue[];
  locationId: string;
  readOnly: boolean;
  blocked: string | null;
  catalogHref: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [generating, startGenerate] = useTransition();
  const [error, setError] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) setError(r.error || "Couldn't update your quote — try again.");
      } catch {
        setError("Couldn't update your quote — check your connection and try again.");
      }
      router.refresh();
    });
  };

  const generate = () => {
    setError("");
    startGenerate(async () => {
      try {
        // Success redirects to /portal; only a refusal comes back.
        const r = await generateQuote();
        if (r && !r.ok) {
          setError(r.error);
          router.refresh();
        }
      } catch (e) {
        // A redirect surfaces here as a thrown navigation signal — let it through.
        if (e && typeof e === "object" && "digest" in e && String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
        setError("Couldn't generate your quote — check your connection and try again.");
      }
    });
  };

  const live = view.lines.filter((l) => !l.unavailable);
  const hasPor = live.some((l) => l.por);
  const busy = pending || generating;

  return (
    <>
      <style>{PANEL_CSS + CSS}</style>
      <div className="pq-head">
        <div>
          <div className="pq-title">Your quote</div>
          <div className="pq-sub">Prices are yours, worked out by our system as you go. Generate when it looks right.</div>
        </div>
        <Link href={catalogHref} className="pq-link">
          ← Keep shopping
        </Link>
      </div>

      <div className="pq-card">
        <div className="pq-venue">
          <label htmlFor="pq-venue">Venue</label>
          {venues.length ? (
            <select
              id="pq-venue"
              value={locationId}
              disabled={readOnly || busy}
              onChange={(e) => {
                const v = e.target.value;
                run(() => setCartVenue(v));
              }}
            >
              <option value="">Choose the venue this is for…</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="pq-venue-need">We don&rsquo;t have a venue on file for you yet — ask us to add one.</div>
          )}
          {!locationId && venues.length > 0 && <div className="pq-muted">The venue sets freight &amp; delivery.</div>}
        </div>
      </div>

      <div className="pq-card">
        <div className="pq-card-head">
          <div className="pq-card-title">Items</div>
          <div className="pq-muted">
            {view.lines.length} {view.lines.length === 1 ? "line" : "lines"}
          </div>
        </div>
        {view.lines.length ? (
          view.lines.map((l) => (
            <CartLineRow
              key={l.lineId}
              line={l}
              readOnly={readOnly}
              busy={busy}
              onQty={(lineId, qty) => run(() => updateCartLine(lineId, qty))}
              onRemove={(lineId) => run(() => removeCartLine(lineId))}
            />
          ))
        ) : (
          <div className="pq-empty">
            Your quote is empty.{" "}
            <Link href={catalogHref} className="pq-link">
              Browse the catalog
            </Link>
          </div>
        )}
      </div>

      <div className="pq-card">
        <div className="pq-sum">
          <div className="pq-row">
            <span>Subtotal</span>
            <span>{money(view.subtotal)}</span>
          </div>
          <div className="pq-row">
            <span>{view.freight.miles != null ? `Freight & delivery — ${Math.round(view.freight.miles).toLocaleString("en-US")} mi` : "Freight & delivery"}</span>
            <span>{locationId ? money(view.freight.amount) : "Pick a venue"}</span>
          </div>
          <div className="pq-total">
            <span>{hasPor ? "Total (excludes items pending price)" : "Total"}</span>
            <span>{locationId ? money(view.total) : "—"}</span>
          </div>
          {live.length > 0 && (
            <div className="pq-mode">
              {view.mode === "firm" ? <span className="pq-badge pq-firm">Firm quote</span> : <span className="pq-badge pq-review">Needs Peak review</span>}
              <span className="pq-reason">{view.mode === "firm" ? "Every line is priced — your quote is ready the moment you generate it." : cartReviewReasonLine(view.reason)}</span>
            </div>
          )}
          <div className="pq-fine">
            {REVIEW_LINE} {TAX_LINE}
          </div>
        </div>
        {error && (
          <div className="pq-err" role="alert">
            {error}
          </div>
        )}
        <div className="pq-go">
          {blocked && <span className="pq-go-why">{blocked}</span>}
          <button type="button" className="pq-btn" disabled={!!blocked || busy} onClick={generate}>
            {generating ? "Generating…" : "Generate quote"}
          </button>
        </div>
      </div>
    </>
  );
}
