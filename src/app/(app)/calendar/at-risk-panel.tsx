"use client";

/**
 * Spec 2026-10-09 auto task calendar — the at-risk list with one-click
 * fixes: Push due date (to the plan's finish day), Hand off (reassign through
 * the existing path) and Unpin something (frees pinned time for the
 * scheduler). Nothing runs while another plan action is pending.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CalendarAtRisk, CalendarFuturePin } from "@/lib/task-plan/calendar-view";
import { handOffAction, pushDueDateAction, unpinBlockAction } from "./plan-actions";

type Result = { ok: true } | { ok: false; error: string };
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const BTN = { fontSize: 11.5, padding: "4px 9px" } as const;

export default function AtRiskPanel({
  items,
  futurePins,
  roster,
  showOwner,
  busy = false,
  onBusy,
}: {
  items: CalendarAtRisk[];
  futurePins: CalendarFuturePin[];
  roster: { id: string; name: string }[];
  showOwner: boolean;
  /** Another plan action (a block drop) is in flight. */
  busy?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openUnpin, setOpenUnpin] = useState<string | null>(null);
  const [handTo, setHandTo] = useState<Record<string, string>>({});
  const off = pending || busy;

  useEffect(() => {
    onBusy?.(pending);
    return () => onBusy?.(false);
  }, [pending, onBusy]);

  // A message about the last fix goes away when the refreshed plan arrives (the refresh our own failed fix asked for doesn't count).
  const planSig = items.map((a) => `${a.itemKey}|${a.label}|${a.finishDayKey}`).join(",") + "#" + futurePins.length;
  const keepError = useRef(false);
  useEffect(() => {
    if (keepError.current) keepError.current = false;
    else setError(null);
  }, [planSig]);

  if (!items.length) return null;

  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      let r: Result;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: "Couldn't save — try again." };
      }
      if (!r.ok) {
        keepError.current = true;
        setError(r.error);
      }
      router.refresh();
    });

  return (
    <section className="pk-card" aria-label="At risk" style={{ padding: "12px 14px", marginBottom: 14, borderLeft: "3px solid #b4543a" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#8a3a2a", marginBottom: 6 }}>At risk ({items.length})</div>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "#a03b2e", marginBottom: 6 }}>
          {error}{" "}
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 11, padding: 0, marginLeft: 2 }}>
            ✕
          </button>
        </div>
      )}
      {items.map((a) => {
        const others = roster.filter((u) => u.id !== a.userId);
        const pins = futurePins.filter((p) => p.userId === a.userId && p.canUnpin);
        // A stored pick only counts while that person is still on the list (a roster change or a handed-off item clears it).
        const target = others.some((u) => u.id === handTo[a.itemKey]) ? handTo[a.itemKey] : "";
        const day = a.finishDayKey;
        return (
          <div key={a.itemKey} style={{ borderTop: "1px solid #f3f4f7", padding: "8px 0", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {a.href ? <Link href={a.href}>{a.title}</Link> : a.title}
                {showOwner && <span style={{ color: "#8c919c", fontWeight: 500 }}> · {a.ownerName}</span>}
              </div>
              <div style={{ fontSize: 11, color: "#b4543a" }}>
                {a.label} · {a.finishText}
              </div>
            </div>
            {day && (
              <button type="button" className="pk-btn-outline" style={BTN} disabled={off} title={a.finishText} onClick={() => run(() => pushDueDateAction({ kind: a.kind, id: a.id, dayKey: day }))}>
                Push due date
              </button>
            )}
            {others.length > 0 && (
              <span style={{ display: "inline-flex", gap: 4 }}>
                <select
                  aria-label={`Hand off ${a.title} to`}
                  value={target}
                  disabled={off}
                  onChange={(e) => setHandTo((m) => ({ ...m, [a.itemKey]: e.target.value }))}
                  style={{ fontSize: 11.5, border: "1px solid #e4e7ec", borderRadius: 7, padding: "3px 6px" }}
                >
                  <option value="">Hand off to…</option>
                  {others.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="pk-btn-outline" style={BTN} disabled={off || !target} onClick={() => run(() => handOffAction({ kind: a.kind, id: a.id, userId: target }))}>
                  Hand off
                </button>
              </span>
            )}
            {pins.length > 0 && (
              <button type="button" className="pk-btn-outline" style={BTN} aria-expanded={openUnpin === a.itemKey} onClick={() => setOpenUnpin(openUnpin === a.itemKey ? null : a.itemKey)}>
                Unpin something
              </button>
            )}
            {openUnpin === a.itemKey && (
              <ul style={{ flex: "1 0 100%", listStyle: "none", margin: 0, padding: "4px 0 0 0" }}>
                {pins.map((p) => (
                  <li key={p.itemKey + "@" + p.startMs} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, padding: "2px 0" }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      📌 {p.title} · {when(p.startMs)}
                    </span>
                    <button type="button" className="pk-btn-outline" style={BTN} disabled={off} onClick={() => run(() => unpinBlockAction({ kind: p.kind, id: p.id, startMs: p.startMs }))}>
                      Unpin
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
