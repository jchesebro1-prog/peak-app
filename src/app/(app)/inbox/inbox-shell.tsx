"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ComposeInit,
  CustomerVM,
  DraftPayload,
  FolderRowVM,
  ListVM,
  Opt,
  ReaderVM,
  SidebarVM,
} from "./types";
import { autoSyncAction, markReadAction, sendReceiveAction } from "./actions";
import { FolderGlyph, PencilIcon, PhoneIcon, RefreshIcon } from "./icons";
import ThreadList from "./thread-list";
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
  aiEnabled,
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
  aiEnabled: boolean;
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

  const baseQuery = isView
    ? `view=${box}`
    : `box=${box}&folder=${folder}`;

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
      />

      {/* ===== reading pane (desktop) ===== */}
      <div className="ib-pane" style={{ flex: 1, minWidth: 0, background: "#fff" }}>
        <ThreadReader
          key={reader ? reader.id : "empty"}
          vm={reader}
          variant="pane"
          rosterOptions={rosterOptions}
          onAfterSend={selectThread}
          aiEnabled={aiEnabled}
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
              aiEnabled={aiEnabled}
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
