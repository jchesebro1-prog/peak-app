"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { saveThroughOutbox } from "@/lib/sync/save";
import { getEngine } from "@/lib/sync/engine";
import {
  INTERESTS,
  INTEREST_LABEL,
  TEMPERATURES,
  newCaptureId,
  sanitizeCapture,
  type BoothCapture,
  type Interest,
  type Temperature,
} from "@/lib/booth/capture";
import { saveBoothCaptureAction } from "./actions";

/* Booth mode: type a visitor in, Save & next. Saves go through the offline outbox (saveThroughOutbox), so with no
 * signal a capture queues on the device and syncs on reconnect. The whole capture document is minted here (id,
 * timestamps); the server takes "captured by" from the signed-in user and ignores the payload's. */

type Recent = Pick<BoothCapture, "id" | "firstName" | "lastName" | "company" | "temperature" | "capturedAt" | "leadId" | "outcome" | "showId">;
type Row = Recent & { status: "synced" | "waiting" | "error"; error?: string; /** went through the outbox on this device */ queued?: boolean };

const EMPTY = { firstName: "", lastName: "", email: "", phone: "", company: "", title: "", notes: "" };
type Fields = typeof EMPTY;

const TAP: CSSProperties = { minHeight: 44 };
const FIELD: CSSProperties = { display: "grid", gap: 0 };

function randHex16(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fullName(r: Pick<Recent, "firstName" | "lastName">): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unnamed";
}

export default function BoothForm(props: {
  shows: { id: string; name: string }[];
  activeShowId: string | null;
  me: { id: string; name: string };
  recent: Recent[];
  scanAvailableHint: boolean;
}) {
  const uid = useId();
  const [showId, setShowId] = useState<string | null>(props.activeShowId);
  const [f, setF] = useState<Fields>(EMPTY);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [temperature, setTemperature] = useState<Temperature | null>(null);
  const [cardImage, setCardImage] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<Row[]>([]);
  const firstRef = useRef<HTMLInputElement>(null);

  // Seed with this device's queued captures (a reload or PWA relaunch while offline must not lose the "Waiting to
  // sync" rows). Rows that already exist (saved before the read finished) win.
  useEffect(() => {
    let alive = true;
    void getEngine()
      .outboxEntries("booth_captures")
      .then((entries) => {
        if (!alive || entries.length === 0) return;
        setLocal((cur) => {
          const have = new Set(cur.map((r) => r.id));
          const seeded: Row[] = entries
            .filter((e) => !have.has(e.id))
            .map((e) => {
              const d = e.doc;
              const s = (v: unknown) => (typeof v === "string" ? v : "");
              return {
                id: e.id,
                firstName: s(d.firstName),
                lastName: s(d.lastName),
                company: s(d.company),
                temperature: (TEMPERATURES as readonly unknown[]).includes(d.temperature) ? (d.temperature as Temperature) : null,
                capturedAt: typeof d.capturedAt === "number" ? d.capturedAt : 0,
                showId: typeof d.showId === "string" ? d.showId : null,
                status: e.state === "error" ? ("error" as const) : ("waiting" as const),
                ...(e.state === "error" ? { error: e.error || "Couldn't sync" } : {}),
                queued: true,
              };
            });
          return seeded.length ? [...cur, ...seeded] : cur;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Rows queued on this device that haven't synced (waiting or parked in error): re-check the outbox on every engine
  // change. An entry that is gone has synced; one in "error" shows its message; a pending one is waiting again.
  // Functional updates, so a save that lands mid-check isn't lost.
  const watchKey = local.filter((r) => r.queued && r.status !== "synced").map((r) => r.id).join(",");
  useEffect(() => {
    if (!watchKey) return;
    const watchIds = watchKey.split(",");
    const engine = getEngine();
    let alive = true;
    const check = async () => {
      const found = new Map<string, "synced" | "waiting" | { error: string }>();
      for (const id of watchIds) {
        const e = await engine.outboxEntry("booth_captures", id);
        if (!e) found.set(id, "synced");
        else if (e.state === "pending") found.set(id, "waiting");
        else found.set(id, { error: e.error || "Couldn't sync" });
      }
      if (!alive) return;
      setLocal((cur) =>
        cur.map((r) => {
          const v = found.get(r.id);
          if (!v || r.status === "synced") return r;
          if (v === "synced") return { ...r, status: "synced" as const, error: undefined };
          if (v === "waiting") return r.status === "waiting" ? r : { ...r, status: "waiting" as const, error: undefined };
          return r.status === "error" && r.error === v.error ? r : { ...r, status: "error" as const, error: v.error };
        }),
      );
    };
    const off = engine.subscribe(() => void check());
    return () => {
      alive = false;
      off();
    };
  }, [watchKey]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const id = newCaptureId(randHex16);
    const capturedAt = Date.now();
    const doc: Record<string, unknown> = {
      id,
      via: "booth",
      showId,
      ...f,
      interests,
      temperature,
      ...(cardImage ? { cardImage } : {}),
      capturedAt,
      capturedById: props.me.id,
      capturedByName: props.me.name,
      rev: 1,
    };
    // Same rules the server applies, so an offline save can't queue a doc the server will refuse.
    const check = sanitizeCapture(doc);
    if (!check.ok) return setError(check.error);
    setSaving(true);
    setError("");
    // The action's lead link / outcome, captured through the closure (saveThroughOutbox only needs ok/error).
    const landed: { leadId?: string; outcome?: "created" | "merged"; refusal?: string } = {};
    try {
      const { queued } = await saveThroughOutbox({
        collection: "booth_captures",
        id,
        doc,
        action: async () => {
          const r = await saveBoothCaptureAction(doc);
          if (r.ok) {
            landed.leadId = r.leadId;
            landed.outcome = r.outcome;
            return { ok: true };
          }
          landed.refusal = r.error;
          return r;
        },
        timeoutMs: 8000,
      });
      setLocal((l) => [
        {
          id,
          firstName: f.firstName,
          lastName: f.lastName,
          company: f.company,
          temperature,
          capturedAt,
          showId,
          status: queued ? "waiting" : "synced",
          queued,
          ...(!queued && landed.leadId ? { leadId: landed.leadId, outcome: landed.outcome } : {}),
        },
        ...l,
      ]);
      setF(EMPTY);
      setInterests([]);
      setTemperature(null);
      setCardImage(undefined);
      firstRef.current?.focus();
    } catch {
      // A refusal the server worded ({ok:false}) keeps its text; anything else thrown is the connection or a crash.
      setError(landed.refusal ?? "Couldn't save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // A server row for a local id (after a refresh) carries the lead link and outcome; it wins over a synced local row.
  const serverById = new Map(props.recent.map((r) => [r.id, r]));
  const localRows: Row[] = local.map((r) => {
    const sv = serverById.get(r.id);
    return sv && r.status === "synced" ? { ...r, leadId: sv.leadId ?? r.leadId, outcome: sv.outcome ?? r.outcome } : r;
  });
  const server: Row[] = props.recent
    .filter((r) => r.showId === showId && !local.some((l) => l.id === r.id))
    .map((r) => ({ ...r, status: "synced" as const }));
  const rows = [...localRows.filter((r) => r.showId === showId), ...server].sort((a, b) => b.capturedAt - a.capturedAt);
  const showName = props.shows.find((s) => s.id === showId)?.name;
  const fid = (k: string) => `${uid}-${k}`;

  return (
    <div className="pk-content" style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: 18 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <div className="pk-page-title">Booth mode</div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("show")}>Show</label>
          <select id={fid("show")} className="pk-input" style={TAP} value={showId ?? ""} onChange={(e) => setShowId(e.target.value || null)}>
            <option value="">No show</option>
            {props.shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {!props.activeShowId ? (
          <div className="pk-page-sub" style={{ marginTop: 0 }}>
            No active show — set one on <Link href="/leads/shows">Shows</Link>.
          </div>
        ) : null}
      </header>

      <form onSubmit={save} className="pk-card" style={{ display: "grid", gap: 12, padding: 16 }}>
        {/* Scan card: Task 10 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={FIELD}>
            <label className="pk-field-label" htmlFor={fid("first")}>First name</label>
            <input id={fid("first")} ref={firstRef} className="pk-input" style={TAP} value={f.firstName} onChange={set("firstName")} autoComplete="off" />
          </div>
          <div style={FIELD}>
            <label className="pk-field-label" htmlFor={fid("last")}>Last name</label>
            <input id={fid("last")} className="pk-input" style={TAP} value={f.lastName} onChange={set("lastName")} autoComplete="off" />
          </div>
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("email")}>Email</label>
          <input id={fid("email")} type="email" className="pk-input" style={TAP} value={f.email} onChange={set("email")} autoComplete="off" inputMode="email" />
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("phone")}>Phone</label>
          <input id={fid("phone")} type="tel" className="pk-input" style={TAP} value={f.phone} onChange={set("phone")} autoComplete="off" />
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("company")}>Organization / venue</label>
          <input id={fid("company")} className="pk-input" style={TAP} value={f.company} onChange={set("company")} autoComplete="off" />
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("title")}>Title</label>
          <input id={fid("title")} className="pk-input" style={TAP} value={f.title} onChange={set("title")} autoComplete="off" />
        </div>
        <div role="group" aria-labelledby={fid("interests")} style={FIELD}>
          <div className="pk-field-label" id={fid("interests")}>Interested in</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {INTERESTS.map((k) => {
              const on = interests.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className="pk-btn-outline"
                  aria-pressed={on}
                  style={{ ...TAP, padding: "0 14px", ...(on ? { borderColor: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--accent)" } : null) }}
                  onClick={() => setInterests(on ? interests.filter((x) => x !== k) : [...interests, k])}
                >
                  {INTEREST_LABEL[k]}
                </button>
              );
            })}
          </div>
        </div>
        <div role="group" aria-labelledby={fid("temp")} style={FIELD}>
          <div className="pk-field-label" id={fid("temp")}>Temperature</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {TEMPERATURES.map((t) => {
              const on = temperature === t;
              return (
                <button
                  key={t}
                  type="button"
                  className="pk-btn-outline"
                  aria-pressed={on}
                  style={{ ...TAP, ...(on ? { borderColor: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--accent)" } : null) }}
                  onClick={() => setTemperature(on ? null : t)}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              );
            })}
          </div>
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("notes")}>Notes</label>
          <textarea id={fid("notes")} className="pk-input" rows={3} value={f.notes} onChange={set("notes")} />
        </div>
        {cardImage ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span>Card photo attached ✓</span>
            <button type="button" className="pk-btn-outline" style={TAP} onClick={() => setCardImage(undefined)}>
              Remove
            </button>
          </div>
        ) : null}
        {error ? (
          <div role="alert" style={{ color: "#b42318", fontSize: 13 }}>
            {error}
          </div>
        ) : null}
        <button type="submit" className="pk-btn-accent" style={{ ...TAP, fontSize: 15 }} disabled={saving}>
          {saving ? "Saving…" : "Save & next"}
        </button>
      </form>

      <section aria-labelledby={fid("today")}>
        <h2 id={fid("today")} style={{ fontSize: 15, margin: "0 0 8px" }}>
          Today at {showName || "this show"} ({rows.length})
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.id} className="pk-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 12px", minHeight: 44 }}>
              <span style={{ fontSize: 13.5, minWidth: 0 }}>
                {r.leadId ? <Link href={`/leads?lead=${r.leadId}`}>{fullName(r)}</Link> : fullName(r)}
                {r.company ? ` · ${r.company}` : ""}
                {r.temperature ? ` · ${r.temperature}` : ""}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "right", flexShrink: 0 }}>
                {r.status === "waiting" ? "Waiting to sync" : r.status === "error" ? r.error || "Couldn't sync" : r.outcome === "merged" ? "Merged into existing lead" : "Synced"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
