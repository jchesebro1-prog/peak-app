"use client";

/**
 * #335 Inbox organization — the Organize view (spec §2): To file · Noise ·
 * Filed. Sits in the Inbox list column (the shell owns the column and its
 * narrow box picker); a row's sender/subject opens the ordinary thread reader
 * beside it (`?view=organize&tab=…&thread=<id>`). Plain view models from
 * load.ts (types only) — no store imports. Every change posts
 * `inbox-changed` on BroadcastChannel("peak") (spec §9); the actions
 * revalidate this page themselves.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import type { RuleOffer } from "@/lib/inbox-org/apply";
import { postInboxChanged } from "@/lib/inbox-org/broadcast";
import type { OrganizeRowVM, OrganizeVM } from "./load";
import { FILED_CAP, FILED_DAYS, organizeHref, type OrganizeTab } from "./format";
import {
  approveAllStrongAction,
  approveFilingAction,
  markNoiseAction,
  notNoiseAction,
  skipFilingAction,
  undoFilingAction,
} from "../organize-actions";
import { bulkArchiveAction } from "../actions";
import ChangeFiling from "./change-filing";
import RuleOfferBanner from "./rule-offer";
import CleanupButton from "./cleanup-button";
import type { CleanupVM } from "@/lib/inbox-org/cleanup";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

const TABS: { key: OrganizeTab; label: string }[] = [
  { key: "to-file", label: "To file" },
  { key: "noise", label: "Noise" },
  { key: "filed", label: "Filed" },
];

const BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "4px 9px",
  cursor: "pointer",
};
const PRIMARY: React.CSSProperties = { ...BTN, color: "#fff", background: "var(--accent)", border: "1px solid transparent" };

type Note = { text: string; bad: boolean };
type Offer = { offer: RuleOffer; threadId: string };

export default function OrganizeBox({
  vm,
  selectedId,
  cleanup = null,
}: {
  vm: OrganizeVM;
  selectedId: string | null;
  /** "Organize my inbox" (spec §6) — set only for Assist pilot users */
  cleanup?: { state: CleanupVM | null } | null;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tab = vm.tab;
  const count = tab === "to-file" ? vm.counts.toFile : tab === "noise" ? vm.counts.noise : vm.counts.filed;

  /** One row action: run it, post the change, show the note (and the offer). */
  const act = (
    id: string,
    fn: () => Promise<{ ok: true; ruleOffer?: RuleOffer | null } | { ok: false; message: string }>,
    done: string
  ) =>
    start(async () => {
      setNote(null);
      setBusyId(id);
      try {
        const r = await fn();
        if (!r.ok) setNote({ text: r.message, bad: true });
        else {
          postInboxChanged(id);
          setNote({ text: done, bad: false });
          if (r.ruleOffer) setOffer({ offer: r.ruleOffer, threadId: id });
        }
      } catch {
        setNote({ text: "Something went wrong — try again.", bad: true });
      } finally {
        setBusyId(null);
      }
    });

  const approveAll = () =>
    start(async () => {
      setNote(null);
      setConfirmAll(false);
      try {
        const r = await approveAllStrongAction(vm.strongIds);
        postInboxChanged("");
        setNote({
          text: `Approved ${r.approved}${r.skipped ? ` · ${r.skipped} left` : ""}${r.more ? " — press again for the rest" : ""}`,
          bad: false,
        });
      } catch {
        setNote({ text: "Something went wrong — try again.", bad: true });
      }
    });

  const archiveShown = () =>
    start(async () => {
      setNote(null);
      try {
        await bulkArchiveAction(vm.noiseInInboxIds);
        for (const id of vm.noiseInInboxIds) postInboxChanged(id);
        setNote({ text: `Archived ${vm.noiseInInboxIds.length}`, bad: false });
      } catch {
        setNote({ text: "Something went wrong — try again.", bad: true });
      }
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, fontFamily: "var(--font-ui)" }}>
      <div style={{ padding: "11px 15px 10px", borderBottom: "1px solid #f0f1f4", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>Organize</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#aab0bb" }}>{count}</span>
        </div>
        <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 1 }}>
          {tab === "to-file"
            ? "File each thread to a customer — or tell it it's noise"
            : tab === "noise"
              ? "Flagged as noise — newsletters, promotions, notifications — newest first"
              : `Filed in the last ${FILED_DAYS} days`}
        </div>
        {cleanup && (
          <div style={{ marginTop: 8 }}>
            <CleanupButton cleanup={cleanup.state} />
          </div>
        )}

        {tab === "to-file" && (
          <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap", alignItems: "center" }}>
            {!confirmAll ? (
              <button
                type="button"
                style={{ ...PRIMARY, opacity: vm.strongIds.length && !pending ? 1 : 0.5 }}
                disabled={pending || vm.strongIds.length === 0}
                onClick={() => setConfirmAll(true)}
                title={vm.strongIds.length ? "Approve every strong suggestion" : "No strong suggestions"}
              >
                Approve all strong{vm.strongIds.length ? ` (${vm.strongIds.length})` : ""}
              </button>
            ) : (
              <span role="group" aria-label="Confirm approve all" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                Approve {vm.strongIds.length} strong suggestion{vm.strongIds.length === 1 ? "" : "s"}?
                <button type="button" style={PRIMARY} disabled={pending} onClick={approveAll}>
                  Approve {vm.strongIds.length}
                </button>
                <button type="button" style={BTN} disabled={pending} onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
              </span>
            )}
          </div>
        )}
        {tab === "noise" && (
          <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
            <button
              type="button"
              style={BTN}
              disabled={pending || vm.noiseInInboxIds.length === 0}
              onClick={archiveShown}
              title={vm.noiseInInboxIds.length ? "Archive the noise still in your inbox" : "Everything shown is already out of your inbox"}
            >
              Archive all shown{vm.noiseInInboxIds.length ? ` (${vm.noiseInInboxIds.length})` : ""}
            </button>
          </div>
        )}

        {note && (
          <div role="status" style={{ fontSize: 11.5, marginTop: 7, color: note.bad ? "#b4543a" : "#5b616e" }}>
            {note.text}
          </div>
        )}
        {offer && (
          <div style={{ marginTop: 8 }}>
            <RuleOfferBanner
              offer={offer.offer}
              threadId={offer.threadId}
              isAdmin={vm.isAdmin}
              onClose={() => setOffer(null)}
              onSaved={(text) => {
                setOffer(null);
                setNote({ text, bad: false });
              }}
            />
          </div>
        )}

        <nav aria-label="Organize" style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {TABS.map((t) => {
            const on = t.key === tab;
            const n = t.key === "to-file" ? vm.counts.toFile : t.key === "noise" ? vm.counts.noise : vm.counts.filed;
            return (
              <Link
                key={t.key}
                aria-current={on ? "page" : undefined}
                href={organizeHref(vm.baseHref, t.key)}
                style={{
                  fontSize: 12,
                  fontWeight: on ? 600 : 500,
                  padding: "4px 10px",
                  borderRadius: 999,
                  textDecoration: "none",
                  color: on ? ACCENT_INK : "#5b616e",
                  background: on ? ACCENT_SOFT : "#fff",
                  border: on ? "1px solid var(--accent)" : "1px solid #e8eaee",
                }}
              >
                {t.label}
                {n > 0 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, marginLeft: 5 }}>{n}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="ib-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {vm.rows.length === 0 ? (
          <Empty tab={tab} />
        ) : (
          <>
            {vm.rows.map((r) => (
              <Row
                key={r.id}
                r={r}
                tab={tab}
                selected={r.id === selectedId}
                busy={busyId === r.id}
                disabled={pending}
                changing={changing === r.id}
                onApprove={() => act(r.id, () => approveFilingAction(r.id), r.suggestion === "Noise" ? "Moved to Noise" : "Filed")}
                onChange={() => setChanging(changing === r.id ? null : r.id)}
                onChanged={(res) => {
                  setChanging(null);
                  setNote({ text: res.message, bad: false });
                  if (res.ruleOffer) setOffer({ offer: res.ruleOffer, threadId: r.id });
                }}
                onNoise={() => act(r.id, () => markNoiseAction(r.id), "Moved to Noise")}
                onSkip={() => act(r.id, () => skipFilingAction(r.id), "Skipped — it comes back on new mail")}
                onNotNoise={() => act(r.id, () => notNoiseAction(r.id), "Back in your inbox")}
                onUndo={() => act(r.id, () => undoFilingAction(r.id), "Undone — back in To file")}
              />
            ))}
            {tab === "filed" && vm.counts.filed > vm.rows.length && (
              <div style={{ padding: "10px 18px", fontSize: 11.5, color: "#9aa0ab" }}>
                Showing {Math.min(FILED_CAP, vm.rows.length)} of {vm.counts.filed}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Chip({ children, strong, title }: { children: React.ReactNode; strong?: boolean; title?: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10.5,
        fontWeight: 600,
        padding: "0 7px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        flexShrink: 0,
        color: strong ? ACCENT_INK : "#5b616e",
        background: strong ? ACCENT_SOFT : "#fff",
        border: strong ? "1px solid var(--accent)" : "1px dashed #c9ccd3",
      }}
    >
      {children}
    </span>
  );
}

function Row({
  r,
  tab,
  selected,
  busy,
  disabled,
  changing,
  onApprove,
  onChange,
  onChanged,
  onNoise,
  onSkip,
  onNotNoise,
  onUndo,
}: {
  r: OrganizeRowVM;
  tab: OrganizeTab;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  changing: boolean;
  onApprove: () => void;
  onChange: () => void;
  onChanged: (res: { ruleOffer: RuleOffer | null; message: string }) => void;
  onNoise: () => void;
  onSkip: () => void;
  onNotNoise: () => void;
  onUndo: () => void;
}) {
  return (
    <div
      className="ib-row"
      data-thread-id={r.id}
      style={{
        padding: "9px 15px 9px 18px",
        borderBottom: "1px solid #f5f6f8",
        background: selected ? "color-mix(in srgb, var(--accent) 9%, #fff)" : "#fff",
        boxShadow: selected ? "inset 3px 0 0 var(--accent)" : undefined,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Link href={r.href} style={{ display: "block", textDecoration: "none", color: "inherit" }} aria-label={`Open ${r.subject}`}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {tab === "to-file" && r.needsReply && (
            <span
              title="Needs a reply"
              aria-label="Needs a reply"
              role="img"
              style={{ width: 7, height: 7, borderRadius: "50%", background: "#b4543a", flexShrink: 0 }}
            />
          )}
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "#26292f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.sender}
          </span>
          <span style={{ fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{r.when}</span>
        </span>
        <span style={{ display: "block", fontSize: 12, color: "#5b616e", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.subject}
        </span>
      </Link>

      {tab !== "noise" && (
        <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: r.suggestion ? "#26292f" : "#9aa0ab", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {r.suggestion || "No suggestion yet"}
          </span>
          {tab === "to-file" && <Chip strong={r.strength === "strong"}>{r.strength === "strong" ? "Strong" : "Weak"}</Chip>}
          {tab === "to-file" && r.archived && <Chip title="Archived when you replied — still waiting to be filed">Archived</Chip>}
          {tab === "filed" && (
            <span style={{ fontSize: 11, color: "#9aa0ab" }}>
              Filed · {r.filedBy}
              {r.filedWhen ? ` · ${r.filedWhen}` : ""}
            </span>
          )}
        </span>
      )}
      {r.reason && <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>{r.reason}</div>}

      <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
        {tab === "to-file" && (
          <>
            <button type="button" style={PRIMARY} disabled={disabled || !r.canApprove} onClick={onApprove} title={r.canApprove ? undefined : "Nothing to file under yet — use Change…"}>
              Approve
            </button>
            <button type="button" style={BTN} disabled={disabled} onClick={onChange} aria-expanded={changing}>
              Change…
            </button>
            <button type="button" style={BTN} disabled={disabled} onClick={onNoise}>
              Noise
            </button>
            <button type="button" style={BTN} disabled={disabled} onClick={onSkip}>
              Skip
            </button>
          </>
        )}
        {tab === "noise" && (
          <button type="button" style={BTN} disabled={disabled} onClick={onNotNoise}>
            Not noise
          </button>
        )}
        {tab === "filed" && (
          <button type="button" style={BTN} disabled={disabled} onClick={onUndo}>
            Undo
          </button>
        )}
      </div>
      {changing && (
        <div style={{ marginTop: 8 }}>
          <ChangeFiling threadId={r.id} onDone={onChanged} onCancel={onChange} />
        </div>
      )}
    </div>
  );
}

function Empty({ tab }: { tab: OrganizeTab }) {
  const [title, sub] =
    tab === "to-file"
      ? ["Nothing to file", "Suggestions for new mail land here until you approve them."]
      : tab === "noise"
        ? ["No noise", "Newsletters, promotions and notifications flagged as noise land here."]
        : ["Nothing filed lately", `Threads filed in the last ${FILED_DAYS} days show up here.`];
  return (
    <div style={{ padding: "40px 24px", textAlign: "center", color: "#9aa0ab" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#5b616e" }}>{title}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>
    </div>
  );
}
