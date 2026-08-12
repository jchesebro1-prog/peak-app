"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GRID_SCOPES, type GridScope } from "@/lib/design/grid-scopes";
import { buildFieldWorkPacket } from "@/lib/field-work-packet";
import { applyProjectSignoff } from "@/lib/project-signoff";
import { firstName } from "@/lib/team";
import type { CustomerContact, CustomerLocation } from "@/lib/stores/customers";
import type { ProjectRecord, ProjectStage } from "@/lib/stores/projects";
import type { TaskRecord } from "@/lib/stores/tasks";
import {
  toggleFieldTask,
  addFieldTask,
  postFieldNote,
  logFieldTime,
  captureFieldSignoff,
} from "./actions";
import { saveThroughOutbox } from "@/lib/sync/save";

/* ============================================================
 * Field Work — job detail (client, offline-capable).
 *
 * The on-site captures (toggle task, add task, post note, log time) are the
 * genuine no-signal writes, so this view owns the project record locally and
 * saves every mutation through the sync outbox: online it runs the existing
 * FormData server action (the cloud write + revalidate); offline/paused it
 * queues the WHOLE mutated project doc for /api/sync/push on reconnect.
 *
 * Markup, styles and fields are a verbatim port of the server-rendered detail
 * view — the only change is that <form action={serverAction}> submits become
 * client handlers that mutate a local copy, build the matching FormData, and
 * pass both through saveThroughOutbox. The store (DB-backed) can't ship in a
 * client bundle, so its pure palettes/formatters are reproduced below.
 * ============================================================ */

/** Identity (user id + initials + avatar colour) for a person, resolved
    server-side. `id` is the roster user id (null when unresolvable — e.g. a
    legacy free-text name with no matching account) — used to stamp
    assigneeUserId on field-created tasks so offline adds aren't unassigned. */
export type FieldIdentity = { id: string | null; initials: string; color: string };

export type FieldWorkDetailProps = {
  project: ProjectRecord;
  tasks: TaskRecord[];
  meName: string;
  identity: Record<string, FieldIdentity>;
  initialTab: string;
  packetLocation: CustomerLocation | null;
  packetContacts: CustomerContact[] | null;
  packetScopeGroups: Array<{ name: string; sectionKind: string; itemCount: number }>;
  packetReferenceDocs: Array<{ key: string; label: string; href: string; meta: string }>;
  packetVisitHistory: Array<{ id: string; title: string; at: number; status: string; href: string; assignee: string }>;
};

/* ---- palettes & formatters (ported from page.tsx / projects.ts — pure) ---- */

const STAGE_META: Record<
  ProjectStage,
  { label: string; soft: string; ink: string; bd: string }
> = {
  procurement: { label: "Prep", soft: "#fbf3dd", ink: "#8a6d1f", bd: "#f0e2bd" },
  delivery: { label: "Awaiting delivery", soft: "#e9eefb", ink: "#3155a8", bd: "#d4ddf3" },
  scheduled: { label: "Scheduled", soft: "#efeaf6", ink: "#5b4b8a", bd: "#ddd3ec" },
  install: { label: "Installing", soft: "#fbeede", ink: "#9a5a1f", bd: "#f0dcc0" },
  training: { label: "Training", soft: "#e4f1f6", ink: "#1f6a8a", bd: "#c5e2ec" },
  signoff: { label: "Sign-off", soft: "#eaf6ef", ink: "#1f7a52", bd: "#cce9da" },
  complete: { label: "Complete", soft: "#f1f2f5", ink: "#5b616e", bd: "#e4e7ec" },
};

const LINE_STATUS_COLOR: Record<string, string> = {
  received: "#1f7a52",
  shipped: "#5b4b8a",
  ordered: "#3155a8",
  pending: "#9a6a1f",
};
const LINE_STATUS_LABEL: Record<string, string> = {
  received: "On site",
  shipped: "Shipped",
  ordered: "On order",
  pending: "Not ordered",
};

const TABS: Array<[string, string]> = [
  ["packet", "Packet"],
  ["tasks", "Tasks"],
  ["notes", "Notes"],
  ["time", "Time"],
  ["bom", "BOM"],
];

const CSS = `
  .fw-tab:hover { color: #16181d; }
  .fw-card-link:hover { background: #fafbff; }
`;

const DAY = 86400000;

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const d = Math.floor(diff / DAY);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDate(ts: number | null | undefined): string {
  return ts
    ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";
}

/** Prototype uid() — (prefix)+6 base36 chars (project.js). */
function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 8);
}

function chipDark(stage: ProjectStage): React.CSSProperties {
  const m = STAGE_META[stage] || STAGE_META.procurement;
  return {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    color: "#fff",
    background: m.ink,
    padding: "3px 10px",
    borderRadius: 20,
  };
}

const uppLabel: React.CSSProperties = {
  fontSize: 10,
  color: "#8b909a",
  textTransform: "uppercase",
  letterSpacing: ".05em",
};

const signoffInputStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "10px 12px",
  outline: "none",
  background: "#fff",
};

export default function FieldWorkDetail({
  project,
  tasks,
  meName,
  identity,
  initialTab,
  packetLocation,
  packetContacts,
  packetScopeGroups,
  packetReferenceDocs,
  packetVisitHistory,
}: FieldWorkDetailProps) {
  const [p, setP] = useState<ProjectRecord>(project);
  // Latest record for building the whole-doc offline payload, synchronously —
  // rapid checkbox taps must each mutate from the freshest state.
  const pRef = useRef<ProjectRecord>(project);
  // Tasks (#17) are their own collection now — the same freshest-ref pattern,
  // scoped to the task rows instead of the whole project doc.
  const [taskRows, setTaskRows] = useState<TaskRecord[]>(tasks);
  const tasksRef = useRef<TaskRecord[]>(tasks);
  const [tab, setTab] = useState(
    TABS.some((t) => t[0] === initialTab) ? initialTab : "tasks"
  );
  const [taskTitle, setTaskTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [hours, setHours] = useState("");
  const [timeNote, setTimeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [signoffName, setSignoffName] = useState("");
  const [signoffRole, setSignoffRole] = useState("Customer");
  const [signoffNote, setSignoffNote] = useState("");
  const [signoffScopeChecks, setSignoffScopeChecks] = useState<Partial<Record<GridScope, boolean>>>(
    () => Object.fromEntries(GRID_SCOPES.map((scope) => [scope, true])) as Partial<Record<GridScope, boolean>>
  );
  const [signatureBlobKey, setSignatureBlobKey] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const movedRef = useRef(false);

  function flash(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  function identityOf(name: string): FieldIdentity {
    return identity[name] || { id: null, initials: "—", color: "#9aa0ab" };
  }

  const scopeLabels = useMemo(() => GRID_SCOPES, []);

  function signoffPoint(ev: React.PointerEvent<HTMLCanvasElement>) {
    const rect = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function ensureSignatureCtx() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#172033";
    return { canvas, ctx };
  }

  function persistSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !movedRef.current) {
      setSignatureBlobKey("");
      return;
    }
    setSignatureBlobKey(canvas.toDataURL("image/png"));
  }

  function beginSignature(ev: React.PointerEvent<HTMLCanvasElement>) {
    const env = ensureSignatureCtx();
    if (!env) return;
    const p = signoffPoint(ev);
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drawingRef.current = true;
    env.ctx.beginPath();
    env.ctx.moveTo(p.x, p.y);
    setSignatureError("");
  }

  function moveSignature(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const env = ensureSignatureCtx();
    if (!env) return;
    const p = signoffPoint(ev);
    env.ctx.lineTo(p.x, p.y);
    env.ctx.stroke();
    movedRef.current = true;
    persistSignature();
  }

  function endSignature(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    ev.currentTarget.releasePointerCapture(ev.pointerId);
    persistSignature();
  }

  function clearSignature() {
    const env = ensureSignatureCtx();
    if (!env) return;
    env.ctx.clearRect(0, 0, env.canvas.width, env.canvas.height);
    movedRef.current = false;
    setSignatureBlobKey("");
    setSignatureError("");
  }

  /**
   * The WHOLE resulting document for the offline outbox (/api/sync/push does
   * a whole-doc upsert by id) — shared by both the project doc and the
   * individual task docs below. Stamp it the way the store would when the
   * write reaches the cloud — records carry updatedAt only (no syncState on
   * the record), and rev bumps for the outbox version hint.
   */
  function stampDoc<T extends { id: string }>(next: T): Record<string, unknown> {
    const rev = Number((next as unknown as Record<string, unknown>).rev) || 1;
    return { ...(next as unknown as Record<string, unknown>), updatedAt: Date.now(), rev: rev + 1 };
  }

  /**
   * Apply an optimistic mutation, then save it through the seam. Online runs
   * the existing server action (cloud write + revalidate); offline/paused the
   * whole mutated doc is queued and the crew is told it's saved on-device.
   */
  async function persist(
    next: ProjectRecord,
    action: () => Promise<void>
  ): Promise<void> {
    const prev = pRef.current;
    pRef.current = next;
    setP(next);
    setBusy(true);
    try {
      const { queued } = await saveThroughOutbox({
        collection: "projects",
        id: next.id,
        doc: stampDoc(next),
        action,
      });
      if (queued) flash("Saved on this device — will sync when you're back online");
    } catch {
      pRef.current = prev;
      setP(prev);
      flash("Couldn't save — please try again");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Same seam as persist() above, scoped to one task doc — tasks (#17) live
   * in their own collection now, so a task edit no longer rides the whole
   * project doc.
   */
  async function persistTask(
    next: TaskRecord,
    action: () => Promise<void>
  ): Promise<void> {
    const prev = tasksRef.current;
    const nextRows = prev.some((t) => t.id === next.id)
      ? prev.map((t) => (t.id === next.id ? next : t))
      : [...prev, next];
    tasksRef.current = nextRows;
    setTaskRows(nextRows);
    setBusy(true);
    try {
      const { queued } = await saveThroughOutbox({
        collection: "tasks",
        id: next.id,
        doc: stampDoc(next),
        action,
      });
      if (queued) flash("Saved on this device — will sync when you're back online");
    } catch {
      tasksRef.current = prev;
      setTaskRows(prev);
      flash("Couldn't save — please try again");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- capture handlers ---------- */

  function onToggleTask(taskId: string) {
    const cur = tasksRef.current.find((t) => t.id === taskId);
    if (!cur) return;
    const done = cur.status !== "done";
    const next: TaskRecord = {
      ...cur,
      status: done ? "done" : "open",
      doneAt: done ? Date.now() : null,
      updatedAt: Date.now(),
    };
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("done", done ? "1" : "0");
    void persistTask(next, () => toggleFieldTask(fd));
  }

  function onAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cur = pRef.current;
    const title = taskTitle.trim();
    if (!title) return;
    const id = uid("tk-");
    const at = Date.now();
    // identity[meName].id is the signed-in user's roster id (threaded down
    // from page.tsx's requireUser()) — stamped here so a task added offline,
    // which never reaches the server action, still lands assigned (not just
    // named) once the outboxed doc syncs (#17 review).
    const next: TaskRecord = {
      id, title, section: "Install", projectId: cur.id, quoteId: null, coverageKey: null,
      assigneeUserId: identity[meName]?.id ?? null, assigneeName: meName, dueAt: null,
      status: "open", notes: "", createdBy: meName, createdAt: at, updatedAt: at, doneAt: null,
    };
    setTaskTitle("");
    const fd = new FormData();
    fd.set("id", cur.id);
    fd.set("title", title);
    fd.set("taskId", id);
    void persistTask(next, () => addFieldTask(fd));
  }

  function onPostNote(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cur = pRef.current;
    const text = noteText.trim();
    if (!text) return;
    const next: ProjectRecord = {
      ...cur,
      // addNote unshifts (newest first)
      notes: [
        { id: uid("nt-"), by: meName, at: Date.now(), text, photo: null },
        ...(cur.notes || []),
      ],
    };
    setNoteText("");
    const fd = new FormData();
    fd.set("id", cur.id);
    fd.set("text", text);
    void persist(next, () => postFieldNote(fd));
  }

  function onLogTime(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cur = pRef.current;
    const hrs = parseFloat(hours);
    if (!(hrs > 0)) return;
    const note = timeNote.trim();
    const next: ProjectRecord = {
      ...cur,
      timeLogs: [
        ...(cur.timeLogs || []),
        { id: uid("tl-"), person: meName, date: Date.now(), hours: hrs, note },
      ],
    };
    setHours("");
    setTimeNote("");
    const fd = new FormData();
    fd.set("id", cur.id);
    fd.set("hours", hours);
    fd.set("note", note);
    void persist(next, () => logFieldTime(fd));
  }

  function onCaptureSignoff(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cur = pRef.current;
    const name = signoffName.trim();
    const role = signoffRole.trim() || "Customer";
    const note = signoffNote.trim();
    if (!name) return;
    if (!signatureBlobKey) {
      setSignatureError("Capture a signature before recording sign-off.");
      return;
    }
    const stampedAt = Date.now();
    const signoff = {
      name,
      role,
      note,
      scopeChecks: signoffScopeChecks,
      signatureBlobKey,
      signedByName: name,
      capturedBy: meName,
    };
    const next = applyProjectSignoff(cur, signoff, meName, stampedAt);
    const fd = new FormData();
    fd.set("id", cur.id);
    fd.set("name", name);
    fd.set("role", role);
    fd.set("note", note);
    fd.set("signatureBlobKey", signatureBlobKey);
    for (const scope of scopeLabels) {
      fd.set(`scope-${scope}`, signoffScopeChecks[scope] ? "true" : "false");
    }
    void persist(next, () => captureFieldSignoff(fd));
  }

  /* ---------- derived (from local state) ---------- */

  const myLogs = (p.timeLogs || []).filter((l) => l.person === meName);
  const myHours = myLogs.reduce((a, l) => a + (l.hours || 0), 0);
  const crewHours = (p.timeLogs || []).reduce((a, l) => a + (l.hours || 0), 0);
  const packet = buildFieldWorkPacket(p, packetLocation, packetContacts);

  // tasks grouped by section (insertion order preserved)
  const groupsMap: Record<string, TaskRecord[]> = {};
  const order: string[] = [];
  taskRows.forEach((t) => {
    if (!groupsMap[t.section]) {
      groupsMap[t.section] = [];
      order.push(t.section);
    }
    groupsMap[t.section].push(t);
  });

  const segStyle = (on: boolean): React.CSSProperties => ({
    flex: 1,
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "9px 6px",
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    textAlign: "center",
    textDecoration: "none",
    ...(on
      ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.1)" }
      : { background: "transparent", color: "#787d87" }),
  });

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 80px" }}>
      <style>{CSS}</style>

      <Link
        href="/field-work"
        className="fw-tab"
        style={{
          display: "inline-block",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--accent)",
          textDecoration: "none",
          padding: "2px 0 12px",
        }}
      >
        ‹ All field jobs
      </Link>

      {/* job header */}
      <div
        style={{
          background: "#16181d",
          color: "#fff",
          borderRadius: 16,
          padding: "17px 18px",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <span style={chipDark(p.stage)}>{STAGE_META[p.stage]?.label || p.stage}</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "#8b909a",
            }}
          >
            {p.id}
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.25 }}>{p.name}</div>
        <div style={{ fontSize: 12.5, color: "#aab0bb", marginTop: 4 }}>{p.customer || "—"}</div>
        <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
          <div>
            <div style={uppLabel}>Install window</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
              {p.installStart ? fmtDate(p.installStart) + " – " + fmtDate(p.installEnd) : "TBD"}
            </div>
          </div>
          <div>
            <div style={uppLabel}>My hours</div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13.5,
                fontWeight: 600,
                marginTop: 3,
              }}
            >
              {myHours}h
            </div>
          </div>
          <Link
            href={"/projects?id=" + encodeURIComponent(p.id)}
            style={{
              marginLeft: "auto",
              alignSelf: "center",
              fontSize: 12,
              fontWeight: 600,
              color: "#cfd3da",
              textDecoration: "none",
              border: "1px solid #3a3e46",
              borderRadius: 8,
              padding: "7px 11px",
            }}
          >
            PM view
          </Link>
        </div>
      </div>

      {/* segmented tabs — local state so switching works with no signal */}
      <div
        style={{
          display: "flex",
          background: "#e4e6ea",
          borderRadius: 11,
          padding: 3,
          marginBottom: 14,
        }}
      >
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={segStyle(tab === k)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TASKS */}
      {tab === "packet" && (
        <>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: "14px 15px",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>
              Install packet
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 11 }}>
              <div>
                <div style={uppLabel}>Install window</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{packet.installWindowLabel}</div>
              </div>
              <div>
                <div style={uppLabel}>Materials</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
                  {packet.materials.onSite}/{packet.materials.total} on site
                </div>
                <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                  {packet.materials.awaiting} still incoming
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: "14px 15px",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>
              Venue
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 9 }}>{packet.venueLabel}</div>
            <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 4, lineHeight: 1.5 }}>
              {packet.venueAddress}
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", padding: "12px 15px 9px" }}>
              Crew & contacts
            </div>
            {packet.crew.map((c, idx) => (
              <div key={`crew:${c.person}:${idx}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "11px 15px", borderTop: idx === 0 ? "1px solid #f3f4f7" : "1px solid #f3f4f7" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.person}</div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>{c.role}</div>
                </div>
              </div>
            ))}
            {packet.crew.length === 0 && (
              <div style={{ padding: "12px 15px", fontSize: 12.5, color: "#9aa0ab" }}>No crew bookings on this job yet.</div>
            )}
            {packet.contacts.map((c, idx) => (
              <div key={`contact:${c.name}:${idx}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 15px", borderTop: "1px solid #f3f4f7" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
                    {c.primary && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", color: "#1f7a52", background: "#eef3f0", border: "1px solid #d6e6dd", borderRadius: 5, padding: "2px 5px", fontFamily: "var(--font-mono)" }}>
                        PRIMARY
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                    {[c.role, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details on file"}
                  </div>
                </div>
              </div>
            ))}
            {packet.contacts.length === 0 && (
              <div style={{ padding: "12px 15px", fontSize: 12.5, color: "#9aa0ab", borderTop: "1px solid #f3f4f7" }}>
                No customer contacts on file.
              </div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", padding: "12px 15px 9px" }}>
              Scope &amp; BOM
            </div>
            {packetScopeGroups.map((group, idx) => (
              <div key={`${group.name}:${idx}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 15px", borderTop: "1px solid #f3f4f7" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{group.name}</div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                    {group.sectionKind === "labor" ? "Labor" : "Materials"}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e" }}>
                  {group.itemCount} {group.itemCount === 1 ? "line" : "lines"}
                </div>
              </div>
            ))}
            {packetScopeGroups.length === 0 && (
              <div style={{ padding: "12px 15px", fontSize: 12.5, color: "#9aa0ab", borderTop: "1px solid #f3f4f7" }}>
                No saved scope breakdown on the source quote.
              </div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", padding: "12px 15px 9px" }}>
              Signoff checklist
            </div>
            {packet.checklist.map((item, idx) => (
              <div key={item.scope} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 15px", borderTop: idx === 0 ? "1px solid #f3f4f7" : "1px solid #f3f4f7" }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{item.scope}</div>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: item.accepted ? "#1f7a52" : "#9a5a1f" }}>
                  {item.accepted ? "Accepted" : "Pending signoff"}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", padding: "12px 15px 9px" }}>
              Recent notes
            </div>
            {packet.recentNotes.map((n, idx) => (
              <div key={n.id} style={{ padding: "11px 15px", borderTop: idx === 0 ? "1px solid #f3f4f7" : "1px solid #f3f4f7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{firstName(n.by)}</div>
                  <div style={{ marginLeft: "auto", fontSize: 11, color: "#aab0bb" }}>{timeAgo(n.at)}</div>
                </div>
                <div style={{ fontSize: 13, color: "#2f333b", lineHeight: 1.5, marginTop: 5 }}>{n.text}</div>
              </div>
            ))}
            {packet.recentNotes.length === 0 && (
              <div style={{ padding: "12px 15px", fontSize: 12.5, color: "#9aa0ab" }}>No field notes yet.</div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", padding: "12px 15px 9px" }}>
              Reference docs
            </div>
            {packetReferenceDocs.map((doc, idx) => (
              <a
                key={doc.key}
                href={doc.href}
                download={doc.href.startsWith("data:") ? doc.label : undefined}
                className="fw-card-link"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "11px 15px",
                  borderTop: "1px solid #f3f4f7",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{doc.label}</div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>{doc.meta}</div>
                </div>
                <span style={{ color: "#c4c9d2", fontSize: 18 }}>›</span>
              </a>
            ))}
            {packetReferenceDocs.length === 0 && (
              <div style={{ padding: "12px 15px", fontSize: 12.5, color: "#9aa0ab", borderTop: "1px solid #f3f4f7" }}>
                No drawings, attachments, or datasheets are linked yet.
              </div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", padding: "12px 15px 9px" }}>
              Recent site visits
            </div>
            {packetVisitHistory.map((visit) => (
              <Link
                key={visit.id}
                href={visit.href}
                className="fw-card-link"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "11px 15px",
                  borderTop: "1px solid #f3f4f7",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{visit.title}</div>
                  <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                    {fmtDate(visit.at)} · {visit.status}
                    {visit.assignee ? ` · ${firstName(visit.assignee)}` : ""}
                  </div>
                </div>
                <span style={{ color: "#c4c9d2", fontSize: 18 }}>›</span>
              </Link>
            ))}
            {packetVisitHistory.length === 0 && (
              <div style={{ padding: "12px 15px", fontSize: 12.5, color: "#9aa0ab", borderTop: "1px solid #f3f4f7" }}>
                No prior site visits on file for this venue.
              </div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: "14px 15px",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>
              Customer sign-off
            </div>
            {p.signoff ? (
              <div style={{ display: "grid", gap: 10, marginTop: 11 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={uppLabel}>Signed by</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
                      {p.signoff.signedByName || p.signoff.name || "—"}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                      {p.signoff.role || "Customer"}
                    </div>
                  </div>
                  <div>
                    <div style={uppLabel}>Recorded</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
                      {fmtDate(p.signoff.signedAt)}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                      by {firstName(p.signoff.capturedBy || p.signoff.signedBy || meName)}
                    </div>
                  </div>
                </div>
                {p.signoff.signatureBlobKey ? (
                  <img
                    src={p.signoff.signatureBlobKey}
                    alt="Customer signature"
                    style={{
                      width: "100%",
                      maxWidth: 420,
                      height: 140,
                      objectFit: "contain",
                      border: "1px dashed #c9d2df",
                      borderRadius: 12,
                      background: "#fff",
                    }}
                  />
                ) : null}
                {!!p.signoff.note && (
                  <div style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.5 }}>
                    {p.signoff.note}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>
                  Sign-off is recorded. Final completion still happens from PM view.
                </div>
              </div>
            ) : (
              <form onSubmit={onCaptureSignoff} style={{ display: "grid", gap: 10, marginTop: 11 }}>
                <input
                  name="name"
                  value={signoffName}
                  onChange={(e) => setSignoffName(e.target.value)}
                  required
                  placeholder="Customer name (who signed)"
                  style={signoffInputStyle}
                />
                <input
                  name="role"
                  value={signoffRole}
                  onChange={(e) => setSignoffRole(e.target.value)}
                  placeholder="Title / role"
                  style={signoffInputStyle}
                />

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#4b5565" }}>Accepted scopes</div>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                    {scopeLabels.map((scope) => (
                      <label
                        key={scope}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          border: "1px solid #e4e7ec",
                          borderRadius: 10,
                          padding: "10px 12px",
                          fontSize: 13,
                          color: "#172033",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!signoffScopeChecks[scope]}
                          onChange={(e) =>
                            setSignoffScopeChecks((prev) => ({ ...prev, [scope]: e.target.checked }))
                          }
                        />
                        <span>{scope}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#4b5565" }}>Signature</div>
                    <button
                      type="button"
                      onClick={clearSignature}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12,
                        color: "#516072",
                        background: "#fff",
                        border: "1px solid #d9dfe8",
                        borderRadius: 999,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <canvas
                    ref={canvasRef}
                    width={560}
                    height={180}
                    onPointerDown={beginSignature}
                    onPointerMove={moveSignature}
                    onPointerUp={endSignature}
                    onPointerLeave={endSignature}
                    style={{
                      width: "100%",
                      maxWidth: 560,
                      height: 180,
                      border: "1px dashed #c9d2df",
                      borderRadius: 12,
                      background: "#fff",
                      touchAction: "none",
                    }}
                  />
                  <div style={{ fontSize: 12, color: signatureError ? "#b42318" : "#8c919c" }}>
                    {signatureError || "Draw the customer’s signature here."}
                  </div>
                </div>

                <textarea
                  name="note"
                  value={signoffNote}
                  onChange={(e) => setSignoffNote(e.target.value)}
                  placeholder="Notes / punch items (optional)"
                  rows={2}
                  style={{ ...signoffInputStyle, resize: "vertical" }}
                />
                <button
                  type="submit"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--accent)",
                    border: "none",
                    padding: "11px 16px",
                    borderRadius: 9,
                    cursor: "pointer",
                  }}
                >
                  Record sign-off
                </button>
              </form>
            )}
          </div>
        </>
      )}

      {tab === "tasks" && (
        <>
          {order.map((sec) => (
            <div key={sec}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9aa0ab",
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  margin: "6px 2px 8px",
                }}
              >
                {sec}
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e7e9ee",
                  borderRadius: 13,
                  overflow: "hidden",
                  marginBottom: 14,
                }}
              >
                {groupsMap[sec].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onToggleTask(t.id)}
                    className="fw-card-link"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      width: "100%",
                      textAlign: "left",
                      padding: "14px 15px",
                      border: "none",
                      borderBottom: "1px solid #f3f4f7",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 7,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 1,
                        border: `2px solid ${t.status === "done" ? "var(--accent)" : "#cdd2da"}`,
                        background: t.status === "done" ? "var(--accent)" : "#fff",
                        color: "#fff",
                      }}
                    >
                      {t.status === "done" ? "✓" : ""}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 14,
                          fontWeight: 500,
                          lineHeight: 1.35,
                          ...(t.status === "done"
                            ? { textDecoration: "line-through", color: "#aab0bb" }
                            : { color: "#16181d" }),
                        }}
                      >
                        {t.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 11.5,
                          color: "#9aa0ab",
                          marginTop: 3,
                        }}
                      >
                        {(t.assigneeName ? firstName(t.assigneeName) : "Unassigned") +
                          (t.status === "done" && t.doneAt ? " · done " + timeAgo(t.doneAt) : "")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <form onSubmit={onAddTask} style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <input
              name="title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Add a task…"
              style={{
                flex: 1,
                fontFamily: "var(--font-ui)",
                fontSize: 13.5,
                border: "1px solid #e4e7ec",
                borderRadius: 10,
                padding: "12px 13px",
                outline: "none",
                background: "#fff",
              }}
            />
            <button
              type="submit"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 13.5,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                border: "none",
                padding: "0 18px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              Add
            </button>
          </form>
        </>
      )}

      {/* NOTES */}
      {tab === "notes" && (
        <>
          <form
            onSubmit={onPostNote}
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: "13px 14px",
              marginBottom: 14,
            }}
          >
            <textarea
              name="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Log a field note — conditions, blockers, changes…"
              rows={3}
              style={{
                width: "100%",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                border: "none",
                outline: "none",
                resize: "vertical",
                color: "#16181d",
                background: "transparent",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid #f3f4f7",
              }}
            >
              <button
                type="submit"
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  border: "none",
                  padding: "9px 16px",
                  borderRadius: 9,
                  cursor: "pointer",
                }}
              >
                Post note
              </button>
            </div>
          </form>

          {(p.notes || []).map((n) => {
            const idn = identityOf(n.by);
            return (
              <div
                key={n.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e7e9ee",
                  borderRadius: 13,
                  padding: "13px 14px",
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: idn.color,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {idn.initials}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{firstName(n.by)}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#aab0bb" }}>
                    {timeAgo(n.at)}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "#2f333b" }}>{n.text}</div>
                {n.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={n.photo}
                    alt=""
                    style={{
                      marginTop: 10,
                      maxHeight: 200,
                      maxWidth: "100%",
                      borderRadius: 10,
                      display: "block",
                    }}
                  />
                )}
              </div>
            );
          })}
          {(p.notes || []).length === 0 && (
            <div
              style={{ textAlign: "center", color: "#9aa0ab", fontSize: 12.5, padding: 14 }}
            >
              No notes yet — log the first one above.
            </div>
          )}
        </>
      )}

      {/* TIME */}
      {tab === "time" && (
        <>
          <form
            onSubmit={onLogTime}
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: 14,
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 11 }}>
              Log hours — today
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                name="hours"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                inputMode="decimal"
                placeholder="Hrs"
                style={{
                  width: 74,
                  fontFamily: "var(--font-mono)",
                  fontSize: 15,
                  textAlign: "center",
                  border: "1px solid #e4e7ec",
                  borderRadius: 10,
                  padding: "12px 8px",
                  outline: "none",
                }}
              />
              <input
                name="note"
                value={timeNote}
                onChange={(e) => setTimeNote(e.target.value)}
                placeholder="What you worked on"
                style={{
                  flex: 1,
                  fontFamily: "var(--font-ui)",
                  fontSize: 13.5,
                  border: "1px solid #e4e7ec",
                  borderRadius: 10,
                  padding: "12px 13px",
                  outline: "none",
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: "100%",
                marginTop: 11,
                fontFamily: "var(--font-ui)",
                fontSize: 13.5,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                border: "none",
                padding: 12,
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              Log time
            </button>
          </form>

          <div style={{ display: "flex", gap: 11, marginBottom: 14 }}>
            <div
              style={{
                flex: 1,
                background: "#fff",
                border: "1px solid #e7e9ee",
                borderRadius: 13,
                padding: "13px 14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600 }}>
                {myHours}h
              </div>
              <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 3 }}>my hours</div>
            </div>
            <div
              style={{
                flex: 1,
                background: "#fff",
                border: "1px solid #e7e9ee",
                borderRadius: 13,
                padding: "13px 14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600 }}>
                {crewHours}h
              </div>
              <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 3 }}>crew total</div>
            </div>
          </div>

          {(p.timeLogs || [])
            .slice()
            .sort((a, b) => (b.date || 0) - (a.date || 0))
            .map((l) => {
              const idn = identityOf(l.person);
              return (
                <div
                  key={l.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    background: "#fff",
                    border: "1px solid #e7e9ee",
                    borderRadius: 11,
                    padding: "11px 13px",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: idn.color,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {idn.initials}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{firstName(l.person)}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#9aa0ab",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {l.note || "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600 }}
                    >
                      {l.hours}h
                    </div>
                    <div style={{ fontSize: 10, color: "#aab0bb" }}>{timeAgo(l.date)}</div>
                  </div>
                </div>
              );
            })}
          {(p.timeLogs || []).length === 0 && (
            <div style={{ textAlign: "center", color: "#9aa0ab", fontSize: 12.5, padding: 10 }}>
              No hours logged yet.
            </div>
          )}
        </>
      )}

      {/* BOM / PLAN */}
      {tab === "bom" && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: "#eef3f0",
              border: "1px solid #d6e6dd",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 13,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".06em",
                color: "#1f7a52",
                background: "#fff",
                border: "1px solid #cce9da",
                padding: "3px 7px",
                borderRadius: 5,
                fontFamily: "var(--font-mono)",
              }}
            >
              READ-ONLY
            </span>
            <span style={{ fontSize: 12, color: "#3a6650" }}>
              Bill of materials &amp; plan — view only on site.
            </span>
          </div>
          <Link
            href="/design/quick"
            className="fw-card-link"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              padding: "14px 15px",
              marginBottom: 13,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "#f1f2f5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 17,
                flexShrink: 0,
              }}
            >
              ◳
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Stage plan &amp; layout</div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Open the groundplan drawing
              </div>
            </div>
            <span style={{ color: "#c4c9d2", fontSize: 18 }}>›</span>
          </Link>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
                padding: "12px 15px 9px",
              }}
            >
              Bill of materials
            </div>
            {(p.procurement || []).map((l) => {
              const color = LINE_STATUS_COLOR[l.status] || "#9aa0ab";
              return (
                <div
                  key={l.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "11px 15px",
                    borderTop: "1px solid #f3f4f7",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: color,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{l.desc}</div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "#aab0bb",
                        marginTop: 2,
                      }}
                    >
                      {(l.sku || "—") + " · " + l.qty + " " + l.unit + " · PO " + (l.po || "—")}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color, flexShrink: 0 }}>
                    {LINE_STATUS_LABEL[l.status] || l.status}
                  </span>
                </div>
              );
            })}
            {(p.procurement || []).length === 0 && (
              <div
                style={{
                  padding: "16px 15px",
                  fontSize: 12.5,
                  color: "#9aa0ab",
                  textAlign: "center",
                }}
              >
                No materials on this job.
              </div>
            )}
          </div>
        </>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 22,
            transform: "translateX(-50%)",
            zIndex: 90,
            display: "flex",
            alignItems: "center",
            gap: 11,
            background: "#16181d",
            color: "#fff",
            borderRadius: 12,
            padding: "13px 17px",
            boxShadow: "0 12px 40px rgba(0,0,0,.3)",
            maxWidth: "92vw",
          }}
        >
          <span
            style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fd29a", flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>{toast}</span>
        </div>
      )}
    </div>
  );
}
