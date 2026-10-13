"use client";

/**
 * #335 Inbox organization — the thread reader's organization strip: the
 * court chip with "Not on me" / "On me" (spec §3), the "Looks like noise" tag
 * with Not noise, the filing line with Approve / Change… (§2), and the
 * promise-task line "Task created: … · due Thu · Undo" (§7). Plain view model
 * (ReaderOrgVM) — no store imports; every change posts `postChanged("thread")`
 * on the pop-out channel (LiveSync refreshes the other windows).
 */
import { useState, useTransition } from "react";
import type { RuleOffer } from "@/lib/inbox-org/apply";
import { postChanged } from "@/lib/popout/channel";
import type { ReaderOrgVM } from "../types";
import {
  approveFilingAction,
  notNoiseAction,
  overrideCourtAction,
  undoFilingAction,
  undoPromiseTaskAction,
} from "../organize-actions";
import ChangeFiling from "./change-filing";
import RuleOfferBanner from "./rule-offer";

const COURT_COLORS: Record<string, [string, string, string]> = {
  me: ["#b4543a", "#f8ece7", "#eccfc4"],
  teammate: ["#3155a8", "#e9eefb", "#d4ddf3"],
  customer: ["#8a6d1f", "#fbf3dd", "#f0e2bd"],
  nobody: ["#1f7a52", "#eaf6ef", "#cce9da"],
};

const LINK_BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "color-mix(in srgb, var(--accent) 68%, #000)",
  background: "transparent",
  border: "none",
  padding: "2px 4px",
  cursor: "pointer",
};
const SMALL_BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "3px 8px",
  cursor: "pointer",
};

function Pill({ colors: [ink, soft, bd], children, title }: { colors: [string, string, string]; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color: ink,
        background: soft,
        border: `1px solid ${bd}`,
        padding: "2px 9px",
        borderRadius: 20,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export default function ReaderOrgStrip({ threadId, org }: { threadId: string; org: ReaderOrgVM }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [offer, setOffer] = useState<RuleOffer | null>(null);
  const [changing, setChanging] = useState(false);

  const run = (
    fn: () => Promise<{ ok: true; ruleOffer?: RuleOffer | null } | { ok: false; message: string }>,
    done: string
  ) =>
    start(async () => {
      setNote(null);
      try {
        const r = await fn();
        if (!r.ok) setNote({ text: r.message, bad: true });
        else {
          postChanged("thread", threadId);
          setNote({ text: done, bad: false });
          if (r.ruleOffer) setOffer(r.ruleOffer);
        }
      } catch {
        setNote({ text: "Something went wrong — try again.", bad: true });
      }
    });

  const { court, noise, filing, promise } = org;
  const showFiling = !!filing && (filing.state === "suggested" || filing.state === "filed") && !(filing.suggestion === "Noise" && noise?.moved);

  return (
    <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }} aria-label="Organization" role="group">
      {(court || noise) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {court && (
            <>
              <Pill colors={COURT_COLORS[court.owner] || COURT_COLORS.nobody} title={court.reason || undefined}>
                {court.label}
              </Pill>
              {court.owner === "me" ? (
                <button type="button" style={SMALL_BTN} disabled={pending} onClick={() => run(() => overrideCourtAction(threadId, "nobody"), "Marked not on you")}>
                  Not on me
                </button>
              ) : (
                <button type="button" style={SMALL_BTN} disabled={pending} onClick={() => run(() => overrideCourtAction(threadId, "me"), "Marked on you")}>
                  On me
                </button>
              )}
            </>
          )}
          {noise && (
            <>
              <Pill colors={["#5b616e", "#f1f2f5", "#e4e7ec"]} title={noise.reason || undefined}>
                {noise.moved ? "Noise" : "Looks like noise"}
              </Pill>
              <button type="button" style={SMALL_BTN} disabled={pending} onClick={() => run(() => notNoiseAction(threadId), "Not noise — back in your inbox")}>
                Not noise
              </button>
            </>
          )}
        </div>
      )}

      {showFiling && filing && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12, color: "#5b616e" }}>
          {filing.state === "suggested" ? (
            <>
              <span>File under</span>
              <b style={{ color: "#26292f" }}>{filing.suggestion || "—"}</b>
              <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>{filing.strength === "strong" ? "Strong" : "Weak"}</span>
              <button
                type="button"
                style={{ ...SMALL_BTN, color: "#fff", background: "var(--accent)", border: "1px solid transparent" }}
                disabled={pending || !filing.canApprove}
                onClick={() => run(() => approveFilingAction(threadId), "Filed")}
              >
                Approve
              </button>
              <button type="button" style={SMALL_BTN} disabled={pending} onClick={() => setChanging((v) => !v)} aria-expanded={changing}>
                Change…
              </button>
            </>
          ) : (
            <>
              <span>Filed under</span>
              <b style={{ color: "#26292f" }}>{filing.suggestion || "—"}</b>
              <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>{filing.filedBy}</span>
              <button type="button" style={LINK_BTN} disabled={pending} onClick={() => run(() => undoFilingAction(threadId), "Filing undone")}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
      {showFiling && filing?.reason && filing.state === "suggested" && <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>{filing.reason}</div>}
      {changing && (
        <ChangeFiling
          threadId={threadId}
          onCancel={() => setChanging(false)}
          onDone={(r) => {
            setChanging(false);
            setNote({ text: r.message, bad: false });
            if (r.ruleOffer) setOffer(r.ruleOffer);
          }}
        />
      )}

      {promise && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 12, color: "#5b616e" }}>
          <span>Task created:</span>
          <b style={{ color: "#26292f" }}>{promise.title}</b>
          {promise.due && <span>· {promise.due}</span>}
          {!promise.open && <span>· done</span>}
          {promise.open && (
            <>
              <span>·</span>
              <button
                type="button"
                style={LINK_BTN}
                disabled={pending}
                aria-label={`Undo task ${promise.title}`}
                onClick={() => run(() => undoPromiseTaskAction(threadId, promise.taskId), "Task removed")}
              >
                Undo
              </button>
            </>
          )}
        </div>
      )}

      {offer && (
        <RuleOfferBanner
          offer={offer}
          threadId={threadId}
          isAdmin={org.isAdmin}
          onClose={() => setOffer(null)}
          onSaved={(text) => {
            setOffer(null);
            setNote({ text, bad: false });
          }}
        />
      )}
      {note && (
        <div role="status" style={{ fontSize: 11.5, color: note.bad ? "#b4543a" : "#5b616e" }}>
          {note.text}
        </div>
      )}
    </div>
  );
}
