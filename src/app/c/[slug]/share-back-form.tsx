"use client";

import { useState } from "react";
import { INTERESTS, INTEREST_LABEL, type Interest } from "@/lib/booth/capture";

export default function ShareBackForm({ slug, firstName }: { slug: string; firstName: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);

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
      setError(res.status === 429 ? "Too many tries — wait a few minutes." : "Couldn't send that. Please try again.");
      setState("error");
    } catch {
      setError("No connection — please try again.");
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <section className="pk-card" style={{ padding: 20, textAlign: "center", display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Thanks — I&apos;ll be in touch.</h2>
        <a href={`/c/${encodeURIComponent(slug)}/vcard`}>Save my contact</a>
      </section>
    );

  return (
    <form onSubmit={submit} className="pk-card" style={{ padding: 20, display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Send {firstName} your info</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input className="pk-input" name="firstName" placeholder="First name" autoComplete="given-name" maxLength={80} />
        <input className="pk-input" name="lastName" placeholder="Last name" autoComplete="family-name" maxLength={80} />
      </div>
      <input className="pk-input" name="email" type="email" placeholder="Email" autoComplete="email" maxLength={200} />
      <input className="pk-input" name="phone" type="tel" placeholder="Phone" autoComplete="tel" maxLength={40} />
      <input className="pk-input" name="company" placeholder="Organization / venue" autoComplete="organization" maxLength={160} />
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
      <textarea className="pk-input" name="notes" placeholder="Anything we should know?" rows={3} maxLength={2000} style={{ resize: "vertical" }} />
      <input name="company_website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
      {state === "error" ? <div role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</div> : null}
      <button type="submit" className="pk-btn-accent" style={{ padding: "12px 14px", fontSize: 14 }} disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}
