"use client";

import { useEffect, useRef, useState } from "react";
import { FIXTURE_UNAVAILABLE_COPY, type PartDetailFixture } from "@/lib/portal-part-view";
import { priceFixtureOptions } from "./actions";
import { AddedNote, clampQty, money, PreviewHint, QtyStepper, useAddToQuote } from "./panel-ui";

/**
 * The fixture configurator (#245 Task 11, spec §8.3): the light engine, lens
 * and included parts are fixed; each optional add-on is a toggle with its
 * own qty (qty > 0 = on). The total is re-priced ON THE SERVER on every
 * change (debounced) through the same path the cart uses — the browser
 * never computes it.
 */
export function FixtureConfig({
  fx,
  previewCid,
  added,
  onAdded,
}: {
  fx: PartDetailFixture;
  previewCid: string;
  added: number | null;
  onAdded: (count: number) => void;
}) {
  const preview = !!previewCid;
  const [options, setOptions] = useState<Record<string, number>>({});
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState({ unitPrice: fx.unitPrice, por: fx.por, unavailable: fx.unavailable });
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [touched, setTouched] = useState(false);
  const seq = useRef(0);
  const add = useAddToQuote(onAdded);

  // The first paint carries the server's no-add-on price; re-price only
  // after the customer changes an add-on.
  useEffect(() => {
    if (!touched) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await priceFixtureOptions(fx.id, options, previewCid || undefined);
        if (my !== seq.current) return;
        if (r.ok) {
          setPrice({ unitPrice: r.unitPrice, por: r.por, unavailable: r.unavailable });
          setPriceError("");
        } else setPriceError(r.error);
      } catch {
        if (my === seq.current) setPriceError("Couldn't update the price — check your connection.");
      } finally {
        if (my === seq.current) setPricing(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [options, touched, fx.id, previewCid]);

  const setOpt = (key: string, n: number) => {
    setTouched(true);
    setPricing(true);
    setOptions((o) => {
      const next = { ...o };
      if (n > 0) next[key] = clampQty(n);
      else delete next[key];
      return next;
    });
  };

  const busy = pricing || add.pending;
  const canAdd = !preview && !price.unavailable && !busy;

  return (
    <>
      <section>
        <div className="ps-sec-title">Included</div>
        <div className="ps-list">
          {fx.fixed.map((l) => (
            <div key={l.sku + l.label} className="ps-row">
              <div className="ps-row-main">
                <div className="ps-row-title">{l.label}</div>
                <div className="ps-row-sub">{l.sku}</div>
              </div>
              <span className="ps-inc-qty">×{l.qty}</span>
            </div>
          ))}
        </div>
      </section>

      {fx.addOns.length > 0 && (
        <section>
          <div className="ps-sec-title">Add-ons</div>
          <div className="ps-list">
            {fx.addOns.map((a) => {
              const n = options[a.key] ?? 0;
              const id = "ps-opt-" + a.key.replace(/[^a-zA-Z0-9_-]/g, "_");
              return (
                <div key={a.key} className="ps-toggle">
                  <input id={id} type="checkbox" checked={n > 0} onChange={(e) => setOpt(a.key, e.target.checked ? 1 : 0)} />
                  <label htmlFor={id} className="ps-row-main" style={{ cursor: "pointer" }}>
                    <div className="ps-row-title">{a.label}</div>
                    <div className="ps-row-sub">
                      {a.sku}
                      {" · "}
                      {a.unitPrice != null ? "+" + money(a.unitPrice) + " each" : "Price on request"}
                    </div>
                  </label>
                  {n > 0 && <QtyStepper value={n} onChange={(v) => setOpt(a.key, v)} label={`${a.label} quantity`} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="ps-buy">
        {price.unavailable ? (
          <div className="ps-por-sub" style={{ fontSize: 13, color: "#16181d" }}>
            {FIXTURE_UNAVAILABLE_COPY}
          </div>
        ) : (
          <div style={{ opacity: pricing ? 0.5 : 1, transition: "opacity .15s" }} aria-live="polite">
            {price.unitPrice != null ? (
              <div className="ps-price">
                {money(price.unitPrice)}
                <small>each, as configured</small>
              </div>
            ) : (
              <>
                <div className="ps-por">Price on request</div>
                <div className="ps-por-sub">A part in this configuration needs a price from us — we&rsquo;ll confirm it on your quote.</div>
              </>
            )}
          </div>
        )}
        {priceError && <div className="ps-err">{priceError}</div>}
        <div className="ps-buy-row">
          <QtyStepper value={qty} onChange={setQty} disabled={preview || price.unavailable} />
          <button
            type="button"
            className="ps-add"
            disabled={!canAdd}
            onClick={() => add.run({ kind: "fixture", fixtureId: fx.id, options, qty })}
          >
            {add.pending ? "Adding…" : pricing ? "Updating price…" : "Add to quote"}
          </button>
        </div>
        {preview && <PreviewHint />}
        {add.error && <div className="ps-err">{add.error}</div>}
        {added != null && <AddedNote count={added} />}
        <div className="ps-fine">All quotes are subject to Peak review and approval.</div>
      </div>
    </>
  );
}
