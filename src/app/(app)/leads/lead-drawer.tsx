"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignAction,
  convertLeadAction,
  createLeadAction,
  logActivityAction,
  markLostAction,
  requestSiteVisitAction,
  setForecastAction,
  setNextActionAction,
  setStageAction,
} from "./actions";
import type { DrawerDetailVM, LeadThreadVM, SourceOptionVM } from "./types";

/**
 * Lead Detail.dc.html — the right-hand drawer. mode "new" is the quick-add
 * form; mode "detail" is the full lead view with stage stepper, owner,
 * next-action date, activity log + quick-add, convert → Customer + draft
 * Quote, and mark-lost. Overlays whichever leads view is behind it.
 */

const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";

const lbl: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 6 };
const microLbl: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#aab0bb",
};
const inStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #dfe2e8",
  borderRadius: 9,
  padding: "10px 12px",
};
const selStyle: CSSProperties = { ...inStyle, cursor: "pointer", paddingRight: 30 };
const areaStyle: CSSProperties = { ...inStyle, minHeight: 64, resize: "vertical", lineHeight: 1.5 };
const secLbl: CSSProperties = { ...microLbl, marginTop: 20, marginBottom: 9 };
const secLbl2: CSSProperties = { ...microLbl, marginTop: 20, marginBottom: 10 };
const mbLbl: CSSProperties = { ...microLbl, marginBottom: 7 };
const primaryBtn: CSSProperties = {
  flex: 1,
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  fontWeight: 600,
  color: "#fff",
  background: ACCENT,
  border: "none",
  padding: "12px 14px",
  borderRadius: 10,
  cursor: "pointer",
};
const ghostBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  fontWeight: 600,
  color: "#5b616e",
  background: "#f1f2f5",
  border: "1px solid #e4e7ec",
  padding: "12px 18px",
  borderRadius: 10,
  cursor: "pointer",
};
const dangerBtn: CSSProperties = {
  flex: 1,
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  fontWeight: 600,
  color: "#fff",
  background: "#b4543a",
  border: "none",
  padding: "12px 14px",
  borderRadius: 10,
  cursor: "pointer",
};
const smallPrimary: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#fff",
  background: ACCENT,
  border: "none",
  padding: "9px 14px",
  borderRadius: 8,
  cursor: "pointer",
};
const smallGhost: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#8c919c",
  background: "#f1f2f5",
  border: "1px solid #e4e7ec",
  padding: "9px 14px",
  borderRadius: 8,
  cursor: "pointer",
};
const convertBtn: CSSProperties = {
  flex: 1,
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background: ACCENT,
  border: "none",
  padding: "12px 14px",
  borderRadius: 10,
  cursor: "pointer",
};
const lostBtnStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  color: "#b4543a",
  background: "#f8ece7",
  border: "1px solid #eccfc4",
  padding: "12px 16px",
  borderRadius: 10,
  cursor: "pointer",
};
const closeBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: "none",
  background: "#f1f2f5",
  borderRadius: 9,
  color: "#5b616e",
  fontSize: 18,
  cursor: "pointer",
  flexShrink: 0,
};
const backBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#8c919c",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 0,
  marginBottom: 16,
};
const cvRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "#fbfbfc",
  border: "1px solid #eef0f3",
  borderRadius: 11,
  padding: "13px 14px",
};
const cvBadge: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  background: ACCENT_SOFT,
  color: ACCENT_INK,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: 13,
  flexShrink: 0,
  fontFamily: "var(--font-mono)",
};

const threadChip = (c: { ink: string; soft: string; bd: string }): CSSProperties => ({
  display: "inline-block",
  fontSize: 10.5,
  fontWeight: 600,
  color: c.ink,
  background: c.soft,
  border: `1px solid ${c.bd}`,
  padding: "3px 10px",
  borderRadius: 20,
  textDecoration: "none",
  whiteSpace: "nowrap",
});

const drawerCss = `
.ldw-in::placeholder { color: #aab0bb; }
.ldw-in:focus { outline: none; border-color: #c4c9d2; }
.ldw-scroll::-webkit-scrollbar { width: 8px; }
.ldw-scroll::-webkit-scrollbar-thumb { background: #dcdfe5; border-radius: 8px; }
`;

const CHANNELS = [
  ["note", "Note"],
  ["call", "Call"],
  ["email", "Email"],
  ["meeting", "Meeting"],
] as const;
type Channel = (typeof CHANNELS)[number][0];

const LOG_PLACEHOLDER: Record<Channel, string> = {
  note: "Log a note…",
  call: "Log a call…",
  email: "Log an email…",
  meeting: "Log a meeting…",
};
const LOG_BTN: Record<Channel, string> = {
  note: "Log note",
  call: "Log call",
  email: "Log email",
  meeting: "Log meeting",
};

const TYPE_OPTIONS = ["", "Performing arts", "Education", "Worship", "Civic", "Commercial", "Other"];

const LOST_DEFS = [
  "Price / budget",
  "Went with a competitor",
  "Timing / put on hold",
  "Out of scope",
  "__other",
];

function toDateInput(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function fromDateInput(s: string): number | null {
  if (!s) return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  return new Date(+p[0], +p[1] - 1, +p[2], 9, 0, 0).getTime();
}

type NewForm = {
  org: string;
  contact: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  source: string;
  interest: string;
  owner: string;
  value: string;
};

export default function LeadDrawer({
  mode,
  vm,
  closeHref,
  meName,
  rosterNames,
  sourceOptions,
  thread,
  visitReasons,
}: {
  mode: "new" | "detail";
  vm: DrawerDetailVM | null;
  closeHref: string;
  meName: string;
  rosterNames: string[];
  sourceOptions: SourceOptionVM[];
  thread: LeadThreadVM;
  visitReasons: string[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [view, setView] = useState<"main" | "convert" | "lost" | "visit">("main");
  const [logChannel, setLogChannel] = useState<Channel>("note");
  const [logText, setLogText] = useState("");
  const [naDate, setNaDate] = useState<string | null>(null);
  const [naNote, setNaNote] = useState<string | null>(null);
  const [fcDate, setFcDate] = useState<string | null>(null);
  const [cvVenue, setCvVenue] = useState("");
  const [cvType, setCvType] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [lostOther, setLostOther] = useState("");
  const [nf, setNf] = useState<NewForm>(() => ({
    org: "",
    contact: "",
    email: "",
    phone: "",
    city: "",
    state: "WI",
    source: "phone",
    interest: "",
    owner: rosterNames.includes(meName) ? meName : "",
    value: "",
  }));
  const [nfErr, setNfErr] = useState("");

  // #34 — request-visit form + convert gate
  const [reqReason, setReqReason] = useState(() => visitReasons[0] || "Site survey / measure");
  const [reqTiming, setReqTiming] = useState("");
  const [reqAssignee, setReqAssignee] = useState("");
  const [reqErr, setReqErr] = useState("");
  const [skipSurvey, setSkipSurvey] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [cvErr, setCvErr] = useState("");
  // Gate preview (server re-checks regardless): blocked unless the linked
  // survey is completed. thread.survey is surveysForLead(leadId)[0] — the
  // SAME resolution convertLeadAction's gate uses, so preview and server
  // can never disagree (a past "done" visit doesn't hide the survey).
  const gateBlocked = !thread.survey || thread.survey.stage !== "completed";

  const isNew = mode === "new" || !vm;

  const close = () => router.push(closeHref);
  const refresh = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const setNfField = (patch: Partial<NewForm>) => {
    setNf((v) => ({ ...v, ...patch }));
    setNfErr("");
  };

  const doCreate = () => {
    if (!nf.org.trim()) {
      setNfErr("Add an organization or venue name.");
      return;
    }
    startTransition(async () => {
      await createLeadAction({
        source: nf.source,
        org: nf.org.trim(),
        contact: nf.contact.trim(),
        email: nf.email.trim(),
        phone: nf.phone.trim(),
        city: nf.city.trim(),
        state: nf.state.trim() || "WI",
        interest: nf.interest.trim(),
        owner: nf.owner || undefined,
        value: parseInt(nf.value.replace(/[^0-9]/g, ""), 10) || 0,
      });
      router.push(closeHref);
      router.refresh();
    });
  };

  const saveNa = () => {
    if (!vm) return;
    const d = naDate != null ? naDate : toDateInput(vm.nextActionAt);
    const note = naNote != null ? naNote : vm.nextActionNote;
    startTransition(async () => {
      await setNextActionAction(vm.id, fromDateInput(d), note);
      setNaDate(null);
      setNaNote(null);
      router.refresh();
    });
  };

  const clearNa = () => {
    if (!vm) return;
    startTransition(async () => {
      await setNextActionAction(vm.id, null, "");
      setNaDate(null);
      setNaNote(null);
      router.refresh();
    });
  };

  const saveFc = () => {
    if (!vm || fcDate == null) return;
    startTransition(async () => {
      await setForecastAction(vm.id, fromDateInput(fcDate));
      setFcDate(null);
      router.refresh();
    });
  };

  const doLog = () => {
    if (!vm) return;
    const t = logText.trim();
    if (!t) return;
    startTransition(async () => {
      await logActivityAction(vm.id, { type: logChannel, note: t });
      setLogText("");
      router.refresh();
    });
  };

  const doConvert = () => {
    if (!vm) return;
    startTransition(async () => {
      const res = await convertLeadAction(vm.id, {
        venueLabel: cvVenue.trim() || "Main venue",
        type: cvType,
        skipSurvey,
        skipReason: skipReason.trim(),
      });
      if (!res.ok) {
        setCvErr(
          res.reason === "survey-missing"
            ? "No completed site survey is linked to this lead — tick “Skip survey” to convert anyway."
            : res.reason === "survey-open"
              ? "The linked survey isn't completed yet — finish it, or tick “Skip survey”."
              : "Convert failed — lead not found."
        );
        return;
      }
      setView("main");
      router.refresh();
    });
  };

  const doRequestVisit = () => {
    if (!vm) return;
    startTransition(async () => {
      const res = await requestSiteVisitAction(vm.id, {
        reason: reqReason,
        timing: reqTiming.trim(),
        assignee: reqAssignee,
      });
      if (!res.ok) {
        setReqErr(
          res.reason === "exists"
            ? "This lead already has an active site visit (" + res.visitId + ")."
            : "Lead not found."
        );
        return;
      }
      setView("main");
      router.refresh();
    });
  };

  const doLost = () => {
    if (!vm) return;
    const reason = lostReason === "__other" ? lostOther.trim() : lostReason;
    startTransition(async () => {
      await markLostAction(vm.id, reason);
      router.push(closeHref);
      router.refresh();
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{drawerCss}</style>
      <div onClick={close} style={{ position: "absolute", inset: 0, background: "rgba(16,18,22,.42)" }} />

      <div
        className="ldw-scroll"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 452,
          maxWidth: "100%",
          background: "#fff",
          boxShadow: "-18px 0 50px rgba(16,18,22,.22)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {isNew ? (
          <>
            {/* ===== NEW LEAD FORM ===== */}
            <div
              style={{
                padding: "20px 22px 16px",
                borderBottom: "1px solid #f0f1f4",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                position: "sticky",
                top: 0,
                background: "#fff",
                zIndex: 2,
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>New lead</div>
                <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>Log a call, referral or walk-in</div>
              </div>
              <button onClick={close} style={closeBtnStyle}>
                ×
              </button>
            </div>
            <div style={{ padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={lbl}>
                  Organization / venue <span style={{ color: ACCENT_INK }}>*</span>
                </div>
                <input
                  className="ldw-in"
                  value={nf.org}
                  onChange={(e) => setNfField({ org: e.target.value })}
                  placeholder="e.g. Riverside Playhouse"
                  style={inStyle}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={lbl}>Contact name</div>
                  <input
                    className="ldw-in"
                    value={nf.contact}
                    onChange={(e) => setNfField({ contact: e.target.value })}
                    placeholder="First and last"
                    style={inStyle}
                  />
                </div>
                <div>
                  <div style={lbl}>Source</div>
                  <select
                    className="ldw-in"
                    value={nf.source}
                    onChange={(e) => setNfField({ source: e.target.value })}
                    style={selStyle}
                  >
                    {sourceOptions.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={lbl}>Email</div>
                  <input
                    className="ldw-in"
                    value={nf.email}
                    onChange={(e) => setNfField({ email: e.target.value })}
                    placeholder="name@venue.org"
                    style={inStyle}
                  />
                </div>
                <div>
                  <div style={lbl}>Phone</div>
                  <input
                    className="ldw-in"
                    value={nf.phone}
                    onChange={(e) => setNfField({ phone: e.target.value })}
                    placeholder="(555) 555-0100"
                    style={inStyle}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <div>
                  <div style={lbl}>City</div>
                  <input
                    className="ldw-in"
                    value={nf.city}
                    onChange={(e) => setNfField({ city: e.target.value })}
                    placeholder="City"
                    style={inStyle}
                  />
                </div>
                <div>
                  <div style={lbl}>State</div>
                  <input
                    className="ldw-in"
                    value={nf.state}
                    onChange={(e) => setNfField({ state: e.target.value })}
                    placeholder="WI"
                    style={inStyle}
                  />
                </div>
              </div>
              <div>
                <div style={lbl}>What they need</div>
                <input
                  className="ldw-in"
                  value={nf.interest}
                  onChange={(e) => setNfField({ interest: e.target.value })}
                  placeholder="e.g. Counterweight rigging + drapery"
                  style={inStyle}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={lbl}>Owner</div>
                  <select
                    className="ldw-in"
                    value={nf.owner}
                    onChange={(e) => setNfField({ owner: e.target.value })}
                    style={selStyle}
                  >
                    <option value="">Unassigned</option>
                    {rosterNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={lbl}>Est. value ($)</div>
                  <input
                    className="ldw-in"
                    value={nf.value}
                    onChange={(e) => setNfField({ value: e.target.value })}
                    placeholder="0"
                    style={inStyle}
                  />
                </div>
              </div>
              {nfErr && <div style={{ fontSize: 12, color: "#b4543a", fontWeight: 600 }}>{nfErr}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button onClick={close} style={ghostBtn}>
                  Cancel
                </button>
                <button onClick={doCreate} disabled={busy} style={primaryBtn}>
                  Add lead
                </button>
              </div>
            </div>
          </>
        ) : (
          vm && (
            <>
              {/* ===== EXISTING LEAD — header ===== */}
              <div
                style={{
                  padding: "18px 22px 15px",
                  borderBottom: "1px solid #f0f1f4",
                  position: "sticky",
                  top: 0,
                  background: "#fff",
                  zIndex: 2,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: vm.srcColor,
                        background: `color-mix(in srgb, ${vm.srcColor} 12%, #fff)`,
                        border: `1px solid color-mix(in srgb, ${vm.srcColor} 26%, #fff)`,
                        padding: "2px 9px",
                        borderRadius: 20,
                      }}
                    >
                      {vm.srcShort}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#aab0bb" }}>{vm.id}</span>
                  </div>
                  <button onClick={close} style={closeBtnStyle}>
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.015em", lineHeight: 1.2, marginTop: 11 }}>
                  {vm.org}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 7, fontSize: 12.5, color: "#5b616e" }}>
                  {vm.contact && <span style={{ fontWeight: 600, color: "#3a3f4a" }}>{vm.contact}</span>}
                  {vm.email && (
                    <a href={`mailto:${vm.email}`} style={{ color: ACCENT_INK, textDecoration: "none" }}>
                      {vm.email}
                    </a>
                  )}
                  {vm.phone && <span style={{ color: "#8c919c" }}>{vm.phone}</span>}
                </div>
                <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 5 }}>{vm.locLine}</div>
              </div>

              {/* ===== MAIN view ===== */}
              {view === "main" && (
                <>
                  <div style={{ padding: "16px 22px 22px" }}>
                    {/* follow-up / SLA banner */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "11px 13px",
                        borderRadius: 11,
                        background: vm.banner.soft,
                        border: `1px solid ${vm.banner.bd}`,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: vm.banner.dot,
                          flexShrink: 0,
                          marginTop: 4,
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: vm.banner.ink, lineHeight: 1.35 }}>
                          {vm.banner.title}
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: `color-mix(in srgb, ${vm.banner.ink} 78%, #555)`,
                            marginTop: 1,
                            lineHeight: 1.4,
                          }}
                        >
                          {vm.banner.detail}
                        </div>
                      </div>
                    </div>

                    {/* interest + value */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 14,
                        marginTop: 16,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={microLbl}>Interested in</div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, marginTop: 4 }}>
                          {vm.interestLine}
                        </div>
                        {vm.timeline && (
                          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>Timeline · {vm.timeline}</div>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={microLbl}>Est. value</div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 20,
                            fontWeight: 600,
                            letterSpacing: "-.01em",
                            marginTop: 3,
                          }}
                        >
                          {vm.valueLabel}
                        </div>
                      </div>
                    </div>

                    {vm.message.trim() && (
                      <div
                        style={{
                          background: "#fbfbfc",
                          border: "1px solid #eef0f3",
                          borderRadius: 11,
                          padding: "12px 14px",
                          marginTop: 14,
                          fontSize: 12.5,
                          color: "#4a4f59",
                          lineHeight: 1.55,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {vm.message}
                      </div>
                    )}

                    {/* stage stepper */}
                    <div style={secLbl}>Pipeline stage</div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {vm.stages.map((st) => (
                        <button
                          key={st.key}
                          title={st.label}
                          onClick={() => refresh(() => setStageAction(vm.id, st.key))}
                          style={{
                            flex: 1,
                            fontFamily: "var(--font-ui)",
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: "8px 3px",
                            borderRadius: 7,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            border: `1px solid ${st.on ? st.ink : st.done ? st.bd : "#e8eaee"}`,
                            background: st.on ? st.soft : st.done ? "#fbfbfc" : "#fff",
                            color: st.on ? st.ink : st.done ? "#5b616e" : "#9aa0ab",
                          }}
                        >
                          {st.short}
                        </button>
                      ))}
                    </div>

                    {/* owner + next follow-up */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
                      <div>
                        <div style={mbLbl}>Owner</div>
                        <select
                          className="ldw-in"
                          value={vm.owner}
                          onChange={(e) => refresh(() => assignAction(vm.id, e.target.value))}
                          style={selStyle}
                        >
                          <option value="">Unassigned</option>
                          {rosterNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div style={mbLbl}>Next follow-up</div>
                        <input
                          type="date"
                          className="ldw-in"
                          value={naDate ?? toDateInput(vm.nextActionAt)}
                          onChange={(e) => setNaDate(e.target.value)}
                          style={inStyle}
                        />
                      </div>
                    </div>
                    <input
                      className="ldw-in"
                      value={naNote ?? vm.nextActionNote}
                      onChange={(e) => setNaNote(e.target.value)}
                      placeholder="Follow-up note (optional)"
                      style={{ ...inStyle, marginTop: 10 }}
                    />
                    {(naDate != null || naNote != null) && (
                      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                        <button onClick={saveNa} disabled={busy} style={smallPrimary}>
                          Save follow-up
                        </button>
                        {vm.nextActionAt != null && (
                          <button onClick={clearNa} disabled={busy} style={smallGhost}>
                            Clear
                          </button>
                        )}
                      </div>
                    )}

                    {/* forecast close date (#18 opportunity board) */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                      <div>
                        <div style={mbLbl}>Forecast date</div>
                        <input
                          type="date"
                          className="ldw-in"
                          value={fcDate ?? toDateInput(vm.forecastAt)}
                          onChange={(e) => setFcDate(e.target.value)}
                          style={inStyle}
                        />
                      </div>
                      {fcDate != null && (
                        <div style={{ display: "flex", alignItems: "flex-end" }}>
                          <button onClick={saveFc} disabled={busy} style={smallPrimary}>
                            Save forecast
                          </button>
                        </div>
                      )}
                    </div>

                    {/* #34 — site-visit / survey thread */}
                    <div style={secLbl}>Site visit</div>
                    {(thread.visit || thread.survey) && (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        {thread.visit && (
                          <Link href="/field-survey" style={threadChip(thread.visit)}>
                            Visit · {thread.visit.label}
                          </Link>
                        )}
                        {/* Survives visit completion: activeVisitForLead drops the visit
                            once it derives "done", but the completed survey chip must
                            stay visible — it doesn't depend on an active visit. */}
                        {thread.survey && (
                          <Link
                            href={`/field-survey?id=${encodeURIComponent(thread.survey.id)}`}
                            style={threadChip(thread.survey)}
                          >
                            Survey · {thread.survey.label}
                          </Link>
                        )}
                        {thread.visit && (
                          <span style={{ fontSize: 11.5, color: "#8c919c" }}>
                            {thread.visit.assignedTo || "Unclaimed"}
                            {thread.visit.startAt != null
                              ? " · " +
                                new Date(thread.visit.startAt).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : ""}
                          </span>
                        )}
                      </div>
                    )}
                    {!thread.visit &&
                      (vm.converted ? (
                        !thread.survey && (
                          <div style={{ fontSize: 12, color: "#9aa0ab" }}>
                            No site visit was requested.
                          </div>
                        )
                      ) : (
                        <button
                          onClick={() => {
                            setView("visit");
                            setReqTiming("");
                            setReqAssignee("");
                            setReqErr("");
                          }}
                          style={smallGhost}
                        >
                          Request site visit
                        </button>
                      ))}

                    {/* log a touch */}
                    <div style={secLbl}>Log a touch</div>
                    <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3, gap: 2 }}>
                      {CHANNELS.map(([k, label]) => {
                        const on = logChannel === k;
                        return (
                          <button
                            key={k}
                            onClick={() => setLogChannel(k)}
                            style={{
                              flex: 1,
                              fontFamily: "var(--font-ui)",
                              fontSize: 11.5,
                              fontWeight: 600,
                              padding: "7px 4px",
                              borderRadius: 7,
                              cursor: "pointer",
                              border: "none",
                              background: on ? "#fff" : "transparent",
                              color: on ? "#16181d" : "#8c919c",
                              boxShadow: on ? "0 1px 2px rgba(0,0,0,.09)" : "none",
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      className="ldw-in"
                      value={logText}
                      onChange={(e) => setLogText(e.target.value)}
                      placeholder={LOG_PLACEHOLDER[logChannel]}
                      style={{ ...areaStyle, marginTop: 9 }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <button onClick={doLog} disabled={busy} style={smallPrimary}>
                        {LOG_BTN[logChannel]}
                      </button>
                    </div>

                    {/* activity timeline */}
                    <div style={secLbl2}>Activity</div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {vm.activities.map((a) => (
                        <div key={a.id} style={{ display: "flex", gap: 11, paddingBottom: 14, position: "relative" }}>
                          {a.line && (
                            <span
                              style={{
                                position: "absolute",
                                left: 12,
                                top: 26,
                                bottom: 0,
                                width: 1.5,
                                background: "#eef0f3",
                              }}
                            />
                          )}
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 7,
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              background: "#f4f5f7",
                              color: a.iconColor,
                              zIndex: 1,
                            }}
                          >
                            {a.icon}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.45 }}>
                              <b style={{ fontWeight: 600, color: "#16181d" }}>{a.who}</b> {a.note}
                            </div>
                            <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 2 }}>{a.when}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* footer actions */}
                  <div
                    style={{
                      marginTop: "auto",
                      position: "sticky",
                      bottom: 0,
                      background: "#fff",
                      borderTop: "1px solid #f0f1f4",
                      padding: "13px 22px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    {vm.converted ? (
                      <Link
                        href={`/quotes?id=${encodeURIComponent(vm.quoteId)}`}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 7,
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#fff",
                          background: ACCENT,
                          padding: "12px 14px",
                          borderRadius: 10,
                          textDecoration: "none",
                        }}
                      >
                        Open quote {vm.quoteId} →
                      </Link>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setView("convert");
                            setCvVenue("");
                            setCvType("");
                            setSkipSurvey(false);
                            setSkipReason("");
                            setCvErr("");
                          }}
                          style={convertBtn}
                        >
                          Convert to customer + quote
                        </button>
                        <button
                          onClick={() => {
                            setView("lost");
                            setLostReason("");
                            setLostOther("");
                          }}
                          title="Mark lost"
                          style={lostBtnStyle}
                        >
                          Lost
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* ===== CONVERT view ===== */}
              {view === "convert" && (
                <div style={{ padding: "18px 22px 22px" }}>
                  <button onClick={() => setView("main")} style={backBtn}>
                    ← Back
                  </button>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em" }}>Convert this lead</div>
                  <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.55, marginTop: 6 }}>
                    Creates a customer record and a linked draft quote you can build out in the Estimator.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                    <div style={cvRow}>
                      <span style={cvBadge}>C</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>New customer</div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#8c919c",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {vm.org}
                        </div>
                      </div>
                    </div>
                    <div style={cvRow}>
                      <span style={cvBadge}>Q</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Draft quote</div>
                        <div style={{ fontSize: 12, color: "#8c919c" }}>
                          {vm.valueLabel} · owner {vm.ownerShort}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                    <div>
                      <div style={lbl}>Primary venue</div>
                      <input
                        className="ldw-in"
                        value={cvVenue}
                        onChange={(e) => setCvVenue(e.target.value)}
                        placeholder="Main venue"
                        style={inStyle}
                      />
                    </div>
                    <div>
                      <div style={lbl}>Customer type</div>
                      <select
                        className="ldw-in"
                        value={cvType}
                        onChange={(e) => setCvType(e.target.value)}
                        style={selStyle}
                      >
                        {TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* #34 — survey gate (server re-checks in convertLeadAction) */}
                  <div
                    style={{
                      marginTop: 16,
                      padding: "11px 13px",
                      borderRadius: 11,
                      background: gateBlocked ? "#fbf3dd" : "#eaf6ef",
                      border: `1px solid ${gateBlocked ? "#f0e2bd" : "#cce9da"}`,
                      fontSize: 12.5,
                      color: gateBlocked ? "#8a6d1f" : "#1f7a52",
                      lineHeight: 1.5,
                    }}
                  >
                    {thread.survey
                      ? `Site survey ${thread.survey.id} — ${thread.survey.label}.`
                      : "No site survey is linked to this lead."}
                    {gateBlocked && " Converting normally waits for a completed survey."}
                  </div>
                  {gateBlocked && (
                    <div style={{ marginTop: 12 }}>
                      <label
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      >
                        <input
                          type="checkbox"
                          checked={skipSurvey}
                          onChange={(e) => setSkipSurvey(e.target.checked)}
                        />
                        Skip survey and convert anyway
                      </label>
                      {skipSurvey && (
                        <input
                          className="ldw-in"
                          value={skipReason}
                          onChange={(e) => setSkipReason(e.target.value)}
                          placeholder="Why skip? (optional — logged on the lead)"
                          style={{ ...inStyle, marginTop: 9 }}
                        />
                      )}
                    </div>
                  )}
                  {cvErr && (
                    <div style={{ fontSize: 12, color: "#b4543a", fontWeight: 600, marginTop: 12 }}>{cvErr}</div>
                  )}
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setView("main")} style={ghostBtn}>
                      Cancel
                    </button>
                    <button onClick={doConvert} disabled={busy || (gateBlocked && !skipSurvey)} style={primaryBtn}>
                      Convert lead
                    </button>
                  </div>
                </div>
              )}

              {/* ===== REQUEST VISIT view (#34) ===== */}
              {view === "visit" && (
                <div style={{ padding: "18px 22px 22px" }}>
                  <button onClick={() => setView("main")} style={backBtn}>
                    ← Back
                  </button>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em" }}>Request a site visit</div>
                  <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.55, marginTop: 6 }}>
                    Creates an open visit request and a linked survey brief. Assign someone, or leave
                    it open for anyone to claim from Field Survey.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
                    <div>
                      <div style={lbl}>Reason</div>
                      <select
                        className="ldw-in"
                        value={reqReason}
                        onChange={(e) => setReqReason(e.target.value)}
                        style={selStyle}
                      >
                        {visitReasons.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={lbl}>Preferred timing</div>
                      <input
                        className="ldw-in"
                        value={reqTiming}
                        onChange={(e) => setReqTiming(e.target.value)}
                        placeholder="e.g. Week of Aug 10, mornings"
                        style={inStyle}
                      />
                    </div>
                    <div>
                      <div style={lbl}>Assign to</div>
                      <select
                        className="ldw-in"
                        value={reqAssignee}
                        onChange={(e) => setReqAssignee(e.target.value)}
                        style={selStyle}
                      >
                        <option value="">Open — anyone can claim</option>
                        {rosterNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {reqErr && (
                    <div style={{ fontSize: 12, color: "#b4543a", fontWeight: 600, marginTop: 12 }}>{reqErr}</div>
                  )}
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setView("main")} style={ghostBtn}>
                      Cancel
                    </button>
                    <button onClick={doRequestVisit} disabled={busy} style={primaryBtn}>
                      Request visit
                    </button>
                  </div>
                </div>
              )}

              {/* ===== LOST view ===== */}
              {view === "lost" && (
                <div style={{ padding: "18px 22px 22px" }}>
                  <button onClick={() => setView("main")} style={backBtn}>
                    ← Back
                  </button>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em" }}>Mark as lost</div>
                  <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.55, marginTop: 6 }}>
                    Why didn&apos;t this one work out? This helps the team learn.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 16 }}>
                    {LOST_DEFS.map((r) => {
                      const on = lostReason === r;
                      const label = r === "__other" ? "Other reason" : r;
                      return (
                        <button
                          key={r}
                          onClick={() => setLostReason(r)}
                          style={{
                            textAlign: "left",
                            fontFamily: "var(--font-ui)",
                            fontSize: 13,
                            fontWeight: on ? 600 : 500,
                            padding: "11px 13px",
                            borderRadius: 9,
                            cursor: "pointer",
                            border: `1px solid ${on ? "#b4543a" : "#e4e7ec"}`,
                            background: on ? "#f8ece7" : "#fff",
                            color: on ? "#b4543a" : "#3a3f4a",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    className="ldw-in"
                    value={lostOther}
                    onChange={(e) => {
                      setLostOther(e.target.value);
                      setLostReason("__other");
                    }}
                    placeholder="Other reason…"
                    style={{ ...inStyle, marginTop: 10 }}
                  />
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setView("main")} style={ghostBtn}>
                      Cancel
                    </button>
                    <button onClick={doLost} disabled={busy} style={dangerBtn}>
                      Mark lost
                    </button>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
