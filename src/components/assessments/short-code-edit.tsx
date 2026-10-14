"use client";

/* The short code behind printed finding ids (#340 Task 11), shown on a venue's / company's Findings card with an
   Edit control. It reuses the editor's setShortCodesAction, so the in-use / approve rule is the server's one: anyone
   with `create` edits a code until a live finding carries it; after that changing it needs `approve`. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CODE_RE } from "@/lib/assessments/codes";
import { setShortCodesAction } from "@/app/(app)/assessments/[id]/actions";

export interface ShortCodeEditProps {
  kind: "company" | "site";
  companyId: string;
  siteId?: string;
  code: string | null;
  /** a live finding carries the code */
  locked: boolean;
  canEdit: boolean;
  canApprove: boolean;
}

export default function ShortCodeEdit({ kind, companyId, siteId, code, locked, canEdit, canApprove }: ShortCodeEditProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(code ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = canEdit && (!locked || canApprove);
  const noun = kind === "company" ? "Customer code" : "Venue code";
  const next = value.trim().toUpperCase();
  const invalid = next !== (code ?? "") && !CODE_RE.test(next);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await setShortCodesAction(kind === "company" ? { companyId, companyCode: next } : { siteId, siteCode: next });
      if (!r.ok) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("Changing codes needs a connection.");
    } finally {
      setBusy(false);
    }
  };

  const linkBtn = { background: "none", border: 0, padding: 0, font: "inherit", fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer" } as const;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#8c919c" }}>{noun}</span>
      <span
        title="Printed at the start of this finding id"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: code ? "#3a3f4a" : "#9aa0ab", background: "#f1f2f5", border: "1px solid #e4e7ec", borderRadius: 20, padding: "2px 9px" }}
      >
        {code ?? "none yet"}
      </span>
      {editable && !open && (
        <button
          type="button"
          style={linkBtn}
          onClick={() => {
            setValue(code ?? "");
            setError(null);
            setOpen(true);
          }}
        >
          Edit
        </button>
      )}
      {!editable && canEdit && locked && <span style={{ fontSize: 11, color: "#9aa0ab" }}>locked: printed on findings</span>}
      {open && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <input
            className="pk-input"
            aria-label={noun}
            maxLength={6}
            value={value}
            disabled={busy}
            aria-invalid={invalid}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            style={{ width: 84, fontFamily: "var(--font-mono)" }}
          />
          <button type="button" className="pk-btn-accent" style={{ padding: "5px 11px" }} disabled={busy || invalid} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <span style={{ fontSize: 11, color: "#9aa0ab", flexBasis: "100%" }}>2–6 letters or digits. Issued finding ids keep their old code.</span>
          {error && <span style={{ fontSize: 12, color: "#8c3b26", flexBasis: "100%" }}>{error}</span>}
        </span>
      )}
    </span>
  );
}
