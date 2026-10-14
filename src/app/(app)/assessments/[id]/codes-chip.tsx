"use client";

/* The short codes behind printed finding ids (#337 spec §3 Printed IDs, Task 8): "MPSD · LIN" on the editor header,
   or "No codes yet — will be suggested on first finding". Anyone with `create` edits a code until a live finding
   carries it; after that changing it needs `approve` (issued ids keep their text either way). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CODE_RE } from "@/lib/assessments/codes";
import { setShortCodesAction } from "./actions";

export interface CodesChipProps {
  codes: { companyId: string; siteId: string; company: string | null; site: string | null; companyLocked: boolean; siteLocked: boolean };
  canEdit: boolean;
  canApprove: boolean;
}

export default function CodesChip({ codes, canEdit, canApprove }: CodesChipProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(codes.company ?? "");
  const [site, setSite] = useState(codes.site ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyEditable = canEdit && (!codes.companyLocked || canApprove);
  const siteEditable = canEdit && (!codes.siteLocked || canApprove);
  const none = !codes.company && !codes.site;
  const norm = (s: string) => s.trim().toUpperCase();
  const bad = (s: string, cur: string | null) => norm(s) !== (cur ?? "") && !CODE_RE.test(norm(s));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await setShortCodesAction({
        ...(companyEditable && norm(company) !== (codes.company ?? "") ? { companyId: codes.companyId, companyCode: norm(company) } : {}),
        ...(siteEditable && norm(site) !== (codes.site ?? "") ? { siteId: codes.siteId, siteCode: norm(site) } : {}),
      });
      if (!r.ok) setError(r.error);
      else { setOpen(false); router.refresh(); }
    } catch {
      setError("Changing codes needs a connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        title="Short codes printed on finding ids"
        style={{ fontFamily: none ? undefined : "var(--font-mono)", fontSize: 11.5, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", borderRadius: 20, padding: "2px 9px" }}
      >
        {none ? "No codes yet — will be suggested on first finding" : `${codes.company ?? "—"} · ${codes.site ?? "—"}`}
      </span>
      {(companyEditable || siteEditable) && (
        <button type="button" className="as-linkbtn" style={{ fontWeight: 400, fontSize: 12 }} onClick={() => { setCompany(codes.company ?? ""); setSite(codes.site ?? ""); setError(null); setOpen((o) => !o); }}>
          {none ? "Set codes…" : "Change code…"}
        </button>
      )}
      {open && (
        <div className="pk-card" style={{ position: "absolute", top: 26, left: 0, zIndex: 30, padding: 12, width: 280, maxWidth: "calc(100vw - 32px)", boxShadow: "0 8px 24px rgba(0,0,0,.12)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label>
              <div className="pk-field-label">Customer</div>
              <input className="pk-input" maxLength={6} value={company} disabled={!companyEditable || busy} onChange={(e) => setCompany(e.target.value.toUpperCase())} aria-invalid={bad(company, codes.company)} />
            </label>
            <label>
              <div className="pk-field-label">Venue</div>
              <input className="pk-input" maxLength={6} value={site} disabled={!siteEditable || busy} onChange={(e) => setSite(e.target.value.toUpperCase())} aria-invalid={bad(site, codes.site)} />
            </label>
          </div>
          {((codes.companyLocked && !canApprove) || (codes.siteLocked && !canApprove)) && (
            <div className="as-mono-sm" style={{ marginTop: 6 }}>A code already printed on a finding is locked. Changing it needs approval rights.</div>
          )}
          <div className="as-mono-sm" style={{ marginTop: 6 }}>2–6 letters or digits. Issued finding ids keep their old code.</div>
          {error && <div style={{ color: "#8c3b26", fontSize: 12.5, marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="pk-btn-accent" style={{ padding: "6px 12px" }} disabled={busy || bad(company, codes.company) || bad(site, codes.site)} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="pk-btn-outline" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </span>
  );
}
