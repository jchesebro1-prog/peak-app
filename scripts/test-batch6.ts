/* Jeff's 2026-10-15 decisions — Batch 6 harness checks (docs/decisions/2026-10-15-jeff-decisions.md
   Round 2 items 64–68, plus the addFieldTask overwrite fix).
   `batch6PureChecks` needs no database; `batch6DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-batch6.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./ok-type";
import { sourcingReport, sourcingCsv, sortForNoCost, type SourcingPart } from "../src/lib/sourcing-report";
import { iconSource, iconVersion, parseIconFile, iconHref, manifestIcons, iconCacheControl, ICON_LIGHT_BG, ICON_DARK_BG } from "../src/lib/app-icon";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* --- Bug fix: addFieldTask could overwrite any task by id --- */
function fieldTaskPureChecks(ok: Ok) {
  const me = { id: "u1" };
  const mine = { projectId: "P-1", section: "Install", assigneeUserId: "u1" };
}

async function fieldTaskDbChecks(ok: Ok) {
  const { registerFixture } = await import("./test-fixtures");
  const me = { id: "u-b6", name: "Batch Six" };
  const other = { id: "u-b6b", name: "Other Person" };

  const id = "tk-b6x" + Math.random().toString(36).slice(2, 6);
  registerFixture("tasks", id);
}

/* --- #66 most-quoted products / projected sourcing --- */
function sourcingChecks(ok: Ok) {
  const parts = new Map<string, SourcingPart>([
    ["ETC:S4", { sku: "ETC:S4", mfr: "ETC", desc: "Source Four", cost: 200, manufacturerModelNumber: "Source Four 750" }],
    ["ETC:LAMP", { sku: "ETC:LAMP", mfr: "ETC", desc: "Lamp", cost: 20 }],
    ["Shure:SM58", { sku: "Shure:SM58", mfr: "Shure", desc: "Mic", cost: 100 }],
    ["doc-id-58", { sku: "Shure:SM58", mfr: "Shure", desc: "Mic", cost: 100 }],
    ["RACK-PANEL", { sku: "RACK-PANEL", mfr: "Middle Atlantic", desc: "Panel", cost: 30 }],
  ]);
  const sec = (items: unknown[], extra: Record<string, unknown> = {}) => ({ id: "s", name: "S", items, ...extra });
  const q = (id: string, status: string, spec: unknown) => ({ id, status, spec, updatedAt: Date.now() });
  const quotes = [
    q("Q1", "sent", { sections: [sec([
      { sku: "ETC:S4", qty: 4, cost: 180, price: 300 },
      { sku: "BONUS", qty: 1, cost: 50, bonus: "package" },
      { sku: "ETC:S4", qty: 9, cost: 180, option: true },
      { sku: "LAB", qty: 8, cost: 50, labor: true },
      { sku: "ASM-1", qty: 2, fixture: true, components: [{ sku: "ETC:S4", qty: 1, cost: 150, role: "fixture" }, { sku: "ETC:LAMP", qty: 2, cost: 15 }] },
    ]), sec([{ sku: "Shure:SM58", qty: 50, cost: 100 }], { alternate: true }), sec([{ sku: "ETC:S4", qty: 99, cost: 1 }], { kind: "labor" })] }),
    q("Q2", "draft", { lines: [{ sku: "doc-id-58", qty: 3 }, { sku: "allow:x", qty: 1 }, { sku: "asm:R1", qty: 1 }] }),
    q("Q3", "won", { sections: [sec([{ sku: "ETC:S4", qty: 100, cost: 180 }])] }),
    q("Q4", "lost", { sections: [sec([{ sku: "Shure:SM58", qty: 100, cost: 100 }])] }),
    q("Q5", "draft", { sections: [sec([{ sku: "CUSTOM", qty: 1, cost: 10 }])] }),
  ];
  const fixtureOf = (id: string) => (id === "R1" ? ({ id: "R1", kind: "system", label: "R", lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [{ sku: "RACK-PANEL", qty: 2 }] } as never) : null);
  const rates: Record<string, number> = { etc: 0.5, shure: 0.25 };
  const rep = sourcingReport(quotes, parts, { rateFor: (k) => rates[k] ?? 0.1, fixtureOf });
  const s4 = rep.parts.find((r) => r.sku === "ETC:S4");
  ok(!!s4 && s4.qty === 6 && s4.estimates === 1, "#66: Source Four counts its own line (4) + the assembly's member (2 × 1); options, bonus, labor and won/lost quotes are left out");
  ok(!!s4 && s4.weightedQty === 3 && s4.weightedCost === (4 * 180 + 2 * 150) * 0.5, "#66: weighted qty / cost = qty / cost × the manufacturer's win rate (a member at its component's quoted cost)");
  ok(s4?.model === "Source Four 750", "#66: the part column is the Model # (#304 partModel)");
  const lamp = rep.parts.find((r) => r.sku === "ETC:LAMP");
  ok(!!lamp && lamp.qty === 4 && lamp.weightedCost === 4 * 15 * 0.5, "#66: an assembly's members count (qty × line qty)");
  const mic = rep.parts.find((r) => r.sku === "Shure:SM58");
  ok(!!mic && mic.qty === 3 && mic.estimates === 1 && mic.weightedCost === 3 * 100 * 0.25, "#66: an Alternate group is left out; a Grid line by document id counts once under its real sku at catalog cost");
  const panel = rep.parts.find((r) => r.sku === "RACK-PANEL");
  ok(rep.parts.every((r) => r.sku !== "CUSTOM" && r.sku !== "ASM-1" && r.sku !== "BONUS"), "#66: only catalog parts are listed (no custom, no assembly id, no bonus line)");
  ok(rep.openEstimates === 2, "#66: open estimates = draft + sent quotes with a counted part");
  const etc = rep.manufacturers.find((m) => m.mfrKey === "etc");
  ok(!!etc && etc.parts === 2 && etc.qty === 10 && etc.estimates === 1, "#66: the manufacturer table sums its parts");
  ok(rep.manufacturers[0].weightedCost >= rep.manufacturers[rep.manufacturers.length - 1].weightedCost, "#66: rows sort by weighted cost");
  ok(!!panel && panel.qty === 2 && panel.weightedCost === 2 * 30 * 0.1, "#66: a Grid asm: line expands into its live members at catalog cost (shop rate when the maker has none)");
  const csv = sourcingCsv([{ ...s4!, model: "=HYPERLINK(1)", desc: "+cmd", manufacturer: "@x" }], true);
  ok(csv.includes("'=HYPERLINK(1)") && csv.includes("'+cmd") && csv.includes("'@x") && csv.startsWith("﻿Model #"), "#66: CSV cells starting = + - @ get a leading '");
  const noCost = sourcingCsv([s4!], false);
  ok(!noCost.includes("Weighted cost") && !noCost.includes(String((4 * 180 + 2 * 150) * 0.5)), "#66: the CSV leaves cost out for a viewer without approve");
  const sorted = sortForNoCost([{ weightedQty: 1, qty: 1, n: "b" }, { weightedQty: 5, qty: 5, n: "a" }], (x) => x.n);
  ok(sorted[0].n === "a", "#66: without cost the rows sort by weighted qty");
  const page = src("src/app/(app)/reports/sourcing/page.tsx");
  const route = src("src/app/(app)/reports/sourcing/export/route.ts");
  ok(/const showCost = can\("approve", me\.roles\)/.test(page) && /\{showCost && <th/.test(page) && /const withCost = can\("approve", me\.roles\)/.test(route),
    "#66: cost shows only to approve holders (the Reports margin-widget gate), page and CSV alike");
  ok(src("src/app/(app)/reports/page.tsx").includes('href="/reports/sourcing"'), "#66: Reports links to the table");
}

/* --- #67 app icon from the Branding logo --- */
async function appIconChecks(ok: Ok) {
  const sharp = (await import("sharp")).default;
  const { renderAppIcon, BUILTIN_ICON_SVG } = await import("../src/lib/app-icon-render");
  const red = await sharp({ create: { width: 40, height: 20, channels: 4, background: "#ff0000" } }).png().toBuffer();
  const logo = `data:image/png;base64,${red.toString("base64")}`;
  ok(iconSource({}) === null && iconVersion({}) === "default", "#67: no logo → the built-in mark, version 'default'");
  ok(iconSource({ logoDark: logo, logoLight: logo })?.background === ICON_LIGHT_BG, "#67: the document (dark-on-white) logo is padded on white");
  ok(iconSource({ logoLight: logo })?.background === ICON_DARK_BG, "#67: only the nav logo → padded on the nav's near-black");
  ok(iconSource({ logoDark: "javascript:alert(1)" }) === null && iconSource({ logoDark: "data:text/html;base64,PGI+" }) === null, "#67: only a PNG/JPEG/SVG/WebP data URL is drawn");
  const v1 = iconVersion({ logoDark: logo });
  ok(/^[0-9a-f]{12}$/.test(v1) && v1 !== iconVersion({ logoLight: logo }) && v1 === iconVersion({ logoDark: logo }), "#67: the version changes with the logo and its background, and is stable");
  ok(JSON.stringify(parseIconFile("512-maskable.png")) === '{"size":512,"maskable":true}' && parseIconFile("180.png")?.size === 180 &&
     parseIconFile("64.png") === null && parseIconFile("../x.png") === null && parseIconFile("512.svg") === null, "#67: only the served sizes parse (32/180/192/512, -maskable)");
  ok(iconHref(192, "abc") === "/icons/app/192.png?v=abc", "#67: icon hrefs carry the version");
  const icons = manifestIcons("abc");
  ok(icons.length === 3 && icons.some((i) => i.sizes === "192x192") && icons.some((i) => i.purpose === "maskable" && i.src.includes("512-maskable")), "#67: the manifest lists 192, 512 and a maskable 512");
  ok(iconCacheControl("abc", "abc").includes("immutable") && !iconCacheControl("old", "abc").includes("immutable") && !iconCacheControl(null, "abc").includes("immutable"),
    "#67: only the current version is cached immutably (a new logo busts the cache)");
  const m = await sharp(await renderAppIcon(iconSource({ logoDark: logo }), v1, 192, false)).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => Array.from(m.data.subarray((y * m.info.width + x) * m.info.channels, (y * m.info.width + x) * m.info.channels + 3)).join(",");
  ok(m.info.width === 192 && m.info.height === 192 && px(2, 2) === "255,255,255" && px(96, 96) === "255,0,0", "#67: the logo is fitted centred on a padded white square");
  const builtin = await sharp(await renderAppIcon(null, "default", 32, false)).metadata();
  ok(builtin.width === 32 && builtin.height === 32 && builtin.format === "png", "#67: with no logo the built-in mark renders as a PNG");
  const junk = await sharp(await renderAppIcon({ dataUrl: "data:image/png;base64,AAAA", background: "#fff" }, "junk", 180, true)).metadata();
  ok(junk.width === 180 && junk.format === "png", "#67: an unreadable logo falls back to the built-in mark");
  ok(BUILTIN_ICON_SVG === src("public/icon.svg"), "#67: the inline built-in mark equals public/icon.svg");
  const layout = src("src/app/layout.tsx");
  ok(/export async function generateMetadata/.test(layout) && layout.includes("apple: [{ url: iconHref(180, v)") && !layout.includes('icon: "/icon.svg"'), "#67: the root layout links the versioned favicon and apple-touch-icon");
  ok(src("src/app/manifest.ts").includes("icons: manifestIcons(version)") && src("src/app/manifest.ts").includes('dynamic = "force-dynamic"'), "#67: the manifest is generated per request from the logo");
  ok(/\|icons\|/.test(src("src/middleware.ts")), "#67: /icons/* stays outside the session gate (login page, home-screen install)");
}

/* --- #65 Download today's jobs --- */
function todayJobsChecks(ok: Ok) {
  const day = "2026-10-16";
  const start = Date.UTC(2026, 9, 16, 5); // 00:00 Chicago (CDT)
  const end = Date.UTC(2026, 9, 17, 5) - 1;
  const dayKeyOf = (ms: number) => (ms >= start && ms <= end ? day : ms < start ? "2026-10-15" : "2026-10-17");
  const me = { id: "u7", name: "Nic Trapani" };
  const svc = (id: string, extra: Record<string, unknown> = {}) => ({ id, stage: "scheduled", assignedTo: "Nic Trapani", scheduledDate: day, customer: "Lincoln HS", venue: "Aud", ...extra });
  const mirrored = new Set(["surveys:FS-9", "inspections:IN-1", "repair_jobs:RP-1", "assessments:AS-1001"]);
  const sw = src("public/sw.js");
  ok(sw.includes("const port = event.ports && event.ports[0]") && sw.includes(".then(() => reply(true))") && sw.includes(".catch(() => reply(false))"), "#65: the service worker answers a CACHE_ROUTE that carries a port");
  ok(/async pull\(opts: \{ force\?: boolean \} = \{\}\): Promise<boolean>/.test(src("src/lib/sync/engine.ts")) && src("src/lib/sync/engine.ts").includes("this.pullForbidden) return false"),
    "#65: a forced pull still honours a 403 (pullForbidden) and reports success");
}

/* --- #64 Attach in the Inbox composer --- */
async function attachPureChecks(ok: Ok) {
  const key = "UP-0123456789abcdef";

  const read = async () => Buffer.from("hello");
  let threw = false;
  try {
  } catch {
    threw = true;
  }
  const raw = Buffer.from("From: a\r\n\r\nhi").toString("base64url");
}

async function attachDbChecks(ok: Ok) {
  const key = "UP-00000000000000aa";
  const mine = `mail-attachments/u1/${key}/plan-x1.pdf`;
  const heads = new Map<string, { bytes: Uint8Array; size: number }>([
    [mine, { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), size: 1000 }],
    [`mail-attachments/u1/${key}/tool-x1.pdf`, { bytes: new Uint8Array([0x4d, 0x5a, 0, 0]), size: 50 }],
    [`mail-attachments/u1/${key}/huge-x1.pdf`, { bytes: new Uint8Array([1, 2, 3]), size: 26 * 1024 * 1024 }],
  ]);
  const removed: string[] = [];
  const deps = {
    head: async (p: string) => heads.get(p) ?? null,
    remove: async (p: string) => { removed.push(p); },
    document: async (id: string) => (id === "DOC-2001" ? { id, fileName: "Spec.pdf", mime: "application/pdf", size: 5000, customerId: "c1", projectId: null, blobPath: "documents/c1/x" } : id === "DOC-2002" ? { id, fileName: "Other.pdf", mime: "application/pdf", size: 10, customerId: "c9", projectId: null, blobPath: "documents/c9/y" } : null),
  };

  const stored = [{ name: "EST-1001.pdf", mime: "application/pdf", size: 2000, pdfPath: "quote-pdfs/Q-1/rev-1.pdf", href: "/x" }];

  const T = { id: "C-x", customerId: "c1", link: null, mailboxOwnerId: "u2" } as never;
}

/* --- #356 review fixes --- */
async function reviewPureChecks(ok: Ok) {
  const { pushParksOn, PUSH_READ_ONLY_MESSAGE } = await import("../src/lib/sync/engine");
  const { isOpenForSourcing } = await import("../src/lib/sourcing-report");
  const src1 = { id: "C-1", messages: [{ id: "m1", attachments: [{ name: "old.pdf", mime: "application/pdf", size: 1 }] }, { id: "m2", attachments: [
    { name: "a.pdf", mime: "application/pdf", size: 10, dataUrl: "data:application/pdf;base64,QQ==" },
    { name: "b.pdf", mime: "application/pdf", size: 10, gmailPartId: "2" },
    { name: "c.pdf", mime: "application/pdf", size: 10, documentId: "DOC-1001" },
    { name: "d.pdf", mime: "application/pdf", size: 10 },
  ] }] } as never;

  // 2 — push gate + task rule
  const user = { id: "u1", name: "Nic Trapani" };
  const live = (id: string) => id === "P-1" || id === "P-2";
  ok(pushParksOn(403, { error: "read-only" }) && !pushParksOn(403, { error: "forbidden" }) && !pushParksOn(403, null) && !pushParksOn(403) && !pushParksOn(500, { error: "read-only" }) && PUSH_READ_ONLY_MESSAGE.startsWith("Read-only"),
    "#356 re-review push: only the route's own 403 { error: \"read-only\" } parks; any other 403 is transient (retried)");
  const route = src("src/app/api/sync/push/route.ts");
  const eng = src("src/lib/sync/engine.ts");
  ok(/if \(res\.status === 403 && pushParksOn\(res\.status, await res\.clone\(\)\.json\(\)\.catch\(\(\) => null\)\)\) \{\s*for \(const e of outbox\) await idb\.put\("outbox", \{ \.\.\.e, state: "error", error: PUSH_READ_ONLY_MESSAGE \}\);/.test(eng), "#356 push: the engine parks a refused push's entries");

  // 4–8 minor
  const now = Date.UTC(2026, 9, 16);
  ok(isOpenForSourcing({ status: "sent" }, now) && isOpenForSourcing({ status: "draft", updatedAt: now - 30 * 864e5 }, now) && !isOpenForSourcing({ status: "draft", updatedAt: now - 400 * 864e5 }, now) && !isOpenForSourcing({ status: "won" }, now),
    "#356 sourcing: open = sent, or a draft touched in the last 12 months");
  ok(src("src/lib/sourcing-report-load.ts").includes("loadManufacturerAnalytics(now, { parts, records, quotes })"), "#356 sourcing: quotes are read once and shared with the analytics");
  const layout = src("src/app/layout.tsx");
  ok(layout.includes("const requestSettings = cache(() => getSettings());") && (layout.match(/await requestSettings\(\)/g) || []).length === 2 && !layout.includes("await getSettings()"), "#356: one cached settings read per request in the root layout");
  ok(src("next.config.ts").includes('{ source: "/favicon.ico", destination: "/icons/app/32.png" }'), "#356: /favicon.ico serves the Branding-logo icon");
}

async function reviewDbChecks(ok: Ok) {
  const { createFixture, registerFixture, fixtureId } = await import("./test-fixtures");
  const me = { id: "u-b6fwd", name: "Batch Six Fwd" };
  const base = {
    mailbox: "personal", mailboxUser: me.name, mailboxOwnerId: me.id, archived: false, customerId: "c-b6", customer: "Lincoln HS",
    contactName: "Pat Customer", contactEmail: "pat@customer.org", cc: "", channel: "email", status: "waiting_us", assignedTo: me.name,
    unread: false, subject: "Stage curtains", createdAt: 1000, updatedAt: 1000, link: null,
    messages: [{ id: "m1", at: 1000, direction: "in", channel: "email", author: "Pat", body: "Can you price new mains?", attachments: [{ name: "photo.jpg", mime: "image/jpeg", size: 4, dataUrl: "data:image/jpeg;base64,QUJD" }] }],
  };
  const privId = fixtureId("b6", "fwd-private");
  const linkedId = fixtureId("b6", "fwd-linked");
  await createFixture("comms", { ...base, id: privId } as never);
  await createFixture("comms", { ...base, id: linkedId, linkedBy: "user" } as never);

  // Reply all — the Cc reaches the bridge
  const raId = fixtureId("b6", "reply-all");
  await createFixture("comms", { ...base, id: raId, cc: "" } as never);
}

/* --- #356 re-review fixes --- */
async function rereviewPureChecks(ok: Ok) {

  // 3 — an offline tick
  const live = (id: string) => id === "P-1";
  const stored = { id: "T-6100", title: "Hang borders", projectId: "P-1", section: "Install", assigneeUserId: "u9", createdBy: "Jeff Chesebro", status: "open", doneAt: null, updatedAt: 1, notes: "keep" };
  const user = { id: "u1", name: "Nic Trapani" };
  const tick = { ...stored, status: "done", doneAt: 5, updatedAt: 5, rev: 3, syncState: "pending" };
  const route = src("src/app/api/sync/push/route.ts");
}

async function rereviewDbChecks(ok: Ok) {
  const { createFixture, registerFixture, fixtureId } = await import("./test-fixtures");
  const me = { id: "u-b6rr", name: "Batch Six RR" };
  const id = fixtureId("b6", "fwd-pending");
  await createFixture("comms", {
    id, mailbox: "personal", mailboxUser: me.name, mailboxOwnerId: me.id, archived: false, customerId: null, customer: "", contactName: "Pat",
    contactEmail: "pat@customer.org", cc: "", channel: "email", status: "waiting_us", assignedTo: me.name, unread: false, subject: "Plans", createdAt: 1, updatedAt: 1, link: null,
    messages: [{ id: "m1", at: 1, direction: "in", channel: "email", author: "Pat", body: "Plans attached", gmailId: "g-1" }],
  } as never);
}

export async function batch6PureChecks(ok: Ok) {
  fieldTaskPureChecks(ok);
  sourcingChecks(ok);
  await appIconChecks(ok);
  todayJobsChecks(ok);
  await attachPureChecks(ok);
  await reviewPureChecks(ok);
  await rereviewPureChecks(ok);
}

export async function batch6DbChecks(ok: Ok) {
  await fieldTaskDbChecks(ok);
  await attachDbChecks(ok);
  await reviewDbChecks(ok);
  await rereviewDbChecks(ok);
}

if (process.argv[1]?.endsWith("test-batch6.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch6PureChecks(okf)
    .then(() => (db ? batch6DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
