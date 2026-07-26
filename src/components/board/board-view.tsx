"use client";

import { useEffect, useState, useTransition } from "react";
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
  moveAction?: (id: string, col: string) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, string>>({});

  // Once the refresh lands (transition done), server props are fresh — drop overrides.
  useEffect(() => {
    if (!isPending) setMoves((m) => (Object.keys(m).length ? {} : m));
  }, [isPending]);

  const colOf = (c: BoardCardVM) => moves[c.id] || c.col;
  const canDrag = (c: BoardCardVM) => !!moveAction && c.canMoveTo.length > 0;

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
    setMoves((m) => ({ ...m, [id]: col }));
    startTransition(async () => {
      await moveAction(id, col);
      router.refresh();
    });
  };

  return (
    <div
      className="lv-hs"
      style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "hidden", padding: "14px 24px 20px" }}
    >
      <div style={{ display: "flex", gap: 13, height: "100%", minWidth: "min-content" }}>
        {columns.map((col) => {
          const colCards = cards.filter((c) => colOf(c) === col.key);
          const val = colCards.reduce((s, c) => s + (c.value || 0), 0);
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
  );
}
