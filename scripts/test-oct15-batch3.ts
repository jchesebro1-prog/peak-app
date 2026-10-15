/* Jeff's 2026-10-15 decisions — Batch 3 (Lists, pipelines, field) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 8, 10, 11, 34, 35, 42).
   `batch3PureChecks` needs no database; `batch3DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-batch3.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { like } from "drizzle-orm";
import type { Ok } from "./test-inbox-org";
import { LIST_PAGE_SIZE, paginate, parsePageParam, pageOfIndex, resolvePage, withPage, pageCountFor } from "../src/lib/list-paging";
import { quotesHubView, HUB_TYPE_KEYS, type HubQuote } from "../src/lib/quotes-hub-view";
import { companyRollups, filterCompanyDirectory, companySearchText } from "../src/lib/company-directory";
import { getDb } from "../src/db";
import { companies, sites, contacts, contactEmails } from "../src/db/schema";
import { saveCompany, companiesByNames } from "../src/lib/identity/companies";
import { saveSite } from "../src/lib/identity/sites";
import { companyIdsWithContactMatching } from "../src/lib/identity/contacts";
import { allForDirectory } from "../src/lib/stores/customers";
import { listQuoteRows } from "../src/lib/stores/quotes";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ #11 lists ------------------------------------------------------------------ */

function listPagingChecks(ok: Ok) {
  ok(LIST_PAGE_SIZE === 50, "b3 #11: 50 rows a page");
  ok(parsePageParam("3") === 3 && parsePageParam("") === 1 && parsePageParam("0") === 1 && parsePageParam("-2") === 1 && parsePageParam("2.5") === 1 && parsePageParam("abc") === 1 && parsePageParam(undefined) === 1,
    "b3 #11: ?page= parses to a positive integer, anything else is page 1");
  const all = Array.from({ length: 123 }, (_, i) => i);
  const p1 = paginate(all, 1), p3 = paginate(all, 3), p9 = paginate(all, 9);
  ok(p1.rows.length === 50 && p1.rows[0] === 0 && p1.from === 1 && p1.to === 50 && p1.pageCount === 3 && p1.total === 123, "b3 #11: page 1 of 123 rows is rows 1–50 of 3 pages");
  ok(p3.rows.length === 23 && p3.rows[0] === 100 && p3.from === 101 && p3.to === 123, "b3 #11: the last page holds the remainder");
  ok(p9.page === 3 && p9.rows[0] === 100, "b3 #11: a page past the end shows the last page");
  const empty = paginate([], 4);
  ok(empty.page === 1 && empty.pageCount === 1 && empty.from === 0 && empty.to === 0 && pageCountFor(0) === 1, "b3 #11: an empty list is page 1 of 1");
  ok(pageOfIndex(0) === 1 && pageOfIndex(49) === 1 && pageOfIndex(50) === 2 && pageOfIndex(-1) === 1, "b3 #11: the page holding a row index");
  ok(resolvePage(1, 120) === 3 && resolvePage(2, -1) === 2, "b3 #11: a ?id= row found in the filtered set opens on its page; not found keeps ?page=");
  const params = new URLSearchParams("status=sent&page=4&q=gym");
  ok(withPage("/quotes", params, 2) === "/quotes?status=sent&q=gym&page=2" && withPage("/quotes", params, 1) === "/quotes?status=sent&q=gym" && withPage("/quotes", new URLSearchParams(), 1) === "/quotes",
    "b3 #11: page links keep every filter; page 1 has the plain URL");

  /* Quotes hub: filters, chips and stats over the FULL set, never one page. 260 quotes, newest first. */
  const owners = ["Pat", "Sam", "Lee"];
  const types = [undefined, "flame_test", "repair", "inspection", "consulting", "rental", "system"];
  const statuses = ["draft", "sent", "won", "lost"];
  const rows: HubQuote[] = Array.from({ length: 260 }, (_, i) => ({
    id: "Q-" + i,
    name: i === 237 ? "Needle in the haystack" : "Quote " + i,
    customer: i === 201 ? "Farfield Schools" : "Cust " + (i % 9),
    owner: owners[i % 3],
    status: statuses[i % 4],
    quoteType: types[i % 7],
    value: 100,
    estNo: 1001 + i,
  }));
  const bidderMap = new Map<string, Array<{ bid: { result: "pending" } }>>([["Q-249", [{ bid: { result: "pending" } }]], ["Q-12", [{ bid: { result: "pending" } }]]]);
  const bidders = (id: string) => (bidderMap.get(id) ?? []) as never;
  const bidderNames = (id: string) => (id === "Q-255" ? ["Acme Mechanical"] : []);
  const base = { scope: "all", me: "Pat", status: "all", type: "all", bid: false, q: "" };
  const v0 = quotesHubView(rows, base, bidders, bidderNames);
  ok(v0.filtered.length === 260 && v0.statusCounts.all === 260 && v0.statusCounts.won === 65 && v0.typeCounts.system === 75 && v0.typeCounts.rental === 37,
    "b3 #11 quotes: status and type counts cover all 260 quotes (system = no quoteType + 'system')");
  ok(HUB_TYPE_KEYS.reduce((a, k) => a + v0.typeCounts[k], 0) === 260, "b3 #11 quotes: the type chips add up to every quote");
  const vNeedle = quotesHubView(rows, { ...base, q: "needle" }, bidders, bidderNames);
  ok(vNeedle.filtered.length === 1 && vNeedle.filtered[0].id === "Q-237", "b3 #11 quotes: a search finds a quote far past page 1 (row 238 of 260)");
  ok(quotesHubView(rows, { ...base, q: "farfield" }, bidders, bidderNames).filtered[0]?.id === "Q-201", "b3 #11 quotes: search reads the customer");
  ok(quotesHubView(rows, { ...base, q: "acme mech" }, bidders, bidderNames).filtered.map((q) => q.id).join() === "Q-255", "b3 #11 quotes: search reads bidder company names");
  const vNum = quotesHubView(rows, { ...base, q: "1250" }, bidders, bidderNames);
  ok(vNum.filtered[0]?.id === "Q-249", "b3 #11 quotes: an estimate number finds its quote first, wherever it sits");
  const vBid = quotesHubView(rows, { ...base, bid: true }, bidders, bidderNames);
  ok(v0.outToBidCount === 2 && vBid.filtered.map((q) => q.id).sort().join() === "Q-12,Q-249", "b3 #11 quotes: Out to bid counts and filters across every page");
  const vMine = quotesHubView(rows, { ...base, scope: "mine", status: "won" }, bidders, bidderNames);
  ok(vMine.scoped.every((q) => q.owner === "Pat") && vMine.scoped.length === 87 && vMine.filtered.every((q) => q.status === "won") && vMine.statusCounts.won === vMine.filtered.length,
    "b3 #11 quotes: My work + a status chip count the whole of my quotes");
  const vType = quotesHubView(rows, { ...base, type: "repair", status: "sent" }, bidders, bidderNames);
  ok(vType.typeCounts.all === 260 && vType.scoped.every((q) => q.quoteType === "repair") && vType.filtered.every((q) => q.status === "sent" && q.quoteType === "repair"),
    "b3 #11 quotes: type chip counts are taken before the type filter; status after");
  const pg = paginate(v0.filtered, resolvePage(1, v0.filtered.findIndex((q) => q.id === "Q-180")));
  ok(pg.page === 4 && pg.rows.some((q) => q.id === "Q-180"), "b3 #11 quotes: /quotes?id=Q-180 opens on page 4");

  /* Companies directory */
  const cos = Array.from({ length: 140 }, (_, i) => ({
    id: "co" + i,
    name: i === 133 ? "Zephyr Arts Center" : "Company " + i,
    type: i % 2 ? "School" : "Church",
    owner: i === 5 ? "Lee" : undefined,
    createdAt: i === 120 ? Date.now() - 86_400_000 : Date.now() - 30 * 86_400_000,
    locations: [{ label: "Hall " + i, city: i === 99 ? "Oshkosh" : "Madison", state: "WI", address: "1 Main", zip: "53703" }],
  }));
  const qrows = [
    { customerId: "co7", status: "sent", value: 500, owner: "Sam", updatedAt: 10 },
    { customerId: "co7", status: "won", value: 900, owner: "Pat", updatedAt: 20 },
    { customer: "Company 8", status: "draft", value: 300, owner: "Pat", updatedAt: 5 },
  ];
  const prows = [{ customerId: "co7", owner: "Lee", updatedAt: 15 }, { customerId: "co5", owner: "Pat", updatedAt: 99 }];
  const drows = companyRollups(cos, qrows, prows);
  const r7 = drows.find((r) => r.c.id === "co7")!, r8 = drows.find((r) => r.c.id === "co8")!, r5 = drows.find((r) => r.c.id === "co5")!;
  ok(r7.openValue === 500 && r7.quoteCount === 2 && r7.owner === "Pat" && r8.quoteCount === 1 && r8.openValue === 300 && r5.owner === "Lee",
    "b3 #11 companies: rollups (open value, quote count by id or name, latest-activity owner, stored owner wins)");
  const f = { scope: "all", me: "Pat", type: "all", q: "", added: "" };
  ok(filterCompanyDirectory(drows, { ...f, q: "zephyr" }).filtered.map((r) => r.c.id).join() === "co133", "b3 #11 companies: search finds a company far past page 1");
  ok(filterCompanyDirectory(drows, { ...f, q: "oshkosh" }).filtered.map((r) => r.c.id).join() === "co99", "b3 #11 companies: search reads venue city");
  ok(companySearchText(cos[3]).includes("53703") && companySearchText(cos[3]).includes("school"), "b3 #11 companies: search text holds type, address and zip");
  ok(filterCompanyDirectory(drows, { ...f, q: "pat person", contactHits: new Set(["co77"]) }).filtered.map((r) => r.c.id).join() === "co77", "b3 #11 companies: a contact match (SQL) brings its company in");
  const mine = filterCompanyDirectory(drows, { ...f, scope: "mine" }).filtered.map((r) => r.c.id).sort().join();
  ok(mine === "co7,co8", "b3 #11 companies: My companies reads the rollup owner across every company");
  const sch = filterCompanyDirectory(drows, { ...f, type: "School" });
  ok(sch.filtered.length === 70 && paginate(sch.filtered, 2).rows.length === 20, "b3 #11 companies: a type filter counts the full set, then pages it");
  const add = filterCompanyDirectory(drows, { ...f, added: "7d" });
  ok(add.addedCount === 1 && add.filtered.map((r) => r.c.id).join() === "co120", "b3 #11 companies: Added in 7 days over the full set");

  /* Pins: the pages read slim projections, page last, and show the pager. */
  const qp = src("src/app/(app)/quotes/page.tsx");
  ok(!/\bgetAll\(\)/.test(qp) && !/allCustomers/.test(qp) && /listQuoteRows\(\)/.test(qp) && /quotesHubView\(/.test(qp) && /getQuotesMany\(paged\.rows/.test(qp) && /<ListPager/.test(qp) && /pageQuotes\.map\(/.test(qp),
    "b3 #11 pin: the Quotes hub filters a slim projection of every quote, reads only the page in full, and pages it");
  const cp = src("src/app/(app)/companies/page.tsx");
  ok(/allForDirectory\(\)/.test(cp) && /listQuoteRows\(\)/.test(cp) && /listProjectActivityRows\(\)/.test(cp) && /companyIdsWithContactMatching\(q\)/.test(cp) && /filterCompanyDirectory\(rows/.test(cp) && /<ListPager/.test(cp) && !/parsePageSize/.test(cp),
    "b3 #11 pin: the Companies directory filters every company (slim reads + SQL contact search) and pages with ?page=");
  const vp = src("src/app/(app)/venues/page.tsx");
  const vh = src("src/lib/venue-history-server.ts");
  ok(/<ListPager/.test(vp) && /parsePageParam\(one\(sp\.page\)\)/.test(vp) && /activityRows\("quotes", AT\)/.test(vh) && !/loadVenueDirectory[\s\S]{0,400}getAllQuotes\(\)/.test(vh),
    "b3 #11 pin: the Venues directory reads activity as projections and pages with ?page=");
}

async function listDbChecks(ok: Ok) {
  const db = await getDb();
  const PFX = "TESTb3:";
  const cleanup = async () => {
    await db.delete(contactEmails).where(like(contactEmails.id, PFX + "%"));
    await db.delete(contacts).where(like(contacts.id, PFX + "%"));
    await db.delete(sites).where(like(sites.id, PFX + "%"));
    await db.delete(companies).where(like(companies.id, PFX + "%"));
  };
  try {
    await cleanup();
    await saveCompany({ id: PFX + "co1", name: "B3 Lattice Theatre", type: "customer", lifecycle: "active", deleted: false });
    await saveSite({ id: PFX + "st1", companyId: PFX + "co1", name: "B3 Hall", locationName: "B3 Hall", venueKind: "proscenium" });
    const t = Date.now();
    await db.insert(contacts).values({ id: PFX + "ct1", firstName: "Quinby", lastName: "Marsh", homeCompanyId: PFX + "co1", title: "TD", isPrimary: true, createdAt: t, updatedAt: t });
    await db.insert(contactEmails).values({ id: PFX + "ce1", contactId: PFX + "ct1", email: "qmarsh@lattice-b3.example", isPrimary: true } as never);
    const byName = await companyIdsWithContactMatching("quinby mar");
    const byMail = await companyIdsWithContactMatching("LATTICE-B3");
    const none = await companyIdsWithContactMatching("50%_");
    ok(byName.has(PFX + "co1") && byMail.has(PFX + "co1") && !none.has(PFX + "co1"), "b3 #11 db: the SQL contact search matches name and email; LIKE wildcards are literal");
    const dir = await allForDirectory();
    const mine = dir.find((c) => c.id === PFX + "co1");
    ok(!!mine && mine.contacts.length === 0 && mine.locations.length === 1, "b3 #11 db: the directory read carries venues and no contacts");
    const named = await companiesByNames(["b3 lattice THEATRE"]);
    ok(named.get("b3 lattice theatre")?.id === PFX + "co1", "b3 #11 db: companiesByNames matches ignoring case");

    const Q = fixtureId("b3", "list-quote");
    await createFixture("quotes", { id: Q, name: "B3 list quote", customer: "B3 Lattice Theatre", customerId: PFX + "co1", owner: "Pat", status: "sent", value: 4321, updatedAt: t, spec: { sections: [{ id: "s1", items: [{ id: "l1", desc: "big" }] }] }, revisions: [{ rev: 1 }] } as never);
    const rows = await listQuoteRows();
    const r = rows.find((x) => x.id === Q) as Record<string, unknown> | undefined;
    ok(!!r && r.value === 4321 && r.status === "sent" && r.customerId === PFX + "co1" && !("spec" in r) && !("revisions" in r), "b3 #11 db: listQuoteRows is a projection — list fields, no spec or revisions");
    ok(rows.every((x, i) => i === 0 || (rows[i - 1].updatedAt || 0) >= (x.updatedAt || 0)), "b3 #11 db: listQuoteRows is newest first, like getAll()");
  } finally {
    await dropFixtures("b3");
    await cleanup();
  }
}

/* ------------------------------------------------------------------ entry points ------------------------------------------------------------------ */

export async function batch3PureChecks(ok: Ok) {
  listPagingChecks(ok);
}

export async function batch3DbChecks(ok: Ok) {
  await listDbChecks(ok);
}

if (process.argv[1]?.endsWith("test-oct15-batch3.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch3PureChecks(okf)
    .then(() => (db ? batch3DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
