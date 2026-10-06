"use client";

import { useState, useSyncExternalStore, useTransition, type CSSProperties, type FormEvent } from "react";
import { fmt } from "@/app/(app)/estimator/pricing";
import { CLIENT_ACTION_COPY, selectedTotal, type ClientActionResult, type ResponseScope } from "@/lib/estimate-output/responses";
import { submitScopeSelection } from "./actions";

/**
 * #301 slice C (spec §7, R1) — "Choose your scopes": a checkbox per scope
 * (all checked), the live "Selected scopes" total (pre-credit) with the
 * Rewards credit note, name / title / email / note, Submit selection. It
 * renders only after hydration (adaptation 13): without JS there is no form
 * to post a name into a URL. Receives only scope ids, names and prices.
 */

const subscribeNothing = () => () => {};
const input: CSSProperties = { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 14, padding: "8px 10px", border: "1px solid #d5d9e0", borderRadius: 8 };
const hidden: CSSProperties = { position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" };
const btn: CSSProperties = { font: "inherit", fontWeight: 700, fontSize: 14, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer" };

export function ScopeSelection({ id, token, scopes, creditNote }: { id: string; token: string; scopes: ResponseScope[]; creditNote: string | null }) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [picked, setPicked] = useState<string[]>(() => scopes.map((s) => s.id));
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [trap, setTrap] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = selectedTotal(scopes.filter((s) => picked.includes(s.id)));

  if (!hydrated) return <p className="pkg-muted">{CLIENT_ACTION_COPY.noJs}</p>;
  if (done)
    return (
      <div role="status" className="pkg-goals">
        {done}
      </div>
    );

  const toggle = (sid: string) => setPicked((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      let r: ClientActionResult;
      try {
        r = await submitScopeSelection(id, token, { name, title, email, message: note, sectionIds: picked, hp_confirm_x: trap });
      } catch {
        setErr(CLIENT_ACTION_COPY.failed);
        return;
      }
      if (r.ok) setDone(r.confirmation);
      else setErr(r.error);
    });
  };

  return (
    <form method="post" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="pkg-muted" style={{ margin: 0 }}>
        {CLIENT_ACTION_COPY.chooseHelp}
      </p>
      {scopes.map((s) => (
        <label key={s.id} className="pkg-row" style={{ alignItems: "center", cursor: "pointer" }}>
          <span>
            <input type="checkbox" aria-label={s.name} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} style={{ marginRight: 8 }} />
            {s.name}
          </span>
          <span className="pkg-price">{s.priceLabel}</span>
        </label>
      ))}
      <div className="pkg-row pkg-total" aria-live="polite">
        <span>{CLIENT_ACTION_COPY.selectedTotal}</span>
        <span>{fmt(total)}</span>
      </div>
      {creditNote && <div className="pkg-muted">{creditNote}</div>}
      <input aria-label={CLIENT_ACTION_COPY.name} placeholder={CLIENT_ACTION_COPY.name} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={input} />
      <input aria-label={CLIENT_ACTION_COPY.title} placeholder={CLIENT_ACTION_COPY.title} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
      <input aria-label={CLIENT_ACTION_COPY.email} placeholder={CLIENT_ACTION_COPY.email} type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
      <textarea aria-label={CLIENT_ACTION_COPY.note} placeholder={CLIENT_ACTION_COPY.note} maxLength={4000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={input} />
      <div aria-hidden="true" style={hidden}>
        <label>
          Leave this field empty
          <input type="text" name="hp_confirm_x" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>
      {err && (
        <div role="alert" style={{ color: "#a33a2b", fontSize: 13 }}>
          {err}
        </div>
      )}
      <button type="submit" disabled={pending || !picked.length} style={{ ...btn, opacity: pending || !picked.length ? 0.6 : 1, alignSelf: "flex-start" }}>
        {pending ? CLIENT_ACTION_COPY.sending : CLIENT_ACTION_COPY.submitSelection}
      </button>
    </form>
  );
}
