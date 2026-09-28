"use client";

import { useEffect, useRef, useState } from "react";
import { curtainAreas } from "@/lib/curtain-geom";
import { CURTAIN_FULLNESS } from "@/lib/portal-cart-rules";
import type { CurtainRequest as CurtainInputs } from "@/lib/portal-cart-types";
import { priceCurtainOptions } from "./actions";
import { AddedNote, money, PreviewHint, useAddToQuote } from "./panel-ui";

/**
 * The curtain configurator (#245 Task 11, spec §3.3; priced live #250) — the
 * Estimator curtain configurator's inputs (name, fabric, qty, width, height,
 * fullness). The fabric list is names only; the PRICE is computed on the
 * server (the Estimator's own curtain math, at the customer's tier) through
 * a debounced `priceCurtainOptions` call — the browser never computes it. A
 * curtain line still lands on the quote flagged for Peak to confirm
 * (measurements + fabric), priced or not.
 */

type Draft = Omit<CurtainInputs, "fabricName">;
const EMPTY: Draft = { name: "", fabricSku: "", qty: "1", width: "", height: "", fullness: "50" };

export function CurtainRequestButton({
  fabrics,
  previewCid,
}: {
  fabrics: Array<{ sku: string; name: string }>;
  previewCid: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ps-btn-ghost" onClick={() => setOpen(true)} style={{ height: 38, whiteSpace: "nowrap" }}>
        Request curtain pricing
      </button>
      {open && <CurtainPanel fabrics={fabrics} previewCid={previewCid} preview={!!previewCid} onClose={() => setOpen(false)} />}
    </>
  );
}

function CurtainPanel({
  fabrics,
  previewCid,
  preview,
  onClose,
}: {
  fabrics: Array<{ sku: string; name: string }>;
  previewCid: string;
  preview: boolean;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [added, setAdded] = useState<number | null>(null);
  const add = useAddToQuote(setAdded);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [price, setPrice] = useState<{ unitPrice: number | null; extPrice: number | null } | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState("");
  const priceSeq = useRef(0);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Every field change marks a re-price pending (mirrors FixtureConfig's
  // setOpt — set from the event handler, never synchronously inside the
  // effect below, which only ever sets state from its async callback).
  const set = (k: keyof Draft, v: string) => {
    setPricing(true);
    setD((x) => ({ ...x, [k]: v }));
  };
  const qty = Math.max(1, parseInt(d.qty, 10) || 1);
  const area = curtainAreas({ name: d.name, hang: "", fabric: d.fabricSku, qty: d.qty, width: d.width, height: d.height, fullness: d.fullness, bottom: "" });
  const totalSqft = Math.round(area.fabricArea * qty);
  const ready = !!d.name.trim() && Number(d.width) > 0 && Number(d.height) > 0 && /^\d+$/.test(d.qty.trim()) && Number(d.qty) >= 1;
  // A team preview can fill the form (to see the fabric-area hint); only the
  // submit is disabled.
  const disabled = add.pending;

  // Live price (#250): re-priced ON THE SERVER, debounced, once the draft is
  // ready to submit — the same fields the Add button gates on. Fabric,
  // fullness and qty changes re-fire too; a team preview still prices (only
  // the submit is disabled for it).
  useEffect(() => {
    // Not ready yet — priceLine below reads `ready` first and ignores stale
    // price/error state, so there's nothing to reset here (state updates
    // stay inside the async callback, never synchronous in the effect body).
    if (!ready) return;
    const my = ++priceSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await priceCurtainOptions(
          { name: d.name.trim(), fabricSku: d.fabricSku, qty: d.qty.trim(), width: d.width, height: d.height, fullness: d.fullness },
          previewCid || undefined
        );
        if (my !== priceSeq.current) return;
        if (r.ok) {
          setPrice({ unitPrice: r.unitPrice, extPrice: r.extPrice });
          setPriceError("");
        } else {
          setPrice(null);
          setPriceError(r.error);
        }
      } catch {
        if (my === priceSeq.current) {
          setPrice(null);
          setPriceError("Couldn't update the price — check your connection.");
        }
      } finally {
        if (my === priceSeq.current) setPricing(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [ready, d.name, d.fabricSku, d.qty, d.width, d.height, d.fullness, previewCid]);

  let priceLine: string;
  if (!ready) priceLine = "";
  else if (pricing && !price) priceLine = "Pricing…";
  else if (priceError) priceLine = priceError;
  else if (price && price.unitPrice != null) priceLine = `${money(price.unitPrice)} each · ${money(price.extPrice ?? price.unitPrice * qty)} total`;
  else priceLine = "We'll recommend a fabric and price it.";

  const submit = () => {
    if (!ready || preview || added != null || add.pending) return;
    const fabric = fabrics.find((f) => f.sku === d.fabricSku);
    add.run({
      kind: "curtain",
      curtain: { ...d, name: d.name.trim(), qty: d.qty.trim(), fabricName: fabric?.name ?? "" },
    });
  };

  return (
    <>
      <div className="ps-scrim" onClick={onClose} aria-hidden="true" />
      <div className="ps-modal" role="dialog" aria-modal="true" aria-labelledby="ps-curtain-title">
        <div className="ps-head">
          <div>
            <div className="ps-head-label">Drapery</div>
            <div id="ps-curtain-title" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              Configure a curtain
            </div>
          </div>
          <button ref={closeRef} type="button" className="ps-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          className="ps-body"
          id="ps-curtain-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="ps-hint">Curtains are confirmed by Peak before your quote is final.</div>
          <label className="ps-field">
            <span className="ps-label">Curtain name</span>
            <input className="ps-input" value={d.name} maxLength={80} placeholder="e.g. Main Grand Drape" disabled={disabled} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="ps-field">
            <span className="ps-label">Fabric</span>
            <select className="ps-input" value={d.fabricSku} disabled={disabled} onChange={(e) => set("fabricSku", e.target.value)}>
              <option value="">Not sure — recommend one</option>
              {fabrics.map((f) => (
                <option key={f.sku} value={f.sku}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ps-grid3">
            <label className="ps-field">
              <span className="ps-label">Quantity</span>
              <input className="ps-input" inputMode="numeric" value={d.qty} disabled={disabled} onChange={(e) => set("qty", e.target.value.replace(/[^\d]/g, "").slice(0, 5))} />
            </label>
            <label className="ps-field">
              <span className="ps-label">Width (ft)</span>
              <input className="ps-input" inputMode="decimal" value={d.width} placeholder="0" disabled={disabled} onChange={(e) => set("width", e.target.value.replace(/[^\d.]/g, "").slice(0, 7))} />
            </label>
            <label className="ps-field">
              <span className="ps-label">Height (ft)</span>
              <input className="ps-input" inputMode="decimal" value={d.height} placeholder="0" disabled={disabled} onChange={(e) => set("height", e.target.value.replace(/[^\d.]/g, "").slice(0, 7))} />
            </label>
          </div>
          <div className="ps-field">
            <span className="ps-label">Fullness</span>
            <div className="ps-seg" role="radiogroup" aria-label="Fullness">
              {CURTAIN_FULLNESS.map(([label, v]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={d.fullness === v}
                  className={d.fullness === v ? "ps-seg-on" : ""}
                  disabled={disabled}
                  onClick={() => set("fullness", v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="ps-fine" aria-live="polite" style={{ minHeight: 18 }}>
            {totalSqft > 0
              ? `≈ ${totalSqft.toLocaleString("en-US")} sq ft of fabric${qty > 1 ? ` (${qty} curtains)` : ""}`
              : "Enter the width and height to see the fabric area."}
          </div>
          <div className="ps-fine" aria-live="polite" style={{ minHeight: 18, opacity: pricing ? 0.6 : 1, transition: "opacity .15s" }}>
            {priceLine}
          </div>
          {add.error && <div className="ps-err">{add.error}</div>}
          {added != null && <AddedNote count={added} />}
          {preview && <PreviewHint />}
        </form>
        <div className="ps-foot">
          {added != null ? (
            <>
              <button
                type="button"
                className="ps-btn-ghost"
                onClick={() => {
                  setD(EMPTY);
                  setAdded(null);
                }}
              >
                Add another
              </button>
              <button type="button" className="ps-add" style={{ flex: "none" }} onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <button type="submit" form="ps-curtain-form" className="ps-add" style={{ flex: "none" }} disabled={!ready || disabled || preview}>
              {add.pending ? "Adding…" : "Add to quote"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
