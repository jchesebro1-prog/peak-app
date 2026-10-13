"use client";

/**
 * #335 Inbox organization — Change… (spec §2): file a thread under something
 * else. The existing link search (companies and venues) plus a second group,
 * the open quotes / projects / leads of the thread's customer (or of the
 * company picked above). Every pick is re-checked on the server
 * (changeFiling); the result's rule offer goes back to the caller.
 */
import { useEffect, useState, useTransition } from "react";
import type { LinkTargetGroups, LinkTargetHit } from "@/lib/inbox-link-targets";
import type { RuleOffer } from "@/lib/inbox-org/apply";
import { postInboxChanged } from "@/lib/inbox-org/broadcast";
import { searchLinkTargetsAction } from "../link-popup-actions";
import { changeFilingAction, filingRecordsAction } from "../organize-actions";

type Records = { customer: { id: string; name: string } | null; records: Array<{ id: string; type: "quote" | "project" | "lead"; label: string }> };
type Picked = { customerId: string; customerName: string; siteId: string | null; siteName: string | null };

const TYPE_LABEL: Record<string, string> = { quote: "Quote", project: "Project", lead: "Lead" };

const ITEM: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
  width: "100%",
  textAlign: "left",
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#26292f",
  background: "#fff",
  border: "none",
  borderBottom: "1px solid #f3f4f6",
  padding: "6px 9px",
  cursor: "pointer",
};
const GROUP: React.CSSProperties = {
  padding: "6px 9px 3px",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "#aab0bb",
  background: "#fbfbfc",
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "5px 9px",
  cursor: "pointer",
};

export default function ChangeFiling({
  threadId,
  onDone,
  onCancel,
}: {
  threadId: string;
  onDone: (r: { ruleOffer: RuleOffer | null; message: string }) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ q: string; groups: LinkTargetGroups } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [records, setRecords] = useState<Records | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // the thread's likely customer first; a company / venue pick reloads them
  const pickedCustomer = picked?.customerId ?? "";
  useEffect(() => {
    let cancelled = false;
    filingRecordsAction(threadId, pickedCustomer || null)
      .then((r) => {
        if (!cancelled) setRecords(r.ok ? { customer: r.customer, records: r.records } : { customer: null, records: [] });
      })
      .catch(() => {
        if (!cancelled) setRecords({ customer: null, records: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, pickedCustomer]);

  const query = q.trim();
  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const h = setTimeout(() => {
      searchLinkTargetsAction(query)
        .then((groups) => {
          if (!cancelled) setHits({ q: query, groups });
        })
        .catch(() => {
          if (!cancelled) setHits({ q: query, groups: { companies: [], venues: [], people: [] } });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [query]);
  const groups = query.length >= 2 && hits?.q === query ? hits.groups : null;

  const submit = (target: { customerId?: string | null; siteId?: string | null; work?: { type: string; id: string } | null }) =>
    start(async () => {
      setError(null);
      try {
        const r = await changeFilingAction(threadId, target);
        if (!r.ok) {
          setError(r.message);
          return;
        }
        postInboxChanged(threadId);
        onDone({ ruleOffer: r.ruleOffer, message: r.archived ? "Filed and archived" : "Filed" });
      } catch {
        setError("Something went wrong — try again.");
      }
    });

  const pickCompany = (h: LinkTargetHit) => {
    setPicked({ customerId: h.id, customerName: h.label, siteId: null, siteName: null });
    setQ("");
  };
  const pickVenue = (h: LinkTargetHit) => {
    if (!h.companyId) return;
    setPicked({ customerId: h.companyId, customerName: h.companyName, siteId: h.id, siteName: h.label });
    setQ("");
  };

  const recCustomer = records?.customer ?? null;
  const siteForRecords = picked && recCustomer && picked.customerId === recCustomer.id ? picked.siteId : null;

  return (
    <div
      role="group"
      aria-label="Change filing"
      style={{ border: "1px solid #e4e7ec", borderRadius: 9, background: "#fff", overflow: "hidden", fontFamily: "var(--font-ui)" }}
    >
      <div style={{ display: "flex", gap: 6, padding: 7, borderBottom: "1px solid #f0f1f4" }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a company or venue…"
          aria-label="Search a company or venue"
          style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 8px" }}
        />
        <button type="button" style={{ ...BTN, color: "#787d87" }} onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>

      {picked && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderBottom: "1px solid #f0f1f4", fontSize: 12 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {picked.customerName}
            {picked.siteName ? ` · ${picked.siteName}` : ""}
          </span>
          <button
            type="button"
            style={{ ...BTN, color: "#fff", background: "var(--accent)", border: "1px solid transparent" }}
            disabled={pending}
            onClick={() => submit({ customerId: picked.customerId, siteId: picked.siteId })}
          >
            {pending ? "Filing…" : picked.siteName ? "File under this venue" : "File under this company"}
          </button>
        </div>
      )}

      <div className="ib-scroll" style={{ maxHeight: 260, overflowY: "auto" }}>
        {groups && (
          <>
            {groups.companies.length > 0 && <div style={GROUP}>Companies</div>}
            {groups.companies.map((h) => (
              <button key={`c-${h.id}`} type="button" style={ITEM} disabled={pending} onClick={() => pickCompany(h)}>
                <span style={{ fontWeight: 600 }}>{h.label}</span>
                {h.sub && <span style={{ fontSize: 11, color: "#9aa0ab" }}>{h.sub}</span>}
              </button>
            ))}
            {groups.venues.filter((h) => !!h.companyId).length > 0 && <div style={GROUP}>Venues</div>}
            {groups.venues
              .filter((h) => !!h.companyId)
              .map((h) => (
                <button key={`v-${h.id}`} type="button" style={ITEM} disabled={pending} onClick={() => pickVenue(h)}>
                  <span style={{ fontWeight: 600 }}>{h.label}</span>
                  <span style={{ fontSize: 11, color: "#9aa0ab" }}>{h.companyName}</span>
                </button>
              ))}
            {groups.companies.length === 0 && groups.venues.length === 0 && (
              <div style={{ padding: "8px 9px", fontSize: 12, color: "#9aa0ab" }}>No company or venue matches.</div>
            )}
          </>
        )}

        <div style={GROUP}>{recCustomer ? `Quotes, projects & leads — ${recCustomer.name}` : "Quotes, projects & leads"}</div>
        {!records ? (
          <div style={{ padding: "8px 9px", fontSize: 12, color: "#9aa0ab" }}>Loading…</div>
        ) : !recCustomer ? (
          <div style={{ padding: "8px 9px", fontSize: 12, color: "#9aa0ab" }}>Pick a company to see its records.</div>
        ) : records.records.length === 0 ? (
          <div style={{ padding: "8px 9px", fontSize: 12, color: "#9aa0ab" }}>No open quotes, projects or leads.</div>
        ) : (
          records.records.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              style={ITEM}
              disabled={pending}
              onClick={() => submit({ customerId: recCustomer.id, siteId: siteForRecords, work: { type: r.type, id: r.id } })}
            >
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#9aa0ab", minWidth: 46 }}>{TYPE_LABEL[r.type] || r.type}</span>
              <span>{r.label}</span>
            </button>
          ))
        )}
      </div>
      {error && (
        <div role="alert" style={{ padding: "6px 9px", fontSize: 11.5, color: "#b4543a", borderTop: "1px solid #f0f1f4" }}>
          {error}
        </div>
      )}
    </div>
  );
}
