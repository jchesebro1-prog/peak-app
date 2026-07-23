"use client";

import type { DraftPayload, ListVM, Opt, ThreadRowVM } from "./types";
import type { SearchRow } from "./actions";
import { ChanGlyph, CheckIcon, FlagIcon, Magnifier, PinIcon } from "./icons";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";

export type RowActions = {
  onArchive: (id: string) => void;
  onFlag: (id: string, on: boolean) => void;
  onPin: (id: string, on: boolean) => void;
};

export type HeaderCheck = "none" | "some" | "all";

export default function ThreadList({
  list,
  selectedId,
  readIds,
  onSelect,
  onOpenDraft,
  onBoxSel,
  boxSelOptions,
  commandBar,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  headerCheck,
  query,
  onQueryChange,
  scope,
  onScopeChange,
  isSearch,
  searchRows,
  searching,
  onOpenResult,
  rowActions,
}: {
  list: ListVM;
  selectedId: string | null;
  readIds: Set<string>;
  onSelect: (id: string) => void;
  onOpenDraft: (d: DraftPayload, id: string) => void;
  onBoxSel: (v: string) => void;
  boxSelOptions: Opt[];
  commandBar: React.ReactNode;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shift: boolean) => void;
  onToggleAll: () => void;
  headerCheck: HeaderCheck;
  query: string;
  onQueryChange: (v: string) => void;
  scope: "all" | "folder";
  onScopeChange: (v: "all" | "folder") => void;
  /** true when the search box holds a live query (≥2 chars) */
  isSearch: boolean;
  /** results for the current query, or null while they load */
  searchRows: SearchRow[] | null;
  searching: boolean;
  onOpenResult: (id: string) => void;
  rowActions: RowActions;
}) {
  const rows = list.rows;

  const emptyTitle =
    list.emptyKind === "drafts"
      ? "No drafts"
      : list.emptyKind === "outbox"
        ? "Outbox is empty"
        : list.emptyKind === "needs"
          ? "Nothing needs a reply"
          : list.emptyKind === "flagged"
            ? "Nothing flagged"
            : list.emptyKind === "deleted"
              ? "Deleted is empty"
              : "Nothing here";
  const emptySub =
    list.emptyKind === "drafts"
      ? "Saved drafts show up here."
      : list.emptyKind === "needs"
        ? "Every customer message has been handled."
        : list.emptyKind === "flagged"
          ? "Flag a message and it shows up here."
          : list.emptyKind === "deleted"
            ? "Deleted messages stay here until you empty them."
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
      {/* command bar (bulk actions + filter/sort) */}
      {commandBar}

      <div style={{ padding: "11px 15px 10px", borderBottom: "1px solid #f0f1f4", flexShrink: 0 }}>
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
                {isSearch ? "Search results" : list.title}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "#aab0bb",
                  flexShrink: 0,
                }}
              >
                {isSearch ? (searchRows ? searchRows.length : 0) : rows.length}
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
              {isSearch
                ? scope === "all"
                  ? "Across all mailboxes and folders"
                  : "In this folder"
                : list.sub}
            </div>
          </div>
        </div>

        {/* search box + scope */}
        <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              flex: 1,
              minWidth: 0,
              background: "#f7f8fa",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: "8px 11px",
            }}
          >
            <Magnifier />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search name, email, subject, body…"
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
            {query && (
              <button
                onClick={() => onQueryChange("")}
                title="Clear"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#aab0bb",
                  cursor: "pointer",
                  fontSize: 15,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            )}
          </div>
          <select
            value={scope}
            onChange={(e) => onScopeChange(e.target.value as "all" | "folder")}
            title="Search scope"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "#5b616e",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: "0 6px",
              background: "#fff",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <option value="all">All mail</option>
            <option value="folder">This folder</option>
          </select>
        </div>
      </div>

      {/* select-all header (hidden in search mode) */}
      {!isSearch && rows.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "6px 15px 6px 18px",
            borderBottom: "1px solid #f0f1f4",
            background: "#fbfbfc",
            flexShrink: 0,
          }}
        >
          <Checkbox
            state={headerCheck}
            onClick={onToggleAll}
            title={headerCheck === "all" ? "Deselect all" : "Select all"}
          />
          <span style={{ fontSize: 11, color: "#9aa0ab" }}>
            {headerCheck === "none" ? "Select all" : `${selectedIds.size} selected`}
          </span>
        </div>
      )}

      <div className="ib-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {isSearch ? (
          <SearchResults
            rows={searchRows}
            searching={searching}
            query={query}
            onOpen={onOpenResult}
          />
        ) : (
          <>
            {rows.map((r) => (
              <Row
                key={r.id}
                r={r}
                active={r.id === selectedId}
                unread={r.unread && !readIds.has(r.id)}
                selected={selectedIds.has(r.id)}
                onToggle={(shift) => onToggleSelect(r.id, shift)}
                actions={rowActions}
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
          </>
        )}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

/* ---- checkbox ---- */

function Checkbox({
  state,
  onClick,
  title,
}: {
  state: HeaderCheck | boolean;
  onClick: (shift: boolean) => void;
  title?: string;
}) {
  const checked = state === true || state === "all";
  const partial = state === "some";
  const on = checked || partial;
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.shiftKey);
      }}
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 4,
        border: on ? "1.5px solid var(--accent)" : "1.5px solid #c4c9d2",
        background: on ? "var(--accent)" : "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
        color: "#fff",
      }}
    >
      {checked && <CheckIcon size={11} />}
      {partial && <span style={{ width: 8, height: 2, background: "#fff", borderRadius: 1 }} />}
    </button>
  );
}

/* ---- search results ---- */

function SearchResults({
  rows,
  searching,
  query,
  onOpen,
}: {
  rows: SearchRow[] | null;
  searching: boolean;
  query: string;
  onOpen: (id: string) => void;
}) {
  if (query.trim().length < 2)
    return (
      <div style={{ padding: "44px 26px", textAlign: "center", color: "#9aa0ab" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#5b616e" }}>Type to search</div>
        <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
          Finds any message by name, email, customer, subject, body, or attachment.
        </div>
      </div>
    );
  if (rows === null)
    return (
      <div style={{ padding: "20px 26px", textAlign: "center", color: "#aab0bb", fontSize: 12 }}>
        Searching…
      </div>
    );
  if (rows.length === 0 && !searching)
    return (
      <div style={{ padding: "44px 26px", textAlign: "center", color: "#9aa0ab" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#5b616e" }}>No matches</div>
        <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
          Nothing matches “{query.trim()}”.
        </div>
      </div>
    );
  return (
    <>
      {searching && (
        <div style={{ padding: "8px 18px", fontSize: 11, color: "#aab0bb" }}>Searching…</div>
      )}
      {rows.map((r) => (
        <button
          key={r.id}
          onClick={() => onOpen(r.id)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: "12px 15px 12px 18px",
            border: "none",
            borderBottom: "1px solid #f5f6f8",
            cursor: "pointer",
            textAlign: "left",
            background: "#fff",
            fontFamily: "var(--font-ui)",
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              flexShrink: 0,
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f1f2f5",
            }}
          >
            <ChanGlyph chan={r.chan} color="#5b616e" size={13} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: r.unread ? 700 : 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "#26292f",
                }}
              >
                {r.name}
              </span>
              {r.flagged && <FlagIcon size={12} fill="#d85a30" />}
              <span style={{ fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{r.time}</span>
            </span>
            <span
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: r.unread ? 600 : 500,
                color: "#3a3f4a",
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
            <span
              style={{
                display: "inline-block",
                marginTop: 7,
                fontSize: 9.5,
                fontWeight: 600,
                color: "#5b616e",
                background: "#f1f2f5",
                border: "1px solid #e4e7ec",
                padding: "1px 8px",
                borderRadius: 20,
              }}
            >
              {r.where}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

/* ---- message row ---- */

function Row({
  r,
  active,
  unread,
  selected,
  onToggle,
  onClick,
  actions,
}: {
  r: ThreadRowVM;
  active: boolean;
  unread: boolean;
  selected: boolean;
  onToggle: (shift: boolean) => void;
  onClick: () => void;
  actions: RowActions;
}) {
  const chColor = r.waitingUs ? "#b4543a" : "#5b616e";
  const wrapBg = r.waitingUs ? "#f8ece7" : r.isDraft ? "#fbf3dd" : "#f1f2f5";
  return (
    <div
      className="ib-row"
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "13px 15px 13px 18px",
        borderBottom: "1px solid #f5f6f8",
        cursor: "pointer",
        textAlign: "left",
        background: selected ? "color-mix(in srgb, var(--accent) 9%, #fff)" : active ? ACCENT_SOFT : "#fff",
        boxShadow: active || selected ? "inset 3px 0 0 var(--accent)" : undefined,
        fontFamily: "var(--font-ui)",
      }}
    >
      {/* category color spine */}
      {r.categoryColor && (
        <span
          title={r.categoryLabel}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: r.categoryColor,
          }}
        />
      )}
      {/* unread dot / checkbox (checkbox shows on hover or when selected) */}
      <span
        style={{ position: "relative", width: 16, flexShrink: 0, marginTop: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        {unread && !selected && (
          <span
            className="ib-unread-dot"
            style={{
              position: "absolute",
              left: -10,
              top: 8,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
            }}
          />
        )}
        <span
          className="ib-check"
          style={{ display: selected ? "block" : undefined, opacity: selected ? 1 : undefined }}
        >
          <Checkbox state={selected} onClick={onToggle} title="Select" />
        </span>
      </span>

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
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          {r.pinned && (
            <span style={{ color: "#8c919c", display: "flex" }} title="Pinned">
              <PinIcon size={12} fill="#8c919c" />
            </span>
          )}
          {r.flagged && (
            <span style={{ color: "#d85a30", display: "flex" }} title="Flagged">
              <FlagIcon size={12} fill="#d85a30" />
            </span>
          )}
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

      {/* hover quick-actions */}
      {!r.isDraft && (
        <span
          className="ib-quick"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 12,
            top: 10,
            display: "flex",
            gap: 2,
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 8,
            padding: 2,
            boxShadow: "0 2px 8px rgba(16,22,30,.08)",
          }}
        >
          <QuickBtn title="Archive" onClick={() => actions.onArchive(r.id)}>
            <ArchiveMini />
          </QuickBtn>
          <QuickBtn
            title={r.flagged ? "Unflag" : "Flag"}
            active={r.flagged}
            onClick={() => actions.onFlag(r.id, !r.flagged)}
          >
            <FlagIcon size={13} fill={r.flagged ? "#d85a30" : "none"} />
          </QuickBtn>
          <QuickBtn
            title={r.pinned ? "Unpin" : "Pin"}
            active={r.pinned}
            onClick={() => actions.onPin(r.id, !r.pinned)}
          >
            <PinIcon size={13} fill={r.pinned ? "#5b616e" : "none"} />
          </QuickBtn>
        </span>
      )}
    </div>
  );
}

function QuickBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 6,
        background: "transparent",
        cursor: "pointer",
        color: active ? "#3a3f4a" : "#5b616e",
      }}
    >
      {children}
    </button>
  );
}

function ArchiveMini() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}
