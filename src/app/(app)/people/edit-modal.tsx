"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { deletePersonAction, savePersonAction } from "./actions";
import type { ChannelInputVM, CompanyOptionVM, SavePersonInput } from "./types";
import { SearchableSelect } from "@/components/searchable-select";

/**
 * New / Edit person modal (identity core, D85). A person is one row for
 * life — employer changes just re-point the home company. Emails and phones
 * are full labeled lists here (the legacy customer seam only ever carried
 * one of each).
 */

const CHANNEL_LABELS = ["work", "mobile", "home", "other"];
const STATUSES = [
  { value: "active", label: "Active" },
  { value: "former", label: "Former" },
  { value: "do_not_contact", label: "Do not contact" },
];
// Item 11 (D87): the person's tier is authoritative; blank falls back to
// the company's tier, then Base. Margins are set in /estimating-rules.
const TIERS = [
  { value: "", label: "— Company / Base —" },
  { value: "base", label: "Base" },
  { value: "copper", label: "Copper" },
  { value: "silver", label: "Silver" },
  { value: "gold", label: "Gold" },
  { value: "platinum", label: "Platinum" },
  { value: "reseller", label: "Reseller" },
  { value: "employee", label: "Employee" },
];

const field: CSSProperties = {
  width: "100%",
  fontSize: 13.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "9px 11px",
  outline: "none",
};
const label: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#8c919c",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  marginBottom: 5,
};

type ChannelRow = ChannelInputVM & { key: string };

function rowsFrom(list: ChannelInputVM[] | undefined, kind: string): ChannelRow[] {
  const src = list || [];
  return src.map((c, i) => ({ ...c, key: kind + i }));
}

export default function EditPersonModal({
  mode,
  initial,
  companyOptions,
  closeHref,
}: {
  mode: "new" | "edit";
  initial: SavePersonInput | null;
  companyOptions: CompanyOptionVM[];
  closeHref: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [firstName, setFirstName] = useState(initial?.firstName || "");
  const [lastName, setLastName] = useState(initial?.lastName || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [companyId, setCompanyId] = useState(initial?.homeCompanyId || "");
  const [status, setStatus] = useState(initial?.status || "active");
  const [pricingTier, setPricingTier] = useState(initial?.pricingTier || "");
  const [isPrimary, setIsPrimary] = useState(!!initial?.isPrimary);
  const [emails, setEmails] = useState<ChannelRow[]>(() => rowsFrom(initial?.emails, "e"));
  const [phones, setPhones] = useState<ChannelRow[]>(() => rowsFrom(initial?.phones, "p"));
  const [error, setError] = useState("");

  const close = () => router.push(closeHref);

  const save = () => {
    setError("");
    startTransition(async () => {
      const res = await savePersonAction({
        id: initial?.id ?? null,
        firstName,
        lastName,
        title,
        homeCompanyId: companyId || null,
        status,
        pricingTier: pricingTier || null,
        isPrimary,
        emails: emails.map(({ value, label: l, isPrimary: p }) => ({ value, label: l, isPrimary: p })),
        phones: phones.map(({ value, label: l, isPrimary: p }) => ({ value, label: l, isPrimary: p })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/people/${encodeURIComponent(res.id)}`);
      router.refresh();
    });
  };

  const del = () => {
    if (!initial?.id) return;
    startTransition(async () => {
      await deletePersonAction(initial.id!);
      router.push("/people");
      router.refresh();
    });
  };

  const channelEditor = (
    kind: "email" | "phone",
    rows: ChannelRow[],
    setRows: (r: ChannelRow[]) => void
  ) => (
    <div>
      <span style={label}>{kind === "email" ? "Emails" : "Phones"}</span>
      {rows.map((r, i) => (
        <div key={r.key} style={{ display: "flex", gap: 7, marginBottom: 7 }}>
          <input
            value={r.value}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            placeholder={kind === "email" ? "name@example.com" : "(715) 555-0100"}
            style={{ ...field, flex: 1 }}
            type={kind === "email" ? "email" : "tel"}
          />
          <select
            value={r.label}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            style={{ ...field, width: 96, flexShrink: 0 }}
          >
            {CHANNEL_LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Primary"
            onClick={() => setRows(rows.map((x, j) => ({ ...x, isPrimary: j === i })))}
            style={{
              width: 34,
              flexShrink: 0,
              borderRadius: 8,
              border: `1px solid ${r.isPrimary ? "var(--accent)" : "#e4e7ec"}`,
              background: r.isPrimary ? "var(--accent-soft, #f3ecf5)" : "#fff",
              color: r.isPrimary ? "var(--accent)" : "#aab0bb",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ★
          </button>
          <button
            type="button"
            title="Remove"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            style={{ width: 34, flexShrink: 0, borderRadius: 8, border: "1px solid #e4e7ec", background: "#fff", color: "#aab0bb", cursor: "pointer", fontSize: 15 }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setRows([
            ...rows,
            { key: kind[0] + Date.now().toString(36), value: "", label: "work", isPrimary: rows.length === 0 },
          ])
        }
        style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      >
        + Add {kind}
      </button>
    </div>
  );

  return (
    <div
      onClick={close}
      style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.46)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, zIndex: 60, fontFamily: "var(--font-ui)", color: "#16181d" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: "100%", maxHeight: "88vh", background: "#fff", borderRadius: 15, boxShadow: "0 24px 70px rgba(0,0,0,.32)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "17px 22px", borderBottom: "1px solid #f0f1f4", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 600 }}>
              {mode === "new" ? "New person" : "Edit person"}
            </div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>
              {mode === "new"
                ? "One record for life — employer changes just re-point the company"
                : "Changes apply everywhere this person is referenced"}
            </div>
          </div>
          <button
            onClick={close}
            style={{ width: 30, height: 30, borderRadius: 8, background: "#f1f2f5", color: "#5b616e", border: "none", cursor: "pointer", fontSize: 17, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* body */}
        <div style={{ padding: 22, overflowY: "auto", display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={label}>First name</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={field} autoFocus />
            </div>
            <div>
              <span style={label}>Last name</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={field} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={label}>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Technical Director" style={field} />
            </div>
            <div>
              <span style={label}>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={field}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={label}>Company</span>
              <SearchableSelect value={companyId} onValueChange={setCompanyId}
                options={companyOptions.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="— No company —" searchPlaceholder="Search companies…" buttonStyle={field} />
            </div>
            <div>
              <span style={label}>Pricing tier</span>
              <select value={pricingTier} onChange={(e) => setPricingTier(e.target.value)} style={field} title="Follows the person everywhere (design §4.7); margins set in Estimating Rules">
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, fontSize: 12.5, color: "#5b616e", cursor: "pointer" }}>
              <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
              Primary contact for this company
            </label>
          </div>
          {channelEditor("email", emails, setEmails)}
          {channelEditor("phone", phones, setPhones)}
          {error && (
            <div style={{ fontSize: 12.5, color: "#b03a2e", background: "#faece9", borderRadius: 8, padding: "9px 12px" }}>
              {error}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "15px 22px", borderTop: "1px solid #f0f1f4", flexShrink: 0 }}>
          {mode === "edit" ? (
            <button
              onClick={del}
              disabled={busy}
              style={{ fontSize: 12.5, fontWeight: 600, color: "#b03a2e", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              Delete person
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 9 }}>
            <button
              onClick={close}
              disabled={busy}
              style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 14px", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Saving…" : mode === "new" ? "Create person" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
