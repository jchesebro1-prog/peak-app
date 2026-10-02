# Narrative-first client preview — key products, saved paragraphs, system library, client link (#293)

Date: 2026-10-01 · Punch #293 (renumber at merge if taken) · Owner approval: Jeff, 2026-10-01 · Builds on #281
(`2026-09-29-estimator-narrative-column-design.md`, D488).

Three independently shippable slices, built in order. D-numbers are assigned at docs time, recomputed from origin/main
right before writing DECISIONS.md.

---

## Goal

Today the Estimator's customer output is BOM-first. A system can print as a narrative (`presentation: "narrative"`),
but the narrative is one plain-text box per system (`SpecSection.narrative`, types.ts:204–239). It's rewritten on every
estimate, and it carries no product imagery.

This build makes the output **narrative-first**:

- **Key products.** The estimator marks the products that matter in each system.
- **Saved paragraphs.** Each key product prints a paragraph that was written once and reused, with the part's photo
  beside it, brochure style.
- **System intros.** A small library of reusable intro paragraphs opens each system.
- **System library.** It grows on its own from sent and won estimates. A past system can be loaded whole, or its
  narrative merged in.
- **Both versions.** The client can see the Narrative and the itemized BOM: as an appendix on the PDF, and as a
  Narrative / BOM toggle online.
- **Client link.** The client opens a page on their own, through the portal or a signed no-login link. Long term,
  this page is "the presentation of every estimate".

There is **no AI and no paid service anywhere in the quote path.** Text is written once and reused, never generated.
This supersedes an earlier "AI fills gaps" idea and matches D89, which keeps the app fully deterministic.

---

## Decisions (D-numbers assigned at docs time)

1. **No generation.** Every customer-facing word is typed by a person: an intro, a product paragraph, or quote text.
   Draft narrative only copies saved text. Nothing calls an external service.
2. **Key products are structured blocks on the section, not tokens in the text.**
   - They live in `SpecSection.keyProducts`, an ordered array.
   - `SpecSection.narrative` stays the system's intro and free prose, unchanged.
   - A quote without `keyProducts` prints exactly as it does today, so back-compat is exact.
3. **A block's anchor is the line's existing numeric id, scoped to its section.**
   - `SpecItem.id` is a per-estimate counter (`computeNid`, estimator-client.tsx:308–318; `nextId`, :485). It is not
     globally unique.
   - "Copy to existing" deliberately keeps item ids (`placeSystemInEstimate`, actions.ts:764–789), so an id is only
     unique **inside one section**. That is exactly where the block lives.
   - A block stores `lineKey = String(item.id)` plus the `sku` it was marked on. It resolves only when **both** match.
     Every path that re-mints ids remaps the blocks (§3.4).
   - No new id field is minted on `SpecItem`. That would touch every add flow (≈15 `nextId()` call sites) for no gain.
4. **A product paragraph is a field on the catalog part, written only through `mergeUpsert`.** It is not a separate
   collection. See §3.2 for the justification.
5. **System intros are one settings blob, `narrative_intros`, with stable ids.** It uses the `portal_departments` /
   `gridDeviceTypes` idiom (stores/portal-departments.ts:1–20). There is no table and no migration.
6. **Editing a quote never writes the library.**
   - **Save to library** on a key-product block is the only path from a quote into a part's paragraph. It is explicit
     and confirmed when it would replace existing text.
   - **Save as intro** is the only path into the intro library.
   - Neither is ever automatic.
7. **Key products print only in Narrative presentation.** This is D488's rule, extended. An itemized system keeps its
   blocks but doesn't print them, and the editor says so.
8. **The photo is the part's primary image:** `visibleImagesForParts([sku]).get(sku)?.[0]`
   (stores/part-documents.ts:288).
   - That order already puts a datasheet-render thumbnail after every real image (part-docs/types.ts:156–169). So
     `[0]` is the first real, visible image, or a datasheet thumbnail when the part has nothing else. This is the same
     image the portal tile shows (#290 Make primary).
   - Each block has its own photo on/off. No photo means the paragraph prints full width.
9. **The PDF embeds photos as server-side data URIs.** The browser pages use scoped image routes.
   - The print route has no session, and `/api/part-documents/[id]` requires one (route.ts:13).
   - Data URIs make the headless render self-contained: no second authenticated fetch, and no token in an `<img>` URL.
   - The web pages can't carry megabytes of base64 per view, so they stream through two small routes. Each serves
     only the photo ids that the quote's own latest sent revision prints (§6.4).
10. **New Show-on-PDF toggle: "Itemized appendix"** (`pdfItemizedAppendix`, default **off**).
    - When on, the full BOM of every system the body didn't itemize is printed after the signature block, on a new
      page.
    - Older quotes, where the key is absent, normalize to off and print as before.
11. **The system library is computed, never curated.**
    - **What's indexed:** every system on a quote whose status is `sent` or `won`, read from that quote's **latest
      sent revision** (`latestSentRevision`, quote-pdf/state.ts:129). Drafts and post-send edits never leak in.
    - **Fallback:** a won quote with no sent revision (won straight from draft) uses its live spec, because its won
      status is the final mark.
    - **Ranking:** won before sent, then newest first.
    - **Never indexed:** lost quotes, `source: "daylite"` history and non-system quote types.
12. **Load system reuses Copy system (#266).**
    - It re-prices at today's catalog and the current estimate's tier through `copySectionForTarget`
      (copy-system.ts:91).
    - It carries the narrative, the presentation and the key products, with ids remapped.
    - Vendor-quote lines are **left out** with a notice. Their records hold job-specific files and terms that don't
      belong on another job, and their attachments count against the per-estimate 820 kB budget (types.ts,
      `VENDOR_ATTACHMENT_BUDGET`).
13. **Merge narrative appends only.**
    - Intro text is appended after a blank line, unless the same text is already present.
    - A key-product block is added only when its sku is not already a key product here **and** this system has a line
      with that sku to anchor it.
    - Blocks with no line are listed and skipped, never invented. A block can't exist without a line (decision 3), and
      adding a priced line silently would change the estimate.
14. **The client link is signed, no-login and read-only, with a 60-day default expiry and Revoke.**
    - The signature is an HMAC over a per-quote nonce stored on the quote.
    - Revoke rotates the nonce, so every earlier link dies at once.
    - It shows the **latest sent revision only**. A never-sent quote has no link, and the button is disabled.
    - Creating or revoking a link requires the `send` permission, because a public link is a form of sending.
15. **One document, three surfaces.** The PDF print route, the portal estimate page and the share page all render
    `QuoteDocument` from one loader, so they can't drift. The Narrative / BOM toggle is a view transform on the same
    props, not a second renderer.
16. **A lost quote's link and portal page still open, marked "This estimate is closed."** A quote recalled to draft
    after sending shows "This estimate is being revised — your Peak rep will send the updated version", with no
    content. It never shows the old revision while staff are mid-edit, mirroring `portalListsQuote` (quotes.ts:471),
    which hides drafts.

---

## Slices at a glance

| Slice | Ships | Done when |
|---|---|---|
| **1** | Key products, product paragraphs, system intros, Draft narrative, photo-beside-paragraph printing, Itemized appendix | §8.1 |
| **2** | System library, Load system, Merge narrative | §8.2 |
| **3** | Portal HTML estimate page, signed share link, Narrative / BOM toggle | §8.3 |

Each slice gets its own branch, task reviews, a final review, the four gates (tsc, test:specs, test:smoke, eslint vs a
baseline), `next build`, merge to main, and a deploy, in order 1 → 2 → 3.

---

## 1. Data model

There is no migration in any slice. Everything is JSONB on existing documents or one settings blob.

### 1.1 Key products on the section (Slice 1)

`src/app/(app)/estimator/types.ts`. These are additive optional fields; `SpecSection` is persisted verbatim on
`quote.spec` (types.ts:16–21).

```ts
/** #293: a product the customer narrative features — its paragraph prints
 *  (Narrative presentation only) with the part's photo floated beside it. */
export type KeyProduct = {
  /** String(SpecItem.id) of a line in THIS section (ids are unique per section only). */
  lineKey: string;
  /** The line's sku when marked — resolution requires it to still match. */
  sku: string;
  /** The paragraph as it prints: plain text, narrativeBlocks() rules (D488). */
  text: string;
  /** Print the part's primary photo beside the paragraph. */
  photo: boolean;
};

export type SpecSection = {
  // …existing fields unchanged…
  /** #293: ordered; at most one block per lineKey and per sku. */
  keyProducts?: KeyProduct[];
};
```

**Limits** live in `narrative.ts`:

- `MAX_KEY_PRODUCTS = 20` per system;
- `MAX_PARAGRAPH = 4000` characters per block;
- `MAX_INTRO = 8000` characters for an intro (library or narrative).

Server-action bodies are capped at 1200 kB (next.config.ts). Twenty 4 kB blocks per system is far below that.

**Eligible line:**

- `sku` is non-empty;
- and the line is none of: `labor`, `laborOverhead`, `laborTravel`, `rewardCredit`, `option`.

Option lines print in Optional additions (quote-document.tsx:564), so featuring one would describe an item that isn't
in the total. Custom, curtain, fixture, track, allowance-with-sku and vendor-quote lines are eligible. Only a catalog
sku can **Save to library** or have a photo (§3.2).

### 1.2 Product paragraph on the catalog part (Slice 1)

`src/lib/stores/catalog.ts`, `CatalogPart`, additive:

```ts
/** #293: the part's write-once customer paragraph (plain text, D488 rules).
 *  Written only through mergeUpsert by saveProductParagraph — no importer,
 *  enricher or price-book patch carries these keys, so imports never clear it. */
narrativeText?: string;
narrativeUpdatedAt?: number;
narrativeUpdatedBy?: string;
```

**Why a field on the part, not a collection:**

- **Keyed by the same natural key.** The paragraph is keyed by sku, exactly like the part (`id === sku`,
  catalog.ts:63–66). It lives and dies with the part: a soft-deleted part takes its paragraph out of use, which is
  correct.
- **Precedent.** It follows the Specs module's canonical text fields (`specTitle`/`specBody`/`specState`,
  catalog.ts:155–185, D258). Those are the same kind of per-part, human-authored prose, also written only through
  `mergeUpsert`.
- **Survives imports.** `mergeUpsert` (catalog.ts:286) keeps every key the patch doesn't name, and every production
  writer uses it. The only bare `upsert` callers are test scripts. So a price-book import never touches the paragraph.
- **No extra store.** A collection would add a second store, a second soft-delete rule and an orphan problem (a
  paragraph for a sku that no longer exists) for no capability the field lacks.

**Accepted side effects:**

- `writePart` stamps `updatedAt` on every write (catalog.ts:242–253), so a paragraph save moves the part's
  `updatedAt` the way a spec-text save already does. `pricedAt` is untouched, because the price didn't change.
- `clearCatalogPriceList()` (catalog.ts:310) and the go-live demo wipe would remove paragraphs along with parts.
  That's noted under Rollout.

This is distinct from `specBody`. That field is CSI Part 2 spec language for the Specs builder. A narrative paragraph
is sales prose. They are separate fields with separate editors.

### 1.3 System-intro library (Slice 1)

There's a new settings blob, `narrative_intros`, holding `{ intros: SystemIntro[] }`. Store:
`src/lib/stores/narrative-intros.ts`. Pure half: `src/lib/narrative/intros.ts`.

```ts
export type SystemIntro = {
  id: string;          // "NI-" + 8 base36 chars, server-minted, stable
  title: string;       // ≤ 120 chars, trimmed, unique case-insensitively
  text: string;        // ≤ MAX_INTRO chars, plain text (D488 rules)
  updatedAt: number;
  updatedBy: string;
};
```

- **One operation per write**, not full-list replacement: `upsertIntro` and `deleteIntro`. Each one reads the blob,
  applies a pure `applyIntroOp`, and writes it back. This keeps two editors from clobbering each other's unrelated
  intros.
- **Cap:** 200 intros.
- **Order:** sorted by title for display.

### 1.4 Itemized appendix toggle (Slice 1)

`src/lib/quote-pdf/pdf-options.ts`:

- `QuotePdfOptions` gains `pdfItemizedAppendix: boolean`.
- `PDF_TOGGLE_KEYS` (pdf-options.ts:17) gains it.
- `DEFAULT_PDF_OPTIONS.pdfItemizedAppendix = false`.
- `normalizePdfOptions` already copies only boolean toggle keys, so an absent key reads `false`.
- `pdfOptions` is a `QUOTE_CONTENT_FIELDS` member (quotes.ts:314–339), so flipping the toggle re-renders the PDF
  through the existing save path.
- `PdfToggle` in preview-doc.tsx:58 gains the key too.

### 1.5 Revision document fields (Slice 3)

`QuoteRevision` (quotes.ts:366–399) snapshots the priced payload (`spec`, `vendorQuotes`, `name`, `value`). It does
**not** snapshot the header fields that `QuoteDocument` prints. Rendering a sent revision as HTML therefore needs them
frozen too. `snapshotOf` (quotes.ts:697) gains an annex on **every** new revision:

```ts
/** #293: the non-payload fields the customer document prints, frozen with the
 *  snapshot so the online page shows the version that was sent. */
docFields?: {
  customer: string; locationId: string | null; contactName: string; quoteNote: string;
  assumptions: string; installTimeframe: string; preparedBy: string; owner: string;
  termsText: string; paymentTerms: string | null; pdfOptions: QuotePdfOptions | null;
  portalFirm: Quote["portalFirm"] | null; source: string;
};
```

- It's built by a pure `revisionDocFields(doc)` next to `snapshotOf`.
- Revision **recall** ignores it. Recall behavior is unchanged.
- **Older revisions without it** fall back to the live quote's header fields (§6.1). Every one of those fields is
  customer-facing, so the fallback is a fidelity approximation, never a leak. Such quotes still offer the exact sent
  PDF.

### 1.6 Share link on the quote (Slice 3)

`Quote` gains:

```ts
/** #293: the client share link. Server-written only; never in QUOTE_CONTENT_FIELDS,
 *  never snapshotted, never copied by buildQuote (quotes.ts:608). */
shareLink?: {
  nonce: string;        // 32 random bytes, base64url — rotated on revoke
  expiresAt: number;    // epoch ms; 0 = revoked/none
  createdAt: number;
  createdBy: string;
  revokedAt?: number | null;
  revokedBy?: string | null;
} | null;
```

Browsers get a view only: `{ active, url, expiresAt, createdAt, createdBy }`. They never get the nonce.

---

## 2. Pure modules

All of these are pure (no I/O, no React) so the harness imports them.

### 2.1 `src/app/(app)/estimator/narrative.ts` (extend the #281 module)

```ts
export const MAX_KEY_PRODUCTS = 20;
export const MAX_PARAGRAPH = 4000;
export const MAX_INTRO = 8000;

export function isKeyProductEligible(it: SpecItem): boolean;

export type KeyProductResolution =
  | { kp: KeyProduct; status: "ok"; item: SpecItem }
  | { kp: KeyProduct; status: "missing" }      // no line with that id
  | { kp: KeyProduct; status: "changed"; item: SpecItem }  // id found, sku differs
  | { kp: KeyProduct; status: "ineligible"; item: SpecItem }; // now an option/labor line
export function resolveKeyProducts(sec: SpecSection): KeyProductResolution[];

/** Shape-clean for save: drop malformed rows and unknown keys, trim, cap counts
 *  and lengths, dedupe by lineKey then sku (first wins). Does NOT drop
 *  unresolved blocks — the editor shows them flagged until removed. */
export function sanitizeKeyProducts(raw: unknown): KeyProduct[];

/** Re-anchor after a re-id (same-estimate Copy, Load system). Blocks whose old id
 *  isn't in the map are dropped. */
export function remapKeyProducts(kps: KeyProduct[] | undefined, idMap: ReadonlyMap<number, number>): KeyProduct[] | undefined;

export type LibraryInfo = { inCatalog: boolean; desc: string; paragraph: string | null };
/** Draft narrative: the chosen intro + each block's library paragraph (else the
 *  catalog description as starting text). mode "replace" overwrites; "blanks"
 *  fills only an empty narrative / empty block text. Returns which skus still
 *  need a paragraph (no library text). */
export function draftNarrative(
  sec: SpecSection,
  intro: string | null,
  library: ReadonlyMap<string, LibraryInfo>,
  mode: "replace" | "blanks"
): { section: SpecSection; needsParagraph: string[]; changed: boolean };

/** What prints for a narrative system: resolved "ok" blocks in order, text split
 *  by narrativeBlocks, the line's customer description as the heading. */
export function printableKeyProducts(sec: SpecSection): Array<{ sku: string; heading: string; blocks: NarrativeBlock[]; photo: boolean }>;
```

`printableKeyProducts` details:

- **Heading:** the line's `desc`, with the same allowance prefix rule quote-document.tsx:176–180 uses. This is text the
  itemized view already prints, so nothing new is exposed.
- **Empty text:** a block with empty `text` prints its heading (and photo) only.

### 2.2 `src/lib/narrative/intros.ts`

Pure: `sanitizeIntro(input) → { ok, value } | { ok: false, error }`,
`applyIntroOp(list, op: { kind: "upsert"; intro } | { kind: "delete"; id }, now, by) → SystemIntro[] | error`, and
`newIntroId()` (the id is minted by the store, which passes a random source in).

### 2.3 `src/app/(app)/estimator/quote-document.tsx` helpers (exported, pure)

- **`appendixSystemIds(sections, detail) → string[]`:** systems whose lines the body didn't itemize. That means
  `presentation === "narrative"`, or every system when `detail === "sectioned"`. It skips systems the body already
  filters out (no revenue).
- **`bomViewProps(p: QuoteDocumentProps) → QuoteDocumentProps`** (Slice 3):
  - every section becomes `presentation: "itemized"`, with `detail: "itemized"`;
  - `pdfQty: true`, `pdfNotes: true`, `pdfItemizedAppendix: false`;
  - `pdfPrices` keeps the quote's own choice. An estimator who hid prices still hides them in the BOM.

### 2.4 `src/lib/narrative/system-library.ts` (Slice 2)

```ts
export type SystemLibraryEntry = {
  key: string;            // `${quoteId}:${rev|"live"}:${sectionId}`
  quoteId: string; estNumber: string; quoteName: string; customer: string;
  status: "won" | "sent"; at: number;    // sent revision's `at`; won-without-send: updatedAt
  rev: number | null;
  sectionId: string; systemName: string;
  intro: string;          // the section's narrative
  keyProducts: KeyProduct[];
  lineCount: number; skus: string[]; descs: string[];
  presentation: "itemized" | "narrative";
};
export function systemLibraryEntries(quotes: Quote[], customerNames: ReadonlyMap<string, string>): SystemLibraryEntry[];
export function searchSystemLibrary(entries: SystemLibraryEntry[], query: string, opts?: { hasNarrative?: boolean; limit?: number }): SystemLibraryEntry[];
```

**Entry source rules, in order:**

- **Skip the quote** when any of these holds:
  - `source === "daylite"` (`isImportedHistoryQuote`, quotes.ts);
  - `quoteType` is not `system` or absent;
  - status is not `sent` or `won`.
- **Pick the spec:**
  - the latest sent revision's `spec` when there is one;
  - otherwise, only for `won`, the live `spec`;
  - otherwise skip.
- **Skip systems** with no items (after `withoutRewardCredit`) and labor-kind sections.

**Search and ranking:**

- **Matching:** the query is split on whitespace. Every token must match, case-insensitively, in at least one of:
  `systemName`, `customer`, `quoteName`, `estNumber`, any `sku` or any `desc`.
- **Ranking:**
  1. won before sent;
  2. `at` descending;
  3. a `systemName` match before a match only in lines.
- **Limit:** 50 by default.
- **`hasNarrative`:** keeps entries with intro text or key products.

### 2.5 `src/lib/narrative/merge.ts` (Slice 2)

```ts
export function mergeNarrative(
  target: SpecSection,
  sources: Array<Pick<SystemLibraryEntry, "intro" | "keyProducts" | "systemName">>,
  opts: { intro: boolean; products: boolean }
): {
  section: SpecSection;
  introsAppended: number;
  productsAdded: number;
  skippedPresent: string[];   // sku already a key product here
  skippedNoLine: string[];    // no eligible, unmarked line with that sku here
};
```

- **Intro:** each source's trimmed intro is appended as `"\n\n" + text`. It's skipped when empty, or when
  `target.narrative` already contains it, compared after whitespace normalization.
- **Products, per source block in order:**
  1. If the sku is already a key product here, record it in `skippedPresent`.
  2. Otherwise anchor it to the first eligible line in `target` with that sku that has no block yet, carrying `text`
     and `photo`.
  3. If no such line exists, record it in `skippedNoLine`.
- **Cap:** stops at `MAX_KEY_PRODUCTS`, and the overflow is reported in `skippedNoLine`.

### 2.6 `src/lib/quote-share/token.ts` (Slice 3; server-only, `node:crypto`)

This is modeled on `src/lib/quote-pdf/token.ts`, with domain separation (`share:` vs `print:`) and a different TTL.

```ts
export const SHARE_DEFAULT_TTL_MS = 60 * 86_400_000;   // 60 days
export const SHARE_MAX_TTL_MS = 366 * 86_400_000;
export function newShareNonce(): string;               // randomBytes(32).toString("base64url")
export function signShareToken(secret: string, quoteId: string, nonce: string, exp: number): string;
//   `${exp}.${base64url(HMAC-SHA256(secret, "share:quote:" + quoteId + ":" + nonce + ":" + exp))}`
export function verifyShareToken(
  secret: string, token: string, quoteId: string,
  stored: { nonce: string; expiresAt: number } | null | undefined, nowMs: number
): boolean;
```

`verifyShareToken` fails closed on any of these:

- no secret or stored link;
- `stored.expiresAt <= 0`, meaning revoked;
- a token not matching `/^(\d{1,15})\.([A-Za-z0-9_-]{43})$/`;
- `exp !== stored.expiresAt`;
- `now > exp`;
- `exp − now > SHARE_MAX_TTL_MS`;
- a non-finite clock;
- a MAC mismatch, compared with `timingSafeEqual`.

The secret is `AUTH_SECRET`, as for the print token (print/quote/[id]/page.tsx:19). Rotating `AUTH_SECRET` kills every
link, which is the documented consequence.

### 2.7 `src/lib/quote-share/view.ts` (Slice 3, pure)

```ts
export type OnlineEstimateState =
  | { kind: "ok"; rev: QuoteRevision; closed: boolean }  // closed = status lost
  | { kind: "revising" }                                  // status draft, a sent revision exists
  | { kind: "unavailable" };                              // never sent / not a system quote / deleted
export function onlineEstimateState(q: Quote): OnlineEstimateState;
export function shareLinkView(q: Pick<Quote, "id" | "shareLink">, origin: string, secret: string, now: number): ShareLinkView;
```

`onlineEstimateState` is the one rule both web pages use. `kind: "ok"` requires all of these:

- `pdfKindForQuoteType(q.quoteType) === "quote"`. Service quotes print letters (`/print/letter/...`) and stay
  PDF-only.
- a latest sent revision exists;
- status is `sent`, `won` or `lost`.

---

## 3. Slice 1 — key products, paragraphs, intros, Draft narrative, printing

### 3.1 Marking key products

- **Line row (section-card.tsx, beside ↑ ↓ ✕ at :1307–1313):**
  - **What:** a ★ toggle on every eligible line.
  - **Look:** filled when the line is a key product, and its title says "Key product — featured in the narrative".
  - **Toggling on:** appends a block `{ lineKey: String(it.id), sku: it.sku, text: <library paragraph if loaded,
    else "">, photo: true }`.
  - **Toggling off:** removes the block.
  - **At the cap:** the star is disabled at `MAX_KEY_PRODUCTS`, with a title explaining why.
  - **Ineligible lines:** no star.
- **New prop:** `onToggleKeyProduct(itemId)`. The section state change goes through the existing `setSections` (so the
  #254 banner rule holds, estimator-client.tsx:470–477).

### 3.2 The narrative column (extends #281's `aside.est-narr`, estimator-client.tsx:3819–3925)

Below the existing presentation select and hint, top to bottom:

1. **System intro row:**
   - a `<select>` of intros (title), with a "— none —" option;
   - **Draft narrative**;
   - a ⋯ menu with **Save as intro…** (opens a title prompt and saves the current `narrative` text as a new intro) and
     **Manage intros…** (a modal listing intros with edit and delete).
   - Both menu items require `create`. Without it they show disabled with a "Needs the Create permission" title.
2. **The existing narrative textarea,** relabelled "Intro" with its #281 hint. Its min height shrinks to ~140px when
   the system has key products, so the blocks get room. The column scrolls.
3. **Key products** — one card per block, in order:
   - **Head:** the line's description and sku (mono).
   - **Library-status chip:**
     - **Needs a paragraph** (amber) — a catalog part with no saved paragraph;
     - **From library** — the text equals the saved paragraph;
     - **Edited** — it differs;
     - **Not in catalog** (grey) — a custom sku. Save to library is unavailable.
   - **Photo:** a thumbnail served by the team route `/api/part-documents/<docId>`, with a **Photo** on/off switch. A
     part with no image reads "No photo — prints full width".
   - **Text:** a textarea bound to `kp.text`, with the same D488 plain-text rules. An empty block shows the catalog
     description as a greyed `placeholder`.
   - **Actions:** ↑ ↓, **Save to library**, **Use library text** (shown only when Edited), and **Remove**.
   - **Unresolved blocks:**
     - Status `missing`: a red strip reads "Line removed — this block won't print" with Remove.
     - Status `changed`: "Line changed to <sku> — this block won't print" with **Re-anchor**. That sets `sku` to the
       line's current sku and keeps the text.
     - Status `ineligible`: "Optional/labor line — won't print".
4. **+ Key product:** a picker listing the system's eligible, unmarked lines. It's the same as the star.

When the system is Itemized, the existing hint "Prints on the quote only in Narrative mode." covers the blocks too
(decision 7).

**Library data for the column:** `keyProductLibraryAction(skus: string[])`. It requires `requireUser()` and caps at 200
skus. It returns, per sku:

```
{ inCatalog, desc, paragraph: string | null, paragraphUpdatedAt, paragraphUpdatedBy, photoDocId: string | null }
```

- It reads `catalog.getMany` and `visibleImagesForParts`.
- It's fetched when the active system's set of key-product skus changes, and cached per sku in client state.
- The full catalog is never shipped to the client. The page only loads it server-side today (estimator/page.tsx:285).

### 3.3 Draft narrative

**What it does:**

1. Runs `draftNarrative(sec, chosenIntro?.text ?? null, library, mode)` (§2.1).
2. When something already written would change, it first asks: **Replace what's written** / **Fill blanks only** /
   **Cancel**.
3. It also switches the system to Narrative presentation when it was Itemized. Drafting a narrative is the explicit
   act of choosing one. The column notes "Switched to Narrative".
4. If any skus still need a paragraph, it reports "N products still need a paragraph".

**Text on the quote:** everything Draft writes is copied onto the quote. Later library edits never change an existing
quote. That keeps the sent document reproducible (revisions snapshot `spec`).

### 3.4 Library writes and copies

- **`saveProductParagraphAction(sku, text, expectUpdatedAt?)`:**
  - **Access:** `requirePerm("create")`.
  - **Refuses:**
    - text after trim that is empty or over `MAX_PARAGRAPH`;
    - a sku not in the catalog (`catalog.get` null or soft-deleted);
    - `expectUpdatedAt` that doesn't equal the part's `narrativeUpdatedAt`. The client then re-asks "The library
      paragraph changed since you loaded it — replace it anyway?".
  - **Write:** `mergeUpsert(sku, { narrativeText, narrativeUpdatedAt: now, narrativeUpdatedBy: user.name })`.
  - **Confirm first:** the client asks **"Replace the library paragraph for <sku>?"** whenever the part already has
    different text.
- **`upsertSystemIntroAction(input)` and `deleteSystemIntroAction(id)`:** `requirePerm("create")`, through the
  store's single-op writes (§1.3).
- **Catalog part editor:** a **Narrative paragraph** textarea in the part editor's existing spec area. It uses the
  same action and is visible to `create`, matching the Spec panel's audience (#205). This gives the paragraph a home
  outside any quote.
- **Saving the quote:** `saveQuoteAction` (actions.ts:356) runs `sanitizeKeyProducts` on every posted section, beside
  `sanitizeSystemSell`. The stored shape is therefore server-clean whatever the client posts.
- **Re-id paths** must call `remapKeyProducts` with the old→new id map:
  - same-estimate **Copy system** (estimator-client.tsx:1660–1665, which mints new item ids);
  - **Load system** (§4.2).
- **Paths that carry blocks as-is,** because they keep ids:
  - Move and Copy to another estimate (`placeSystemInEstimate`);
  - revision recall;
  - tier re-price;
  - `withRewardCredit`.
  These spread the section, so no change is needed. A harness check pins each.

### 3.5 Printing (QuoteDocument)

`quote-document.tsx`. This is the one component behind the PDF (print route) and, in Slice 3, the web pages.

- **Props:**
  - `pdfItemizedAppendix: boolean`, from the `normalizePdfOptions` spread in `quoteDocumentDataFor`;
  - `keyProductPhotos?: Record<string, { src: string; alt: string }>`, keyed by sku and filled by the caller;
  - `layout?: "sheet" | "web"`, used in Slice 3.
- **`previewSections`** (quote-document.tsx:124) gains `keyProducts: printableKeyProducts(sec)`, so the photo
  lookup happens at render.
- **Narrative branch** (quote-document.tsx:426–445):
  1. Renders the intro blocks as today.
  2. Then renders each key product as `<div className="est-kp">`:
     - an `<img>` floated **right** (34% width, max-height 2.4in, `object-fit: contain`, margin 0 0 8px 14px), when
       `photo` is on and a src exists;
     - a bold heading;
     - the paragraph blocks;
     - a clearfix (`display: flow-root`).
  3. If there's no intro **and** no printable key product, it prints today's fallback sentence. If key products exist,
     the fallback doesn't print.
- **Print CSS** (`QUOTE_PRINT_CSS`, quote-document.tsx:79–86) gains:

  ```
  .est-doc .est-kp { break-inside: avoid; page-break-inside: avoid; }
  .est-doc .est-appendix { break-before: page; page-break-before: always; }
  ```

  A block taller than a page is allowed to break. `break-inside: avoid` is advisory in Chrome.
- **Itemized lines component:** the itemized-lines markup (quote-document.tsx:446–545) moves into an internal
  `ItemizedLines` function component, used by the body and by the appendix, so the two can't drift.
- **Appendix:**
  - **When:** `p.pdfItemizedAppendix && appendixSystemIds(...).length > 0`.
  - **Where:** after the acceptance/signature block, before the footer.
  - **Content:**
    - a heading **"Appendix — Itemized bill of materials"**;
    - for each listed system, its section band (number, name, subtotal) and `ItemizedLines`;
    - descriptions always shown, with quantities and prices per their own toggles;
    - the freight row as in the body.
  - **Totals:** unchanged. The appendix restates; it doesn't add.
- **Preview sidebar** (preview-doc.tsx:162–170): a toggle button **"Itemized appendix"** after Options. Its title reads
  "Print every narrative system's full line list after the signature".

### 3.6 Photos in the PDF (print route)

There's a new server helper, `src/lib/narrative/photos.ts`:

```ts
/** sku → primary visible image doc (visibleImagesForParts()[sku][0]). */
export async function keyProductPhotoDocs(sections: SpecSection[]): Promise<Map<string, PartDocument>>;
/** Same, read and inlined: data:<type>;base64,… for the print route. */
export async function keyProductPhotoDataUris(sections: SpecSection[]): Promise<Record<string, { src: string; alt: string }>>;
```

- **Which skus:** only narrative-presentation systems' printable blocks with `photo: true`.
- **Content types:** `image/png`, `image/jpeg` and `image/webp` only. That's the same allowlist as the portal doc
  route (portal/catalog/doc/[id]/route.ts:18). SVG is never inlined.
- **Reads:** `getBlobStream(blobKey)`, collected, with at most 6 concurrent reads.
- **Size caps:**
  - each image ≤ 3 MB, otherwise it's skipped;
  - the total for one document ≤ 15 MB, after which later photos are skipped.
  - Images stored since #283 are ≤1600 px WebP (part-docs/shrink.ts:11), typically a few hundred kB.
- **Failure:** any failure on a photo means no photo (full-width paragraph) plus a `console.warn`. A photo **never**
  fails the render.
- **Wiring:** `print/quote/[id]/page.tsx` calls it after its existing loads and passes `keyProductPhotos`. There's no
  new network fetch in headless Chrome, because the images are in the HTML. The renderer waits on `load`
  (quote-pdf/render.ts:137), which covers data URIs.

**Known limit:** photos resolve from the live catalog at render time. A PDF already stamped on a sent revision is frozen
(that's the #222 rule). The online page (Slice 3) shows the part's current primary photo, which can differ if someone
later changes it. Paragraph **text** is never live: it's on the quote.

---

## 4. Slice 2 — system library, Load system, Merge narrative

### 4.1 Index and search

- **Server:** `src/lib/narrative/system-library-index.ts`.
  - Builds `systemLibraryEntries(getAll(), customerNames)`.
  - Caches it per process with a 5-minute TTL. That's the `portalIndex` idiom (portal-catalog-index.ts:113–131), with
    `invalidateSystemLibrary()` called from `setStatus` after a send or won transition.
  - Stale-by-up-to-5-minutes is acceptable for a reference library.
- **Action:** `searchSystemLibraryAction(query, opts)`.
  - **Access:** `requireUser()`, like `searchQuotesAction` (actions.ts:672).
  - **Returns** entries without `keyProducts` text bodies. It sends counts plus the first 140 characters of the intro
    and of each block, for the list.
  - `getSystemLibraryEntryAction(key)` returns one full entry for the Merge preview.

### 4.2 Estimator UI

The left Systems rail gains **+ From library…** next to + Add system. The card's ⋯ menu gains **Merge narrative from
library…**.

**The library modal** is shared:

- **Controls:** a search box and a **Has narrative** chip.
- **Rows:** system name, then `customer · EST-#### · Won|Sent · date`, then `N lines · M key products`, then the
  intro's first line.
- **Detail pane:** the selected row shows the full intro and the key-product headings.

**Load system:**

- **Action:** `loadLibrarySystemAction(key, ctx: { tierMargin })`, `requireUser()`.
- **Loading:** it re-reads the source quote server-side and picks the same snapshot as the index. Client-supplied
  section data is never trusted.
- **Vendor lines:** it drops vendor-quote lines and counts them.
- **Pricing:** it re-prices through a helper factored out of `copySystemToEstimateAction` (actions.ts:896–1000) — the
  catalog and fixture loading plus `copySectionForTarget`, with:
  - the source tier = the revision's `tierMargin`;
  - the target tier = the current estimate's.
- **Result:** the section, plus `{ costsUpdated, tierRepriced, vendorLinesDropped }`.
- **Client side:**
  - gives the section a new `"sys" + nextId()` id;
  - re-ids every item;
  - remaps `keyProducts`;
  - keeps the system name;
  - appends it after the active system;
  - selects it.
- **Notice:** "Loaded <name> from EST-#### · 3 parts updated to today's cost · 1 vendor-quote line left out".

**Merge narrative:**

- **Selection:** pick one or more rows, then tick **Intro** and/or **Key products** (both on by default). A preview
  shows what will be appended and what will be skipped, from `mergeNarrative` run client-side on the full entries.
- **Apply:** writes through `setSections`.
- **Notice:** "Added intro from 2 systems · 4 key products · skipped 2 already featured · 3 not on this system (add
  the part first): SKU, SKU, SKU".

---

## 5. Slice 3 — client link and online estimate

### 5.1 One loader for all three surfaces

There's a new `src/lib/quote-pdf/document-loader.ts` (server):

```ts
export async function loadQuoteDocumentProps(
  q: Quote,
  opts: { revision?: QuoteRevision; photos: "inline" | { routeBase: string } }
): Promise<QuoteDocumentProps>;
```

- **Revision fields:** with `revision`, it builds the document from
  `{ ...q, ...(revision.docFields ?? {}), name, spec, vendorQuotes, value, updatedAt: revision.at,
  revisions: q.revisions.slice(0, idx + 1) }`.
- **Mapping:** it then goes through the existing pure `quoteDocumentDataFor` (quote-document-data.ts:61). The mapping
  stays single, and the revision number and date read the sent revision's.
- **Shared loads:** customer, settings and `purchasePerksForCompany`, exactly as the print route does
  (print/quote/[id]/page.tsx:39–45).
- **Photos:** `"inline"` gives data URIs (§3.6). `routeBase` gives `${routeBase}/<docId>` URLs.

`print/quote/[id]/page.tsx` switches to this loader with `photos: "inline"` and no revision. It keeps rendering the
live quote, which is today's behavior.

### 5.2 Portal estimate page — `/portal/quotes/[id]`

- **File:** `src/app/portal/quotes/[id]/page.tsx`, a sibling of the existing `pdf/route.ts`.
- **Viewer:** `resolvePortalViewer(?preview)` (portal-viewer.ts). Middleware already exempts `/portal`.
- **Access:** the quote must pass `portalListsQuote(q, session.customerId)`. Then `onlineEstimateState(q)` decides.
- **`ok`:**
  - **Chrome:** the portal shell, a header row with ← Back, `EST-#### · Rev N · sent <date>`, the **Narrative / BOM**
    segmented control, and **Download PDF**. The PDF link is the existing route, shown only when
    `portalQuotePdfSource` is non-null.
  - **Document:** `QuoteDocument` with `layout="web"`.
  - **Closed:** an amber "This estimate is closed." banner when the quote is lost.
- **`revising`:** the "being revised" card.
- **Anything else** (unknown, another customer's, never sent, service type): the same 200 card, "This estimate isn't
  available online," plus the PDF link if one exists. Nothing hints whether the quote exists. A 200 is used (not a
  404) so smoke can cover it, as `/portal/catalog?part=no-such-part` does.
- **The toggle** is two plain links, `?view=narrative` (the default) and `?view=bom`. `bomViewProps` is applied
  server-side. There's no client component and no client-side quote data.
  - The toggle appears only when at least one printed system is Narrative. Otherwise the document already is the BOM.
- **Portal rows** (`src/app/portal/quote-row.tsx:134–175`): the title links to `/portal/quotes/<id>` (keeping
  `?preview`) when `onlineEstimateState(q).kind` is `ok` or `revising`. Otherwise it keeps today's PDF link. The
  explicit **PDF** link stays either way.

### 5.3 Share page — `/share/quote/[id]/[token]`

- **Files:** `src/app/share/quote/[id]/[token]/page.tsx`, outside the `(app)` group, so there's no team layout or nav.
  It has its own minimal `layout.tsx`. The root layout already sets fonts and `--accent`.
- **Middleware:** the matcher (middleware.ts:29) adds `share/` to its exemption list, beside `portal` and `print/`.
  The doc comment above it gains a sentence naming the route and its self-check.
- **Order of checks, before any read beyond the quote:**
  1. Rate limit: `rateLimit("share-view:" + ip, 60, 60_000)`. On failure, a 429 "Too many requests" page.
  2. `get(id)`, then `verifyShareToken(AUTH_SECRET, token, id, q.shareLink, Date.now())`.
  3. `onlineEstimateState(q)`.
- **Results:**
  - **Valid + `ok`:** the document (`layout="web"`), the Narrative / BOM toggle (plain links), and the closed banner
    if lost. There's no PDF link: the PDF route needs a portal session, and the page itself is printable.
  - **Valid + `revising`:** the "being revised" card.
  - **Anything else** — bad, expired or revoked token, unknown id, never sent: one 200 card, "This link isn't active.
    Ask your Peak rep for a new one." It's identical for every cause, so nothing about the quote's existence leaks.
- **Metadata and headers:**
  - `robots: { index: false, follow: false }` and `<meta name="referrer" content="no-referrer">`, so the token never
    leaves in a Referer;
  - `export const dynamic = "force-dynamic"`.
- **IP helper:** `clientIp` (rate-limit.ts:68) takes a `Request`. Add a sibling, `clientIpFromHeaders(h: Headers)`,
  so a page can use `headers()`. Both share the parsing.

### 5.4 Photo routes for the web pages

There are two route handlers. Each recomputes, live, the set of photo doc ids that its quote's latest sent revision
prints, and serves only a member of that set.

- `/portal/quotes/[id]/photo/[docId]/route.ts` — portal viewer, `portalListsQuote` and `onlineEstimateState` `ok`.
  Rate limit `portal-photo:<grantId>`, 300/min.
- `/share/quote/[id]/[token]/photo/[docId]/route.ts` — the same token check as the page. Rate limit
  `share-photo:<ip>`, 300/min.

Both behave the same way:

- **Set membership:** `keyProductPhotoDocs(rev.spec.sections)` values' ids.
- **Content types:** png, jpeg and webp only.
- **Headers:** `x-content-type-options: nosniff`, an ETag on doc id + blobKey hash (the portal doc route's scheme),
  and `cache-control: private, max-age=3600`.
- **Anything else:** a plain 404.

### 5.5 Staff controls

- **Where:** a **Client link** block in the customer preview sidebar (preview-doc.tsx), and the same three actions in
  the toolbar's quote ⋯ menu.
- **No sent revision:** **Copy client link** is disabled, titled "Send the quote first — the link shows the version
  you sent."
- **Active link:** **Copy client link**, then "Expires <date> · created by <name>", then **Revoke**.
- **Expired or revoked link:** **Copy client link** creates a fresh one.

The actions:

- **`getShareLinkAction(quoteId)`** — `requirePerm("send")`.
  - Refuses a quote whose `onlineEstimateState` is not `ok`.
  - If an active link exists (`expiresAt > now`), it returns the same URL. Copying twice gives the same link.
  - Otherwise it writes `shareLink = { nonce: newShareNonce(), expiresAt: now + SHARE_DEFAULT_TTL_MS, createdAt,
    createdBy }` through `update()`.
  - It returns `{ path, expiresAt, … }`.
  - The client prefixes `window.location.origin`, the way the portal magic link is shared (portal.ts:129), and
    writes it to the clipboard.
- **`revokeShareLinkAction(quoteId)`** — `requirePerm("send")`.
  - Confirm: "Anyone with the current link will lose access."
  - Writes `{ nonce: newShareNonce(), expiresAt: 0, revokedAt, revokedBy }`.
  - The old token can never verify again: the nonce changed **and** expiry is 0.

`shareLink` is not a content field, so neither action touches the PDF state.

### 5.6 What the online pages render — and never render

**Rendered.** Exactly what `QuoteDocument` prints from the sent revision:

- **Header:**
  - letterhead or uploaded logo;
  - customer name, attn contact (name · role) and project name;
  - venue "Label — City";
  - lead estimator and Prepared by names, and the company name.
- **Quote-level text:** the quote note when the Cover toggle is on, plus the assumptions.
- **Each printed system:**
  - number, name and system sell subtotal;
  - intro and key-product headings, paragraphs and photos (narrative);
  - or customer lines (itemized). Those are `customerLines` rows: description, customer comment when Descriptions is
    on, qty/unit when Quantities is on, extended sell when Prices is on.
  - The freight row.
- **Vendor-quote lines:** "Vendor · Quote no. — Description" and, when itemized, their line descriptions and qty.
- **Further sections:**
  - Optional additions, when on;
  - totals and the Rewards credit line;
  - the purchase-perks line;
  - payment terms;
  - terms text, when on;
  - the standing / valid-until lines;
  - acceptance and signature blocks.

**Never rendered.** These were checked against quote-document.tsx and pricing.ts `customerLines`:

- **Money internals:** `cost` (line, component or vendor), `margin`, `tierMargin` and `pricingTier`, and the
  `sellOverride` mechanics.
- **Internal text:** `internalNote`, and vendor-quote `terms` / `notes` / attachment.
- **Line metadata:** `link`, `room`, `laborGroups`, `components`, and shop/bonus/travel labor lines by name (folded by
  `customerLines`).
- **Quote records:** `review`, `history`, `owner` email, the other revisions, PDF blob paths, and `shareLink` itself.

**Page wiring.** The pages pass **no quote data to any client component**. The toggle is links, and the document is a
server component (quote-document.tsx:10–15: no hooks, no "use client"). So no RSC payload carries the raw spec.

### 5.7 `layout="web"`

- **Width:** `.est-doc` drops its fixed `width: 740` for `width: 100%; max-width: 740px`.
- **Padding:** 46px 50px becomes 20px 16px under 600px.
- **Photos:** a key-product photo un-floats and goes full width above its paragraph under 480px.
- **Sheet chrome:** the box shadow and the sheet look stay above 760px.
- **Phone check:** the line grid (`70px` / `104px` columns) fits a 375px screen with the descriptions column at
  `1fr`. Verified in the browser at 375px.

---

## 6. Edge cases

| Case | Behavior |
|---|---|
| Key product's line deleted | Resolution `missing`. The editor shows a red "Line removed" strip with Remove. The block doesn't print. It is never auto-deleted, so the text isn't lost silently. |
| Line's sku changed under the same id (e.g. a line replaced) | Resolution `changed`. It doesn't print. **Re-anchor** adopts the new sku and keeps the text. |
| Line turned into an option, or labor | `ineligible`. It doesn't print. |
| Part has no image, or photo off | The paragraph prints full width. |
| Photo blob unreadable or oversize | No photo, plus a warn log. The render never fails. |
| Part soft-deleted from the catalog | Block text still prints (it's on the quote). There's no photo. The chip reads **Not in catalog**, and Save to library is refused. |
| Library paragraph edited after the quote was drafted | The quote keeps its copy. The chip turns **Edited**, and **Use library text** pulls the new one in. |
| Same sku on two lines | One block per sku per system (sanitize keeps the first). The star on the second line is disabled with a title saying so. |
| Same-estimate Copy system | Item ids are re-minted, and the blocks are remapped (§3.4). |
| Copy or Move to another estimate | Ids are kept, so the blocks travel as-is. |
| Revision recall | `spec` is restored with its blocks. That's unchanged. |
| Quote re-sent | The link and the portal page show the **newest** sent revision. The token is unchanged. |
| Quote recalled to draft after sending | "Being revised" card, no content (decision 16). |
| Lost quote | Viewable, with the "This estimate is closed." banner. The link stays valid until it expires or is revoked. |
| Won quote | Viewable, with no banner. |
| Never-sent quote | No link (the button is disabled, and the server refuses). The portal row keeps today's PDF behavior. |
| Service quote (flame / repair / inspection) | Out of scope for Slice 3. It stays PDF-only, and its rows are unchanged. |
| Sent revision cut before #293 (no `docFields`) | The header comes from the live quote. The priced body comes from the revision. |
| Link expired or revoked, or a tampered token | The identical "isn't active" card, 200. |
| `AUTH_SECRET` rotated | Every share link dies. Staff copy a new one. |
| Itemized appendix on, but no narrative or sectioned systems | Nothing prints, because there's nothing the body left out. |
| Labor-kind system in the appendix | It prints the body's single "Installation, commissioning & project management" row, as the body does. |
| Library entry whose quote was deleted since indexing | Load refuses with "That estimate is no longer available" and invalidates the index. |
| Daylite history and lost quotes | Never in the library. |

---

## 7. Security summary (share link)

- **Token:** `<exp>.<HMAC-SHA256(AUTH_SECRET, "share:quote:<id>:<nonce>:<exp>")>`, base64url. The quote id is in the
  path, and the nonce lives only in the database.
  - Domain-separated from the print token's `print:` prefix, and with a different shape. Neither token validates as
    the other.
- **Expiry:** 60 days by default. The verifier also enforces exp = stored exp and a 366-day ceiling.
- **Revoke:** rotate the nonce and set exp to 0.
- **Scope:** read-only, latest sent revision, a system quote only. There are no actions on the page: no accept, no
  download route, no comments.
- **Rate limits:** per IP on the page and the photo route, using the in-memory limiter (rate-limit.ts). It's
  per-instance and best-effort, like every other limiter here. The 256-bit MAC is the real barrier.
- **No session:** the route is outside the team login and the portal session. It never sets or reads either cookie.
- **No index, no Referer:** `robots` noindex and `referrer: no-referrer`.
- **Preview deploys:** they share the production database, so a link copied on a preview deploy carries the preview
  origin. Copy client links from production only. This goes in the Rollout note.

---

## 8. Done criteria per slice

### 8.1 Slice 1

- **Marking:** a line can be starred into a key product and un-starred. Ineligible lines have no star.
- **Column:** the narrative column lists the blocks with the chip, photo, toggle, text, reorder, Save to library,
  Use library text and Remove.
- **Unresolved blocks:** all three states show and don't print.
- **Intros:** Save as intro, Manage intros (edit and delete) and the intro select all work. Writes refuse without
  `create`.
- **Draft narrative:** fills the intro and block texts in both modes, switches to Narrative, and reports the skus that
  still need a paragraph.
- **Save to library:** writes `narrativeText` through `mergeUpsert`. It confirms before replacing, honors the
  stale-version check, and refuses custom skus.
- **Part editor:** shows and edits the paragraph.
- **Saved PDF:** a narrative system prints the intro, then each key product with its photo floated right, or full
  width with no photo. An itemized system prints as before. A quote with no blocks prints byte-for-byte the same
  sections as before (checked against a pre-change render of a seeded quote).
- **Itemized appendix:** the toggle appears in Show on PDF. When on, the appendix prints on a new page after the
  signature, with every narrative system's lines, and the totals are unchanged.
- **Gates:** green, with the harness block `#293 slice 1` (§9).

### 8.2 Slice 2

- **Search:** **+ From library…** searches sent and won systems, ranked won → sent → newest, by name, customer, sku or
  description. Drafts, post-send edits, lost quotes and Daylite history never appear.
- **Load system:** adds a re-priced section with its narrative and remapped key products. Vendor lines are left out
  with a count, and the notice reports cost and tier moves.
- **Merge narrative:** appends intros and anchors blocks per §2.5, with the preview and notice.
- **Gates:** green, with the block `#293 slice 2`.

### 8.3 Slice 3

- **Portal page:** `/portal/quotes/<id>` renders the latest sent revision with the Narrative / BOM toggle, the closed
  banner and the Download PDF link. Portal rows link to it. The not-available and revising cards render 200.
- **Staff actions:** Copy client link creates a link, re-copies the same link, and is refused for a never-sent quote
  or without `send`. Revoke kills the old link immediately.
- **Share page:** `/share/quote/<id>/<token>` renders without any session, toggles views, shows photos through the
  scoped route, and shows the one "isn't active" card for every failure.
- **Fidelity:** a quote edited after sending shows the **sent** version on both pages.
- **Revisions:** new revisions carry `docFields`.
- **Phone:** both pages work at 375px.
- **Gates:** green, with the block `#293 slice 3` and the new smoke routes.

---

## 9. Test plan

### 9.1 Harness

The harness is `scripts/test-review-and-spec.ts` (`npm run test:specs`), with one appended block per slice. Each is
headed with the `/* ===… #293 … ===*/` banner, the way #290's block is (test-review-and-spec.ts:42749). Imports use a
`n293…` alias prefix. The `ok()` helper is at :340.

**Slice 1 — pure:**

- **`isKeyProductEligible`:** a plain catalog line ✓; labor, overhead, travel, reward-credit and option lines ✗; a
  blank sku ✗.
- **`resolveKeyProducts`:** `ok`; `missing` (line removed); `changed` (same id, other sku); `ineligible` (became an
  option).
- **`sanitizeKeyProducts`:**
  - drops non-objects, missing lineKeys and non-boolean photo (defaults it to true);
  - strips unknown keys and trims;
  - caps text at `MAX_PARAGRAPH` and count at `MAX_KEY_PRODUCTS`;
  - dedupes by lineKey, then sku;
  - keeps unresolved blocks.
- **`remapKeyProducts`:** remaps ids, drops unmapped ones, and passes `undefined` through.
- **`draftNarrative`:**
  - intro + library paragraph; catalog-description fallback;
  - `needsParagraph` list;
  - "blanks" leaves written text alone; "replace" overwrites;
  - switches to narrative;
  - `changed: false` when nothing differs.
- **`printableKeyProducts`:** order preserved; unresolved blocks excluded; heading = desc (with the allowance
  prefix); empty text gives a heading only.
- **`appendixSystemIds`:** narrative systems only under itemized detail; all systems under sectioned; revenue-less
  systems skipped.
- **`normalizePdfOptions`:** absent `pdfItemizedAppendix` → false; `true` kept; a non-boolean value → false.
  `PDF_TOGGLE_KEYS` includes it.
- **Intros:** `sanitizeIntro` (empty title, caps, case-insensitive duplicate title) and `applyIntroOp`
  (upsert-new, upsert-existing keeps id, delete, delete-unknown, the 200 cap).

**Slice 1 — DB** (scratch PGlite, as the harness already runs):

- Saving a quote whose section carries messy `keyProducts` through the store path stores the sanitized array.
  `addQuoteRevision` snapshots it.
- The paragraph write — store-level `saveProductParagraph(sku, text, by)`, called by the action — sets
  `narrativeText`/`At`/`By`. `cost`, `list`, `pricedAt` and the `spec*` fields are unchanged. A follow-up
  `mergeUpsert` price patch leaves `narrativeText` intact.
- The intros blob round-trips through `upsertIntro`/`deleteIntro`.
- `keyProductPhotoDocs` returns the `visibleImagesForParts` `[0]` doc for a sku with two images (the primary first)
  and nothing for a hidden-only part.

**Slice 1 — source checks** (`readFileSync`, as the #288/#290 blocks do):

- `saveQuoteAction` calls `sanitizeKeyProducts`.
- The same-estimate copy path calls `remapKeyProducts`.
- `quote-document.tsx` uses `printableKeyProducts` and `ItemizedLines`, and never names `internalNote`.
- The print route passes `keyProductPhotos`.
- `preview-doc.tsx` offers the "Itemized appendix" toggle.

**Slice 2:**

- **`systemLibraryEntries`:**
  - a sent quote edited after send indexes the **revision's** systems, not the live ones;
  - a draft quote is excluded, and so are a lost quote and a `daylite` quote;
  - won-without-send uses the live spec;
  - labor and empty systems are skipped;
  - the Rewards credit line is excluded from counts.
- **`searchSystemLibrary`:** multi-token AND across fields; won → sent → newest ordering; the name-match tiebreak;
  `hasNarrative`; the limit.
- **`mergeNarrative`:**
  - appends the intro, with a duplicate intro skipped;
  - anchors a block to an unmarked line;
  - `skippedPresent`, `skippedNoLine`, the cap overflow;
  - `intro: false` / `products: false`.
- **Load-system pricing helper** (DB): it re-prices a catalog line at today's cost and drops a vendor-quote line with
  the count. The returned section carries `keyProducts` and `narrative`.

**Slice 3:**

- **Token:** sign → verify ✓; wrong id ✗; rotated nonce ✗; `expiresAt: 0` ✗; exp ≠ stored ✗; expired ✗; TTL > 366 d
  ✗; tampered MAC ✗; a malformed token ✗; a NaN clock ✗; a print token never verifies as a share token, nor the
  reverse.
- **`onlineEstimateState`:**
  - never-sent → unavailable;
  - sent → ok;
  - lost → ok + closed;
  - recalled draft with a sent revision → revising;
  - a flame quote → unavailable.
- **`bomViewProps`:** every section itemized; qty and notes on; prices kept; appendix off.
- **`revisionDocFields`, and the loader's revision path** (pure part): a sent revision's name, spec, rev number and
  date win over the live quote; `docFields` win over live header fields; no `docFields` → live header.
- **DB:**
  - `getShareLinkAction`'s store core creates the link, returns the same link again, refuses a never-sent quote;
  - revoke rotates the nonce and the old token stops verifying;
  - a new `addQuoteRevision` carries `docFields`.
- **Source checks:**
  - the middleware matcher contains `share/`;
  - the share page sets `robots` noindex and a no-referrer meta;
  - neither online page imports a `"use client"` module that receives `sections`. The toggle is `<Link>`/`<a>` only.
  - the photo routes check membership via `keyProductPhotoDocs`;
  - smoke-routes.ts lists the new routes.

### 9.2 Smoke

`scripts/smoke-routes.ts` treats any 404 as a failure (:449), so only 200-rendering routes are listed. The photo
routes 404 by design and aren't listed.

- `ROUTES`:
  - `/share/quote/Q-2041/0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` — the "isn't active" card;
  - `/portal/quotes/Q-2041` — signed-out card;
  - `/portal/quotes/Q-2041?preview=lakefront`;
  - `/portal/quotes/Q-2041?preview=lakefront&view=bom`;
  - `/portal/quotes/Q-0?preview=lakefront` — not available.
- The existing `/estimator?id=Q-2041` covers the Slice 1 and 2 client bundles (the narrative column and the library
  modal).

### 9.3 Browser (per slice, on a scratch datadir — never `.data/pglite`)

**Slice 1:**

- star a line, edit its text, toggle the photo, reorder;
- Save to library, then open a fresh quote, star the same part and see the library text;
- Draft narrative in both modes;
- save, open the PDF: the photo sits right of the paragraph; the appendix prints on a new page.

**Slice 2:** load a won system into a new quote; merge narrative into a system that shares two of its parts.

**Slice 3:**

- open the portal page and toggle the views;
- copy the link and open it in a private window with no session;
- revoke, reload, see the inactive card;
- check the page at 375px.

---

## 10. Back-compat and rollout

- **No migration.** `keyProducts` (on `spec.sections`), `narrativeText*` (catalog part docs), `narrative_intros` (a
  blob), `pdfItemizedAppendix` (in `pdfOptions`), `docFields` (on new revisions) and `shareLink` (on the quote doc)
  are all additive JSONB.
- **Older quotes:** they have no `keyProducts`, and `pdfItemizedAppendix` is absent (read as false), so they print
  exactly as before.
- **Older revisions:** they lack `docFields` and read live headers online.
- **Rollback safety:**
  - Pre-#293 code ignores `keyProducts` when printing. An estimator save from old code round-trips sections by spread,
    so the blocks survive.
  - Pre-#293 `normalizePdfOptions` drops the appendix key on its next save, which is harmless.
  - Rolling back Slice 3 removes the routes. Links then 404 until it's redeployed.
  - No slice adds a hazard like #290's.
- **Preview deploys** share the production database. Don't create share links or save paragraphs on a preview unless
  you mean it: they are production writes, and a copied link carries the preview origin.
- **Catalog reset:** paragraphs live on the parts. `Clear catalog price list` (clearCatalogPriceList) and the
  go-live **Clear demo data** wipe (which also removes catalog parts, per settings/groups/data.tsx:245–251) delete
  them with the parts. Take `npm run db:export` first, as for any reset. The `narrative_intros` blob is a settings
  blob and survives both.
- **Docs per slice:** DECISIONS entries for the decisions above that the slice ships, a PUNCHLIST #293 entry
  (Slice 1, 2, 3 sub-lines), and an AGENTS.md phase line. Numbers are recomputed from origin/main right before
  writing.

---

## 11. Out of scope

- **Generation:** any AI or generated text (decision 1).
- **Accepting from the link:** accept, sign or comment on the share page. It's read-only. The portal keeps its
  existing Accept on rows.
- **Service quotes online:** service quotes (flame / repair / inspection letters) on the online pages.
- **Multiple links:** several share links per quote, per-recipient links, and view tracking ("last opened") — see
  Open questions.
- **Rich text:** anything in paragraphs beyond D488's plain-text rules.
- **Curating the library:** editing or pinning library entries. It's computed only.

---

## 12. Open questions for Jeff

1. **Photo side.** Should photos alternate left and right down a system, brochure-style, or always sit on the right
   (the spec's default)?
2. **Datasheet thumbnails as photos.** A part with no real image uses its datasheet page-1 render as the "photo"
   (decision 8, the same as the portal tile). Keep it, or print full width unless there's a real photo?
3. **Default presentation.** Should new systems default to **Narrative** now that key products exist? Today they
   default to Itemized, and Draft narrative switches them.
4. **Link lifetime.** Is 60 days right, or should it be longer, or tied to the quote's validity?
5. **View tracking.** Should staff see "Client opened the link Oct 3"? That needs a write on a public GET; it's
   deliberately left out.
6. **Who manages intros.** Anyone with `create` (the spec's choice, matching the Spec panel), or admins only?
7. **Vendor-quote lines on Load system.** They're left out (decision 12). Would you rather carry them with their
   files?
