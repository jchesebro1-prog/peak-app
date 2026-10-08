# Estimator — Phase 4 (Customer review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Estimator's Customer review step into a real review desk: the saved estimate shown as the client gets it (Document, Package page, BOM, Cut sheets, Datasheets, Drawings; desktop/phone), an internal sidebar (cost/sell/margin, labor hours/cost/sell, package checklist) and review comments pinned to systems that drive "Send back with N comments".

**Architecture:** Pure modules own the labor summary and the comments rules; a store-owned `Quote.reviewComments` holds comments; a staff-only preview route outside the app layout renders the package page / BOM / client cut sheets from the saved quote for framing (desktop or 390 px); the Review step composes tabs + sidebar; Build and Package show comment pins.

**Tech Stack:** Next.js 16 App Router (routes, server actions, `next.config.ts` headers), React 19, TypeScript; spec harness `scripts/test-review-and-spec.ts`.

**Spec:** `docs/superpowers/specs/2026-10-07-estimator-four-steps-design.md` §11.

## Global Constraints

- Previews show the SAVED quote; unsaved edits → "Unsaved changes — Save to refresh what the client sees."
- Preview route: `/estimator-preview/[id]?tab=package|bom|cutsheets` (outside the `(app)` layout; `requireUser`; system estimates only; 404 otherwise); a `X-Frame-Options: SAMEORIGIN` exception for that path only, mirroring the existing exceptions in `next.config.ts`; no open beacon, no client action forms, no token links.
- Staff download route for package files: `/api/quotes/[id]/package-files/[fileId]` (`requireUser`, serves via the existing `servePackageFile`).
- `Quote.reviewComments?: Array<{ id: string; sectionId: string | null; body: string; by: string; at: number; resolvedAt?: number; resolvedBy?: string }>` — store-owned (written only by quotes-store functions; `update()` drops it; not a content field; no `updatedAt` bump); cap 200; body trimmed, 1–2,000 chars.
- Comment permissions: add = `create` | `send` | `approve`; resolve = `create`; delete = author (unresolved) or `approve`.
- Numbering: open comments numbered 1…n ordered by system order (whole-estimate comments first) then `at`.
- Send-back note format (exact): `<n> comment(s) to address:` then one line per open comment `N. <System name | Whole estimate> — <body>`, then a blank line and any extra text the approver typed.
- Labor: hours = Σ over the group's mobilizations (straight + OT + supervision) + PM + shop + drafting hours from `computeLabor(draft, rate)`; cost = configured `totalCost`; sell = Σ CURRENT ext sell of the group's lines (`it.laborGroup === id`); `edited: true` when that differs from the configured `totalPrice` by > $1; hand-added labor lines with `unit === "hr"` → hours = qty; summary line: max crew, Σ days, Σ OT hours.
- Copy (exact): tabs `Document`, `Package page`, `BOM`, `Cut sheets`, `Datasheets`, `Drawings`; toggle `Desktop` / `Phone`; sidebar titles `Internal only`, `Labor`, `Package checklist`, `Comments`; comment target option `Whole estimate`; button `Add comment`; `Resolve`; `Delete`; approver button `Send back with N comment(s)`; labor edited marker `edited`.
- Gates per task: `npx tsc --noEmit` 0; scoped eslint clean (never `npm run lint`); `npm run test:specs` FAIL 0 (report PASS); `npx next build` when client/route code changes. Never `git stash`; never touch `.data/`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Numbers assigned in Task 6.

---

### Task 1: Pure labor summary + comments rules
**Files:** create `src/lib/estimate-review/labor.ts`, `src/lib/estimate-review/comments.ts`; harness `#P4 pure`.
- `laborSummary(sections, rate)` → `{ groups: Array<{ id; label; hours; cost; sell; edited }>; loose: { hours; cost; sell } | null; totals: { hours; cost; sell }; crew: { maxCrew; days; otHours } }` per the constraint rules (group label = section name + discipline label).
- `sanitizeComment(raw)`, `numberComments(comments, sections)` (open only, ordering rule), `sendBackNote(open, sections, extra)` (exact format), `canAddComment/canResolve/canDelete(roles, comment, me)`.
- Tests: fixtures with a configured group (incl. OT + supervision + PM/shop/drafting), an edited group, loose `hr` lines, empty; numbering order; note format; permission matrix. Commit `feat(estimator): Phase 4 labor summary and review-comment rules (pure)`.

### Task 2: Comments store + actions
**Files:** `src/lib/stores/quotes.ts` (`reviewComments` + `addReviewComment`, `resolveReviewComment`, `deleteReviewComment`, mirroring `recordEstimateEmail`'s store-owned pattern); `src/app/(app)/estimator/review-actions.ts` (`"use server"`: list/add/resolve/delete — `requireUser` + permission rules; return the fresh numbered list); harness `#P4 comments` (async DB checks: save can't clobber, cap, permission refusals, numbering after resolve).
Commit `feat(estimator): Phase 4 review comments store and actions`.

### Task 3: Staff preview route + live package loader + staff file route + datasheets action
**Files:** `src/app/estimator-preview/[id]/page.tsx` (+ minimal layout with the app fonts/CSS vars only); a live loader `src/lib/estimate-output/package-live-loader.ts` (from `quoteDocumentDataFor` + `packageViewModel` with staff link bases, frozen fields from the quote, dummy ok state, header line built locally; export `catalogFor` from package-loader.ts); BOM tab renders `<QuoteDocument {...bomViewProps(docProps)} layout="web"/>` with the web CSS; Cut sheets tab renders `loadCutSheets(id, { images: "url" })` → `<CutSheetPages … style="client"/>` WITHOUT injecting print CSS globally (scope it); `next.config.ts` SAMEORIGIN exception for `/estimator-preview/:path*`; `src/app/api/quotes/[id]/package-files/[fileId]/route.ts`; a server action `reviewDocsAction(quoteId)` (datasheets rows from `specPackageDocs` + drawings rows from `loadPackagePanel` with staff hrefs). Tests: source pins (auth, frame exception scoped, no beacon/actions/token links) + loader unit test with fakes if practical. Commit `feat(estimator): Phase 4 staff preview of the package page, BOM and cut sheets`.

### Task 4: Review step UI
**Files:** `steps/review-step.tsx` (+ new `steps/review-tabs.tsx`, `steps/review-sidebar.tsx`), `review-cost-summary.tsx` reuse; harness `#P4 review UI`. Tabs per constraints (Document = existing `PdfPreviewPane`), Desktop/Phone toggle for framed tabs (iframe width 100% / 390 px, height fills), Datasheets + Drawings lists from `reviewDocsAction`, unsaved banner; sidebar: QuoteNextStep (unchanged wiring), Internal only cost table, Labor table (`laborSummary(s.sections, s.rate)`), Package checklist, Comments (list with numbers, add form with system select, Resolve/Delete per permissions). For an approver with the quote in review: a `Send back with N comment(s)` button that calls `nsSendBackAction(quoteId, sendBackNote(...), asOf)` and applies the sync + `onActed("sendBack")`. Phone (≤700 px) keeps today's view-only Review. New step files added to the harness joined-source lists. Commit `feat(estimator): Phase 4 Customer review — client's-eye tabs, labor, checklist, comments`.

### Task 5: Comment pins in Build and Package
**Files:** `steps/build-step.tsx` / `section-card.tsx` (a numbered pin badge on a card header with its open comments in a small popover; click "Resolve" inline for `create`), `steps/package-step.tsx` (count next to each system in its nav), hook: load comments once into state shared by the steps (`reviewComments` + refresh after mutations); harness `#P4 pins`. Commit `feat(estimator): Phase 4 comment pins on Build and Build package`.

### Task 6: Verification + docs
Controller browser pass (scratch DB): each tab desktop + phone, unsaved banner, labor numbers vs the configurator, checklist, add/resolve/delete comments, pins on Build/Package, send back with N comments (note text) and the estimator seeing the strip. Then smoke, DECISIONS/PUNCHLIST/AGENTS (numbers from origin/main), final gates, commit `docs: Estimator Phase 4 — Customer review`.
