"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStageAction } from "./actions";
import { OwnerDot } from "./avatar";
import { shortMoneyZero } from "./money";
import type { BoardCardVM, BoardColumnVM } from "./types";

/**
 * 1a — pipeline board (Leads Explorations.dc.html). Kanban columns by stage;
 * HTML5 drag between columns calls the setStage server action. Cards are
 * optimistically re-homed while the transition + refresh are in flight.
 */
export default function BoardView({
  columns,
  cards,
}: {
  columns: BoardColumnVM[];
  cards: BoardCardVM[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, string>>({});

  // Once the refresh lands (transition done), server props are fresh — drop overrides.
  useEffect(() => {
    if (!isPending) setMoves((m) => (Object.keys(m).length ? {} : m));
  }, [isPending]);

  const stageOf = (c: BoardCardVM) => moves[c.id] || c.stage;

  const drop = (stage: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData("text/plain");
    setDragId(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || stageOf(card) === stage) return;
    setMoves((m) => ({ ...m, [id]: stage }));
    startTransition(async () => {
      await setStageAction(id, stage);
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
          const colCards = cards
            .filter((c) => stageOf(c) === col.key)
            .sort((a, b) => b.urg - a.urg || b.updatedAt - a.updatedAt);
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
                    draggable
                    onDragStart={(e) => {
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
                      borderLeft: `3px solid ${c.strip}`,
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
                      {c.org}
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
                      {c.interest}
                    </div>
                    {c.showFu && (
                      <div
                        style={{
                          display: "inline-block",
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: c.fu.ink,
                          background: c.fu.soft,
                          border: `1px solid ${c.fu.bd}`,
                          padding: "1px 7px",
                          borderRadius: 20,
                          marginTop: 8,
                        }}
                      >
                        {c.fu.label}
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
                      <OwnerDot owner={c.owner} title={c.ownerTitle} size={24} />
                    </div>
                  </div>
                ))}
                {colCards.length === 0 && (
                  <div style={{ fontSize: 11, color: "#b7bcc5", textAlign: "center", padding: "14px 6px" }}>
                    Drop here
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
