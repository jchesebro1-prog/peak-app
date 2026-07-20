# Open decisions — the punch list's remaining questions (2026-07-19)

Everything decision-free is built. These are the questions still gating work,
extracted verbatim-in-substance from PUNCHLIST.md (which stays the source of
truth — answers get recorded back there). Answer inline, in chat, however you
like; a sentence each is enough.

Not listed: items absorbed by the Daylite parity program (7, 12, 17–19,
21–23 — their calls happen inside Phases 2–6), item 5 (tabled), item 4
(deferred), and the Daylite export audit (waiting on your CSV).

---

## Item 11 — Pricing tiers *(READY TO BUILD — just two loose ends)*

- **11-D. Portal equipment prices.** Catalog `list` is a per-SKU absolute
  price with no percentage hook. Should a tier **discount off the list
  price**, or should list be **re-derived from cost + tier margin**? (These
  show the customer different pricing philosophies.)
  > Answer:
- **11-margins. The percentage for each tier** — Base / Cooper / Silver /
  Gold / Platinum / Employee. (Table will be admin-editable, so rough
  numbers are fine to start. Also: is it "Cooper" or "Copper"?)
  > Answer:

## Item 9 — Team members (B is done; email lockout already fixed)

- **9-A. What fields go on the member contact card?** Proposed: real title,
  direct phone, mobile, office assignment — plus certification/license
  numbers **if** those need to print on inspection paperwork. Confirm the
  list.
  > Answer:
- **9-C. Archived vs removed — what's the difference operationally?**
  Suggested: *archived* = keeps history, can't sign in, hidden from pickers;
  *removed* = same but also hidden from the Settings list. (Recommend
  neither ever hard-deletes, since records join members by name.)
  > Answer:
- **9-D. Should the signature phone be the member's direct line** instead of
  the office phone?
  > Answer:

## Item 13 — Service records → projects

- **13-A. Dual-write or convert?** When an inspection is signed off: does it
  *stay* an inspection and gain a linked project (two rows — recommended,
  mirrors quotes→projects), or *become* a project?
  > Answer:
- **13-B. What is "signed off" on an inspection?** Customer signs, or tech
  signs? What happens on un-signoff?
  > Answer:
- **13-C. Unified scheduler:** one screen, or the main Gantt reading all four
  sources?
  > Answer:
- **13-D. What is Consulting?** It exists nowhere in the data model — define
  it before anything can include/exclude it. (Ties to the Consulting idea at
  the bottom of the punch list.)
  > Answer:

## Item 14 — Catalog divergences

- **14-A. Book-age pills** on the dashboard catalog card: drop them for good,
  or add an `updatedAt` to catalog parts so they're real?
  > Answer:
- **14-B. The estimator's hardcoded `SUGGEST` strip** (its SKUs aren't in the
  catalog): retire it in favor of catalog-backed suggestions, or curate it
  as a real validated quick-pick list?
  > Answer:

## Item 15 — Install timeframe on the estimate → project goal

- **15-A. Relative weeks or an absolute date?** If weeks — from the quote
  date or the win date? (Recommend: store weeks, resolve from win date.)
  > Answer:
- **15-B. Does the timeframe set `targetDate` only, or the whole
  install-start → target → buffer triplet?** I.e. is "when they need it"
  *install complete by* or *install begins*?
  > Answer:
- **15-C. Customer-facing or internal?** Should a "needed by" line print on
  the quote PDF?
  > Answer:
- **15-D. Back-fill:** quotes won before this ships have no timeframe — keep
  the silent 42-day default, or surface "no timeframe set"?
  > Answer:
- **15-E. Can a PM edit the date afterward?** (Strongly recommend yes — it
  feeds the billing forecast.)
  > Answer:

## Item 16 — Sold / completed notifications

- **16-A. Task-first or email-first?** Recommend task-first: sold →
  auto-task "PM: reach out"; completed → auto-task "Sales: follow up"
  (composes with item 17's task system; email can layer on after item 9 +
  a send log exist).
  > Answer:
- **16-B. If email: who receives it, and from which mailbox?**
  > Answer:
- **16-C. Batch (daily digest) or per-event?** (Recommend digest if email
  happens at all.)
  > Answer:
- **16-D. "Completed" has two definitions** — via sign-off, or any direct
  stage change to complete. Which one triggers?
  > Answer:
- **16-E. Who is "the PM"?** Projects only carry `owner` (the estimator).
  Who do follow-up tasks get assigned to?
  > Answer:

## Small stragglers

- **Leads chip:** should "Nothing scheduled" on an open lead count as a real
  follow-up need (affects worklist counts/urgency), or stay display-only?
  > Answer:
- **Item 8 leftover** (now filed under item 4): should the four AI features
  be unreachable app-wide until you decide on the API, or stay available
  where they exist?
  > Answer:
