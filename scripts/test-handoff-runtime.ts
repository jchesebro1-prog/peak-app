/**
 * handoff runtime checks — the pure parts of the Estimator handoff's browser runtime (PR 2 Task 3):
 * the IndexedDB overlay merge, the in-memory store fallback, estimate numbering, the ports
 * (users / customers / travel / tiers / email / onWon) and the EstimatorProps builder, run in Node
 * against slices of docs/estimating-core/handoff-fixtures/export-v2.json. IndexedDB itself is
 * exercised in the browser by `npm run handoff:verify -- --estimator`. test:specs → handoffRuntimeChecks(ok).
 */
import * as fs from "node:fs";
import * as vm from "node:vm";
import { ROLE_PERMS, type Perm, type Role } from "@/lib/team";
import { overlayMerge, openStore, storeSeedFrom, type HandoffStore } from "../handoff/estimator/runtime/store";
import {
  clock, configurePorts, customers, email, nextEstNoFrom, numbering, onWon, resolveTierFor, travelFromParts, users,
} from "../handoff/estimator/runtime/ports";
import { buildEstimatorProps } from "../handoff/estimator/runtime/props/estimator";
import type { SeedCustomers, SeedRules, SeedTeamUser } from "../handoff/estimator/runtime/seed";
import { sliceExport, type ExportV2 } from "../handoff/estimator/slice";
import { expectedEstimatorTotals } from "../handoff/estimator/verify";
import type { Ok } from "./test-inbox-org";

const FIXTURE_V2 = "docs/estimating-core/handoff-fixtures/export-v2.json";
const GOLDEN_EXPORT = "docs/estimating-core/golden-fixtures/export.json";

type Globals = Record<string, unknown>;

/** Runs the slicer's data/*.js bodies in a sandbox and returns the window.PEAK_* globals they set. */
export function sliceGlobals(files: Record<string, string>): Globals {
  const window: Globals = {};
  const ctx = vm.createContext({ window });
  for (const [name, body] of Object.entries(files)) if (name.endsWith(".js")) vm.runInContext(body, ctx, { filename: name });
  return window;
}

/** Seed docs with extra fields (StoreSeed only requires an id). */
const docs = (xs: Array<{ id: string } & Record<string, unknown>>): Array<{ id: string }> => xs;

const EMPTY_CUSTOMERS: SeedCustomers = { companies: [], sites: [], contacts: [], contactEmails: [], contactPhones: [], geoCache: [] };

async function storeFor(g: Globals): Promise<HandoffStore> {
  return openStore(
    storeSeedFrom({
      estimates: (g.PEAK_ESTIMATES as never) ?? [],
      catalog: (g.PEAK_CATALOG as never) ?? [],
      fixtures: (g.PEAK_FIXTURES as never) ?? [],
      rules: (g.PEAK_RULES as SeedRules) ?? { settings: {}, blobs: {} },
      meta: (g.PEAK_META as never) ?? null,
    }),
    { idb: null },
  );
}

export async function handoffRuntimeChecks(ok: Ok) {
  // --- overlayMerge ---
  const seed = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
  const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).join(",");
  ok(ids(overlayMerge(seed, new Map())) === "a,b,c", "handoff runtime: overlayMerge — an empty overlay is the seed");
  const won = overlayMerge(seed, new Map([["b", { id: "b", v: 2 }]]));
  ok(ids(won) === "a,b,c" && won[1].v === 2, "handoff runtime: overlayMerge — the overlay wins, in the seed's position");
  ok(ids(overlayMerge(seed, new Map([["b", null]]))) === "a,c", "handoff runtime: overlayMerge — a tombstone hides the seed doc");
  ok(ids(overlayMerge(seed, new Map([["e", { id: "e", v: 1 }], ["d", { id: "d", v: 1 }]]))) === "a,b,c,e,d", "handoff runtime: overlayMerge — new ids append in overlay order");
  ok(ids(overlayMerge(seed, new Map<string, { id: string; v: number } | null>([["c", null], ["a", { id: "a", v: 3 }], ["z", null]]))) === "a,b", "handoff runtime: overlayMerge — a tombstone for an unknown id is harmless");
  ok(seed.length === 3 && seed[1].v === 1, "handoff runtime: overlayMerge — never mutates the seed");

  // --- the store's in-memory fallback (Node has no IndexedDB) ---
  const mem = await openStore({ quotes: [{ id: "Q-1", name: "one" } as { id: string; name: string }], meta: [] }, { idb: null });
  ok(mem.persistent === false, "handoff runtime: store — no IndexedDB → in-memory, persistent false");
  ok((await mem.get<{ name: string }>("quotes", "Q-1"))?.name === "one", "handoff runtime: store — get reads the seed");
  await mem.put("quotes", { id: "Q-1", name: "edited" });
  await mem.put("quotes", { id: "Q-2", name: "new" });
  ok((await mem.get<{ name: string }>("quotes", "Q-1"))?.name === "edited", "handoff runtime: store — get prefers the overlay");
  ok(ids(await mem.all("quotes")) === "Q-1,Q-2", "handoff runtime: store — all is seed ∪ overlay");
  await mem.remove("quotes", "Q-1");
  ok((await mem.get("quotes", "Q-1")) === undefined && ids(await mem.all("quotes")) === "Q-2", "handoff runtime: store — remove tombstones a seed doc");
  const got = await mem.get<{ id: string; name: string }>("quotes", "Q-2");
  if (got) got.name = "mutated by caller";
  ok((await mem.get<{ name: string }>("quotes", "Q-2"))?.name === "new", "handoff runtime: store — get hands back a copy");
  await mem.reset();
  ok(ids(await mem.all("quotes")) === "Q-1" && (await mem.get<{ name: string }>("quotes", "Q-1"))?.name === "one", "handoff runtime: store — reset drops the overlay, back to the seed");

  // --- numbering ---
  ok(nextEstNoFrom([2696, 9001, "x", null, 9003.5], null) === 9002, "handoff runtime: numbering — after the max integer estNo");
  ok(nextEstNoFrom([2696], 3000) === 3001, "handoff runtime: numbering — after the last issued number when it is higher");
  ok(nextEstNoFrom([], null) === 1001, "handoff runtime: numbering — an empty book starts at 1001");
  const numStore = await openStore({ quotes: docs([{ id: "Q-A", estNo: 9001 }, { id: "Q-B", estNo: 9003 }]) }, { idb: null });
  configurePorts({ store: numStore });
  const n1 = await numbering.nextEstNo();
  const n2 = await numbering.nextEstNo();
  ok(n1 === 9004 && n2 === 9005, `handoff runtime: numbering.nextEstNo — 9004 then 9005 (got ${n1}, ${n2})`);
  const [p1, p2] = await Promise.all([numbering.nextEstNo(), numbering.nextEstNo()]);
  ok(p1 !== p2, "handoff runtime: numbering.nextEstNo — concurrent calls never share a number");

  // --- users.can per role (ROLE_PERMS) ---
  const ROLES = Object.keys(ROLE_PERMS) as Role[];
  const PERMS: Perm[] = ["create", "approve", "send", "manage_users"];
  const team: SeedTeamUser[] = ROLES.map((r, i) => ({ id: `u${i + 1}`, name: `${r} Person`, roles: [r], status: "active" }));
  configurePorts({ team, store: numStore });
  for (const r of ROLES) {
    users.setCurrent(team[ROLES.indexOf(r)].id);
    ok(users.current().roles?.[0] === r, `handoff runtime: users.setCurrent — ${r}`);
    for (const p of PERMS) ok(users.can(p) === ROLE_PERMS[r].includes(p), `handoff runtime: users.can(${p}) for ${r} follows ROLE_PERMS`);
  }
  ok(users.approvers().map((u) => u.roles?.[0]).join(",") === ROLES.filter((r) => ROLE_PERMS[r].includes("approve")).join(","), "handoff runtime: users.approvers — every role holding approve");
  users.setCurrent("nobody");
  ok(users.current().id === team[ROLES.length - 1].id, "handoff runtime: users.setCurrent — an unknown id is ignored");
  configurePorts({ team: [{ id: "u9", name: "Est Only", roles: ["Estimator"], status: "active" }, { id: "u1", name: "Boss", roles: ["Manager", "Admin"], status: "active" }] });
  ok(users.current().id === "u1", "handoff runtime: users.current — defaults to the first Admin");
  configurePorts({ team: [] });
  ok(users.current().name !== "" && users.can("create"), "handoff runtime: users.current — an empty roster falls back to a stand-in Admin");

  // --- customers / tiers / travel from the export-v2 slice ---
  const exp = JSON.parse(fs.readFileSync(FIXTURE_V2, "utf8")) as ExportV2;
  const g = sliceGlobals(sliceExport(exp).files);
  const seedCustomers = g.PEAK_CUSTOMERS as SeedCustomers;
  const rules = g.PEAK_RULES as SeedRules;
  configurePorts({ customers: seedCustomers, rules, team: g.PEAK_TEAM as SeedTeamUser[] });
  const all = customers.all();
  ok(all.map((c) => c.name).join("|") === "Alpha Schools|Beta Church", "handoff runtime: customers.all — referenced companies, by name");
  const alpha = all[0];
  ok(alpha.locations.map((l) => l.id).join(",") === "loc1,loc2", "handoff runtime: customers.all — venue ids are legacyLocId, deleted venues gone");
  ok(alpha.contacts.map((c) => c.name).join(",") === "Pat Lee" && alpha.contacts[0].primary, "handoff runtime: customers.all — live contacts, display names");
  ok(customers.resolve("alpha schools")?.id === "c-alpha" && customers.resolve("c-beta")?.name === "Beta Church" && customers.resolve("nope") === null, "handoff runtime: customers.resolve — id, then case-insensitive name");
  ok(customers.tierFor("c-alpha", "Pat Lee") === "base", "handoff runtime: customers.tierFor — an unknown tier value falls back to base");
  const manual = customers.travelFor("loc1", "c-alpha");
  ok(manual.miles === 12 && manual.minutes === 20, `handoff runtime: customers.travelFor — a venue's manual miles win (got ${JSON.stringify(manual)})`);
  configurePorts({ customers: EMPTY_CUSTOMERS });
  ok(customers.all().length === 0 && customers.resolve("Alpha Schools") === null, "handoff runtime: customers — an empty directory is fine");
  const none = customers.travelFor("loc1", "c-alpha");
  ok(none.miles === null && none.minutes === null && none.officeName === null, "handoff runtime: customers.travelFor — no venue → no estimate");

  // travel order: manual → geoCache → haversine (travel_rates) from the quoteDefault office
  const offices = [{ id: "a", name: "Far", lat: 40, lng: -80 }, { id: "hq", name: "HQ", lat: 43, lng: -89, quoteDefault: true }];
  const rates = { roadFactor: 2, mph: 60 };
  const cache = new Map([["43.0000,-89.0000|43.5000,-89.0000", { miles: 99, minutes: 77 }]]);
  ok(travelFromParts(offices, { lat: 43.5, lng: -89, travelMiles: 5, travelMin: 9 }, rates, cache).source === "manual", "handoff runtime: travel — manual first");
  const routed = travelFromParts(offices, { lat: 43.5, lng: -89 }, rates, cache);
  ok(routed.source === "routed" && routed.miles === 99 && routed.office?.name === "HQ", "handoff runtime: travel — then the geoCache route from the quoteDefault office");
  const auto = travelFromParts(offices, { lat: 43.6, lng: -89 }, rates, cache);
  ok(auto.source === "auto" && auto.miles === Math.round(41.46 * 2) && auto.minutes === Math.round((auto.miles! / 60) * 60), `handoff runtime: travel — then haversine × roadFactor at mph (got ${auto.miles} mi / ${auto.minutes} min)`);
  ok(travelFromParts(offices, { city: "Milwaukee", state: "WI" }, rates, cache).source === "auto", "handoff runtime: travel — a known city geocodes offline");
  ok(travelFromParts(offices, { city: "Nowhere", state: "ZZ" }, rates, cache).source === "none", "handoff runtime: travel — no coords → none");
  ok(travelFromParts([], { lat: 43.6, lng: -89, travelMiles: 10 }, rates, cache).miles === 10, "handoff runtime: travel — manual needs no office");

  // tiers: contact → company → base, margin from pricing_rules (`tiers.<tier>` percent) else the defaults
  const tierCustomers: SeedCustomers = {
    ...EMPTY_CUSTOMERS,
    companies: [{ id: "co", name: "Gold Co", pricingTier: "gold" }],
    contacts: [{ id: "k1", firstName: "Sil", lastName: "Ver", homeCompanyId: "co", pricingTier: "silver" }],
  };
  configurePorts({ customers: tierCustomers, rules: { settings: {}, blobs: { pricing_rules: { "tiers.gold": 18 } } } });
  ok(customers.tierFor("co", "Sil Ver") === "silver" && customers.tierFor("co") === "gold" && customers.tierFor("zz") === "base", "handoff runtime: customers.tierFor — contact, then company, then base");
  ok(resolveTierFor("co").margin === 0.18 && resolveTierFor("co", "Sil Ver").margin === 0.22 && resolveTierFor(null).margin === 0.3, "handoff runtime: resolveTierFor — Estimating Rules margin, else the tier default");

  // --- email / onWon / clock ---
  const actStore = await openStore({ quotes: docs([{ id: "Q-W", estNo: 1234, name: "Gym rigging" }]) }, { idb: null });
  configurePorts({ store: actStore });
  const sent = await email.send({ to: ["a@example.com"], subject: "Estimate", body: "Hi", quoteId: "Q-W" });
  const acts = await actStore.all<{ id: string; kind: string; quoteId: string }>("activity");
  ok(acts.length === 1 && acts[0].id === sent.id && acts[0].kind === "email" && acts[0].quoteId === "Q-W", "handoff runtime: email.send — writes one activity row, never sends");
  const won2 = await onWon.run("Q-W");
  ok(/^Would create install project/.test(won2.note) && won2.note.includes("Gym rigging"), `handoff runtime: onWon.run — a note, nothing created (got "${won2.note}")`);
  ok((await actStore.all("activity")).length === 2, "handoff runtime: onWon.run — logs its note to activity");
  ok(clock.timeZone === "America/Chicago" && Math.abs(clock.now() - Date.now()) < 1000, "handoff runtime: clock — Chicago, now");

  // --- buildEstimatorProps (in-memory store) ---
  const store = await storeFor(g);
  configurePorts({ store, customers: seedCustomers, rules, team: g.PEAK_TEAM as SeedTeamUser[] });
  const p = await buildEstimatorProps(store, "Q-G001", new URLSearchParams());
  ok(p.initial.loadedId === "Q-G001" && p.initial.customerId === "c-alpha" && p.initial.custName === "Alpha Schools" && p.initial.locationId === "loc1", "handoff runtime: props — a loaded quote's customer + venue");
  ok(p.initial.contactName === "Pat Lee", "handoff runtime: props — a blank attn resolves to the primary contact");
  ok(p.travel["c-alpha|loc1"]?.miles === 12, `handoff runtime: props — the travel seed for the loaded venue (got ${JSON.stringify(p.travel)})`);
  ok(Array.isArray(p.initial.sections) && p.initial.sections!.length > 0, "handoff runtime: props — sections loaded");
  ok(p.next !== null && typeof p.next === "object", "handoff runtime: props — next from quoteNextStepFor's rules");
  ok(p.blobUploads === false && p.vendorPdfEnabled === false && p.aiSource === null && p.assistDraft === null && p.suggestion === null, "handoff runtime: props — fixed off values");
  ok(p.quoteTasks.length === 0 && p.templateSets.length === 0 && p.specKeys.length === 0 && p.portalStatusError === null && p.canApplyCredit === false, "handoff runtime: props — fixed empty values");
  ok(p.customers.length === 2 && p.people.length === 2 && p.companyName === "Peak Systems Group", "handoff runtime: props — directory, roster, branding");
  ok(p.pipelines.quote.length > 0 && p.freightRule.capPct === 10 && p.curtainSewingPct === 10, "handoff runtime: props — pipelines and Estimating Rules defaults");
  ok(Array.isArray(p.fixtureAssemblies) && p.vendors.every((v, i, a) => i === 0 || a[i - 1].localeCompare(v) <= 0), "handoff runtime: props — assemblies + sorted vendor list");
  ok(p.viewerName === users.current().name && p.viewerCanApprove === users.can("approve"), "handoff runtime: props — the viewer is ports.users.current()");

  const fresh = await buildEstimatorProps(store, null, new URLSearchParams("customer=c-beta"));
  ok(fresh.initial.loadedId === null && fresh.initial.customerId === "c-beta" && fresh.initial.projectName === "Beta Church — System", "handoff runtime: props — a new estimate seeded from ?customer=");
  ok(fresh.initial.pricingTier === "base" && fresh.initial.tierMargin === 0.3 && fresh.next === null, "handoff runtime: props — a new estimate opens at its tier, no next step");
  const unknown = await buildEstimatorProps(store, "Q-NOPE", new URLSearchParams());
  ok(unknown.initial.loadedId === null && unknown.initial.projectName === "New estimate", "handoff runtime: props — an unknown id opens a clean estimate");

  await store.put("quotes", { ...(await store.get<{ id: string }>("quotes", "Q-G001"))!, name: "Overlay name" });
  ok((await buildEstimatorProps(store, "Q-G001", new URLSearchParams())).initial.projectName === "Overlay name", "handoff runtime: props — read through the overlay");

  // the dev slice has estimates but no customer tables — nothing may crash
  const bare = await openStore(storeSeedFrom({ estimates: g.PEAK_ESTIMATES as never, catalog: [], fixtures: [], rules: { settings: {}, blobs: {} }, meta: null }), { idb: null });
  configurePorts({ store: bare, customers: EMPTY_CUSTOMERS, rules: { settings: {}, blobs: {} }, team: [] });
  const b = await buildEstimatorProps(bare, "Q-G001", new URLSearchParams());
  ok(b.initial.custName === "Alpha Schools" && b.customers.length === 0 && b.travel["c-alpha|loc1"]?.miles === null, "handoff runtime: props — no customer tables: the quote's stored name, an empty travel seed");
  ok(b.companyName === "Peak Systems Group" && b.people.length === 1, "handoff runtime: props — empty settings + roster fall back to defaults");

  // --- verify --estimator's expected header total (the Estimator's load canonicalization) ---
  const golden = JSON.parse(fs.readFileSync(GOLDEN_EXPORT, "utf8")) as { collections: { quotes: Array<{ id: string; doc: Record<string, unknown> }> } };
  const gq = (id: string) => ({ ...golden.collections.quotes.find((r) => r.id === id)!.doc, id });
  const e1 = expectedEstimatorTotals(gq("Q-G001"), { blobs: {} });
  ok(e1.raw === 6744 && e1.canonical === 7225 && e1.priceRound && e1.bonusLines, `handoff runtime: expectedEstimatorTotals — Q-G001 golden 6744 → 7225 on screen (got ${e1.raw} → ${e1.canonical})`);
  const e2 = expectedEstimatorTotals(gq("Q-G002"), { blobs: {} });
  ok(e2.raw === 9100 && e2.canonical === 20150, `handoff runtime: expectedEstimatorTotals — Q-G002's ungrouped alternate is counted after normalizeSystemOrder (got ${e2.raw} → ${e2.canonical})`);
  const sentQ = expectedEstimatorTotals({ ...gq("Q-G001"), status: "sent" }, { blobs: {} });
  ok(sentQ.canonical === sentQ.raw && !sentQ.priceRound && !sentQ.bonusLines, "handoff runtime: expectedEstimatorTotals — a sent quote without bonus lines prices as stored");
}
