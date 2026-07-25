# Quartzite-6 — Remaining-Items Decision Sheet & Design (2026-07-25)

Brainstorming session output: Jeff answered every remaining open question across
the punch list, MASTER-QUESTIONS, the D117 catalog import, and The Grid backlog.
This spec records the decisions and the design shape for each theme, and feeds
the implementation plan. Sources: PUNCHLIST.md items 17–37, OPEN-DECISIONS.md
(13-D + item-8 leftover, both queued for this session), MASTER-QUESTIONS.md
(S13/S19 leftovers), DECISIONS.md D113–D117.

Build order decided: **① CRM thread → ② Consulting → ③ Estimator → ④ Knowledge
→ ⑤ Grid + lineset.** Deploy clicks happen this week, before the new builds.

---

## 1. Consulting — redefined (closes 13-D; reshapes #25/#35)

**Definition.** Consulting is a **specifier role**: Peak is paid to design and
write the spec; the project goes out to bid; Peak may or may not win the
equipment; the engagement ends when construction-admin/oversight ends. This
replaces the "design work we get paid to commit to" working definition.

**Lifecycle.** Replace `active / delivered / bid_supported` with six explicit
stages: **Proposal sent → Awarded → Design → Out to bid → Construction admin →
Closed.** Existing engagements map onto the new ladder. (The D113 item-11
"delivered stays open" dashboard rule carries over: any stage before Closed
counts as active.)

**Peak as bidder.** When a consulting job goes out to bid and Peak bids its own
spec, the engagement **formally links to Peak's quote**; the quote's win/loss
feeds the engagement record. One click engagement ↔ estimate.

**Proposal builder (#35).**
- **Scopes:** structured line items, each with **title + description + fee**;
  the proposal total assembles from scope fees.
- **Assumptions:** a **Settings-editable checklist** (visit-reason-picklist
  pattern), seeded from Peak's real consulting letter; tick per proposal.
  Shares the estimator's assumptions/exceptions model (§4).
- **Auto-lead:** creating a proposal logs a lead, **deduped** — link to an
  existing open lead for that company; create only if none.
- **Architect:** **minimal link now** (architect company/contact reference on
  the engagement), designed to migrate into item 20's people/roles model.
- **Document:** Jeff supplies the real Peak consulting letter (homework); the
  `consulting_proposal` template is remapped to match it.

**Naming (#25).** The module is **"Consulting" under the Design tab** — plain
relabel, URLs unchanged. The nav itself is being reworked in a separate
session; this records the name only.

## 2. AI-feature replacements (closes the D89 follow-up)

- **Dropped for good** (no replacement planned): inbox **thread summaries** and
  the **"ask about my business data" assistant**.
- **Import extraction → column-mapping wizard.** Upload any spreadsheet → app
  shows detected columns → user maps them to fields once → **mapping saved per
  source** for reuse. Generalizes the D117 fuzzy-header approach to every
  import type.
- **Renewal-email personalization → conditional paragraphs + merge fields.**
  Rules insert paragraphs from record facts: price-delta explanation (D69),
  years-as-customer, last visit findings, upcoming compliance deadline.
  Deterministic; no snippet-picking step.
- **Customer portal (S19 answered):** the portal is a **full account window** —
  compliance status + certificates, quotes + approvals, and service requests
  all first-class. Remains parked until the backend is production-solid
  (standing S19 rule); this defines its target shape.

## 3. CRM thread (builds first)

**Tasks (#17).** Promote to a **real table** (answered 7/19) with:
- **Template + manual:** stage changes expand a standard checklist
  (blankRubric pattern, coverage-key de-dup) and anyone can add ad-hoc tasks.
  Jeff owes the checklist items per stage (homework).
- **Full shape:** user-id assignee (display name denormalized), due date,
  4-state status (open / in progress / done / blocked), notes.
- **Bell:** overdue + assigned-to-me tasks surface in nav-counts. Item 16's
  sold/completed notifications ride this rail.
- Migration: embedded `ProjectTask[]` moves over; mobile Field Work UI moves
  with it; the two dead server actions are rewritten.

**Opportunity board (#18).** Merged-pipeline concept implemented as a
**read-time union view** over leads + quotes — no migration; dragging a card
writes back to whichever store owns it. Stages: **New → Collect Info →
Estimate → Estimate Sent → Won/Lost → PO Received.** Toolbar filters: owner
(new owner scoping on leads), date ranges (created / forecast — forecast date
is a new lead field), keywords (D85), venue type. Promote to a real
Opportunity record later only if the union creaks.

**Projects board (#19).** `?view=board` toggle beside the master-detail list;
**installs pipeline only** (7 columns); **read-only** columns to start (stage
changes keep their existing deliberate paths). Generalize the leads
`board-view.tsx` into a stage-agnostic component.

**Activity timeline (#21).** v1 = **customer-page merged feed** (read-time
aggregation: quote status history, comms, site visits, job approvals/
completions, project notes) with Daylite-style date buckets, **plus notes as a
real attachable record** so the feed is a note-taking surface, not just system
events. No field-level change tracking.

**Lead → visit → survey → estimate (#34).** Full thread:
- `SiteVisit` gains a **lifecycle** (requested / open / claimed / scheduled /
  done) and **leadId**.
- A **claimable open-visits queue** (reuse the claim pattern from leads/design
  reviews).
- Requesting a visit **auto-creates the linked Survey** at stage `requested`.
- The lead surfaces visit/survey status; **lead→customer convert is gated on
  the survey** instead of bypassing it.
- The button lives on the lead; captures reason (default "Site survey /
  measure"), preferred timing, assign-or-open.

**Navigation (#22).** **Mine/All scoped nav entries first**: promote the
existing Quotes owner filters into nav ("My Quotes"…), add owner scoping to
leads and projects, split won from lost on the leads closed segment.
Per-person saved views deferred. **Learn folds into the Knowledge tab.**
**Team calendar: wanted** — see §7 Calendar.

**Customers (#23).** **Custom fields get built** (definition storage,
per-type schemas, rendering) — decided without waiting for the export audit;
the Daylite CSV is still wanted as an audit input (homework). Also queued:
keywords/lifecycle edit UI, "added in last 7 days" view.

## 4. Estimator upgrades

- **Assumptions & exceptions (#36-A):** **one shared model** consumed by both
  the estimator and consulting proposals. Settings-editable library; each
  quote ticks standard **assumptions** and lists **exceptions** as two
  separate lists, plus free-text additions.
- **Narrative quotes (#36-B):** a rules-based prose draft **assembled from the
  BOM/spec** (D86 mold, no AI), editable before sending. Per-quote toggle:
  customer receives BOM, narrative, or both.
- **Attachments (#36-C):** reuse the consulting attach-document infra on
  quotes. **Internal-only** (never customer-visible), **auto carry-forward to
  the project on Won**, PDF/Office/image types. Driver: vendor quotes for the
  PM.
- **Sell-price entry (#37):** typing a section sell price **solves the uniform
  section margin** (reverse of the existing margin field). The entered price
  **persists across revisions** (not recomputed from tierMargin) and a
  **warning fires** when the implied margin lands below the tier floor.

## 5. Knowledge + design tools

- **Knowledge tab (#26/#27):** new **top-level nav group**. **Data-backed
  store** (importable/refreshable, not hardcoded). One screen with the **7
  fixture cross-reference matrices** as searchable sections, **pricing
  included**, **internal-only** (competitive intel — never portal-exposed).
  Motor Library relocates in; Design Doctrine + school reference sheets can
  follow. Learn/help content also lives here.
- **Lineset (#29):** **full unification** — one fabric record carrying both
  `costPerSqft` (estimator) and areal **oz** (lineset) so any fabric pick
  yields price + weight; add a **proscenium/trim-height** input; **auto-fill
  line defaults from the venue envelope** (borders ≈ width + overlap, legs /
  travelers ≈ trim height, full-stage ≈ W × H); per-line overrides preserved.
  Estimator-spec'd curtains gain a path to lineset weights.
- **#28:** lineset default becomes **50′ × 30′** (constant + reset label).
- **Field measure (#30/#31):** **manual quick-measure UI now** (big numeric
  entry, unit toggle, point→confirm→fill — fills the focused `MeasureField`).
  Surveyors carry **iPhone/iPad**, so Bluetooth laser sync (Leica DISTO)
  arrives via a **Capacitor native shell later** — stay a clean PWA until the
  laser justifies wrapping. No full native rewrite, ever.
- **Mobile readability (#33):** Claude **audits and proposes** the worst
  screens; Jeff approves the target list before work starts.
- **#32 (bug):** venue address picker fix ships with the first wave — carry
  `street` through `AddressHitVM` and set it in `pickAddress`; fall back to
  road/display name for POI hits without a house number.

## 6. The Grid + catalog

- **Device metadata (§10):** **Claude drafts** the ~50-row ETC lighting +
  rigging worksheet from the imported catalog + public ETC specs (symbol,
  weight_lb, datasheet_url, accessories); **Jeff reviews** rather than
  authoring from blank. Datasheet files land in the `quartzite-files` Blob
  store under `datasheets/`.
- **DXF export: queued** — on the backlog after metadata (was park-or-drop).
- **Editable riser: queued** — node repositioning + annotations, after
  metadata. The derived sketch + print/PDF remains the interim answer.
- No new Grid asks from use; the D113 backlog stands.

**Catalog (D117 held-outs):**
- **Tannoy:** keep **Music Tribe Nov 2025** rows; the June 2023 dedicated
  sheet stays out.
- **Ape Riggers: dropped** — not imported, no vendor chase.
- **Draper: base models only** — each product line once, no size
  permutations; sizes priced per-quote from the configurator.
- **Verify-flagged rows (5,206) + weak-parse brands:** a **dedicated cleanup
  session** — Jeff gathers vendor tier confirmations (Symetrix / Danley /
  Listen), Shure/EAW footnote confirmation, and current sheets for the weak
  brands (Apex, NETGEAR, Renkus-Heinz, Cloud, LynTec, Polar Focus, Visionary,
  Linea Research); one batch re-import.

## 7. Operations + sequencing

- **Build order:** ① CRM thread → ② Consulting → ③ Estimator → ④ Knowledge →
  ⑤ Grid follow-ons + lineset. Quick fixes (#32, #28) ride wave ①.
- **Deploy clicks: this week, before the new builds** — push main (~68
  commits), `CRON_SECRET`, OAuth scopes + Calendar API, secret-rotation
  check, optional `gh` sign-in, `QUEUE_API_TOKEN` (MASTER-QUESTIONS S1–S5 has
  the click-by-click).
- **Calendar (S13):** full-page module under Home with **month + week views**,
  defaulting to month, with a **team overlay** (person picker + shared Peak
  calendar) — this is also #22-D's team-calendar answer.

## Homework (Jeff)

1. **Peak consulting letter** file (docx/PDF) — format guide for §1.
2. **Task checklist template items** per stage/type — feeds §3 Tasks.
3. **Vendor tier levels + current sheets** for the catalog cleanup session
   (§6).
4. **Daylite export CSV** — custom-fields audit + field parity check.
5. **Go-live data:** real data locations (S6), pricing numbers (E1–E5, F13),
   roster (S10), logo files (G1).
6. **Deploy clicks** (this week — see §7).

## Out of scope / explicitly closed

- Thread summaries and the data assistant: dropped, not parked.
- Native app rewrite: never; Capacitor shell only when the laser needs it.
- Per-person saved nav views: deferred until Mine/All proves insufficient.
- Real Opportunity record/table: only if the union view creaks.
- Ape Riggers: out of the catalog.
