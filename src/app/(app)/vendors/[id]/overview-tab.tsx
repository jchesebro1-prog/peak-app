"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { ManufacturerEntry, VendorDiscounts, VendorRegistration } from "@/lib/vendor-status";
import { claimManufacturerAction, releaseManufacturerAction, removeVendorProfileAction, saveVendorProfileAction } from "../actions";
import { ConfirmButton } from "@/components/confirm-button";

/**
 * #122 — Overview: discounts + project registration (inline-editable, one
 * Save) and the claimed manufacturers (add = claim, which moves the
 * manufacturer off any other vendor; × = release). Types come from the pure
 * vendor-status module, never the store (client-bundle rule).
 */

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", padding: "16px 18px", marginBottom: 18 };
const H: CSSProperties = { fontSize: 14.5, fontWeight: 600, marginBottom: 12 };
const LBL: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 5 };
const IN: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 11px", outline: "none", background: "#fff", boxSizing: "border-box" };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 11px", cursor: "pointer" };

export default function OverviewTab({
  vendorId,
  discounts,
  registration,
  manufacturers,
  directory,
}: {
  vendorId: string;
  discounts: VendorDiscounts;
  registration: VendorRegistration;
  manufacturers: string[];
  directory: Array<ManufacturerEntry & { vendorName: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const pctText = discounts.percentOffList == null ? "" : String(discounts.percentOffList);
  const [d, setD] = useState({ note: discounts.note, pct: pctText, terms: discounts.terms });
  const [r, setR] = useState<VendorRegistration>({ ...registration });
  const [pick, setPick] = useState("");
  const localDirty = useRef(false);

  // The page refreshes after saves and manufacturer claims. Keep the
  // concurrent-edit protection in the server page, but do not remount this
  // form: a refresh must preserve an in-progress edit and let the Saved chip
  // remain visible. A clean form can still accept a newer server snapshot.
  useEffect(() => {
    if (localDirty.current) return;
    setD({ note: discounts.note, pct: pctText, terms: discounts.terms });
    setR({ ...registration });
    setSaved(false);
  }, [discounts.note, discounts.percentOffList, discounts.terms, registration, pctText]);

  const dirty =
    d.note !== discounts.note || d.terms !== discounts.terms || d.pct !== pctText ||
    r.program !== registration.program || r.url !== registration.url ||
    r.accountNumber !== registration.accountNumber || r.notes !== registration.notes;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      setErr("");
      const res = await fn();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      localDirty.current = false;
      after?.();
      router.refresh();
    });

  const save = () => {
    const pct = d.pct.trim() === "" ? null : Number(d.pct);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setErr("% off list must be between 0 and 100.");
      return;
    }
    run(
      () => saveVendorProfileAction(vendorId, { discounts: { note: d.note, percentOffList: pct, terms: d.terms }, registration: r }),
      () => setSaved(true)
    );
  };

  const claimable = directory.filter((m) => m.vendorId !== vendorId);

  return (
    <>
      <div style={CARD}>
        <div style={H}>Manufacturers claimed</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {manufacturers.map((m) => (
            <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "4px 6px 4px 10px", borderRadius: 20 }}>
              {m}
              <button type="button" title={`Release ${m}`} disabled={pending} onClick={() => run(() => releaseManufacturerAction(vendorId, m))} style={{ border: "none", background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </span>
          ))}
          {manufacturers.length === 0 && <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>No manufacturers claimed yet — the catalog can’t be matched to this vendor until one is.</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ ...IN, width: "auto", minWidth: 240, cursor: "pointer" }}>
            <option value="">Add a catalog manufacturer…</option>
            {claimable.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} · {m.count} part{m.count === 1 ? "" : "s"}{m.vendorName ? ` · claimed by ${m.vendorName}` : ""}
              </option>
            ))}
          </select>
          <button type="button" style={BTN} disabled={pending || !pick} onClick={() => run(() => claimManufacturerAction(vendorId, pick), () => setPick(""))}>
            Claim
          </button>
          <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Claiming a manufacturer another vendor holds moves it here.</span>
        </div>
      </div>

      <div style={CARD}>
        <div style={H}>Discounts</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: 12 }}>
          <div>
            <label style={LBL}>Note</label>
            <input value={d.note} onChange={(e) => { localDirty.current = true; setSaved(false); setD({ ...d, note: e.target.value }); }} placeholder="e.g. dealer program, tiered by annual volume" style={IN} />
          </div>
          <div>
            <label style={LBL}>% off list</label>
            <input value={d.pct} inputMode="decimal" onChange={(e) => { localDirty.current = true; setSaved(false); setD({ ...d, pct: e.target.value }); }} placeholder="e.g. 35" style={{ ...IN, fontFamily: "var(--font-mono)" }} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={LBL}>Terms</label>
          <input value={d.terms} onChange={(e) => { localDirty.current = true; setSaved(false); setD({ ...d, terms: e.target.value }); }} placeholder="e.g. Net 30, freight prepaid over $2,500" style={IN} />
        </div>
      </div>

      <div style={CARD}>
        <div style={H}>Project registration</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
          <div>
            <label style={LBL}>Program</label>
            <input value={r.program} onChange={(e) => { localDirty.current = true; setSaved(false); setR({ ...r, program: e.target.value }); }} placeholder="e.g. Partner project registration" style={IN} />
          </div>
          <div>
            <label style={LBL}>Account #</label>
            <input value={r.accountNumber} onChange={(e) => { localDirty.current = true; setSaved(false); setR({ ...r, accountNumber: e.target.value }); }} style={{ ...IN, fontFamily: "var(--font-mono)" }} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={LBL}>URL</label>
          <input value={r.url} onChange={(e) => { localDirty.current = true; setSaved(false); setR({ ...r, url: e.target.value }); }} placeholder="https://…" style={{ ...IN, fontFamily: "var(--font-mono)" }} />
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={LBL}>Notes</label>
          <textarea value={r.notes} onChange={(e) => { localDirty.current = true; setSaved(false); setR({ ...r, notes: e.target.value }); }} rows={3} placeholder="Who registers, lead time, what it protects" style={{ ...IN, resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <button type="button" className="pk-btn-accent" disabled={pending || !dirty} onClick={save} style={{ opacity: pending || !dirty ? 0.55 : 1 }}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52", fontWeight: 600 }}>Saved</span>}
          {err && <span style={{ fontSize: 12, color: "#b4543a" }}>{err}</span>}
        </div>
      </div>

      <div style={CARD}>
        <div style={H}>Danger zone</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 12 }}>
          Deletes this vendor's manufacturers, price-list ledger, discounts and project
          registration. The company record and its contacts stay.
        </div>
        <ConfirmButton
          className="pk-btn-danger"
          label="Delete vendor profile"
          confirmLabel="Confirm delete"
          onConfirm={async () => {
            const res = await removeVendorProfileAction(vendorId);
            if (!res.ok) throw new Error(res.error);
            router.refresh();
          }}
        />
      </div>
    </>
  );
}
