# Inbox Round 3 Implementation Plan (PUNCHLIST #123–#128)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put "Link to work" (with a one-click "+ New quote") at the top of the reader sidebar, let a linked thread carry a venue, let the user pick which message's addresses drive linking, make the three Inbox panes resizable with a collapsible folder rail, auto-append a per-user plain-text signature, and name each list row after the last person who responded.

**Architecture:** Every new rule is a pure helper in a DB-free module under `src/lib/` (`inbox-identity`, `inbox-rows`, `inbox-layout`, `inbox-signature`, `inbox-links`, `customer-inputs`) covered by `test:specs`; the stores gain three optional JSON-document fields (`CommThread.siteId` / `identityMessageId`, `CommMessage.fromEmail` / `to`) and store-level helpers in `src/lib/gmail/linking.ts` covered by `test:review:regressions`; server actions stay thin `requireUser` + `visibleTo` wrappers. The sidebar is rebuilt top-to-bottom (Work → Customer → Venue → Linking from → Quick add) around an extracted `WorkLinkCard`; `inbox-shell.tsx` owns a `localStorage`-backed layout with a new `SplitHandle` component; the signature lives as a string in the existing per-user `notif_prefs` row and is plain body text to the composer. Spec: `docs/superpowers/specs/2026-09-21-inbox-round-3-design.md`. Builds on #96 (`docs/superpowers/plans/2026-09-21-inbox-customer-linking-and-label-sync.md`) as re-landed by #120.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite, doc-store JSON documents, server actions, tsx test harnesses

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **No schema migration.** The only DB-shape change is widening `notif_prefs.prefs`' TypeScript `$type` (Task 7) — `$type` is a TS annotation, no SQL changes, so do **not** run `npm run db:generate`. Thread/message fields live inside the JSON document (same call as D140's `resolution`).
- **PGlite is single-process.** `test:specs` is pure. `test:review:regressions` opens its own throwaway DB. Implementers run only: `npx tsc --noEmit -p .`, `npx tsx scripts/test-review-and-spec.ts`, `npm run test:review:regressions`, `npx eslint <files>`. Implementers must **not** run `npm run test:smoke`, `next dev` or `next build` — the controller runs those.
- `requireUser()` on every server action; thread-mutating actions also check `visibleTo(t, me.name)` (`src/lib/stores/comms.ts:378`).
- Timestamps epoch-ms. Ids: comms `C-####`, quotes `Q-####` (base 2041), customers are slugs, `CustomerLocation.id` is the directory id (`sites.legacyLocId ?? sites.id`, `src/lib/stores/customers.ts:67`).
- No hardcoded accent colour — reuse `var(--accent)` / the inline `ACCENT_SOFT` / `ACCENT_INK` constants the Inbox already uses. No emoji in UI copy.
- Every new pure helper goes in its own DB-free module (no `@/db`, no runtime store imports — `import type` from `@/lib/stores/comms` is fine, it is erased).
- Action result shape: `{ ok: true } | { ok: false; error: string }` (`link-actions.ts:29`).
- Spec harness: `ok(cond, msg)` in `scripts/test-review-and-spec.ts`; new synchronous sections go **after** the last `collapseLabelEventsByThread` check (the `ok(collapseLabelEventsByThread([]).length === 0, …)` line, ~3134-3137) and before `async function xlsxFixture()`. Regression harness: `assert` inside `main()` in `scripts/test-review-regressions.ts`, new sections appended before `console.log("review regression checks passed")` (~line 738); `getDoc` is already in scope there (`const { getDoc } = await import("@/db/doc-store")`, line 164).
- `git add` only the files each task names. Commit after every task with the trailer shown.
- Line numbers below are as of commit `f657847` on `punch-2026-09-21-round-2`; later tasks shift them — the anchors (quoted code) are authoritative.

---

## File Structure

**Created**
- `src/lib/inbox-identity.ts` — pure identity-source helpers: `identityAddressFor`, `resolveAddressFor`, `firstRecipient`.
- `src/lib/customer-inputs.ts` — pure doc → save-input mappers `toLocationInput` / `toContactInput` shared by the Inbox quick-add and the quote intake (fixes the dropped `locationName`).
- `src/lib/inbox-links.ts` — pure `LINK_TYPE_OPTIONS` (now with `lead`), `newQuoteHref`, `quoteNameFromSubject`.
- `src/app/(app)/inbox/sidebar-styles.ts` — the sidebar's shared inline style constants (moved out of `link-sidebar.tsx`).
- `src/app/(app)/inbox/work-link-card.tsx` — the "Work" card: link chip, picker, "+ New quote".
- `src/lib/inbox-rows.ts` — pure `rowName` (last non-me author + Gmail-style chain).
- `src/lib/inbox-layout.ts` — pure `clampLayout` / `parseLayout` + width constants + storage key.
- `src/components/split-handle.tsx` — pointer + keyboard `SplitHandle` (`role="separator"`).
- `src/lib/inbox-signature.ts` — pure signature block/add/strip helpers + `SIGNATURE_MAX`.
- `src/app/(app)/account/signature-card.tsx` — Account → "Email signature" textarea + preview.

**Modified**
- `src/lib/stores/comms.ts` — `CommMessage.fromEmail`/`to`, `CommThread.siteId`/`identityMessageId`, `resolveCustomerId` honours the identity address.
- `src/lib/gmail/bridge.ts` — stamps `fromEmail`/`to` on imported messages.
- `src/lib/gmail/linking.ts` — resolver keyed off `resolveAddressFor`; `setIdentityMessage`, `setThreadSite`, `linkThreadToNewQuote`; `linkThread` / `applyResweepPatch` clear `siteId` on customer change.
- `src/lib/gmail/label-interpret.ts` — customer-label removal also clears `siteId`.
- `src/app/(app)/inbox/link-actions.ts` — `setThreadSiteAction`, `setIdentityMessageAction`; identity-aware link; `quickAddVenueAction` returns the new site id and can attach it to the thread; uses the shared mappers.
- `src/app/(app)/inbox/types.ts` — `ReaderVM.siteId/siteOptions/identityMessageId/identity`, `linkOptions.lead`; `ThreadRowVM.primaryName/chain`.
- `src/app/(app)/inbox/page.tsx` — VM fields, lead options/href/colour, `rowName`, signature, split-handle CSS.
- `src/app/(app)/inbox/link-sidebar.tsx` — new section order, Venue + Linking-from cards, identity-aware sender.
- `src/app/(app)/inbox/thread-reader.tsx` — picker removed (lives in `WorkLinkCard`); signature seeding + toggle.
- `src/app/(app)/inbox/inbox-shell.tsx` — layout state + handles + collapsible rail; passes `signature`.
- `src/app/(app)/inbox/thread-list.tsx` — `width` prop; row renders `primaryName` + `chain`.
- `src/app/(app)/inbox/compose-modal.tsx` — signature seeding + toggle.
- `src/app/(app)/quotes/new/types.ts` — `IntakeInitial`, `intakeInitialState`, `IntakeSubmit.threadId`.
- `src/app/(app)/quotes/new/page.tsx` — reads `customer=` / `contact=` / `site=` / `thread=`.
- `src/app/(app)/quotes/new/intake-form.tsx` — pre-filled state, thread-aware copy, `threadId` in the payload.
- `src/app/(app)/quotes/new/actions.ts` — with `thread=`: mint the draft quote, link the thread, return to `/inbox?thread=`; shared mappers.
- `src/db/doc-tables.ts` — `notif_prefs.prefs` `$type` widened to `Record<string, boolean | string>`.
- `src/lib/stores/notif-prefs.ts` — `signatureFor` / `setSignature`.
- `src/app/(app)/account/actions.ts` — `saveSignatureAction`; `src/app/(app)/account/page.tsx` — renders `SignatureCard`.
- `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`, `scripts/smoke-routes.ts`.
- `DECISIONS.md` (D158), `PUNCHLIST.md` (#123–#128 → DONE), `docs/superpowers/specs/2026-09-21-inbox-round-3-design.md` (implementation notes).

---

### Task 1: Identity source — thread/message fields, pure `identityAddressFor`, resolver honours it

**Files:**
- Create: `src/lib/inbox-identity.ts`
- Modify: `src/lib/stores/comms.ts:205-223` (`CommMessage`), `:277-289` (`CommThread` tail), `:1646-1657` (`resolveCustomerId`)
- Modify: `src/lib/gmail/bridge.ts:187-198` (the `msg` literal in `recordMessage`)
- Modify: `src/lib/gmail/linking.ts:5-21` (imports), `:66-78` (`applyResweepPatch`), `:80-86` (`matchesFilter`), `:91-141` (`resweepThreads`), `:228-244` (`linkThread`), append `setThreadSite` + `setIdentityMessage`
- Modify: `src/lib/gmail/label-interpret.ts:234-238`
- Test: `scripts/test-review-and-spec.ts` (section "Inbox round 3 — identity source") / `scripts/test-review-regressions.ts`

**Interfaces:**
- Consumes: `parseAddress(raw): { name; email }` (`src/lib/gmail/mime.ts:140`, DB-free — its only import is `import type` from `./api`); `resolveForThread(email)`, `applyResolution(t, r)`, `applyResweepPatch(d, next)`, `resolveSender` (`src/lib/gmail/linking.ts`, `resolve.ts`); `patchDoc`/`getDoc`/`listDocs` (`src/db/doc-store.ts`).
- Produces (`src/lib/inbox-identity.ts`):
  ```ts
  export type IdentityAddress = { email: string; name: string; messageId: string };
  export function firstRecipient(to: string | undefined | null): { name: string; email: string } | null;
  export function identityAddressFor(t: Pick<CommThread, "identityMessageId" | "messages" | "contactEmail" | "contactName">): IdentityAddress | null;
  export function resolveAddressFor(t: same): string;   // identity email, else lowercased contactEmail, else ""
  ```
- Produces (`src/lib/gmail/linking.ts`):
  ```ts
  export async function setThreadSite(threadId: string, siteId: string | null): Promise<CommThread | null>;
  export async function setIdentityMessage(threadId: string, messageId: string | null): Promise<CommThread | null>;
  ```
- Produces (`src/lib/stores/comms.ts`): `CommMessage.fromEmail?: string`, `CommMessage.to?: string`, `CommThread.siteId?: string | null`, `CommThread.identityMessageId?: string | null`.

Findings this task is built on: `CommMessage` (`comms.ts:205-223`) stores only `author` — no addresses — so an outbound message has nothing to read a recipient from until the bridge stamps `to`; `resolveForThread` takes an **email string**, not a thread (`linking.ts:23`); the spec's `LINK_TYPES` constant does not exist anywhere in `src/` (the picker list is `LINK_TYPE_OPTIONS` in `thread-reader.tsx:25-30`, handled in Task 3).

- [ ] **Step 1: Write the failing spec test.** In `scripts/test-review-and-spec.ts` add to the import block near line 21:

```ts
import { identityAddressFor, resolveAddressFor, firstRecipient } from "@/lib/inbox-identity";
```

and extend the existing comms import at line 1529 to `import { participantsFor, deriveStatus, type CommMessage, type CommThread } from "@/lib/stores/comms";` (one import per module — the lint config flags duplicates), then insert this synchronous section after the last `collapseLabelEventsByThread` check (before `async function xlsxFixture()`):

```ts
/* ---- Inbox round 3 (#125) — identity source ---- */
{
  const r3msgs: CommMessage[] = [
    { id: "m1", at: 1, direction: "in", channel: "email", author: "Brenda Gauchel", body: "", fromEmail: "brenda@lakefront.k12.mn.us" },
    { id: "m2", at: 2, direction: "out", channel: "email", author: "Jeff Chesebro", body: "", to: "AP Clerk <AP@Lakefront.K12.MN.US>, brenda@lakefront.k12.mn.us" },
    { id: "m3", at: 3, direction: "in", channel: "email", author: "Chris Hale", body: "", fromEmail: "Chris.Hale@Architects.com" },
    { id: "m4", at: 4, direction: "out", channel: "email", author: "Jeff Chesebro", body: "" },
    { id: "m5", at: 5, direction: "in", channel: "email", author: "Legacy Import", body: "" },
  ];
  const r3base: Pick<CommThread, "identityMessageId" | "messages" | "contactEmail" | "contactName"> = {
    identityMessageId: null,
    messages: r3msgs,
    contactEmail: "Brenda@Lakefront.k12.mn.us",
    contactName: "Brenda Gauchel",
  };
  ok(identityAddressFor(r3base) === null, "identityAddressFor: no identity message → null");
  ok(identityAddressFor({ ...r3base, identityMessageId: "nope" }) === null, "identityAddressFor: missing id → null");
  const r3in = identityAddressFor({ ...r3base, identityMessageId: "m3" });
  ok(r3in?.email === "chris.hale@architects.com" && r3in.name === "Chris Hale" && r3in.messageId === "m3", "identityAddressFor: inbound → its From, lowercased");
  const r3out = identityAddressFor({ ...r3base, identityMessageId: "m2" });
  ok(r3out?.email === "ap@lakefront.k12.mn.us" && r3out.name === "AP Clerk", "identityAddressFor: outbound → first recipient of To");
  const r3outNoTo = identityAddressFor({ ...r3base, identityMessageId: "m4" });
  ok(r3outNoTo?.email === "brenda@lakefront.k12.mn.us" && r3outNoTo.name === "Brenda Gauchel", "identityAddressFor: outbound without stored recipients → thread contact");
  ok(identityAddressFor({ ...r3base, identityMessageId: "m5" })?.email === "brenda@lakefront.k12.mn.us", "identityAddressFor: legacy inbound without fromEmail → thread contact");
  ok(identityAddressFor({ ...r3base, identityMessageId: "m4", contactEmail: "" }) === null, "identityAddressFor: nothing to read → null");
  ok(resolveAddressFor(r3base) === "brenda@lakefront.k12.mn.us", "resolveAddressFor: counterpart by default (lowercased)");
  ok(resolveAddressFor({ ...r3base, identityMessageId: "m3" }) === "chris.hale@architects.com", "resolveAddressFor: identity message wins");
  ok(resolveAddressFor({ ...r3base, contactEmail: "" }) === "", "resolveAddressFor: no address → empty string");
  ok(firstRecipient(" , Nobody <>, Someone <s@x.org>")?.email === "s@x.org", "firstRecipient: skips empty parts");
  ok(firstRecipient("") === null && firstRecipient(undefined) === null, "firstRecipient: empty → null");
}
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `Cannot find module '@/lib/inbox-identity'`.

- [ ] **Step 3: Implement.**

`src/lib/stores/comms.ts` — in `CommMessage`, after `gmailLabelIds?: string[];` (line 222):

```ts
  /** #125 — the addresses this message actually carried, stamped by the
   *  Gmail bridge on import. `fromEmail` is lowercased; `to` is the raw To
   *  header ("Name <a@b>, c@d"). Absent on app-sent and pre-#125 messages —
   *  readers fall back to the thread's contactEmail (see lib/inbox-identity). */
  fromEmail?: string;
  to?: string;
```

In `CommThread`, after `peakLabelsAppliedAt?: number;` (line 288):

```ts
  /** #124 — the linked venue: a CustomerLocation.id (directory id) of the
   *  linked customer. Cleared whenever customerId changes to a different
   *  customer (linkThread / applyResweepPatch / Peak label removal). */
  siteId?: string | null;
  /** #125 — identity source: the message whose addresses drive resolution
   *  and quick-add (inbound → its From; outbound → its first recipient).
   *  null/absent = today's behaviour, the thread counterpart. */
  identityMessageId?: string | null;
```

Replace `resolveCustomerId` (lines 1646-1657) with:

```ts
export async function resolveCustomerId(
  t: CommThread | null | undefined
): Promise<string | null> {
  if (!t) return null;
  if (t.customerId) return t.customerId;
  // #125 — the picked identity message's address, else the counterpart.
  const { resolveAddressFor } = await import("@/lib/inbox-identity");
  const email = resolveAddressFor(t);
  if (!email) return null;
  const { contactByEmail } = await import("@/lib/identity/lookup");
  const hit = await contactByEmail(email);
  // Two live customers on one address is never a silent pick (#96).
  return hit && !("ambiguous" in hit) ? hit.customerId : null;
}
```

`src/lib/inbox-identity.ts` (new):

```ts
/**
 * #125 — identity source. A thread resolves (and quick-adds) from ONE
 * address: by default the thread counterpart (`contactEmail`); when the
 * user picks a message in the sidebar's "Linking from", that message's own
 * address — its From for inbound, its first recipient for outbound — with
 * the thread contact as the fallback for messages that stored no address
 * (app-sent replies, pre-#125 imports). Pure: `parseAddress` is the only
 * runtime import and it is DB-free, so test:specs covers this file.
 */
import type { CommMessage, CommThread } from "@/lib/stores/comms";
import { parseAddress } from "@/lib/gmail/mime";

export type IdentityAddress = { email: string; name: string; messageId: string };

export type IdentityThread = Pick<
  CommThread,
  "identityMessageId" | "messages" | "contactEmail" | "contactName"
>;

function lc(s: string | undefined | null): string {
  return (s || "").trim().toLowerCase();
}

/** First non-empty address in a To header ("AP <ap@x.org>, b@x.org"). */
export function firstRecipient(
  to: string | undefined | null
): { name: string; email: string } | null {
  for (const part of (to || "").split(",")) {
    const a = parseAddress(part);
    if (a.email) return a;
  }
  return null;
}

export function identityAddressFor(t: IdentityThread): IdentityAddress | null {
  const id = t.identityMessageId;
  if (!id) return null;
  const m: CommMessage | undefined = (t.messages || []).find((x) => x.id === id);
  if (!m) return null;
  if (m.direction === "in") {
    const email = lc(m.fromEmail) || lc(t.contactEmail);
    return email ? { email, name: m.author || t.contactName || "", messageId: m.id } : null;
  }
  const r = firstRecipient(m.to);
  const email = r ? r.email : lc(t.contactEmail);
  if (!email) return null;
  return { email, name: r ? r.name : t.contactName || "", messageId: m.id };
}

/** The address the resolver keys off: the identity message's when one is
 *  picked, else the thread counterpart. "" when the thread has neither. */
export function resolveAddressFor(t: IdentityThread): string {
  return identityAddressFor(t)?.email ?? lc(t.contactEmail);
}
```

`src/lib/gmail/bridge.ts` — in `recordMessage`, extend the `msg` literal (lines 187-198) with two fields after `gmailLabelIds`:

```ts
    gmailLabelIds: p.labelIds.length ? p.labelIds : undefined,
    // #125 — keep the addresses so a picked identity message can be resolved
    fromEmail: p.from.email || undefined,
    to: p.to || undefined,
```

`src/lib/gmail/linking.ts`:

Add to the imports (after `import { resolveSender, type Resolution } from "./resolve";`):

```ts
import { resolveAddressFor } from "@/lib/inbox-identity";
```

and change the doc-store import on line 5 to `import { getDoc, listDocs, patchDoc } from "@/db/doc-store";`.

Replace `applyResweepPatch` (lines 66-78):

```ts
export function applyResweepPatch(d: CommThread, next: CommThread): boolean {
  // A manual link landed since we listed — keep it.
  if (d.customerId && d.resolution === "linked") return false;
  // Fresh doc has a customer the snapshot didn't — never downgrade.
  if (d.customerId && !next.customerId) return false;
  // #124 — a venue belongs to one customer; a different customer drops it.
  if (d.customerId !== next.customerId) d.siteId = null;
  d.customerId = next.customerId;
  d.customer = next.customer;
  d.resolvedContactId = next.resolvedContactId ?? null;
  d.resolution = next.resolution;
  d.suggestedCustomerId = next.suggestedCustomerId ?? null;
  d.candidates = next.candidates ?? [];
  return true;
}
```

Replace `matchesFilter` (lines 80-86):

```ts
function matchesFilter(t: CommThread, f?: { email?: string; domain?: string }): boolean {
  if (!f) return true;
  const e = resolveAddressFor(t); // #125 — the picked identity message, else the counterpart
  if (f.email && e !== f.email.toLowerCase()) return false;
  if (f.domain && domainOf(e) !== f.domain.toLowerCase()) return false;
  return true;
}
```

In `resweepThreads` (lines 91-141) make three substitutions: the candidate filter's last clause `!!t.contactEmail` → `!!resolveAddressFor(t)`; `const addresses = candidates.map((t) => (t.contactEmail || "").trim().toLowerCase());` → `const addresses = candidates.map((t) => resolveAddressFor(t));`; and `const r = await resolveSender(t.contactEmail || "", lookups);` → `const r = await resolveSender(resolveAddressFor(t), lookups);`. Nothing else in the function changes.

Replace the `patchDoc` callback body inside `linkThread` (lines 234-241) with:

```ts
  await patchDoc<CommThread>("comms", threadId, (d) => {
    // #124 — a venue belongs to one customer; a different customer drops it.
    if (d.customerId !== customerId) d.siteId = null;
    d.customerId = customerId;
    d.customer = name;
    d.resolvedContactId = contactId ?? d.resolvedContactId ?? null;
    d.resolution = "linked";
    d.suggestedCustomerId = null;
    d.candidates = [];
  });
```

Append to the end of `linking.ts`:

```ts
/** #124 — stamp (or clear) the thread's venue. Validation (the site belongs
 *  to the linked customer) is the action's job; this is the store write. */
export async function setThreadSite(
  threadId: string,
  siteId: string | null
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (d) => {
    d.siteId = siteId || null;
  });
}

/** #125 — pick which message's addresses drive resolution, then re-resolve
 *  this one thread from that address. An unknown message id clears the pick.
 *  Never downgrades a linked thread (applyResweepPatch's guards); a fresh
 *  identity resets "Not them" because the old dismissal was about the old
 *  party's suggestion. */
export async function setIdentityMessage(
  threadId: string,
  messageId: string | null
): Promise<CommThread | null> {
  const t = await getDoc<CommThread>("comms", threadId);
  if (!t) return null;
  const id =
    messageId && (t.messages || []).some((m) => m.id === messageId) ? messageId : null;
  const probe: CommThread = { ...t, identityMessageId: id, suggestionDismissed: false };
  const address = resolveAddressFor(probe);
  const next: CommThread = { ...probe };
  await applyResolution(
    next,
    address ? await resolveForThread(address) : ({ kind: "unknown" } as const)
  );
  let linkedNow = false;
  const res = await patchDoc<CommThread>("comms", threadId, (d) => {
    d.identityMessageId = id;
    d.suggestionDismissed = false;
    if (applyResweepPatch(d, next)) linkedNow = d.resolution === "linked" && !!d.customerId;
  });
  if (linkedNow) {
    // Lazy import — same reason as resweepThreads (label-sync ↔ linking cycle).
    const { queueLabelSync } = await import("./label-sync");
    queueLabelSync(threadId);
  }
  return res;
}
```

`src/lib/gmail/label-interpret.ts` — in the customer-removal patch (lines 234-238) add one line so it reads:

```ts
        await patchDoc<CommThread>("comms", t.id, (d) => {
          d.customerId = null;
          d.customer = "";
          d.resolution = "unknown";
          d.siteId = null; // #124 — no customer, no venue
        });
```

- [ ] **Step 4: Regression test.** In `scripts/test-review-regressions.ts` append inside `main()` before `console.log("review regression checks passed")`:

```ts
  // ---- Inbox round 3 (#124/#125) — identity source + venue on the thread ----
  const { setIdentityMessage, setThreadSite } = await import("@/lib/gmail/linking");
  const r3now = Date.now();
  await upsertDoc("comms", {
    id: "C-r3id", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: true, archived: false,
    customerId: null, customer: "", contactName: "New Person", contactEmail: "np@r3unknown.org",
    subject: "Forwarded quote", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [
      { id: "m1", at: r3now - 3000, direction: "in", channel: "email", author: "New Person", body: "x", fromEmail: "np@r3unknown.org" },
      { id: "m2", at: r3now - 2000, direction: "out", channel: "email", author: "Jeff Chesebro", body: "y", to: "Someone <someone@t96district.org>" },
      { id: "m3", at: r3now - 1000, direction: "in", channel: "email", author: "Brenda Gauchel", body: "z", fromEmail: "brenda.t96@lakefront.k12.mn.us" },
    ],
    createdAt: r3now, updatedAt: r3now, resolution: "unknown",
  } as any);
  // outbound → its first recipient; t96district.org is claimed by lakefront (manual, above) → suggestion
  await setIdentityMessage("C-r3id", "m2");
  let r3t = await getDoc<any>("comms", "C-r3id");
  assert.equal(r3t?.identityMessageId, "m2", "#125 setIdentityMessage stamps the picked message");
  assert.equal(r3t?.resolution, "suggested", "#125 an outbound identity message resolves from its recipient (domain claim → suggestion)");
  assert.equal(r3t?.suggestedCustomerId, "lakefront", "#125 …naming the domain owner");
  // a re-sweep over that domain keeps the picked message and changes nothing
  const r3n = await resweepThreads({ domain: "t96district.org" });
  r3t = await getDoc<any>("comms", "C-r3id");
  assert.equal(r3t?.identityMessageId, "m2", "#125 re-sweep keeps the picked identity message");
  assert.equal(r3t?.resolution, "suggested", "#125 re-sweep is idempotent on the identity-resolved thread");
  void r3n;
  // inbound → its From; Brenda is a live contact of lakefront → links directly
  await setIdentityMessage("C-r3id", "m3");
  r3t = await getDoc<any>("comms", "C-r3id");
  assert.equal(r3t?.resolution, "linked", "#125 an inbound identity message resolves from its From (contact → linked)");
  assert.equal(r3t?.customerId, "lakefront", "#125 …and links the thread");
  // back to the thread contact: a linked thread keeps its customer (never downgraded)
  await setIdentityMessage("C-r3id", null);
  r3t = await getDoc<any>("comms", "C-r3id");
  assert.equal(r3t?.identityMessageId, null, "#125 clearing the identity message falls back to the thread contact");
  assert.equal(r3t?.customerId, "lakefront", "#125 clearing never downgrades a linked thread");
  await setIdentityMessage("C-r3id", "no-such-message");
  r3t = await getDoc<any>("comms", "C-r3id");
  assert.equal(r3t?.identityMessageId, null, "#125 an unknown message id is treated as null");

  // #124 — siteId follows the customer
  await upsertDoc("comms", {
    id: "C-r3site", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
    customerId: "lakefront", customer: "Lakefront", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
    subject: "Venue", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [], createdAt: r3now, updatedAt: r3now, resolution: "linked",
  } as any);
  await setThreadSite("C-r3site", "loc1");
  assert.equal((await getDoc<any>("comms", "C-r3site"))?.siteId, "loc1", "#124 setThreadSite stamps siteId");
  await linkThread("C-r3site", "lakefront");
  assert.equal((await getDoc<any>("comms", "C-r3site"))?.siteId, "loc1", "#124 re-linking the same customer keeps the venue");
  await linkThread("C-r3site", "other");
  assert.equal((await getDoc<any>("comms", "C-r3site"))?.siteId, null, "#124 linking a different customer clears the venue");
  await setThreadSite("C-r3site", null);
  assert.equal((await getDoc<any>("comms", "C-r3site"))?.siteId, null, "#124 setThreadSite(null) clears");
```

(`linkThread` and `resweepThreads` are already in scope in `main()` — lines 11 and 246.)

- [ ] **Step 5: Run tests, expect pass.** `npx tsx scripts/test-review-and-spec.ts | grep -E 'identityAddressFor|resolveAddressFor|firstRecipient|ALL PASSED'` → 12 PASS + `ALL PASSED`. `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed`. `npx tsc --noEmit -p . | tail -3` → empty. `npx eslint src/lib/inbox-identity.ts src/lib/gmail/linking.ts src/lib/stores/comms.ts src/lib/gmail/bridge.ts src/lib/gmail/label-interpret.ts` → clean.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/inbox-identity.ts src/lib/stores/comms.ts src/lib/gmail/bridge.ts src/lib/gmail/linking.ts src/lib/gmail/label-interpret.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(inbox): identity source — siteId/identityMessageId on the thread, message addresses, resolver keyed off the picked message (#124 #125)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Server actions — `setThreadSiteAction`, `setIdentityMessageAction`, venue quick-add keeps `locationName`, identity-aware linking

**Files:**
- Create: `src/lib/customer-inputs.ts`
- Modify: `src/app/(app)/inbox/link-actions.ts:10-27` (imports), `:32-59` (delete the private `toLocationInput`/`toContactInput`), `:64-100` (`linkThreadToCustomerAction`), `:208-246` (`quickAddVenueAction`), append two actions
- Modify: `src/app/(app)/quotes/new/actions.ts:1-46` (imports + delete its private mappers)
- Test: `scripts/test-review-and-spec.ts` (section "Inbox round 3 — customer inputs") / `scripts/test-review-regressions.ts`

**Interfaces:**
- Consumes: `identityAddressFor`, `resolveAddressFor` (Task 1); `setThreadSite`, `setIdentityMessage`, `linkThread` (`src/lib/gmail/linking.ts`); `visibleTo`, `resolveCustomerId`, `get as getThread` (`src/lib/stores/comms.ts`); `get as getCustomer` (`src/lib/stores/customers.ts:368`); `LocationInput`/`ContactInput` (`src/app/(app)/companies/types.ts:6-27`, a types-only module).
- Produces (`src/lib/customer-inputs.ts`): `toLocationInput(l: CustomerLocation): LocationInput`, `toContactInput(c: CustomerContact): ContactInput`.
- Produces (`link-actions.ts`, all `"use server"`):
  ```ts
  setThreadSiteAction(threadId: string, siteId: string | null): Promise<R>
  setIdentityMessageAction(threadId: string, messageId: string | null): Promise<R>
  quickAddVenueAction(input: { customerId; label; city; state; threadId?: string }): Promise<{ ok: true; siteId: string | null } | { ok: false; error: string }>
  ```

Finding: `link-actions.ts:34-49` already maps `locationName` (the #120 re-land fixed it there), but the quote intake's private copy (`quotes/new/actions.ts:22-35`) still drops it — and `writeRecord` is a full replace of the customer's sites (`customers.ts:519-545`), so every intake save wiped `locationName` off every existing venue. One shared mapper fixes both.

- [ ] **Step 1: Write the failing spec test.** Add to the imports of `scripts/test-review-and-spec.ts`:

```ts
import { toLocationInput, toContactInput } from "@/lib/customer-inputs";
```

and the section (after the identity section from Task 1):

```ts
/* ---- Inbox round 3 (#96 follow-up) — shared customer save-input mappers ---- */
{
  const r3loc = toLocationInput({
    id: "loc1", locationName: "Main campus", label: "Auditorium", primary: true,
    address: "1 Main St", city: "Duluth", state: "MN", lat: "46.78", lng: null,
    venueKind: "proscenium", travelMiles: 12, travelMin: 20,
  });
  ok(r3loc.locationName === "Main campus" && r3loc.id === "loc1", "toLocationInput keeps id + locationName");
  ok(r3loc.lat === 46.78 && r3loc.lng === null && r3loc.travelMiles === 12, "toLocationInput converts coords, keeps travel");
  ok(toLocationInput({ primary: false, venueKind: "", travelMiles: null, travelMin: null }).venueKind === "proscenium", "toLocationInput defaults venueKind");
  ok(toLocationInput({ primary: false, venueKind: "x", travelMiles: null, travelMin: null, lat: "" }).lat === null, "toLocationInput: blank lat → null");
  const r3ct = toContactInput({ name: "Brenda Gauchel", role: "", email: "b@x.org", primary: true });
  ok(r3ct.name === "Brenda Gauchel" && r3ct.phone === "" && r3ct.primary === true, "toContactInput fills phone and keeps primary");
}
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `Cannot find module '@/lib/customer-inputs'`.

- [ ] **Step 3: Implement.**

`src/lib/customer-inputs.ts` (new):

```ts
/**
 * Doc-shape → save-input mapping shared by every screen that appends to a
 * customer through saveCustomerAction (Inbox quick-add venue, quote intake).
 * saveCustomerAction → writeRecord is a FULL REPLACE of the customer's
 * sites, so every field the doc carries has to round-trip — `locationName`
 * was silently dropped by the quote intake's private copy (the #96 review
 * follow-up). Pure: type-only imports.
 */
import type { CustomerContact, CustomerLocation } from "@/lib/stores/customers";
import type { ContactInput, LocationInput } from "@/app/(app)/companies/types";

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toLocationInput(l: CustomerLocation): LocationInput {
  return {
    id: l.id,
    locationName: l.locationName || "",
    label: l.label || "",
    primary: !!l.primary,
    address: l.address || "",
    city: l.city || "",
    state: l.state || "",
    lat: num(l.lat),
    lng: num(l.lng),
    venueKind: l.venueKind || "proscenium",
    travelMiles: l.travelMiles,
    travelMin: l.travelMin,
  };
}

export function toContactInput(c: CustomerContact): ContactInput {
  return {
    name: c.name,
    role: c.role || "",
    email: c.email || "",
    phone: c.phone || "",
    primary: !!c.primary,
  };
}
```

`src/app/(app)/quotes/new/actions.ts` — delete the local `toLocationInput` / `toContactInput` (lines 22-46) and their now-unused type imports (`CustomerContact`, `CustomerLocation` from `@/lib/stores/customers` — keep `get as getCustomer`), and add:

```ts
import { toContactInput, toLocationInput } from "@/lib/customer-inputs";
```

`src/app/(app)/inbox/link-actions.ts` — replace the import block (lines 10-27) with:

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { patchDoc } from "@/db/doc-store";
import { get as getThread, resolveCustomerId, visibleTo } from "@/lib/stores/comms";
import type { CommThread } from "@/lib/stores/comms";
import { get as getCustomer, contactsForId } from "@/lib/stores/customers";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
import type { ContactInput, LocationInput } from "@/app/(app)/companies/types";
import { savePersonAction } from "@/app/(app)/people/actions";
import type { SavePersonInput } from "@/app/(app)/people/types";
import { claimDomain, releaseDomain } from "@/lib/gmail/domains";
import { domainOf, isPublicDomain } from "@/lib/gmail/config";
import {
  linkThread,
  rememberAddress,
  resweepThreads,
  setIdentityMessage,
  setThreadSite,
} from "@/lib/gmail/linking";
import { identityAddressFor, resolveAddressFor } from "@/lib/inbox-identity";
import { toContactInput, toLocationInput } from "@/lib/customer-inputs";
```

Delete the private `toLocationInput` / `toContactInput` (lines 32-59, including the comment above them).

In `linkThreadToCustomerAction` (lines 64-100) replace the body from `let contactId = opts.contactId ?? null;` through the `claimDomain` block with:

```ts
  // #125 — the picked identity message's address, else the thread contact.
  const sender = identityAddressFor(t);
  const senderEmail = resolveAddressFor(t);
  const senderName = sender?.name || t.contactName;
  let contactId = opts.contactId ?? null;
  if (opts.remember && senderEmail) {
    const nameForContact = (opts.contactName || "").trim() || senderName;
    contactId = await rememberAddress(customerId, senderEmail, nameForContact, contactId, {
      id: me.id,
      name: me.name,
    });
  }
  if (opts.claimDomain && senderEmail) {
    const d = domainOf(senderEmail);
    if (d && !isPublicDomain(d)) {
      await claimDomain(d, customerId, "manual", me.name);
      await resweepThreads({ domain: d });
    }
  }
```

Replace `quickAddVenueAction` (lines 204-246) with:

```ts
/** Link sidebar's "new venue" quick-add — appends a location to the
 *  customer through the SAME path the Companies screen and guided quote
 *  intake use (saveCustomerAction — a full replace, so every existing site
 *  is mapped through the shared toLocationInput and keeps its
 *  locationName). Returns the new site's directory id; with `threadId`
 *  (the Venue card's "+ New venue", #124) it also links that venue to the
 *  thread. */
export async function quickAddVenueAction(input: {
  customerId: string;
  label: string;
  city: string;
  state: string;
  threadId?: string;
}): Promise<{ ok: true; siteId: string | null } | { ok: false; error: string }> {
  const me = await requireUser();
  const existing = await getCustomer(input.customerId);
  if (!existing) return { ok: false, error: "Customer not found." };
  const thread = input.threadId ? await getThread(input.threadId) : null;
  if (input.threadId && (!thread || !visibleTo(thread, me.name)))
    return { ok: false, error: "Thread not found." };

  const beforeIds = new Set((existing.locations || []).map((l) => l.id).filter(Boolean));
  const locations: LocationInput[] = (existing.locations || []).map(toLocationInput);
  locations.push({
    label: (input.label || "").trim() || "Venue",
    // First location on the record → primary. Never demotes one that's
    // already there.
    primary: locations.length === 0,
    address: "",
    city: (input.city || "").trim(),
    state: (input.state || "").trim(),
    lat: null,
    lng: null,
    venueKind: "proscenium",
    travelMiles: null,
    travelMin: null,
  });
  const contacts: ContactInput[] = (existing.contacts || []).map(toContactInput);

  const res = await saveCustomerAction({
    id: existing.id,
    name: existing.name,
    type: existing.type || "",
    pricingTier: existing.pricingTier ?? null,
    locations,
    contacts,
  });
  if (!res.ok) return { ok: false, error: "Couldn't save that venue." };

  const after = await getCustomer(existing.id);
  const added = (after?.locations || []).find((l) => !!l.id && !beforeIds.has(l.id));
  const siteId = added?.id || null;
  if (thread && siteId) {
    if (!thread.customerId) await linkThread(thread.id, existing.id, thread.resolvedContactId ?? null);
    await setThreadSite(thread.id, siteId);
  }
  revalidate();
  return { ok: true, siteId };
}
```

Append the two new actions at the end of the file:

```ts
/** #124 — Venue card: stamp (or clear) the thread's venue. The venue must
 *  be one of the linked customer's own locations; a thread that only
 *  resolved read-time (needsAdopt) adopts the customer first so siteId
 *  never exists without a stored customerId. */
export async function setThreadSiteAction(threadId: string, siteId: string | null): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const customerId = t.customerId || (await resolveCustomerId(t));
  if (!customerId) return { ok: false, error: "Link a customer first." };
  const clean = (siteId || "").trim() || null;
  if (clean) {
    const c = await getCustomer(customerId);
    if (!(c?.locations || []).some((l) => l.id === clean))
      return { ok: false, error: "That venue isn't on this customer." };
  }
  if (!t.customerId) await linkThread(threadId, customerId, t.resolvedContactId ?? null);
  await setThreadSite(threadId, clean);
  revalidate();
  return { ok: true };
}

/** #125 — "Linking from" picker: which message's addresses drive resolution
 *  and quick-add. null = the thread contact. Re-resolves this one thread. */
export async function setIdentityMessageAction(
  threadId: string,
  messageId: string | null
): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const id = (messageId || "").trim() || null;
  if (id && !(t.messages || []).some((m) => m.id === id))
    return { ok: false, error: "That message isn't on this thread." };
  await setIdentityMessage(threadId, id);
  revalidate();
  return { ok: true };
}
```

- [ ] **Step 4: Regression test** — the venue path minus the session (`saveCustomerAction` → `upsert` → `writeRecord`; the action is the same mapping over `upsert`). Append inside `main()`:

```ts
  // #96 follow-up / #124 — quick-add venue keeps locationName across the full-replace save
  const { upsert: upsertCustomer, get: getCustomerDoc } = await import("@/lib/stores/customers");
  const { toLocationInput: mapLoc } = await import("@/lib/customer-inputs");
  await upsertCustomer({
    id: "r3-venue-co", name: "R3 Venue Co", type: "school",
    locations: [{ id: "loc1", locationName: "Main campus", label: "Auditorium", primary: true, city: "Duluth", state: "MN", venueKind: "proscenium", travelMiles: null, travelMin: null }],
    contacts: [],
  });
  const r3before = await getCustomerDoc("r3-venue-co");
  assert.equal(r3before?.locations[0]?.locationName, "Main campus", "#124 fixture venue carries locationName");
  const r3locs = (r3before?.locations || []).map(mapLoc);
  assert.equal(r3locs[0]?.locationName, "Main campus", "#124 toLocationInput keeps locationName");
  r3locs.push({ label: "Black box", primary: false, address: "", city: "", state: "", lat: null, lng: null, venueKind: "proscenium", travelMiles: null, travelMin: null });
  await upsertCustomer({ id: "r3-venue-co", name: "R3 Venue Co", type: "school", locations: r3locs, contacts: [] });
  const r3after = await getCustomerDoc("r3-venue-co");
  assert.equal(r3after?.locations.find((l) => l.label === "Auditorium")?.locationName, "Main campus", "#124 the full-replace save keeps locationName on the existing venue");
  assert.ok(r3after?.locations.some((l) => l.label === "Black box" && !!l.id), "#124 the appended venue exists with a directory id");
```

- [ ] **Step 5: Run tests, expect pass.** `npx tsx scripts/test-review-and-spec.ts | grep -E 'toLocationInput|toContactInput|ALL PASSED'` → 5 PASS + `ALL PASSED`; `npm run test:review:regressions 2>&1 | tail -3` → passed; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/customer-inputs.ts "src/app/(app)/inbox/link-actions.ts" "src/app/(app)/quotes/new/actions.ts"` → clean.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/customer-inputs.ts "src/app/(app)/inbox/link-actions.ts" "src/app/(app)/quotes/new/actions.ts" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(inbox): setThreadSite/setIdentityMessage actions, identity-aware linking, venue quick-add keeps locationName (#124 #125)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Sidebar reorder — `WorkLinkCard` on top (with `lead` + "+ New quote"), Venue select + quick-add, "Linking from" picker

**Files:**
- Create: `src/lib/inbox-links.ts`, `src/app/(app)/inbox/sidebar-styles.ts`, `src/app/(app)/inbox/work-link-card.tsx`
- Modify: `src/app/(app)/inbox/types.ts:179` (`linkOptions`), `:191-224` (append `ReaderVM` fields)
- Modify: `src/app/(app)/inbox/page.tsx:1-72` (imports), `:165-181` (`LINK_KIND_COLOR`/`linkHref`), `:599-645` (lead options), `:677-707` (identity + venue VM), `:751-811` (VM literal)
- Modify: `src/app/(app)/inbox/link-sidebar.tsx` (whole file — reordered)
- Modify: `src/app/(app)/inbox/thread-reader.tsx:3-18`, `:25-30`, `:386-388`, `:498-648`, `:821`, `:1223`, `:1228-1239`
- Test: `scripts/test-review-and-spec.ts` (section "Inbox round 3 — work links")

**Interfaces:**
- Consumes: `identityAddressFor`, `resolveAddressFor` (Task 1); `setThreadSiteAction`, `setIdentityMessageAction`, `quickAddVenueAction` (Task 2); `setLinkAction(id, link, adopt)` (`inbox/actions.ts:284`); `getAll as allLeads` (`src/lib/stores/leads.ts:308`, `LeadRecord.customerId/org/contact/stage`); `EntityQuickAdd` + `INPUT` (`src/components/entity-quick-add.tsx`); `CUSTOMER_TYPES` (`@/app/(app)/companies/lib`).
- Produces (`src/lib/inbox-links.ts`):
  ```ts
  export type LinkWorkType = "quote" | "lead" | "survey" | "inspection" | "project";
  export const LINK_TYPE_OPTIONS: Array<{ value: LinkWorkType; label: string }>;
  export function newQuoteHref(p: { threadId: string; customerId: string | null; contactName: string; siteId: string | null }): string;
  ```
- Produces (`sidebar-styles.ts`): `ACCENT_SOFT, ACCENT_INK, CARD, H, MUTED, BODY, MONO, BTN, ACCENT_BTN, PRIMARY, SELECT, CHECK_ROW` (the constants currently at `link-sidebar.tsx:28-83`, unchanged values).
- Produces: `WorkLinkCard({ vm: ReaderVM })` default export; `ReaderVM` gains `siteId: string | null`, `siteOptions: Opt[]`, `identityMessageId: string | null`, `identity: { messageId; name; email } | null`, and `linkOptions: Record<LinkWorkType, Opt[]>`.

Findings: the picker is at `thread-reader.tsx:502-648` (`linkWork`), not the spec's 670-847; `LinkSidebar` currently receives it as `children` and renders it inside the linked card (`link-sidebar.tsx:330-335`) or a fallback card (`:516-524`). The venue list comes from `linkedCustomer.locations` — `all()` composes it from `sitesForCompanies` (`customers.ts:343-366`), so it is exactly `sitesForCompany(customerId)` with one query fewer; `l.id` is the directory id the quote intake's `locationId` uses. Lead deep links are `/leads?lead=<id>` (`leads/page.tsx:234`).

- [ ] **Step 1: Write the failing spec test.** Imports:

```ts
import { LINK_TYPE_OPTIONS, newQuoteHref } from "@/lib/inbox-links";
```

Section (after the Task 2 section):

```ts
/* ---- Inbox round 3 (#123) — work links ---- */
{
  ok(LINK_TYPE_OPTIONS.some((o) => o.value === "lead" && o.label === "Lead"), "LINK_TYPE_OPTIONS lists lead");
  ok(LINK_TYPE_OPTIONS.map((o) => o.value).join(",") === "quote,lead,survey,inspection,project", "LINK_TYPE_OPTIONS order: quote first, lead second");
  ok(
    newQuoteHref({ threadId: "C-1032", customerId: "lakefront", contactName: "Brenda Gauchel", siteId: "loc1" }) ===
      "/quotes/new?customer=lakefront&contact=Brenda+Gauchel&site=loc1&thread=C-1032",
    "newQuoteHref: every prefill, thread last"
  );
  ok(newQuoteHref({ threadId: "C-1032", customerId: null, contactName: "", siteId: null }) === "/quotes/new?thread=C-1032", "newQuoteHref: unlinked thread carries only thread=");
}
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `Cannot find module '@/lib/inbox-links'`.

- [ ] **Step 3: Implement.**

`src/lib/inbox-links.ts` (new):

```ts
/**
 * #123 — work-link vocabulary + the "+ New quote" hand-off URL. Pure (the
 * Inbox client components and page.tsx both import it; test:specs covers it).
 */
export type LinkWorkType = "quote" | "lead" | "survey" | "inspection" | "project";

/** The sidebar's work-link picker. `lead` joins the four the inline picker
 *  had — the Peak/Leads/<id> label interpreter already writes type:"lead". */
export const LINK_TYPE_OPTIONS: Array<{ value: LinkWorkType; label: string }> = [
  { value: "quote", label: "Quote" },
  { value: "lead", label: "Lead" },
  { value: "survey", label: "Survey" },
  { value: "inspection", label: "Inspection" },
  { value: "project", label: "Project" },
];

/** /quotes/new pre-filled from a thread; the intake links the thread to the
 *  quote it mints and returns to /inbox?thread= (quotes/new/actions.ts). */
export function newQuoteHref(p: {
  threadId: string;
  customerId: string | null;
  contactName: string;
  siteId: string | null;
}): string {
  const qs = new URLSearchParams();
  if (p.customerId) qs.set("customer", p.customerId);
  if (p.contactName) qs.set("contact", p.contactName);
  if (p.siteId) qs.set("site", p.siteId);
  qs.set("thread", p.threadId);
  return "/quotes/new?" + qs.toString();
}
```

`src/app/(app)/inbox/sidebar-styles.ts` (new) — move the constants verbatim from `link-sidebar.tsx:28-83`, each prefixed with `export`:

```ts
/** Shared inline styles for the reader's link sidebar cards (#96 §2 / round 3). */
import type { CSSProperties } from "react";
import { INPUT } from "@/components/entity-quick-add";

export const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
export const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

export const CARD: CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  padding: "12px 13px",
  background: "#fff",
};
export const H: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#aab0bb",
  marginBottom: 8,
};
export const MUTED: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 3, lineHeight: 1.45 };
export const BODY: CSSProperties = { fontSize: 12.5, lineHeight: 1.5, color: "#3a3f4a" };
export const MONO: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11.5 };
/** matches the reader's ghost action buttons */
export const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};
/** matches the reader's accent-tinted "+ Link to work" button */
export const ACCENT_BTN: CSSProperties = {
  ...BTN,
  color: ACCENT_INK,
  background: ACCENT_SOFT,
  border: `1px solid ${ACCENT_SOFT}`,
};
export const PRIMARY: CSSProperties = {
  ...BTN,
  color: "#fff",
  background: "var(--accent)",
  border: "1px solid transparent",
};
export const SELECT: CSSProperties = { ...INPUT, padding: "8px 10px", fontSize: 12.5, cursor: "pointer" };
export const CHECK_ROW: CSSProperties = {
  display: "flex",
  gap: 7,
  alignItems: "flex-start",
  fontSize: 12,
  color: "#3a3f4a",
  marginTop: 10,
  lineHeight: 1.4,
  cursor: "pointer",
};
```

`src/app/(app)/inbox/types.ts` — add at the top (after the header comment): `import type { LinkWorkType } from "@/lib/inbox-links";`. Change line 179 to `linkOptions: Record<LinkWorkType, Opt[]>;`. Append inside `ReaderVM` after `contactOptions: Opt[];`:

```ts
  /* ---- round 3 ----
   * #124 siteId: the thread's linked venue (a CustomerLocation.id of the
   * linked customer; null when it isn't among siteOptions any more);
   * #125 identityMessageId + identity: which message's addresses drive
   * resolution and quick-add, resolved server-side by identityAddressFor —
   * null = the thread contact. */
  siteId: string | null;
  siteOptions: Opt[];
  identityMessageId: string | null;
  identity: { messageId: string; name: string; email: string } | null;
```

`src/app/(app)/inbox/page.tsx`:

Extend the existing leads import on line 6 to `import { followUpCount, getAll as allLeads } from "@/lib/stores/leads";` (one import per module — the lint config flags duplicates) and add after line 12 (`getAllProjects`):

```ts
import { identityAddressFor, resolveAddressFor } from "@/lib/inbox-identity";
```

`LINK_KIND_COLOR` (165-171): add `lead: "#c85a3c",` after `quote`. `linkHref` (173-181): add `if (link.type === "lead") return \`/leads?lead=${id}\`;` after the `quote` line.

In the reader block, the `linkOptions` initial literal (599-604) becomes `{ quote: [], lead: [], survey: [], inspection: [], project: [] }`. Replace the `Promise.all` load (610-617) with:

```ts
      const [q, surveys, inspections, p, leads] = await Promise.all([
        allQuotes(),
        allSurveys(),
        allInspections(),
        getAllProjects(),
        allLeads(),
      ]);
      quotes = q;
      projects = p;
```

and add a `lead:` entry to the `linkOptions = {…}` literal, after `quote:`:

```ts
        lead: leads
          .filter((l) => l.customerId === resolvedCid && l.stage !== "won" && l.stage !== "lost")
          .map((l) => ({ value: l.id, label: `${l.id} · ${l.org || l.contact || "Lead"}` })),
```

Replace line 680 (`const senderDomain = domainOf(sel.contactEmail || "");`) with:

```ts
    // #125 — the address that drives linking: the picked identity message's,
    // else the counterpart (same rule resolveCustomerId / resweep use).
    const identity = identityAddressFor(sel);
    const senderEmailLc = resolveAddressFor(sel);
    const senderDomain = domainOf(senderEmailLc);
```

Delete line 707 (`const senderEmailLc = (sel.contactEmail || "").trim().toLowerCase();`). After the `customerCard` const (ends line 731) add:

```ts
    // #124 — the linked customer's venues: the same rows sitesForCompany
    // returns, already composed onto the doc (customers.ts all()); value =
    // CustomerLocation.id, the id the quote intake's locationId uses.
    const siteOptions: Opt[] = (linkedCustomer?.locations || [])
      .filter((l) => !!l.id)
      .map((l) => ({
        value: l.id as string,
        label: [l.label || "Venue", [l.city, l.state].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" — "),
      }));
    const siteId =
      sel.siteId && siteOptions.some((o) => o.value === sel.siteId) ? sel.siteId : null;
```

In the `reader = {…}` literal add after `contactOptions: contactOptionsFor(…),`:

```ts
      siteId,
      siteOptions,
      identityMessageId: sel.identityMessageId ?? null,
      identity,
```

`src/app/(app)/inbox/work-link-card.tsx` (new):

```tsx
"use client";

/**
 * #123 — the sidebar's top card: the thread's work link (quote / lead /
 * survey / inspection / project) with the picker that used to live inline
 * in thread-reader.tsx, plus "+ New quote", which opens the guided quote
 * intake pre-filled from the thread; the intake links the thread to the
 * quote it mints and comes back here (quotes/new/actions.ts).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { setLinkAction } from "./actions";
import { LINK_TYPE_OPTIONS, newQuoteHref, type LinkWorkType } from "@/lib/inbox-links";
import { ACCENT_BTN, BTN, CARD, H, MUTED, SELECT } from "./sidebar-styles";

export default function WorkLinkCard({ vm }: { vm: ReaderVM }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [linkType, setLinkType] = useState<LinkWorkType>("quote");
  const [busy, setBusy] = useState(false);
  const options = open ? vm.linkOptions[linkType] || [] : [];
  // picking a record on an unlinked thread also adopts the resolved customer
  // (port of Comm Thread onLinkRec — unchanged from the inline picker)
  const adopt =
    vm.needsAdopt && vm.resolvedCustomerId
      ? { customerId: vm.resolvedCustomerId, customer: vm.resolvedCustomerName }
      : null;

  const pick = async (id: string) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const opt = options.find((o) => o.value === id);
      await setLinkAction(vm.id, { type: linkType, id, label: opt ? opt.label : id }, adopt);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setLinkAction(vm.id, null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const newQuote = () =>
    router.push(
      newQuoteHref({
        threadId: vm.id,
        customerId: vm.resolvedCustomerId,
        contactName: vm.customerCard?.contactName || "",
        siteId: vm.siteId,
      })
    );

  return (
    <div style={CARD}>
      <div style={H}>Work</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {vm.link && (
          <>
            <a
              href={vm.link.href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                minWidth: 0,
                maxWidth: "100%",
                textDecoration: "none",
                fontSize: 11.5,
                fontWeight: 600,
                color: "#3a3f4a",
                background: "#f4f5f7",
                border: "1px solid #e8eaee",
                borderRadius: 8,
                padding: "6px 10px",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  color: "#fff",
                  background: vm.link.color,
                  padding: "2px 6px",
                  borderRadius: 5,
                  flexShrink: 0,
                }}
              >
                {vm.link.kindLabel}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {vm.link.label}
              </span>
            </a>
            <button
              onClick={remove}
              disabled={busy}
              title="Remove link"
              style={{
                width: 26,
                height: 26,
                flexShrink: 0,
                borderRadius: 7,
                border: "1px solid #e4e7ec",
                background: "#fff",
                color: "#aab0bb",
                fontSize: 14,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </>
        )}
        <button onClick={() => setOpen(!open)} style={ACCENT_BTN}>
          {vm.link ? "Change link" : "+ Link to work"}
        </button>
        <button
          onClick={newQuote}
          title="Start a draft quote for this thread's customer — it links back here"
          style={BTN}
        >
          + New quote
        </button>
      </div>
      {open && (
        <>
          {vm.resolvedCustomerId ? (
            <div style={{ ...MUTED, marginTop: 9 }}>
              Showing{" "}
              <span style={{ fontWeight: 600, color: "#5b616e" }}>{vm.resolvedCustomerName}</span>
              &apos;s quotes, leads, surveys, inspections &amp; projects.
            </div>
          ) : (
            <div style={{ ...MUTED, marginTop: 9 }}>
              Link this thread to a customer first and their records will show here.
            </div>
          )}
          <div style={{ display: "grid", gap: 8, marginTop: 9 }}>
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as LinkWorkType)}
              style={SELECT}
            >
              {LINK_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select value="" onChange={(e) => void pick(e.target.value)} disabled={busy} style={SELECT}>
              <option value="">Select a record…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
```

`src/app/(app)/inbox/thread-reader.tsx` — remove the picker (it now lives in `WorkLinkCard`):
1. Imports (3-18): drop `setLinkAction` from the `./actions` import list; `Opt` is still used by `rosterOptions` — keep it.
2. Delete `LINK_TYPE_OPTIONS` (25-30).
3. Delete the `// link picker` state (386-388).
4. Delete from `const linkRecOptions = linkPickerOpen` (498) through the end of the `sidebar` const (648) and replace with just:
   ```tsx
   const sidebar = <LinkSidebar vm={vm} variant={variant} />;
   ```
   (the two `{variant === "overlay" && sidebar}` / `{variant === "pane" && sidebar}` render sites at 821 and 1223 stay as they are.)
5. Delete `linkSelectStyle` (1228-1239).

`src/app/(app)/inbox/link-sidebar.tsx` — replace the whole file:

```tsx
"use client";

/**
 * #96 §2 / round 3 — the reader's link sidebar, top to bottom:
 *   1. Work        — WorkLinkCard (#123): link chip + picker + "+ New quote"
 *   2. Customer    — one card per resolution state (linked / suggested /
 *                    ambiguous / unknown), unchanged from #96
 *   3. Venue       — (#124) only once linked: the customer's venues + quick-add
 *   4. Linking from— (#125) which message's addresses drive linking
 *   5. Quick add   — contacts + venues once a customer is in play
 *
 * Everything here is display + server-action calls on a server-built
 * ReaderVM: no fetching, no env, no store imports. The sender shown and
 * remembered is the picked identity message's address (vm.identity), else
 * the thread contact.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import EntityQuickAdd, { type QuickAddValues } from "@/components/entity-quick-add";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import type { ReaderVM } from "./types";
import {
  dismissSuggestionAction,
  linkThreadToCustomerAction,
  quickAddContactAction,
  releaseDomainAction,
  quickAddCustomerAction,
  quickAddVenueAction,
  setIdentityMessageAction,
  setThreadSiteAction,
} from "./link-actions";
import WorkLinkCard from "./work-link-card";
import { ACCENT_BTN, BODY, BTN, CARD, CHECK_ROW, H, MONO, MUTED, PRIMARY, SELECT } from "./sidebar-styles";

type ActionResult = { ok: boolean; error?: string };

export default function LinkSidebar({
  vm,
  variant,
}: {
  vm: ReaderVM;
  /** pane → 300px column beside the reader; overlay → full-width block
   *  under the reader header (the 540px overlay can't fit a column) */
  variant: "pane" | "overlay";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"contact" | "venue" | null>(null);
  // Venue card's "+ New venue…" (separate from the quick-add card's + Venue)
  const [venueAdding, setVenueAdding] = useState(false);
  // "Wrong customer?" re-pick on the linked card
  const [changing, setChanging] = useState(false);
  // customer picker value on the unknown card ("__new" opens the quick-add)
  const [pickId, setPickId] = useState("");
  const [remember, setRemember] = useState(true);
  // "on contact" pick for the remembered address — "" = new contact; a
  // value is an existing contact's display name (vm.contactOptions)
  const [contactName, setContactName] = useState("");

  // #125 — the party this thread links from: the picked message's address,
  // else the thread contact. vm.senderDomain already follows the same rule.
  const senderName = vm.identity?.name || vm.contactName;
  const senderEmail = vm.identity?.email || vm.contactEmail;
  const identityMsg = vm.identityMessageId
    ? vm.messages.find((m) => m.id === vm.identityMessageId) || null
    : null;

  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({
    name: "",
    type: CUSTOMER_TYPES[0] || "",
  });
  const [newContact, setNewContact] = useState<QuickAddValues["contact"]>({
    name: senderName,
    role: "",
    email: senderEmail,
    phone: "",
  });
  const [newVenue, setNewVenue] = useState<QuickAddValues["venue"]>({
    label: "",
    city: "",
    state: "",
  });

  const run = (fn: () => Promise<ActionResult>, onSuccess?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error || "Something went wrong.");
        return;
      }
      setAdding(null);
      setChanging(false);
      setPickId("");
      setContactName("");
      onSuccess?.();
      router.refresh();
    });

  const linkTo = (customerId: string, claim: boolean, rememberAddr: boolean) =>
    run(() =>
      linkThreadToCustomerAction(vm.id, customerId, {
        remember: rememberAddr,
        claimDomain: claim,
        contactName: rememberAddr && contactName ? contactName : undefined,
      })
    );

  // the id a quick-add contact/venue lands on; in the ambiguous state the
  // user picks which candidate first (quickAddTarget)
  const [quickAddTarget, setQuickAddTarget] = useState("");
  const targetCustomerId =
    vm.customerCard?.id ||
    vm.suggested?.customerId ||
    (vm.resolution === "ambiguous" && vm.candidates.some((c) => c.customerId === quickAddTarget)
      ? quickAddTarget
      : "");
  const canClaim = !vm.senderIsPublicDomain;
  const domainTag = <span style={MONO}>@{vm.senderDomain}</span>;
  const emailTag = <span style={MONO}>{senderEmail}</span>;

  // withPicker=false on the linked card's "Wrong customer?" — its
  // contactOptions belong to the customer being left, not the new one.
  const rememberRow = (label: React.ReactNode, withPicker = true) => (
    <>
      <label style={CHECK_ROW}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>{label}</span>
      </label>
      {withPicker && remember && vm.contactOptions.length > 0 && (
        <label
          style={{
            display: "flex",
            gap: 7,
            alignItems: "center",
            fontSize: 12,
            color: "#8c919c",
            marginTop: 6,
            marginLeft: 20,
          }}
        >
          <span style={{ flexShrink: 0 }}>on contact:</span>
          <select
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            style={{ ...SELECT, padding: "5px 8px", fontSize: 12, minWidth: 0 }}
          >
            <option value="">New contact</option>
            {vm.contactOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );

  const customerPicker = (value: string, onChange: (v: string) => void, withNew: boolean) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={SELECT}>
      <option value="">Pick a customer…</option>
      {vm.customerOptions.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {withNew && <option value="__new">+ New customer…</option>}
    </select>
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
      {/* ---- 1. work (#123) ---- */}
      <WorkLinkCard vm={vm} />

      {/* ---- 2. customer — linked ---- */}
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
          {vm.customerCard.contactName && (
            <div style={{ ...BODY, marginTop: 8 }}>
              Contact: <b>{vm.customerCard.contactName}</b>
            </div>
          )}
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
                style={{
                  ...BTN,
                  padding: "1px 6px",
                  fontSize: 11,
                  color: "#8c919c",
                }}
              >
                Stop
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {vm.needsAdopt && (
              <button
                style={PRIMARY}
                disabled={pending}
                onClick={() => linkTo(vm.customerCard!.id, false, false)}
              >
                Save link
              </button>
            )}
            <button
              style={BTN}
              disabled={pending}
              onClick={() => {
                setChanging((v) => !v);
                setPickId("");
                setError(null);
              }}
            >
              {changing ? "Keep customer" : "Wrong customer?"}
            </button>
          </div>
          {changing && (
            <div style={{ marginTop: 8 }}>
              {rememberRow(<>Remember {emailTag} on a contact</>, false)}
              <div style={{ marginTop: 8 }}>
                {customerPicker(
                  pickId,
                  (v) => {
                    setPickId(v);
                    if (v) linkTo(v, false, remember);
                  },
                  false
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- 2. customer — suggested ---- */}
      {vm.resolution === "suggested" && vm.suggested && (
        <div style={CARD}>
          <div style={H}>Looks like</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{vm.suggested.name}</div>
          <div style={MUTED}>
            {vm.suggested.contactsAtDomain} contact
            {vm.suggested.contactsAtDomain === 1 ? "" : "s"} at {domainTag}
          </div>
          {rememberRow(<>Remember {emailTag} on a contact</>)}
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

      {/* ---- 2. customer — ambiguous ---- */}
      {vm.resolution === "ambiguous" && (
        <div style={CARD}>
          <div style={H}>Which customer?</div>
          <div style={BODY}>
            {domainTag} is shared by {vm.candidates.length} customers.
          </div>
          {vm.candidates.map((c) => (
            <div
              key={c.customerId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
              }}
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
          {rememberRow(<>Remember {emailTag} on a contact</>)}
        </div>
      )}

      {/* ---- 2. customer — unknown ---- */}
      {vm.resolution === "unknown" && (
        <div style={CARD}>
          <div style={H}>Not linked</div>
          {!senderEmail ? (
            <div style={BODY}>No sender address — link this thread to a customer.</div>
          ) : canClaim ? (
            <div style={BODY}>
              {domainTag} isn&apos;t linked to a customer yet. Link this domain to…
            </div>
          ) : (
            <div style={BODY}>
              Personal address — link this thread to a customer and remember {emailTag} on a
              contact.
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            {customerPicker(
              pickId,
              (v) => {
                setPickId(v);
                setError(null);
              },
              true
            )}
          </div>
          {pickId && pickId !== "__new" && (
            <>
              {senderEmail && rememberRow(<>Remember {emailTag} on a contact</>)}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  style={PRIMARY}
                  disabled={pending}
                  onClick={() => linkTo(pickId, canClaim, remember)}
                >
                  {canClaim ? "Link domain + thread" : "Link thread"}
                </button>
                {canClaim && (
                  <button
                    style={BTN}
                    disabled={pending}
                    title={`Link this thread without claiming @${vm.senderDomain}`}
                    onClick={() => linkTo(pickId, false, remember)}
                  >
                    Link thread only
                  </button>
                )}
              </div>
            </>
          )}
          {pickId === "__new" && (
            <div style={{ marginTop: 10 }}>
              {senderEmail && rememberRow(<>Remember {emailTag} on a contact</>)}
              <div style={{ marginTop: 8 }}>
                <EntityQuickAdd
                  kind="customer"
                  value={newCustomer}
                  onChange={setNewCustomer}
                  submitting={pending}
                  error={error}
                  onCancel={() => {
                    setPickId("");
                    setError(null);
                  }}
                  onSubmit={() =>
                    run(() =>
                      quickAddCustomerAction({
                        ...newCustomer,
                        senderName,
                        senderEmail,
                        remember,
                        threadId: vm.id,
                      })
                    )
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- 3. venue (#124) — only once a customer is linked ---- */}
      {vm.resolution === "linked" && vm.customerCard && (
        <div style={CARD}>
          <div style={H}>Venue</div>
          <select
            value={venueAdding ? "__new" : vm.siteId || ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              setError(null);
              if (v === "__new") {
                setVenueAdding(true);
                return;
              }
              setVenueAdding(false);
              run(() => setThreadSiteAction(vm.id, v || null));
            }}
            style={SELECT}
          >
            <option value="">No venue</option>
            {vm.siteOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="__new">+ New venue…</option>
          </select>
          {venueAdding && (
            <div style={{ marginTop: 8 }}>
              <EntityQuickAdd
                kind="venue"
                value={newVenue}
                onChange={setNewVenue}
                submitting={pending}
                error={error}
                onCancel={() => {
                  setVenueAdding(false);
                  setError(null);
                }}
                onSubmit={() =>
                  run(
                    () =>
                      quickAddVenueAction({
                        customerId: vm.customerCard!.id,
                        ...newVenue,
                        threadId: vm.id,
                      }),
                    () => {
                      setVenueAdding(false);
                      setNewVenue({ label: "", city: "", state: "" });
                    }
                  )
                }
              />
            </div>
          )}
          {vm.siteId && !venueAdding && (
            <div style={{ ...MUTED, marginTop: 6 }}>
              Quotes started from this thread carry this venue.
            </div>
          )}
        </div>
      )}

      {/* ---- 4. linking from (#125) — which message's addresses drive linking ---- */}
      {vm.isEmail && vm.messages.length > 0 && (
        <div style={CARD}>
          <div style={H}>Linking from</div>
          <select
            value={vm.identityMessageId || ""}
            disabled={pending}
            onChange={(e) => {
              setError(null);
              run(() => setIdentityMessageAction(vm.id, e.target.value || null));
            }}
            style={SELECT}
          >
            <option value="">Thread contact — {vm.contactName}</option>
            {[...vm.messages].reverse().map((m) => (
              <option key={m.id} value={m.id}>
                {m.author} · {m.out ? "out" : "in"} · {m.time}
              </option>
            ))}
          </select>
          {identityMsg && vm.identity && (
            <div style={{ ...MUTED, marginTop: 6 }}>
              Linking from: <b>{vm.identity.name || vm.identity.email}</b>,{" "}
              {identityMsg.out ? "out" : "in"}, {identityMsg.time}
              {vm.identity.name ? (
                <>
                  {" "}· <span style={MONO}>{vm.identity.email}</span>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ---- 5. quick add (once a customer is in play; ambiguous picks one first) ---- */}
      {(targetCustomerId || vm.resolution === "ambiguous") &&
        vm.resolution !== "unknown" && (
        <div style={CARD}>
          <div style={H}>Quick add</div>
          {vm.resolution === "ambiguous" && (
            <div style={{ marginBottom: 8 }}>
              <select
                value={quickAddTarget}
                onChange={(e) => {
                  setQuickAddTarget(e.target.value);
                  setAdding(null);
                  setError(null);
                }}
                style={SELECT}
              >
                <option value="">Add to which customer…</option>
                {vm.candidates.map((c) => (
                  <option key={c.customerId} value={c.customerId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              style={adding === "contact" ? ACCENT_BTN : BTN}
              disabled={pending || !targetCustomerId}
              onClick={() => {
                setAdding(adding === "contact" ? null : "contact");
                setError(null);
              }}
            >
              + Contact
            </button>
            <button
              style={adding === "venue" ? ACCENT_BTN : BTN}
              disabled={pending || !targetCustomerId}
              onClick={() => {
                setAdding(adding === "venue" ? null : "venue");
                setError(null);
              }}
            >
              + Venue
            </button>
          </div>
          {adding === "contact" && (
            <div style={{ marginTop: 10 }}>
              <EntityQuickAdd
                kind="contact"
                value={newContact}
                onChange={setNewContact}
                submitting={pending}
                error={error}
                onCancel={() => {
                  setAdding(null);
                  setError(null);
                }}
                onSubmit={() =>
                  run(
                    () => quickAddContactAction({ customerId: targetCustomerId, ...newContact }),
                    () =>
                      setNewContact({
                        name: senderName,
                        role: "",
                        email: senderEmail,
                        phone: "",
                      })
                  )
                }
              />
            </div>
          )}
          {adding === "venue" && (
            <div style={{ marginTop: 10 }}>
              <EntityQuickAdd
                kind="venue"
                value={newVenue}
                onChange={setNewVenue}
                submitting={pending}
                error={error}
                onCancel={() => {
                  setAdding(null);
                  setError(null);
                }}
                onSubmit={() =>
                  run(
                    () => quickAddVenueAction({ customerId: targetCustomerId, ...newVenue }),
                    () => setNewVenue({ label: "", city: "", state: "" })
                  )
                }
              />
            </div>
          )}
        </div>
      )}

      {/* EntityQuickAdd renders the error inside an open form — don't repeat it */}
      {error && !adding && !venueAdding && pickId !== "__new" && (
        <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run tests, expect pass.** `npx tsx scripts/test-review-and-spec.ts | grep -E 'LINK_TYPE_OPTIONS|newQuoteHref|ALL PASSED'` → 4 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty (the `ReaderVM` change forces every VM literal to carry the four new fields — the compiler is the check that page.tsx got them); `npx eslint src/lib/inbox-links.ts "src/app/(app)/inbox/sidebar-styles.ts" "src/app/(app)/inbox/work-link-card.tsx" "src/app/(app)/inbox/link-sidebar.tsx" "src/app/(app)/inbox/thread-reader.tsx" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/types.ts"` → clean (unused-import errors mean a leftover from the removed picker). The controller's browser pass checks the order Work → Customer → Venue → Linking from → Quick add and that picking a message changes the suggestion on a multi-party thread.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/inbox-links.ts "src/app/(app)/inbox/sidebar-styles.ts" "src/app/(app)/inbox/work-link-card.tsx" "src/app/(app)/inbox/link-sidebar.tsx" "src/app/(app)/inbox/thread-reader.tsx" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/types.ts" scripts/test-review-and-spec.ts
git commit -m "feat(inbox): sidebar reorder — Work card on top with lead links + New quote, Venue select/quick-add, Linking-from picker (#123 #124 #125)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: "+ New quote" → `/quotes/new` pre-filled; the intake mints the draft quote, links the thread, returns to the Inbox

**Files:**
- Modify: `src/lib/inbox-links.ts` (append `quoteNameFromSubject`)
- Modify: `src/lib/gmail/linking.ts` (append `linkThreadToNewQuote`)
- Modify: `src/app/(app)/quotes/new/types.ts` (append `IntakeInitial`, `IntakePrefill`, `intakeInitialState`; `IntakeSubmit.threadId`)
- Modify: `src/app/(app)/quotes/new/page.tsx` (whole file is 45 lines — read the four params, pass `initial`)
- Modify: `src/app/(app)/quotes/new/intake-form.tsx:4-8` (imports), `:18-24` (props), `:31`, `:37-38`, `:45-46` (initial state), `:120-138` (payload), `:151-156` (copy), `:379` (button label)
- Modify: `src/app/(app)/quotes/new/actions.ts:1-14` (imports), `:48-52` (capture `me`), the tail before `redirect(builderPath(…))`
- Modify: `scripts/smoke-routes.ts:102`
- Test: `scripts/test-review-and-spec.ts` (section "Inbox round 3 — quote intake hand-off") / `scripts/test-review-regressions.ts`

**Interfaces:**
- Consumes: `create as createQuote(partial: Partial<Quote>)` (`src/lib/stores/quotes.ts:340` — mints `Q-####`, `status: "draft"`, `quoteType`, `category`, `source`, `owner`); `setLink(threadId, link)` (`comms.ts:1603`); `linkThread` (Task 1); `getCustomer`; `saveCustomerAction`; `builderPath` (`quotes/new/types.ts`); `visibleTo`.
- Produces (`inbox-links.ts`): `quoteNameFromSubject(subject: string | null | undefined): string`.
- Produces (`linking.ts`):
  ```ts
  export async function linkThreadToNewQuote(threadId: string, input: {
    customerId: string; customer: string; locationId: string | null; contactName: string;
    quoteType: string; category: string; owner: string;
  }): Promise<{ quoteId: string; name: string } | null>;
  ```
- Produces (`quotes/new/types.ts`):
  ```ts
  export type IntakeInitial = { customerId: string; contactName: string; locationId: string; threadId: string };
  export type IntakePrefill = { customerId: string; locationMode: "pick" | "skip"; locationId: string; contactMode: "pick" | "skip"; contactName: string };
  export function intakeInitialState(customers: IntakeCustomer[], init: IntakeInitial): IntakePrefill;
  ```
  and `IntakeSubmit` gains `threadId?: string`.

Findings that shape this task: the spec says `/quotes/new` "already reads `customer=`" — it does not (`quotes/new/page.tsx` reads only `type`; the form has no initial-customer prop). And `createQuoteIntakeAction` (`quotes/new/actions.ts:48-125`) never creates a quote — it `redirect()`s into a builder with `?customer=`, and every builder mints the quote on its first save. So with `thread=` there is no quote id to link unless the intake mints the draft itself. It does exactly that: `createQuote({...})` with the intake's customer/venue/contact, `quoteType` from the card (`custom` → `"system"` + `category`, the same split `builderPath` makes), `source: "inbox"`, `name` from the thread subject; then `setLink` with the picker's `"<id> · <name>"` label; a thread with no stored customer adopts the intake's (same rule as `setLinkAction`'s adopt); then `redirect("/inbox?thread=<id>")` per spec — the Work chip's href (`/quotes?id=`) reaches the hub's per-type "Open … →" edit link (`quotes/page.tsx:54-65`), and every builder accepts `?id=` with a null engine subdoc (`flame-tests/quote/page.tsx:107-110`, `estimator/page.tsx:175`).

- [ ] **Step 1: Write the failing spec tests.** Imports:

```ts
import { quoteNameFromSubject } from "@/lib/inbox-links";
import { intakeInitialState, type IntakeCustomer } from "@/app/(app)/quotes/new/types";
```

(merge `quoteNameFromSubject` into the existing `@/lib/inbox-links` import line from Task 3.) Section:

```ts
/* ---- Inbox round 3 (#123) — quote intake hand-off ---- */
{
  ok(quoteNameFromSubject("Re: Fwd: Curtain quote for the PAC") === "Curtain quote for the PAC", "quoteNameFromSubject strips Re:/Fwd: prefixes");
  ok(quoteNameFromSubject("RE: re: FW: hello") === "hello", "quoteNameFromSubject strips repeated prefixes case-insensitively");
  ok(quoteNameFromSubject("") === "Untitled estimate" && quoteNameFromSubject("(no subject)") === "Untitled estimate", "quoteNameFromSubject falls back");
  ok(quoteNameFromSubject("Rental for spring musical") === "Rental for spring musical", "quoteNameFromSubject leaves a plain subject alone");
  const r3customers: IntakeCustomer[] = [{
    id: "lakefront", name: "Lakefront ISD", type: "school",
    locations: [{ id: "loc1", label: "Auditorium", city: "Duluth", state: "MN", primary: true }],
    contacts: [{ name: "Brenda Gauchel", role: "Director", primary: true }],
  }];
  const r3full = intakeInitialState(r3customers, { customerId: "lakefront", contactName: "Brenda Gauchel", locationId: "loc1", threadId: "C-1" });
  ok(
    r3full.customerId === "lakefront" && r3full.locationMode === "pick" && r3full.locationId === "loc1" && r3full.contactMode === "pick" && r3full.contactName === "Brenda Gauchel",
    "intakeInitialState: known customer/venue/contact pre-pick"
  );
  const r3partial = intakeInitialState(r3customers, { customerId: "lakefront", contactName: "Nobody", locationId: "loc9", threadId: "" });
  ok(r3partial.customerId === "lakefront" && r3partial.locationMode === "skip" && r3partial.locationId === "" && r3partial.contactMode === "skip" && r3partial.contactName === "", "intakeInitialState: unknown venue/contact fall back to skip");
  const r3none = intakeInitialState(r3customers, { customerId: "ghost", contactName: "Brenda Gauchel", locationId: "loc1", threadId: "" });
  ok(r3none.customerId === "" && r3none.locationMode === "skip" && r3none.contactMode === "skip", "intakeInitialState: unknown customer → nothing pre-picked");
}
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `does not provide an export named 'quoteNameFromSubject'`.

- [ ] **Step 3: Implement.**

Append to `src/lib/inbox-links.ts`:

```ts
/** A draft quote's name from the thread subject — Re:/Fwd: prefixes off,
 *  capped, with the quotes store's own fallback. */
export function quoteNameFromSubject(subject: string | null | undefined): string {
  const s = (subject || "").replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, "").trim();
  return s && s !== "(no subject)" ? s.slice(0, 120) : "Untitled estimate";
}
```

Append to `src/lib/gmail/linking.ts` (add `import { quoteNameFromSubject } from "@/lib/inbox-links";` to its imports):

```ts
/** #123 — "+ New quote" from a thread. The builders mint quotes on their
 *  first save, so the intake mints the draft here to have an id to link:
 *  the thread's work link points at it, and a thread with no stored
 *  customer adopts the intake's (same rule as setLinkAction's adopt).
 *  Lazy imports: comms lazily imports this module, and quotes pulls in the
 *  assignments store — neither belongs in this module's static graph. */
export async function linkThreadToNewQuote(
  threadId: string,
  input: {
    customerId: string;
    customer: string;
    locationId: string | null;
    contactName: string;
    quoteType: string;
    category: string;
    owner: string;
  }
): Promise<{ quoteId: string; name: string } | null> {
  const t = await getDoc<CommThread>("comms", threadId);
  if (!t) return null;
  const { create: createQuote } = await import("@/lib/stores/quotes");
  const { setLink } = await import("@/lib/stores/comms");
  const q = await createQuote({
    name: quoteNameFromSubject(t.subject),
    customer: input.customer,
    customerId: input.customerId,
    locationId: input.locationId,
    contactName: input.contactName,
    quoteType: input.quoteType,
    category: input.category,
    source: "inbox",
    owner: input.owner,
  });
  if (!t.customerId) await linkThread(threadId, input.customerId, t.resolvedContactId ?? null);
  await setLink(threadId, { type: "quote", id: q.id, label: `${q.id} · ${q.name}` });
  return { quoteId: q.id, name: q.name };
}
```

`src/app/(app)/quotes/new/types.ts` — add `threadId?: string;` to `IntakeSubmit` (after `newContactPhone: string;`) with the comment `/** #123 — set when the intake was opened from an Inbox thread ("+ New quote"): the action mints the draft quote, links the thread and returns to the Inbox. */`, and append:

```ts
/** #123 — what the Inbox's "+ New quote" hands over in the URL. */
export type IntakeInitial = {
  customerId: string;
  contactName: string;
  locationId: string;
  threadId: string;
};

export type IntakePrefill = {
  customerId: string;
  locationMode: "pick" | "skip";
  locationId: string;
  contactMode: "pick" | "skip";
  contactName: string;
};

/** Initial form state from the URL prefill — only ids/names that exist on
 *  the directory are pre-picked; anything else falls back to today's
 *  defaults (no customer, venue/contact skipped). Pure. */
export function intakeInitialState(customers: IntakeCustomer[], init: IntakeInitial): IntakePrefill {
  const c = init.customerId ? customers.find((x) => x.id === init.customerId) : undefined;
  if (!c) return { customerId: "", locationMode: "skip", locationId: "", contactMode: "skip", contactName: "" };
  const loc = init.locationId && c.locations.some((l) => l.id === init.locationId) ? init.locationId : "";
  const ct = init.contactName && c.contacts.some((x) => x.name === init.contactName) ? init.contactName : "";
  return {
    customerId: c.id,
    locationMode: loc ? "pick" : "skip",
    locationId: loc,
    contactMode: ct ? "pick" : "skip",
    contactName: ct,
  };
}
```

`src/app/(app)/quotes/new/page.tsx` — replace the file body from `const rawType` onward:

```tsx
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
  const rawType = one(sp.type);
  const initialType: ServiceType = isServiceType(rawType) ? rawType : "system";
  // #123 — the Inbox's "+ New quote" pre-fills who the quote is for and names
  // the thread to link back to (lib/inbox-links newQuoteHref).
  const initial: IntakeInitial = {
    customerId: one(sp.customer),
    contactName: one(sp.contact),
    locationId: one(sp.site),
    threadId: one(sp.thread),
  };

  const customers: IntakeCustomer[] = customerDocs
    .map((c: CustomerDoc) => ({
      id: c.id,
      name: c.name,
      type: c.type || "",
      locations: (c.locations || []).map((l) => ({
        id: l.id || "",
        label: l.label || "",
        city: l.city || "",
        state: l.state || "",
        primary: !!l.primary,
      })),
      contacts: (c.contacts || []).map((ct) => ({
        name: ct.name,
        role: ct.role || "",
        primary: !!ct.primary,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <QuoteIntakeForm customers={customers} initialType={initialType} initial={initial} />;
```

and extend its types import: `import { isServiceType, type IntakeCustomer, type IntakeInitial, type ServiceType } from "./types";`. Update the doc comment's last line to `/quotes/new?type=…&customer=…&contact=…&site=…&thread=…`.

`src/app/(app)/quotes/new/intake-form.tsx`:
- Line 8: `import { intakeInitialState, SERVICE_TYPES, type IntakeCustomer, type IntakeInitial, type IntakeSubmit, type ServiceType } from "./types";`
- Props (18-24): add `initial` —
  ```tsx
  export default function QuoteIntakeForm({
    customers,
    initialType,
    initial,
  }: {
    customers: IntakeCustomer[];
    initialType: ServiceType;
    initial: IntakeInitial;
  }) {
    // #123 — URL prefill (only ids/names that exist are pre-picked)
    const prefill = intakeInitialState(customers, initial);
    const fromThread = !!initial.threadId;
  ```
- Line 31: `const [customerId, setCustomerId] = useState(prefill.customerId);`
- Lines 37-38: `const [locationMode, setLocationMode] = useState<"pick" | "new" | "skip">(prefill.locationMode);` / `const [locationId, setLocationId] = useState(prefill.locationId);`
- Lines 45-46: `const [contactMode, setContactMode] = useState<"pick" | "new" | "skip">(prefill.contactMode);` / `const [contactName, setContactName] = useState(prefill.contactName);`
- Payload (120-138): add `threadId: initial.threadId || undefined,` after `newContactPhone: newContact.phone,`.
- Copy (154-156):
  ```tsx
      <p style={{ fontSize: 13, color: "#8c919c", margin: "0 0 22px" }}>
        {fromThread
          ? "Pick who this is for. A draft quote is created, linked to the email thread, and you land back on the thread."
          : "Pick who this is for, then jump straight into the builder."}
      </p>
  ```
- Button label (379): `{pending ? "Setting up…" : fromThread ? "Create quote & link thread" : "Continue to builder →"}`

`src/app/(app)/quotes/new/actions.ts`:
- Imports: add `import { get as getThread, visibleTo } from "@/lib/stores/comms";` and `import { linkThreadToNewQuote } from "@/lib/gmail/linking";`.
- Line 51: `await requireUser();` → `const me = await requireUser();`
- Replace the tail `if (!customerId) return { ok: false, error: "Pick or create a customer first." };` + `redirect(builderPath(input.type, customerId, category));` with:

```ts
  if (!customerId) return { ok: false, error: "Pick or create a customer first." };

  // #123 — opened from an Inbox thread: mint the draft quote here (the
  // builders only create one on first save), link the thread to it, and go
  // back to the thread. The venue/contact resolve against the record as it
  // stands AFTER the save so a venue/contact added in this same intake counts.
  const threadId = (input.threadId || "").trim();
  if (threadId) {
    const thread = await getThread(threadId);
    if (!thread || !visibleTo(thread, me.name))
      return { ok: false, error: "That email thread couldn't be found — start the quote from the Quotes hub instead." };
    const record = await getCustomer(customerId);
    const newVenueLabel = (input.newLocationLabel || "").trim() || "Venue";
    const locationId =
      input.locationMode === "pick"
        ? (input.locationId || "").trim() || null
        : input.locationMode === "new"
          ? (record?.locations || []).find((l) => (l.label || "") === newVenueLabel)?.id || null
          : null;
    const contactName =
      input.contactMode === "pick"
        ? (input.contactName || "").trim()
        : input.contactMode === "new"
          ? (input.newContactName || "").trim()
          : "";
    const made = await linkThreadToNewQuote(threadId, {
      customerId,
      customer: record?.name || newCustomerName,
      locationId,
      contactName,
      quoteType: input.type === "custom" ? "system" : input.type,
      category: input.type === "custom" ? category : "",
      owner: me.name,
    });
    if (!made) return { ok: false, error: "That email thread couldn't be found." };
    redirect(`/inbox?thread=${encodeURIComponent(threadId)}`);
  }

  redirect(builderPath(input.type, customerId, category));
```

`scripts/smoke-routes.ts` — after `"/quotes/new",` add:

```ts
  // #123 — the Inbox's "+ New quote" hand-off (prefill params are read, never required to match)
  "/quotes/new?customer=lakefront&contact=Brenda%20Gauchel&site=loc1&thread=C-1032",
```

- [ ] **Step 4: Regression test.** Append inside `main()`:

```ts
  // #123 — "+ New quote" from a thread: mint the draft, link the thread, adopt the customer
  const { linkThreadToNewQuote } = await import("@/lib/gmail/linking");
  const { get: getQuoteDoc } = await import("@/lib/stores/quotes");
  await upsertDoc("comms", {
    id: "C-r3quote", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
    customerId: null, customer: "", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
    subject: "Re: Fwd: Curtain quote for the PAC", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [], createdAt: r3now, updatedAt: r3now, resolution: "unknown",
  } as any);
  const r3made = await linkThreadToNewQuote("C-r3quote", {
    customerId: "lakefront", customer: "Lakefront ISD", locationId: "loc1", contactName: "Brenda Gauchel",
    quoteType: "flame_test", category: "", owner: "Tester",
  });
  assert.ok(r3made && r3made.quoteId.startsWith("Q-"), "#123 linkThreadToNewQuote mints a Q- id");
  const r3q = await getQuoteDoc(r3made!.quoteId);
  assert.equal(r3q?.customerId, "lakefront", "#123 the draft carries the intake's customer");
  assert.equal(r3q?.locationId, "loc1", "#123 …and venue");
  assert.equal(r3q?.contactName, "Brenda Gauchel", "#123 …and contact");
  assert.equal(r3q?.quoteType, "flame_test", "#123 …and quote type");
  assert.equal(r3q?.source, "inbox", "#123 source is inbox");
  assert.equal(r3q?.status, "draft", "#123 the quote starts as a draft");
  assert.equal(r3q?.name, "Curtain quote for the PAC", "#123 name comes from the subject, prefixes stripped");
  const r3qt = await getDoc<any>("comms", "C-r3quote");
  assert.equal(r3qt?.link?.type, "quote", "#123 the thread links to a quote");
  assert.equal(r3qt?.link?.id, r3made!.quoteId, "#123 …the minted one");
  assert.equal(r3qt?.link?.label, `${r3made!.quoteId} · Curtain quote for the PAC`, "#123 label matches the picker's format");
  assert.equal(r3qt?.customerId, "lakefront", "#123 an unlinked thread adopts the intake's customer");
  assert.equal(r3qt?.resolution, "linked", "#123 …and reads as linked");
  assert.equal(
    await linkThreadToNewQuote("C-r3-no-such-thread", { customerId: "lakefront", customer: "x", locationId: null, contactName: "", quoteType: "system", category: "", owner: "Tester" }),
    null,
    "#123 unknown thread → null, nothing minted"
  );
```

- [ ] **Step 5: Run tests, expect pass.** `npx tsx scripts/test-review-and-spec.ts | grep -E 'quoteNameFromSubject|intakeInitialState|ALL PASSED'` → 7 PASS + `ALL PASSED`; `npm run test:review:regressions 2>&1 | tail -3` → passed; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/inbox-links.ts src/lib/gmail/linking.ts "src/app/(app)/quotes/new/types.ts" "src/app/(app)/quotes/new/page.tsx" "src/app/(app)/quotes/new/intake-form.tsx" "src/app/(app)/quotes/new/actions.ts" scripts/smoke-routes.ts` → clean. (The controller's `test:smoke` covers the new route and the browser pass: "+ New quote" lands on the intake pre-filled, "Create quote & link thread" returns to the thread with the quote chip in the Work card.)

- [ ] **Step 6: Commit.**

```bash
git add src/lib/inbox-links.ts src/lib/gmail/linking.ts "src/app/(app)/quotes/new/types.ts" "src/app/(app)/quotes/new/page.tsx" "src/app/(app)/quotes/new/intake-form.tsx" "src/app/(app)/quotes/new/actions.ts" scripts/smoke-routes.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(quotes): intake pre-fills from an Inbox thread, mints the draft quote, links the thread and returns to it (#123)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: List row — last responder (ignoring me) + Gmail-style chain

**Files:**
- Create: `src/lib/inbox-rows.ts`
- Modify: `src/app/(app)/inbox/types.ts:84-122` (`ThreadRowVM`)
- Modify: `src/app/(app)/inbox/page.tsx:458-526` (`rowFor`)
- Modify: `src/app/(app)/inbox/thread-list.tsx:605-647` (the row's name line)
- Test: `scripts/test-review-and-spec.ts` (section "Inbox round 3 — row name")

**Interfaces:**
- Consumes: `CommThread.messages[].author/at` (`comms.ts:205-223`), `contactName`, `customer`; `me` (`page.tsx:190`).
- Produces (`src/lib/inbox-rows.ts`):
  ```ts
  export type RowName = { primary: string; secondary: string };
  export function rowName(t: Pick<CommThread, "messages" | "contactName" | "customer">, meName: string): RowName;
  ```
- Produces: `ThreadRowVM.primaryName: string`, `ThreadRowVM.chain: string` (`name` / `participants` stay — `haystack` and the drafts row still use them).

Finding: the row currently shows `participants || name` (`thread-list.tsx:619`), where `name` is `customer || contactName` (`page.tsx:461-463`) — the customer, not a person. Outbound authors are the sender's display name (`bridge.ts:192` `p.from.name`, `comms.ts reply()` `me`), so comparing `author` to `me` (`user.name`) is the store's own convention. `showStatus` / `showWait` / `statusMeta` are untouched.

- [ ] **Step 1: Write the failing spec test.** Import:

```ts
import { rowName } from "@/lib/inbox-rows";
```

Section:

```ts
/* ---- Inbox round 3 (#128) — row name: last responder, Gmail-style chain ---- */
{
  const M = (id: string, at: number, direction: "in" | "out", author: string): CommMessage =>
    ({ id, at, direction, channel: "email", author, body: "" });
  const T = (messages: CommMessage[]) => ({ messages, contactName: "Brenda Gauchel", customer: "Lakefront ISD" });
  const me = "Jeff Chesebro";
  const r3a = rowName(T([M("1", 1, "in", "Brenda Gauchel"), M("2", 2, "out", me)]), me);
  ok(r3a.primary === "Brenda Gauchel" && r3a.secondary === "Brenda, me (2)", "rowName: my reply is ignored — Brenda stays primary; chain 'Brenda, me (2)'");
  const r3b = rowName(T([M("1", 1, "out", me)]), me);
  ok(r3b.primary === "Brenda Gauchel" && r3b.secondary === "me", "rowName: all mine → counterpart, chain 'me'");
  const r3c = rowName(T([M("1", 1, "in", "Brenda Gauchel"), M("2", 2, "in", "Chris Hale"), M("3", 3, "out", me)]), me);
  ok(r3c.primary === "Chris Hale" && r3c.secondary === "Brenda, Chris, me (3)", "rowName: newest non-me author wins; chain in first-seen order");
  const r3d = rowName(T([M("2", 5, "in", "Late Reply"), M("1", 1, "in", "Early Bird")]), me);
  ok(r3d.primary === "Late Reply" && r3d.secondary === "Early, Late (2)", "rowName: newest by `at`, not array order");
  const r3e = rowName(T([M("1", 1, "in", "Brenda Gauchel")]), me);
  ok(r3e.primary === "Brenda Gauchel" && r3e.secondary === "Brenda", "rowName: single message → no count");
  const r3f = rowName(T([]), me);
  ok(r3f.primary === "Brenda Gauchel" && r3f.secondary === "", "rowName: no messages → counterpart, empty chain");
  const r3g = rowName({ messages: [], contactName: "", customer: "" }, me);
  ok(r3g.primary === "Customer", "rowName: nothing known → 'Customer'");
  const r3h = rowName({ messages: [M("1", 1, "out", me)], contactName: "", customer: "Lakefront ISD" }, me);
  ok(r3h.primary === "Lakefront ISD", "rowName: counterpart falls back to the customer name");
}
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `Cannot find module '@/lib/inbox-rows'`.

- [ ] **Step 3: Implement.**

`src/lib/inbox-rows.ts` (new):

```ts
/**
 * #128 — the Inbox list row's name, Gmail-style: the last person who
 * responded (ignoring me), with a "Brenda, me (3)" chain under it. Pure.
 */
import type { CommThread } from "@/lib/stores/comms";

export type RowName = { primary: string; secondary: string };

function first(name: string): string {
  const n = (name || "").trim();
  return n.split(/\s+/)[0] || n;
}

export function rowName(
  t: Pick<CommThread, "messages" | "contactName" | "customer">,
  meName: string
): RowName {
  const all = t.messages || [];
  const authored = all.filter((m) => !!m.author);
  const counterpart = t.contactName || t.customer || "Customer";
  // Newest first by `at` — the store keeps messages sorted, but never trust it.
  const newestFirst = [...authored].sort((a, b) => (b.at || 0) - (a.at || 0));
  const lastOther = newestFirst.find((m) => m.author !== meName);
  const primary = lastOther ? lastOther.author : counterpart;
  // Distinct authors in first-seen order, me rendered as "me", first names only.
  const seen: string[] = [];
  for (const m of [...authored].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    if (!seen.includes(m.author)) seen.push(m.author);
  }
  const chain = seen.map((a) => (a === meName ? "me" : first(a))).join(", ");
  const secondary = chain ? (all.length > 1 ? `${chain} (${all.length})` : chain) : "";
  return { primary, secondary };
}
```

`src/app/(app)/inbox/types.ts` — in `ThreadRowVM` after `participants: string;` (line 97):

```ts
  /** #128 — author of the newest message that isn't me (drafts: the "To: …"
   *  line); falls back to the counterpart when every message is mine */
  primaryName: string;
  /** #128 — Gmail-style "Brenda, me (3)"; "" on drafts */
  chain: string;
```

`src/app/(app)/inbox/page.tsx` — add `import { rowName } from "@/lib/inbox-rows";` next to the other `@/lib` imports; in `rowFor` (458-526) add after `const snip = snippet(t);`:

```ts
    const who = isDrafts ? null : rowName(t, me);
```

and in the returned literal, after `participants: participantsFor(t),`:

```ts
      primaryName: who ? who.primary : nm,
      chain: who ? who.secondary : "",
```

`src/app/(app)/inbox/thread-list.tsx` — in `Row`, replace `{r.participants || r.name}` (line 619) with `{r.primaryName}`, and insert the chain line between the name line's closing `</span>` (line 647) and the subject `<span>` (line 648) — shown only when it adds information beyond the name:

```tsx
        {r.chain && r.chain !== r.primaryName && (
          <span
            title={r.chain}
            style={{
              display: "block",
              fontSize: 11,
              color: "#9aa0ab",
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {r.chain}
          </span>
        )}
```

The `{r.msgCount > 1 && (…)}` count badge on the name line stays exactly as it is (spec: badge unchanged), as do the status pill and the waiting chip.

- [ ] **Step 4: Run tests, expect pass.** `npx tsx scripts/test-review-and-spec.ts | grep -E 'rowName|ALL PASSED'` → 8 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/inbox-rows.ts "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/thread-list.tsx" "src/app/(app)/inbox/types.ts"` → clean.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/inbox-rows.ts "src/app/(app)/inbox/types.ts" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/thread-list.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(inbox): list row names the last responder (ignoring me) with a Gmail-style chain; waiting badge unchanged (#128)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Resizable panes + collapsible folder rail — `clampLayout`, `SplitHandle`, shell layout state

**Files:**
- Create: `src/lib/inbox-layout.ts`, `src/components/split-handle.tsx`
- Modify: `src/app/(app)/inbox/inbox-shell.tsx:3-43` (imports), `:115-121` (after the `narrow` effect), `:569-580` (rail wrapper), `:581-852` (rail content wrapped), `:856` (`ThreadList` width + handle), append `CollapsedRail`/`IconRow`
- Modify: `src/app/(app)/inbox/thread-list.tsx:19-65` (props), `:96-107` (root width)
- Modify: `src/app/(app)/inbox/page.tsx:901-921` (the `<style>` block)
- Test: `scripts/test-review-and-spec.ts` (section "Inbox round 3 — layout clamp")

**Interfaces:**
- Consumes: `narrow` state (`inbox-shell.tsx:115-121`, `window.innerWidth <= 960`), `SidebarVM`/`FolderRowVM` (`types.ts`), `FolderGlyph`/`PencilIcon`/`PhoneIcon` (`inbox/icons.tsx:64,120,129`), `blankCompose`, `setCompose`, `setLogging`.
- Produces (`src/lib/inbox-layout.ts`):
  ```ts
  export type InboxLayout = { rail: number; list: number };
  export const LAYOUT_KEY = "pk.inbox.layout.v1";
  export const RAIL_DEFAULT = 238, RAIL_MIN = 180, RAIL_MAX = 320, RAIL_COLLAPSED = 48;
  export const LIST_DEFAULT = 392, LIST_MIN = 300, LIST_MAX = 640;
  export const DEFAULT_LAYOUT: InboxLayout;
  export function clampLayout(input: Partial<InboxLayout> | null | undefined): InboxLayout;
  export function parseLayout(raw: string | null | undefined): InboxLayout;
  ```
- Produces (`src/components/split-handle.tsx`): `SplitHandle({ value, min, max, onChange, label })` default export.
- Produces: `ThreadList` prop `width: number`.

Finding: the Inbox's own breakpoint is **960px** (`inbox-shell.tsx:117` + the `.ib-pane`/`.ib-list` media query at `page.tsx:914`), not the spec's 860 — below it the reader pane is already hidden, so the handles follow `narrow` and stored widths are ignored there; the rail hides at 720 as today. No new responsive work.

- [ ] **Step 1: Write the failing spec test.** Import:

```ts
import { clampLayout, parseLayout, DEFAULT_LAYOUT } from "@/lib/inbox-layout";
```

Section:

```ts
/* ---- Inbox round 3 (#126) — pane layout clamp ---- */
{
  const J = (v: unknown) => JSON.stringify(v);
  ok(J(clampLayout({ rail: 100, list: 100 })) === J({ rail: 180, list: 300 }), "clampLayout: below minimums → minimums");
  ok(J(clampLayout({ rail: 900, list: 900 })) === J({ rail: 320, list: 640 }), "clampLayout: above maximums → maximums");
  ok(clampLayout({ rail: 0, list: 392 }).rail === 0, "clampLayout: 0 stays 0 (collapsed rail)");
  ok(clampLayout({ rail: -5, list: 392 }).rail === 0, "clampLayout: a negative rail collapses");
  ok(J(clampLayout(undefined)) === J(DEFAULT_LAYOUT) && J(clampLayout(null)) === J(DEFAULT_LAYOUT), "clampLayout: nothing → defaults");
  ok(J(clampLayout({ rail: Number.NaN, list: "x" as unknown as number })) === J(DEFAULT_LAYOUT), "clampLayout: garbage → defaults");
  ok(clampLayout({ rail: 250.6, list: 400.2 }).rail === 251 && clampLayout({ rail: 250.6, list: 400.2 }).list === 400, "clampLayout: whole pixels");
  ok(J(parseLayout('{"rail":0,"list":500}')) === J({ rail: 0, list: 500 }), "parseLayout: stored value round-trips");
  ok(J(parseLayout("garbage")) === J(DEFAULT_LAYOUT) && J(parseLayout(null)) === J(DEFAULT_LAYOUT) && J(parseLayout("")) === J(DEFAULT_LAYOUT), "parseLayout: bad/absent → defaults");
  ok(J(parseLayout("[1,2]")) === J(DEFAULT_LAYOUT) && J(parseLayout('{"list":9999}')) === J({ rail: 238, list: 640 }), "parseLayout: wrong shape / partial → clamped defaults");
}
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `Cannot find module '@/lib/inbox-layout'`.

- [ ] **Step 3: Implement.**

`src/lib/inbox-layout.ts` (new):

```ts
/**
 * #126 — Inbox pane layout: folder-rail and message-list widths (the
 * reader takes the rest). Per device, in localStorage under LAYOUT_KEY;
 * the clamp/parse rules live here so test:specs can pin them.
 */
export type InboxLayout = { rail: number; list: number };

export const LAYOUT_KEY = "pk.inbox.layout.v1";
export const RAIL_DEFAULT = 238;
export const RAIL_MIN = 180;
export const RAIL_MAX = 320;
/** Width of the icon column shown while the rail is collapsed (rail === 0). */
export const RAIL_COLLAPSED = 48;
export const LIST_DEFAULT = 392;
export const LIST_MIN = 300;
export const LIST_MAX = 640;
export const DEFAULT_LAYOUT: InboxLayout = { rail: RAIL_DEFAULT, list: LIST_DEFAULT };

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** rail: 0 = collapsed, else 180–320; list: 300–640; anything unusable →
 *  that pane's default. */
export function clampLayout(input: Partial<InboxLayout> | null | undefined): InboxLayout {
  const rail = finite(input?.rail);
  const list = finite(input?.list);
  return {
    rail:
      rail === null
        ? RAIL_DEFAULT
        : rail <= 0
          ? 0
          : Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(rail))),
    list: list === null ? LIST_DEFAULT : Math.min(LIST_MAX, Math.max(LIST_MIN, Math.round(list))),
  };
}

/** The stored JSON → a clamped layout; never throws. */
export function parseLayout(raw: string | null | undefined): InboxLayout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_LAYOUT;
    return clampLayout(parsed as Partial<InboxLayout>);
  } catch {
    return DEFAULT_LAYOUT;
  }
}
```

`src/components/split-handle.tsx` (new):

```tsx
"use client";

/**
 * #126 — a 6px vertical drag handle between two panes. A pointer-captured
 * drag reports the new width of the pane to its LEFT (start width + dx),
 * clamped to [min, max]; arrow keys move 16px, Home/End jump to the
 * limits. No dependency and no layout state of its own — the parent owns
 * the width and passes it back as `value`.
 */
import { useRef } from "react";

const STEP = 16;

export default function SplitHandle({
  value,
  min,
  max,
  onChange,
  label,
}: {
  /** current width of the pane to the left, px */
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** accessible name, e.g. "Resize message list" */
  label: string;
}) {
  const drag = useRef<{ startX: number; startValue: number } | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="ib-split"
      title={`${label} — drag, or focus and use the arrow keys`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { startX: e.clientX, startValue: value };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onChange(clamp(drag.current.startValue + (e.clientX - drag.current.startX)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(clamp(value - STEP));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(clamp(value + STEP));
        } else if (e.key === "Home") {
          e.preventDefault();
          onChange(min);
        } else if (e.key === "End") {
          e.preventDefault();
          onChange(max);
        }
      }}
      style={{
        width: 6,
        flexShrink: 0,
        alignSelf: "stretch",
        cursor: "col-resize",
        background: "transparent",
        touchAction: "none",
        outline: "none",
        position: "relative",
        zIndex: 2,
        // straddle the neighbours' 1px borders instead of adding a gap
        margin: "0 -3px",
      }}
    />
  );
}
```

`src/app/(app)/inbox/page.tsx` — in the `<style>` block: add a line `.ib-split:hover, .ib-split:focus-visible { background: color-mix(in srgb, var(--accent) 30%, #fff); }` after the `.ib-boxsel { display:none; }` line, and add `.ib-split { display:none !important; }` inside the existing `@media (max-width: 960px) { … }` rule (line 914), so it reads:

```
        @media (max-width: 960px) { .ib-pane { display:none !important; } .ib-split { display:none !important; } .ib-list { flex:1 1 auto !important; width:auto !important; border-right:none !important; } }
```

`src/app/(app)/inbox/thread-list.tsx` — add `width,` to the destructured props (after `list,`) and `/** #126 — pane width from the shell's layout state */ width: number;` to the props type (after `list: ListVM;`); change `width: 392,` (line 99) to `width,`.

`src/app/(app)/inbox/inbox-shell.tsx`:

Imports — add after line 43:

```ts
import SplitHandle from "@/components/split-handle";
import {
  clampLayout,
  DEFAULT_LAYOUT,
  LAYOUT_KEY,
  LIST_DEFAULT,
  LIST_MAX,
  LIST_MIN,
  parseLayout,
  RAIL_COLLAPSED,
  RAIL_DEFAULT,
  RAIL_MAX,
  RAIL_MIN,
  type InboxLayout,
} from "@/lib/inbox-layout";
```

After the `narrow` effect (line 121) add:

```ts
  // #126 — pane widths + rail collapse, per device. Read once after mount
  // (the server render uses the defaults, so no hydration mismatch), written
  // back debounced 150ms. Storage can be missing or throw (private mode) —
  // both fall back to the defaults, silently.
  const [layout, setLayout] = useState<InboxLayout>(DEFAULT_LAYOUT);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAYOUT_KEY);
    } catch {
      stored = null;
    }
    setLayout(parseLayout(stored));
    setLayoutLoaded(true);
  }, []);
  useEffect(() => {
    if (!layoutLoaded) return;
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        // storage unavailable — the layout still applies for this page view
      }
    }, 150);
    return () => window.clearTimeout(id);
  }, [layout, layoutLoaded]);
  const setRail = useCallback((rail: number) => setLayout((l) => clampLayout({ ...l, rail })), []);
  const setList = useCallback((list: number) => setLayout((l) => clampLayout({ ...l, list })), []);
  // Below the Inbox's own breakpoint the reader pane is hidden anyway: no
  // handles, stored widths ignored, everything as it was before #126.
  const applyLayout = !narrow;
  const railCollapsed = applyLayout && layout.rail === 0;
  const railWidth = !applyLayout ? RAIL_DEFAULT : railCollapsed ? RAIL_COLLAPSED : layout.rail;
  const listWidth = applyLayout ? layout.list : LIST_DEFAULT;
```

Rail wrapper (569-580): change `width: 238,` to `width: railWidth,`. Directly inside it, before the Compose/Log padding `<div style={{ padding: "14px 13px 10px", flexShrink: 0 }}>` (line 581), insert the toggle, then wrap the three existing blocks (the padding div, the `ib-scroll` div, and the connection footer — lines 581-852) in a conditional:

```tsx
        {/* #126 — collapse / expand the folder rail (desktop only) */}
        {applyLayout && (
          <div
            style={{
              display: "flex",
              justifyContent: railCollapsed ? "center" : "flex-end",
              padding: railCollapsed ? "10px 0 2px" : "8px 8px 0",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setRail(railCollapsed ? RAIL_DEFAULT : 0)}
              title={railCollapsed ? "Expand folders" : "Collapse folders"}
              aria-label={railCollapsed ? "Expand folders" : "Collapse folders"}
              aria-expanded={!railCollapsed}
              style={railToggleStyle}
            >
              {railCollapsed ? "›" : "‹"}
            </button>
          </div>
        )}
        {railCollapsed ? (
          <CollapsedRail
            sidebar={sidebar}
            onCompose={() => setCompose(blankCompose(composeDefaultBox))}
            onLog={() => setLogging(true)}
          />
        ) : (
          <>
            {/* …the existing three blocks, unchanged: Compose/Log, folders+views+leads, connection footer… */}
          </>
        )}
```

(`composeDefaultBox` is declared at line 549, above the `return` — it is in scope.) After the rail's closing `</div>` (line 853) insert the first handle, and after the `<ThreadList … />` element (closes at line 944) the second one; also pass `width={listWidth}` to `ThreadList`:

```tsx
      {applyLayout && !railCollapsed && (
        <SplitHandle value={layout.rail} min={RAIL_MIN} max={RAIL_MAX} onChange={setRail} label="Resize folders" />
      )}
```

```tsx
      {applyLayout && (
        <SplitHandle value={layout.list} min={LIST_MIN} max={LIST_MAX} onChange={setList} label="Resize message list" />
      )}
```

Append after `FolderRow` at the end of the file:

```tsx
const railToggleStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 7,
  border: "1px solid #e4e7ec",
  background: "#fff",
  color: "#8c919c",
  fontSize: 15,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
  fontFamily: "var(--font-ui)",
};

/** #126 — the 48px icon column shown while the rail is collapsed: every
 *  folder and view stays reachable (glyph + tooltip + count), Compose and
 *  Log call keep their buttons, the connection dot keeps its state. */
function CollapsedRail({
  sidebar,
  onCompose,
  onLog,
}: {
  sidebar: SidebarVM;
  onCompose: () => void;
  onLog: () => void;
}) {
  const iconBtn = (accent: boolean): React.CSSProperties => ({
    width: 34,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    border: accent ? "none" : "1px solid #e4e7ec",
    background: accent ? "var(--accent)" : "#fff",
    color: accent ? "#fff" : "#5b616e",
    cursor: "pointer",
    padding: 0,
  });
  return (
    <div
      className="ib-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "4px 0 12px",
      }}
    >
      <button type="button" onClick={onCompose} title="Compose" aria-label="Compose" style={iconBtn(true)}>
        <PencilIcon size={15} />
      </button>
      <button type="button" onClick={onLog} title="Log call / meeting" aria-label="Log call / meeting" style={iconBtn(false)}>
        <PhoneIcon size={13} />
      </button>
      <span style={{ height: 6 }} />
      {sidebar.personalFolders.map((f) => (
        <IconRow key={f.key} f={f} />
      ))}
      <span style={{ height: 6 }} />
      {sidebar.views.map((v) => (
        <IconRow key={v.key} f={v} />
      ))}
      <Link
        href="/leads"
        title={sidebar.leadFollowCount > 0 ? `Leads to follow up (${sidebar.leadFollowCount})` : "Leads to follow up"}
        aria-label="Leads to follow up"
        style={{
          position: "relative",
          width: 34,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          textDecoration: "none",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          color: "#b4543a",
        }}
      >
        L
        {sidebar.leadFollowCount > 0 && <CountDot count={sidebar.leadFollowCount} color="#c85a3c" />}
      </Link>
      <span style={{ flex: 1 }} />
      <span
        title={`${sidebar.connection.label} — ${sidebar.connection.detail}`}
        style={{ width: 9, height: 9, borderRadius: "50%", background: sidebar.connection.color, flexShrink: 0 }}
      />
    </div>
  );
}

function CountDot({ count, color, ink }: { count: number; color: string; ink?: string }) {
  return (
    <span
      style={{
        position: "absolute",
        top: 1,
        right: 1,
        minWidth: 14,
        height: 14,
        padding: "0 3px",
        borderRadius: 7,
        fontFamily: "var(--font-mono)",
        fontSize: 8.5,
        fontWeight: 700,
        lineHeight: "14px",
        textAlign: "center",
        color: ink || "#fff",
        background: color,
        boxSizing: "border-box",
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function IconRow({ f }: { f: FolderRowVM }) {
  return (
    <Link
      href={f.href}
      title={f.count > 0 ? `${f.label} (${f.count})` : f.label}
      aria-label={f.label}
      style={{
        position: "relative",
        width: 34,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        background: f.active ? ACCENT_SOFT : "transparent",
        textDecoration: "none",
      }}
    >
      <FolderGlyph kind={f.icon} active={f.active} />
      {f.count > 0 && (
        <CountDot
          count={f.count}
          color={f.badge === "accent" ? "var(--accent)" : f.badge === "red" ? "#c85a3c" : "#e4e7ec"}
          ink={f.badge === "plain" ? "#5b616e" : "#fff"}
        />
      )}
    </Link>
  );
}
```

- [ ] **Step 4: Run tests, expect pass.** `npx tsx scripts/test-review-and-spec.ts | grep -E 'clampLayout|parseLayout|ALL PASSED'` → 10 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/inbox-layout.ts src/components/split-handle.tsx "src/app/(app)/inbox/inbox-shell.tsx" "src/app/(app)/inbox/thread-list.tsx" "src/app/(app)/inbox/page.tsx"` → clean. (Controller's browser pass: drag both handles, collapse the rail, reload — `localStorage["pk.inbox.layout.v1"]` holds `{"rail":0,"list":<n>}` and the layout persists; every folder/view is reachable from the icon column.)

- [ ] **Step 5: Commit.**

```bash
git add src/lib/inbox-layout.ts src/components/split-handle.tsx "src/app/(app)/inbox/inbox-shell.tsx" "src/app/(app)/inbox/thread-list.tsx" "src/app/(app)/inbox/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(inbox): resizable folder rail / message list with a collapsible rail, layout remembered per device (#126)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Signatures — prefs field, `saveSignatureAction` + Account card, composer seeding and toggle

**Files:**
- Create: `src/lib/inbox-signature.ts`, `src/app/(app)/account/signature-card.tsx`
- Modify: `src/db/doc-tables.ts:172`
- Modify: `src/lib/stores/notif-prefs.ts` (`readRow`/`writeRow` types ~57-79, `setAll` ~113, append the signature accessors before `countOn`)
- Modify: `src/app/(app)/account/actions.ts:5-11` (imports), append `saveSignatureAction`
- Modify: `src/app/(app)/account/page.tsx:2` (import), `:20-22` (load), the `<NotifControls rows={rows} />` line (render)
- Modify: `src/app/(app)/inbox/page.tsx:7` (import), `:263` (load), `:941-957` (prop)
- Modify: `src/app/(app)/inbox/inbox-shell.tsx:73-111` (prop), `:952-958` + `:990-997` (`ThreadReader`), `:1004-1020` (`ComposeModal`)
- Modify: `src/app/(app)/inbox/thread-reader.tsx:3` (imports), `:353-366` (props), `:431-453` (`openMode`), `:495` (`sendReady`), `:1042-1061` (textarea ref), `:1087-1106` (toggle after Attach)
- Modify: `src/app/(app)/inbox/compose-modal.tsx:3-6` (imports), `:8-26` (props + state), `:38-39` (`composeReady`), `:278-294` (textarea ref), `:334-348` (toggle after Discard)
- Test: `scripts/test-review-and-spec.ts` (section "Inbox round 3 — signature block") / `scripts/test-review-regressions.ts`

**Interfaces:**
- Consumes: `readRow`/`writeRow` (`notif-prefs.ts`), `requireUser`, `revalidatePath`; `openMode`/`doSend`/`closeComposer` (`thread-reader.tsx:431-476`); `ComposeInit` (`types.ts:235-248`).
- Produces (`src/lib/inbox-signature.ts`):
  ```ts
  export const SIGNATURE_MAX = 2000;
  export const SIG_SEP = "\n-- \n";
  export const FORWARD_MARK = "\n\n---------- Forwarded ----------";
  export function normalizeSignature(text: string): string;                // CRLF→LF, trim, cap
  export function signatureBlock(signature: string): string;               // "" | "\n\n-- \n" + normalized
  export function hasSignature(body: string): boolean;
  export function withSignature(body: string, signature: string, mode: "add" | "strip"): string;
  export function stripSignature(body: string, signature: string): string;
  ```
- Produces (`notif-prefs.ts`): `SIGNATURE_KEY = "email_signature"`, `signatureFor(user: string): Promise<string>`, `setSignature(text: string, user: string): Promise<string>` (returns what was stored).
- Produces (`account/actions.ts`): `saveSignatureAction(text: string): Promise<{ ok: true; signature: string } | { ok: false; error: string }>`.
- Produces: `InboxShell`, `ThreadReader`, `ComposeModal` gain a `signature: string` prop.

Findings: the per-user prefs row is `notif_prefs.prefs`, typed `Record<string, boolean>` in Drizzle (`doc-tables.ts:172`) — a JSONB column, so a string value needs only the TS `$type` widened (no migration; `db:generate` would emit nothing). `crmMode` already lives there as a non-category key (`notif-prefs.ts` `CRM_MODE_KEY`), and `setAll` spreads the stored row so foreign keys survive. `doSend()` (`thread-reader.tsx:464-476`) sends `cBody.trim()` — the signature is just body text, so `buildRaw()` / `deliverThreadOutbound` are untouched.

- [ ] **Step 1: Write the failing spec test.** Import:

```ts
import { hasSignature, normalizeSignature, signatureBlock, withSignature, SIGNATURE_MAX } from "@/lib/inbox-signature";
```

Section:

```ts
/* ---- Inbox round 3 (#127) — signature block ---- */
{
  const sig = "Jeff Chesebro\nPeak Systems Group";
  ok(signatureBlock("") === "" && signatureBlock("  \n ") === "", "signatureBlock: empty → no block");
  ok(signatureBlock(" " + sig + "\r\n") === "\n\n-- \n" + sig, "signatureBlock: '\\n\\n-- \\n' + trimmed, CRLF normalised");
  ok(withSignature("", sig, "add") === "\n\n-- \n" + sig, "add: the reply/new seed is the bare block (cursor stays above it)");
  ok(withSignature("Thanks!", sig, "add") === "Thanks!\n\n-- \n" + sig, "add: appends below the text");
  ok(withSignature("Thanks!\n\n-- \n" + sig, sig, "add") === "Thanks!\n\n-- \n" + sig, "add: idempotent");
  ok(withSignature("Thanks!", "", "add") === "Thanks!", "add: no signature configured → untouched");
  ok(withSignature("\n\n-- \n" + sig, sig, "strip") === "", "strip: the bare seed → empty");
  ok(withSignature("Thanks!\n\n-- \n" + sig, sig, "strip") === "Thanks!", "strip: exact block removed, text above untouched");
  ok(withSignature("Thanks!\n\n-- \nJeff (edited)", sig, "strip") === "Thanks!", "strip: an edited signature still goes by the -- separator");
  ok(withSignature("Thanks!", sig, "strip") === "Thanks!", "strip: nothing to strip → untouched");
  const fwd = "\n\n---------- Forwarded ----------\nFrom: Brenda\n\n> hi";
  ok(withSignature(fwd, sig, "add") === "\n\n-- \n" + sig + fwd, "add: forward keeps the forwarded block, signature above it");
  ok(withSignature("\n\n-- \n" + sig + fwd, sig, "strip") === fwd, "strip: forward gives the forwarded block back");
  ok(withSignature("\n\n-- \nJeff edited" + fwd, sig, "strip") === fwd, "strip: edited signature above a forwarded block → cut to the next blank line");
  ok(hasSignature("x\n-- \ny") && !hasSignature("x\n--\ny") && !hasSignature("x -- y"), "hasSignature: the exact '\\n-- \\n' separator");
  ok(normalizeSignature("a".repeat(2500)).length === SIGNATURE_MAX, "normalizeSignature caps at SIGNATURE_MAX");
}
```

- [ ] **Step 2: Run it, expect failure.** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `Cannot find module '@/lib/inbox-signature'`.

- [ ] **Step 3: Implement.**

`src/lib/inbox-signature.ts` (new):

```ts
/**
 * #127 — the plain-text email signature. It is body text and nothing more:
 * the composer seeds it below a "-- " separator (the RFC 3676 convention
 * every mail client recognises), the toggle strips/re-inserts it by that
 * separator so edits above it are untouched, and send/MIME see only text.
 * Pure — the composer (client) and the prefs store (server) both import it.
 */
export const SIGNATURE_MAX = 2000;
export const SIG_SEP = "\n-- \n";
/** thread-reader's Forward block starts with this (openMode). */
export const FORWARD_MARK = "\n\n---------- Forwarded ----------";

export function normalizeSignature(text: string): string {
  return (text || "").replace(/\r\n?/g, "\n").trim().slice(0, SIGNATURE_MAX);
}

/** "" when there is no signature, else "\n\n-- \n" + the normalized text. */
export function signatureBlock(signature: string): string {
  const s = normalizeSignature(signature);
  return s ? "\n" + SIG_SEP + s : "";
}

export function hasSignature(body: string): boolean {
  return (body || "").includes(SIG_SEP);
}

function addSignature(body: string, signature: string): string {
  const block = signatureBlock(signature);
  if (!block || hasSignature(body)) return body;
  // Forward: keep the forwarded block, put the signature above it.
  const fwd = body.indexOf(FORWARD_MARK);
  if (fwd >= 0) return body.slice(0, fwd) + block + body.slice(fwd);
  return body + block;
}

/** Removes the signature: the exact block when it is still intact, else
 *  from the "-- " separator (and the blank line before it) up to the next
 *  blank line — so an edited signature still comes out cleanly and a
 *  forwarded block after it survives. */
export function stripSignature(body: string, signature: string): string {
  const block = signatureBlock(signature);
  const exact = block ? body.indexOf(block) : -1;
  if (exact >= 0) return body.slice(0, exact) + body.slice(exact + block.length);
  const sep = body.indexOf(SIG_SEP);
  if (sep < 0) return body;
  const start = sep > 0 && body[sep - 1] === "\n" ? sep - 1 : sep;
  const after = body.indexOf("\n\n", sep + SIG_SEP.length);
  return body.slice(0, start) + (after < 0 ? "" : body.slice(after));
}

export function withSignature(body: string, signature: string, mode: "add" | "strip"): string {
  return mode === "add" ? addSignature(body, signature) : stripSignature(body, signature);
}
```

`src/db/doc-tables.ts:172` — `prefs: jsonb("prefs").$type<Record<string, boolean>>().notNull(),` → `prefs: jsonb("prefs").$type<Record<string, boolean | string>>().notNull(),` with the comment above the table extended: `/** Per-user notification category mutes — rss_notifprefs_v1 (notifprefs.js). Sparse map; booleans for the bell categories + flags, a string for the email signature (#127). */`.

`src/lib/stores/notif-prefs.ts`:
- Add near the top (after the `DEFAULT_USER` const): `import { normalizeSignature } from "@/lib/inbox-signature";` goes with the other imports at the top of the file, and `type PrefsRow = Record<string, boolean | string>;` after `DEFAULT_USER`.
- `readRow` returns `Promise<PrefsRow>`; `writeRow(user: string, prefs: PrefsRow)`.
- In `setAll`: `const mine: Record<string, boolean> = { ...(await readRow(u)) };` → `const mine: PrefsRow = { ...(await readRow(u)) };`.
- Append before `countOn`:

```ts
/* ---- Email signature (#127) — same sparse row, STRING-valued key ---- */

/** Per-user plain-text signature the Inbox composer seeds below a "-- "
 *  line (lib/inbox-signature). Per user == per mailbox today: every live
 *  thread is mailbox:"personal" (comms.ts SHARED_BOXES = []). */
export const SIGNATURE_KEY = "email_signature";

export async function signatureFor(user: string): Promise<string> {
  const v = (await readRow(user))[SIGNATURE_KEY];
  return typeof v === "string" ? v : "";
}

/** Stores the normalized text (CRLF → LF, trimmed, capped at
 *  SIGNATURE_MAX); an empty signature removes the key. Returns what was
 *  stored. */
export async function setSignature(text: string, user: string): Promise<string> {
  const clean = normalizeSignature(text);
  const mine: PrefsRow = { ...(await readRow(user)) };
  if (clean) mine[SIGNATURE_KEY] = clean;
  else delete mine[SIGNATURE_KEY];
  await writeRow(user, mine);
  return clean;
}
```

`src/app/(app)/account/actions.ts` — extend the `@/lib/stores/notif-prefs` import with `setSignature` and add `import { SIGNATURE_MAX } from "@/lib/inbox-signature";`; append:

```ts
/** #127 — the signed-in user's own email signature (plain text). */
export async function saveSignatureAction(text: string) {
  const me = await requireUser();
  const raw = typeof text === "string" ? text : "";
  if (raw.length > SIGNATURE_MAX)
    return { ok: false as const, error: `Keep it under ${SIGNATURE_MAX.toLocaleString()} characters.` };
  const signature = await setSignature(raw, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const, signature };
}
```

`src/app/(app)/account/signature-card.tsx` (new):

```tsx
"use client";

import { useState, useTransition } from "react";
import { saveSignatureAction } from "./actions";
import { SIGNATURE_MAX, signatureBlock } from "@/lib/inbox-signature";

/**
 * #127 — Account → "Email signature". Plain text, saved per user into the
 * same prefs row as the bell mutes; the preview is exactly what the
 * composer appends (signatureBlock, minus the leading blank lines).
 */
export default function SignatureCard({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = text !== saved;

  const save = () =>
    start(async () => {
      const r = await saveSignatureAction(text);
      if (r.ok) {
        setSaved(r.signature);
        setText(r.signature);
        setMsg({ ok: true, text: "Saved" });
      } else {
        setMsg({ ok: false, text: r.error });
      }
    });

  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Email signature</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        Added below a &quot;-- &quot; line on every reply and new email you write in the Inbox.
        Plain text only; you can remove it from any message before sending.
      </div>
      <textarea
        value={text}
        maxLength={SIGNATURE_MAX}
        rows={5}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
        placeholder={"Jeff Chesebro\nPeak Systems Group\n(218) 555-0100"}
        style={{
          width: "100%",
          marginTop: 12,
          resize: "vertical",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          lineHeight: 1.55,
          color: "#16181d",
          border: "1px solid #e4e7ec",
          borderRadius: 9,
          padding: "10px 12px",
          outline: "none",
          background: "#fff",
          boxSizing: "border-box",
          display: "block",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
          {text.length} / {SIGNATURE_MAX}
        </span>
        <span style={{ flex: 1 }} />
        {msg && !pending && (
          <span style={{ fontSize: 11, color: msg.ok ? "#1f7a52" : "#b4543a" }}>{msg.text}</span>
        )}
        <button
          type="button"
          className="pk-btn-accent"
          disabled={!dirty || pending}
          onClick={save}
          style={{
            padding: "8px 14px",
            fontSize: 12.5,
            opacity: !dirty || pending ? 0.55 : 1,
            cursor: !dirty || pending ? "default" : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save signature"}
        </button>
      </div>
      {saved.trim() && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Preview — exactly what gets sent
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              background: "#fafbfc",
              border: "1px solid #eef0f3",
              borderRadius: 9,
              padding: "10px 12px",
              color: "#3a3f4a",
            }}
          >
            {signatureBlock(saved).replace(/^\n+/, "")}
          </pre>
        </div>
      )}
    </div>
  );
}
```

`src/app/(app)/account/page.tsx` — line 2: `import { CATEGORIES, getPrefs, invitesOn, signatureFor } from "@/lib/stores/notif-prefs";`; add `import SignatureCard from "./signature-card";` after the `KrispCard` import; after `const invites = await invitesOn(user.name);` add `const signature = await signatureFor(user.name);`; after `<NotifControls rows={rows} />` add:

```tsx
      {/* ---- email signature (#127) ---- */}
      <SignatureCard initial={signature} />
```

`src/app/(app)/inbox/page.tsx` — line 7: `import { crmModeOn, signatureFor } from "@/lib/stores/notif-prefs";`; after `const crmMode = await crmModeOn(me);` (263) add `const signature = await signatureFor(me); // #127`; pass `signature={signature}` to `<InboxShell …>` after `crmMode={crmMode}`.

`src/app/(app)/inbox/inbox-shell.tsx` — add `signature,` to the destructured props (after `crmMode: initialCrmMode,`) and `/** #127 — the signed-in user's email signature ("" when none) */ signature: string;` to the props type; pass `signature={signature}` to both `<ThreadReader …>` elements (pane and overlay) and to `<ComposeModal …>`.

`src/app/(app)/inbox/thread-reader.tsx`:
- Line 3: `import { useEffect, useRef, useState } from "react";` and add `import { hasSignature, stripSignature, withSignature } from "@/lib/inbox-signature";`.
- Props (353-366): add `signature,` to the destructure and `/** #127 — seeded below a "-- " line on Reply / Reply all / Forward */ signature: string;` to the type.
- After the `const [sending, setSending] = useState(false);` line add:

```ts
  // #127 — the composer body; on open the caret sits ABOVE the seeded signature
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!mode || !bodyRef.current) return;
    bodyRef.current.focus();
    bodyRef.current.setSelectionRange(0, 0);
  }, [mode]);
```

- `openMode` (431-453): the forward branch's `setCBody("\n\n---------- Forwarded ----------\nFrom: " + vm.forwardFrom + "\n\n" + quote);` becomes
  ```ts
      setCBody(
        withSignature(
          "\n\n---------- Forwarded ----------\nFrom: " + vm.forwardFrom + "\n\n" + quote,
          signature,
          "add"
        )
      );
  ```
  and the reply branch's `setCBody("");` becomes `setCBody(withSignature("", signature, "add"));`.
- Line 495: `const sendReady = cBody.trim().length > 0 && cTo.trim().length > 0;` → `const sendReady = stripSignature(cBody, signature).trim().length > 0 && cTo.trim().length > 0;` (a signature alone is not a message) and add `const sigOn = hasSignature(cBody);` on the next line.
- The composer `<textarea value={cBody} …>` (1042): add `ref={bodyRef}`.
- After the Attach `</button>` (line 1106), before `<span style={{ flex: 1 }} />`:

```tsx
                {signature && (
                  <button
                    onClick={() => setCBody(withSignature(cBody, signature, sigOn ? "strip" : "add"))}
                    aria-pressed={sigOn}
                    title={sigOn ? "Remove your signature from this message" : "Add your signature below a -- line"}
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: sigOn ? ACCENT_INK : "#5b616e",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    {sigOn ? "Remove signature" : "Add signature"}
                  </button>
                )}
```

`src/app/(app)/inbox/compose-modal.tsx`:
- Line 3: `import { useEffect, useRef, useState } from "react";` and add `import { hasSignature, stripSignature, withSignature } from "@/lib/inbox-signature";`.
- Props: add `signature,` and `/** #127 — seeded into a NEW message; a saved draft keeps its own body */ signature: string;`.
- Line 25: `const [cd, setCd] = useState<ComposeInit>({ ...init });` →
  ```ts
  const [cd, setCd] = useState<ComposeInit>(() => ({
    ...init,
    // #127 — a fresh compose starts with the signature; a saved draft or a
    // pre-filled body is left exactly as it came
    body: init.id || init.body ? init.body : withSignature("", signature, "add"),
  }));
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.focus();
    bodyRef.current.setSelectionRange(0, 0);
  }, []);
  const sigOn = hasSignature(cd.body);
  ```
- Lines 38-39: `const composeReady = !!cd.to.trim() && !!(cd.subject.trim() || stripSignature(cd.body, signature).trim());`
- The `<textarea value={cd.body} …>` (278): add `ref={bodyRef}`.
- After the Discard `</button>` (line 348), before `<span style={{ flex: 1 }} />`:

```tsx
          {signature && (
            <button
              onClick={() => set({ body: withSignature(cd.body, signature, sigOn ? "strip" : "add") })}
              aria-pressed={sigOn}
              title={sigOn ? "Remove your signature from this message" : "Add your signature below a -- line"}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: sigOn ? "var(--accent)" : "#8c919c",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "9px 6px",
                fontFamily: "var(--font-ui)",
              }}
            >
              {sigOn ? "Remove signature" : "Add signature"}
            </button>
          )}
```

- [ ] **Step 4: Regression test.** Append inside `main()`:

```ts
  // #127 — the signature round-trips through the per-user prefs row alongside the boolean prefs
  const { setSignature, signatureFor, setCrmMode: setCrmModePref, crmModeOn: crmModeOnPref } =
    await import("@/lib/stores/notif-prefs");
  const { withSignature: withSig } = await import("@/lib/inbox-signature");
  await setCrmModePref(true, "Sig Tester");
  const r3sig = await setSignature("  Jeff Chesebro\r\nPeak Systems Group\n(218) 555-0100  \n", "Sig Tester");
  assert.equal(r3sig, "Jeff Chesebro\nPeak Systems Group\n(218) 555-0100", "#127 setSignature normalises line endings and trims");
  assert.equal(await signatureFor("Sig Tester"), r3sig, "#127 signatureFor round-trips");
  assert.equal(await crmModeOnPref("Sig Tester"), true, "#127 a string pref coexists with the boolean prefs in the same row");
  assert.ok(withSig("", r3sig, "add").includes("\n-- \n"), "#127 the composer seed carries the -- separator");
  assert.equal((await setSignature("x".repeat(2500), "Sig Tester")).length, 2000, "#127 the store caps at 2,000 chars");
  await setSignature("", "Sig Tester");
  assert.equal(await signatureFor("Sig Tester"), "", "#127 an empty signature clears the key");
  assert.equal(await crmModeOnPref("Sig Tester"), true, "#127 clearing the signature leaves the other prefs alone");
  assert.equal(await signatureFor("Nobody Here"), "", "#127 no row → empty signature");
```

- [ ] **Step 5: Run tests, expect pass.** `npx tsx scripts/test-review-and-spec.ts | grep -E 'signatureBlock|add:|strip:|hasSignature|normalizeSignature|ALL PASSED'` → 15 PASS + `ALL PASSED`; `npm run test:review:regressions 2>&1 | tail -3` → passed; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/inbox-signature.ts src/db/doc-tables.ts src/lib/stores/notif-prefs.ts "src/app/(app)/account/actions.ts" "src/app/(app)/account/page.tsx" "src/app/(app)/account/signature-card.tsx" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/inbox-shell.tsx" "src/app/(app)/inbox/thread-reader.tsx" "src/app/(app)/inbox/compose-modal.tsx"` → clean. (Controller's browser pass: save a signature on `/account`, Reply on a thread → the body opens with the caret at the top and `-- ` + signature below; "Remove signature" strips it; Forward shows the signature above the forwarded block.)

- [ ] **Step 6: Commit.**

```bash
git add src/lib/inbox-signature.ts src/db/doc-tables.ts src/lib/stores/notif-prefs.ts "src/app/(app)/account/actions.ts" "src/app/(app)/account/page.tsx" "src/app/(app)/account/signature-card.tsx" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/inbox-shell.tsx" "src/app/(app)/inbox/thread-reader.tsx" "src/app/(app)/inbox/compose-modal.tsx" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(inbox): per-user plain-text signature — Account card, composer seeding below a -- line, toggle (#127)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs — D158, PUNCHLIST #123–#128 → DONE, spec implementation notes

**Files:**
- Modify: `DECISIONS.md` (append `## D158`), `PUNCHLIST.md:5998-6073` (the six headings + a `**Shipped:**` paragraph each), `docs/superpowers/specs/2026-09-21-inbox-round-3-design.md` (append "Implementation notes")

**Interfaces:** none — documentation only. Before committing, verify the D-number is still free on `main`: `git fetch origin && git show origin/main:DECISIONS.md | grep -c "^## D158"` must print `0` (numbers collided today; if it prints `1`, take the next free number and use it everywhere below).

- [ ] **Step 1: Full gate**, one at a time: `npx tsc --noEmit -p .` (empty), `npx eslint src scripts` (0 errors), `npx tsx scripts/test-review-and-spec.ts | tail -1` (`ALL PASSED`), `npm run test:review:regressions 2>&1 | tail -3` (`review regression checks passed`). The controller runs `npm run test:smoke` and the browser pass.

- [ ] **Step 2: DECISIONS.md** — append:

```markdown
## D158. Inbox round 3: identity source (not message-level links), per-device pane layout, and the defaults the spec left open (#123–#128, 2026-09-21)

Spec: `docs/superpowers/specs/2026-09-21-inbox-round-3-design.md`; plan
`docs/superpowers/plans/2026-09-21-inbox-round-3.md`.

- **Identity source, not message-level links (#125).** A thread still has one customer and one
  work link. `CommThread.identityMessageId` names the message whose addresses drive resolution
  and quick-add: inbound → its From, outbound → its first recipient, falling back to the thread
  contact when the message stored no address. To make that possible the Gmail bridge now stamps
  `CommMessage.fromEmail` / `to` on import (`bridge.ts recordMessage`); app-sent and pre-#125
  messages fall back to `contactEmail`. The pure rule is `lib/inbox-identity.ts`
  (`identityAddressFor` / `resolveAddressFor`); `resolveCustomerId`, `resweepThreads`, the link
  actions and the reader VM all key off it, so a picked message survives every re-sweep.
  Picking a message resets `suggestionDismissed` — "Not them" was about the previous party.
  Message-level links (each message its own customer/work) were decided against.
- **Venue on the thread (#124).** `CommThread.siteId` is a `CustomerLocation.id` (the directory
  id `sites.legacyLocId ?? sites.id`, the same id `quotes.locationId` stores). The Venue card
  reads the linked customer's composed `locations` — the same rows `sitesForCompany` returns,
  already on the doc, one query fewer. `siteId` is cleared wherever `customerId` changes to a
  different customer: `linkThread`, `applyResweepPatch`, the `Peak/Customers/*` label removal.
  `setThreadSiteAction` adopts a read-time-resolved customer first, so a site never exists
  without a stored `customerId`. Work links inherit it only where the target accepts it — the
  quote intake now (`site=`); survey/inspection create flows are unchanged.
- **"+ New quote" mints the draft in the intake (#123).** `createQuoteIntakeAction` never created
  a quote — every builder does on first save — so with `thread=` the intake creates the draft
  itself (`quotes.create`, `source: "inbox"`, `quoteType` from the card, `custom` → `system` +
  `category`, name = subject minus Re:/Fwd:), links the thread (`"<id> · <name>"` label, the
  picker's format), adopts the customer onto a thread that had none (same rule as
  `setLinkAction`'s adopt), and returns to `/inbox?thread=<id>` as specified. The Work chip's
  href is the Quotes hub, whose per-type "Open … →" link reaches the right builder with `?id=`;
  every builder tolerates a null engine subdoc. `/quotes/new` gained `customer=`, `contact=`,
  `site=`, `thread=` (the spec's claim that `customer=` was already read was stale).
- **`lead` is a work-link type (#123).** There was no `LINK_TYPES` constant; the picker's list is
  `LINK_TYPE_OPTIONS` (now in `lib/inbox-links.ts`, quote → lead → survey → inspection →
  project), with `/leads?lead=<id>` as the chip href and `#c85a3c` as its colour. Options are the
  customer's open leads (not won/lost).
- **Per-device pane layout (#126).** `localStorage["pk.inbox.layout.v1"]` = `{ rail, list }`;
  rail 180–320 or 0 (collapsed → a 48px icon column with every folder/view, Compose, Log call
  and the connection dot), list 300–640, reader `flex: 1`; read once after mount (server render
  uses the defaults — no hydration mismatch), written debounced 150 ms, every storage access in
  try/catch. Expanding restores 238, not the last width (the stored shape has no room for it).
  The handles follow the Inbox's own `narrow` breakpoint — **960 px**, where the reader pane is
  already hidden — not the nav's 860; below it stored widths are ignored and nothing changes.
  `SplitHandle` is a pointer-captured `role="separator"` (arrows 16 px, Home/End) with no
  dependency.
- **Signature (#127).** A string in the existing per-user `notif_prefs` row
  (`email_signature`); the Drizzle `$type` widened to `boolean | string`, no migration. 2,000
  chars, CRLF → LF, trimmed. Seeded as `"\n\n-- \n" + signature` on Reply / Reply all / New with
  the caret at the top; Forward keeps its block below the signature. The toggle strips by the
  exact block, else by the `\n-- \n` separator up to the next blank line, so edits above it are
  untouched. A signature alone is not a message — Send stays disabled until there is text above
  the separator. `doSend` / `buildRaw` / Gmail MIME untouched. Per user == per mailbox today.
- **Row name (#128).** `primaryName` = the newest message's author that isn't me (`user.name`,
  the store's own author convention), else the counterpart (`contactName || customer ||
  "Customer"` — the person, no longer the customer); `chain` = distinct authors in first-seen
  order as first names, me as "me", `(n)` when the thread has more than one message. The chain
  renders on its own muted line only when it says more than the name (multi-party threads);
  the count badge, status pill and waiting chip are unchanged.
- **`locationName` (the #96 follow-up).** One `toLocationInput`/`toContactInput`
  (`lib/customer-inputs.ts`) now serves the Inbox venue quick-add and the quote intake; the
  intake's private copy had dropped `locationName` on every full-replace save.
```

- [ ] **Step 3: PUNCHLIST.md** — change each heading and add a `**Shipped:**` paragraph after the item's `**Ask:**` paragraph:

`## 123. … — OPEN` → `## 123. Inbox: "Link to work" above the customer picker in the link sidebar, plus quick-add quote — DONE 2026-09-21 (D158)` with:

```markdown
**Shipped:** `WorkLinkCard` (`inbox/work-link-card.tsx`) is the sidebar's first card — chip,
picker (quote / **lead** / survey / inspection / project) and "+ New quote", which opens
`/quotes/new?customer=&contact=&site=&thread=`; the intake mints the draft quote, links the
thread and returns to it (`quotes/new/actions.ts`, `linkThreadToNewQuote`). Order is Work →
Customer → Venue → Linking from → Quick add.
```

`## 124. … — OPEN` → `## 124. Inbox: link a venue through the selected customer — DONE 2026-09-21 (D158)` with:

```markdown
**Shipped:** `CommThread.siteId` + a Venue card (select over the linked customer's venues, "+ New
venue…" through `quickAddVenueAction` which now attaches the new site); `setThreadSiteAction`;
cleared on any customer change; the quote intake receives it as `site=`.
```

`## 125. … — OPEN` → `## 125. Inbox: per-message picker to link from a specific message (in or out) — DONE 2026-09-21 (D158)` with:

```markdown
**Shipped:** decided as an identity source, not message-level links: `identityMessageId` + the
"Linking from" card (author · in/out · date, newest first, default "Thread contact");
`identityAddressFor` (`lib/inbox-identity.ts`) feeds `resolveCustomerId`, the re-sweep, the link
actions and quick-add; the bridge stamps `fromEmail`/`to` on imported messages.
```

`## 126. … — OPEN` → `## 126. Inbox: resizable list/reader panes + collapsible menu — DONE 2026-09-21 (D158)` with:

```markdown
**Shipped:** `SplitHandle` (`components/split-handle.tsx`) between rail/list and list/reader,
rail collapse to a 48px icon column, `{rail, list}` remembered per device in
`localStorage["pk.inbox.layout.v1"]` (`lib/inbox-layout.ts` clamps). Inbox folder rail only —
the app nav is untouched.
```

`## 127. … — OPEN` → `## 127. Inbox: email signatures, auto-appended — DONE 2026-09-21 (D158)` with:

```markdown
**Shipped:** Account → "Email signature" (plain text, 2,000 chars, preview), stored in the
per-user prefs row; the composer seeds `-- ` + signature on Reply / Reply all / New (above the
Forward block) with an "Add/Remove signature" toggle (`lib/inbox-signature.ts`).
```

`## 128. … — OPEN` → `## 128. Inbox: list row shows the last person who responded (Gmail-style); "waiting on them" badge stays — DONE 2026-09-21 (D158)` with:

```markdown
**Shipped:** `rowName` (`lib/inbox-rows.ts`) → `ThreadRowVM.primaryName` (newest non-me author,
else the counterpart) + `chain` ("Brenda, me (3)", shown when it adds information); status pill,
waiting chip and count badge unchanged.
```

- [ ] **Step 4: Spec implementation notes** — append to `docs/superpowers/specs/2026-09-21-inbox-round-3-design.md`:

```markdown
## Implementation notes (2026-09-21, D158)

- `LINK_TYPES` did not exist; `lead` was added to `LINK_TYPE_OPTIONS`, now in `lib/inbox-links.ts`.
- `resolveForThread` takes an address, not a thread; the thread → address rule is
  `resolveAddressFor` in `lib/inbox-identity.ts`, which needed `CommMessage.fromEmail` / `to`
  (stamped by the bridge) — messages stored only `author` before.
- The work picker lived at `thread-reader.tsx:502-648`, not 670-847.
- `/quotes/new` did **not** read `customer=`; and the intake never created a quote — with
  `thread=` it now mints the draft itself (§1 above, D158) so there is something to link.
- Venue options come from the linked customer's composed `locations` (the same rows as
  `sitesForCompany`, already loaded), value = `CustomerLocation.id`.
- The handles follow the Inbox's own 960 px breakpoint, not 860 (§4).
- `quickAddVenueAction` already kept `locationName`; the quote intake's private mapper was the
  one dropping it — both now use `lib/customer-inputs.ts`.
```

- [ ] **Step 5: Commit + push.**

```bash
git add DECISIONS.md PUNCHLIST.md docs/superpowers/specs/2026-09-21-inbox-round-3-design.md
git commit -m "docs: D158 Inbox round 3 — identity source, venue link, quote hand-off, pane layout, signatures, row names; close #123–#128

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin punch-2026-09-21-round-2
```

---

## Self-review

**1. Spec coverage — every spec section maps to a task**

| Spec section | Requirement | Task |
|---|---|---|
| §1 Data model | `siteId`, `identityMessageId` on `CommThread` (JSON, no hot column) | 1 |
| §1 | `LINK_TYPES` gains `lead`; `LINK_TYPE_OPTIONS` lists it | 3 (no `LINK_TYPES` exists — `LINK_TYPE_OPTIONS` + href + colour; noted in D158) |
| §1 | `signature` in the per-user prefs doc; layout in `localStorage` `pk.inbox.layout.v1` `{rail, list}` | 7, 6 |
| §2 Resolver | `identityAddressFor(t)` pure + tested; inbound → From, outbound → first recipient, fallback to `contactEmail`; re-sweeps use it; "Linking from: name, in/out, date" | 1 (helper, `resolveAddressFor`, resweep, `setIdentityMessage`), 3 (the sidebar line) |
| §3.1 Work | picker moved into `WorkLinkCard`, same `setLinkAction`; "+ New quote" → `/quotes/new?customer&contact&site&thread`; intake reads them, links the thread on save, returns to `/inbox?thread=` | 3, 4 |
| §3.2 Customer | unchanged cards; a different customer clears `siteId` | 3 (cards), 1 (`linkThread`/`applyResweepPatch`/label removal clear) |
| §3.3 Venue | select over the customer's sites + "+ New venue" via `quickAddVenueAction` → `setThreadSiteAction`; quote intake carries `site=` | 2 (actions), 3 (card), 4 (`site=` → `locationId`) |
| §3.4 Linking from | select of messages newest-first, default "Thread contact" → `setIdentityMessageAction` re-resolves that thread | 1 (store), 2 (action), 3 (card) |
| §3.5 Quick add | unchanged | 3 (kept; sender now the identity address) |
| §3 Actions | both `requireUser` + `visibleTo` + revalidate; `quickAddVenueAction` keeps `locationName` | 2 |
| §4 Panes | `SplitHandle` (6px, pointer capture, arrows 16px, `role="separator"` vertical, no dependency); shell layout state read once / debounced 150ms / clamped (rail 180–320 or 0, list 300–640); `thread-list` `width` prop; rail chevron → 48px icon column with badges; `clampLayout` tested; handles hidden below the breakpoint | 6 (breakpoint is the Inbox's 960 — D158) |
| §5 Signatures | Account textarea (≤2,000, preview) via `saveSignatureAction`; `openMode` seeds `"\n\n-- \n" + sig` for Reply/Reply-all/New, Forward keeps its block below; toggle matched on `\n-- \n`; `doSend` unchanged; per user | 7 |
| §6 Row name | `rowName(t, meName)` → primary (newest non-me author / counterpart), secondary chain "Brenda, me (3)"; `ThreadRowVM.primaryName/chain`; `thread-list` renders them; status/wait untouched | 5 |
| §7 test:specs | `identityAddressFor` (3 cases + more), `rowName` (4 cases + more), `clampLayout` | 1, 5, 6 (+ `toLocationInput`, `newQuoteHref`, `quoteNameFromSubject`, `intakeInitialState`, signature helpers in 2, 3, 4, 7) |
| §7 regressions | `setThreadSite` stamps + customer change clears; `setIdentityMessage` re-resolves + re-sweep keeps it; intake with `thread=` links (`linkThreadToNewQuote`); `saveSignature` round-trip + seed has `-- `; venue keeps `locationName` | 1, 1, 4, 7, 2 |
| §7 smoke | `/inbox`, `/inbox?view=unmatched`, `/account` already listed; the new `/quotes/new?…&thread=` route added | 4 |
| §7 browser pass | listed per task for the controller | 3, 4, 6, 7 |
| Out of scope | no message-level links, no app-nav compact mode, no HTML signatures, no label colours | respected |

**2. Placeholder scan.** No "TBD", "TODO", "similar to Task N", "add validation" or "handle edge cases" in any step; every code step is the complete function/component/action. The one abbreviated block — Task 6's `{/* …the existing three blocks, unchanged… */}` — refers to code that stays byte-for-byte as it is at `inbox-shell.tsx:581-852` (it is wrapped, not rewritten), and the exact lines are cited.

**3. Type/name consistency across tasks.**
- `identityAddressFor` / `resolveAddressFor` / `firstRecipient` / `IdentityAddress` — defined in Task 1 (`@/lib/inbox-identity`), consumed in Tasks 1 (linking, comms), 2 (link-actions), 3 (page.tsx).
- `setThreadSite` / `setIdentityMessage` — Task 1 (`linking.ts`), consumed by Task 2 actions; `linkThreadToNewQuote` — Task 4 (`linking.ts`), consumed by Task 4's intake action and regression.
- `setThreadSiteAction(threadId, siteId)` / `setIdentityMessageAction(threadId, messageId)` / `quickAddVenueAction({…, threadId?}) → { ok: true; siteId }` — Task 2, consumed by Task 3's sidebar (the `run` helper accepts `{ ok: boolean; error?: string }`, which the widened venue result satisfies).
- `toLocationInput` / `toContactInput` — Task 2 (`@/lib/customer-inputs`), used by `link-actions.ts` and `quotes/new/actions.ts`.
- `LinkWorkType`, `LINK_TYPE_OPTIONS`, `newQuoteHref` — Task 3 (`@/lib/inbox-links`); `quoteNameFromSubject` — Task 4 (same module); `ReaderVM.linkOptions: Record<LinkWorkType, Opt[]>` (Task 3 types.ts) matches `WorkLinkCard`'s `vm.linkOptions[linkType]` and page.tsx's five-key literal.
- `ReaderVM.siteId / siteOptions / identityMessageId / identity` — Task 3 types.ts ↔ page.tsx literal ↔ `link-sidebar.tsx` / `work-link-card.tsx` reads.
- `IntakeInitial` / `intakeInitialState` / `IntakeSubmit.threadId` — Task 4 `types.ts` ↔ `page.tsx` ↔ `intake-form.tsx` ↔ `actions.ts`.
- `rowName` → `ThreadRowVM.primaryName / chain` — Task 5 (`inbox-rows.ts`, `types.ts`, `page.tsx`, `thread-list.tsx`).
- `clampLayout` / `parseLayout` / `LAYOUT_KEY` / `RAIL_*` / `LIST_*` / `InboxLayout` — Task 6 (`inbox-layout.ts`) ↔ `inbox-shell.tsx`; `SplitHandle({ value, min, max, onChange, label })` ↔ both call sites; `ThreadList` `width` prop ↔ `width={listWidth}`.
- `SIGNATURE_MAX` / `signatureBlock` / `hasSignature` / `stripSignature` / `withSignature` / `normalizeSignature` — Task 7 (`inbox-signature.ts`) ↔ `notif-prefs.ts`, `account/actions.ts`, `signature-card.tsx`, `thread-reader.tsx`, `compose-modal.tsx`; `signatureFor` / `setSignature` ↔ `account/page.tsx`, `inbox/page.tsx`, the regression; the `signature: string` prop flows `page.tsx → InboxShell → ThreadReader ×2 + ComposeModal`.
- Test-harness identifiers are all `r3`-prefixed (`r3msgs`, `r3loc`, `r3full`, `r3a`…`r3h`, `r3now`, `r3t`, `r3made`, `r3sig`…) so they cannot collide with the existing `plan`, `collapsed`, `rec`, `cid` consts; the regression sections reuse `getDoc`, `linkThread`, `resweepThreads`, `upsertDoc` that `main()` already has in scope.
