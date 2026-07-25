# Quartzite-6 Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the app shell to the approved Quartzite-6 brand — near-black + steel + gold tokens, flat vector Q6 brand kit, nav renamed to EST · PM · CRM · DESIGN with the Q6 mark as Home, and a dark brand login.

**Architecture:** Everything rides on the existing CSS-token system in `src/app/globals.css` plus `DEFAULT_SETTINGS.accent`; the nav IA change is data-only in `src/components/nav/nav-data.ts` (routes never move); new brand SVGs are self-contained React components under `src/components/brand/`.

**Tech Stack:** Next.js App Router, `next/font/google`, plain CSS tokens (no Tailwind classes for the shell), Drizzle + PGlite, `tsx` spec-test script.

**Spec:** `docs/superpowers/specs/2026-07-25-quartzite6-rebrand-design.md` (approved). Decision number for this work: **D117**.

## Global Constraints

- Branch: `quartzite-6-rebrand` (already created; the spec commit is on it).
- **Never run `npm run build` while a dev server is running** (PGlite is single-process; D106).
- Test command: `npm run test:specs` — must end `ALL PASSED`. Type check: `npx tsc --noEmit`.
- New brand hexes (verbatim from spec): near-black `#0e0f12`, gold accent `#b08d4a`, bronze ink `#8a6c34`, steel `#c6c9ce` / `#9aa0ab` / `#2c2f36`, content bg `#f6f6f8`.
- Accent surfaces carry the adaptive `--accent-contrast` text color: near-black `#16181b` when the active accent is light (gold default), `#fff` when it is dark (purple/blue overrides). White-on-gold is never acceptable. `--accent-contrast` is computed server-side from `settings.accent` luminance (helper `accentContrast(hex)` in `src/lib/color.ts`) and set beside `--accent` in `layout.tsx`.
- Michroma is used ONLY for the wordmark/login brand text — never body text.
- Routes never change; only nav group keys/labels change (`est`, `pm`, `crm`, `design`).
- Print/letter CSS (`.pk-doc-page` block in globals.css) is untouched.
- Comment style: match the repo — short, decision-referencing (e.g. `/* Q-6 rebrand (D117) */`).

---

### Task 1: Q-6 palette tokens + gold default accent

**Files:**
- Modify: `src/app/globals.css` (`:root` block, lines ~10–38, plus dark-hex values through the file)
- Modify: `src/db/seed-data.ts:40` (accent default)
- Modify: `src/app/layout.tsx:28` (viewport themeColor)
- Modify: `src/app/(app)/settings/settings-client.tsx:46` (ACCENTS picker)
- Modify: `src/app/(app)/design/engagements/letter/page.tsx:76`, `src/app/(app)/design/grid/[id]/schedule/page.tsx:39`, `src/app/(app)/design/grid/[id]/riser/page.tsx:39`, `src/app/(app)/design/quick/tierdefs-store.ts:46` (old-purple fallbacks)
- Create: `scripts/rebrand-accent.ts` (one-time stored-settings backfill)
- Test: `scripts/test-review-and-spec.ts` (new D117 section)

**Interfaces:**
- Produces: CSS tokens `--accent-ink`, `--steel-hi`, `--steel`, `--steel-border`, `--nav-chip-bg`, `--nav-chip-border`, `--font-brand` (declared here, font wired in Task 4). Tasks 2/4/5 rely on these exact names.
- Produces: `DEFAULT_SETTINGS.accent === "#b08d4a"`.

- [ ] **Step 1: Write the failing test**

At the end of `scripts/test-review-and-spec.ts` (just before the final `console.log(fail ? ...)` line), add:

```ts
/* --- Quartzite-6 rebrand (D117): gold default accent --- */
import { DEFAULT_SETTINGS } from "@/db/seed-data";
ok(DEFAULT_SETTINGS.accent === "#b08d4a", "default accent is Q-6 gold (D117)");
```

Note: the file uses top-level imports at the top; put the `import` at the top of the file with the others and the `ok()` lines at the bottom section.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/sm/Downloads/peak-app && npm run test:specs 2>&1 | tail -5`
Expected: `FAIL default accent is Q-6 gold (D117)` and exit 1.

- [ ] **Step 3: Swap the token block in globals.css**

Replace the current `:root` block (keep `--font-ui`, `--font-mono`, and the three `--pk-h*` lines exactly as they are) with:

```css
:root {
  --accent: #b08d4a; /* Q-6 gold — overridden per-request from AppSettings (D117) */
  --accent-ink: #8a6c34; /* gold legible on white — links/focus on light surfaces */
  --accent-soft: color-mix(in srgb, var(--accent) 13%, #fff);
  --nav-bg: #0e0f12; /* Q-6 near-black */
  --nav-item-bg-hover: #1a1c21;
  --nav-item-bg-active: #22242a;
  --nav-border: #26282e;
  --nav-chip-bg: #16181d; /* search/sync/icon-button plates on the nav */
  --nav-chip-border: #26282e;
  --steel-hi: #c6c9ce;
  --steel: #9aa0ab;
  --steel-border: #2c2f36;
  --content-bg: #f6f6f8; /* stone-paper */
  --ink: #16181b;
  --muted: #9aa0ab;
  --muted-2: #8c919c;
  --label: #aab0bb;
  --hairline: #e8eaee;
  --card-border: #ececf0;
  --divider: #f0f1f4;
  --row-divider: #f5f6f8;
  --hover-light: #f4f5f7;
  --hover-lighter: #f7f8fa;
  --green: #3fae74;
  --amber: #d98a2b;
  --blue: #3d8bf2;
  --red: #b4543a;
  --font-brand: var(--font-michroma), "Michroma", var(--font-ui); /* wired in layout.tsx (Task 4) */
  /* --font-ui / --font-mono / --pk-h* lines: unchanged */
}
```

- [ ] **Step 4: Retarget the hardcoded dark hexes in globals.css**

Find-and-replace within `globals.css` only (these are the nav-plate colors):

| Old value | New value | Appears in |
|---|---|---|
| `#23262d` (as `background`) | `var(--nav-chip-bg)` | `.pk-beta`, `.pk-search`, `.pk-sync`, `.pk-iconbtn` |
| `#3a3e46` (as `border` color) | `var(--nav-chip-border)` | `.pk-beta`, `.pk-kbd` |
| `#272a31` | `#1a1c21` | `.pk-search:focus-within` |
| `#4a4f59` | `#3a3f47` | `.pk-search:focus-within` border |

Then the gold-carries-dark-text rule (spec §1). In `globals.css` change **text color only** on the accent-filled elements:

- `.pk-btn-accent` → `color: var(--ink);`
- `.pk-badge` → `color: var(--ink);`
- `.pk-bell-badge` → `color: var(--ink);`
- `.pk-avatar-btn` and `.pk-menu-avatar` → `color: #fff;` **stays** (their CSS declares an accent background, but every real call site overrides it inline to the user's identity color — they are never gold surfaces at runtime, so the gold-carries-dark-text rule does not apply).
- `.pk-mark` → `color: var(--ink);` (still used by login until Task 5 swaps it out).

And accent-on-white becomes bronze: in `.pk-open-chip` change `color: var(--accent)` → `color: var(--accent-ink)`; in `.pk-input:focus` keep the accent border (border is fine at 3:1); leave `--accent-soft` usages as-is.

- [ ] **Step 5: Gold default in code + fallbacks + picker + themeColor**

- `src/db/seed-data.ts:40`: `accent: "#7b3f8a",` → `accent: "#b08d4a",`
- `src/app/layout.tsx:28`: `themeColor: "#16181d",` → `themeColor: "#0e0f12",`
- `settings-client.tsx:46`: `const ACCENTS = ["#7b3f8a", "#1f8a5b", "#3d4eb0", "#b4543a"];` → `const ACCENTS = ["#b08d4a", "#7b3f8a", "#1f8a5b", "#3d4eb0", "#b4543a"];` (gold first = default; purple stays available as an override choice)
- In `letter/page.tsx:76`, `grid/[id]/schedule/page.tsx:39`, `grid/[id]/riser/page.tsx:39`: `settings.accent || "#7b3f8a"` → `settings.accent || "#b08d4a"`
- `design/quick/tierdefs-store.ts:46`: `const ACCENT_FALLBACK = "#7b3f8a";` → `const ACCENT_FALLBACK = "#b08d4a";`

Do NOT touch `design/quick/engine.ts` or `schedule/page.tsx` PALETTE — those purples are category/roster colors, not the brand accent.

- [ ] **Step 6: Create the stored-settings backfill script**

Create `scripts/rebrand-accent.ts`:

```ts
/**
 * One-time Q-6 rebrand backfill (D117): if the stored settings row still
 * carries the OLD default purple accent explicitly, move it to the new
 * Q-6 gold default. A deliberately customized accent is left alone.
 * Run: npx tsx scripts/rebrand-accent.ts   (works against the local PGlite
 * dev DB, or against prod when DATABASE_URL is set in the environment).
 */
import { getSettingsPatch, setSettings } from "@/lib/settings";

const OLD_DEFAULT = "#7b3f8a";
const NEW_DEFAULT = "#b08d4a";

const patch = await getSettingsPatch();
const stored = typeof patch.accent === "string" ? patch.accent.toLowerCase() : undefined;
if (stored === OLD_DEFAULT) {
  await setSettings({ accent: NEW_DEFAULT });
  console.log(`accent: ${OLD_DEFAULT} (old default) -> ${NEW_DEFAULT} (Q-6 gold)`);
} else {
  console.log(`accent untouched: ${stored ?? "(unset — new default applies)"}`);
}
process.exit(0);
```

Run it once locally: `cd /Users/sm/Downloads/peak-app && npx tsx scripts/rebrand-accent.ts`
Expected: either the `->` line or `accent untouched`. (Prod run happens at deploy time — noted in Task 6.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | tail -3` → `ALL PASSED`. Then `npx tsc --noEmit` → no output.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: Q-6 palette — gold default accent, near-black nav tokens (D117)"
```

---

### Task 2: Brand kit — Q6Mark, chip icons, favicon, manifest

**Files:**
- Create: `src/components/brand/Q6Mark.tsx`
- Create: `src/components/brand/chip-icons.tsx`
- Replace: `public/icon.svg`
- Modify: `public/manifest.webmanifest` (colors only)

**Interfaces:**
- Produces: `Q6Mark({ variant?: "steel" | "gold" | "mono"; size?: number })` — height-`size`px inline SVG, width 1.5×.
- Produces: `EstIcon`, `PmIcon`, `CrmIcon`, `DesignIcon` — each `({ size?: number })`, 16-viewBox line icons drawing in `currentColor`. Task 4 maps them to nav groups.

- [ ] **Step 1: Create Q6Mark.tsx**

```tsx
/**
 * Q-6 brand mark (D117) — flat vector stand-in for the photographic logo:
 * ring-Q with the angled tail slash + geometric 6. Crisp at 30px.
 */
const PALETTES = {
  steel: { q: "#9aa0ab", six: "#c6c9ce" },
  gold: { q: "#8a6c34", six: "#b08d4a" },
  mono: { q: "currentColor", six: "currentColor" },
} as const;

export type Q6Variant = keyof typeof PALETTES;

export default function Q6Mark({
  variant = "steel",
  size = 30,
  title = "Quartzite-6",
}: {
  variant?: Q6Variant;
  size?: number;
  title?: string;
}) {
  const c = PALETTES[variant];
  return (
    <svg
      viewBox="0 0 66 44"
      width={size * 1.5}
      height={size}
      role="img"
      aria-label={title}
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="20" cy="22" r="16" fill="none" stroke={c.q} strokeWidth="7" />
      <path d="M23 25 L39 41" stroke={c.q} strokeWidth="7" fill="none" />
      <path d="M58 3 C 50 10, 45 17, 43.5 25.5" stroke={c.six} strokeWidth="7" fill="none" />
      <circle cx="50" cy="30.5" r="9.5" fill="none" stroke={c.six} strokeWidth="7" />
    </svg>
  );
}
```

- [ ] **Step 2: Create chip-icons.tsx**

```tsx
/**
 * Q-6 feature-chip line icons (D117) — EST / PM / CRM / DESIGN, drawn to
 * match the brand chips: 16-grid, 1.6 stroke, currentColor (gold on the nav).
 */
import type { SVGProps } from "react";

function Base({ children, size = 14, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** EST — calculator */
export function EstIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M5.5 4.5h5" />
      <path d="M5.7 8h.01M8 8h.01M10.3 8h.01M5.7 10.5h.01M8 10.5h.01M10.3 10.5h.01" />
    </Base>
  );
}

/** PM — clipboard-check */
export function PmIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="3" y="2.5" width="10" height="12" rx="1.5" />
      <path d="M6 2.5v-.4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v.4" />
      <path d="M5.6 7.4l1.5 1.5 3.2-3.2" />
      <path d="M5.6 11.5h4.8" />
    </Base>
  );
}

/** CRM — three people */
export function CrmIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="8" cy="5.4" r="2.1" />
      <path d="M4.6 14c0-2.1 1.5-3.6 3.4-3.6s3.4 1.5 3.4 3.6" />
      <circle cx="2.9" cy="6.8" r="1.5" />
      <path d="M1 12.9c0-1.6 1-2.7 2.4-2.7" />
      <circle cx="13.1" cy="6.8" r="1.5" />
      <path d="M15 12.9c0-1.6-1-2.7-2.4-2.7" />
    </Base>
  );
}

/** DESIGN — blueprint + set square */
export function DesignIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="1.8" y="2.5" width="9" height="11" rx="1" />
      <path d="M4 5.5h4.5M4 8h2.5" />
      <path d="M9 13.8 L14.5 8.3 L14.5 13.8 Z" />
    </Base>
  );
}
```

- [ ] **Step 3: Replace public/icon.svg**

Overwrite the whole file (it currently embeds the Peak PNG on a white tile — the Q6 software mark replaces it per the approved spec):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Q-6 app icon (D117): flat brand mark on near-black. -->
  <rect width="512" height="512" rx="112" fill="#0e0f12"/>
  <g transform="translate(58,124) scale(6)" fill="none">
    <circle cx="20" cy="22" r="16" stroke="#9aa0ab" stroke-width="7"/>
    <path d="M23 25 L39 41" stroke="#9aa0ab" stroke-width="7"/>
    <path d="M58 3 C 50 10, 45 17, 43.5 26" stroke="#b08d4a" stroke-width="7"/>
    <circle cx="50" cy="31" r="9.5" stroke="#b08d4a" stroke-width="7"/>
  </g>
</svg>
```

- [ ] **Step 4: Update manifest colors**

In `public/manifest.webmanifest`: `"background_color": "#16181d"` → `"#0e0f12"` and `"theme_color": "#16181d"` → `"#0e0f12"`. Nothing else changes.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → clean. Then `npm run test:specs 2>&1 | tail -3` → `ALL PASSED` (nothing imports the new components yet — this is the compile gate).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Q-6 brand kit — vector mark, chip icons, app icon, manifest (D117)"
```

---

### Task 3: Nav IA — EST · PM · CRM · DESIGN (data + tests)

**Files:**
- Modify: `scripts/test-review-and-spec.ts` (D98/D99/D100 nav assertions → new shape; new D117 section)
- Modify: `src/components/nav/nav-data.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NAV` with top-level keys exactly `est,pm,crm,design` (all groups, no links); child keys unchanged plus new `estimator` child; `activeKeyFor("/estimator") === "estimator"`, `activeKeyFor("/") === "home"` (kept for the drawer Home link); `parentGroupOf` reflects the new groups. Task 4 renders from this.

- [ ] **Step 1: Update the spec tests to the new truth (failing first)**

In `scripts/test-review-and-spec.ts`:

1. **D98 block (~line 206):** keep `NAV.length === 4` but reword the message: `"the header keeps 4 top-level items (chips, D117)"`. Keep the queue/calendar/inbox absence checks. **Add** after them:
   ```ts
   ok(!NAV.some((e) => e.kind === "link" && e.key === "home"), "Home is no longer a tab — the Q6 mark is the home link (D117)");
   ```
2. **D99 sales block (~line 217):** the group finder `key === "sales"` → `key === "crm"`, and its expected children become `"leads,companies,people,venues,field"` (quotes + reviews moved to EST). Update the assertion messages to say CRM.
3. **Order assertion (~line 276):** `"home,design,sales,operations"` → `"est,pm,crm,design"`, message `"the four top-level chips are EST, PM, CRM, DESIGN in order (D117)"`.
4. **D100 block (~line 288):** finder `key === "operations"` → `key === "pm"`; the six children and their order are unchanged; `parentGroupOf(...) === "operations"` (six checks) → `"pm"`. Update messages to say PM.
5. **New D117 section** (bottom, after the Task 1 accent check):
   ```ts
   /* --- Quartzite-6 rebrand (D117): nav chips --- */
   const d117Est = NAV.find((e) => e.kind === "group" && e.key === "est");
   ok(
     !!(d117Est && d117Est.kind === "group" &&
       d117Est.children.map((c) => c.key).join(",") === "quotes,estimator,reviews"),
     "EST = Quotes, Estimator, Reviews in order",
   );
   ok(activeKeyFor("/estimator") === "estimator", "/estimator lights its own EST child");
   ok(activeKeyFor("/") === "home", "root still resolves to home (drawer link + mark)");
   ok(
     parentGroupOf("quotes") === "est" && parentGroupOf("estimator") === "est" && parentGroupOf("reviews") === "est",
     "quotes, estimator, reviews report EST as parent",
   );
   ok(
     parentGroupOf("leads") === "crm" && parentGroupOf("venues") === "crm" && parentGroupOf("field") === "crm",
     "relationship children report CRM as parent",
   );
   ok(NAV.every((e) => e.kind === "group"), "every top-level entry is a group — the mark handles Home");
   ```

- [ ] **Step 2: Run tests to verify the nav assertions fail**

Run: `npm run test:specs 2>&1 | grep -c FAIL`
Expected: several FAILs (old NAV shape), exit 1.

- [ ] **Step 3: Rewrite NAV in nav-data.ts**

Replace the `NAV` array with (comments included — repo style):

```ts
export const NAV: NavEntry[] = [
  /* Q-6 rebrand (D117): the header reads like the brand lockup —
   * [Q6 mark = Home] EST · PM · CRM · DESIGN. Home left the tab row (the
   * mark is the link); Quotes/Estimator/Reviews split out of Sales into
   * EST; the rest of Sales became CRM; Operations became PM. Routes are
   * untouched — only group keys/labels moved. */
  {
    kind: "group",
    key: "est",
    label: "EST",
    children: [
      { key: "quotes", label: "Quotes", href: "/quotes" },
      { key: "estimator", label: "Estimator", href: "/estimator" },
      { key: "reviews", label: "Reviews", href: "/reviews" },
    ],
  },
  {
    kind: "group",
    key: "pm",
    label: "PM",
    children: [
      { key: "projects", label: "Projects", href: "/projects" },
      { key: "schedule", label: "Schedule", href: "/schedule" },
      { key: "fieldwork", label: "Field Work", href: "/field-work" },
      { key: "flametests", label: "Flame Tests", href: "/flame-tests" },
      { key: "inspections", label: "Rigging Inspections", href: "/inspections" },
      { key: "repairs", label: "Repairs", href: "/repairs" },
    ],
  },
  {
    kind: "group",
    key: "crm",
    label: "CRM",
    children: [
      { key: "leads", label: "Leads", href: "/leads" },
      { key: "companies", label: "Companies", href: "/companies" },
      { key: "people", label: "People", href: "/people" },
      { key: "venues", label: "Venues", href: "/venues" },
      { key: "field", label: "Field Survey", href: "/field-survey" },
    ],
  },
  {
    kind: "group",
    key: "design",
    label: "DESIGN",
    children: [
      { key: "designoverview", label: "Overview", href: "/design" },
      { key: "engagements", label: "Consulting", href: "/design/engagements" },
      { key: "designs", label: "Designs", href: "/design/designs" },
      { key: "grid", label: "The Grid", href: "/design/grid" },
      { key: "steel", label: "Steel Calculator", href: "/design/steel" },
      { key: "lineset", label: "Lineset Builder", href: "/design/lineset" },
      { key: "motors", label: "Motor Library", href: "/design/motors" },
      { key: "fixtures", label: "Fixture Cross-Ref", href: "/design/fixtures" },
    ],
  },
];
```

Keep the existing D97/D98 explanatory comments above the array if they still read true; fold their content into the D117 comment where they don't.

In `activeKeyFor`, change one mapping: `"/estimator": "quotes"` → `"/estimator": "estimator"`. Everything else (including `if (pathname === "/") return "home"`) stays.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | tail -3` → `ALL PASSED`.
Also: `npm run test:specs 2>&1 | grep D117` → the new lines all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: nav IA — EST/PM/CRM/DESIGN chip groups, Estimator gets a nav entry (D117)"
```

---

### Task 4: Nav header — Q6 mark as Home, wordmark, chip-icon tabs

**Files:**
- Modify: `src/app/layout.tsx` (add Michroma font)
- Modify: `src/components/nav/Nav.tsx` (brand block ~lines 181–194, tab render ~196–241, hamburger/drawer hexes, drawer nav list)
- Modify: `src/app/globals.css` (`.pk-tab` sizing, new `.pk-wordmark` family of classes, tab icon color rule)

**Interfaces:**
- Consumes: `Q6Mark` from `@/components/brand/Q6Mark`; `EstIcon`/`PmIcon`/`CrmIcon`/`DesignIcon` from `@/components/brand/chip-icons`; NAV shape from Task 3.
- Produces: `--font-michroma` CSS variable on `<body>` (login in Task 5 relies on it and on `.pk-wordmark`).

- [ ] **Step 1: Wire Michroma in layout.tsx**

Add to the imports: `Michroma` from `next/font/google`; then beside the other two fonts:

```tsx
const michroma = Michroma({
  variable: "--font-michroma",
  subsets: ["latin"],
  weight: "400",
});
```

and add it to the body className: `` className={`${publicSans.variable} ${plexMono.variable} ${michroma.variable}`} ``.

- [ ] **Step 2: Brand-block CSS in globals.css**

Add after the `.pk-company` rule (keep `.pk-company` itself — the drawer/menus still use its pattern; the header stops using it):

```css
/* Q-6 header brand block (D117) */
.pk-home {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border-radius: 7px;
}
.pk-home:hover { opacity: 0.85; }
.pk-wordblock { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.pk-wordmark {
  font-family: var(--font-brand);
  font-size: 11.5px;
  letter-spacing: 0.14em;
  color: #e7e9ee;
  white-space: nowrap;
}
.pk-wordmark .six { color: var(--accent); }
.pk-operator {
  font-size: 9.5px;
  font-weight: 500;
  color: var(--steel);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

And restyle the tabs for the chip look — modify the existing `.pk-tab` rule: `font-size: 13px` → `font-size: 11.5px`, add `text-transform: uppercase; letter-spacing: 0.08em;`, change `font-weight: 500` → `600`. Then add:

```css
.pk-tab .pk-tab-ic { color: var(--steel); display: flex; }
.pk-tab:hover .pk-tab-ic,
.pk-tab.active .pk-tab-ic { color: var(--accent); }
```

- [ ] **Step 3: Rework the Nav.tsx brand block**

Imports at top of `Nav.tsx`:

```tsx
import Q6Mark from "@/components/brand/Q6Mark";
import { EstIcon, PmIcon, CrmIcon, DesignIcon } from "@/components/brand/chip-icons";
```

Add near `markLetter` (then delete the `markLetter` line — it becomes unused):

```tsx
const GROUP_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  est: EstIcon,
  pm: PmIcon,
  crm: CrmIcon,
  design: DesignIcon,
};
```

Replace the brand `<div>` (the one holding `logoLight ? <img> : .pk-mark`, `.pk-company`, `.pk-beta`) with:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
  <Link href="/" className="pk-home" aria-label="Home">
    <Q6Mark size={26} variant="steel" />
  </Link>
  {logoLight ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoLight}
      alt={companyName}
      style={{ height: 26, maxWidth: 140, objectFit: "contain", display: "block" }}
    />
  ) : (
    <div className="pk-wordblock">
      <div className="pk-wordmark">
        QUARTZITE<span className="six">-6</span>
      </div>
      <div className="pk-operator">{companyName}</div>
    </div>
  )}
  <span className="pk-beta">BETA</span>
</div>
```

- [ ] **Step 4: Chip icons on the tabs**

In the desktop tab render, both branches get the icon. Link branch:

```tsx
<Link key={entry.key} href={entry.href} className={`pk-tab${activeKey === entry.key ? " active" : ""}`}>
  {entry.label}
</Link>
```
(unchanged — after Task 3 there are no link entries, but the branch stays for type completeness). Group-button branch — add the icon span before the label:

```tsx
{(() => { const Ic = GROUP_ICONS[entry.key]; return Ic ? <span className="pk-tab-ic"><Ic size={14} /></span> : null; })()}
{entry.label}
```

- [ ] **Step 5: Drawer — Home link + new plate colors**

In the narrow drawer `<nav>` (before the `NAV.map(...)`), add an explicit Home entry (NAV no longer carries one):

```tsx
<DrawerLink href="/" label="Home" active={activeKey === "home"} child={false} badge={0} />
```

Update the drawer/hamburger inline hexes in Nav.tsx to the new plates: `background: "#23262d"` → `"var(--nav-chip-bg)"`, `border: "1px solid #2f323a"` → `"1px solid var(--nav-border)"` (hamburger button, close button), drawer panel `background: "#16181d"` → `"#111318"`, drawer header `borderBottom: "1px solid #23262d"` → `"1px solid #22242a"`.

- [ ] **Step 6: Verify + live check**

Run: `npx tsc --noEmit` → clean; `npm run test:specs 2>&1 | tail -3` → `ALL PASSED`.
Start dev (`npm run dev`), open http://localhost:3000 — header shows [Q6 mark] QUARTZITE-6 wordmark, gold BETA, EST·PM·CRM·DESIGN tabs with gold icons on hover/active; mark click lands Home; narrow viewport drawer shows Home + four groups. **Stop the dev server when done.**

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Q-6 header — mark-as-Home, Michroma wordmark, chip-icon tabs (D117)"
```

---

### Task 5: Login — the brand moment

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/login-buttons.tsx`
- Modify: `src/app/globals.css` (login block, ~lines 657–695)

**Interfaces:**
- Consumes: `Q6Mark`, `.pk-wordmark` CSS, `--font-brand`, tokens from Task 1.
- Produces: nothing downstream.

- [ ] **Step 1: Restyle the login CSS**

Replace the `.pk-login`, `.pk-login-card`, `.pk-google-btn` rules with:

```css
/* Q-6 login (D117) — the brand moment: near-black, grain, dark card. */
.pk-login {
  min-height: 100vh;
  min-height: 100dvh;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),
    radial-gradient(1100px 640px at 50% 18%, #17181d 0%, #0e0f12 55%, #0a0b0d 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.pk-login-card {
  background: #141519;
  border: 1px solid var(--steel-border);
  border-radius: 14px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  width: 380px;
  max-width: 94vw;
  padding: 28px 26px 24px;
  color: #e7e9ee;
}
.pk-login-tagline {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--steel);
  text-align: center;
}
.pk-login-tagline .gold { color: var(--accent); }
.pk-google-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  font-size: 13.5px;
  font-weight: 600;
  color: #e7e9ee;
  background: #1a1c21;
  border: 1px solid var(--steel-border);
  border-radius: 9px;
  padding: 11px 14px;
  cursor: pointer;
  font-family: var(--font-ui);
}
.pk-google-btn:hover { border-color: #3a3f47; background: #1e2026; }
```

- [ ] **Step 2: Rework page.tsx brand header**

In `src/app/login/page.tsx`, add `import Q6Mark from "@/components/brand/Q6Mark";`, delete the `markLetter` line, and replace the brand `<div>` (mark + name + BETA) with:

```tsx
<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 20 }}>
  <Q6Mark size={54} variant="gold" />
  <div className="pk-wordmark" style={{ fontSize: 19, letterSpacing: "0.18em" }}>
    QUARTZITE<span className="six">-6</span>
  </div>
  <div className="pk-login-tagline">
    Theatrical software. <span className="gold">Built for how you build.</span>
  </div>
  <div style={{ color: "var(--steel)", fontSize: 10.5, fontWeight: 500 }}>
    {settings.companyName}
  </div>
</div>
```

(The photographic logo swaps in for `Q6Mark` later, when the asset files land in `public/brand/` — out of scope here.)

Inside the card, flip the two light-hardcoded text colors: the "Sign in" heading keeps its inherited light color; the sub line `color: "#9aa0ab"` is fine (steel). Check for inline `background`/light borders inside the card markup and align them to the dark card (any `#fff`/`#ececf0` inline values → `#1a1c21` / `var(--steel-border)`).

- [ ] **Step 3: Dark-card variants in login-buttons.tsx**

- The `!google && !devLogin` info box: `color: "#9aa0ab"` stays, `background: "#f7f8fa"` → `"#1a1c21"`, `border: "1px solid #ececf0"` → `"1px solid #2c2f36"`.
- Dev-login roster rows: any light `background`/`border`/text hexes (`#fff`, `#f4f5f7`, `#ececf0`, `#3a3f4a`) get dark equivalents — row text `#e7e9ee`, hover background `#1a1c21`, dividers `#22242a`. Read the file and apply consistently to every roster row style.
- The Google logo SVG keeps its colors (recognizability).

- [ ] **Step 4: Verify + live check**

`npx tsc --noEmit` → clean. Start dev, open http://localhost:3000/login (sign out or private window if needed): near-black grain background, gold Q6 mark, Michroma wordmark, tagline with gold half, dark card, legible buttons/roster. **Stop the dev server.**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Q-6 login — dark brand panel, wordmark, tagline (D117)"
```

---

### Task 6: Full verification, decision record, status docs

**Files:**
- Modify: `DECISIONS.md` (new D117 entry at the top, matching the file's existing entry format)
- Modify: `README.md` (status line mentioning the rebrand, matching its existing style)

**Interfaces:** none — closeout.

- [ ] **Step 1: Full test + build gate**

With NO dev server running:

```bash
cd /Users/sm/Downloads/peak-app && npm run test:specs 2>&1 | tail -3 && npm run build 2>&1 | tail -15
```

Expected: `ALL PASSED` and a green `next build` (route table prints, exit 0).

- [ ] **Step 2: Live sweep**

Start dev; check, at desktop and at a narrow (~390px) viewport:
1. `/` — header brand block, four chip tabs, dropdowns open with badges legible (gold badge, near-black count text).
2. `/quotes` and `/estimator` — EST tab lights; `/leads` — CRM lights; `/projects` — PM lights; `/design` — DESIGN lights.
3. `/login` — brand panel.
4. `/settings` — accent picker shows gold first and selected (after the Task 1 backfill).
5. A letter/print preview (`/design/engagements` → any letter) — confirm the white letterhead is untouched.
Take screenshots of 1 and 3 for Jeff. **Stop the dev server.**

- [ ] **Step 3: Write the D117 decision entry**

Prepend to `DECISIONS.md` (follow the file's existing entry format exactly — read the top entry first):
D117 — Quartzite-6 rebrand (2026-07-25): gold default accent `#b08d4a` (override setting kept), near-black `#0e0f12` shell, nav renamed to EST·PM·CRM·DESIGN with Q6-mark-as-Home, Estimator got its own nav entry, flat vector brand kit + new app icon, dark brand login, Michroma for brand text only, print documents untouched. Spec: `docs/superpowers/specs/2026-07-25-quartzite6-rebrand-design.md`. Deploy note: run `npx tsx scripts/rebrand-accent.ts` against prod (DATABASE_URL) once at deploy.

- [ ] **Step 4: Update README status + commit**

Add/adjust the README's status section the way past features did (one short line). Then:

```bash
git add -A && git commit -m "docs: D117 decision entry + status — Quartzite-6 rebrand complete"
```

---

## Self-Review Notes (run after drafting — resolved inline)

- Spec coverage: §1 tokens→Task 1; §2 type/kit→Tasks 2+4 (Michroma wired where first consumed); §3 nav→Tasks 3+4; §4 login/furniture/rollout→Tasks 5+6, backfill→Task 1, prod-backfill note→Task 6 D117 entry. Print untouched→verified in Task 6 sweep.
- Placeholders: none — all code inline. One deliberate open aesthetic: Q6Mark geometry may get eyeball-tuned during Task 4/5 live checks; the checkpoints are the gate.
- Type consistency: `Q6Mark({variant,size,title})` and `*Icon({size})` signatures match between Task 2 (producer) and Tasks 4/5 (consumers); token names `--accent-ink`/`--steel*`/`--nav-chip-*`/`--font-brand` declared in Task 1 and consumed in Tasks 4/5.
