# Customer Rewards (#282) — design

**Date:** 2026-09-30 · **Punch:** #282 · **Approved by:** Jeff (2026-09-30, in session: "approve and start building all
of this … make best assumptions")

## Ask

"A rewards tracker for customer purchases … where we can give rewards and other benefits based on how much they have
purchased." Jeff's choices:

| Question | Answer |
|---|---|
| Reward kinds | **All:** tracking, automatic tier moves, account credit, perks |
| Counts as a purchase | **Won quotes** (every quote type) + imported Daylite history |
| Window | **Lifetime** — levels only go up |
| Tier moves | **Suggested; staff approve** |
| Credit earning | **% of each won quote, by level** (admin-set) |
| History and credit | **Retroactive, capped** one-time starting credit |
| Credit spending | **Staff apply it on a quote; never expires** |
| Portal | **Yes** — level, progress, credit, perks (never margins) |

## Units

### 1. Program settings — `src/lib/rewards/program.ts` (pure) + blob `rewards_program`

```ts
type RewardLevel = "base" | "copper" | "silver" | "gold" | "platinum"; // the ladder; reseller/employee are off-ladder
type RewardsProgram = {
  enabled: boolean;                                       // default false — nothing posts or shows while off
  thresholds: Record<Exclude<RewardLevel, "base">, number>; // lifetime $ to reach each level
  earnPct: Record<RewardLevel, number>;                    // credit earned per won quote, % of its value
  retro: { ratePct: number; capPerCustomer: number };       // one-time starting credit from history
  perks: Perk[];
  launchedAt?: number;                                     // stamped the first time `enabled` turns on
};
type Perk = { id: string; name: string; description: string; level: RewardLevel; frequency: "once" | "yearly"; active: boolean };
```

Defaults (assumptions, flagged for Jeff): thresholds Copper $25,000 · Silver $75,000 · Gold $150,000 · Platinum
$300,000; earn Base 0 % · Copper 1 % · Silver 1.5 % · Gold 2 % · Platinum 3 %; retro 1 % capped at $1,000; no perks;
**disabled**. `sanitizeRewardsProgram` enforces ascending thresholds, 0–20 % earn, non-negative caps, unique perk ids.
Admin page **Settings → Rewards** (`/settings/rewards`, an `ADMIN_SCREENS` link, `manage_users`).

### 2. Lifetime spend — `src/lib/rewards/spend.ts` (pure) + a loader

A company's purchases, each counted **once**:

- every **won quote** (any `quoteType`, any `source`, not soft-deleted) at `value` **plus** any Rewards credit applied
  on it (credit doesn't reduce spend); dated by the last `history` entry `to: "won"` (fallback `updatedAt`/`createdAt`);
- every **project** (and imported **repair** record) whose `quoteId` is empty or does not point to a won quote, with
  `valueUnknown !== true` and `value > 0`, dated `closedAt ?? startedAt ?? createdAt` — this is where Daylite won
  history lives.

`lifetimeSpend(purchases)`, `levelFor(spend, program)` (highest threshold met), `nextLevel(...)` → `{level, need}`.
Company-level (a customer is a company); contacts' purchases roll up to their company.

### 3. Levels and tier suggestions

- A customer's **current tier** is resolved as today (contact → company → base, `src/lib/pricing-tiers.ts`); the
  company tier is what rewards reads and sets.
- **Suggestion:** the earned level is above the company's current ladder tier. Reseller/Employee companies are never
  suggested. Never suggests down.
- **Approve** (`approve` perm): sets the company's `pricingTier` to the earned level through the existing company save,
  and raises any of its contacts whose own ladder tier is below it (never lowers a contact, never touches
  reseller/employee contacts). Open Estimator drafts re-price through the existing #254 path the next time the customer
  is picked; nothing is rewritten server-side (D457 stands). **Dismiss** hides a suggestion until the next level.

### 4. Credit ledger — collection `reward_ledger` (new doc table + migration)

Append-only entries, one company each: `{ id, companyId, kind, amount, quoteId?, perkId?, note?, at, by }`,
`kind ∈ earn | reverse | start | redeem | unredeem | adjust | perk`. Balance = Σ amount over `earn`, `reverse`
(negative), `start`, `redeem` (negative), `unredeem`, `adjust`. `perk` entries carry `amount 0` and record a perk use.
Deterministic ids make every post idempotent (`earn:<quoteId>:<n>`, `start:<companyId>`, `redeem:<quoteId>:<n>`).
Wiped by the go-live demo reset like other customer data (not added to `CONFIG_COLLECTIONS`).

- **Earn:** inside `setStatus()` (`src/lib/stores/quotes.ts`, the single funnel for every Won path), when a quote
  becomes `won`, the program is enabled, and the transition is not a `historical-import` bypass: post
  `earn = round2(value × earnPct[level at the moment of the win] / 100)` (value net of credit — what the customer pays).
  Leaving `won` posts a `reverse` for the open earn; re-winning posts a fresh earn. A failure to post never blocks the
  status change (logged).
- **Starting credit:** Settings → Rewards → "Starting credit" lists every company with history before `launchedAt`,
  proposed `min(cap, round2(historySpend × ratePct/100))`; Post (one or all) writes `start:<companyId>` once.
- **Adjust:** `manage_users` can post a signed adjustment with a required note.

### 5. Spending credit

- **Estimator:** "Apply credit" (in the quote totals area; `create` perm) adds one `SpecItem` with `rewardCredit: true`,
  `qty 1`, `cost 0`, negative `price`, desc "Rewards credit", to the last system. Amount ≤ **available** = balance −
  credit sitting on the company's other open (draft/sent) quotes, and never more than the quote's pre-credit total.
  `reconcileEstimatorValue` and the sell-override/clamp rules accept a negative price **only** on a `rewardCredit`
  line and clamp it server-side to the available amount; freight, margin readouts, the #267 system sell and $25
  rounding, parts list and tier re-price ignore it. The customer document prints it as its own "Rewards credit" line
  under the system subtotal.
- **Service quotes (flame / inspection / repair):** a "Rewards credit" amount on the builder, applied after the
  engine's total (after $25 rounding / typed total); the letter prints "Rewards credit −$X" and the net total.
- **Redeem:** on Won, post `redeem:<quoteId>` for the credit on the quote; leaving Won posts `unredeem`.

### 6. Perks

Perk definitions live in the program blob. A perk is **available** to a company whose earned level ≥ perk level and
(`once`: never used; `yearly`: not used in the last 365 days). Staff "Mark used" (`create`) posts a `perk` ledger entry
with an optional quote link and note.

### 7. Screens

- **Company record → Rewards card:** earned level + current tier (and a suggestion with Approve/Dismiss), lifetime
  spend, progress bar to the next level, credit balance + available, perks (Mark used), the counted purchases list and
  the ledger (with Adjust for admins). Hidden while the program is off.
- **`/rewards`** (CRM nav, `create`): Ready to move up (Approve/Dismiss), every customer by lifetime spend with level,
  credit balance and available perks; filters by level.
- **Portal:** a Rewards card on `/portal` for the grant's company only: level name, progress to next level
  ("$X to Gold"), credit balance, available perks. No margins. Tier *names* become customer-visible as reward levels
  — amends the "never shown to customers" note on `PRICING_TIERS` (D87) for names only.

## Phases

1. **Tracker + suggestions:** §1, §2, §3, the Rewards card (spend/level/progress/suggestion), `/rewards`,
   Settings → Rewards (levels + earn % + retro fields; perks editor may land in phase 3).
2. **Credit:** §4 (migration, earn/reverse in `setStatus`, starting credit, adjust), §5 Estimator apply + redeem,
   card + `/rewards` credit columns.
3. **Service-quote credit** (§5 service part).
4. **Perks + portal** (§6, perks editor, portal card).

## Testing

Pure: spend dedupe (won quote + its spawned project counted once; Daylite project with no quote counted; UKN skipped;
deleted skipped), level/next-level math, sanitize, suggestion rules (reseller/employee, never down), ledger balance,
earn/reverse/re-win idempotency, starting credit cap, available-credit holds, credit line clamps (never below $0, never
above available), perk availability windows. DB: setStatus posts earn once; historical-import posts nothing; program
off posts nothing; portal card scoped to the grant. Gates: tsc, test:specs, test:smoke, eslint, next build; browser run
on a scratch datadir.

## Jeff-gated after ship

Review the default thresholds / earn % / retro rate and cap, add perks, post starting credit, then turn the program on.
