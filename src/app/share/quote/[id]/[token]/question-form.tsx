"use client";

import { useState, useSyncExternalStore, useTransition, type CSSProperties, type FormEvent } from "react";
import { CLIENT_ACTION_COPY, type ClientActionResult } from "@/lib/estimate-output/responses";
import { askQuestion } from "./actions";

/** #301 slice C (spec §7) — "Ask a question or request changes". Hydration-only, like ScopeSelection. */

const subscribeNothing = () => () => {};
const input: CSSProperties = { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 14, padding: "8px 10px", border: "1px solid #d5d9e0", borderRadius: 8 };
const hidden: CSSProperties = { position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" };
const btn: CSSProperties = { font: "inherit", fontWeight: 700, fontSize: 14, color: "#16181d", background: "#f1f2f5", border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer" };

export function QuestionForm({ id, token }: { id: string; token: string }) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!hydrated) return <p className="pkg-muted">{CLIENT_ACTION_COPY.noJs}</p>;
  if (done)
    return (
      <div role="status" className="pkg-goals">
        {done}
      </div>
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      let r: ClientActionResult;
      try {
        r = await askQuestion(id, token, { name, email, message, website });
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
      <input aria-label={CLIENT_ACTION_COPY.name} placeholder={CLIENT_ACTION_COPY.name} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={input} />
      <input aria-label={CLIENT_ACTION_COPY.email} placeholder={CLIENT_ACTION_COPY.email} type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
      <textarea aria-label={CLIENT_ACTION_COPY.message} placeholder={CLIENT_ACTION_COPY.message} required maxLength={4000} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} style={input} />
      <div aria-hidden="true" style={hidden}>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {err && (
        <div role="alert" style={{ color: "#a33a2b", fontSize: 13 }}>
          {err}
        </div>
      )}
      <button type="submit" disabled={pending} style={{ ...btn, opacity: pending ? 0.6 : 1, alignSelf: "flex-start" }}>
        {pending ? CLIENT_ACTION_COPY.sending : CLIENT_ACTION_COPY.send}
      </button>
    </form>
  );
}
