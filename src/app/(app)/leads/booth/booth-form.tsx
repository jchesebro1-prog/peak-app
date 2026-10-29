"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
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
import { cardTextAvailable, recognizeCardLines } from "@/lib/booth/card-text";
import { parseCardText } from "@/lib/booth/card-parse";
import { resizePhoto, shrinkForInline } from "@/lib/assessments/photo-resize";
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
  // Scan card (native shells only — detected on the client, so the web build never shows it).
  const scanAvailable = useSyncExternalStore(
    () => () => {},
    cardTextAvailable,
    () => false,
  );
  const [scanning, setScanning] = useState(false);
  const [filled, setFilled] = useState<Set<string>>(new Set());
  const fRef = useRef(f);
  useEffect(() => {
    fRef.current = f;
  });

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

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF((cur) => ({ ...cur, [k]: e.target.value }));
    setFilled((cur) => {
      if (!cur.has(k)) return cur;
      const next = new Set(cur);
      next.delete(k);
      return next;
    });
  };
  // A field the scan filled gets a subtle accent outline until staff edit it.
  const scanned = (k: keyof Fields): CSSProperties => ({ ...TAP, ...(filled.has(k) ? { outline: "2px solid var(--accent)", outlineOffset: -1 } : null) });

  // Read the card photo on the device (Vision / ML Kit — no network), then fill only fields that are still empty, so a
  // scan never overwrites what staff typed (checked against the latest state, including edits made while it ran).
  async function onCardPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setError("");
    try {
      const { blob } = await resizePhoto(file);
      const small = await shrinkForInline(blob, 250_000);
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Couldn't read that photo."));
        r.readAsDataURL(small);
      });
      setCardImage(b64);
      const lines = await recognizeCardLines(b64.slice(b64.indexOf(",") + 1));
      const p = parseCardText(lines);
      const sp = p.name.lastIndexOf(" ");
      const found: Partial<Fields> = {
        firstName: sp > 0 ? p.name.slice(0, sp) : p.name,
        lastName: sp > 0 ? p.name.slice(sp + 1) : "",
        email: p.email,
        phone: p.phones[0] || "",
        company: p.company,
        title: p.title,
      };
      const did = new Set<string>();
      for (const k of Object.keys(found) as (keyof Fields)[]) if (!fRef.current[k] && found[k]) did.add(k);
      setFilled(did);
      // Re-check inside the updater: only a still-empty field takes the scanned value.
      setF((now) => {
        const out = { ...now };
        for (const k of did) if (!now[k as keyof Fields]) out[k as keyof Fields] = found[k as keyof Fields] as string;
        return out;
      });
      if (!lines.length) setError("No text found on that photo — type it in, the photo is still attached.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't scan that card.");
    } finally {
      setScanning(false);
    }
  }

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
      setFilled(new Set());
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
        {scanAvailable ? (
          <label className="pk-btn" style={{ ...TAP, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {scanning ? "Reading card…" : "Scan card"}
            <input type="file" accept="image/jpeg,image/png" capture="environment" onChange={onCardPhoto} hidden disabled={scanning} />
          </label>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={FIELD}>
            <label className="pk-field-label" htmlFor={fid("first")}>First name</label>
            <input id={fid("first")} ref={firstRef} className="pk-input" style={scanned("firstName")} value={f.firstName} onChange={set("firstName")} autoComplete="off" />
          </div>
          <div style={FIELD}>
            <label className="pk-field-label" htmlFor={fid("last")}>Last name</label>
            <input id={fid("last")} className="pk-input" style={scanned("lastName")} value={f.lastName} onChange={set("lastName")} autoComplete="off" />
          </div>
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("email")}>Email</label>
          <input id={fid("email")} type="email" className="pk-input" style={scanned("email")} value={f.email} onChange={set("email")} autoComplete="off" inputMode="email" />
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("phone")}>Phone</label>
          <input id={fid("phone")} type="tel" className="pk-input" style={scanned("phone")} value={f.phone} onChange={set("phone")} autoComplete="off" />
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("company")}>Organization / venue</label>
          <input id={fid("company")} className="pk-input" style={scanned("company")} value={f.company} onChange={set("company")} autoComplete="off" />
        </div>
        <div style={FIELD}>
          <label className="pk-field-label" htmlFor={fid("title")}>Title</label>
          <input id={fid("title")} className="pk-input" style={scanned("title")} value={f.title} onChange={set("title")} autoComplete="off" />
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
