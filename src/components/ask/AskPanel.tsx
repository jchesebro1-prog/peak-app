"use client";

/**
 * Ask AI — the panel (spec 2026-10-13-ask-ai-design.md §1). Opened from the
 * ⌘K "Ask AI" row with the query as the first question; anchored under the
 * search box, full screen under 700 px. Esc / ✕ close it and closing forgets
 * the conversation (Nav also closes it on a route change).
 *
 * Model text is untrusted: answers render through ask-render's block model
 * as React text — paragraphs, `- ` bullets, `**bold**` — and a `[[kind:id]]`
 * links only when a `ref` event whitelisted that exact kind:id in this
 * conversation. Web sources are http(s) only and open in a new tab. No HTML
 * is ever injected from model text. Imports only actions, pure modules and
 * types.
 */
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ASK_CONTEXT_ROUTE,
  ASK_OFFLINE_TEXT,
  ASK_ROUTE,
  applyAskEvent,
  askResponseProblem,
  askStatusText,
  askTurnRefused,
  buildAskMessages,
  canTryHarder,
  finishAskTurn,
  newAskTurn,
  readAskStream,
  type AskTurnState,
} from "@/lib/assist/ask-client";
import { renderAnswerBlocks, sourceLabel, type AskInline, type AskLinkRef, type AskWhitelist } from "@/lib/assist/features/ask-render";
import { refKey, type RefKind } from "@/lib/assist/features/ask-refs";
import { ASK_PAGE_MAX, ASK_TURN_MAX } from "@/lib/assist/features/ask-body";
import { handlePopoutClick } from "@/lib/popout/open";
import type { PopKind } from "@/lib/popout/names";
import AskCards, { type AskTeamMember } from "./AskCards";

/** Kinds with a #336 pop-out: Shift-click opens that window. */
const POP_FOR: Partial<Record<RefKind, PopKind>> = { thread: "thread", quote: "estimate", company: "customer" };

type Ctx = { ref: { kind: RefKind; id: string; title: string; href: string }; title: string };

const CSS = `
.pk-ask { position: fixed; top: 60px; right: 16px; width: 520px; max-width: calc(100vw - 32px); max-height: 70vh; display: flex; flex-direction: column; background: #fff; border: 1px solid #e8eaee; border-radius: 12px; box-shadow: 0 16px 46px rgba(0,0,0,.24); z-index: 85; color: #16181d; font-family: var(--font-ui); }
.pk-ask a.pk-ask-ref { color: var(--accent-ink); font-weight: 600; text-decoration: none; }
.pk-ask a.pk-ask-ref:hover { text-decoration: underline; }
.pk-ask-answer p { margin: 0 0 8px; line-height: 1.5; }
.pk-ask-answer ul { margin: 0 0 8px; padding-left: 18px; line-height: 1.5; }
@media (max-width: 700px) {
  .pk-ask { top: 0; right: 0; left: 0; bottom: 0; width: 100vw; max-width: none; max-height: none; height: 100dvh; border-radius: 0; border: none; padding-top: env(safe-area-inset-top); }
}
`;

const iconBtn: CSSProperties = { width: 28, height: 28, borderRadius: 7, border: "1px solid #e4e7ec", background: "#fff", color: "#5b616e", cursor: "pointer", fontSize: 14, lineHeight: 1, flexShrink: 0 };
const muted: CSSProperties = { fontSize: 11.5, color: "#9aa0ab" };

/** One record link: a plain click navigates (and closes the panel); Shift-click pops out where #336 has a window; Cmd/Ctrl-click keeps the browser's new tab. */
function RefLink({ link, onNavigate }: { link: AskLinkRef; onNavigate: (href: string) => void }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const pop = POP_FOR[link.kind];
    if (pop && handlePopoutClick(e, pop, link.id, link.href)) return;
    if (e.metaKey || e.ctrlKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(link.href);
  };
  return (
    <a className="pk-ask-ref" href={link.href} onClick={onClick} title={`${link.kind} ${link.id}`}>
      {link.title}
    </a>
  );
}

function Inline({ runs, onNavigate }: { runs: AskInline[]; onNavigate: (href: string) => void }) {
  return (
    <>
      {runs.map((r, i) => {
        const el = "link" in r ? <RefLink link={r.link} onNavigate={onNavigate} /> : r.text;
        return r.bold ? <strong key={i}>{el}</strong> : <span key={i}>{el}</span>;
      })}
    </>
  );
}

const Answer = memo(function Answer({ text, whitelist, onNavigate }: { text: string; whitelist: AskWhitelist; onNavigate: (href: string) => void }) {
  const blocks = renderAnswerBlocks(text, whitelist);
  return (
    <div className="pk-ask-answer" style={{ fontSize: 13 }}>
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline runs={it} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {b.lines.map((ln, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Inline runs={ln} onNavigate={onNavigate} />
              </span>
            ))}
          </p>
        )
      )}
    </div>
  );
});

export default function AskPanel({
  initialQuestion,
  page,
  team,
  meId,
  onClose,
}: {
  initialQuestion: string;
  /** location.pathname + location.search when the panel opened */
  page: string;
  team: AskTeamMember[];
  meId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<AskTurnState[]>([]);
  const [whitelist, setWhitelist] = useState<Map<string, { title: string; href: string }>>(() => new Map());
  const [input, setInput] = useState("");
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [ctxDropped, setCtxDropped] = useState(false);
  const turnsRef = useRef<AskTurnState[]>([]);
  const ctlRef = useRef<AbortController | null>(null);
  const keyRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const pagePath = page.slice(0, ASK_PAGE_MAX);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const onNavigate = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  /** Ask one question (or re-ask the latest with Sonnet: `retry`). One stream at a time. */
  const ask = useCallback(
    async (question: string, retry: { key: number; runId: string | null } | null = null) => {
      if (ctlRef.current) return;
      const all = turnsRef.current;
      const prior = retry ? all.filter((t) => t.key !== retry.key) : all;
      const messages = buildAskMessages(prior.filter((t) => !t.streaming).map((t) => ({ question: t.question, answer: t.answer })), question);
      if (!messages) return;
      const key = ++keyRef.current;
      const hard = !!retry;
      const turn = newAskTurn(key, question.trim(), { hard, web });
      setTurns((ts) => (retry ? ts.map((t) => (t.key === retry.key ? turn : t)) : [...ts, turn]));
      const update = (f: (t: AskTurnState) => AskTurnState) => setTurns((ts) => ts.map((t) => (t.key === key ? f(t) : t)));
      const ctl = new AbortController();
      ctlRef.current = ctl;
      setBusy(true);
      try {
        const res = await fetch(ASK_ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages, page: ctxDropped ? null : pagePath || null, web, hard, retryOf: retry?.runId ?? null }),
          signal: ctl.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        const problem = await askResponseProblem(res);
        if (problem || !res.body) {
          update((t) => finishAskTurn(t, { aborted: false, failure: problem || ASK_OFFLINE_TEXT }));
          return;
        }
        await readAskStream(res.body, (e) => {
          if (e.t === "ref") {
            setWhitelist((m) => {
              const k = refKey(e.kind, e.id);
              if (m.has(k)) return m;
              const next = new Map(m);
              next.set(k, { title: e.title, href: e.href });
              return next;
            });
          }
          update((t) => applyAskEvent(t, e));
        });
        update((t) => finishAskTurn(t, { aborted: ctl.signal.aborted }));
      } catch {
        update((t) => finishAskTurn(t, { aborted: ctl.signal.aborted, failure: ctl.signal.aborted ? null : ASK_OFFLINE_TEXT }));
      } finally {
        if (ctlRef.current === ctl) ctlRef.current = null;
        setBusy(false);
      }
    },
    [ctxDropped, pagePath, web]
  );

  // The page's context chip, and the first question — once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (pagePath) {
      fetch(`${ASK_CONTEXT_ROUTE}?page=${encodeURIComponent(pagePath)}`, { credentials: "same-origin", cache: "no-store" })
        .then(async (r) => {
          const type = (r.headers.get("content-type") || "").toLowerCase();
          if (!r.ok || !type.includes("application/json")) return;
          const v = (await r.json()) as Ctx | null;
          if (v && v.ref && typeof v.title === "string" && v.title) setCtx({ ref: v.ref, title: v.title });
        })
        .catch(() => {});
    }
    if (initialQuestion.trim()) void ask(initialQuestion);
    else queueMicrotask(() => inputRef.current?.focus());
  }, [ask, initialQuestion, pagePath]);

  // Esc closes; closing (or unmounting on a route change) stops the stream.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // A real unmount aborts the stream; React's dev-only remount (Strict Mode)
  // re-mounts before the timer fires, so it doesn't stop the first question.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const ctl = ctlRef.current;
      setTimeout(() => {
        if (!mountedRef.current) ctl?.abort();
      }, 0);
    };
  }, []);

  // Keep the newest answer in view while it streams, unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    void ask(q);
  };
  const latestKey = turns.length ? turns[turns.length - 1].key : -1;

  return (
    <div className="pk-ask" role="dialog" aria-label="Ask AI">
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>✦ Ask AI</span>
        <span style={{ ...muted, flex: 1 }}>Looks things up; changes nothing until you confirm a card.</span>
        <button type="button" aria-label="Close Ask AI" title="Close (Esc)" onClick={onClose} style={iconBtn}>
          ✕
        </button>
      </div>

      {ctx && !ctxDropped && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid #f0f1f4", fontSize: 12 }}>
          <span style={{ background: "#f3f4f7", borderRadius: 999, padding: "3px 4px 3px 10px", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", minWidth: 0 }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Looking at: <b>{ctx.title}</b>
            </span>
            <button
              type="button"
              aria-label="Don't use this page"
              title="Don't use this page for follow-ups"
              onClick={() => setCtxDropped(true)}
              style={{ border: "none", background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 12, padding: "0 6px" }}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px" }}>
        {turns.map((t) => {
          const status = askStatusText(t);
          const latest = t.key === latestKey;
          return (
            <div key={t.key} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                <div style={{ background: "#f3f4f7", borderRadius: 10, padding: "6px 10px", fontSize: 13, maxWidth: "85%", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.question}</div>
              </div>
              {t.hard && <div style={{ ...muted, marginBottom: 4 }}>Tried harder (Sonnet)</div>}
              {t.answer && <Answer text={t.answer} whitelist={whitelist} onNavigate={onNavigate} />}
              {status && (
                <div style={{ ...muted, fontStyle: "italic" }} aria-live="polite">
                  {status}
                </div>
              )}
              {t.stopped && <div style={muted}>Stopped.</div>}
              {t.error && (
                <div role="alert" style={{ fontSize: 12.5, color: "#b4543a", marginTop: 4 }}>
                  {t.error}
                </div>
              )}
              <AskCards cards={t.cards} runId={t.runId} streaming={t.streaming} whitelist={whitelist} team={team} meId={meId} onNavigate={onNavigate} />
              {t.looked.length > 0 && (
                <details style={{ marginTop: 8, fontSize: 12 }}>
                  <summary style={{ cursor: "pointer", color: "#5b616e" }}>
                    Looked at {t.looked.length} record{t.looked.length === 1 ? "" : "s"}
                  </summary>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {t.looked.map((r) => (
                      <li key={refKey(r.kind, r.id)}>
                        <span style={{ color: "#9aa0ab" }}>{r.kind} · </span>
                        <RefLink link={r} onNavigate={onNavigate} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {t.sources.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: "#5b616e" }}>Sources</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {t.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-ink)", wordBreak: "break-word" }}>
                          {sourceLabel(s.url, s.title)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {canTryHarder(t, latest) && !busy && !askTurnRefused(t) && (
                <button type="button" className="pk-btn-outline" style={{ marginTop: 8 }} title="Re-ask this question with Sonnet, replacing this answer" onClick={() => void ask(t.question, { key: t.key, runId: t.runId })}>
                  Try harder
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: "1px solid #f0f1f4", padding: "8px 12px 10px" }}>
        <textarea
          ref={inputRef}
          aria-label="Ask a follow-up"
          placeholder={turns.length ? "Ask a follow-up…" : "Ask about your records…"}
          value={input}
          maxLength={ASK_TURN_MAX}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 10px", fontSize: 13, fontFamily: "var(--font-ui)", resize: "none" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3a3f4a", cursor: "pointer", flex: 1 }}>
            <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
            Search the web
          </label>
          {busy ? (
            <button type="button" className="pk-btn-outline" onClick={() => ctlRef.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="button" className="pk-btn-accent" disabled={!input.trim()} onClick={send} style={{ padding: "7px 14px", opacity: input.trim() ? 1 : 0.5 }}>
              Ask
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
