"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CategoryOpt,
  ComposeInit,
  CustomerVM,
  DraftPayload,
  FolderRowVM,
  ListVM,
  Opt,
  ReaderVM,
  SidebarVM,
} from "./types";
import {
  archiveAction,
  autoSyncAction,
  bulkArchiveAction,
  bulkCategoryAction,
  bulkDeleteAction,
  bulkFlagAction,
  bulkMarkReadAction,
  bulkMoveAction,
  bulkRestoreAction,
  deleteAction,
  flagAction,
  markReadAction,
  pinAction,
  restoreAction,
  searchInboxAction,
  sendReceiveAction,
  setInboxModeAction,
  type SearchRow,
} from "./actions";
import { FolderGlyph, PencilIcon, PhoneIcon, RefreshIcon } from "./icons";
import ThreadList, { type HeaderCheck, type RowActions } from "./thread-list";
import CommandBar, { type BulkHandlers } from "./command-bar";
import type { FolderId, MailboxId } from "@/lib/stores/comms";
import ThreadReader from "./thread-reader";
import ComposeModal from "./compose-modal";
import LogModal from "./log-modal";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

const BOX_SEL_OPTIONS: Opt[] = [
  { value: "personal:inbox", label: "My Inbox" },
  { value: "personal:sent", label: "My Sent" },
  { value: "personal:drafts", label: "My Drafts" },
  { value: "sales:inbox", label: "Sales" },
  { value: "installs:inbox", label: "Installs" },
  { value: "info:inbox", label: "Info" },
  { value: "needs", label: "Needs reply" },
  { value: "calls", label: "Calls & meetings" },
];

function blankCompose(mailbox: string): ComposeInit {
  return {
    id: null,
    mailbox,
    to: "",
    cc: "",
    showCc: false,
    subject: "",
    body: "",
    customerId: "",
    contactName: "",
  };
}

export default function InboxShell({
  box,
  folder,
  isView,
  isDrafts,
  sidebar,
  list,
  reader,
  explicitSelected,
  rosterOptions,
  customers,
  contactEmails,
  fromOptions,
  initialCompose,
  categoryOptions,
  // Punch #42: per-user Inbox/CRM mode pref, server-resolved. Renamed on
  // destructure — the shell keeps its own optimistic copy (see crmMode
  // state below) so the toggle flips instantly instead of waiting on the
  // server action + revalidate.
  crmMode: initialCrmMode,
}: {
  box: string;
  folder: string;
  isView: boolean;
  isDrafts: boolean;
  sidebar: SidebarVM;
  list: ListVM;
  reader: ReaderVM | null;
  explicitSelected: boolean;
  rosterOptions: Opt[];
  customers: CustomerVM[];
  contactEmails: Opt[];
  fromOptions: Opt[];
  initialCompose: ComposeInit | null;
  categoryOptions: CategoryOpt[];
  // Punch #42: per-user Inbox/CRM mode pref (waiting-first sort opt-in),
  // resolved server-side from the current user.
  crmMode: boolean;
}) {
  const router = useRouter();

  // prototype tracked window width for pane/overlay behavior
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const upd = () => setNarrow(window.innerWidth <= 960);
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  // Punch #42: Inbox/CRM mode toggle. Optimistic — flips the local copy
  // immediately, then persists via the server action and refreshes so the
  // waiting-first sort (and anything else gated on crmMode) catches up.
  // If the server action throws, revert to the pre-toggle value (no toast
  // infra exists, so the revert is silent). modePending disables both
  // segmented buttons while a flip is in flight, so a rapid second click
  // can't race the first one's persist and land out of order.
  const [crmMode, setCrmModeState] = useState(initialCrmMode);
  const [modePending, startTransition] = useTransition();
  const onToggleMode = (on: boolean) => {
    const previous = crmMode;
    setCrmModeState(on);
    startTransition(async () => {
      try {
        await setInboxModeAction(on);
        router.refresh();
      } catch {
        setCrmModeState(previous);
      }
    });
  };

  const [compose, setCompose] = useState<ComposeInit | null>(initialCompose);
  const [logging, setLogging] = useState(false);
  // optimistic unread clearing while markRead lands server-side
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  // external deep links (?thread=) mark the thread read, like the prototype
  const sentReads = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (explicitSelected && reader && reader.unread && !sentReads.current.has(reader.id)) {
      sentReads.current.add(reader.id);
      void markReadAction(reader.id);
    }
  }, [explicitSelected, reader]);

  // rows show as read the moment they're opened (server truth follows)
  const effectiveReadIds = useMemo(() => {
    if (explicitSelected && reader && !readIds.has(reader.id)) {
      const s = new Set(readIds);
      s.add(reader.id);
      return s;
    }
    return readIds;
  }, [explicitSelected, reader, readIds]);

  // Keep the active filter/sort on the URL while reading a thread, so opening
  // a message doesn't drop the list's refinement.
  const refineQuery = [
    list.filter ? `filter=${list.filter}` : "",
    list.sort && list.sort !== "date" ? `sort=${list.sort}` : "",
  ]
    .filter(Boolean)
    .join("&");
  const baseQuery =
    (isView ? `view=${box}` : `box=${box}&folder=${folder}`) +
    (refineQuery ? `&${refineQuery}` : "");

  const selectThread = useCallback(
    (id: string) => {
      setReadIds((s) => new Set(s).add(id));
      void markReadAction(id);
      router.push(`/inbox?${baseQuery}&thread=${encodeURIComponent(id)}`);
    },
    [router, baseQuery]
  );

  const openDraft = useCallback((d: DraftPayload, id: string) => {
    setCompose({
      id,
      mailbox: d.mailbox || "personal",
      to: d.to,
      cc: d.cc,
      showCc: !!d.cc,
      subject: d.subject,
      body: d.body,
      customerId: d.customerId,
      contactName: d.contactName,
      attachments: d.attachments || [],
    });
  }, []);

  const closeOverlay = useCallback(() => {
    router.push(`/inbox?${baseQuery}`);
  }, [router, baseQuery]);

  /* ---- filter / sort (server-driven via the URL) ---- */
  const setRefinement = useCallback(
    (key: "filter" | "sort", value: string | null) => {
      const params = new URLSearchParams();
      if (isView) params.set("view", box);
      else {
        params.set("box", box);
        params.set("folder", folder);
      }
      const nextFilter = key === "filter" ? value : list.filter;
      const nextSort = key === "sort" ? value : list.sort;
      if (nextFilter) params.set("filter", nextFilter);
      if (nextSort && nextSort !== "date") params.set("sort", nextSort);
      router.push(`/inbox?${params.toString()}`);
    },
    [router, isView, box, folder, list.filter, list.sort]
  );

  /* ---- multi-select ---- */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Shift-range anchor, kept as an ID and only touched inside the click
  // handler (never during render). Stale anchors self-heal: an id no longer in
  // the current list resolves to indexOf === -1 and falls back to a plain toggle.
  const anchorIdRef = useRef<string | null>(null);
  const rowIds = useMemo(() => list.rows.map((r) => r.id), [list.rows]);

  // Clear the selection whenever the listing changes (nav / filter / sort).
  // React's sanctioned "adjust state during render" pattern (prev-value in
  // useState), so no effect and no cascading render.
  const listKey = `${isView ? "view" : "box"}:${box}/${folder}/${list.filter}/${list.sort}`;
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    if (selectedIds.size) setSelectedIds(new Set());
  }

  const onToggleSelect = useCallback(
    (id: string, shift: boolean) => {
      const idx = rowIds.indexOf(id);
      const anchorIdx = anchorIdRef.current ? rowIds.indexOf(anchorIdRef.current) : -1;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shift && anchorIdx !== -1 && idx !== -1) {
          const a = Math.min(anchorIdx, idx);
          const b = Math.max(anchorIdx, idx);
          for (let i = a; i <= b; i++) next.add(rowIds[i]); // range-select (Outlook)
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorIdRef.current = id;
    },
    [rowIds]
  );

  const onToggleAll = useCallback(() => {
    setSelectedIds((prev) =>
      rowIds.length > 0 && rowIds.every((id) => prev.has(id))
        ? new Set()
        : new Set(rowIds)
    );
  }, [rowIds]);

  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const headerCheck: HeaderCheck = allSelected
    ? "all"
    : selectedIds.size > 0
      ? "some"
      : "none";

  /* ---- bulk actions ---- */
  const runBulk = useCallback(
    async (fn: (ids: string[]) => Promise<unknown>) => {
      const picked = Array.from(selectedIds);
      if (!picked.length) return;
      setSelectedIds(new Set());
      await fn(picked);
      router.refresh();
    },
    [selectedIds, router]
  );

  const bulk: BulkHandlers = {
    onArchive: () => void runBulk((ids) => bulkArchiveAction(ids)),
    onDelete: () => void runBulk((ids) => bulkDeleteAction(ids)),
    onRestore: () => void runBulk((ids) => bulkRestoreAction(ids)),
    onMarkRead: (read) => void runBulk((ids) => bulkMarkReadAction(ids, read)),
    onFlag: (on) => void runBulk((ids) => bulkFlagAction(ids, on)),
    onCategory: (key) => void runBulk((ids) => bulkCategoryAction(ids, key)),
    onMove: (mb) => void runBulk((ids) => bulkMoveAction(ids, mb)),
  };

  /* ---- per-row hover quick actions ---- */
  const rowActions: RowActions = useMemo(
    () => ({
      onArchive: async (id) => {
        await archiveAction(id);
        router.refresh();
      },
      onFlag: async (id, on) => {
        await flagAction(id, on);
        router.refresh();
      },
      onPin: async (id, on) => {
        await pinAction(id, on);
        router.refresh();
      },
      // Task 4 (#42): single-row Delete/Restore in the hover quick-actions
      // pill. deleteAction/restoreAction already exist as single-id actions
      // (same shape as archiveAction/flagAction/pinAction above) — reusing
      // those instead of bulkDeleteAction([id]) keeps this handler
      // consistent with its siblings rather than routing through the bulk
      // path for a single row.
      onDelete: async (id) => {
        await deleteAction(id);
        router.refresh();
      },
      onRestore: async (id) => {
        await restoreAction(id);
        router.refresh();
      },
    }),
    [router]
  );

  /* ---- global search (server-side, debounced) ---- */
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "folder">("all");
  // Results tagged with the query they answer, so a stale set never shows for
  // a newer query (and no setState runs synchronously in the effect body).
  const [search, setSearch] = useState<{ q: string; rows: SearchRow[] } | null>(null);
  const [searching, setSearching] = useState(false);

  const trimmedQuery = query.trim();
  const isSearch = trimmedQuery.length >= 2;
  const searchRows =
    search && search.q === trimmedQuery ? search.rows : null; // null = loading

  useEffect(() => {
    if (trimmedQuery.length < 2) return;
    let cancelled = false;
    const h = setTimeout(async () => {
      setSearching(true);
      try {
        // "This folder" only applies to a real mailbox folder; smart views
        // span mailboxes, so they fall back to searching everything.
        const scopeArg =
          scope === "folder" && !isView
            ? {
                kind: "box" as const,
                box: box as MailboxId,
                folder: folder as FolderId,
              }
            : { kind: "all" as const };
        const { rows } = await searchInboxAction(trimmedQuery, scopeArg);
        if (!cancelled) setSearch({ q: trimmedQuery, rows });
      } catch {
        if (!cancelled) setSearch({ q: trimmedQuery, rows: [] });
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [trimmedQuery, scope, box, folder, isView]);

  const openSearchResult = useCallback(
    (id: string) => {
      void markReadAction(id);
      router.push(`/inbox?thread=${encodeURIComponent(id)}`);
    },
    [router]
  );

  // PUNCHLIST #1 — "actively sync": a silent background send/receive on mount
  // and every few minutes while the tab is visible. The server action claims
  // per-mailbox sync slots atomically (D73), so overlapping clients and quick
  // remounts are cheap; with the Gmail gate off it is a no-op. The action
  // does NOT revalidate (that would swap the auto-selected reader in the same
  // roundtrip) — we refresh here instead, only when a sync actually changed
  // something and never mid-typing; a change detected while typing is LATCHED
  // and flushed at the next non-typing moment (next tick or field blur).
  useEffect(() => {
    let stop = false;
    let pending = false;
    const typing = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "TEXTAREA" ||
        tag === "INPUT" ||
        (el as HTMLElement).isContentEditable
      );
    };
    const flush = () => {
      if (stop || !pending || typing()) return;
      pending = false;
      router.refresh();
    };
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const r = await autoSyncAction();
        if (r.changed) pending = true;
        flush();
      } catch {
        // background — never surface errors; the manual button still reports
      }
    };
    const onBlur = () => setTimeout(flush, 100); // let focus settle first
    document.addEventListener("focusout", onBlur);
    tick();
    const iv = setInterval(tick, 3 * 60_000);
    return () => {
      stop = true;
      clearInterval(iv);
      document.removeEventListener("focusout", onBlur);
    };
  }, [router]);

  const [sendReceiving, setSendReceiving] = useState(false);
  const onSendReceive = useCallback(async () => {
    if (sendReceiving) return;
    setSendReceiving(true);
    try {
      await sendReceiveAction();
      router.refresh();
    } finally {
      setSendReceiving(false);
    }
  }, [router, sendReceiving]);

  const onBoxSel = useCallback(
    (v: string) => {
      if (v === "needs" || v === "calls") router.push(`/inbox?view=${v}`);
      else {
        const [b, f] = v.split(":");
        router.push(`/inbox?box=${b}&folder=${f || "inbox"}`);
      }
    },
    [router]
  );

  const composeDefaultBox = useMemo(
    () => (box === "sales" || box === "installs" || box === "info" ? box : "personal"),
    [box]
  );

  const showOverlay = narrow && explicitSelected && !!reader && !isDrafts;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
        color: "#16181d",
        background: "#f7f8fa",
      }}
    >
      {/* ===== sidebar: mailboxes + folders ===== */}
      <div
        className="ib-side"
        style={{
          width: 238,
          flexShrink: 0,
          background: "#fbfbfc",
          borderRight: "1px solid #ececf0",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ padding: "14px 13px 10px", flexShrink: 0 }}>
          <button
            onClick={() => setCompose(blankCompose(composeDefaultBox))}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontFamily: "var(--font-ui)",
              fontSize: 13.5,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              border: "none",
              borderRadius: 10,
              padding: 11,
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,.08)",
            }}
          >
            <PencilIcon size={15} />
            Compose
          </button>
          <button
            onClick={() => setLogging(true)}
            style={{
              width: "100%",
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 600,
              color: "#5b616e",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: 8,
              cursor: "pointer",
            }}
          >
            <PhoneIcon size={13} />
            Log call / meeting
          </button>
        </div>

        <div
          className="ib-scroll"
          style={{ flex: 1, overflowY: "auto", padding: "4px 10px 12px", minHeight: 0 }}
        >
          {/* personal mailbox */}
          <div style={sectionLabelStyle("10px 8px 5px")}>Your mailbox</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px 7px" }}>
            <span
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
                background: sidebar.personal.color,
              }}
            >
              {sidebar.personal.initials}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, lineHeight: 1.1 }}>
                {sidebar.personal.label}
              </span>
              <span
                style={{
                  display: "block",
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  color: "#aab0bb",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {sidebar.personal.address}
              </span>
            </span>
          </div>
          {sidebar.personalFolders.map((f) => (
            <FolderRow key={f.key} f={f} indent />
          ))}

          {/* shared mailboxes */}
          <div style={sectionLabelStyle("15px 8px 5px")}>Shared mailboxes</div>
          {sidebar.sharedBoxes.map((b) => (
            <div key={b.id}>
              <Link
                href={b.href}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  marginBottom: 1,
                  background: b.active ? "#eef0f3" : "transparent",
                  textDecoration: "none",
                  color: "inherit",
                  boxSizing: "border-box",
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: b.color,
                  }}
                />
                <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.15,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {b.label}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--font-mono)",
                      fontSize: 9.5,
                      color: "#aab0bb",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {b.address}
                  </span>
                </span>
                {b.unread > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "#fff",
                      background: "var(--accent)",
                      padding: "0 6px",
                      borderRadius: 20,
                      flexShrink: 0,
                    }}
                  >
                    {b.unread}
                  </span>
                )}
              </Link>
              {b.active && b.folders.map((f) => <FolderRow key={f.key} f={f} indent />)}
            </div>
          ))}

          {/* smart views */}
          <div style={sectionLabelStyle("15px 8px 5px")}>Views</div>
          {sidebar.views.map((v) => (
            <FolderRow key={v.key} f={v} />
          ))}
          <Link
            href="/leads"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              marginTop: 2,
              borderRadius: 9,
              textDecoration: "none",
              color: "#3a3f4a",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 5,
                background: "#f8ece7",
                color: "#b4543a",
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                fontWeight: 700,
              }}
            >
              L
            </span>
            <span style={{ flex: 1, textAlign: "left" }}>Leads to follow up</span>
            {sidebar.leadFollowCount > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  background: "#c85a3c",
                  padding: "1px 7px",
                  borderRadius: 20,
                }}
              >
                {sidebar.leadFollowCount}
              </span>
            )}
          </Link>
        </div>

        {/* connection / send-receive */}
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid #ececf0",
            padding: "11px 12px",
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                flexShrink: 0,
                background: "#3fae74",
              }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#3a3f4a" }}>Connected</span>
          </div>
          <button
            onClick={onSendReceive}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 600,
              color: ACCENT_INK,
              background: ACCENT_SOFT,
              border: `1px solid ${ACCENT_SOFT}`,
              borderRadius: 9,
              padding: 8,
              cursor: "pointer",
              opacity: sendReceiving ? 0.6 : 1,
            }}
          >
            <RefreshIcon size={13} />
            {sendReceiving ? "Checking…" : "Send / Receive"}
          </button>
          <div
            title="Forward customer emails here and they land in the right mailbox (planned — real email sync isn’t connected yet)."
            style={{ marginTop: 9, fontSize: 10, color: "#aab0bb", lineHeight: 1.5 }}
          >
            Forward-to-log:{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "#8c919c" }}>
              {sidebar.forwardAddr}
            </span>{" "}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: ".05em",
                color: "#8a6d1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "0 4px",
                borderRadius: 4,
              }}
            >
              SOON
            </span>
          </div>
        </div>
      </div>

      {/* ===== message list ===== */}
      <ThreadList
        list={list}
        selectedId={reader && !narrow ? reader.id : explicitSelected && reader ? reader.id : null}
        readIds={effectiveReadIds}
        onSelect={selectThread}
        onOpenDraft={openDraft}
        onBoxSel={onBoxSel}
        boxSelOptions={BOX_SEL_OPTIONS}
        commandBar={
          <>
            <CommandBar
              selectedCount={selectedIds.size}
              isDeleted={list.isDeleted}
              filter={list.filter}
              sort={list.sort}
              categoryOptions={categoryOptions}
              crmMode={crmMode}
              onToggleMode={onToggleMode}
              modePending={modePending}
              onClear={() => setSelectedIds(new Set())}
              onFilter={(v) => setRefinement("filter", v)}
              onSort={(v) => setRefinement("sort", v)}
              bulk={bulk}
            />
            {/* Punch #42: CRM-mode follow-up filter chips — quick access to
                the three refinements CRM users reach for most. Clicking the
                active chip clears the filter (same URL param the Filter▾
                menu drives). */}
            {crmMode && (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--row-divider, #f5f6f8)",
                }}
              >
                {(
                  [
                    ["needs", "Needs reply"],
                    ["flagged", "Flagged"],
                    ["unread", "Unread"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() =>
                      setRefinement("filter", list.filter === key ? null : key)
                    }
                    style={{
                      fontSize: 12,
                      padding: "3px 10px",
                      borderRadius: 999,
                      cursor: "pointer",
                      border:
                        list.filter === key
                          ? "1px solid var(--accent, #b08d4a)"
                          : "1px solid #e8eaee",
                      background: list.filter === key ? "#faf6ee" : "#fff",
                      color:
                        list.filter === key
                          ? "var(--accent-ink, #8a6c34)"
                          : "#5b616e",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </>
        }
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onToggleAll={onToggleAll}
        headerCheck={headerCheck}
        query={query}
        onQueryChange={setQuery}
        scope={scope}
        onScopeChange={setScope}
        isSearch={isSearch}
        searchRows={searchRows}
        searching={searching}
        onOpenResult={openSearchResult}
        rowActions={rowActions}
      />

      {/* ===== reading pane (desktop) ===== */}
      <div className="ib-pane" style={{ flex: 1, minWidth: 0, background: "#fff" }}>
        <ThreadReader
          key={reader ? reader.id : "empty"}
          vm={reader}
          variant="pane"
          rosterOptions={rosterOptions}
          onAfterSend={selectThread}
        />
      </div>

      {/* ===== reading overlay (narrow) ===== */}
      {showOverlay && (
        <>
          <div
            onClick={closeOverlay}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(16,22,30,.44)",
              zIndex: 80,
              animation: "ib-scrim .16s ease both",
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: 540,
              maxWidth: "96vw",
              zIndex: 90,
              background: "#fff",
              boxShadow: "-18px 0 50px rgba(0,0,0,.26)",
              display: "flex",
              flexDirection: "column",
              animation: "ib-slide .2s cubic-bezier(.22,.61,.36,1) both",
            }}
          >
            <ThreadReader
              key={reader ? `ov-${reader.id}` : "ov-empty"}
              vm={reader}
              variant="overlay"
              rosterOptions={rosterOptions}
              onClose={closeOverlay}
              onAfterSend={selectThread}
            />
          </div>
        </>
      )}

      {/* ===== compose modal ===== */}
      {compose && (
        <ComposeModal
          init={compose}
          fromOptions={fromOptions}
          customers={customers}
          contactEmails={contactEmails}
          onClose={() => setCompose(null)}
          onSaved={(mailbox) => {
            setCompose(null);
            router.push(`/inbox?box=${mailbox}&folder=drafts`);
          }}
          onSent={(mailbox, id) => {
            setCompose(null);
            router.push(
              `/inbox?box=${mailbox}&folder=inbox${id ? `&thread=${encodeURIComponent(id)}` : ""}`
            );
          }}
        />
      )}

      {/* ===== log call/meeting modal ===== */}
      {logging && (
        <LogModal
          customers={customers}
          rosterOptions={rosterOptions}
          onClose={() => setLogging(false)}
          onLogged={(id) => {
            setLogging(false);
            router.push(`/inbox?view=calls${id ? `&thread=${encodeURIComponent(id)}` : ""}`);
          }}
        />
      )}
    </div>
  );
}

function sectionLabelStyle(padding: string): React.CSSProperties {
  return {
    padding,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: ".07em",
    textTransform: "uppercase",
    color: "#aab0bb",
  };
}

function FolderRow({ f, indent }: { f: FolderRowVM; indent?: boolean }) {
  return (
    <Link
      href={f.href}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: indent ? "7px 10px 7px 12px" : "8px 10px",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        marginBottom: 1,
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: f.active ? 600 : 500,
        color: f.active ? "#16181d" : "#5b616e",
        background: f.active ? ACCENT_SOFT : "transparent",
        textDecoration: "none",
        boxSizing: "border-box",
      }}
    >
      <FolderGlyph kind={f.icon} active={f.active} />
      <span style={{ flex: 1, textAlign: "left" }}>{f.label}</span>
      {f.count > 0 && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 700,
            flexShrink: 0,
            ...(f.badge === "accent"
              ? {
                  color: "#fff",
                  background: "var(--accent)",
                  padding: "0 6px",
                  borderRadius: 20,
                }
              : f.badge === "red"
                ? {
                    color: "#fff",
                    background: "#c85a3c",
                    padding: "0 6px",
                    borderRadius: 20,
                  }
                : { color: "#aab0bb" }),
          }}
        >
          {f.count}
        </span>
      )}
    </Link>
  );
}
