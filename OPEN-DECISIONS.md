# Open decisions — the punch list's remaining questions (2026-07-19)

**ALL ANSWERED 2026-07-19.** Jeff answered the full sheet; every answer is recorded back into
PUNCHLIST.md (the source of truth) under its item, and the batch is logged as decision D87.
Jeff's framing: **store to run later** — these are recorded decisions queued for build, not a
green light to start everything now.

Not listed: items absorbed by the Daylite parity program (7, 12, 17–19,
21–23 — their calls happen inside Phases 2–6), item 5 (tabled), item 4
(deferred), and the Daylite export audit (waiting on your CSV).

---

## Item 11 — Pricing tiers *(answered separately, earlier on 2026-07-19)*

- **11-D. Portal equipment prices.** Catalog `list` is a per-SKU absolute
  price with no percentage hook. Should a tier **discount off the list
  price**, or should list be **re-derived from cost + tier margin**?
  > Answer: **Cost + margin** — customer price re-derived from cost at the tier margin
  > (fall back to list when a part has no cost).
- **11-margins. The percentage for each tier.**
  > Answer: **Seven tiers — Base 30 · Copper 27 · Silver 22 · Gold 20 · Platinum 15 ·
  > Reseller 10 · Employee 5** (percent margin; spelling confirmed "Copper").
  > Admin-editable tier→margin table seeded with these.

## Item 9 — Team members

- **9-A. What fields go on the member contact card?**
  > Answer: **Confirmed as proposed** — real title, direct phone, mobile, office assignment,
  > certification/license numbers. ("That is a good list.")
- **9-C. Archived vs removed — what's the difference operationally?**
  > Answer: **Correct as suggested** — archived = keeps history, can't sign in, hidden from
  > pickers; removed = also hidden from the Settings list; neither hard-deletes.
- **9-D. Should the signature phone be the member's direct line?**
  > Answer: **No — signatures use the standard office numbers.** (Means office phones must
  > become editable and resolve from the signer's office, not `offices[0]`.)

## Item 13 — Service records → projects

- **13-A. Dual-write or convert?**
  > Answer: **Dual-write / linked, as recommended** — the inspection stays and gains a
  > linked project.
- **13-B. What is "signed off" on an inspection?**
  > Answer: **Customer sign-off is purely approval of the inspection QUOTE** — it authorizes
  > doing the inspection. The inspection report then carries a **repair estimate tied to it**
  > for the repair that solves the found problem.
- **13-C. Unified scheduler:**
  > Answer: **One Gantt for all four sources** (projects, inspections, repairs, flame jobs).
- **13-D. What is Consulting?**
  > Answer: **Tabled.** Working definition: design work we get paid to commit to — more
  > paperwork, much more review, but a real path forward. **Note filed to ask at the next
  > brainstorming session.**

## Item 14 — Catalog divergences

- **14-A. Book-age pills:**
  > Answer: **Add `updatedAt` to catalog parts** — so we know when a price list was last
  > updated; the pills become real.
- **14-B. The estimator's hardcoded `SUGGEST` strip:**
  > Answer: **Retire it in favour of the catalog** — catalog-backed suggestions.

## Item 15 — Install timeframe on the estimate → project goal

- **15-A. Relative weeks or an absolute date?**
  > Answer: **As recommended** — store weeks, resolve from the win date.
- **15-B. `targetDate` only, or the whole triplet?**
  > Answer: **"When they need it" is the target date for COMPLETION** (install complete by);
  > the triplet shifts together off it.
- **15-C. Customer-facing or internal?**
  > Answer: **Internal** — no needed-by line on the quote PDF, **but lead time gets listed in
  > the quote's terms & assumptions.**
- **15-D. Back-fill:**
  > Answer: **Keep the silent default rule; the default is 12 weeks (84 days) MINIMUM.**
  > (Current code hardcodes 42 days — moves to 84.)
- **15-E. Can a PM edit the date afterward?**
  > Answer: **Yes.**

## Item 16 — Sold / completed notifications

- **16-A. Task-first or email-first?**
  > Answer: **Task-first, as recommended.**
- **16-B. If email: who receives it, and from which mailbox?**
  > Answer: Moot for now — email layers on later (after item 9 + a send log).
- **16-C. Batch or per-event?**
  > Answer: Moot for now — see 16-B.
- **16-D. Which "completed" triggers?**
  > Answer: **The definitions collapse: the PM completes via direct stage change, but
  > sign-off is REQUIRED to complete** — gate the stage change on signoff; single trigger path.
- **16-E. Who is "the PM"?**
  > Answer: **Projects need multiple people in roles** — Project Manager, Project Coordinator,
  > Estimator, Lead Sales, Installer Lead, Installers, etc. A project-roles model; tasks then
  > assign by role (sold → PM, completed → Lead Sales).

## Small stragglers

- **Leads chip:** should "Nothing scheduled" on an open lead count as a real
  follow-up need, or stay display-only?
  > Answer: **Stays display-only** — Jeff is good with the D83 chip as-is.
- **Item 8 leftover** (now filed under item 4): should the four AI features
  be unreachable app-wide until you decide on the API, or stay available
  where they exist?
  > Answer: **Stay available for now.** Jeff wants a working session to **design ways around
  > the four AI features** (rules-based replacements, D75/D86 mold) — queued for the next
  > brainstorming session.
