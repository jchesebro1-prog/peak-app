"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { priceRental } from "@/lib/pricing/rental";
import { saveRentalQuote, approveRentalQuote, checkRentalAvailabilityAction } from "./actions";

/**
 * QuoteBuilder — the rental quote builder (rental twin of the repair
 * QuoteBuilder at repairs/quote/controls.tsx, the structural mirror). Holds
 * the ephemeral builder state (customer, date range, gear lines) and
 * previews pricing live with `priceRental()` — the same pure module
 * actions.ts imports server-side, so the live preview and the saved value
 * always agree without duplicating the formula.
 *
 * The gear picker is category/manufacturer/search filterable (the design
 * spec's whole point — replacing "this massive fucking dropdown"), and
 * adding an item never auto-fills a line's qty/location: per the design
 * spec, a human reviews and sets every line by hand.
 */

/* ---------- serializable props from the server page ---------- */

export type BuilderContact = { name: string; role: string; email: string; primary: boolean };
export type BuilderCustomer = { id: string; name: string; contacts: BuilderContact[] };
export type BuilderLocation = { id: string; name: string };
export type BuilderItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  dayRate: number;
  weekRate: number;
  monthRate: number;
};
export type BuilderOption = { key: string; label: string };
export type BuilderLineInit = { itemId: string; locationId: string; qty: string };
export type BuilderInitial = {
  editingId: string | null;
  customerId: string;
  quoteName: string;
  contactSel: string;
  contactManual: string;
  startDate: string;
  endDate: string;
  lines: BuilderLineInit[];
  saved: boolean;
  approved: boolean;
  savedId: string;
};

type BuilderLineRow = { key: string; itemId: string; locationId: string; qty: string };

/* ---------- date helpers (mirrors schedule/page.tsx's sod()/iso() pair) ---------- */
const DAY = 86400000;
function dateMs(v: string): number {
  const [y, m, d] = String(v || "").split("-").map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getTime();
}

/* ---------- display helpers ---------- */
function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

const LABEL: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 7,
};
const FIELD: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "11px 13px",
  boxSizing: "border-box",
};
const ROWBTN: CSSProperties = {
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  lineHeight: 1,
  color: "#8c919c",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};

const CSS = `
  select.rtq-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 34px !important; }
  @media (max-width: 900px) {
    .rtq-grid { grid-template-columns: 1fr !important; }
    .rtq-side { position: static !important; }
    .rtq-two { grid-template-columns: 1fr !important; }
  }
`;

let keySeq = 0;
function nextLineKey(): string {
  keySeq += 1;
  return "ln-" + keySeq;
}

export function QuoteBuilder({
  customers,
  items,
  locations,
  categories,
  initial,
  me,
  accent,
}: {
  customers: BuilderCustomer[];
  items: BuilderItem[];
  locations: BuilderLocation[];
  categories: BuilderOption[];
  initial: BuilderInitial;
  me: string;
  accent: string;
}) {
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [quoteName, setQuoteName] = useState(initial.quoteName);
  const [contactSel, setContactSel] = useState(initial.contactSel);
  const [contactManual, setContactManual] = useState(initial.contactManual);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [lines, setLines] = useState<BuilderLineRow[]>(() =>
    initial.lines.map((l) => ({ key: nextLineKey(), ...l }))
  );
  const [category, setCategory] = useState("all");
  const [manufacturer, setManufacturer] = useState("all");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<Record<string, number | null>>({});
  const [savedFlag, setSavedFlag] = useState(initial.saved || initial.approved);
  const [pending, startTransition] = useTransition();

  const editingId = initial.editingId;
  const savedId = initial.savedId;
  const isApproved = initial.approved;

  const dirty = () => setSavedFlag(false);

  const customer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );
  const contacts = customer?.contacts || [];
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const manufacturers = useMemo(
    () => Array.from(new Set(items.map((i) => i.manufacturer).filter(Boolean))).sort(),
    [items]
  );

  function pickCustomer(id: string) {
    const c = customers.find((x) => x.id === id) || null;
    const primary = c?.contacts.find((x) => x.primary) || c?.contacts[0] || null;
    setCustomerId(id);
    setQuoteName(c ? c.name + " — Rental" : "");
    setContactSel(primary ? primary.name : "");
    setContactManual("");
    dirty();
  }

  /* ---- date range / day count ---- */
  const startMs = dateMs(startDate);
  const endMs = dateMs(endDate);
  const hasRange = !!startMs && !!endMs && endMs >= startMs;
  const days = hasRange ? Math.round((endMs - startMs) / DAY) + 1 : 0;

  /* ---- lines ---- */
  function addLine(item: BuilderItem) {
    const key = nextLineKey();
    setLines((prev) => [...prev, { key, itemId: item.id, locationId: locations[0]?.id || "", qty: "1" }]);
    dirty();
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setAvailability((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    dirty();
  }
  function setLineQty(key: string, qty: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty } : l)));
    dirty();
  }
  function setLineLocation(key: string, locationId: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, locationId } : l)));
    dirty();
  }

  /* ---- availability warnings — re-checked whenever the date range or any
     line's item/location changes. Never blocks adding/saving a line, per the
     design spec's "let staff override with judgment" philosophy. ---- */
  const lineSig = lines.map((l) => l.key + ":" + l.itemId + ":" + l.locationId).join("|");
  useEffect(() => {
    if (!hasRange) return;
    let cancelled = false;
    const checkable = lines.filter((l) => l.itemId && l.locationId);
    if (!checkable.length) return;
    (async () => {
      const entries = await Promise.all(
        checkable.map(async (l) => {
          const avail = await checkRentalAvailabilityAction(l.itemId, l.locationId, startMs, endMs);
          return [l.key, avail] as const;
        })
      );
      if (cancelled) return;
      setAvailability((prev) => {
        const next = { ...prev };
        entries.forEach(([k, v]) => {
          next[k] = v;
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRange, startMs, endMs, lineSig]);

  /* ---- picker filtering ---- */
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (category === "all" ? true : i.category === category))
      .filter((i) => (manufacturer === "all" ? true : i.manufacturer === manufacturer))
      .filter((i) => {
        if (!q) return true;
        return (
          i.name.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q) ||
          (i.manufacturer || "").toLowerCase().includes(q)
        );
      })
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, category, manufacturer, search]);

  /* ---- live pricing ---- */
  function priceOf(l: BuilderLineRow): { rate: number; qty: number; total: number } {
    const item = itemById.get(l.itemId);
    const qty = Math.max(1, Math.round(Number(l.qty) || 0));
    if (!item || !hasRange) return { rate: 0, qty, total: 0 };
    const rate = priceRental(days, { dayRate: item.dayRate, weekRate: item.weekRate, monthRate: item.monthRate });
    return { rate, qty, total: rate * qty };
  }
  const priced = lines.map((l) => ({ line: l, item: itemById.get(l.itemId) || null, ...priceOf(l) }));
  const total = priced.reduce((sum, p) => sum + p.total, 0);

  const hasCustomer = !!customer;
  const validLines = lines.filter((l) => l.itemId && l.locationId);
  const canSave = hasCustomer && hasRange && validLines.length > 0;
  const showApprove = canSave && !isApproved;

  /* ---- selected contact ---- */
  function selectedContact(): { name: string; role: string; email: string } | null {
    if (contactSel === "__other__") {
      const n = contactManual.trim();
      return n ? { name: n, role: "", email: "" } : null;
    }
    if (!contactSel) return null;
    const c = contacts.find((x) => x.name === contactSel);
    return c ? { name: c.name, role: c.role || "", email: c.email || "" } : { name: contactSel, role: "", email: "" };
  }
  const contactMeta = selectedContact()?.email || "";

  /* ---- submit ---- */
  function buildForm(): FormData {
    const fd = new FormData();
    fd.set("editingId", editingId || "");
    fd.set("customerId", customerId);
    fd.set("quoteName", quoteName);
    const c = selectedContact();
    fd.set("contactName", c?.name || "");
    fd.set("contactRole", c?.role || "");
    fd.set("contactEmail", c?.email || "");
    fd.set("startDate", startDate);
    fd.set("endDate", endDate);
    fd.set(
      "lines",
      JSON.stringify(
        validLines.map((l) => ({
          itemId: l.itemId,
          locationId: l.locationId,
          qty: Math.max(1, Math.round(Number(l.qty) || 0)),
        }))
      )
    );
    return fd;
  }
  function doSave() {
    if (!canSave || pending) return;
    startTransition(() => saveRentalQuote(buildForm()));
  }
  function doApprove() {
    if (!canSave || pending) return;
    startTransition(() => approveRentalQuote(buildForm()));
  }

  return (
    <div className="pk-content" style={{ fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{CSS}</style>

      <Link
        href="/rentals"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#8c919c",
          textDecoration: "none",
          marginBottom: 14,
        }}
      >
        ← Rentals
      </Link>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Rental quote</div>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                color: "#b4543a",
                background: "#f7e9e5",
                border: "1px solid #f0d6cd",
                padding: "3px 8px",
                borderRadius: 5,
              }}
            >
              Auto-priced
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            Cheapest of day/week/month billing per line, live availability shown as you add gear.
          </div>
        </div>
      </div>

      <div
        className="rtq-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 358px",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ===== MAIN ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              padding: "18px 20px",
              display: "grid",
              gap: 14,
            }}
          >
            <div>
              <label style={LABEL}>Customer</label>
              <select
                className="rtq-sel"
                value={customerId}
                onChange={(e) => pickCustomer(e.target.value)}
                style={{ ...FIELD, fontWeight: 600, cursor: "pointer" }}
              >
                <option value="">Select a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={LABEL}>Quote name</label>
              <input
                value={quoteName}
                onChange={(e) => {
                  setQuoteName(e.target.value);
                  dirty();
                }}
                placeholder="e.g. Lakefront PAC — Fall concert rental"
                style={FIELD}
              />
            </div>
            <div className="rtq-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={LABEL}>Load-out date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    dirty();
                  }}
                  style={{ ...FIELD, fontFamily: "var(--font-mono)" }}
                />
              </div>
              <div>
                <label style={LABEL}>Return date</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    dirty();
                  }}
                  style={{ ...FIELD, fontFamily: "var(--font-mono)" }}
                />
              </div>
            </div>
            {startDate && endDate && !hasRange && (
              <div style={{ fontSize: 11.5, color: "#b4543a" }}>Return date can&apos;t be before the load-out date.</div>
            )}
            {hasRange && (
              <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                {days} day{days === 1 ? "" : "s"} — billed at whichever of day/week/month is cheapest, per line.
              </div>
            )}
            <div>
              <label style={LABEL}>
                Contact{" "}
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "#c0c5cd" }}>
                  · who signs for the gear
                </span>
              </label>
              <select
                className="rtq-sel"
                value={contactSel}
                onChange={(e) => {
                  setContactSel(e.target.value);
                  dirty();
                }}
                style={{ ...FIELD, cursor: "pointer" }}
              >
                <option value="">No contact — TBD</option>
                {contacts.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name + (c.role ? " — " + c.role : "")}
                  </option>
                ))}
                <option value="__other__">Other — enter name…</option>
              </select>
              {contactSel === "__other__" && (
                <input
                  value={contactManual}
                  onChange={(e) => {
                    setContactManual(e.target.value);
                    dirty();
                  }}
                  placeholder="Contact name"
                  style={{ ...FIELD, marginTop: 9 }}
                />
              )}
              {contactMeta && <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 6 }}>{contactMeta}</div>}
            </div>
          </div>

          {hasCustomer ? (
            <>
              {/* ===== GEAR PICKER ===== */}
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #ececf0",
                  borderRadius: 13,
                  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "15px 20px 12px" }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 12 }}>Add gear</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 9 }}>
                    <select
                      className="rtq-sel"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      style={{ ...FIELD, fontSize: 12.5, padding: "9px 11px", cursor: "pointer" }}
                    >
                      <option value="all">All categories</option>
                      {categories.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rtq-sel"
                      value={manufacturer}
                      onChange={(e) => setManufacturer(e.target.value)}
                      style={{ ...FIELD, fontSize: 12.5, padding: "9px 11px", cursor: "pointer" }}
                    >
                      <option value="all">All manufacturers</option>
                      {manufacturers.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name or SKU…"
                      style={{ ...FIELD, fontSize: 12.5, padding: "9px 11px" }}
                    />
                  </div>
                </div>
                <div style={{ maxHeight: 280, overflowY: "auto", borderTop: "1px solid #f3f4f7" }}>
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) auto auto",
                        gap: 12,
                        alignItems: "center",
                        padding: "10px 20px",
                        borderBottom: "1px solid #f3f4f7",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.name}
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                          {item.sku}
                          {item.manufacturer ? " · " + item.manufacturer : ""}
                        </div>
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#8c919c", textAlign: "right", whiteSpace: "nowrap" }}>
                        {money(item.dayRate)}/day · {money(item.weekRate)}/wk
                      </div>
                      <button
                        type="button"
                        onClick={() => addLine(item)}
                        style={{
                          fontFamily: "var(--font-ui)",
                          fontSize: 12,
                          fontWeight: 600,
                          color: accent,
                          background: "#fff",
                          border: "1px solid #e4e7ec",
                          borderRadius: 7,
                          padding: "6px 11px",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                  {filteredItems.length === 0 && (
                    <div style={{ padding: "28px 20px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                      No gear matches this filter.
                    </div>
                  )}
                </div>
              </div>

              {/* ===== LINES ===== */}
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #ececf0",
                  borderRadius: 13,
                  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                  padding: "18px 20px",
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>Rental lines</div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>{lines.length} line{lines.length === 1 ? "" : "s"}</div>
                </div>
                {!hasRange && (
                  <div style={{ fontSize: 11.5, color: "#b4543a" }}>Set a load-out and return date to price these lines.</div>
                )}
                {priced.map(({ line, item, rate, qty, total: lineTotal }) => {
                  const avail = availability[line.key];
                  const short = avail != null && avail < qty;
                  return (
                    <div
                      key={line.key}
                      style={{ border: "1px solid #f0f1f4", borderRadius: 10, padding: "12px 13px", display: "grid", gap: 9 }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{item?.name || "Unknown item"}</div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>{item?.sku}</div>
                        </div>
                        <button type="button" onClick={() => removeLine(line.key)} title="Remove this line" style={ROWBTN}>
                          ×
                        </button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 9, alignItems: "center" }}>
                        <select
                          className="rtq-sel"
                          value={line.locationId}
                          onChange={(e) => setLineLocation(line.key, e.target.value)}
                          style={{ ...FIELD, fontSize: 12.5, padding: "8px 10px", cursor: "pointer" }}
                        >
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          step="1"
                          value={line.qty}
                          onChange={(e) => setLineQty(line.key, e.target.value)}
                          style={{ ...FIELD, fontFamily: "var(--font-mono)", textAlign: "center", padding: "8px 8px" }}
                        />
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right", minWidth: 72 }}>
                          {money(lineTotal)}
                        </div>
                      </div>
                      {hasRange && item && (
                        <div style={{ fontSize: 10.5, color: "#aab0bb" }}>
                          {money(rate)}/unit for {days} day{days === 1 ? "" : "s"} × {qty}
                        </div>
                      )}
                      {avail != null && (
                        <div style={{ fontSize: 11, color: short ? "#b4543a" : "#3a8a5c", fontWeight: short ? 600 : 500 }}>
                          {short
                            ? "⚠ Only " + avail + " available at " + (locationById.get(line.locationId)?.name || "this location") + " for these dates — requesting " + qty + "."
                            : avail + " available at " + (locationById.get(line.locationId)?.name || "this location") + " for these dates."}
                        </div>
                      )}
                    </div>
                  );
                })}
                {lines.length === 0 && (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                    No gear added yet — use the picker above.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                background: "#fff",
                border: "1px dashed #d9dce2",
                borderRadius: 13,
                padding: "40px 20px",
                textAlign: "center",
                color: "#9aa0ab",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Pick a customer to start adding gear.
            </div>
          )}
        </div>

        {/* ===== TOTAL SIDEBAR ===== */}
        <div className="rtq-side" style={{ position: "sticky", top: 16 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 3px rgba(0,0,0,.06)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 14px", background: "#16181d", color: "#fff" }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "#9aa0ab",
                }}
              >
                Quote total
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 600, letterSpacing: "-.01em", marginTop: 4 }}>
                {money(total)}
              </div>
              <div style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 3 }}>
                {lines.length} line{lines.length === 1 ? "" : "s"} · {hasRange ? days + " day" + (days === 1 ? "" : "s") : "no dates set"}
              </div>
            </div>

            <div style={{ padding: "15px 18px" }}>
              {priced
                .filter((p) => p.total > 0)
                .map((p) => (
                  <div
                    key={p.line.key}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, marginBottom: 7 }}
                  >
                    <span
                      style={{
                        color: "#5b616e",
                        minWidth: 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        paddingRight: 8,
                      }}
                    >
                      {p.item?.name || "Item"} × {p.qty}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flexShrink: 0 }}>{money(p.total)}</span>
                  </div>
                ))}

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  fontSize: 14,
                  fontWeight: 700,
                  marginTop: 13,
                  paddingTop: 12,
                  borderTop: "1px solid #eceef1",
                }}
              >
                <span>Total</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{money(total)}</span>
              </div>

              <button
                type="button"
                onClick={doSave}
                disabled={!canSave || pending}
                style={{
                  marginTop: 14,
                  width: "100%",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: 12,
                  cursor: canSave && !pending ? "pointer" : "not-allowed",
                  background: canSave ? accent : "#c8ccd3",
                  boxSizing: "border-box",
                }}
              >
                {savedFlag ? "Saved ✓" : editingId ? "Update quote" : "Save quote"}
              </button>

              {showApprove && (
                <button
                  type="button"
                  onClick={doApprove}
                  disabled={pending}
                  style={{
                    marginTop: 9,
                    width: "100%",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "#1f7a52",
                    background: "#eaf6ef",
                    border: "1px solid #cce9da",
                    borderRadius: 10,
                    padding: 11,
                    cursor: pending ? "not-allowed" : "pointer",
                    boxSizing: "border-box",
                  }}
                >
                  Mark as approved
                </button>
              )}

              {isApproved && (
                <div
                  style={{
                    marginTop: 9,
                    border: "1px solid #cce9da",
                    background: "#eaf6ef",
                    borderRadius: 10,
                    padding: "12px 13px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#1f7a52" }}>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "#1f7a52",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                    Approved
                  </div>
                  <div style={{ fontSize: 11.5, color: "#3a6650", marginTop: 6, lineHeight: 1.5 }}>
                    Accepted — bookings are confirmed and stock is reserved.
                  </div>
                  <Link
                    href="/rentals"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      marginTop: 9,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#1f7a52",
                      textDecoration: "none",
                    }}
                  >
                    View rental inventory →
                  </Link>
                </div>
              )}

              {savedFlag && savedId && (
                <div style={{ marginTop: 10, textAlign: "center", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>
                  Saved {savedId} ·{" "}
                  <Link href="/quotes" style={{ color: "#8c919c" }}>
                    Back to Quotes
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
