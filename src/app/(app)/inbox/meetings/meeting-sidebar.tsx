"use client";

/**
 * #323 — the meeting reader's right column, laid out like the email reader's
 * link sidebar (#96 / #214): Suggested (chip + reasons + Confirm), Linked
 * (company, venue, people, work, internal — each with ✕), + Link (the Inbox
 * link-target search), a work picker over the linked company's records, the
 * internal-people picker, Mark as noise / Not noise, and Share with customer
 * / Stop sharing. Every write is a server action; a change that would stop a
 * customer share asks first and retries with `confirmUnshare`.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Typeahead } from "@/components/search/typeahead";
import { passAllFilter, stableRank } from "@/lib/search/typeahead-rank";
import type { LinkTargetHit, LinkTargetKind } from "@/lib/inbox-link-targets";
import type { MeetingLinks, MeetingSuggestion, SuggestionKind, WorkType } from "@/lib/meetings/types";
import { searchLinkTargetsAction } from "../link-popup-actions";
import { ACCENT_BTN, BODY, BTN, CARD, H, MUTED, PRIMARY, SELECT } from "../sidebar-styles";
import { INPUT } from "@/components/entity-quick-add";
import type { MeetingReaderVM } from "./load";
import {
  confirmSuggestionsAction,
  linkVenueAction,
  setLinksAction,
  setNoiseAction,
  shareWithCustomerAction,
  stopSharingAction,
  type MeetingActionResult,
} from "./actions";
import { SuggestionChip } from "./meetings-box";

type Opts = { confirmUnshare?: boolean };

/** One meeting mutation: inline error, the share guard's confirm-then-retry, then a refresh. */
export function useMeetingAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (opts: Opts) => Promise<MeetingActionResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        let r = await fn({});
        if (!r.ok && r.needsConfirm) {
          if (!window.confirm("This stops sharing it with the customer. Continue?")) return;
          r = await fn({ confirmUnshare: true });
        }
        if (!r.ok) {
          setError(r.busy ? "Sync already running — try again in a moment" : r.error);
          if (r.partial) router.refresh();
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError("Something went wrong — try again.");
      }
    });
  return { pending, error, run };
}

const KIND_META: Record<LinkTargetKind, { label: string; color: string }> = {
  company: { label: "Company", color: "#8a6d1f" },
  venue: { label: "Venue", color: "#1f7a52" },
  person: { label: "Person", color: "#3155a8" },
};

const ELLIPSIS: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** Debounced link-target search with a stale-response guard (the link panel's useLinkSearch pattern). */
export function LinkSearch({
  only,
  placeholder,
  disabled,
  onPick,
}: {
  only?: LinkTargetKind;
  placeholder: string;
  disabled?: boolean;
  onPick: (hit: LinkTargetHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTargetHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setFailed(false);
      searchLinkTargetsAction(q, only)
        .then((g) => {
          if (my !== seq.current) return;
          setResults([...g.companies, ...g.venues, ...g.people]);
          setResultQuery(q);
        })
        .catch(() => {
          if (my === seq.current) setFailed(true);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query, only]);
  const trimmed = query.trim();
  const fresh = trimmed.length >= 2 && resultQuery === trimmed;
  return (
    <Typeahead
      items={fresh ? results : []}
      keyOf={(h) => `${h.kind}:${h.id}`}
      filter={passAllFilter}
      rank={stableRank}
      render={(h) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#fff",
            padding: "2px 6px", borderRadius: 5, flexShrink: 0, background: KIND_META[h.kind].color }}>
            {KIND_META[h.kind].label}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, ...ELLIPSIS }}>{h.label}</span>
            {h.sub && <span style={{ display: "block", fontSize: 11, color: "#8c919c", ...ELLIPSIS }}>{h.sub}</span>}
          </span>
        </span>
      )}
      onPick={onPick}
      max={24}
      placeholder={placeholder}
      ariaLabel={placeholder}
      inputStyle={{ ...INPUT, padding: "8px 10px", fontSize: 12.5 }}
      emptyText={failed ? "Search failed — try again." : trimmed.length < 2 ? "Type at least 2 letters." : fresh ? "Nothing matches." : "Searching…"}
      onQueryChange={setQuery}
      disabled={disabled}
    />
  );
}

const WORK_LABEL: Record<WorkType, string> = {
  lead: "Lead", site_visit: "Site visit", survey: "Survey", project: "Project", engagement: "Engagement", quote: "Quote",
};

const X_BTN: React.CSSProperties = {
  border: "none", background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px", flexShrink: 0,
};

function LinkedRow({ kind, label, href, removed, onRemove, disabled }: {
  kind: string; label: string; href: string | null; removed: boolean; onRemove: () => void; disabled: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 10.5, color: "#aab0bb", width: 62, flexShrink: 0 }}>{kind}</span>
      {href ? (
        <a href={href} style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#16181d", textDecoration: "none", ...ELLIPSIS }}>{label}</a>
      ) : (
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: removed ? "#aab0bb" : "#16181d", ...ELLIPSIS }}>{label}</span>
      )}
      <button type="button" style={X_BTN} disabled={disabled} onClick={onRemove} title={`Unlink ${label}`} aria-label={`Unlink ${label}`}>
        ✕
      </button>
    </div>
  );
}

export default function MeetingSidebar({ vm }: { vm: MeetingReaderVM }) {
  const { pending, error, run } = useMeetingAction();
  const [workType, setWorkType] = useState<WorkType>(vm.links.work?.type ?? "lead");
  const [workFilter, setWorkFilter] = useState("");
  const [sharing, setSharing] = useState(false);
  const [draft, setDraft] = useState(vm.shareDraft);

  const L = vm.links;
  const setLinks = (patch: Partial<MeetingLinks>) => run((o) => setLinksAction(vm.id, patch, o));

  /** One suggestion. A venue carries its company: linked already, its company suggestion, else a manual link. */
  const confirmOne = (s: MeetingReaderVM["suggestions"][number]) => {
    if (s.kind === "venue") {
      const cid = s.companyId;
      if (!cid) return run(async () => ({ ok: false, error: "That venue no longer exists" }));
      if (L.company?.id !== cid) {
        const companySug = vm.suggestions.find((x) => x.kind === "company" && x.id === cid);
        if (!companySug) return run((o) => setLinksAction(vm.id, { customerId: cid, siteId: s.id }, o));
        return run((o) => confirmSuggestionsAction(vm.id, [{ kind: "company", id: cid }, { kind: "venue", id: s.id }], o));
      }
    }
    return run((o) => confirmSuggestionsAction(vm.id, [{ kind: s.kind, id: s.id }], o));
  };

  /** "Confirm suggestions": the top company, its venues, and every person / work / internal suggestion. */
  const open = vm.suggestions.filter((s) => !s.linked);
  const confirmAll = () => {
    const company = L.company?.id ?? vm.suggestions.find((s) => s.kind === "company")?.id ?? null;
    const picks: { kind: SuggestionKind; id: string }[] = open
      .filter((s) => (s.kind === "company" ? s.id === company : s.kind === "venue" ? s.companyId === company : true))
      .map((s) => ({ kind: s.kind, id: s.id }));
    if (!picks.length) return;
    run((o) => confirmSuggestionsAction(vm.id, picks, o));
  };

  const pickTarget = (h: LinkTargetHit) => {
    if (h.kind === "company") setLinks({ customerId: h.id });
    else if (h.kind === "venue") {
      if (!h.companyId) return run(async () => ({ ok: false, error: "That venue has no company" }));
      run((o) => linkVenueAction(vm.id, h.id, h.companyId!, o));
    } else if (!L.contactIds.includes(h.id)) setLinks({ contactIds: [...L.contactIds, h.id] });
  };

  const options = vm.workOptions[workType] || [];
  const filteredWork = workFilter.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(workFilter.trim().toLowerCase()))
    : options;
  const freeTeam = vm.team.filter((u) => !L.internalUserIds.includes(u.id));

  return (
    <aside
      className="ib-scroll"
      data-link-panel
      style={{
        width: 300,
        maxWidth: "100%",
        flexShrink: 0,
        borderLeft: "1px solid #ececf0",
        background: "#fafbfc",
        overflowY: "auto",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: "var(--font-ui)",
        color: "#16181d",
      }}
    >
      {/* ---- suggested ---- */}
      <div style={CARD}>
        <div style={H}>Suggested</div>
        {open.length === 0 ? (
          <div style={MUTED}>{vm.suggestions.length ? "Every suggestion is linked." : "No suggestions — link it below."}</div>
        ) : (
          <>
            {open.map((s) => (
              <SuggestionRow key={`${s.kind}:${s.id}`} s={s} disabled={pending} onConfirm={() => confirmOne(s)} />
            ))}
            {open.length > 1 && (
              <button type="button" style={{ ...PRIMARY, marginTop: 10 }} disabled={pending} onClick={confirmAll}>
                Confirm suggestions
              </button>
            )}
          </>
        )}
      </div>

      {/* ---- linked ---- */}
      <div style={CARD}>
        <div style={H}>Linked</div>
        {!L.company && !L.venue && !L.people.length && !L.work && !L.internal.length ? (
          <div style={MUTED}>Not linked yet — only you can see it.</div>
        ) : (
          <>
            {L.company && (
              <LinkedRow kind="Company" {...L.company} disabled={pending} onRemove={() => setLinks({ customerId: null, siteId: null, work: null })} />
            )}
            {L.venue && <LinkedRow kind="Venue" {...L.venue} disabled={pending} onRemove={() => setLinks({ siteId: null })} />}
            {L.people.map((p) => (
              <LinkedRow key={p.id} kind="Person" {...p} disabled={pending}
                onRemove={() => setLinks({ contactIds: L.contactIds.filter((c) => c !== p.id) })} />
            ))}
            {L.work && (
              <LinkedRow kind={L.work.typeLabel} {...L.work} disabled={pending} onRemove={() => setLinks({ work: null })} />
            )}
            {L.internal.map((u) => (
              <LinkedRow key={u.id} kind="Internal" {...u} disabled={pending}
                onRemove={() => setLinks({ internalUserIds: L.internalUserIds.filter((x) => x !== u.id) })} />
            ))}
          </>
        )}
        <div style={{ marginTop: 10 }}>
          <div style={{ ...MUTED, marginBottom: 5 }}>+ Link a company, venue or person</div>
          <LinkSearch placeholder="Search companies, venues, people…" disabled={pending} onPick={pickTarget} />
        </div>
      </div>

      {/* ---- work ---- */}
      <div style={CARD}>
        <div style={H}>Work</div>
        {!L.company || L.company.removed ? (
          <div style={MUTED}>Link a company to pick its lead, visit, survey, project, engagement or quote.</div>
        ) : (
          <>
            <select
              aria-label="Work type"
              value={workType}
              onChange={(e) => { setWorkType(e.target.value as WorkType); setWorkFilter(""); }}
              style={SELECT}
            >
              {(Object.keys(WORK_LABEL) as WorkType[]).map((t) => (
                <option key={t} value={t}>{WORK_LABEL[t]} ({vm.workOptions[t]?.length ?? 0})</option>
              ))}
            </select>
            {options.length > 8 && (
              <input
                value={workFilter}
                onChange={(e) => setWorkFilter(e.target.value)}
                placeholder="Search by number or name…"
                aria-label="Search work"
                style={{ ...INPUT, padding: "7px 10px", fontSize: 12.5, marginTop: 6 }}
              />
            )}
            <select
              aria-label="Work record"
              value={L.work?.type === workType ? L.work.id : ""}
              disabled={pending || options.length === 0}
              onChange={(e) => {
                const hit = options.find((o) => o.id === e.target.value);
                if (hit) setLinks({ work: { type: workType, id: hit.id, label: hit.label } });
              }}
              style={{ ...SELECT, marginTop: 6 }}
            >
              <option value="">{options.length ? `Pick a ${WORK_LABEL[workType].toLowerCase()}…` : `No ${WORK_LABEL[workType].toLowerCase()}s for this company`}</option>
              {filteredWork.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* ---- internal people ---- */}
      <div style={CARD}>
        <div style={H}>Internal</div>
        <div style={{ ...MUTED, marginTop: 0, marginBottom: 6 }}>Teammates who can see it while it isn&apos;t linked to a customer.</div>
        <select
          aria-label="Add a teammate"
          value=""
          disabled={pending || freeTeam.length === 0}
          onChange={(e) => e.target.value && setLinks({ internalUserIds: [...L.internalUserIds, e.target.value] })}
          style={SELECT}
        >
          <option value="">+ Add a teammate…</option>
          {freeTeam.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>

      {/* ---- noise + share ---- */}
      <div style={CARD}>
        <div style={H}>Meeting</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {vm.noise ? (
            <button type="button" style={BTN} disabled={pending} onClick={() => run(() => setNoiseAction(vm.id, false))}>
              Not noise
            </button>
          ) : vm.canMarkNoise ? (
            <button type="button" style={BTN} disabled={pending} onClick={() => run(() => setNoiseAction(vm.id, true))}>
              Mark as noise
            </button>
          ) : null}
          {vm.share ? (
            <button type="button" style={BTN} disabled={pending} onClick={() => run(() => stopSharingAction(vm.id))}>
              Stop sharing
            </button>
          ) : vm.canShare ? (
            <button type="button" style={ACCENT_BTN} disabled={pending} onClick={() => { setDraft(vm.shareDraft); setSharing(true); }}>
              Share with customer…
            </button>
          ) : null}
        </div>
        {vm.share && (
          <div style={{ ...MUTED, marginTop: 8 }}>
            🌐 {vm.share.label} — the customer sees this summary in their portal.
          </div>
        )}
        {!vm.share && !vm.canShare && vm.canCreate && <div style={{ ...MUTED, marginTop: 8 }}>Link a company to share it with the customer.</div>}
      </div>

      {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>}

      {sharing && (
        <ShareModal
          draft={draft}
          setDraft={setDraft}
          pending={pending}
          onClose={() => setSharing(false)}
          onShare={() => run(() => shareWithCustomerAction(vm.id, draft), () => setSharing(false))}
          error={error}
        />
      )}
    </aside>
  );
}

function SuggestionRow({ s, disabled, onConfirm }: { s: MeetingSuggestion; disabled: boolean; onConfirm: () => void }) {
  const kind = s.kind === "work" && s.workType ? WORK_LABEL[s.workType] : s.kind === "internal" ? "Internal" : s.kind.charAt(0).toUpperCase() + s.kind.slice(1);
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #f0f1f4" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{kind}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex" }}><SuggestionChip s={s} /></span>
        <button type="button" style={{ ...BTN, padding: "3px 8px" }} disabled={disabled} onClick={onConfirm}>
          Confirm
        </button>
      </div>
      {s.reasons.length > 0 && <div style={{ ...MUTED, fontSize: 11 }}>{s.reasons.join(" · ")}</div>}
    </div>
  );
}

function ShareModal({ draft, setDraft, pending, onClose, onShare, error }: {
  draft: string; setDraft: (v: string) => void; pending: boolean; onClose: () => void; onShare: () => void; error: string | null;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.44)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share with customer"
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, width: 560, maxWidth: "100%", padding: 18, boxShadow: "0 18px 50px rgba(0,0,0,.26)" }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>Share with customer</div>
        <div style={{ ...BODY, color: "#8c919c", marginTop: 4 }}>
          The customer sees this summary, the date and the title in their portal — never the transcript, attendees or to-dos.
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          aria-label="Summary the customer will see"
          style={{ ...INPUT, width: "100%", marginTop: 12, fontSize: 13, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
        />
        {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" style={BTN} onClick={onClose}>Cancel</button>
          <button type="button" style={PRIMARY} disabled={pending || !draft.trim()} onClick={onShare}>Share</button>
        </div>
      </div>
    </div>
  );
}
