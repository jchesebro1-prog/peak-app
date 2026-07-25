# Inbox Round 2 Implementation Plan (punch #42, wave 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inbox feel like Outlook: plain date-sorted email by default with an opt-in per-user CRM mode (waiting-first sort + follow-up filters), conversation count/participants on rows, arrow-key navigation, tighter list density, and Delete in the hover quick actions.

**Architecture:** Task 0 recon (2026-07-25) found threading, the three-pane layout, and the selection-aware command bar ALREADY BUILT. This plan only adds what's missing. The mode toggle is a per-user server-side pref (notifPrefs pattern) that gates the existing waiting-first default sort in `threadsIn()`; CRM mode also reveals a follow-up filter row that composes into the existing `?filter=` URL mechanism. No sync-layer changes.

**Tech Stack:** Next.js app router (server components + server actions), Drizzle/PGlite, hand-styled inline React (match the inbox's existing inline-style idiom — do NOT introduce ui.tsx primitives into the inbox).

## Global Constraints

- **Never touch the sync layer** (`src/lib/gmail/bridge.ts`, `autoSyncAction`) — and never add `revalidatePath` to `autoSyncAction` (the no-revalidate-mid-type contract, inbox-shell.tsx:346-383).
- The default (CRM mode OFF) list order must be pure date-desc (pinned still float — `pinnedFirst` stays).
- The "Needs reply" smart view (`boxId === "needs"`) keeps waiting-first ordering in BOTH modes — it's an explicit view.
- Per-user persistence uses the `notif_prefs` row (sparse `prefs` jsonb map, keyed by user NAME) — same row, new key, like `site_visit_invites` (notif-prefs.ts:142-153).
- Gate after every task: `npx tsc --noEmit` clean. Final gate: `npm run test:specs` + `npm run build` (build is safe post-D106; do not run build while a dev server is running anyway).
- Match existing code style: inline styles, no new deps, no emoji, functional glyphs only.
- Commit after every task.

---

### Task 1: Per-user inbox mode pref + gate the waiting-first sort

**Files:**
- Modify: `src/lib/stores/notif-prefs.ts` (append accessors after the site-visit-invite block, ~line 153)
- Modify: `src/lib/stores/comms.ts` (`threadsIn` opts + waitFirst gate, ~lines 629, 697-705)
- Modify: `src/app/(app)/inbox/page.tsx` (read the pref, pass to `threadsIn`, expose to shell VM)
- Modify: `src/app/(app)/inbox/actions.ts` (new `setInboxModeAction`)

**Interfaces:**
- Produces: `crmModeOn(user?: string): Promise<boolean>` and `setCrmMode(on: boolean, user?: string): Promise<void>` in notif-prefs.ts; `threadsIn(boxId, folder, me, opts)` gains `opts.crmMode?: boolean`; server action `setInboxModeAction(on: boolean): Promise<void>`; `page.tsx` passes `crmMode: boolean` down to `InboxShell` as a prop.

- [ ] **Step 1: Add the pref accessors** in `src/lib/stores/notif-prefs.ts`, directly below the `setInvitesOn` block, copying its shape exactly:

```ts
/* ---- Inbox/CRM mode (punch #42) — same sparse row, non-category key ---- */

const CRM_MODE_KEY = "inbox_crm_mode";

/** CRM mode is OPT-IN: missing key = plain inbox (false), unlike category
 *  mutes where missing = on. */
export async function crmModeOn(user?: string): Promise<boolean> {
  const u = user ?? (await currentUserName());
  const prefs = await readRow(u);
  return prefs[CRM_MODE_KEY] === true;
}

export async function setCrmMode(on: boolean, user?: string): Promise<void> {
  const u = user ?? (await currentUserName());
  const prefs = await readRow(u);
  await writeRow(u, { ...prefs, [CRM_MODE_KEY]: on });
}
```

(If `readRow`/`writeRow`/`currentUserName` have different actual names or the user-name helper is imported, mirror whatever `invitesOn`/`setInvitesOn` do verbatim — that pair is the authoritative pattern.)

- [ ] **Step 2: Gate the waiting-first sort** in `src/lib/stores/comms.ts`. Add `crmMode?: boolean` to the `threadsIn` opts type. Change the `waitFirst` computation (currently `const waitFirst = boxId === "needs" || folder === "inbox";` at ~line 697) to:

```ts
const waitFirst = boxId === "needs" || (folder === "inbox" && opts?.crmMode === true);
```

Everything else in the function (the waiting-first branch itself, `pinnedFirst`, explicit-sort handling) stays byte-identical. When `waitFirst` is false and no explicit sort is set, the existing date-desc fallback path must apply — verify that path exists (it's the `rest`-style updatedAt sort); if the current code has no non-waitFirst default branch, add `return pinnedFirst(base.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));` as the fallback.

- [ ] **Step 3: Plumb the pref through `page.tsx`.** In the `Promise.all` load block (~lines 177-206), add `crmModeOn(user.name)` (import from notif-prefs store). Pass `crmMode` into the `threadsIn(...)` opts alongside `filter`/`sort`, and pass `crmMode={crmMode}` to `<InboxShell>`. Add `crmMode: boolean` to the shell's props type.

- [ ] **Step 4: Server action.** In `src/app/(app)/inbox/actions.ts`, next to the other small actions:

```ts
export async function setInboxModeAction(on: boolean): Promise<void> {
  await setCrmMode(on);
  revalidate();
}
```

(`revalidate()` is the existing local helper doing `revalidatePath("/", "layout")` at ~line 71.)

- [ ] **Step 5: Verify + commit.** Run `npx tsc --noEmit` — clean. Expected behavior delta: with no pref set, the inbox lists pure date-desc (pinned first); the Needs reply view still sorts waiting-first. Commit: `feat: per-user Inbox/CRM mode pref gates the waiting-first sort (#42)`

---

### Task 2: Mode toggle UI + CRM filter row

**Files:**
- Modify: `src/app/(app)/inbox/inbox-shell.tsx` (toggle in the list-pane header area, CRM filter row, optimistic mode state)
- Modify: `src/app/(app)/inbox/command-bar.tsx` ONLY if the toggle lands there — preferred placement is the list header inside `thread-list.tsx`'s header slot; put the toggle where the Filter/Sort menus already live so mode and refinement read as one cluster.

**Interfaces:**
- Consumes: `setInboxModeAction(on)` from Task 1; `crmMode: boolean` prop on `InboxShell`.
- Produces: a two-option segmented control ("Inbox" | "CRM") rendered beside the Filter/Sort menus; when CRM is active, a compact filter chip row under the command bar with: Needs reply · Flagged · Unread — each chip writes the existing `?filter=` URL param via the existing `setRefinement("filter", value)` helper (inbox-shell.tsx:177-192), active chip highlighted, clicking the active chip clears the filter.

- [ ] **Step 1: Optimistic mode state in the shell.** `const [crmMode, setCrmModeState] = useState(props.crmMode);` and a handler:

```ts
const onToggleMode = (on: boolean) => {
  setCrmModeState(on);
  startTransition(async () => {
    await setInboxModeAction(on);
    router.refresh();
  });
};
```

- [ ] **Step 2: Render the segmented control.** Hand-styled to match the inbox idiom (do NOT import `SegmentedToggle` — it's href-based). Two buttons in a rounded `#f1f2f5` track, active = white pill with hairline border and `--ink` text, inactive = `#5b616e`; font-size 12.5, padding "4px 12px". Labels: `Inbox`, `CRM`. Place it in the command-bar row's right cluster, left of Filter▾ (pass it into `ThreadList`'s `commandBar` slot region from the shell, or as a new prop to `CommandBar` — pick whichever needs the least prop drilling given the actual JSX; the bar already receives callbacks from the shell).

- [ ] **Step 3: CRM filter chips row.** Rendered between the command bar and the row list, only when `crmMode`:

```tsx
{crmMode && (
  <div style={{ display: "flex", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--row-divider, #f5f6f8)" }}>
    {([["needs", "Needs reply"], ["flagged", "Flagged"], ["unread", "Unread"]] as const).map(([key, label]) => (
      <button key={key} onClick={() => setRefinement("filter", filter === key ? null : key)}
        style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                 border: filter === key ? "1px solid var(--accent, #b08d4a)" : "1px solid #e8eaee",
                 background: filter === key ? "#faf6ee" : "#fff",
                 color: filter === key ? "var(--accent-ink, #8a6c34)" : "#5b616e" }}>
        {label}
      </button>
    ))}
  </div>
)}
```

(The shell must know the current `filter` value — it already builds refinement URLs, so read it from the same place `setRefinement` does; thread the value as a prop if it currently lives only in `page.tsx`.)

- [ ] **Step 4: Verify + commit.** `npx tsc --noEmit` clean. Manual check in the running app: toggle flips instantly (optimistic), survives reload (server pref), chips only in CRM mode, chip click filters the list via URL. Commit: `feat: Inbox/CRM segmented toggle + CRM-mode follow-up filter chips (#42)`

---

### Task 3: Conversation affordances — message count + participants on rows

**Files:**
- Modify: `src/app/(app)/inbox/types.ts` (`ThreadRowVM`, lines 73-107)
- Modify: `src/app/(app)/inbox/page.tsx` (`rowFor`, lines 319-384)
- Modify: `src/app/(app)/inbox/thread-list.tsx` (`Row`, lines 497-770)

**Interfaces:**
- Produces: `ThreadRowVM.msgCount: number` (count of `messages[]`) and `ThreadRowVM.participants: string` (unique message authors beyond the primary `name`, e.g. `"Jeff, Sarah +1"`; empty string when the thread has one author).

- [ ] **Step 1: Extend the VM.** In `types.ts` add `msgCount: number;` and `participants: string;` to `ThreadRowVM`.

- [ ] **Step 2: Build the fields in `rowFor` (page.tsx).**

```ts
const msgCount = (t.messages || []).length;
const authors = Array.from(new Set((t.messages || []).map((m) => m.author).filter(Boolean)));
const participants =
  authors.length <= 1 ? "" :
  authors.length <= 2 ? authors.join(", ") :
  `${authors.slice(0, 2).join(", ")} +${authors.length - 2}`;
```

Include both in the returned VM object.

- [ ] **Step 3: Render.** In `Row`, line 1 (the name row): when `msgCount > 1`, render a count badge after the name and prefer participants over the single name when present:

```tsx
<span style={{ /* existing name styles */ }}>{r.participants || r.name}</span>
{r.msgCount > 1 && (
  <span style={{ fontSize: 11, fontWeight: 600, color: "#8c919c", background: "#f1f2f5",
                 borderRadius: 8, padding: "0 6px", marginLeft: 6, flexShrink: 0 }}>
    {r.msgCount}
  </span>
)}
```

Keep the time right-aligned exactly as-is; the badge must not push it (name span keeps `minWidth: 0` + ellipsis).

- [ ] **Step 4: Verify + commit.** `npx tsc --noEmit` clean; in the app, a multi-message thread shows a count badge and combined participants; single-message threads unchanged. Commit: `feat: conversation count badge + participants on inbox rows (#42)`

---

### Task 4: Density + hover-action pass

**Files:**
- Modify: `src/app/(app)/inbox/thread-list.tsx` (`Row`)
- Modify: `src/app/(app)/inbox/inbox-shell.tsx` (wire single-thread delete into quick actions)
- Modify: `src/app/(app)/inbox/actions.ts` (only if no single-id delete action exists — `bulkDeleteAction([id])` is acceptable; do not add a new action if the bulk one serves)

- [ ] **Step 1: Tighten density.** Row padding `13px 15px 13px 18px` → `9px 15px 9px 18px`; drop the snippet line-height if set above 1.35; chip meta row (line 4) only renders when it has content (status pill / waiting / outbox / boxTag) — for a plain read thread with no chips, the row is 3 lines. Channel tile 30px → 26px.

- [ ] **Step 2: Add Delete to hover quick actions.** In the `ib-quick` pill (lines 731-767) add a Delete button after Archive/Flag/Pin using the existing icon set (`icons.tsx` — reuse the same trash icon the command bar uses), calling the same handler path the bulk Delete uses but for the single row id, then `router.refresh()`. In the Deleted folder, the quick pill shows Restore instead (mirror the command bar's `isDeleted` branch).

- [ ] **Step 3: Verify + commit.** `npx tsc --noEmit` clean; visually confirm tighter rows, hover shows Archive · Flag · Pin · Delete, delete moves the thread to Deleted (recoverable). Commit: `feat: tighter inbox list density + Delete in hover quick actions (#42)`

---

### Task 5: Keyboard navigation

**Files:**
- Modify: `src/app/(app)/inbox/inbox-shell.tsx` (window keydown handler)

**Interfaces:**
- Consumes: `selectThread(id)` (inbox-shell.tsx:148-155), the ordered row VM list, `reader?.id`.

- [ ] **Step 1: Add the handler.** In `InboxShell`:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const ids = rows.filter((r) => r.status !== "draft").map((r) => r.id);
    if (!ids.length) return;
    const cur = ids.indexOf(selectedId ?? "");
    const next = e.key === "ArrowDown"
      ? ids[Math.min(cur + 1, ids.length - 1)]
      : ids[Math.max(cur - 1, 0)];
    if (next && next !== selectedId) {
      e.preventDefault();
      selectThread(next);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [rows, selectedId, selectThread]);
```

Adapt names to the shell's actual variables (`rows` = the list VM array prop; `selectedId` = `reader?.id`). Guard: only active in desktop pane mode (skip when the overlay/mobile branch is showing, using the same condition that picks overlay vs pane). If `selectThread` is not stable, wrap in `useCallback` or inline its logic.

- [ ] **Step 2: Scroll the selected row into view.** Give each row `data-thread-id={r.id}`; after selection changes, `document.querySelector(\`[data-thread-id="${selectedId}"]\`)?.scrollIntoView({ block: "nearest" })` in an effect keyed on `selectedId`.

- [ ] **Step 3: Verify + commit.** `npx tsc --noEmit` clean; arrows walk the list, reader follows, typing in search/composer never triggers navigation, selected row stays visible. Commit: `feat: arrow-key navigation across inbox conversations (#42)`

---

### Task 6: Final gates + punch-list update

- [ ] **Step 1:** `npx tsc --noEmit` && `npm run test:specs` && `npm run build` — all green (no dev server running during build).
- [ ] **Step 2:** Full acceptance walk in the browser per the spec: multi-message chain = one row with count; in-pane reading; arrow keys; quiet bar with no selection; fresh user sees plain date-sorted inbox; flip to CRM → waiting-first + chips; flip back; pref survives reload.
- [ ] **Step 3:** Update `PUNCHLIST.md` #42 status to DONE with a short what-shipped note (threading/three-pane/bar found already built by recon; this build added mode toggle, count/participants, density, delete-on-hover, keyboard nav). Commit: `docs: punch #42 inbox round 2 complete`

## Self-Review Notes

- Spec coverage: threading (already built — Task 3 surfaces it), three-pane (already built), density (Task 4), selection-aware bar (already built), mode toggle (Tasks 1-2). Keyboard nav (Task 5). All five locked decisions covered.
- The mode toggle gates SORT, not a filter — recon showed waiting-first ordering is the actual "CRM-ish default" in the code. The spec's "waiting-date/follow-up filter OFF by default" maps to this sort gate + the chips row being CRM-only.
- Type consistency: `crmMode` boolean end-to-end; `ThreadRowVM.msgCount/participants` defined in Task 3 and consumed only there.
