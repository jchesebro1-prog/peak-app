"use client";

/**
 * #214 — the Inbox Link popup. Opened from a message header's "Link…" (that
 * message becomes the thread's "Linking from") or the sidebar's "Edit
 * links" (the identity message). Top to bottom:
 *   1. People on this email — From/To/Cc; tick to link, "Add" to create
 *   2. Company & venue      — current links + one search box
 *   3. Work                 — WorkLinkCard in edit mode (scoped to the company)
 *   4. From the signature   — prefill a new contact / fill a known one's blanks
 *   5. Footer               — Create task (#215 passes onCreateTask) · Done
 *
 * Data comes from linkPopupDataAction; every write goes through a server
 * action, then reloads that data and router.refresh()es the reader. No store
 * imports — a store pulls postgres into the client bundle (next build only).
 */
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import EntityQuickAdd, { INPUT, type QuickAddValues } from "@/components/entity-quick-add";
import { Typeahead } from "@/components/search/typeahead";
import { passAllFilter, stableRank } from "@/lib/search/typeahead-rank";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import type { LinkTargetHit, LinkTargetKind } from "@/lib/inbox-link-targets";
import type { LinkPopupData, PopupParticipant, ReaderVM } from "./types";
import {
  fetchMessageCcAction,
  fillContactBlanksAction,
  linkPopupDataAction,
  searchLinkTargetsAction,
  setThreadContactsAction,
} from "./link-popup-actions";
import {
  linkThreadToCustomerAction,
  quickAddContactAction,
  quickAddCustomerAction,
  quickAddVenueAction,
  setIdentityMessageAction,
  setThreadSiteAction,
} from "./link-actions";
import WorkLinkCard from "./work-link-card";
import { ACCENT_BTN, BODY, BTN, CARD, CHECK_ROW, H, MONO, MUTED, PRIMARY } from "./sidebar-styles";

/** `note` — setThreadContactsAction's optional heads-up when linking a
 *  person whose home company was deleted (the company step is skipped,
 *  never the link itself; #214 fix wave 2). */
type ActionResult = { ok: boolean; error?: string; note?: string };

const KIND_META: Record<LinkTargetKind, { label: string; color: string }> = {
  company: { label: "Company", color: "#8a6d1f" },
  venue: { label: "Venue", color: "#1f7a52" },
  person: { label: "Person", color: "#3155a8" },
};

const ROLE_LABEL: Record<PopupParticipant["role"], string> = { from: "From", to: "To", cc: "Cc" };

const ELLIPSIS: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const CHIP: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "#fff",
  padding: "2px 6px",
  borderRadius: 5,
  flexShrink: 0,
};

const hitKey = (h: LinkTargetHit) => `${h.kind}:${h.id}`;

function HitRow({ hit }: { hit: LinkTargetHit }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ ...CHIP, background: KIND_META[hit.kind].color }}>{KIND_META[hit.kind].label}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, ...ELLIPSIS }}>{hit.label}</span>
        {hit.sub && <span style={{ display: "block", fontSize: 11, color: "#8c919c", ...ELLIPSIS }}>{hit.sub}</span>}
      </span>
    </span>
  );
}

/** Debounced server search with a stale-response guard — the #121 pattern
 *  (design/assemblies/fixture-form.tsx usePartSearch): items are DERIVED
 *  from whether the last answered query still matches the live one. */
function useLinkSearch(only?: LinkTargetKind) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTargetHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      searchLinkTargetsAction(q, only).then((g) => {
        if (my !== seq.current) return;
        setResults([...g.companies, ...g.venues, ...g.people]);
        setResultQuery(q);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query, only]);
  const trimmed = query.trim();
  const fresh = trimmed.length >= 2 && resultQuery === trimmed;
  return {
    setQuery,
    items: fresh ? results : [],
    emptyText: trimmed.length < 2 ? "Type at least 2 letters." : fresh ? "Nothing matches." : "Searching…",
  };
}

function LinkSearchBox({
  only,
  placeholder,
  onPick,
}: {
  only?: LinkTargetKind;
  placeholder: string;
  onPick: (hit: LinkTargetHit) => void;
}) {
  const { setQuery, items, emptyText } = useLinkSearch(only);
  return (
    <Typeahead
      items={items}
      keyOf={hitKey}
      filter={passAllFilter}
      rank={stableRank}
      render={(h) => <HitRow hit={h} />}
      onPick={onPick}
      max={24}
      placeholder={placeholder}
      ariaLabel={placeholder}
      inputStyle={{ ...INPUT, padding: "8px 10px", fontSize: 12.5 }}
      emptyText={emptyText}
      onQueryChange={setQuery}
    />
  );
}

type Adding = {
  email: string;
  values: QuickAddValues["contact"];
  company: { id: string; name: string } | null;
};

export default function LinkPopup({
  vm,
  messageId,
  fromHeader,
  onClose,
  onCreateTask,
}: {
  vm: ReaderVM;
  messageId: string;
  /** opened from a message header — that message becomes "Linking from" */
  fromHeader: boolean;
  onClose: () => void;
  /** #215 wires this; the footer shows "Create task" only when it is set */
  onCreateTask?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [data, setData] = useState<LinkPopupData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [newCompany, setNewCompany] = useState<QuickAddValues["customer"] | null>(null);
  const [newVenue, setNewVenue] = useState<QuickAddValues["venue"] | null>(null);
  const [remember, setRemember] = useState(true);
  const [claim, setClaim] = useState(false);

  // Load (and, once, lazily backfill Cc for) the popup's message. `rev`
  // bumps after every write so the lists re-read the server.
  useEffect(() => {
    let alive = true;
    linkPopupDataAction(vm.id, messageId).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setData(r.data);
      if (r.data.ccPending) {
        fetchMessageCcAction(vm.id, messageId).then((r2) => {
          if (alive && r2.ok) setData(r2.data);
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [vm.id, messageId, rev]);

  // Opened from a message header: that message drives linking from now on
  // (#125's identity source), exactly as the old "Linking from" picker did.
  const identitySet = useRef(false);
  useEffect(() => {
    if (!fromHeader || identitySet.current || vm.identityMessageId === messageId) return;
    identitySet.current = true;
    setIdentityMessageAction(vm.id, messageId).then(() => router.refresh());
  }, [fromHeader, messageId, vm.id, vm.identityMessageId, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (fn: () => Promise<ActionResult>, onSuccess?: () => void) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error || "Something went wrong.");
        return;
      }
      if (r.note) setNotice(r.note);
      onSuccess?.();
      setRev((v) => v + 1);
      router.refresh();
    });

  const senderEmail = vm.identity?.email || vm.contactEmail;
  const canClaim = !vm.senderIsPublicDomain && !!vm.senderDomain;
  const companyId = vm.customerCard?.id || null;
  const venueLabel = vm.siteId ? vm.siteOptions.find((o) => o.value === vm.siteId)?.label || "Venue" : "";

  const linkCompany = (id: string) =>
    linkThreadToCustomerAction(vm.id, id, {
      remember: remember && !!senderEmail,
      claimDomain: claim && canClaim,
    });

  const pickTarget = (hit: LinkTargetHit) => {
    if (hit.kind === "company") run(() => linkCompany(hit.id));
    else if (hit.kind === "venue")
      run(async () => {
        if (hit.companyId && hit.companyId !== companyId) {
          const r = await linkCompany(hit.companyId);
          if (!r.ok) return r;
        }
        return setThreadSiteAction(vm.id, hit.id);
      });
    else run(() => setThreadContactsAction(vm.id, hit.id, true));
  };

  const startAdding = (p: PopupParticipant) => {
    const pre = data?.prefill && data.prefill.email === p.email ? data.prefill : null;
    const company = pre?.companyId
      ? { id: pre.companyId, name: pre.companyName }
      : companyId && vm.customerCard
        ? { id: companyId, name: vm.customerCard.name }
        : null;
    setError(null);
    setAdding({
      email: p.email,
      values: {
        name: pre?.name || p.name,
        role: pre?.title || "",
        email: p.email,
        phone: pre?.phone || "",
      },
      company,
    });
  };

  const submitAdding = () => {
    if (!adding) return;
    if (!adding.company) {
      setError("Pick the company this person works for.");
      return;
    }
    const a = adding;
    run(
      async () => {
        const res = await quickAddContactAction({ customerId: a.company!.id, ...a.values });
        if (!res.ok) return res;
        return setThreadContactsAction(vm.id, res.id, true);
      },
      () => setAdding(null)
    );
  };

  const sender = data?.participants.find((p) => p.role === "from") || null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,24,29,.4)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Link this email"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 580,
          maxWidth: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#fafbfc",
          borderRadius: 14,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          fontFamily: "var(--font-ui)",
          color: "#16181d",
        }}
      >
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #eef0f3", background: "#fff", borderRadius: "14px 14px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>Link this email</div>
            <button
              onClick={onClose}
              title="Close"
              style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
          <div style={{ ...MUTED, marginTop: 2 }}>
            Linking from: {data ? data.messageLabel : "…"}
          </div>
        </div>

        <div className="ib-scroll" style={{ overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {loadError && <div style={{ fontSize: 12.5, color: "#b4543a" }}>{loadError}</div>}
          {!data && !loadError && <div style={MUTED}>Loading…</div>}

          {data && (
            <>
              {/* 1. People on this email */}
              <div style={CARD}>
                <div style={H}>People on this email</div>
                {data.participants.length === 0 && (
                  <div style={MUTED}>No outside addresses on this message.</div>
                )}
                {data.participants.map((p) => (
                  <div key={p.email} style={{ padding: "6px 0", borderTop: "1px solid #f2f3f6" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {p.contactId ? (
                        <input
                          type="checkbox"
                          checked={p.linked}
                          disabled={pending}
                          aria-label={`Link ${p.contactName || p.email}`}
                          onChange={(e) => run(() => setThreadContactsAction(vm.id, p.contactId!, e.target.checked))}
                        />
                      ) : (
                        <span style={{ width: 13 }} />
                      )}
                      <span style={{ ...CHIP, background: "#8c919c" }}>{ROLE_LABEL[p.role]}</span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, ...ELLIPSIS }}>
                          {p.contactName || p.name || p.email}
                        </span>
                        <span style={{ display: "block", ...MONO, color: "#8c919c", ...ELLIPSIS }}>
                          {p.email}
                          {p.companyName ? ` · ${p.companyName}` : ""}
                        </span>
                      </span>
                      {!p.contactId && !p.ambiguous && (
                        <button
                          type="button"
                          style={adding?.email === p.email ? ACCENT_BTN : BTN}
                          disabled={pending}
                          onClick={() => (adding?.email === p.email ? setAdding(null) : startAdding(p))}
                        >
                          Add
                        </button>
                      )}
                      {p.ambiguous && <span style={MUTED}>At several companies</span>}
                    </div>
                    {adding?.email === p.email && (
                      <div style={{ marginTop: 8, paddingLeft: 21 }}>
                        <div style={{ ...MUTED, marginBottom: 6 }}>
                          Company:{" "}
                          {adding.company ? (
                            <>
                              <b>{adding.company.name}</b>{" "}
                              <button
                                type="button"
                                style={{ ...BTN, padding: "1px 6px", fontSize: 11 }}
                                onClick={() => setAdding({ ...adding, company: null })}
                              >
                                Change
                              </button>
                            </>
                          ) : (
                            "pick one below"
                          )}
                        </div>
                        {!adding.company && (
                          <LinkSearchBox
                            only="company"
                            placeholder="Search companies…"
                            onPick={(h) => setAdding({ ...adding, company: { id: h.id, name: h.label } })}
                          />
                        )}
                        <EntityQuickAdd
                          kind="contact"
                          value={adding.values}
                          onChange={(v) => setAdding({ ...adding, values: v })}
                          submitting={pending}
                          error={error}
                          onCancel={() => setAdding(null)}
                          onSubmit={submitAdding}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {data.otherLinked.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ ...MUTED, marginBottom: 4 }}>Also linked to this thread</div>
                    {data.otherLinked.map((o) => (
                      <label key={o.id} style={{ ...CHECK_ROW, marginTop: 4 }}>
                        <input
                          type="checkbox"
                          checked
                          disabled={pending}
                          onChange={() => run(() => setThreadContactsAction(vm.id, o.id, false))}
                        />
                        <span>
                          {o.name}
                          {o.companyName ? ` · ${o.companyName}` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Company & venue */}
              <div style={CARD}>
                <div style={H}>Company &amp; venue</div>
                <div style={BODY}>
                  Company: <b>{vm.customerCard?.name || "none"}</b>
                  {vm.customerCard && (
                    <>
                      {" "}· Venue: <b>{venueLabel || "none"}</b>
                      {vm.siteId && (
                        <button
                          type="button"
                          style={{ ...BTN, padding: "1px 6px", fontSize: 11, marginLeft: 6 }}
                          disabled={pending}
                          onClick={() => run(() => setThreadSiteAction(vm.id, null))}
                        >
                          Clear venue
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div style={{ marginTop: 10 }}>
                  <LinkSearchBox
                    placeholder="Search a company, venue or person…"
                    onPick={pickTarget}
                  />
                </div>
                {senderEmail && (
                  <label style={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      When I pick a company, remember <span style={MONO}>{senderEmail}</span> on a contact
                    </span>
                  </label>
                )}
                {canClaim && (
                  <label style={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={claim}
                      onChange={(e) => setClaim(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      …and always link <span style={MONO}>@{vm.senderDomain}</span> to it
                    </span>
                  </label>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    style={newCompany ? ACCENT_BTN : BTN}
                    disabled={pending}
                    onClick={() => setNewCompany(newCompany ? null : { name: "", type: CUSTOMER_TYPES[0] || "" })}
                  >
                    + New company
                  </button>
                  {companyId && (
                    <button
                      type="button"
                      style={newVenue ? ACCENT_BTN : BTN}
                      disabled={pending}
                      onClick={() => setNewVenue(newVenue ? null : { label: "", city: "", state: "" })}
                    >
                      + New venue
                    </button>
                  )}
                </div>
                {newCompany && (
                  <div style={{ marginTop: 8 }}>
                    <EntityQuickAdd
                      kind="customer"
                      value={newCompany}
                      onChange={setNewCompany}
                      submitting={pending}
                      error={error}
                      onCancel={() => setNewCompany(null)}
                      onSubmit={() =>
                        run(
                          () =>
                            quickAddCustomerAction({
                              ...newCompany,
                              senderName: vm.identity?.name || vm.contactName,
                              senderEmail,
                              remember: remember && !!senderEmail,
                              threadId: vm.id,
                            }),
                          () => setNewCompany(null)
                        )
                      }
                    />
                  </div>
                )}
                {newVenue && companyId && (
                  <div style={{ marginTop: 8 }}>
                    <EntityQuickAdd
                      kind="venue"
                      value={newVenue}
                      onChange={setNewVenue}
                      submitting={pending}
                      error={error}
                      onCancel={() => setNewVenue(null)}
                      onSubmit={() =>
                        run(
                          () => quickAddVenueAction({ customerId: companyId, ...newVenue, threadId: vm.id }),
                          () => setNewVenue(null)
                        )
                      }
                    />
                  </div>
                )}
              </div>

              {/* 3. Work */}
              <WorkLinkCard vm={vm} mode="edit" />

              {/* 4. From the signature (received messages only) */}
              {data.inbound && (
                <div style={CARD}>
                  <div style={H}>From the signature</div>
                  {!data.signature ? (
                    <div style={MUTED}>No signature found on this message.</div>
                  ) : (
                    <>
                      <div style={{ ...BODY, display: "grid", gap: 2 }}>
                        {data.signature.name && <div><b>{data.signature.name}</b></div>}
                        {data.signature.title && <div>{data.signature.title}</div>}
                        {data.signature.company && <div>{data.signature.company}</div>}
                        {data.signature.phones.map((ph) => (
                          <div key={ph.number} style={MONO}>
                            {ph.label} · {ph.number}
                          </div>
                        ))}
                        {data.signature.website && <div style={MONO}>{data.signature.website}</div>}
                      </div>
                      {data.senderContactId ? (
                        data.missing.title || data.missing.phones.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={MUTED}>
                              Not on file yet:{" "}
                              {[
                                data.missing.title ? `title “${data.missing.title}”` : "",
                                ...data.missing.phones.map((ph) => `${ph.label} ${ph.number}`),
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                            <button
                              type="button"
                              style={{ ...PRIMARY, marginTop: 8 }}
                              disabled={pending}
                              onClick={() =>
                                run(async () => {
                                  const r = await fillContactBlanksAction(vm.id, messageId);
                                  if (r.ok) setNotice(r.wrote.length ? `Added ${r.wrote.join(" and ")}.` : "Nothing new to add.");
                                  return r;
                                })
                              }
                            >
                              Add missing details
                            </button>
                          </div>
                        ) : (
                          <div style={{ ...MUTED, marginTop: 8 }}>Everything here is already on file.</div>
                        )
                      ) : (
                        sender &&
                        !sender.contactId &&
                        !sender.ambiguous && (
                          <button
                            type="button"
                            style={{ ...PRIMARY, marginTop: 10 }}
                            disabled={pending}
                            onClick={() => startAdding(sender)}
                          >
                            Add as contact
                          </button>
                        )
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {notice && <div style={{ fontSize: 12, color: "#1f7a52" }}>{notice}</div>}
          {error && !adding && !newCompany && !newVenue && (
            <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "12px 20px",
            borderTop: "1px solid #eef0f3",
            background: "#fff",
            borderRadius: "0 0 14px 14px",
          }}
        >
          {onCreateTask && (
            <button type="button" style={BTN} onClick={onCreateTask}>
              Create task
            </button>
          )}
          <button type="button" style={PRIMARY} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
