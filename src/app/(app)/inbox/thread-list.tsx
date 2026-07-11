"use client";

import { useState } from "react";
import type { DraftPayload, ListVM, Opt, ThreadRowVM } from "./types";
import { ChanGlyph, Magnifier } from "./icons";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";

export default function ThreadList({
  list,
  selectedId,
  readIds,
  onSelect,
  onOpenDraft,
  onBoxSel,
  boxSelOptions,
}: {
  list: ListVM;
  selectedId: string | null;
  readIds: Set<string>;
  onSelect: (id: string) => void;
  onOpenDraft: (d: DraftPayload, id: string) => void;
  onBoxSel: (v: string) => void;
  boxSelOptions: Opt[];
}) {
  const [query, setQuery] = useState("");
  const ql = query.trim().toLowerCase();
  const rows = ql ? list.rows.filter((r) => r.haystack.includes(ql)) : list.rows;

  const emptyTitle = ql
    ? "No matches"
    : list.emptyKind === "drafts"
      ? "No drafts"
      : list.emptyKind === "outbox"
        ? "Outbox is empty"
        : list.emptyKind === "needs"
          ? "Nothing needs a reply"
          : "Nothing here";
  const emptySub = ql
    ? `Nothing matches “${query.trim()}”.`
    : list.emptyKind === "drafts"
      ? "Saved drafts show up here."
      : list.emptyKind === "needs"
        ? "Every customer message has been handled."
        : "Messages in this folder will appear here.";

  return (
    <div
      className="ib-list"
      style={{
        width: 392,
        flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid #ececf0",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: "12px 15px 11px", borderBottom: "1px solid #f0f1f4", flexShrink: 0 }}>
        {/* narrow-only mailbox switcher */}
        <select
          className="ib-boxsel"
          value={list.boxSelValue}
          onChange={(e) => onBoxSel(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 10,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            color: "#16181d",
            border: "1px solid #e4e7ec",
            borderRadius: 9,
            padding: "9px 11px",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          {boxSelOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {list.title}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "#aab0bb",
                  flexShrink: 0,
                }}
              >
                {rows.length}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#9aa0ab",
                marginTop: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {list.sub}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "#f7f8fa",
            border: "1px solid #e4e7ec",
            borderRadius: 9,
            padding: "8px 11px",
            marginTop: 10,
          }}
        >
          <Magnifier />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this mailbox…"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
              color: "#16181d",
              outline: "none",
            }}
          />
        </div>
      </div>

      <div className="ib-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {rows.map((r) => (
          <Row
            key={r.id}
            r={r}
            active={r.id === selectedId}
            unread={r.unread && !readIds.has(r.id)}
            onClick={() => {
              if (r.isDraft && r.draft) onOpenDraft(r.draft, r.id);
              else onSelect(r.id);
            }}
          />
        ))}
        {rows.length === 0 && (
          <div style={{ padding: "52px 26px", textAlign: "center", color: "#9aa0ab" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#5b616e" }}>{emptyTitle}</div>
            <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{emptySub}</div>
          </div>
        )}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

function Row({
  r,
  active,
  unread,
  onClick,
}: {
  r: ThreadRowVM;
  active: boolean;
  unread: boolean;
  onClick: () => void;
}) {
  const chColor = r.waitingUs ? "#b4543a" : "#5b616e";
  const wrapBg = r.waitingUs ? "#f8ece7" : r.isDraft ? "#fbf3dd" : "#f1f2f5";
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "13px 15px 13px 18px",
        border: "none",
        borderBottom: "1px solid #f5f6f8",
        cursor: "pointer",
        textAlign: "left",
        background: active ? ACCENT_SOFT : "#fff",
        boxShadow: active ? "inset 3px 0 0 var(--accent)" : undefined,
        fontFamily: "var(--font-ui)",
      }}
    >
      {unread && (
        <span
          style={{
            position: "absolute",
            left: 6,
            top: "50%",
            transform: "translateY(-50%)",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
        />
      )}
      <span
        style={{
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: wrapBg,
        }}
      >
        <ChanGlyph chan={r.chan} color={chColor} size={13} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              fontWeight: unread ? 700 : 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: unread ? "#16181d" : "#26292f",
            }}
          >
            {r.name}
          </span>
          <span style={{ fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{r.time}</span>
        </span>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: unread ? 600 : 500,
            color: unread ? "#16181d" : "#3a3f4a",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {r.subject}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 11.5,
            color: "#9aa0ab",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {r.snippet}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8 }}>
          {r.showBoxTag && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: r.boxColor,
                background: `color-mix(in srgb, ${r.boxColor} 12%, #fff)`,
                border: `1px solid color-mix(in srgb, ${r.boxColor} 24%, #fff)`,
                padding: "1px 7px",
                borderRadius: 20,
              }}
            >
              {r.boxTag}
            </span>
          )}
          {r.showStatus && (
            <span
              style={{
                display: "inline-block",
                fontSize: 9.5,
                fontWeight: 600,
                color: r.statusInk,
                background: r.statusSoft,
                border: `1px solid ${r.statusBd}`,
                padding: "2px 8px",
                borderRadius: 20,
              }}
            >
              {r.statusLabel}
            </span>
          )}
          {r.showWait && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                color: "#b4543a",
              }}
            >
              {r.waitLabel} waiting
            </span>
          )}
          {r.showQueued && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".03em",
                textTransform: "uppercase",
                color: "#8a6d1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "1px 6px",
                borderRadius: 5,
              }}
            >
              Outbox
            </span>
          )}
          <span style={{ flex: 1 }} />
          {r.showAssignee && (
            <span
              title={r.assignee}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 600,
                color: "#fff",
                background: r.assigneeColor,
              }}
            >
              {r.assigneeInitials}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
