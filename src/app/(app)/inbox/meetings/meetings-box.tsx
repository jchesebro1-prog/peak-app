"use client";

/**
 * #323 — the Inbox Meetings box: To file (This week / Older) · Filed · Noise.
 * Sits in the Inbox list column (the shell owns the column and its narrow
 * box picker); rows link to `?view=meetings&tab=…&m=<id>`. Plain view models
 * from load.ts — no store imports.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MeetingScope } from "@/lib/meetings/visibility";
import type { MeetingSuggestion } from "@/lib/meetings/types";
import type { MeetingRowVM, MeetingsBoxVM } from "./load";
import { FILED_CAP, MEETINGS_BASE_HREF, meetingsHref, type MeetingsTab } from "./format";
import { confirmAllStrongAction, loadOlderAction, syncNowAction } from "./actions";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

const TABS: { key: MeetingsTab; label: string }[] = [
  { key: "to-file", label: "To file" },
  { key: "filed", label: "Filed" },
  { key: "noise", label: "Noise" },
];

export const SCOPE_META: Record<MeetingScope | "shared", { icon: string; words: string }> = {
  private: { icon: "🔒", words: "Only you" },
  internal: { icon: "👥", words: "Internal" },
  peak: { icon: "🏢", words: "All of Peak" },
  shared: { icon: "🌐", words: "Shared with customer" },
};

export function ScopeIcon({ scope, shared }: { scope: MeetingScope; shared: boolean }) {
  const meta = SCOPE_META[shared ? "shared" : scope];
  return (
    <span title={meta.words} aria-label={meta.words} role="img" style={{ fontSize: 12, flexShrink: 0 }}>
      {meta.icon}
    </span>
  );
}

/** strong = solid accent chip, weak = outline */
export function SuggestionChip({ s }: { s: MeetingSuggestion }) {
  const strong = s.strength === "strong";
  return (
    <span
      title={`${strong ? "Strong" : "Possible"} match · ${s.reasons.join(" · ")}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        fontSize: 11,
        fontWeight: 600,
        padding: "1px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: strong ? ACCENT_INK : "#5b616e",
        background: strong ? ACCENT_SOFT : "#fff",
        border: strong ? "1px solid var(--accent)" : "1px dashed #c9ccd3",
      }}
    >
      {s.label}
    </span>
  );
}

const BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "5px 9px",
  cursor: "pointer",
};
const PRIMARY: React.CSSProperties = { ...BTN, color: "#fff", background: "var(--accent)", border: "1px solid transparent" };

export default function MeetingsBox({
  vm,
  selectedId,
  tab,
  baseHref = MEETINGS_BASE_HREF,
}: {
  vm: MeetingsBoxVM;
  selectedId: string | null;
  tab: MeetingsTab;
  /** where the box lives — the Inbox view today; its own nav page later (K7) */
  baseHref?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const toFileRows = [...vm.thisWeek, ...vm.older];
  const strongIds = toFileRows.filter((r) => r.top?.strength === "strong").map((r) => r.id);

  const confirmAll = () =>
    start(async () => {
      setNote(null);
      try {
        // the action revalidates /inbox itself — no client refresh on top
        const r = await confirmAllStrongAction(strongIds);
        if (!r.ok) setNote({ text: r.error, bad: true });
        else setNote({ text: `Filed ${r.filed ?? 0} meeting${r.filed === 1 ? "" : "s"}`, bad: false });
      } catch {
        setNote({ text: "Something went wrong — try again.", bad: true });
      }
    });

  const sync = (mode: "recent" | "backfill") =>
    start(async () => {
      setNote(null);
      try {
        const r = mode === "recent" ? await syncNowAction() : await loadOlderAction();
        if (!r.ok) setNote({ text: r.error, bad: true });
        else if (r.busy) setNote({ text: "Sync already running", bad: false });
        else {
          const created = r.result?.created ?? 0;
          const detailed = r.result?.detailed ?? 0;
          setNote({
            text: created
              ? `${created} new meeting${created === 1 ? "" : "s"}`
              : detailed
                ? `Updated ${detailed}`
                : "Up to date",
            bad: false,
          });
          // the action revalidates only when something changed; refresh for the "Synced …" line otherwise
          if (!created && !detailed) router.refresh();
        }
      } catch {
        setNote({ text: "Something went wrong — try again.", bad: true });
      }
    });

  const count = tab === "to-file" ? vm.counts.toFile : tab === "filed" ? vm.counts.filed : vm.counts.noise;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, fontFamily: "var(--font-ui)" }}>
      <div style={{ padding: "11px 15px 10px", borderBottom: "1px solid #f0f1f4", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>Meetings</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#aab0bb" }}>{count}</span>
        </div>
        <div style={{ fontSize: 11, color: vm.sync.lastError ? "#b4543a" : "#9aa0ab", marginTop: 1 }} title={vm.sync.lastError || undefined}>
          {!vm.sync.connected ? (
            <>
              Krisp isn&apos;t connected —{" "}
              <Link href="/account" style={{ color: ACCENT_INK }}>connect it in Account</Link>
            </>
          ) : vm.sync.lastError ? (
            <>Last sync failed: {vm.sync.lastError}</>
          ) : vm.sync.syncedAgo ? (
            <>Synced {vm.sync.syncedAgo}{vm.sync.backfillLabel ? ` · back to ${vm.sync.backfillLabel}` : ""}</>
          ) : (
            <>Not synced yet</>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
          <button type="button" style={BTN} disabled={pending || !vm.sync.connected} onClick={() => sync("recent")}>
            Sync now
          </button>
          <button type="button" style={BTN} disabled={pending || !vm.sync.connected} onClick={() => sync("backfill")}
            title="Import the 90 days before the oldest meeting synced so far">
            Load older
          </button>
          {tab === "to-file" && (
            <button
              type="button"
              style={{ ...PRIMARY, marginLeft: "auto", opacity: strongIds.length && !pending ? 1 : 0.5 }}
              disabled={pending || strongIds.length === 0}
              onClick={confirmAll}
              title={strongIds.length ? "File every meeting with a strong match, using exactly its strong matches" : "No meeting has a strong match"}
            >
              Confirm all{strongIds.length ? ` (${strongIds.length})` : ""}
            </button>
          )}
        </div>
        {note && (
          <div role="status" style={{ fontSize: 11.5, marginTop: 7, color: note.bad ? "#b4543a" : "#5b616e" }}>
            {note.text}
          </div>
        )}
        <nav aria-label="Meetings" style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {TABS.map((t) => {
            const on = t.key === tab;
            const n = t.key === "to-file" ? vm.counts.toFile : t.key === "filed" ? vm.counts.filed : vm.counts.noise;
            return (
              <Link
                key={t.key}
                aria-current={on ? "page" : undefined}
                href={meetingsHref(baseHref, t.key)}
                style={{
                  fontSize: 12,
                  fontWeight: on ? 600 : 500,
                  padding: "4px 10px",
                  borderRadius: 999,
                  textDecoration: "none",
                  color: on ? ACCENT_INK : "#5b616e",
                  background: on ? ACCENT_SOFT : "#fff",
                  border: on ? "1px solid var(--accent)" : "1px solid #e8eaee",
                }}
              >
                {t.label}
                {n > 0 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, marginLeft: 5 }}>{n}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="ib-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {tab === "to-file" ? (
          toFileRows.length === 0 ? (
            <Empty title="Nothing to file" sub="New Krisp meetings land here until they're linked." />
          ) : (
            <>
              <Section label="This week" rows={vm.thisWeek} tab={tab} selectedId={selectedId} baseHref={baseHref} />
              <Section label="Older" rows={vm.older} tab={tab} selectedId={selectedId} baseHref={baseHref} />
            </>
          )
        ) : vm.rows.length === 0 ? (
          <Empty
            title={tab === "filed" ? "Nothing filed yet" : "No noise"}
            sub={tab === "filed" ? "Meetings you link show up here." : "Recordings under 3 minutes land here."}
          />
        ) : (
          <>
            {vm.rows.map((r) => <Row key={r.id} r={r} tab={tab} selected={r.id === selectedId} baseHref={baseHref} />)}
            {tab === "filed" && vm.counts.filed > vm.rows.length && (
              <div style={{ padding: "10px 18px", fontSize: 11.5, color: "#9aa0ab" }}>
                Showing {Math.min(FILED_CAP, vm.rows.length)} of {vm.counts.filed}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, rows, tab, selectedId, baseHref }: {
  label: string; rows: MeetingRowVM[]; tab: MeetingsTab; selectedId: string | null; baseHref: string;
}) {
  if (!rows.length) return null;
  return (
    <>
      <div
        style={{
          padding: "8px 15px 5px 18px",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "#aab0bb",
          background: "#fbfbfc",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        {label}
      </div>
      {rows.map((r) => <Row key={r.id} r={r} tab={tab} selected={r.id === selectedId} baseHref={baseHref} />)}
    </>
  );
}

function Row({ r, tab, selected, baseHref }: { r: MeetingRowVM; tab: MeetingsTab; selected: boolean; baseHref: string }) {
  return (
    <Link
      className="ib-row"
      data-meeting-id={r.id}
      href={meetingsHref(baseHref, tab, r.id)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "9px 15px 9px 18px",
        borderBottom: "1px solid #f5f6f8",
        textDecoration: "none",
        color: "inherit",
        background: selected ? "color-mix(in srgb, var(--accent) 9%, #fff)" : "#fff",
        boxShadow: selected ? "inset 3px 0 0 var(--accent)" : undefined,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ScopeIcon scope={r.scope} shared={r.shared} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "#26292f",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {r.title}
          </span>
          <span style={{ fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{r.length}</span>
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
          {r.when} · {r.source}
          {r.removed ? " · removed in Krisp" : ""}
        </span>
        {r.top && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, minWidth: 0 }}>
            <SuggestionChip s={r.top} />
            {r.strongCount > 1 && (
              <span style={{ fontSize: 10.5, color: "#9aa0ab", flexShrink: 0 }}>+{r.strongCount - 1} strong</span>
            )}
          </span>
        )}
      </span>
    </Link>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ padding: "40px 24px", textAlign: "center", color: "#9aa0ab" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#5b616e" }}>{title}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>
    </div>
  );
}
