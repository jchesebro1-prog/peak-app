# Quartzite-6 Rebrand — Design

- **Date:** 2026-07-25
- **Status:** Approved by Jeff (all four sections, this session)
- **Scope:** Shell-first rebrand of the app to the new Quartzite-6 (Q-6) brand:
  near-black stone/steel/gold, nav renamed to the four module chips, brand
  login. Working screens stay light; customer print documents untouched.

## Brand source

New logo package (provided by Jeff in chat, 2026-07-25; individual asset files
to follow):

- Hammered-stone **Q** with an angled tail + brushed-steel **6** on a
  near-black textured background.
- Wordmark **QUARTZITE-6** in a wide squared industrial sans; the "-6" in gold.
- Tagline: "THEATRICAL SOFTWARE. **BUILT FOR HOW YOU BUILD.**" (gold emphasis).
- Four feature chips as gold line icons in steel rounded squares:
  **EST** (calculator) · **PM** (clipboard-check) · **CRM** (people) ·
  **DESIGN** (blueprint + square).
- Q6 mark variants: stone/steel on dark, stone on white, all-silver, all-gold.

## Decisions (made with Jeff this session)

1. **Shell first.** Nav, login, favicon, buttons, accents go full Q-6. Content
   area stays light with the steel/gold palette. Full dark mode is a possible
   later phase, not this one.
2. **Nav renames to the chips.** Header tabs become EST · PM · CRM · DESIGN.
3. **EST = Quotes + Estimator + Reviews** (splits out of Sales). CRM keeps the
   relationship side.
4. **Q-6 mark = Home.** No Home tab; the logo mark at far left is the home
   button. Header reads like the lockup: Q6 · EST · PM · CRM · DESIGN.
5. **Execution = tokens + vector kit + brand font.** No photographic assets at
   UI sizes; Michroma for brand moments only.

## 1 · Palette & tokens (globals.css + settings default)

| Token | Current | New |
|---|---|---|
| `--nav-bg` (dark surfaces) | `#16181d` | `#0e0f12` near-black |
| Nav hover / active / border | `#23262d` / `#2b2e35` / `#2f323a` | deepened to match (`#1a1c21` / `#22242a` / `#26282e`) |
| `--accent` default | purple `#7b3f8a` | **Q-6 gold `#b08d4a`** |
| Accent text/links on white | `var(--accent)` | deep bronze `#8a6c34` (AA contrast) — new token `--accent-ink` |
| Primary buttons (`.pk-btn-accent`) | accent bg, white text | **gold bg, near-black text** |
| Steel ramp | ad-hoc grays | named tokens: `--steel-hi #c6c9ce`, `--steel #9aa0ab`, `--steel-border #2c2f36` |
| `--content-bg` | `#f7f8fa` | stays light, nudged cooler (stone-paper `#f6f6f8`) |
| Status green/amber/blue/red | — | unchanged |

- The per-company accent override in AppSettings **stays**; gold becomes the
  default in `lib/settings.ts`, plus a one-time update of the stored settings
  row so the running app actually shows gold (only if it still holds the old
  purple default; a deliberately customized accent would be left alone).
- Anywhere white text sits on `var(--accent)` (badges, bell count, avatar,
  mark) flips to near-black text on gold, matching the button rule.

## 2 · Typography & vector brand kit

- **Michroma** (Google font, weight 400 only) added via `next/font` — used
  ONLY for: nav wordmark "QUARTZITE-6", login title/tagline. Everything else
  stays Public Sans; mono stays IBM Plex Mono.
- **Nav tabs:** Public Sans SemiBold, uppercase, `letter-spacing: 0.08em`,
  ~11.5px (Michroma is illegibly wide at tab size).
- **New files:**
  - `src/components/brand/Q6Mark.tsx` — flat two-tone SVG Q-with-tail + 6.
    Props: `variant: "steel" | "gold" | "mono"`, `size`. Crisp at 30px.
  - `src/components/brand/chip-icons.tsx` — four gold line icons (calculator,
    clipboard-check, people, blueprint-square), ~1.6px stroke, `currentColor`
    so they theme.
  - `public/icon.svg` replaced: flat Q6 on near-black rounded square;
    `manifest.webmanifest` icons/theme-color updated to match.
- Photographic assets (when Jeff sends them) land in `public/brand/` and are
  used at full size on the login screen and future marketing surfaces only.

## 3 · Nav & information architecture (nav-data.ts, Nav.tsx)

Header: **[Q6Mark → `/`] QUARTZITE-6 · company name · BETA(gold) — EST · PM ·
CRM · DESIGN — search · sync · bell · avatar**

| Group (new key) | Label | Children |
|---|---|---|
| `est` | EST | Quotes `/quotes`, Estimator `/estimator` (new child entry), Reviews `/reviews` |
| `pm` | PM | Projects, Schedule, Field Work, Flame Tests, Rigging Inspections, Repairs |
| `crm` | CRM | Leads, Companies, People, Venues, Field Survey |
| `design` | DESIGN | Overview, Consulting, Designs, The Grid, Steel Calculator, Lineset Builder, Motor Library, Fixture Cross-Ref |

- Tab order matches the lockup: EST · PM · CRM · DESIGN.
- **No routes move.** Only group keys/labels, the `home` link removal (mark
  becomes the link), `activeKeyFor` (`/estimator` → `estimator`), and
  `parentGroupOf` fall out of the table above. Bookmarks and hrefs unchanged.
- Tabs get their 14px chip icon at left, gold on hover/active.
- Mobile/narrow nav mirrors the same four groups.
- Nav spec tests updated to the new labels/keys; `test:specs` stays green.

## 4 · Login, small furniture, rollout

**Login** (`app/login/`): the full brand moment —

- Near-black background with a subtle CSS grain/vignette (no image needed).
- Photographic Q-6 logo when assets arrive; flat `Q6Mark` stands in until then.
- "QUARTZITE-6" in Michroma; tagline "THEATRICAL SOFTWARE. BUILT FOR HOW YOU
  BUILD." with gold emphasis; company name (operating company) beneath.
- **Dark sign-in card**: `#141519` card, steel border, gold primary button,
  roster rows restyled for dark. Dev-login roster behavior unchanged.

**Small furniture** (token-driven, no per-screen work): badges/bell counts go
gold-on-black; search/sync/icon buttons deepen to the new near-black; focus
rings and links on light surfaces use `--accent-ink` bronze.

**Explicitly untouched this phase:** printable documents (letters, quotes, bid
specs — white serif letterhead), the portal beyond inheriting tokens, all
screen layouts/content, full dark mode.

**Rollout:**

1. Branch `quartzite-6-rebrand` off main.
2. Phased commits: (a) tokens + settings default, (b) brand kit
   (mark/icons/favicon/manifest), (c) nav IA rename, (d) login.
3. `npm run test:specs` + `npm run build` green (build is safe per D106; never
   build with a dev server running — PGlite is single-process).
4. Live verification in the browser, screenshots to Jeff, then merge on his OK.

## Open items

- Jeff to send individual chip images + Q6 mark on transparency (dark and gold
  variants) → `public/brand/`.
- Exact gold hex may be tuned against the real assets once they arrive
  (`#b08d4a` is sampled from the renders in chat).
