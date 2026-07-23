"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryOpt, Opt } from "./types";
import {
  ArchiveIcon,
  ChevronDown,
  FilterIcon,
  FlagIcon,
  MailOpenIcon,
  MoveIcon,
  RestoreIcon,
  SortIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from "./icons";

/**
 * Command bar — the slim action/refine row above the message list (new
 * Outlook parity). Left half switches to bulk actions when rows are selected;
 * the right half always offers Filter + Sort. All selection state lives in
 * inbox-shell; this component is purely presentational + callbacks.
 */

const FILTERS: Opt[] = [
  { value: "unread", label: "Unread" },
  { value: "flagged", label: "Flagged" },
  { value: "attachments", label: "Has attachments" },
  { value: "tome", label: "To me" },
  { value: "needs", label: "Needs reply" },
];

const SORTS: Opt[] = [
  { value: "date", label: "Date (newest)" },
  { value: "from", label: "From (A–Z)" },
  { value: "subject", label: "Subject (A–Z)" },
];

export type BulkHandlers = {
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onMarkRead: (read: boolean) => void;
  onFlag: (on: boolean) => void;
  onCategory: (key: string | null) => void;
  onMove: (mailbox: string) => void;
};

const MOVE_TARGETS: Opt[] = [
  { value: "personal", label: "My inbox" },
  { value: "sales", label: "Sales" },
  { value: "installs", label: "Installs" },
  { value: "info", label: "Info" },
];

export default function CommandBar({
  selectedCount,
  isDeleted,
  filter,
  sort,
  categoryOptions,
  onClear,
  onFilter,
  onSort,
  bulk,
}: {
  selectedCount: number;
  isDeleted: boolean;
  filter: string;
  sort: string;
  categoryOptions: CategoryOpt[];
  onClear: () => void;
  onFilter: (key: string) => void;
  onSort: (key: string) => void;
  bulk: BulkHandlers;
}) {
  const hasSel = selectedCount > 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 10px",
        borderBottom: "1px solid #f0f1f4",
        background: hasSel ? "color-mix(in srgb, var(--accent) 7%, #fff)" : "#fbfbfc",
        minHeight: 42,
        boxSizing: "border-box",
        flexWrap: "wrap",
        rowGap: 4,
      }}
    >
      {hasSel ? (
        <>
          <button onClick={onClear} title="Clear selection" style={iconBtn}>
            <XIcon size={14} />
          </button>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: "color-mix(in srgb, var(--accent) 72%, #000)",
              padding: "0 6px",
              whiteSpace: "nowrap",
            }}
          >
            {selectedCount} selected
          </span>
          <Divider />
          {isDeleted ? (
            <ActBtn icon={<RestoreIcon size={14} />} label="Restore" onClick={bulk.onRestore} />
          ) : (
            <>
              <ActBtn icon={<ArchiveIcon size={14} />} label="Archive" onClick={bulk.onArchive} />
              <ActBtn icon={<TrashIcon size={14} />} label="Delete" onClick={bulk.onDelete} />
              <ActBtn
                icon={<MailOpenIcon size={14} />}
                label="Read"
                onClick={() => bulk.onMarkRead(true)}
              />
              <ActBtn
                icon={<FlagIcon size={14} />}
                label="Flag"
                onClick={() => bulk.onFlag(true)}
              />
              <Menu
                trigger={<ActBtnInner icon={<TagIcon size={14} />} label="Categorize" caret />}
              >
                {(close) => (
                  <>
                    {categoryOptions.map((c) => (
                      <MenuItem
                        key={c.key}
                        onClick={() => {
                          bulk.onCategory(c.key);
                          close();
                        }}
                      >
                        <span style={{ ...dot, background: c.color }} />
                        {c.label}
                      </MenuItem>
                    ))}
                    <MenuItem
                      onClick={() => {
                        bulk.onCategory(null);
                        close();
                      }}
                    >
                      <span style={{ ...dot, background: "transparent", border: "1.5px solid #c4c9d2" }} />
                      None
                    </MenuItem>
                  </>
                )}
              </Menu>
              <Menu
                trigger={<ActBtnInner icon={<MoveIcon size={14} />} label="Move" caret />}
              >
                {(close) => (
                  <>
                    {MOVE_TARGETS.map((m) => (
                      <MenuItem
                        key={m.value}
                        onClick={() => {
                          bulk.onMove(m.value);
                          close();
                        }}
                      >
                        {m.label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>
            </>
          )}
        </>
      ) : (
        <span style={{ fontSize: 11, color: "#aab0bb", padding: "0 6px", whiteSpace: "nowrap" }}>
          Select messages to act on them
        </span>
      )}

      <span style={{ flex: 1 }} />

      {/* filter + sort — always available, top-right like Outlook */}
      <Menu
        align="right"
        trigger={
          <span style={{ ...refineBtn, ...(filter ? refineActive : null) }}>
            <FilterIcon size={14} />
            {filter ? FILTERS.find((f) => f.value === filter)?.label || "Filter" : "Filter"}
            <ChevronDown size={12} />
          </span>
        }
      >
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                onFilter("");
                close();
              }}
              active={!filter}
            >
              All
            </MenuItem>
            {FILTERS.map((f) => (
              <MenuItem
                key={f.value}
                active={filter === f.value}
                onClick={() => {
                  onFilter(f.value);
                  close();
                }}
              >
                {f.label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Menu
        align="right"
        trigger={
          <span style={refineBtn}>
            <SortIcon size={14} />
            {SORTS.find((s) => s.value === sort)?.label.split(" ")[0] || "Sort"}
            <ChevronDown size={12} />
          </span>
        }
      >
        {(close) => (
          <>
            {SORTS.map((s) => (
              <MenuItem
                key={s.value}
                active={sort === s.value}
                onClick={() => {
                  onSort(s.value);
                  close();
                }}
              >
                {s.label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </div>
  );
}

/* ---- small building blocks ---- */

const iconBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  border: "none",
  background: "transparent",
  borderRadius: 6,
  cursor: "pointer",
  color: "#5b616e",
};

const dot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  flexShrink: 0,
  boxSizing: "border-box",
};

const refineBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 500,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "5px 9px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const refineActive: React.CSSProperties = {
  color: "color-mix(in srgb, var(--accent) 72%, #000)",
  background: "color-mix(in srgb, var(--accent) 10%, #fff)",
  borderColor: "color-mix(in srgb, var(--accent) 30%, #fff)",
};

function Divider() {
  return <span style={{ width: 1, height: 18, background: "#e4e7ec", margin: "0 4px" }} />;
}

function ActBtnInner({
  icon,
  label,
  caret,
}: {
  icon: React.ReactNode;
  label: string;
  caret?: boolean;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        fontWeight: 500,
        color: "#3a3f4a",
        padding: "5px 8px",
        borderRadius: 7,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
      {caret && <ChevronDown size={11} />}
    </span>
  );
}

function ActBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        fontWeight: 500,
        color: "#3a3f4a",
        background: hov ? "#eef0f3" : "transparent",
        border: "none",
        padding: "5px 8px",
        borderRadius: 7,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/** Click-to-open popover menu; closes on outside-click or Escape. */
function Menu({
  trigger,
  children,
  align = "left",
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
      >
        {trigger}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            ...(align === "right" ? { right: 0 } : { left: 0 }),
            zIndex: 60,
            minWidth: 168,
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 10,
            boxShadow: "0 10px 34px rgba(16,22,30,.14)",
            padding: 5,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        textAlign: "left",
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        color: active ? "color-mix(in srgb, var(--accent) 72%, #000)" : "#3a3f4a",
        background: hov ? "#f4f5f7" : active ? "color-mix(in srgb, var(--accent) 8%, #fff)" : "transparent",
        border: "none",
        borderRadius: 7,
        padding: "8px 10px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
