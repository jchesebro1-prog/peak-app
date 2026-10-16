/* Jeff's 2026-10-15 decisions — Batch 6 harness checks (docs/decisions/2026-10-15-jeff-decisions.md
   Round 2 items 64–68, plus the addFieldTask overwrite fix).
   `batch6PureChecks` needs no database; `batch6DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-batch6.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { FIELD_TASK_ID_RE, fieldTaskIdDecision } from "../src/lib/stores/tasks";
import { sourcingReport, sourcingCsv, sortForNoCost, type SourcingPart } from "../src/lib/sourcing-report";
import { todaysJobs, pagesToCache, readyCount, readyLine, isoDay } from "../src/lib/sync/today-jobs";
import { iconSource, iconVersion, parseIconFile, iconHref, manifestIcons, iconCacheControl, ICON_LIGHT_BG, ICON_DARK_BG } from "../src/lib/app-icon";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* --- Bug fix: addFieldTask could overwrite any task by id --- */
function fieldTaskPureChecks(ok: Ok) {
  const me = { id: "u1" };
  ok(FIELD_TASK_ID_RE.test("tk-a1b2c3") && !FIELD_TASK_ID_RE.test("T-6001") && !FIELD_TASK_ID_RE.test("T-auto-x") && !FIELD_TASK_ID_RE.test("tk-") && !FIELD_TASK_ID_RE.test("tk-AB/../x"),
    "fieldtask: only a Field Work id (tk- + base36) is accepted from the client");
  ok(fieldTaskIdDecision("", null, me, "P-1") === "server", "fieldtask: no client id → the server allocates the id");
  ok(fieldTaskIdDecision("T-6001", null, me, "P-1") === "refuse", "fieldtask: an office id (T-6001) is refused, never written");
  ok(fieldTaskIdDecision("tk-abc123", null, me, "P-1") === "insert", "fieldtask: a free Field Work id is inserted");
  const mine = { projectId: "P-1", section: "Install", assigneeUserId: "u1" };
  ok(fieldTaskIdDecision("tk-abc123", mine, me, "P-1") === "same", "fieldtask: the caller's own capture arriving again is idempotent");
  ok(fieldTaskIdDecision("tk-abc123", { ...mine, assigneeUserId: "u2" }, me, "P-1") === "refuse", "fieldtask: someone else's task under that id is refused");
  ok(fieldTaskIdDecision("tk-abc123", mine, me, "P-2") === "refuse", "fieldtask: another project's task under that id is refused");
  ok(fieldTaskIdDecision("tk-abc123", { ...mine, section: "Office" }, me, "P-1") === "refuse", "fieldtask: a non-Install task under that id is refused");
  ok(fieldTaskIdDecision("tk-abc123", mine, { id: "" }, "P-1") === "refuse", "fieldtask: no caller id never matches");
  const act = src("src/app/(app)/field-work/actions.ts");
  ok(act.includes("createFieldTask({ clientId, title, projectId }, me)") && !/createTask\(\s*\{\s*id:/.test(act), "fieldtask: addFieldTask goes through createFieldTask, never createTask({ id })");
}

async function fieldTaskDbChecks(ok: Ok) {
  const T = await import("../src/lib/stores/tasks");
  const { registerFixture } = await import("./test-fixtures");
  const me = { id: "u-b6", name: "Batch Six" };
  const other = { id: "u-b6b", name: "Other Person" };
  // An office task that the old code would have replaced.
  const office = await T.createTask({ title: "Office task — must survive", section: "" }, other);
  registerFixture("tasks", office.id);
  const hit = await T.createFieldTask({ clientId: office.id, title: "Overwrite attempt", projectId: "P-b6" }, me);
  const after = await T.getTask(office.id);
  ok(!hit.ok && after?.title === "Office task — must survive" && after.createdBy === "Other Person", "fieldtask db: an office id is refused and the office task is unchanged");

  const id = "tk-b6x" + Math.random().toString(36).slice(2, 6);
  registerFixture("tasks", id);
  const a = await T.createFieldTask({ clientId: id, title: "Hang borders", projectId: "P-b6" }, me);
  ok(a.ok && a.task.id === id && a.task.assigneeUserId === "u-b6" && a.task.section === "Install", "fieldtask db: a fresh Field Work id inserts, assigned to the caller");
  await T.setTaskStatus(id, "done");
  const again = await T.createFieldTask({ clientId: id, title: "Hang borders", projectId: "P-b6" }, me);
  ok(again.ok && (await T.getTask(id))?.status === "done", "fieldtask db: a retry of the same push is idempotent and never resets the stored row");
  const theirs = await T.createFieldTask({ clientId: id, title: "Hijack", projectId: "P-b6" }, other);
  ok(!theirs.ok && (await T.getTask(id))?.title === "Hang borders", "fieldtask db: another user reusing the id is refused, the row is unchanged");
  const otherProj = await T.createFieldTask({ clientId: id, title: "Hijack", projectId: "P-b6-other" }, me);
  ok(!otherProj.ok, "fieldtask db: the same id on another project is refused");
  const srv = await T.createFieldTask({ clientId: "", title: "Server id", projectId: "P-b6" }, me);
  if (srv.ok) registerFixture("tasks", srv.task.id);
  ok(srv.ok && /^T-\d+$/.test(srv.task.id), "fieldtask db: no client id gets a server-allocated T-#### id");
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
  const jobs = todaysJobs({
    visits: [
      { id: "SV-1", startAt: start + 3600e3, assignedTo: "Nic Trapani", attendees: [], stage: "scheduled", surveyId: "FS-9", customerId: "c1", customer: "Lincoln HS", venue: "Aud" },
      { id: "SV-2", startAt: start + 7200e3, assignedTo: "Jeff Chesebro", attendees: ["nic trapani"], stage: "scheduled", surveyId: null, customerId: "c2", customer: "X", venue: "" },
      { id: "SV-3", startAt: end + 3600e3, assignedTo: "Nic Trapani", attendees: [], stage: "scheduled", surveyId: null, customerId: "c3", customer: "Tomorrow", venue: "" },
      { id: "SV-4", startAt: start, assignedTo: "Jeff Chesebro", attendees: [], stage: "scheduled", surveyId: null, customerId: "c4", customer: "Not mine", venue: "" },
    ] as never,
    surveys: [svc("FS-9"), svc("FS-10", { stage: "completed" })] as never,
    inspections: [svc("IN-1"), svc("IN-2", { scheduledDate: "2026-10-17" })] as never,
    flame: [svc("FT-1", { assignedTo: "Jeff Chesebro" })] as never,
    repairs: [svc("RP-1", { assignedTo: "Jeff Chesebro", crew: ["Nic Trapani"] })] as never,
    assessments: [
      { id: "AS-1001", status: "onsite", assessorId: "u7", visitDate: start + 1 },
      { id: "AS-1002", status: "completed", assessorId: "u7", visitDate: start + 1 },
      { id: "AS-1003", status: "draft", assessorId: "u9", visitDate: start + 1 },
    ] as never,
    projects: [
      { id: "P-1", kind: "project", name: "Install", customer: "Lincoln", crew: [{ person: "Nic Trapani", start: start - 86400e3, end: start }] },
      { id: "P-2", kind: "project", name: "Done one", customer: "Y", crew: [{ person: "Nic Trapani", start, end: start }] },
      { id: "P-3", kind: "project", name: "Next week", customer: "Z", crew: [{ person: "Nic Trapani", start: end + 7 * 86400e3, end: end + 8 * 86400e3 }] },
    ] as never,
  }, me, { key: day, start, end }, dayKeyOf, (id) => id === "P-2");
  const ids = jobs.map((j) => `${j.kind}:${j.id}`).join(",");
  ok(ids === "site_visit:SV-1,site_visit:SV-2,survey:FS-9,inspection:IN-1,repair_job:RP-1,assessment:AS-1001,project:P-1",
    `#65: today's jobs are mine (lead / attendee / assignee / crew / assessor), today only, not completed or done (got ${ids})`);
  const sv1 = jobs.find((j) => j.id === "SV-1")!;
  const sv2 = jobs.find((j) => j.id === "SV-2")!;
  ok(sv1.href === "/venue-assessments/FS-9" && sv2.href === "/companies/c2" && sv1.collection === null, "#65: a visit opens its survey, else its company; it is not mirrored");
  ok(jobs.find((j) => j.id === "RP-1")?.href === "/repairs/results?job=RP-1" && jobs.find((j) => j.id === "AS-1001")?.collection === "assessments", "#65: job links and mirrored collections");
  const pages = pagesToCache(jobs);
  ok(pages[0] === "/field-work" && pages.filter((p) => p === "/venue-assessments/FS-9").length === 1, "#65: the Field Work list plus each page once");
  const cached = new Set(pages.filter((p) => p !== "/inspections/IN-1"));
  const mirrored = new Set(["surveys:FS-9", "inspections:IN-1", "repair_jobs:RP-1", "assessments:AS-1001"]);
  ok(readyCount(jobs, cached, mirrored) === 5, "#65: ready = page kept and (if mirrored) record on the device — IN-1's page and P-1's record are missing");
  ok(readyLine(5, 5) === "Ready offline: 5 jobs" && readyLine(1, 1) === "Ready offline: 1 job" && readyLine(5, 7).startsWith("Ready offline: 5 jobs (2 couldn") && readyLine(0, 0) === "No jobs for you today.",
    "#65: the result line reads 'Ready offline: N jobs'");
  ok(isoDay("2026-10-16") === day && isoDay("") === "" && isoDay("10/16/2026") === "", "#65: isoDay takes only YYYY-MM-DD");

  const route = src("src/app/api/sync/today/route.ts");
  ok(/if \(!mayPullFieldData\(me\.roles\)\) return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\)/.test(route) && route.includes("getOptionalUser()"),
    "#65: /api/sync/today has the pull's gate — signed in and `create` (#351)");
  const sw = src("public/sw.js");
  ok(sw.includes("const port = event.ports && event.ports[0]") && sw.includes(".then(() => reply(true))") && sw.includes(".catch(() => reply(false))"), "#65: the service worker answers a CACHE_ROUTE that carries a port");
  const btn = src("src/components/sync/download-today.tsx");
  ok(btn.includes('fetch("/api/sync/today"') && btn.includes("engine.pull({ force: true })") && btn.includes("readyLine(ready, jobs.length)") && !/from "@\/lib\/stores\//.test(btn.replace(/import type[^\n]*\n/g, "")),
    "#65: the button lists, pulls into the mirror, caches pages and reports — and imports no store");
  ok(/canFieldDownload: can\("create", user\.roles\)/.test(src("src/app/(app)/layout.tsx")) && src("src/components/nav/Nav.tsx").includes('<SyncChip variant="drawer" canDownload={!!user.canFieldDownload} />') &&
     /\{can\("create", me\.roles\) && <DownloadToday \/>\}/.test(src("src/app/(app)/field-work/page.tsx")), "#65: the button shows (nav sync panel, phone drawer, Field Work) only to `create` holders");
  ok(/async pull\(opts: \{ force\?: boolean \} = \{\}\): Promise<boolean>/.test(src("src/lib/sync/engine.ts")) && src("src/lib/sync/engine.ts").includes("this.pullForbidden) return false"),
    "#65: a forced pull still honours a 403 (pullForbidden) and reports success");
}

/* --- #64 Attach in the Inbox composer --- */
async function attachPureChecks(ok: Ok) {
  const M = await import("../src/lib/mail-attachments");
  const { attachmentMimePart, messageTooLargeError, rawMessageBytes, GMAIL_MAX_MESSAGE_BYTES } = await import("../src/lib/comms-attachments");
  const { multipartSendBody, SIMPLE_SEND_MAX_CHARS } = await import("../src/lib/gmail/api");
  const key = "UP-0123456789abcdef";
  const p = M.mailBlobPath("u1", key, "Rigging plan (v2).pdf");
  ok(p.startsWith("mail-attachments/u1/UP-0123456789abcdef/") && M.mailBlobPathInScope(p, "u1", key) && M.mailBlobPathInScope(p, "u1"), "#64: an upload path sits under the uploader's own folder and key");
  ok(!M.mailBlobPathInScope(p, "u2") && !M.mailBlobPathInScope(p, "u1", "UP-ffffffffffffffff") && !M.mailBlobPathInScope("documents/c1/UP-0123456789abcdef/x.pdf", "u1") &&
     !M.mailBlobPathInScope("mail-attachments/u1/UP-0123456789abcdef/../x.pdf", "u1") && !M.mailBlobPathInScope("mail-attachments/u1/UP-0123456789abcdef/a/b.pdf", "u1"),
    "#64: another user's path, another key, a document path, '..' and a nested path are all refused");
  ok(M.isMailBlobPath(p) && !M.isMailBlobPath("quote-pdfs/Q-1/rev-1.pdf") && M.mailBlobOwnerSegment(p) === "u1", "#64: the bridge recognises only composer upload paths, and whose");
  ok(M.parseMailUploadPayload(JSON.stringify({ uploadKey: key }))?.uploadKey === key && M.parseMailUploadPayload('{"uploadKey":"x"}') === null && M.parseMailUploadPayload("nope") === null, "#64: the token route's payload is just a valid upload key");
  ok(M.attachKey({ blobPath: p }, 3) === `blob:${p}` && M.attachKey({ documentId: "DOC-1001" }, 0) === "doc:DOC-1001" && M.attachKey({ pdfPath: "quote-pdfs/Q/rev-1.pdf" }, 0) === "pdf:quote-pdfs/Q/rev-1.pdf" && M.attachKey({ name: "a.txt" }, 2) === "old:2:a.txt",
    "#64: draft files are kept or dropped by a stable key");
  const parsed = M.parseComposeAttachments({ keep: ["pdf:x", 7], add: [{ kind: "upload", blobPath: p, name: "a.pdf" }, { kind: "document", documentId: "DOC-1001" }, { kind: "document", documentId: "../x" }, { kind: "evil" }] });
  ok(!!parsed && parsed.keep.join() === "pdf:x" && parsed.add.length === 2 && M.parseComposeAttachments(undefined) === null, "#64: the browser's { keep, add } is shape-checked (junk dropped; absent = untouched)");
  ok(M.attachLimitError([{ size: 12 * 1024 * 1024 }, { size: 7 * 1024 * 1024 }]) === "Attachments too large for Gmail — 18 MB max." && M.attachLimitError([{ size: 18 * 1024 * 1024 }]) === null &&
     M.attachLimitError([{ size: 1 }]) === null && M.attachLimitError(Array.from({ length: 21 }, () => ({ size: 1 })))?.includes("20") === true,
    "#64 / #356 review: 18 MB of files (Gmail counts the encoded message) and 20 files together, with the rep's message");
  ok(M.MAIL_ATTACH_MAX_BYTES === 18 * 1024 * 1024 && Math.ceil((M.MAIL_ATTACH_MAX_BYTES * 4) / 3) < 25 * 1024 * 1024, "#356 review: 18 MB of files still fits Gmail's 25 MB once base64-encoded");
  ok(M.mailAttachNameError("big.zip", 19 * 1024 * 1024)?.includes("18 MB max") === true && M.mailAttachNameError("run.exe", 10)?.includes("program") === true && M.mailAttachNameError("a.pdf", 0)?.includes("empty") === true && M.mailAttachNameError("a.pdf", 10) === null,
    "#64: one file is checked before it uploads (size, program, empty)");
  ok(M.documentFitsEmail({ customerId: "c1", projectId: null }, { customerId: "c1" }) && M.documentFitsEmail({ customerId: "c2", projectId: "P-1" }, { customerId: "c1", projectId: "P-1" }) &&
     !M.documentFitsEmail({ customerId: "c2", projectId: null }, { customerId: "c1" }) && !M.documentFitsEmail({ customerId: "c1", projectId: null }, {}),
    "#64: a document fits the email's own company or project only");

  const read = async () => Buffer.from("hello");
  const part = await attachmentMimePart({ name: "a.pdf", mime: "application/pdf", blobPath: p }, async () => null, read);
  ok(part?.dataBase64 === Buffer.from("hello").toString("base64") && part.mime === "application/pdf", "#64: a by-reference upload becomes a MIME part through the reader");
  let threw = false;
  try {
    await attachmentMimePart({ name: "gone.pdf", documentId: "DOC-1" }, async () => null, async () => null);
  } catch {
    threw = true;
  }
  ok(threw, "#64: a missing / refused upload or document THROWS — the email never goes without it");
  const big = Buffer.alloc(GMAIL_MAX_MESSAGE_BYTES + 10).toString("base64url");
  ok(messageTooLargeError(big) === "Attachments too large for Gmail — 18 MB max." && messageTooLargeError(Buffer.from("hi").toString("base64url")) === null && rawMessageBytes(Buffer.from("hello").toString("base64url")) === 5,
    "#356 review: the bridge measures the built (encoded) message and refuses over 25 MB");
  const raw = Buffer.from("From: a\r\n\r\nhi").toString("base64url");
  const body = multipartSendBody(raw, "T1", "BND").toString("utf8");
  ok(body.startsWith('--BND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"threadId":"T1"}') && body.includes("Content-Type: message/rfc822\r\n\r\nFrom: a\r\n\r\nhi") && body.endsWith("--BND--\r\n") && SIMPLE_SEND_MAX_CHARS === 4 * 1024 * 1024,
    "#64: a big send goes to Gmail's upload endpoint as multipart/related (thread metadata + the raw message)");

  const route = src("src/app/api/inbox/attach-upload/route.ts");
  ok(route.includes("mailBlobPathInScope(pathname, u.id, payload.uploadKey)") && route.includes("maximumSizeInBytes: MAIL_ATTACH_MAX_BYTES") && !route.includes("onUploadCompleted:"),
    "#64: the token route grants only the signed-in user's own path, 25 MB, no callback");
  const actions = src("src/app/(app)/inbox/attach-actions.ts");
  ok(/attachableDocumentsAction[\s\S]*const t = await ownThread\(input\.threadId, user\)/.test(actions) && !actions.includes("Buffer") && !actions.includes("arrayBuffer"),
    "#64: the Documents list for a draft is its owner's only (#341/#349); no file bytes pass through a server action");
  const inbox = src("src/app/(app)/inbox/actions.ts");
  ok(/export async function replyAction\(id: string, body: string, signatureHandled\?: boolean, attachments\?: unknown, cc\?: unknown\) \{[\s\S]{0,300}const own = await ownThread\(id, user\);\s*if \(!own\) return/.test(inbox) &&
     inbox.includes("resolveComposeAttachments(") && (inbox.match(/resolveComposeAttachments\(/g) || []).length === 4,
    "#64: reply / send / save check the owner, then re-check every attachment on the server");
  const picker = src("src/app/(app)/inbox/attach-picker.tsx");
  ok(picker.startsWith('"use client"') && picker.includes('handleUploadUrl: "/api/inbox/attach-upload"') && !/from "@\/lib\/stores\//.test(picker) && picker.includes("aria-label={`Remove ${a.name}`}"),
    "#64: the picker uploads straight to Blob, imports no store and shows ✕ on every chip");
  const reader = src("src/app/(app)/inbox/thread-reader.tsx");
  ok(!reader.includes("illustrative in this preview") && reader.includes("<AttachPicker state={att} setState={setAtt} threadId={vm.id}") && src("src/app/(app)/inbox/compose-modal.tsx").includes("<AttachPicker state={att} setState={setAtt} threadId={cd.id} customerId={cd.customerId} />"),
    "#64: the reply composer's demo Attach is replaced by the real one, and New message / Edit draft get it too");
  const bridge = src("src/lib/gmail/bridge.ts");
  ok(bridge.includes("attachmentMimePart(a, readPdfForThread, (r) => readMailRefForThread(r, t))") && bridge.includes("const tooBig = messageTooLargeError(raw);") && /if \(tooLarge\) \{\s*target\.sendError = err\.message;\s*target\.noAutoRetry = true;/.test(bridge),
    "#64 / #356 review: the Gmail bridge reads the new references, refuses a message over Gmail's limit and shows why on it (never retried)");
  const readerSrc = src("src/app/(app)/inbox/thread-reader.tsx");
  ok(readerSrc.includes("Not sent — {m.sendError}") && src("src/app/(app)/inbox/page.tsx").includes("...(m.sendError ? { sendError: m.sendError } : {}),"), "#356 review: a bridge refusal is visible on the message");
}

async function attachDbChecks(ok: Ok) {
  const S = await import("../src/lib/mail-attachments-server");
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
  const fin = await S.finalizeMailUpload({ uploadKey: key, blobPath: mine, fileName: "plan.pdf", mime: "application/pdf" }, "u1", deps);
  ok(fin.ok && fin.attachment.size === 1000 && fin.attachment.blobPath === mine, "#64 server: a finished upload becomes an attachment at its real (Blob-listed) size");
  const exe = await S.finalizeMailUpload({ uploadKey: key, blobPath: `mail-attachments/u1/${key}/tool-x1.pdf`, fileName: "tool.pdf" }, "u1", deps);
  const huge = await S.finalizeMailUpload({ uploadKey: key, blobPath: `mail-attachments/u1/${key}/huge-x1.pdf`, fileName: "huge.pdf" }, "u1", deps);
  ok(!exe.ok && !huge.ok && removed.length === 2, "#64 server: program bytes and an over-25 MB file are refused and deleted");
  const theirs = await S.finalizeMailUpload({ uploadKey: key, blobPath: mine, fileName: "plan.pdf" }, "u2", deps);
  ok(!theirs.ok && removed.length === 2, "#64 server: someone else's upload is refused and never deleted");

  const stored = [{ name: "EST-1001.pdf", mime: "application/pdf", size: 2000, pdfPath: "quote-pdfs/Q-1/rev-1.pdf", href: "/x" }];
  const untouched = await S.resolveComposeAttachments(stored, null, { userId: "u1", customerId: "c1" }, deps);
  ok(untouched.ok && untouched.attachments.length === 1, "#64 server: an untouched list keeps the draft's own files");
  const r = await S.resolveComposeAttachments(stored, { keep: ["pdf:quote-pdfs/Q-1/rev-1.pdf"], add: [{ kind: "upload", blobPath: mine, name: "plan.pdf" }, { kind: "document", documentId: "DOC-2001" }] }, { userId: "u1", customerId: "c1" }, deps);
  ok(r.ok && r.attachments.map((a) => a.name).join("|") === "EST-1001.pdf|plan.pdf|Spec.pdf" && r.attachments[2].size === 5000 && r.attachments[2].documentId === "DOC-2001",
    "#64 server: kept files + a checked upload + a document (name and size from the record)");
  const dropped = await S.resolveComposeAttachments(stored, { keep: [], add: [] }, { userId: "u1", customerId: "c1" }, deps);
  ok(dropped.ok && dropped.attachments.length === 0, "#64 server: ✕ removes a draft's file");
  const forged = await S.resolveComposeAttachments([], { keep: ["pdf:quote-pdfs/Q-9/rev-1.pdf"], add: [] }, { userId: "u1", customerId: "c1" }, deps);
  ok(forged.ok && forged.attachments.length === 0, "#64 server: a browser can't invent a by-reference file by naming its key");
  const other = await S.resolveComposeAttachments([], { keep: [], add: [{ kind: "document", documentId: "DOC-2002" }] }, { userId: "u1", customerId: "c1" }, deps);
  const notMine = await S.resolveComposeAttachments([], { keep: [], add: [{ kind: "upload", blobPath: mine, name: "plan.pdf" }] }, { userId: "u2", customerId: "c1" }, deps);
  ok(!other.ok && !notMine.ok, "#64 server: another company's document and another user's upload are refused");

  const T = { id: "C-x", customerId: "c1", link: null, mailboxOwnerId: "u2" } as never;
  ok((await S.readMailRefForThread({ blobPath: mine }, T)) === null, "#64 server: at send time an upload must be the thread owner's own");
  ok((await S.readMailRefForThread({ blobPath: "documents/c1/UP-00000000000000aa/x.pdf" }, T)) === null, "#64 server: a non-composer path is never read as an upload");
  ok((await S.readMailRefForThread({ documentId: "DOC-999999" }, T)) === null, "#64 server: a missing document reads as missing (the send throws)");
}

/* --- #356 review fixes --- */
async function reviewPureChecks(ok: Ok) {
  const F = await import("../src/lib/inbox-forward");
  const { outboundAddressing } = await import("../src/lib/gmail/bridge");
  const { taskPushAllowed } = await import("../src/lib/sync/task-push");
  const { pushParksOn, PUSH_READ_ONLY_MESSAGE } = await import("../src/lib/sync/engine");
  const { isOpenForSourcing } = await import("../src/lib/sourcing-report");
  const { sameMailbox } = await import("../src/lib/mail-attachments-server");

  // 1 — Forward / Reply all
  ok(F.forwardSubject("Rigging quote") === "Fwd: Rigging quote" && F.forwardSubject("Fwd: x") === "Fwd: x" && F.forwardSubject("") === "Fwd: (no subject)", "#356 forward: subject is 'Fwd: <subject>' once");
  ok(F.cleanAddressList(" a@b.com,\r\nBcc: evil@x ") === "a@b.com, Bcc: evil@x" && F.cleanAddressList(undefined) === "", "#356 forward: typed addresses lose CR/LF (no header injection)");
  const src1 = { id: "C-1", messages: [{ id: "m1", attachments: [{ name: "old.pdf", mime: "application/pdf", size: 1 }] }, { id: "m2", attachments: [
    { name: "a.pdf", mime: "application/pdf", size: 10, dataUrl: "data:application/pdf;base64,QQ==" },
    { name: "b.pdf", mime: "application/pdf", size: 10, gmailPartId: "2" },
    { name: "c.pdf", mime: "application/pdf", size: 10, documentId: "DOC-1001" },
    { name: "d.pdf", mime: "application/pdf", size: 10 },
  ] }] } as never;
  const kept = F.forwardableAttachments(src1, false);
  ok(kept.map((a) => a.name).join() === "a.pdf,b.pdf" && JSON.stringify(kept[1].fwdFrom) === '{"threadId":"C-1","messageId":"m2"}',
    "#356 forward: the forwarded (newest) message's files ride by reference; a Gmail file points at its source; a document only when the company is kept; no-reference files dropped");
  ok(F.forwardableAttachments(src1, true).some((a) => a.documentId === "DOC-1001"), "#356 forward: with a deliberate company link a document rides too");
  ok(JSON.stringify(outboundAddressing({ contactEmail: "vendor@y.com", contactName: "", cc: "t@y.com" }, { cc: "boss@y.com" })) === '{"to":"vendor@y.com","cc":"boss@y.com"}' &&
     outboundAddressing({ contactEmail: "c@x.com", contactName: "", cc: "t@y.com" }, {}).cc === "t@y.com",
    "#356 reply all: a message's own Cc wins; otherwise the thread's");
  ok(sameMailbox({ mailbox: "personal", mailboxOwnerId: "u1" }, { mailbox: "personal", mailboxOwnerId: "u1" }) && !sameMailbox({ mailbox: "personal", mailboxOwnerId: "u1" }, { mailbox: "personal", mailboxOwnerId: "u2" }) &&
     sameMailbox({ mailbox: "info", mailboxOwnerId: null }, { mailbox: "info", mailboxOwnerId: null }) && !sameMailbox({ mailbox: "info", mailboxOwnerId: null }, { mailbox: "sales", mailboxOwnerId: null }),
    "#356 forward: a forwarded Gmail file is read only within the same mailbox");
  const reader = src("src/app/(app)/inbox/thread-reader.tsx");
  ok(/if \(mode === "forward"\) \{\s*const fwd = await forwardAction\(\{\s*threadId: vm\.id,\s*to: cTo,\s*cc: cCc,/.test(reader) && reader.includes('replyAction(vm.id, b, !!signature, attachPayload(att), mode === "replyAll" ? cCc : undefined)'),
    "#356: Forward sends to the typed To / Cc as a new message; Reply all passes its Cc");
  const acts = src("src/app/(app)/inbox/actions.ts");
  ok(/export async function forwardAction\([\s\S]{0,400}const source = await ownThread\(d\?\.threadId, user\);\s*if \(!source\) return/.test(acts) && acts.includes("...(ccLine ? { cc: ccLine } : {})"),
    "#356: forwardAction checks the owner of the source thread; replyAction sends the Cc");

  // 2 — push gate + task rule
  const user = { id: "u1", name: "Nic Trapani" };
  const live = (id: string) => id === "P-1" || id === "P-2";
  ok(taskPushAllowed("tk-abc1", null, { projectId: "P-1" }, user, live) && !taskPushAllowed("T-6001", null, { projectId: "P-1" }, user, live) && !taskPushAllowed("tk-abc1", null, { projectId: "P-9" }, user, live) && !taskPushAllowed("tk-abc1", null, {}, user, live),
    "#356 push: an insert is only a new tk- task on a live project");
  ok(taskPushAllowed("tk-abc1", { projectId: "P-1", assigneeUserId: "u2", createdBy: "Other" }, { projectId: "P-1" }, user, live) && !taskPushAllowed("tk-abc1", { projectId: "P-1" }, { projectId: "P-2" }, user, live),
    "#356 push: a tk- field task on a live project updates (but can't move to another project)");
  ok(!taskPushAllowed("T-6001", { projectId: "P-1", assigneeUserId: "u2", createdBy: "Jeff Chesebro" }, { projectId: "P-1" }, user, live) &&
     taskPushAllowed("T-6001", { projectId: null, assigneeUserId: "u1" }, {}, user, live) && taskPushAllowed("T-6002", { createdBy: "nic trapani" }, {}, user, live),
    "#356 push: an office task updates only for its assignee or creator");
  ok(pushParksOn(403) && !pushParksOn(500) && !pushParksOn(401) && PUSH_READ_ONLY_MESSAGE.startsWith("Read-only"), "#356 push: a 403 parks the entries as read-only (no retry storm)");
  const route = src("src/app/api/sync/push/route.ts");
  ok(route.indexOf("if (!mayPullFieldData(session.user.roles))") > 0 && route.indexOf("if (!mayPullFieldData(session.user.roles))") < route.indexOf("await req.json()") &&
     route.includes("if (!taskPushAllowed(rec.id, stored, inc, pusher, (x) => known.get(x) === true))") && route.includes("sanitizePushedDoc(coll,"),
    "#356 push: the route has the pull's `create` gate before reading anything, the task rule, and still strips #351 fields");
  const eng = src("src/lib/sync/engine.ts");
  ok(/if \(pushParksOn\(res\.status\)\) \{\s*for \(const e of outbox\) await idb\.put\("outbox", \{ \.\.\.e, state: "error", error: PUSH_READ_ONLY_MESSAGE \}\);/.test(eng), "#356 push: the engine parks a refused push's entries");
  const fw = src("src/app/(app)/field-work/actions.ts");
  ok(/export async function toggleFieldTask[\s\S]{0,500}if \(!can\("create", me\.roles\)\)[\s\S]{0,200}const task = await getTask\(taskId\);\s*if \(!task \|\| !task\.projectId \|\| !\(await getProject\(task\.projectId\)\)\)/.test(fw) &&
     /export async function addFieldTask[\s\S]{0,200}if \(!can\("create", me\.roles\)\)/.test(fw),
    "#356: toggleFieldTask / addFieldTask need `create` and a task on a live project");
  ok(fieldTaskIdDecision("tk-abc123", { projectId: "P-1", section: "Install", assigneeUserId: null, createdBy: "Nic Trapani" }, { id: "u1", name: "Nic Trapani" }, "P-1") === "same" &&
     fieldTaskIdDecision("tk-abc123", { projectId: "P-1", section: "Install", assigneeUserId: null, createdBy: "Someone Else" }, { id: "u1", name: "Nic Trapani" }, "P-1") === "refuse",
    "#356 field task: the caller's own unassigned capture (same id + project) answers ok; someone else's doesn't");

  // 4–8 minor
  const now = Date.UTC(2026, 9, 16);
  ok(isOpenForSourcing({ status: "sent" }, now) && isOpenForSourcing({ status: "draft", updatedAt: now - 30 * 864e5 }, now) && !isOpenForSourcing({ status: "draft", updatedAt: now - 400 * 864e5 }, now) && !isOpenForSourcing({ status: "won" }, now),
    "#356 sourcing: open = sent, or a draft touched in the last 12 months");
  ok(src("src/lib/sourcing-report-load.ts").includes("loadManufacturerAnalytics(now, { parts, records, quotes })"), "#356 sourcing: quotes are read once and shared with the analytics");
  const layout = src("src/app/layout.tsx");
  ok(layout.includes("const requestSettings = cache(() => getSettings());") && (layout.match(/await requestSettings\(\)/g) || []).length === 2 && !layout.includes("await getSettings()"), "#356: one cached settings read per request in the root layout");
  const picker = src("src/app/(app)/inbox/attach-picker.tsx");
  ok(picker.includes("{d.internal && (") && picker.includes("Documents{docsHeading ? ` — ${docsHeading}` : \"\"}") && src("src/app/(app)/inbox/attach-actions.ts").includes('internal: d.visibility === "internal"'),
    "#356: the Documents picker tags internal files and names the company / project");
  ok(src("next.config.ts").includes('{ source: "/favicon.ico", destination: "/icons/app/32.png" }'), "#356: /favicon.ico serves the Branding-logo icon");
}

async function reviewDbChecks(ok: Ok) {
  const C = await import("../src/lib/stores/comms");
  const F = await import("../src/lib/inbox-forward");
  const { outboundAddressing } = await import("../src/lib/gmail/bridge");
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

  const res = await F.forwardThread((await C.get(privId))!, { to: "vendor@supplier.com", cc: "boss@supplier.com", body: "See below.\n\n> Can you price new mains?", includeOriginal: true }, me);
  if (res.ok) registerFixture("comms", res.id);
  const fwd = res.ok ? await C.get(res.id) : null;
  const out = fwd?.messages?.[fwd.messages.length - 1];
  const addr = fwd && out ? outboundAddressing(fwd, out) : null;
  ok(!!fwd && res.ok && res.id !== privId && fwd.contactEmail === "vendor@supplier.com" && addr?.to === "vendor@supplier.com" && addr?.cc === "boss@supplier.com" && !JSON.stringify(addr).includes("pat@customer.org"),
    "#356 forward (DB): a forward is its own thread addressed only to the typed To / Cc — never the customer contact");
  ok(fwd?.subject === "Fwd: Stage curtains" && out?.direction === "out" && (out?.attachments || []).some((a) => a.name === "photo.jpg"), "#356 forward (DB): 'Fwd:' subject and the original's attachment");
  const srcAfter = await C.get(privId);
  ok(srcAfter?.messages.length === 1 && srcAfter.contactEmail === "pat@customer.org", "#356 forward (DB): nothing is added to (or sent on) the source thread");
  ok(!!fwd && !fwd.customerId && !fwd.link && !C.hasDeliberateLink(fwd), "#356 forward (DB): forwarding a private email keeps the forward private (#341 — no company copied)");
  const res2 = await F.forwardThread((await C.get(linkedId))!, { to: "vendor@supplier.com", body: "FYI", includeOriginal: false }, me);
  if (res2.ok) registerFixture("comms", res2.id);
  const fwd2 = res2.ok ? await C.get(res2.id) : null;
  ok(fwd2?.customerId === "c-b6" && !(fwd2?.messages?.[fwd2.messages.length - 1]?.attachments || []).length, "#356 forward (DB): a deliberately filed email keeps its company; unticked originals stay behind");
  const none = await F.forwardThread((await C.get(privId))!, { to: "  ", body: "x" }, me);
  ok(!none.ok, "#356 forward (DB): no recipient, no forward");

  // Reply all — the Cc reaches the bridge
  const raId = fixtureId("b6", "reply-all");
  await createFixture("comms", { ...base, id: raId, cc: "" } as never);
  await C.reply(raId, { body: "Thanks all", me: me.name, cc: "boss@customer.org, ops@customer.org" });
  const ra = await C.get(raId);
  const raMsg = ra?.messages?.[ra.messages.length - 1];
  ok(raMsg?.cc === "boss@customer.org, ops@customer.org" && outboundAddressing(ra!, raMsg!).cc === "boss@customer.org, ops@customer.org" && outboundAddressing(ra!, raMsg!).to === "pat@customer.org",
    "#356 reply all (DB): the Cc rides on the message and the bridge sends it");
}

export async function batch6PureChecks(ok: Ok) {
  fieldTaskPureChecks(ok);
  sourcingChecks(ok);
  await appIconChecks(ok);
  todayJobsChecks(ok);
  await attachPureChecks(ok);
  await reviewPureChecks(ok);
}

export async function batch6DbChecks(ok: Ok) {
  await fieldTaskDbChecks(ok);
  await attachDbChecks(ok);
  await reviewDbChecks(ok);
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
