# Manufacturer page + quoted cost and forecast — design (Manufacturer section, Parts 2–3)

**Date:** 2026-10-03 · **Punch item:** next free on `origin/main` at docs time
(#298 at spec time) · **Decisions:** next free D numbers (D588+) · **Migration:**
none (new fields on the existing `manufacturers` doc records).

Jeff (2026-10-02): "a better manufacturer page that also links to vendors in
companies tab and allows for people to also be linked but also has locations and
current cost quoted and allows for better forecast … with the vendor/manufacturer.
Overall there needs to be a manufacturer section of catalog." Part 1 (#297)
shipped the `manufacturers` record + images. Jeff then asked to "keep going til it
is all done" — every choice below was taken without asking and is logged in
DECISIONS.

## Part 2 — the manufacturer page

### Route
`/catalog/manufacturers/<key>` where `<key>` is the manufacturer key (`mfrKey`).
It works for any manufacturer in the catalog, with or without a record; records
are still created lazily on the first edit. An alias key (see merging) redirects
to its canonical key. Rows on Catalog → Manufacturers link here. View: signed in.
Every edit: `create`.

### Record additions (`manufacturers`, no migration)
```ts
aliasKeys: string[];        // other manufacturer keys merged into this one
mergedInto: string | null;  // set on a record that was merged away (its canonical key)
companyId: string | null;   // the manufacturer's own company (people + locations)
people: Array<{ contactId: string; role: string }>; // reps/contacts from any company
notes: string;              // plain text, ≤ 4000 chars
```
Old records read with defaults (`[]`, `null`, `null`, `[]`, `""`).

### Merging spellings (aliases)
"Allen & Heath" (`allenheath`) and "Allen and Heath" (`allenandheath`) are
different keys. **Merge into…** on a manufacturer's page folds it into another:
- the target's `aliasKeys` gains the source key and the source's own aliases; the
  source record (created if missing) gets `mergedInto: <target key>`;
- the target keeps its own image/company/notes; it adopts the source's image or
  company only when it has none; `people` are unioned;
- **non-destructive**: catalog parts keep their `mfr` text; **Unmerge** removes
  an alias and clears its `mergedInto`;
- one pure resolver, `canonicalKeyMap(records)`, maps any key to its canonical key
  (unknown keys map to themselves; chains flatten — merging a key that already
  has aliases moves them). Merging into yourself or into one of your own aliases
  is refused.
- **Everything keyed by manufacturer becomes alias-aware:** the Manufacturers
  list (one row per canonical key, spellings from every merged key),
  `manufacturerImageLookup` (an alias key resolves to the canonical image — so the
  portal, documents and cut sheets follow automatically), and the portal index's
  `mfrImageDocs` (alias keys included).

### Page sections
1. **Header** — image (upload/replace/remove, reusing the Part 1 actions), name,
   spellings (each links to `/catalog?mfr=<spelling>`), merged keys with
   Unmerge, and Merge into… (a manufacturer picker).
2. **Supplied by** — the vendor(s) whose vendor profile claims any of this
   manufacturer's spellings (`claimOwnerByKey` over every key in the group; live
   vendor companies only): name → `/vendors/<id>`, last price list received /
   effective, discount terms. **Set vendor** (a vendor picker) and **Release**
   call the existing `claimManufacturerAction` / `releaseManufacturerAction`
   (a manufacturer belongs to at most one vendor — claiming moves it).
3. **Company** — link an existing company (company picker), **Create company**
   (type `vendor/manufacturer`, via the existing vendor-company creator), or
   unlink. When linked: its locations (`sitesForCompany`) and its people
   (`contactsForCompany`, with title, email, phone) — editing stays on the
   company page (a link).
4. **Reps & contacts** — people linked to the manufacturer from any company
   (rep firms, distributor contacts): name, their company, role; **Add** (search
   contacts by name, pick, type a role) and **Remove**.
5. **Notes** — one plain-text field, Save.
6. **Catalog** — part count, parts without their own photo (the portal's rule),
   top categories, the price-book date (`priceBooks`), Catalog links per spelling.
7. **Quoted** — Part 3.

## Part 3 — quoted cost and forecast

### What counts
- **Quotes:** live system quotes with `spec.sections` (Estimator / Quick / Grid);
  service quotes, Daylite history and deleted quotes carry no catalog lines and
  are skipped by construction.
- **Lines:** every section item except labor (`labor`, a labor section,
  `laborOverhead`, `laborTravel`), options, the rewards credit, allowances and
  price-on-request lines. A line with `components` (fixtures) counts each
  component (`qty = component.qty × line.qty`, `cost = component.cost`, `sell =
  component.price × qty`); otherwise the line itself (`cost = qty × cost`,
  `sell = lineExtSellOf`).
- **Manufacturer:** the catalog part's `mfr` (by sku), else the line's own
  `manufacturer` text; resolved to the canonical key. No manufacturer → skipped.
- **Cost is the cost as quoted** on the line (what Peak expected to pay then);
  sell is shown alongside.

### Metrics (per manufacturer; the window is the 12 calendar months ending now (America/Chicago) unless noted — the oldest month starts at midnight Chicago on the 1st, so Won equals the monthly chart's sum)
| Metric | Definition |
|---|---|
| Quoted | cost of lines on quotes **created** in the window whose status is sent, won or lost |
| Won | cost on quotes whose **won** date (`wonAt`) is in the window |
| Lost | cost on quotes whose **decided** date (`decidedAt`) is in the window and status lost |
| Win rate | Won ÷ (Won + Lost) by cost; none when both are 0 |
| Open (sent) | cost on quotes currently `sent` (any age) |
| In draft | cost on quotes currently `draft` (any age) |
| **Forecast** | Open (sent) × the manufacturer's win rate, falling back to the shop-wide win rate (same window, all manufacturers), else 0 |
| Monthly won | won cost per calendar month, last 12 months (America/Chicago) |
| Top parts | top 10 skus by Quoted cost (sku, description, qty, cost) |
| Quotes | count of distinct quotes contributing to Quoted |

A component with no catalog manufacturer falls back to its parent line's
`manufacturer` text. A vendor rollup counts distinct quotes (one quote touching
two of its manufacturers counts once), its **forecast is the sum of its
manufacturers' forecasts** (each with its own win rate or the shop rate), and
the win rate it shows is the pooled one (Won ÷ (Won + Lost) over all of them).

Every cost metric has a sell twin. No stage probabilities exist in the app, so the
forecast weights only sent quotes by history; drafts are shown, never forecast.

### Where it shows
- **Manufacturer page → Quoted** section: the metric tiles (cost, sell beneath),
  a 12-bar monthly won chart, top parts, and the "how the forecast is figured"
  line.
- **Catalog → Manufacturers list:** two new columns, **Quoted 12 mo** and
  **Open**, and a sort control (Parts · Quoted · Open).
- **Vendor page → Overview:** a "Quoted through this vendor (12 months)" card —
  the same metrics summed over the manufacturers that vendor supplies, with one
  row per manufacturer linking to its page.

### Computation
One pure module (`src/lib/manufacturer-analytics.ts`) does line extraction,
attribution and every metric over `(quotes, partsBySku, canonicalKey, now)`; a
server loader reads quotes + catalog + manufacturers once per page.

## Out of scope
Changing catalog `mfr` text on merge; editing company people/locations from the
manufacturer page (links to the company page instead); stage-probability
settings; service-quote attribution; export.

## Testing
Four gates + `next build`. Pure: alias resolver (flattening, refusals, unknown
keys), merge/unmerge semantics, alias-aware rows and image lookup, every
analytics metric incl. components, skipped line kinds, windows, win-rate
fallback, monthly buckets, vendor rollup. DB: store merge/unmerge/link/people/
notes; portal `mfrImageDocs` covers alias keys. Smoke: a manufacturer page.
Browser: list → page, sections render, merge preview on a scratch datadir (no
Blob writes).
