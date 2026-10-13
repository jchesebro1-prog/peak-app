"use client";

/**
 * #335 §6 — "Organize my inbox" (Assist pilot only): loops the budgeted
 * cleanup batch (organizeInboxAction, 40 s each) while it isn't done,
 * showing "212 of 480 checked", then the run's counts. Re-runnable; a run
 * left half-done (tab closed) resumes on the next press.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CleanupVM } from "@/lib/inbox-org/cleanup";
import { postChanged } from "@/lib/popout/channel";
import { organizeInboxAction } from "../organize-actions";
import { cleanupProgressText, cleanupSummaryText } from "./format";

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

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });

function lastRunLine(c: CleanupVM | null): string | null {
  if (!c) return null;
  if (c.done && c.summary) return `Last run ${DAY.format(new Date(c.doneAt || c.startedAt))} — ${cleanupSummaryText(c.summary).replace(/^Done: /, "")}`;
  if (!c.done) return `Stopped at ${cleanupProgressText(c.checked, c.total)} — press to continue`;
  return null;
}

export default function CleanupButton({ cleanup }: { cleanup: CleanupVM | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [line, setLine] = useState<{ text: string; bad: boolean } | null>(null);

  const go = () =>
    start(async () => {
      setLine({ text: "Starting…", bad: false });
      let lastChecked = -1;
      try {
        for (;;) {
          const r = await organizeInboxAction();
          if (!r.ok) {
            setLine({ text: r.error, bad: true });
            break;
          }
          if (r.done) {
            setLine({ text: r.summary ? cleanupSummaryText(r.summary) : "Done.", bad: false });
            break;
          }
          if (r.checked === lastChecked) {
            setLine({ text: `Stopped at ${cleanupProgressText(r.checked, r.total)} — press again to continue`, bad: true });
            break;
          }
          lastChecked = r.checked;
          setLine({ text: cleanupProgressText(r.checked, r.total), bad: false });
        }
      } catch {
        setLine({ text: "Stopped — press Organize my inbox to continue where it left off.", bad: true });
      }
      postChanged("inbox");
      router.refresh();
    });

  const idle = lastRunLine(cleanup);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        style={{ ...BTN, opacity: pending ? 0.6 : 1 }}
        disabled={pending}
        onClick={go}
        title="Suggest a filing for every inbox thread from the last 90 days — nothing is filed until you approve it"
      >
        {pending ? "Organizing…" : "Organize my inbox"}
      </button>
      {(line || idle) && (
        <span role="status" style={{ fontSize: 11.5, color: line?.bad ? "#b4543a" : "#5b616e" }}>
          {line ? line.text : idle}
        </span>
      )}
    </span>
  );
}
