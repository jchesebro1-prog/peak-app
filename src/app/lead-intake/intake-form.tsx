"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

/**
 * Lead Intake.dc.html — form + success state. Posts JSON to
 * /api/leads/intake (fields org, contact, email, phone, city, state,
 * interest, timeline, message + hidden honeypot company_website). The
 * pipeline "interest" line is derived from the need/venue selects exactly
 * like the prototype; the budget band is folded into the message since the
 * intake API takes no `value` field.
 */

const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";
const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 28%, #fff)";

const inStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #dfe2e8",
  borderRadius: 10,
  padding: "11px 13px",
};
const selStyle: CSSProperties = { ...inStyle, cursor: "pointer", paddingRight: 32 };
const areaStyle: CSSProperties = { ...inStyle, minHeight: 96, resize: "vertical", lineHeight: 1.5 };
const lblStyle: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 6 };

const css = `
.li-in::placeholder { color: #aab0bb; }
.li-in:focus { outline: none; }
select.li-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 13px center; }
.li-send:hover { filter: brightness(1.06); }
.li-again:hover { background: #e9ebef; }
@media (max-width: 820px) {
  .li-grid { grid-template-columns: 1fr !important; }
  .li-aside { border-right: none !important; border-bottom: 1px solid #e8eaee !important; }
  .li-two { grid-template-columns: 1fr !important; }
}
`;

const VENUE_TYPES = [
  "Theater / performing arts",
  "School / education",
  "House of worship",
  "Gymnasium / gym-a-torium",
  "Arena / civic",
  "Other",
];
const NEEDS = [
  "Not sure yet",
  "Rigging & fly systems",
  "Soft goods / drapery & track",
  "Motorized systems & hoists",
  "Inspection or repair",
  "Flame testing",
];
const TIMELINES = ["Just exploring", "As soon as possible", "Next 3 months", "This year", "Next budget year"];
const BUDGETS: Array<[string | null, string]> = [
  ["u10", "Under $10k"],
  ["10_50", "$10k–$50k"],
  ["50_150", "$50k–$150k"],
  ["150p", "$150k+"],
  [null, "Not sure"],
];

const STEPS = [
  { n: "1", title: "We review your request", body: "Your details land with our sales team right away." },
  { n: "2", title: "We reach out", body: "A rep contacts you within one business day." },
  { n: "3", title: "Walk-through if needed", body: "We schedule a site visit to measure and scope." },
  { n: "4", title: "You get a detailed quote", body: "A clear, itemized proposal — no surprises." },
];

type F = {
  org: string;
  contact: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  venueType: string;
  need: string;
  timeline: string;
  budget: string | null;
  message: string;
};

const blankF = (): F => ({
  org: "",
  contact: "",
  email: "",
  phone: "",
  city: "",
  state: "WI",
  venueType: "Theater / performing arts",
  need: "Not sure yet",
  timeline: "Just exploring",
  budget: null,
  message: "",
});

export default function IntakeForm() {
  const [f, setF] = useState<F>(blankF);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hp, setHp] = useState(""); // honeypot — stays empty for humans
  const [sent, setSent] = useState<{ id: string; org: string; first: string } | null>(null);

  const set = (patch: Partial<F>) => {
    setF((v) => ({ ...v, ...patch }));
    setErr("");
  };

  const submit = async () => {
    if (!f.org.trim() || !f.contact.trim() || !f.email.trim()) {
      setErr("Please add your organization, name and email so we can reach you.");
      return;
    }
    // derive a pipeline interest line from the selects (prototype logic)
    const interest =
      f.need && f.need !== "Not sure yet"
        ? f.need
        : f.venueType && f.venueType !== "Other"
          ? f.venueType
          : "New project";
    const parts: string[] = [];
    if (f.venueType) parts.push("Venue: " + f.venueType);
    const budgetLabel = BUDGETS.find(([k]) => k === f.budget)?.[1];
    if (f.budget && budgetLabel) parts.push("Budget: " + budgetLabel);
    if (f.message.trim()) parts.push(f.message.trim());

    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org: f.org.trim(),
          contact: f.contact.trim(),
          email: f.email.trim(),
          phone: f.phone.trim(),
          city: f.city.trim(),
          state: f.state.trim() || "WI",
          interest,
          timeline: f.timeline,
          message: parts.join("\n\n"),
          company_website: hp,
        }),
      });
      if (res.ok) {
        const data: { id?: string } = await res.json().catch(() => ({}));
        setSent({
          id: data.id || "L-—",
          org: f.org.trim(),
          first: f.contact.trim().split(/\s+/)[0] || "there",
        });
      } else {
        const data: { details?: { email?: string[] } } = await res.json().catch(() => ({}));
        setErr(
          data.details?.email
            ? "That email address doesn't look right — please double-check it."
            : "We couldn't send your request — please check your details and try again."
        );
      }
    } catch {
      setErr("We couldn't send your request — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const onAnother = () => {
    setSent(null);
    setF(blankF());
    setErr("");
  };

  if (sent) {
    return (
      <div style={{ padding: "64px 30px 58px", textAlign: "center" }}>
        <style>{css}</style>
        <div
          style={{
            width: 62,
            height: 62,
            borderRadius: "50%",
            background: ACCENT_SOFT,
            border: `1px solid ${ACCENT_BORDER_LT}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 22px",
          }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5"></path>
          </svg>
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.015em" }}>
          Request received — thank you, {sent.first}.
        </div>
        <div
          style={{
            fontSize: 14,
            color: "#5b616e",
            lineHeight: 1.65,
            maxWidth: 440,
            margin: "14px auto 0",
          }}
        >
          Your request for <b style={{ fontWeight: 600, color: "#16181d" }}>{sent.org}</b> is in. Someone from our
          team will reach out within one business day to learn more and schedule a walk-through if needed.
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            background: "#fbfbfc",
            border: "1px solid #eceef1",
            borderRadius: 10,
            padding: "11px 16px",
            marginTop: 26,
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: ACCENT_INK }}>
            {sent.id}
          </span>
          <span style={{ fontSize: 12.5, color: "#8c919c" }}>reference number</span>
        </div>
        <div style={{ marginTop: 30 }}>
          <button
            onClick={onAnother}
            className="li-again"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 600,
              color: "#3a3f4a",
              background: "#f1f2f5",
              border: "1px solid #e4e7ec",
              padding: "11px 18px",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            Submit another request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="li-grid" style={{ display: "grid", gridTemplateColumns: "340px minmax(0,1fr)" }}>
      <style>{css}</style>

      {/* info rail */}
      <div className="li-aside" style={{ background: "#fbfbfc", borderRight: "1px solid #eef0f3", padding: "32px 30px" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: ACCENT_INK,
          }}
        >
          Request a quote
        </div>
        <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.15, marginTop: 12 }}>
          Tell us about your stage or venue project.
        </div>
        <div style={{ fontSize: 13.5, color: "#5b616e", lineHeight: 1.6, marginTop: 14 }}>
          Rigging, soft goods, motorized systems, inspections and repairs for theaters, schools, houses of worship
          and arenas across Wisconsin.
        </div>

        <div style={{ height: 1, background: "#eceef1", margin: "26px 0" }} />

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            color: "#aab0bb",
            marginBottom: 14,
          }}
        >
          What happens next
        </div>
        {STEPS.map((s) => (
          <div key={s.n} style={{ display: "flex", gap: 13, marginBottom: 16 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: ACCENT_SOFT,
                border: `1px solid ${ACCENT_BORDER_LT}`,
                color: ACCENT_INK,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {s.n}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "#8c919c", lineHeight: 1.45, marginTop: 2 }}>{s.body}</div>
            </div>
          </div>
        ))}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "#eef3f0",
            border: "1px solid #d8e8df",
            borderRadius: 10,
            padding: "11px 13px",
            marginTop: 22,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2f9d6b", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "#2f6f4f", fontWeight: 600, lineHeight: 1.4 }}>
            We reply to every request within one business day.
          </span>
        </div>
      </div>

      {/* form */}
      <div style={{ padding: "32px 34px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          <div>
            <div style={lblStyle}>
              Organization / venue name <span style={{ color: ACCENT_INK }}>*</span>
            </div>
            <input
              className="li-in"
              value={f.org}
              onChange={(e) => set({ org: e.target.value })}
              placeholder="e.g. Riverside Playhouse"
              style={inStyle}
            />
          </div>

          <div className="li-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={lblStyle}>
                Your name <span style={{ color: ACCENT_INK }}>*</span>
              </div>
              <input
                className="li-in"
                value={f.contact}
                onChange={(e) => set({ contact: e.target.value })}
                placeholder="First & last"
                style={inStyle}
              />
            </div>
            <div>
              <div style={lblStyle}>Venue type</div>
              <select
                className="li-in li-sel"
                value={f.venueType}
                onChange={(e) => set({ venueType: e.target.value })}
                style={selStyle}
              >
                {VENUE_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="li-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={lblStyle}>
                Email <span style={{ color: ACCENT_INK }}>*</span>
              </div>
              <input
                className="li-in"
                value={f.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="you@venue.org"
                style={inStyle}
              />
            </div>
            <div>
              <div style={lblStyle}>Phone</div>
              <input
                className="li-in"
                value={f.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="(555) 555-0100"
                style={inStyle}
              />
            </div>
          </div>

          <div className="li-two" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <div>
              <div style={lblStyle}>City</div>
              <input
                className="li-in"
                value={f.city}
                onChange={(e) => set({ city: e.target.value })}
                placeholder="City"
                style={inStyle}
              />
            </div>
            <div>
              <div style={lblStyle}>State</div>
              <input
                className="li-in"
                value={f.state}
                onChange={(e) => set({ state: e.target.value })}
                placeholder="WI"
                style={inStyle}
              />
            </div>
          </div>

          <div className="li-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={lblStyle}>What can we help with?</div>
              <select
                className="li-in li-sel"
                value={f.need}
                onChange={(e) => set({ need: e.target.value })}
                style={selStyle}
              >
                {NEEDS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={lblStyle}>Timeline</div>
              <select
                className="li-in li-sel"
                value={f.timeline}
                onChange={(e) => set({ timeline: e.target.value })}
                style={selStyle}
              >
                {TIMELINES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div style={lblStyle}>
              Estimated budget <span style={{ color: "#aab0bb", fontWeight: 500 }}>(optional)</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {BUDGETS.map(([key, label]) => {
                const on = f.budget === key;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => set({ budget: key })}
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: "9px 14px",
                      borderRadius: 9,
                      cursor: "pointer",
                      border: `1px solid ${on ? ACCENT : "#dfe2e8"}`,
                      background: on ? ACCENT_SOFT : "#fff",
                      color: on ? ACCENT_INK : "#5b616e",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={lblStyle}>Tell us about your project</div>
            <textarea
              className="li-in"
              value={f.message}
              onChange={(e) => set({ message: e.target.value })}
              placeholder="What are you looking to do? Any dimensions, condition notes, or event dates help us respond faster."
              style={areaStyle}
            />
          </div>

          {/* honeypot — bots fill it, the API rejects non-empty values */}
          <input
            type="text"
            name="company_website"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -9999,
              top: -9999,
              width: 0,
              height: 0,
              opacity: 0,
              pointerEvents: "none",
            }}
          />

          {err && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                background: "#f8ece7",
                border: "1px solid #eccfc4",
                borderRadius: 9,
                padding: "10px 13px",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#c85a3c", flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: "#b4543a", fontWeight: 600 }}>{err}</span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
              rowGap: 12,
              marginTop: 2,
            }}
          >
            <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.5, maxWidth: 340 }}>
              By submitting you agree to be contacted about your request. We don&apos;t share your information.
            </div>
            <button
              onClick={submit}
              disabled={busy}
              className="li-send"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                background: ACCENT,
                border: "none",
                padding: "14px 26px",
                borderRadius: 11,
                cursor: "pointer",
                boxShadow: `0 2px 10px ${ACCENT_SOFT}`,
                opacity: busy ? 0.7 : 1,
              }}
            >
              Send request
              <span style={{ fontSize: 15, lineHeight: 1 }}>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
