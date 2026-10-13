"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { COMPANY_LOGO_ACCEPT, COMPANY_LOGO_COPY, COMPANY_LOGO_MAX_BYTES } from "@/lib/company-logo";
import { removeCompanyLogoAction, saveCompanyLogoAction } from "./logo-actions";
import { postChanged } from "@/lib/popout/channel";

/**
 * Grid notes #8 — the company record's Logo card: a small preview, Upload /
 * Replace and Remove. The logo prints top-right on the datasheet book's
 * cover; without one the company name prints there instead.
 */

const card: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 11, padding: "14px 15px", boxShadow: "0 1px 2px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", gap: 8 };
const label: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" };
const small: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const btn: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, borderRadius: 7, padding: "6px 11px", border: "1px solid #e4e7ec", background: "#fff", color: "#3a3f4a", cursor: "pointer" };
const FAILED = "Could not reach the server. Try again.";

export function CompanyLogoCard({ companyId, companyName, logoSrc }: { companyId: string; companyName: string; logoSrc: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const upload = (file: File) =>
    start(async () => {
      setErr(null);
      // The server checks again from the bytes; this only spares a doomed upload.
      if (file.size > COMPANY_LOGO_MAX_BYTES) {
        setErr(COMPANY_LOGO_COPY.tooBig);
        return;
      }
      const fd = new FormData();
      fd.set("file", file);
      try {
        const r = await saveCompanyLogoAction(companyId, fd);
        if (!r.ok) setErr(r.error);
        else {
          postChanged("customer", companyId);
          router.refresh();
        }
      } catch {
        setErr(FAILED);
      }
    });

  const remove = () =>
    start(async () => {
      setErr(null);
      try {
        const r = await removeCompanyLogoAction(companyId);
        if (!r.ok) setErr(r.error);
        else {
          postChanged("customer", companyId);
          router.refresh();
        }
      } catch {
        setErr(FAILED);
      }
    });

  return (
    <div style={card} data-testid="company-logo">
      <span style={label}>{COMPANY_LOGO_COPY.heading}</span>
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored data URL, not an optimisable asset
        <img src={logoSrc} alt={`${companyName} logo`} style={{ maxWidth: "100%", maxHeight: 72, objectFit: "contain", alignSelf: "flex-start" }} />
      ) : (
        <span style={small}>{COMPANY_LOGO_COPY.empty}</span>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={{ ...btn, opacity: pending ? 0.55 : 1 }} disabled={pending} onClick={() => input.current?.click()}>
          {logoSrc ? COMPANY_LOGO_COPY.replace : COMPANY_LOGO_COPY.upload}
        </button>
        {logoSrc && (
          <button type="button" style={{ ...btn, color: "#a33a2b", opacity: pending ? 0.55 : 1 }} disabled={pending} onClick={remove}>
            {COMPANY_LOGO_COPY.remove}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={COMPANY_LOGO_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload(file);
          }}
        />
      </div>
      <span style={{ ...small, color: "#8c919c", fontSize: 11 }}>{COMPANY_LOGO_COPY.hint}</span>
      {err && (
        <span role="alert" style={{ ...small, color: "#a33a2b" }}>
          {err}
        </span>
      )}
    </div>
  );
}
