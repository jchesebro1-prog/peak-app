"use client";

import { useEffect, useRef, useState } from "react";
import { INTERESTS, INTEREST_LABEL, type Interest } from "@/lib/booth/capture";

export default function ShareBackForm({ slug, firstName }: { slug: string; firstName: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const thanks = useRef<HTMLHeadingElement>(null);

  // Announce the confirmation to screen readers.
  useEffect(() => {
    if (state === "sent") thanks.current?.focus();
  }, [state]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const phone = String(fd.get("phone") || "").trim();
    if (!String(fd.get("firstName") || "").trim() && !String(fd.get("lastName") || "").trim()) return setError("Add your name."), setState("error");
    if (!email && !phone) return setError("Add an email or a phone number."), setState("error");
    setState("sending");
    try {
      const res = await fetch("/api/booth/share-back", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          firstName: fd.get("firstName"),
          lastName: fd.get("lastName"),
          email,
          phone,
          company: fd.get("company"),
          interests,
          notes: fd.get("notes"),
          company_website: fd.get("company_website"),
        }),
      });
      if (res.ok) return setState("sent");
      let msg = "";
      if (res.status === 429) msg = "Too many tries — wait a few minutes.";
      else if (res.status === 400 || res.status === 409) {
        // The server's message for these is user-readable ("Add an email or a phone number.", "Still saving…").
        const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
        if (j && typeof j.error === "string" && j.error.trim()) msg = j.error;
      }
      setError(msg || "Couldn't send that. Please try again.");
      setState("error");
    } catch {
      setError("No connection — please try again.");
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <section className="pk-card" style={{ padding: 20, textAlign: "center", display: "grid", gap: 8 }}>
        <h2 ref={thanks} tabIndex={-1} style={{ margin: 0, outline: "none" }}>Thanks — I&apos;ll be in touch.</h2>
        <a href={`/c/${encodeURIComponent(slug)}/vcard`}>Save my contact</a>
      </section>
    );

  return (
    <form onSubmit={submit} className="pk-card" style={{ padding: 20, display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Send {firstName} your info</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="pk-field-label" htmlFor="sb-first">First name</label>
          <input id="sb-first" className="pk-input" name="firstName" autoComplete="given-name" maxLength={80} />
        </div>
        <div>
          <label className="pk-field-label" htmlFor="sb-last">Last name</label>
          <input id="sb-last" className="pk-input" name="lastName" autoComplete="family-name" maxLength={80} />
        </div>
      </div>
      <div>
        <label className="pk-field-label" htmlFor="sb-email">Email</label>
        <input id="sb-email" className="pk-input" name="email" type="email" autoComplete="email" maxLength={200} />
      </div>
      <div>
        <label className="pk-field-label" htmlFor="sb-phone">Phone</label>
        <input id="sb-phone" className="pk-input" name="phone" type="tel" autoComplete="tel" maxLength={40} />
      </div>
      <div>
        <label className="pk-field-label" htmlFor="sb-org">Organization / venue</label>
        <input id="sb-org" className="pk-input" name="company" autoComplete="organization" maxLength={160} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="pk-field-label">Interested in</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {INTERESTS.map((k) => {
            const on = interests.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                className={on ? "pk-btn-accent" : "pk-btn-outline"}
                style={{ borderRadius: 20, padding: "7px 12px", fontSize: 12.5 }}
                onClick={() => setInterests(on ? interests.filter((x) => x !== k) : [...interests, k])}
              >
                {INTEREST_LABEL[k]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div>
        <label className="pk-field-label" htmlFor="sb-notes">Anything we should know?</label>
        <textarea id="sb-notes" className="pk-input" name="notes" rows={3} maxLength={2000} style={{ resize: "vertical" }} />
      </div>
      <input name="company_website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
      {state === "error" ? <div role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</div> : null}
      <button type="submit" className="pk-btn-accent" style={{ padding: "12px 14px", fontSize: 14 }} disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}
