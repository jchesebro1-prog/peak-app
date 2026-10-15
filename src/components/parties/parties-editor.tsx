"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PARTY_ROLES, ROLE_LABEL, groupPartiesByRole, type PartyRecordType, type PartyRole } from "@/lib/parties/rules";
import type { ContactOption, PartyVM } from "@/lib/parties/vm";
import { addPartyAction, companyContactsAction, removePartyAction, setPartyContactAction, type PartyActionResult } from "@/app/(app)/parties/actions";
import CompanySearch from "./company-search";

/**
 * #346 — the one parties editor: grouped by role, add (role → company → optional person → label for Other),
 * change person, remove. Used by the lead drawer, the project page and the Estimator's Parties dialog.
 */
export default function PartiesEditor({
  recordType,
  recordId,
  initial,
  canEdit,
  roles = PARTY_ROLES,
  onChange,
}: {
  recordType: PartyRecordType;
  recordId: string;
  initial: PartyVM[];
  canEdit: boolean;
  roles?: readonly PartyRole[];
  onChange?: (parties: PartyVM[]) => void;
}) {
  const router = useRouter();
  const [parties, setParties] = useState(initial);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<PartyRole>(roles[0]);
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactId, setContactId] = useState("");
  const [label, setLabel] = useState("");
  const [contactsFor, setContactsFor] = useState<Record<string, ContactOption[]>>({});

  const apply = (r: PartyActionResult) => {
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setError("");
    setNote(r.note ?? "");
    setParties(r.parties);
    onChange?.(r.parties);
    router.refresh();
    return true;
  };

  const pickCompany = (c: { id: string; name: string }) => {
    setCompany(c);
    setContactId("");
    setContacts([]);
    companyContactsAction(c.id).then(setContacts).catch(() => setContacts([]));
  };

  const resetAdd = () => {
    setAdding(false);
    setCompany(null);
    setContacts([]);
    setContactId("");
    setLabel("");
  };

  const submit = () => {
    if (!company) return setError("Pick a company.");
    start(async () => {
      const ok = apply(await addPartyAction({ recordType, recordId, companyId: company.id, role, contactId: contactId || null, roleLabel: role === "other" ? label : null }));
      if (ok) resetAdd();
    });
  };

  const loadContacts = (companyId: string) => {
    if (contactsFor[companyId]) return;
    companyContactsAction(companyId).then((list) => setContactsFor((m) => ({ ...m, [companyId]: list }))).catch(() => {});
  };

  const groups = groupPartiesByRole(parties);
  const small = { fontSize: 11.5, color: "#8c919c" } as const;
  const btn = { fontSize: 12, fontWeight: 600, border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "5px 10px", cursor: "pointer" } as const;

  return (
    <div>
      {groups.length === 0 && <div style={{ ...small, padding: "6px 0" }}>No companies linked yet.</div>}
      {groups.map((g) => (
        <div key={g.role} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 4 }}>{g.label}</div>
          {g.parties.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid #f3f4f7", flexWrap: "wrap" }}>
              <Link href={p.href} style={{ fontSize: 13, fontWeight: 600, color: "inherit", textDecoration: "none", minWidth: 0, overflowWrap: "anywhere" }}>
                {p.companyName}
              </Link>
              {p.role === "other" && <span style={small}>{p.roleText}</span>}
              <span style={{ flex: 1 }} />
              {canEdit ? (
                <select
                  aria-label={`Person at ${p.companyName}`}
                  value={p.contactId ?? ""}
                  onFocus={() => loadContacts(p.companyId)}
                  onChange={(e) => start(async () => void apply(await setPartyContactAction(p.id, e.target.value || null)))}
                  disabled={pending}
                  style={{ fontSize: 12, maxWidth: 180 }}
                >
                  <option value="">— no person —</option>
                  {p.contactId && !(contactsFor[p.companyId] ?? []).some((c) => c.id === p.contactId) && <option value={p.contactId}>{p.contactName || p.contactId}</option>}
                  {(contactsFor[p.companyId] ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.title ? ` · ${c.title}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                p.contactName && <span style={small}>{p.contactName}</span>
              )}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${p.companyName} (${p.roleText})`}
                  onClick={() => start(async () => void apply(await removePartyAction(p.id)))}
                  disabled={pending}
                  style={{ ...btn, padding: "2px 7px", color: "#8a2f22" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ))}

      {canEdit && !adding && (
        <button type="button" onClick={() => setAdding(true)} style={btn}>
          + Link a company
        </button>
      )}
      {canEdit && adding && (
        <div style={{ display: "grid", gap: 8, padding: 10, border: "1px solid #ececf0", borderRadius: 10, background: "#fafbfc" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as PartyRole)} style={{ fontSize: 12.5 }}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          {role === "other" && (
            <label style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
              Role name
              <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Construction manager" style={{ fontSize: 12.5, padding: "6px 8px" }} />
            </label>
          )}
          <div style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
            Company
            {company ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13 }}>{company.name}</span>
                <button type="button" onClick={() => setCompany(null)} style={{ ...btn, padding: "2px 8px" }}>
                  Change
                </button>
              </div>
            ) : (
              <CompanySearch placeholder="Search companies…" onPick={pickCompany} disabled={pending} />
            )}
          </div>
          {company && (
            <label style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
              Person (optional)
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} style={{ fontSize: 12.5 }}>
                <option value="">— no person —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.title ? ` · ${c.title}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={submit} disabled={pending || !company} style={{ ...btn, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}>
              {pending ? "Linking…" : "Link"}
            </button>
            <button type="button" onClick={resetAdd} disabled={pending} style={btn}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#8a2f22" }}>{error}</div>}
      {note && !error && <div style={{ marginTop: 8, ...small }}>{note}</div>}
    </div>
  );
}
