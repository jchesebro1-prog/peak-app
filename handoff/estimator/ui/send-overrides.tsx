/**
 * Estimator handoff — bundle-time replacement for src/app/(app)/estimator/steps/send-activity.tsx
 * (esbuild-plugins.ts APP_OVERRIDES; this module exports the same name and props).
 *
 * The Activity card is the app's own `SendActivity`, unchanged: its emails come from `sendTrackAction`
 * (runtime/actions/send-actions.ts), each one reading "Sent (simulated)". Below it, the prototype adds what
 * Quartzite would have done on its own — today the `onWon` port's note ("Would create install project for …")
 * — read from the store's `activity` rows for this quote, newest first. It re-reads on mount, when the card's
 * `refreshKey` changes (a send) and on every router refresh (a status change runs one). Plan: PR 2 Task 6.
 */
import { useEffect, useState, type ComponentProps, type CSSProperties } from "react";
import { SendActivity as AppSendActivity } from "@/app/(app)/estimator/steps/send-activity";
import { activityTime } from "@/lib/estimate-email/send-ui";
import { configuredStore } from "../runtime/ports";
import { onRefresh } from "../runtime/router";

/** One prototype-only activity row (the onWon port's kind "won"). */
export type PrototypeNote = { id: string; kind: string; at: number; by?: string; quoteId: string; note?: string };

/** The rows the log shows for one quote: anything but the email rows (those are the card's), newest first. Pure. */
export function prototypeNotesFor(rows: readonly PrototypeNote[], quoteId: string): PrototypeNote[] {
  return rows
    .filter((r) => r && r.quoteId === quoteId && r.kind !== "email" && typeof r.note === "string" && r.note)
    .slice()
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

export const PROTOTYPE_LOG_TITLE = "Prototype log — what Quartzite would do";
const KIND_LABEL: Record<string, string> = { won: "Marked Won" };

const SMALL: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };

function PrototypeLog({ quoteId, refreshKey }: { quoteId: string; refreshKey: number }) {
  const [notes, setNotes] = useState<PrototypeNote[]>([]);
  useEffect(() => {
    const store = configuredStore();
    if (!store) return;
    let live = true;
    const load = () =>
      store.all<PrototypeNote>("activity").then(
        (rows) => {
          if (live) setNotes(prototypeNotesFor(rows, quoteId));
        },
        (e: unknown) => console.error("[handoff] activity log: read failed", e),
      );
    void load();
    const off = onRefresh(() => void load());
    return () => {
      live = false;
      off();
    };
  }, [quoteId, refreshKey]);
  if (!notes.length) return null;
  return (
    <div data-handoff-activity-log="" style={{ marginTop: 14, borderTop: "1px solid #f0f1f4", paddingTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 8 }}>{PROTOTYPE_LOG_TITLE}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {notes.map((n) => (
          <div key={n.id} style={{ borderRadius: 8, padding: "7px 10px", background: "#f7f8fa", borderLeft: "3px solid #e4e6eb" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, color: "#6b7079" }}>
              <span style={{ fontWeight: 700, color: "#5b616e" }}>{KIND_LABEL[n.kind] ?? n.kind}</span>
              {n.by && <span>{n.by}</span>}
              <span>· {activityTime(n.at)}</span>
            </div>
            <div style={{ ...SMALL, color: "#16181d", marginTop: 3 }}>{n.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SendActivity(props: ComponentProps<typeof AppSendActivity>) {
  return (
    <>
      <AppSendActivity {...props} />
      <PrototypeLog quoteId={props.quoteId} refreshKey={props.refreshKey} />
    </>
  );
}
