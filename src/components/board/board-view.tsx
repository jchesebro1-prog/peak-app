"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// Client-safe pure helpers that grew up on the leads screen (no store
// imports, no "use client" needed on avatar.tsx). If a third consumer
// outside boards appears, promote them into components/.
import { OwnerDot } from "@/app/(app)/leads/avatar";
import { shortMoneyZero } from "@/app/(app)/leads/money";
import type { BoardCardVM, BoardColumnVM } from "./types";

/**
 * Generic kanban board (#18/#19) — the leads pipeline board
 * (Leads Explorations.dc.html) generalized to any column vocabulary.
 * HTML5 drag between columns calls the injected `moveAction` server action;
 * cards are optimistically re-homed while the transition + refresh are in
 * flight. Pages PRE-SORT cards (the component renders them in given order)
 * and declare per-card drag targets via `canMoveTo`; the server re-validates
 * every move with the same pure policy. No `moveAction`, or an empty
 * `canMoveTo`, renders a read-only card (no draggable attr).
 */
export default function BoardView({
  columns,
  cards,
  moveAction,
}: {
  columns: BoardColumnVM[];
  cards: BoardCardVM[];
    moveAction?: (id: string, col: string, details?: Record<string, string>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState<{ id: string; col: string } | null>(null);
  const [details, setDetails] = useState({ contact: "", email: "", phone: "", interest: "", timeline: "", message: "" });
  const [error, setError] = useState("");

  // Once the refresh lands (transition done), server props are fresh — drop
  // the optimistic overrides. Done during render on the pending→idle edge
  // (React's adjust-state-on-changed-value pattern) rather than in an effect,
  // which would paint one frame of stale overrides on top of fresh props.
  const [wasPending, setWasPending] = useState(isPending);
  if (wasPending !== isPending) {
    setWasPending(isPending);
    if (!isPending && Object.keys(moves).length) setMoves({});
  }

  const colOf = (c: BoardCardVM) => moves[c.id] || c.col;
  const canDrag = (c: BoardCardVM) => !!moveAction && c.canMoveTo.length > 0;

  const executeMove = (id: string, col: string, submitted?: Record<string, string>) => {
    if (!moveAction) return;
    setMoves((m) => ({ ...m, [id]: col }));
    startTransition(async () => {
      const result = await moveAction(id, col, submitted);
      if (!result.ok) {
        setMoves((m) => { const next = { ...m }; delete next[id]; return next; });
        setError(result.error || "That opportunity could not be moved.");
      }
      router.refresh();
    });
  };

  const drop = (col: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData("text/plain");
    setDragId(null);
    if (!id || !moveAction) return;
    const card = cards.find((c) => c.id === id);
    if (!card || colOf(card) === col) return;
    // Policy gate (targets are declared relative to the card's server-known
    // column; the server action re-validates regardless).
    if (!card.canMoveTo.includes(col)) return;
    if (card.promptOnMoveTo?.includes(col)) {
      setDetails({ contact: "", email: "", phone: "", interest: "", timeline: "", message: "" });
      setError("");
      setPrompt({ id, col });
      return;
    }
    executeMove(id, col);
  };

  const promptCard = prompt ? cards.find((c) => c.id === prompt.id) : null;
  const field = (key: keyof typeof details, label: string, required = false, multiline = false) => (
    <label key={key} style={{ display: "block", marginTop: 12 }}>
      <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#737985", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>{label}{required ? " *" : ""}</span>
      {multiline ? <textarea value={details[key]} onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))} style={{ width: "100%", minHeight: 72, resize: "vertical", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", font: "13px var(--font-ui)" }} /> : <input value={details[key]} onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", font: "13px var(--font-ui)" }} />}
    </label>
  );

  return (
    <>
    <div
      className="lv-hs"
      style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "hidden", padding: "14px 24px 20px" }}
    >
      <div style={{ display: "flex", gap: 13, height: "100%", minWidth: "min-content" }}>
        {columns.map((col) => {
          const colCards = cards.filter((c) => colOf(c) === col.key);
          const val = colCards.reduce((s, c) => s + (c.value || 0), 0);
          // #189 — a column total already excludes UKN cards from `val` (they
          // contribute 0); say how many so a column of mostly-unknown value
          // doesn't read as a small real number.
          const valUnknown = colCards.filter((c) => c.valueUnknown).length;
          return (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={drop(col.key)}
              style={{
                flex: "0 0 190px",
                display: "flex",
                flexDirection: "column",
                background: "#eef0f3",
                borderRadius: 12,
                minHeight: 0,
              }}
            >
              <div style={{ padding: "11px 13px 9px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#3a3f4a" }}>{col.label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab", marginLeft: "auto" }}>
                  {colCards.length}
                </span>
              </div>
              <div style={{ padding: "0 13px 6px", fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb" }}>
                {val > 0 ? shortMoneyZero(val) : "—"}
                {valUnknown > 0 ? ` · ${valUnknown} with unknown value` : ""}
              </div>
              <div
                className="lv-col"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: "2px 9px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {colCards.map((c) => (
                  <div
                    key={c.id}
                    draggable={canDrag(c)}
                    onDragStart={(e) => {
                      if (!canDrag(c)) return;
                      setDragId(c.id);
                      try {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", c.id);
                      } catch {
                        /* older engines */
                      }
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => router.push(c.href)}
                    className="lv-bcard"
                    style={{
                      background: "#fff",
                      border: "1px solid #e6e8ec",
                      borderLeft: `3px solid ${c.strip || "transparent"}`,
                      borderRadius: 9,
                      padding: "10px 11px",
                      cursor: "pointer",
                      boxShadow: "0 1px 2px rgba(16,18,22,.05)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        color: "#16181d",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {c.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#9aa0ab",
                        marginTop: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.sub}
                    </div>
                    {c.chips.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                        {c.chips.map((ch, i) => (
                          <span
                            key={i}
                            style={{
                              display: "inline-block",
                              fontSize: 9.5,
                              fontWeight: 600,
                              color: ch.ink,
                              background: ch.soft,
                              border: `1px solid ${ch.bd}`,
                              padding: "1px 7px",
                              borderRadius: 20,
                            }}
                          >
                            {ch.label}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        marginTop: 9,
                      }}
                    >
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a" }}>
                        {c.valueLabel}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        {c.ageLabel && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9aa0ab" }}>
                            {c.ageLabel}
                          </span>
                        )}
                        <OwnerDot owner={c.owner} title={c.ownerTitle} size={24} />
                      </span>
                    </div>
                  </div>
                ))}
                {colCards.length === 0 && (
                  <div style={{ fontSize: 11, color: "#b7bcc5", textAlign: "center", padding: "14px 6px" }}>
                    {moveAction ? "Drop here" : "Empty"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    {prompt && promptCard && (
      <div onClick={() => setPrompt(null)} style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(16,22,30,.42)" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "100%", maxHeight: "calc(100vh - 40px)", overflowY: "auto", background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 24px 70px rgba(0,0,0,.28)" }}>
          <div style={{ fontSize: 17, fontWeight: 650 }}>Collect information</div>
          <div style={{ color: "#737985", fontSize: 13, lineHeight: 1.5, marginTop: 5 }}>Add the basic details needed before moving <strong>{promptCard.title}</strong> into Collect Info.</div>
          {field("contact", "Primary contact", true)}
          {field("email", "Email")}
          {field("phone", "Phone")}
          {field("interest", "What are they looking for?", true)}
          {field("timeline", "Timeline")}
          {field("message", "Notes", false, true)}
          {error && <div style={{ color: "#b4543a", fontSize: 12, marginTop: 10 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 18 }}>
            <button type="button" onClick={() => setPrompt(null)} style={{ border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, padding: "9px 13px", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button type="button" onClick={() => { if (!details.contact.trim() || !details.interest.trim()) { setError("Primary contact and opportunity need are required."); return; } const p = prompt; setPrompt(null); executeMove(p.id, p.col, details); }} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}>Save & move</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
