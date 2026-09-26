# Saved quote PDFs (#222) + portal history (#220) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Save of an Estimator quote or a flame-test / repair / inspection proposal prints the customer document to a real PDF with headless Chrome, stores it, and that stored PDF is what the Estimator's customer preview, the service builders' letter button, and the customer portal show. The portal also lists every app-era estimate (Open / History) and the customer's projects (Active / History).

**Architecture:** A signed, session-less print route renders the SAME customer document from saved data only (`/print/quote/[id]` for the Estimator's `QuoteDocument`, `/print/letter/[kind]/[id]` for the three letter views). Save actions mark `quote.pdf` pending and schedule a generator with Next's `after()`; the generator signs a 120 s HMAC token, drives `puppeteer-core` (system Chrome locally, `@sparticuz/chromium` on Vercel) to print that route, stores the file (Vercel Blob, or `.data/files` in dev), and settles the state with a `savedAt` supersede rule. A send copies the current PDF onto the sent revision. Team (`/api/quotes/[id]/pdf`) and portal (`/portal/quotes/[id]/pdf`) routes stream files by quote id under their own access rules. All rules live in pure modules the spec harness tests directly.

**Tech Stack:** Next.js 16.3.5 App Router (server components, `"use server"` actions, route handlers, `after()` from `next/server`), TypeScript, Drizzle doc-store (quotes are JSONB docs, so no migration), `@vercel/blob`, `puppeteer-core` + `@sparticuz/chromium` (new), the `scripts/test-review-and-spec.ts` harness.

Spec: `docs/superpowers/specs/2026-09-26-quote-pdfs-portal-history-design.md`, sections "#222" and "#220" (#221 is planned separately; this plan does not depend on it and does not touch `src/lib/quote-links.ts`).

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Prefix every shell command with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks &&`.
- Before Task 1: `ls node_modules/.bin/next` must exist. If `node_modules` is missing or partial, run `npm ci` (never symlink the main checkout's). `.env.local` must exist; if it doesn't, `cp /Users/sm/Downloads/peak-app/.env.local .env.local` (gitignored).
- This is Next.js 16 (`node_modules/next/dist/docs/`). APIs this plan uses and the doc that governs each: `after()` (`01-app/03-api-reference/04-functions/after.md`: runs after the response, even after `redirect()`, bounded by the route's `maxDuration`; server actions inherit the PAGE's `maxDuration`, `02-route-segment-config/maxDuration.md`), route handlers with `ctx.params: Promise<…>`, `serverExternalPackages`, `outputFileTracingIncludes`, `headers()` ordering in `next.config.ts` ("the last header key will override the first"). The auth file stays `src/middleware.ts` (renaming it to `proxy.ts` is out of scope).
- A `"use client"` file never imports a VALUE from `@/lib/stores/*`, `@/db*`, `@/lib/settings`, `@/lib/quote-pdf/{token,storage,render,generate,schedule,portal-access,quote-document-data}`. The client-safe modules are `@/lib/quote-pdf/state`, `@/lib/quote-pdf/pdf-options` and `@/lib/portal-projects` (type-only imports from stores are fine). Only `next build` catches a violation.
- A storage path (`blobPath`, `pdfBlobPath`) is server-written only. It never reaches a browser (clients get `QuotePdfView`, which has `hasFile`, not the path) and no route or action accepts one from a request. Download routes look files up by quote id.
- Pinned versions: `puppeteer-core@25.12.0` and `@sparticuz/chromium@153.0.0`, installed `--save-exact` as `dependencies`. Task 3 verifies the Chromium major matches puppeteer's.
- Print tokens: `HMAC-SHA256(AUTH_SECRET, "print:<kind>:<id>:<exp>")`, base64url, TTL 120 000 ms, token = `<exp>.<sig>`. Missing / bad / expired token → the print route 404s (`notFound()`), checked BEFORE any quote read.
- PDF storage path: `quote-pdfs/<quoteId with [^A-Za-z0-9_-] → _>/<savedAt>.pdf`; a sent revision's copy is `…/rev-<n>.pdf`. Blob adds a random suffix; the returned pathname is what gets stored.
- PDF responses: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<Q-id>[-rev<n>].pdf"` (`attachment` for `?download=1`), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. Streamed, never buffered, so a large file never hits the ~4.5 MB non-streamed response ceiling.
- Timestamps are epoch-ms numbers. Quote ids and field names stay as they are. `pdf` and `pdfOptions` are new optional fields on the quote doc; `pdfBlobPath` is a new optional annex on `QuoteRevision` (the snapshot's priced fields are still never rewritten).
- Customer-facing copy (exact): "Updating PDF…", "Unsaved changes — save to update the PDF.", "Save this estimate to create its PDF.", "Document being prepared", "Download PDF", "Open PDF ↗", "Open", "History", "Active", "Your projects".
- Preview deployments share the production database and Blob store. A save on a preview writes the live quote already; its PDF render writes that quote's `pdf` state and Blob file too. Nothing in this plan changes that; do not add a preview-only DB path.
- The dev database is single-process. Never open `.data/pglite` from a script. `npm run test:specs` is safe (its own `mktemp -d` datadir). Browser/curl checks use a scratch dev server (`PGLITE_PATH` in a `mktemp -d`, recipe in Task 4), never `.data/pglite`. Before `test:specs` or a scratch server: `ps aux | grep -E "tsx|next dev" | grep -v grep` must show nothing of THIS worktree. Stop the scratch server before re-running `test:specs`.
- Spec-harness assertions go at the END of `scripts/test-review-and-spec.ts` as a hoisted `import` block plus a `{ … }` block, tagged `#222` / `#220`. Import aliases that could collide carry a `222`/`q222` suffix/prefix. Async (DB) checks are `async function …222AsyncChecks()` at the end of the file, each added to the promise chain with one `.then(() => …)` line placed immediately ABOVE the line `  // Before the report and before the \`.catch\`, so a thrown suite is torn` (anchor on that comment; other branches append there too).
- Gates in each task's last step: `npx tsc --noEmit` (0 errors) · `npm run test:specs` (0 FAIL; report the PASS count and `grep -c '^PASS #22[02]'`) · `npx eslint <changed files>` (0 errors; quote paths containing parentheses). Tasks 2–6 also run `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` (must succeed). Record the PASS baseline before Task 1: `npm run test:specs > "$TMPDIR/specs-base.log" 2>&1; grep -c '^PASS' "$TMPDIR/specs-base.log"`.
- Commits: `feat(quotes): … (#222)` or `feat(portal): … (#220)`, a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the task's files; never `git add -A`. On `index.lock`, wait 5 s and retry (up to 5 times); never delete the lock. Never use bare `git stash`.
- Do not write DECISIONS.md or PUNCHLIST.md entries.

## Decisions this plan takes where the spec is open

1. **`PreviewDoc`'s document becomes `QuoteDocument`**, a directive-less component with no hooks and no handlers (`src/app/(app)/estimator/quote-document.tsx`), rendered by the print route. The per-system Itemized/Narrative button moves out of the document into the preview's sidebar. After Task 5 the Estimator no longer renders the document live at all; it shows the stored PDF.
2. **Portal self-serve estimates get a PDF too.** `submitPortalEstimate` schedules one, because the spec lets a customer open their own self-serve PDF and without this they would only ever see "Document being prepared".
3. **The last good file survives.** A pending re-render and a failure both keep the previous `blobPath`, so the preview shows the old PDF under an "Updating PDF…"/error banner instead of going blank. The portal only serves a `ready` file or a sent revision's copy.
4. **Stale pending.** A render still `pending` 150 s after it started is reported as failed ("The PDF didn't finish rendering — try again."), since its function is gone. The client stops polling after 60 s and offers Retry. Retry re-renders with the SAME `savedAt` (the document hasn't changed).
5. **Send ordering.** Saves mark the PDF pending BEFORE any status change in the same save. `setStatus(…, "sent")` copies the current PDF onto the new sent revision only when it is `ready`; when it is still rendering, the generator copies it on completion. The rule for both: the latest `sent` revision, no copy yet, cut at or after the PDF's `savedAt` (`revisionAwaitingPdf`).
6. **Portal PDF source.** The latest `sent` revision's copy when it has one, else the current `ready` file. A draft is served only when `portalListsQuote` allows it (the customer's own self-serve draft).
7. **Iframe.** The app sends `X-Frame-Options: DENY` everywhere. A later `next.config.ts` header entry sets `SAMEORIGIN` for `/api/quotes/:id/pdf` only, so the Estimator can frame its own PDF.
8. **Service builders** keep their layout: the "Preview quote letter →" link becomes "Open quote PDF →" (new tab) with the same status/Retry line, plus a small "Web version" link to the old letter page.
9. **Dev without Blob** stores files under `QUOTE_PDF_DIR` (default `<cwd>/.data/files`). On Vercel without `BLOB_READ_WRITE_TOKEN` the PDF fails with a clear reason; the save still succeeds.
10. **Renders are serialized per server instance** (a module-level promise queue) so two quick saves never run two Chromiums in one Fluid-compute instance.

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/lib/quote-pdf/token.ts` | 1 | sign / verify print tokens (pure, `node:crypto`) |
| `src/lib/quote-pdf/state.ts` | 1 | PDF state machine, browser view, path rules (pure, client-safe) |
| `src/lib/quote-pdf/pdf-options.ts` | 1 | saved Show-on-PDF options (pure, client-safe) |
| `src/lib/quote-pdf/origin.ts` | 1 | origin the headless browser prints from (pure) |
| `src/lib/portal-projects.ts` | 1 | app-era filter, `portalProjectView` whitelist, grouping (pure) |
| `src/app/(app)/estimator/quote-document.tsx` | 2 | the customer quote document (shared) |
| `src/lib/quote-pdf/quote-document-data.ts` | 2 | saved quote → `QuoteDocumentProps` |
| `src/app/print/quote/[id]/page.tsx`, `src/app/print/letter/[kind]/[id]/page.tsx` | 2 | signed print routes |
| `src/app/(app)/{flame-tests,repairs,inspections}/letter/letter-view.tsx` | 2 | letter bodies, shared by page + print route |
| `src/lib/quote-pdf/storage.ts` | 3 | Blob / local-file store with a path guard |
| `src/lib/quote-pdf/render.ts` | 3 | Chrome discovery + URL → PDF bytes |
| `src/lib/quote-pdf/generate.ts` | 3 | render → store → settle; sent-revision copy |
| `src/lib/quote-pdf/portal-access.ts` | 3 | portal PDF access rule |
| `src/lib/quote-pdf/schedule.ts` | 4 | mark pending + `after()` |
| `src/lib/quote-pdf/http.ts` | 4 | streamed PDF response |
| `src/app/api/quotes/[id]/pdf/route.ts`, `src/app/portal/quotes/[id]/pdf/route.ts` | 4 | team + portal downloads |
| `src/app/(app)/quotes/pdf-actions.ts` | 4 | status poll + retry actions |
| `src/lib/portal-viewer.ts` | 4 | portal session or team preview (one rule) |
| `src/components/quote-pdf/{use-quote-pdf.ts,quote-pdf-viewer.tsx,saved-pdf-button.tsx}` | 5 | polling hook, iframe viewer, service button |
| `src/app/(app)/estimator/pdf-doc-key.ts` | 5 | "unsaved changes" fingerprint (pure) |

---

### Task 1: Pure pieces — tokens, PDF state, saved options, origin, portal projects

**Files:**
- Create: `src/lib/quote-pdf/token.ts`, `src/lib/quote-pdf/state.ts`, `src/lib/quote-pdf/pdf-options.ts`, `src/lib/quote-pdf/origin.ts`, `src/lib/portal-projects.ts`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `ProjectRecord` type (`src/lib/stores/projects.ts:201`).
- Produces (later tasks use these exact names):
  - `token.ts`: `PRINT_TOKEN_TTL_MS = 120_000`; `signPrintToken(secret: string, kind: PdfKind, id: string, nowMs: number): string`; `verifyPrintToken(secret: string, token: string, kind: PdfKind, id: string, nowMs: number): boolean`.
  - `state.ts`: `type PdfKind = "quote" | "flame" | "repair" | "inspection"`; `type QuotePdfStatus`; `type QuotePdfState = { status; at; savedAt; blobPath?; error? }`; `type QuotePdfView = { status; at; savedAt; error: string | null; hasFile: boolean }`; `type PdfOutcome`; `PDF_PENDING_STALE_MS = 150_000`; `pdfKindForQuoteType(t)`; `printPathFor(kind, id)`; `pdfStoragePath(quoteId, name)`; `pendingPdf(cur, savedAt, now)`; `failedPdf(cur, savedAt, error, now)`; `settlePdf(cur, savedAt, outcome, now): QuotePdfState | undefined` (undefined = superseded); `pdfView(pdf, now): QuotePdfView | null`; `revisionAwaitingPdf(rev, pdfSavedAt)`; `latestSentRevision(revisions)`; `portalPdfSource(q): { path; rev } | null`; `teamPdfPath(q, rev): string | null`; `pdfFileName(quoteId, rev)`.
  - `pdf-options.ts`: `type QuotePdfOptions = { detail: "itemized" | "sectioned"; pdfQty; pdfNotes; pdfPrices; pdfCover; pdfTerms; pdfOptions: boolean }`; `DEFAULT_PDF_OPTIONS`; `normalizePdfOptions(raw: unknown): QuotePdfOptions`. (Yes, the saved object `quote.pdfOptions` carries a boolean key also named `pdfOptions` — the Estimator's existing "Options" toggle name; the spec names both.)
  - `origin.ts`: `originFrom(host: string | null, proto: string | null, fixed?: string | null): string | null`.
  - `portal-projects.ts`: `isAppEraProject(p)`, `type PortalProjectView`, `portalProjectView(p, { venueName, quoteStatus })`, `groupPortalProjects(views)`, `groupPortalQuotes(quotes)`.

- [ ] **Step 1: Write the failing tests.** Append to the END of `scripts/test-review-and-spec.ts`:

```ts
/* ============ #222 / #220 — saved quote PDFs + portal history: pure pieces (Task 1) ============ */
import { PRINT_TOKEN_TTL_MS, signPrintToken, verifyPrintToken } from "@/lib/quote-pdf/token";
import {
  PDF_PENDING_STALE_MS,
  failedPdf,
  latestSentRevision,
  pdfFileName,
  pdfKindForQuoteType,
  pdfStoragePath,
  pdfView,
  pendingPdf,
  portalPdfSource,
  printPathFor,
  revisionAwaitingPdf,
  settlePdf,
  teamPdfPath,
  type QuotePdfState,
} from "@/lib/quote-pdf/state";
import { DEFAULT_PDF_OPTIONS, normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { originFrom } from "@/lib/quote-pdf/origin";
import { groupPortalProjects, groupPortalQuotes, isAppEraProject, portalProjectView } from "@/lib/portal-projects";
{
  const S = "test-secret-222";
  const t0 = 1_800_000_000_000;
  const tok = signPrintToken(S, "quote", "Q-2041", t0);
  ok(verifyPrintToken(S, tok, "quote", "Q-2041", t0 + 1000), "#222 print token: a fresh token verifies for its kind + id");
  ok(!verifyPrintToken(S, tok, "flame", "Q-2041", t0), "#222 print token: another kind is refused");
  ok(!verifyPrintToken(S, tok, "quote", "Q-2042", t0), "#222 print token: another quote id is refused");
  ok(!verifyPrintToken(S, tok, "quote", "Q-2041", t0 + PRINT_TOKEN_TTL_MS + 1), "#222 print token: expires after its TTL");
  ok(PRINT_TOKEN_TTL_MS === 120_000, "#222 print token: TTL is 120 s");
  const [exp, sig] = tok.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  ok(!verifyPrintToken(S, `${exp}.${flipped}`, "quote", "Q-2041", t0), "#222 print token: a tampered signature is refused");
  ok(!verifyPrintToken(S, `${Number(exp) + 60_000}.${sig}`, "quote", "Q-2041", t0), "#222 print token: a stretched expiry is refused");
  ok(!verifyPrintToken("other-secret", tok, "quote", "Q-2041", t0), "#222 print token: another secret is refused");
  ok(!verifyPrintToken(S, "", "quote", "Q-2041", t0) && !verifyPrintToken(S, "garbage", "quote", "Q-2041", t0), "#222 print token: missing or malformed tokens are refused");
  ok(!verifyPrintToken("", tok, "quote", "Q-2041", t0), "#222 print token: no secret configured → nothing verifies");
}
{
  ok(
    pdfKindForQuoteType(undefined) === "quote" && pdfKindForQuoteType("system") === "quote" && pdfKindForQuoteType("flame_test") === "flame" &&
      pdfKindForQuoteType("repair") === "repair" && pdfKindForQuoteType("inspection") === "inspection",
    "#222 pdfKindForQuoteType: system → quote, the three service letters by type"
  );
  ok(pdfKindForQuoteType("consulting") === null && pdfKindForQuoteType("rental") === null, "#222 pdfKindForQuoteType: consulting and rental have no saved PDF");
  ok(printPathFor("quote", "Q-1") === "/print/quote/Q-1" && printPathFor("repair", "Q 2") === "/print/letter/repair/Q%202", "#222 printPathFor: quote vs letter routes, id encoded");
  ok(
    pdfStoragePath("Q-2041", "123") === "quote-pdfs/Q-2041/123.pdf" && pdfStoragePath("TEST222:a/b", "rev-1") === "quote-pdfs/TEST222_a_b/rev-1.pdf",
    "#222 pdfStoragePath: one folder per quote, unsafe characters replaced"
  );
  const ready: QuotePdfState = { status: "ready", at: 10, savedAt: 5, blobPath: "quote-pdfs/Q-1/5.pdf" };
  const p = pendingPdf(ready, 20, 21);
  ok(p.status === "pending" && p.savedAt === 20 && p.at === 21 && p.blobPath === ready.blobPath, "#222 pendingPdf: a new save goes pending but keeps the last good file");
  ok(settlePdf(p, 19, { ok: true, blobPath: "x" }, 30) === undefined, "#222 settlePdf: an older save's render is superseded by the newer savedAt");
  ok(settlePdf(null, 20, { ok: true, blobPath: "x" }, 30) === undefined, "#222 settlePdf: nothing to settle when the quote carries no pdf state");
  const done = settlePdf(p, 20, { ok: true, blobPath: "quote-pdfs/Q-1/20.pdf" }, 30);
  ok(done?.status === "ready" && done.blobPath === "quote-pdfs/Q-1/20.pdf" && done.at === 30 && done.savedAt === 20, "#222 settlePdf: the matching save becomes ready with its new file");
  const bad = settlePdf(p, 20, { ok: false, error: "No Chrome" }, 30);
  ok(bad?.status === "failed" && bad.error === "No Chrome" && bad.blobPath === ready.blobPath, "#222 settlePdf: a failure records the reason and keeps the last good file");
  const f = failedPdf(ready, 40, "x".repeat(400), 41);
  ok(f.status === "failed" && f.savedAt === 40 && f.error?.length === 300 && f.blobPath === ready.blobPath, "#222 failedPdf: reason capped at 300 chars, last good file kept");
  const v = pdfView(p, 21 + PDF_PENDING_STALE_MS + 1);
  ok(v?.status === "failed" && !!v.error && v.hasFile, "#222 pdfView: a pending render older than the stale window reads as failed");
  ok(pdfView(p, 22)?.status === "pending" && pdfView(null, 0) === null, "#222 pdfView: a live pending render stays pending; no state → null");
  ok(!("blobPath" in (pdfView(ready, 11) as object)), "#222 pdfView: the browser view never carries the storage path");
  ok(
    revisionAwaitingPdf({ rev: 2, at: 50, reason: "sent" }, 40) && !revisionAwaitingPdf({ rev: 2, at: 30, reason: "sent" }, 40) &&
      !revisionAwaitingPdf({ rev: 2, at: 50, reason: "manual" }, 40) && !revisionAwaitingPdf({ rev: 2, at: 50, reason: "sent", pdfBlobPath: "x" }, 40),
    "#222 revisionAwaitingPdf: only a sent revision cut at/after the PDF's save and not yet copied"
  );
  const revs = [
    { rev: 1, at: 1, reason: "sent", pdfBlobPath: "r1" },
    { rev: 2, at: 2, reason: "manual" },
    { rev: 3, at: 3, reason: "sent" },
  ];
  ok(latestSentRevision(revs)?.rev === 3, "#222 latestSentRevision: the newest sent snapshot");
  ok(portalPdfSource({ revisions: revs, pdf: ready })?.path === ready.blobPath, "#222 portalPdfSource: the latest sent revision has no copy → the current ready PDF");
  ok(
    portalPdfSource({ revisions: [revs[0], revs[1], { rev: 3, at: 3, reason: "sent", pdfBlobPath: "r3" }], pdf: ready })?.path === "r3",
    "#222 portalPdfSource: the latest sent revision's copy wins over later edits"
  );
  ok(
    portalPdfSource({ revisions: [], pdf: { ...ready, status: "failed" } }) === null && portalPdfSource({ revisions: [], pdf: null }) === null,
    "#222 portalPdfSource: no ready file → nothing for the customer"
  );
  ok(
    teamPdfPath({ revisions: revs, pdf: ready }, 1) === "r1" && teamPdfPath({ revisions: revs, pdf: ready }, 3) === null && teamPdfPath({ revisions: revs, pdf: ready }, null) === ready.blobPath,
    "#222 teamPdfPath: ?rev=n reads that revision's copy, else the current file"
  );
  ok(pdfFileName("Q-2041", null) === "Q-2041.pdf" && pdfFileName("Q-2041", 3) === "Q-2041-rev3.pdf", "#222 pdfFileName: Q-id plus -rev<n>");
}
{
  ok(JSON.stringify(normalizePdfOptions(undefined)) === JSON.stringify(DEFAULT_PDF_OPTIONS), "#222 normalizePdfOptions: absent → every toggle on, itemized");
  const n = normalizePdfOptions({ detail: "sectioned", pdfPrices: false, pdfQty: "no", junk: 1 });
  ok(n.detail === "sectioned" && n.pdfPrices === false && n.pdfQty === true && !("junk" in n), "#222 normalizePdfOptions: keeps real booleans, drops junk, defaults the rest");
  ok(normalizePdfOptions({ detail: "weird" }).detail === "itemized", "#222 normalizePdfOptions: an unknown detail falls back to itemized");
}
{
  ok(originFrom("localhost:3000", null) === "http://localhost:3000", "#222 originFrom: localhost defaults to http");
  ok(originFrom("quartzite-six.vercel.app", "https") === "https://quartzite-six.vercel.app", "#222 originFrom: forwarded proto + host");
  ok(originFrom("evil.com/x", "https") === null && originFrom("", "https") === null, "#222 originFrom: a host with a path, or no host, is refused");
  ok(
    originFrom("ignored:1", "http", "https://app.example.com/") === "https://app.example.com" && originFrom("x", "http", "not a url") === null,
    "#222 originFrom: QUOTE_PDF_ORIGIN wins, and a malformed one refuses"
  );
}
{
  const dlSource = { system: "daylite", importedAt: 1 };
  ok(
    !isAppEraProject({ id: "P-3001", source: dlSource }) && !isAppEraProject({ id: "P-dl-abc123" }) && isAppEraProject({ id: "P-3002", source: null }),
    "#220 isAppEraProject: Daylite-sourced and legacy P-dl-* projects stay internal"
  );
  const proj = {
    id: "P-3003", name: "Main stage rigging", kind: "project" as const, projectType: "system", stage: "install",
    stageMeta: { pipelineId: "install", tag: "onsite" as const, label: "Install", index: 3, count: 7 },
    installStart: 100, installEnd: 200, targetDate: 300, value: 48000.4, valueUnknown: false, updatedAt: 9,
    margin: 0.4, procurement: [{}], crew: [{}], timeLogs: [{}], notes: [{}], tasks: [{}], owner: "Jeff", deliveries: [{}], mobilizations: [{}],
  };
  const view = portalProjectView(proj, { venueName: "Hall A", quoteStatus: "won" });
  ok(Object.keys(view).sort().join(",") === "done,end,id,name,stage,start,target,type,updatedAt,value,venue", "#220 portalProjectView: whitelists exactly the customer-safe fields");
  ok(view.value === 48000 && view.venue === "Hall A" && view.type === "Installation" && view.stage === "Install" && !view.done, "#220 portalProjectView: value, venue, type label, stage label");
  ok(
    portalProjectView(proj, { venueName: "", quoteStatus: "sent" }).value === null && portalProjectView({ ...proj, valueUnknown: true }, { venueName: "", quoteStatus: "won" }).value === null,
    "#220 portalProjectView: value only when known and the linked quote is won"
  );
  ok(
    portalProjectView({ ...proj, kind: "order", projectType: null }, { venueName: "", quoteStatus: null }).type === "Order" &&
      portalProjectView({ ...proj, projectType: "flame_test" }, { venueName: "", quoteStatus: null }).type === "Flame test",
    "#220 portalProjectView: order and service type labels"
  );
  const doneView = portalProjectView({ ...proj, stageMeta: { ...proj.stageMeta, tag: "done" as const, label: "Complete" }, updatedAt: 20 }, { venueName: "", quoteStatus: null });
  const g = groupPortalProjects([view, doneView]);
  ok(g.active.length === 1 && g.active[0] === view && g.history.length === 1 && g.history[0].stage === "Complete", "#220 groupPortalProjects: Complete → History, everything else Active");
  const gq = groupPortalQuotes([
    { id: "a", status: "sent", updatedAt: 1 },
    { id: "b", status: "won", updatedAt: 2 },
    { id: "c", status: "draft", updatedAt: 3 },
    { id: "d", status: "lost", updatedAt: 4 },
  ]);
  ok(gq.open.map((q) => q.id).join(",") === "c,a" && gq.history.map((q) => q.id).join(",") === "d,b", "#220 groupPortalQuotes: sent + own drafts Open, won + lost History, newest first");
}
```

- [ ] **Step 2: Run to verify it fails.** `npx tsc --noEmit 2>&1 | head -5` — expected: `Cannot find module '@/lib/quote-pdf/token'` (and the other four).

- [ ] **Step 3: Create `src/lib/quote-pdf/state.ts`.**

```ts
/**
 * Saved quote PDFs (#222) — the pure half: the state a quote's `pdf` field
 * moves through, the browser-facing view of it, and the path rules the team
 * and portal download routes share. No I/O and no store imports, so client
 * components (the Estimator preview, the service builders) import it freely.
 */

export type PdfKind = "quote" | "flame" | "repair" | "inspection";
export type QuotePdfStatus = "pending" | "ready" | "failed";

/**
 * Stored on the quote doc as `pdf`. `savedAt` names the save the file (or the
 * in-flight render) was made from — the supersede key. `blobPath` is the last
 * GOOD file and survives a pending re-render and a failure, so the preview
 * never goes blank. Server-written only; never accepted from a request.
 */
export type QuotePdfState = {
  status: QuotePdfStatus;
  at: number;
  savedAt: number;
  blobPath?: string;
  error?: string;
};

/** What a browser sees: the state without the storage path. */
export type QuotePdfView = {
  status: QuotePdfStatus;
  at: number;
  savedAt: number;
  error: string | null;
  hasFile: boolean;
};

export type PdfOutcome = { ok: true; blobPath: string } | { ok: false; error: string };

/** A render still "pending" this long after it started died with its function. */
export const PDF_PENDING_STALE_MS = 150_000;
export const PDF_STALE_ERROR = "The PDF didn’t finish rendering — try again.";
const ERROR_MAX = 300;

/** Which document a quote prints as — null for types with no saved PDF. */
export function pdfKindForQuoteType(quoteType: string | null | undefined): PdfKind | null {
  if (!quoteType || quoteType === "system") return "quote";
  if (quoteType === "flame_test") return "flame";
  if (quoteType === "repair") return "repair";
  if (quoteType === "inspection") return "inspection";
  return null;
}

export function printPathFor(kind: PdfKind, id: string): string {
  const eid = encodeURIComponent(id);
  return kind === "quote" ? `/print/quote/${eid}` : `/print/letter/${kind}/${eid}`;
}

export function pdfStoragePath(quoteId: string, name: string): string {
  return `quote-pdfs/${quoteId.replace(/[^A-Za-z0-9_-]/g, "_")}/${name}.pdf`;
}

export function pendingPdf(cur: QuotePdfState | null | undefined, savedAt: number, now: number): QuotePdfState {
  return { status: "pending", at: now, savedAt, ...(cur?.blobPath ? { blobPath: cur.blobPath } : {}) };
}

export function failedPdf(cur: QuotePdfState | null | undefined, savedAt: number, error: string, now: number): QuotePdfState {
  return {
    status: "failed",
    at: now,
    savedAt,
    error: (error || "The PDF couldn’t be made.").slice(0, ERROR_MAX),
    ...(cur?.blobPath ? { blobPath: cur.blobPath } : {}),
  };
}

/** Settle a render. `undefined` means superseded: a newer save owns the state. */
export function settlePdf(
  cur: QuotePdfState | null | undefined,
  savedAt: number,
  outcome: PdfOutcome,
  now: number
): QuotePdfState | undefined {
  if (!cur || cur.savedAt !== savedAt) return undefined;
  if (outcome.ok) return { status: "ready", at: now, savedAt, blobPath: outcome.blobPath };
  return failedPdf(cur, savedAt, outcome.error, now);
}

export function pdfView(pdf: QuotePdfState | null | undefined, now: number): QuotePdfView | null {
  if (!pdf) return null;
  const stale = pdf.status === "pending" && now - pdf.at > PDF_PENDING_STALE_MS;
  return {
    status: stale ? "failed" : pdf.status,
    at: pdf.at,
    savedAt: pdf.savedAt,
    error: stale ? PDF_STALE_ERROR : pdf.error ?? null,
    hasFile: !!pdf.blobPath,
  };
}

type RevisionPdfFields = { rev: number; at: number; reason: string; pdfBlobPath?: string };

/** A sent revision still owed a copy of the PDF made from a save at/before it. */
export function revisionAwaitingPdf(rev: RevisionPdfFields | null | undefined, pdfSavedAt: number): boolean {
  return !!rev && rev.reason === "sent" && !rev.pdfBlobPath && rev.at >= pdfSavedAt;
}

export function latestSentRevision<R extends RevisionPdfFields>(revisions: R[] | null | undefined): R | null {
  const revs = Array.isArray(revisions) ? revisions : [];
  for (let i = revs.length - 1; i >= 0; i--) if (revs[i]?.reason === "sent") return revs[i];
  return null;
}

type PdfSourceFields = { pdf?: QuotePdfState | null; revisions?: RevisionPdfFields[] | null };

/** What a customer may open: the latest sent revision's copy, else the current READY file. */
export function portalPdfSource(q: PdfSourceFields): { path: string; rev: number | null } | null {
  const sent = latestSentRevision(q.revisions);
  if (sent?.pdfBlobPath) return { path: sent.pdfBlobPath, rev: sent.rev };
  if (q.pdf?.status === "ready" && q.pdf.blobPath) return { path: q.pdf.blobPath, rev: null };
  return null;
}

/** The team's file: revision `rev`'s copy, or the current file whatever its status. */
export function teamPdfPath(q: PdfSourceFields, rev: number | null): string | null {
  if (rev != null) return (Array.isArray(q.revisions) ? q.revisions : []).find((r) => r.rev === rev)?.pdfBlobPath ?? null;
  return q.pdf?.blobPath ?? null;
}

export function pdfFileName(quoteId: string, rev: number | null): string {
  return quoteId.replace(/[^A-Za-z0-9_-]/g, "_") + (rev != null ? `-rev${rev}` : "") + ".pdf";
}
```

- [ ] **Step 4: Create `src/lib/quote-pdf/token.ts`.**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PdfKind } from "./state";

/**
 * Print-route tokens (#222). The headless browser that prints a quote has no
 * team session, so each print URL carries a short-lived HMAC of
 * "print:<kind>:<id>:<exp>" keyed by AUTH_SECRET. Pure: the secret and the
 * clock are parameters, so the harness tests expiry and tampering directly.
 * Server-only (node:crypto) — never import from a client component.
 */
export const PRINT_TOKEN_TTL_MS = 120_000;

function mac(secret: string, kind: PdfKind, id: string, exp: number): string {
  return createHmac("sha256", secret).update(`print:${kind}:${id}:${exp}`).digest("base64url");
}

export function signPrintToken(secret: string, kind: PdfKind, id: string, nowMs: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a print token.");
  const exp = nowMs + PRINT_TOKEN_TTL_MS;
  return `${exp}.${mac(secret, kind, id, exp)}`;
}

export function verifyPrintToken(secret: string, token: string, kind: PdfKind, id: string, nowMs: number): boolean {
  if (!secret || typeof token !== "string") return false;
  const m = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || nowMs > exp || exp - nowMs > PRINT_TOKEN_TTL_MS) return false;
  const want = Buffer.from(mac(secret, kind, id, exp));
  const have = Buffer.from(m[2]);
  return want.length === have.length && timingSafeEqual(want, have);
}
```

- [ ] **Step 5: Create `src/lib/quote-pdf/pdf-options.ts`.**

```ts
/**
 * The customer preview's "Show on PDF" choices (#222), saved on the quote as
 * `pdfOptions` so the stored PDF is reproducible from saved data alone. Pure
 * and client-safe. The boolean named `pdfOptions` inside is the existing
 * "Options" toggle (option-flagged lines) — the name predates this object.
 */
export type QuotePdfOptions = {
  detail: "itemized" | "sectioned";
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
};

export const PDF_TOGGLE_KEYS = ["pdfQty", "pdfNotes", "pdfPrices", "pdfCover", "pdfTerms", "pdfOptions"] as const;

export const DEFAULT_PDF_OPTIONS: QuotePdfOptions = {
  detail: "itemized",
  pdfQty: true,
  pdfNotes: true,
  pdfPrices: true,
  pdfCover: true,
  pdfTerms: true,
  pdfOptions: true,
};

export function normalizePdfOptions(raw: unknown): QuotePdfOptions {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: QuotePdfOptions = { ...DEFAULT_PDF_OPTIONS, detail: o.detail === "sectioned" ? "sectioned" : "itemized" };
  for (const k of PDF_TOGGLE_KEYS) {
    const v = o[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}
```

- [ ] **Step 6: Create `src/lib/quote-pdf/origin.ts`.**

```ts
/**
 * The origin the headless browser prints from (#222). QUOTE_PDF_ORIGIN pins it;
 * otherwise it is the request's own host (on Vercel the platform routed the
 * request by that host, so it is one of this project's domains). A host that
 * isn't a bare hostname[:port] is refused — the signed print URL is never sent
 * anywhere a request header made up.
 */
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const FIXED_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/;

export function originFrom(host: string | null, proto: string | null, fixed?: string | null): string | null {
  if (fixed) return FIXED_RE.test(fixed.trim()) ? fixed.trim().replace(/\/+$/, "") : null;
  const h = (host || "").trim();
  if (!h || !HOST_RE.test(h)) return null;
  const p = (proto || "").split(",")[0].trim().toLowerCase();
  const scheme = p === "http" || p === "https" ? p : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? "http" : "https";
  return `${scheme}://${h}`;
}
```

- [ ] **Step 7: Create `src/lib/portal-projects.ts`.**

```ts
import type { ProjectRecord } from "@/lib/stores/projects";

/**
 * Customer portal project history (#220). Pure. App-era only: a Daylite import
 * (`source.system === "daylite"`) or a July-script `P-dl-*` record stays
 * internal. `portalProjectView` is the ONE whitelist of what a customer sees
 * about a project — never margin, procurement, crew, time logs, notes, tasks,
 * owner, deliveries or mobilizations.
 */

export const PORTAL_PROJECT_TYPE_LABEL: Record<string, string> = {
  system: "Installation",
  flame_test: "Flame test",
  repair: "Repair",
  inspection: "Inspection",
  consulting: "Consulting",
  rental: "Rental",
};

export function isAppEraProject(p: { id: string; source?: unknown }): boolean {
  const sys = (p.source as { system?: unknown } | null | undefined)?.system;
  if (sys === "daylite") return false;
  return !String(p.id || "").startsWith("P-dl-");
}

export type PortalProjectInput = Pick<
  ProjectRecord,
  "id" | "name" | "kind" | "projectType" | "installStart" | "installEnd" | "targetDate" | "value" | "updatedAt"
> & { stageMeta?: { tag?: string; label?: string } | null; valueUnknown?: boolean };

export type PortalProjectView = {
  id: string;
  name: string;
  venue: string;
  type: string;
  stage: string;
  start: number | null;
  end: number | null;
  target: number | null;
  value: number | null;
  done: boolean;
  updatedAt: number;
};

export function portalProjectView(
  p: PortalProjectInput,
  ctx: { venueName: string; quoteStatus: string | null }
): PortalProjectView {
  const typeKey = p.projectType || "system";
  return {
    id: p.id,
    name: p.name || "Project",
    venue: ctx.venueName || "",
    type: p.kind === "order" && typeKey === "system" ? "Order" : PORTAL_PROJECT_TYPE_LABEL[typeKey] || "Project",
    stage: p.stageMeta?.label || "",
    start: p.installStart ?? null,
    end: p.installEnd ?? null,
    target: p.targetDate ?? null,
    value: !p.valueUnknown && typeof p.value === "number" && p.value > 0 && ctx.quoteStatus === "won" ? Math.round(p.value) : null,
    done: p.stageMeta?.tag === "done",
    updatedAt: p.updatedAt || 0,
  };
}

function newestFirst<T extends { updatedAt?: number }>(a: T, b: T): number {
  return (b.updatedAt || 0) - (a.updatedAt || 0);
}

export function groupPortalProjects(views: PortalProjectView[]): { active: PortalProjectView[]; history: PortalProjectView[] } {
  return {
    active: views.filter((v) => !v.done).sort(newestFirst),
    history: views.filter((v) => v.done).sort(newestFirst),
  };
}

/** Open = sent + the customer's own drafts; History = won + lost. Newest first. */
export function groupPortalQuotes<T extends { status: string; updatedAt?: number }>(quotes: T[]): { open: T[]; history: T[] } {
  return {
    open: quotes.filter((q) => q.status === "sent" || q.status === "draft").sort(newestFirst),
    history: quotes.filter((q) => q.status === "won" || q.status === "lost").sort(newestFirst),
  };
}
```

- [ ] **Step 8: Run the gates.**
  - `npx tsc --noEmit` → 0 errors.
  - `npm run test:specs > "$TMPDIR/specs-t1.log" 2>&1; grep -c '^PASS' "$TMPDIR/specs-t1.log"; grep '^FAIL' "$TMPDIR/specs-t1.log"; grep -c '^PASS #22[02]' "$TMPDIR/specs-t1.log"` → no FAIL; PASS = baseline + 44; `#222/#220` PASS = 44.
  - `npx eslint src/lib/quote-pdf src/lib/portal-projects.ts scripts/test-review-and-spec.ts` → 0 errors.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/quote-pdf/token.ts src/lib/quote-pdf/state.ts src/lib/quote-pdf/pdf-options.ts src/lib/quote-pdf/origin.ts src/lib/portal-projects.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): pure PDF state, print tokens and portal project view (#222, #220)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One customer document — `QuoteDocument`, letter views, signed print routes, saved `pdfOptions`

**Files:**
- Create: `src/app/(app)/estimator/quote-document.tsx` (extracted from `preview-doc.tsx`), `src/lib/quote-pdf/quote-document-data.ts`, `src/app/print/quote/[id]/page.tsx`, `src/app/print/letter/[kind]/[id]/page.tsx`
- Rename + modify: `src/app/(app)/{flame-tests,repairs,inspections}/letter/page.tsx` → `letter-view.tsx`; Create new thin `page.tsx` in each
- Modify: `src/app/(app)/estimator/preview-doc.tsx`, `src/middleware.ts`, `src/lib/stores/quotes.ts` (Quote type), `src/app/(app)/estimator/{types.ts,page.tsx,actions.ts,estimator-client.tsx}`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Task 1 `verifyPrintToken`, `pdfKindForQuoteType`, `PdfKind`, `QuotePdfOptions`, `DEFAULT_PDF_OPTIONS`, `normalizePdfOptions`.
- Produces:
  - `quote-document.tsx`: `export type QuoteDocumentProps` (fields: `quoteId, revNum, revDateMs, custName, hasAttn, attnLine, projectName, venueLabel, ownerName, companyName, logoDark, quoteNote, assumptions, sections, vendorQuotes, t, taxRatePct, detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, paymentTerms`), `export const QUOTE_PRINT_CSS: string`, `export default function QuoteDocument(p: QuoteDocumentProps)`.
  - `quoteDocumentDataFor(q, cust, settings): QuoteDocumentProps`.
  - Letter views: `FlameLetterView`, `RepairLetterView`, `InspectionLetterView` — each `async ({ id }: { id: string }) => JSX`.
  - Routes: `GET /print/quote/<id>?t=<token>`, `GET /print/letter/<flame|repair|inspection>/<id>?t=<token>`.
  - `Quote.pdfOptions?: QuotePdfOptions | null`; `InitialQuote.pdfOptions: QuotePdfOptions`; `SavePayload.pdfOptions: QuotePdfOptions`.
  - Estimator client: `pdfOpts` (memoized `QuotePdfOptions`) — Task 5 reuses it.

- [ ] **Step 1: Write the failing tests.** Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ============ #222 Task 2 — one customer document, signed print routes, saved pdfOptions ============ */
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { create as q222Create, get as q222Get, update as q222Update } from "@/lib/stores/quotes";
import { fixtureId as fixtureId222, registerFixture as registerFixture222 } from "./test-fixtures";
{
  const src222 = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const qd = src222("src/app/(app)/estimator/quote-document.tsx");
  ok(!/^\s*["']use client["']/.test(qd) && !/\buse(State|Effect|Memo|Ref|Transition)\(/.test(qd) && !/onClick=/.test(qd), "#222 QuoteDocument: no client directive, no hooks, no handlers — the print route renders it on the server");
  const pd = src222("src/app/(app)/estimator/preview-doc.tsx");
  ok(!pd.includes('className="est-doc"') && !pd.includes("customerLines("), "#222 PreviewDoc carries no copy of the customer document (it lives in QuoteDocument)");
  ok(/\|print\/\|/.test(src222("src/middleware.ts")), "#222 middleware: /print/ is exempt from the team login (it checks its own token)");
  for (const p of ["src/app/print/quote/[id]/page.tsx", "src/app/print/letter/[kind]/[id]/page.tsx"]) {
    const s = src222(p);
    ok(s.indexOf("verifyPrintToken(") > -1 && s.indexOf("verifyPrintToken(") < s.indexOf("getQuote("), `#222 ${p}: the token is checked before any quote is read`);
  }
  for (const k of ["flame-tests", "repairs", "inspections"]) {
    const view = src222(`src/app/(app)/${k}/letter/letter-view.tsx`);
    const page = src222(`src/app/(app)/${k}/letter/page.tsx`);
    ok(!view.includes("requireUser") && page.includes("requireUser()") && /LetterView id=\{id\}/.test(page), `#222 ${k} letter: the page keeps the team login; the shared view has none`);
  }
}
{
  const q = {
    id: "Q-9", name: "Stage package", customer: "Old Name", customerId: "co-1", locationId: "st-2", contactName: "Pat Lee",
    quoteNote: "Hi", assumptions: "A", owner: "Jeff Chesebro", updatedAt: 1234, createdAt: 1000, revisions: [{}, {}],
    spec: { sections: [] }, vendorQuotes: [], paymentTerms: "Net 30", pdfOptions: { detail: "sectioned", pdfPrices: false },
  };
  const cust = {
    name: "Civic Center",
    locations: [{ id: "st-1", label: "Hall", city: "X", primary: true }, { id: "st-2", label: "Theater", city: "Denver", primary: false }],
    contacts: [{ name: "Pat Lee", role: "TD", email: "", primary: false }],
  };
  const d = quoteDocumentDataFor(q as never, cust as never, { companyName: "Peak", logoDark: null });
  ok(d.custName === "Civic Center" && d.venueLabel === "Theater — Denver" && d.hasAttn && d.attnLine === "Pat Lee · TD", "#222 quoteDocumentDataFor: customer, venue and attn exactly as the Estimator preview shows them");
  ok(d.revNum === 2 && d.revDateMs === 1234 && d.detail === "sectioned" && d.pdfPrices === false && d.pdfQty === true && d.paymentTerms === "Net 30", "#222 quoteDocumentDataFor: revision, date, saved pdfOptions, terms");
  ok(d.t.grand === 0 && d.sections.length === 0 && d.ownerName === "Jeff Chesebro" && d.companyName === "Peak", "#222 quoteDocumentDataFor: totals from saved sections, owner, company");
  const bare = quoteDocumentDataFor({ id: "Q-10", name: "", customer: "Walk-in", customerId: null, owner: "", updatedAt: 5, createdAt: 5 } as never, null, { companyName: "", logoDark: null });
  ok(
    bare.custName === "Walk-in" && bare.venueLabel === "" && !bare.hasAttn && bare.revNum === 1 && bare.paymentTerms === "Unknown" &&
      bare.companyName === "Peak Systems Group" && bare.ownerName === "Peak Systems Group",
    "#222 quoteDocumentDataFor: an unlinked quote falls back without inventing data"
  );
}

async function quotePdfOptions222AsyncChecks(): Promise<void> {
  const id = fixtureId222("222", "opts");
  registerFixture222("quotes", id);
  await q222Create({ id, name: "#222 opts", customer: "Spec fixture", owner: "spec" });
  await q222Update(id, { pdfOptions: { ...DEFAULT_PDF_OPTIONS, detail: "sectioned", pdfTerms: false } });
  const back = normalizePdfOptions((await q222Get(id))?.pdfOptions);
  ok(back.detail === "sectioned" && back.pdfTerms === false && back.pdfQty === true, "#222 pdfOptions: saved on the quote and read back");
}
```

Then add this line to the promise chain, immediately ABOVE `  // Before the report and before the \`.catch\`, so a thrown suite is torn`:

```ts
  .then(() => quotePdfOptions222AsyncChecks())
```

- [ ] **Step 2: Run to verify it fails.** `npx tsc --noEmit 2>&1 | head -5` → `Cannot find module '@/lib/quote-pdf/quote-document-data'` and `pdfOptions` does not exist on `Partial<Quote>`.

- [ ] **Step 3: Add `pdfOptions` to the Quote type.** In `src/lib/stores/quotes.ts`, after the line `import { isProjectExcludedQuoteType } from "@/lib/project-quote-types";` add:

```ts
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
```

Replace

```ts
  /** Append-only priced snapshots (punch item 24). Absent on pre-D84 quotes. */
  revisions?: QuoteRevision[];
};
```

with

```ts
  /** Append-only priced snapshots (punch item 24). Absent on pre-D84 quotes. */
  revisions?: QuoteRevision[];
  /** Customer-preview "Show on PDF" choices (#222) — saved with the quote so the
   *  stored PDF is reproducible. Read through normalizePdfOptions. */
  pdfOptions?: QuotePdfOptions | null;
};
```

- [ ] **Step 4: Extract `QuoteDocument`.** First confirm the anchors (the script refuses to run if any moved):

```bash
cat > "$TMPDIR/qd-head.tsx" <<'EOF'
import type { CSSProperties } from "react";
import letterhead from "./peak-letterhead.jpg";
import { customerLines, fmt, lineExtSellOf, systemFreight, systemItemsRev, type QuoteTotals } from "./pricing";
import type { PaymentTerms, SpecItem, SpecSection, VendorQuote } from "./types";

/**
 * The customer quote document (#222) — ONE component for both places it
 * appears: the signed print route (/print/quote/[id]) that headless Chrome
 * turns into the saved PDF, and (until the preview shows that PDF) the
 * Estimator's customer preview. No "use client", no hooks and no handlers, so
 * a server component can render it from saved data alone. Its controls (Show
 * on PDF, per-system Itemized/Narrative) live in PreviewDoc's sidebar.
 *
 * D69 redesign (Jeff, Jul 12): branded accent styling, a document title
 * block, the REAL project/venue, an at-a-glance investment band, Optional
 * additions, itemized terms, and an acceptance/signature block.
 */

export type QuoteDocumentProps = {
  quoteId: string;
  revNum: number;
  revDateMs: number;
  custName: string;
  hasAttn: boolean;
  attnLine: string;
  projectName: string;
  /** "Label — City" for the selected customer venue ("" when none). */
  venueLabel: string;
  ownerName: string;
  companyName: string;
  /** Uploaded document logo (Settings → Branding), falls back to the baked letterhead. */
  logoDark: string | null;
  quoteNote: string;
  assumptions: string;
  sections: SpecSection[];
  /** #143 — a vendor line reads from its record here too, but NEVER its cost,
   *  terms or notes: those are internal only (Jeff). */
  vendorQuotes: VendorQuote[];
  t: QuoteTotals;
  taxRatePct: number;
  detail: "itemized" | "sectioned";
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
  paymentTerms: PaymentTerms;
};

/** Page CSS for the print route: Letter, 0.6in margins, the on-screen sheet
 *  chrome removed, the same keep-together rules window.print() used. */
export const QUOTE_PRINT_CSS = `
@page { size: letter; margin: 0.6in; }
html, body { background: #fff !important; margin: 0; height: auto !important; }
nextjs-portal { display: none !important; }
.pk-no-print { display: none !important; }
.est-doc { width: auto !important; height: auto !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; border-radius: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.est-doc .est-secband { break-inside: avoid; break-after: avoid; page-break-after: avoid; }
.est-doc .est-line, .est-doc .est-optbox, .est-doc .est-totals, .est-doc .est-terms, .est-doc .est-accept, .est-doc .est-sig { break-inside: avoid; page-break-inside: avoid; }
`;

EOF
node - <<'EOF'
const fs = require("fs");
const F = "src/app/(app)/estimator/preview-doc.tsx";
const O = "src/app/(app)/estimator/quote-document.tsx";
const L = fs.readFileSync(F, "utf8").split("\n");
const must = [[19, "const ACCENT_INK"], [46, "const microLabel"], [94, "const DAY_MS"], [109, "function longDate"],
  [118, "  const isItemized"], [218, "  const showOptions"], [375, "        <div"], [376, '          className="est-doc"'], [908, "        </div>"]];
for (const [n, s] of must) if (!L[n - 1].startsWith(s)) { console.error(`anchor moved at line ${n}: ${L[n - 1]}`); process.exit(1); }
const lines = (a, b) => L.slice(a - 1, b).join("\n");
const out = [
  fs.readFileSync(process.env.TMPDIR + "/qd-head.tsx", "utf8").trimEnd(), "",
  lines(19, 20), "", lines(46, 52), "", lines(94, 94), "", lines(109, 115), "",
  "export default function QuoteDocument(p: QuoteDocumentProps) {",
  lines(118, 218), "", "  return (", lines(375, 908), "  );", "}", "",
].join("\n");
fs.writeFileSync(O, out);
console.log("wrote " + O);
EOF
```

Then, in the new `src/app/(app)/estimator/quote-document.tsx`, replace

```tsx
                  {ps.subtotalLabel}
                  <button type="button" className="pk-no-print" onClick={() => p.setSectionPresentation(ps.id, ps.presentation === "narrative" ? "itemized" : "narrative")} style={{ marginLeft: 8, border: "1px solid rgba(255,255,255,.25)", borderRadius: 5, background: "transparent", color: "#fff", fontSize: 10, padding: "3px 6px", cursor: "pointer" }}>
                    {ps.presentation === "narrative" ? "Narrative" : "Itemized"}
                  </button>
```

with

```tsx
                  {ps.subtotalLabel}
```

- [ ] **Step 5: Point `PreviewDoc` at `QuoteDocument`.** It keeps its sidebar (and, until Task 5, `window.print()` + `PRINT_CSS`, which still print `.est-doc`). The per-system Itemized/Narrative toggle moves into the sidebar.

```bash
cat > "$TMPDIR/pd-props.ts" <<'EOF'
export type PreviewProps = QuoteDocumentProps & {
  phone: boolean;
  canBuild: boolean;
  onBack: () => void;
  setSectionPresentation: (id: string, value: "itemized" | "narrative") => void;
  setDetail: (d: "itemized" | "sectioned") => void;
  paymentTermsOptions: readonly PaymentTerms[];
  setPaymentTerms: (terms: PaymentTerms) => void;
  togglePdf: (flag: "pdfQty" | "pdfNotes" | "pdfPrices" | "pdfCover" | "pdfTerms" | "pdfOptions") => void;
};
EOF
cat > "$TMPDIR/pd-sections.tsx" <<'EOF'
        {sectionToggles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Systems
            </span>
            {sectionToggles.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#3a3f4a", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </span>
                <button
                  type="button"
                  onClick={() => p.setSectionPresentation(s.id, s.presentation === "narrative" ? "itemized" : "narrative")}
                  style={segOn}
                >
                  {s.presentation === "narrative" ? "Narrative" : "Itemized"}
                </button>
              </div>
            ))}
          </div>
        )}
EOF
node - <<'EOF'
const fs = require("fs");
const F = "src/app/(app)/estimator/preview-doc.tsx";
let L = fs.readFileSync(F, "utf8").split("\n");
const must = [[4, "import letterhead"], [5, "import { customerLines"], [6, "import type { PaymentTerms"], [19, "const ACCENT_INK"],
  [46, "const microLabel"], [54, "export type PreviewProps"], [92, "};"], [94, "const DAY_MS"], [109, "function longDate"],
  [118, "  const isItemized"], [218, "  const showOptions"], [344, "        </div>"], [345, "        <button"], [375, "        <div"], [908, "        </div>"]];
for (const [n, s] of must) if (!L[n - 1].startsWith(s)) { console.error(`anchor moved at line ${n}: ${L[n - 1]}`); process.exit(1); }
const read = (f) => fs.readFileSync(process.env.TMPDIR + "/" + f, "utf8").replace(/\n$/, "").split("\n");
const replace = (a, b, repl) => L.splice(a - 1, b - a + 1, ...repl);
// bottom-up so earlier line numbers stay valid
replace(375, 908, ["        <QuoteDocument {...p} />"]);
L.splice(344, 0, ...read("pd-sections.tsx"));
replace(118, 218, [
  '  const isItemized = p.detail === "itemized";',
  "  // Per-system Itemized/Narrative lives in this sidebar: the document itself is",
  "  // shared with the signed print route (#222) and carries no controls.",
  "  const sectionToggles = p.sections",
  "    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0)",
  '    .map((sec) => ({ id: sec.id, name: sec.name, presentation: sec.presentation || "itemized" }));',
]);
replace(109, 116, []);
replace(94, 95, []);
replace(54, 92, read("pd-props.ts"));
replace(46, 53, []);
replace(19, 21, []);
replace(4, 6, [
  'import QuoteDocument, { type QuoteDocumentProps } from "./quote-document";',
  'import { systemFreight, systemItemsRev } from "./pricing";',
  'import type { PaymentTerms } from "./types";',
]);
fs.writeFileSync(F, L.join("\n"));
console.log("rewrote " + F);
EOF
grep -n "QuoteDocument\|sectionToggles\|window.print" "src/app/(app)/estimator/preview-doc.tsx"
```

Expected grep: the two imports/usages of `QuoteDocument`, the `sectionToggles` lines, and one `window.print()`.

- [ ] **Step 6: Create `src/lib/quote-pdf/quote-document-data.ts`.**

```ts
import type { CustomerDoc } from "@/lib/stores/customers";
import type { AppSettingsData } from "@/lib/settings";
import type { Quote } from "@/lib/stores/quotes";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { totals } from "@/app/(app)/estimator/pricing";
import { PAYMENT_TERMS, type PaymentTerms, type SpecSection, type VendorQuote } from "@/app/(app)/estimator/types";
import { normalizePdfOptions } from "./pdf-options";

/**
 * A saved quote → the props of the customer QuoteDocument (#222). Mirrors what
 * the Estimator hands PreviewDoc (estimator-client.tsx: custName, the "attn"
 * contact ladder, "Label — City" venue, Rev = revisions.length) so the saved
 * PDF and the builder agree. Pure given its inputs; the print route loads them.
 */

/** The Estimator's TAX_RATE_PCT (estimator-client.tsx) — no tax line today. */
const TAX_RATE_PCT = 0;

type DocQuote = Quote & { paymentTerms?: string };
type DocCustomer = Pick<CustomerDoc, "name" | "locations" | "contacts">;

export function quoteDocumentDataFor(
  q: DocQuote,
  cust: DocCustomer | null,
  settings: Pick<AppSettingsData, "companyName" | "logoDark">
): QuoteDocumentProps {
  const spec = (q.spec || null) as { sections?: unknown } | null;
  const sections = spec && Array.isArray(spec.sections) ? (spec.sections as SpecSection[]) : [];
  const vendorQuotes = Array.isArray(q.vendorQuotes)
    ? (q.vendorQuotes as VendorQuote[]).filter((v) => !!v && typeof v.id === "string")
    : [];
  const contacts = cust?.contacts || [];
  const contactName = q.contactName || "";
  const current =
    contacts.length && contactName
      ? contacts.find((c) => c.name === contactName) || contacts.find((c) => c.primary) || contacts[0]
      : null;
  const loc = cust && q.locationId ? (cust.locations || []).find((l) => l.id === q.locationId) : undefined;
  const companyName = settings.companyName || "Peak Systems Group";
  const paymentTerms: PaymentTerms = (PAYMENT_TERMS as readonly string[]).includes(q.paymentTerms || "")
    ? (q.paymentTerms as PaymentTerms)
    : "Unknown";
  return {
    quoteId: q.id,
    revNum: Math.max(1, q.revisions?.length || 1),
    revDateMs: q.updatedAt || q.createdAt || 0,
    custName: (q.customerId && cust?.name) || q.customer || "",
    hasAttn: current ? true : !!contactName,
    attnLine: current ? current.name + (current.role ? " · " + current.role : "") : contactName,
    projectName: q.name || "",
    venueLabel: loc ? [loc.label || "", loc.city || ""].filter(Boolean).join(" — ") : "",
    ownerName: q.owner || companyName,
    companyName,
    logoDark: settings.logoDark || null,
    quoteNote: q.quoteNote || "",
    assumptions: q.assumptions || "",
    sections,
    vendorQuotes,
    t: totals(sections, TAX_RATE_PCT),
    taxRatePct: TAX_RATE_PCT,
    ...normalizePdfOptions(q.pdfOptions),
    paymentTerms,
  };
}
```

- [ ] **Step 7: Create `src/app/print/quote/[id]/page.tsx`.**

```tsx
import { notFound } from "next/navigation";
import QuoteDocument, { QUOTE_PRINT_CSS } from "@/app/(app)/estimator/quote-document";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getCustomer } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quote", robots: { index: false, follow: false } };

/**
 * Signed print route for an Estimator quote (#222). Headless Chrome loads this
 * with a 120 s token and prints it to the saved PDF. Outside the team login
 * (middleware exempts /print/); the token is the only key, checked before any
 * read. Renders from saved data only — the same QuoteDocument the team sees.
 */
export default async function PrintQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  if (!t || !verifyPrintToken(process.env.AUTH_SECRET || "", t, "quote", id, Date.now())) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") notFound();
  const [cust, settings] = await Promise.all([getCustomer(q.customerId), getSettings()]);
  return (
    <main>
      <style>{QUOTE_PRINT_CSS}</style>
      <QuoteDocument {...quoteDocumentDataFor(q, cust, settings)} />
    </main>
  );
}
```

- [ ] **Step 8: Split the three letter pages into view + page.** Move each body into `letter-view.tsx` and strip the page-only parts:

```bash
for k in flame-tests repairs inspections; do git mv "src/app/(app)/$k/letter/page.tsx" "src/app/(app)/$k/letter/letter-view.tsx"; done
node - <<'EOF'
const fs = require("fs");
const specs = [["flame-tests", "FlameLetterView"], ["repairs", "RepairLetterView"], ["inspections", "InspectionLetterView"]];
for (const [dir, view] of specs) {
  const F = `src/app/(app)/${dir}/letter/letter-view.tsx`;
  let s = fs.readFileSync(F, "utf8");
  const swaps = [
    ['import { requireUser } from "@/lib/session";\n', ""],
    [/^export const metadata = \{ title: "[^"]*" \};\n\n?/m, ""],
    ['function one(v: string | string[] | undefined): string {\n  return Array.isArray(v) ? v[0] ?? "" : v ?? "";\n}\n\n', ""],
    [/export default async function \w+\(\{\n  searchParams,\n\}: \{\n  searchParams: Promise<Record<string, string \| string\[\] \| undefined>>;\n\}\) \{\n  const \[, sp, settings\] = await Promise\.all\(\[\n    requireUser\(\),\n    searchParams,\n    getSettings\(\),\n  \]\);\n/,
      `export async function ${view}({ id }: { id: string }) {\n  const settings = await getSettings();\n`],
    ["  const id = one(sp.id);\n", ""],
  ];
  for (const [a, b] of swaps) {
    const before = s;
    s = s.replace(a, b);
    if (s === before) { console.error(`${F}: no match for ${a}`); process.exit(1); }
  }
  fs.writeFileSync(F, s);
  console.log("rewrote " + F);
}
EOF
```

Create `src/app/(app)/flame-tests/letter/page.tsx`:

```tsx
import { requireUser } from "@/lib/session";
import { FlameLetterView } from "./letter-view";

export const metadata = { title: "Field Flame Inspection — Quartzite-6" };

/** /flame-tests/letter?id=<id>. The sheet is FlameLetterView, shared with the
 *  signed print route that renders the saved PDF (#222). */
export default async function FlameTestLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const id = Array.isArray(sp.id) ? sp.id[0] ?? "" : sp.id ?? "";
  return <FlameLetterView id={id} />;
}
```

Create `src/app/(app)/repairs/letter/page.tsx`:

```tsx
import { requireUser } from "@/lib/session";
import { RepairLetterView } from "./letter-view";

export const metadata = { title: "Repair letter — Quartzite-6" };

/** /repairs/letter?id=<id>. The sheet is RepairLetterView, shared with the
 *  signed print route that renders the saved PDF (#222). */
export default async function RepairLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const id = Array.isArray(sp.id) ? sp.id[0] ?? "" : sp.id ?? "";
  return <RepairLetterView id={id} />;
}
```

Create `src/app/(app)/inspections/letter/page.tsx`:

```tsx
import { requireUser } from "@/lib/session";
import { InspectionLetterView } from "./letter-view";

export const metadata = { title: "Rigging Inspection — Quartzite-6" };

/** /inspections/letter?id=<id>. The sheet is InspectionLetterView, shared with
 *  the signed print route that renders the saved PDF (#222). */
export default async function InspectionLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const id = Array.isArray(sp.id) ? sp.id[0] ?? "" : sp.id ?? "";
  return <InspectionLetterView id={id} />;
}
```

- [ ] **Step 9: Create `src/app/print/letter/[kind]/[id]/page.tsx`.**

```tsx
import { notFound } from "next/navigation";
import { FlameLetterView } from "@/app/(app)/flame-tests/letter/letter-view";
import { InspectionLetterView } from "@/app/(app)/inspections/letter/letter-view";
import { RepairLetterView } from "@/app/(app)/repairs/letter/letter-view";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal", robots: { index: false, follow: false } };

/**
 * Signed print route for the three service proposal letters (#222). Same
 * rules as /print/quote/[id]: token first, then the quote must be the kind the
 * URL names. The letter views are the same components the team's letter pages
 * render; their toolbars are .pk-no-print, so page.pdf() (print media) drops them.
 */
export default async function PrintLetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ kind, id }, sp] = await Promise.all([params, searchParams]);
  if (kind !== "flame" && kind !== "repair" && kind !== "inspection") notFound();
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  if (!t || !verifyPrintToken(process.env.AUTH_SECRET || "", t, kind, id, Date.now())) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== kind) notFound();
  return (
    <>
      <style>{"nextjs-portal{display:none!important}"}</style>
      {kind === "flame" ? <FlameLetterView id={id} /> : kind === "repair" ? <RepairLetterView id={id} /> : <InspectionLetterView id={id} />}
    </>
  );
}
```

- [ ] **Step 10: Exempt `/print/` from the team login.** In `src/middleware.ts`, in the matcher string, replace `|portal|` with `|portal|print/|`. Add one sentence to the header comment after the `/portal` sentence: `/print/* is the headless-Chrome print route for saved quote PDFs (#222); it checks its own 120 s signed token and 404s without one.`

- [ ] **Step 11: Save `pdfOptions` from the Estimator.**
  - `src/app/(app)/estimator/types.ts`: add `import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";` after the existing `import type { TaskRecord } …` line, and in `InitialQuote` replace `  replaces: string;\n};` with:

```ts
  replaces: string;
  /** Saved Show-on-PDF choices (#222) — DEFAULT_PDF_OPTIONS for a new estimate. */
  pdfOptions: QuotePdfOptions;
};
```

  - `src/app/(app)/estimator/page.tsx`: add `import { DEFAULT_PDF_OPTIONS, normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";` after the `blobEnabled` import. In `initialFrom`, the `!q` branch: replace `      replaces: "",\n    };\n  }` with `      replaces: "",\n      pdfOptions: { ...DEFAULT_PDF_OPTIONS },\n    };\n  }`. The final return: replace `    replaces: "",\n  };\n}` with `    replaces: "",\n    pdfOptions: normalizePdfOptions(q.pdfOptions),\n  };\n}`.
  - `src/app/(app)/estimator/actions.ts`: add `import { normalizePdfOptions, type QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";` after the `totals` import. In `SavePayload`, replace

```ts
  vendorQuotes: VendorQuote[];
  /** #160 / D205 — sent on the create save only: the draft this quote replaces. */
```

with

```ts
  vendorQuotes: VendorQuote[];
  /** #222 — the preview's Show-on-PDF choices; the saved PDF prints with them. */
  pdfOptions: QuotePdfOptions;
  /** #160 / D205 — sent on the create save only: the draft this quote replaces. */
```

In `saveQuoteAction`'s `patch`, replace `    spec: { sections: payload.sections, mobs: payload.mobs },\n  };` with `    spec: { sections: payload.sections, mobs: payload.mobs },\n    pdfOptions: normalizePdfOptions(payload.pdfOptions),\n  };`. In the create branch, replace

```ts
      category: (payload.category || "").trim(),
      vendorQuotes: storedVendorQuotes,
    } as QuotePatch);
```

with

```ts
      category: (payload.category || "").trim(),
      vendorQuotes: storedVendorQuotes,
      pdfOptions: normalizePdfOptions(payload.pdfOptions),
    } as QuotePatch);
```

  - `src/app/(app)/estimator/estimator-client.tsx`: add `import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";` after `import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";`. Replace

```ts
  const [pdfQty, setPdfQty] = useState(true);
  const [pdfNotes, setPdfNotes] = useState(true);
  const [pdfCover, setPdfCover] = useState(true);
  const [pdfTerms, setPdfTerms] = useState(true);
  const [pdfOptions, setPdfOptions] = useState(true);
  const [pdfPrices, setPdfPrices] = useState(true);
  const [detail, setDetail] = useState<"itemized" | "sectioned">("itemized");
```

with

```ts
  const [pdfQty, setPdfQty] = useState(initial.pdfOptions.pdfQty);
  const [pdfNotes, setPdfNotes] = useState(initial.pdfOptions.pdfNotes);
  const [pdfCover, setPdfCover] = useState(initial.pdfOptions.pdfCover);
  const [pdfTerms, setPdfTerms] = useState(initial.pdfOptions.pdfTerms);
  const [pdfOptions, setPdfOptions] = useState(initial.pdfOptions.pdfOptions);
  const [pdfPrices, setPdfPrices] = useState(initial.pdfOptions.pdfPrices);
  const [detail, setDetail] = useState<"itemized" | "sectioned">(initial.pdfOptions.detail);
  /** #222 — the Show-on-PDF choices, saved with the quote (Quote.pdfOptions). */
  const pdfOpts = useMemo<QuotePdfOptions>(
    () => ({ detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions }),
    [detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions]
  );
```

  and in `doSave`'s payload replace `          vendorQuotes,\n        });` with `          vendorQuotes,\n          pdfOptions: pdfOpts,\n        });`.

- [ ] **Step 12: Run the gates.**
  - `npx tsc --noEmit` → 0.
  - `npm run test:specs > "$TMPDIR/specs-t2.log" 2>&1; grep -c '^PASS' "$TMPDIR/specs-t2.log"; grep '^FAIL' "$TMPDIR/specs-t2.log"` → no FAIL; PASS = Task 1 total + 13. The existing `#180` source checks on `estimator/actions.ts` must still pass (the `patch` still carries no `status`).
  - `npx eslint "src/app/(app)/estimator" "src/app/(app)/flame-tests/letter" "src/app/(app)/repairs/letter" "src/app/(app)/inspections/letter" src/app/print src/lib/quote-pdf src/middleware.ts src/lib/stores/quotes.ts scripts/test-review-and-spec.ts` → 0 errors.
  - `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` → succeeds; the route list shows `ƒ /print/quote/[id]` and `ƒ /print/letter/[kind]/[id]`.

- [ ] **Step 13: Commit.**

```bash
git add "src/app/(app)/estimator/quote-document.tsx" "src/app/(app)/estimator/preview-doc.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" "src/app/(app)/estimator/actions.ts" "src/app/(app)/estimator/estimator-client.tsx" \
  "src/app/(app)/flame-tests/letter" "src/app/(app)/repairs/letter" "src/app/(app)/inspections/letter" \
  src/app/print src/lib/quote-pdf/quote-document-data.ts src/middleware.ts src/lib/stores/quotes.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): shared customer document, signed print routes, saved pdfOptions (#222)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: PDF engine — Chrome, storage, generator, sent-revision copy

**Files:**
- Modify: `package.json`, `package-lock.json` (install), `next.config.ts`, `.env.example`, `src/lib/stores/quotes.ts`
- Create: `src/lib/quote-pdf/storage.ts`, `src/lib/quote-pdf/render.ts`, `src/lib/quote-pdf/generate.ts`, `src/lib/quote-pdf/portal-access.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Task 1 state/token helpers; `putBlob`, `getBlobStream`, `deleteBlob`, `blobEnabled` (`src/lib/blob.ts`); `portalListsQuote` (`src/lib/stores/quotes.ts:322`).
- Produces:
  - `quotes.ts`: `Quote.pdf?: QuotePdfState | null`; `QuoteRevision.pdfBlobPath?: string`; `updateQuotePdf(id, mutate: (cur: QuotePdfState | null) => QuotePdfState | undefined): Promise<{ before; after; changed: boolean } | null>` (no `updatedAt` bump); `setRevisionPdfPath(id, rev, path): Promise<boolean>`; `setStatus` copies the PDF onto a newly cut sent revision.
  - `storage.ts`: `type PdfStorage = { backend; put(path, bytes): Promise<string>; read(path): Promise<Buffer | null>; stream(path): Promise<ReadableStream | null>; remove(path): Promise<void> }`; `pdfStorage(): PdfStorage | { unavailable: string }`; `isQuotePdfPath(p)`.
  - `render.ts`: `chromeLaunch(): Promise<ChromeLaunch | { unavailable: string }>`; `renderPrintRouteToPdf(url, opts?): Promise<Buffer>`; `PdfRenderUnavailable`.
  - `generate.ts`: `generateQuotePdf({ quoteId, savedAt, origin, secret?, render? }): Promise<QuotePdfState | null>` (never throws; null = superseded or no document); `copySentRevisionPdf(quoteId): Promise<string | null>`.
  - `portal-access.ts`: `portalQuotePdfSource(q: Quote, customerId: string): { path; rev } | null`.

- [ ] **Step 1: Install and pin the engine.**

```bash
npm install --save-exact puppeteer-core@25.12.0 @sparticuz/chromium@153.0.0
grep -R "chrome:" node_modules/puppeteer-core/lib/cjs/puppeteer/revisions.js node_modules/puppeteer-core/lib/esm/puppeteer/revisions.js 2>/dev/null
```

The grep prints puppeteer's Chrome build (e.g. `chrome: '153.0.…'`). If its MAJOR is not 153, run `npm install --save-exact @sparticuz/chromium@<that major>.0.0` (sparticuz versions track Chromium majors; `npm view @sparticuz/chromium versions` lists them). Record the pair in the commit message body.

- [ ] **Step 2: Write the failing tests.** Append:

```ts
/* ============ #222 Task 3 — PDF engine: storage, generator, sent-revision copy ============ */
import { copySentRevisionPdf, generateQuotePdf } from "@/lib/quote-pdf/generate";
import { isQuotePdfPath, pdfStorage } from "@/lib/quote-pdf/storage";
import { portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { chromeLaunch, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { setStatus as q222SetStatus, updateQuotePdf as q222UpdatePdf } from "@/lib/stores/quotes";
import { readdirSync as readdirSync222 } from "node:fs";
{
  const cfg222 = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
  ok(/serverExternalPackages:[^\n]*"puppeteer-core"[^\n]*"@sparticuz\/chromium"/.test(cfg222), "#222 next.config: puppeteer-core and @sparticuz/chromium stay external");
  ok(/"\/estimator": \[[^\]]*@sparticuz\/chromium\/bin/.test(cfg222), "#222 next.config: the Chromium binary is traced into the functions that render");
}

async function quotePdfEngine222AsyncChecks(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "quote-pdfs-222-"));
  process.env.QUOTE_PDF_DIR = root;
  const store = pdfStorage();
  ok(!("unavailable" in store) && store.backend === "fs", "#222 storage: no Blob token and not on Vercel → local files under QUOTE_PDF_DIR");
  if ("unavailable" in store) return;
  ok(
    isQuotePdfPath("quote-pdfs/Q-1/2.pdf") && !isQuotePdfPath("quote-pdfs/../etc/passwd.pdf") && !isQuotePdfPath("/etc/x.pdf") && !isQuotePdfPath("quote-pdfs/Q-1/x.txt"),
    "#222 storage: only quote-pdfs/<id>/<name>.pdf paths are ever read or written"
  );
  const put = await store.put("quote-pdfs/TEST222_s/1.pdf", Buffer.from("%PDF-1.4 x"));
  ok((await store.read(put))?.toString() === "%PDF-1.4 x", "#222 storage: a written PDF reads back");
  await store.remove(put);
  ok((await store.read(put)) === null, "#222 storage: a removed PDF is gone");

  const origin = "http://print.test";
  const secret = "spec-secret-222";
  const fake = (label: string) => async () => Buffer.from(`%PDF-1.4 ${label}`);
  const dirOf = (qid: string) => join(root, "quote-pdfs", qid.replace(/[^A-Za-z0-9_-]/g, "_"));

  const id = fixtureId222("222", "gen");
  registerFixture222("quotes", id);
  await q222Create({ id, name: "#222 gen", customer: "Spec fixture", owner: "spec" });
  let seenUrl = "";
  await q222UpdatePdf(id, (cur) => pendingPdf(cur, 100, 100));
  const r1 = await generateQuotePdf({ quoteId: id, savedAt: 100, origin, secret, render: async (u) => { seenUrl = u; return Buffer.from("%PDF-1.4 one"); } });
  ok(r1?.status === "ready" && !!r1.blobPath, "#222 generate: a render lands ready with a stored file");
  ok(seenUrl.startsWith(`${origin}/print/quote/${encodeURIComponent(id)}?t=`), "#222 generate: prints the quote's own print route");
  ok(verifyPrintToken(secret, decodeURIComponent(seenUrl.split("?t=")[1]), "quote", id, Date.now()), "#222 generate: the print URL carries a token that verifies for that quote");

  await q222UpdatePdf(id, (cur) => pendingPdf(cur, 200, 200));
  const raced = await generateQuotePdf({
    quoteId: id, savedAt: 200, origin, secret,
    render: async () => { await q222UpdatePdf(id, (cur) => pendingPdf(cur, 300, 300)); return Buffer.from("%PDF-1.4 two"); },
  });
  const afterRace = (await q222Get(id))?.pdf;
  ok(raced === null && afterRace?.status === "pending" && afterRace.savedAt === 300 && afterRace.blobPath === r1?.blobPath, "#222 generate: a save landing mid-render supersedes it — the newer pending state stands");
  ok(readdirSync222(dirOf(id)).join(",") === "100.pdf", "#222 generate: the superseded render's file is deleted");
  ok((await generateQuotePdf({ quoteId: id, savedAt: 250, origin, secret, render: fake("stale") })) === null, "#222 generate: a render for a save that is no longer current doesn't start");

  const r3 = await generateQuotePdf({ quoteId: id, savedAt: 300, origin, secret, render: fake("three") });
  ok(r3?.status === "ready" && r3.savedAt === 300 && readdirSync222(dirOf(id)).join(",") === "300.pdf", "#222 generate: the newest save lands ready and the previous file is deleted");

  await q222UpdatePdf(id, (cur) => pendingPdf(cur, 400, 400));
  const r4 = await generateQuotePdf({ quoteId: id, savedAt: 400, origin, secret, render: async () => { throw new Error("Chrome crashed"); } });
  ok(r4?.status === "failed" && r4.error === "Chrome crashed" && r4.blobPath === r3?.blobPath, "#222 generate: a failed render records why and keeps the last good file");

  await q222UpdatePdf(id, (cur) => pendingPdf(cur, 500, 500));
  const r5 = await generateQuotePdf({ quoteId: id, savedAt: 500, origin, secret: "", render: fake("x") });
  ok(r5?.status === "failed" && /AUTH_SECRET/.test(r5.error || ""), "#222 generate: no AUTH_SECRET → failed with the reason, nothing rendered");

  // A send copies the current PDF onto the sent revision.
  const sid = fixtureId222("222", "send");
  registerFixture222("quotes", sid);
  await q222Create({ id: sid, name: "#222 send", customer: "Spec fixture", owner: "spec" });
  await q222UpdatePdf(sid, (cur) => pendingPdf(cur, 1000, 1000));
  await generateQuotePdf({ quoteId: sid, savedAt: 1000, origin, secret, render: fake("sent-doc") });
  await q222SetStatus(sid, "sent", "spec", { bypassApprovalGate: "engine-owned-flow" });
  const rev = latestSentRevision((await q222Get(sid))?.revisions);
  ok(!!rev?.pdfBlobPath && rev.pdfBlobPath.endsWith(`/rev-${rev.rev}.pdf`), "#222 send: the sent revision records its own copy of the PDF");
  ok((await store.read(rev?.pdfBlobPath || ""))?.toString() === "%PDF-1.4 sent-doc", "#222 send: the copy is the exact document that was current at send");
  const later = Date.now() + 1;
  await q222UpdatePdf(sid, (cur) => pendingPdf(cur, later, later));
  await generateQuotePdf({ quoteId: sid, savedAt: later, origin, secret, render: fake("edited") });
  const edited = await q222Get(sid);
  ok(
    latestSentRevision(edited?.revisions)?.pdfBlobPath === rev?.pdfBlobPath && (await store.read(rev?.pdfBlobPath || ""))?.toString() === "%PDF-1.4 sent-doc",
    "#222 send: later edits regenerate the current PDF, never the sent copy"
  );
  ok(!!edited && portalPdfSource(edited)?.path === rev?.pdfBlobPath, "#222 portal: a sent quote serves the sent revision's copy, not later edits");

  // A send while the PDF is still rendering: the generator copies on completion.
  const pid = fixtureId222("222", "pending-send");
  registerFixture222("quotes", pid);
  await q222Create({ id: pid, name: "#222 pending send", customer: "Spec fixture", owner: "spec" });
  const savedAt = Date.now() - 5;
  await q222UpdatePdf(pid, (cur) => pendingPdf(cur, savedAt, savedAt));
  await q222SetStatus(pid, "sent", "spec", { bypassApprovalGate: "engine-owned-flow" });
  ok(!latestSentRevision((await q222Get(pid))?.revisions)?.pdfBlobPath, "#222 send: nothing to copy while the PDF is still rendering");
  await generateQuotePdf({ quoteId: pid, savedAt, origin, secret, render: fake("late") });
  const lateRev = latestSentRevision((await q222Get(pid))?.revisions);
  ok(!!lateRev?.pdfBlobPath && (await store.read(lateRev.pdfBlobPath))?.toString() === "%PDF-1.4 late", "#222 send: a render finishing after the send copies itself onto the sent revision");
  ok((await copySentRevisionPdf(pid)) === null, "#222 send: copying again is a no-op");

  // Portal access rules.
  const cust = fixtureId222("222", "cust");
  const mk = async (slug: string, source: string) => {
    const qid = fixtureId222("222", slug);
    registerFixture222("quotes", qid);
    await q222Create({ id: qid, name: slug, customer: "Spec fixture", customerId: cust, owner: "spec", source });
    await q222UpdatePdf(qid, (c) => pendingPdf(c, 1, 1));
    await generateQuotePdf({ quoteId: qid, savedAt: 1, origin, secret, render: fake(slug) });
    return qid;
  };
  const own = await mk("selfserve", "portal-self-serve");
  const internal = await mk("internal", "estimator");
  const sentQ = await mk("sentq", "estimator");
  const dl = await mk("daylite", "daylite");
  await q222SetStatus(sentQ, "sent", "spec", { bypassApprovalGate: "engine-owned-flow" });
  await q222Update(dl, { status: "sent" });
  const src = async (qid: string, c: string) => {
    const q = await q222Get(qid);
    return q ? portalQuotePdfSource(q, c) : null;
  };
  ok(!!(await src(own, cust)), "#222 portal PDF: the customer's own self-serve draft opens");
  ok((await src(internal, cust)) === null, "#222 portal PDF: an unsent internal draft is 404");
  ok(!!(await src(sentQ, cust)) && (await src(sentQ, "someone-else")) === null, "#222 portal PDF: a sent quote opens for its own customer only");
  ok((await src(dl, cust)) === null, "#222 portal PDF: Daylite history never opens on the portal");

  // Smoke: a real Chrome prints a real PDF (skipped, with the reason, when there's no Chrome).
  const launch = await chromeLaunch();
  if ("unavailable" in launch) {
    console.log(`SKIP #222 smoke render: ${launch.unavailable}`);
  } else {
    const pdf = await renderPrintRouteToPdf("data:text/html,<h1>Quartzite quote</h1>");
    ok(pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 500, "#222 smoke: headless Chrome prints a page to a real PDF");
  }
}
```

and add `  .then(() => quotePdfEngine222AsyncChecks())` to the chain above the anchor comment.

- [ ] **Step 3: Run to verify it fails.** `npx tsc --noEmit 2>&1 | head` → missing modules `@/lib/quote-pdf/generate` etc. and `updateQuotePdf` not exported.

- [ ] **Step 4: Extend the quotes store.** In `src/lib/stores/quotes.ts`:
  - Replace the Task 2 import line `import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";` with:

```ts
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import type { QuotePdfState } from "@/lib/quote-pdf/state";
```

  - In `Quote`, after the `pdfOptions?: QuotePdfOptions | null;` line add:

```ts
  /** The saved customer PDF (#222) — server-written by lib/quote-pdf only.
   *  `blobPath` never leaves the server; browsers get a QuotePdfView. */
  pdf?: QuotePdfState | null;
```

  - In `QuoteRevision`, replace `  vendorQuotes?: unknown;\n};\n\nexport type ReviewOpts` with:

```ts
  vendorQuotes?: unknown;
  /** #222 — the exact PDF that went to the customer with a "sent" revision.
   *  An annex stamped once after the snapshot is cut; the priced fields above
   *  are still never rewritten. */
  pdfBlobPath?: string;
};

export type ReviewOpts
```

  - After the `addQuoteRevision` function, add:

```ts
/**
 * Read-modify-write the quote's `pdf` state (#222). `mutate` returns the next
 * state, or `undefined` to leave it (a superseded render). Deliberately does
 * NOT bump `updatedAt`: the PDF is a by-product of a save, and `updatedAt` is
 * the document's printed revision date and the portal's sort key.
 */
export async function updateQuotePdf(
  id: string,
  mutate: (cur: QuotePdfState | null) => QuotePdfState | undefined
): Promise<{ before: QuotePdfState | null; after: QuotePdfState | null; changed: boolean } | null> {
  let out: { before: QuotePdfState | null; after: QuotePdfState | null; changed: boolean } | null = null;
  const res = await patchDoc<Quote>("quotes", id, (doc) => {
    const before = doc.pdf ?? null;
    const next = mutate(before);
    if (next !== undefined) doc.pdf = next;
    out = { before, after: next === undefined ? before : next, changed: next !== undefined };
  });
  return res ? out : null;
}

/** Stamp a revision's PDF copy once (#222). False when the revision is gone or already has one. */
export async function setRevisionPdfPath(id: string, rev: number, path: string): Promise<boolean> {
  let hit = false;
  await patchDoc<Quote>("quotes", id, (doc) => {
    const r = (doc.revisions || []).find((x) => x.rev === rev);
    if (r && !r.pdfBlobPath) {
      r.pdfBlobPath = path;
      hit = true;
    }
  });
  return hit;
}

/** After a send commits: copy the current PDF onto the new sent revision (#222).
 *  Never fails the send — a missing copy is logged, and the generator retries
 *  it when a still-rendering PDF lands. */
async function copySentPdfSafely(id: string): Promise<void> {
  try {
    const { copySentRevisionPdf } = await import("../quote-pdf/generate");
    await copySentRevisionPdf(id);
  } catch (e) {
    console.error("[quotes] copying the sent revision's PDF failed", id, e);
  }
}
```

  - In `setStatus`, replace

```ts
  return withTransaction(async () => {
  if (!STAGES.includes(status)) return null;
```

with

```ts
  const sentCut = { value: false };
  const out = await withTransaction(async () => {
  if (!STAGES.includes(status)) return null;
```

replace

```ts
    if (status === "sent") {
      pushRevision(doc, by || DEFAULT_ACTOR, "sent", "Sent to customer");
    }
```

with

```ts
    if (status === "sent") {
      pushRevision(doc, by || DEFAULT_ACTOR, "sent", "Sent to customer");
      sentCut.value = true;
    }
```

and replace

```ts
    await spawnFromQuote(result, q.status);
  }
  return result;
  });
}
```

with

```ts
    await spawnFromQuote(result, q.status);
  }
  return result;
  });
  // #222: Blob I/O stays out of the status transaction. A same-status no-op
  // cuts no revision, so it copies nothing.
  if (out && sentCut.value) await copySentPdfSafely(id);
  return out;
}
```

- [ ] **Step 5: Create `src/lib/quote-pdf/storage.ts`.**

```ts
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { blobEnabled, deleteBlob, getBlobStream, putBlob } from "@/lib/blob";

/**
 * Where saved quote PDFs live (#222). Vercel Blob (private) when
 * BLOB_READ_WRITE_TOKEN is set; otherwise, off Vercel, local files under
 * QUOTE_PDF_DIR (default <cwd>/.data/files) so dev works without a token. On
 * Vercel without a token there is nowhere durable to keep a file — callers get
 * `unavailable` and record it as the PDF's failure reason. Every path is
 * checked against isQuotePdfPath before any I/O. Server-only.
 */

const PATH_RE = /^quote-pdfs\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.pdf$/;

export function isQuotePdfPath(p: unknown): p is string {
  return typeof p === "string" && PATH_RE.test(p) && !p.split("/").some((s) => s === "." || s === "..");
}

export type PdfStorage = {
  backend: "blob" | "fs";
  /** Returns the stored path (Blob adds a random suffix). */
  put(path: string, bytes: Buffer): Promise<string>;
  read(path: string): Promise<Buffer | null>;
  stream(path: string): Promise<ReadableStream | null>;
  remove(path: string): Promise<void>;
};

function guard(p: string): string {
  if (!isQuotePdfPath(p)) throw new Error("Refusing a storage path that isn't a quote PDF.");
  return p;
}

async function collect(s: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = s.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const blobStore: PdfStorage = {
  backend: "blob",
  async put(path, bytes) {
    return (await putBlob(guard(path), bytes, "application/pdf")).pathname;
  },
  async read(path) {
    try {
      const s = await getBlobStream(guard(path));
      return s ? await collect(s as ReadableStream<Uint8Array>) : null;
    } catch {
      return null;
    }
  },
  async stream(path) {
    return getBlobStream(guard(path));
  },
  async remove(path) {
    await deleteBlob(guard(path));
  },
};

function fsRoot(): string {
  return resolve(process.env.QUOTE_PDF_DIR || join(process.cwd(), ".data", "files"));
}

function fsPath(p: string): string {
  const root = fsRoot();
  const full = resolve(root, guard(p));
  if (!full.startsWith(root + sep)) throw new Error("Refusing a path outside the PDF store.");
  return full;
}

const fsStore: PdfStorage = {
  backend: "fs",
  async put(path, bytes) {
    const full = fsPath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return path;
  },
  async read(path) {
    const full = fsPath(path);
    return existsSync(full) ? readFile(full) : null;
  },
  async stream(path) {
    const full = fsPath(path);
    return existsSync(full) ? (Readable.toWeb(createReadStream(full)) as unknown as ReadableStream) : null;
  },
  async remove(path) {
    await rm(fsPath(path), { force: true });
  },
};

export function pdfStorage(): PdfStorage | { unavailable: string } {
  if (blobEnabled()) return blobStore;
  if (process.env.VERCEL) {
    return { unavailable: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — the PDF can't be kept on this deployment." };
  }
  return fsStore;
}
```

- [ ] **Step 6: Create `src/lib/quote-pdf/render.ts`.**

```ts
import { existsSync } from "node:fs";

/**
 * URL → PDF bytes with headless Chrome (#222). On Vercel: @sparticuz/chromium's
 * bundled headless shell (its brotli'd binary is traced in via next.config's
 * outputFileTracingIncludes). Elsewhere: the installed Google Chrome
 * (CHROME_PATH, default the macOS app). No Chrome → PdfRenderUnavailable with a
 * reason the PDF state shows; the save that scheduled it has already succeeded.
 * Renders are serialized per server instance so two quick saves never run two
 * Chromiums side by side. Server-only; both packages load lazily.
 */

export const MAC_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export type ChromeLaunch = { executablePath: string; args: string[]; headless: true | "shell" };

export class PdfRenderUnavailable extends Error {}

export async function chromeLaunch(): Promise<ChromeLaunch | { unavailable: string }> {
  if (process.env.QUOTE_PDF_DISABLED === "1") {
    return { unavailable: "PDF rendering is switched off on this server (QUOTE_PDF_DISABLED=1)." };
  }
  if (process.env.VERCEL) {
    try {
      const chromium = (await import("@sparticuz/chromium")).default;
      return { executablePath: await chromium.executablePath(), args: chromium.args, headless: "shell" };
    } catch (e) {
      return { unavailable: "Chromium isn't available on this deployment (" + (e instanceof Error ? e.message : String(e)) + ")." };
    }
  }
  const path = process.env.CHROME_PATH || MAC_CHROME_PATH;
  if (!existsSync(path)) return { unavailable: `No Chrome found at ${path} — install Google Chrome or set CHROME_PATH.` };
  return {
    executablePath: path,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars"],
    headless: true,
  };
}

let queue: Promise<unknown> = Promise.resolve();

export function renderPrintRouteToPdf(url: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  // `next dev` compiles /print on first hit, which can take far longer than a
  // warm production render.
  const timeout = opts.timeoutMs ?? (process.env.NODE_ENV === "development" ? 90_000 : 30_000);
  const run = () => renderOnce(url, timeout);
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

async function renderOnce(url: string, timeout: number): Promise<Buffer> {
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new PdfRenderUnavailable(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    headless: launch.headless,
    defaultViewport: { width: 1100, height: 1400 },
  });
  try {
    const page = await browser.newPage();
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) await page.setExtraHTTPHeaders({ "x-vercel-protection-bypass": bypass });
    const res = await page.goto(url, { waitUntil: "load", timeout });
    if (res ? !res.ok() : !url.startsWith("data:")) {
      throw new Error(`The print page answered ${res ? res.status() : "nothing"}.`);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const pdf = await page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true, timeout });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
```

- [ ] **Step 7: Create `src/lib/quote-pdf/generate.ts`.**

```ts
import { get as getQuote, setRevisionPdfPath, updateQuotePdf } from "@/lib/stores/quotes";
import { renderPrintRouteToPdf } from "./render";
import {
  latestSentRevision,
  pdfKindForQuoteType,
  pdfStoragePath,
  printPathFor,
  revisionAwaitingPdf,
  settlePdf,
  type PdfOutcome,
  type QuotePdfState,
} from "./state";
import { pdfStorage } from "./storage";
import { signPrintToken } from "./token";

/**
 * Render → store → settle (#222). Runs inside `after()` (schedule.ts), so it
 * must never throw: every failure lands on the quote as `pdf.status = failed`
 * with a reason. Supersede rule: only the render whose `savedAt` still matches
 * the quote's `pdf.savedAt` may write; a loser deletes its own file. `render`
 * and `secret` are injectable for the spec harness.
 */

export type GenerateInput = {
  quoteId: string;
  savedAt: number;
  origin: string;
  secret?: string;
  render?: (url: string) => Promise<Buffer>;
};

function reason(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300) || "The PDF couldn’t be rendered.";
}

export async function generateQuotePdf(input: GenerateInput): Promise<QuotePdfState | null> {
  const { quoteId, savedAt } = input;
  const settle = async (outcome: PdfOutcome): Promise<QuotePdfState | null> => {
    const res = await updateQuotePdf(quoteId, (cur) => settlePdf(cur, savedAt, outcome, Date.now()));
    return res && res.changed ? res.after : null;
  };
  try {
    const q = await getQuote(quoteId);
    const kind = q ? pdfKindForQuoteType(q.quoteType) : null;
    if (!q || !kind) return null;
    if (q.pdf?.savedAt !== savedAt) return null; // a newer save already owns the state
    const secret = input.secret ?? process.env.AUTH_SECRET ?? "";
    if (!secret) return await settle({ ok: false, error: "AUTH_SECRET is not set — the print page can’t be signed." });
    const store = pdfStorage();
    if ("unavailable" in store) return await settle({ ok: false, error: store.unavailable });
    const token = signPrintToken(secret, kind, quoteId, Date.now());
    const url = `${input.origin}${printPathFor(kind, quoteId)}?t=${encodeURIComponent(token)}`;
    let bytes: Buffer;
    try {
      bytes = await (input.render ?? renderPrintRouteToPdf)(url);
    } catch (e) {
      return await settle({ ok: false, error: reason(e) });
    }
    const path = await store.put(pdfStoragePath(quoteId, String(savedAt)), bytes);
    const res = await updateQuotePdf(quoteId, (cur) => settlePdf(cur, savedAt, { ok: true, blobPath: path }, Date.now()));
    if (!res || !res.changed) {
      await store.remove(path).catch(() => undefined);
      return null;
    }
    const prev = res.before?.blobPath;
    if (prev && prev !== path) await store.remove(prev).catch(() => undefined);
    try {
      await copySentRevisionPdf(quoteId);
    } catch (e) {
      console.error("[quote-pdf] sent-revision copy failed", quoteId, e);
    }
    return res.after;
  } catch (e) {
    console.error("[quote-pdf] generate failed", quoteId, e);
    try {
      return await settle({ ok: false, error: reason(e) });
    } catch {
      return null;
    }
  }
}

/**
 * Copy the current READY file onto the latest sent revision when that revision
 * is still owed one (revisionAwaitingPdf). Called from setStatus after a send
 * commits, and by the generator when a render finishes after the send.
 */
export async function copySentRevisionPdf(quoteId: string): Promise<string | null> {
  const q = await getQuote(quoteId);
  const pdf = q?.pdf;
  if (!q || !pdf || pdf.status !== "ready" || !pdf.blobPath) return null;
  const rev = latestSentRevision(q.revisions);
  if (!rev || !revisionAwaitingPdf(rev, pdf.savedAt)) return null;
  const store = pdfStorage();
  if ("unavailable" in store) return null;
  const bytes = await store.read(pdf.blobPath);
  if (!bytes) return null;
  const path = await store.put(pdfStoragePath(quoteId, `rev-${rev.rev}`), bytes);
  if (!(await setRevisionPdfPath(quoteId, rev.rev, path))) {
    await store.remove(path).catch(() => undefined);
    return null;
  }
  return path;
}
```

- [ ] **Step 8: Create `src/lib/quote-pdf/portal-access.ts`.**

```ts
import { portalListsQuote, type Quote } from "@/lib/stores/quotes";
import { portalPdfSource } from "./state";

/**
 * The customer portal's PDF rule (#222), one place for the route and the list:
 * the quote must be one the portal lists for this customer (published, or the
 * customer's own self-serve draft; never Daylite history), and it must have a
 * file a customer may see (the latest sent revision's copy, else a ready PDF).
 */
export function portalQuotePdfSource(q: Quote, customerId: string): { path: string; rev: number | null } | null {
  if (!portalListsQuote(q, customerId)) return null;
  return portalPdfSource(q);
}
```

- [ ] **Step 9: Keep the engine external and trace the Chromium binary.** In `next.config.ts` replace

```ts
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
```

with

```ts
  // #222: headless Chrome for saved quote PDFs — never bundled.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "puppeteer-core", "@sparticuz/chromium"],
```

and replace

```ts
  outputFileTracingIncludes: { "/catalog/documents": ["./data/davinci-extract.json"] },
```

with

```ts
  // #222: @sparticuz/chromium reads its brotli'd binary from bin/ at run time,
  // which file tracing can't see — ship it with every page whose server
  // actions render a quote PDF (saves + Retry), and nowhere else (~60 MB).
  outputFileTracingIncludes: {
    "/catalog/documents": ["./data/davinci-extract.json"],
    "/estimator": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/flame-tests/quote": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/repairs/quote": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/inspections/quote": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/portal/estimate": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
```

- [ ] **Step 10: Document the env.** Append to `.env.example`:

```
# Saved quote PDFs (#222). Local dev prints with the installed Google Chrome;
# set CHROME_PATH if it isn't at the macOS default. Vercel uses the bundled
# @sparticuz/chromium. Without BLOB_READ_WRITE_TOKEN, dev keeps the files under
# QUOTE_PDF_DIR (default .data/files). QUOTE_PDF_ORIGIN pins the address the
# headless browser prints from. QUOTE_PDF_DISABLED=1 turns rendering off (saves
# still succeed; the PDF reads "failed" with the reason).
# CHROME_PATH=
# QUOTE_PDF_DIR=
# QUOTE_PDF_ORIGIN=
# QUOTE_PDF_DISABLED=
# Preview deployments behind Vercel Deployment Protection: the automation bypass
# secret lets the headless browser reach the print page.
# VERCEL_AUTOMATION_BYPASS_SECRET=
```

- [ ] **Step 11: Run the gates.**
  - `npx tsc --noEmit` → 0.
  - `npm run test:specs > "$TMPDIR/specs-t3.log" 2>&1; grep -c '^PASS' "$TMPDIR/specs-t3.log"; grep '^FAIL\|^SKIP #222' "$TMPDIR/specs-t3.log"` → no FAIL; PASS = Task 2 total + 26, plus 1 when Chrome is installed (otherwise one `SKIP #222 smoke render: …` line). Existing setStatus/revision/#170 checks still pass.
  - `npx eslint src/lib/quote-pdf src/lib/stores/quotes.ts next.config.ts scripts/test-review-and-spec.ts` → 0 errors.
  - `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` → succeeds.

- [ ] **Step 12: Commit.**

```bash
git add package.json package-lock.json next.config.ts .env.example src/lib/stores/quotes.ts src/lib/quote-pdf/storage.ts src/lib/quote-pdf/render.ts src/lib/quote-pdf/generate.ts src/lib/quote-pdf/portal-access.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): headless-Chrome PDF engine, storage and sent-revision copy (#222)

puppeteer-core 25.12.0 + @sparticuz/chromium <major verified in step 1>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Every save schedules the PDF; team + portal download routes

**Files:**
- Create: `src/lib/quote-pdf/schedule.ts`, `src/lib/quote-pdf/http.ts`, `src/lib/portal-viewer.ts`, `src/app/api/quotes/[id]/pdf/route.ts`, `src/app/portal/quotes/[id]/pdf/route.ts`, `src/app/(app)/quotes/pdf-actions.ts`
- Modify: `src/app/(app)/estimator/actions.ts`, `src/app/(app)/{flame-tests,repairs,inspections}/quote/{actions.ts,page.tsx}`, `src/app/portal/actions.ts`, `src/app/portal/estimate/page.tsx`, `next.config.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Task 3 `generateQuotePdf`, `updateQuotePdf`, `pdfStorage`, `isQuotePdfPath`, `portalQuotePdfSource`; Task 1 `originFrom`, `pendingPdf`, `failedPdf`, `pdfView`, `teamPdfPath`, `pdfFileName`.
- Produces:
  - `scheduleQuotePdf(quoteId: string, opts?: { savedAt?: number }): Promise<QuotePdfView | null>` — never throws; must be called inside a request (server action).
  - `pdfResponse(path: string | null, fileName: string, download: boolean): Promise<Response>`.
  - `resolvePortalViewer(previewCid: string): Promise<{ session: PortalSession | null; preview: boolean }>`.
  - `quotePdfStatusAction(id: string): Promise<QuotePdfView | null>`, `retryQuotePdfAction(id: string): Promise<QuotePdfView | null>`.
  - `SaveResult.pdf?: QuotePdfView | null`.
  - `GET /api/quotes/<id>/pdf[?rev=n][&download=1]`, `GET /portal/quotes/<id>/pdf[?preview=<cid>]`.

- [ ] **Step 1: Write the failing tests.** Append:

```ts
/* ============ #222 Task 4 — saves schedule the PDF; download routes ============ */
{
  const s222 = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const est = s222("src/app/(app)/estimator/actions.ts");
  const upd = est.slice(est.indexOf("if (loadedId) {"), est.indexOf("} else {"));
  ok(upd.includes("scheduleQuotePdf(loadedId)") && upd.indexOf("scheduleQuotePdf(loadedId)") < upd.indexOf("setStatus(loadedId"), "#222 saveQuoteAction (update): the PDF goes pending before any status change in the same save");
  const crt = est.slice(est.indexOf("created = await create("), est.indexOf("retireReplacedDraftSafely(payload.replaces"));
  ok(crt.includes("scheduleQuotePdf(created.id)") && crt.indexOf("scheduleQuotePdf(created.id)") < crt.indexOf("setStatus(created.id"), "#222 saveQuoteAction (create): the PDF goes pending before any status change");
  for (const k of ["flame-tests", "repairs", "inspections"]) {
    ok(/  if \(q\) await scheduleQuotePdf\(q\.id\);\n  return \(q && q\.id\) \|\| editingId \|\| null;/.test(s222(`src/app/(app)/${k}/quote/actions.ts`)), `#222 ${k}: every save schedules the proposal-letter PDF`);
    ok(/export const maxDuration = 60;/.test(s222(`src/app/(app)/${k}/quote/page.tsx`)), `#222 ${k}: the quote page gives its after() render 60 s`);
  }
  ok(/scheduleQuotePdf\(created\.id\)/.test(s222("src/app/portal/actions.ts")) && /export const maxDuration = 60;/.test(s222("src/app/portal/estimate/page.tsx")), "#222 a portal self-serve estimate gets its PDF too");
  const cfg = s222("next.config.ts");
  ok(/source: "\/api\/quotes\/:id\/pdf"[\s\S]{0,200}SAMEORIGIN/.test(cfg) && cfg.indexOf("SAMEORIGIN") > cfg.indexOf('value: "DENY"'), "#222 next.config: only the team PDF route may be framed, by the app itself — after the global DENY");
  const team = s222("src/app/api/quotes/[id]/pdf/route.ts");
  ok(team.indexOf("requireUser()") > -1 && team.indexOf("requireUser()") < team.indexOf("getQuote("), "#222 team PDF route: signed-in team only, checked first");
  const portal = s222("src/app/portal/quotes/[id]/pdf/route.ts");
  ok(portal.includes("resolvePortalViewer(") && portal.includes("portalQuotePdfSource(") && !/searchParams\.get\("(path|blobPath)"\)/.test(portal + team), "#222 PDF routes: files by quote id under the portal rule — never a client-supplied path");
  const http = s222("src/lib/quote-pdf/http.ts");
  ok(/application\/pdf/.test(http) && /nosniff/.test(http) && /private, no-store/.test(http) && /isQuotePdfPath\(/.test(http), "#222 pdfResponse: PDF type, nosniff, private no-store, path-guarded");
}
```

- [ ] **Step 2: Run to verify it fails.** `npm run test:specs > "$TMPDIR/specs-t4a.log" 2>&1; grep '^FAIL #222' "$TMPDIR/specs-t4a.log" | head` → the suite aborts with `ENOENT … src/app/api/quotes/[id]/pdf/route.ts` (the red state: the checks read files that don't exist yet); tsc still passes.

- [ ] **Step 3: Create `src/lib/quote-pdf/schedule.ts`.**

```ts
import { after } from "next/server";
import { headers } from "next/headers";
import { get as getQuote, updateQuotePdf } from "@/lib/stores/quotes";
import { generateQuotePdf } from "./generate";
import { originFrom } from "./origin";
import { failedPdf, pdfKindForQuoteType, pdfView, pendingPdf, type QuotePdfView } from "./state";

/**
 * Mark a just-saved quote's PDF pending and render it after the response
 * (#222). Call from a server action AFTER the quote write and BEFORE any
 * status change in the same save (a send then waits for this render; the
 * generator copies it onto the sent revision). Never throws: a save must not
 * fail because its PDF can't be scheduled. The render's time budget is the
 * calling page's `maxDuration` (after.md).
 */
export async function scheduleQuotePdf(quoteId: string, opts: { savedAt?: number } = {}): Promise<QuotePdfView | null> {
  try {
    const q = await getQuote(quoteId);
    if (!q || !pdfKindForQuoteType(q.quoteType)) return null;
    const savedAt = opts.savedAt ?? Date.now();
    const h = await headers();
    const origin = originFrom(h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"), process.env.QUOTE_PDF_ORIGIN);
    if (!origin) {
      const res = await updateQuotePdf(quoteId, (cur) => failedPdf(cur, savedAt, "Couldn’t work out this server’s address to print from (set QUOTE_PDF_ORIGIN).", Date.now()));
      return pdfView(res?.after, Date.now());
    }
    const res = await updateQuotePdf(quoteId, (cur) => pendingPdf(cur, savedAt, Date.now()));
    after(async () => {
      await generateQuotePdf({ quoteId, savedAt, origin });
    });
    return pdfView(res?.after, Date.now());
  } catch (e) {
    console.error("[quote-pdf] scheduling failed", quoteId, e);
    return null;
  }
}
```

- [ ] **Step 4: Create `src/lib/quote-pdf/http.ts`.**

```ts
import { isQuotePdfPath, pdfStorage } from "./storage";

/** Stream a stored quote PDF (#222). Streaming (never buffering) keeps a large
 *  file clear of the platform's non-streamed response ceiling. */
export async function pdfResponse(path: string | null, fileName: string, download: boolean): Promise<Response> {
  if (!path || !isQuotePdfPath(path)) return new Response("Not found", { status: 404 });
  const store = pdfStorage();
  if ("unavailable" in store) return new Response("Not found", { status: 404 });
  let stream: ReadableStream | null;
  try {
    stream = await store.stream(path);
  } catch {
    return new Response("Couldn't read the PDF — try again", { status: 502 });
  }
  if (!stream) return new Response("Not found", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
```

- [ ] **Step 5: Create `src/lib/portal-viewer.ts`** (the preview rule moves here verbatim from `src/app/portal/page.tsx`; Task 6 points the page at it).

```ts
import { portalSession, type PortalSession } from "@/lib/portal";
import { getOptionalUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";

/**
 * Who is looking at the portal (IDEAS #47, #222): a signed-in team member
 * previewing `?preview=<customerId>` sees that customer's portal (taking
 * precedence over any stale portal cookie); everyone else is their own portal
 * session or nobody. A real customer has no team session, so ?preview never
 * grants them anyone's portal. One rule for the page and the PDF route.
 */
export async function resolvePortalViewer(previewCid: string): Promise<{ session: PortalSession | null; preview: boolean }> {
  if (previewCid) {
    const teamUser = await getOptionalUser();
    if (teamUser) {
      const pc = await getCustomer(previewCid);
      if (pc) {
        const primary = (pc.contacts || []).find((c) => c.primary) || (pc.contacts || [])[0];
        return {
          session: { grantId: "preview", customerId: previewCid, name: primary?.name || teamUser.name, email: primary?.email || "" },
          preview: true,
        };
      }
    }
  }
  return { session: await portalSession(), preview: false };
}
```

- [ ] **Step 6: Create the team route `src/app/api/quotes/[id]/pdf/route.ts`.**

```ts
import { pdfResponse } from "@/lib/quote-pdf/http";
import { pdfFileName, teamPdfPath } from "@/lib/quote-pdf/state";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";

/**
 * A quote's saved PDF for the team (#222): the current file, or `?rev=<n>` for
 * the exact document a sent revision carried. `?download=1` downloads instead
 * of opening inline. next.config.ts lets the app frame this route (SAMEORIGIN)
 * for the Estimator's embedded preview.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const q = await getQuote(id);
  if (!q) return new Response("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const revRaw = sp.get("rev");
  if (revRaw !== null && !/^\d{1,4}$/.test(revRaw)) return new Response("Not found", { status: 404 });
  const rev = revRaw === null ? null : Number(revRaw);
  return pdfResponse(teamPdfPath(q, rev), pdfFileName(q.id, rev), sp.get("download") === "1");
}
```

- [ ] **Step 7: Create the portal route `src/app/portal/quotes/[id]/pdf/route.ts`.**

```ts
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { pdfResponse } from "@/lib/quote-pdf/http";
import { portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { pdfFileName } from "@/lib/quote-pdf/state";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";

/**
 * A quote's PDF for the customer portal (#222). The customer comes from the
 * portal session (or a team preview) only; the quote must pass the portal's
 * list rule and have a file a customer may see. Anything else is a plain 404 —
 * no hint whether the quote exists.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { session } = await resolvePortalViewer(new URL(req.url).searchParams.get("preview") || "");
  if (!session) return new Response("Not found", { status: 404 });
  const q = await getQuote(id);
  const src = q ? portalQuotePdfSource(q, session.customerId) : null;
  if (!q || !src) return new Response("Not found", { status: 404 });
  return pdfResponse(src.path, pdfFileName(q.id, src.rev), false);
}
```

- [ ] **Step 8: Create `src/app/(app)/quotes/pdf-actions.ts`.**

```ts
"use server";

import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { pdfView, type QuotePdfView } from "@/lib/quote-pdf/state";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

/** The saved PDF's state for the preview's poll (#222). */
export async function quotePdfStatusAction(id: string): Promise<QuotePdfView | null> {
  await requireUser();
  const q = typeof id === "string" && id ? await getQuote(id) : null;
  return pdfView(q?.pdf, Date.now());
}

/** Re-render the saved PDF (#222). Same `savedAt`: the document hasn't changed,
 *  so a send waiting on this render still gets its copy. */
export async function retryQuotePdfAction(id: string): Promise<QuotePdfView | null> {
  await requireUser();
  const q = typeof id === "string" && id ? await getQuote(id) : null;
  if (!q) return null;
  return scheduleQuotePdf(q.id, { savedAt: q.pdf?.savedAt ?? q.updatedAt ?? Date.now() });
}
```

- [ ] **Step 9: Schedule from the Estimator save.** In `src/app/(app)/estimator/actions.ts`:
  - Add after the `normalizePdfOptions` import:

```ts
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
```

  - In `SaveResult`, replace `  notice?: string;\n};\n\nexport type ReviewSync` with:

```ts
  notice?: string;
  /** #222 — the saved PDF's state after this save (pending when a render was scheduled). */
  pdf?: QuotePdfView | null;
};

export type ReviewSync
```

  - Replace `  let statusNotice: string | undefined;` with `  let statusNotice: string | undefined;\n  let pdfState: QuotePdfView | null = null;`.
  - Replace

```ts
    q = await update(loadedId, { ...patch, vendorQuotes: storedVendorQuotes } as QuotePatch);
```

with

```ts
    q = await update(loadedId, { ...patch, vendorQuotes: storedVendorQuotes } as QuotePatch);
    // #222: pending BEFORE any status change below, so a send in this same
    // save waits for this save's render instead of copying the previous file.
    if (q) pdfState = await scheduleQuotePdf(loadedId);
```

  - Replace

```ts
      pdfOptions: normalizePdfOptions(payload.pdfOptions),
    } as QuotePatch);
    if (payload.status !== "draft") {
```

with

```ts
      pdfOptions: normalizePdfOptions(payload.pdfOptions),
    } as QuotePatch);
    // #222: same ordering as the update branch.
    if (q) pdfState = await scheduleQuotePdf(created.id);
    if (payload.status !== "draft") {
```

  - In the final return, replace `    vendorQuotes: storedVendorQuotes,\n    ...(statusError` with `    vendorQuotes: storedVendorQuotes,\n    pdf: pdfState,\n    ...(statusError`.

- [ ] **Step 10: Schedule from the three service saves and give their pages 60 s.** In each of `src/app/(app)/flame-tests/quote/actions.ts`, `src/app/(app)/repairs/quote/actions.ts`, `src/app/(app)/inspections/quote/actions.ts`: add `import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";` after the `requireUser` import, and replace

```ts
  return (q && q.id) || editingId || null;
```

with

```ts
  // #222: every save re-prints the proposal letter to the saved PDF.
  if (q) await scheduleQuotePdf(q.id);
  return (q && q.id) || editingId || null;
```

In each of `src/app/(app)/flame-tests/quote/page.tsx`, `src/app/(app)/repairs/quote/page.tsx`, `src/app/(app)/inspections/quote/page.tsx`, add immediately after the `export const metadata = …;` line:

```ts
/** #222: Save/Approve render the proposal PDF in `after()`, inside this budget. */
export const maxDuration = 60;
```

- [ ] **Step 11: Schedule from the portal self-serve estimate.** In `src/app/portal/actions.ts` add `import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";` after the `resolveTier` import, and replace

```ts
    await updateQuote(created.id, patch as unknown as Parameters<typeof updateQuote>[1]);
```

with

```ts
    await updateQuote(created.id, patch as unknown as Parameters<typeof updateQuote>[1]);
    // #222: the customer can open their own estimate's PDF from the portal.
    await scheduleQuotePdf(created.id);
```

In `src/app/portal/estimate/page.tsx`, after `export const dynamic = "force-dynamic";` add:

```ts
/** #222: submitting renders the estimate's PDF in `after()`, inside this budget. */
export const maxDuration = 60;
```

- [ ] **Step 12: Let the app frame its own PDF.** In `next.config.ts`, inside `async headers()`, add a second object to the returned array, after the existing `source: "/:path*"` entry, so the array reads:

```ts
    return [
      {
        source: "/:path*",
        headers: [
          /* …existing entries unchanged… */
        ],
      },
      // #222: the Estimator's customer preview embeds the saved PDF. Later
      // entries win for the same key, so this relaxes DENY for this route only.
      {
        source: "/api/quotes/:id/pdf",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
```

(Keep the existing `/:path*` entry's five headers exactly as they are; only the new second object is added.)

- [ ] **Step 13: Run the gates.**
  - `npx tsc --noEmit` → 0.
  - `npm run test:specs > "$TMPDIR/specs-t4.log" 2>&1; grep -c '^PASS' "$TMPDIR/specs-t4.log"; grep '^FAIL' "$TMPDIR/specs-t4.log"` → no FAIL; PASS = Task 3 total + 13. The `#180` saveQuoteAction source checks still pass.
  - `npx eslint src/lib/quote-pdf src/lib/portal-viewer.ts src/app/api/quotes "src/app/portal" "src/app/(app)/quotes/pdf-actions.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/flame-tests/quote" "src/app/(app)/repairs/quote" "src/app/(app)/inspections/quote" next.config.ts scripts/test-review-and-spec.ts` → 0 errors.
  - `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` → succeeds.

- [ ] **Step 14: End-to-end check on a scratch server** (never `.data/pglite`). Needs `.env.local` with `AUTH_SECRET` and `AUTH_DEV_LOGIN=true`, and Google Chrome installed.

```bash
SCRATCH=$(mktemp -d); PORT=3222
lsof -i :$PORT || true   # must be free
env -u DATABASE_URL PGLITE_PATH="$SCRATCH/pglite" QUOTE_PDF_DIR="$SCRATCH/files" NEXT_TELEMETRY_DISABLED=1 \
  node node_modules/.bin/next dev -p $PORT > "$SCRATCH/dev.log" 2>&1 &
sleep 20
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/print/quote/Q-2041"            # 404 (no token)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/print/quote/Q-2041?t=1.abc"    # 404 (bad token)
J="$SCRATCH/jar"
CSRF=$(curl -s -c "$J" "http://localhost:$PORT/api/auth/csrf" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).csrfToken')
curl -s -b "$J" -c "$J" -o /dev/null -X POST -d "csrfToken=$CSRF&userId=u1" "http://localhost:$PORT/api/auth/callback/dev-login"
```

Then open `http://localhost:3222` in the Browser pane (navigate; unregister the service worker on first load if the page looks stale), sign in with dev-login, create an Estimator quote with one line, click Save, wait ~10 s, and note its id `Q-…`:

```bash
curl -s -b "$J" "http://localhost:$PORT/api/quotes/<Q-id>/pdf" -o "$SCRATCH/q.pdf" -D - | grep -i "content-type\|x-frame\|cache-control"
head -c 5 "$SCRATCH/q.pdf"; echo     # %PDF-
ls -R "$SCRATCH/files/quote-pdfs"
```

Expected: `application/pdf`, `X-Frame-Options: SAMEORIGIN`, `private, no-store`, `%PDF-`, one `<savedAt>.pdf`. Open `$SCRATCH/q.pdf` with the Read tool and confirm it shows the QUOTE document (letterhead, title block, the line). Repeat once with a flame-test quote (Save on `/flame-tests/quote`) and confirm a Field Flame Inspection letter PDF. Then stop the server: `pkill -f "next dev -p $PORT"` and confirm `ps aux | grep "next dev" | grep -v grep` is empty and `.data/pglite`'s mtime is unchanged.

- [ ] **Step 15: Commit.**

```bash
git add src/lib/quote-pdf/schedule.ts src/lib/quote-pdf/http.ts src/lib/portal-viewer.ts src/app/api/quotes src/app/portal/quotes src/app/portal/actions.ts src/app/portal/estimate/page.tsx \
  "src/app/(app)/quotes/pdf-actions.ts" "src/app/(app)/estimator/actions.ts" \
  "src/app/(app)/flame-tests/quote/actions.ts" "src/app/(app)/flame-tests/quote/page.tsx" "src/app/(app)/repairs/quote/actions.ts" "src/app/(app)/repairs/quote/page.tsx" \
  "src/app/(app)/inspections/quote/actions.ts" "src/app/(app)/inspections/quote/page.tsx" next.config.ts scripts/test-review-and-spec.ts
git commit -m "feat(quotes): every save renders the saved PDF; team and portal PDF routes (#222)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The customer preview IS the saved PDF — Estimator + service builders

**Files:**
- Create: `src/components/quote-pdf/use-quote-pdf.ts`, `src/components/quote-pdf/quote-pdf-viewer.tsx`, `src/components/quote-pdf/saved-pdf-button.tsx`, `src/app/(app)/estimator/pdf-doc-key.ts`
- Rewrite: `src/app/(app)/estimator/preview-doc.tsx`
- Modify: `src/app/(app)/estimator/{estimator-client.tsx,types.ts,page.tsx}`, `src/app/(app)/{flame-tests,repairs,inspections}/quote/{controls.tsx,page.tsx}`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Task 4 `quotePdfStatusAction`, `retryQuotePdfAction`, `SaveResult.pdf`, `GET /api/quotes/<id>/pdf`; Task 1 `QuotePdfView`, `pdfView`; Task 2 `pdfOpts`, `QuotePdfOptions`.
- Produces: `useQuotePdf(quoteId, pdf, onPdf): { timedOut; retry; retrying }`; `<QuotePdfViewer quoteId pdf onPdf dirty />`; `<SavedPdfButton quoteId initialPdf accent letterHref />`; `pdfDocKey(input): string`; `InitialQuote.pdf: QuotePdfView | null`; service `QuoteBuilder` prop `pdf?: QuotePdfView | null`.

- [ ] **Step 1: Write the failing tests.** Append:

```ts
/* ============ #222 Task 5 — the preview is the saved PDF ============ */
import { pdfDocKey } from "@/app/(app)/estimator/pdf-doc-key";
{
  const base = {
    projectName: "P", custName: "C", customerId: null, locationId: null, contactName: "", quoteNote: "", assumptions: "",
    paymentTerms: "Unknown", sections: [],
    vendorQuotes: [{ id: "vq1", vendor: "V", quoteNumber: "1", description: "d", display: "single" as const, lines: [], terms: "", notes: "", total: 1, includesFreight: false }],
    pdfOptions: DEFAULT_PDF_OPTIONS,
  };
  ok(pdfDocKey(base) === pdfDocKey({ ...base }), "#222 pdfDocKey: the same document gives the same key");
  ok(pdfDocKey(base) !== pdfDocKey({ ...base, pdfOptions: { ...DEFAULT_PDF_OPTIONS, pdfPrices: false } }), "#222 pdfDocKey: flipping a Show-on-PDF toggle marks the PDF stale");
  ok(pdfDocKey(base) !== pdfDocKey({ ...base, quoteNote: "Hello" }), "#222 pdfDocKey: a cover-note edit marks the PDF stale");
  ok(
    pdfDocKey(base) === pdfDocKey({ ...base, vendorQuotes: [{ ...base.vendorQuotes[0], attachment: { blobPath: "x" }, terms: "t", notes: "n", total: 9 }] }),
    "#222 pdfDocKey: internal vendor fields (attachment, terms, notes, cost) never mark the PDF stale"
  );
  const s5 = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const pd = s5("src/app/(app)/estimator/preview-doc.tsx");
  ok(!pd.includes("window.print") && pd.includes("<QuotePdfViewer") && pd.includes("?download=1"), "#222 PreviewDoc: shows the saved PDF and downloads the saved file — no window.print()");
  const clientFiles = ["src/app/(app)/estimator/estimator-client.tsx", "src/app/(app)/estimator/preview-doc.tsx", "src/components/quote-pdf/quote-pdf-viewer.tsx", "src/components/quote-pdf/saved-pdf-button.tsx", "src/components/quote-pdf/use-quote-pdf.ts"];
  ok(
    clientFiles.every((f) => !/^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/quote-pdf\/(token|storage|render|generate|schedule|portal-access|quote-document-data))/m.test(s5(f))),
    "#222 client files import no store, DB or server-only PDF module"
  );
  for (const k of ["flame-tests", "repairs", "inspections"]) {
    ok(/<SavedPdfButton/.test(s5(`src/app/(app)/${k}/quote/controls.tsx`)) && /pdf=\{editQuote \? pdfView\(editQuote\.pdf, Date\.now\(\)\) : null\}/.test(s5(`src/app/(app)/${k}/quote/page.tsx`)), `#222 ${k}: the letter button opens the saved PDF`);
  }
}
```

- [ ] **Step 2: Run to verify it fails.** `npx tsc --noEmit 2>&1 | head -3` → `Cannot find module '@/app/(app)/estimator/pdf-doc-key'`.

- [ ] **Step 3: Create `src/app/(app)/estimator/pdf-doc-key.ts`.**

```ts
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import type { SpecSection, VendorQuote } from "./types";

/**
 * Fingerprint of what the customer PDF shows (#222). The preview compares the
 * live key to the key of the last successful save and says "Unsaved changes —
 * save to update the PDF." while they differ. Vendor quotes contribute only
 * their customer-visible fields: attachment, terms, notes and cost never print,
 * and the server rewrites attachments on save.
 */
export type PdfDocKeyInput = {
  projectName: string;
  custName: string;
  customerId: string | null;
  locationId: string | null;
  contactName: string;
  quoteNote: string;
  assumptions: string;
  paymentTerms: string;
  sections: SpecSection[];
  vendorQuotes: VendorQuote[];
  pdfOptions: QuotePdfOptions;
};

export function pdfDocKey(i: PdfDocKeyInput): string {
  return JSON.stringify([
    i.projectName,
    i.custName,
    i.customerId || "",
    i.locationId || "",
    i.contactName,
    i.quoteNote,
    i.assumptions,
    i.paymentTerms,
    i.sections,
    i.vendorQuotes.map((v) => [v.id, v.vendor, v.quoteNumber, v.description, v.display, v.lines]),
    i.pdfOptions,
  ]);
}
```

- [ ] **Step 4: Create `src/components/quote-pdf/use-quote-pdf.ts`.**

```ts
import { useEffect, useRef, useState, useTransition } from "react";
import { quotePdfStatusAction, retryQuotePdfAction } from "@/app/(app)/quotes/pdf-actions";
import type { QuotePdfView } from "@/lib/quote-pdf/state";

/** Poll cadence and give-up point for a pending render (#222). */
export const PDF_POLL_MS = 2000;
export const PDF_POLL_LIMIT_MS = 60_000;

/**
 * Keeps a saved-PDF view fresh (#222): while it is `pending`, polls every 2 s
 * and hands each change to `onPdf`; after 60 s it stops and reports
 * `timedOut` (keyed to that pending state's `at`, so a Retry resets it
 * without a synchronous setState in an effect). `retry` re-renders the PDF.
 * Imported only by client components.
 */
export function useQuotePdf(quoteId: string | null, pdf: QuotePdfView | null, onPdf: (v: QuotePdfView) => void) {
  const onPdfRef = useRef(onPdf);
  useEffect(() => {
    onPdfRef.current = onPdf;
  }, [onPdf]);
  const [timedOutAt, setTimedOutAt] = useState<number | null>(null);
  const [retrying, startRetry] = useTransition();
  const pendingAt = quoteId && pdf?.status === "pending" ? pdf.at : null;

  useEffect(() => {
    if (!quoteId || pendingAt == null) return;
    const started = Date.now();
    let live = true;
    const timer = setInterval(async () => {
      if (Date.now() - started > PDF_POLL_LIMIT_MS) {
        clearInterval(timer);
        if (live) setTimedOutAt(pendingAt);
        return;
      }
      let next: QuotePdfView | null = null;
      try {
        next = await quotePdfStatusAction(quoteId);
      } catch {
        return;
      }
      if (!live || !next) return;
      if (next.status !== "pending" || next.at !== pendingAt) {
        clearInterval(timer);
        onPdfRef.current(next);
      }
    }, PDF_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [quoteId, pendingAt]);

  const retry = () => {
    if (!quoteId) return;
    startRetry(async () => {
      const next = await retryQuotePdfAction(quoteId).catch(() => null);
      if (next) onPdfRef.current(next);
    });
  };

  return { timedOut: pendingAt != null && timedOutAt === pendingAt, retry, retrying };
}
```

- [ ] **Step 5: Create `src/components/quote-pdf/quote-pdf-viewer.tsx`.**

```tsx
"use client";

import type { CSSProperties } from "react";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { useQuotePdf } from "./use-quote-pdf";

type Tone = "info" | "warn" | "error";
type Note = { tone: Tone; text: string; action?: string };

function bannerStyle(tone: Tone): CSSProperties {
  const palette =
    tone === "error"
      ? { background: "#fbeeee", color: "#a33b3b", border: "1px solid #f1d2d2" }
      : tone === "warn"
      ? { background: "#fbf3dd", color: "#8a6d1f", border: "1px solid #f0e2bd" }
      : { background: "#e9eefb", color: "#3155a8", border: "1px solid #d4ddf3" };
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    marginBottom: 10,
    ...palette,
  };
}

const actionBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid currentColor",
  background: "#fff",
  color: "inherit",
  borderRadius: 7,
  padding: "5px 10px",
  cursor: "pointer",
  flexShrink: 0,
};

/**
 * The saved quote PDF in an embedded viewer (#222), with its status above it:
 * "Updating PDF…" while a render runs (the previous file stays visible), the
 * failure reason with Retry, and "Unsaved changes — save to update the PDF."
 * while the editor holds changes the file doesn't.
 */
export function QuotePdfViewer({
  quoteId,
  pdf,
  onPdf,
  dirty,
}: {
  quoteId: string | null;
  pdf: QuotePdfView | null;
  onPdf: (v: QuotePdfView) => void;
  dirty: boolean;
}) {
  const { timedOut, retry, retrying } = useQuotePdf(quoteId, pdf, onPdf);
  const pending = pdf?.status === "pending";
  const notes: Note[] = [];
  if (!quoteId) notes.push({ tone: "info", text: "Save this estimate to create its PDF." });
  if (quoteId && dirty) notes.push({ tone: "warn", text: "Unsaved changes — save to update the PDF." });
  if (quoteId) {
    if (retrying || (pending && !timedOut)) notes.push({ tone: "info", text: "Updating PDF…" });
    else if (pending && timedOut) notes.push({ tone: "warn", text: "The PDF is taking longer than expected.", action: "Retry" });
    else if (pdf?.status === "failed") notes.push({ tone: "error", text: pdf.error || "The PDF couldn’t be made.", action: "Retry" });
    else if (!pdf && !dirty) notes.push({ tone: "warn", text: "No PDF yet for this quote.", action: "Create PDF" });
  }
  const src = quoteId && pdf?.hasFile ? `/api/quotes/${encodeURIComponent(quoteId)}/pdf?v=${pdf.status}-${pdf.at}` : null;
  return (
    <div style={{ flex: 1, minHeight: "70vh", display: "flex", flexDirection: "column" }}>
      {notes.map((n) => (
        <div key={n.text} role="status" style={bannerStyle(n.tone)}>
          <span>{n.text}</span>
          {n.action && (
            <button type="button" onClick={retry} disabled={retrying} style={actionBtn}>
              {retrying ? "Working…" : n.action}
            </button>
          )}
        </div>
      ))}
      {src ? (
        <iframe
          key={src}
          src={src}
          title="Quote PDF"
          style={{ flex: 1, width: "100%", minHeight: "60vh", border: "none", borderRadius: 4, background: "#fff", boxShadow: "0 6px 30px rgba(0,0,0,.12)" }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: "60vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            background: "#fff",
            color: "#9aa0ab",
            fontSize: 13,
          }}
        >
          {pending ? "Rendering the PDF…" : "The PDF appears here once the quote is saved."}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `src/app/(app)/estimator/preview-doc.tsx`** (full replacement; the document itself now lives only in the print route).

```tsx
"use client";

import type { CSSProperties } from "react";
import { QuotePdfViewer } from "@/components/quote-pdf/quote-pdf-viewer";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { systemFreight, systemItemsRev } from "./pricing";
import type { PaymentTerms, SpecSection } from "./types";

/**
 * Customer preview (#222) — the SAVED quote PDF beside the Show-on-PDF
 * controls. The PDF is printed by headless Chrome from the signed print route
 * (/print/quote/[id], the shared QuoteDocument) on every Save, so what the team
 * sees here is byte-for-byte what the customer gets. Changing a control marks
 * the quote dirty; the next Save re-renders.
 */

const segOn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 13px",
  borderRadius: 5,
  background: "#fff",
  color: "#16181d",
  border: "none",
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(0,0,0,.1)",
};
const segOff: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 500,
  padding: "5px 13px",
  borderRadius: 5,
  background: "transparent",
  color: "#9aa0ab",
  border: "none",
  cursor: "pointer",
};
const sideLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".04em",
};
const actionLink: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  textAlign: "center",
  borderRadius: 8,
  padding: "9px 16px",
  textDecoration: "none",
  border: "none",
};

export type PdfToggle = "pdfQty" | "pdfNotes" | "pdfPrices" | "pdfCover" | "pdfTerms" | "pdfOptions";

export type PreviewProps = {
  phone: boolean;
  canBuild: boolean;
  onBack: () => void;
  /** The saved quote id — null until the first Save creates it. */
  savedQuoteId: string | null;
  pdf: QuotePdfView | null;
  onPdf: (v: QuotePdfView) => void;
  /** The editor holds changes the saved PDF doesn't have yet. */
  dirty: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  sections: SpecSection[];
  setSectionPresentation: (id: string, value: "itemized" | "narrative") => void;
  detail: "itemized" | "sectioned";
  setDetail: (d: "itemized" | "sectioned") => void;
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
  paymentTerms: PaymentTerms;
  paymentTermsOptions: readonly PaymentTerms[];
  setPaymentTerms: (terms: PaymentTerms) => void;
  togglePdf: (flag: PdfToggle) => void;
};

export default function PreviewDoc(p: PreviewProps) {
  const isItemized = p.detail === "itemized";
  const sectionToggles = p.sections
    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0)
    .map((sec) => ({ id: sec.id, name: sec.name, presentation: sec.presentation || "itemized" }));
  const pdfHref = p.savedQuoteId ? `/api/quotes/${encodeURIComponent(p.savedQuoteId)}/pdf` : null;
  const hasFile = !!p.pdf?.hasFile;

  return (
    <div
      data-screen-label="Customer quote document"
      className="est-screen"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      {p.phone && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "11px 16px",
            background: "#fbf3dd",
            borderBottom: "1px solid #f0e2bd",
            color: "#8a6d1f",
            fontSize: 12.5,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          View only on phone — open on iPad or desktop to edit.
        </div>
      )}
      <div className="est-previewbody" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          className="est-prevhead"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            justifyContent: "flex-start",
            gap: 18,
            width: 264,
            padding: "20px 18px",
            background: "#fff",
            borderRight: "1px solid #ececf0",
            flexShrink: 0,
            overflowY: "auto",
          }}
        >
          {p.canBuild && (
            <button
              type="button"
              onClick={p.onBack}
              style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, color: "#16181d", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
            >
              ← Back to estimate
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 9 }}>
            <span style={sideLabel}>Show on PDF</span>
            <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 7, padding: 2 }}>
              <button type="button" onClick={() => p.setDetail("itemized")} style={isItemized ? segOn : segOff}>
                Itemized
              </button>
              <button type="button" onClick={() => p.setDetail("sectioned")} style={!isItemized ? segOn : segOff}>
                By section
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2, padding: 4, borderRadius: 7, background: "#e6e8ec" }}>
              <span style={{ padding: "5px 7px", fontSize: 10, fontWeight: 700, color: "#777d88", textTransform: "uppercase", letterSpacing: ".04em" }}>Line detail</span>
              <button type="button" onClick={() => p.togglePdf("pdfQty")} style={p.pdfQty ? segOn : segOff}>{(p.pdfQty ? "✓ " : "") + "Quantities"}</button>
              <button type="button" onClick={() => p.togglePdf("pdfNotes")} style={p.pdfNotes ? segOn : segOff}>{(p.pdfNotes ? "✓ " : "") + "Descriptions"}</button>
              <button type="button" onClick={() => p.togglePdf("pdfPrices")} style={p.pdfPrices ? segOn : segOff}>{(p.pdfPrices ? "✓ " : "") + "Prices"}</button>
            </div>
            <button type="button" onClick={() => p.togglePdf("pdfCover")} style={p.pdfCover ? segOn : segOff}>
              {(p.pdfCover ? "✓ " : "") + "Cover note"}
            </button>
            <button type="button" onClick={() => p.togglePdf("pdfOptions")} style={p.pdfOptions ? segOn : segOff}>
              {(p.pdfOptions ? "✓ " : "") + "Options"}
            </button>
            <button type="button" onClick={() => p.togglePdf("pdfTerms")} style={p.pdfTerms ? segOn : segOff}>
              {(p.pdfTerms ? "✓ " : "") + "Terms"}
            </button>
            <select
              value={p.paymentTerms}
              onChange={(event) => p.setPaymentTerms(event.target.value as PaymentTerms)}
              aria-label="Payment terms"
              style={{ border: "1px solid #dfe2e8", borderRadius: 7, background: "#fff", color: "#5b616e", padding: "6px 8px", fontSize: 11.5 }}
            >
              {p.paymentTermsOptions.map((terms) => (
                <option key={terms} value={terms}>
                  {terms}
                </option>
              ))}
            </select>
          </div>
          {sectionToggles.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <span style={sideLabel}>Systems</span>
              {sectionToggles.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#3a3f4a", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <button
                    type="button"
                    onClick={() => p.setSectionPresentation(s.id, s.presentation === "narrative" ? "itemized" : "narrative")}
                    style={segOn}
                  >
                    {s.presentation === "narrative" ? "Narrative" : "Itemized"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {(p.dirty || !p.savedQuoteId) && p.canBuild && (
            <button
              type="button"
              onClick={p.onSave}
              disabled={p.saveDisabled}
              style={{ ...actionLink, color: "#fff", background: "#2b2e35", cursor: p.saveDisabled ? "not-allowed" : "pointer", opacity: p.saveDisabled ? 0.6 : 1 }}
            >
              {p.savedQuoteId ? "Save & update PDF" : "Save to create PDF"}
            </button>
          )}
          {pdfHref && hasFile ? (
            <>
              <a href={pdfHref + "?download=1"} style={{ ...actionLink, color: "#fff", background: "var(--accent)" }}>
                Download PDF
              </a>
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ ...actionLink, color: "#16181d", background: "#f1f2f5" }}>
                Open PDF ↗
              </a>
            </>
          ) : (
            <span style={{ ...actionLink, color: "#9aa0ab", background: "#f1f2f5", cursor: "default" }}>Download PDF</span>
          )}
        </aside>
        <div
          className="est-scroll est-docwrap"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#e9ebef", padding: 18, display: "flex", flexDirection: "column" }}
        >
          <QuotePdfViewer quoteId={p.savedQuoteId} pdf={p.pdf} onPdf={p.onPdf} dirty={p.dirty} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire the Estimator client.** In `src/app/(app)/estimator/types.ts` add `import type { QuotePdfView } from "@/lib/quote-pdf/state";` next to the `QuotePdfOptions` import, and in `InitialQuote` replace `  pdfOptions: QuotePdfOptions;\n};` with:

```ts
  pdfOptions: QuotePdfOptions;
  /** The saved PDF's state (#222) — null for a new or never-rendered estimate. */
  pdf: QuotePdfView | null;
};
```

In `src/app/(app)/estimator/page.tsx` add `import { pdfView } from "@/lib/quote-pdf/state";`; in the `!q` branch replace `      pdfOptions: { ...DEFAULT_PDF_OPTIONS },\n    };` with `      pdfOptions: { ...DEFAULT_PDF_OPTIONS },\n      pdf: null,\n    };`; in the final return replace `    pdfOptions: normalizePdfOptions(q.pdfOptions),\n  };` with `    pdfOptions: normalizePdfOptions(q.pdfOptions),\n    pdf: pdfView(q.pdf, Date.now()),\n  };`.

In `src/app/(app)/estimator/estimator-client.tsx`:
  - After `import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";` add:

```ts
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { pdfDocKey } from "./pdf-doc-key";
```

  - In the component's props destructuring, replace `  companyName,\n  logoDark,\n  fabrics,` with `  fabrics,` (the document, and its company/logo, now render on the server; `EstimatorProps` keeps the fields).
  - Replace `  const [revDateMs, setRevDateMs] = useState(initial.revDateMs);` with `  const [, setRevDateMs] = useState(initial.revDateMs);`.
  - Delete the four lines starting `  const hasAttn = currentContact ? true : !!contactName;` through `    : contactName || "";`.
  - Immediately above `  const doSave = () => {` insert:

```ts
  /* #222 — the saved PDF is the customer preview. `docKey` fingerprints what
     the customer document shows; the preview reads "Unsaved changes" while it
     differs from the key captured at the last successful save. */
  const [pdf, setPdf] = useState<QuotePdfView | null>(initial.pdf);
  const docCustName = customerId ? customers.find((c) => c.id === customerId)?.name || custName : custName;
  const docKey = useMemo(
    () =>
      pdfDocKey({
        projectName,
        custName: docCustName,
        customerId,
        locationId,
        contactName,
        quoteNote,
        assumptions,
        paymentTerms,
        sections,
        vendorQuotes,
        pdfOptions: pdfOpts,
      }),
    [projectName, docCustName, customerId, locationId, contactName, quoteNote, assumptions, paymentTerms, sections, vendorQuotes, pdfOpts]
  );
  const [savedDocKey, setSavedDocKey] = useState(docKey);
  const pdfDirty = !!loadedId && docKey !== savedDocKey;

```

  - Replace `  const doSave = () => {\n    const cname = customerId` with `  const doSave = () => {\n    const keyAtSave = docKey;\n    const cname = customerId`.
  - Replace `        if (res.id) {\n          setLoadedId(res.id);` with:

```ts
        if (res.id) {
          setLoadedId(res.id);
          setSavedDocKey(keyAtSave);
          if (res.pdf) setPdf(res.pdf);
```

  - Replace the whole preview block — from the line `      {/* ===================== PREVIEW MODE (customer quote) ===================== */}` through the `      )}` that closes `{isPreview && (…)}` (the last JSX before the component's closing `    </div>`) — with:

```tsx
      {/* ===================== PREVIEW MODE (the saved customer PDF, #222) ===================== */}
      {isPreview && (
        <PreviewDoc
          phone={phone}
          canBuild={!phone}
          onBack={() => setMode("build")}
          savedQuoteId={loadedId}
          pdf={pdf}
          onPdf={setPdf}
          dirty={pdfDirty}
          onSave={doSave}
          saveDisabled={statusChanging}
          sections={sections}
          setSectionPresentation={(id, value) => setSystemPresentation(id, value)}
          detail={detail}
          setDetail={setDetail}
          pdfQty={pdfQty}
          pdfNotes={pdfNotes}
          pdfPrices={pdfPrices}
          pdfCover={pdfCover}
          pdfTerms={pdfTerms}
          pdfOptions={pdfOptions}
          paymentTerms={paymentTerms}
          paymentTermsOptions={PAYMENT_TERMS}
          setPaymentTerms={setPaymentTerms}
          togglePdf={(flag) => {
            if (flag === "pdfQty") setPdfQty((v) => !v);
            else if (flag === "pdfNotes") setPdfNotes((v) => !v);
            else if (flag === "pdfPrices") setPdfPrices((v) => !v);
            else if (flag === "pdfCover") setPdfCover((v) => !v);
            else if (flag === "pdfOptions") setPdfOptions((v) => !v);
            else setPdfTerms((v) => !v);
          }}
        />
      )}
```

  - If `npx tsc --noEmit` / eslint now report `t`, `TAX_RATE_PCT` or `currentContact` unused, leave `t` (used by the build view) and fix only what is reported as unused by removing that declaration.

- [ ] **Step 8: Create `src/components/quote-pdf/saved-pdf-button.tsx`.**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { useQuotePdf } from "./use-quote-pdf";

/**
 * Service builders' letter button (#222): opens the SAVED proposal PDF in a new
 * tab, with its render status and Retry underneath; the old web letter stays
 * one click away as "Web version".
 */
export function SavedPdfButton({
  quoteId,
  initialPdf,
  accent,
  letterHref,
}: {
  quoteId: string;
  initialPdf: QuotePdfView | null;
  accent: string;
  letterHref: string;
}) {
  const [pdf, setPdf] = useState<QuotePdfView | null>(initialPdf);
  const { timedOut, retry, retrying } = useQuotePdf(quoteId, pdf, setPdf);
  const href = `/api/quotes/${encodeURIComponent(quoteId)}/pdf`;
  const ready = !!pdf?.hasFile;
  const note = retrying
    ? "Updating PDF…"
    : !pdf
    ? "No PDF yet."
    : pdf.status === "pending"
    ? timedOut
      ? "The PDF is taking longer than expected."
      : "Updating PDF…"
    : pdf.status === "failed"
    ? pdf.error || "The PDF couldn’t be made."
    : null;
  const canRetry = !retrying && (!pdf || pdf.status === "failed" || timedOut);
  const btn = {
    marginTop: 9,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontSize: 13,
    fontWeight: 600,
    color: accent,
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 10,
    padding: 11,
    textDecoration: "none",
    boxSizing: "border-box" as const,
  };
  return (
    <div>
      {ready ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={btn}>
          Open quote PDF →
        </a>
      ) : (
        <span style={{ ...btn, opacity: 0.55, cursor: "default" }}>Open quote PDF →</span>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6, fontSize: 11.5, color: "#8c919c" }}>
        <span>{note || "Saved PDF is current."}</span>
        <span style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          {canRetry && (
            <button
              type="button"
              onClick={retry}
              style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: accent, background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              {pdf ? "Retry" : "Create PDF"}
            </button>
          )}
          <Link href={letterHref} style={{ color: "#8c919c", fontWeight: 600, textDecoration: "none" }}>
            Web version
          </Link>
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Use it in the three service builders.** In each of `src/app/(app)/flame-tests/quote/controls.tsx`, `src/app/(app)/repairs/quote/controls.tsx`, `src/app/(app)/inspections/quote/controls.tsx`:
  - Add after `import Link from "next/link";`:

```ts
import { SavedPdfButton } from "@/components/quote-pdf/saved-pdf-button";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
```

  - In `export function QuoteBuilder({ … })`'s destructuring replace `  initial,\n  accent,\n}: {` with `  initial,\n  accent,\n  pdf = null,\n}: {`. In its prop type replace (flame-tests and repairs) `  initial: BuilderInitial;\n  accent: string;\n}) {` / (inspections) `  me: string;\n  accent: string;\n}) {` with the same text plus, before `}) {`, the line `  /** #222 — the saved quote's PDF state (null for an unsaved quote). */\n  pdf?: QuotePdfView | null;`.
  - Replace the `{letterHref && ( <Link href={letterHref} …>Preview quote letter →</Link> )}` block (flame-tests lines ~1169–1192, repairs ~1474–1497, inspections ~1235–1258; locate by the text `Preview quote letter →`) with:

```tsx
              {letterHref && (
                <SavedPdfButton quoteId={savedId} initialPdf={pdf} accent={accent} letterHref={letterHref} />
              )}
```

  In each of the three `quote/page.tsx` files add `import { pdfView } from "@/lib/quote-pdf/state";` and add the prop `pdf={editQuote ? pdfView(editQuote.pdf, Date.now()) : null}` on the line after `initial={initial}` in the `<QuoteBuilder` element (`editQuote` is the page-level `const editQuote = editId ? await getQuote(editId) : null;`).

- [ ] **Step 10: Run the gates.**
  - `npx tsc --noEmit` → 0.
  - `npm run test:specs > "$TMPDIR/specs-t5.log" 2>&1; grep -c '^PASS' "$TMPDIR/specs-t5.log"; grep '^FAIL' "$TMPDIR/specs-t5.log"` → no FAIL; PASS = Task 4 total + 9.
  - `npx eslint src/components/quote-pdf "src/app/(app)/estimator" "src/app/(app)/flame-tests/quote" "src/app/(app)/repairs/quote" "src/app/(app)/inspections/quote" scripts/test-review-and-spec.ts` → 0 errors.
  - `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` → succeeds (this is the gate that catches a client file pulling a server module).

- [ ] **Step 11: Browser check on the scratch server** (Task 4 step 14 recipe; stop it afterwards). In the Estimator: open a saved quote → Customer preview → the PDF shows with no banner; flip "Prices" → "Unsaved changes — save to update the PDF." → "Save & update PDF" → "Updating PDF…" → the iframe reloads without prices within ~10 s; Download PDF saves `Q-….pdf`; a brand-new estimate's preview says "Save this estimate to create its PDF.". Open a saved quote and go straight to the preview: no "Unsaved changes" banner (if one appears, a mount-time effect is rewriting a keyed field — find it and exclude that field from `pdfDocKey` rather than masking it). On `/flame-tests/quote?id=<saved>`: "Open quote PDF →" opens the letter PDF in a new tab; "Web version" opens the old page. Temporarily start the server with `QUOTE_PDF_DISABLED=1`, Save, and confirm the save succeeds and the preview shows the reason with Retry. Stop the server.

- [ ] **Step 12: Commit.**

```bash
git add src/components/quote-pdf "src/app/(app)/estimator/pdf-doc-key.ts" "src/app/(app)/estimator/preview-doc.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/page.tsx" \
  "src/app/(app)/flame-tests/quote/controls.tsx" "src/app/(app)/flame-tests/quote/page.tsx" "src/app/(app)/repairs/quote/controls.tsx" "src/app/(app)/repairs/quote/page.tsx" \
  "src/app/(app)/inspections/quote/controls.tsx" "src/app/(app)/inspections/quote/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(quotes): the customer preview shows the saved PDF (#222)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Portal — every estimate (Open / History) opens its PDF; project history

**Files:**
- Modify: `src/app/portal/page.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `resolvePortalViewer` (Task 4), `portalQuotePdfSource` (Task 3), `groupPortalQuotes`, `groupPortalProjects`, `isAppEraProject`, `portalProjectView` (Task 1), `getAllProjects` (`src/lib/stores/projects.ts:366`), route `GET /portal/quotes/<id>/pdf`.
- Produces: the portal page's "Your quotes & estimates" (Open / History, PDF links) and "Your projects" (Active / History) cards.

- [ ] **Step 1: Write the failing tests.** Append:

```ts
/* ============ #220 Task 6 — portal quotes Open/History + projects ============ */
{
  const portal220 = readFileSync(join(process.cwd(), "src/app/portal/page.tsx"), "utf8");
  ok(portal220.includes("resolvePortalViewer(") && !portal220.includes("getOptionalUser"), "#220 portal page: the team-preview rule is the shared resolvePortalViewer");
  ok(portal220.includes("groupPortalQuotes(published)") && portal220.includes("portalQuotePdfSource(q, cid)") && portal220.includes("Document being prepared"), "#220 portal quotes: grouped Open/History, each row opens its PDF or says it's being prepared");
  ok(portal220.includes("isAppEraProject(p)") && portal220.includes("portalProjectView(p,") && portal220.includes("Your projects"), "#220 portal projects: app-era only, through the whitelist view");
  ok(!/\.(procurement|timeLogs|mobilizations|deliveries|crew|margin)\b/.test(portal220), "#220 portal page never reads internal project/quote fields");
}
```

- [ ] **Step 2: Run to verify it fails.** `npm run test:specs > "$TMPDIR/specs-t6a.log" 2>&1; grep '^FAIL #220' "$TMPDIR/specs-t6a.log"` → the four new checks FAIL.

- [ ] **Step 3: Imports.** In `src/app/portal/page.tsx` delete the lines `import { portalSession, type PortalSession } from "@/lib/portal";` and `import { getOptionalUser } from "@/lib/session";`, and add after `import { acceptPortalQuote } from "./actions";`:

```ts
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { groupPortalProjects, groupPortalQuotes, isAppEraProject, portalProjectView } from "@/lib/portal-projects";
import { getAllProjects } from "@/lib/stores/projects";
```

- [ ] **Step 4: Viewer.** Replace the block from `  // Team-gated PREVIEW: a signed-in team member can view a customer's portal as` through `  if (!session) session = await portalSession();` with:

```ts
  // Team-gated PREVIEW (?preview=<customerId>): resolvePortalViewer is the one
  // rule, shared with the portal PDF route (#222) so a preview opens PDFs too.
  const previewCid = one(sp.preview);
  const { session, preview } = await resolvePortalViewer(previewCid);
```

- [ ] **Step 5: Data.** Replace

```ts
  const [cust, quotes, leads, fRenewals, iRenewals] = await Promise.all([
    getCustomer(cid),
    allQuotes(),
    allLeads(),
    flameRenewals({}),
    inspectionRenewals({}),
  ]);
```

with

```ts
  const [cust, quotes, leads, fRenewals, iRenewals, projects] = await Promise.all([
    getCustomer(cid),
    allQuotes(),
    allLeads(),
    flameRenewals({}),
    inspectionRenewals({}),
    getAllProjects(),
  ]);
```

and replace

```ts
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const requests = leads
```

with

```ts
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const quoteGroups = groupPortalQuotes(published);

  // #220: project history, app-era only (never Daylite imports), through the
  // portalProjectView whitelist — value only when known and the quote is won.
  const quoteStatusById = new Map(quotes.map((q) => [q.id, q.status]));
  const venueNameOf = (locationId: string | null) => {
    const l = venues.find((v) => v.id === locationId);
    return l ? l.label || l.locationName || "" : "";
  };
  const projectGroups = groupPortalProjects(
    projects
      .filter((p) => p.customerId === cid && isAppEraProject(p))
      .map((p) =>
        portalProjectView(p, {
          venueName: venueNameOf(p.locationId),
          quoteStatus: p.quoteId ? quoteStatusById.get(p.quoteId) ?? null : null,
        })
      )
  );

  const requests = leads
```

- [ ] **Step 6: Row renderers + group heading.** Add, directly above `const QUOTE_CHIP` (module scope):

```ts
const GROUP_HEAD: React.CSSProperties = {
  padding: "9px 20px 5px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  background: "#fafbfc",
  borderBottom: "1px solid #f0f1f4",
};
```

Then, inside `PortalPage`, directly above

```ts
  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
```

insert:

```tsx
  const quoteRow = (q: (typeof published)[number]) => {
    const isDraft = q.status === "draft"; // only the customer's own self-serve drafts reach here
    const pendingAccept = q.status === "sent" && !!q.portalAcceptance;
    const canAccept = portalCanAcceptQuote(q, cid) && !preview;
    const chip = isDraft
      ? { label: "In review with our team", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
      : pendingAccept
      ? { label: "Accepted — awaiting confirmation", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
      : QUOTE_CHIP[q.status] || QUOTE_CHIP.sent;
    // #222: the saved PDF (latest sent revision's copy, else the ready file).
    const pdfHref = portalQuotePdfSource(q, cid)
      ? `/portal/quotes/${encodeURIComponent(q.id)}/pdf` + (preview ? `?preview=${encodeURIComponent(cid)}` : "")
      : null;
    return (
      <div
        key={q.id}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 96px auto",
          gap: 12,
          alignItems: "center",
          padding: "13px 20px",
          borderBottom: "1px solid #f5f6f8",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {pdfHref ? (
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                {q.name}
              </a>
            ) : (
              q.name
            )}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>
            {q.id + " · " + fmtDate(q.updatedAt)}
          </div>
          <div style={{ fontSize: 11.5, marginTop: 3 }}>
            {pdfHref ? (
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                Open PDF ↗
              </a>
            ) : (
              <span style={{ color: "#9aa0ab" }}>Document being prepared</span>
            )}
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{money(q.value)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
          <Chip c={chip} />
          {canAccept && (
            <form action={acceptPortalQuote}>
              <input type="hidden" name="quote" value={q.id} />
              <button
                type="submit"
                title="Accepting lets our team know to move ahead — nothing is final until they confirm."
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#fff",
                  background: "#1f7a52",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Accept quote
              </button>
            </form>
          )}
        </div>
      </div>
    );
  };

  const projectRow = (v: (typeof projectGroups.active)[number]) => {
    const when =
      v.start || v.end
        ? [v.start ? fmtDate(v.start) : "", v.end ? fmtDate(v.end) : ""].filter(Boolean).join(" – ")
        : v.target
        ? "Target " + fmtDate(v.target)
        : "";
    return (
      <div
        key={v.id}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 96px auto",
          gap: 12,
          alignItems: "center",
          padding: "13px 20px",
          borderBottom: "1px solid #f5f6f8",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>{[v.venue, v.type, when].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right" }}>
          {v.value != null ? money(v.value) : ""}
        </div>
        <Chip
          c={
            v.done
              ? { label: v.stage || "Complete", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" }
              : { label: v.stage || "In progress", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" }
          }
        />
      </div>
    );
  };

```

- [ ] **Step 7: Cards.** Replace everything from the line `      {/* quotes */}` up to (not including) the line `      {/* venues + compliance */}` with:

```tsx
      {/* quotes — #220: Open (sent, your own drafts) + History (won, lost); each opens its saved PDF (#222) */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your quotes &amp; estimates</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>estimates you&#39;ve submitted and quotes from {companyName}</div>
        </div>
        {quoteGroups.open.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>Open</div>
            {quoteGroups.open.map(quoteRow)}
          </div>
        )}
        {quoteGroups.history.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>History</div>
            {quoteGroups.history.map(quoteRow)}
          </div>
        )}
        {published.length === 0 && (
          <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            Nothing here yet — build an estimate or anything we send you will appear here.
          </div>
        )}
      </div>

      {/* projects — #220: app-era only, Active + History */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your projects</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
            {projectGroups.active.length ? projectGroups.active.length + " active" : "none active"}
          </div>
        </div>
        {projectGroups.active.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>Active</div>
            {projectGroups.active.map(projectRow)}
          </div>
        )}
        {projectGroups.history.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>History</div>
            {projectGroups.history.map(projectRow)}
          </div>
        )}
        {projectGroups.active.length + projectGroups.history.length === 0 && (
          <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            No projects yet — work we take on for you will appear here.
          </div>
        )}
      </div>

```

- [ ] **Step 8: Run the gates.**
  - `npx tsc --noEmit` → 0.
  - `npm run test:specs > "$TMPDIR/specs-t6.log" 2>&1; grep -c '^PASS' "$TMPDIR/specs-t6.log"; grep '^FAIL' "$TMPDIR/specs-t6.log"; grep -c '^PASS #22[02]' "$TMPDIR/specs-t6.log"` → no FAIL; PASS = Task 5 total + 4; `#222/#220` PASS = 109 (+1 with Chrome).
  - `npx eslint src/app/portal/page.tsx scripts/test-review-and-spec.ts` → 0 errors.
  - `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` → succeeds.

- [ ] **Step 9: Browser check on the scratch server.** As a team user, open a customer record's "Preview portal" (`/portal?preview=<customerId>`) for a customer with one sent Estimator quote and one won quote whose project exists: the quotes card shows Open (the sent one, "Open PDF ↗" opens the PDF in a new tab) and History (the won one); an internal draft is absent; a sent quote with no file yet reads "Document being prepared". The projects card lists the project under Active with name, venue, type, stage and dates, and shows its value only because its quote is won. `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3222/portal/quotes/<other customer's Q-id>/pdf?preview=<customerId>" -b "$J"` → 404. Stop the server.

- [ ] **Step 10: Commit.**

```bash
git add src/app/portal/page.tsx scripts/test-review-and-spec.ts
git commit -m "feat(portal): quotes Open/History open their saved PDFs; project history (#220)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Risks to watch while executing

- **Chromium on Vercel.** `@sparticuz/chromium` adds ~60 MB (compressed) to each function listed in `outputFileTracingIncludes`; the unzipped function limit is 250 MB. A cold render costs ~3–8 s plus a cold print-route invocation, inside the page's 60 s `maxDuration`. Chromium needs ~1 GB memory. If the version pair drifts (Task 3 step 1), launches fail with a protocol error; the PDF shows the reason and saves still work. First production deploy: save one quote and read the function log for `[quote-pdf]` lines.
- **Deployment Protection.** On protected preview URLs the headless browser gets Vercel's login page unless `VERCEL_AUTOMATION_BYPASS_SECRET` is set in the project (the render then fails with "The print page answered 401/403.").
- **Preview deploys share the production DB and Blob store** — a preview save re-renders a live quote's PDF with preview code.
- **Dev.** Needs Google Chrome at the macOS default or `CHROME_PATH`. `next dev` compiles `/print/…` on the first render (hence the 90 s dev timeout). Without a Blob token, files land in `.data/files` (gitignored with `.data/`).
- **Capacitor shells.** WKWebView may show only the first page of an iframed PDF, and `target="_blank"` can leave the app's session; "Open PDF ↗" is always offered next to the frame.
- **Revision label.** The PDF prints "REV n" from the revision count at save time; a send cuts a revision afterwards, so the sent copy shows the pre-send count (unchanged from today's printed preview).
