# QUESTIONS.md — the agenda for Jeff

Nothing here blocks the build — defaults are chosen (see DECISIONS.md) and
everything is reversible. Items are grouped by when they actually matter.
Answer any of them whenever; one-word answers are fine.

## ⚡ To get the live URL (Phase 1's last step — needs your accounts)

The app is built and deploy-ready, but hosting requires accounts only you
can create (they're free). **DEPLOY.md walks through all four** — GitHub,
Neon (database), Vercel (host), Google sign-in credentials (~30 min total).

- **Q-A. When you're ready, work through DEPLOY.md with me.** I'll do all
  the terminal parts and verify each step.
- **Q-B. Which Google account should own the infrastructure?** (Also
  QUESTIONS #1/#4 below — Workspace vs plain Gmail affects nothing yet;
  your `jchesebro1@gmail.com` is pre-authorized to sign in either way.)

## Soon (Phase 2–3 use these)

1. **Company Google Workspace or plain Gmail?** (`name@peaksystemsgroup.com`
   addresses real?) Affects Gmail integration + whether teammates sign in
   with company or personal addresses. *Seeded emails are the derived
   company ones; add/adjust real sign-in emails in Settings → Team.*
2. **Real team roster** — names, sign-in emails, roles (prototype's six
   demo people are seeded; QUESTIONS #22).
3. **Demo data on or off** while screens land? *(Default: on in dev via
   Settings → Beta → Demo data, off in production.)*

## The original handoff agenda (defaults in italics)

**Hosting & accounts**
- Q2. Custom domain (e.g. app.peaksystemsgroup.com)? *(Default: Vercel's
  free subdomain first; domain is a 10-minute add later.)*
- Q3. Budget comfort. *(Default: free tiers → ~$20/mo class if usage grows.)*
- Q4. Who besides you gets admin on hosting/Google accounts?

**Sign-in**
- Q5. Google only, or also Microsoft / email+password? *(Default: Google
  only — built.)*
- Q6. Domain-restricted or invite list? *(Default: invite list = Settings →
  Team — built.)*
- Q7. Keep the prototype's four roles, or add e.g. a field-tech role?
  *(Default: as-is — Admin/Manager/Estimator/Reviewer, ported.)*

**Gmail / Inbox (Phase 7)**
- Q8–12 unchanged from the handoff (which mailboxes, send-as, history
  import depth *(90 days)*, Sent-folder mirroring *(yes)*, Calendar sync).

**AI features (Phase 8)** — Q13–18 unchanged; *default guardrail: AI
drafts, human sends.*

**Data migration (Phase 9)** — Q19–22 unchanged (where current data lives,
whether Blank V.01.xlsx is the real template, history depth *(active + 3
yrs compliance)*, real roster).

**Product decisions (from docs/IDEAS.md)**
- Q23. Real estimating rates before go-live (editable in-app meanwhile).
- Q24. Inspection recurrence: L1 annual / L2 five-year + lead windows —
  confirm before Phase 4 builds the renewals view.
- Q25. Repairs intake form fields (IDEAS #29) — needed in Phase 4.
- Q26. Service contracts (IDEAS #33). *(Default: parked for v2.)*
- Q27. Quotes hub shape. *(Default: one hub + type filter.)*
- Q28. Billing/QuickBooks. *(Default: forecast-only.)*
- Q29. **Company logo files** — light version (dark nav) + dark version
  (documents). Usable any time; documents phase wants it.

**Go-live** — Q30–33 unchanged (testers, backups *(host automatic +
monthly export)*, cutover *(per-module)*, PWA for phones *(yes)*).
