"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import EntityQuickAdd, { type QuickAddValues } from "@/components/entity-quick-add";
import { quickAddContactAction } from "@/app/(app)/inbox/link-actions";
import { ACCENT_INK, ACCENT_SOFT, mono } from "@/app/(app)/companies/lib";
import { setContactRoleAction } from "../actions";

/**
 * #122 — Contacts: the company's contacts (identity core rows, so each has
 * an id) with an editable "Contact for…" role per contact (VendorProfile.
 * contactRoles), and a quick-add that reuses EntityQuickAdd kind="contact"
 * + the Inbox sidebar's quickAddContactAction (savePersonAction underneath).
 */

export type VendorContactVM = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  primary: boolean;
  role: string;
};

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 18, overflow: "hidden" };
const IN: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 10px", outline: "none", background: "#fff", boxSizing: "border-box" };

function RoleField({ vendorId, contact }: { vendorId: string; contact: VendorContactVM }) {
  const router = useRouter();
  const [v, setV] = useState(contact.role);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const commit = () => {
    if (v.trim() === contact.role) return;
    start(async () => {
      setErr("");
      const res = await setContactRoleAction(vendorId, contact.id, v);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  };
  return (
    <div style={{ minWidth: 0 }}>
      <input
        value={v}
        disabled={pending}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Contact for… (e.g. price lists, RMAs, project registration)"
        style={IN}
      />
      {err && <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 4 }}>{err}</div>}
    </div>
  );
}

export default function ContactsTab({ vendorId, contacts }: { vendorId: string; contacts: VendorContactVM[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<QuickAddValues["contact"]>({ name: "", role: "", email: "", phone: "" });
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const submit = () =>
    start(async () => {
      setErr(null);
      const res = await quickAddContactAction({ customerId: vendorId, ...draft });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setAdding(false);
      setDraft({ name: "", role: "", email: "", phone: "" });
      router.refresh();
    });

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Contacts</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{contacts.length}</span>
        </div>
        <button type="button" onClick={() => setAdding((a) => !a)} style={{ fontSize: 12, fontWeight: 700, color: ACCENT_INK, background: ACCENT_SOFT, border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
          {adding ? "Cancel" : "+ Add contact"}
        </button>
      </div>
      {adding && (
        <div style={{ padding: "4px 18px 16px", borderBottom: "1px solid #f0f1f4", background: "#fafbfc" }}>
          <EntityQuickAdd
            kind="contact"
            value={draft}
            onChange={setDraft}
            submitting={pending}
            error={err}
            onCancel={() => {
              setAdding(false);
              setErr(null);
            }}
            onSubmit={submit}
          />
        </div>
      )}
      {contacts.map((ct) => (
        <div key={ct.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1.4fr)", gap: 14, padding: "12px 18px", borderBottom: "1px solid #f5f6f8", alignItems: "start" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
              {mono(ct.name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>
                <Link href={`/people/${encodeURIComponent(ct.id)}`} style={{ color: "inherit", textDecoration: "none" }}>{ct.name}</Link>
                {ct.primary && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT_INK, background: ACCENT_SOFT, padding: "1px 5px", borderRadius: 4, marginLeft: 5, letterSpacing: ".03em" }}>
                    PRIMARY
                  </span>
                )}
              </div>
              {ct.title && <div style={{ fontSize: 11, color: "#8c919c", marginTop: 1 }}>{ct.title}</div>}
              {ct.email && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ct.email}</div>}
              {ct.phone && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>{ct.phone}</div>}
            </div>
          </div>
          <RoleField vendorId={vendorId} contact={ct} />
        </div>
      ))}
      {contacts.length === 0 && (
        <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No contacts yet — add the rep you email for price lists.
        </div>
      )}
    </div>
  );
}
