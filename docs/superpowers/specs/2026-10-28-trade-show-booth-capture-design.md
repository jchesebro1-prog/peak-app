# Trade show booth capture + NFC contact card — design

Jeff, 2026-10-28: "I need a way to track and collect contact information for
people that come to my trade show booth. I would love it if I could also have
my contact card on NFC to tap to them."

## Decisions taken in the brainstorm (Jeff)

| Question | Answer |
| --- | --- |
| Where do contacts end up? | Peak App **Leads** (source `event`), no separate list |
| Who enters the info? | Visitor via QR/NFC on their own phone **and** staff Booth mode **and** business-card scan (not badge scan) |
| What does the NFC tap open? | One page: Jeff's card (Save contact) **plus** "Send me your info", which becomes a lead |
| How is a business card read? | **On-device** text recognition (native app only), no AI call |
| Offline? | Booth mode **queues offline** through the existing outbox |
| Follow-up to a visitor who sends their info? | A **draft waiting in Jeff's Inbox**. Nothing sends automatically |

Approach chosen: a light **Shows** list (option 1 of 3). The alternatives were a
free-text tag on the lead, or a full events module with cost/ROI reports.

## What already exists

- `src/lib/stores/leads.ts`: `SOURCES` includes `event` ("Trade show / event",
  48 h SLA). Leads land in the existing SLA queue and follow-up flow.
- `/lead-intake` + `/api/leads/intake`: public, branded form with a honeypot and
  rate limits, exempted in `src/middleware.ts`.
- `users`: `title`, `phone`, `mobile` and `photoUrl` are already the contact-card
  fields (signature blocks).
- Offline outbox + SyncEngine (`src/lib/sync/`) flushing to `/api/sync/push`.
  Push accepts only `SYNCABLE_COLLECTIONS` (`src/db/doc-tables.ts`).
- Native shells: Capacitor 8 iOS + Android (`ios/`, `android/`).

## 1. Shows

- A settings blob `trade_shows`: `{ id: "sh_<8 hex>", name, startAt, endAt,
  active: boolean }[]`. **At most one** show is active, enforced by the one
  writer. Pure rules in `src/lib/booth/shows.ts`: sanitize, `activeShow(list, now)`,
  and `showFor(list, id | undefined)`.
- Admin/`create` UI: **Leads → Shows** (`/leads/shows`). Add, edit, set active,
  archive. A show is never deleted once a lead names it.
- `Lead.eventId?: string` (optional doc field, no migration). Every booth
  lead has `source: "event"` + `eventId`.
- The Leads board/worklist/table gains a **Show** filter (`?show=<id>`). The lead
  drawer shows the show name next to the source chip.
- `booth_captures` is a new doc table (migration 0042_booth_captures), added to
  the offline-synced field collections. Shows and contact cards stay settings
  blobs (`trade_shows`, `contact_cards`), written one op at a time under the
  blob row lock; a card slug is admin-only (`manage_users`), one slug per user,
  and a slug held by another user is refused.

## 2. Public card page (what the NFC tap opens)

- Route: `/c/[slug]`, public, outside `(app)`, and added to the middleware
  exemption alongside `lead-intake`. The slug maps to a user through a settings
  blob `contact_cards: { [slug]: userId }` (no migration), edited on
  `/leads/shows` by an admin. An unknown slug returns 404. Only Jeff gets one now. The
  URL shape leaves room for per-staff cards later; no per-staff UI is built now.
- Shows the user's photo (`photoUrl`, else the initials avatar), name, title,
  phone/mobile, email, company name and website (AppSettings), with branding
  from the root layout.
- **Save contact** → `GET /c/[slug]/vcard` returns a vCard 3.0 (`text/vcard`,
  `Content-Disposition: attachment; filename="<Name>.vcf"`): `FN`, `N`, `ORG`,
  `TITLE`, `TEL;TYPE=WORK`, `TEL;TYPE=CELL`, `EMAIL`, `URL`, and `PHOTO` base64
  (JPEG ≤ 200 KB, fetched server-side and omitted on failure). A pure builder,
  `src/lib/booth/vcard.ts`, handles escaping (`\,` `\;` `\n`) and line folding
  at 75 octets.
- **Attribution (card-origin captures):** the follow-up and the lead owner are
  the card's user, but the visitor is a stranger and cannot speak as the owner.
  A card-origin capture that merges into an existing open lead is attributed to
  "Contact card" (never to the owner), its note is prefixed "Sent from the
  contact card (not verified): ", and it never changes the lead's temperature.
- **Send me your info**: name (required), email or phone (at least one), company,
  interest chips (Rigging · Curtains · Lighting · AV · Flame testing ·
  Inspections) and a note. Same guards as `/api/leads/intake`: a honeypot, the
  existing per-IP rate limit, and a JS-only submit. It posts to
  `POST /api/booth/share-back` (also exempted).
- On submit, the server builds the lead **through the booth core (§5)** with
  `source: "event"`, `eventId` = the active show (none outside a show, which is
  fine), owner = the card's user, and `capturedVia: "card"`. Then it creates a
  **follow-up draft** in the owner's mailbox (§6). The visitor sees "Thanks — I'll
  be in touch," plus the Save contact button again.

## 3. The NFC card + QR (no code)

- Blank NTAG215/216 cards (or a printed/metal NFC business card). Write the URL
  `https://<prod host>/c/jeff` with the free NFC Tools app on an iPhone (one
  NDEF URI record). iPhone XS+ and Android read URL tags with no app.
- The card never names a show. The server uses whichever show is active, so a
  card is written once and works at every show.
- `/leads/shows` shows a **QR code** for each card URL, with SVG + PNG download,
  for the card's back and a booth sign. It uses a QR generator; the dependency
  is chosen in the plan, and an existing one is used if the repo already has one.
- The how-to (buying cards, writing the tag, testing a tap) goes in
  MASTER-HOWTO.

## 4. Booth mode (staff)

- Route `/leads/booth`, phone/iPad first, `requirePerm("create")`. It's listed in
  the nav under Leads and is also reachable from `/leads/shows`.
- The header shows the active show (switchable). Fields: first/last name, email,
  phone, company, title, the same interest chips, **Hot / Warm / Cold**
  (`Lead.temperature?`) and notes. **Save & next** clears the form, keeping the
  show.
- **Scan card**, native shells only (hidden in a browser):
  - The camera captures a still, and a Capacitor text-recognition plugin (Apple
    Vision on iOS, ML Kit on Android) returns lines of text on the device with
    no network. The plugin is chosen in the plan; it must run fully on-device.
  - A pure parser, `src/lib/booth/card-parse.ts`, turns lines into
    `{ name, email, phones[], website, company, title }`. It uses regexes for
    email/URL/phone, and heuristics for the rest: the name is the line with 2–4
    capitalised words that isn't the company or title, the company is the line
    matching the email/website domain or carrying a corporate suffix, and the
    title matches a keyword list. It never invents values: an unknown field stays
    blank.
  - The parsed fields fill **only fields that are still empty** (a rescan never
    overwrites what staff typed or an earlier scan filled) and are highlighted
    until edited; staff confirm. An ambiguous name stays blank rather than guessed.
  - The card photo is shrunk on the device to a ≤ 250 KB JPEG and rides inside
    the `booth_captures` doc. On receipt the server verifies the JPEG magic bytes,
    moves it to private Blob at `booth/<capture id>.jpg` (kept inline only in
    local dev without Blob) and the lead drawer shows it via
    `GET /api/booth/card-image/<id>` (signed-in only).
  - Recognition is a local `CardText` Capacitor plugin (Apple Vision on iOS, a
    bundled ML Kit model on Android), not a third-party plugin: the iOS project
    uses SPM and the ML Kit Capacitor plugin is CocoaPods-only.
- **Offline:** a capture is a `booth_captures` doc, a new collection added to
  `SYNCABLE_COLLECTIONS`. Its id is generated on the device as `bc_<16 hex>`, and
  the doc holds the form, show id, the card image (see above) and `capturedAt`.
  It goes through the outbox like the field-capture editors. Pulled copies strip
  `cardImage` and `claimUntil`; `leadId`, `outcome`, `cardImagePath` and
  `claimUntil` are server-owned.
- **Today at this show:** the device's captures for the current show, each
  marked *Synced* or *Waiting to sync*, with the count.

## 5. Booth core (server, one path)

`src/lib/booth/capture-server.ts` → `recordBoothCapture(capture, actor)` is used
by both the share-back API and the `booth_captures` push handler:

- **Claim first, then idempotent:** each capture id is claimed with
  `insertDocIfAbsent` and a 60 s `claimUntil` lease (a second caller while the
  lease is live gets "busy": the push replies `retry`, share-back answers 409;
  a stale claim is taken over by compare-and-set). It is a claim, not an
  advisory lock, because creating a lead inside a transaction returns an
  unnumbered lead. Share-back mints its own `bc_` id. A repeat push returns the
  same lead and never creates a second one (`Lead.boothCaptureIds`).
- **One-write lead create:** `eventId`, `interests`, `temperature` and
  `boothCaptureIds` go through `Leads.create()` in a single write.
- **Merge:** an open-lead match is applied by `addBoothCapture` in one
  `patchDoc` callback, idempotent per capture id.
- **Attribution:** `capturedById` / `capturedByName` are always the signed-in actor (the payload field
  is ignored); the lead owner is the card owner (share-back) or the capturing
  staff member (Booth mode).
- **Dedupe** (pure rule `src/lib/booth/dedupe.ts`): an exact, case-insensitive
  email match to an existing contact attaches the lead to that contact/company.
  An email matching an **open** lead adds a note "Met again at <show>" + the
  capture's notes and interests to that lead instead of a new one. A phone-only
  match is never auto-merged.
- New leads: `source: "event"`, `eventId`, the owner (share-back: the card's
  user; Booth mode: the capturing staff member), SLA from `slaForSource`, and
  interests and temperature stored on the lead.
- The `booth_captures` doc is stamped `{ leadId, outcome: "created" | "merged" }`
  so the device shows the result after pull.

## 6. Follow-up draft (share-back only)

- After a share-back lead is recorded, a draft is created in the card owner's
  mailbox **through the existing app-created draft path** (the one renewal
  outreach uses). It's linked to the lead (deliberate link), addressed to the
  visitor's email, subject "Great meeting you at <show>", with a short
  rules-based body naming their interests and the owner's vCard attached.
- No email → no draft (the lead still lands). Mailbox not connected → the draft
  stays an app draft in the Inbox as today. **Nothing is ever sent
  automatically.**
- Booth-mode captures get no automatic draft. Staff follow up from the lead.

## Not in scope

Badge scanning, AI card reading, auto-sent email, per-staff card UI, show
cost/ROI reports, a per-show CSV export, and offline for the visitor's own form
(it needs their phone's signal).

## Testing

- `scripts/test-booth.ts` (joins `test:specs`): vCard builder (escaping,
  folding, missing fields), card parser (≥ 15 real-world card text samples,
  including two-column, all-caps and multi-phone cards), dedupe rule, shows rules
  (one active), and `recordBoothCapture` idempotency + merge (scratch PGlite).
- Smoke: `GET /c/jeff` and `/c/jeff/vcard` return 200 signed out, and `/leads/booth`
  and `/leads/shows` redirect signed out.
- Manual: a real NFC tap on an iPhone and an Android, a card scan in the iOS app
  in airplane mode then a sync, and a share-back creating a lead + Inbox draft.

## Remaining (Jeff-gated after build)

Buy and write the NFC cards, set Jeff's photo/title/phone in Settings →
Team and his card slug on `/leads/shows`, create the first show and set it active, `npx cap sync` and
rebuild the native apps for card scanning.
