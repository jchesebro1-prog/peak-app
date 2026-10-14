"use client";

/**
 * AI daily brief — the Home card's client half (spec §4): collapse
 * (remembered per brief id), Rebuild, Listen / Stop, `?brief=1` scrolling,
 * and the big-text variant under 900 px (pure CSS — both variants render,
 * a media query picks one). Imports only an action, pure modules and types.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { rebuildBriefAction } from "@/app/(app)/brief-actions";
import { postChanged } from "@/lib/popout/channel";
import type { BriefCardVM } from "@/lib/brief/card-vm";
import SuggestEstimate from "@/components/assist/suggest-estimate";

const COLLAPSE_KEY = (id: string) => `peak-brief-collapsed:${id}`;

const CSS = `
.pkb-big{display:none}
.pkb-btn{border:1px solid #e4e7ec;background:#fff;color:#3a3f4a;border-radius:7px;padding:3px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.pkb-btn:hover{border-color:#c4c9d2}
.pkb-btn:disabled{opacity:.6;cursor:default}
.pkb-chip{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.02em;padding:1px 7px;border-radius:5px;background:color-mix(in srgb,var(--accent) 12%,#fff);color:color-mix(in srgb,var(--accent) 68%,#000)}
.pkb-link{color:var(--accent);text-decoration:none;font-weight:600}
.pkb-link:hover{text-decoration:underline}
@media (max-width:899px){
  .pkb-full{display:none}
  .pkb-big{display:block}
}
`;

const H: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#8c919c", margin: "12px 0 5px" };

export default function BriefCardView({ vm }: { vm: BriefCardVM }) {
  const router = useRouter();
  const rootRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rebuildInFlight = useRef(false);
  // ?brief=1 (the phone reminder's tap → router.push) — a dependency, so a
  // push onto an already-open Home still scrolls here.
  const briefParam = useSearchParams().get("brief");

  // After paint (the server render is always expanded / no Listen): the
  // remembered collapse, speech support, and ?brief=1 → scroll here.
  useEffect(() => {
    queueMicrotask(() => {
      let wasCollapsed = false;
      try {
        wasCollapsed = window.localStorage.getItem(COLLAPSE_KEY(vm.id)) === "1";
      } catch {
        /* storage unavailable (private mode, blocked) — stay expanded */
      }
      const fromReminder = briefParam === "1";
      setCollapsed(wasCollapsed && !fromReminder);
      setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function");
      if (fromReminder) rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [vm.id, briefParam]);

  // Leaving Home (or a new brief) stops the voice.
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* nothing speaking */
      }
    };
  }, [vm.id]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      if (next) window.localStorage.setItem(COLLAPSE_KEY(vm.id), "1");
      else window.localStorage.removeItem(COLLAPSE_KEY(vm.id));
    } catch {
      /* not remembered — fine */
    }
  };

  const listen = () => {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(vm.speech);
      u.lang = "en-US";
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(u);
    } catch {
      setSpeaking(false);
    }
  };

  const stop = () => {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing speaking */
    }
    setSpeaking(false);
  };

  const rebuild = async () => {
    if (rebuildInFlight.current) return;
    rebuildInFlight.current = true;
    setRebuilding(true);
    setError(null);
    try {
      const r = await rebuildBriefAction();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // The rebuild may have run the Inbox AI pass (court / filing) too.
      postChanged("inbox");
      router.refresh();
    } catch {
      setError("Couldn’t rebuild the brief — try again.");
    } finally {
      rebuildInFlight.current = false;
      setRebuilding(false);
    }
  };

  const listenBtn = canSpeak ? (
    speaking ? (
      <button type="button" className="pkb-btn" onClick={stop} aria-label="Stop reading the brief">
        ■ Stop
      </button>
    ) : (
      <button type="button" className="pkb-btn" onClick={listen} aria-label="Read the brief aloud">
        ▶ Listen
      </button>
    )
  ) : null;

  return (
    <section ref={rootRef} id="brief" className="pk-card" style={{ marginBottom: 22, overflow: "hidden", scrollMarginTop: 12 }} aria-label={vm.title}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 17px 6px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: "#16181d" }}>{vm.title}</span>
          <span style={{ fontSize: 12, color: "#8c919c" }}>{vm.builtLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {listenBtn}
          {vm.canRebuild && (
            <button type="button" className="pkb-btn" onClick={rebuild} disabled={rebuilding} aria-busy={rebuilding} title="Build this brief again from the latest list (3 per hour)">
              {rebuilding ? "Rebuilding…" : "Rebuild"}
            </button>
          )}
          <button type="button" className="pkb-btn" onClick={toggle} aria-expanded={!collapsed}>
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" style={{ margin: "0 17px 6px", fontSize: 12, color: "#b4543a" }}>
          {error}
        </p>
      )}
      {!collapsed && (
        <div style={{ padding: "0 17px 14px" }}>
          {vm.notes.map((n) => (
            <div key={n} style={{ fontSize: 12, color: "#8a6d1f", marginBottom: 4 }}>
              {n}
            </div>
          ))}
          <FullVariant vm={vm} />
          <BigVariant vm={vm} />
        </div>
      )}
    </section>
  );
}

function FullVariant({ vm }: { vm: BriefCardVM }) {
  return (
    <div className="pkb-full">
      {vm.since && <p style={{ margin: "2px 0 6px", fontSize: 12.5, fontWeight: 600, color: "#3a3f4a" }}>{vm.since}</p>}
      <p style={{ margin: "2px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "#16181d", whiteSpace: "pre-line" }}>{vm.summary}</p>

      {vm.doFirst.length > 0 && (
        <>
          <div style={H}>Do these first</div>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
            {vm.doFirst.map((d) => (
              <li key={d.key} style={{ fontSize: 13, lineHeight: 1.45, color: "#16181d" }}>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                  {d.source && <span style={{ fontSize: 11, color: "#8c919c" }}>{d.source}</span>}
                  {d.href ? (
                    <Link href={d.href} className="pkb-link">
                      {d.title}
                    </Link>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{d.title}</span>
                  )}
                  {d.draftReady && <span className="pkb-chip">Draft ready</span>}
                  {d.tasksReady && <span className="pkb-chip">Tasks ready</span>}
                </span>
                {d.why && <div style={{ fontSize: 12.5, color: "#5b616e" }}>{d.why}</div>}
                {d.leadSuggest ? (
                  <div style={{ fontSize: 12, color: "#5b616e", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                    Ready to quote?
                    <SuggestEstimate
                      source={{ kind: "lead", id: d.leadSuggest.leadId }}
                      readyHref={d.leadSuggest.readyHref}
                      buttonStyle={{ fontSize: 12, padding: "3px 10px", borderRadius: 7, color: "#3a3f4a" }}
                    />
                  </div>
                ) : (
                  d.leadHref && (
                    <div style={{ fontSize: 12, color: "#5b616e" }}>
                      Ready to quote? →{" "}
                      <Link href={d.leadHref} className="pkb-link">
                        Open lead
                      </Link>
                    </div>
                  )
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {vm.organize && (
        <>
          <div style={H}>Inbox organization</div>
          <div style={{ fontSize: 13, color: "#3a3f4a" }}>
            {vm.organize.label} →{" "}
            <Link href={vm.organize.href} className="pkb-link">
              Review
            </Link>
          </div>
        </>
      )}

      {vm.promises.length > 0 && (
        <>
          <div style={H}>New tasks from promises</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3 }}>
            {vm.promises.map((p) => (
              <li key={p.taskId} style={{ fontSize: 13, color: "#16181d" }}>
                {p.title}
                {p.dueLabel && <span style={{ color: "#8c919c" }}> · due {p.dueLabel}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {(vm.today || vm.approvals) && (
        <>
          <div style={H}>Today</div>
          {vm.today && <div style={{ fontSize: 13, color: "#3a3f4a" }}>{vm.today}</div>}
          {vm.approvals && <div style={{ fontSize: 13, color: "#3a3f4a" }}>{vm.approvals}</div>}
        </>
      )}

      {vm.quiet.length > 0 && (
        <>
          <div style={H}>Quiet quotes</div>
          <div style={{ display: "grid", gap: 8 }}>
            {vm.quiet.map((q) => (
              <div key={q.quoteId} style={{ border: "1px solid #f0f1f4", borderRadius: 9, padding: "8px 11px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#16181d" }}>{q.label}</span>
                  <span style={{ fontSize: 12, color: "#8c919c" }}>{q.daysLabel}</span>
                </div>
                {q.note && <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 3 }}>{q.note}</div>}
                <div style={{ display: "flex", gap: 14, marginTop: 5, fontSize: 12.5 }}>
                  {q.nudgeHref && (
                    <Link href={q.nudgeHref} className="pkb-link" title="Opens the Inbox composer with the follow-up — review it before sending">
                      Send nudge
                    </Link>
                  )}
                  <Link href={q.openHref} className="pkb-link">
                    Open estimate
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Under 900 px: larger type, summary + Do these first + counts — no drafts. */
function BigVariant({ vm }: { vm: BriefCardVM }) {
  return (
    <div className="pkb-big">
      {vm.since && <p style={{ margin: "4px 0 8px", fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>{vm.since}</p>}
      <p style={{ margin: "4px 0 0", fontSize: 18, lineHeight: 1.55, color: "#16181d", whiteSpace: "pre-line" }}>{vm.summary}</p>
      {vm.doFirst.length > 0 && (
        <>
          <div style={{ ...H, fontSize: 13 }}>Do these first</div>
          <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 10 }}>
            {vm.doFirst.map((d) => (
              <li key={d.key} style={{ fontSize: 17, lineHeight: 1.45, color: "#16181d" }}>
                {d.href ? (
                  <Link href={d.href} className="pkb-link">
                    {d.title}
                  </Link>
                ) : (
                  <span style={{ fontWeight: 600 }}>{d.title}</span>
                )}
                {d.why && <div style={{ fontSize: 15, color: "#5b616e" }}>{d.why}</div>}
              </li>
            ))}
          </ol>
        </>
      )}
      {vm.counts.length > 0 && (
        <ul style={{ margin: "12px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
          {vm.counts.map((c) => (
            <li key={c} style={{ fontSize: 16, color: "#3a3f4a" }}>
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
