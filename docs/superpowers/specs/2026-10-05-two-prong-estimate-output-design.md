# Two-prong estimate output — cover PDF + HTML package link (#301)

Source: Jeff's build brief "Two-Prong Estimate Output (Cover PDF + HTML Package)" (2026-10-05, Cowork) and its
brainstorm note `sessions/2026-10-05-two-prong-estimate-output-brainstorm.md`. Extends #293
(`docs/superpowers/specs/2026-10-01-narrative-client-preview-design.md`), which already built key products, saved
paragraphs, intros, the Narrative/BOM online page, the client share link and the scoped photo routes.

D-numbers are tentative (D613…); recompute from origin/main right before the docs commit.

## Goal

One estimate, two client outputs from the same stored systems:

1. **Cover PDF** — letterhead, Arial, a short paragraph + bold price line per scope, an overall summary, add options,
   "Not included", the link line, and the lead estimator's signature block. One to two pages.
2. **HTML package link** — the share link becomes a per-revision, frozen presentation page: header with the grand
   total, overall summary, one section per scope (client goals, long narrative, key-product photos, scope price, a
   Qty / Manufacturer / Part / Description BOM with no unit prices), plans and risers, add options and "Not
   included", downloads (datasheets + spec .docx zip), and client actions (check scopes + submit, ask a question).
   Opens are tracked.

Plus the survey change: a **Client goals** box per discipline that pre-fills each scope's client need.

## Locked decisions (Jeff)

| # | Decision |
|---|---|
| 1 | HTML link shows scope totals and the grand total only. The BOM sits behind a toggle with no unit or extended prices. |
| 2 | Cover PDF: standalone, Peak letterhead + footer, Arial, underlined centered title, signature block. |
| 3 | Price source of truth = the app estimate. **No QuickBooks integration**; Jeff keys QB from the estimate (answered 2026-10-05). |
| 4 | Client need = a "Client goals" box per survey discipline, copied into the matching scope; editable. |
| 5 | Long form written once (#293's intro + key-product paragraphs). Cover paragraph = override text, else the first paragraph of the intro. |
| 6 | No AI anywhere in the quote path (D89). Unwritten → visible placeholder, never blocking. |
| 7 | Link: unguessable, revocable, no client login. |
| 8 | **Frozen snapshot per sent revision**, its own token. A newer send → the old link shows a "superseded" banner pointing at the latest. |
| 9 | Plans/risers: Grid-derived by default, an uploaded file overrides. Shown only when present. |
| 10 | Client actions: download the datasheet/spec package, check wanted scopes + submit, ask a question / request changes. |
| 11 | Acceptance: notify + log on the CRM thread. **No stage change**; Jeff moves to Won after the PO. |
| 12 | Signature block = the quote's **Lead estimator** (`owner`): name, title, phone, email from Team (answered 2026-10-05). |
| 13 | Datasheet gaps are **staff-only** (Client link panel chips); the client page lists only what's included (answered). |
| 14 | Printed site-visit sheets + the July sheet-vs-app field reconciliation are revised in the same build, as a parallel side task outside the repo (answered). |

## Decisions taken without asking (to log)

- **D-a Scope = printed system.** A "scope" is a `SpecSection` that prints (the same set and order
  `quoteDocumentDataFor` prints). Its price is the existing system sell subtotal (`sellOverride`/rounding included).
  Grand total = the document's own total. Nothing re-prices.
- **D-b Discipline tag on a system.** New optional `SpecSection.discipline?: "lighting" | "rigging" | "curtain" | "av"`
  (the survey's `DisciplineKey`). Set by a small select in the system header; when blank, inferred from the system
  name by keyword (`lighting|dimm|fixture` → lighting, `rigging|hoist|batten|track` → rigging, `curtain|drape|valance|
  cyc|soft goods` → curtain, `audio|video|av|sound|projection` → av) for goal matching only — never stored by
  inference.
- **D-c Client goals pre-fill.** Survey discipline data gets a `goals` string key (`DisciplineData` is already
  `Record<string, …>` — no migration). When the estimator's survey-driven Draft scope (`draftQuoteScopeAction`)
  assembles sections, each section's `clientGoals` is copied from its discipline's goals. A narrative-column
  **From site visit** menu lists the surveys linked to this quote's lead/customer (newest five) × disciplines with
  non-blank goals, and copies one in. Blank → the column shows "Add the client's goals" (amber), never blocks.
- **D-d Cover paragraph.** `SpecSection.coverText?: string` override. Else the first paragraph block of
  `narrativeBlocks(section.narrative)`; else the first key product's first paragraph; else the visible placeholder
  "[needs a paragraph]" in the staff render — the PDF prints it too, in grey italics, so a gap is obvious and the
  export never blocks. "Flag a sentence" = paste it into the override (UI: **Use selection as cover** button on the
  intro textarea copies the selected text into `coverText`).
- **D-e Overall summary + Not included.** Quote fields `coverSummary?: string` and `notIncluded?: string`. A settings
  blob `estimate_output_defaults` holds the shared **Not included** list (one item per line; Settings → Estimating
  defaults, admin) which a new quote's `notIncluded` starts from and which **Reset to default** restores. Printed as
  one "Not included:" paragraph (items joined with "; "). Overall summary blank → cover prints the scope list
  sentence "This estimate includes N scopes: A, B and C." (deterministic).
- **D-f Add options** are the existing option-flagged lines (`SpecItem.option`), numbered "ADD OPTION 1…" across the
  quote in document order, each with its description, customer comment as the reason, and its extended sell. They
  print on both outputs only when the quote's existing `pdfOptions` toggle is on (the same rule the estimate PDF uses).
- **D-g Rev-pinned tokens.** Token v2 = `<exp>.<rev>.<mac>`, MAC over `share:quote:<id>:<rev>:<nonce>:<exp>` —
  domain-separated from v1. One nonce/expiry per quote (unchanged storage); the **rev** pins the snapshot. Copy client
  link always mints the token for the latest sent revision. v1 tokens (`<exp>.<mac>`) keep #293's behavior (latest
  sent) and never get actions — no live link breaks. Revoke still kills every token for the quote.
- **D-h Superseded + revising.** A pinned rev that is no longer the latest sent → the frozen page with a top banner
  "A newer version of this estimate was sent <date>." + **View the current version** (the v2 token for the latest,
  same nonce/exp). Actions are disabled on a superseded page. A quote recalled to draft → the pinned snapshot still
  shows, with "Peak is revising this estimate." and actions disabled (supersedes #293 decision 16 for v2 links:
  "frozen" means the client keeps what was sent; Revoke is the kill switch).
- **D-i The portal page stays #293's.** `/portal/quotes/[id]` is unchanged; the package is the share link only.
- **D-j Package files.** `Quote.packageFiles: PackageFile[]` (≤ 12) — `{ id, kind: "plan" | "riser" | "drawing",
  name, blobPath, contentType, size, source: "upload" | "grid", addedAt, addedBy }`. Uploads: PDF/PNG/JPEG/WebP,
  ≤ 25 MB, magic-byte checked, private Blob, direct-to-Blob like the `documents` collection. **Generate from Grid**
  renders the linked Grid design's drawing set (plan sheets + E-501 riser, 11×17) to one PDF through a new signed
  print route and stores it as a `source: "grid"` file. Any `upload` file of a kind hides `grid` files of the same
  kind on the page (override, decision 9). `revisionDocFields` snapshots `packageFiles`, so a revision is frozen;
  revisions cut before #301 read none.
- **D-k Grid lookup.** A quote finds its Grid project by scanning projects for `options[].quoteId === quote.id`
  (new `gridProjectForQuote(quoteId)` in grid-projects.ts). No stored back-link.
- **D-l Downloads.** One zip per (quote, rev): every datasheet and spec sheet `resolvePackageDocs` covers for the
  revision's BOM skus (blob-backed only; link-only placeholders are skipped), plus the spec .docx the client package
  generator builds for that BOM. Streamed. Gaps (no datasheet) appear only in the staff panel. Individual datasheet
  links also appear under each key product.
- **D-m Client responses.** `Quote.clientResponses: ClientResponse[]` (append-only, ≤ 200) — `{ id, kind: "accept" |
  "question", rev, at, name, email, title?, message, sectionIds, sectionNames, total }`. Side effects, all
  best-effort after the write: (1) `addNoteRecord({ parentKind: "quote", parentId, customerId, system: true })`
  (customer timeline = the CRM thread); (2) `logActivity(leadId, …)` when the quote has a lead; (3) `createTask`
  assigned to the Lead estimator (fallback: preparedBy's user, else every `approve` holder), due today, titled
  "Client accepted EST-1042 Rev 2 — Lighting, Rigging ($48,250)" / "Client question — EST-1042". **Status never
  changes.**
- **D-n Public form protection.** Server actions on the share page re-verify the v2 token + pinned rev = latest sent
  + state ok on every submit; refused on v1, revoked, expired, superseded or revising. Per-IP rate limit 5/10 min and
  per-quote 30/day; a hidden honeypot field; name ≤ 120, email ≤ 200 (shape-checked, optional), message ≤ 4,000;
  `sectionIds` filtered to the pinned revision's printable sections. No cookies set.
- **D-o Open tracking.** `Quote.shareOpens: Record<rev, { first, last, count }>`. The share page GET records an open
  (a public write, deliberately added now — reverses #293's "no view tracking" per the brief) at most once per
  IP-hash per rev per 30 minutes (in-memory dedupe, like the rate limiter); skipped when the request carries a team
  session (`auth()` user present). Shown in the Client link panel ("Rev 2 · opened 3× · first Oct 5 · last Oct 6") and
  on the Quotes hub row as a small "Opened" chip.
- **D-p Cover PDF delivery.** Rendered on demand from the **live** quote (staff can print a draft) through a signed
  print route `/print/cover/[id]` (new `PrintTokenKind` `"cover"`) and the existing headless-Chrome renderer; downloaded
  from `/api/quotes/[id]/cover-pdf` (`requirePerm("view")`… same perm the estimate PDF download uses). Entry points:
  the customer preview sidebar (**Cover PDF**) and the toolbar quote ⋯ menu. The link line prints the active v2 share
  URL (absolute, from `printOriginFor`) when one exists, else nothing.

## Spec-review corrections (2026-10-05) — these override anything above

R1. **Totals.** Freight is already inside each system's sell (`systemSellTotal` = items + freight). The invariant is
   `Σ scope prices − t.credit = t.grand` (tax is 0). Both outputs print the Rewards credit line ("Rewards points
   applied"), the purchase-perks line (`rewardsLine`) and the POR wording ("Total (excludes items pending price)")
   exactly where QuoteDocument prints them. The Phase 5 live total is "Selected scopes" (pre-credit) with a note
   "A Rewards credit of $X applies to your order." when the quote has one.
R2. **Labor systems are scopes.** A labor-kind section prints as its own scope (its name, its single "Installation,
   commissioning & project management" BOM row, its price), is checkable in Phase 5, never matches a discipline.
R3. **Goals pre-fill (replaces D-c's Draft-scope copy).** `draftQuoteScopeAction` builds a paragraph, not sections. New
   `surveyGoalsAction(surveyId)` → `{ goals: Partial<Record<DisciplineKey, string>>, label }` (`requireUser`, capped
   1,000, trimmed). The estimator calls it when the page has a linked survey (`aiSource.kind === "survey"`) on load
   and through **From site visit**; it fills `clientGoals` only on sections whose discipline (stored, else inferred)
   matches **and** whose `clientGoals` is blank. From site visit lists `surveysForLead(q.leadId)` + the customer's
   surveys (newest five).
R4. **Survey goals sanitizing** happens in `saveSurvey` (trim, ≤ 1,000 per discipline `goals`) and again wherever
   goals are copied (the push path has no sanitizer). The box renders in `sections/systems.tsx` inside each
   discipline block and inherits the existing kill-question lock.
R5. **Load system strips per-customer text.** `librarySectionForLoad` deletes `clientGoals` and `coverText` beside
   `room`. Same-estimate Copy and Move keep them.
R6. **BOM rows.** Manufacturer / Part come from the line first (`manufacturer`, `manufacturerPartNumber`, frozen with the
   revision), then the catalog part by `sku` (`mfr`, `manufacturerPartNumber`, via `getMany`), else blank. Labor
   lines (`it.labor`) are dropped from the parts BOM except a labor-kind system's single row. Options and the credit
   line never appear (customerLines already excludes them).
R7. **Cover PDF route** uses `requireUser()` (there is no `view` perm), `export const maxDuration = 60`, and
   `printOriginFor(process.env, host, proto)` like the rack submittal route.
R8. **Grid drawing set printing** needs: (a) the set body extracted to a shared server component taking an
   `assetHref(kind, id)` resolver; (b) token-scoped asset routes under `/print/grid-set/[id]/asset/...` that verify the
   same print token and that the asset belongs to that project (sheet sources, symbol docs); (c) a `waitFor` selector
   option on `renderPrintRouteToPdf` (`[data-plan-figure]:not([data-ready="1"])` absent, with a 30 s cap). This is its
   own task in Slice C; the upload override ships first and works without it.
R9. `gridProjectForQuote` scans `ensureOptions(doc).options[].quoteId` and `doc.quoteId`.
R10. **Package zip** is built in memory (`createStoredZip`) with the rack caps (25 MB/doc, 60 MB total, 45 s deadline,
   a `LEFT OUT.txt` listing what was skipped), includes the D94 `assemble` + `buildSpecDocx` spec as
   `Specifications.docx`, and is **cached in private Blob** at `estimate-package/<quoteId>/rev-<rev>.zip` on first
   download; later downloads stream the blob. Staff **Rebuild package** deletes the cache. Rate limit 6/10 min/IP.
R11. **Token rev = `QuoteRevision.rev`** (array position incl. manual snapshots). Everything customer- or staff-facing
   prints `sentDocumentStamp(q, rev).revNo` ("Rev 2").
R12. **No live fallback for v2.** A v2 page reads `coverSummary`, `notIncluded`, `packageFiles` from the pinned
   revision's `docFields` only; absent = empty (never the live quote — that would leak unsent edits). Header fields
   keep #293's fallback.
R13. **Drawings are an annex, not priced content.** `addPackageFile`/`removePackageFile` write the quote's list **and**
   the latest sent revision's `docFields.packageFiles` when the quote's online state is ok (like `pdfBlobPath` is
   stamped after the snapshot). Superseded revisions keep their own list.
R14. `coverSummary`/`notIncluded` are **not** `QUOTE_CONTENT_FIELDS` (they don't print on the estimate PDF). They join
   the estimator save whitelist, `buildQuote`, and `QuoteRevisionDocFields`.
R15. **CRM thread.** `logActivity(leadId, { type: "system", … })` (never `note` — that stamps `firstContactAt`).
   `addNoteRecord` parent `quote` + `customerId` (shows on the customer feed; a quote with no customer still stores
   it). One `createTask` per assignee.
R16. **Lead estimator lookup.** `owner` is a name string. Resolve via `allUsers()` exact case-insensitive name match,
   unique only; else `preparedBy` the same way; else no signer block name (prints "Peak Systems Group") and tasks go to
   every `approve` holder.
R17. **Settings.** New admin section Settings → **Estimate output**: Not included default list, and a `website` field
   for the cover footer. Footer = company name · primary office street, city, state zip · office phone · website.
R18. **Opens are recorded by a client beacon, not the GET.** A tiny client island calls `recordShareOpenAction(id,
   token)` from `useEffect` once per page load (link-preview bots and mail scanners don't run JS); skipped server-side
   when `getOptionalUser()` is a team user; dedupe per IP-hash per rev per 30 min in memory. Limitation noted.
R19. `inferDiscipline` uses word boundaries (`\bav\b`, `\baudio\b`, `\bvideo\b`, `\bsound\b`, `\bprojection\b`;
   `track` only with `curtain|drape` context — "track lighting" is lighting).
R20. Type name: `QuoteDocumentProps` (quote-document-data.ts:62), not `QuoteDocumentData`.

## Slices

- **Slice A (Phases 1–2):** section fields + discipline, survey goals + `surveyGoalsAction`, narrative-column
  authoring, quote cover fields + Settings → Estimate output, pure `estimate-output/scopes.ts`, CoverDocument +
  `/print/cover/[id]` + `/api/quotes/[id]/cover-pdf`, preview sidebar buttons. Ships a usable cover PDF.
- **Slice B (Phases 3 + 6):** v2 tokens, `package-view.ts`, PackageView page, BOM rows, superseded/revising banners,
  Client link panel per-rev list, open beacon + display.
- **Slice C (Phases 4 + 5):** datasheet doc route + zip cache, package files upload + annex, Grid-set print (R8), client
  actions + responses + notifications, staff gap chips, response list.

## 1. Data model

All additive JSONB on the quote doc / spec — **no migration**.

```ts
// estimator/types.ts — SpecSection
discipline?: "lighting" | "rigging" | "curtain" | "av";
clientGoals?: string;   // ≤ 1,000 chars, plain text
coverText?: string;     // ≤ 1,500 chars, plain text

// stores/quotes.ts — Quote
coverSummary?: string;  // ≤ 3,000
notIncluded?: string;   // ≤ 3,000, one item per line
packageFiles?: PackageFile[];
clientResponses?: ClientResponse[];
shareOpens?: Record<string, { first: number; last: number; count: number }>;
```

- `coverSummary`, `notIncluded` join `QUOTE_CONTENT_FIELDS` and `QuoteRevisionDocFields` (they print on the package
  page and the cover). `packageFiles` joins `QuoteRevisionDocFields` only (not content — attaching a drawing does not
  stale the estimate PDF).
- `clientResponses` and `shareOpens` are written only by new store functions under the row lock
  (`appendClientResponse`, `recordShareOpen`), and `update()` strips them like `shareLink` (a client save can't
  overwrite them). `packageFiles` likewise has its own writers (`addPackageFile`, `removePackageFile`).
- Section fields are sanitized server-side in the save path beside `withSanitizedKeyProducts` (trim, caps, discipline
  whitelist) and carried by Copy system / Load system / Move.
- Survey: `disciplines[key].goals` (string ≤ 1,000), sanitized in the survey save path.

## 2. Pure modules

- `src/lib/estimate-output/scopes.ts` — `outputScopes(data: QuoteDocumentData)` → `{ id, num, name, discipline,
  price, clientGoals, coverParagraph: { text, source: "override" | "intro" | "key-product" | "missing" },
  narrativeBlocks, keyProducts, bomRows }[]`; `addOptions(...)`; `notIncludedItems(text)`; `coverSummaryText(...)`;
  `inferDiscipline(name)`. Sum check: Σ scope prices + freight rows = the document's base total (harness asserts).
- `src/lib/estimate-output/bom.ts` — `packageBomRows(section, catalogIndex)` → `{ qty, unit, manufacturer, part,
  description }[]` from `customerLines` (labor folded the same way), manufacturer/MFR part # from the catalog part
  (blank for custom/allowance). **Never** carries cost, margin, sell or line price — a type with no money field.
- `src/lib/quote-share/token.ts` — add `signShareTokenV2`, `parseShareToken` (v1 | v2), `verifyShareTokenV2`.
- `src/lib/quote-share/package-view.ts` — `packageState(q, pinnedRev, now)` → `ok | superseded{latestRev, sentAt} |
  revising | inactive`; `canAct(state)`.
- `src/lib/estimate-output/responses.ts` — `sanitizeClientResponse(input, revSections)`, `responseTaskTitle(...)`,
  `responseNoteText(...)`.
- `src/lib/estimate-output/opens.ts` — `nextOpens(prev, rev, now)`.

## 3. Phase 1 — scope record + survey goals

- Survey editor (`venue-assessments/[id]`): a **Client goals** textarea at the top of each discipline section
  ("What is the client trying to solve?"), saved through the existing survey save, offline outbox included.
- Estimator system header: **Discipline** select (blank / Lighting / Rigging / Curtains / AV).
- Narrative column (`aside.est-narr`): **Client goals** textarea + **From site visit ▾**; **Cover paragraph** textarea
  with the derived fallback as placeholder, a source chip (Override / From intro / From key product / Needs a
  paragraph), and **Use selection as cover** on the intro.
- Quote level (customer preview sidebar, a new **Cover & package** block): **Overall summary** textarea, **Not
  included** textarea + Reset to default.
- Settings → Estimating defaults: the shared Not included list (admin).
- Draft scope from survey copies goals (D-c).

## 4. Phase 2 — cover PDF

- `src/components/estimate-output/cover-document.tsx` — server component, pure props (`CoverDocumentProps` from
  `coverDocumentPropsFor(q, data, settings, signer, shareUrl)`), `font-family: Arial, Helvetica, sans-serif`,
  Letter portrait, 0.75in margins, Peak letterhead image (uploaded logo ?? `peak-letterhead.jpg`, same rule as
  QuoteDocument) and a footer (company name · address · phone · web from Settings → Branding/Locations, one line,
  every page via `position: fixed` print CSS).
- Order (brief §Prong 1): underlined centered title (quote name, else "Estimate Summary") → project block (customer,
  attn, venue, project, `EST-#### Rev N`, date) → one paragraph per scope with a bold right-aligned price line
  ("Lighting scope: $28,500.00") → overall summary → **Total: $X** → numbered add options with prices → Not included
  paragraph → link line ("View the full estimate online: <url>") → signature block (Lead estimator name, title,
  Peak Systems Group, phone, email; "Accepted by / Date" lines for the customer).
- Print route `/print/cover/[id]` verifies a `"cover"` print token (120 s), loads with `loadQuoteDocumentProps(q,
  { photos: "inline" })`'s data path (no revision — live) and renders `CoverDocument`.
- `/api/quotes/[id]/cover-pdf` → `renderPrintRouteToPdf` → `application/pdf` attachment
  `EST-1042 Cover.pdf`. Refuses non-system quotes.

## 5. Phase 3 — HTML snapshot page

- Share page `/share/quote/[id]/[token]` branches on token version: v1 → today's `OnlineEstimateView`, untouched;
  v2 → `PackageView`.
- `PackageView` (`src/components/estimate-output/package-view.tsx`, server component; only the scope checklist, the
  question form and the Narrative/BOM toggle are small client islands receiving **only** ids, names, prices and the
  action endpoints):
  1. Header: logo, customer, project, `EST-#### · Rev N · sent <date>`, **grand total**.
  2. Banner (superseded / revising / closed-lost).
  3. Overall summary.
  4. Per scope: number + name + **scope price**; "Your goals" (client goals, when present); the intro paragraphs; key
     products with photos (existing scoped photo route, re-keyed to the v2 token) and, under each, its datasheet link
     when one exists; then the **Narrative / BOM** toggle per page (`?view=bom`), BOM = `packageBomRows` table
     (Qty · Manufacturer · Part · Description).
  5. Plans & risers (Phase 4) — only when present.
  6. Add options (numbered, with prices) and Not included.
  7. Downloads (Phase 4).
  8. Client actions (Phase 5).
- Web layout: max-width 820px, 16px gutters on phones, Public Sans (the app font), print stylesheet so the page prints
  cleanly. `robots noindex`, `referrer no-referrer`, `force-dynamic`, rate limit unchanged.
- Staff Client link panel: Copy client link now copies the **v2** link for the latest sent rev; a list of earlier
  sent revs ("Rev 1 — superseded") with their opens; Revoke unchanged.

## 6. Phase 4 — media + attachments

- Photos: #293's scoped photo route, v2 path `/share/quote/[id]/[token]/photo/[docId]` (route code parses either
  token; the set is the pinned rev's key products).
- Datasheets: `/share/quote/[id]/[token]/doc/[docId]` serves one blob-backed `part_documents` file that
  `resolvePackageDocs(pinned rev skus)` includes (datasheet/specsheet only), `content-disposition: attachment`, nosniff,
  rate limit 120/min/IP.
- Zip: `/share/quote/[id]/[token]/package.zip` — streamed (mirror the rack submittal's streaming zip), datasheets +
  spec sheets + `Specifications.docx` from the client-package generator's spec builder, refactored so the docx
  builder is callable for a given spec without writing a client-package record. Rate limit 6/10 min/IP.
- Package files: Client link panel gains **Drawings**: list (kind, name, source, size, remove), **Upload…** (kind
  select), **Generate from Grid** (enabled when `gridProjectForQuote` finds one; disabled with a title otherwise).
  New signed print route `/print/grid-set/[id]` (token kind `"grid-set"`, id = `<projectId>~<optionId>`) rendering
  the drawing set body extracted from `design/grid/[id]/set/page.tsx` into a shared server component
  (`DrawingSetSheets`) used by both pages — the team page keeps its settings panel and PrintButton. Files served by
  `/share/quote/[id]/[token]/file/[fileId]` from the pinned rev's `docFields.packageFiles` (inline for PDF/images,
  nosniff, private cache).
- Staff gap chips in the Client link panel: "N parts without a datasheet", "No drawings", "M key products need a
  paragraph", "No client goals on K scopes".

## 7. Phase 5 — client actions

- **Choose your scopes**: a checkbox per scope (all checked by default), a live total of the checked scopes, name
  (required), title, email, note, **Submit selection**. Confirmation card after submit ("Thanks — Jeff Chesebro has
  been notified.") naming the Lead estimator.
- **Ask a question or request changes**: name, email, message, **Send**.
- Server actions `submitScopeSelection(id, token, input)` / `askQuestion(id, token, input)` in
  `src/app/share/quote/[id]/[token]/actions.ts`, D-m/D-n.
- Staff: Client link panel lists responses newest first (kind, rev, who, scopes, total, message, when); the quote's
  Activity / customer timeline shows the note; the Lead estimator gets a task (bell).

## 8. Phase 6 — tracking

D-o. Hub row chip + Client link panel line; lead drawer shows the same line when the quote has a lead.

## 9. Side task — printed sheets (outside the repo)

Revise the five Dropbox `.docx` site-visit sheets (`knowledge/peak/Peak-*-Site-Visit-Sheet.docx` + combined) with a
bordered "Client goals" box at the top of each discipline section (existing box style), bump their revision, and
write `knowledge/peak/site-visit-sheet-field-reconciliation-2026-10.md`: sheet field ↔ `survey-intake.ts` /
`surveys.ts` field, missing on either side.

## 10. Never on the client page

Cost, margin, tier, line/unit sell, `sellOverride`, internal notes, room, labor groups, vendor terms/notes,
owner email, other customers, datasheet gaps, response lists, opens, `shareLink`, `packageFiles` blob paths, any other
revision's content.

## 11. Tests

- Harness (`scripts/test-review-and-spec.ts`): scopes/cover-paragraph rules, Σ scope prices = total, discipline
  inference, bom rows have no money keys (`Object.keys` check), token v1/v2 parse/verify/domain separation/tamper,
  packageState matrix (ok/superseded/revising/lost/revoked/expired/v1), response sanitize + caps + section filter,
  opens dedupe, packageFiles snapshot in docFields, `update()` strips the new store-owned fields, survey goals
  sanitize, async: appendClientResponse writes note + task + no status change; refuses superseded.
- Smoke: `/print/cover` (token-less → 404/refusal), v2 share page card for a bad token, `/share/.../package.zip` bad
  token → 404.
- Browser on a scratch datadir: goals → draft scope → cover PDF; send → copy link → page; resend → old link banner;
  submit selection → task + note; revoke → inactive.

## 12. Back-compat and rollout

- No migration. Pre-#301 quotes print an unchanged estimate PDF (no new field prints there).
- Existing v1 links keep working exactly as #293.
- Preview deploys share the production DB: copy links from production only; a response submitted on a preview is a
  production write.
- Rollback: older code ignores the new JSONB fields; v2 links 404→"isn't active" card under old code (v2 token fails
  the v1 regex).

## 13. Open questions for Jeff (non-blocking)

1. Should Accept require a typed title/PO number?
2. Should the Lead estimator also get an email (Gmail bridge) on accept, beyond the bell task?
3. Starter paragraphs from Riverview/GET/AAC/Fall Creek — import as a follow-up item?
