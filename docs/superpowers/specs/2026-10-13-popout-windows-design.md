# Pop-out windows — design

Date: 2026-10-13 · Status: approved in brainstorm (Jeff, 2026-10-13) · Punch # and D-numbers are assigned at build (recheck `origin/main`).

This is roadmap piece 1b: the dashboard stays open as home base, and the Inbox, an email, an estimate or a customer record each get their own window. Windows keep each other current. This is approach A from the brainstorm: the same pages, opened as named browser windows, with no separate routes.

## Decisions (Jeff)

| Question | Answer |
|---|---|
| First-slice screens | Inbox (whole box and single thread), Estimator, customer record (`/companies/[id]`) |
| How to open | ⧉ button on the screen, shift-click on links, ⧉ on the side nav |
| A second item of the same kind | **One window per item**; popping out the same item again focuses its window |
| Live updates | **Anything shown that changed** refreshes; unsaved typing is never overwritten |
| Window memory | **Size and position per screen type** |

## 1. Opening a pop-out

`src/lib/popout/open.ts` (client):

```ts
type PopKind = "inbox" | "thread" | "estimate" | "customer";
openPopout(kind: PopKind, id: string, url: string): void
```

- **Window name:** `peak-pop:<kind>:<id>` (`id` is `"box"` for the whole Inbox). `window.open(url, name, features)`. Reusing the name focuses the existing window.
- **Features:**
  - `popup=yes`, plus the saved `left`, `top`, `width` and `height` for that kind.
  - Defaults: estimate 1100×800, customer 900×800, thread/inbox 760×800, centred on the opener's screen.
- **If `window.open` returns null** (pop-up blocked), show a toast: "Your browser blocked the window — allow pop-ups for this site." The page does not navigate.
- **URLs:**
  - inbox `/inbox` (or the current box URL)
  - thread `/inbox?thread=<id>`
  - estimate `quoteBuilderHref(q)`, i.e. `/estimator?id=…`
  - customer `/companies/<id>`

## 2. Pop-out mode

- An inline script in the root `<head>` (`src/app/layout.tsx`) runs before first paint: if `window.name` starts with `peak-pop:`, add `pk-pop` to `<html>`. It must be tiny and inline. Use `next/script` with `beforeInteractive`, or a plain inline `<script>` if the Next 16 docs say that is the right way. Check `node_modules/next/dist/docs`.
- **CSS** (`globals.css`):
  - `html.pk-pop` hides the side nav (the Nav root) and makes `.pk-main` full width.
  - It shows `.pk-pop-header`.
- **`PopHeader`** (client, rendered once in `(app)/layout.tsx`, visible only in pop-out mode):
  - The current page title, from `document.title` or the page's own title prop where available.
  - **Open in main window**: posts `{type:"open-in-main", url}` on the channel. The main window, meaning any window without `pk-pop`, handles it by focusing itself and navigating to `url`. If no main window answers within 500 ms, it opens `url` in a normal tab.
  - **✕** closes the window.
- Navigation inside a pop-out stays in pop-out mode, because `window.name` persists.
- **Mobile and native shells** (Capacitor iOS/Android, PWA on phones): pop-out affordances are hidden when the viewport is under 900 px or the platform is the native shell.

## 3. Ways to open

- **⧉ buttons** (`PopoutButton`, aria-label "Open in its own window"):
  - the Inbox header (whole box)
  - the thread reader header (that thread)
  - the Estimator header (that estimate; hidden on an unsaved new estimate until it has an id)
  - the customer record header
- **Side nav:** a hover ⧉ next to **Inbox**, **Estimator** and **Customers** opens that section's landing page in a window. The kind is that section's own (`inbox:box`, `estimate:new`, `customer:list`), and the window name uses `list` / `new` as the id.
- **Shift-click** on email rows, estimate rows (Quotes hub, customer record quote lists, Home quote cards) and customer links (directories, cross-links) opens a pop-out. Plain clicks and cmd/ctrl-clicks keep their current behaviour.
  - Implement this as one `usePopoutClick(kind, id, url)` handler, or a `PopLink` wrapper used at those link sites.
  - A hover ⧉ on those rows is an extra way in, used where rows already have a hover-action area.

## 4. Window memory

- Each pop-out saves `{left: screenX, top: screenY, width: outerWidth, height: outerHeight}` under `localStorage["peak-pop-geo:<kind>"]` on `resize` (debounced) and `beforeunload`. The kind is parsed from `window.name`.
- `openPopout` reads it. All storage access is wrapped in try/catch; when storage is unavailable, use the defaults.

## 5. Live sync

The channel is `src/lib/popout/channel.ts` (client). It generalises `src/lib/inbox-org/broadcast.ts`:

```ts
type Changed = { type: "changed"; entity: "thread" | "quote" | "customer" | "task" | "inbox"; id?: string };
postChanged(entity, id?): void       // try/catch; no-op without BroadcastChannel
onChanged(handler): () => void
```

- The existing `inbox-changed` posts move to `postChanged("thread", id)`. Keep accepting the old message for one release, or migrate every poster and listener together.
- **Posters** (after a successful save only):
  - Inbox organize/link/archive/status/reply actions (already posting).
  - Estimator: save, status change, submit/approve/send, client-package changes.
  - Customer record: edits, contacts, venues, notes, documents.
  - Tasks: create, complete, delete (task dialogs, Home queue, thread task actions).
- **Listener** (`LiveSync`, one per window, mounted in `(app)/layout.tsx`, replacing the Inbox/Home `inbox-changed-listener`):
  - Every "changed" message causes a debounced `router.refresh()` (1 s).
  - **Typing guard:** if the focused element is an editable field with unsaved input, or the user typed in the last 3 s, defer the refresh until 3 s after the last keystroke.
  - **Self-ignore:** ignore messages this window posted (a per-window id in the message, not a time window).
  - **Focus refresh:** on `visibilitychange` to visible or window `focus`, refresh if the last refresh was more than 30 s ago.
  - Nav counts and the bell refresh because they are part of the layout's server render.

Pages already persist their own unsaved state where they need it: Estimator drafts and composer text are client state, and `router.refresh()` keeps client state. The guard is a second safety net.

## Non-goals

- Restoring a window set across sessions.
- Right-click custom context menus.
- Other screens' ⧉ buttons. The mechanism supports any route, so adding a button later is a one-liner.
- A native desktop app.
- Multi-monitor placement beyond what `screenX`/`screenY` give.
- Any server or data change.

## Testing

**Pure checks:**
- window-name parse and build
- geometry clamp: off-screen saved positions are clamped to the visible screen
- self-ignore id
- typing-guard decision function

**Source pins:**
- the head script exists and only reads `window.name`
- `PopHeader` and `LiveSync` are mounted once
- each of the three screens has a `PopoutButton`
- the posters exist in the Estimator, customer and task save paths
- client files import no stores

**Manual check** in the browser pane:
- Open the dashboard, pop out an estimate, edit it, and confirm the dashboard and Quotes refresh.
- Close and re-open the window; confirm the size is remembered.

**Gates:** test:specs, test:smoke, tsc, eslint, next build.
