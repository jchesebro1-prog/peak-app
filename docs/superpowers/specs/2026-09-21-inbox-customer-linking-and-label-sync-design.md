# Inbox: automatic customer linking, link sidebar, two-way Gmail labels, derived status

Status: approved by Jeff (brainstorming session 2026-09-21) — build queued behind the
Gmail hardening batch (login `callbackUrl`, redirect-URI visibility, address fallback,
`CRON_SECRET`), since none of this runs until Connect works in production.

## Context

Gmail Phase 7 (D33–D37, D73/D74) imports mail into `comms` and mirrors INBOX both ways,
but every imported thread is created with `customerId: null`
(`src/lib/gmail/bridge.ts` recordMessage). Linking is lazy: `resolveCustomerId()` in
`src/lib/stores/comms.ts` does an exact contact-email match by scanning every customer
document, only when a screen asks. The customer activity feed (D121) therefore never sees an
email until something triggers that lookup, and mail from addresses not yet on a contact —
new district staff, AP, procurement — never links at all.

Gmail labels are read (per-mailbox cache, `30ef1eb`; Inbox filter) but never written except
the INBOX label for archive. The identity core (D85) already has an indexed `contact_emails`
table that comms does not use.

Jeff's asks, 2026-09-21:

1. Link emails to customers **automatically when they arrive**, by contact and by domain.
2. A **link sidebar** in the reader that suggests the customer when a contact matches, and
   when nothing matches, asks to link the sender's **domain** to a customer so it's easier
   going forward. Quick-add customers, contacts and venues from the sidebar, the way the
   guided quote intake (`/quotes/new`, D138) does.
3. Labels **both ways**: the app writes labels into Gmail, and labels applied in Gmail act as
   instructions — customer link, status, route to lead/project, assign to teammate.
4. Fix the **"Waiting on us" stamp** that survives a reply (the Brenda thread).

## 1. Resolver — runs on ingest, not on read

`src/lib/gmail/resolve.ts` — a pure function over injected lookups so it is spec-testable:

```ts
type Resolution =
  | { kind: "linked";    customerId: string; contactId?: string; via: "contact" | "domain" }
  | { kind: "ambiguous"; candidates: Array<{ customerId: string; name: string }> }
  | { kind: "unknown" };

resolveSender(email, { contactsByEmail, customersByDomain }): Resolution
```

Rules, in order:

| Outcome | Rule | Source |
|---|---|---|
| `linked` (contact) | exact address is on a contact | `contact_emails` (indexed) |
| `linked` (domain) | sender's domain is claimed by exactly one customer | new `customer_domains` |
| `ambiguous` | domain claimed by 2+ customers — list them, never guess | `customer_domains` |
| `unknown` | nothing matched | — |

Public webmail domains (`PUBLIC_EMAIL_DOMAINS` in `lib/gmail/config.ts`: gmail, googlemail,
yahoo, outlook, hotmail, live, icloud, me, aol, comcast, att, msn, protonmail, …) are never
claimable and never suggested — a personal-webmail sender goes straight to contact-level
linking.

Where it runs:

- **On thread creation** in `recordMessage` — the inbound sender, or the outbound first
  recipient — replacing the `customerId: null` stamp. Replies inherit the thread's link
  exactly as they do now.
- **Backfill**: one pass over every thread with no `customerId`, run from the same sync
  claim slot so it cannot overlap itself.
- **Re-sweep**: whenever a contact gains an email or a domain is claimed, re-resolve every
  thread whose `resolution !== "linked"` and whose sender matches the new address/domain.
  Linking one email from a district fixes that district's whole history.

`resolveCustomerId()` stays as the read-time fallback for legacy callers, but switches
from the full customer scan to a `contact_emails` lookup.

## 2. Link sidebar (reader context panel)

A right-hand panel in `thread-reader.tsx`, always present. It absorbs the existing inline
"+ Link to work" picker and its `resolvedCustomerId` / `needsAdopt` plumbing. State is
driven by the thread's `resolution`:

- **Linked** — customer card (name, tier, open quotes/projects count), the matched contact,
  the *Link to work* picker. "Wrong customer?" opens the picker to re-link.
- **Suggested** (domain match not yet adopted) — "Looks like **Lakefront ISD** — 3 contacts
  at `@lakefront.k12.mn.us`." **Link** stamps the thread and adds the sender address to a
  contact (pick an existing one or quick-add). **Not them** dismisses for this thread only.
- **Unknown domain** — "`@newdistrict.org` isn't linked to a customer yet. **Link this
  domain to…**" with a customer picker that includes **+ New customer**. Linking writes
  `customer_domains` (`source: "manual"`) and triggers the re-sweep immediately.
- **Ambiguous** — the candidate list. Picking one links this thread; "always use this one
  for this domain" rewrites `customer_domains` to a single manual owner.
- **Quick-add** in every state: **+ Customer**, **+ Contact** (pre-filled with the sender's
  display name + address, attached to the linked/selected customer), **+ Venue** (attached to
  the customer). One shared `EntityQuickAdd` component extracted from
  `quotes/new/intake-form.tsx`'s `pick | new | skip` inline forms, calling the same
  `saveCustomerAction` / contact / venue actions those already use. The quote intake is
  refactored to use the extracted component so there is one implementation.

Every manual link action also records the sender's address on the chosen contact
("remember this address") unless the user unticks it.

## 3. Label sync — both ways, one namespace

The app owns everything under `Peak/`. Nothing outside the namespace is read or written.

| Label | Meaning | App writes when… | Gmail-applied means… |
|---|---|---|---|
| `Peak/Customers/<Name>` | thread ↔ customer | thread links (resolver, sidebar, domain claim) | link this thread to that customer; remember the sender on a contact |
| `Peak/Status/Needs reply` · `Waiting` · `Done` | status | status changes in Peak | set status, clearing the other two |
| `Peak/Assign/<First name>` | assignedTo | assignment changes in Peak | assign; fire the to-do bell |
| `Peak/New lead` | route (command only) | never | create a lead in the SLA queue pre-linked to the customer, then swap this label for `Peak/Leads/<id>` so it cannot fire twice |
| `Peak/Projects/<id>` · `Peak/Leads/<id>` · `Peak/Quotes/<id>` | work link | *Link to work* set | attach the thread to that record |

Status label mapping: `Needs reply` ↔ `waiting_us`, `Waiting` ↔ `waiting_them`,
`Done` ↔ `closed`. `replied` and `draft` have no label.

**Lazy creation per mailbox.** Labels are created with `users.labels.create` the first time a
name is needed in that mailbox, and the id cached in the connection's `labelMap`. Customer
renames re-label on next touch; a deleted customer leaves a stale label the next sync removes
from any thread it still tags.

**Peak → Gmail.** Every comms mutation of link / status / assign / work-link already flows
through `src/lib/stores/comms.ts`; each gains a `syncPeakLabels(thread)` tail that diffs the
*desired* `Peak/*` set against the thread's cached `gmailLabelIds` and issues one
`messages.modify` per thread (`addLabelIds` / `removeLabelIds`). A Gmail failure never blocks
the Peak write: it logs and the next sync pass reconciles, the same contract as two-way
archive (`pushInboxState`).

**Gmail → Peak.** The history replay in `bridge.ts` already sees `labelsAdded` /
`labelsRemoved` events and filters them for INBOX. A new `interpretLabelEvent(event)` handles
the `Peak/*` subset: resolve label name → command (table above), apply it through the same
store functions the UI uses (so the activity feed, badges and bell fire), then mark the
thread's `gmailLabelIds` as in-sync so the app does not echo the label back.

**Conflict rule.** Last write wins by timestamp: Gmail history events carry the change time,
Peak writes stamp `updatedAt`. Same-second collisions resolve in Gmail's favour.

**Cadence.** Mechanism C: the interpreter runs inside the existing sync — ~2 min with an
Inbox tab open, every 5 min via `/api/gmail/sync` once `CRON_SECRET` is set on Vercel. Gmail
push (Pub/Sub `watch`) is a later phase; it only tells us *that* something changed and the
same history replay does the work, so it slots in without touching the interpreter.

**Scopes.** `gmail.modify` — registered on the consent screen 2026-09-21. Nothing further.

## 4. Data model

- **new table `customer_domains`**: `domain` (pk, lowercased), `customer_id`, `source`
  (`learned` | `manual`), `added_by`, `at`. `learned` rows come from "remember this address"
  when the address's domain is not public and not yet claimed. Migration via `db:generate`.
- **`comms` document** gains `resolution: "linked" | "suggested" | "ambiguous" | "unknown"`,
  `suggestedCustomerId?`, `candidates?: Array<{ customerId; name }>`. `resolution` is
  promoted to a hot column so the Unmatched view is one indexed query.
- **`gmail_connections`** gains `label_map` (JSONB: `Peak/…` name → Gmail label id).
- `PUBLIC_EMAIL_DOMAINS` constant in `src/lib/gmail/config.ts`.

## 5. Inbox views

- **Unmatched** in the sidebar's *Views* list: `resolution ∈ {unknown, ambiguous}`, count
  badge, so leftovers get worked down.
- The customer record's activity feed (D121) shows a thread the moment it links; the
  backfill and re-sweep fill in history.

## 6. Status derivation (the "Waiting on us" bug)

**Defect.** `recordMessage` stamps `d.status = threadStatusFor(dir)` for *every* message it
records (`bridge.ts` ~line 198). Gmail's `messages.list` returns newest first, so on import a
reply (`out` → `waiting_them`) is recorded before the original (`in` → `waiting_us`) and the
older message's stamp wins. A poll that catches two messages in one batch has the same race.
Replying from Gmail itself, or from the app, both show as still waiting on us.

**Rule.** Status is *derived* from the thread, not stamped per message:

```
latest   = message with the greatest `at`
derived  = latest.direction === "in" ? "waiting_us" : "waiting_them"

if thread.status === "draft"                          → keep (never override a draft)
if thread.status === "closed" && latest.direction === "out" → keep closed
otherwise                                              → derived
```

`closed` reopens to `waiting_us` only on a new inbound. `messages` is kept sorted by `at` on
write. A one-off re-derive runs over every thread on the next sync after deploy so existing
threads (Brenda's included) correct themselves. Manual `setStatus` remains available and is
respected until the next message lands.

This item is independent of §1–§5 and ships with the Gmail hardening batch.

## 7. Testing

- `test:specs`: resolver precedence (contact beats domain; ambiguous never guesses; public
  webmail never claims or suggests), label-name ↔ command parsing in both directions,
  desired-label diffing, conflict rule, status derivation with messages fed newest-first.
- `test:review:regressions` (scratch DB): ingest a thread → linked; claim a domain →
  re-sweep links the backlog; a `Peak/New lead` event creates exactly one lead and swaps the
  label; a reply imported before its original still yields `waiting_them`.
- Smoke: `/inbox` 200 with the sidebar; `/inbox?view=unmatched` 200.

## Out of scope

- Gmail push notifications (Pub/Sub) — later phase.
- Forward-to-`log@` parsing (MASTER-QUESTIONS C9).
- Calendar scope / API enablement — separate follow-up from the 2026-09-21 Gmail session.
