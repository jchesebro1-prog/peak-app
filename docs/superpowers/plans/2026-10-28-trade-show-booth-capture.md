# Trade Show Booth Capture + NFC Contact Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Booth visitors become Peak App leads, three ways: they tap Jeff's NFC card (or scan its QR) and send their info, staff type them into an offline Booth mode, or staff scan the visitor's business card. Each lead is tagged with the active trade show.

**Architecture:** Two settings blobs (`trade_shows`, `contact_cards`) and one new offline doc collection (`booth_captures`, migration 0042). All three capture paths funnel into one idempotent server function, `recordBoothCapture`, which creates or merges a lead. Pure rules (shows, vCard, card parser, dedupe) live in `src/lib/booth/` and are tested in `scripts/test-booth.ts`. Card scanning is a small local Capacitor plugin: Apple Vision on iOS, ML Kit on Android.

**Tech Stack:** Next.js 16 App Router, Drizzle on Postgres/PGlite doc tables, the existing offline outbox (`src/lib/sync/`), Capacitor 8 (iOS SPM project, Android Gradle), `qrcode` 1.5.4.

Spec: `docs/superpowers/specs/2026-10-28-trade-show-booth-capture-design.md`.

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing route handlers or pages. This Next.js version has breaking changes (AGENTS.md).
- Timestamps are epoch-ms numbers. Ids: shows `sh_<8 hex>`, captures `bc_<16 hex>`.
- Lead source for every booth lead is `"event"` (existing `SOURCES`, 48 h SLA).
- Nothing is ever sent automatically. A share-back creates a **draft** only.
- Card text recognition runs **on the device only**. No AI call (D89), no network.
- Public routes: `/c/[slug]`, `/c/[slug]/vcard`, `POST /api/booth/share-back`. Everything else requires a signed-in user. Booth mode and Shows need `requirePerm("create")`.
- Never hardcode accent-colored UI. Use `var(--accent)` and the `pk-*` classes in `src/app/globals.css`.
- The dev DB (`.data/pglite`) is single-process. Never run a db script while `next dev` is up. Tests use `npm run test:specs` (it makes its own temp DB).
- Migrations are idempotent (`IF NOT EXISTS`, D141). Renumber `0042` at merge if another branch lands one first.
- Never preview-deploy this branch (previews share the production DB and skip migrations).
- Verification gate per task where noted: `npx tsc --noEmit`, `npm run test:specs`, `npm run lint`. Before the final commit also run `npm run build` and `npm run test:smoke`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/booth-capture` (branch `feat/booth-capture`). It has no `node_modules`: run `npm ci` once first (not a symlink), and copy `.env.local` + `next-env.d.ts` from the main checkout.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/booth/shows.ts` | Pure: `Show` type, sanitize, one-active rule, show ops, contact-card slug map |
| `src/lib/booth/vcard.ts` | Pure: vCard 3.0 builder (escape + fold) |
| `src/lib/booth/card-parse.ts` | Pure: OCR lines → contact fields |
| `src/lib/booth/capture.ts` | Pure: `BoothCapture` type, `INTERESTS`, sanitize, dedupe decision, lead text, follow-up copy |
| `src/lib/stores/booth.ts` | Server: read/write the two blobs, booth_captures reads |
| `src/lib/booth/capture-server.ts` | Server: `recordBoothCapture` (the one path) + card image to Blob |
| `src/lib/booth/followup-server.ts` | Server: share-back follow-up draft |
| `src/lib/booth/card-text.ts` | Client: calls the native `CardText` plugin |
| `drizzle/0042_booth_captures.sql` + `drizzle/meta/*` | New doc table |
| `src/app/c/[slug]/page.tsx`, `share-back-form.tsx`, `vcard/route.ts` | Public card page + vCard |
| `src/app/api/booth/share-back/route.ts` | Public share-back POST |
| `src/app/api/booth/card-image/[id]/route.ts` | Signed-in card image bytes |
| `src/app/(app)/leads/shows/page.tsx`, `actions.ts`, `shows-editor.tsx` | Shows + card admin + QR |
| `src/app/(app)/leads/booth/page.tsx`, `actions.ts`, `booth-form.tsx` | Staff Booth mode |
| `ios/App/App/CardTextPlugin.swift`, `BridgeViewController.swift` | iOS Vision plugin |
| `android/app/src/main/java/com/peaksystemsgroup/quartzite/CardTextPlugin.java` | Android ML Kit plugin |
| `scripts/test-booth.ts` | Pure + DB checks, wired into `test:specs` |

Spec change made by this plan: the card image rides **inside** the `booth_captures` doc as a ≤ 250 KB JPEG data URL (shrunk on the device), and the server moves it to private Blob on receipt. It does not use the assessment photo queue. This keeps a capture one offline record. The spec's §4 is updated in Task 12.

---

### Task 1: Shows + contact-card rules (pure) and the test harness

**Files:**
- Create: `src/lib/booth/shows.ts`
- Create: `scripts/test-booth.ts`
- Modify: `scripts/test-review-and-spec.ts` (import near line 11367, chain near line 11754)

**Interfaces:**
- Produces:
  - `type Show = { id: string; name: string; startAt: number | null; endAt: number | null; active: boolean; archived: boolean; createdAt: number }`
  - `sanitizeShows(raw: unknown): Show[]`
  - `activeShow(list: Show[]): Show | null`
  - `type ShowOp = { kind: "upsert"; show: unknown } | { kind: "activate"; id: string } | { kind: "deactivate" } | { kind: "archive"; id: string } | { kind: "unarchive"; id: string }`
  - `applyShowOp(list: Show[], op: ShowOp, now: number, mintId: () => string): { ok: true; list: Show[]; id?: string } | { ok: false; error: string }`
  - `type ContactCards = Record<string, string>` (slug → userId)
  - `sanitizeCards(raw: unknown): ContactCards`, `slugProblem(slug: string): string | null`, `normalizeSlug(s: string): string`
  - `boothChecks(ok: Ok)` and `boothDbChecks(ok: Ok)` exported from `scripts/test-booth.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-booth.ts`:

```ts
/* Trade show booth capture — harness checks. `boothChecks` is pure; `boothDbChecks` needs the test DB.
   Run the pure half alone with `npx tsx scripts/test-booth.ts`. */
import type { Ok } from "./test-inbox-org";
import { activeShow, applyShowOp, normalizeSlug, sanitizeCards, sanitizeShows, slugProblem, type Show } from "../src/lib/booth/shows";

const S = (over: Partial<Show>): Show => ({ id: "sh_00000001", name: "LDI 2026", startAt: null, endAt: null, active: false, archived: false, createdAt: 1, ...over });
const mint = (() => { let n = 0; return () => "sh_" + String(++n).padStart(8, "0"); })();

export async function boothChecks(ok: Ok) {
  // shows
  ok(sanitizeShows(null).length === 0, "booth: no shows blob → empty list");
  ok(sanitizeShows([{ id: "sh_0000000a", name: "  USITT  " }])[0].name === "USITT", "booth: show name trimmed");
  ok(sanitizeShows([{ id: "bad", name: "X" }, { id: "sh_0000000b", name: "" }]).length === 0, "booth: bad id / blank name dropped");
  const two = sanitizeShows([S({ id: "sh_00000001", active: true }), S({ id: "sh_00000002", active: true })]);
  ok(two.filter((s) => s.active).length === 1 && two[0].active, "booth: sanitize keeps only the first active show");
  ok(activeShow([S({}), S({ id: "sh_00000002", active: true })])?.id === "sh_00000002", "booth: activeShow finds it");
  ok(activeShow([S({ active: true, archived: true })]) === null, "booth: an archived show is never active");

  const added = applyShowOp([], { kind: "upsert", show: { name: "LDI 2026", startAt: 10, endAt: 20 } }, 5, mint);
  ok(added.ok && added.list.length === 1 && added.list[0].id === added.id && added.list[0].createdAt === 5, "booth: upsert adds with a minted id");
  ok(!applyShowOp([], { kind: "upsert", show: { name: " " } }, 5, mint).ok, "booth: blank name refused");
  ok(!applyShowOp([], { kind: "upsert", show: { name: "X", startAt: 20, endAt: 10 } }, 5, mint).ok, "booth: end before start refused");
  const list = [S({ id: "sh_00000001", active: true }), S({ id: "sh_00000002" })];
  const act = applyShowOp(list, { kind: "activate", id: "sh_00000002" }, 6, mint);
  ok(act.ok && act.list.filter((s) => s.active).map((s) => s.id).join() === "sh_00000002", "booth: activate moves the one active flag");
  ok(!applyShowOp(list, { kind: "activate", id: "sh_00000009" }, 6, mint).ok, "booth: activate unknown refused");
  const off = applyShowOp(list, { kind: "deactivate" }, 6, mint);
  ok(off.ok && off.list.every((s) => !s.active), "booth: deactivate clears the flag");
  const arch = applyShowOp(list, { kind: "archive", id: "sh_00000001" }, 6, mint);
  ok(arch.ok && arch.list[0].archived && !arch.list[0].active, "booth: archive also deactivates");
  const un = applyShowOp([S({ archived: true })], { kind: "unarchive", id: "sh_00000001" }, 8, mint);
  ok(un.ok && !un.list[0].archived && !un.list[0].active && un.list[0].name === "LDI 2026", "booth: unarchive keeps name, stays inactive");
  ok(!applyShowOp([S({ archived: true })], { kind: "activate", id: "sh_00000001" }, 8, mint).ok, "booth: an archived show can't be set active");
  const ren = applyShowOp(list, { kind: "upsert", show: { id: "sh_00000002", name: "Renamed" } }, 7, mint);
  ok(ren.ok && ren.list[1].name === "Renamed" && ren.list[1].createdAt === 1, "booth: upsert by id edits in place, keeps createdAt");

  // contact-card slugs
  ok(normalizeSlug("  Jeff ") === "jeff", "booth: slug lowercased + trimmed");
  ok(slugProblem("jeff") === null && slugProblem("jeff-c2") === null, "booth: plain slugs ok");
  ok(slugProblem("") !== null && slugProblem("a b") !== null && slugProblem("-x") !== null && slugProblem("x".repeat(33)) !== null, "booth: bad slugs refused");
  const cards = sanitizeCards({ jeff: "u1", "Bad Slug": "u2", sam: "" });
  ok(Object.keys(cards).join() === "jeff" && cards.jeff === "u1", "booth: card map keeps only valid entries");
}

export async function boothDbChecks(ok: Ok) {
  void ok; // filled in by Task 5 and Task 6
}

if (process.argv[1]?.endsWith("test-booth.ts")) {
  let fails = 0;
  const ok: Ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
  boothChecks(ok).then(() => { console.log(fails ? `${fails} FAILED` : "booth: ALL PASSED"); process.exit(fails ? 1 : 0); });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-booth.ts`
Expected: FAIL. The module `../src/lib/booth/shows` can't be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/booth/shows.ts`:

```ts
/**
 * Trade show booth capture — the Shows list and the contact-card slug map.
 * Pure: the store (`src/lib/stores/booth.ts`) applies one op under the blob's
 * row lock. At most one show is active; an archived show is never active.
 */

export type Show = {
  id: string; // sh_<8 hex>
  name: string;
  startAt: number | null;
  endAt: number | null;
  active: boolean;
  archived: boolean;
  createdAt: number;
};

const SHOW_ID = /^sh_[0-9a-f]{8}$/;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function sanitizeShows(raw: unknown): Show[] {
  if (!Array.isArray(raw)) return [];
  const out: Show[] = [];
  let seenActive = false;
  for (const r of raw) {
    const o = (r || {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const name = text(o.name, 120);
    if (!SHOW_ID.test(id) || !name || out.some((s) => s.id === id)) continue;
    const archived = o.archived === true;
    const active = o.active === true && !archived && !seenActive;
    if (active) seenActive = true;
    out.push({ id, name, startAt: num(o.startAt), endAt: num(o.endAt), active, archived, createdAt: num(o.createdAt) ?? 0 });
  }
  return out;
}

export function activeShow(list: Show[]): Show | null {
  return list.find((s) => s.active && !s.archived) || null;
}

export type ShowOp =
  | { kind: "upsert"; show: unknown }
  | { kind: "activate"; id: string }
  | { kind: "deactivate" }
  | { kind: "archive"; id: string }
  | { kind: "unarchive"; id: string };

export type ShowOpResult = { ok: true; list: Show[]; id?: string } | { ok: false; error: string };

export function applyShowOp(list: Show[], op: ShowOp, now: number, mintId: () => string): ShowOpResult {
  if (op.kind === "deactivate") return { ok: true, list: list.map((s) => ({ ...s, active: false })) };
  if (op.kind === "activate" || op.kind === "archive" || op.kind === "unarchive") {
    if (!list.some((s) => s.id === op.id)) return { ok: false, error: "That show no longer exists." };
    if (op.kind === "activate") {
      if (list.find((s) => s.id === op.id)?.archived) return { ok: false, error: "Unarchive the show first." };
      return { ok: true, list: list.map((s) => ({ ...s, active: s.id === op.id })) };
    }
    const archived = op.kind === "archive";
    return { ok: true, list: list.map((s) => (s.id === op.id ? { ...s, archived, active: false } : s)) };
  }
  const o = (op.show || {}) as Record<string, unknown>;
  const name = text(o.name, 120);
  if (!name) return { ok: false, error: "Give the show a name." };
  const startAt = num(o.startAt);
  const endAt = num(o.endAt);
  if (startAt != null && endAt != null && endAt < startAt) return { ok: false, error: "The show ends before it starts." };
  const id = typeof o.id === "string" ? o.id : "";
  const existing = id ? list.find((s) => s.id === id) : undefined;
  if (id && !existing) return { ok: false, error: "That show no longer exists." };
  if (existing) return { ok: true, id, list: list.map((s) => (s.id === id ? { ...s, name, startAt, endAt } : s)) };
  const show: Show = { id: mintId(), name, startAt, endAt, active: false, archived: false, createdAt: now };
  return { ok: true, id: show.id, list: [...list, show] };
}

/* ---- contact cards: public slug → user id ---- */

export type ContactCards = Record<string, string>;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function normalizeSlug(s: string): string {
  return String(s || "").trim().toLowerCase();
}

export function slugProblem(slug: string): string | null {
  return SLUG.test(slug) ? null : "Use 1–32 lowercase letters, numbers or dashes (not at the ends).";
}

export function sanitizeCards(raw: unknown): ContactCards {
  const out: ContactCards = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (slugProblem(k) === null && typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-booth.ts`
Expected: `booth: ALL PASSED`

- [ ] **Step 5: Wire into test:specs**

In `scripts/test-review-and-spec.ts`, add next to the other `./test-*` imports (after the `./test-parties` import):

```ts
import { boothChecks, boothDbChecks } from "./test-booth";
```

and add to the `.then` chain, right after `.then(() => partyChecks(ok)).then(() => partyDbChecks(ok))`:

```ts
  .then(() => boothChecks(ok)).then(() => boothDbChecks(ok))
```

Run: `npm run test:specs 2>&1 | tail -3`
Expected: ends with `ALL PASSED`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/booth/shows.ts scripts/test-booth.ts scripts/test-review-and-spec.ts
git commit -m "feat(booth): shows + contact-card rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: vCard builder (pure)

**Files:**
- Create: `src/lib/booth/vcard.ts`
- Modify: `scripts/test-booth.ts`

**Interfaces:**
- Produces:
  - `type VCardInput = { name: string; org?: string; title?: string; workPhone?: string; cellPhone?: string; email?: string; url?: string; photoJpegBase64?: string }`
  - `buildVCard(v: VCardInput): string` (CRLF lines, ends with CRLF)
  - `vcardFileName(name: string): string`

- [ ] **Step 1: Write the failing test**

In `scripts/test-booth.ts` add the import and append to `boothChecks`:

```ts
import { buildVCard, vcardFileName } from "../src/lib/booth/vcard";
```

```ts
  // vCard
  const vc = buildVCard({ name: "Jeff Chesebro", org: "Peak Systems Group", title: "Owner, President", workPhone: "414-555-0100", cellPhone: "414-555-0199", email: "jeff@example.com", url: "https://peaksystemsgroup.com" });
  const lines = vc.split("\r\n");
  ok(lines[0] === "BEGIN:VCARD" && lines[1] === "VERSION:3.0" && lines[lines.length - 2] === "END:VCARD" && lines[lines.length - 1] === "", "booth: vCard frame + CRLF");
  ok(lines.includes("FN:Jeff Chesebro") && lines.includes("N:Chesebro;Jeff;;;"), "booth: vCard FN + N split on last space");
  ok(lines.includes("TITLE:Owner\\, President"), "booth: vCard escapes commas");
  ok(lines.includes("TEL;TYPE=WORK,VOICE:414-555-0100") && lines.includes("TEL;TYPE=CELL:414-555-0199"), "booth: vCard phones");
  ok(lines.includes("EMAIL;TYPE=INTERNET:jeff@example.com") && lines.includes("URL:https://peaksystemsgroup.com"), "booth: vCard email + url");
  ok(!buildVCard({ name: "A B" }).includes("TEL"), "booth: vCard omits missing fields");
  ok(buildVCard({ name: "A;B\nC" }).includes("FN:A\\;B\\nC"), "booth: vCard escapes ; and newline");
  const photo = buildVCard({ name: "A B", photoJpegBase64: "x".repeat(300) }).split("\r\n");
  ok(photo.every((l) => Buffer.byteLength(l) <= 75) && photo.some((l) => l.startsWith("PHOTO;ENCODING=b;TYPE=JPEG:")) && photo.some((l) => l.startsWith(" ")), "booth: vCard folds long lines at 75 octets");
  ok(vcardFileName("Jeff Chesebro") === "Jeff Chesebro.vcf" && vcardFileName(' a/"b ') === "a b.vcf" && vcardFileName("") === "contact.vcf", "booth: vCard file name");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-booth.ts`
Expected: FAIL, module `vcard` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/booth/vcard.ts`:

```ts
/**
 * vCard 3.0 for the public contact card (Save contact). Pure. RFC 2426:
 * escape `\` `,` `;` and newlines in text values; fold lines longer than
 * 75 octets with CRLF + one space.
 */

export type VCardInput = {
  name: string;
  org?: string;
  title?: string;
  workPhone?: string;
  cellPhone?: string;
  email?: string;
  url?: string;
  /** Raw base64 of a JPEG (no data: prefix). */
  photoJpegBase64?: string;
};

const esc = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

function fold(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let limit = 75;
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > limit) {
      out.push(cur);
      cur = " " + ch;
      limit = 75;
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function buildVCard(v: VCardInput): string {
  const name = (v.name || "").trim();
  const sp = name.lastIndexOf(" ");
  const first = sp > 0 ? name.slice(0, sp) : name;
  const last = sp > 0 ? name.slice(sp + 1) : "";
  const raw: string[] = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(name)}`, `N:${esc(last)};${esc(first)};;;`];
  if (v.org?.trim()) raw.push(`ORG:${esc(v.org.trim())}`);
  if (v.title?.trim()) raw.push(`TITLE:${esc(v.title.trim())}`);
  if (v.workPhone?.trim()) raw.push(`TEL;TYPE=WORK,VOICE:${esc(v.workPhone.trim())}`);
  if (v.cellPhone?.trim()) raw.push(`TEL;TYPE=CELL:${esc(v.cellPhone.trim())}`);
  if (v.email?.trim()) raw.push(`EMAIL;TYPE=INTERNET:${esc(v.email.trim())}`);
  if (v.url?.trim()) raw.push(`URL:${v.url.trim()}`);
  if (v.photoJpegBase64) raw.push(`PHOTO;ENCODING=b;TYPE=JPEG:${v.photoJpegBase64}`);
  raw.push("END:VCARD");
  return raw.flatMap(fold).join("\r\n") + "\r\n";
}

export function vcardFileName(name: string): string {
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "contact") + ".vcf";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-booth.ts`
Expected: `booth: ALL PASSED`

- [ ] **Step 5: Commit**

```bash
git add src/lib/booth/vcard.ts scripts/test-booth.ts
git commit -m "feat(booth): vCard 3.0 builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Business-card text parser (pure)

**Files:**
- Create: `src/lib/booth/card-parse.ts`
- Create: `docs/booth/card-samples.json` (fixtures, committed under docs/ per the harness rule)
- Modify: `scripts/test-booth.ts`

**Interfaces:**
- Produces:
  - `type ParsedCard = { name: string; email: string; phones: string[]; website: string; company: string; title: string }`
  - `parseCardText(lines: string[]): ParsedCard` (never invents: unknown = `""` / `[]`)

- [ ] **Step 1: Write the fixtures**

Create `docs/booth/card-samples.json`. Each sample is OCR-style lines plus the fields it must produce. Fields left out of `expect` aren't checked.

```json
[
  { "lines": ["Sarah Lindqvist", "Technical Director", "Riverside Performing Arts Center", "sarah.lindqvist@riversidepac.org", "(608) 555-0142", "www.riversidepac.org"],
    "expect": { "name": "Sarah Lindqvist", "title": "Technical Director", "company": "Riverside Performing Arts Center", "email": "sarah.lindqvist@riversidepac.org", "phones": ["(608) 555-0142"], "website": "www.riversidepac.org" } },
  { "lines": ["MARK OYELARAN", "PRODUCTION MANAGER", "BLUE LINE STAGING, INC.", "M 312.555.0187", "O 312.555.0100", "moyelaran@bluelinestaging.com"],
    "expect": { "name": "Mark Oyelaran", "title": "Production Manager", "company": "Blue Line Staging, Inc.", "email": "moyelaran@bluelinestaging.com", "phones": ["312.555.0187", "312.555.0100"] } },
  { "lines": ["Acme Theatrical Supply LLC", "Dana Pruitt", "Sales Representative", "dana@acmetheatrical.com", "Tel: +1 414-555-0111"],
    "expect": { "name": "Dana Pruitt", "company": "Acme Theatrical Supply LLC", "title": "Sales Representative", "email": "dana@acmetheatrical.com", "phones": ["+1 414-555-0111"] } },
  { "lines": ["Fr. Thomas Weber", "Pastor", "St. Anne Parish", "tweber@stanneparish.org", "920-555-0133 ext. 12"],
    "expect": { "name": "Thomas Weber", "title": "Pastor", "company": "St. Anne Parish", "email": "tweber@stanneparish.org", "phones": ["920-555-0133 ext. 12"] } },
  { "lines": ["Kim Nguyen | Theatre Teacher", "Lincoln High School", "knguyen@lincolnhs.k12.wi.us"],
    "expect": { "name": "Kim Nguyen", "title": "Theatre Teacher", "company": "Lincoln High School", "email": "knguyen@lincolnhs.k12.wi.us" } },
  { "lines": ["HALVERSON AUDIO", "Pete Halverson", "Owner", "pete@halversonaudio.com", "halversonaudio.com", "651 555 0198"],
    "expect": { "name": "Pete Halverson", "title": "Owner", "company": "Halverson Audio", "email": "pete@halversonaudio.com", "website": "halversonaudio.com", "phones": ["651 555 0198"] } },
  { "lines": ["Jordan Ellis-Moore", "Facilities Director", "Northern Lakes University", "Jordan.Ellis-Moore@nlu.edu", "P: 715.555.0120  F: 715.555.0121"],
    "expect": { "name": "Jordan Ellis-Moore", "title": "Facilities Director", "company": "Northern Lakes University", "email": "Jordan.Ellis-Moore@nlu.edu", "phones": ["715.555.0120"] } },
  { "lines": ["Maria del Carmen Ruiz", "Executive Director", "Teatro Esperanza", "maria@teatroesperanza.org"],
    "expect": { "name": "Maria del Carmen Ruiz", "title": "Executive Director", "company": "Teatro Esperanza", "email": "maria@teatroesperanza.org" } },
  { "lines": ["BRIGHTWAVE", "LIGHTING & RIGGING", "Chris Tan", "Account Manager", "chris.tan@brightwave.co", "+1 (262) 555-0177"],
    "expect": { "name": "Chris Tan", "title": "Account Manager", "email": "chris.tan@brightwave.co", "phones": ["+1 (262) 555-0177"] } },
  { "lines": ["Leah Brandt, CTS", "AV Systems Engineer", "Summit Integration Group", "lbrandt@summitig.com", "608.555.0155"],
    "expect": { "name": "Leah Brandt", "title": "AV Systems Engineer", "company": "Summit Integration Group", "email": "lbrandt@summitig.com", "phones": ["608.555.0155"] } },
  { "lines": ["Ray Okafor", "Stage Manager", "ray.okafor@gmail.com", "414-555-0166"],
    "expect": { "name": "Ray Okafor", "title": "Stage Manager", "company": "", "email": "ray.okafor@gmail.com", "phones": ["414-555-0166"] } },
  { "lines": ["Greenfield School District", "Bob Kessler", "Director of Buildings & Grounds", "bkessler@greenfield.k12.wi.us", "Cell 414.555.0190"],
    "expect": { "name": "Bob Kessler", "title": "Director of Buildings & Grounds", "company": "Greenfield School District", "email": "bkessler@greenfield.k12.wi.us", "phones": ["414.555.0190"] } },
  { "lines": ["Anne-Marie Fischer", "Resident Lighting Designer", "Lakeshore Opera Company", "afischer@lakeshoreopera.org", "lakeshoreopera.org"],
    "expect": { "name": "Anne-Marie Fischer", "title": "Resident Lighting Designer", "company": "Lakeshore Opera Company", "email": "afischer@lakeshoreopera.org", "website": "lakeshoreopera.org" } },
  { "lines": ["123 Main Street, Suite 400", "Madison, WI 53703", "Tom Becker", "Principal", "Becker Theatre Consulting", "tom@beckertc.com"],
    "expect": { "name": "Tom Becker", "title": "Principal", "company": "Becker Theatre Consulting", "email": "tom@beckertc.com" } },
  { "lines": ["THANK YOU", "Visit us at Booth 1214"],
    "expect": { "name": "", "email": "", "phones": [], "company": "", "title": "" } },
  { "lines": ["Priya Raman", "VP, Operations", "Crescent Arena", "priya@crescentarena.com", "Office: 312-555-0105", "Mobile: 312-555-0106"],
    "expect": { "name": "Priya Raman", "title": "VP, Operations", "company": "Crescent Arena", "email": "priya@crescentarena.com", "phones": ["312-555-0105", "312-555-0106"] } }
]
```

- [ ] **Step 2: Write the failing test**

In `scripts/test-booth.ts` add imports and append to `boothChecks`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCardText, type ParsedCard } from "../src/lib/booth/card-parse";
```

```ts
  // card parser — every committed sample
  const samples = JSON.parse(readFileSync(join(__dirname, "..", "docs", "booth", "card-samples.json"), "utf8")) as Array<{ lines: string[]; expect: Partial<ParsedCard> }>;
  ok(samples.length >= 15, "booth: ≥ 15 card samples");
  samples.forEach((s, i) => {
    const got = parseCardText(s.lines);
    for (const [k, want] of Object.entries(s.expect)) {
      const have = (got as Record<string, unknown>)[k];
      ok(JSON.stringify(have) === JSON.stringify(want), `booth: card sample ${i + 1} ${k} = ${JSON.stringify(have)} (want ${JSON.stringify(want)})`);
    }
  });
  ok(JSON.stringify(parseCardText([])) === JSON.stringify({ name: "", email: "", phones: [], website: "", company: "", title: "" }), "booth: empty card → blank fields");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/test-booth.ts`
Expected: FAIL, module `card-parse` not found.

- [ ] **Step 4: Write the implementation**

Create `src/lib/booth/card-parse.ts`:

```ts
/**
 * Business-card OCR lines → contact fields. Pure and rules-based (no AI, D89).
 * It never invents a value: a field it can't place stays blank, and staff
 * check every field before saving.
 *
 * Order of work: pull out the unambiguous tokens (email, website, phones),
 * drop address/marketing lines, split "Name | Title" lines, then pick the
 * title (keyword list), the company (matches the email/web domain or has a
 * corporate/venue word) and the name (2–4 name-like words) from what's left.
 */

export type ParsedCard = { name: string; email: string; phones: string[]; website: string; company: string; title: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|us|co|io|biz|info|gov))\b(?!@)/i;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,5})?/gi;
const FAX_LABEL = /\b(?:f|fax)\s*[:.]?\s*$/i;
const ADDRESS = /\b(street|st\.|avenue|ave\.?|road|rd\.|suite|ste\.?|blvd|drive|dr\.|p\.?o\.? box)\b|,\s*[A-Z]{2}\s+\d{5}/i;
const NOISE = /\b(thank you|booth|visit us)\b/i;

const TITLE_WORDS = /\b(director|manager|president|vp|vice president|owner|principal|engineer|designer|teacher|pastor|rep(?:resentative)?|sales|coordinator|supervisor|technician|stage manager|administrator|superintendent|founder|partner|ceo|cfo|coo|cto|executive|head|lead|officer|consultant|specialist|chair|dean|professor|producer)\b/i;
const COMPANY_WORDS = /\b(inc\.?|llc|ltd|corp\.?|company|co\.|group|associates|school|district|university|college|church|parish|theatre|theater|arena|center|centre|pac|opera|staging|supply|audio|lighting|rigging|integration|consulting|systems|productions?|studios?)\b/i;
const HONORIFIC = /^(mr|mrs|ms|dr|fr|rev)\.?\s+/i;
const CREDENTIAL = /,\s*(cts(?:-[di])?|pe|phd|ma|mfa|cpa|esq\.?)$/i;
const NAME_WORD = /^[A-Z][a-zA-Z'’-]+$|^(del|de|la|van|von|da|di|le)$/;

const LABEL_PREFIX = /^(?:p|o|m|t|c|tel|phone|office|mobile|cell|direct)\s*[:.]?\s*/i;

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Inc|Llc|Ltd)\b/g, (m) => (m === "Llc" ? "LLC" : m));
}

function looksLikeName(s: string): boolean {
  const words = s.replace(HONORIFIC, "").replace(CREDENTIAL, "").trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (TITLE_WORDS.test(s) || COMPANY_WORDS.test(s) || /\d|@/.test(s)) return false;
  return words.every((w) => NAME_WORD.test(titleCase(w)) || NAME_WORD.test(w));
}

function domainOf(email: string, website: string): string {
  const fromEmail = email.split("@")[1] || "";
  const host = (fromEmail || website).replace(/^https?:\/\//, "").replace(/^www\./, "");
  const parts = host.toLowerCase().split(".");
  // skip free mail
  if (["gmail", "yahoo", "outlook", "hotmail", "icloud", "aol"].includes(parts[0])) return "";
  return parts.length >= 2 ? parts[0] : "";
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseCardText(input: string[]): ParsedCard {
  const out: ParsedCard = { name: "", email: "", phones: [], website: "", company: "", title: "" };
  const rest: string[] = [];
  for (const raw of input) {
    let line = String(raw || "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const em = line.match(EMAIL);
    if (em) {
      if (!out.email) out.email = em[0];
      line = line.replace(em[0], "").trim();
    }
    // phones: keep labels out, skip numbers labelled fax
    const phoneHits = [...line.matchAll(PHONE)];
    for (const m of phoneHits) {
      const before = line.slice(0, m.index ?? 0);
      if (FAX_LABEL.test(before.trim().split(/\s{2,}|\s(?=[A-Za-z]+\s*[:.]?\s*$)/).pop() || "")) continue;
      const num = m[0].trim();
      if (!out.phones.includes(num)) out.phones.push(num);
    }
    if (phoneHits.length) line = line.replace(PHONE, "").replace(/\b(?:p|o|m|t|c|f|tel|phone|office|mobile|cell|fax|direct)\s*[:.]?/gi, "").trim();
    const url = em ? null : line.match(URL_RE);
    if (url && !out.website) {
      out.website = url[1];
      line = line.replace(url[0], "").trim();
    }
    line = line.replace(LABEL_PREFIX, "").replace(/^[|,\s]+|[|,\s]+$/g, "").trim();
    if (!line || ADDRESS.test(line) || NOISE.test(line)) continue;
    // "Name | Title" on one line
    for (const part of line.split(/\s*\|\s*/)) if (part) rest.push(part);
  }

  const dom = domainOf(out.email, out.website);
  const used = new Set<number>();

  // name first: the most name-like line
  const ni = rest.findIndex((l) => looksLikeName(l));
  if (ni >= 0) {
    used.add(ni);
    out.name = titleCase(rest[ni].replace(HONORIFIC, "").replace(CREDENTIAL, "").trim());
  }
  // company: matches the email/web domain, else the first line with a company word that isn't a title
  let ci = dom ? rest.findIndex((l, i) => !used.has(i) && squash(l).includes(dom.slice(0, Math.max(4, Math.min(dom.length, 8))))) : -1;
  if (ci < 0) ci = rest.findIndex((l, i) => !used.has(i) && COMPANY_WORDS.test(l) && !TITLE_WORDS.test(l));
  if (ci >= 0) {
    used.add(ci);
    out.company = titleCase(rest[ci]);
  }
  // title: first remaining line with a title word
  const ti = rest.findIndex((l, i) => !used.has(i) && TITLE_WORDS.test(l));
  if (ti >= 0) {
    used.add(ti);
    out.title = titleCase(rest[ti]);
  }
  return out;
}
```

- [ ] **Step 5: Run test and iterate until it passes**

Run: `npx tsx scripts/test-booth.ts`
Expected: `booth: ALL PASSED`. If a sample fails, fix the **rule** in `card-parse.ts` (never special-case a sample's text) and rerun. Every sample must pass; a sample may only be changed if its expectation is wrong for a human reader, and that change gets a one-line note in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/lib/booth/card-parse.ts docs/booth/card-samples.json scripts/test-booth.ts
git commit -m "feat(booth): rules-based business-card text parser + 16 samples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Capture model + dedupe rule (pure)

**Files:**
- Create: `src/lib/booth/capture.ts`
- Modify: `scripts/test-booth.ts`

**Interfaces:**
- Produces:
  - `INTERESTS = ["rigging","curtains","lighting","av","flame","inspections"] as const`, `type Interest`, `INTEREST_LABEL: Record<Interest,string>`
  - `TEMPERATURES = ["hot","warm","cold"] as const`, `type Temperature`
  - `type BoothCapture = { id: string; via: "card" | "booth"; showId: string | null; firstName: string; lastName: string; email: string; phone: string; company: string; title: string; interests: Interest[]; temperature: Temperature | null; notes: string; cardImage?: string; cardImagePath?: string; capturedAt: number; capturedById: string; capturedByName: string; leadId?: string; outcome?: "created" | "merged"; rev?: number }`
  - `CAPTURE_ID = /^bc_[0-9a-f]{16}$/`, `newCaptureId(randHex16: () => string): string`
  - `sanitizeCapture(raw: unknown): { ok: true; capture: BoothCapture } | { ok: false; error: string }` (needs a name and an email or phone; drops a `cardImage` that isn't a `data:image/jpeg;base64,` URL ≤ 350,000 chars)
  - `type LeadLite = { id: string; email: string; stage: string; boothCaptureIds?: string[] }`
  - `dedupeDecision(c: BoothCapture, openLeads: LeadLite[]): { kind: "merge"; leadId: string } | { kind: "new" }`
  - `alreadyRecorded(captureId: string, leads: LeadLite[]): string | null` (lead id)
  - `leadMessage(c: BoothCapture, showName: string | null): string`
  - `followUpCopy(input: { firstName: string; showName: string | null; interests: Interest[]; senderName: string }): { subject: string; body: string }`

- [ ] **Step 1: Write the failing test**

In `scripts/test-booth.ts` add:

```ts
import { alreadyRecorded, dedupeDecision, followUpCopy, leadMessage, newCaptureId, sanitizeCapture, type BoothCapture } from "../src/lib/booth/capture";
```

and append to `boothChecks`:

```ts
  // capture model
  const C = (over: Record<string, unknown> = {}) => ({ id: "bc_0123456789abcdef", via: "booth", showId: "sh_00000001", firstName: "Sarah", lastName: "Lind", email: "Sarah@Riverside.org", phone: "", company: "Riverside PAC", title: "TD", interests: ["rigging", "bogus"], temperature: "hot", notes: "wants a quote", capturedAt: 100, capturedById: "u1", capturedByName: "Jeff Chesebro", ...over });
  const good = sanitizeCapture(C());
  ok(good.ok && good.capture.email === "sarah@riverside.org" && good.capture.interests.join() === "rigging", "booth: capture sanitized (email lowered, unknown interest dropped)");
  ok(!sanitizeCapture(C({ id: "bc_x" })).ok, "booth: bad capture id refused");
  ok(!sanitizeCapture(C({ firstName: "", lastName: "" })).ok, "booth: name required");
  ok(!sanitizeCapture(C({ email: "", phone: "" })).ok, "booth: email or phone required");
  ok(sanitizeCapture(C({ email: "", phone: "414-555-0100" })).ok, "booth: phone alone is enough");
  ok(!sanitizeCapture(C({ email: "not-an-email" })).ok, "booth: malformed email refused");
  const img = sanitizeCapture(C({ cardImage: "data:image/png;base64,AAAA" }));
  ok(img.ok && img.capture.cardImage === undefined, "booth: non-JPEG card image dropped");
  const big = sanitizeCapture(C({ cardImage: "data:image/jpeg;base64," + "A".repeat(400_000) }));
  ok(big.ok && big.capture.cardImage === undefined, "booth: oversized card image dropped");
  ok(sanitizeCapture(C({ temperature: "lukewarm" })).ok && (sanitizeCapture(C({ temperature: "lukewarm" })) as { capture: BoothCapture }).capture.temperature === null, "booth: unknown temperature → null");
  ok(newCaptureId(() => "0123456789abcdef") === "bc_0123456789abcdef", "booth: capture id shape");

  const cap = (good as { capture: BoothCapture }).capture;
  const leads = [
    { id: "L-1100", email: "SARAH@riverside.org", stage: "lost" },
    { id: "L-1101", email: "sarah@riverside.org", stage: "contacted" },
  ];
  const dd = dedupeDecision(cap, leads);
  ok(dd.kind === "merge" && dd.leadId === "L-1101", "booth: an open lead with the same email is merged into");
  ok(dedupeDecision(cap, [{ id: "L-1", email: "sarah@riverside.org", stage: "won" }]).kind === "new", "booth: won/lost leads are not merged into");
  ok(dedupeDecision({ ...cap, email: "" }, [{ id: "L-1", email: "", stage: "new" }]).kind === "new", "booth: phone-only never merges");
  ok(alreadyRecorded(cap.id, [{ id: "L-7", email: "", stage: "new", boothCaptureIds: [cap.id] }]) === "L-7" && alreadyRecorded(cap.id, leads) === null, "booth: alreadyRecorded finds the lead holding the capture");
  const msg = leadMessage(cap, "LDI 2026");
  ok(msg.includes("Met at LDI 2026") && msg.includes("Interests: Rigging") && msg.includes("wants a quote") && msg.includes("Temperature: Hot"), "booth: lead message");
  ok(leadMessage({ ...cap, interests: [], notes: "", temperature: null }, null) === "Met at a trade show", "booth: lead message with nothing extra");
  const fu = followUpCopy({ firstName: "Sarah", showName: "LDI 2026", interests: ["rigging", "lighting"], senderName: "Jeff Chesebro" });
  ok(fu.subject === "Great meeting you at LDI 2026" && fu.body.startsWith("Hi Sarah,") && fu.body.includes("rigging and lighting") && fu.body.trimEnd().endsWith("Jeff Chesebro"), "booth: follow-up copy");
  ok(followUpCopy({ firstName: "", showName: null, interests: [], senderName: "Jeff" }).subject === "Great meeting you", "booth: follow-up copy without a show");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-booth.ts`
Expected: FAIL, module `capture` not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/booth/capture.ts`:

```ts
/**
 * Trade show booth capture — the record every capture path produces (the
 * public card page's share-back, staff Booth mode, a scanned card), the
 * dedupe rule, and the copy written onto the lead and the follow-up draft.
 * Pure. The server path is `capture-server.ts`.
 */

export const INTERESTS = ["rigging", "curtains", "lighting", "av", "flame", "inspections"] as const;
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LABEL: Record<Interest, string> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  av: "AV",
  flame: "Flame testing",
  inspections: "Inspections",
};

export const TEMPERATURES = ["hot", "warm", "cold"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export type BoothCapture = {
  id: string; // bc_<16 hex>, minted on the device (or by the share-back route)
  via: "card" | "booth";
  showId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  interests: Interest[];
  temperature: Temperature | null;
  notes: string;
  /** On the way in only: a ≤ 250 KB JPEG data URL. The server moves it to Blob and drops it. */
  cardImage?: string;
  /** Set by the server: private Blob path (or "inline" in dev without Blob). */
  cardImagePath?: string;
  capturedAt: number;
  capturedById: string;
  capturedByName: string;
  /** Set by the server once recorded. */
  leadId?: string;
  outcome?: "created" | "merged";
  rev?: number;
};

export const CAPTURE_ID = /^bc_[0-9a-f]{16}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_IMAGE_CHARS = 350_000;

export function newCaptureId(randHex16: () => string): string {
  return "bc_" + randHex16();
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function sanitizeCapture(raw: unknown): { ok: true; capture: BoothCapture } | { ok: false; error: string } {
  const o = (raw || {}) as Record<string, unknown>;
  const id = str(o.id, 40);
  if (!CAPTURE_ID.test(id)) return { ok: false, error: "Bad capture id." };
  const firstName = str(o.firstName, 80);
  const lastName = str(o.lastName, 80);
  if (!firstName && !lastName) return { ok: false, error: "Add a name." };
  const email = str(o.email, 200).toLowerCase();
  const phone = str(o.phone, 40);
  if (!email && !phone) return { ok: false, error: "Add an email or a phone number." };
  if (email && !EMAIL.test(email)) return { ok: false, error: "That email doesn't look right." };
  const interests = Array.isArray(o.interests)
    ? INTERESTS.filter((k) => (o.interests as unknown[]).includes(k))
    : [];
  const temperature = (TEMPERATURES as readonly string[]).includes(o.temperature as string) ? (o.temperature as Temperature) : null;
  const img = typeof o.cardImage === "string" && o.cardImage.startsWith("data:image/jpeg;base64,") && o.cardImage.length <= MAX_IMAGE_CHARS ? o.cardImage : undefined;
  const showId = typeof o.showId === "string" && /^sh_[0-9a-f]{8}$/.test(o.showId) ? o.showId : null;
  const capturedAt = typeof o.capturedAt === "number" && Number.isFinite(o.capturedAt) ? o.capturedAt : 0;
  const capture: BoothCapture = {
    id,
    via: o.via === "card" ? "card" : "booth",
    showId,
    firstName,
    lastName,
    email,
    phone,
    company: str(o.company, 160),
    title: str(o.title, 120),
    interests,
    temperature,
    notes: str(o.notes, 4000),
    ...(img ? { cardImage: img } : {}),
    capturedAt,
    capturedById: str(o.capturedById, 80),
    capturedByName: str(o.capturedByName, 120),
  };
  return { ok: true, capture };
}

export type LeadLite = { id: string; email: string; stage: string; boothCaptureIds?: string[] };

const OPEN = new Set(["new", "contacted", "qualified", "quoted"]);

export function dedupeDecision(c: BoothCapture, openLeads: LeadLite[]): { kind: "merge"; leadId: string } | { kind: "new" } {
  if (!c.email) return { kind: "new" };
  const hit = openLeads.find((l) => OPEN.has(l.stage) && (l.email || "").trim().toLowerCase() === c.email);
  return hit ? { kind: "merge", leadId: hit.id } : { kind: "new" };
}

export function alreadyRecorded(captureId: string, leads: LeadLite[]): string | null {
  return leads.find((l) => (l.boothCaptureIds || []).includes(captureId))?.id ?? null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function leadMessage(c: BoothCapture, showName: string | null): string {
  const parts = [showName ? `Met at ${showName}` : "Met at a trade show"];
  if (c.interests.length) parts.push("Interests: " + c.interests.map((k) => INTEREST_LABEL[k]).join(", "));
  if (c.temperature) parts.push("Temperature: " + cap(c.temperature));
  if (c.notes) parts.push(c.notes);
  return parts.join("\n");
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
}

export function followUpCopy(input: { firstName: string; showName: string | null; interests: Interest[]; senderName: string }): { subject: string; body: string } {
  const subject = input.showName ? `Great meeting you at ${input.showName}` : "Great meeting you";
  const hi = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const about = input.interests.length
    ? `I'd be glad to follow up on ${list(input.interests.map((k) => INTEREST_LABEL[k].toLowerCase()))} for your space.`
    : "I'd be glad to help with whatever your space needs next.";
  const where = input.showName ? ` at ${input.showName}` : "";
  const body = `${hi}\n\nThanks for stopping by our booth${where}. ${about} My contact card is attached so you have my direct line.\n\nWhat's a good time for a quick call this week or next?\n\n${input.senderName}\n`;
  return { subject, body };
}
```

Note: confirm the open stages against `OPEN_STAGES` in `src/lib/stores/leads.ts` (line ~56) and copy that exact list into `OPEN` if it differs. Importing it from the store isn't possible because this file must stay pure (the store imports the DB).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-booth.ts`
Expected: `booth: ALL PASSED`

- [ ] **Step 5: Commit**

```bash
git add src/lib/booth/capture.ts scripts/test-booth.ts
git commit -m "feat(booth): capture model, dedupe rule, lead + follow-up copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Storage — booth_captures table, lead fields, blob stores

**Files:**
- Modify: `src/db/doc-tables.ts` (new `boothCaptures` docTable after `recordParties` ~line 112; `booth_captures` in `DOC_TABLES` after `record_parties` ~line 164; `"booth_captures"` appended to `SYNCABLE_COLLECTIONS` ~line 200)
- Modify: `src/lib/sync/engine.ts:32-42` (`FIELD_COLLECTIONS` gains `"booth_captures"`)
- Create: `drizzle/0042_booth_captures.sql` (+ the `drizzle/meta/` snapshot/journal that `npm run db:generate` writes)
- Modify: `src/lib/stores/leads.ts` (`LeadRecord` optional fields)
- Create: `src/lib/stores/booth.ts`
- Modify: `scripts/test-booth.ts`

**Interfaces:**
- Consumes: `sanitizeShows`, `applyShowOp`, `ShowOp`, `sanitizeCards`, `normalizeSlug`, `slugProblem` (Task 1); `BoothCapture` (Task 4).
- Produces:
  - `LeadRecord` gains `eventId?: string; interests?: string[]; temperature?: "hot" | "warm" | "cold" | null; boothCaptureIds?: string[]`
  - `listShows(): Promise<Show[]>`, `getActiveShow(): Promise<Show | null>`, `writeShow(op: ShowOp): Promise<ShowOpResult>`
  - `listCards(): Promise<ContactCards>`, `cardUserId(slug: string): Promise<string | null>`, `setCard(slug: string, userId: string | null): Promise<{ ok: true } | { ok: false; error: string }>`
  - `getCapture(id: string): Promise<BoothCapture | null>`, `listCapturesForShow(showId: string): Promise<BoothCapture[]>`

- [ ] **Step 1: Write the failing DB test**

Replace the body of `boothDbChecks` in `scripts/test-booth.ts`:

```ts
import { listShows, getActiveShow, writeShow, listCards, cardUserId, setCard } from "../src/lib/stores/booth";
import { SYNCABLE_COLLECTIONS, DOC_TABLES } from "../src/db/doc-tables";
import { FIELD_COLLECTIONS } from "../src/lib/sync/engine";
```

```ts
export async function boothDbChecks(ok: Ok) {
  ok("booth_captures" in DOC_TABLES && SYNCABLE_COLLECTIONS.includes("booth_captures"), "booth: booth_captures is a syncable doc table");
  ok((FIELD_COLLECTIONS as readonly string[]).includes("booth_captures"), "booth: device mirrors booth_captures");

  const a = await writeShow({ kind: "upsert", show: { name: "Test Show A" } });
  const b = await writeShow({ kind: "upsert", show: { name: "Test Show B" } });
  ok(a.ok && b.ok && (await listShows()).length >= 2, "booth: shows persist");
  await writeShow({ kind: "activate", id: (a as { id: string }).id });
  await writeShow({ kind: "activate", id: (b as { id: string }).id });
  ok((await getActiveShow())?.id === (b as { id: string }).id && (await listShows()).filter((s) => s.active).length === 1, "booth: one active show in storage");

  ok((await setCard("Jeff", "u1")).ok && (await cardUserId("jeff")) === "u1", "booth: card slug stored normalized");
  ok(!(await setCard("bad slug", "u1")).ok, "booth: bad slug refused");
  await setCard("jeff", null);
  ok((await cardUserId("jeff")) === null && !("jeff" in (await listCards())), "booth: card removed");
  await writeShow({ kind: "deactivate" });
}
```

Run: `npm run test:specs 2>&1 | grep -E "booth|PASSED|FAIL" | tail -5`
Expected: FAIL (module `../src/lib/stores/booth` not found).

- [ ] **Step 2: Add the doc table and sync lists**

In `src/db/doc-tables.ts` after the `recordParties` line:

```ts
export const boothCaptures = docTable("booth_captures"); // Trade show booth capture — one visitor captured at a booth (Booth mode or the card page's share-back), id bc_<16 hex> minted on the device; recordBoothCapture turns it into a lead (docs/superpowers/specs/2026-10-28-trade-show-booth-capture-design.md); migration 0042_booth_captures
```

In `DOC_TABLES` after `record_parties: recordParties,`:

```ts
  booth_captures: boothCaptures,
```

In `SYNCABLE_COLLECTIONS`, append `"booth_captures",` after `"findings",`. In `src/lib/sync/engine.ts` `FIELD_COLLECTIONS`, append `"booth_captures",` after `"findings",`.

- [ ] **Step 3: Generate and harden the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0042_*.sql` + updated `drizzle/meta/_journal.json` and a snapshot. Rename the SQL file to `drizzle/0042_booth_captures.sql` and update its `tag` in `_journal.json` to `0042_booth_captures`. Replace its contents with the idempotent form (D141):

```sql
-- Trade show booth capture — one doc collection: booth_captures.
--
--  - One row per visitor captured at a booth; id bc_<16 hex> is minted on the device so an
--    offline capture keeps its id through the outbox. recordBoothCapture (src/lib/booth/capture-server.ts)
--    turns it into a lead; the doc then carries leadId + outcome.
--  - One expression index serves the only lookup: a show's captures (doc->>'showId').
--
-- Generated by drizzle-kit, then hardened so it is idempotent per D141 (the shared Neon
-- database is migrated by more than one branch's build).
CREATE TABLE IF NOT EXISTS "booth_captures" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_captures_seq_idx" ON "booth_captures" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_captures_deleted_idx" ON "booth_captures" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_captures_show_id_idx" ON "booth_captures" USING btree (("doc"->>'showId'));--> statement-breakpoint
CREATE OR REPLACE TRIGGER booth_captures_seq_bump BEFORE UPDATE ON "booth_captures" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```

If drizzle-kit didn't emit the `showId` index, add it to the `docTable` definition only if other per-collection expression indexes are declared there. Otherwise the SQL alone is the source, as in `0041_record_parties.sql`.

- [ ] **Step 4: Lead fields**

In `src/lib/stores/leads.ts`, inside `interface LeadRecord`, after `estNo?: number;`:

```ts
  /** Trade show booth capture — the show (`sh_…`, settings blob trade_shows) this lead was met at. */
  eventId?: string;
  /** Booth capture interest keys (src/lib/booth/capture.ts INTERESTS). */
  interests?: string[];
  temperature?: "hot" | "warm" | "cold" | null;
  /** Every booth capture recorded into this lead — recordBoothCapture's idempotency key. */
  boothCaptureIds?: string[];
```

- [ ] **Step 5: The store**

Create `src/lib/stores/booth.ts`:

```ts
import { randomBytes } from "node:crypto";
import { getBlob, getDoc, listDocsByField, updateBlob } from "@/db/doc-store";
import { applyShowOp, activeShow, normalizeSlug, sanitizeCards, sanitizeShows, slugProblem, type ContactCards, type Show, type ShowOp, type ShowOpResult } from "@/lib/booth/shows";
import type { BoothCapture } from "@/lib/booth/capture";

/**
 * Trade show booth capture store. Two settings blobs, no table (the
 * narrative_intros idiom), each write ONE op under the blob's row lock:
 *   trade_shows     { shows: Show[] }
 *   contact_cards   { cards: { [slug]: userId } }
 * plus reads of the booth_captures doc collection.
 */

const SHOWS_BLOB = "trade_shows";
const CARDS_BLOB = "contact_cards";

export async function listShows(): Promise<Show[]> {
  const row = await getBlob<Record<string, unknown>>(SHOWS_BLOB, {});
  return sanitizeShows(row.shows);
}

export async function getActiveShow(): Promise<Show | null> {
  return activeShow(await listShows());
}

export async function writeShow(op: ShowOp): Promise<ShowOpResult> {
  const now = Date.now();
  const out: { res?: ShowOpResult } = {};
  await updateBlob(SHOWS_BLOB, (raw) => {
    const res = applyShowOp(sanitizeShows(raw.shows), op, now, () => "sh_" + randomBytes(4).toString("hex"));
    out.res = res;
    return res.ok ? { shows: res.list } : null;
  });
  return out.res!;
}

export async function listCards(): Promise<ContactCards> {
  const row = await getBlob<Record<string, unknown>>(CARDS_BLOB, {});
  return sanitizeCards(row.cards);
}

export async function cardUserId(slug: string): Promise<string | null> {
  return (await listCards())[normalizeSlug(slug)] ?? null;
}

/** userId null removes the slug. One slug → one user; a user may hold one slug (an earlier one is removed). */
export async function setCard(slug: string, userId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = normalizeSlug(slug);
  const problem = slugProblem(s);
  if (problem) return { ok: false, error: problem };
  await updateBlob(CARDS_BLOB, (raw) => {
    const cards = sanitizeCards(raw.cards);
    if (userId) for (const [k, v] of Object.entries(cards)) if (v === userId) delete cards[k];
    if (userId) cards[s] = userId;
    else delete cards[s];
    return { cards };
  });
  return { ok: true };
}

export async function getCapture(id: string): Promise<BoothCapture | null> {
  return getDoc<BoothCapture & { id: string }>("booth_captures", id);
}

export async function listCapturesForShow(showId: string): Promise<BoothCapture[]> {
  const rows = await listDocsByField<BoothCapture & { id: string }>("booth_captures", "showId", showId);
  return rows.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
}
```

Check `listDocsByField`'s real signature at `src/db/doc-store.ts:335` before relying on it. If it takes different arguments, use `listDocsWhere("booth_captures", { field: "showId", eq: showId })` with the `DocCond` shape defined at line 102.

If `updateBlob` **merges** the returned object into the stored row (read lines 1000–1018), then `delete cards[k]` is still correct because the whole `cards` object is returned and replaces the key.

- [ ] **Step 6: Run tests**

Run: `npm run test:specs 2>&1 | tail -3` and `npx tsc --noEmit`
Expected: `ALL PASSED`, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/doc-tables.ts src/lib/sync/engine.ts drizzle/ src/lib/stores/leads.ts src/lib/stores/booth.ts scripts/test-booth.ts
git commit -m "feat(booth): booth_captures table (0042), lead booth fields, shows + card stores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The one capture path — recordBoothCapture, follow-up draft, sync push

**Files:**
- Create: `src/lib/booth/capture-server.ts`
- Create: `src/lib/booth/followup-server.ts`
- Modify: `src/app/api/sync/push/route.ts` (a `booth_captures` branch next to the `surveys` branch ~line 118)
- Modify: `scripts/test-booth.ts`

**Interfaces:**
- Consumes: Task 4 (`sanitizeCapture`, `dedupeDecision`, `alreadyRecorded`, `leadMessage`, `followUpCopy`, `BoothCapture`); Task 5 (`getCapture`, `listShows`); leads store `create`, `update`, `logActivity`, `getAll`; `contactByEmail` (`src/lib/identity/lookup.ts`); `blobEnabled`, `putBlob`, `dataUrlToBytes` (`src/lib/blob.ts`); comms `saveDraft`, `findDraftByLink`; `mailboxViewer` (the import `renewal-outreach.ts` uses); `buildVCard`; `getUser`.
- Produces:
  - `recordBoothCapture(raw: unknown, actor: { id: string; name: string }, opts?: { ownerName?: string }): Promise<{ ok: true; leadId: string; outcome: "created" | "merged"; capture: BoothCapture } | { ok: false; error: string }>`
  - `pushBoothCapture(rec: { id: string; rev?: number; doc: Record<string, unknown> }, user: { id: string; name: string; roles: string[] | null | undefined }): Promise<{ id: string; status: "ok" | "error" | "retry"; rev?: number; error?: string }>`
  - `createShareBackDraft(input: { leadId: string; capture: BoothCapture; owner: { id: string; name: string } }): Promise<string | null>` (thread id, or null when no email)

- [ ] **Step 1: Write the failing DB test**

Append to `boothDbChecks` in `scripts/test-booth.ts` (imports at the top):

```ts
import { recordBoothCapture } from "../src/lib/booth/capture-server";
import { get as getLead } from "../src/lib/stores/leads";
import { getCapture } from "../src/lib/stores/booth";
```

```ts
  // recordBoothCapture — create, idempotent replay, merge into an open lead
  const show = await writeShow({ kind: "upsert", show: { name: "Booth DB Show" } });
  const showId = (show as { id: string }).id;
  await writeShow({ kind: "activate", id: showId });
  const actor = { id: "u-booth", name: "Booth Tester" };
  const cap1 = { id: "bc_00000000000000a1", via: "booth", showId, firstName: "Pat", lastName: "Visitor", email: "pat.visitor@example.org", phone: "", company: "Visitor Hall", title: "TD", interests: ["rigging"], temperature: "hot", notes: "", capturedAt: Date.now(), capturedById: actor.id, capturedByName: actor.name };
  const r1 = await recordBoothCapture(cap1, actor);
  ok(r1.ok && r1.outcome === "created", "booth: first capture creates a lead");
  const lead1 = r1.ok ? await getLead(r1.leadId) : null;
  ok(!!lead1 && lead1.source === "event" && lead1.eventId === showId && lead1.owner === actor.name && (lead1.boothCaptureIds || []).includes(cap1.id) && lead1.contact === "Pat Visitor" && lead1.org === "Visitor Hall", "booth: lead fields");
  const r1b = await recordBoothCapture(cap1, actor);
  ok(r1b.ok && r1.ok && r1b.leadId === r1.leadId, "booth: replaying the same capture returns the same lead");
  ok((await getCapture(cap1.id))?.leadId === (r1.ok ? r1.leadId : ""), "booth: capture doc stamped with its lead");
  const cap2 = { ...cap1, id: "bc_00000000000000a2", email: "PAT.VISITOR@example.org", notes: "came back day 2" };
  const r2 = await recordBoothCapture(cap2, actor);
  ok(r2.ok && r1.ok && r2.outcome === "merged" && r2.leadId === r1.leadId, "booth: same email → merged into the open lead");
  const merged = r1.ok ? await getLead(r1.leadId) : null;
  ok(!!merged && (merged.boothCaptureIds || []).length === 2 && merged.activities.some((a) => a.note.includes("Met again at Booth DB Show") && a.note.includes("came back day 2")), "booth: merge logs Met again with notes");
  const bad = await recordBoothCapture({ ...cap1, id: "bc_00000000000000a3", firstName: "", lastName: "" }, actor);
  ok(!bad.ok, "booth: an invalid capture is refused");
  await writeShow({ kind: "deactivate" });
```

Run: `npm run test:specs 2>&1 | grep -E "booth|FAIL" | tail -5`
Expected: FAIL, module `capture-server` not found.

- [ ] **Step 2: Implement recordBoothCapture**

Create `src/lib/booth/capture-server.ts`:

```ts
import { getDoc, upsertDoc } from "@/db/doc-store";
import { blobEnabled, dataUrlToBytes, putBlob } from "@/lib/blob";
import { contactByEmail } from "@/lib/identity/lookup";
import { can } from "@/lib/team";
import { create as createLead, getAll as allLeads, logActivity, update as updateLead } from "@/lib/stores/leads";
import { listShows } from "@/lib/stores/booth";
import { alreadyRecorded, dedupeDecision, leadMessage, sanitizeCapture, type BoothCapture } from "./capture";

/**
 * The one server path every booth capture takes: the public card page's
 * share-back, a Booth-mode save online, and a Booth-mode capture pushed from
 * the offline outbox. Idempotent by capture id — the lead stores every
 * capture id it holds (`boothCaptureIds`), so a retry after a crash at any
 * point finds the lead instead of minting a second one.
 */

type Actor = { id: string; name: string };
export type RecordResult = { ok: true; leadId: string; outcome: "created" | "merged"; capture: BoothCapture } | { ok: false; error: string };

async function storeCardImage(c: BoothCapture): Promise<BoothCapture> {
  if (!c.cardImage) return c;
  if (!blobEnabled()) {
    // Local dev without Blob keeps the (already small) data URL on the doc.
    return { ...c, cardImagePath: "inline" };
  }
  const { bytes } = dataUrlToBytes(c.cardImage);
  const { pathname } = await putBlob(`booth/${c.id}.jpg`, bytes, "image/jpeg");
  const { cardImage: _drop, ...rest } = c;
  return { ...rest, cardImagePath: pathname };
}

export async function recordBoothCapture(raw: unknown, actor: Actor, opts: { ownerName?: string } = {}): Promise<RecordResult> {
  const s = sanitizeCapture(raw);
  if (!s.ok) return s;
  let capture = s.capture;

  const prior = await getDoc<BoothCapture & { id: string }>("booth_captures", capture.id);
  // Never let a later push swap an image already stored, and keep who first captured it.
  if (prior?.cardImagePath) {
    const { cardImage: _x, ...rest } = capture;
    capture = { ...rest, cardImagePath: prior.cardImagePath };
  } else {
    capture = await storeCardImage(capture);
  }
  if (prior) capture = { ...capture, capturedById: prior.capturedById || capture.capturedById, capturedByName: prior.capturedByName || capture.capturedByName };
  if (!capture.capturedById) capture = { ...capture, capturedById: actor.id, capturedByName: actor.name };
  if (!capture.capturedAt) capture = { ...capture, capturedAt: Date.now() };

  const shows = await listShows();
  const showName = shows.find((x) => x.id === capture.showId)?.name ?? null;
  const leads = await allLeads();
  const lite = leads.map((l) => ({ id: l.id, email: l.email, stage: l.stage, boothCaptureIds: l.boothCaptureIds }));

  let leadId = alreadyRecorded(capture.id, lite);
  let outcome: "created" | "merged" = prior?.outcome ?? "created";

  if (!leadId) {
    const d = dedupeDecision(capture, lite);
    if (d.kind === "merge") {
      outcome = "merged";
      leadId = d.leadId;
      const target = leads.find((l) => l.id === d.leadId)!;
      await updateLead(d.leadId, {
        boothCaptureIds: [...(target.boothCaptureIds || []), capture.id],
        interests: Array.from(new Set([...(target.interests || []), ...capture.interests])),
        ...(capture.temperature ? { temperature: capture.temperature } : {}),
        ...(!target.eventId && capture.showId ? { eventId: capture.showId } : {}),
      });
      const note = `Met again at ${showName || "a trade show"}` + (capture.notes ? `\n${capture.notes}` : "");
      await logActivity(d.leadId, { type: "note", by: actor.name, note }, actor.name);
    } else {
      outcome = "created";
      const hit = capture.email ? await contactByEmail(capture.email) : null;
      const customerId = hit && "customerId" in hit ? hit.customerId : null;
      const lead = await createLead(
        {
          org: capture.company,
          contact: [capture.firstName, capture.lastName].filter(Boolean).join(" "),
          contactRole: capture.title,
          email: capture.email,
          phone: capture.phone,
          source: "event",
          owner: opts.ownerName ?? capture.capturedByName ?? actor.name,
          interest: capture.interests.join(", "),
          message: leadMessage(capture, showName),
          customerId,
        },
        actor.name
      );
      await updateLead(lead.id, {
        eventId: capture.showId ?? undefined,
        interests: capture.interests,
        temperature: capture.temperature,
        boothCaptureIds: [capture.id],
      });
      leadId = lead.id;
    }
  }

  const stored: BoothCapture & { id: string } = { ...capture, leadId, outcome, rev: (prior?.rev ?? 0) + 1 };
  delete (stored as { cardImage?: string }).cardImage;
  if (stored.cardImagePath === "inline" && capture.cardImage) (stored as { cardImage?: string }).cardImage = capture.cardImage;
  else if (prior?.cardImagePath === "inline" && (prior as { cardImage?: string }).cardImage) (stored as { cardImage?: string }).cardImage = (prior as { cardImage?: string }).cardImage;
  await upsertDoc("booth_captures", stored);
  return { ok: true, leadId, outcome, capture: stored };
}

/** /api/sync/push branch for booth_captures. A throw replies `retry` (the device tries again). */
export async function pushBoothCapture(
  rec: { id: string; rev?: number; doc: Record<string, unknown> },
  user: { id: string; name: string; roles: string[] | null | undefined }
): Promise<{ id: string; status: "ok" | "error" | "retry"; rev?: number; error?: string }> {
  if (!can("create", user.roles)) return { id: rec.id, status: "error", error: "You don't have permission to save booth captures" };
  try {
    const r = await recordBoothCapture({ ...rec.doc, id: rec.id }, { id: user.id, name: user.name });
    return r.ok ? { id: rec.id, status: "ok", rev: r.capture.rev } : { id: rec.id, status: "error", error: r.error };
  } catch (e) {
    console.error("[booth] push failed; the device will retry", rec.id, e);
    return { id: rec.id, status: "retry", error: "The server couldn't save it just now; it will try again" };
  }
}
```

Before relying on it, read `dataUrlToBytes` (`src/lib/blob.ts:212`) and the `create()` default-owner rule (`leads.ts:516`). `create` sets `owner` from `partial.owner` when it's given, which this code always passes.

- [ ] **Step 3: Wire the push route**

In `src/app/api/sync/push/route.ts`, import:

```ts
import { pushBoothCapture } from "@/lib/booth/capture-server";
```

and add a branch right after the `surveys` branch (the `if (coll === "surveys") { … continue; }` block near line 118). Follow that block's exact shape, including its `continue`:

```ts
      if (coll === "booth_captures") {
        results[coll].push(await pushBoothCapture({ id: rec.id, rev: rec.rev, doc: rec.doc }, { ...pusher, roles: session.user.roles }));
        continue;
      }
```

- [ ] **Step 4: Follow-up draft**

Create `src/lib/booth/followup-server.ts`:

```ts
import { findDraftByLink, saveDraft } from "@/lib/stores/comms";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { listShows } from "@/lib/stores/booth";
import { buildVCard, vcardFileName } from "./vcard";
import { followUpCopy, type BoothCapture } from "./capture";

/**
 * Share-back only: a follow-up draft in the card owner's own mailbox, linked
 * to the lead (deliberate link), with the owner's vCard attached. Never sent —
 * the owner reviews it in the Inbox. One draft per lead (a second share-back
 * from the same visitor reuses it).
 */
export async function createShareBackDraft(input: { leadId: string; capture: BoothCapture; owner: { id: string; name: string } }): Promise<string | null> {
  const { capture, owner } = input;
  if (!capture.email) return null;
  const existing = await findDraftByLink("lead", input.leadId, { owner: await mailboxViewer(owner) });
  if (existing) return existing.id;
  const [user, settings, shows] = await Promise.all([getUser(owner.id), getSettings(), listShows()]);
  const showName = shows.find((s) => s.id === capture.showId)?.name ?? null;
  const copy = followUpCopy({ firstName: capture.firstName, showName, interests: capture.interests, senderName: owner.name });
  const vcf = buildVCard({
    name: owner.name,
    org: settings.companyName || "Peak Systems Group",
    title: user?.title || "",
    workPhone: user?.phone || "",
    cellPhone: user?.mobile || "",
    email: user?.email || "",
  });
  const thread = await saveDraft({
    mailbox: "personal",
    owner,
    customerId: null,
    customer: capture.company,
    contactName: [capture.firstName, capture.lastName].filter(Boolean).join(" "),
    to: capture.email,
    subject: copy.subject,
    body: copy.body,
    link: { type: "lead", id: input.leadId, label: capture.company || capture.email },
    attachments: [{ name: vcardFileName(owner.name), mime: "text/vcard", size: Buffer.byteLength(vcf), dataUrl: "data:text/vcard;base64," + Buffer.from(vcf).toString("base64") }],
  });
  return thread.id;
}
```

Confirm the `mailboxViewer` import path (grep `export async function mailboxViewer` under `src/lib/`; AGENTS.md names `src/lib/mailbox-viewer.ts`). Also confirm that `create()` in comms marks `linkedBy: "user"` when `link` is set (comms.ts ~line 1423). That makes the link deliberate, so the thread shows on the lead (#341).

Add a DB check (append to `boothDbChecks`):

```ts
  const { createShareBackDraft } = await import("../src/lib/booth/followup-server");
  const { allUsers } = await import("../src/lib/users");
  const u = (await allUsers())[0];
  if (u && r1.ok) {
    const t1 = await createShareBackDraft({ leadId: r1.leadId, capture: { ...(r1.capture), via: "card" }, owner: { id: u.id, name: u.name } });
    const t2 = await createShareBackDraft({ leadId: r1.leadId, capture: { ...(r1.capture), via: "card" }, owner: { id: u.id, name: u.name } });
    ok(!!t1 && t1 === t2, "booth: share-back draft created once per lead");
    ok((await createShareBackDraft({ leadId: r1.leadId, capture: { ...(r1.capture), email: "" }, owner: { id: u.id, name: u.name } })) === null, "booth: no email → no draft");
  } else ok(false, "booth: test DB has a seeded user for the draft check");
```

- [ ] **Step 5: Run tests**

Run: `npm run test:specs 2>&1 | tail -3` and `npx tsc --noEmit`
Expected: `ALL PASSED`, no type errors. If the test DB has no seeded users, use the fixture helpers in `scripts/test-fixtures.ts` (as `test-parties.ts` does) to create one, rather than skipping.

- [ ] **Step 6: Commit**

```bash
git add src/lib/booth/capture-server.ts src/lib/booth/followup-server.ts src/app/api/sync/push/route.ts scripts/test-booth.ts
git commit -m "feat(booth): recordBoothCapture (idempotent create/merge), sync push branch, share-back draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Public card page, vCard download, share-back API

**Files:**
- Create: `src/app/c/[slug]/page.tsx`
- Create: `src/app/c/[slug]/share-back-form.tsx`
- Create: `src/app/c/[slug]/vcard/route.ts`
- Create: `src/app/api/booth/share-back/route.ts`
- Modify: `src/middleware.ts:37` (exempt `c/` and `api/booth/share-back`)
- Modify: `scripts/smoke-routes.ts` (signed-out public routes)

**Interfaces:**
- Consumes: `cardUserId`, `getActiveShow` (Task 5); `recordBoothCapture` (Task 6); `createShareBackDraft` (Task 6); `buildVCard`, `vcardFileName` (Task 2); `INTERESTS`, `INTEREST_LABEL`, `newCaptureId` (Task 4); `getUser`; `getSettings`; `rateLimit`, `rateLimitRefund`, `clientIp`.
- Produces: `GET /c/[slug]`, `GET /c/[slug]/vcard`, `POST /api/booth/share-back` with body `{ slug, firstName, lastName, email, phone, company, interests, notes, company_website }` → `201 { ok: true }` | `400` | `404` | `429` | `503`.

- [ ] **Step 1: Read the Next docs for this version**

Run: `ls node_modules/next/dist/docs/` and read the guides on dynamic route params (`params` is a Promise in this version, as in `src/app/(app)/leads/page.tsx:234`) and on Route Handlers.

- [ ] **Step 2: Middleware exemption**

In `src/middleware.ts:37`, add `c/|api/booth/share-back|` right after `lead-intake|` inside the negative lookahead:

```ts
    "/((?!api/auth|api/native/auth|api/leads/intake|api/booth/share-back|api/gmail/sync|api/triage/build|api/drive/sync|api/recordings/upload|login|lead-intake|c/|portal|print/|share/|d/ds/|pdf\\.worker\\.min\\.mjs|placeholders/|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icons|images).*)",
```

(`c/` only matches a path starting `/c/`. `/calendar`, `/catalog` and `/customers` still require sign-in.)

- [ ] **Step 3: vCard route**

Create `src/app/c/[slug]/vcard/route.ts`:

```ts
import { cardUserId } from "@/lib/stores/booth";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { buildVCard, vcardFileName } from "@/lib/booth/vcard";

export const dynamic = "force-dynamic";

/** Public: the card owner's vCard (Save contact). Photo fetched server-side, ≤ 200 KB, omitted on any failure. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const userId = await cardUserId(slug);
  const user = userId ? await getUser(userId) : null;
  if (!user || user.status !== "active") return new Response("Not found", { status: 404 });
  const settings = await getSettings();
  let photo: string | undefined;
  if (user.photoUrl) {
    try {
      const res = await fetch(user.photoUrl, { signal: AbortSignal.timeout(4000) });
      const type = res.headers.get("content-type") || "";
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && type.includes("jpeg") && buf.length <= 200_000) photo = buf.toString("base64");
    } catch {
      photo = undefined;
    }
  }
  const vcf = buildVCard({
    name: user.name,
    org: settings.companyName || "Peak Systems Group",
    title: user.title || "",
    workPhone: user.phone || "",
    cellPhone: user.mobile || "",
    email: user.email,
    url: (settings as { website?: string }).website || "",
    photoJpegBase64: photo,
  });
  return new Response(vcf, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${vcardFileName(user.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

Check `AppSettingsData` (`src/lib/settings.ts:35`) for a website field. If there's none, drop the `url` line rather than adding a setting.

`user.photoUrl` is a Google profile URL from the roster, not user input, so this fetch isn't an SSRF vector. Still, if the codebase's `guardedFetchBytes` (`src/lib/venue-calendar-fetch.ts`) fits, use it.

- [ ] **Step 4: Share-back API**

Create `src/app/api/booth/share-back/route.ts`:

```ts
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, rateLimitRefund, clientIp } from "@/lib/rate-limit";
import { cardUserId, getActiveShow } from "@/lib/stores/booth";
import { getUser } from "@/lib/users";
import { INTERESTS, newCaptureId } from "@/lib/booth/capture";
import { recordBoothCapture } from "@/lib/booth/capture-server";
import { createShareBackDraft } from "@/lib/booth/followup-server";

/**
 * Public: a visitor who tapped the NFC card sends their info back. Same
 * guards as /api/leads/intake — honeypot, length caps, per-IP rate limit,
 * same-email dedup window. Becomes a lead (source event, the active show,
 * owned by the card's user) + a follow-up DRAFT in that user's Inbox.
 */

const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60 * 1000;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

const Body = z.object({
  slug: z.string().trim().min(1).max(40),
  firstName: z.string().trim().max(80).optional().default(""),
  lastName: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().max(200).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  company: z.string().trim().max(160).optional().default(""),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional().default([]),
  notes: z.string().trim().max(2000).optional().default(""),
  company_website: z.string().max(0).optional().default(""), // honeypot
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ip = clientIp(req) || "unknown";
  const gate = rateLimit(`booth:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!gate.ok) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) } });

  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid fields" }, { status: 400 });
  const f = parsed.data;
  const userId = await cardUserId(f.slug);
  const owner = userId ? await getUser(userId) : null;
  if (!owner || owner.status !== "active") return NextResponse.json({ error: "not found" }, { status: 404 });

  const dedupKey = `booth:dup:${f.email.toLowerCase() || f.phone}:${f.slug}`;
  if (!rateLimit(dedupKey, 1, DEDUP_WINDOW_MS).ok) return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });

  const show = await getActiveShow();
  const actor = { id: owner.id, name: owner.name };
  try {
    const r = await recordBoothCapture(
      {
        id: newCaptureId(() => randomBytes(8).toString("hex")),
        via: "card",
        showId: show?.id ?? null,
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.email,
        phone: f.phone,
        company: f.company,
        title: "",
        interests: f.interests,
        temperature: null,
        notes: f.notes,
        capturedAt: Date.now(),
        capturedById: owner.id,
        capturedByName: owner.name,
      },
      actor,
      { ownerName: owner.name }
    );
    if (!r.ok) {
      rateLimitRefund(dedupKey);
      return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    try {
      await createShareBackDraft({ leadId: r.leadId, capture: r.capture, owner: actor });
    } catch (e) {
      console.error("[booth] share-back draft failed; the lead stands", r.leadId, e);
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error("[booth] share-back failed", e);
    rateLimitRefund(dedupKey);
    return NextResponse.json({ ok: false, error: "Could not send that. Please try again." }, { status: 503 });
  }
}
```

- [ ] **Step 5: The card page**

Create `src/app/c/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cardUserId } from "@/lib/stores/booth";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import ShareBackForm from "./share-back-form";

/**
 * Public contact card — what Jeff's NFC card (and its QR) opens. No auth, no
 * nav (middleware exempts /c/). Save contact downloads a vCard; Send me your
 * info becomes a lead + a follow-up draft (api/booth/share-back).
 */

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const id = await cardUserId(slug);
  const user = id ? await getUser(id) : null;
  return user && user.status === "active" ? user : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const user = await load((await params).slug);
  const s = await getSettings();
  return { title: user ? `${user.name} — ${s.companyName || "Peak Systems Group"}` : "Contact card", robots: { index: false } };
}

export default async function ContactCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await load(slug);
  if (!user) notFound();
  const s = await getSettings();
  const company = s.companyName || "Peak Systems Group";
  return (
    <main style={{ minHeight: "100vh", background: "#edeef1", fontFamily: "var(--font-ui)", color: "#16181d", padding: "24px 16px" }}>
      <div style={{ maxWidth: 440, margin: "0 auto", display: "grid", gap: 16 }}>
        <section className="pk-card" style={{ padding: 20, textAlign: "center", display: "grid", gap: 8 }}>
          {user.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoUrl} alt="" width={96} height={96} style={{ borderRadius: "50%", margin: "0 auto", objectFit: "cover" }} />
          ) : (
            <div aria-hidden style={{ width: 96, height: 96, borderRadius: "50%", margin: "0 auto", background: user.color, color: "#fff", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 700 }}>{user.initials}</div>
          )}
          <h1 style={{ fontSize: 22, margin: 0 }}>{user.name}</h1>
          {user.title ? <div style={{ color: "#5b616e" }}>{user.title}</div> : null}
          <div style={{ fontWeight: 600 }}>{company}</div>
          <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
            {user.mobile ? <a href={`tel:${user.mobile}`}>{user.mobile} (mobile)</a> : null}
            {user.phone ? <a href={`tel:${user.phone}`}>{user.phone} (office)</a> : null}
            <a href={`mailto:${user.email}`}>{user.email}</a>
          </div>
          <a className="pk-btn pk-btn-primary" href={`/c/${slug}/vcard`} style={{ marginTop: 10 }}>Save contact</a>
        </section>
        <ShareBackForm slug={slug} firstName={user.name.split(" ")[0]} />
      </div>
    </main>
  );
}
```

Use the real button/card class names from `src/app/globals.css` (grep `.pk-btn`, `.pk-card`). The ones above are placeholders for whatever the stylesheet defines. Match `/lead-intake`'s visual style.

Create `src/app/c/[slug]/share-back-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { INTERESTS, INTEREST_LABEL, type Interest } from "@/lib/booth/capture";

export default function ShareBackForm({ slug, firstName }: { slug: string; firstName: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const phone = String(fd.get("phone") || "").trim();
    if (!String(fd.get("firstName") || "").trim() && !String(fd.get("lastName") || "").trim()) return setError("Add your name."), setState("error");
    if (!email && !phone) return setError("Add an email or a phone number."), setState("error");
    setState("sending");
    try {
      const res = await fetch("/api/booth/share-back", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          firstName: fd.get("firstName"),
          lastName: fd.get("lastName"),
          email,
          phone,
          company: fd.get("company"),
          interests,
          notes: fd.get("notes"),
          company_website: fd.get("company_website"),
        }),
      });
      if (res.ok) return setState("sent");
      setError(res.status === 429 ? "Too many tries — wait a few minutes." : "Couldn't send that. Please try again.");
      setState("error");
    } catch {
      setError("No connection — please try again.");
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <section className="pk-card" style={{ padding: 20, textAlign: "center" }}>
        <h2 style={{ margin: "0 0 6px" }}>Thanks — I&apos;ll be in touch.</h2>
        <a href={`/c/${slug}/vcard`}>Save my contact</a>
      </section>
    );

  return (
    <form onSubmit={submit} className="pk-card" style={{ padding: 20, display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Send {firstName} your info</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input name="firstName" placeholder="First name" autoComplete="given-name" maxLength={80} />
        <input name="lastName" placeholder="Last name" autoComplete="family-name" maxLength={80} />
      </div>
      <input name="email" type="email" placeholder="Email" autoComplete="email" maxLength={200} />
      <input name="phone" type="tel" placeholder="Phone" autoComplete="tel" maxLength={40} />
      <input name="company" placeholder="Organization / venue" autoComplete="organization" maxLength={160} />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13, color: "#5b616e", marginBottom: 6 }}>Interested in</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {INTERESTS.map((k) => {
            const on = interests.includes(k);
            return (
              <button key={k} type="button" aria-pressed={on} className={on ? "pk-chip pk-chip-on" : "pk-chip"} onClick={() => setInterests(on ? interests.filter((x) => x !== k) : [...interests, k])}>
                {INTEREST_LABEL[k]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <textarea name="notes" placeholder="Anything we should know?" rows={3} maxLength={2000} />
      <input name="company_website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
      {state === "error" ? <div role="alert" style={{ color: "#b42318" }}>{error}</div> : null}
      <button type="submit" className="pk-btn pk-btn-primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}
```

As with the page, swap in the real chip/button classes from `globals.css`.

- [ ] **Step 6: Smoke routes**

In `scripts/smoke-routes.ts`, find how signed-out public routes such as `/lead-intake` are checked (read the file around `ROUTES` at line 50). Add `/c/jeff` (expect 404 when no card is set up, or 200 when the smoke DB seeds one; seed one if the script has a seeding step) and `/c/jeff/vcard` with the same rule. Then add `/leads/booth` and `/leads/shows` to the signed-out redirect list.

- [ ] **Step 7: Verify in the browser**

Start the dev server per the project memory (no stray `next dev`/`tsx` first: `ps aux | grep -E "next dev|tsx" | grep -v grep`). Set a card (`/leads/shows` is built in Task 8; for now run a one-off `npx tsx -e` against a **scratch** PGlite datadir, never `.data/pglite` while dev is up). Open `/c/jeff` signed out and check: the page renders, Save contact downloads `Jeff Chesebro.vcf`, and a share-back creates a lead (shown on `/leads`) plus an Inbox draft.

- [ ] **Step 8: Gate + commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:specs 2>&1 | tail -2`
Expected: all clean, `ALL PASSED`.

```bash
git add src/app/c src/app/api/booth/share-back src/middleware.ts scripts/smoke-routes.ts
git commit -m "feat(booth): public contact card page, vCard download, share-back → lead + draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Leads → Shows admin page (shows, card slug, QR)

**Files:**
- Modify: `package.json` (add `"qrcode": "1.5.4"` dependency and `"@types/qrcode"` dev dependency)
- Create: `src/app/(app)/leads/shows/page.tsx`
- Create: `src/app/(app)/leads/shows/actions.ts`
- Create: `src/app/(app)/leads/shows/shows-editor.tsx`
- Modify: `src/components/nav/nav-data.ts` (route map: `/leads/shows` and `/leads/booth` → `"leads"`)

**Interfaces:**
- Consumes: `listShows`, `writeShow`, `listCards`, `setCard` (Task 5); `allUsers`; `requirePerm`.
- Produces: server actions `saveShowAction(input: { id?: string; name: string; startAt: number | null; endAt: number | null }): Promise<{ ok: boolean; error?: string }>`, `showOpAction(op: { kind: "activate" | "archive" | "unarchive"; id: string } | { kind: "deactivate" }): Promise<{ ok: boolean; error?: string }>`, `setCardAction(slug: string, userId: string | null): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Install qrcode**

Run: `npm install qrcode@1.5.4 && npm install -D @types/qrcode`
Expected: `package.json` + `package-lock.json` updated.

- [ ] **Step 2: Server actions**

Create `src/app/(app)/leads/shows/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { can } from "@/lib/team";
import { setCard, writeShow } from "@/lib/stores/booth";

export async function saveShowAction(input: { id?: string; name: string; startAt: number | null; endAt: number | null }) {
  await requirePerm("create");
  const r = await writeShow({ kind: "upsert", show: input });
  revalidatePath("/leads/shows");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function showOpAction(op: { kind: "activate" | "archive" | "unarchive"; id: string } | { kind: "deactivate" }) {
  await requirePerm("create");
  const r = await writeShow(op);
  revalidatePath("/leads/shows");
  revalidatePath("/leads/booth");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function setCardAction(slug: string, userId: string | null) {
  const me = await requirePerm("create");
  if (!can("admin", me.roles)) return { ok: false, error: "Only an admin can change contact cards." };
  const r = await setCard(slug, userId);
  revalidatePath("/leads/shows");
  return r;
}
```

Check that `can("admin", …)` is a real `Perm` in `src/lib/team.ts` (`ROLE_PERMS`). If admin is a role rather than a perm, use whatever the Settings → Team actions use.

- [ ] **Step 3: The page**

Create `src/app/(app)/leads/shows/page.tsx`:

```tsx
import QRCode from "qrcode";
import { headers } from "next/headers";
import { requirePerm } from "@/lib/session";
import { allUsers } from "@/lib/users";
import { listCards, listShows } from "@/lib/stores/booth";
import ShowsEditor from "./shows-editor";

export const dynamic = "force-dynamic";

export default async function ShowsPage() {
  const me = await requirePerm("create");
  const [shows, cards, users, h] = await Promise.all([listShows(), listCards(), allUsers(), headers()]);
  const origin = process.env.QUOTE_PDF_ORIGIN || `https://${h.get("host")}`;
  const cardRows = await Promise.all(
    Object.entries(cards).map(async ([slug, userId]) => {
      const url = `${origin}/c/${slug}`;
      return { slug, userId, url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
    })
  );
  return (
    <ShowsEditor
      shows={shows}
      cards={cardRows}
      users={users.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name }))}
      isAdmin={me.roles.includes("admin")}
    />
  );
}
```

Use the same admin check as the action (Step 2) for `isAdmin`. Check whether the app already has a canonical "public origin" helper (grep `QUOTE_PDF_ORIGIN` and `publicOrigin`) and use it instead of the `headers()` fallback when one exists.

- [ ] **Step 4: The editor (client)**

Create `src/app/(app)/leads/shows/shows-editor.tsx`. It has two sections:

1. **Shows**: a table of shows (name, dates, status chip Active / Archived), with a row form to add/edit (name, start date, end date as `<input type="date">` converted to epoch-ms at local midnight) and buttons **Set active** / **Turn off** / **Archive** / **Unarchive** calling the actions, then `router.refresh()`. The active show is shown first and highlighted with `var(--accent)`. Booth mode is linked at the top ("Open Booth mode →" to `/leads/booth`).
2. **Contact cards** (edit controls admin-only; others read-only): one row per card showing slug, user, the full URL with **Copy link**, the QR (rendered from `qrSvg` via `dangerouslySetInnerHTML`; it's server-generated SVG from our own URL), and **Download SVG** / **Download PNG**. PNG is drawn client-side by painting the SVG onto a 1024×1024 canvas. Plus an "Add card" row: slug input + user `<select>` → `setCardAction`, and a ✕ that calls `setCardAction(slug, null)`.
3. Under Contact cards, a short "Write your NFC card" help: "Buy blank NTAG215 or NTAG216 NFC cards. In the free NFC Tools app on your iPhone: Write → Add a record → URL → paste the link above → Write, then hold the card to the top of the phone. Test by tapping it with a different phone."

Write it following the existing client-component style in `src/app/(app)/settings/` (state with `useState`, `useTransition` for actions, errors inline). Everything here is ordinary form UI with no business rules: all the rules live in the pure `shows.ts` and the actions.

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Show } from "@/lib/booth/shows";
import { saveShowAction, setCardAction, showOpAction } from "./actions";

type CardRow = { slug: string; userId: string; url: string; qrSvg: string };

const toDay = (ms: number | null) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10));
const fromDay = (s: string) => (s ? new Date(s + "T00:00:00").getTime() : null);

function downloadPng(svg: string, name: string) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.drawImage(img, 0, 0, 1024, 1024);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = name + ".png";
    a.click();
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function downloadSvg(svg: string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = name + ".svg";
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ShowsEditor({ shows, cards, users, isAdmin }: { shows: Show[]; cards: CardRow[]; users: { id: string; name: string }[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ id?: string; name: string; start: string; end: string }>({ name: "", start: "", end: "" });
  const [newSlug, setNewSlug] = useState("");
  const [newUser, setNewUser] = useState(users[0]?.id ?? "");
  const run = (p: Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await p;
      if (!r.ok) setError(r.error || "Couldn't save that.");
      else {
        setError("");
        after?.();
        router.refresh();
      }
    });
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "(removed user)";
  const ordered = [...shows].sort((a, b) => Number(b.active) - Number(a.active) || Number(a.archived) - Number(b.archived) || (b.startAt ?? 0) - (a.startAt ?? 0));

  return (
    <div className="pk-page" style={{ display: "grid", gap: 24, maxWidth: 900 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Trade shows</h1>
        <a href="/leads/booth" className="pk-btn pk-btn-primary">Open Booth mode →</a>
      </header>
      {error ? <div role="alert" style={{ color: "#b42318" }}>{error}</div> : null}

      <section style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Shows</h2>
        <table className="pk-table">
          <thead><tr><th>Show</th><th>Dates</th><th>Status</th><th /></tr></thead>
          <tbody>
            {ordered.map((s) => (
              <tr key={s.id} style={s.active ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}>
                <td>{s.name}</td>
                <td>{toDay(s.startAt)}{s.endAt ? ` – ${toDay(s.endAt)}` : ""}</td>
                <td>{s.active ? "Active" : s.archived ? "Archived" : "—"}</td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button type="button" disabled={pending} onClick={() => setDraft({ id: s.id, name: s.name, start: toDay(s.startAt), end: toDay(s.endAt) })}>Edit</button>
                  {s.archived ? (
                    <button type="button" disabled={pending} onClick={() => run(showOpAction({ kind: "unarchive", id: s.id }))}>Unarchive</button>
                  ) : s.active ? (
                    <button type="button" disabled={pending} onClick={() => run(showOpAction({ kind: "deactivate" }))}>Turn off</button>
                  ) : (
                    <button type="button" disabled={pending} onClick={() => run(showOpAction({ kind: "activate", id: s.id }))}>Set active</button>
                  )}
                  {!s.archived ? <button type="button" disabled={pending} onClick={() => run(showOpAction({ kind: "archive", id: s.id }))}>Archive</button> : null}
                </td>
              </tr>
            ))}
            {!ordered.length ? <tr><td colSpan={4}>No shows yet — add the first one below.</td></tr> : null}
          </tbody>
        </table>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(saveShowAction({ id: draft.id, name: draft.name, startAt: fromDay(draft.start), endAt: fromDay(draft.end) }), () => setDraft({ name: "", start: "", end: "" }));
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}
        >
          <label>Show name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} required /></label>
          <label>Starts<input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></label>
          <label>Ends<input type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></label>
          <button type="submit" className="pk-btn pk-btn-primary" disabled={pending}>{draft.id ? "Save show" : "Add show"}</button>
          {draft.id ? <button type="button" onClick={() => setDraft({ name: "", start: "", end: "" })}>Cancel</button> : null}
        </form>
      </section>

      <section style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Contact cards</h2>
        {cards.map((c) => (
          <div key={c.slug} className="pk-card" style={{ padding: 12, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 120, height: 120 }} dangerouslySetInnerHTML={{ __html: c.qrSvg }} />
            <div style={{ display: "grid", gap: 6, minWidth: 0, flex: 1 }}>
              <strong>{userName(c.userId)}</strong>
              <code style={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{c.url}</code>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => navigator.clipboard.writeText(c.url)}>Copy link</button>
                <button type="button" onClick={() => downloadSvg(c.qrSvg, `card-${c.slug}`)}>Download SVG</button>
                <button type="button" onClick={() => downloadPng(c.qrSvg, `card-${c.slug}`)}>Download PNG</button>
                {isAdmin ? <button type="button" disabled={pending} onClick={() => run(setCardAction(c.slug, null))}>Remove</button> : null}
              </div>
            </div>
          </div>
        ))}
        {isAdmin ? (
          <form onSubmit={(e) => { e.preventDefault(); run(setCardAction(newSlug, newUser), () => setNewSlug("")); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <label>Link name<input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="jeff" maxLength={32} required /></label>
            <label>Person<select value={newUser} onChange={(e) => setNewUser(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <button type="submit" className="pk-btn pk-btn-primary" disabled={pending}>Add card</button>
          </form>
        ) : null}
        <p style={{ color: "#5b616e", margin: 0 }}>
          Write your NFC card: buy blank NTAG215 or NTAG216 NFC cards. In the free NFC Tools app on your iPhone, choose Write → Add a record → URL, paste the link above, tap Write, then hold the card to the top of the phone. Test it by tapping the card with a different phone.
        </p>
      </section>
    </div>
  );
}
```

Replace `pk-page` / `pk-table` / `pk-card` / `pk-btn` with the real class names from `globals.css`.

- [ ] **Step 5: Nav route map**

In `src/components/nav/nav-data.ts` (route map near line 164), add `"/leads/shows": "leads",` and `"/leads/booth": "leads",` so both highlight Leads. Add **no** new nav rows, because Booth mode is linked from the Shows page and from the Leads page header (Task 11).

- [ ] **Step 6: Verify in the browser**

Start the dev server (check for strays first). Open `/leads/shows`: add a show, set it active, add a card `jeff` → your user, see the QR, download the PNG, scan it with a phone camera, and check that it opens `/c/jeff`.

- [ ] **Step 7: Gate + commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:specs 2>&1 | tail -2`

```bash
git add package.json package-lock.json src/app/\(app\)/leads/shows src/components/nav/nav-data.ts
git commit -m "feat(booth): Leads → Shows page with active show, contact cards and QR codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Booth mode (staff capture, offline)

**Files:**
- Create: `src/app/(app)/leads/booth/page.tsx`
- Create: `src/app/(app)/leads/booth/actions.ts`
- Create: `src/app/(app)/leads/booth/booth-form.tsx`
- Create: `src/app/api/booth/card-image/[id]/route.ts`

**Interfaces:**
- Consumes: `listShows`, `getActiveShow`, `listCapturesForShow`, `getCapture` (Task 5); `recordBoothCapture` (Task 6); `INTERESTS`, `INTEREST_LABEL`, `TEMPERATURES`, `newCaptureId`, `BoothCapture` (Task 4); `saveThroughOutbox` (`src/lib/sync/save.ts`); `getEngine` (`src/lib/sync/engine.ts`: `outboxEntry`, `subscribe`); `resizePhoto`, `shrinkForInline` (`src/lib/assessments/photo-resize.ts`); `getBlobStream` (`src/lib/blob.ts`).
- Produces:
  - server action `saveBoothCaptureAction(doc: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }>`
  - `GET /api/booth/card-image/[id]` (signed in): the capture's card JPEG
  - `BoothForm` props: `{ shows: { id: string; name: string }[]; activeShowId: string | null; me: { id: string; name: string }; recent: Array<Pick<BoothCapture, "id" | "firstName" | "lastName" | "company" | "temperature" | "capturedAt" | "leadId" | "outcome" | "showId">>; scanAvailableHint: boolean }`

- [ ] **Step 1: Server action**

Create `src/app/(app)/leads/booth/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { recordBoothCapture } from "@/lib/booth/capture-server";

export async function saveBoothCaptureAction(doc: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requirePerm("create");
  const r = await recordBoothCapture(doc, { id: me.id, name: me.name });
  if (!r.ok) return r;
  revalidatePath("/leads/booth");
  revalidatePath("/leads");
  return { ok: true };
}
```

Booth-mode server actions with a `cardImage` data URL can approach the server-action body limit. The memory note on Vercel Blob limits says about 1200 KB per action. A ≤ 250 KB JPEG is about 340 KB as base64, which is well under it. Keep `shrinkForInline(blob, 250_000)`.

- [ ] **Step 2: Card image route**

Create `src/app/api/booth/card-image/[id]/route.ts`:

```ts
import { requireUser } from "@/lib/session";
import { getCapture } from "@/lib/stores/booth";
import { dataUrlToBytes, getBlobStream } from "@/lib/blob";

export const dynamic = "force-dynamic";

/** Signed in: one booth capture's business-card photo (private Blob, or inline in dev). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const c = await getCapture(id);
  if (!c?.cardImagePath) return new Response("Not found", { status: 404 });
  const headers = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
  if (c.cardImagePath === "inline") {
    const inline = (c as { cardImage?: string }).cardImage;
    if (!inline) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(dataUrlToBytes(inline).bytes), { headers });
  }
  const stream = await getBlobStream(c.cardImagePath);
  if (!stream) return new Response("Not found", { status: 404 });
  return new Response(stream as unknown as ReadableStream, { headers });
}
```

Read `getBlobStream`'s real return shape (`src/lib/blob.ts:172`) and adapt the last lines to it, mirroring an existing private-file proxy such as `/api/surveys/[id]/files/[fileId]`.

- [ ] **Step 3: Page**

Create `src/app/(app)/leads/booth/page.tsx`:

```tsx
import { requirePerm } from "@/lib/session";
import { getActiveShow, listCapturesForShow, listShows } from "@/lib/stores/booth";
import BoothForm from "./booth-form";

export const dynamic = "force-dynamic";

export default async function BoothPage() {
  const me = await requirePerm("create");
  const [shows, active] = await Promise.all([listShows(), getActiveShow()]);
  const recent = active ? (await listCapturesForShow(active.id)).slice(0, 50) : [];
  return (
    <BoothForm
      shows={shows.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name }))}
      activeShowId={active?.id ?? null}
      me={{ id: me.id, name: me.name }}
      recent={recent.map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName, company: c.company, temperature: c.temperature, capturedAt: c.capturedAt, leadId: c.leadId, outcome: c.outcome, showId: c.showId }))}
      scanAvailableHint={false}
    />
  );
}
```

- [ ] **Step 4: The form (client)**

Create `src/app/(app)/leads/booth/booth-form.tsx`. Behaviour:

- Header: a show `<select>` (default `activeShowId`; "No show" option). If there's no active show, show a notice "No active show — set one on Shows" with a link to `/leads/shows`.
- Fields: first name, last name, email, phone, company, title, interest chips (`INTERESTS`), Hot/Warm/Cold segmented buttons, notes.
- **Scan card** button: rendered only when `isNativePlatform()` and the `CardText` plugin is available (Task 10 wires the handler; in this task render it disabled and hidden unless `scanAvailable` is true, with `scanAvailable` state defaulting to `false`).
- **Save & next**: builds the whole doc (`id: newCaptureId(randHex16)` using `crypto.getRandomValues`, `via: "booth"`, `capturedAt: Date.now()`, `capturedById/Name` from `me`, `rev: 1`, plus `cardImage` if a scan set one). Then:
  `await saveThroughOutbox({ collection: "booth_captures", id, doc, action: () => saveBoothCaptureAction(doc), timeoutMs: 8000 })`.
  On success, clear the form (keep the show), push the capture into a local "today" list with status `queued ? "Waiting to sync" : "Synced"`, and focus first name. Errors from the action (e.g. "Add a name.") show inline and don't clear the form. Validate on the client first with `sanitizeCapture` (it's pure) so offline saves can't queue a doc the server will refuse.
- **Today at this show** list: merges server `recent` (filtered to the selected show) with this session's local list, newest first. Each row: name, company, temperature chip, and "Synced" / "Waiting to sync" / "Merged into existing lead". A row with `leadId` links to `/leads?lead=<leadId>`. Count in the heading. Subscribe to `getEngine().subscribe(...)` and, on each change, call `getEngine().outboxEntry("booth_captures", id)` for local rows marked waiting. When it returns `null` the row becomes "Synced"; when `state === "error"` show its `error`.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { saveThroughOutbox } from "@/lib/sync/save";
import { getEngine } from "@/lib/sync/engine";
import { INTERESTS, INTEREST_LABEL, TEMPERATURES, newCaptureId, sanitizeCapture, type BoothCapture, type Interest, type Temperature } from "@/lib/booth/capture";
import { saveBoothCaptureAction } from "./actions";

type Recent = Pick<BoothCapture, "id" | "firstName" | "lastName" | "company" | "temperature" | "capturedAt" | "leadId" | "outcome" | "showId">;
type Row = Recent & { status: "synced" | "waiting" | "error"; error?: string };

const EMPTY = { firstName: "", lastName: "", email: "", phone: "", company: "", title: "", notes: "" };

function randHex16(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function BoothForm(props: { shows: { id: string; name: string }[]; activeShowId: string | null; me: { id: string; name: string }; recent: Recent[]; scanAvailableHint: boolean }) {
  const [showId, setShowId] = useState<string | null>(props.activeShowId);
  const [f, setF] = useState(EMPTY);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [temperature, setTemperature] = useState<Temperature | null>(null);
  const [cardImage, setCardImage] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<Row[]>([]);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const engine = getEngine();
    const check = async () => {
      const next = await Promise.all(
        local.map(async (r) => {
          if (r.status === "synced") return r;
          const e = await engine.outboxEntry("booth_captures", r.id);
          if (!e) return { ...r, status: "synced" as const };
          return e.state === "error" ? { ...r, status: "error" as const, error: e.error } : r;
        })
      );
      if (next.some((r, i) => r.status !== local[i].status)) setLocal(next);
    };
    return engine.subscribe(() => void check());
  }, [local]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const doc: Record<string, unknown> = {
      id: newCaptureId(randHex16),
      via: "booth",
      showId,
      ...f,
      interests,
      temperature,
      ...(cardImage ? { cardImage } : {}),
      capturedAt: Date.now(),
      capturedById: props.me.id,
      capturedByName: props.me.name,
      rev: 1,
    };
    const check = sanitizeCapture(doc);
    if (!check.ok) return setError(check.error);
    setSaving(true);
    setError("");
    try {
      const { queued } = await saveThroughOutbox({ collection: "booth_captures", id: doc.id as string, doc, action: () => saveBoothCaptureAction(doc), timeoutMs: 8000 });
      setLocal((l) => [{ id: doc.id as string, firstName: f.firstName, lastName: f.lastName, company: f.company, temperature, capturedAt: doc.capturedAt as number, showId, status: queued ? "waiting" : "synced" }, ...l]);
      setF(EMPTY);
      setInterests([]);
      setTemperature(null);
      setCardImage(undefined);
      firstRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  const server: Row[] = props.recent.filter((r) => r.showId === showId && !local.some((l) => l.id === r.id)).map((r) => ({ ...r, status: "synced" }));
  const rows = [...local.filter((r) => r.showId === showId), ...server].sort((a, b) => b.capturedAt - a.capturedAt);
  const showName = props.shows.find((s) => s.id === showId)?.name;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: 16, padding: "0 16px" }}>
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0 }}>Booth mode</h1>
        <select value={showId ?? ""} onChange={(e) => setShowId(e.target.value || null)} aria-label="Show">
          <option value="">No show</option>
          {props.shows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!props.activeShowId ? <div>No active show — set one on <a href="/leads/shows">Shows</a>.</div> : null}
      </header>

      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        {/* Scan card: Task 10 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input ref={firstRef} placeholder="First name" value={f.firstName} onChange={set("firstName")} autoComplete="off" />
          <input placeholder="Last name" value={f.lastName} onChange={set("lastName")} autoComplete="off" />
        </div>
        <input type="email" placeholder="Email" value={f.email} onChange={set("email")} autoComplete="off" inputMode="email" />
        <input type="tel" placeholder="Phone" value={f.phone} onChange={set("phone")} autoComplete="off" />
        <input placeholder="Organization / venue" value={f.company} onChange={set("company")} autoComplete="off" />
        <input placeholder="Title" value={f.title} onChange={set("title")} autoComplete="off" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {INTERESTS.map((k) => {
            const on = interests.includes(k);
            return <button key={k} type="button" aria-pressed={on} onClick={() => setInterests(on ? interests.filter((x) => x !== k) : [...interests, k])}>{INTEREST_LABEL[k]}</button>;
          })}
        </div>
        <div role="group" aria-label="Temperature" style={{ display: "flex", gap: 6 }}>
          {TEMPERATURES.map((t) => <button key={t} type="button" aria-pressed={temperature === t} onClick={() => setTemperature(temperature === t ? null : t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        <textarea placeholder="Notes" rows={3} value={f.notes} onChange={set("notes")} />
        {cardImage ? <div>Card photo attached ✓ <button type="button" onClick={() => setCardImage(undefined)}>Remove</button></div> : null}
        {error ? <div role="alert" style={{ color: "#b42318" }}>{error}</div> : null}
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save & next"}</button>
      </form>

      <section>
        <h2 style={{ fontSize: 16 }}>Today at {showName || "this show"} ({rows.length})</h2>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>
                {r.leadId ? <a href={`/leads?lead=${r.leadId}`}>{[r.firstName, r.lastName].filter(Boolean).join(" ")}</a> : [r.firstName, r.lastName].filter(Boolean).join(" ")}
                {r.company ? ` · ${r.company}` : ""}
                {r.temperature ? ` · ${r.temperature}` : ""}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {r.status === "waiting" ? "Waiting to sync" : r.status === "error" ? r.error || "Couldn't sync" : r.outcome === "merged" ? "Merged into existing lead" : "Synced"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

Style with the app's `pk-*` classes and keep touch targets ≥ 44 px (phone/iPad first). Use the accent only through `var(--accent)`. The `setCardImage` setter is used by Task 10.

- [ ] **Step 5: Verify in the browser, including offline**

Run the dev server and open `/leads/booth` signed in.
1. Online: save a capture → the row shows "Synced" and the lead appears on `/leads` with source Trade show / event.
2. Turn on the Nav **Work offline** toggle (or set the Browser pane offline): save two captures → "Waiting to sync". Toggle back → both flip to "Synced" and appear as leads. Check with `read_page` / JS, not only screenshots (the screenshot-lag memory).
3. Save the same email twice → second row says "Merged into existing lead".

- [ ] **Step 6: Gate + commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:specs 2>&1 | tail -2 && npm run build`
The build matters because a client component importing a server store breaks only `next build` (memory note).

```bash
git add src/app/\(app\)/leads/booth src/app/api/booth/card-image
git commit -m "feat(booth): Booth mode — offline staff capture through the outbox, Today at this show

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Scan card — native on-device text recognition

**Files:**
- Create: `ios/App/App/CardTextPlugin.swift`
- Create: `ios/App/App/BridgeViewController.swift`
- Modify: `ios/App/App/Base.lproj/Main.storyboard:14`
- Modify: `ios/App/App.xcodeproj/project.pbxproj` (4 entries per new Swift file)
- Create: `android/app/src/main/java/com/peaksystemsgroup/quartzite/CardTextPlugin.java`
- Modify: `android/app/src/main/java/com/peaksystemsgroup/quartzite/MainActivity.java`
- Modify: `android/app/build.gradle` (ML Kit dependency)
- Create: `src/lib/booth/card-text.ts`
- Modify: `src/app/(app)/leads/booth/booth-form.tsx`

**Interfaces:**
- Consumes: `parseCardText` (Task 3); `resizePhoto`, `shrinkForInline` (photo-resize); `isNativePlatform` (`src/lib/platform.ts`); the `setCardImage` / `setF` state in `booth-form.tsx`.
- Produces:
  - Native plugin `CardText` with method `recognize({ base64: string }) → { lines: string[] }`
  - `cardTextAvailable(): boolean`, `recognizeCardLines(jpegBase64: string): Promise<string[]>` in `src/lib/booth/card-text.ts`

- [ ] **Step 1: JS bridge**

Create `src/lib/booth/card-text.ts`:

```ts
"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";

/**
 * Business-card text recognition on the device (no network, no AI — D89):
 * Apple Vision on iOS, ML Kit on Android, through the app's own local
 * `CardText` plugin (ios/App/App/CardTextPlugin.swift,
 * android/…/CardTextPlugin.java). Not available in a browser.
 */

interface CardTextPlugin {
  recognize(opts: { base64: string }): Promise<{ lines: string[] }>;
}

const CardText = registerPlugin<CardTextPlugin>("CardText");

export function cardTextAvailable(): boolean {
  return isNativePlatform() && Capacitor.isPluginAvailable("CardText");
}

export async function recognizeCardLines(jpegBase64: string): Promise<string[]> {
  const { lines } = await CardText.recognize({ base64: jpegBase64 });
  return Array.isArray(lines) ? lines.map(String) : [];
}
```

- [ ] **Step 2: iOS plugin (Vision)**

Create `ios/App/App/CardTextPlugin.swift`:

```swift
import Capacitor
import UIKit
import Vision

/// Booth mode "Scan card": on-device text recognition with Apple Vision.
/// Input: a base64 JPEG. Output: the recognized lines, top to bottom.
@objc(CardTextPlugin)
public class CardTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CardTextPlugin"
    public let jsName = "CardText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"),
              let data = Data(base64Encoded: b64),
              let image = UIImage(data: data),
              let cg = image.cgImage else {
            call.reject("Couldn't read that photo.")
            return
        }
        let request = VNRecognizeTextRequest { req, err in
            if let err = err {
                call.reject("Text recognition failed: \(err.localizedDescription)")
                return
            }
            let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
            // Vision's origin is bottom-left: sort top-to-bottom, then left-to-right.
            let sorted = obs.sorted {
                abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.01
                    ? $0.boundingBox.midY > $1.boundingBox.midY
                    : $0.boundingBox.minX < $1.boundingBox.minX
            }
            let lines = sorted.compactMap { $0.topCandidates(1).first?.string }
            call.resolve(["lines": lines])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let orientation = CGImagePropertyOrientation(rawValue: UInt32(image.imageOrientation.exifOrientation)) ?? .up
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:]).perform([request])
            } catch {
                call.reject("Text recognition failed: \(error.localizedDescription)")
            }
        }
    }
}

private extension UIImage.Orientation {
    var exifOrientation: Int32 {
        switch self {
        case .up: return 1
        case .down: return 3
        case .left: return 8
        case .right: return 6
        case .upMirrored: return 2
        case .downMirrored: return 4
        case .leftMirrored: return 5
        case .rightMirrored: return 7
        @unknown default: return 1
        }
    }
}
```

Create `ios/App/App/BridgeViewController.swift`:

```swift
import Capacitor
import UIKit

/// Registers the app's own local plugins (Capacitor 8 SPM apps have no
/// auto-registration for in-app plugin classes).
class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CardTextPlugin())
    }
}
```

In `ios/App/App/Base.lproj/Main.storyboard:14`, change `customClass="CAPBridgeViewController" customModule="Capacitor"` to `customClass="BridgeViewController" customModule="App" customModuleProvider="target"`.

In `ios/App/App.xcodeproj/project.pbxproj`, add both Swift files the same way `SceneDelegate.swift` is listed. Use fresh 24-hex ids that aren't already in the file (check with `grep -c <id>`):
- PBXBuildFile section:
  `		B00C0DE10000000000000001 /* CardTextPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = B00C0DE10000000000000002 /* CardTextPlugin.swift */; };`
  `		B00C0DE10000000000000003 /* BridgeViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = B00C0DE10000000000000004 /* BridgeViewController.swift */; };`
- PBXFileReference section:
  `		B00C0DE10000000000000002 /* CardTextPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = CardTextPlugin.swift; sourceTree = "<group>"; };`
  `		B00C0DE10000000000000004 /* BridgeViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = BridgeViewController.swift; sourceTree = "<group>"; };`
- The `App` PBXGroup `children` (after the `SceneDelegate.swift` child):
  `				B00C0DE10000000000000002 /* CardTextPlugin.swift */,`
  `				B00C0DE10000000000000004 /* BridgeViewController.swift */,`
- PBXSourcesBuildPhase `files` (after the `SceneDelegate.swift in Sources` line):
  `				B00C0DE10000000000000001 /* CardTextPlugin.swift in Sources */,`
  `				B00C0DE10000000000000003 /* BridgeViewController.swift in Sources */,`

Build headless per the iOS toolchain memory note: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5`.
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Android plugin (ML Kit)**

In `android/app/build.gradle` `dependencies { … }` add:

```gradle
    implementation "com.google.mlkit:text-recognition:16.0.1"
```

(This is the bundled model, so it works offline from first install. Check with `./gradlew :app:dependencies` that it resolves, and bump to the latest 16.x if Gradle reports a newer one.)

Create `android/app/src/main/java/com/peaksystemsgroup/quartzite/CardTextPlugin.java`:

```java
package com.peaksystemsgroup.quartzite;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/** Booth mode "Scan card": on-device text recognition with ML Kit (bundled model, no network). */
@CapacitorPlugin(name = "CardText")
public class CardTextPlugin extends Plugin {
    @PluginMethod
    public void recognize(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) { call.reject("Couldn't read that photo."); return; }
        byte[] bytes;
        try { bytes = Base64.decode(b64, Base64.DEFAULT); } catch (IllegalArgumentException e) { call.reject("Couldn't read that photo."); return; }
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) { call.reject("Couldn't read that photo."); return; }
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            .process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener((Text text) -> {
                JSArray lines = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks())
                    for (Text.Line line : block.getLines()) lines.put(line.getText());
                JSObject ret = new JSObject();
                ret.put("lines", lines);
                call.resolve(ret);
            })
            .addOnFailureListener((Exception e) -> call.reject("Text recognition failed: " + e.getMessage()));
    }
}
```

Replace `MainActivity.java` with:

```java
package com.peaksystemsgroup.quartzite;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CardTextPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

Build: `cd android && ./gradlew :app:assembleDebug 2>&1 | tail -5`
Expected: `BUILD SUCCESSFUL`. (If no Android SDK is installed on this Mac, say so in the task report. Don't skip silently.)

- [ ] **Step 4: Wire Scan card into Booth mode**

In `booth-form.tsx`, add the imports:

```ts
import { cardTextAvailable, recognizeCardLines } from "@/lib/booth/card-text";
import { parseCardText } from "@/lib/booth/card-parse";
import { resizePhoto, shrinkForInline } from "@/lib/assessments/photo-resize";
```

Add state and the handler, and replace the `{/* Scan card: Task 10 */}` placeholder:

```tsx
  const [scanAvailable, setScanAvailable] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filled, setFilled] = useState<Set<string>>(new Set());
  useEffect(() => setScanAvailable(cardTextAvailable()), []);

  async function onCardPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setError("");
    try {
      const { blob } = await resizePhoto(file);
      const small = await shrinkForInline(blob, 250_000);
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Couldn't read that photo."));
        r.readAsDataURL(small);
      });
      setCardImage(b64);
      const lines = await recognizeCardLines(b64.slice(b64.indexOf(",") + 1));
      const p = parseCardText(lines);
      const sp = p.name.lastIndexOf(" ");
      const next = {
        firstName: f.firstName || (sp > 0 ? p.name.slice(0, sp) : p.name),
        lastName: f.lastName || (sp > 0 ? p.name.slice(sp + 1) : ""),
        email: f.email || p.email,
        phone: f.phone || p.phones[0] || "",
        company: f.company || p.company,
        title: f.title || p.title,
        notes: f.notes,
      };
      setFilled(new Set(Object.keys(next).filter((k) => k !== "notes" && next[k as keyof typeof next] && !f[k as keyof typeof f])));
      setF(next);
      if (!lines.length) setError("No text found on that photo — type it in, the photo is still attached.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't scan that card.");
    } finally {
      setScanning(false);
    }
  }
```

```tsx
        {scanAvailable ? (
          <label className="pk-btn" style={{ textAlign: "center" }}>
            {scanning ? "Reading card…" : "Scan card"}
            <input type="file" accept="image/jpeg,image/png" capture="environment" onChange={onCardPhoto} hidden disabled={scanning} />
          </label>
        ) : null}
```

Highlight auto-filled fields (`filled.has("email")` → a subtle accent outline via `outline: "2px solid var(--accent)"`), and remove a key from `filled` when that field is edited. Clear `filled` on Save & next. Scanned values only fill **empty** fields, so they never overwrite what staff typed.

- [ ] **Step 5: Verify**

1. Web: `/leads/booth` in the Browser pane shows **no** Scan card button.
2. iOS simulator (per the iOS toolchain memory): `npx cap sync ios`, build, launch, attach the panel, open Booth mode, Scan card with a photo of a business card dropped into the simulator's Photos. Fields fill, and the card photo is attached. Then save offline and sync.
3. Run the pure parser test again: `npx tsx scripts/test-booth.ts`.

- [ ] **Step 6: Gate + commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`

```bash
git add ios/App android/app src/lib/booth/card-text.ts src/app/\(app\)/leads/booth/booth-form.tsx
git commit -m "feat(booth): Scan card — on-device text recognition (Vision on iOS, ML Kit on Android)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Leads board Show filter + drawer booth details

**Files:**
- Modify: `src/app/(app)/leads/page.tsx` (read `sp.show` near line 250; filter `all` near line 268; pass show options + selected id to the header/filter UI; build the drawer VM fields)
- Modify: `src/app/(app)/leads/types.ts` (`DrawerDetailVM` gains booth fields)
- Modify: `src/app/(app)/leads/lead-drawer.tsx` (show name chip, interests, temperature, card photo)
- Modify: `scripts/test-booth.ts` (pure filter helper check)
- Create: `src/lib/booth/lead-filter.ts`

**Interfaces:**
- Consumes: `listShows` (Task 5); `INTEREST_LABEL` (Task 4); `listDocsWhere`/`listDocsByField` for the lead's captures.
- Produces:
  - `filterByShow<T extends { eventId?: string }>(leads: T[], showId: string | null): T[]`
  - `DrawerDetailVM` gains `show?: { id: string; name: string } | null; interests?: string[]; temperature?: "hot" | "warm" | "cold" | null; cardImageIds?: string[]`

- [ ] **Step 1: Failing pure test**

Create `src/lib/booth/lead-filter.ts` test first. In `scripts/test-booth.ts` add:

```ts
import { filterByShow } from "../src/lib/booth/lead-filter";
```

```ts
  const LL = [{ id: "1", eventId: "sh_00000001" }, { id: "2" }, { id: "3", eventId: "sh_00000002" }];
  ok(filterByShow(LL, null).length === 3, "booth: no show filter → all leads");
  ok(filterByShow(LL, "sh_00000001").map((l) => l.id).join() === "1", "booth: show filter keeps that show's leads");
```

Run: `npx tsx scripts/test-booth.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
/** Leads board `?show=<id>` filter. Pure. */
export function filterByShow<T extends { eventId?: string }>(leads: T[], showId: string | null): T[] {
  return showId ? leads.filter((l) => l.eventId === showId) : leads;
}
```

Run: `npx tsx scripts/test-booth.ts` → `booth: ALL PASSED`.

- [ ] **Step 3: Board filter**

In `src/app/(app)/leads/page.tsx`:
- After the `who` parsing (~line 251): `const showParam = one(sp.show) || null;` and load `const shows = await listShows();` alongside the page's other loads.
- Change line ~268 so the show filter applies after the owner scope:
  `const all = filterByShow(scopeName ? allLeads.filter((l) => l.owner === scopeName) : allLeads, showParam);`
- In the page header (find where the `who` filter control renders), add a **Show** `<select>` (All shows + each non-archived show, newest first) that navigates to the same URL with `show=` set or removed, keeping the other params (the page has a URL-builder near line 77; reuse it), plus a **Booth mode →** link to `/leads/booth`.

- [ ] **Step 4: Drawer details**

In `types.ts` add to `DrawerDetailVM`:

```ts
  /** Trade show booth capture */
  show?: { id: string; name: string } | null;
  interests?: string[];
  temperature?: "hot" | "warm" | "cold" | null;
  /** booth_captures ids that carry a card photo (GET /api/booth/card-image/<id>) */
  cardImageIds?: string[];
```

Where `page.tsx` builds the drawer VM for `leadRec`:

```ts
  show: leadRec.eventId ? (shows.find((s) => s.id === leadRec.eventId) ? { id: leadRec.eventId, name: shows.find((s) => s.id === leadRec.eventId)!.name } : null) : null,
  interests: (leadRec.interests || []).map((k) => INTEREST_LABEL[k as Interest] ?? k),
  temperature: leadRec.temperature ?? null,
  cardImageIds: (await Promise.all((leadRec.boothCaptureIds || []).map((id) => getCapture(id)))).filter((c) => c?.cardImagePath).map((c) => c!.id),
```

In `lead-drawer.tsx`, next to the source chip (grep `sourceMeta`), render:
- the show name as a chip linking to `/leads?show=<id>`,
- a Hot/Warm/Cold chip,
- "Interests: Rigging, Lighting",
- each card photo as a thumbnail `<img src={`/api/booth/card-image/${id}`} … />` that opens full size in a new tab.

Follow the drawer's existing chip markup and the mono-font badge convention (IBM Plex Mono for badges).

- [ ] **Step 5: Verify in the browser**

`/leads?show=<id>` shows only that show's leads, and the select reflects it. Open a booth lead: the drawer shows the show chip, temperature, interests and the card photo.

- [ ] **Step 6: Gate + commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:specs 2>&1 | tail -2`

```bash
git add src/lib/booth/lead-filter.ts src/app/\(app\)/leads scripts/test-booth.ts
git commit -m "feat(booth): Leads Show filter + booth details and card photo in the lead drawer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, spec sync, full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-trade-show-booth-capture-design.md` (§4 card image rides in the capture doc; migration 0042)
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase entry), `MASTER-HOWTO.md` (NFC + booth how-to)

- [ ] **Step 1: Spec sync**

In the spec's §4 replace the card-image sentences with: "The card photo is shrunk on the device to a ≤ 250 KB JPEG and rides inside the `booth_captures` doc. On receipt the server moves it to private Blob at `booth/<capture id>.jpg` (kept inline only in local dev without Blob) and the lead drawer shows it via `GET /api/booth/card-image/<id>`." Add under §1: "`booth_captures` is a new doc table (migration 0042)."

- [ ] **Step 2: Numbers**

Fetch first, then read the **current** `origin/main` `DECISIONS.md` and `PUNCHLIST.md` to take the next free D-numbers and punch number (the two-sessions memory note: recompute right before writing docs).
`git fetch -q && git show origin/main:DECISIONS.md | grep -oE "^#+ *D[0-9]+" | tail -1 && git show origin/main:PUNCHLIST.md | grep -oE "#[0-9]{3}" | sort -n | tail -1`

- [ ] **Step 3: Write the docs**

- `DECISIONS.md`: one entry per default taken here. Shows + cards as settings blobs; `booth_captures` table + device-minted `bc_` ids; idempotency via `Lead.boothCaptureIds`; email-only merge into open leads; card image inline → Blob; a local `CardText` plugin (Vision/ML Kit) instead of a third-party plugin, because the iOS project is SPM and the ML Kit Capacitor plugin is CocoaPods-only; share-back draft one per lead, never sent; admin-only card slugs.
- `PUNCHLIST.md`: the item, what shipped, and the Jeff-gated remainder: buy + write NFC cards, set photo/title/phone in Settings → Team, add his card slug on Leads → Shows, create the first show and set it active, `npx cap sync` + rebuild both native apps, a real tap test on an iPhone and an Android, and a production check after the merge deploy applies 0042 (no preview).
- `AGENTS.md`: a phase entry in the house style (what, where, decisions range, remaining), plus "never preview-deploy this branch".
- `MASTER-HOWTO.md`: "Trade show booth" section: set up a show, set up your card, write the NFC tag (NFC Tools steps), print the QR, use Booth mode offline, Scan card, after the show filter Leads by show.

- [ ] **Step 4: Full verification gate**

Stop any dev server first (`ps aux | grep -E "next dev|tsx" | grep -v grep`). Then run:

```bash
npx tsc --noEmit
npm run lint
npm run test:specs 2>&1 | tail -3
npm run test:smoke 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

Expected: no type errors, lint clean, `ALL PASSED`, smoke green, build succeeds. Report the real numbers (assertion counts, smoke route counts).

- [ ] **Step 5: Commit**

```bash
git add docs DECISIONS.md PUNCHLIST.md AGENTS.md MASTER-HOWTO.md
git commit -m "docs(booth): decisions, punch item, phase entry, booth how-to; spec sync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes (done while writing)

- Spec coverage: §1 Shows → Tasks 1, 5, 8, 11. §2 card page + vCard + share-back → Tasks 2, 7. §3 NFC/QR → Task 8 (QR + how-to), Task 12 (MASTER-HOWTO). §4 Booth mode + Scan + offline + Today list → Tasks 3, 9, 10. §5 booth core, idempotency, dedupe → Tasks 4, 6. §6 follow-up draft → Task 6, wired in Task 7. Testing → `scripts/test-booth.ts` across tasks + smoke in Task 7. Remaining → Task 12.
- Deviation from the spec, recorded in Task 12: the card image rides in the capture doc instead of the assessment photo queue.
- Names used across tasks: `recordBoothCapture`, `pushBoothCapture`, `createShareBackDraft`, `listShows`/`getActiveShow`/`writeShow`, `listCards`/`cardUserId`/`setCard`, `getCapture`/`listCapturesForShow`, `sanitizeCapture`, `newCaptureId`, `parseCardText`, `buildVCard`/`vcardFileName`, `recognizeCardLines`/`cardTextAvailable`, `filterByShow`.
- `ShowOp` includes `unarchive` from Task 1 on, so Task 8's action passes ops straight through.
