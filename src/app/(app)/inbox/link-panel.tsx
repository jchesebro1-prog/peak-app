"use client";

/**
 * #214 — the Inbox link panel: the reader sidebar's link mode (Jeff, Sep 27
 * — it replaced the modal link dialog). The sidebar shows it when a message
 * header's "Link…" (that message becomes the thread's "Linking from") or the
 * summary's "Edit links" (the identity message) is clicked. Top to bottom,
 * stacked for a narrow column:
 *   0. Header               — "Linking from: <sender> · <date>" · Done
 *   1. People on this email — From/To/Cc; tick to link, "Add" to create
 *   2. Company & venue      — current links + one search box
 *   3. Work                 — WorkLinkCard in edit mode (scoped to the company)
 *   4. From the signature   — prefill a new contact / fill a known one's blanks
 *   5. Create task          — only when #215 passes onCreateTask
 *
 * Data comes from linkPopupDataAction; every write goes through a server
 * action, then reloads that data and router.refresh()es the reader — link
 * mode stays open so several people can be linked in a row. No store
 * imports — a store pulls postgres into the client bundle (next build only).
 */
import { useEffect, useRef, useState, useTransition, type CSSProperties, type RefObject } from "react";
import { useRouter } from "next/navigation";
import EntityQuickAdd, { INPUT, emptyVenueQuickAdd, type QuickAddValues } from "@/components/entity-quick-add";
import { venueTypeOptions } from "@/lib/venue-types";
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
 *  from whether the last answered query still matches the live one. A
 *  rejected search (#214 fix wave 1) never leaves the box stuck reading
 *  "Searching…" — it reports failure and lets the next keystroke retry. */
function useLinkSearch(only?: LinkTargetKind) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTargetHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [searchError, setSearchError] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setSearchError(false);
      searchLinkTargetsAction(q, only)
        .then((g) => {
          if (my !== seq.current) return;
          setResults([...g.companies, ...g.venues, ...g.people]);
          setResultQuery(q);
        })
        .catch(() => {
          if (my !== seq.current) return;
          setSearchError(true);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query, only]);
  const trimmed = query.trim();
  const fresh = trimmed.length >= 2 && resultQuery === trimmed;
  return {
    setQuery,
    items: fresh ? results : [],
    emptyText: searchError
      ? "Search failed — try again."
      : trimmed.length < 2
        ? "Type at least 2 letters."
        : fresh
          ? "Nothing matches."
          : "Searching…",
  };
}

function LinkSearchBox({
  only,
  placeholder,
  disabled,
  onPick,
}: {
  only?: LinkTargetKind;
  placeholder: string;
  /** #214 fix wave 1 — block further picks while one is still being applied */
  disabled?: boolean;
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
      disabled={disabled}
    />
  );
}

type Adding = {
  email: string;
  values: QuickAddValues["contact"];
  company: { id: string; name: string } | null;
};

/** #214 sidebar fix 2 — which quick-add form (if any) has been typed into,
 *  so Escape / Done / a header "Link…" on another message all know whether
 *  leaving would silently drop it. A module-level function (not a value from
 *  render scope) so the Escape effect below doesn't need it as a dep. */
function openQuickAddWithContent(
  adding: Adding | null,
  newCompany: QuickAddValues["customer"] | null,
  newVenue: QuickAddValues["venue"] | null
): "contact" | "company" | "venue" | null {
  if (adding && (adding.values.name.trim() || adding.values.role.trim() || adding.values.phone.trim()))
    return "contact";
  if (newCompany && newCompany.name.trim()) return "company";
  if (newVenue && (newVenue.locationName.trim() || newVenue.city.trim() || newVenue.state.trim()))
    return "venue";
  return null;
}

export default function LinkPanel({
  vm,
  messageId,
  fromHeader,
  onDone,
  guardRef,
  onCreateTask,
}: {
  vm: ReaderVM;
  messageId: string;
  /** opened from a message header — that message becomes "Linking from" */
  fromHeader: boolean;
  /** back to the sidebar summary (Done, or Escape inside the panel) */
  onDone: () => void;
  /** #214 sidebar fix 2 — the reader calls this before switching link mode to
   *  a different message; it returns false (and keeps this message's panel
   *  up) when the person cancels a "discard the unsaved …?" confirm. */
  guardRef?: RefObject<(() => boolean) | null>;
  /** #215 wires this; "Create task" shows only when it is set */
  onCreateTask?: () => void;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [data, setData] = useState<LinkPopupData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  // #214 fix wave 1 — `dataRev` tracks which `rev` the loaded `data` belongs
  // to. After an action succeeds, `pending` clears as soon as the server
  // action itself resolves, but the panel's lists are still showing
  // pre-action data until the reload triggered by `rev` lands — without
  // this, checkboxes were briefly re-enabled with stale `checked` values
  // (a visible bounce) in that gap.
  const [dataRev, setDataRev] = useState(-1);
  const busy = pending || dataRev !== rev;
  // Per-form error state (#214 fix wave 1): a shared `error` let a failure
  // from one action show up inside an unrelated open form. `error` is now
  // only for actions with no form of their own (checkbox toggles, the
  // company/venue/person search, "Add missing details").
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [newCompany, setNewCompany] = useState<QuickAddValues["customer"] | null>(null);
  const [newVenue, setNewVenue] = useState<QuickAddValues["venue"] | null>(null);
  const [remember, setRemember] = useState(true);
  const [claim, setClaim] = useState(false);

  // Load (and, once, lazily backfill Cc for) the panel's message. `rev`
  // bumps after every write so the lists re-read the server. A rejected
  // load (#214 fix wave 1) sets an error instead of leaving "Loading…" up
  // forever, and a later successful load clears any earlier error.
  useEffect(() => {
    let alive = true;
    linkPopupDataAction(vm.id, messageId)
      .then((r) => {
        if (!alive) return;
        if (!r.ok) {
          setLoadError(r.error);
          setDataRev(rev);
          return;
        }
        setLoadError(null);
        setData(r.data);
        setDataRev(rev);
        if (r.data.ccPending) {
          // #214 fix wave 2 — a rejected lazy backfill is not surfaced as
          // an error; Cc simply stays un-backfilled for this load.
          fetchMessageCcAction(vm.id, messageId)
            .then((r2) => {
              if (alive && r2.ok) setData(r2.data);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (!alive) return;
        setLoadError("Couldn't load this message's links — try again.");
        setDataRev(rev);
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

  // #214 sidebar — entering link mode brings the panel into view and takes
  // focus (the panel root first, then the main search box once the data has
  // loaded and focus hasn't moved elsewhere meanwhile). Handing focus back
  // on Done is the sidebar's job: it knows which button opened link mode.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.focus({ preventScroll: true });
  }, []);
  const searchFocused = useRef(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!data || !el || searchFocused.current) return;
    searchFocused.current = true;
    if (document.activeElement !== el) return;
    el.querySelector<HTMLInputElement>('input[aria-label="Search a company, venue or person…"]')?.focus();
  }, [data]);

  // Escape — only while focus is inside the panel (it is no longer a modal:
  // the rest of the reader keeps its own keys), and never when a nested
  // widget already handled it (a Typeahead preventDefault()s Escape only
  // while its dropdown is open, so an idle search box lets it through).
  // Arrow keys: the panel root carries `data-link-panel`, which the inbox
  // shell's ArrowUp/ArrowDown thread switcher skips — the job the old modal's
  // dialog role + focus trap used to do (#214 fix waves 1–2).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!t || !panelRef.current?.contains(t)) return;
      if (adding || newCompany || newVenue) {
        // First Escape closes the open quick-add form (a Typeahead's own
        // Escape already preventDefault()s above, so this only runs for a
        // plain form field or a target outside any input). A second
        // Escape, with nothing left open, returns to the summary. #214
        // sidebar fix 2 — but not while there's typed content in it: same
        // "a stray Escape while typing doesn't throw away what's typed" rule
        // as task-dialog.tsx. An empty form still closes here; a non-empty
        // one only closes from Done's own discard confirm.
        if (openQuickAddWithContent(adding, newCompany, newVenue)) return;
        setAdding(null);
        setNewCompany(null);
        setNewVenue(null);
        return;
      }
      // A native <select> or a textarea keeps Escape for itself.
      if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone, adding, newCompany, newVenue]);

  // #214 sidebar fix 2 — keeps guardRef pointed at a closure over the latest
  // adding/newCompany/newVenue so the reader can ask, before it swaps this
  // panel for a different message's, whether that would discard something
  // typed — and if so, run the same confirm Done uses. Cleared on unmount
  // (own key change or Done/Escape closing the panel) so a stale guard is
  // never consulted once this instance's data is gone.
  useEffect(() => {
    if (!guardRef) return;
    const guard = () => {
      const kind = openQuickAddWithContent(adding, newCompany, newVenue);
      return !kind || window.confirm(`Discard the unsaved new ${kind}?`);
    };
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  });

  const run = (
    fn: () => Promise<ActionResult>,
    onSuccess?: () => void,
    setErr: (e: string | null) => void = setError
  ) =>
    start(async () => {
      setErr(null);
      setNotice(null);
      try {
        const r = await fn();
        if (!r.ok) {
          setErr(r.error || "Something went wrong.");
          return;
        }
        if (r.note) setNotice(r.note);
        onSuccess?.();
        setRev((v) => v + 1);
        router.refresh();
      } catch {
        setErr("Something went wrong — try again.");
      }
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

  const closeAdding = () => {
    setAdding(null);
    setAddError(null);
  };

  const startAdding = (p: PopupParticipant) => {
    const pre = data?.prefill && data.prefill.email === p.email ? data.prefill : null;
    const company = pre?.companyId
      ? { id: pre.companyId, name: pre.companyName }
      : companyId && vm.customerCard
        ? { id: companyId, name: vm.customerCard.name }
        : null;
    setAddError(null);
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
      setAddError("Pick the company this person works for.");
      return;
    }
    const a = adding;
    start(async () => {
      setAddError(null);
      setNotice(null);
      // #214 fix wave 2 — tracks whether quickAddContactAction actually
      // created the contact. Once it has, the form is closed and can no
      // longer show `addError`, and the reload must run even if the
      // link step below throws (not just returns !ok) — otherwise the
      // row still shows "Add" and a retry creates a duplicate contact.
      let created = false;
      try {
        const res = await quickAddContactAction({ customerId: a.company!.id, ...a.values });
        if (!res.ok) {
          setAddError(res.error || "Something went wrong.");
          return;
        }
        // #214 fix wave 1 — the contact now exists, so the form closes here
        // regardless of whether the link below succeeds: a stale open form
        // left up after a partial failure could otherwise be retried and
        // create a duplicate contact. The reload always runs so the new
        // person shows up — linked, or listed unlinked if only the link
        // step failed.
        created = true;
        closeAdding();
        const link = await setThreadContactsAction(vm.id, res.id, true);
        if (!link.ok) setError(link.error || "Added the contact, but couldn't link them to this thread.");
        else if (link.note) setNotice(link.note);
      } catch {
        // #214 fix wave 2 — a throw after `closeAdding()` ran would
        // otherwise land in `addError`, which nothing renders once the
        // form is closed. Route it to the general `error` slot instead so
        // it's actually visible.
        if (created) setError("Added the contact, but couldn't link them to this thread — try again.");
        else setAddError("Something went wrong — try again.");
      } finally {
        if (created) {
          setRev((v) => v + 1);
          router.refresh();
        }
      }
    });
  };

  const sender = data?.participants.find((p) => p.role === "from") || null;

  // "Linking from: <sender> · <date>" — straight from the reader's own
  // message so the header never waits on the load.
  const msg = vm.messages.find((m) => m.id === messageId) || null;
  const fromWho = msg?.author || sender?.name || sender?.email || "";
  const fromLabel = msg && fromWho ? `${fromWho} · ${msg.time}` : data ? data.messageLabel : "…";

  return (
    <div
      ref={panelRef}
      data-link-panel=""
      role="region"
      aria-label="Link this email"
      tabIndex={-1}
      style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, outline: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Link this email</div>
          <div style={{ ...MUTED, ...ELLIPSIS }} title={fromLabel}>
            Linking from: {fromLabel}
          </div>
        </div>
        <button
          type="button"
          style={{ ...PRIMARY, flexShrink: 0 }}
          onClick={() => {
            // #214 sidebar fix 2 — Done never silently drops a typed-but-
            // unsaved quick-add; same confirm the reader runs before
            // switching link mode to a different message.
            const kind = openQuickAddWithContent(adding, newCompany, newVenue);
            if (kind && !window.confirm(`Discard the unsaved new ${kind}?`)) return;
            onDone();
          }}
        >
          Done
        </button>
      </div>

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
                      disabled={busy}
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
                      disabled={busy}
                      onClick={() => (adding?.email === p.email ? closeAdding() : startAdding(p))}
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
                        disabled={busy}
                        onPick={(h) => setAdding({ ...adding, company: { id: h.id, name: h.label } })}
                      />
                    )}
                    <EntityQuickAdd
                      kind="contact"
                      value={adding.values}
                      onChange={(v) => setAdding({ ...adding, values: v })}
                      submitting={pending}
                      error={addError}
                      onCancel={closeAdding}
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
                      disabled={busy}
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
                      disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
                onClick={() => {
                  setNewCompany(newCompany ? null : { name: "", type: CUSTOMER_TYPES[0] || "" });
                  setCompanyError(null);
                }}
              >
                + New company
              </button>
              {companyId && (
                <button
                  type="button"
                  style={newVenue ? ACCENT_BTN : BTN}
                  disabled={busy}
                  onClick={() => {
                    // #216 — default to the first live venue type, not a hard-coded key.
                    setNewVenue(newVenue ? null : emptyVenueQuickAdd(venueTypeOptions(vm.venueTypes)[0]?.key));
                    setVenueError(null);
                  }}
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
                  error={companyError}
                  onCancel={() => {
                    setNewCompany(null);
                    setCompanyError(null);
                  }}
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
                      () => setNewCompany(null),
                      setCompanyError
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
                  venueTypes={vm.venueTypes}
                  submitting={pending}
                  error={venueError}
                  onCancel={() => {
                    setNewVenue(null);
                    setVenueError(null);
                  }}
                  onSubmit={() =>
                    run(
                      () => quickAddVenueAction({ customerId: companyId, ...newVenue, threadId: vm.id }),
                      () => setNewVenue(null),
                      setVenueError
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
                          disabled={busy}
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
                        disabled={busy}
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
      {/* #214 fix wave 1 — this is only ever set by an action with no
          form of its own (a checkbox toggle, the company/venue/person
          search, "Add missing details"); the add-contact/new-company/
          new-venue forms each read their own scoped error above. */}
      {error && <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>}

      {onCreateTask && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={BTN} onClick={onCreateTask}>
            Create task
          </button>
        </div>
      )}
    </div>
  );
}
