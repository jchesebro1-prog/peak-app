# Dashboard widget system: composable Reports + Home, pipeline/capacity widget, #15 prerequisite

**Wave 2.** Full decision record:
`knowledge/peak/quartzite-dashboard-widget-brief-2026-07.md` (all 8 brainstorm
decisions Jeff-confirmed 2026-07-25 — READ IT FIRST; this spec adds only the
build shape and the post-brief trade decision). **Supersedes punch #7** —
reconcile inside the Daylite-parity design so two dashboard plans don't
coexist. **Punch #15 is a prerequisite and is IN SCOPE here.**

## Summary of locked design (details in the brief)
- Curated widget REGISTRY (5 primitives: metric tile · list · breakdown ·
  pipeline/capacity · scheduled load) — NOT a query builder.
- One system powers Home AND Reports; existing `home-*.tsx` cards become the
  first registry widgets; Home = the user's layout.
- Role-gated widgets; Owner/Sales · Installer · Admin presets as starting
  layouts; per-user persistence via the `notifPrefs` pattern.
- Layout v1 = pick + reorder from a gallery, fixed size classes
  (tile/half/full), auto-flow grid. No free drag-resize.
- Global timeframe selector; forward-looking widgets (pipeline/capacity)
  always show next 12 months and are exempt.
- Utilization v1 = **scheduled load** (scheduled days/person/week from
  existing schedule data). No timesheets feature.

## Post-brief decision (Jeff, pop-in 2026-07-25)
**Trades = Lighting / Rigging / AV.** Category→trade mapping ships in the
wave-1 catalog spec as admin-editable data; this widget consumes it. The
brief's "riskiest assumption" is thereby resolved at the taxonomy level —
residual risk is only data quality of the mapping.

## Pipeline/capacity widget (the new computation)
- Both lenses: revenue-target (stage-weighted pipeline vs annual number) and
  install-capacity (monthly loading vs capacity line).
- Capacity = `capacity_bands`: `{ trade, dollarsPerMonth, effectiveFrom }` —
  admin-edited, effective-dated (context: ~$3M/yr now, ~$4M with new hires,
  must spread across 12 months, not summer-stacked).
- Job trade mix: auto-split of quote $ by line-item category→trade; manual
  override per quote.
- Timing: **build #15 first** — install-timeframe field on the quote
  (recon done: insertion `projects.ts:488-490`; richest scope signal
  `spec.mobs[]`; **never build on `spec.systems`**, it's vestigial). One
  field feeds project targets, procurement, Gantt, billing forecast AND this
  widget.
- Confidence: per-stage default weights (admin-set; Jeff tunes over time —
  verbal ≈ 90 or 100) + per-deal override set after customer meetings + a
  separate **"sits awhile"** control that pushes timing months out without
  touching probability. Later (not v1): learn weights from `stageHistory`
  win rates.

## Build tasks
0. Recon: Reports module today, `home-*.tsx` card inventory, notifPrefs
   shape, quote line-item→category join, stage sets.
1. **#15**: install-timeframe on quotes → `fromQuote()` honors it (kill the
   +42d hardcode); edit path for project targets.
2. Widget registry + per-user layout store + gallery (pick/reorder) +
   size-class auto-flow grid + role gates.
3. Global timeframe selector + widget contract (each widget declares its
   date anchor or forward-exemption).
4. Backward widgets: $ quoted, avg margin, project profit, open-projects
   list, backlog list, equipment-sold breakdown (category→item drill).
5. Pipeline/capacity widget: capacity_bands admin UI, trade split, stage
   weights + per-deal override + sits-awhile, monthly loading chart.
6. Scheduled-load widget; wrap existing Home cards as widgets; role presets.
7. Reconcile/supersede #7 in the Daylite-parity spec.

## Open questions
- "Project profit" source: quote margin vs project actuals — define at
  Task 4 with Jeff (one pop-in).
- Preset editing rights: admin-only edit of role presets assumed.

## Acceptance
Jeff composes his five widgets and sees monthly loading vs per-trade capacity
for the next 12 months, overrides one deal to 90% after a meeting, pushes
another out three months without changing its odds; an installer's default
Home shows their open-projects list and equipment breakdown and offers no
margin widgets; the timeframe selector changes history widgets but never the
forecast.
