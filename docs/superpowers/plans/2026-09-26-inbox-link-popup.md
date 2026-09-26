# Inbox Link Popup (#214) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Inbox link sidebar's dropdown editors with a "Link…" popup opened from any message: link every person on the email (From/To/Cc), search companies/venues/people in one box, link work, and read the sender's signature to prefill a new contact or fill a known contact's blanks.

**Architecture:** Four pure modules (`inbox-participants`, `inbox-signature-parse`, `inbox-thread-contacts`, `inbox-link-targets`) hold every rule and are covered by the spec harness. One new server-actions file (`inbox/link-popup-actions.ts`) loads the popup's data per message and does the new writes; company/venue/quick-add writes reuse `inbox/link-actions.ts` unchanged. The client popup (`inbox/link-popup.tsx`) talks only to server actions and type-only imports; the sidebar becomes a read-only summary with "Edit links".

**Tech Stack:** Next.js 16 App Router (client components + server actions), TypeScript, Drizzle on Postgres/PGlite (identity tables), JSONB doc store (`comms`), Gmail REST (metadata fetch), the `scripts/test-review-and-spec.ts` spec harness run by `npm run test:specs`.

Spec: `docs/superpowers/specs/2026-09-26-inbox-link-popup-tasks-calendar-design.md`, section "#214 — Inbox: the Link popup".

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Prefix every shell command with `export PATH=$HOME/.local/node/bin:$PATH &&`.
- This is Next.js 16 — before writing Next-specific code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md). Nothing in this plan uses a new Next API: server actions (`"use server"`), `revalidatePath`, `useRouter().refresh()` exactly as the neighbouring inbox files already do.
- No DB migrations. `comms` is a JSONB doc table; every new field (`CommThread.linkedContactIds`, `CommMessage.cc`, `CommMessage.ccFetched`) is optional, so old docs read unchanged.
- Deterministic only — no AI anywhere (D89).
- Client components (`"use client"`) never import a store (`@/lib/stores/*`), `@/db`, `@/lib/identity/*` or `@/lib/gmail/*` at runtime — a store pulls postgres into the client bundle and only `next build` catches it. Type-only imports from pure modules are fine. Data reaches the client through props (`ReaderVM`) and server actions.
- Every server action calls `requireUser()`; every thread action refuses a thread the user can't see (`visibleTo(t, me.name)`).
- Never run the dev server or any db script (`db:*`, seeds, imports). `npm run test:specs` is allowed: it always runs on a fresh `mktemp -d` PGlite datadir. Check `ps aux | grep -E "tsx|next dev" | grep -v grep` is empty before running it.
- Never use bare `git stash` (the stash is shared across worktrees) — commit instead.
- Spec-harness assertions are tagged `#214` and appended at the END of `scripts/test-review-and-spec.ts` as a hoisted `import` block plus a `{ … }` block (the same shape as the file's last `#205 product specs` block). Import aliases carry a `214` suffix (`ip214…`, `sig214…`, `tc214…`, `lt214…`) so they can't collide.
- Gates in each task's final step: `npx tsc --noEmit` (0 errors) · `npm run test:specs` (0 FAIL; report the PASS count) · `npx eslint <changed files>` (0 errors). Task 5 also runs `npm run build` (must succeed).
- Commit messages: `feat(inbox): … (#214)`, then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the task's files (never `git add -A`).
- Do not write DECISIONS.md / PUNCHLIST.md entries.
- #215 seam: the popup takes `onCreateTask?: () => void` and renders a "Create task" button only when it is passed. This plan never passes it; #215 wires it.

## Decisions this plan takes where the spec is open

1. **Inbound Cc is stored on the message only.** The spec says `bridge.ts` "stores it instead of `cc: ""`", but `deliverThreadOutbound` (`src/lib/gmail/bridge.ts:137-141`) copies the THREAD's `cc` onto every reply we send — putting an inbound Cc there would silently Cc those people on every reply. So `CommMessage.cc` carries the header; the new thread record keeps `cc: ""` (a spec assertion guards it).
2. **Company: change, not clear.** A thread whose sender is a known contact re-resolves to that company at read time (`resolveCustomerId`), so a "clear company" button could not stick. The popup offers change (the search box) for the company and Clear for the venue (`setThreadSiteAction(threadId, null)` already exists).
3. **Sidebar keeps its one-click cards.** "Dropdown editors are removed" is read literally: the customer `<select>`s, the venue `<select>`, the "Linking from" `<select>`, the "on contact:" `<select>`, the Work picker and every quick-add form leave the sidebar. The Suggested (Link / Always / Not them), Ambiguous (This thread / Always), "Save link" and domain "Stop" buttons stay — they are buttons, not editors.
4. **"Linking from" is set only by a header open.** Opening the popup from a message's "Link…" calls `setIdentityMessageAction` for that message (unless it already is the identity message). "Edit links" opens on the identity message, else the newest received message, else the newest — without changing the identity.
5. **Popup data is loaded by a server action per message**, not added to the page's `ReaderVM`, so the Inbox page load is unchanged. The page only gains `linkedPeople` (the sidebar chips).
6. **Addresses known at several companies** (`contactsByEmails` → `{ ambiguous }`) show "At several companies" with no checkbox and no Add — the popup never guesses between them.
7. **Adding a person needs a company.** The quick-add contact form pre-selects the signature's company (one domain owner, else one exact company-name match), else the thread's company; with none, a company search box appears and Add refuses until one is picked.
8. **The signature card shows only for received messages** (an outbound message's sender is us).
9. **People linked from other messages** are listed under "Also linked to this thread" in the popup, ticked, so they can be unlinked too.
10. **People search** matches name + email; the email half is one SQL `like` on the query's longest word (`emailsMatching`), so it never loads every address.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/inbox-participants.ts` | new, pure | Split From/To/Cc into `{ name, email, role }`, dedupe, drop our own addresses |
| `src/lib/inbox-signature-parse.ts` | new, pure | `extractSignature`, `missingContactFields`, `companyByExactName`, `channelLabelFor` |
| `src/lib/inbox-thread-contacts.ts` | new, pure | Linked-people rules: `linkedContactIdsOf`, `applyContactLink`, cap 25 |
| `src/lib/inbox-link-targets.ts` | new, pure | `rankLinkTargets` — companies / venues / people, ≤ 8 per group |
| `src/lib/stores/comms.ts` | modify | `CommMessage.cc`, `CommMessage.ccFetched`, `CommThread.linkedContactIds` |
| `src/lib/gmail/mime.ts` | modify | `ParsedInbound.cc`; export `headerValue` |
| `src/lib/gmail/api.ts` | modify | `getMessageMetadata` (format=metadata) |
| `src/lib/gmail/bridge.ts` | modify | store message Cc on import; `fetchMessageCc` lazy backfill |
| `src/lib/identity/lookup.ts` | modify | `emailsMatching(fragment)` for the people search |
| `src/app/(app)/inbox/types.ts` | modify | `ReaderVM.linkedPeople`, `PopupParticipant`, `LinkPopupData` |
| `src/app/(app)/inbox/link-popup-actions.ts` | new, server | `linkPopupDataAction`, `fetchMessageCcAction`, `setThreadContactsAction`, `searchLinkTargetsAction`, `fillContactBlanksAction` |
| `src/app/(app)/inbox/page.tsx` | modify | build `linkedPeople` |
| `src/app/(app)/inbox/link-popup.tsx` | new, client | the popup |
| `src/app/(app)/inbox/work-link-card.tsx` | modify | `mode: "summary" \| "edit"` |
| `src/app/(app)/inbox/link-sidebar.tsx` | rewrite | read-only summary + "Edit links" |
| `src/app/(app)/inbox/thread-reader.tsx` | modify | "Link…" on each message header; mount the popup |
| `scripts/test-review-and-spec.ts` | append | five `#214` blocks (85 assertions) |

Before Task 1, record the baseline: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | grep -c '^PASS'` (and confirm the run ends `ALL PASSED`) → note the number (B). After Task N the count must be B + the running total below (17 · 38 · 62 · 72 · 85), with 0 FAIL.

---

### Task 1: Participants + Cc stored on import

**Files:**
- Create: `src/lib/inbox-participants.ts`
- Modify: `src/lib/stores/comms.ts:230-233` (end of `CommMessage`)
- Modify: `src/lib/gmail/mime.ts:108-111` (`header`), `:147-165` (`ParsedInbound`), `:175` (`parseInbound`)
- Modify: `src/lib/gmail/api.ts:126` (insert before `getProfile`)
- Modify: `src/lib/gmail/bridge.ts:38-49` (imports), `:199-201` (`recordMessage` msg), `:480` (insert before `buildImportDedup`)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `participantsOf(message: ParticipantSource, mailboxAddresses: readonly string[], fallbackFrom?: { name: string; email: string } | null): Participant[]`; `type Participant = { name: string; email: string; role: ParticipantRole }`; `type ParticipantRole = "from" | "to" | "cc"`; `splitAddressList(header)`, `parseMailbox(part)`.
- Produces: `CommMessage.cc?: string`, `CommMessage.ccFetched?: true`; `ParsedInbound.cc: string`; `headerValue(headers, name): string` (mime.ts); `getMessageMetadata(mailboxKey, id, headers: string[]): Promise<GmailFullMessage>` (api.ts); `fetchMessageCc(threadId: string, messageId: string): Promise<string | null>` (bridge.ts — `null` = nothing to fetch, `""` = fetched, no Cc).

- [ ] **Step 1: Write the failing test.** Append this block to the very end of `scripts/test-review-and-spec.ts`:

````ts
/* ====== #214 Inbox Link popup — participants + Cc on import (Task 1) ======
   Pure parsing of From/To/Cc into the popup's "People on this email", the
   Cc header now read on import, and the lazy one-message Cc backfill —
   the bridge/api halves checked as source text (they call Gmail). */
import {
  participantsOf as ip214Participants,
  splitAddressList as ip214Split,
  parseMailbox as ip214Mailbox,
} from "@/lib/inbox-participants";
import { parseInbound as ip214ParseInbound, headerValue as ip214Header } from "@/lib/gmail/mime";
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const j = (x: unknown) => JSON.stringify(x);
  ok(
    j(ip214Split('"Hale, Chris" <chris@arch.com>, d@y.org')) === j(['"Hale, Chris" <chris@arch.com>', "d@y.org"]),
    "#214 participants: a comma inside a quoted display name does not split the list"
  );
  ok(j(ip214Split(" , ;")) === "[]" && j(ip214Split(undefined)) === "[]", "#214 participants: empty parts and a missing header give no addresses");
  const hale = ip214Mailbox('"Hale, Chris" <Chris.Hale@Arch.COM>');
  ok(hale.name === "Hale, Chris" && hale.email === "chris.hale@arch.com", "#214 participants: quoted name unquoted, address lowercased");
  ok(ip214Mailbox('"O\\"Brien, Pat" <pat@x.org>').name === 'O"Brien, Pat', "#214 participants: an escaped quote inside the display name survives");
  ok(ip214Mailbox("Nobody <>").email === "" && ip214Mailbox("not an address").email === "", "#214 participants: no real address → empty email");
  ok(ip214Mailbox("  AP@Lakefront.org ").email === "ap@lakefront.org", "#214 participants: a bare address parses");
  const own = ["jeff@peaksystemsgroup.com", "Sarah@PeakSystemsGroup.com"];
  const inbound = ip214Participants(
    {
      direction: "in",
      author: "Brenda Gauchel",
      fromEmail: "brenda@lakefront.k12.mn.us",
      to: 'Jeff Chesebro <jeff@peaksystemsgroup.com>, "Hale, Chris" <chris@arch.com>',
      cc: "AP Clerk <ap@lakefront.k12.mn.us>, BRENDA@lakefront.k12.mn.us, sarah@peaksystemsgroup.com",
    },
    own
  );
  ok(
    inbound.map((p) => `${p.role}:${p.email}:${p.name}`).join("|") ===
      "from:brenda@lakefront.k12.mn.us:Brenda Gauchel|to:chris@arch.com:Hale, Chris|cc:ap@lakefront.k12.mn.us:AP Clerk",
    "#214 participants: From → To → Cc, deduped by address (first role wins), our own addresses dropped case-insensitively"
  );
  const outbound = ip214Participants(
    { direction: "out", author: "Jeff Chesebro", fromEmail: "jeff@peaksystemsgroup.com", to: "a@x.org; b@x.org", cc: "" },
    own
  );
  ok(outbound.map((p) => p.role + ":" + p.email).join() === "to:a@x.org,to:b@x.org", "#214 participants: an outbound message lists its recipients, never us as From");
  const legacy = ip214Participants({ direction: "in", author: "Legacy" }, own, { name: "Brenda", email: "Brenda@L.org" });
  ok(legacy.length === 1 && legacy[0].email === "brenda@l.org" && legacy[0].role === "from" && legacy[0].name === "Brenda", "#214 participants: an inbound message with no stored From falls back to the thread counterpart");
  ok(ip214Participants({ direction: "in", author: "X" }, own, null).length === 0, "#214 participants: nothing stored and no counterpart → no participants");

  const gm = {
    id: "g1",
    threadId: "t1",
    labelIds: ["INBOX"],
    internalDate: "1000",
    payload: {
      mimeType: "text/plain",
      body: { data: Buffer.from("Body").toString("base64") },
      headers: [
        { name: "From", value: "Brenda <brenda@x.org>" },
        { name: "To", value: "jeff@peaksystemsgroup.com" },
        { name: "Cc", value: '"Hale, Chris" <chris@arch.com>' },
        { name: "Subject", value: "Hi" },
      ],
    },
  };
  ok(ip214ParseInbound(gm).cc === '"Hale, Chris" <chris@arch.com>', "#214 Cc: parseInbound reads the raw Cc header");
  ok(
    ip214ParseInbound({ ...gm, payload: { ...gm.payload, headers: gm.payload.headers.filter((h) => h.name !== "Cc") } }).cc === "",
    "#214 Cc: no Cc header → empty string"
  );
  ok(ip214Header([{ name: "CC", value: "a@b.org" }], "Cc") === "a@b.org", "#214 Cc: headerValue matches the header name case-insensitively");
  const bridge = read("src/lib/gmail/bridge.ts");
  ok(bridge.includes("cc: p.cc || undefined,"), "#214 Cc: the bridge stores Cc on each imported message");
  ok(/cc: "",\s*\n\s*subject: p\.subject,/.test(bridge), "#214 Cc: a new thread's own cc stays empty — replies copy thread.cc, so an inbound Cc must never land there");
  ok(
    /export async function fetchMessageCc\(threadId: string, messageId: string\)/.test(bridge) &&
      bridge.includes('getMessageMetadata(key, m.gmailId, ["Cc"])') &&
      bridge.includes("x.ccFetched = true;") &&
      bridge.includes("if (m.cc || m.ccFetched) return m.cc || \"\";"),
    "#214 Cc: fetchMessageCc reads only the Cc header, stamps ccFetched, and never refetches"
  );
  const api = read("src/lib/gmail/api.ts");
  ok(
    /export async function getMessageMetadata\(/.test(api) &&
      api.includes('new URLSearchParams({ format: "metadata" })') &&
      api.includes('qs.append("metadataHeaders", h)'),
    "#214 Cc: getMessageMetadata asks Gmail for headers only (format=metadata)"
  );
}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | grep -E "Cannot find module|#214|FAILED|ALL PASSED" | head`
Expected: the run aborts with `Cannot find module '@/lib/inbox-participants'` (the hoisted import fails before any check runs).

- [ ] **Step 3: Create `src/lib/inbox-participants.ts`**

````ts
/**
 * #214 — who is on one email: From / To / Cc parsed into participants.
 * Pure (no runtime imports) so test:specs covers it and the Link popup's
 * server loader can use it without pulling anything else in.
 */

export type ParticipantRole = "from" | "to" | "cc";

export type Participant = { name: string; email: string; role: ParticipantRole };

/** The slice of a CommMessage this reads (kept structural so the module
 *  needs no store import). */
export type ParticipantSource = {
  direction: "in" | "out";
  author?: string;
  fromEmail?: string;
  to?: string;
  cc?: string;
};

/** Split an address-list header on commas that sit outside double quotes
 *  and angle brackets: `"Hale, Chris" <c@x.org>, d@y.org` → two parts. */
export function splitAddressList(header: string | null | undefined): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let inAngle = false;
  const s = header || "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && inQuote && i + 1 < s.length) {
      cur += s[i + 1];
      i++;
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    if ((ch === "," || ch === ";") && !inQuote && !inAngle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** One mailbox → { name, email }. Quoted display names lose their quotes;
 *  "Last, First" stays as written. email is lowercased; "" when the part
 *  carries no real address. */
export function parseMailbox(part: string): { name: string; email: string } {
  const p = (part || "").trim();
  const angle = /<([^>]*)>\s*$/.exec(p);
  if (angle) {
    const email = angle[1].trim().toLowerCase();
    const name = p
      .slice(0, angle.index)
      .trim()
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/\\(.)/g, "$1")
      .trim();
    return { name, email: EMAIL_RE.test(email) ? email : "" };
  }
  const email = p.replace(/^"|"$/g, "").trim().toLowerCase();
  return { name: "", email: EMAIL_RE.test(email) ? email : "" };
}

function lc(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

/**
 * Everyone on `message`, in From → To → Cc order, deduped by email (first
 * role wins), minus our own addresses (`mailboxAddresses`: the connected
 * mailbox and every team member's emails). An inbound message with no
 * stored fromEmail (app-sent / pre-#125) falls back to `fallbackFrom`
 * (the thread counterpart); outbound From is always us, so it is skipped.
 */
export function participantsOf(
  message: ParticipantSource,
  mailboxAddresses: readonly string[],
  fallbackFrom?: { name: string; email: string } | null
): Participant[] {
  const own = new Set(mailboxAddresses.map(lc).filter(Boolean));
  const seen = new Set<string>();
  const out: Participant[] = [];
  const push = (name: string, email: string, role: ParticipantRole) => {
    const e = lc(email);
    if (!e || own.has(e) || seen.has(e)) return;
    seen.add(e);
    out.push({ name: (name || "").trim(), email: e, role });
  };
  if (message.direction === "in") {
    const from = lc(message.fromEmail);
    if (from) push(message.author || "", from, "from");
    else if (fallbackFrom?.email) push(fallbackFrom.name || message.author || "", fallbackFrom.email, "from");
  }
  for (const part of splitAddressList(message.to)) {
    const a = parseMailbox(part);
    push(a.name, a.email, "to");
  }
  for (const part of splitAddressList(message.cc)) {
    const a = parseMailbox(part);
    push(a.name, a.email, "cc");
  }
  return out;
}
````

- [ ] **Step 4: Add the two optional fields to `CommMessage`** in `src/lib/stores/comms.ts`.

In `src/lib/stores/comms.ts`, find:

````ts
  fromEmail?: string;
  to?: string;
};

export type CommDraft = {
````

replace with:

````ts
  fromEmail?: string;
  to?: string;
  /** #214 — the raw Cc header ("Name <a@b>, c@d"), stamped by the Gmail
   *  bridge on import, or by the Link popup's one-time lazy fetch for
   *  messages imported before #214. */
  cc?: string;
  /** #214 — set once that lazy Cc fetch has run (whether or not the
   *  message had a Cc), so it never runs twice. */
  ccFetched?: true;
};

export type CommDraft = {
````

- [ ] **Step 5: Read Cc in `src/lib/gmail/mime.ts`.**

In `src/lib/gmail/mime.ts`, find:

````ts
function header(headers: GmailHeader[] | undefined, name: string): string {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}
````

replace with:

````ts
function header(headers: GmailHeader[] | undefined, name: string): string {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

/** #214 — one header's value off a Gmail message ("" when absent); the
 *  bridge's lazy Cc fetch reads a metadata-format response with it. */
export const headerValue = header;
````

In `src/lib/gmail/mime.ts`, find:

````ts
  from: { name: string; email: string };
  to: string;
  subject: string;
````

replace with:

````ts
  from: { name: string; email: string };
  to: string;
  /** #214 — raw Cc header, "" when the message had none */
  cc: string;
  subject: string;
````

In `src/lib/gmail/mime.ts`, find:

````ts
    to: header(hs, "To"),
    subject:
````

replace with:

````ts
    to: header(hs, "To"),
    cc: header(hs, "Cc"),
    subject:
````

- [ ] **Step 6: Add `getMessageMetadata` to `src/lib/gmail/api.ts`.**

In `src/lib/gmail/api.ts`, find:

````ts
/** The mailbox profile — carries the current historyId (sync cursor baseline). */
````

replace with:

````ts
/** #214 — headers only (format=metadata): the Link popup's lazy Cc fetch
 *  for messages imported before Cc was stored. 5 quota units, no body. */
export async function getMessageMetadata(
  mailboxKey: string,
  id: string,
  headers: string[]
): Promise<GmailFullMessage> {
  const qs = new URLSearchParams({ format: "metadata" });
  for (const h of headers) qs.append("metadataHeaders", h);
  return gapi(mailboxKey, "/messages/" + encodeURIComponent(id) + "?" + qs.toString());
}

/** The mailbox profile — carries the current historyId (sync cursor baseline). */
````

- [ ] **Step 7: Store the message Cc and add the lazy backfill in `src/lib/gmail/bridge.ts`.**

In `src/lib/gmail/bridge.ts`, find:

````ts
import {
  getMessage,
  getProfile,
````

replace with:

````ts
import {
  getMessage,
  getMessageMetadata,
  getProfile,
````

In `src/lib/gmail/bridge.ts`, find:

````ts
import { buildRaw, parseAddress, parseInbound, type ParsedInbound } from "./mime";
````

replace with:

````ts
import { buildRaw, headerValue, parseAddress, parseInbound, type ParsedInbound } from "./mime";
````

In `src/lib/gmail/bridge.ts`, find:

````ts
    fromEmail: p.from.email || undefined,
    to: p.to || undefined,
  };
````

replace with:

````ts
    fromEmail: p.from.email || undefined,
    to: p.to || undefined,
    // #214 — who else was on it (the Link popup's participants). Message
    // only: the THREAD's cc below stays "" because deliverThreadOutbound
    // copies thread.cc onto every reply we send.
    cc: p.cc || undefined,
  };
````

In `src/lib/gmail/bridge.ts`, find:

````ts
/** Dedup set for the one-time history import:
````

replace with:

````ts
/**
 * #214 — the Link popup's lazy Cc backfill for a message imported before Cc
 * was stored: fetch that one message's Cc header (metadata format), stamp
 * `cc` + `ccFetched` so it never runs twice, and return the header ("" when
 * the message had no Cc). null = nothing to fetch (no such message, not a
 * Gmail message, or no connected mailbox for the thread). Already-fetched
 * messages return what is stored without calling Gmail.
 */
export async function fetchMessageCc(threadId: string, messageId: string): Promise<string | null> {
  const t = await getDoc<CommThread>("comms", threadId);
  const m = (t?.messages || []).find((x) => x.id === messageId);
  if (!t || !m?.gmailId) return null;
  if (m.cc || m.ccFetched) return m.cc || "";
  const key = t.gmailAccountKey ?? (await keyForThread(t));
  if (!key) return null;
  const meta = await getMessageMetadata(key, m.gmailId, ["Cc"]);
  const cc = headerValue(meta.payload?.headers, "Cc");
  await patchDoc<CommThread>("comms", threadId, (d) => {
    const x = (d.messages || []).find((y) => y.id === messageId);
    if (!x) return;
    if (cc) x.cc = cc;
    x.ccFetched = true;
  });
  return cc;
}

/** Dedup set for the one-time history import:
````

Leave the new-thread record's `cc: "",` (line 251) exactly as it is — see "Decisions" §1.

- [ ] **Step 8: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit
export PATH=$HOME/.local/node/bin:$PATH && LOG=$(mktemp) && npm run test:specs > "$LOG" 2>&1; grep -E "^FAIL|FAILED|ALL PASSED" "$LOG"; grep -c '^PASS' "$LOG"
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/inbox-participants.ts src/lib/stores/comms.ts src/lib/gmail/mime.ts src/lib/gmail/api.ts src/lib/gmail/bridge.ts
```
Expected: tsc prints nothing; test:specs prints `ALL PASSED` and no `FAIL` line, PASS count = B + 17; eslint exits 0 with no output.

- [ ] **Step 9: Commit**

```bash
git add src/lib/inbox-participants.ts src/lib/stores/comms.ts src/lib/gmail/mime.ts src/lib/gmail/api.ts src/lib/gmail/bridge.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(inbox): parse email participants and keep Cc on imported messages (#214)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Signature reader

**Files:**
- Create: `src/lib/inbox-signature-parse.ts` (distinct from the existing composer-signature module `src/lib/inbox-signature.ts` — do not touch that one)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `extractSignature(body: string, sender: { name?: string; email: string }): ParsedSignature | null`; `type ParsedSignature = { name?; title?; company?; phones: SigPhone[]; email?; website? }`; `type SigPhone = { label: "mobile" | "office" | "other"; number: string }` (numbers formatted `(218) 555-0100` / `… x204`); `stripQuotedHistory(body): string`; `missingContactFields(contact: { title: string | null | undefined; phones: readonly string[] }, sig: ParsedSignature | null): { title?: string; phones: SigPhone[] }`; `companyByExactName(name, companies: { id; name }[]): string | null`; `channelLabelFor(label): "mobile" | "work" | "other"`.

Rules implemented (spec §"Signature reader"): cut history at `On … wrote:` (spanning ≤ 3 lines), `-----Original Message-----` / `Forwarded message`, an Outlook `_____` rule, or a `From:` line followed within 4 lines by `Sent:`/`Date:`; drop `>` lines and device footers ("Sent from my iPhone", "Get Outlook for iOS"); the block is the ≤ 12 lines after the LAST sign-off (`--`, Thanks, Thank you, Best, Regards, Sincerely, Cheers, …); with no sign-off it starts at the line naming the sender (display-name tokens), and with neither only contact details are read. Name = first of the block's first 3 lines matching the sender's name tokens (credentials after a comma dropped; a lone first name expands to the sender's full display name), else a 2–4-word capitalized line. The next non-contact line is: `Title | Company` (split); the company when it matches the email domain root; the title when it has a title keyword; the title when it is short, digit-free, not company-worded and more lines follow. Company = a later line matching the domain root, else the next short digit-free line. Phones: NANP with optional `+1` and `x`/`ext`, labelled mobile by a preceding `m/c/cell/mobile/mob`, office by `o/d/t/p/w/office/direct/tel/ph/phone/work/main`, else other. `null` when nothing beyond an email is found.

- [ ] **Step 1: Write the failing test.** Append to the end of `scripts/test-review-and-spec.ts`:

````ts
/* ====== #214 Inbox Link popup — signature reader (Task 2) ======
   Deterministic (D89): realistic bodies in, name/title/company/phones out;
   what a known contact lacks; the exact-name company match; label mapping. */
import {
  extractSignature as sig214Extract,
  missingContactFields as sig214Missing,
  companyByExactName as sig214Company,
  stripQuotedHistory as sig214Strip,
  channelLabelFor as sig214Label,
} from "@/lib/inbox-signature-parse";
{
  const j = (x: unknown) => JSON.stringify(x);

  // 1 — a reply with quoted history (CRLF), mobile + office phones, website.
  const reply = [
    "Hi Jeff,", "", "Yes — Tuesday at 10 works for the walkthrough.", "", "Thanks,", "Brenda Gauchel",
    "Technical Director", "Lakefront Public Schools", "m: 218-555-0142", "o: (218) 555-0100 x204",
    "www.lakefront.k12.mn.us", "",
    "On Mon, Sep 21, 2026 at 3:02 PM Jeff Chesebro <jeff@peaksystemsgroup.com> wrote:",
    "> Hi Brenda,", "> Does Tuesday work?", ">", "> Jeff Chesebro", "> Peak Systems Group", "> (612) 555-0199",
  ].join("\r\n");
  const s1 = sig214Extract(reply, { name: "Brenda Gauchel", email: "brenda@lakefront.k12.mn.us" });
  ok(s1?.name === "Brenda Gauchel" && s1.title === "Technical Director" && s1.company === "Lakefront Public Schools", "#214 signature: reply — name, title, company after the sign-off");
  ok(
    j(s1?.phones) === j([{ label: "mobile", number: "(218) 555-0142" }, { label: "office", number: "(218) 555-0100 x204" }]),
    "#214 signature: reply — m:/o: labels, extension kept, the quoted (612) number ignored"
  );
  ok(s1?.website === "www.lakefront.k12.mn.us" && s1.email === undefined, "#214 signature: reply — website read, no email in the block");

  // 2 — "Sent from my iPhone" and nothing else → null.
  ok(
    sig214Extract("Sounds good — see you Tuesday.\n\nSent from my iPhone", { name: "Brenda Gauchel", email: "brenda@lakefront.k12.mn.us" }) === null,
    "#214 signature: a phone footer alone is no signature"
  );
  // 3 — no signature at all → null.
  ok(
    sig214Extract("Can you send the revised quote by Friday? The board meets Monday.", { name: "Pat Kim", email: "pkim@x.org" }) === null,
    "#214 signature: a body with no signature → null"
  );

  // 4 — "-- " delimiter, credentials, Direct | Cell on one line, Outlook history cut.
  const outlook = [
    "Chris,", "", "Attached is the rigging plot.", "", "-- ", "Chris Hale, AIA", "Principal", "Hale Arch Studio",
    "Direct 612.555.0123 | Cell 612.555.0456", "chris.hale@halearchstudio.com", "", "-----Original Message-----",
    "From: Jeff Chesebro <jeff@peaksystemsgroup.com>", "Sent: Monday, September 21, 2026 3:02 PM", "To: Chris Hale",
    "Subject: Plot", "", "Jeff Chesebro | 612-555-0199",
  ].join("\n");
  const s4 = sig214Extract(outlook, { name: "Chris Hale", email: "chris.hale@halearchstudio.com" });
  ok(s4?.name === "Chris Hale" && s4.title === "Principal" && s4.company === "Hale Arch Studio", "#214 signature: '-- ' delimiter — credentials dropped from the name, company matched to the email domain");
  ok(
    j(s4?.phones) === j([{ label: "office", number: "(612) 555-0123" }, { label: "mobile", number: "(612) 555-0456" }]),
    "#214 signature: Direct → office, Cell → mobile, two numbers on one line; the Original Message history is cut"
  );
  ok(s4?.email === "chris.hale@halearchstudio.com" && s4.website === undefined, "#214 signature: an email address is not mistaken for a website");

  // 5 — no sign-off: the block starts at the sender's name; "Title | Company".
  const s5 = sig214Extract(
    "Please call me when you get a chance.\n\nDana Whitfield\nTheatre Manager | Orpheum Theatre\nT 952-555-0177",
    { name: "Dana Whitfield", email: "dwhitfield@orpheum.org" }
  );
  ok(
    s5?.name === "Dana Whitfield" && s5.title === "Theatre Manager" && s5.company === "Orpheum Theatre" &&
      j(s5.phones) === j([{ label: "office", number: "(952) 555-0177" }]),
    "#214 signature: no sign-off — found by the sender's name; 'Title | Company' split; T → office"
  );

  // 6 — webmail sender with no display name: capitalized name line, title keyword.
  const s6 = sig214Extract(
    "Got it, thank you.\n\nThank you!\nSam Ortiz\nProduction Coordinator\nNorthfield Arts Guild\ncell: 507.555.0190",
    { name: "", email: "samortiz88@gmail.com" }
  );
  ok(
    s6?.name === "Sam Ortiz" && s6.title === "Production Coordinator" && s6.company === "Northfield Arts Guild" &&
      j(s6.phones) === j([{ label: "mobile", number: "(507) 555-0190" }]),
    "#214 signature: webmail sender — the capitalized line is the name, 'Coordinator' marks the title"
  );

  // 7 — only an email under the sign-off → null.
  ok(
    sig214Extract("See attached.\n\nThanks,\nbrenda@lakefront.k12.mn.us", { name: "Brenda", email: "brenda@lakefront.k12.mn.us" }) === null,
    "#214 signature: nothing beyond an email → null"
  );

  // 8 — company right under the name (no title), unlabelled phone → other.
  const s8 = sig214Extract("Here you go.\n\nBest regards,\nPat Kim\nLakefront Public Schools\n(218) 555-0111", {
    name: "Pat Kim",
    email: "pkim@lakefront.k12.mn.us",
  });
  ok(
    s8?.name === "Pat Kim" && s8.title === undefined && s8.company === "Lakefront Public Schools" &&
      j(s8.phones) === j([{ label: "other", number: "(218) 555-0111" }]),
    "#214 signature: a line matching the email domain is the company, not a title; an unlabelled phone is 'other'"
  );

  // 9 — first name only expands to the sender's full display name.
  const s9 = sig214Extract("Works for me.\n\nThanks,\nBrenda\nTechnical Director", { name: "Brenda Gauchel", email: "brenda@lakefront.k12.mn.us" });
  ok(s9?.name === "Brenda Gauchel" && s9.title === "Technical Director", "#214 signature: a signed first name takes the sender's full name");
  ok(sig214Strip("a\r\n> b\r\nc") === "a\nc", "#214 signature: quoted '>' lines are dropped, CRLF normalised");

  // What a known contact lacks — never an overwrite.
  const miss = sig214Missing({ title: "", phones: ["218-555-0142"] }, s1);
  ok(
    miss.title === "Technical Director" && j(miss.phones) === j([{ label: "office", number: "(218) 555-0100 x204" }]),
    "#214 signature: missing = a blank title + phones whose digits aren't on file"
  );
  ok(
    j(sig214Missing({ title: "TD", phones: ["(218) 555-0142", "2185550100 ext 9"] }, s1)) === j({ phones: [] }),
    "#214 signature: a title already set and phones already on file (any format) propose nothing"
  );
  ok(j(sig214Missing({ title: "", phones: [] }, null)) === j({ phones: [] }), "#214 signature: no signature → nothing missing");

  ok(
    sig214Company("Lakefront Public Schools", [{ id: "lakefront", name: "Lakefront Public Schools" }, { id: "x", name: "Lakefront" }]) === "lakefront",
    "#214 signature: the signature company matches one company by exact name"
  );
  ok(sig214Company("Lakefront", [{ id: "a", name: "Lakefront" }, { id: "b", name: "LAKEFRONT." }]) === null, "#214 signature: two companies with that name → no pick");
  ok(sig214Company("", [{ id: "a", name: "" }]) === null, "#214 signature: a blank company never matches");
  ok(sig214Label("office") === "work" && sig214Label("mobile") === "mobile" && sig214Label("other") === "other", "#214 signature: office → the identity core's 'work' label");
}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | grep -E "Cannot find module|FAILED|ALL PASSED" | head`
Expected: the run aborts with `Cannot find module '@/lib/inbox-signature-parse'`.

- [ ] **Step 3: Create `src/lib/inbox-signature-parse.ts`**

````ts
/**
 * #214 — read the sender's signature out of one email body. Deterministic
 * rules only (D89 — no AI): cut the quoted history, find the sign-off,
 * then pick name / title / company / phones / email / website off the
 * lines that follow. Pure (no imports) so test:specs covers it and the
 * Link popup's server loader can call it.
 */

export type SigPhoneLabel = "mobile" | "office" | "other";
export type SigPhone = { label: SigPhoneLabel; number: string };

export type ParsedSignature = {
  name?: string;
  title?: string;
  company?: string;
  phones: SigPhone[];
  email?: string;
  website?: string;
};

export type SignatureSender = { name?: string; email: string };

const MAX_BLOCK_LINES = 12;

const SIGN_OFF_RE =
  /^(--|—|thanks( so much| again)?|thank you( so much)?|many thanks|best( regards| wishes)?|all the best|regards|kind regards|warm regards|warmly|sincerely|cheers|respectfully|take care)[\s,.!]*$/i;

const DEVICE_LINE_RE =
  /^(sent from my \S.*|sent from (mail|outlook|yahoo mail|gmail)\b.*|get outlook for \S.*|sent via \S.*)$/i;

const TITLE_WORDS = [
  "director", "manager", "coordinator", "engineer", "designer", "owner", "president", "vp",
  "vice president", "chair", "chairman", "chairperson", "teacher", "principal", "supervisor",
  "technician", "producer", "head", "lead", "officer", "administrator", "specialist",
  "assistant", "associate", "superintendent", "consultant", "architect", "founder", "partner",
  "ceo", "cfo", "coo", "cto", "executive", "instructor", "professor", "dean", "chief",
  "treasurer", "secretary", "representative", "estimator", "buyer", "planner", "foreman",
];

const COMPANY_WORDS = [
  "school", "schools", "district", "theatre", "theater", "theatres", "theaters", "church",
  "university", "college", "inc", "llc", "ltd", "company", "co", "corp", "corporation",
  "center", "centre", "group", "associates", "architects", "productions", "guild", "arts",
  "studio", "studios", "foundation", "academy", "ministries", "auditorium", "hall",
  "systems", "services", "solutions", "partners",
];

const PUBLIC_ROOTS = new Set([
  "gmail", "googlemail", "yahoo", "outlook", "hotmail", "icloud", "aol", "live", "msn",
  "comcast", "me", "mac", "protonmail", "proton", "ymail", "att", "sbcglobal", "verizon",
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE =
  /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|us|gov|io|co|biz|info|church|theater|theatre|arts)(?:\/[^\s|,]*)?/i;
const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?:\s*(?:x|ext\.?|extension)\s*(\d{1,6}))?/gi;
const MOBILE_TOKEN_RE = /(?:^|[^a-z])(m|c|cell|mobile|mob)\.?\s*[:.]?\s*$/i;
const OFFICE_TOKEN_RE =
  /(?:^|[^a-z])(o|d|t|p|w|office|direct|tel|ph|phone|work|main)\.?\s*[:.]?\s*$/i;
const ADDRESS_RE = /^\d+\s+[A-Za-z]|,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\b|\b(p\.?o\.?\s*box)\b/i;

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
}

function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasWord(line: string, list: readonly string[]): boolean {
  const lw = " " + words(line).join(" ") + " ";
  return list.some((w) => lw.includes(" " + w + " "));
}

/** Cut replies/forwards off the bottom, drop `>` quoting and device
 *  footers ("Sent from my iPhone"). Normalises CRLF. */
export function stripQuotedHistory(body: string): string {
  const lines = (body || "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(t)) break;
    if (/^_{5,}$/.test(t)) break;
    if (/^on\s.+/i.test(t) && lines.slice(i, i + 3).join(" ").includes("wrote:")) break;
    if (/^from:\s*\S/i.test(t) && lines.slice(i + 1, i + 5).some((l) => /^(sent|date):\s*\S/i.test(l.trim()))) break;
    if (t.startsWith(">")) continue;
    if (DEVICE_LINE_RE.test(t)) continue;
    out.push(lines[i]);
  }
  return out.join("\n");
}

function formatPhone(m: RegExpExecArray): string {
  const base = `(${m[1]}) ${m[2]}-${m[3]}`;
  return m[4] ? `${base} x${m[4]}` : base;
}

function phonesIn(line: string): SigPhone[] {
  const out: SigPhone[] = [];
  const re = new RegExp(PHONE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const before = line.slice(Math.max(0, m.index - 14), m.index);
    const after = line.slice(m.index + m[0].length, m.index + m[0].length + 10);
    let label: SigPhoneLabel = "other";
    if (MOBILE_TOKEN_RE.test(before) || /^\s*\(?(cell|mobile|m)\)?(\W|$)/i.test(after)) label = "mobile";
    else if (OFFICE_TOKEN_RE.test(before) || /^\s*\(?(office|work|direct|o)\)?(\W|$)/i.test(after)) label = "office";
    out.push({ label, number: formatPhone(m) });
  }
  return out;
}

function isContactLine(line: string): boolean {
  return new RegExp(PHONE_RE.source, "i").test(line) || EMAIL_RE.test(line) || URL_RE.test(line) || ADDRESS_RE.test(line);
}

function isNameShaped(line: string): boolean {
  if (/[0-9@]/.test(line) || /[?!:;.]$/.test(line)) return false;
  const n = line.split(/\s+/).filter(Boolean).length;
  return n >= 1 && n <= 5;
}

/** "Chris Hale, AIA" → "Chris Hale" (credentials after a comma go). */
function cleanName(line: string): string {
  const comma = line.indexOf(",");
  if (comma > 0 && line.slice(0, comma).trim().split(/\s+/).length >= 2) return line.slice(0, comma).trim();
  return line.trim();
}

function domainRoot(email: string): string {
  const host = (email.split("@")[1] || "").toLowerCase().replace(/^www\./, "");
  const root = host.split(".")[0] || "";
  return PUBLIC_ROOTS.has(root) ? "" : alnum(root);
}

function matchesDomain(line: string, root: string): boolean {
  if (root.length < 4) return false;
  const a = alnum(line);
  return a.length >= 4 && (a.includes(root) || root.includes(a));
}

export function extractSignature(
  body: string,
  sender: SignatureSender
): ParsedSignature | null {
  const lines = stripQuotedHistory(body)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const senderTokens = words(sender.name || "").filter((w) => w.length >= 2);
  const root = domainRoot(sender.email || "");

  // The block: after the last sign-off that still has lines under it; with
  // no sign-off, from the last-12 line that names the sender; with neither,
  // the last 12 lines, read for contact details only (no name/title/company).
  let signOff = -1;
  for (let i = lines.length - 2; i >= 0; i--) {
    if (SIGN_OFF_RE.test(lines[i])) {
      signOff = i;
      break;
    }
  }
  let block: string[];
  let trusted: boolean;
  if (signOff >= 0) {
    block = lines.slice(signOff + 1, signOff + 1 + MAX_BLOCK_LINES);
    trusted = true;
  } else {
    const tail = lines.slice(-MAX_BLOCK_LINES);
    const at = tail.findIndex(
      (l) => isNameShaped(cleanName(l)) && !isContactLine(l) && senderTokens.some((t) => words(l).includes(t))
    );
    block = at >= 0 ? tail.slice(at) : tail;
    trusted = at >= 0;
  }

  const phones: SigPhone[] = [];
  let email: string | undefined;
  let website: string | undefined;
  for (const l of block) {
    for (const p of phonesIn(l)) if (!phones.some((x) => x.number === p.number)) phones.push(p);
    const em = EMAIL_RE.exec(l);
    if (em && !email) email = em[0].toLowerCase();
    const withoutEmail = em ? l.replace(em[0], " ") : l;
    const url = URL_RE.exec(withoutEmail);
    if (url && !website) website = url[0];
  }

  let name: string | undefined;
  let title: string | undefined;
  let company: string | undefined;

  if (trusted) {
    const head = block.slice(0, 3);
    let nameIdx = head.findIndex(
      (l) => isNameShaped(cleanName(l)) && !isContactLine(l) && senderTokens.some((t) => words(l).includes(t))
    );
    if (nameIdx < 0) {
      nameIdx = head.findIndex(
        (l) =>
          !isContactLine(l) &&
          !hasWord(l, TITLE_WORDS) &&
          /^[A-Z][A-Za-z'’.-]*(\s+[A-Z][A-Za-z'’.-]*){1,3}$/.test(cleanName(l))
      );
    }
    if (nameIdx >= 0) {
      const raw = cleanName(block[nameIdx]);
      const rawWords = words(raw);
      name =
        senderTokens.length > rawWords.length && rawWords.every((w) => senderTokens.includes(w))
          ? (sender.name || "").trim()
          : raw;

      const rest = block.slice(nameIdx + 1).filter((l) => !isContactLine(l));
      const next = rest[0];
      let afterTitle = 0;
      if (next) {
        const parts = next.split(/\s+\|\s+/).map((s) => s.trim()).filter(Boolean);
        if (parts.length > 1 && parts.some((p) => hasWord(p, TITLE_WORDS))) {
          title = parts.find((p) => hasWord(p, TITLE_WORDS));
          company = parts.find((p) => p !== title);
          afterTitle = 1;
        } else if (matchesDomain(next, root)) {
          // the company line sits right under the name — no title
        } else if (hasWord(next, TITLE_WORDS)) {
          title = next;
          afterTitle = 1;
        } else if (
          !hasWord(next, COMPANY_WORDS) &&
          next.split(/\s+/).length <= 6 &&
          !/\d/.test(next) &&
          rest.length > 1
        ) {
          title = next;
          afterTitle = 1;
        }
      }
      if (!company) {
        const candidates = rest.slice(afterTitle);
        company =
          candidates.find((l) => matchesDomain(l, root)) ||
          candidates.find((l) => l.split(/\s+/).length <= 8 && !/\d/.test(l));
      }
    }
  }

  if (!name && !title && !company && !phones.length && !website) return null;
  const out: ParsedSignature = { phones };
  if (name) out.name = name;
  if (title) out.title = title;
  if (company) out.company = company;
  if (email) out.email = email;
  if (website) out.website = website;
  return out;
}

/** What a KNOWN contact lacks that the signature carries — the "Add
 *  missing details" list. Title only when the contact has none; a phone
 *  only when its last 10 digits aren't already on file. Never proposes
 *  overwriting anything. */
export function missingContactFields(
  contact: { title: string | null | undefined; phones: readonly string[] },
  sig: ParsedSignature | null
): { title?: string; phones: SigPhone[] } {
  const out: { title?: string; phones: SigPhone[] } = { phones: [] };
  if (!sig) return out;
  if (sig.title && !(contact.title || "").trim()) out.title = sig.title;
  const have = new Set(
    contact.phones.map((p) => p.replace(/\s*(x|ext\.?)\s*\d+$/i, "").replace(/\D/g, "").slice(-10)).filter(Boolean)
  );
  for (const p of sig.phones) {
    const key = p.number.replace(/\s*x\d+$/, "").replace(/\D/g, "").slice(-10);
    if (!have.has(key)) {
      have.add(key);
      out.phones.push(p);
    }
  }
  return out;
}

/** The one company a signature's company line names, by exact
 *  (case/punctuation-insensitive) name — null when none or several. */
export function companyByExactName(
  name: string | null | undefined,
  companies: ReadonlyArray<{ id: string; name: string }>
): string | null {
  const key = alnum(name || "");
  if (!key) return null;
  const hits = companies.filter((c) => alnum(c.name) === key);
  return hits.length === 1 ? hits[0].id : null;
}

/** A signature phone label → the identity core's channel label
 *  (identity/config CHANNEL_LABELS: work | mobile | home | other). */
export function channelLabelFor(label: SigPhoneLabel): "mobile" | "work" | "other" {
  return label === "office" ? "work" : label;
}
````

- [ ] **Step 4: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit
export PATH=$HOME/.local/node/bin:$PATH && LOG=$(mktemp) && npm run test:specs > "$LOG" 2>&1; grep -E "^FAIL|FAILED|ALL PASSED" "$LOG"; grep -c '^PASS' "$LOG"
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/inbox-signature-parse.ts
```
Expected: tsc silent; `ALL PASSED`, no `FAIL`, PASS = B + 38; eslint exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox-signature-parse.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(inbox): deterministic signature reader for the Link popup (#214)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Linked-people rules, link-search ranking, store field

**Files:**
- Create: `src/lib/inbox-thread-contacts.ts`, `src/lib/inbox-link-targets.ts`
- Modify: `src/lib/stores/comms.ts:292` (`CommThread.resolvedContactId` → add `linkedContactIds`)
- Modify: `src/lib/identity/lookup.ts` (append after line 85)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `typeaheadMatches(q, items, filter, rank, max)` from `src/lib/search/typeahead-rank.ts:8`.
- Produces: `MAX_LINKED_CONTACTS = 25`; `linkedContactIdsOf(t: { linkedContactIds?; resolvedContactId? }): string[]` (primary first); `applyContactLink(t, contactId: string, on: boolean): { ok: true; linkedContactIds: string[]; resolvedContactId: string | null } | { ok: false; error: string }`.
- Produces: `type LinkTargetKind = "company" | "venue" | "person"`; `type LinkTargetHit = { kind; id; label; sub; companyId: string | null; companyName: string }` (venue `id` = the CustomerLocation id that `thread.siteId` stores); `type LinkTargetGroups = { companies; venues; people }`; `rankLinkTargets(q, { companies, sites, people }, only?: LinkTargetKind): LinkTargetGroups`; `emptyLinkTargets()`; `nameRank(q, name)`; `LINK_TARGET_MAX = 8`; `LINK_TARGET_MIN_QUERY = 2`.
- Produces: `CommThread.linkedContactIds?: string[]`; `emailsMatching(fragment: string, limit = 200): Promise<Map<string, string[]>>` (lookup.ts).

- [ ] **Step 1: Write the failing test.** Append to the end of `scripts/test-review-and-spec.ts`:

````ts
/* ====== #214 Inbox Link popup — linked people + link search (Task 3) ======
   The thread's linked-people rules (add / remove / primary promotion / cap)
   and the three-group search ranking, both pure. */
import {
  applyContactLink as tc214Apply,
  linkedContactIdsOf as tc214Ids,
  MAX_LINKED_CONTACTS as tc214Max,
} from "@/lib/inbox-thread-contacts";
import { rankLinkTargets as lt214Rank, nameRank as lt214NameRank } from "@/lib/inbox-link-targets";
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const j = (x: unknown) => JSON.stringify(x);
  ok(j(tc214Ids({})) === "[]", "#214 linked people: none");
  ok(j(tc214Ids({ resolvedContactId: "ct-a" })) === j(["ct-a"]), "#214 linked people: a pre-#214 thread reads as its primary");
  ok(j(tc214Ids({ resolvedContactId: "ct-b", linkedContactIds: ["ct-a", "ct-b", "", "ct-a"] })) === j(["ct-b", "ct-a"]), "#214 linked people: primary first, deduped, blanks dropped");
  const a1 = tc214Apply({}, "ct-a", true);
  ok(a1.ok && j(a1.linkedContactIds) === j(["ct-a"]) && a1.resolvedContactId === "ct-a", "#214 linked people: the first person linked becomes primary");
  const a2 = tc214Apply({ linkedContactIds: ["ct-a"], resolvedContactId: "ct-a" }, "ct-b", true);
  ok(a2.ok && j(a2.linkedContactIds) === j(["ct-a", "ct-b"]) && a2.resolvedContactId === "ct-a", "#214 linked people: a second person keeps the primary");
  const a3 = tc214Apply({ linkedContactIds: ["ct-a", "ct-b"], resolvedContactId: "ct-a" }, "ct-a", true);
  ok(a3.ok && j(a3.linkedContactIds) === j(["ct-a", "ct-b"]), "#214 linked people: linking twice is a no-op");
  const r1 = tc214Apply({ linkedContactIds: ["ct-a", "ct-b", "ct-c"], resolvedContactId: "ct-a" }, "ct-a", false);
  ok(r1.ok && j(r1.linkedContactIds) === j(["ct-b", "ct-c"]) && r1.resolvedContactId === "ct-b", "#214 linked people: unlinking the primary promotes the next one");
  const r2 = tc214Apply({ linkedContactIds: ["ct-a", "ct-b"], resolvedContactId: "ct-a" }, "ct-b", false);
  ok(r2.ok && j(r2.linkedContactIds) === j(["ct-a"]) && r2.resolvedContactId === "ct-a", "#214 linked people: unlinking someone else leaves the primary");
  const r3 = tc214Apply({ linkedContactIds: ["ct-a"], resolvedContactId: "ct-a" }, "ct-a", false);
  ok(r3.ok && j(r3.linkedContactIds) === "[]" && r3.resolvedContactId === null, "#214 linked people: unlinking the last person clears the primary");
  const legacy = tc214Apply({ resolvedContactId: "ct-p" }, "ct-q", true);
  ok(legacy.ok && j(legacy.linkedContactIds) === j(["ct-p", "ct-q"]) && legacy.resolvedContactId === "ct-p", "#214 linked people: an old primary is carried into the list");
  const full = Array.from({ length: tc214Max }, (_, i) => "ct-" + i);
  const capped = tc214Apply({ linkedContactIds: full, resolvedContactId: "ct-0" }, "ct-new", true);
  ok(tc214Max === 25 && !capped.ok && capped.error.includes("25"), "#214 linked people: a 26th person is refused");
  ok(tc214Apply({ linkedContactIds: full, resolvedContactId: "ct-0" }, "ct-3", true).ok, "#214 linked people: re-linking someone already in a full list is fine");
  ok(!tc214Apply({}, "  ", true).ok, "#214 linked people: a blank id is refused");

  const data = {
    companies: [
      { id: "lakefront", name: "Lakefront Public Schools", city: "Duluth", state: "MN" },
      { id: "orpheum", name: "Orpheum Theatre", city: "Minneapolis", state: "MN" },
      { id: "north", name: "North Lakefront Church", city: "Two Harbors", state: "MN" },
    ],
    sites: [
      { id: "loc1", companyId: "lakefront", name: "Lakefront High School Auditorium", address: "100 Main St", city: "Duluth", state: "MN" },
      { id: "st-orpheum-1", companyId: "orpheum", name: "Main Stage", city: "Minneapolis", state: "MN" },
      { id: "st-gone-1", companyId: "deleted-co", name: "Lakefront Annex" },
    ],
    people: [
      { id: "ct-1", name: "Brenda Gauchel", title: "Technical Director", companyId: "lakefront", emails: ["brenda@lakefront.k12.mn.us"] },
      { id: "ct-2", name: "Dana Whitfield", title: "", companyId: "orpheum", emails: ["dwhitfield@orpheum.org"] },
    ],
  };
  const g1 = lt214Rank("lakefront", data);
  ok(g1.companies.map((c) => c.id).join() === "lakefront,north", "#214 link search: a name that starts with the query ranks first");
  ok(
    g1.venues.map((v) => v.id).join() === "loc1" && g1.venues[0].companyId === "lakefront" && g1.venues[0].companyName === "Lakefront Public Schools" && g1.venues[0].sub.includes("100 Main St"),
    "#214 link search: a venue carries its company; a venue whose company is gone is dropped"
  );
  ok(
    g1.people.map((p) => p.id).join() === "ct-1" && g1.people[0].sub === "Technical Director · Lakefront Public Schools" && g1.people[0].companyId === "lakefront",
    "#214 link search: a person matches by email and shows title · home company"
  );
  ok(lt214Rank("main", data).venues.map((v) => v.id).join() === "st-orpheum-1,loc1", "#214 link search: a venue named for the query beats one that only has it in the address");
  const g3 = lt214Rank("dana orph", data);
  ok(g3.people.length === 1 && g3.people[0].id === "ct-2" && g3.companies.length === 0, "#214 link search: every word must match");
  ok(j(lt214Rank("l", data)) === j({ companies: [], venues: [], people: [] }), "#214 link search: under 2 letters searches nothing");
  const g4 = lt214Rank("lakefront", data, "company");
  ok(g4.companies.length === 2 && g4.venues.length === 0 && g4.people.length === 0, "#214 link search: `only` narrows to one group");
  const many = { companies: Array.from({ length: 12 }, (_, i) => ({ id: "c" + i, name: "Acme " + i })), sites: [], people: [] };
  ok(lt214Rank("acme", many).companies.length === 8, "#214 link search: at most 8 per group");
  ok(lt214NameRank("orph", "Orpheum Theatre") === 0 && lt214NameRank("thea", "Orpheum Theatre") === 1 && lt214NameRank("heat", "Orpheum Theatre") === 2, "#214 link search: starts-with < word-start < anywhere");

  const comms214 = read("src/lib/stores/comms.ts");
  ok(/linkedContactIds\?: string\[\];/.test(comms214) && /ccFetched\?: true;/.test(comms214) && /\n  cc\?: string;\n  \/\*\* #214 — set once/.test(comms214), "#214 store: CommThread.linkedContactIds and CommMessage.cc / ccFetched are optional (old docs read unchanged)");
  const lookup214 = read("src/lib/identity/lookup.ts");
  const em214 = lookup214.slice(lookup214.indexOf("export async function emailsMatching"));
  ok(em214.includes("eq(contacts.deleted, false)") && em214.includes(".limit(limit)") && em214.includes("if (f.length < 2) return out;"), "#214 link search: emailsMatching skips deleted contacts, is capped, and ignores 1-letter fragments");
}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | grep -E "Cannot find module|FAILED|ALL PASSED" | head`
Expected: aborts with `Cannot find module '@/lib/inbox-thread-contacts'`.

- [ ] **Step 3: Create `src/lib/inbox-thread-contacts.ts`**

````ts
/**
 * #214 — the people linked to one thread. `linkedContactIds` holds every
 * linked person; `resolvedContactId` stays the primary. Pure so test:specs
 * covers the add / remove / primary-promotion rules the store write and
 * the sidebar both read.
 */

export const MAX_LINKED_CONTACTS = 25;

export type ThreadContactState = {
  linkedContactIds?: string[] | null;
  resolvedContactId?: string | null;
};

/** Every linked person, primary first, deduped. A thread from before #214
 *  that only has a primary reads as that one person. */
export function linkedContactIdsOf(t: ThreadContactState): string[] {
  const out: string[] = [];
  for (const id of [t.resolvedContactId, ...(t.linkedContactIds || [])]) {
    const v = (id || "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export type ContactLinkResult =
  | { ok: true; linkedContactIds: string[]; resolvedContactId: string | null }
  | { ok: false; error: string };

/** Link (`on`) or unlink one person. Linking when there is no primary makes
 *  them primary; unlinking the primary promotes the next linked person, or
 *  clears it. Linking past MAX_LINKED_CONTACTS is refused. Idempotent. */
export function applyContactLink(
  t: ThreadContactState,
  contactId: string,
  on: boolean
): ContactLinkResult {
  const id = (contactId || "").trim();
  if (!id) return { ok: false, error: "No person picked." };
  const ids = linkedContactIdsOf(t);
  let primary = (t.resolvedContactId || "").trim() || null;
  if (on) {
    if (!ids.includes(id)) {
      if (ids.length >= MAX_LINKED_CONTACTS)
        return { ok: false, error: `A thread links at most ${MAX_LINKED_CONTACTS} people.` };
      ids.push(id);
    }
    if (!primary) primary = id;
  } else {
    const at = ids.indexOf(id);
    if (at >= 0) ids.splice(at, 1);
    if (primary === id) primary = ids[0] ?? null;
  }
  return { ok: true, linkedContactIds: ids, resolvedContactId: primary };
}
````

- [ ] **Step 4: Create `src/lib/inbox-link-targets.ts`**

````ts
/**
 * #214 — the Link popup's one search box: companies, venues and people in
 * three groups of at most 8, ranked the way every other typeahead ranks
 * (typeaheadMatches). Pure — the server action loads the rows and calls
 * rankLinkTargets; test:specs covers the ranking.
 */
import { typeaheadMatches } from "@/lib/search/typeahead-rank";

export type LinkTargetKind = "company" | "venue" | "person";

export type LinkTargetHit = {
  kind: LinkTargetKind;
  /** company id · venue CustomerLocation id (what thread.siteId stores) · contact id */
  id: string;
  label: string;
  sub: string;
  /** the company a venue belongs to / a person's home company */
  companyId: string | null;
  companyName: string;
};

export type LinkTargetGroups = {
  companies: LinkTargetHit[];
  venues: LinkTargetHit[];
  people: LinkTargetHit[];
};

export const LINK_TARGET_MAX = 8;
export const LINK_TARGET_MIN_QUERY = 2;

export type CompanyCandidate = { id: string; name: string; city?: string | null; state?: string | null };
export type SiteCandidate = {
  /** the CustomerLocation id (docLocId) */
  id: string;
  companyId: string;
  name?: string | null;
  locationName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
};
export type PersonCandidate = {
  id: string;
  name: string;
  title?: string | null;
  companyId: string | null;
  emails: readonly string[];
};

function tokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

function allIn(q: string, hay: string): boolean {
  const h = hay.toLowerCase();
  return tokens(q).every((t) => h.includes(t));
}

/** 0 = the name starts with the query, 1 = a word in it does, 2 = elsewhere. */
export function nameRank(q: string, name: string): number {
  const s = q.trim().toLowerCase();
  const n = (name || "").toLowerCase();
  if (!s) return 2;
  if (n.startsWith(s)) return 0;
  if (n.includes(" " + s)) return 1;
  return 2;
}

function place(city?: string | null, state?: string | null): string {
  return [city, state].filter(Boolean).join(", ");
}

function siteLabel(s: SiteCandidate): string {
  return (s.name || "").trim() || (s.locationName || "").trim() || "Venue";
}

export function emptyLinkTargets(): LinkTargetGroups {
  return { companies: [], venues: [], people: [] };
}

export function rankLinkTargets(
  q: string,
  data: {
    companies: readonly CompanyCandidate[];
    sites: readonly SiteCandidate[];
    people: readonly PersonCandidate[];
  },
  only?: LinkTargetKind
): LinkTargetGroups {
  const query = (q || "").trim();
  if (query.length < LINK_TARGET_MIN_QUERY) return emptyLinkTargets();
  const nameOf = new Map(data.companies.map((c) => [c.id, c.name]));
  const out = emptyLinkTargets();

  if (!only || only === "company") {
    out.companies = typeaheadMatches(
      query,
      data.companies,
      (qq, c) => allIn(qq, `${c.name} ${c.city || ""}`),
      (qq, c) => nameRank(qq, c.name),
      LINK_TARGET_MAX
    ).map((c) => ({
      kind: "company",
      id: c.id,
      label: c.name || c.id,
      sub: place(c.city, c.state),
      companyId: c.id,
      companyName: c.name || c.id,
    }));
  }
  if (!only || only === "venue") {
    out.venues = typeaheadMatches(
      query,
      data.sites.filter((s) => nameOf.has(s.companyId)),
      (qq, s) => allIn(qq, `${siteLabel(s)} ${s.locationName || ""} ${s.address || ""} ${s.city || ""}`),
      (qq, s) => nameRank(qq, siteLabel(s)),
      LINK_TARGET_MAX
    ).map((s) => {
      const companyName = nameOf.get(s.companyId) || s.companyId;
      return {
        kind: "venue",
        id: s.id,
        label: siteLabel(s),
        sub: [companyName, [s.address, place(s.city, s.state)].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
        companyId: s.companyId,
        companyName,
      };
    });
  }
  if (!only || only === "person") {
    out.people = typeaheadMatches(
      query,
      data.people,
      (qq, p) => allIn(qq, `${p.name} ${p.emails.join(" ")}`),
      (qq, p) => nameRank(qq, p.name),
      LINK_TARGET_MAX
    ).map((p) => {
      const companyName = p.companyId ? nameOf.get(p.companyId) || "" : "";
      return {
        kind: "person",
        id: p.id,
        label: p.name || p.emails[0] || p.id,
        sub: [p.title, companyName].filter(Boolean).join(" · ") || p.emails[0] || "",
        companyId: p.companyId,
        companyName,
      };
    });
  }
  return out;
}
````

- [ ] **Step 5: Add `linkedContactIds` to `CommThread`** in `src/lib/stores/comms.ts`.

In `src/lib/stores/comms.ts`, find:

````ts
  resolvedContactId?: string | null;
  /** "Not them" on a suggestion — stop offering it for this thread. */
````

replace with:

````ts
  /** The primary linked person (#96). #214: always one of the linked
   *  people below — see lib/inbox-thread-contacts for the rules. */
  resolvedContactId?: string | null;
  /** #214 — every person linked to this thread (contact ids, deduped,
   *  capped at 25). Absent on older threads: they read as just
   *  resolvedContactId (linkedContactIdsOf). */
  linkedContactIds?: string[];
  /** "Not them" on a suggestion — stop offering it for this thread. */
````

- [ ] **Step 6: Append `emailsMatching` to `src/lib/identity/lookup.ts`** (after `pickContactHit`, the file's last function; the file already imports `and`, `eq`, `sql`, `getDb`, `contactEmails`, `contacts`):

````ts
/** #214 — the Link popup's people search: contacts with an address
 *  containing `fragment` (case-insensitive), as contactId → matching
 *  addresses. Soft-deleted contacts are skipped; capped at `limit` rows.
 *  Fragments under 2 characters match nothing. */
export async function emailsMatching(fragment: string, limit = 200): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const f = (fragment || "").trim().toLowerCase();
  if (f.length < 2) return out;
  const like = "%" + f.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const db = await getDb();
  const rows = await db
    .select({ contactId: contactEmails.contactId, email: sql<string>`lower(${contactEmails.email})` })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(and(sql`lower(${contactEmails.email}) like ${like}`, eq(contacts.deleted, false)))
    .limit(limit);
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push(r.email);
    out.set(r.contactId, list);
  }
  return out;
}
````

- [ ] **Step 7: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit
export PATH=$HOME/.local/node/bin:$PATH && LOG=$(mktemp) && npm run test:specs > "$LOG" 2>&1; grep -E "^FAIL|FAILED|ALL PASSED" "$LOG"; grep -c '^PASS' "$LOG"
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/inbox-thread-contacts.ts src/lib/inbox-link-targets.ts src/lib/stores/comms.ts src/lib/identity/lookup.ts
```
Expected: tsc silent; `ALL PASSED`, no `FAIL`, PASS = B + 62; eslint exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/inbox-thread-contacts.ts src/lib/inbox-link-targets.ts src/lib/stores/comms.ts src/lib/identity/lookup.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(inbox): linked-people rules and company/venue/people search ranking (#214)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Server actions + reader VM

**Files:**
- Create: `src/app/(app)/inbox/link-popup-actions.ts`
- Modify: `src/app/(app)/inbox/types.ts:6` (imports), `:247` (end of `ReaderVM`)
- Modify: `src/app/(app)/inbox/page.tsx:25` (imports), `:783` (before `messages`), `:874` (end of the `reader` object)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes (Tasks 1–3): `participantsOf`, `Participant`; `extractSignature`, `missingContactFields`, `companyByExactName`, `channelLabelFor`; `applyContactLink`, `linkedContactIdsOf`; `rankLinkTargets`, `emptyLinkTargets`, `LINK_TARGET_MIN_QUERY`, `LinkTargetGroups`, `LinkTargetKind`; `emailsMatching`; `fetchMessageCc` (lazy import).
- Consumes (existing): `contactsByEmails`/`contactByEmail` (`src/lib/identity/lookup.ts:17,43`), `getContact`/`saveContact`/`phonesFor`/`setPhones`/`displayName`/`allContacts` (`src/lib/identity/contacts.ts`), `getCompanies`/`allCompanies` (`src/lib/identity/companies.ts`), `getAllSites`/`docLocId` (`src/lib/identity/sites.ts:30,97`), `customersForDomain` (`src/lib/gmail/domains.ts:12`), `linkThread` (`src/lib/gmail/linking.ts:240`), `gmailEnabled`/`domainOf`/`personalKey` (`src/lib/gmail/config.ts`), `getConnectionInfo` (`src/lib/gmail/connections.ts:50`), `activeUsers` (`src/lib/users.ts:16`).
- Produces (server actions, all `requireUser()`):
  - `linkPopupDataAction(threadId: string, messageId: string): Promise<{ ok: true; data: LinkPopupData } | { ok: false; error: string }>`
  - `fetchMessageCcAction(threadId: string, messageId: string)` → same result type; data always has `ccPending: false`
  - `setThreadContactsAction(threadId: string, contactId: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }>`
  - `searchLinkTargetsAction(q: string, only?: LinkTargetKind): Promise<LinkTargetGroups>`
  - `fillContactBlanksAction(threadId: string, messageId: string): Promise<{ ok: true; wrote: string[] } | { ok: false; error: string }>`
- Produces (types.ts): `ReaderVM.linkedPeople: Array<{ id: string; name: string; primary: boolean }>`; `PopupParticipant`; `LinkPopupData` (fields below).

- [ ] **Step 1: Write the failing test.** Append to the end of `scripts/test-review-and-spec.ts`:

````ts
/* ====== #214 Inbox Link popup — server actions (Task 4) ======
   The actions touch the DB and (lazily) Gmail, so their guard rails are
   checked as source text: every export signs in and scopes to the user's
   mailbox, the Cc fetch is env-gated with a lazy bridge import, and
   "Add missing details" only ever fills blanks. */
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const acts214 = read("src/app/(app)/inbox/link-popup-actions.ts");
  const fn214 = (name: string) => {
    const at = acts214.indexOf(`export async function ${name}(`);
    return at < 0 ? "" : acts214.slice(at, acts214.indexOf("\n}\n", at));
  };
  const names214 = [
    "linkPopupDataAction",
    "fetchMessageCcAction",
    "setThreadContactsAction",
    "searchLinkTargetsAction",
    "fillContactBlanksAction",
  ];
  ok(acts214.startsWith('"use server"'), "#214 actions: link-popup-actions.ts is a server-actions module");
  ok(names214.every((n) => fn214(n).includes("await requireUser()")), "#214 actions: every popup action requires a signed-in user");
  ok(
    ["linkPopupDataAction", "fetchMessageCcAction", "fillContactBlanksAction"].every((n) => fn214(n).includes("loadThread(")) &&
      acts214.includes("if (!t || !visibleTo(t, me.name)) return { ok: false, error: \"Thread not found.\" };") &&
      fn214("setThreadContactsAction").includes("visibleTo(t, me.name)"),
    "#214 actions: thread actions only reach threads in the user's own mailbox"
  );
  const cc214 = fn214("fetchMessageCcAction");
  ok(
    cc214.includes("gmailEnabled()") && cc214.includes('await import("@/lib/gmail/bridge")') && !/^import[^\n]*"@\/lib\/gmail\/bridge"/m.test(acts214),
    "#214 actions: the Cc fetch is gated on GMAIL_ENABLED and loads the bridge lazily"
  );
  ok(cc214.includes("ccPending: false"), "#214 actions: a failed Cc fetch never makes the popup ask again");
  const set214 = fn214("setThreadContactsAction");
  ok(
    set214.includes("applyContactLink(d, contactId, on)") && set214.includes("d.linkedContactIds = next.linkedContactIds") && set214.includes("d.resolvedContactId = next.resolvedContactId"),
    "#214 actions: link/unlink writes through the pure rules on the fresh doc"
  );
  ok(
    set214.includes("!(t.customerId || (await resolveCustomerId(t)))") && set214.includes("linkThread(threadId, c.homeCompanyId"),
    "#214 actions: linking a person on a thread with no company links their home company"
  );
  const fill214 = fn214("fillContactBlanksAction");
  ok(
    /if \(miss\.title\) \{\s*await saveContact\(\{ \.\.\.c, title: miss\.title \}\);/.test(fill214) &&
      fill214.includes("...phones.map((p) => ({ value: p.phone, label: p.label, isPrimary: p.isPrimary }))") &&
      fill214.includes("missingContactFields(") &&
      fill214.includes("extractSignature(r.m.body"),
    "#214 actions: Add missing details re-reads the signature on the server, writes a title only into a blank one, and keeps every existing phone"
  );
  ok(fn214("searchLinkTargetsAction").includes("rankLinkTargets(") && fn214("searchLinkTargetsAction").includes("docLocId(s)"), "#214 actions: search ranks through the pure helper; venue ids are the CustomerLocation ids threads store");
  const page214 = read("src/app/(app)/inbox/page.tsx");
  ok(page214.includes("linkedContactIdsOf(sel)") && /\n      linkedPeople,\n    \};/.test(page214), "#214 page: the reader VM carries the linked people");
}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | grep -E "^FAIL|ENOENT|FAILED|ALL PASSED" | head`
Expected: the run aborts with `ENOENT … link-popup-actions.ts` (the block reads the file, which does not exist yet).

- [ ] **Step 3: Add the popup types to `src/app/(app)/inbox/types.ts`.**

In `src/app/(app)/inbox/types.ts`, find:

````ts
import type { LinkWorkType } from "@/lib/inbox-links";
````

replace with:

````ts
import type { LinkWorkType } from "@/lib/inbox-links";
import type { ParsedSignature, SigPhone } from "@/lib/inbox-signature-parse";
import type { ParticipantRole } from "@/lib/inbox-participants";
````

In `src/app/(app)/inbox/types.ts`, find:

````ts
  /** contacts of the linked/suggested customer (value = contact name — the
   *  doc-shape contact carries no id) */
  contactOptions: Opt[];
};
````

replace with:

````ts
  /** contacts of the linked/suggested customer (value = contact name — the
   *  doc-shape contact carries no id) */
  contactOptions: Opt[];
  /** #214 — every person linked to the thread, primary first (the
   *  sidebar's chips). */
  linkedPeople: Array<{ id: string; name: string; primary: boolean }>;
};

/** #214 — one address on the Link popup's message, matched to a contact. */
export type PopupParticipant = {
  name: string;
  email: string;
  role: ParticipantRole;
  /** the one live contact with this address, else null */
  contactId: string | null;
  contactName: string;
  companyId: string | null;
  companyName: string;
  /** the address belongs to contacts at more than one company */
  ambiguous: boolean;
  /** contactId is among the thread's linked people */
  linked: boolean;
};

/** #214 — everything the Link popup shows for one message (built on the
 *  server by linkPopupDataAction; no store ever reaches the client). */
export type LinkPopupData = {
  messageId: string;
  /** "Brenda Gauchel · in · Sep 21, 3:02 PM" */
  messageLabel: string;
  inbound: boolean;
  participants: PopupParticipant[];
  /** linked people who are not on this message */
  otherLinked: Array<{ id: string; name: string; companyName: string }>;
  /** Gmail message whose Cc was never fetched — the popup calls
   *  fetchMessageCcAction once, then shows the fuller list */
  ccPending: boolean;
  /** the parsed signature of an inbound message's sender, else null */
  signature: ParsedSignature | null;
  /** the sender is one known contact — they can take "Add missing details" */
  senderContactId: string | null;
  /** fields that contact lacks and the signature has (never overwrites) */
  missing: { title?: string; phones: SigPhone[] };
  /** unknown sender — "Add as contact" starts from these */
  prefill: {
    name: string;
    title: string;
    email: string;
    phone: string;
    companyId: string | null;
    companyName: string;
  } | null;
};
````

- [ ] **Step 4: Create `src/app/(app)/inbox/link-popup-actions.ts`**

````ts
"use server";

/**
 * #214 — server actions behind the Inbox Link popup: load one message's
 * participants (matched to contacts) + its sender's parsed signature, the
 * lazy Cc backfill, link/unlink one person, the combined company / venue /
 * person search, and "Add missing details" from the signature. Company and
 * venue links reuse link-actions.ts (linkThreadToCustomerAction,
 * setThreadSiteAction, the quick-adds); nothing here duplicates them.
 */
import { revalidatePath } from "next/cache";
import { requireUser, type SessionUser } from "@/lib/session";
import { patchDoc } from "@/db/doc-store";
import {
  get as getThread,
  resolveCustomerId,
  timeFull,
  visibleTo,
  type CommMessage,
  type CommThread,
} from "@/lib/stores/comms";
import { activeUsers } from "@/lib/users";
import { domainOf, gmailEnabled, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { customersForDomain } from "@/lib/gmail/domains";
import { linkThread } from "@/lib/gmail/linking";
import { allCompanies, getCompanies } from "@/lib/identity/companies";
import {
  allContacts,
  displayName,
  getContact,
  phonesFor,
  saveContact,
  setPhones,
} from "@/lib/identity/contacts";
import { contactByEmail, contactsByEmails, emailsMatching } from "@/lib/identity/lookup";
import { docLocId, getAllSites } from "@/lib/identity/sites";
import { participantsOf, type Participant } from "@/lib/inbox-participants";
import {
  channelLabelFor,
  companyByExactName,
  extractSignature,
  missingContactFields,
} from "@/lib/inbox-signature-parse";
import { applyContactLink, linkedContactIdsOf } from "@/lib/inbox-thread-contacts";
import {
  emptyLinkTargets,
  rankLinkTargets,
  LINK_TARGET_MIN_QUERY,
  type LinkTargetGroups,
  type LinkTargetKind,
} from "@/lib/inbox-link-targets";
import type { LinkPopupData, PopupParticipant } from "./types";

type R = { ok: true } | { ok: false; error: string };
type DataR = { ok: true; data: LinkPopupData } | { ok: false; error: string };
const revalidate = () => revalidatePath("/", "layout");

/** Our own addresses — never offered as people to link: every active team
 *  member's roster + Google addresses, the signed-in user's connected
 *  mailbox, and the mailbox that owns this thread. */
async function ownAddresses(t: CommThread, me: SessionUser): Promise<string[]> {
  const [users, mine, owner] = await Promise.all([
    activeUsers(),
    getConnectionInfo(personalKey(me.id)),
    t.gmailAccountKey ? getConnectionInfo(t.gmailAccountKey) : Promise.resolve(null),
  ]);
  const out: string[] = [me.email];
  for (const u of users) out.push(u.email, u.googleEmail || "");
  if (mine?.address) out.push(mine.address);
  if (owner?.address) out.push(owner.address);
  return out.filter(Boolean);
}

function senderOf(m: CommMessage, t: CommThread): Participant | null {
  if (m.direction !== "in") return null;
  return (
    participantsOf(m, [], { name: t.contactName, email: t.contactEmail }).find((p) => p.role === "from") ||
    null
  );
}

type Loaded = { ok: true; t: CommThread; m: CommMessage } | { ok: false; error: string };

async function loadThread(threadId: string, messageId: string, me: SessionUser): Promise<Loaded> {
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const m = (t.messages || []).find((x) => x.id === messageId);
  if (!m) return { ok: false, error: "That message isn't on this thread." };
  return { ok: true, t, m };
}

async function buildPopupData(t: CommThread, m: CommMessage, me: SessionUser): Promise<LinkPopupData> {
  const parts = participantsOf(m, await ownAddresses(t, me), {
    name: t.contactName,
    email: t.contactEmail,
  });
  const hits = await contactsByEmails(parts.map((p) => p.email));
  const linkedIds = linkedContactIdsOf(t);

  const contactIds = new Set<string>(linkedIds);
  for (const h of hits.values()) if (h && "contactId" in h) contactIds.add(h.contactId);
  const contactRows = (await Promise.all([...contactIds].map((id) => getContact(id)))).filter(
    (c): c is NonNullable<typeof c> => !!c
  );
  const contactById = new Map(contactRows.map((c) => [c.id, c]));
  const companies = await getCompanies(
    contactRows.map((c) => c.homeCompanyId).filter((v): v is string => !!v)
  );
  const companyName = (id: string | null | undefined) => (id ? companies.get(id)?.name || "" : "");

  const participants: PopupParticipant[] = parts.map((p) => {
    const h = hits.get(p.email) ?? null;
    const c = h && "contactId" in h ? contactById.get(h.contactId) ?? null : null;
    return {
      name: p.name,
      email: p.email,
      role: p.role,
      contactId: c?.id ?? null,
      contactName: c ? displayName(c) : "",
      companyId: c?.homeCompanyId ?? null,
      companyName: companyName(c?.homeCompanyId),
      ambiguous: !!h && "ambiguous" in h,
      linked: !!c && linkedIds.includes(c.id),
    };
  });
  const onMessage = new Set(participants.map((p) => p.contactId).filter(Boolean));
  const otherLinked = linkedIds
    .filter((id) => !onMessage.has(id))
    .map((id) => contactById.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ id: c.id, name: displayName(c), companyName: companyName(c.homeCompanyId) }));

  const sender = senderOf(m, t);
  const signature = sender ? extractSignature(m.body || "", { name: sender.name, email: sender.email }) : null;
  const senderRow = sender ? participants.find((p) => p.email === sender.email) ?? null : null;
  const senderContactId = senderRow?.contactId ?? null;

  let missing: LinkPopupData["missing"] = { phones: [] };
  let prefill: LinkPopupData["prefill"] = null;
  if (senderContactId) {
    const c = contactById.get(senderContactId);
    const phones = await phonesFor(senderContactId);
    missing = missingContactFields({ title: c?.title ?? "", phones: phones.map((p) => p.phone) }, signature);
  } else if (sender && !senderRow?.ambiguous) {
    const owners = await customersForDomain(domainOf(sender.email));
    let companyId: string | null = owners.length === 1 ? owners[0].customerId : null;
    if (!companyId && signature?.company) {
      companyId = companyByExactName(
        signature.company,
        (await allCompanies()).map((c) => ({ id: c.id, name: c.name }))
      );
    }
    const phone = signature?.phones.find((p) => p.label === "mobile") ?? signature?.phones[0];
    prefill = {
      name: signature?.name || sender.name || "",
      title: signature?.title || "",
      email: sender.email,
      phone: phone?.number || "",
      companyId,
      companyName: companyId ? (await getCompanies([companyId])).get(companyId)?.name || "" : "",
    };
  }

  return {
    messageId: m.id,
    messageLabel: `${m.author || (m.direction === "in" ? t.contactName : "Me")} · ${
      m.direction === "in" ? "in" : "out"
    } · ${timeFull(m.at)}`,
    inbound: m.direction === "in",
    participants,
    otherLinked,
    ccPending: gmailEnabled() && !!m.gmailId && !m.cc && !m.ccFetched,
    signature,
    senderContactId,
    missing,
    prefill,
  };
}

/** The popup's data for one message. */
export async function linkPopupDataAction(threadId: string, messageId: string): Promise<DataR> {
  const me = await requireUser();
  const r = await loadThread(threadId, messageId, me);
  if (!r.ok) return r;
  return { ok: true, data: await buildPopupData(r.t, r.m, me) };
}

/** Lazy Cc backfill for a Gmail message imported before #214, then the
 *  refreshed popup data. Inert when Gmail is off or the fetch fails: the
 *  popup keeps its From/To participants. */
export async function fetchMessageCcAction(threadId: string, messageId: string): Promise<DataR> {
  const me = await requireUser();
  const r = await loadThread(threadId, messageId, me);
  if (!r.ok) return r;
  if (gmailEnabled() && r.m.gmailId && !r.m.cc && !r.m.ccFetched) {
    try {
      // Lazy import — the bridge (and the Gmail client) only loads when the
      // env gate is on, the same rule comms.ts follows.
      const { fetchMessageCc } = await import("@/lib/gmail/bridge");
      await fetchMessageCc(threadId, messageId);
    } catch (err) {
      console.error("[inbox] Cc fetch failed", threadId, messageId, err);
    }
  }
  const again = await loadThread(threadId, messageId, me);
  if (!again.ok) return again;
  const data = await buildPopupData(again.t, again.m, me);
  // A failed fetch must not make the popup ask again on every open render.
  return { ok: true, data: { ...data, ccPending: false } };
}

/** Link (`on`) or unlink one person. Linking a person on a thread with no
 *  company yet also links their home company (and makes them primary). */
export async function setThreadContactsAction(
  threadId: string,
  contactId: string,
  on: boolean
): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const c = on ? await getContact(contactId) : null;
  if (on && !c) return { ok: false, error: "Person not found." };
  const pre = applyContactLink(t, contactId, on);
  if (!pre.ok) return pre;
  await patchDoc<CommThread>("comms", threadId, (d) => {
    const next = applyContactLink(d, contactId, on);
    if (!next.ok) return;
    d.linkedContactIds = next.linkedContactIds;
    d.resolvedContactId = next.resolvedContactId;
  });
  if (on && c?.homeCompanyId && !(t.customerId || (await resolveCustomerId(t)))) {
    await linkThread(threadId, c.homeCompanyId, pre.resolvedContactId);
  }
  revalidate();
  return { ok: true };
}

/** One search across companies (name, city), venues (name, address, city)
 *  and people (name, email) — ≤ 8 per group. `only` narrows to one kind
 *  (the quick-add contact form's company box). */
export async function searchLinkTargetsAction(
  q: string,
  only?: LinkTargetKind
): Promise<LinkTargetGroups> {
  await requireUser();
  const query = (q || "").trim();
  if (query.length < LINK_TARGET_MIN_QUERY) return emptyLinkTargets();
  const wantSites = !only || only === "venue";
  const wantPeople = !only || only === "person";
  const longest = query.split(/\s+/).sort((a, b) => b.length - a.length)[0] || "";
  const [companies, sites, people, emails] = await Promise.all([
    allCompanies(),
    wantSites ? getAllSites() : Promise.resolve([]),
    wantPeople ? allContacts() : Promise.resolve([]),
    wantPeople ? emailsMatching(longest) : Promise.resolve(new Map<string, string[]>()),
  ]);
  return rankLinkTargets(
    query,
    {
      companies: companies.map((c) => ({ id: c.id, name: c.name, city: c.city, state: c.state })),
      sites: sites.map((s) => ({
        id: docLocId(s),
        companyId: s.companyId,
        name: s.name,
        locationName: s.locationName,
        address: s.address,
        city: s.city,
        state: s.state,
      })),
      people: people.map((p) => ({
        id: p.id,
        name: displayName(p),
        title: p.title,
        companyId: p.homeCompanyId,
        emails: emails.get(p.id) ?? [],
      })),
    },
    only
  );
}

/** "Add missing details": write the title and phones the sender's contact
 *  lacks, re-read from the message on the server — never overwrites a
 *  field that already has a value. */
export async function fillContactBlanksAction(
  threadId: string,
  messageId: string
): Promise<{ ok: true; wrote: string[] } | { ok: false; error: string }> {
  const me = await requireUser();
  const r = await loadThread(threadId, messageId, me);
  if (!r.ok) return r;
  const sender = senderOf(r.m, r.t);
  if (!sender) return { ok: false, error: "Only a received message has a sender's signature." };
  const hit = await contactByEmail(sender.email);
  if (!hit || !("contactId" in hit)) return { ok: false, error: "The sender isn't one known contact." };
  const c = await getContact(hit.contactId);
  if (!c) return { ok: false, error: "Person not found." };
  const phones = await phonesFor(c.id);
  const sig = extractSignature(r.m.body || "", { name: sender.name, email: sender.email });
  const miss = missingContactFields({ title: c.title, phones: phones.map((p) => p.phone) }, sig);
  const wrote: string[] = [];
  if (miss.title) {
    await saveContact({ ...c, title: miss.title });
    wrote.push("title");
  }
  if (miss.phones.length) {
    await setPhones(c.id, [
      ...phones.map((p) => ({ value: p.phone, label: p.label, isPrimary: p.isPrimary })),
      ...miss.phones.map((p, i) => ({
        value: p.number,
        label: channelLabelFor(p.label),
        isPrimary: phones.length === 0 && i === 0,
      })),
    ]);
    wrote.push(miss.phones.length === 1 ? "1 phone" : `${miss.phones.length} phones`);
  }
  if (wrote.length) revalidate();
  return { ok: true, wrote };
}
````

- [ ] **Step 5: Build `linkedPeople` in `src/app/(app)/inbox/page.tsx`.**

In `src/app/(app)/inbox/page.tsx`, find:

````tsx
import { identityAddressFor, resolveAddressFor } from "@/lib/inbox-identity";
````

replace with:

````tsx
import { identityAddressFor, resolveAddressFor } from "@/lib/inbox-identity";
import { linkedContactIdsOf } from "@/lib/inbox-thread-contacts";
import { displayName as contactDisplayName, getContact } from "@/lib/identity/contacts";
````

In `src/app/(app)/inbox/page.tsx`, find:

````tsx
    const messages: MessageVM[] = (sel.messages || []).map((m) => ({
````

replace with:

````tsx
    // #214 — the sidebar's linked-people chips (primary first; ≤ 25 ids).
    const linkedIds = linkedContactIdsOf(sel);
    const linkedPeople: ReaderVM["linkedPeople"] = (
      await Promise.all(linkedIds.map((id) => getContact(id)))
    )
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ id: c.id, name: contactDisplayName(c), primary: c.id === linkedIds[0] }));

    const messages: MessageVM[] = (sel.messages || []).map((m) => ({
````

In `src/app/(app)/inbox/page.tsx`, find:

````tsx
            : []
      ),
    };
  }
````

replace with:

````tsx
            : []
      ),
      linkedPeople,
    };
  }
````

- [ ] **Step 6: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit
export PATH=$HOME/.local/node/bin:$PATH && LOG=$(mktemp) && npm run test:specs > "$LOG" 2>&1; grep -E "^FAIL|FAILED|ALL PASSED" "$LOG"; grep -c '^PASS' "$LOG"
export PATH=$HOME/.local/node/bin:$PATH && npx eslint "src/app/(app)/inbox/link-popup-actions.ts" "src/app/(app)/inbox/types.ts" "src/app/(app)/inbox/page.tsx"
```
Expected: tsc silent; `ALL PASSED`, no `FAIL`, PASS = B + 72; eslint exit 0.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/inbox/link-popup-actions.ts" "src/app/(app)/inbox/types.ts" "src/app/(app)/inbox/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(inbox): Link popup server actions — participants, lazy Cc, people links, search, signature blanks (#214)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The popup, the "Link…" button, the summary sidebar

**Files:**
- Create: `src/app/(app)/inbox/link-popup.tsx`
- Modify: `src/app/(app)/inbox/work-link-card.tsx:17-19`, `:126-128`, `:137`
- Rewrite: `src/app/(app)/inbox/link-sidebar.tsx` (whole file)
- Modify: `src/app/(app)/inbox/thread-reader.tsx:18`, `:134-146`, `:199`, `:282-290`, `:319`, `:370`, `:424`, `:552-554`, `:736-739`, `:1155`
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes (Task 4): the five actions in `./link-popup-actions`, `LinkPopupData`, `PopupParticipant`, `ReaderVM.linkedPeople`.
- Consumes (existing, unchanged): `linkThreadToCustomerAction`, `quickAddCustomerAction`, `quickAddContactAction` (returns `{ ok: true; id }`), `quickAddVenueAction`, `setThreadSiteAction`, `setIdentityMessageAction`, `dismissSuggestionAction`, `releaseDomainAction` (`./link-actions`); `Typeahead` (`src/components/search/typeahead.tsx`) with `passAllFilter`/`stableRank`; `EntityQuickAdd` + `INPUT` (`src/components/entity-quick-add.tsx`).
- Produces: `default function LinkPopup({ vm, messageId, fromHeader, onClose, onCreateTask }: { vm: ReaderVM; messageId: string; fromHeader: boolean; onClose: () => void; onCreateTask?: () => void })` — #215 passes `onCreateTask` from `thread-reader.tsx`'s `<LinkPopup …>` mount; `LinkSidebar` gains a required `onEditLinks: () => void`; `WorkLinkCard` gains `mode?: "summary" | "edit"` (default `"edit"`).

- [ ] **Step 1: Write the failing test.** Append to the end of `scripts/test-review-and-spec.ts`:

````ts
/* ====== #214 Inbox Link popup — UI (Task 5) ======
   Client components can't import a store (postgres lands in the client
   bundle and only next build notices), so their imports are checked here;
   the popup's #215 seam and the slimmed sidebar are checked as source. */
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const importsOf = (src: string) => [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)].map((m) => ({ typeOnly: !!m[1], spec: m[2] }));
  const clientFiles214 = [
    "src/app/(app)/inbox/link-popup.tsx",
    "src/app/(app)/inbox/link-sidebar.tsx",
    "src/app/(app)/inbox/work-link-card.tsx",
    "src/app/(app)/inbox/thread-reader.tsx",
  ];
  for (const f of clientFiles214) {
    const src = read(f);
    const bad = importsOf(src).filter(
      (i) =>
        !i.typeOnly &&
        (i.spec.startsWith("@/lib/stores/") || i.spec.startsWith("@/db") || i.spec.startsWith("@/lib/identity/") || i.spec.startsWith("@/lib/gmail/"))
    );
    ok(src.startsWith('"use client"') && bad.length === 0, `#214 UI: ${f} is a client component with no store/db/identity/gmail runtime import (${bad.map((b) => b.spec).join(", ")})`);
  }
  const popup214 = read("src/app/(app)/inbox/link-popup.tsx");
  ok(/onCreateTask\?: \(\) => void;/.test(popup214) && popup214.includes("{onCreateTask && ("), "#214 UI: the popup footer shows Create task only when #215 passes onCreateTask");
  ok(
    ["People on this email", "Company &amp; venue", "From the signature", "<WorkLinkCard vm={vm} mode=\"edit\" />"].every((s) => popup214.includes(s)),
    "#214 UI: the popup has the People / Company & venue / Work / signature sections"
  );
  ok(popup214.includes("setIdentityMessageAction(vm.id, messageId)") && popup214.includes("fromHeader"), "#214 UI: opening from a message header makes that message the Linking-from source");
  ok(popup214.includes("fetchMessageCcAction(vm.id, messageId)") && popup214.includes("if (r.data.ccPending)"), "#214 UI: the popup runs the lazy Cc fetch only when the server says it is pending");
  const side214 = read("src/app/(app)/inbox/link-sidebar.tsx");
  ok(!side214.includes("<select") && !side214.includes("EntityQuickAdd") && !side214.includes("quickAdd"), "#214 UI: the sidebar has no dropdown editors or quick-add forms left");
  ok(side214.includes("onEditLinks: () => void;") && side214.includes("Edit links") && side214.includes("vm.linkedPeople.map("), "#214 UI: the sidebar summary has Edit links and linked-people chips");
  ok(side214.includes('<WorkLinkCard vm={vm} mode="summary" />'), "#214 UI: the sidebar's work card is the summary mode");
  const card214 = read("src/app/(app)/inbox/work-link-card.tsx");
  ok(card214.includes('mode?: "summary" | "edit";') && card214.includes('{mode === "edit" && open && ('), "#214 UI: WorkLinkCard's picker only renders in edit mode");
  const reader214 = read("src/app/(app)/inbox/thread-reader.tsx");
  ok(reader214.includes("Link…") && reader214.includes("onOpenLinks={() => onOpenLinks(m.id)}") && reader214.includes("<LinkPopup"), "#214 UI: each message header has Link… and the reader mounts the popup");
}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | grep -E "^FAIL|ENOENT|FAILED|ALL PASSED" | head`
Expected: aborts with `ENOENT … link-popup.tsx`.

- [ ] **Step 3: Give `WorkLinkCard` a summary mode** (`src/app/(app)/inbox/work-link-card.tsx`).

In `src/app/(app)/inbox/work-link-card.tsx`, find:

````tsx
export default function WorkLinkCard({ vm }: { vm: ReaderVM }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
````

replace with:

````tsx
export default function WorkLinkCard({
  vm,
  mode = "edit",
}: {
  vm: ReaderVM;
  /** #214 — "summary" (the sidebar): the chip, × and "+ New quote" only;
   *  "edit" (the Link popup): the type + record picker too, open at once. */
  mode?: "summary" | "edit";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(mode === "edit");
````

In `src/app/(app)/inbox/work-link-card.tsx`, find:

````tsx
        <button onClick={() => setOpen(!open)} style={ACCENT_BTN}>
          {vm.link ? "Change link" : "+ Link to work"}
        </button>
````

replace with:

````tsx
        {mode === "edit" && (
          <button onClick={() => setOpen(!open)} style={ACCENT_BTN}>
            {vm.link ? "Change link" : "+ Link to work"}
          </button>
        )}
        {mode === "summary" && !vm.link && <span style={MUTED}>No work linked.</span>}
````

In `src/app/(app)/inbox/work-link-card.tsx`, find:

````tsx
      {open && (
````

replace with:

````tsx
      {mode === "edit" && open && (
````

- [ ] **Step 4: Create `src/app/(app)/inbox/link-popup.tsx`**

````tsx
"use client";

/**
 * #214 — the Inbox Link popup. Opened from a message header's "Link…" (that
 * message becomes the thread's "Linking from") or the sidebar's "Edit
 * links" (the identity message). Top to bottom:
 *   1. People on this email — From/To/Cc; tick to link, "Add" to create
 *   2. Company & venue      — current links + one search box
 *   3. Work                 — WorkLinkCard in edit mode (scoped to the company)
 *   4. From the signature   — prefill a new contact / fill a known one's blanks
 *   5. Footer               — Create task (#215 passes onCreateTask) · Done
 *
 * Data comes from linkPopupDataAction; every write goes through a server
 * action, then reloads that data and router.refresh()es the reader. No store
 * imports — a store pulls postgres into the client bundle (next build only).
 */
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import EntityQuickAdd, { INPUT, type QuickAddValues } from "@/components/entity-quick-add";
import { Typeahead } from "@/components/search/typeahead";
import { passAllFilter, stableRank } from "@/lib/search/typeahead-rank";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import type { LinkTargetHit, LinkTargetKind } from "@/lib/inbox-link-targets";
import type { LinkPopupData, PopupParticipant, ReaderVM } from "./types";
import {
  fetchMessageCcAction,
  fillContactBlanksAction,
  linkPopupDataAction,
  searchLinkTargetsAction,
  setThreadContactsAction,
} from "./link-popup-actions";
import {
  linkThreadToCustomerAction,
  quickAddContactAction,
  quickAddCustomerAction,
  quickAddVenueAction,
  setIdentityMessageAction,
  setThreadSiteAction,
} from "./link-actions";
import WorkLinkCard from "./work-link-card";
import { ACCENT_BTN, BODY, BTN, CARD, CHECK_ROW, H, MONO, MUTED, PRIMARY } from "./sidebar-styles";

type ActionResult = { ok: boolean; error?: string };

const KIND_META: Record<LinkTargetKind, { label: string; color: string }> = {
  company: { label: "Company", color: "#8a6d1f" },
  venue: { label: "Venue", color: "#1f7a52" },
  person: { label: "Person", color: "#3155a8" },
};

const ROLE_LABEL: Record<PopupParticipant["role"], string> = { from: "From", to: "To", cc: "Cc" };

const ELLIPSIS: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const CHIP: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "#fff",
  padding: "2px 6px",
  borderRadius: 5,
  flexShrink: 0,
};

const hitKey = (h: LinkTargetHit) => `${h.kind}:${h.id}`;

function HitRow({ hit }: { hit: LinkTargetHit }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ ...CHIP, background: KIND_META[hit.kind].color }}>{KIND_META[hit.kind].label}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, ...ELLIPSIS }}>{hit.label}</span>
        {hit.sub && <span style={{ display: "block", fontSize: 11, color: "#8c919c", ...ELLIPSIS }}>{hit.sub}</span>}
      </span>
    </span>
  );
}

/** Debounced server search with a stale-response guard — the #121 pattern
 *  (design/assemblies/fixture-form.tsx usePartSearch): items are DERIVED
 *  from whether the last answered query still matches the live one. */
function useLinkSearch(only?: LinkTargetKind) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTargetHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      searchLinkTargetsAction(q, only).then((g) => {
        if (my !== seq.current) return;
        setResults([...g.companies, ...g.venues, ...g.people]);
        setResultQuery(q);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query, only]);
  const trimmed = query.trim();
  const fresh = trimmed.length >= 2 && resultQuery === trimmed;
  return {
    setQuery,
    items: fresh ? results : [],
    emptyText: trimmed.length < 2 ? "Type at least 2 letters." : fresh ? "Nothing matches." : "Searching…",
  };
}

function LinkSearchBox({
  only,
  placeholder,
  onPick,
}: {
  only?: LinkTargetKind;
  placeholder: string;
  onPick: (hit: LinkTargetHit) => void;
}) {
  const { setQuery, items, emptyText } = useLinkSearch(only);
  return (
    <Typeahead
      items={items}
      keyOf={hitKey}
      filter={passAllFilter}
      rank={stableRank}
      render={(h) => <HitRow hit={h} />}
      onPick={onPick}
      max={24}
      placeholder={placeholder}
      ariaLabel={placeholder}
      inputStyle={{ ...INPUT, padding: "8px 10px", fontSize: 12.5 }}
      emptyText={emptyText}
      onQueryChange={setQuery}
    />
  );
}

type Adding = {
  email: string;
  values: QuickAddValues["contact"];
  company: { id: string; name: string } | null;
};

export default function LinkPopup({
  vm,
  messageId,
  fromHeader,
  onClose,
  onCreateTask,
}: {
  vm: ReaderVM;
  messageId: string;
  /** opened from a message header — that message becomes "Linking from" */
  fromHeader: boolean;
  onClose: () => void;
  /** #215 wires this; the footer shows "Create task" only when it is set */
  onCreateTask?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [data, setData] = useState<LinkPopupData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [newCompany, setNewCompany] = useState<QuickAddValues["customer"] | null>(null);
  const [newVenue, setNewVenue] = useState<QuickAddValues["venue"] | null>(null);
  const [remember, setRemember] = useState(true);
  const [claim, setClaim] = useState(false);

  // Load (and, once, lazily backfill Cc for) the popup's message. `rev`
  // bumps after every write so the lists re-read the server.
  useEffect(() => {
    let alive = true;
    linkPopupDataAction(vm.id, messageId).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setData(r.data);
      if (r.data.ccPending) {
        fetchMessageCcAction(vm.id, messageId).then((r2) => {
          if (alive && r2.ok) setData(r2.data);
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [vm.id, messageId, rev]);

  // Opened from a message header: that message drives linking from now on
  // (#125's identity source), exactly as the old "Linking from" picker did.
  const identitySet = useRef(false);
  useEffect(() => {
    if (!fromHeader || identitySet.current || vm.identityMessageId === messageId) return;
    identitySet.current = true;
    setIdentityMessageAction(vm.id, messageId).then(() => router.refresh());
  }, [fromHeader, messageId, vm.id, vm.identityMessageId, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (fn: () => Promise<ActionResult>, onSuccess?: () => void) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error || "Something went wrong.");
        return;
      }
      onSuccess?.();
      setRev((v) => v + 1);
      router.refresh();
    });

  const senderEmail = vm.identity?.email || vm.contactEmail;
  const canClaim = !vm.senderIsPublicDomain && !!vm.senderDomain;
  const companyId = vm.customerCard?.id || null;
  const venueLabel = vm.siteId ? vm.siteOptions.find((o) => o.value === vm.siteId)?.label || "Venue" : "";

  const linkCompany = (id: string) =>
    linkThreadToCustomerAction(vm.id, id, {
      remember: remember && !!senderEmail,
      claimDomain: claim && canClaim,
    });

  const pickTarget = (hit: LinkTargetHit) => {
    if (hit.kind === "company") run(() => linkCompany(hit.id));
    else if (hit.kind === "venue")
      run(async () => {
        if (hit.companyId && hit.companyId !== companyId) {
          const r = await linkCompany(hit.companyId);
          if (!r.ok) return r;
        }
        return setThreadSiteAction(vm.id, hit.id);
      });
    else run(() => setThreadContactsAction(vm.id, hit.id, true));
  };

  const startAdding = (p: PopupParticipant) => {
    const pre = data?.prefill && data.prefill.email === p.email ? data.prefill : null;
    const company = pre?.companyId
      ? { id: pre.companyId, name: pre.companyName }
      : companyId && vm.customerCard
        ? { id: companyId, name: vm.customerCard.name }
        : null;
    setError(null);
    setAdding({
      email: p.email,
      values: {
        name: pre?.name || p.name,
        role: pre?.title || "",
        email: p.email,
        phone: pre?.phone || "",
      },
      company,
    });
  };

  const submitAdding = () => {
    if (!adding) return;
    if (!adding.company) {
      setError("Pick the company this person works for.");
      return;
    }
    const a = adding;
    run(
      async () => {
        const res = await quickAddContactAction({ customerId: a.company!.id, ...a.values });
        if (!res.ok) return res;
        return setThreadContactsAction(vm.id, res.id, true);
      },
      () => setAdding(null)
    );
  };

  const sender = data?.participants.find((p) => p.role === "from") || null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,24,29,.4)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Link this email"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 580,
          maxWidth: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#fafbfc",
          borderRadius: 14,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          fontFamily: "var(--font-ui)",
          color: "#16181d",
        }}
      >
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #eef0f3", background: "#fff", borderRadius: "14px 14px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>Link this email</div>
            <button
              onClick={onClose}
              title="Close"
              style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
          <div style={{ ...MUTED, marginTop: 2 }}>
            Linking from: {data ? data.messageLabel : "…"}
          </div>
        </div>

        <div className="ib-scroll" style={{ overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {loadError && <div style={{ fontSize: 12.5, color: "#b4543a" }}>{loadError}</div>}
          {!data && !loadError && <div style={MUTED}>Loading…</div>}

          {data && (
            <>
              {/* 1. People on this email */}
              <div style={CARD}>
                <div style={H}>People on this email</div>
                {data.participants.length === 0 && (
                  <div style={MUTED}>No outside addresses on this message.</div>
                )}
                {data.participants.map((p) => (
                  <div key={p.email} style={{ padding: "6px 0", borderTop: "1px solid #f2f3f6" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {p.contactId ? (
                        <input
                          type="checkbox"
                          checked={p.linked}
                          disabled={pending}
                          aria-label={`Link ${p.contactName || p.email}`}
                          onChange={(e) => run(() => setThreadContactsAction(vm.id, p.contactId!, e.target.checked))}
                        />
                      ) : (
                        <span style={{ width: 13 }} />
                      )}
                      <span style={{ ...CHIP, background: "#8c919c" }}>{ROLE_LABEL[p.role]}</span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, ...ELLIPSIS }}>
                          {p.contactName || p.name || p.email}
                        </span>
                        <span style={{ display: "block", ...MONO, color: "#8c919c", ...ELLIPSIS }}>
                          {p.email}
                          {p.companyName ? ` · ${p.companyName}` : ""}
                        </span>
                      </span>
                      {!p.contactId && !p.ambiguous && (
                        <button
                          type="button"
                          style={adding?.email === p.email ? ACCENT_BTN : BTN}
                          disabled={pending}
                          onClick={() => (adding?.email === p.email ? setAdding(null) : startAdding(p))}
                        >
                          Add
                        </button>
                      )}
                      {p.ambiguous && <span style={MUTED}>At several companies</span>}
                    </div>
                    {adding?.email === p.email && (
                      <div style={{ marginTop: 8, paddingLeft: 21 }}>
                        <div style={{ ...MUTED, marginBottom: 6 }}>
                          Company:{" "}
                          {adding.company ? (
                            <>
                              <b>{adding.company.name}</b>{" "}
                              <button
                                type="button"
                                style={{ ...BTN, padding: "1px 6px", fontSize: 11 }}
                                onClick={() => setAdding({ ...adding, company: null })}
                              >
                                Change
                              </button>
                            </>
                          ) : (
                            "pick one below"
                          )}
                        </div>
                        {!adding.company && (
                          <LinkSearchBox
                            only="company"
                            placeholder="Search companies…"
                            onPick={(h) => setAdding({ ...adding, company: { id: h.id, name: h.label } })}
                          />
                        )}
                        <EntityQuickAdd
                          kind="contact"
                          value={adding.values}
                          onChange={(v) => setAdding({ ...adding, values: v })}
                          submitting={pending}
                          error={error}
                          onCancel={() => setAdding(null)}
                          onSubmit={submitAdding}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {data.otherLinked.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ ...MUTED, marginBottom: 4 }}>Also linked to this thread</div>
                    {data.otherLinked.map((o) => (
                      <label key={o.id} style={{ ...CHECK_ROW, marginTop: 4 }}>
                        <input
                          type="checkbox"
                          checked
                          disabled={pending}
                          onChange={() => run(() => setThreadContactsAction(vm.id, o.id, false))}
                        />
                        <span>
                          {o.name}
                          {o.companyName ? ` · ${o.companyName}` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Company & venue */}
              <div style={CARD}>
                <div style={H}>Company &amp; venue</div>
                <div style={BODY}>
                  Company: <b>{vm.customerCard?.name || "none"}</b>
                  {vm.customerCard && (
                    <>
                      {" "}· Venue: <b>{venueLabel || "none"}</b>
                      {vm.siteId && (
                        <button
                          type="button"
                          style={{ ...BTN, padding: "1px 6px", fontSize: 11, marginLeft: 6 }}
                          disabled={pending}
                          onClick={() => run(() => setThreadSiteAction(vm.id, null))}
                        >
                          Clear venue
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div style={{ marginTop: 10 }}>
                  <LinkSearchBox
                    placeholder="Search a company, venue or person…"
                    onPick={pickTarget}
                  />
                </div>
                {senderEmail && (
                  <label style={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      When I pick a company, remember <span style={MONO}>{senderEmail}</span> on a contact
                    </span>
                  </label>
                )}
                {canClaim && (
                  <label style={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={claim}
                      onChange={(e) => setClaim(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      …and always link <span style={MONO}>@{vm.senderDomain}</span> to it
                    </span>
                  </label>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    style={newCompany ? ACCENT_BTN : BTN}
                    disabled={pending}
                    onClick={() => setNewCompany(newCompany ? null : { name: "", type: CUSTOMER_TYPES[0] || "" })}
                  >
                    + New company
                  </button>
                  {companyId && (
                    <button
                      type="button"
                      style={newVenue ? ACCENT_BTN : BTN}
                      disabled={pending}
                      onClick={() => setNewVenue(newVenue ? null : { label: "", city: "", state: "" })}
                    >
                      + New venue
                    </button>
                  )}
                </div>
                {newCompany && (
                  <div style={{ marginTop: 8 }}>
                    <EntityQuickAdd
                      kind="customer"
                      value={newCompany}
                      onChange={setNewCompany}
                      submitting={pending}
                      error={error}
                      onCancel={() => setNewCompany(null)}
                      onSubmit={() =>
                        run(
                          () =>
                            quickAddCustomerAction({
                              ...newCompany,
                              senderName: vm.identity?.name || vm.contactName,
                              senderEmail,
                              remember: remember && !!senderEmail,
                              threadId: vm.id,
                            }),
                          () => setNewCompany(null)
                        )
                      }
                    />
                  </div>
                )}
                {newVenue && companyId && (
                  <div style={{ marginTop: 8 }}>
                    <EntityQuickAdd
                      kind="venue"
                      value={newVenue}
                      onChange={setNewVenue}
                      submitting={pending}
                      error={error}
                      onCancel={() => setNewVenue(null)}
                      onSubmit={() =>
                        run(
                          () => quickAddVenueAction({ customerId: companyId, ...newVenue, threadId: vm.id }),
                          () => setNewVenue(null)
                        )
                      }
                    />
                  </div>
                )}
              </div>

              {/* 3. Work */}
              <WorkLinkCard vm={vm} mode="edit" />

              {/* 4. From the signature (received messages only) */}
              {data.inbound && (
                <div style={CARD}>
                  <div style={H}>From the signature</div>
                  {!data.signature ? (
                    <div style={MUTED}>No signature found on this message.</div>
                  ) : (
                    <>
                      <div style={{ ...BODY, display: "grid", gap: 2 }}>
                        {data.signature.name && <div><b>{data.signature.name}</b></div>}
                        {data.signature.title && <div>{data.signature.title}</div>}
                        {data.signature.company && <div>{data.signature.company}</div>}
                        {data.signature.phones.map((ph) => (
                          <div key={ph.number} style={MONO}>
                            {ph.label} · {ph.number}
                          </div>
                        ))}
                        {data.signature.website && <div style={MONO}>{data.signature.website}</div>}
                      </div>
                      {data.senderContactId ? (
                        data.missing.title || data.missing.phones.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={MUTED}>
                              Not on file yet:{" "}
                              {[
                                data.missing.title ? `title “${data.missing.title}”` : "",
                                ...data.missing.phones.map((ph) => `${ph.label} ${ph.number}`),
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                            <button
                              type="button"
                              style={{ ...PRIMARY, marginTop: 8 }}
                              disabled={pending}
                              onClick={() =>
                                run(async () => {
                                  const r = await fillContactBlanksAction(vm.id, messageId);
                                  if (r.ok) setNotice(r.wrote.length ? `Added ${r.wrote.join(" and ")}.` : "Nothing new to add.");
                                  return r;
                                })
                              }
                            >
                              Add missing details
                            </button>
                          </div>
                        ) : (
                          <div style={{ ...MUTED, marginTop: 8 }}>Everything here is already on file.</div>
                        )
                      ) : (
                        sender &&
                        !sender.contactId &&
                        !sender.ambiguous && (
                          <button
                            type="button"
                            style={{ ...PRIMARY, marginTop: 10 }}
                            disabled={pending}
                            onClick={() => startAdding(sender)}
                          >
                            Add as contact
                          </button>
                        )
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {notice && <div style={{ fontSize: 12, color: "#1f7a52" }}>{notice}</div>}
          {error && !adding && !newCompany && !newVenue && (
            <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "12px 20px",
            borderTop: "1px solid #eef0f3",
            background: "#fff",
            borderRadius: "0 0 14px 14px",
          }}
        >
          {onCreateTask && (
            <button type="button" style={BTN} onClick={onCreateTask}>
              Create task
            </button>
          )}
          <button type="button" style={PRIMARY} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
````

- [ ] **Step 5: Replace the whole of `src/app/(app)/inbox/link-sidebar.tsx`** with the summary version:

````tsx
"use client";

/**
 * #96 §2 / #123 / #124 / #125 / #214 — the reader's link sidebar, now a
 * SUMMARY of what the thread is linked to, with "Edit links" opening the
 * Link popup (link-popup.tsx) where every editor lives. Top to bottom:
 *   1. Edit links   — opens the popup on the identity message
 *   2. Work         — WorkLinkCard in summary mode (chip, ×, + New quote)
 *   3. Customer     — linked card / one-click suggested + ambiguous cards /
 *                     "Not linked" (the pickers moved into the popup)
 *   4. People       — (#214) chips for every linked person, primary first
 *   5. Venue        — the linked venue, read-only
 *   6. Linking from — which message's addresses drive linking, read-only
 *
 * Display + server-action calls on a server-built ReaderVM: no fetching, no
 * env, no store imports.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import {
  dismissSuggestionAction,
  linkThreadToCustomerAction,
  releaseDomainAction,
} from "./link-actions";
import WorkLinkCard from "./work-link-card";
import { ACCENT_BTN, BODY, BTN, CARD, CHECK_ROW, H, MONO, MUTED, PRIMARY } from "./sidebar-styles";

type ActionResult = { ok: boolean; error?: string };

export default function LinkSidebar({
  vm,
  variant,
  onEditLinks,
}: {
  vm: ReaderVM;
  /** pane → 300px column beside the reader; overlay → full-width block
   *  under the reader header (the 540px overlay can't fit a column) */
  variant: "pane" | "overlay";
  /** #214 — opens the Link popup */
  onEditLinks: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  // #125 — the party this thread links from: the picked message's address,
  // else the thread contact. vm.senderDomain already follows the same rule.
  const senderEmail = vm.identity?.email || vm.contactEmail;
  const identityMsg = vm.identityMessageId
    ? vm.messages.find((m) => m.id === vm.identityMessageId) || null
    : null;
  const venueLabel = vm.siteId
    ? vm.siteOptions.find((o) => o.value === vm.siteId)?.label || "Venue"
    : "";

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error || "Something went wrong.");
        return;
      }
      router.refresh();
    });

  const linkTo = (customerId: string, claim: boolean, rememberAddr: boolean) =>
    run(() =>
      linkThreadToCustomerAction(vm.id, customerId, {
        remember: rememberAddr,
        claimDomain: claim,
      })
    );

  const canClaim = !vm.senderIsPublicDomain;
  const domainTag = <span style={MONO}>@{vm.senderDomain}</span>;
  const emailTag = <span style={MONO}>{senderEmail}</span>;

  const rememberRow = (
    <label style={CHECK_ROW}>
      <input
        type="checkbox"
        checked={remember}
        onChange={(e) => setRemember(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span>Remember {emailTag} on a contact</span>
    </label>
  );

  const asideStyle: React.CSSProperties =
    variant === "pane"
      ? {
          width: 300,
          flexShrink: 0,
          borderLeft: "1px solid #ececf0",
          background: "#fafbfc",
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }
      : {
          flexShrink: 0,
          maxHeight: "42%",
          borderBottom: "1px solid #ececf0",
          background: "#fafbfc",
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        };

  return (
    <aside
      className="ib-scroll"
      style={{ ...asideStyle, fontFamily: "var(--font-ui)", color: "#16181d" }}
    >
      <button
        type="button"
        onClick={onEditLinks}
        disabled={vm.messages.length === 0}
        style={{ ...PRIMARY, padding: "8px 12px", fontSize: 12.5 }}
      >
        Edit links
      </button>

      <WorkLinkCard vm={vm} mode="summary" />

      {/* ---- linked ---- */}
      {vm.resolution === "linked" && vm.customerCard && (
        <div style={CARD}>
          <div style={H}>Customer</div>
          <a
            href={`/companies/${encodeURIComponent(vm.customerCard.id)}`}
            style={{ fontSize: 14, fontWeight: 600, color: "#16181d", textDecoration: "none" }}
          >
            {vm.customerCard.name}
          </a>
          <div style={MUTED}>
            {vm.customerCard.tier} tier · {vm.customerCard.openQuotes} open quote
            {vm.customerCard.openQuotes === 1 ? "" : "s"} · {vm.customerCard.openProjects} open
            project{vm.customerCard.openProjects === 1 ? "" : "s"}
          </div>
          {vm.needsAdopt && (
            <div style={{ ...MUTED, marginTop: 8 }}>
              Matched by {emailTag} — not saved on this thread yet.
            </div>
          )}
          {vm.domainClaimedByThisCustomer && !vm.senderIsPublicDomain && (
            <div style={{ ...MUTED, marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span>Emails from {domainTag} link here automatically ·</span>
              <button
                type="button"
                disabled={pending}
                title={`Stop linking @${vm.senderDomain} to ${vm.customerCard.name}`}
                onClick={() => run(() => releaseDomainAction(vm.senderDomain, vm.customerCard!.id))}
                style={{ ...BTN, padding: "1px 6px", fontSize: 11, color: "#8c919c" }}
              >
                Stop
              </button>
            </div>
          )}
          {vm.needsAdopt && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              <button
                style={PRIMARY}
                disabled={pending}
                onClick={() => linkTo(vm.customerCard!.id, false, false)}
              >
                Save link
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- suggested — one click, no picker ---- */}
      {vm.resolution === "suggested" && vm.suggested && (
        <div style={CARD}>
          <div style={H}>Looks like</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{vm.suggested.name}</div>
          <div style={MUTED}>
            {vm.suggested.contactsAtDomain} contact
            {vm.suggested.contactsAtDomain === 1 ? "" : "s"} at {domainTag}
          </div>
          {rememberRow}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <button
              style={PRIMARY}
              disabled={pending}
              onClick={() => linkTo(vm.suggested!.customerId, false, remember)}
            >
              Link
            </button>
            {canClaim && (
              <button
                style={ACCENT_BTN}
                disabled={pending}
                title={`Always link @${vm.senderDomain} to ${vm.suggested.name}`}
                onClick={() => linkTo(vm.suggested!.customerId, true, remember)}
              >
                Always
              </button>
            )}
            <button
              style={BTN}
              disabled={pending}
              onClick={() => run(() => dismissSuggestionAction(vm.id))}
            >
              Not them
            </button>
          </div>
        </div>
      )}

      {/* ---- ambiguous — one click per candidate ---- */}
      {vm.resolution === "ambiguous" && (
        <div style={CARD}>
          <div style={H}>Which customer?</div>
          <div style={BODY}>
            {domainTag} is shared by {vm.candidates.length} customers.
          </div>
          {vm.candidates.map((c) => (
            <div
              key={c.customerId}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.name}
              </span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  style={BTN}
                  disabled={pending}
                  title="Link just this thread"
                  onClick={() => linkTo(c.customerId, false, remember)}
                >
                  This thread
                </button>
                {canClaim && (
                  <button
                    style={ACCENT_BTN}
                    disabled={pending}
                    title={`Always link @${vm.senderDomain} to ${c.name}`}
                    onClick={() => linkTo(c.customerId, true, remember)}
                  >
                    Always
                  </button>
                )}
              </span>
            </div>
          ))}
          {rememberRow}
        </div>
      )}

      {/* ---- unknown — the search lives in the popup ---- */}
      {vm.resolution === "unknown" && (
        <div style={CARD}>
          <div style={H}>Not linked</div>
          <div style={BODY}>
            {!senderEmail ? (
              <>No sender address — link this thread to a customer.</>
            ) : canClaim ? (
              <>{domainTag} isn&apos;t linked to a customer yet.</>
            ) : (
              <>Personal address — link this thread to a customer.</>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" style={ACCENT_BTN} onClick={onEditLinks} disabled={vm.messages.length === 0}>
              Find a company, venue or person…
            </button>
          </div>
        </div>
      )}

      {/* ---- people (#214) ---- */}
      <div style={CARD}>
        <div style={H}>People</div>
        {vm.linkedPeople.length === 0 ? (
          <div style={MUTED}>No one linked yet.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {vm.linkedPeople.map((p) => (
              <a
                key={p.id}
                href={`/people/${encodeURIComponent(p.id)}`}
                title={p.primary ? "Primary contact on this thread" : undefined}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#3a3f4a",
                  background: p.primary ? "#f4f0e6" : "#f4f5f7",
                  border: "1px solid #e8eaee",
                  borderRadius: 999,
                  padding: "3px 10px",
                  textDecoration: "none",
                }}
              >
                {p.name}
                {p.primary ? " · primary" : ""}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ---- venue (#124) — read-only; changed in the popup ---- */}
      {vm.resolution === "linked" && vm.customerCard && (
        <div style={CARD}>
          <div style={H}>Venue</div>
          <div style={BODY}>{venueLabel || "No venue"}</div>
          {vm.siteId && (
            <div style={{ ...MUTED, marginTop: 6 }}>Quotes started from this thread carry this venue.</div>
          )}
        </div>
      )}

      {/* ---- linking from (#125) — read-only; the popup's message sets it ---- */}
      {identityMsg && vm.identity && (
        <div style={CARD}>
          <div style={H}>Linking from</div>
          <div style={MUTED}>
            <b>{vm.identity.name || vm.identity.email}</b>, {identityMsg.out ? "out" : "in"},{" "}
            {identityMsg.time}
            {vm.identity.name ? (
              <>
                {" "}· <span style={MONO}>{vm.identity.email}</span>
              </>
            ) : null}
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>}
    </aside>
  );
}
````

- [ ] **Step 6: Wire the reader** (`src/app/(app)/inbox/thread-reader.tsx`).

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
import LinkSidebar from "./link-sidebar";
````

replace with:

````tsx
import LinkSidebar from "./link-sidebar";
import LinkPopup from "./link-popup";
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
  linkOptions,
  onLink,
}: {
  m: MessageVM;
  collapsible: boolean;
  onCollapse: () => void;
  linkOptions: Record<"quote" | "survey" | "inspection" | "project", Opt[]>;
  onLink: (link: { type: string; id: string; label: string } | null) => void;
}) {
````

replace with:

````tsx
  linkOptions,
  onLink,
  onOpenLinks,
}: {
  m: MessageVM;
  collapsible: boolean;
  onCollapse: () => void;
  linkOptions: Record<"quote" | "survey" | "inspection" | "project", Opt[]>;
  onLink: (link: { type: string; id: string; label: string } | null) => void;
  /** #214 — open the Link popup on this message */
  onOpenLinks: () => void;
}) {
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
          <span style={{ fontSize: 11, color: "#aab0bb" }}>{m.time}</span>
          <select
````

replace with:

````tsx
          <span style={{ fontSize: 11, color: "#aab0bb" }}>{m.time}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenLinks();
            }}
            title="Link the people, company and work on this message"
            style={{
              border: "1px solid #e4e7ec",
              borderRadius: 6,
              padding: "2px 8px",
              color: "#3a3f4a",
              fontSize: 10.5,
              fontWeight: 600,
              background: "#fff",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
            }}
          >
            Link…
          </button>
          <select
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
function Conversation({
  messages,
  linkOptions,
  onLink,
}: {
  messages: MessageVM[];
  linkOptions: Record<"quote" | "survey" | "inspection" | "project", Opt[]>;
  onLink: (messageId: string, link: { type: string; id: string; label: string } | null) => void;
}) {
````

replace with:

````tsx
function Conversation({
  messages,
  linkOptions,
  onLink,
  onOpenLinks,
}: {
  messages: MessageVM[];
  linkOptions: Record<"quote" | "survey" | "inspection" | "project", Opt[]>;
  onLink: (messageId: string, link: { type: string; id: string; label: string } | null) => void;
  /** #214 — a message header's "Link…" */
  onOpenLinks: (messageId: string) => void;
}) {
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
        linkOptions={linkOptions}
        onLink={(link) => onLink(m.id, link)}
      />
````

replace with:

````tsx
        linkOptions={linkOptions}
        onLink={(link) => onLink(m.id, link)}
        onOpenLinks={() => onOpenLinks(m.id)}
      />
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
            linkOptions={linkOptions}
            onLink={(link) => onLink(newest.id, link)}
          />
````

replace with:

````tsx
            linkOptions={linkOptions}
            onLink={(link) => onLink(newest.id, link)}
            onOpenLinks={() => onOpenLinks(newest.id)}
          />
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
  // D76 — schedule-site-visit modal
  const [visitOpen, setVisitOpen] = useState(false);
````

replace with:

````tsx
  // D76 — schedule-site-visit modal
  const [visitOpen, setVisitOpen] = useState(false);
  // #214 — the Link popup: which message, and whether a header opened it
  const [linkFor, setLinkFor] = useState<{ messageId: string; fromHeader: boolean } | null>(null);
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
  // #96 §2 / #123 — the link sidebar now owns the "+ Link to work" picker
  // itself (WorkLinkCard, rendered first inside LinkSidebar).
  const sidebar = <LinkSidebar vm={vm} variant={variant} />;
````

replace with:

````tsx
  // #214 — the sidebar is a summary; "Edit links" opens the popup on the
  // identity message, else the newest received one, else the newest.
  const popupDefaultId =
    vm.identityMessageId ||
    [...vm.messages].reverse().find((m) => !m.out)?.id ||
    vm.messages[vm.messages.length - 1]?.id ||
    "";
  const sidebar = (
    <LinkSidebar
      vm={vm}
      variant={variant}
      onEditLinks={() => popupDefaultId && setLinkFor({ messageId: popupDefaultId, fromHeader: false })}
    />
  );
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
            onLink={(messageId, link) => {
              void setMessageLinkAction(vm.id, messageId, link).then(() => router.refresh());
            }}
          />
````

replace with:

````tsx
            onLink={(messageId, link) => {
              void setMessageLinkAction(vm.id, messageId, link).then(() => router.refresh());
            }}
            onOpenLinks={(messageId) => setLinkFor({ messageId, fromHeader: true })}
          />
````

In `src/app/(app)/inbox/thread-reader.tsx`, find:

````tsx
      {variant === "pane" && sidebar}
    </div>
  );
}
````

replace with:

````tsx
      {variant === "pane" && sidebar}
      {linkFor && (
        <LinkPopup
          key={linkFor.messageId}
          vm={vm}
          messageId={linkFor.messageId}
          fromHeader={linkFor.fromHeader}
          onClose={() => setLinkFor(null)}
        />
      )}
    </div>
  );
}
````

- [ ] **Step 7: Run the gates, including the production build**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit
export PATH=$HOME/.local/node/bin:$PATH && LOG=$(mktemp) && npm run test:specs > "$LOG" 2>&1; grep -E "^FAIL|FAILED|ALL PASSED" "$LOG"; grep -c '^PASS' "$LOG"
export PATH=$HOME/.local/node/bin:$PATH && npx eslint "src/app/(app)/inbox/link-popup.tsx" "src/app/(app)/inbox/link-sidebar.tsx" "src/app/(app)/inbox/work-link-card.tsx" "src/app/(app)/inbox/thread-reader.tsx"
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL npm run build 2>&1 | tail -15
```
Expected: tsc silent; `ALL PASSED`, no `FAIL`, PASS = B + 85; eslint exit 0; the build ends with the route table and no `Module not found` / `postgres` / `Can't resolve 'fs'` error. (`env -u DATABASE_URL` keeps `scripts/migrate.mjs` from touching any hosted DB; the build gives each worker a throwaway PGlite datadir.)

If the build fails with a Node-builtin error in a client chunk, a client file imported a server module: re-run the `#214 UI:` assertions (they name the offending import) and change it to a `import type`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/inbox/link-popup.tsx" "src/app/(app)/inbox/link-sidebar.tsx" "src/app/(app)/inbox/work-link-card.tsx" "src/app/(app)/inbox/thread-reader.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(inbox): Link popup from each message; sidebar becomes a summary with Edit links (#214)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Manual check (after Task 5; for the reviewer, not a gate)

Only on a scratch datadir (memory: "Exercising POST routes safely" / "Worktree dev-server browser traps") — never `.data/pglite`. Open a thread → a message header's **Link…** → the popup lists From/To/Cc with company matches; tick a known person (sidebar chip appears; unlinking the primary promotes the next); search "lake" → Company / Venue / Person rows; pick a venue on another company → company + venue both change; an unknown sender with a signature → **Add as contact** is prefilled; a known sender missing a title → **Add missing details** fills only the blank. The footer shows only **Done** (Create task arrives with #215).

## Self-review notes

- Spec coverage: data model (Tasks 1, 3), participants + lazy Cc (1, 4), signature reader + both consumers (2, 4, 5), search (3, 4, 5), popup sections 1–5 (5), sidebar summary + Edit links + linked-people chips (4, 5), new actions `setThreadContactsAction` / `searchLinkTargetsAction` / `fetchMessageCcAction` / `fillContactBlanksAction` (4). "Tasks on this thread" in the sidebar summary is #215's (it owns `tasksForThread`).
- `ReaderVM.contactOptions` (the old "on contact:" picker's data) is no longer read by the sidebar; it stays in the VM untouched to keep this change small.
