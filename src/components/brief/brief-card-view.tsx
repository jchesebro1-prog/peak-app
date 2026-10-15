"use client";

/**
 * AI daily brief — the Home card's client half (spec §4): collapse
 * (remembered per brief id), Rebuild, Listen / Stop, `?brief=1` scrolling,
 * and the big-text variant under 900 px (pure CSS — both variants render,
 * a media query picks one). Imports only an action, pure modules and types.
 * Both variants show the summary, then the VM's blocks in order — Emails,
 * Estimates, Tasks (Jeff, 2026-10-15) — with the Do-these-first picks as ★
 * inside their own block.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { rebuildBriefAction } from "@/app/(app)/brief-actions";
import { postChanged } from "@/lib/popout/channel";
import type { BriefBlockItem, BriefBlockVM, BriefCardVM } from "@/lib/brief/card-vm";
import SuggestEstimate from "@/components/assist/suggest-estimate";

const COLLAPSE_KEY = (id: string) => `peak-brief-collapsed:${id}`;

const CSS = `
.pkb-big{display:none}
.pkb-btn{border:1px solid #e4e7ec;background:#fff;color:#3a3f4a;border-radius:7px;padding:3px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.pkb-btn:hover{border-color:#c4c9d2}
.pkb-btn:disabled{opacity:.6;cursor:default}
.pkb-chip{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.02em;padding:1px 7px;border-radius:5px;background:color-mix(in srgb,var(--accent) 12%,#fff);color:color-mix(in srgb,var(--accent) 68%,#000)}
.pkb-star{color:var(--accent);font-weight:700;line-height:1;cursor:help}
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
      <p style={{ margin: "2px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--ink)", whiteSpace: "pre-line" }}>{vm.summary}</p>
      {vm.blocks.map((block) => (
        <section key={block.id} data-brief-block={block.id} aria-label={block.title}>
          <div style={H}>{block.title}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {block.items.map((it) => (
              <FullItem key={itemKey(it)} it={it} />
            ))}
          </div>
          <More block={block} size={12.5} />
        </section>
      ))}
    </div>
  );
}

const itemKey = (it: BriefBlockItem): string =>
  it.kind === "row" ? it.key : it.kind === "quiet" ? `quiet:${it.quoteId}` : it.kind === "promise" ? `promise:${it.taskId}` : it.kind === "line" ? `line:${it.id}` : it.kind;

/** ★ — one of the brief's Do-these-first picks; its why is the tooltip (and the small text under the row). */
function Star({ why, size }: { why: string; size: number }) {
  return (
    <span className="pkb-star" style={{ fontSize: size }} title={why ? `Do this first — ${why}` : "Do this first"} aria-label="Do this first">
      ★
    </span>
  );
}

function More({ block, size }: { block: BriefBlockVM; size: number }) {
  if (!block.more.length) return null;
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 5, fontSize: size }}>
      {block.more.map((m) => (
        <Link key={m.href} href={m.href} className="pkb-link">
          {m.label}
        </Link>
      ))}
    </div>
  );
}

function FullItem({ it }: { it: BriefBlockItem }) {
  switch (it.kind) {
    case "row":
      return (
        <div data-brief-row={it.key} data-brief-star={it.star ? "1" : undefined} style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink)" }} title={it.star ? undefined : it.hint || undefined}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
            {it.star && <Star why={it.why} size={13} />}
            {it.source && <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{it.source}</span>}
            {it.href ? (
              <Link href={it.href} className="pkb-link">
                {it.title}
              </Link>
            ) : (
              <span style={{ fontWeight: 600 }}>{it.title}</span>
            )}
            {it.draftReady && it.source === "Email" && it.href ? (
              <span style={{ fontSize: 12 }}>
                <span className="pkb-chip">Draft reply ready</span>{" "}
                <span aria-hidden style={{ color: "var(--muted-2)" }}>
                  ·
                </span>{" "}
                <Link href={it.href} className="pkb-link" title="Opens the thread — Use it puts the prepared draft in the reply; review it before sending">
                  Use it
                </Link>
              </span>
            ) : (
              it.draftReady && <span className="pkb-chip">Draft ready</span>
            )}
            {it.tasksReady && <span className="pkb-chip">Tasks ready</span>}
          </span>
          {it.star && it.why && <div style={{ fontSize: 12.5, color: "#5b616e" }}>{it.why}</div>}
          {it.leadSuggest ? (
            <div style={{ fontSize: 12, color: "#5b616e", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
              Ready to quote?
              <SuggestEstimate
                source={{ kind: "lead", id: it.leadSuggest.leadId }}
                readyHref={it.leadSuggest.readyHref}
                buttonStyle={{ fontSize: 12, padding: "3px 10px", borderRadius: 7, color: "#3a3f4a" }}
              />
            </div>
          ) : (
            it.leadHref && (
              <div style={{ fontSize: 12, color: "#5b616e" }}>
                Ready to quote? →{" "}
                <Link href={it.leadHref} className="pkb-link">
                  Open lead
                </Link>
              </div>
            )
          )}
        </div>
      );
    case "quiet":
      return (
        <div data-brief-quiet={it.quoteId} style={{ border: "1px solid var(--divider)", borderRadius: 9, padding: "8px 11px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted-2)", marginRight: 6 }}>Quiet</span>
              {it.label}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted-2)" }}>{it.daysLabel}</span>
          </div>
          {it.note && <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 3 }}>{it.note}</div>}
          <div style={{ display: "flex", gap: 14, marginTop: 5, fontSize: 12.5 }}>
            {it.nudgeHref && (
              <Link href={it.nudgeHref} className="pkb-link" title="Opens the Inbox composer with the follow-up — review it before sending">
                Send nudge
              </Link>
            )}
            <Link href={it.openHref} className="pkb-link">
              Open estimate
            </Link>
          </div>
        </div>
      );
    case "promise":
      return (
        <div data-brief-promise={it.taskId} style={{ fontSize: 13, color: "var(--ink)" }}>
          <span style={{ fontSize: 11, color: "var(--muted-2)", marginRight: 6 }}>From a promise</span>
          {it.title}
          {it.dueLabel && <span style={{ color: "var(--muted-2)" }}> · due {it.dueLabel}</span>}
        </div>
      );
    case "organize":
      return (
        <div data-brief-organize style={{ fontSize: 13, color: "#3a3f4a" }}>
          {it.label} —{" "}
          <Link href={it.href} className="pkb-link">
            Review
          </Link>
        </div>
      );
    case "cleanup":
      return (
        <div data-brief-organize-cleanup style={{ fontSize: 12.5, color: "#5b616e" }}>
          <Link href={it.href} className="pkb-link">
            {it.label} →
          </Link>{" "}
          {it.detail}
        </div>
      );
    case "line":
      return (
        <div data-brief-line={it.id} style={{ fontSize: 13, color: "#3a3f4a" }}>
          {it.text}
        </div>
      );
  }
}

/** Under 900 px: larger type — the summary, then the same three blocks in the same order. No drafts here (no Draft ready, notes or Send nudge). */
function BigVariant({ vm }: { vm: BriefCardVM }) {
  return (
    <div className="pkb-big">
      {vm.since && <p style={{ margin: "4px 0 8px", fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>{vm.since}</p>}
      <p style={{ margin: "4px 0 0", fontSize: 18, lineHeight: 1.55, color: "var(--ink)", whiteSpace: "pre-line" }}>{vm.summary}</p>
      {vm.blocks.map((block) => (
        <section key={block.id} data-brief-big-block={block.id} aria-label={block.title}>
          <div style={{ ...H, fontSize: 13, marginTop: 16 }}>{block.title}</div>
          <div style={{ display: "grid", gap: 10 }}>
            {block.items.map((it) => (
              <BigItem key={itemKey(it)} it={it} />
            ))}
          </div>
          <More block={block} size={15} />
        </section>
      ))}
    </div>
  );
}

function BigItem({ it }: { it: BriefBlockItem }) {
  const text: React.CSSProperties = { fontSize: 17, lineHeight: 1.45, color: "var(--ink)" };
  switch (it.kind) {
    case "row":
      return (
        <div style={text}>
          {it.star && (
            <>
              <Star why={it.why} size={17} />{" "}
            </>
          )}
          {it.href ? (
            <Link href={it.href} className="pkb-link">
              {it.title}
            </Link>
          ) : (
            <span style={{ fontWeight: 600 }}>{it.title}</span>
          )}
          {it.star && it.why && <div style={{ fontSize: 15, color: "#5b616e" }}>{it.why}</div>}
        </div>
      );
    case "quiet":
      return (
        <div style={text}>
          <Link href={it.openHref} className="pkb-link">
            {it.label}
          </Link>
          <div style={{ fontSize: 15, color: "#5b616e" }}>{it.daysLabel}</div>
        </div>
      );
    case "promise":
      return (
        <div style={text}>
          {it.title}
          {it.dueLabel && <span style={{ color: "var(--muted-2)" }}> · due {it.dueLabel}</span>}
        </div>
      );
    case "organize":
      return (
        <div style={{ ...text, fontSize: 16, color: "#3a3f4a" }}>
          Inbox: {it.label} —{" "}
          <Link href={it.href} className="pkb-link">
            Review inbox →
          </Link>
        </div>
      );
    case "cleanup":
      return (
        <div style={{ fontSize: 16 }}>
          <Link href={it.href} className="pkb-link">
            {it.label} →
          </Link>
        </div>
      );
    case "line":
      return <div style={{ ...text, fontSize: 16, color: "#3a3f4a" }}>{it.text}</div>;
  }
}
