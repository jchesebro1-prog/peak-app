"use client";

import { useRef, useState, useTransition } from "react";
import { askAction } from "./actions";

/**
 * The "Ask about your business data" chat surface (Phase 8, D5). A lightweight
 * ask/answer log — each question rebuilds a fresh live snapshot server-side, so
 * there's no conversation memory to persist; the log is client-only UI state.
 * The assistant is read-only (D6): it answers, it never acts.
 */

type Turn = { q: string; a?: string; error?: string };

const SUGGESTIONS = [
  "How's the pipeline looking right now?",
  "Which flame-test renewals are overdue?",
  "What are our biggest open quotes?",
  "How many leads need follow-up?",
];

export default function AssistantClient({ meName }: { meName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);

  function submit(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    const idx = turns.length;
    setTurns((t) => [...t, { q }]);
    start(async () => {
      const res = await askAction(q);
      setTurns((t) => {
        const next = t.slice();
        next[idx] = res.ok
          ? { q, a: res.answer }
          : { q, error: res.error };
        return next;
      });
      requestAnimationFrame(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
      });
    });
  }

  return (
    <div
      className="pk-content"
      style={{
        maxWidth: 820,
        padding: "26px 30px 40px",
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 56px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "var(--accent-soft)",
            color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            flexShrink: 0,
          }}
        >
          ✨
        </span>
        <div>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.015em" }}>
            Assistant
          </div>
          <div style={{ fontSize: 13, color: "#8c919c", marginTop: 1 }}>
            Ask about your quotes, customers, renewals and pipeline. Answers use
            your live business data.
          </div>
        </div>
      </div>

      <div
        ref={logRef}
        style={{
          flex: 1,
          overflowY: "auto",
          marginTop: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          paddingRight: 4,
        }}
      >
        {turns.length === 0 && (
          <div
            className="pk-card"
            style={{ padding: "22px 20px", background: "#fafbfc" }}
          >
            <div style={{ fontSize: 13.5, color: "#5b616e", lineHeight: 1.6 }}>
              Hi {meName.split(" ")[0]} — I can answer questions about what&#39;s in
              the app right now. Try one of these, or ask your own:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "color-mix(in srgb, var(--accent) 72%, #16181d)",
                    background: "var(--accent-soft)",
                    border: "1px solid color-mix(in srgb, var(--accent) 20%, #fff)",
                    borderRadius: 20,
                    padding: "7px 13px",
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  maxWidth: "78%",
                  background: "var(--accent)",
                  color: "#fff",
                  borderRadius: "14px 14px 4px 14px",
                  padding: "10px 14px",
                }}
              >
                {t.q}
              </div>
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: "var(--accent-soft)",
                  color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                ✨
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                {t.a != null ? (
                  <div
                    style={{
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      color: "#2b2f38",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {t.a}
                  </div>
                ) : t.error ? (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: "#b4543a",
                      background: "#f8ece7",
                      border: "1px solid #eccfc4",
                      borderRadius: 9,
                      padding: "9px 12px",
                    }}
                  >
                    {t.error}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#9aa0ab" }}>Thinking…</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "flex-end" }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(input);
            }
          }}
          placeholder="Ask about your business data…"
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.5,
            padding: "11px 14px",
            border: "1px solid #e4e7ec",
            borderRadius: 12,
            outline: "none",
            maxHeight: 160,
          }}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="pk-btn-accent"
          style={{
            flexShrink: 0,
            opacity: pending || !input.trim() ? 0.5 : 1,
            cursor: pending || !input.trim() ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "…" : "Ask"}
        </button>
      </form>
      <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 8, textAlign: "center" }}>
        Answers are generated from your live data and may be imperfect — verify
        anything important against the source screen.
      </div>
    </div>
  );
}
