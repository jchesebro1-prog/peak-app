"use client";

/**
 * #215 — "Create task" from an email. Opened from a message header's
 * "Task…" and from the Link popup's footer. Title (the subject), links
 * (pre-ticked from the thread; the thread itself always saves), notes
 * (who/when the email came from), assignee (default me), optional due date.
 * Everything arrives on the server-built ReaderVM; one server action saves.
 */
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { createTaskFromThreadAction } from "./task-actions";
import { defaultThreadTaskNotes, THREAD_TASK_TITLE_MAX } from "@/lib/inbox-task";
import { BTN, CHECK_ROW, PRIMARY } from "./sidebar-styles";

const inStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  background: "#fff",
  color: "#16181d",
  outline: "none",
  boxSizing: "border-box",
};

const lbl: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  margin: "12px 0 5px",
};

export default function TaskDialog({
  vm,
  messageId,
  onClose,
}: {
  vm: ReaderVM;
  /** the message the dialog was opened from; null = the newest */
  messageId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [pending, start] = useTransition();
  const msg =
    (messageId ? vm.messages.find((m) => m.id === messageId) : null) ||
    vm.messages[vm.messages.length - 1] ||
    null;
  const [title, setTitle] = useState(vm.subject || "");
  const [notes, setNotes] = useState(() =>
    defaultThreadTaskNotes(vm.subject, msg?.author || vm.contactName, msg?.time || "")
  );
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(vm.taskLinks.map((l) => l.key)));
  const [assignee, setAssignee] = useState(
    vm.taskTeam.some((u) => u.id === vm.meId) ? vm.meId : vm.taskTeam[0]?.id || ""
  );
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Same mount-focus / restore-on-close pattern as the Link popup (#214 fix
  // wave 1): without it the inbox shell's ArrowUp/ArrowDown handler (which
  // only skips a target inside `[role="dialog"]`) would keep switching
  // threads out from under this dialog, and focus would land on the page
  // behind it once the dialog closes.
  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Trap Tab/Shift+Tab inside the dialog — the same fix wave 2 pattern —
  // so tabbing off either end can't hand focus to the page behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Escape closes the dialog unless something inside it already handled the
  // key (e.g. a select's own dropdown) — the same defaultPrevented guard the
  // Link popup uses, so this dialog never fights a nested widget's Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    if (pending) return;
    start(async () => {
      setError(null);
      const r = await createTaskFromThreadAction({
        threadId: vm.id,
        title,
        notes,
        assigneeUserId: assignee,
        dueDate: due,
        linkKeys: Array.from(ticked),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,24,29,.4)",
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create task"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="ib-sheet"
        style={{
          width: 460,
          maxWidth: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          padding: "20px 22px",
          fontFamily: "var(--font-ui)",
          color: "#16181d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>Create task</div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <label style={lbl} htmlFor="task-title">Title</label>
        <input
          id="task-title"
          value={title}
          maxLength={THREAD_TASK_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          style={inStyle}
          autoFocus
        />

        <div style={lbl}>Links</div>
        <div>
          {vm.taskLinks.map((l) => (
            <label key={l.key} style={{ ...CHECK_ROW, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={l.kind === "thread" || ticked.has(l.key)}
                disabled={l.kind === "thread"}
                onChange={() => toggle(l.key)}
              />
              <span>
                {l.label}
                <span style={{ color: "#aab0bb", marginLeft: 6, fontSize: 11 }}>
                  {l.kind === "contact" ? "person" : l.kind === "customer" ? "company" : l.kind === "site" ? "venue" : l.kind === "thread" ? "always linked" : ""}
                </span>
              </span>
            </label>
          ))}
        </div>

        <label style={lbl} htmlFor="task-notes">Notes</label>
        <textarea
          id="task-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          style={{ ...inStyle, resize: "vertical", lineHeight: 1.45 }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={lbl} htmlFor="task-assignee">Assign to</label>
            <select id="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ ...inStyle, cursor: "pointer" }}>
              {vm.taskTeam.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === vm.meId ? `${u.name} (me)` : u.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 150px" }}>
            <label style={lbl} htmlFor="task-due">Due date (optional)</label>
            <input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={inStyle} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
          Shows on the calendar on its due date. With no date, or once overdue, it floats on today until it’s done or deleted.
        </div>

        {error && (
          <div role="alert" style={{ marginTop: 12, fontSize: 12, color: "#b4543a" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={BTN}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={pending || !title.trim()} style={{ ...PRIMARY, opacity: pending || !title.trim() ? 0.6 : 1 }}>
            {pending ? "Saving…" : "Save task"}
          </button>
        </div>
      </div>
    </div>
  );
}
