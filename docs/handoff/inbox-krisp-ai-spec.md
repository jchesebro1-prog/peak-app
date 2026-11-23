# Inbox, Gmail, Krisp and AI features — functional specification (handoff)

Status: written 2026-11-19 from the code in this repository, for a team that will rebuild these
features in a different application. They are being removed here. The companion document
`removal-map-inbox-krisp-ai.md` says how to delete the code.

How to read this document

- It describes behaviour, not implementation. Where a rule is stated as "MUST", the current code
  enforces it and a rebuild should too.
- "Peak" means the business that owns the app (Peak Systems Group, a theatrical rigging, drapery,
  lighting and AV contractor). "Staff", "rep" and "teammate" mean signed-in team members. "Customer"
  and "company" mean a company in the CRM. "Venue" means one of a company's physical locations.
- "Owner" of an email thread means the staff member whose mailbox it is in.
- Every section ends with a **Source** line listing the repository files it was derived from.
  Paths are relative to the repository root.
- "Not verified" means the behaviour was taken from project notes or a code comment and was not
  traced through the code. Section 14 collects all of these.
- Where project documentation and code disagree, the code is described and the disagreement is
  noted (section 13.3).
- Numbers (limits, scores, time windows, model names, prices) are the constants in the code on
  the date above.

Contents

1. Purpose and users
2. Data model
3. Mailbox identity and thread visibility
4. Gmail integration
5. The Inbox email client
6. Linking email to CRM records
7. Inbox organization (filing, court, noise, archive-on-reply, promise tasks)
8. Krisp: recordings and the meeting matcher
9. The Assist layer (AI gate, providers, cost)
10. Assist features
11. Sending estimates by email (Send & track, bidders, other drafts)
12. Google Calendar, Tasks and Drive touchpoints, and other surfaces
13. Security rules, known gaps, and disagreements
14. Not verified

---

## 1. Purpose and users

Four feature groups are covered. They are layered: each one depends on the ones above it.

| Group | What it does | Depends on |
| --- | --- | --- |
| Gmail integration | Connects each staff member's own Google mailbox. Imports mail, sends mail, mirrors archive and labels both ways | Google sign-in credentials |
| Inbox | An email client inside the app at `/inbox`. Every customer touch (email, logged call, logged meeting) is a message in a thread. Threads link to companies, venues, people, leads, quotes and projects | Gmail integration (works in a simulated mode without it) |
| Inbox organization | Rules that decide, for each thread, where it should be filed, whose turn it is ("court"), and whether it is noise. Archives a thread after a reply | Inbox |
| Krisp | Two features on one Krisp connection: in-app audio recordings sent to Krisp for transcription, and a matcher that lists every Krisp meeting and suggests which company it belongs to | A per-person Krisp API key |
| Assist (AI) | Optional model calls behind a gate: task suggestions, reply drafts, estimate suggestions, a daily brief, a question-answering panel, vendor PDF reading, and AI help for Inbox organization | Inbox, Krisp, and an Anthropic API key |

Users

| User | What they can do |
| --- | --- |
| Any signed-in staff member | Connect their own mailbox and Krisp key; use their own Inbox; see teammates' threads that were deliberately linked to a record, read-only |
| Administrator (`manage_users` permission) | Disconnect any mailbox; edit the Assist pilot list, feature switches, spend cap and API key; edit company-wide sender rules and the own-domain list |
| Assist pilot user | A staff member on the allow-list. Only they see or trigger any AI feature |
| Customer | Never signs in to any of this. They receive ordinary email from the rep's own Gmail address |

Everything except Assist is deterministic. Assist never sends, links, files or creates anything
by itself, with two exceptions that are stated where they occur: promise tasks (section 7.7) and
moving noise out of the inbox for pilot users (section 7.4).

**Source:** `AGENTS.md` (phases 7, 8, 42, 46, 53–58, 60, 63), `src/lib/stores/comms.ts`,
`src/lib/gmail/config.ts`, `src/lib/assist/config.ts`, `src/lib/inbox-org/pipeline.ts`,
`src/lib/meetings/types.ts`, `src/lib/stores/recordings.ts`.

---

## 2. Data model

Most records are whole JSON documents in "collections" (one table per collection, columns `id`,
`doc`, `rev`, `seq`, `updated_at`, `received_at`, `review`, `deleted`). Small singletons are
"blobs" (one row, a JSON object, merged per key). Timestamps are epoch milliseconds.

### 2.1 Records at a glance

| Record | Storage | Id format |
| --- | --- | --- |
| Email / call / meeting thread | collection `comms` | `C-` + number, counter starts at 1032 |
| Message inside a thread | array on the thread | `m<n>-<4 random base-36 chars>` for app-written; `gm-<Gmail message id>` for imported |
| Gmail connection | table `gmail_connections` | key `personal:<user id>` |
| Gmail label cache | table `gmail_labels` | (mailbox key, Gmail label id) |
| Extra calendar account | table `calendar_connections` | Not verified |
| Sender-domain claims | table `customer_domains` | Not verified |
| Email signatures | blob `email_signatures` | map keyed by user display name |
| Sender rules | blob `inbox_sender_rules` | rule id format not verified; at most 2,000 rules |
| Filing log | blob `inbox_filing_log` | at most 2,000 entries |
| Inbox organization settings | blob `inbox_org_settings` | own-domain override, per-user "keep in inbox" |
| Cleanup run state | blob `inbox_cleanup:<user id>` | one per user |
| Krisp connection | table `krisp_connections` | primary key = user id |
| Krisp meeting | collection `meetings` | `km-<Krisp meeting id>` |
| In-app recording | collection `recordings` | `REC-` + number, counter starts at 9000; or `rec-<uuid>` when created offline |
| Assist model call | collection `assist_runs` | `AR-<time base-36>-<4 random chars>` |
| Assist API key | blob `assist_secrets` | encrypted |
| Estimate suggestion | blobs `estsugg:<id>`, `estsugg-src:<kind>:<source id>`, `estsugg-quote:<quote id>` | suggestion id `ES-` + 6 to 40 lower-case alphanumerics |
| Daily brief | blob `brief:<user id>:<YYYY-MM-DD>:<slot>` | slot = `morning` or `midday` |
| Meeting-derived task / note | collections `tasks`, `notes` | `T-mtg-<hash>`, `N-mtg-<hash>` |
| Promise task | collection `tasks` | `T-prm-<hash of thread id, message id, normalised text>` |

### 2.2 Thread

| Field | Meaning |
| --- | --- |
| `id` | `C-####` |
| `mailbox` | Always `personal` for new threads. `sales`, `installs`, `info` exist on old threads only (shared mailboxes were retired) |
| `mailboxOwnerId` | The user id that owns the thread. The identity every ownership check uses. The special value `unresolved` means "owned by nobody, permanently" |
| `mailboxUser` | The owner's display name. For display only |
| `gmailAccountKey` | Which connection's Gmail account holds the Gmail thread (`personal:<user id>`) |
| `gmailThreadId` | Gmail's thread id, once any message is sent or imported |
| `gmailInboxed` | Gmail-side INBOX membership. `undefined` = never bridged; `false` = archived or labelled out of INBOX in Gmail |
| `unread`, `archived`, `flagged`, `pinned`, `deleted` | Flags. `archived` is the app's own flag and is separate from `gmailInboxed`. `deleted` means "in the Deleted folder" (recoverable) |
| `category` | One of six fixed colour keys: red, orange, yellow, green, blue, purple; or none |
| `customerId`, `customer` | Linked company id and name |
| `siteId` | Linked venue (must belong to the linked company) |
| `contactName`, `contactEmail`, `cc` | The counterpart |
| `resolvedContactId`, `linkedContactIds` | The primary linked person and all linked people (at most 25) |
| `linkedBy` | `user` or `filing` when the link was deliberate; absent when the company came only from automatic sender matching |
| `link` | One work link: `{type, id, label}` where type is quote, lead, project, survey or inspection. `renewal: true` marks a renewal-outreach thread |
| `resolution` | How the sender was matched: `linked`, `suggested`, `ambiguous`, `unknown` |
| `suggestedCustomerId`, `candidates`, `suggestionDismissed` | Sender-match suggestion state |
| `identityMessageId` | Which message's address drives sender matching (default: the thread counterpart) |
| `subject`, `channel` | Channel is `email`, `call` or `meeting` |
| `status` | `waiting_us`, `waiting_them`, `replied`, `closed`, or `draft` |
| `assignedTo`, `assignedToId` | Display name and user id of the assignee (default: the owner) |
| `draft` | `{to, cc, subject, body, attachments}` while status is `draft` |
| `messages` | Array of messages |
| `filing`, `court`, `noise` | Inbox organization state (section 7) |
| `preDraft`, `preDraftLeaseUntil` | A pre-made AI reply (section 10.4) |
| `userLabelOps`, `peakLabelsAppliedAt` | Echo-suppression stamps for Gmail label sync |

### 2.3 Message

| Field | Meaning |
| --- | --- |
| `id`, `at` | Id and time |
| `direction` | `in` or `out` |
| `channel` | `email`, `call`, `meeting` |
| `author`, `body` | Plain text only |
| `attachments` | See 2.4 |
| `queued` | Waiting in the Outbox (written while offline) |
| `gmailId`, `gmailThreadId`, `gmailMessageId`, `gmailLabelIds` | Gmail ids, the RFC Message-ID header, and the Gmail label ids at import time |
| `fromEmail`, `to`, `cc` | Addresses as the message carried them |
| `link` | Optional per-message record link |
| `bulk` | Mailing-list mail: a `List-Unsubscribe` header, or `Precedence` of bulk, list or junk |
| `autoSubmitted` | An `Auto-Submitted` header other than `no` |
| `sendFailure`, `sendError`, `noAutoRetry`, `deliveryNote` | Outbound failure state (section 4.5) |

### 2.4 Attachment

An attachment has `name`, `mime`, `size` and exactly one way to reach its bytes:

| Reference | Used for |
| --- | --- |
| `dataUrl` | Small generated documents carried inline |
| `pdfPath` + `href` | A stored quote or assessment PDF, by reference |
| `gmailPartId` | An imported Gmail attachment. Bytes stay in Gmail and are fetched on demand |
| `blobPath` | A composer upload in private file storage under `mail-attachments/` |
| `documentId` | A Documents record of the email's company or project |
| `fwdFrom` + `gmailPartId` | A forwarded Gmail attachment, read from the source message |

**Source:** `src/lib/stores/comms.ts`, `src/db/schema.ts`, `src/db/doc-tables.ts`,
`src/lib/stores/inbox-org.ts`, `src/lib/stores/signatures.ts`, `src/lib/stores/assist-runs.ts`,
`src/lib/assist/features/suggestion.ts`, `src/lib/brief/build.ts`, `src/lib/meetings/types.ts`,
`src/lib/stores/recordings.ts`, `src/lib/inbox-org/ids.ts`, `src/lib/inbox-org/cleanup.ts`.

---

## 3. Mailbox identity and thread visibility

The owner's rule, in his words: "you can only see information that was either linked to entities
or your own information", and a mailbox "should all be linked to the email address so you can't
view a different mailbox that isn't tied to your email".

### 3.1 Who owns a thread

A thread is in a person's own mailbox when its `mailbox` is `personal` and the first rule that
applies says so:

1. `mailboxOwnerId` is set: it must equal the person's user id. The value `unresolved` equals
   nobody.
2. Otherwise `gmailAccountKey` is set: it must equal `personal:<the person's user id>`.
3. Otherwise (a legacy thread with only a name): `mailboxUser` must equal the person's display
   name exactly AND no other user of any status (archived and removed included) holds that name,
   compared trimmed and case-insensitively.

Rules

- Ownership MUST be decided by user id, never by display name, except in case 3.
- A name held by two users owns nothing (fail closed).
- Creating a thread in a personal mailbox without an owner id and name MUST fail. There is no
  default owner.
- Legacy threads are stamped with `mailboxOwnerId` lazily, the next time their owner performs a
  write on them, using a compare-and-set that only writes where the field is still absent.
- Before a user is renamed, legacy name-only threads carrying the old name MUST be stamped: to
  that user if the old name was theirs alone, else to `unresolved`. Before a name becomes held
  (a new user, or a rename to it), name-only threads already carrying it MUST be stamped
  `unresolved`. A newcomer inherits no mail.
- The same three-step shape decides "assigned to me": `assignedToId` when set, else the
  `assignedTo` name only while the person's name is unique.
- Legacy shared-mailbox threads are owned by nobody.

### 3.2 Who can see a thread

A person can see a thread when it is not in Deleted and any of these holds:

| Reason | Condition |
| --- | --- |
| Own | It is in their own mailbox (3.1) |
| Assigned | It is not a draft and is assigned to them |
| Linked | It is not a draft and is deliberately linked (3.3) |
| Shared by task | It is not a draft and its owner shared it with them through a task (3.4) |

- Another person's draft MUST never be visible.
- The owner can also open their own thread in Deleted.
- Seeing a thread MUST never grant a write. Every write (reply, read state, status, flags,
  filing, links, labels, delete) requires ownership. A non-owner sees the thread read-only with
  the banner "In <owner name>'s mailbox — read only" (or "Shared mailbox — read only").
- A write attempted on a thread the caller does not own MUST answer exactly like a missing
  thread.
- The same rule MUST be available as a database filter so that search and listings never load a
  thread the viewer cannot see.

### 3.3 What "deliberately linked" means

A thread is linked when it has a company, a venue, a work link, or linked people, AND the link
was deliberate. A link is deliberate when any of these is true:

- `linkedBy` is `user` or `filing`;
- its filing state is `filed` and the filing is not noise;
- it has a work link (type and id both present);
- it has a venue;
- it has linked people;
- its channel is not email (a logged call or meeting) and it has a company.

The last four are proofs for threads written before `linkedBy` existed: no automatic path ever
writes those fields.

Automatic sender matching (section 6.1) sets the company and the primary contact but MUST NOT set
`linkedBy`. An automatically matched thread stays private. Adding a contact to the CRM MUST never
expose anyone's mail.

A thread created in the app with a picked company or record (Compose, Log call, an estimate
email, renewal outreach) is `linkedBy: user` from the start.

### 3.4 Sharing through a task

When a thread's owner creates a task from the thread and assigns it to someone else, the server
writes a stamp on the task: `{threadId, by, to, at}`. The assignee can read that one thread,
read-only, while the task is not deleted, the stamp names them, and the task is still assigned to
them. Re-assigning the task makes the old stamp inert. A viewer carries at most 2,000 such thread
ids, loaded in one query per request.

### 3.5 Read-only surfaces for non-owners

- An assignee can mark an assigned thread Done or reassign it from the Home "Start here" list; the
  thread is re-checked at action time.
- An administrator viewing a teammate's Start here list sees "Private email" in place of rows for
  threads they cannot see.

**Source:** `src/lib/stores/comms-visibility.ts`, `src/lib/mailbox-viewer.ts`,
`src/lib/mailbox-names.ts`, `src/lib/inbox-thread-guard.ts`, `src/lib/task-thread-share.ts`,
`src/lib/comms-owner-stamp.ts`, `src/lib/triage/thread-access.ts`, `DECISIONS.md` (D1004–D1016,
D1063–D1073).

---

## 4. Gmail integration

### 4.1 Gate

The integration is inert unless all of these are set: the Google OAuth client id and secret (the
same client used for staff sign-in) and `GMAIL_ENABLED=true`. With the gate off the Inbox runs in
a simulated mode: outbound messages are stamped as sent locally and nothing contacts Google.

There is no Google SDK. Every call is a plain HTTPS request to Google's REST endpoints.

### 4.2 Connecting a mailbox

1. The person opens `/api/gmail/connect?mailbox=personal:<user id>`.
2. They must be signed in and active. A person may connect only their own mailbox; connecting
   someone else's requires `manage_users`.
3. The server redirects to Google's consent screen with `access_type=offline`,
   `prompt=consent`, `include_granted_scopes=true`, and a `login_hint` of the person's email when
   it is their own mailbox.
4. Google returns to `/api/gmail/callback`. The server verifies the signed state, requires that
   the user who started the flow is the signed-in user, exchanges the code, reads the authorised
   address, and stores the connection.
5. Administrators land on Settings → Integrations; everyone else on their Account page, with
   `?gmail=` set to `connected`, `denied`, `badstate`, `error`, `disabled`, `badmailbox` or
   `forbidden`.

Scopes

| Scope | When requested | Purpose |
| --- | --- | --- |
| `gmail.send` | Always | Send mail (a copy lands in Gmail Sent) |
| `gmail.readonly` | Always | Import and poll |
| `gmail.modify` | Always | Two-way archive and labels |
| `userinfo.email` | Always | Learn the authorised address |
| `calendar.events` | `?calendar=1` | Calendar read/write (section 12) |
| `tasks` | `?tasks=1` | Google Tasks sync |
| `drive.file` | `?drive=1` | Recordings audio archive |
| `drive.readonly` | `?drivephotos=1` | Catalog product photos folder |
| `calendar.readonly` + `userinfo.email` | `?purpose=calendar-connect` | A second Google account, calendars only, no mailbox |

Rules

- The state parameter MUST be signed (HMAC-SHA-256, key derived from the app secret) and carry
  the mailbox key, the initiating user id and a random nonce. The signature is compared in
  constant time.
- Refresh and access tokens MUST be encrypted at rest (AES-256-GCM, key = SHA-256 of the app
  secret, stored as `base64(iv).base64(tag).base64(ciphertext)`). Encryption MUST fail loudly if
  the app secret is missing.
- An access token is refreshed when it is within 60 seconds of expiry.
- A connection made before `gmail.modify` was added keeps working one-way; Settings flags it to
  reconnect.
- Disconnecting deletes the stored tokens. Imported threads remain.
- Settings shows a warning when the configured redirect origin differs from the app's own origin
  (scheme and host compared).

Connection record: mailbox key, address, user id, who connected it, encrypted refresh token,
encrypted cached access token and its expiry, granted scope string, Gmail history cursor,
"initial import done" flag, last sync time.

### 4.3 Sync triggers

| Trigger | Frequency | Notes |
| --- | --- | --- |
| Inbox page open in a browser | Every 3 minutes | Calls the throttled sync |
| "Send/Receive" button | On click | Skips a mailbox only if a sync of it started in the last 10 seconds |
| Server boot timer | Every 2 minutes | Only on a long-lived server process, not on serverless hosting |
| Scheduled job `GET /api/gmail/sync` | Daily at 11:45 UTC | Requires `Authorization: Bearer <CRON_SECRET>`; returns 503 when no secret is configured, 401 on a wrong one; 60-second limit |

- A mailbox is synced by an automatic trigger only when its last sync started more than 2
  minutes ago.
- Each sync MUST claim the mailbox atomically by stamping the start time with a conditional
  update, so concurrent callers never sync the same mailbox twice inside the window, and a
  failing mailbox still advances its stamp.
- The scheduled job also runs unrelated daily work as riders, each in its own error boundary:
  Google Tasks sync, Krisp recording reconcile and archive, vendor price-list checks, the morning
  triage build, the Krisp meeting sync, the morning brief and draft queue (cut off at 35 seconds),
  and the catalog photo sync (cut off at 45 seconds).

### 4.4 Import and poll

First sync of a mailbox (history import)

- Imports mail newer than 90 days (`newer_than:90d`).
- Message ids are listed first and de-duplicated against every Gmail message id already stored,
  before any full message is fetched.
- At most 80 newly recorded messages per chunk, at most 8 chunks per run, inside a 40-second
  budget. The run stops at a chunk boundary and the next sync resumes.
- A Gmail rate-limit response pauses the import and keeps what was stored. The import is marked
  done only when the listing is exhausted; then the history cursor is saved.

Later syncs (incremental)

- Read Gmail history since the stored cursor: added messages and label changes.
- A rate limit leaves the cursor where it was. Any other failure (for example an expired cursor)
  resets the cursor to "now"; changes in the gap are lost except for what the reconcile step
  recovers.

Recording one message

- De-duplicated by Gmail message id across all threads.
- A message carrying the app's own site-visit invite header is skipped.
- It is appended to the thread with the same Gmail thread id in the same account, else a new
  thread is created. New thread ids are allocated insert-if-absent and retried on collision.
- Direction is outbound when the message has Gmail's SENT label.
- The body is the message's text content, falling back to Gmail's snippet. Attachments are
  recorded by reference only (at most 20 per message).
- New inbound mail sets the thread unread and un-archives it. An outbound message never
  un-archives.
- Status is derived from the newest message: inbound → `waiting_us`, outbound → `waiting_them`.
  A draft is never changed by an import. A closed thread stays closed until a new inbound
  message arrives.
- After the write, sender matching (6.1) and Inbox organization (7) run on the thread.

After every sync, in order, each in its own error boundary: reconcile inbox membership, re-derive
statuses, back-fill sender matches, refresh the label cache, reconcile app-owned labels.

Inbox reconcile

- One ids-only listing of `in:inbox` (500 per page, at most 20 pages).
- A bridged thread absent from the listing gets `gmailInboxed = false` and leaves the app inbox
  (it stays under Archived). A thread present gets `true`.
- Nothing is hidden on a truncated listing.
- A thread with only outbound messages is never demoted for being absent.
- A thread that moves from not-inboxed to inboxed in Gmail also has the app's `archived` flag
  cleared, and noise the pipeline had moved counts as rescued.

### 4.5 Sending

- Outbound mail is sent from the thread owner's own Gmail account. If the owner cannot be
  resolved to exactly one user, nothing is sent.
- The app writes the message first (optimistic), then sends. Gmail's ids are stamped back on the
  message.
- Recipients: the thread's contact, plus the message's own Cc when it has one, else the thread's
  Cc. A forward is its own new thread addressed only to the typed To and Cc.
- Replies carry the stored RFC Message-ID so Gmail threads them.
- A send that times out is recorded as `timeout` ("Gmail may have accepted it"); any other
  failure as `error`.
- A message that did not leave through Gmail and is marked `noAutoRetry` MUST never be sent by a
  later send on the same thread. This prevents a later reply from silently delivering an old
  estimate email with its PDF.
- Attachments over the limit produce the message "Attachments too large for Gmail — 18 MB max."
  and the message is never retried.
- Large messages use Gmail's upload endpoint; the threshold is 4 MB of encoded text.

### 4.6 Two-way archive

Archiving or un-archiving a thread in the app removes or adds Gmail's INBOX label on the Gmail
thread. The local change is committed first; a failed push is logged and not retried. Mailboxes
without `gmail.modify` stay one-way.

### 4.7 App-owned Gmail labels ("Peak/…")

The app owns the label namespace `Peak/`. It never reads or writes labels outside it, except the
person's own labels in 4.8.

| Label | Written by the app when | A person applying it in Gmail means |
| --- | --- | --- |
| `Peak/Status/Needs reply` | status is `waiting_us` | Set status `waiting_us` |
| `Peak/Status/Waiting` | status is `waiting_them` | Set status `waiting_them` |
| `Peak/Status/Done` | status is `closed` | Set status `closed` |
| `Peak/Customers/<company name>` | the thread has a company | Link the thread to that company (a deliberate link) |
| `Peak/Assign/<first name>` | the thread is assigned | Assign to that teammate |
| `Peak/Projects/<id>`, `Peak/Leads/<id>`, `Peak/Quotes/<id>` | the thread has that work link | Set the work link |
| `Peak/New lead` | never | Create a new lead from the thread |

- Label names are capped at 225 characters.
- A label event arriving within 2 minutes of the app's own write for that thread is treated as
  an echo and ignored.
- `Peak/Customers/<placeholder>` (a stand-in company such as "UNKNOWN" or "TBD") is never
  created, and applying one links nothing.

### 4.8 The person's own Gmail labels

The thread reader has a Labels card: it lists the person's own Gmail labels on the thread, lets
them add or remove one, and create a new label.

- The label list is cached for 5 minutes.
- Starred and Important are the only system labels that can be set.
- Reserved names (inbox, sent, draft, drafts, trash, spam, starred, important, unread, chat, all
  mail, scheduled, snoozed) and anything under `Peak/` cannot be created.
- For 2 minutes after the card changes a label, Gmail's own events for that label are ignored;
  the card's state wins.
- Errors are typed: not found, Gmail not connected, missing scope, label missing, thread missing,
  bad name, quota, failed.

### 4.9 Fetching attachment bytes

An imported attachment's bytes are fetched from Gmail when someone opens it, through
`/api/inbox/attachments/<thread>/<message>/<index>`. Visibility (section 3.2) is checked before
anything else and a missing thread answers the same as an invisible one. A stored quote PDF is
served only on a thread linked to that quote; an assessment report only on a thread for that
assessment's company or an unlinked one.

**Source:** `src/lib/gmail/config.ts`, `src/lib/gmail/oauth.ts`, `src/lib/gmail/connections.ts`,
`src/lib/gmail/crypto.ts`, `src/lib/gmail/bridge.ts`, `src/lib/gmail/api.ts`,
`src/lib/gmail/mime.ts`, `src/lib/gmail/peak-labels.ts`, `src/lib/gmail/label-sync.ts`,
`src/lib/gmail/label-interpret.ts`, `src/lib/gmail/user-labels.ts`,
`src/lib/gmail/user-label-rules.ts`, `src/app/api/gmail/connect/route.ts`,
`src/app/api/gmail/callback/route.ts`, `src/app/api/gmail/sync/route.ts`, `src/instrumentation.ts`,
`src/lib/thread-pdf-read.ts`, `src/lib/vendor-quotes/thread-attachment-server.ts`, `vercel.json`,
`src/db/schema.ts`.

---

## 5. The Inbox email client

Route: `/inbox`. The page allows server work up to 300 seconds because sync and AI actions run
inside it.

### 5.1 Layout

Three panes: a sidebar (folders, views, labels), the thread list, and the reader with a link
sidebar. The list width is adjustable between 300 and 620 pixels (default 392) and remembered in
the browser, as is the collapsed state of the link sidebar.

### 5.2 Folders and views

There is one mailbox: the signed-in person's own.

| Folder / view | Contains |
| --- | --- |
| Inbox | Not a draft, not archived, not Gmail-archived (`gmailInboxed` is not `false`), not deleted |
| Sent | Not a draft, has at least one outbound message |
| Drafts | Status `draft` |
| Outbox | Has a queued message |
| Archived | Archived in the app OR archived in Gmail |
| Deleted | `deleted` is set. Every other folder hides deleted threads |
| Needs reply (view) | Own threads with status `waiting_us`, not archived, not deleted, not Gmail-archived |
| Calls & meetings (view) | Own threads whose channel is not email, not drafts |
| Flagged (view) | Own flagged threads |
| Organize (view, `?view=organize`) | Section 7.8 |
| Meetings (view, `?view=meetings`) | Section 8.3 |

List options

- Filter chips: unread, flagged, has attachments, sent to me, needs reply.
- Sort: date (default, newest first), from, subject. Pinned threads always float to the top.
- Optional per-user "CRM mode": in the Inbox folder, threads waiting on us come first, longest
  wait first. The Needs reply view always uses this order.
- Text search matches company, subject, contact name, contact email and the latest snippet.
- Filter by a Gmail label.
- The row's name is the last person who responded other than the viewer, with a short chain
  ("Brenda, me (3)") under it.

### 5.3 Thread actions

Mark read / unread, archive / unarchive, flag, pin, set category, delete (to Deleted), restore,
set status, reopen, assign to a teammate. Archive, delete, restore, mark read / unread, flag and
set category also exist as bulk actions on a selection. Bulk actions apply only to ids the caller
owns (at most 1,000 per call).

Status

| Status | Meaning |
| --- | --- |
| `waiting_us` | "Needs reply" |
| `waiting_them` | "Waiting" |
| `replied` | Manually marked replied |
| `closed` | Closed |
| `draft` | Unsent |

Marking a thread replied or closed also archives it (section 7.5) unless Inbox organization is
switched off.

### 5.4 Reader

Shows the messages, attachments, per-message record links, the court chip and filing line
(section 7), promise-task line, linked tasks, and for pilot users the AI buttons (section 10).
Opening an own thread marks it read. A non-owner sees no write controls and opening does not
change read state.

### 5.5 Composer

- New email: To, Cc, subject, body, optional company and work link. Sending creates a thread in
  the person's mailbox, status `waiting_them`.
- Reply and Reply all are composed inline in the reader. Reply all's Cc is the replied-to
  message's other To and Cc recipients, minus the mailbox's own addresses and the primary
  contact.
- Forward creates a new thread with subject "Fwd: …", the typed recipients only, and the quoted
  original. It may carry the original's attachments by reference. A forward of a privately held
  thread MUST stay private: it copies the company and work link only when the source link was
  deliberate.
- Save draft keeps the composer's content as a thread in Drafts. Discard removes it.
- Signature: one plain-text signature per person, at most 2,000 characters, edited on the
  Account page. The composer seeds it below a line containing `-- ` and a toggle strips or
  re-inserts it by that separator.
- Attachments: files from the computer are uploaded straight to private file storage and then
  checked on the server (path, real size, leading bytes); or a Documents record of the linked
  company or project can be picked. Limits: 18 MB total and 20 files per message. A refused
  upload is deleted.
- Offline: an outbound message written while offline is queued in the Outbox and sent on
  reconnect.

### 5.6 Log a call or meeting

A form records a call or meeting as a message with that channel on a new or existing thread, with
company, contact, subject and notes. A note can also be added to an existing thread.

### 5.7 Tasks from an email

"Create task" on a thread opens a dialog: title (at most 200 characters), notes (at most 4,000),
assignee, due date, and a checklist of links the thread already carries (contact, company, venue,
lead, thread). The browser sends only which candidate links stay ticked; the server re-derives
the candidates from the thread, so a task can never link something the thread does not carry.
Assigning the task to someone else shares the thread with them (3.4). Linked tasks are listed on
the thread and can be completed there.

### 5.8 Other actions from a thread

| Action | Effect |
| --- | --- |
| + New quote | Opens the new-quote intake pre-filled from the thread and links the new quote back to the thread |
| Schedule site visit | Creates a site visit from the thread |
| Add as vendor quote… | For a PDF attachment: opens the Estimator's vendor-quote form with that PDF. The PDF is copied on the server (limit 25 MB) |
| File to estimate / project… | Sets the thread's work link to a chosen estimate or project |
| New lead | Applying the Gmail label `Peak/New lead` creates a lead from the thread, once per thread. An in-app button for this was not traced |

### 5.9 Deep links into the Inbox

`?thread=<id>` opens a thread; `?draft=<id>` opens a draft in the composer; `?compose=1` opens an
empty composer; `?new=<company id>` and `?customer=<company id>` start a new email to a company
(`&log=1` opens the log form instead); `?nudge=<quote id>` opens the composer pre-filled from a
stored AI nudge (10.4); `?compose=ask` reads a draft from browser session storage (10.6);
`?box=`, `?view=organize`, `?view=meetings`.

**Source:** `src/app/(app)/inbox/page.tsx`, `src/app/(app)/inbox/actions.ts`,
`src/app/(app)/inbox/inbox-shell.tsx`, `src/app/(app)/inbox/task-actions.ts`,
`src/app/(app)/inbox/attach-actions.ts`, `src/app/(app)/inbox/vendor-file-actions.ts`,
`src/app/(app)/inbox/site-visit-actions.ts`, `src/lib/stores/comms.ts`, `src/lib/inbox-layout.ts`,
`src/lib/inbox-rows.ts`, `src/lib/inbox-signature.ts`, `src/lib/stores/signatures.ts`,
`src/lib/mail-attachments.ts`, `src/lib/mail-attachments-server.ts`, `src/lib/inbox-forward.ts`,
`src/lib/reply-all.ts`, `src/lib/inbox-task.ts`, `src/lib/inbox-links.ts`,
`src/lib/inbox-compose-prefill.ts`, `src/lib/vendor-quotes/threads-server.ts`.

---

## 6. Linking email to CRM records

### 6.1 Automatic sender matching

Run when a message is imported, when a thread is created in the app, and when contacts or
companies change ("resweep").

1. Look up the sender's address among known contact emails.
   - One live contact with a real company → `linked` to that company, with that contact.
   - Contacts spanning more than one real company → `ambiguous`, with the candidate companies.
   - A contact whose only company is a placeholder ("UNKNOWN", "TBD", "N/A") → keep the contact,
     no company.
2. Otherwise take the sender's domain. Skip public webmail and ISP domains (a fixed list of 23,
   including gmail.com, outlook.com, yahoo.com, icloud.com).
   - Exactly one company has claimed the domain → `suggested` (not linked) with that company,
     unless the suggestion was dismissed for this thread.
   - More than one → `ambiguous`.
3. Otherwise `unknown`.

Rules

- Matching MUST never downgrade or replace an existing company on a thread.
- A resweep MUST decline when a manual link landed between its read and its write.
- A resweep that changes the company clears the venue and clears `linkedBy`.
- A resweep triggered by a person touches only that person's own mailbox. Only the system
  back-fill after an import runs over every mailbox, and what it links stays private.

### 6.2 The link sidebar

In the reader's sidebar the owner can:

- link the thread to a company (sets `linkedBy: user`), accept or dismiss a suggestion ("Not
  them"), or pick among ambiguous candidates;
- claim the sender's domain for a company, or release it;
- pick the venue (only venues of the linked company);
- link several people from the message's From, To and Cc; one is primary; at most 25;
- choose "Linking from": which message's address drives matching (its From for inbound, its
  first recipient for outbound);
- quick-add a new company, contact or venue from the sender;
- search companies, venues and people in one box: three groups, at most 8 results each, minimum
  2 characters.

### 6.3 Signature reader

When the link panel opens, the server reads the sender's signature out of the chosen message
using fixed text rules (no AI): cut the quoted history, find the sign-off, then pick name, title,
company, phones, email and website from the lines that follow. The result pre-fills a new
contact, or offers to fill blank fields on a known contact. It never overwrites a filled field.

### 6.4 Where linked threads appear

A linked thread appears on the company record ("Emails" list), in the company activity feed, on a
lead's drawer, in global search (⌘K), and in the Estimator's Vendors card when it is filed to
that estimate. Every one of these lists MUST apply section 3.2 and show at most subject, last
author, last time and unread state for a thread the viewer does not own.

**Source:** `src/lib/gmail/resolve.ts`, `src/lib/gmail/linking.ts`, `src/lib/gmail/domains.ts`,
`src/lib/gmail/config.ts`, `src/app/(app)/inbox/link-actions.ts`,
`src/app/(app)/inbox/link-popup-actions.ts`, `src/lib/inbox-identity.ts`,
`src/lib/inbox-thread-contacts.ts`, `src/lib/inbox-link-targets.ts`,
`src/lib/inbox-signature-parse.ts`, `src/lib/inbox-participants.ts`, `src/lib/customer-feed.ts`,
`src/lib/vendor-quotes/threads-server.ts`, `src/lib/inbox-org/placeholder.ts`.

---

## 7. Inbox organization

A rule pipeline runs on a thread after each imported message, after the owner's reply, and during
a 90-day cleanup. It writes three fields on the thread: `filing`, `court` and `noise`. It skips
drafts, deleted threads, retired shared-mailbox threads and threads with no email messages.

`INBOX_ORG_DISABLED=true` switches off the import hook, archive-on-reply, the archive on Mark
replied / Close, and the AI pass. Hand actions in the Organize view still work.

### 7.1 Internal or external

An address is internal when it belongs to a staff member (their sign-in email, their Google
email, or any connected mailbox address) or is on an own domain. Own domains are Peak's own
domain always, plus either the administrator's override list or, when no override is set, every
non-freemail domain found on team addresses. Freemail domains (a fixed list of 21) are never own
domains. A subdomain of an own domain is internal.

### 7.2 Filing

The first matching step produces a filing suggestion.

| Order | Step | Result |
| --- | --- | --- |
| 1 | Sender rule (7.6) | File under the rule's company and optional record, or mark noise, or "never noise" |
| 2 | Identity | The automatic sender match (6.1), strong when matched by a known contact |
| 3 | Record number | A number written in the subject, then the body |
| 4 | Noise rules (7.4) | Noise |
| 5 | AI (pilot users only, 10.7) | A pick from a server-built candidate list |

- A strong identity match still takes a record number that names one of the same company's
  records (more specific).
- A weak domain guess counts only after numbers and noise found nothing.
- A forward is filed on the forwarded (external) sender and content.
- An internal-only thread is filed by a number only; otherwise it is left `skipped`.
- `filed` and `dismissed` filings are never overwritten. `skipped` and an AI filing stay until
  new mail arrives. A sender rule still wins over an AI filing.
- A placeholder company is never a filing target.

Record numbers recognised

- Estimate numbers: a prefix (`EST`, `FLM`, `RIG`, `REP`, `RNT`, `CON`, `OPP`), a hyphen or dash,
  4 to 9 digits, and an optional `-N` suffix of 1 to 3 digits. The prefix must be upper case as
  printed, except `EST` which is accepted in any case. A `-1` suffix reads as the bare number.
- Internal ids: `P-` or `S-` + 4 to 9 digits (projects and orders), `L-` + 4 to 9 digits (leads),
  upper case only.
- A match is rejected when it is preceded by a word character, hyphen, `/`, `.`, `=`, `?` or `@`,
  or followed by a word character, `-<digit>` or `@`. So `TEST-1042`, `/REP-1234.pdf` and
  `EST-1042-2026` do not match.
- A number that names no live record is ignored.

Filing fields: target company, optional work record, optional venue, noise flag, source (`rule`,
`identity`, `number`, `noise-rule`, `ai`), a reason sentence, strength (`strong` or `weak`),
needs-reply flag, state (`suggested`, `filed`, `skipped`, `dismissed`), and when filed, how
(`approved`, `reply`, `rule`, `teammate-reply`) and exactly what it changed, so Undo can put back
only that.

### 7.3 Court (whose turn it is)

Court owner is one of: `me` (the mailbox owner), `teammate`, `customer`, `nobody`. The last
counted message, by time, decides.

| Last message | Court |
| --- | --- |
| A teammate's forward to me, FYI-only | nobody |
| A teammate's forward to me, otherwise | me |
| From a customer (any non-internal sender), a pure sign-off | nobody |
| From a customer, otherwise | me |
| From me | customer |
| From a teammate, with no outside address in To or Cc (an internal note), sign-off or FYI | nobody |
| From a teammate, internal note, otherwise | me |
| From a teammate to the customer, whose own text names me ("Jeff will call you") | me |
| From a teammate to the customer, otherwise | customer, with that teammate recorded |
| Internal-only thread, a teammate wrote last | me (sign-off → nobody) |
| Internal-only thread, I wrote last | that teammate (my sign-off → nobody) |

- My own forwards out do not move the court.
- A customer's forward is never read as a sign-off.

Sign-off rule: take the author's own text (quoted reply, forwarded block, signature after a `-- `
line, and mobile footers removed). It is a sign-off only when it contains no question mark, is at
most 8 words after dropping a trailing signature block, contains a sign-off phrase ("thanks",
"thank you", "got it", "sounds good", "will do", "perfect", and similar), and everything else is
filler words or at most two capitalised name words. An action word (send, call, approve, cancel,
invoice, and similar) disqualifies it.

Naming rule: a person's names are their first name and full name from the team list. Matching is
case-insensitive and word-bounded, except that a first name that is also an everyday word (a
fixed list including Will, Mark, Bill, Grant, Chase, May, June, Rob) matches only when
capitalised.

Status follows the court: me → `waiting_us`; customer or teammate → `waiting_them`; nobody →
`closed`. This write is "quiet": it does not change the thread's last-updated time. A status a
person set by hand to replied or closed is respected until new mail arrives.

An archived thread whose court becomes `me` through new mail is un-archived.

The owner can override the court by hand. An override, or an AI court, sticks until the thread's
newest message changes.

### 7.4 Noise

A thread is noise when the newest message matches any of these, in order:

1. Gmail categorised it as Promotions, Social or Forums.
2. It has a bulk or mailing-list header.
3. The sender's local part matches no-reply, do-not-reply, notification(s), mailer-daemon or
   bounce.
4. It has an auto-submitted header.
5. The subject says out of office, automatic reply or auto-reply.

Noise is never applied when the sender is a known customer contact, when the thread is
internal-only, when the owner wrote in the thread, or when the thread was rescued ("Not noise").

- For everyone: the thread is tagged "Looks like noise" and stays in the inbox.
- For Assist pilot users with Inbox organization switched on: the thread is moved out of the
  inbox (archived in the app and in Gmail) and listed on the Organize view's Noise tab.

### 7.5 Archive-on-reply

After the owner's reply leaves, after a teammate's reply that left the court with the customer or
nobody, and after a manual Mark replied or Close:

1. If the thread is linked, or has a strong suggestion, it is filed first (recorded as filed by
   `reply` or `teammate-reply`).
2. The thread is archived in the app and in Gmail.
3. If it had only a weak suggestion or none, it is archived anyway and stays on the To file list,
   marked as archived-on-reply.

Rules

- This applies to everyone, not only pilot users.
- A person can opt out on the Account page ("Keep threads in my inbox").
- An outbound message or a logged call never un-archives a thread. New inbound mail does.
- A teammate's reply never brings back a thread the owner had already archived.
- A teammate's reply archives quietly, so the thread does not jump to the top of lists.
- The step is best-effort and MUST never fail a send.
- Moving a thread back to the inbox in Gmail brings it back in the app.

### 7.6 Sender rules

A saved rule matches a sender by exact email or exact domain (no subdomains) and does one of:
file under a company (and optional record), mark noise, or never mark noise.

- Scope is `user` (applies only to that user's mailbox) or `company` (everyone).
- Precedence: personal beats company-wide; within a scope an exact address beats a domain; the
  newest rule breaks a tie.
- At most 2,000 rules are stored.
- After approving or changing a filing, the Organize view offers "always file mail from this
  sender under X". Accepting saves the rule and sweeps that sender's other threads in the
  person's own mailbox: threads that are unlinked or linked to the same company are filed;
  everything else gets a suggestion. The sweep handles at most 200 threads in at most 20 seconds.
- A rule never replaces a hand-picked link on the same company.
- Personal rules are listed and deleted on the Account page; company rules in Settings.

### 7.7 Promise tasks (pilot users only)

When the AI court reading (10.7) finds a promise in the newest message ("I'll send the drawings
Friday"), a task is created automatically for the person who made it.

- At most 3 promises per message.
- Only for mail less than 7 days old, never for the 90-day import or the cleanup.
- Only for messages written by the owner or a teammate.
- The task goes only to a team member the newest message actually names (7.3 naming rule) or to
  its author.
- The task id is deterministic (`T-prm-` + hash), so a repeat run never creates a duplicate.
- A marker naming the message is written before the tasks are created. A process that dies
  between the two drops the tasks rather than duplicating them.
- The reader shows the task with an Undo.

Due date, from the promise's due phrase, always 5:00 pm America/Chicago, anchored on the Chicago
day the message was sent. First match wins:

1. An explicit date. Without a year it is this year; one that passed within the last 180 days
   falls back to the default; an older one rolls to next year.
2. "end of next week" → the following week's Friday.
3. "end of week", "EOW" → the Friday on or after the anchor (Saturday or Sunday → next Friday).
4. "end of month", "EOM" → the month's last day.
5. A weekday with "next week" → that day of the following week.
6. A weekday name → its next occurrence after the anchor.
7. "next week" → the following Monday.
8. "tomorrow" → the next day.
9. "today", "tonight", "EOD", "COB" → that day.
10. Anything else → 2 business days (Monday to Friday) after the anchor.

### 7.8 The Organize view

`/inbox?view=organize`, with three tabs.

| Tab | Rows | Actions |
| --- | --- | --- |
| To file | Own threads with a suggestion not yet filed, including archived-on-reply ones | Approve, Change…, Noise, Skip, Archive; "Approve all strong" |
| Noise | Threads moved as noise | Not noise, Archive |
| Filed | Recently filed threads | Undo |

- Approve applies the suggestion: links the company (as `linkedBy: filing`), sets the work link
  and venue, and archives unless the owner still owes a reply.
- Undo restores exactly the fields the filing changed, each only if it still holds the value the
  filing wrote.
- Approve all strong handles at most 500 threads in at most 20 seconds. Bulk Archive handles at
  most 500.
- "Organize my inbox" (pilot users with Inbox organization on) runs a resumable cleanup over the
  person's own inbox threads active in the last 90 days that are not filed: at most 5,000
  threads, in batches of at most 40 seconds, of which up to 15 seconds may go to AI filing. It
  only suggests. A run abandoned for more than a day can be restarted.
- Every action is logged against the suggestion's source so the administrator's report can
  compare sources (rule, identity, number, AI).
- Changes are broadcast to the person's other open windows.

**Source:** `src/lib/inbox-org/pipeline.ts`, `src/lib/inbox-org/types.ts`,
`src/lib/inbox-org/court.ts`, `src/lib/inbox-org/noise.ts`, `src/lib/inbox-org/numbers.ts`,
`src/lib/inbox-org/forward.ts`, `src/lib/inbox-org/internal.ts`, `src/lib/inbox-org/signoff.ts`,
`src/lib/inbox-org/names.ts`, `src/lib/inbox-org/due.ts`, `src/lib/inbox-org/sender-rules.ts`,
`src/lib/inbox-org/apply.ts`, `src/lib/inbox-org/cleanup.ts`, `src/lib/inbox-org/kill-switch.ts`,
`src/lib/inbox-org/ids.ts`, `src/lib/inbox-org/placeholder.ts`, `src/lib/stores/inbox-org.ts`,
`src/lib/estimate-number.ts`,
`src/app/(app)/inbox/organize-actions.ts`, `src/app/(app)/inbox/organize/`, `DECISIONS.md`
(D882–D900).

---

## 8. Krisp: recordings and the meeting matcher

Krisp is a third-party meeting recorder and transcriber. Each staff member pastes their own Krisp
API key on the Account page. The key is stored encrypted, one row per user, with the Krisp user
id, email and name read from Krisp at connect time. The key never reaches the browser.

Krisp API facts used by the code: base `https://meeting-api.krisp.ai/v1`; each request times out
at 20 seconds; calls are paced at one every 220 ms (Krisp's limit is 5 per second sustained);
errors are mapped to typed cases: 401 (reconnect), 403 (storage full or read-only key), 409
(still processing), 429 (rate limit), and "an import is still in process".

### 8.1 Recordings

A staff member records audio inside the app against a record. The app uploads the audio, relays
it to the recorder's own Krisp account, polls for the transcript, and later archives the audio to
Google Drive.

- A recording always belongs to a parent: a site visit, venue assessment, inspection, flame-test
  job, repair job, project or consulting engagement. Company, venue and a title are copied from
  the parent at creation.
- Two independent lifecycles:
  - audio: `on_device` → `uploaded` → `archived`
  - Krisp: `pending` → `importing` → `processing` → `ready` or `failed`
- Recording works offline. The file is queued on the device and uploaded with back-off from 5
  seconds up to 15 minutes. The upload goes straight to private file storage through a broker
  route that is exempt from the staff sign-in gate and authenticates the upload itself.
- Only one Krisp import may be in flight per Krisp account. The app holds a lock per user that
  expires after 5 minutes.
- Krisp's notes are stored raw. Summary sections, key points and action items are derived from
  them and re-derived on every refresh. Action items keep their accepted or dismissed state by a
  stable key.
- An action item can be accepted (becomes a task for a matched teammate) or dismissed.
- Summary sections can be inserted into the parent record's fields ("From recording" panel on
  venue assessments and inspections); inserted keys are remembered.
- Polling: recordings still processing are re-checked, at most 5 per user per pass, no more
  often than every 2 minutes, from the daily job and when Home is loaded.
- A recording still processing after 24 hours is shown as stalled.
- Archive: once the Krisp side has been settled (ready or failed) for 6 hours, the audio is moved
  to the archive Google account's Drive under `Peak Recordings/<Company>/` (or `Unfiled`), at
  most 5 per run. The staged file is deleted only after Drive returns an id. The archive account
  is chosen in Settings and needs the `drive.file` scope.

Screens: `/recordings/new?parent=<kind>:<id>` (full-screen recorder), `/recordings/<id>`
(summary, key points, action items, transcript; `?tab=transcript&seg=N` deep-links a transcript
segment), a Record button and a recordings strip on each parent record, and a Recordings card on
the company record.

### 8.2 Meeting sync

Every Krisp meeting of every connected staff member is listed in the app, including internal
ones.

- First sync walks back 90 days in resumable steps. After that, each sync covers a rolling 14-day
  window.
- A sync spends at most 40 seconds.
- A meeting's detail (transcript, notes) is re-fetched until it is complete, for up to 48 hours.
- Triggers: "Sync now" and "Load older" buttons, the daily job (at most 20 seconds, skipped when
  fewer than 5 seconds remain), and loading Home when the last sync is older than 10 minutes.
- Only one sync per staff member runs at a time in a process.
- A meeting shorter than 180 seconds is marked noise.
- Sync writes MUST never overwrite what a person did meanwhile (filing, links, speaker names,
  attendee edits, to-do decisions, sharing).
- A meeting created from an in-app recording is linked to that recording.

### 8.3 Matcher

For each meeting the matcher scores every company and suggests links. It only suggests; nothing
is linked without a tap.

Score per company (points add up)

| Evidence | Points |
| --- | --- |
| The meeting title contains the company's name core or a keyword | 50 |
| …and the hit was on one of the company's venue names | +10 |
| The matching calendar event's title contains it | 30 |
| An external attendee's email is a known contact of the company | 60 |
| else an external attendee's email domain is claimed by the company | 40 |
| The meeting overlaps one of the owner's site visits or assessments for the company | 40 |
| The Krisp notes name the company | 20 |
| A speaker's first name matches one of the company's contacts | 10 |

- "Name core" is the company name with generic words removed. Venue cores also drop venue-type
  words, are never equal to the company's own core, and are ignored when venues of more than 3
  companies share them.
- The top company is suggested when it scores at least 40.
- It is **strong** when it scores at least 80 and leads the runner-up by at least 30. Otherwise
  it is **weak**, and up to 2 more companies within 30 points and at least 40 are also offered
  (at most 3 in total).
- With the top company the matcher also suggests: its venue when a venue name or a single
  overlapping visit identified one; each external attendee who is a known contact of that
  company (or of no company); and one work record.
- Work record: the overlapping visit if exactly one; otherwise the company's only open lead, else
  its only open engagement, else its only open project. If the most specific level has more than
  one, nothing is guessed.
- If no company reaches 40, the matcher suggests internal teammates instead: strong when matched
  by attendee email, weak when matched by speaker name.

### 8.4 Filing a meeting

A meeting can be linked to one company, one venue, up to 25 people, one work record (lead, site
visit, venue assessment, project, engagement or quote) and any number of teammates.

- "Confirm" applies the strong suggestions for one meeting. "Confirm all" does so for up to 200
  meetings.
- Attendees are the union of Krisp's participants, the calendar event's attendees and any added
  by hand. Each can be removed, matched to a contact, or turned into a new contact.
- "Speaker N" labels can be mapped to people; the transcript is relabelled in one pass.
- A meeting can be marked noise or not noise by hand, and refreshed from Krisp.

### 8.5 Meeting to-dos

Each Krisp action item becomes a to-do awaiting a decision.

| Decision | Result |
| --- | --- |
| Task | A task for a teammate, deterministic id `T-mtg-…`. A Krisp due date becomes 5:00 pm Chicago that day |
| Waiting on customer | A task marked as waiting on the customer, default due 7 days out |
| Note | A note (`N-mtg-…`) on the venue, else the lead, project or engagement, else the company |
| Dismiss | Nothing |

Suggested decision: no assignee → note; assignee exactly matches a teammate → task; exactly
matches a contact → waiting; a first name matching both a teammate and a contact → note (the
person decides); a first name matching only one → that one. A decided to-do is never lost when
Krisp later drops or rewords it.

### 8.6 Meeting visibility

| Scope | When | Who can see |
| --- | --- | --- |
| Private | No links | Only the staff members whose Krisp account saw it |
| Internal | Linked only to teammates | Those teammates and the staff who saw it |
| Peak | Linked to a company, venue, person or work record | All staff |
| Customer | Staff pressed "Share with customer" | That company's portal users |

- Sharing with the customer MUST be an explicit act. Only the title, date and an edited summary
  (at most 8,000 characters) are shared. The transcript, attendees, to-dos and links are never
  shared.
- A meeting is shared only with the company it is linked to.

### 8.7 Screens

- Meetings box: `/inbox?view=meetings`, tabs To file, Filed (most recent 200) and Noise, with
  Sync now and Load older.
- Meeting reader: summary, key points, transcript, to-dos, and a sidebar for links, attendees and
  speakers.
- A Meetings card on company, venue, person, lead, project, engagement and venue-assessment
  pages; a "Waiting on customer" card on company and venue pages; meeting rows in the company
  activity feed and in global search; a "Meeting notes" page in the customer portal.
- A Krisp card on the Account page (connect, disconnect, last sync, Sync now, Load older).

**Source:** `src/lib/krisp/client.ts`, `src/lib/krisp/errors.ts`, `src/lib/krisp/connections.ts`,
`src/lib/krisp/import.ts`, `src/lib/krisp/reconcile.ts`, `src/lib/krisp/archive.ts`,
`src/lib/krisp/derive.ts`, `src/lib/krisp/write-back.ts`, `src/lib/stores/recordings.ts`,
`src/lib/recorder/`, `src/app/(app)/recordings/`, `src/app/api/recordings/upload/route.ts`,
`src/components/recordings/`, `src/lib/meetings/types.ts`, `src/lib/meetings/match.ts`,
`src/lib/meetings/names.ts`, `src/lib/meetings/sync.ts`, `src/lib/meetings/sync-state.ts`,
`src/lib/meetings/todos.ts`, `src/lib/meetings/visibility.ts`, `src/lib/meetings/actions-core.ts`,
`src/lib/meetings/portal.ts`, `src/lib/stores/meetings.ts`, `src/app/(app)/inbox/meetings/`,
`src/components/meetings/`, `src/db/schema.ts`, `DECISIONS.md` (D725–D761).

---

## 9. The Assist layer

Assist is the single path for every model call. Nothing calls a model except through it.

### 9.1 Gate

A call is allowed only when all of these hold, checked in this order:

1. `ASSIST_DISABLED` is not `true`.
2. A provider is configured: an Anthropic API key, or a local server (`ASSIST_PROVIDER=local` and
   `ASSIST_LOCAL_URL`).
3. The user is on the pilot allow-list. **An empty list means nobody.**
4. The feature's switch is on.

When the gate refuses, no AI control is shown and no call is made.

Features and default switch state

| Feature key | What | Default |
| --- | --- | --- |
| `tasks` | Suggest tasks | On |
| `reply` | Draft reply | On |
| `estimate` | Suggest estimate | On |
| `file` | AI filing, noise moved out of the inbox, Organize my inbox | Off |
| `promise` | AI court reading and promise tasks | Off |
| `brief` | Daily brief, pre-made drafts, quote nudges | Off |
| `ask` | Ask AI | Off |
| `vendorpdf` | Read the PDF | Off |

### 9.2 API key

- The key may come from the environment or be pasted by an administrator in Settings.
- A pasted key MUST be stored encrypted in its own record, never inside the general settings
  object that pages hand to the browser. The Settings card may know only the last four
  characters, when it was saved and by whom.
- A pasted key wins over the environment key. An unreadable stored key falls back to the
  environment key.
- A preview deployment ignores the stored key unless `ASSIST_ALLOW_PREVIEW_KEY=true` (previews
  share the production database).
- A pasted key must match `sk-ant-` followed by 20 to 300 characters from letters, digits, `_`
  and `-`.
- "Test key" makes one call with a 15-second timeout.

### 9.3 Spend cap and rate limits

- Monthly cap, default $200, settable from $0 to $10,000. Before every call the month's logged
  spend (month boundaries in America/Chicago) is compared to the cap; at or over it the call is
  refused with "Assist paused for the month (spend cap reached)."
- Per user per hour, per feature:

| Feature | Calls per hour |
| --- | --- |
| tasks | 60 |
| reply | 60 |
| estimate | 20 (counted once per suggestion) |
| file | 600 |
| promise | 600 |
| brief | 60 (Rebuild has its own limit of 3 per hour) |
| ask | 60 (plus 15 per hour for "Try harder", plus $5 per user per Chicago day) |
| vendorpdf | 30 |

- Background work (pre-made drafts) does not count against the hourly limits. It is bounded by
  the monthly cap and stops when the month's spend reaches 60% of the cap.

### 9.4 Models and request budgets

Model ids are configurable per slot by environment variable. Defaults:

| Slot | Default model | Effort | Max output tokens | Timeout | Retries | Streamed |
| --- | --- | --- | --- | --- | --- | --- |
| tasks | `claude-haiku-5-5` | low | 4,000 | 60 s | 1 | no |
| reply | `claude-sonnet-5-5` | low | 4,000 | 60 s | 1 | no |
| extract (estimate step 1) | `claude-haiku-5-5` | low | 4,000 | 45 s | 0 | no |
| estimate (step 2) | `claude-opus-5-5` | medium | 32,000 | 210 s | 0 | yes |
| file | `claude-haiku-5-5` | low | 2,000 | 30 s | 0 | no |
| promise | `claude-haiku-5-5` | low | 2,000 | 30 s | 0 | no |
| brief | `claude-haiku-5-5` | low | 2,000 | 30 s | 0 | no |
| ask | `claude-haiku-5-5` | low | 4,000 | 60 s (whole question) | 0 | yes |
| ask, Try harder | `claude-sonnet-5-5` | medium | 4,000 | 90 s (whole question) | 0 | yes |
| vendorpdf | `claude-haiku-5-5` | low | 8,000 | 80 s | 0 | no |
| vendorpdf, Try harder | `claude-sonnet-5-5` | medium | 16,000 | 95 s | 0 | yes |

- A caller may shorten a slot's timeout or retries, never lengthen them.
- A local provider (any OpenAI-compatible server) may be the primary. If it is unreachable
  (network or timeout only) the call falls back once to `claude-haiku-5-5` when a key exists.
- Ask AI and Read the PDF are Claude-only. A PDF is never sent to the local provider.

### 9.5 Cost accounting

Each call's cost is computed from token counts and a price table (US dollars per million tokens):

| Model | Input | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 0.125 |
| `claude-sonnet-5-5` | 2 | 10 | 0.20 | 2.50 |
| `claude-opus-5-5` | 4 | 20 | 0.20 | 5 |
| `claude-opus-5` | 5 | 25 | 0.50 | 6.25 |
| `claude-fable-5-1` | 10 | 50 | 1 | 12.50 |

- A Haiku prompt over 100,000 input tokens is billed at 5 times the row.
- A run is billed at the answering model's row; if that model is not in the table, at the
  requested model's row; if neither is known, at the most expensive row. The cap MUST never be
  under-counted.
- A local model costs $0.
- A web search (Ask AI) costs $0.01.

### 9.6 Run log

Every call that passes the gate writes one record: feature, step, user, provider, answering
model, requested model, whether it fell back, token counts, cost, latency, a hash of the input,
the output (first 20,000 characters), success, error, stop reason, a context reference, the month
key, and later an outcome.

Outcome is `accepted`, `edited` or `discarded`, with detail. It is written once: the first write
wins, only the run's own user may write it, and the write is one atomic conditional update.

The log survives the "clear demo data" reset.

### 9.7 Prompt safety rules

- Text written by outside parties (email bodies, lead messages, meeting notes, record fields) is
  untrusted. It MUST be placed inside named wrapper tags and the model told it is data, never an
  instruction.
- Untrusted text MUST be folded first (zero-width characters removed, Unicode compatibility forms
  normalised) and then have any wrapper-closing or wrapper-opening tag defanged.
- Single-line fields are stripped of line breaks and capped at 120 characters.
- Structured answers are validated against a strict schema. An answer that does not parse is an
  error ("unreadable answer").
- The model is never shown cost or price data, with one stated exception: a sent quote's own
  total in the reply prompt and the nudge prompt.
- Ids returned by the model are accepted only when they were in the list the server gave it.

### 9.8 Administrator screen

Settings → Beta → Assist pilot (administrators only): status line, API key (paste, test, clear),
pilot allow-list, feature switches, monthly cap, own-domain override, company sender rules, and
reports: cost and outcomes by feature and model for recent months, a filing report by source, a
daily brief table, an Ask AI table, and a vendor PDF table by model and vendor.

**Source:** `src/lib/assist/config.ts`, `src/lib/assist/models.ts`, `src/lib/assist/run.ts`,
`src/lib/assist/types.ts`, `src/lib/assist/key-store.ts`, `src/lib/assist/anthropic.ts`,
`src/lib/assist/local.ts`, `src/lib/assist/provider.ts`, `src/lib/assist/call-budget.ts`,
`src/lib/rate-limit.ts`,
`src/lib/assist/features/thread-text.ts`, `src/lib/assist/features/ask-limits.ts`,
`src/lib/assist/report.ts`, `src/lib/assist/outcome.ts`, `src/lib/stores/assist-runs.ts`,
`src/app/(app)/settings/assist-data.ts`, `src/app/(app)/settings/groups/assist-pilot.tsx`,
`src/db/seed-data.ts`, `.env.example`, `DECISIONS.md` (D869–D881).

---

## 10. Assist features

### 10.1 Suggest tasks

A button on an own email thread. The model reads the subject and the latest 8 messages (2,000
characters each) and returns 0 to 5 tasks: title (200 characters), notes (1,000), due date,
assignee (must be a real team id), which of the thread's links to carry, priority tier (high,
normal, low) and size (small ≈ 30 minutes, medium ≈ 1 hour, large ≈ half a day). The person ticks
which to create. Ticked tasks are created through the ordinary create-task-from-email path
(5.7). Nothing is created by the model. Outcome: which were ticked.

### 10.2 Draft reply

A button on an own email thread with a tone choice (short, normal, formal). The model reads the
latest 10 messages (2,500 characters each), up to 5 examples of the person's own sent mail (1,200
characters each) for tone, their signature, and the open quotes of the thread's resolved company
only. Draft quotes are listed without a price; sent quotes with their total. The answer (at most
6,000 characters) fills the inline reply composer. It is never sent automatically. Outcome: how
much of the draft survived in what was sent (an edit ratio).

Only the thread's owner can run either button.

### 10.3 Estimate suggestion

"Suggest estimate" is available on an email thread, a lead, a venue assessment, and a Krisp
meeting that is linked. It never creates a quote.

Flow

1. Access is checked per source. An unlinked meeting is refused even for its owner. A lead's
   linked threads are read from the caller's own mailbox only.
2. The server builds untrusted source text. Caps: thread 10 messages × 2,500 characters; lead
   message 4,000; lead-linked thread 1,500; assessment findings 8,000, 60 inventory rows, 40
   fields per discipline; meeting transcript 12,000, summary 4,000, 20 key points, 25 attendees.
3. Step 1 (extract, Haiku): pull out what is being asked for, as phrases and system names.
4. Candidates: catalog parts found by those phrases (8 per query, 400 in total), up to 5 similar
   past systems from sent or won estimates, up to 5 of the same company's quotes, and the system
   categories. No cost or price is included.
5. Step 2 (draft, Opus): propose systems and lines using candidate part numbers only.
6. The answer is sanitised: at most 12 systems and 60 lines, quantities 1 to 9,999, names 120
   characters, descriptions and reasons 200, notes 2,000. A part number not in the candidate
   list becomes an unpriced custom line "Suggested: needs a part and price".

- The whole request has a 300-second budget; step 2 is not started with less than 220 seconds
  left.
- The suggestion is stored and the reply is a link that opens a new, unsaved estimate with only
  the header filled (company; venue, contact and lead only when the suggestion is about that
  company; name) and a "Suggested BOM" panel.
- From the panel the person adds a whole system or single lines. Each added line is priced at
  that moment by the same rule as a manual add from the catalog.
- "Added" state is derived from the estimate's contents.
- The first save links the suggestion to the quote. Only the first quote is kept.
- Outcome is computed for the report from that first quote: pending until saved, discarded if
  the quote is deleted, and a separate bucket for runs that saved nothing.
- Each entry point shows "Suggestion ready → Open" and "Suggest again" when the source already
  has one.

Endpoint: `POST /api/assist/suggest-estimate`. It requires a signed-in user and the `estimate`
gate, accepts only JSON (415 otherwise), and always answers 200 with a JSON result.

### 10.4 Daily brief, pre-made drafts and nudges

For pilot users with Daily brief on.

Brief

- Two slots per day, 6:45 and 13:45 America/Chicago. Before 6:45 the previous afternoon's brief
  is shown.
- Shown as a card at the top of Home in three blocks: Emails, Estimates, Tasks. It contains: a
  short summary (at most 900 characters), 3 to 5 "do these first" picks each with a reason (at
  most 160 characters), Organize counts, new promise tasks, today's plan, approvals waiting,
  quiet quotes, and in the afternoon a "since this morning" line.
- The summary is one Haiku call limited to the rows of the person's ranked to-do list. The picks
  MUST be keys of that list; fewer than 3 are padded from the top rows. If the call fails, is
  refused, or there is no time, a rule-built brief is shown instead.
- Stored once per user and slot; the first build wins. "Rebuild" replaces it: at most 3 per hour,
  90-second limit. A build triggered by opening Home has 20 seconds; one that ran out of time is
  not stored.
- Built by the two daily jobs (11:45 and 18:45 UTC) and lazily on first view.

Quiet quotes

- A quote is quiet when it is the person's (its owner, else whoever prepared it), its status is
  still sent, it was sent at least 5 business days ago, and no inbound message arrived since on a
  thread linked to the quote or on a thread of the same company whose subject names the estimate
  number as a whole token.
- At most 8, oldest first.

Pre-made drafts (background)

- For every thread on the person's court, assigned to them, in their own mailbox and not
  archived: a reply draft (Sonnet) and task suggestions (Haiku), stored on the thread. It is
  fresh while the thread's newest inbound message is the one it was drafted against.
- For every quiet quote: a follow-up note (at most 300 characters) and a nudge email (subject at
  most 120, body at most 2,000), stored on the quote. An answer naming any dollar amount other
  than the quote's own total is refused.
- Each thread and quote is worked under a lease taken by compare-and-set; results are written
  only if the record's basis is unchanged. A failed draft is retried after 6 hours. No call
  starts with less than 15 seconds of room. A queue for the same person runs at most once a
  minute.
- In the reader, "Use it" opens a fresh stored draft without a new model call. "Send nudge" opens
  the composer pre-filled; the recipient is resolved on the server; nothing is sent until the
  person presses Send.

Phone

- A large-text view, a "Listen" button that reads the brief aloud using the device's speech
  synthesis, and two repeating local notifications at 6:45 and 13:45 on the phone's own clock
  (fixed ids 64501 and 64502), on by default, switchable on the Account page.

### 10.5 Morning triage email feed

The ranked to-do list on Home ("Start here") includes emails on the person's court. An email
waiting at least one business day ranks higher and is labelled "customer waiting"; a younger one
"customer message". The list itself is specified with Project Management, not here.

### 10.6 Ask AI

A question-answering panel over Peak's own data, opened from the global search box (first result
row "Ask AI: <query>", or ⌘↵). For pilot users with Ask AI on and a Claude key.

Limits per question

| Limit | Value |
| --- | --- |
| Model rounds | 6, the last one without tools |
| Tool calls | 12 |
| Characters per tool result | 6,000 |
| Wall clock | 60 seconds (90 for Try harder) |
| A new round is not started with less than | 5 seconds left |
| Web searches per round (when the toggle is on) | 3 |
| Conversation sent with a question | at most 12 earlier turns, 8,000 characters each, 40,000 in total |
| Current screen text | 6,000 characters |

Read tools (11). Each uses the asker's own access rights; a forbidden record answers like a
missing one.

| Tool | Returns |
| --- | --- |
| `search` | The same results as global search, scoped to the asker |
| `get_company` | Company facts, venues, people, counts, latest quotes, projects, leads and notes |
| `get_venue` | Venue facts and its latest service records and quotes |
| `get_quote` | One quote: header, total and lines at sell price. Bonus lines are hidden |
| `list_quotes` | Quotes filtered by company, status, type and recency (headers only) |
| `get_lead` | A lead and the subjects of threads linked to it |
| `get_project` | Stage, dates, crew, procurement summary, open tasks |
| `get_thread` | A thread the asker may see (3.2): subject, participants, latest messages |
| `get_meeting` | A meeting the asker may see: title, date, attendees, summary, key points, to-dos. Never the transcript |
| `search_catalog` | Parts: number, manufacturer, description, unit, cost, list price |
| `my_tasks` | The asker's own open tasks |

Proposal tools (4): propose a task, a note, an email, or an estimate suggestion. These write
nothing. Each becomes a card the person must confirm.

- A card may reference only record ids that this question's tools returned (plus at most 20 ids
  from earlier in the conversation, re-checked).
- An email card's recipients may come only from structured record fields or the person's own
  typing.
- Confirming uses the app's ordinary paths: create task, add note, open the composer with the
  draft (never sends), or start an estimate suggestion.
- Answers are rendered as plain text. A record reference becomes a link only when the server
  returned that record.
- "Try harder" re-asks on the larger model; the earlier answer is discarded only if the retry
  succeeds.
- The conversation is not stored. Closing the panel or navigating forgets it.
- One run record per question.

Endpoints: `POST /api/assist/ask` (a stream of newline-delimited JSON events, 120-second limit)
and `GET /api/assist/ask/context` (the current screen's record reference and title).

### 10.7 AI help for Inbox organization

Runs as a time-boxed background pass after a Gmail poll, never inside the scheduled job.

AI filing (`file`)

- The model picks exactly one id from a server-built list, or "none", or "noise". The list holds
  the likely company, up to 15 of its open quotes, active projects and open leads, and up to 5
  companies matching organisation names in the mail.
- Any other answer is dropped.
- A pick is strong only when the model says so AND the target is the matched company or one of
  its records.

AI court and promise reading (`promise`)

- The model reads the last 3 messages, the team list, the owner and today's date. Who wrote each
  message is stated by the server outside the untrusted wrapper.
- It may override the rule court only toward `me` or a named teammate (a hand-off or an ask).
- It returns at most 3 promises.

The pass

- A call starts only inside a 20-second window and only when the time left before the caller's
  deadline covers the call's worst case plus 5 seconds.
- At most 100 threads per owner per pass; owners are interleaved so one person's backlog cannot
  starve another.
- Each thread is leased for 2 minutes by compare-and-set. Results are written only if the thread
  was not rewritten meanwhile.
- A failed call counts an attempt; after 3 attempts the thread is given up until new mail.
- A refusal before any call (cap, rate limit) is not an attempt.
- A thread whose owner is not a pilot user is cleared with no call.

### 10.8 Read the PDF (vendor quotes)

In the Estimator's vendor-quote form, a button reads an attached vendor quote PDF into the form.

- Limits: about 23.8 MiB of file (so the encoded request stays under 32 MiB), 100 pages, 300
  lines, 30 reads per user per hour, about 108 seconds overall.
- The bytes come only from a stored file that the vendor quote owns, or from the form's own
  upload.
- The result fills empty fields and pre-fills the description (200 characters) when blank.
- Checks flag and never fix: line arithmetic (tolerance one cent or 0.5%), the sum against the
  stated total, whether a part number is in the catalog, whether the vendor name exactly matches
  a company.
- Freight and tax stay inside the total.
- "Try harder" re-reads with the larger model. A later read replaces the earlier one.
- On save the server verifies the extraction by a hash of the run. Accuracy is scored once, at
  the first save.

**Source:** `src/lib/assist/tasks-server.ts`, `src/lib/assist/features/task-suggest.ts`,
`src/lib/assist/reply-server.ts`, `src/lib/assist/features/reply-draft.ts`,
`src/lib/assist/thread-access.ts`, `src/lib/assist/estimate-suggest-server.ts`,
`src/lib/assist/estimate-candidates.ts`, `src/lib/assist/features/suggest-sources.ts`,
`src/lib/assist/features/suggestion.ts`, `src/lib/assist/features/suggestion-panel.ts`,
`src/lib/assist/suggestion-save.ts`, `src/lib/stores/estimate-suggestions.ts`,
`src/app/api/assist/`, `src/lib/brief/build.ts`, `src/lib/brief/drafts.ts`,
`src/lib/brief/quiet.ts`, `src/lib/brief/nudge.ts`, `src/lib/brief/sanitize.ts`,
`src/lib/brief/slots.ts`, `src/lib/brief/reminders.ts`, `src/components/brief/`,
`src/lib/triage/feeds/email.ts`, `src/lib/assist/ask-runner.ts`,
`src/lib/assist/ask-tools-server.ts`, `src/lib/assist/features/ask-cards.ts`,
`src/lib/assist/features/ask-limits.ts`, `src/lib/assist/features/ask-body.ts`,
`src/lib/assist/features/ask-prompt.ts`, `src/components/ask/`, `src/lib/inbox-org/ai-pass.ts`,
`src/lib/inbox-org/ai-filing.ts`, `src/lib/inbox-org/ai-court.ts`, `src/lib/vendor-pdf/`,
`DECISIONS.md` (D914–D960, D1140–D1157).

---

## 11. Sending estimates by email

### 11.1 The Send & track step

The Estimator's fourth step. Its cards, in order, depend on the estimate's status:

| Status | Cards |
| --- | --- |
| Draft | Composer, Bidders, Vendors, Status, Pipeline, Client link, Tasks |
| Sent | Activity, Bidders, Vendors, Composer (collapsed, for a re-send), Client link, Tasks, Pipeline, Status |
| Won / Lost | Activity, Bidders, Vendors, Client link, Tasks, Pipeline, Status |

Only the Composer, the Activity card, and the Send controls on the Bidders card involve email.

### 11.2 Composer

Defaults

- To: the quote's contact. Cc: the lead estimator, unless that is the sender or has no address.
- Subject: `<project name> — estimate <estimate number>`.
- Body: a greeting with the contact's first name ("Hi there," when unknown), a line naming the
  estimate, a line with the token `{link}` ("You can also view the full package online, and
  choose any alternates, here: {link}"), a closing and the sender's signature.
- For a "box goods sale" estimate the subject and body say "quote" and the link line is shorter.
- Follow-up task: Off, or in 2, 3, 5, 7 or 14 days. Default 5.
- Attachments: the estimate PDF, and optionally the cover PDF.

Limits: at most 20 recipients across To and Cc; the raw address text at most 4,000 characters;
subject at most 300 characters; body at most 20,000; attachments together at most 15 MB.

### 11.3 Send order

Permission: `send` or `approve`. Only system estimates in draft or sent status can be emailed.
The steps run in this fixed order:

1. Preflight: permission, the quote exists, it is a system estimate, it is not closed, the view
   is current, the PDF is current and readable, recipients, subject and body are valid.
2. Claim: one send at a time per quote. The claim lasts 120 seconds and is released at the end.
3. Preflight again under the claim.
4. Prepare attachments (read the estimate PDF; render the cover).
5. Re-read the quote. A recall, close or save during step 4 refuses the send.
6. Mark the quote sent (draft only). The approval gate applies; a refusal emails nothing.
7. Create or reuse the client link and replace `{link}` in the body. If the body has no token,
   the link is added above the signature.
8. Create the email thread and send it from the sender's own Gmail; or, for "Open in Inbox",
   create a draft instead.
9. Record the email on the quote (thread id, revision, time, sender, recipients; the last 50 are
   kept).
10. Create the follow-up task.

Rules

- Nothing is marked or emailed when preflight or the attachments fail.
- Once the quote is marked sent, a later failure reports that it is marked sent; the status is
  not rolled back.
- Once the email has gone out, a failed record or follow-up MUST NOT read as a failed send. The
  result is success with a warning.
- A Gmail refusal for a connected sender is a failure, never "sent locally".
- A Gmail timeout is reported as "Gmail didn't answer in time — check your Gmail Sent folder
  before sending again."
- The PDFs ride by reference; their bytes are never copied into the thread.
- An estimate email that did not leave through Gmail is held back from every later send on that
  thread.
- When the sender has no connected Gmail, the email is recorded locally and labelled as such.
- The email thread is linked to the quote and its company (a deliberate link), so teammates can
  see it.

Escape hatches that involve no email: "Mark sent" (change the status by hand) and "Copy link"
(copy the client link).

### 11.4 Activity card

For a sent estimate: each emailed thread with its delivery state, the count of unread replies,
the replies themselves, an inline Reply, Mark read, and how many times the client link was opened
(total and per revision). A badge on the step's tab counts new replies. Reply and Mark read
require the thread's owner.

### 11.5 Bidders

When an estimate is bid to contractors, each bidder row with an email address has Send and Retry,
and there is "Send to all bidders".

- One server call per bidder, under the per-quote claim.
- Each email carries that bidder's own PDF and their own client link.
- Subject `Bid — <project> (<estimate number>)`; a revised bid adds "(Addendum N)". The body has
  no named greeting ("Hello,").
- A failure on one row marks that row failed and the walk continues. A quote-level refusal stops
  the walk.
- A send whose Gmail result is unknown is marked so, and Retry asks for confirmation.
- Bidders who submit through their own website are marked "submitted" by hand.

### 11.6 Other places that create an email or a draft

| Place | What it creates |
| --- | --- |
| Renewal outreach (service dashboards) | A draft in the rep's mailbox with a re-priced quote PDF attached; sending it stamps the renewal state |
| Assessment report, "Email report" | A draft with the report PDF attached, then opens the Inbox composer |
| Trade-show contact card, "Send me your info" | A follow-up draft in the card owner's mailbox, one per lead, never sent |
| Customer portal invite | Sends the access link from the staff member's Gmail |
| Site-visit scheduling | Sends calendar invites, updates and cancellations from the sender's mailbox |
| Quote email draft helper | Builds To, subject ("Quote <id> — <name>") and body from a quote. No caller was found in application code; only a test uses it |

**Source:** `src/lib/estimate-email/compose.ts`, `src/lib/estimate-email/send-server.ts`,
`src/lib/estimate-email/send-ui.ts`, `src/lib/estimate-email/track-server.ts`,
`src/lib/estimate-email/sender-mailbox.ts`, `src/app/(app)/estimator/send-actions.ts`,
`src/app/(app)/estimator/bid-send-actions.ts`, `src/app/(app)/estimator/steps/send-step.tsx`,
`src/app/(app)/estimator/steps/send-composer.tsx`,
`src/app/(app)/estimator/steps/send-activity.tsx`,
`src/app/(app)/estimator/steps/bidders-card.tsx`, `src/lib/stores/quotes.ts`,
`src/lib/parties/bid-panel-server.ts`, `src/lib/renewal-outreach.ts`,
`src/app/(app)/assessments/[id]/report/actions.ts`, `src/lib/booth/followup-server.ts`,
`src/lib/portal-invite.ts`, `src/lib/visit-invite.ts`, `src/lib/quote-email.ts`, `DECISIONS.md`
(D658–D663, D1086–D1096).

---

## 12. Google Calendar, Tasks and Drive touchpoints, and other surfaces

### 12.1 Features that reuse the mailbox's Google grant

These are not part of the Inbox, but they authenticate through the same connection record and the
same connect and callback routes. Removing the Gmail connection removes their access.

| Feature | Scope | What it does |
| --- | --- | --- |
| Calendar | `calendar.events` | Reads the person's calendar for Home and `/calendar`; writes site-visit events, service-job events and drive-time blocks; imports history from the old CRM |
| Meeting matcher | `calendar.events` | Finds the calendar event that overlaps a Krisp meeting (title, attendees) |
| Google Tasks | `tasks` | Two-way sync of the person's task queue |
| Recordings archive | `drive.file` | Section 8.1 |
| Consulting engagement files | `drive.file` | Stores engagement files in Drive |
| Catalog product photos | `drive.readonly` | Reads the "Peak Product Photos" folder and attaches photos to catalog parts by file name |
| Additional calendar account | `calendar.readonly` | A second Google account whose calendars are shown read-only. Separate connection record; does not need the Gmail gate |

### 12.2 Other surfaces fed by the Inbox, meetings or Assist

| Surface | What it shows |
| --- | --- |
| Home | Inbox card (waiting threads, counts), brief card, "meetings to file" count, Start here list |
| Home tab bar | An Inbox tab |
| Bell | Group "Customers waiting on a reply": threads waiting on us with hours waited. Can be muted per person |
| Global search (⌘K) | Email threads the viewer may see, meetings, recordings, and the Ask AI row |
| Company record | Emails list, "+ New email", Meetings card, Recordings card, Waiting on customer card |
| Company activity feed | Thread rows and meeting rows |
| Lead drawer | Linked threads, Meetings card, Suggest estimate |
| Vendor record | "Email" and "Log a call" links into the Inbox |
| Estimator | Send & track (11), Vendors card listing filed threads, vendor quote "from email" link, Suggested BOM panel, Read the PDF |
| Pop-out windows | The Inbox and a single thread can open in their own browser window; changes are broadcast between windows |
| Account page | Connect mailbox, signature, Krisp card, Inbox organization card, brief reminders |
| Settings | Mailboxes card, Recordings card, Assist pilot card |

**Source:** `src/lib/gmail/config.ts`, `src/lib/google/`, `src/lib/part-docs/drive-photo-sync.ts`,
`src/lib/consulting-files-server.ts`, `src/lib/agenda.ts`, `src/lib/visit-invite.ts`,
`src/lib/drive-sync/sync.ts`, `src/lib/nav-counts.ts`, `src/lib/search/global-search.ts`,
`src/lib/customer-feed.ts`, `src/lib/dashboard/data.ts`,
`src/app/(app)/_dashboard/widgets/home-cards.tsx`, `src/app/(app)/companies/[id]/page.tsx`,
`src/app/(app)/account/page.tsx`, `src/app/(app)/settings/page.tsx`, `src/lib/popout/`,
`src/app/(app)/home-tabs-keys.ts`.

---

## 13. Security rules, known gaps, and disagreements

### 13.1 Security rules worth preserving

1. Mail is sent only from the thread owner's own Google account, resolved by user id.
2. Ownership and visibility are decided by user id; a display name is never an identity (3.1).
3. Automatic sender matching never shares a thread; only a deliberate link does (3.3).
4. Every write on a thread checks ownership first and answers like "not found" otherwise (3.2).
5. Another person's draft is never visible.
6. A forward of a private thread stays private (5.5).
7. OAuth state is signed and bound to the initiating user; tokens and API keys are encrypted at
   rest; the Anthropic key and Krisp keys never reach the browser.
8. Scheduled endpoints are outside the sign-in gate and MUST check a shared secret; they are
   disabled when none is configured.
9. Attachment bytes are served only after the visibility check, and stored PDFs only on a thread
   that legitimately carries them (4.9).
10. Uploaded attachments are re-checked on the server (path belongs to the caller, real size,
    leading bytes) before they can be attached.
11. Model output is untrusted: schema-validated, ids checked against server-supplied lists,
    rendered as plain text; outside text is wrapped and defanged before it reaches a model (9.7).
12. No model call can send mail or change a record, except promise tasks and pilot noise moves.
13. A meeting's transcript is never exposed to customers or to the AI question tool.
14. Preview deployments must not use the stored API key by default.
15. The offline sync endpoint serves only field-capture collections, never threads or meetings.

### 13.2 Known gaps and open questions

1. OAuth state has no expiry. It is single-purpose and bound to a user id, but a captured state
   stays valid indefinitely.
2. Email signatures are stored keyed by display name, although mailbox identity was moved to user
   id. Two users with the same name would share a signature; a rename loses it.
3. Every folder listing and the de-duplication of an imported message load all threads and filter
   in memory. This was accepted for small volumes.
4. A history-cursor failure resets the cursor to "now"; messages in the gap are not imported
   later (label and inbox state are recovered by the reconcile).
5. A failed archive push to Gmail is not retried.
6. Appending a message to a thread is a whole-document write in some paths; project notes list
   "atomic append" as a follow-up.
7. The Assist hourly rate limits use an in-memory, per-process limiter. Its own comment says it
   is best-effort and resets on restart; on serverless hosting it does not hold across instances.
   Only the monthly spend cap is a hard limit.
8. With only daily scheduled jobs, mail freshness depends on someone having the Inbox open.
9. The 6:45 Chicago brief is built by an 11:45 UTC job, which is 5:45 Chicago in winter; the
   brief then builds lazily on first view.
10. Meeting visibility "private" depends on which staff members' Krisp accounts saw the meeting,
    not on attendance.
11. Recording upload is brokered by a route outside the sign-in gate; its own authentication was
    not traced (14.6).
12. Model ids and prices are constants in code and must be re-checked against the provider.

### 13.3 Where documentation and code disagree

| Topic | Documentation says | Code does |
| --- | --- | --- |
| Shared mailboxes | `AGENTS.md` phase 7: Settings "connects personal + shared boxes". The header comment of the thread store describes `sales`, `installs`, `info` mailboxes. The Gmail config comment says "four connectable mailboxes" | Shared mailboxes are retired. The shared list is empty; only personal mailboxes can be connected or listed. Old shared threads are stored and owned by nobody |
| Simulated mail | The thread store's header says sending and receiving "is SIMULATED" | True only while the Gmail gate is off |
| AI removal | `AGENTS.md` phase 8: "the app is fully deterministic, no `ANTHROPIC_API_KEY` anywhere" | Superseded by the Assist layer, as the same entry later notes |
| Draft estimate | `AGENTS.md` phase 53 describes "Draft estimate" creating a draft quote | Replaced by Estimate suggestion, which creates no quote. Banners on old drafts remain |
| Scheduled-job secret | `.env.example` describes `CRON_SECRET` as the secret for the Gmail sync endpoint | The other scheduled endpoints use the same secret and the same 503 / 401 contract through a shared helper |
| Noise senders | The design note lists "no-reply" | Code also treats "do-not-reply" as an automated sender |
| Morning build time | `AGENTS.md` phase 44 says the morning build runs at 11:45 UTC as "6:45 Chicago" | 11:45 UTC is 6:45 only during daylight time |

**Source:** `src/lib/gmail/oauth.ts`, `src/lib/stores/signatures.ts`, `src/lib/stores/comms.ts`,
`src/lib/gmail/bridge.ts`, `src/lib/gmail/config.ts`, `src/app/api/gmail/sync/route.ts`,
`src/middleware.ts`, `src/app/api/sync/pull/route.ts`, `src/lib/meetings/visibility.ts`,
`src/lib/assist/models.ts`, `src/lib/rate-limit.ts`, `src/lib/triage/cron.ts`, `AGENTS.md`,
`.env.example`, `vercel.json`.

---

## 14. Not verified

The following were taken from project notes or comments, or were only partly read. A rebuild team
should confirm them with the owner before relying on them.

1. The Inbox's on-screen layout, keyboard shortcuts and command bar. The folder, filter and action
   rules were read; the markup was not.
2. The exact behaviour of each link-sidebar control, the quick-add forms, and the domain claim
   table's shape.
3. The signature reader's line-by-line rules.
4. The MIME builder (headers, encodings) and exactly how the body is extracted from HTML-only
   mail.
5. The upload-endpoint switch for large sends: only the 4 MB constant was read.
6. Recordings: the recorder UI, the upload broker's authentication, the Krisp import request, the
   action-item write-back to Krisp, and the Drive folder cache. The lifecycle and limits were
   read from constants and header comments.
7. Meetings: the reader and sidebar markup, the name-core word lists, how the calendar event is
   chosen, and the "Load older" paging.
8. Google Calendar, Google Tasks and the additional-calendar connection: only their existence,
   scopes and callers were traced.
9. How the rate limiter behaves on the production host (it is in-memory per process).
10. The Assist reports' exact columns and the edit-ratio formula.
11. Ask AI: the system prompt, the card sanitiser's field caps, how the forced final round behaves
    live, and web-search tool versions per model. Project notes say the final round and Haiku web
    search were "not yet verified live".
12. The daily brief's three-block card layout, the afternoon diff, and the speech text.
13. Estimate suggestion: the extract and draft prompts and the candidate ranking.
14. Read the PDF: the extraction schema and the accuracy score.
15. Send & track: the Activity card's reply path, the bidder send internals and the per-bidder
    link token format. The fixed order and limits were read from the module's header and
    constants.
16. Renewal outreach, portal invite and site-visit invites: only that they create mail or drafts
    through the thread store.
17. How a found record number is resolved to a live quote, lead or project, and how ties between
    several numbers in one message are broken.
18. That company-wide sender rules and the own-domain override are restricted to administrators
    (the Settings card is; each action's own check was not read).
19. Morning triage's use of threads beyond the one-business-day rule.
20. Automated test coverage. Test scripts exist for Inbox organization, thread visibility, Assist,
    the brief, Ask AI, estimate suggestion, meetings and vendors (`scripts/test-inbox-org.ts`,
    `scripts/test-thread-visibility.ts`, `scripts/test-assist.ts`, `scripts/test-brief.ts`,
    `scripts/test-ask.ts`, `scripts/test-suggest.ts`, `scripts/test-meetings-323.ts`,
    `scripts/test-vendors.ts`); what each covers was not checked, and none was run for this
    document.
21. Production values: the pilot list, feature switches, cap, own-domain override and sender
    rules are stored settings and may differ from the defaults described.
