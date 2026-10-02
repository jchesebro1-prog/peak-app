"use client";

import { useState, useTransition, type CSSProperties, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/format";
import { MAX_PARAGRAPH } from "@/app/(app)/estimator/narrative";
import { saveProductParagraphAction } from "@/app/(app)/estimator/narrative-actions";

/**
 * #293 — the part's Narrative paragraph: the write-once sales prose the
 * Estimator copies onto a quote when this part is a key product. Distinct
 * from the Spec panel's specBody (CSI Part 2 text). Lives inside the part
 * editor's <form action={upsertPart}> like SpecPanel: type="button" only,
 * no `name` on any field (nothing leaks into upsertPart), state seeded once
 * per mount (PUNCHLIST #141 rule). Saved through saveProductParagraphAction
 * (Create; mergeUpsert only), stale-checked against narrativeUpdatedAt.
 */
const LBL: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 5 };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#fff", background: "#2b2e35", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer" };

export default function NarrativeParagraphPanel({
  part,
}: {
  part: { sku: string; narrativeText?: string; narrativeUpdatedAt?: number; narrativeUpdatedBy?: string };
}) {
  const router = useRouter();
  const [text, setText] = useState(part.narrativeText || "");
  /** The stamp this editor last saw — advanced by our own saves, so a second
   *  save before router.refresh() lands isn't reported as stale. */
  const [seen, setSeen] = useState<{ at: number | null; by: string | null }>({ at: part.narrativeUpdatedAt ?? null, by: part.narrativeUpdatedBy ?? null });
  const [stale, setStale] = useState<{ updatedAt: number | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  // A thrown action inside startTransition reaches the error boundary — catch it.
  const save = (expect: number | null) =>
    start(async () => {
      setMsg("");
      try {
        const r = await saveProductParagraphAction(part.sku, text, expect);
        if (r.ok) {
          setStale(null);
          setSeen({ at: r.row.paragraphUpdatedAt, by: r.row.paragraphUpdatedBy });
          setMsg("Saved");
          router.refresh();
        } else if (r.stale) {
          setStale({ updatedAt: r.stale.updatedAt });
        } else setMsg(r.error);
      } catch {
        setMsg("Could not reach the server. Try again.");
      }
    });
  const stopEnter = (e: KeyboardEvent) => e.stopPropagation();

  return (
    <div>
      <label style={LBL}>Narrative paragraph</label>
      <textarea
        aria-label="Narrative paragraph"
        value={text}
        maxLength={MAX_PARAGRAPH}
        onKeyDown={stopEnter}
        onChange={(e) => setText(e.target.value)}
        placeholder="How this part reads in a customer narrative — written once, reused on every quote that features it."
        style={{ width: "100%", minHeight: 110, resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.5, border: "1px solid #e4e7ec", borderRadius: 7, padding: "8px 10px" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" style={{ ...BTN, opacity: text.trim() ? 1 : 0.5 }} disabled={pending || !text.trim()} onClick={() => save(seen.at)}>
          {pending ? "Saving…" : "Save paragraph"}
        </button>
        {seen.at ? (
          <span style={{ fontSize: 11, color: "#8c919c" }}>
            Last saved {timeAgo(seen.at)}
            {seen.by ? " by " + seen.by : ""}
          </span>
        ) : null}
        {msg && <span style={{ fontSize: 11.5, color: msg === "Saved" ? "#1f7a52" : "#b4543a" }}>{msg}</span>}
      </div>
      {stale && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11.5, background: "#fbf3dd", borderRadius: 6, padding: "6px 8px" }}>
          <span>The library paragraph changed since you loaded it — replace it anyway?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => save(stale.updatedAt)}>Replace anyway</button>
          <button type="button" style={{ ...BTN, background: "#f1f2f5", color: "#3a3f4a" }} onClick={() => setStale(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
