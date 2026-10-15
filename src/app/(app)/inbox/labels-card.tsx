"use client";

/**
 * #346 — the reader sidebar's Labels card (Jeff, Oct 14: "apply labels" from
 * the Organize view). The thread's label is the Inbox's own category — the
 * same presets and the same action as Categorize ▾ on a selection
 * (`categoryAction`, owner-checked) — shown as a chip with ✕, plus "+ Add
 * label" (or "Change") to pick one. Gmail labels the thread carries show as
 * read-only chips under it (placeholder Peak/Customers labels left out,
 * #345). Changing a label never touches the filing. The card only renders
 * for the viewer's own thread (the read-only #341 reader has no sidebar, and
 * its VM carries `labels: null`).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { categoryAction } from "./actions";
import { CategoryMenu } from "./command-bar";
import { labelColors } from "./thread-list";
import { postChanged } from "@/lib/popout/channel";
import { BTN, CARD, H, MUTED } from "./sidebar-styles";

export default function LabelsCard({ vm }: { vm: ReaderVM }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const labels = vm.labels;
  if (!labels || vm.readOnly) return null;
  const cur = labels.current;

  const apply = (key: string | null) =>
    start(async () => {
      setError(null);
      try {
        await categoryAction(vm.id, key);
        postChanged("thread", vm.id);
        router.refresh();
      } catch {
        setError("Couldn't change the label — try again.");
      }
    });

  return (
    <div style={CARD} data-labels-card>
      <div style={H}>Labels</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", opacity: pending ? 0.6 : 1 }}>
        {cur && (
          <span
            data-label-chip={cur.key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "#3a3f4a",
              background: `color-mix(in srgb, ${cur.color} 12%, #fff)`,
              border: `1px solid color-mix(in srgb, ${cur.color} 40%, #fff)`,
              borderRadius: 999,
              padding: "2px 4px 2px 8px",
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: cur.color, flexShrink: 0 }} />
            {cur.label}
            <button
              type="button"
              aria-label={`Remove the ${cur.label} label`}
              title="Remove label"
              disabled={pending}
              onClick={() => apply(null)}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "#8c919c", fontSize: 13, lineHeight: 1, padding: "0 3px" }}
            >
              ✕
            </button>
          </span>
        )}
        <CategoryMenu
          trigger={<span style={{ ...BTN, display: "inline-block", padding: "4px 9px" }}>{cur ? "Change" : "+ Add label"}</span>}
          categoryOptions={labels.options}
          current={cur?.key ?? null}
          onCategory={(key) => {
            if (key !== (cur?.key ?? null)) apply(key);
          }}
          showNone={false}
        />
      </div>
      {labels.gmail.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div style={{ ...MUTED, marginTop: 0, marginBottom: 5 }}>In Gmail</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {labels.gmail.map((l) => (
              <span key={l.id} title="Gmail label — change it in Gmail" style={{ fontSize: 10.5, fontWeight: 600, ...labelColors(l), borderRadius: 4, padding: "2px 6px" }}>
                {l.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{error}</div>}
    </div>
  );
}
