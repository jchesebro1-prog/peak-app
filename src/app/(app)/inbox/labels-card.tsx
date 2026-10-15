"use client";

/**
 * #346 / #347 — the reader sidebar's Labels card (Jeff, Oct 14: "My real
 * Gmail labels").
 *
 * - **Gmail labels first:** the thread's own labels (and Starred /
 *   Important) as chips with ✕; "+ Add label" opens a searchable picker of
 *   the person's Gmail labels with "Create '<typed>'" at the bottom. Apply,
 *   remove and create go to Gmail (`setGmailLabelAction` /
 *   `createGmailLabelAction` — owner-checked, threads.modify / labels.create)
 *   and the stored labels follow at once. The app's Peak/* labels show
 *   read-only (they follow filing and status) and are never offered.
 * - **Colour:** the Inbox's category (one per thread, the same
 *   `categoryAction` as Categorize ▾) as a small row underneath.
 *
 * Nothing here changes the filing. The card renders only for the viewer's
 * own thread (a read-only #341 thread has no sidebar and `labels: null`).
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { categoryAction, createGmailLabelAction, gmailLabelPickerAction, setGmailLabelAction } from "./actions";
import { CategoryMenu } from "./command-bar";
import { labelColors } from "./thread-list";
import { postChanged } from "@/lib/popout/channel";
import { validateLabelName, type CardGmailChip, type PickerLabel } from "@/lib/gmail/user-label-rules";
import { BTN, CARD, H, MUTED } from "./sidebar-styles";

type Res = { ok: true } | { ok: false; message: string };

export default function LabelsCard({ vm }: { vm: ReaderVM }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const labels = vm.labels;
  if (!labels || vm.readOnly) return null;
  const cur = labels.current;

  /** run one change, then post + refresh; a refusal shows inline */
  const run = (fn: () => Promise<Res | void>, done?: () => void) =>
    start(async () => {
      setError(null);
      try {
        const r = await fn();
        if (r && !r.ok) {
          setError(r.message);
          return;
        }
        postChanged("thread", vm.id);
        done?.();
        router.refresh();
      } catch {
        setError("Couldn't change the label — try again.");
      }
    });

  const editable = labels.gmail.filter((g) => g.editable);
  const peak = labels.gmail.filter((g) => !g.editable);

  return (
    <div style={CARD} data-labels-card>
      <div style={H}>Labels</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", opacity: pending ? 0.6 : 1 }}>
        {editable.map((g) => (
          <GmailChip
            key={g.id}
            chip={g}
            onRemove={labels.gmailEditable ? () => run(() => setGmailLabelAction(vm.id, g.id, false)) : undefined}
            disabled={pending}
          />
        ))}
        {labels.gmailEditable && !picking && (
          <button type="button" data-gmail-label-add style={{ ...BTN, padding: "4px 9px" }} disabled={pending} onClick={() => setPicking(true)}>
            + Add label
          </button>
        )}
        {!labels.gmailEditable && editable.length === 0 && <span style={{ ...MUTED, marginTop: 0 }}>Gmail labels show on emails from your connected Gmail.</span>}
      </div>
      {picking && (
        <LabelPicker
          threadId={vm.id}
          applied={new Set(editable.map((g) => g.id))}
          busy={pending}
          onPick={(l) => run(() => setGmailLabelAction(vm.id, l.id, true), () => setPicking(false))}
          onCreate={(name) => run(() => createGmailLabelAction(vm.id, name), () => setPicking(false))}
          onClose={() => setPicking(false)}
        />
      )}
      {peak.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }} title="Set by the app from the filing and status">
          {peak.map((g) => (
            <span key={g.id} data-peak-label style={{ fontSize: 10.5, fontWeight: 600, ...labelColors(g), borderRadius: 4, padding: "2px 6px", opacity: 0.85 }}>
              {g.name}
            </span>
          ))}
        </div>
      )}

      {/* Colour — the Inbox's category */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }} data-colour-row>
        <span style={{ fontSize: 11, color: "#8c919c", minWidth: 42 }}>Colour</span>
        {cur && (
          <span
            data-label-chip={cur.key}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", padding: "1px 2px 1px 0" }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: cur.color, flexShrink: 0 }} />
            {cur.label}
            <button
              type="button"
              aria-label={`Remove the ${cur.label} colour`}
              title="Remove colour"
              disabled={pending}
              onClick={() => run(() => categoryAction(vm.id, null))}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "#8c919c", fontSize: 12, lineHeight: 1, padding: "0 3px" }}
            >
              ✕
            </button>
          </span>
        )}
        <CategoryMenu
          trigger={<span style={{ ...BTN, display: "inline-block", padding: "2px 8px", fontSize: 11 }}>{cur ? "Change" : "+ Colour"}</span>}
          categoryOptions={labels.options}
          current={cur?.key ?? null}
          onCategory={(key) => {
            if (key !== (cur?.key ?? null)) run(() => categoryAction(vm.id, key));
          }}
          showNone={false}
        />
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function GmailChip({ chip, onRemove, disabled }: { chip: CardGmailChip; onRemove?: () => void; disabled: boolean }) {
  return (
    <span
      data-gmail-label={chip.id}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, ...labelColors(chip), borderRadius: 999, padding: onRemove ? "2px 4px 2px 9px" : "2px 9px" }}
    >
      {chip.name}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove the ${chip.name} label`}
          title="Remove label (in Gmail too)"
          disabled={disabled}
          onClick={onRemove}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: "inherit", opacity: 0.7, fontSize: 12.5, lineHeight: 1, padding: "0 3px" }}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** The searchable picker: the mailbox's labels (loaded when it opens), the
 *  ones already on the thread left out, and "Create '<typed>'" at the bottom
 *  when no label has that name. */
function LabelPicker({
  threadId,
  applied,
  busy,
  onPick,
  onCreate,
  onClose,
}: {
  threadId: string;
  applied: Set<string>;
  busy: boolean;
  onPick: (l: PickerLabel) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<PickerLabel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    inputRef.current?.focus();
    gmailLabelPickerAction(threadId)
      .then((r) => {
        if (!live) return;
        if (r.ok) setAll(r.labels);
        else {
          setAll([]);
          setLoadError(r.message);
        }
      })
      .catch(() => {
        if (live) {
          setAll([]);
          setLoadError("Couldn't load your Gmail labels.");
        }
      });
    return () => {
      live = false;
    };
  }, [threadId]);

  const query = q.trim().toLowerCase();
  const shown = useMemo(() => (all || []).filter((l) => !applied.has(l.id) && (!query || l.name.toLowerCase().includes(query))).slice(0, 60), [all, applied, query]);
  const exact = (all || []).some((l) => l.name.toLowerCase() === query);
  const v = validateLabelName(q);
  const canCreate = !!query && !exact && v.ok;

  return (
    <div data-gmail-label-picker style={{ marginTop: 8, border: "1px solid #e4e7ec", borderRadius: 9, padding: 6, background: "#fff" }}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") {
            e.preventDefault();
            if (shown[0]) onPick(shown[0]);
            else if (canCreate) onCreate(q);
          }
        }}
        placeholder="Search or create a label…"
        aria-label="Search your Gmail labels"
        style={{ width: "100%", boxSizing: "border-box", fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 8px" }}
      />
      <div role="listbox" aria-label="Gmail labels" style={{ maxHeight: 190, overflowY: "auto", marginTop: 4 }}>
        {all === null && <div style={{ ...MUTED, padding: "4px 6px" }}>Loading your labels…</div>}
        {shown.map((l) => (
          <button
            key={l.id}
            type="button"
            role="option"
            aria-selected={false}
            disabled={busy}
            onClick={() => onPick(l)}
            style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left", border: "none", background: "transparent", borderRadius: 6, padding: "6px 6px", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#3a3f4a" }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, background: l.backgroundColor || "#c4c9d2" }} />
            {l.name}
          </button>
        ))}
        {all !== null && !shown.length && !query && <div style={{ ...MUTED, padding: "4px 6px" }}>No other labels yet — type a name to create one.</div>}
        {query && !exact && (
          <button
            type="button"
            data-gmail-label-create
            disabled={busy || !canCreate}
            title={v.ok ? undefined : v.message}
            onClick={() => onCreate(q)}
            style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderTop: "1px solid #f0f1f4", background: "transparent", padding: "7px 6px", cursor: canCreate ? "pointer" : "default", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, color: canCreate ? "var(--accent)" : "#aab0bb" }}
          >
            Create “{q.trim()}”{!v.ok ? ` — ${v.message}` : ""}
          </button>
        )}
      </div>
      {loadError && <div style={{ fontSize: 11.5, color: "#b4543a", padding: "4px 6px" }}>{loadError}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" style={{ ...BTN, padding: "3px 8px", fontSize: 11 }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
