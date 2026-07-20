# Review Markup & Accountability — Design

**Date:** 2026-07-19
**Status:** Approved by Jeff (brainstorming session 2026-07-19, memory-repo session)
**Home:** peak-app. Upgrades the shared review record, so it lands on quote
reviews and consulting phase reviews alike.

## Problem / goal

Jeff: *"The review screen is how we hold accountability and I think right now it
is the most underutilized."* He is right, and the model shows why.

Today `QuoteReview` (`src/lib/stores/quotes.ts`) is:

```
{ state, reviewer, submittedBy, submittedAt, decidedBy, decidedAt, note }
```

States (`none | in_review | approved | changes`) and the claim / approve /
request-changes actions all exist — but the entire substance of a review is one
free-text `note`. There is no itemized record of what was examined, no markup on
the drawings, no proof that requested edits were ever made, and nothing binding
an approval to the documents it approved.

Goal: every review carries itemized comments with attribution, markup drawn on
the documents themselves, an explicit send-back loop that gates approval, and an
approval permanently bound to the exact files reviewed.

Because consulting phase reviews reuse the same `QuoteReview` shape
(`engagements.ts` `EngagementPhase.review`), this work upgrades every review in
the app at once.

## Decisions made in this session

| Decision | Choice |
|----------|--------|
| Markup depth | **Full annotation toolset** (shapes, clouds, arrows, text, highlight) |
| Spec structure | **One combined spec** (not split), with a staged internal build order |
| Approval attestation | **Pin document versions + keep frozen immutable copies** |

## Component A — Comments (the accountability spine)

A review holds N comments. Each: id, author, createdAt, body, status
(`open | resolved | waived`), resolution (`resolvedBy/At`, or waive reason),
anchor, and optional parent for threaded replies.

**Anchors** — what the comment is about:
- a quote/estimate line item
- a standards-checklist item (per the review-checklists spec, same date)
- a document (as a whole)
- a **markup annotation** (Component B)
- the review itself (general comment)

The trail is **append-only**: edits and resolutions add records, never
overwrite. A reviewer's objection and the submitter's answer stay threaded
together.

## Component B — Markup (annotation toolset)

A document viewer + annotation layer on review attachments.

- **Rendering:** PDF (adds a PDF renderer — pdf.js; the app has no PDF library
  today) and images. Zoom/pan transforms.
- **Tools:** rectangle, ellipse, arrow, freehand, revision cloud, text box,
  highlight. Per-annotation color and author attribution.
- **Storage:** annotations are **geometry records anchored to a document
  version + page**, never burned into the file — so they stay editable,
  filterable by author, and exportable.
- **Interaction:** selection, editing, delete, undo. Hit-testing in page
  coordinates so annotations hold position across zoom levels.
- **Joining the trail:** any annotation may carry a comment, which is how
  markup becomes part of the accountability record instead of sitting beside
  it.
- **Export:** flattened PDF with markup burned in **plus a numbered comment
  log** — the artifact you hand an architect.

## Component C — Send-back with edits

Request-changes stops being "a state plus a note":

1. Reviewer marks comments as the **required edits** and sends back. The
   submitter sees exactly what must change.
2. Submitter responds to each comment and resubmits.
3. On resubmit the reviewer gets a **what-changed view**: comments resolved
   since last submission, documents with new versions, and new markup.
4. **Approval is blocked** while any open comment or unchecked standards
   checklist item remains. Waiving is permitted but requires a recorded
   reason.

## Component D — What approval attests to

On approval the app pins:

- the exact set of artifacts and the **version** of each reviewed;
- a **frozen immutable copy** of each reviewed file;
- the markup as it stood at approval.

If a revised document is uploaded afterward, the approval renders **stale**
against the new version and the phase flags for re-review. "Approved" therefore
always names a specific, retrievable set of documents; silent post-approval
swaps become impossible.

**Open implementation decision (must be settled in the plan):** attachments are
currently data-URLs inside doc-store documents (`EngagementDoc`). Frozen copies
multiply that storage. The plan must choose a size budget and very likely move
review attachments to blob storage rather than inline data-URLs.

## Error handling

- Comment trail is append-only — no edit or delete erases history.
- Frozen copies are immutable once written.
- Concurrent reviewers: last-write-wins on a **single** comment, never on the
  set; resolutions never clobber one another.
- A missing/unreadable document version fails the approval pin loudly rather
  than approving with an incomplete record.

## Testing

- Comment lifecycle: create, reply, resolve, waive-with-reason, attribution.
- Approval gate: blocked with open comments / unchecked checklist items;
  unblocks on resolve or waive.
- Send-back → resubmit diff correctness.
- Annotation persistence and coordinate fidelity across zoom levels and
  reloads; per-tool round-trip.
- Version pinning: upload a revised document post-approval → approval shows
  stale, phase flags for re-review.
- Export: flattened PDF contains markup and the numbered comment log.

## Build order (inside this one spec)

1. **Accountability first** — comments, anchors, send-back loop, approval gate,
   version pinning, frozen copies. The review screen becomes genuinely
   accountable here.
2. **Annotation canvas** — viewer, tools, persistence, export — layered onto
   the comment model above.

Staged this way deliberately: the loop is what fixes "underutilized"; the
canvas is the larger, separable unit. (Cost note recorded during design: the
annotation layer alone is comparable in size to the whole D90 Consulting
module.)

## Out of scope (this phase)

Real-time multi-user co-annotation, architect/customer-facing markup access,
OCR, and measurement/takeoff tools.
