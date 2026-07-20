# Design Module Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the `Consulting` top-level link and the `Design Studio` group into one **Design** nav module, moving routes under `/design/*` with permanent redirects from every old path, and make the design↔engagement link navigable from both sides.

**Architecture:** Pure route + navigation change. No data migration, no store changes. Old routes become thin `redirect()` stubs following the existing `design-studio/weights/page.tsx` precedent. All path-mapping logic lives in one pure module (`src/lib/design-routes.ts`) so it is testable in `npm run test:specs`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, Drizzle/PGlite doc-store.

**Spec:** `docs/superpowers/specs/2026-07-20-design-module-consolidation-design.md`

## Global Constraints

These apply to every task in this plan.

- **Next.js 16.** Read the relevant guide in `node_modules/next/dist/docs/` before writing route code. APIs differ from training data.
- **`requireUser()` / `requirePerm(perm)`** from `src/lib/session.ts` in every server component or action that touches data.
- **Client-bundle boundary:** files marked `"use client"` may only `import type` from anything that reaches the doc-store. Importing a *value* pulls PGlite into the browser bundle and **fails the production build**. This has bitten twice (D90 `TABS`, D94).
- **Never export a `const` array from a `"use client"` file for server consumption** — the server receives a client-reference proxy and `.includes` is not a function. Put shared value arrays in a dependency-free `.ts` module. See `src/app/(app)/consulting/tabs.ts` and its header comment.
- **Never use `window.prompt` / `window.confirm`** — they throw in this app's browser context, silently. Build the input into the page.
- **Timestamps are epoch-ms numbers.**
- **Never hardcode accent-colored UI** — accent is user-configurable and flows through `var(--accent)`.
- **Nav child keys are also badge-count keys** in `src/lib/nav-counts.ts`. Renaming a key silently kills its badge. Bell-group keys additionally double as stored per-user `NotifPrefs` keys — renaming those breaks saved preferences.
- **PGlite is single-process.** Never run a DB script while a dev server holds `.data/pglite`. This corrupted the dev DB twice.
- **Commit after every task.**

---

## Decisions this plan makes (beyond the spec)

The spec left three things ambiguous or unaddressed. These are resolved here; if any is wrong, fix it before starting.

1. **`/design` collision.** The spec defines `/design` as the new Overview *and* lists a redirect `old /design → /design/designs`. Both cannot hold. **Resolution:** `/design` renders the Overview; when `?id=` is present it redirects to `/design/designs?id=…`. This preserves the two live external deep links (`src/app/api/search/route.ts:85`, `src/lib/nav-counts.ts:146`).
2. **`/quick-design` moves too.** It is an unlisted member of this module: it maps to the `design` nav key, imports `../design/actions`, and calls `revalidatePath("/design")` three times. It becomes `/design/quick`.
3. **Two colliding design stores.** `src/lib/stores/designs.ts` (`D-###` sandbox, doc-store rows) and `src/lib/stores/studio-designs.ts` (`DS-<hex>` tool saves, keyed blob) **both export `getDesign` and `removeDesign`** with incompatible signatures. Import sites in this module must alias them: `import { getDesign as getSandboxDesign }` / `import { getDesign as getStudioDesign }`. Never bare-import either name inside `/design/*`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/design-routes.ts` | Pure path-mapping. The single source of truth for old→new paths. No imports. |
| `src/app/(app)/design/page.tsx` | Overview landing (engagements + recent designs side by side). Redirects `?id=` to `/design/designs`. |
| `src/app/(app)/design/designs/page.tsx` | The sandbox list (moved from `/design`). |
| `src/app/(app)/design/designs/design-client.tsx` | Moved from `src/app/(app)/design/design-client.tsx`. |
| `src/app/(app)/design/designs/actions.ts` | Moved; `revalidatePath` targets updated. |
| `src/app/(app)/design/designs/design.css` | Moved. |
| `src/app/(app)/design/engagements/**` | All of `src/app/(app)/consulting/**`, moved. |
| `src/app/(app)/design/{steel,lineset,motors}/**` | Moved from `design-studio/`. |
| `src/app/(app)/design/quick/**` | Moved from `quick-design/`. |

**Redirect stubs** (old path → new), each modeled on `src/app/(app)/design-studio/weights/page.tsx`:
`consulting/page.tsx`, `consulting/[id]/page.tsx`, `consulting/spec/page.tsx`, `consulting/spec/[id]/page.tsx`, `consulting/letter/page.tsx`, `consulting/markup/page.tsx`, `consulting/quote/page.tsx`, `design-studio/page.tsx`, `design-studio/{steel,lineset,motors}/page.tsx`, `quick-design/page.tsx`.

**Modified:** `src/components/nav/nav-data.ts`, `src/lib/queue.ts`, `src/lib/nav-counts.ts`, `src/app/api/search/route.ts`, `src/app/(app)/quotes/{page.tsx,controls.tsx}`, `src/app/(app)/reviews/page.tsx`, `src/lib/stores/engagements.ts` (comment only), `scripts/test-review-and-spec.ts`.

---

### Task 1: The pure route-mapping module

**Files:**
- Create: `src/lib/design-routes.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing. This module must have zero imports so both server routes and the test script can load it freely.
- Produces: `designRedirect(pathname: string, query: Record<string, string>): string | null`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- design module route map (D97) --- */
import { designRedirect } from "@/lib/design-routes";

ok(designRedirect("/consulting", {}) === "/design/engagements",
  "consulting list redirects to engagements");
ok(designRedirect("/consulting/CE-1001", {}) === "/design/engagements/CE-1001",
  "engagement detail keeps its id");
ok(designRedirect("/consulting/CE-1001", { tab: "phases" }) === "/design/engagements/CE-1001?tab=phases",
  "engagement detail preserves ?tab=");
ok(designRedirect("/consulting/markup", { eng: "CE-1001", phase: "ph-2", doc: "ed-3" })
     === "/design/engagements/markup?eng=CE-1001&phase=ph-2&doc=ed-3",
  "markup preserves all three params in order");
ok(designRedirect("/design-studio", {}) === "/design",
  "design-studio overview redirects to the new Design overview");
ok(designRedirect("/design-studio/steel", {}) === "/design/steel",
  "calculators keep their leaf name");
ok(designRedirect("/design-studio/lineset", { design: "DS-abc" }) === "/design/lineset?design=DS-abc",
  "lineset preserves its ?design= deep link");
ok(designRedirect("/design", { id: "D-101" }) === "/design/designs?id=D-101",
  "old sandbox deep link lands on the designs list");
ok(designRedirect("/design", {}) === null,
  "bare /design is the Overview and must NOT redirect");
ok(designRedirect("/quotes", {}) === null,
  "unrelated paths are not redirected");
ok(designRedirect("/consulting/CE-1001", { tab: "bogus" }) === "/design/engagements/CE-1001?tab=bogus",
  "unknown tab values pass through — the destination validates, not the redirect");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: FAIL — `Cannot find module '@/lib/design-routes'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/design-routes.ts`:

```ts
/**
 * Design module consolidation (D97) — the single source of truth for the
 * old→new path map.
 *
 * Deliberately dependency-free: imported by server route stubs AND by
 * scripts/test-review-and-spec.ts, so it must not reach the doc-store.
 */

const QS_ORDER: Record<string, string[]> = {
  "/consulting/markup": ["eng", "phase", "doc"],
};

function qs(pathname: string, query: Record<string, string>): string {
  const keys = QS_ORDER[pathname] || Object.keys(query);
  const parts: string[] = [];
  for (const k of keys) {
    const v = query[k];
    if (v == null || v === "") continue;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

/**
 * Returns the new path for a legacy Design-module path, or null when the
 * path is not a legacy path (and must render normally).
 */
export function designRedirect(
  pathname: string,
  query: Record<string, string>
): string | null {
  // Bare /design is the new Overview. Only the ?id= deep link moves.
  if (pathname === "/design") {
    return query.id ? "/design/designs?id=" + encodeURIComponent(query.id) : null;
  }

  if (pathname === "/consulting") return "/design/engagements";

  if (pathname.startsWith("/consulting/")) {
    const rest = pathname.slice("/consulting/".length);
    return "/design/engagements/" + rest + qs(pathname, query);
  }

  if (pathname === "/design-studio") return "/design";

  if (pathname.startsWith("/design-studio/")) {
    const leaf = pathname.slice("/design-studio/".length);
    return "/design/" + leaf + qs(pathname, query);
  }

  if (pathname === "/quick-design") return "/design/quick" + qs(pathname, query);

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: all new lines PASS, all pre-existing lines still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-routes.ts scripts/test-review-and-spec.ts
git commit -m "Design module: pure old→new route map with tests (D97)"
```

---

### Task 2: Move the engagement routes

**Files:**
- Move: `src/app/(app)/consulting/**` → `src/app/(app)/design/engagements/**`
- Modify: every intra-module link listed below

**Interfaces:**
- Consumes: nothing from Task 1 yet (redirect stubs land in Task 5).
- Produces: the `/design/engagements/*` route tree that Tasks 5–7 point at.

- [ ] **Step 1: Move the directory with git so history follows**

```bash
cd ~/Downloads/peak-app
mkdir -p "src/app/(app)/design"
git mv "src/app/(app)/consulting" "src/app/(app)/design/engagements"
```

- [ ] **Step 2: Rewrite intra-module links**

Every `/consulting` string inside the moved tree becomes `/design/engagements`. Verified inventory (re-run the grep in Step 3 rather than trusting this list):

| File | Lines |
|---|---|
| `design/engagements/page.tsx` | 29 |
| `design/engagements/view.tsx` | 199, 213, 304, 315, 338, 342, 345, 348, 402, 928 |
| `design/engagements/letter/page.tsx` | 105, 146, 147 |
| `design/engagements/markup/page.tsx` | 32 |
| `design/engagements/markup/viewer.tsx` | 292, 302 |
| `design/engagements/quote/actions.ts` | 112 |
| `design/engagements/quote/controls.tsx` | 370 |
| `design/engagements/spec/page.tsx` | 31 |
| `design/engagements/spec/generator.tsx` | 160, 169, 250 |
| `design/engagements/spec/[id]/page.tsx` | 24 |
| `design/engagements/spec/[id]/doc-view.tsx` | 80 |

```bash
cd ~/Downloads/peak-app
grep -rl '"/consulting\|`/consulting\|(/consulting' "src/app/(app)/design/engagements" \
  | xargs sed -i '' 's|/consulting|/design/engagements|g'
```

- [ ] **Step 3: Verify no stale references remain inside the moved tree**

```bash
cd ~/Downloads/peak-app && grep -rn "/consulting" "src/app/(app)/design/engagements" || echo "CLEAN"
```
Expected: `CLEAN`. Any hit is a link the sed missed — fix it by hand.

- [ ] **Step 4: Typecheck**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit
```
Expected: no errors *from the moved tree*. External referrers (`queue.ts`, `quotes`, `reviews`) still point at `/consulting` — those are strings, not types, so they will not error here. They are fixed in Task 7.

- [ ] **Step 5: Commit**

```bash
git add -A "src/app/(app)"
git commit -m "Design module: move consulting routes under /design/engagements (D97)"
```

---

### Task 3: Move the calculators

**Files:**
- Move: `src/app/(app)/design-studio/{steel,lineset,motors}` → `src/app/(app)/design/{steel,lineset,motors}`

**Interfaces:**
- Consumes: nothing.
- Produces: `/design/steel`, `/design/lineset`, `/design/motors`.

> `/quick-design` moves in **Task 4**, not here. Its client imports
> `../design/actions`, which only becomes `../designs/actions` once the sandbox
> list moves — moving it here would leave this task's commit failing typecheck.

- [ ] **Step 1: Move**

```bash
cd ~/Downloads/peak-app
git mv "src/app/(app)/design-studio/steel"   "src/app/(app)/design/steel"
git mv "src/app/(app)/design-studio/lineset" "src/app/(app)/design/lineset"
git mv "src/app/(app)/design-studio/motors"  "src/app/(app)/design/motors"
```

`src/app/(app)/design-studio/save-bar.tsx` is imported by the lineset builder — move it too:

```bash
git mv "src/app/(app)/design-studio/save-bar.tsx" "src/app/(app)/design/save-bar.tsx"
git mv "src/app/(app)/design-studio/export.ts"    "src/app/(app)/design/export.ts"
```

- [ ] **Step 2: Rewrite links and imports**

```bash
cd ~/Downloads/peak-app
grep -rl 'design-studio' "src/app/(app)/design" \
  | xargs sed -i '' -e 's|/design-studio/|/design/|g' \
                    -e 's|"/design-studio"|"/design"|g'
```

- [ ] **Step 3: Verify no stale tool paths remain in the moved tree**

```bash
cd ~/Downloads/peak-app && grep -rn "design-studio" "src/app/(app)/design" || echo "CLEAN"
```
Expected: `CLEAN`. (`src/app/(app)/design-studio/` itself still exists and still
references its own paths — it becomes redirect stubs in Task 5.)

- [ ] **Step 4: Typecheck**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit
```
Expected: **clean**. This task must not leave the tree failing typecheck.

- [ ] **Step 5: Commit**

```bash
git add -A "src/app/(app)"
git commit -m "Design module: move calculators under /design (D97)"
```

---

### Task 4: Move the sandbox list and quick-design, and build the Overview

**Files:**
- Move: `src/app/(app)/design/{page.tsx,design-client.tsx,actions.ts,design.css}` → `src/app/(app)/design/designs/`
- Move: `src/app/(app)/quick-design` → `src/app/(app)/design/quick`
- Create: `src/app/(app)/design/page.tsx` (the new Overview)

**Interfaces:**
- Consumes: `designRedirect` from Task 1.
- Produces: `/design` (Overview), `/design/designs` (sandbox list), `/design/quick`.

- [ ] **Step 1: Move the sandbox list into its own segment, and quick-design in beside it**

```bash
cd ~/Downloads/peak-app
mkdir -p "src/app/(app)/design/designs"
git mv "src/app/(app)/design/page.tsx"          "src/app/(app)/design/designs/page.tsx"
git mv "src/app/(app)/design/design-client.tsx" "src/app/(app)/design/designs/design-client.tsx"
git mv "src/app/(app)/design/actions.ts"        "src/app/(app)/design/designs/actions.ts"
git mv "src/app/(app)/design/design.css"        "src/app/(app)/design/designs/design.css"
git mv "src/app/(app)/quick-design"             "src/app/(app)/design/quick"
```

- [ ] **Step 1b: Retarget quick-design**

`src/app/(app)/design/quick/quick-design-client.tsx:57` imported `../design/actions`. The sandbox actions now live one segment over — set it to:

```ts
import { promoteDesignAction } from "../designs/actions";
```

`revalidatePath("/design")` in `design/quick/actions.ts` (lines 60, 87, 119) becomes `revalidatePath("/design/designs")` — those calls revalidate the sandbox list, not the Overview.

Any `/quick-design` string inside the moved tree becomes `/design/quick`:

```bash
cd ~/Downloads/peak-app
grep -rl '/quick-design' "src/app/(app)/design" \
  | xargs sed -i '' 's|/quick-design|/design/quick|g' 2>/dev/null || true
```

- [ ] **Step 2: Retarget the sandbox's own links**

In `design/designs/actions.ts`, all five `revalidatePath("/design")` calls (lines 37, 51, 62, 73, 86) become `revalidatePath("/design/designs")`.

In `design/designs/design-client.tsx`:
- line 159: `router.replace("/design/designs", { scroll: false })`
- line 281: `<Link href="/design/designs" …>`
- line 470: `` <Link href={`/design/designs?id=${encodeURIComponent(d.id)}`} …> ``

- [ ] **Step 3: Write the Overview page**

Create `src/app/(app)/design/page.tsx`. It is a server component, no `"use client"`, following the house list-page idiom (`requireUser()` first in a single `Promise.all`, `one()` helper for params, inline `CSSProperties`, `pk-content` / `pk-card`).

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { designRedirect } from "@/lib/design-routes";
import { allEngagements, ENGAGEMENT_STATUS_LABEL } from "@/lib/stores/engagements";
import { getAllDesigns as getSandboxDesigns } from "@/lib/stores/designs";
import { shortDate } from "@/lib/format";

export const metadata = { title: "Design — Peak Backend" };
export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function DesignOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);

  // Legacy deep link: /design?id=D-101 → /design/designs?id=D-101
  const hop = designRedirect("/design", { id: one(sp.id) });
  if (hop) redirect(hop);

  const [engagements, designs] = await Promise.all([
    allEngagements(),
    getSandboxDesigns(),
  ]);

  const activeEngagements = engagements
    .filter((e) => e.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const recentDesigns = designs
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  const card: React.CSSProperties = { padding: "18px 20px" };
  const head: React.CSSProperties = {
    display: "flex", alignItems: "baseline", justifyContent: "space-between",
    marginBottom: 12,
  };

  return (
    <div className="pk-content" style={{ maxWidth: 1080, padding: "26px 30px 64px" }}>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginBottom: 4 }}>
        Design
      </h1>
      <p style={{ color: "#8c919c", fontSize: 13, marginBottom: 22 }}>
        Paid engagements and budgetary designs — the same job at different stages.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 18 }}>
        <section className="pk-card" style={card}>
          <div style={head}>
            <strong style={{ fontSize: 14 }}>Active engagements</strong>
            <Link href="/design/engagements" style={{ color: "var(--accent)", fontSize: 12.5 }}>
              All engagements →
            </Link>
          </div>
          {activeEngagements.length === 0 ? (
            <p style={{ color: "#9aa0ab", fontSize: 13 }}>No active engagements.</p>
          ) : (
            activeEngagements.slice(0, 8).map((e) => (
              <Link
                key={e.id}
                href={`/design/engagements/${encodeURIComponent(e.id)}`}
                style={{ display: "block", padding: "9px 0", borderTop: "1px solid #eef0f3", textDecoration: "none", color: "inherit" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                <div style={{ fontSize: 12, color: "#8c919c" }}>
                  {e.customer} · {ENGAGEMENT_STATUS_LABEL[e.status] ?? e.status} · {shortDate(e.updatedAt)}
                </div>
              </Link>
            ))
          )}
        </section>

        <section className="pk-card" style={card}>
          <div style={head}>
            <strong style={{ fontSize: 14 }}>Recent designs</strong>
            <Link href="/design/designs" style={{ color: "var(--accent)", fontSize: 12.5 }}>
              All designs →
            </Link>
          </div>
          {recentDesigns.length === 0 ? (
            <p style={{ color: "#9aa0ab", fontSize: 13 }}>No designs yet.</p>
          ) : (
            recentDesigns.map((d) => (
              <Link
                key={d.id}
                href={`/design/designs?id=${encodeURIComponent(d.id)}`}
                style={{ display: "block", padding: "9px 0", borderTop: "1px solid #eef0f3", textDecoration: "none", color: "inherit" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: "#8c919c" }}>
                  {d.customer} · {d.venue} · {shortDate(d.updatedAt)}
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify both routes render**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A "src/app/(app)/design"
git commit -m "Design module: sandbox list to /design/designs, quick-design to /design/quick, add Overview (D97)"
```

---

### Task 5: Redirect stubs for every old path

**Files:**
- Create: one `page.tsx` per legacy route (list below)

**Interfaces:**
- Consumes: `designRedirect(pathname, query)` from Task 1.
- Produces: nothing downstream.

Template — modeled on the existing `design-studio/weights/page.tsx`. Every stub is a server component that calls `designRedirect` and then `redirect()`.

- [ ] **Step 1: Write the list-route stubs**

`src/app/(app)/consulting/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/engagements (D97). Kept for bookmarks and deep links. */
export default async function LegacyConsultingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const id = Array.isArray(sp.id) ? sp.id[0] : sp.id;
  // /consulting?id=X was already a redirect to the detail route.
  if (id) redirect("/design/engagements/" + encodeURIComponent(id));
  redirect(designRedirect("/consulting", {})!);
}
```

`src/app/(app)/consulting/[id]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

export default async function LegacyEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  redirect(designRedirect("/consulting/" + id, tab ? { tab } : {})!);
}
```

- [ ] **Step 2: Write the leaf-route stubs**

Create the same shape for each of these, passing the params each one carries:

| Stub file | Params to forward |
|---|---|
| `consulting/spec/page.tsx` | `id` |
| `consulting/spec/[id]/page.tsx` | path `id` only |
| `consulting/letter/page.tsx` | `id`, `kind` |
| `consulting/markup/page.tsx` | `eng`, `phase`, `doc` |
| `consulting/quote/page.tsx` | `id`, `customer`, `saved` |
| `design-studio/page.tsx` | none |
| `design-studio/steel/page.tsx` | none |
| `design-studio/lineset/page.tsx` | `design` |
| `design-studio/motors/page.tsx` | none |
| `quick-design/page.tsx` | none |

Example, `src/app/(app)/consulting/markup/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

export default async function LegacyMarkupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  redirect(designRedirect("/consulting/markup", {
    eng: one(sp.eng), phase: one(sp.phase), doc: one(sp.doc),
  })!);
}
```

`src/app/(app)/design-studio/weights/page.tsx` already redirects to `/design-studio/lineset`. Retarget it to `/design/lineset` directly rather than chaining two redirects.

- [ ] **Step 3: Verify every stub compiles and no stub imports a store**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit
grep -rn "stores/" "src/app/(app)/consulting" "src/app/(app)/design-studio" "src/app/(app)/quick-design" \
  || echo "CLEAN — no stub touches a store"
```

- [ ] **Step 4: Commit**

```bash
git add -A "src/app/(app)"
git commit -m "Design module: redirect stubs for every legacy path (D97)"
```

---

### Task 6: Nav data

**Files:**
- Modify: `src/components/nav/nav-data.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `design` nav group, and an `activeKeyFor` map covering every new path.

**Key-collision warning:** the child key `design` currently belongs to "Design Estimator". The new *group* also wants the key `design`. `parentGroupOf()` walks children, so a group and a child sharing a key makes the active pill ambiguous. Use group key `design` and rename the child keys: `dsoverview`→ (dropped), `design`→`designs`, `dssteel`→`steel`, `dslineset`→`lineset`, `dsmotors`→`motors`, `consulting`→`engagements`. **None of these six keys carries a badge count** (`nav-counts.ts` sets only `inbox`, `leads`, `reviews`, `projects`, `flametests`, `inspections`, `repairs`, `field`), so renaming them is safe. Verify before editing:

```bash
cd ~/Downloads/peak-app && grep -n "dsoverview\|dssteel\|dslineset\|dsmotors\|consulting\|\bdesign\b" src/lib/nav-counts.ts
```

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- design module nav (D97) --- */
import { activeKeyFor, NAV } from "@/components/nav/nav-data";

ok(activeKeyFor("/design") === "designoverview",
  "the Design overview resolves to the designoverview key");
ok(activeKeyFor("/design/engagements") === activeKeyFor("/design/steel"),
  "every /design/* path resolves to the same key (segment-1 matching)");
ok(NAV.some((e) => e.kind === "group" && e.key === "design"),
  "Design exists as a nav group");
ok(!NAV.some((e) => e.kind === "link" && e.key === "consulting"),
  "the standalone Consulting link is gone");
ok(!NAV.some((e) => e.kind === "group" && e.key === "designstudio"),
  "the Design Studio group is gone");
const designGroup = NAV.find((e) => e.kind === "group" && e.key === "design");
ok(designGroup && designGroup.kind === "group" && designGroup.children.length === 6,
  "Design has six children: Overview, Engagements, Designs, Steel, Lineset, Motors");
ok(NAV.length === 9, "the header is down to 9 top-level items");
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: the `NAV` assertions FAIL.

- [ ] **Step 3: Edit `nav-data.ts`**

Delete the `consulting` top-level link (line 21) and the whole `designstudio` group (lines 36–42). Insert a `design` group in the position the `consulting` link held:

```ts
  {
    kind: "group",
    key: "design",
    label: "Design",
    children: [
      { key: "designoverview", label: "Overview", href: "/design" },
      { key: "engagements", label: "Engagements", href: "/design/engagements" },
      { key: "designs", label: "Designs", href: "/design/designs" },
      { key: "steel", label: "Steel Calculator", href: "/design/steel" },
      { key: "lineset", label: "Lineset Builder", href: "/design/lineset" },
      { key: "motors", label: "Motor Library", href: "/design/motors" },
    ],
  },
```

In the `activeKeyFor` map, delete `"/consulting"`, `"/design-studio"`, and `"/quick-design"`, and set:

```ts
    "/design": "designoverview",
```

Because `activeKeyFor` matches only the **first path segment**, every `/design/*` route resolves to `designoverview`, whose parent group is `design` — so the Design pill lights for all six children. That is the behaviour the spec asks for; the test above asserts it deliberately rather than relying on luck.

- [ ] **Step 4: Run the test**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "Design module: one Design nav group replaces Consulting + Design Studio (D97)"
```

---

### Task 7: External referrers

**Files:**
- Modify: `src/lib/queue.ts:66,112,130`, `src/lib/nav-counts.ts:146`, `src/app/api/search/route.ts:85`, `src/app/(app)/quotes/controls.tsx:196`, `src/app/(app)/quotes/page.tsx:59`, `src/app/(app)/reviews/page.tsx:95,122`

**Interfaces:**
- Consumes: the routes created in Tasks 2–4.
- Produces: nothing.

These are the links that would otherwise silently bounce through a redirect on every use.

- [ ] **Step 1: Re-run the grep rather than trusting the list**

```bash
cd ~/Downloads/peak-app
grep -rn '"/consulting\|`/consulting\|"/design"\|`/design?\|/design-studio\|/quick-design' \
  src \
  --include=*.ts --include=*.tsx \
  | grep -v "design-routes.ts" \
  | grep -v "src/app/(app)/design/" \
  | grep -v "src/app/(app)/consulting/" \
  | grep -v "src/app/(app)/design-studio/"
```

- [ ] **Step 2: Apply the edits**

| File:line | From | To |
|---|---|---|
| `src/lib/queue.ts:66` | `` `/consulting/${a.link.id}` `` | `` `/design/engagements/${a.link.id}` `` |
| `src/lib/queue.ts:112` | `` `/consulting/${e.id}?tab=phases` `` | `` `/design/engagements/${e.id}?tab=phases` `` |
| `src/lib/queue.ts:130` | `` `/consulting/${e.id}?tab=milestones` `` | `` `/design/engagements/${e.id}?tab=milestones` `` |
| `src/lib/nav-counts.ts:146` | `href: "/design"` | `href: "/design/designs"` |
| `src/app/api/search/route.ts:85` | `` `/design?id=${…}` `` | `` `/design/designs?id=${…}` `` |
| `src/app/(app)/quotes/controls.tsx:196` | `"/consulting/quote"` | `"/design/engagements/quote"` |
| `src/app/(app)/quotes/page.tsx:59` | `` `/consulting/quote?id=${…}` `` | `` `/design/engagements/quote?id=${…}` `` |
| `src/app/(app)/reviews/page.tsx:95` | `"/consulting/quote?id="` | `"/design/engagements/quote?id="` |
| `src/app/(app)/reviews/page.tsx:122` | `"/consulting/" + … + "?tab=phases"` | `"/design/engagements/" + … + "?tab=phases"` |
| `src/app/(app)/page.tsx` (greeting card, ~line 551–629) | `href="/quick-design"` | `href="/design/quick"` |

- [ ] **Step 3: Confirm nothing outside the stubs still points at a legacy path**

```bash
cd ~/Downloads/peak-app
grep -rn "/consulting\|/design-studio\|/quick-design" src \
  --include=*.ts --include=*.tsx \
  | grep -v "src/app/(app)/consulting/" \
  | grep -v "src/app/(app)/design-studio/" \
  | grep -v "src/app/(app)/quick-design/" \
  | grep -v "design-routes.ts" \
  || echo "CLEAN"
```
Expected: `CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "Design module: repoint every external link at the new routes (D97)"
```

---

### Task 8: Make the design↔engagement link first-class

**Files:**
- Modify: `src/app/(app)/design/engagements/view.tsx` (Overview tab), `src/app/(app)/design/designs/design-client.tsx` (detail panel)
- Modify: `src/lib/stores/engagements.ts:218` (comment only)
- Modify: `src/app/(app)/design/engagements/letter/page.tsx:280` (copy only)

**Interfaces:**
- Consumes: `ConsultingEngagement.designIds: string[]` (holds `D-###` sandbox ids), `getAllDesigns()` from `src/lib/stores/designs.ts`.
- Produces: nothing.

**The reverse lookup is derived, not stored.** Per the spec: scan engagements for the design id. No back-pointer field is added, so the two sides cannot disagree.

- [ ] **Step 1: Fix the two wrong descriptions**

`src/lib/stores/engagements.ts:218` — the comment says "Design Studio saved-design links", but the code reads the `D-###` sandbox store. Replace with:

```ts
  /** Linked budgetary designs (D-### records in stores/designs). Spec-gen source. */
  designIds: string[];
```

`src/app/(app)/design/engagements/letter/page.tsx:280` — the empty state says "No Design Studio designs are linked…". Replace with `"No designs are linked to this engagement yet."`

- [ ] **Step 2: Engagement Overview lists its linked designs**

In `view.tsx`'s `OverviewTab`, render `eng.designIds` as navigable links. The engagement loader (`design/engagements/data.ts`) must pass the design records through — add `getAllDesigns()` to its `Promise.all` and expose a `designsById` map, mirroring the existing `quotesById`.

```tsx
{eng.designIds.length > 0 && (
  <section className="pk-card" style={{ padding: "16px 18px", marginBottom: 16 }}>
    <strong style={{ fontSize: 13.5, display: "block", marginBottom: 8 }}>Linked designs</strong>
    {eng.designIds.map((did) => {
      const d = data.designsById[did];
      return (
        <Link
          key={did}
          href={`/design/designs?id=${encodeURIComponent(did)}`}
          style={{ display: "block", padding: "7px 0", borderTop: "1px solid #eef0f3", textDecoration: "none", color: "inherit" }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>{d ? d.name : did}</span>
          {d && <span style={{ fontSize: 12, color: "#8c919c" }}> · {d.venue}</span>}
        </Link>
      );
    })}
  </section>
)}
```

- [ ] **Step 3: A design shows which engagement feeds it**

In `design/designs/page.tsx`, add `allEngagements()` to the `Promise.all` and derive the reverse map before passing to the client:

```ts
const engagementForDesign: Record<string, { id: string; name: string }> = {};
for (const e of engagements) {
  for (const did of e.designIds) {
    engagementForDesign[did] = { id: e.id, name: e.name };
  }
}
```

Pass `engagementForDesign` into `<DesignClient …>` and render it in the detail panel:

```tsx
{sel && engagementForDesign[sel.id] && (
  <Link href={`/design/engagements/${encodeURIComponent(engagementForDesign[sel.id].id)}`}
        style={{ color: "var(--accent)", fontSize: 12.5 }}>
    Part of {engagementForDesign[sel.id].name} →
  </Link>
)}
```

`design-client.tsx` is `"use client"` — pass `engagementForDesign` as a **plain serializable object prop**. Do not import `allEngagements` there.

- [ ] **Step 4: Typecheck and test**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit && npm run test:specs
```
Expected: clean, all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Design module: navigable design↔engagement links both ways (D97)"
```

---

### Task 9: Verify end to end

**Files:** none — this task only observes.

- [ ] **Step 1: Production build**

```bash
cd ~/Downloads/peak-app && npm run build
```
Expected: green. **A client-bundle leak fails here, not at typecheck** — if it fails with a PGlite/`node:` resolution error, a `"use client"` file is importing a store *value*; change it to `import type`.

- [ ] **Step 2: Full test script**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: every line PASS, including the pre-existing bid-spec and annotation sections.

- [ ] **Step 3: Drive the app**

Start the dev server via the preview tooling (never `npm run dev` in a shell — and confirm no other dev server holds `.data/pglite` first). Then confirm each of these returns 200 with the expected screen:

| Path | Expect |
|---|---|
| `/design` | Overview: two columns, engagements + designs |
| `/design/engagements` | the old Consulting list |
| `/design/engagements/CE-1001?tab=phases` | phases tab |
| `/design/designs` | the sandbox card grid |
| `/design/designs?id=D-101` | grid with the detail panel open |
| `/design/steel`, `/design/lineset`, `/design/motors` | the three tools |
| `/consulting` | → `/design/engagements` |
| `/consulting/CE-1001?tab=milestones` | → `/design/engagements/CE-1001?tab=milestones` |
| `/design-studio/lineset?design=DS-abc` | → `/design/lineset?design=DS-abc` |
| `/design?id=D-101` | → `/design/designs?id=D-101` |

- [ ] **Step 4: Confirm the nav pill**

On each `/design/*` path, the **Design** pill is lit and the dropdown lists all six children.

- [ ] **Step 5: Record the decision and commit**

Append a `## D97 — Design module consolidation` entry to `DECISIONS.md` covering: the `/design` Overview-vs-deep-link resolution, the `/quick-design` move, and the two-store aliasing convention.

```bash
git add DECISIONS.md
git commit -m "D97: record the Design module consolidation decisions"
```

---

## Self-review

**Spec coverage.** Structure table → Tasks 2–4, 6. Design↔engagement link → Task 8. Routes and redirects → Tasks 1, 5. `activeKeyFor()` rewrite → Task 6. External referrers → Task 7. Testing section → Tasks 1, 6, 9. "What this does not fix" (header 10→9) → asserted in Task 6 (`NAV.length === 9`).

**Gaps the spec did not cover, now tasked:** `/quick-design` (Task 3), the `/design` collision (Tasks 1, 4), the two-store name collision (Global Constraints + Task 4), the mis-documented `designIds` (Task 8), the nav key collision between the `design` group and the `design` child (Task 6).

**Type consistency.** `designRedirect(pathname, query)` is defined once in Task 1 and used with that exact signature in Tasks 4 and 5. `getSandboxDesigns` is the agreed alias for `getAllDesigns` from `stores/designs.ts` and is used consistently. `engagementForDesign` is `Record<string, {id, name}>` in both Step 3 halves of Task 8.
