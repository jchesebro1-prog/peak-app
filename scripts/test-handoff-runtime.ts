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
import { DB_NAME, overlayFromRows, overlayMerge, openStore, RESET_BLOCKED_MESSAGE, storeSeedFrom, type HandoffStore } from "../handoff/estimator/runtime/store";
import {
  clock, configurePorts, customers, customersFrom, email, nextEstNoFrom, numbering, onWon, resolveTierFor, travelFromParts, users,
} from "../handoff/estimator/runtime/ports";
import { bySkuResolver, buildEstimatorProps } from "../handoff/estimator/runtime/props/estimator";
import type { SeedCustomers, SeedRules, SeedTeamUser } from "../handoff/estimator/runtime/seed";
import { sliceExport, type ExportV2 } from "../handoff/estimator/slice";
import { expectedEstimatorTotals } from "../handoff/estimator/verify";
import type { Ok } from "./test-inbox-org";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import type { SavePayload } from "@/app/(app)/estimator/actions";
import type { SpecSection } from "@/lib/estimating-core/types";
import { totals } from "@/lib/estimating-core/pricing";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { DEFAULT_BONUS_RATES } from "@/lib/estimate-bonus/flags";
import {
  applyUpdate, buildQuote, decideApprovalGate, isApprovalGateRefusal, nextQuoteId, pushRevision, resolveSaveStatusChange, STATUS_CHANGE_FAILED, statusFailureMessage,
} from "../handoff/estimator/runtime/quote-model";
import { quoteRepo, withLock } from "../handoff/estimator/runtime/quote-repo";
import { planSave, settleRewardCreditOffline, vendorQuotesForSave } from "../handoff/estimator/runtime/actions/save-core";
import { estimatorActions, refusedEstimatorActions, REFUSED_ESTIMATOR_ACTIONS } from "../handoff/estimator/runtime/actions/estimator-actions";
import { quotesActions } from "../handoff/estimator/runtime/actions/quotes-actions";
import { renameMapOf } from "../handoff/estimator/runtime/readers";

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


/**
 * A minimal in-memory IndexedDB — just what runtime/store.ts uses (open / upgrade, getAll / getAllKeys / put /
 * delete in a transaction, close, onversionchange, deleteDatabase with `blocked`). getAll returns rows in key
 * order, as the real thing does, so the stored `seq` is what restores the put order.
 */
function fakeIdb(opts: { failWrites?: boolean; failOpen?: boolean; deleteError?: boolean; versionchangeOnOpen?: boolean } = {}) {
  const data = new Map<string, { keyPath: string | null; rows: Map<string, { key: unknown; value: unknown }> }>();
  let exists = false;
  const calls = { opens: 0, deletes: 0 };
  const errors: unknown[] = []; // anything a connection's onversionchange handler threw
  const conns = new Set<{ onversionchange: null | (() => void); close(): void }>();
  const later = (fn: () => void, ms = 0) => void setTimeout(fn, ms);
  type Req = { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; onblocked?: () => void };

  function openConn() {
    const conn = {
      onversionchange: null as null | (() => void),
      close() { conns.delete(conn); },
      objectStoreNames: { contains: (n: string) => data.has(n) },
      createObjectStore(n: string, o?: { keyPath?: string }) { data.set(n, { keyPath: o?.keyPath ?? null, rows: new Map() }); },
      transaction(names: string[], mode: string) {
        if (mode === "readwrite" && opts.failWrites) throw new Error("QuotaExceededError (fake)");
        let pending = 0;
        const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: unknown; objectStore(n: string): unknown } = {
          objectStore(n: string) {
            const st = data.get(n);
            if (!names.includes(n) || !st) throw new Error(`no store ${n}`);
            const request = (fn: () => unknown) => {
              const r: Req = {};
              pending++;
              later(() => { r.result = fn(); pending--; r.onsuccess?.(); });
              return r;
            };
            const sorted = () => [...st.rows.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
            return {
              getAll: () => request(() => sorted().map((e) => e.value)),
              getAllKeys: () => request(() => sorted().map((e) => e.key)),
              put: (value: { id?: string }, key?: unknown) => request(() => { const k = st.keyPath ? (value as Record<string, unknown>)[st.keyPath] : key; st.rows.set(JSON.stringify(k), { key: k, value }); }),
              delete: (key: unknown) => request(() => void st.rows.delete(JSON.stringify(key))),
            };
          },
        };
        const finish = () => (pending > 0 ? later(finish) : void tx.oncomplete?.());
        later(finish);
        return tx;
      },
    };
    conns.add(conn);
    return conn;
  }

  const factory = {
    open() {
      const r: Req = {};
      calls.opens++;
      later(() => {
        if (opts.failOpen) {
          r.error = new Error("SecurityError (fake)");
          r.onerror?.();
          return;
        }
        const fresh = !exists;
        exists = true;
        const conn = openConn();
        r.result = conn;
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
        // another window starts a delete right as this one is still loading its overlay
        if (opts.versionchangeOnOpen) later(() => { try { conn.onversionchange?.(); } catch (e) { errors.push(e); } });
      });
      return r;
    },
    deleteDatabase() {
      const r: Req = {};
      calls.deletes++;
      later(() => {
        if (opts.deleteError) {
          r.error = new Error("delete failed (fake)");
          r.onerror?.();
          return;
        }
        for (const c of [...conns]) c.onversionchange?.();
        let warned = false;
        const wait = () => {
          if (conns.size > 0) {
            if (!warned) { warned = true; r.onblocked?.(); }
            return later(wait, 2);
          }
          data.clear();
          exists = false;
          r.result = undefined;
          r.onsuccess?.();
        };
        wait();
      });
      return r;
    },
  };
  return { factory: factory as unknown as IDBFactory, conns, data, calls, errors, hold: () => openConn() };
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

  // --- overlay order: seq, not id order, decides it after a reload ---
  const reloaded = overlayFromRows([
    { id: "a", seq: 30, doc: { id: "a" } },
    { id: "m", seq: 10, doc: { id: "m" } },
    { id: "z", seq: 20, doc: { id: "z" } },
    { id: "legacy" }, // a bare doc written before seq existed reads as seq 0
  ]);
  ok([...reloaded.keys()].join(",") === "legacy,m,z,a", `handoff runtime: overlayFromRows — put order by seq, not id order (got ${[...reloaded.keys()].join(",")})`);
  ok(ids(overlayMerge([{ id: "s" }], reloaded as Map<string, { id: string } | null>)) === "s,legacy,m,z,a", "handoff runtime: overlayFromRows → overlayMerge keeps the put order after the seed");

  // --- the IndexedDB overlay over a fake: persistence, order, versionchange, failed writes, reset ---
  {
    const fake = fakeIdb();
    const seedDocs = { meta: docs([{ id: "s1" }]), quotes: docs([{ id: "Q-S", name: "seed" }]) };
    const w1 = await openStore(seedDocs, { idb: fake.factory });
    ok(w1.persistent === true, "handoff runtime: idb store — opens persistent");
    let w1Changes = 0;
    w1.subscribe(() => void w1Changes++);
    await w1.put("meta", { id: "zeta" });
    await w1.put("meta", { id: "alpha" });
    await w1.put("meta", { id: "mid" });
    await w1.put("meta", { id: "zeta", again: true }); // a re-put moves to the end
    await w1.put("quotes", { id: "Q-S", name: "edited" });
    await w1.put("meta", { id: "gone" });
    await w1.remove("meta", "gone");
    await w1.remove("quotes", "Q-NOPE");
    const live = ids(await w1.all("meta"));
    ok(live === "s1,alpha,mid,zeta", `handoff runtime: idb store — in-session put order (got ${live})`);
    const w2 = await openStore(seedDocs, { idb: fake.factory }); // a reload: IndexedDB hands rows back in id order
    ok(w2.persistent === true && ids(await w2.all("meta")) === live, `handoff runtime: idb store — the put order survives a reload (got ${ids(await w2.all("meta"))})`);
    ok((await w2.get<{ name: string }>("quotes", "Q-S"))?.name === "edited" && (await w2.get("meta", "gone")) === undefined && (await w2.get("quotes", "Q-NOPE")) === undefined, "handoff runtime: idb store — edits and tombstones survive a reload");
    // another window resets: the first connection closes, the reset completes, the seed is back
    let w2Changes = 0;
    w2.subscribe(() => void w2Changes++);
    await w1.reset();
    ok(w1.persistent === true && ids(await w1.all("meta")) === "s1" && (await w1.get<{ name: string }>("quotes", "Q-S"))?.name === "seed", "handoff runtime: idb store — reset restores the seed and stays persistent");
    ok(w2.persistent === false && w2Changes === 1, `handoff runtime: idb store — another window's reset turns this one non-persistent and notifies once (changes ${w2Changes})`);
    ok(fake.conns.size === 1, `handoff runtime: idb store — only the resetting window holds a connection (got ${fake.conns.size})`);
    await w2.put("meta", { id: "late" });
    ok(ids(await w2.all("meta")) === "s1,alpha,mid,zeta,late", "handoff runtime: idb store — a non-persistent window keeps its edits and keeps editing in memory");
    const w3 = await openStore(seedDocs, { idb: fake.factory });
    ok(ids(await w3.all("meta")) === "s1", "handoff runtime: idb store — nothing the closed window wrote reached the database");
    await w1.put("meta", { id: "after-reset" });
    ok(ids(await (await openStore(seedDocs, { idb: fake.factory })).all("meta")) === "s1,after-reset", "handoff runtime: idb store — writes persist again after a reset");
    ok(w1Changes === 2, `handoff runtime: idb store — a reset reads non-persistent while it runs and persistent again after (changes ${w1Changes})`);
  }
  {
    const fake = fakeIdb({ failWrites: true });
    const w = await openStore({ meta: [] }, { idb: fake.factory });
    let n = 0;
    const off = w.subscribe(() => void n++);
    ok(w.persistent === true, "handoff runtime: idb store — a store whose writes will fail still opens persistent");
    await w.put("meta", { id: "x" });
    ok(w.persistent === false && n === 1 && ids(await w.all("meta")) === "x", "handoff runtime: idb store — the first failed write turns persistence off, notifies once, keeps the edit");
    await w.put("meta", { id: "y" });
    ok(n === 1 && ids(await w.all("meta")) === "x,y", "handoff runtime: idb store — later writes don't notify again");
    off();
  }
  {
    const fake = fakeIdb();
    const w = await openStore({ meta: docs([{ id: "s1" }]) }, { idb: fake.factory, resetTimeoutMs: 40 });
    await w.put("meta", { id: "mine" });
    const stuck = fake.hold(); // a window that never answers versionchange
    let msg = "";
    try {
      await w.reset();
    } catch (e) {
      msg = (e as Error).message;
    }
    ok(msg === RESET_BLOCKED_MESSAGE && /Close other prototype windows/.test(msg), `handoff runtime: idb store — a reset blocked by another window rejects with the close-windows message (got "${msg}")`);
    ok(w.persistent === false && ids(await w.all("meta")) === "s1,mine", "handoff runtime: idb store — a blocked reset leaves the overlay in place and turns this window non-persistent");
    stuck.close();
    const calls = fake.calls.deletes;
    ok(calls === 1, "handoff runtime: idb store — the rejected reset's deleteDatabase request was issued once (it stays queued in the browser)");
    ok(DB_NAME === "peak-estimator-handoff", "handoff runtime: idb store — database name");
  }

  // memory fallback (IndexedDB never opened): reset clears memory and never touches deleteDatabase
  {
    const fake = fakeIdb({ failOpen: true });
    const w = await openStore({ meta: docs([{ id: "s1" }]) }, { idb: fake.factory, resetTimeoutMs: 40 });
    ok(w.persistent === false, "handoff runtime: idb store — an open that fails falls back to memory, non-persistent");
    await w.put("meta", { id: "mine" });
    let n = 0;
    w.subscribe(() => void n++);
    let err = "";
    await w.reset().catch((e: Error) => void (err = e.message));
    ok(err === "" && ids(await w.all("meta")) === "s1" && fake.calls.deletes === 0 && n === 0,
      `handoff runtime: idb store — reset in the memory fallback clears the overlay without deleteDatabase (err "${err}", deletes ${fake.calls.deletes}, notifications ${n})`);
    await w.put("meta", { id: "again" });
    ok(ids(await w.all("meta")) === "s1,again" && w.persistent === false, "handoff runtime: idb store — the memory fallback keeps working after a reset");
  }
  // deleteDatabase fails with an error (not a timeout): memory is cleared, the reset resolves, the window stays non-persistent
  {
    const fake = fakeIdb({ deleteError: true });
    const w = await openStore({ meta: docs([{ id: "s1" }]) }, { idb: fake.factory, resetTimeoutMs: 40 });
    await w.put("meta", { id: "mine" });
    let err = "";
    await w.reset().catch((e: Error) => void (err = e.message));
    ok(err === "" && ids(await w.all("meta")) === "s1", `handoff runtime: idb store — a failed deleteDatabase still clears memory and resolves (err "${err}")`);
    ok(w.persistent === false && fake.calls.deletes === 1 && fake.calls.opens === 1, "handoff runtime: idb store — …and the window stays non-persistent without reopening the old database");
    await w.put("meta", { id: "after" });
    ok(ids(await w.all("meta")) === "s1,after" && ids(await (await openStore({ meta: docs([{ id: "s1" }]) }, { idb: fake.factory })).all("meta")) === "s1,mine", "handoff runtime: idb store — later edits stay in memory only");
  }
  // writes made while a reset runs are not reported as saved, and survive it
  {
    const fake = fakeIdb();
    const seedDocs = { meta: docs([{ id: "s1" }]) };
    const w = await openStore(seedDocs, { idb: fake.factory });
    await w.put("meta", { id: "before" });
    const seen: boolean[] = [];
    w.subscribe(() => void seen.push(w.persistent));
    const r = w.reset();
    ok(w.persistent === false, "handoff runtime: idb store — a store reads non-persistent while its reset runs");
    const p1 = w.put("meta", { id: "mid1" });
    const p2 = w.remove("meta", "s1");
    await Promise.all([r, p1, p2]);
    ok(ids(await w.all("meta")) === "mid1" && (await w.get("meta", "before")) === undefined, `handoff runtime: idb store — mid-reset writes survive the reset, older ones are gone (got ${ids(await w.all("meta"))})`);
    ok(w.persistent === true && seen.join() === "false,true", `handoff runtime: idb store — persistent again after the flush (notified ${seen.join()})`);
    const w2 = await openStore(seedDocs, { idb: fake.factory });
    ok(ids(await w2.all("meta")) === "mid1", `handoff runtime: idb store — the mid-reset writes reached the new database (a reload sees ${ids(await w2.all("meta"))})`);
    // a flush that fails is not reported as saved
    const o = { failWrites: false };
    const bad = fakeIdb(o);
    const wb = await openStore(seedDocs, { idb: bad.factory });
    o.failWrites = true; // the fresh database refuses writes
    const rb = wb.reset();
    const pb = wb.put("meta", { id: "x" });
    await Promise.all([rb, pb]);
    ok(wb.persistent === false && ids(await wb.all("meta")) === "s1,x", "handoff runtime: idb store — a mid-reset write that can't be flushed keeps the doc and leaves the window non-persistent");
  }
  // a versionchange that fires while the overlay is still loading must not throw (state is declared before watch())
  {
    const fake = fakeIdb({ versionchangeOnOpen: true });
    const w = await openStore({ meta: docs([{ id: "s1" }]) }, { idb: fake.factory });
    await new Promise((res) => setTimeout(res, 20));
    ok(fake.errors.length === 0, `handoff runtime: idb store — a versionchange during startup does not throw (${fake.errors.map((e) => (e as Error).message).join("; ")})`);
    ok(w.persistent === false && fake.conns.size === 0 && ids(await w.all("meta")) === "s1", "handoff runtime: idb store — …it closes the connection and the window reads non-persistent");
    await w.put("meta", { id: "x" });
    ok(ids(await w.all("meta")) === "s1,x" && w.persistent === false, "handoff runtime: idb store — a skipped write is never reported as saved (stays non-persistent, edit kept in memory)");
  }

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

  // a legacy stage key and no pipelineId read as the app's getQuote reads them (normalizeQuotePipeline)
  const q1 = (await store.get<Record<string, unknown>>("quotes", "Q-G001"))!;
  const q1NoPipe: Record<string, unknown> = { ...q1 };
  delete q1NoPipe.pipelineId;
  await store.put("quotes", { ...q1NoPipe, id: "Q-G001", status: "sent", stage: "legacy-proposal-xyz" } as { id: string });
  const legacy = await buildEstimatorProps(store, "Q-G001", new URLSearchParams());
  const defPipe = legacy.pipelines.quote.find((pl) => pl.id === legacy.pipelines.defaultQuotePipelineId)!;
  const sentStage = defPipe.stages.find((st) => st.tag === "sent")!;
  ok(legacy.initial.pipelineId === defPipe.id && legacy.initial.stage === sentStage.id,
    `handoff runtime: props — a legacy stage + no pipelineId normalize on read to the default pipeline's sent stage (got ${legacy.initial.pipelineId}/${legacy.initial.stage}, want ${defPipe.id}/${sentStage.id})`);
  ok(((await store.get<{ stage?: string }>("quotes", "Q-G001")))?.stage === "legacy-proposal-xyz", "handoff runtime: props — normalizing never writes back to the store");
  // …and the stored default pipeline (settings.defaultQuotePipelineId, as Settings → Pipelines saves it) decides which one
  const settingsRow = (await store.get<{ id: string; data: Record<string, unknown> }>("settings", "main"))!;
  await store.put("settings", { ...settingsRow, data: { ...settingsRow.data, defaultQuotePipelineId: "bid-spec" } });
  const bidDefault = await buildEstimatorProps(store, "Q-G001", new URLSearchParams());
  ok(bidDefault.pipelines.defaultQuotePipelineId === "bid-spec" && bidDefault.initial.pipelineId === "bid-spec" && bidDefault.initial.stage === "bid-sent",
    `handoff runtime: props — a stored defaultQuotePipelineId drives the default pipeline and the legacy quote's normalization (got ${bidDefault.pipelines.defaultQuotePipelineId}/${bidDefault.initial.pipelineId}/${bidDefault.initial.stage})`);
  await store.put("settings", { ...settingsRow, data: { ...settingsRow.data, defaultQuotePipelineId: "no-such-pipeline" } });
  ok((await buildEstimatorProps(store, "Q-G001", new URLSearchParams())).pipelines.defaultQuotePipelineId === "estimate-design", "handoff runtime: props — an unknown stored default falls back to the app's");
  await store.put("settings", settingsRow);
  await store.put("quotes", q1 as { id: string });

  // renamed SKUs: an old sku resolves to the part it became (catalog getManyBySku)
  const parts = [{ sku: "Brand:New 1" }, { sku: "LIVE-1" }];
  const renames = new Map([
    ["OLD-1", "MID-1"], ["MID-1", "Brand:New 1"], ["LOOP-A", "LOOP-B"], ["LOOP-B", "LOOP-A"], ["GONE-1", "NOT-THERE"],
    ["H0", "H1"], ["H1", "H2"], ["H2", "H3"], ["H3", "H4"], ["H4", "H5"], ["H5", "H6"], ["H6", "H7"], ["H7", "H8"], ["H8", "LIVE-1"],
  ]);
  const res = bySkuResolver(parts, renames);
  ok(res("Brand:New 1")?.sku === "Brand:New 1" && res("LIVE-1")?.sku === "LIVE-1" && res("OLD-1")?.sku === "Brand:New 1" && res("MID-1")?.sku === "Brand:New 1",
    "handoff runtime: bySkuResolver — live skus resolve to themselves, retired ones follow renames through the chain");
  ok(res("LOOP-A") === undefined && res("GONE-1") === undefined && res("nope") === undefined, "handoff runtime: bySkuResolver — a cycle, a dead redirect and an unknown sku are absent");
  ok(res("H1")?.sku === "LIVE-1" && res("H0") === undefined, "handoff runtime: bySkuResolver — at most 8 hops (H1 is 8 away, H0 is 9)");
  ok(bySkuResolver(parts)("OLD-1") === undefined && bySkuResolver(parts)("LIVE-1")?.sku === "LIVE-1", "handoff runtime: bySkuResolver — no renames given: live skus only");
  // stubs are split out of the catalog at the seed: no reader of the catalog collection can list a blank part
  const split = storeSeedFrom({
    estimates: [], fixtures: [], rules: { settings: {}, blobs: {} }, meta: null,
    catalog: [{ id: "OLD-1", sku: "OLD-1", renamedTo: "Brand:New 1" }, { id: "Brand:New 1", sku: "Brand:New 1", desc: "New thing" }, { id: "OLD-2", renamedTo: "Brand:New 1" }],
  });
  ok((split.catalog ?? []).map((x) => x.id).join() === "Brand:New 1" && (split.catalogRenames ?? []).map((x) => `${x.sku}>${x.renamedTo}`).join() === "OLD-1>Brand:New 1,OLD-2>Brand:New 1",
    "handoff runtime: storeSeedFrom — retired stubs leave the catalog and become catalogRenames (a stub without sku keys on its id)");
  const splitStore = await openStore(split, { idb: null });
  ok((await splitStore.all<{ id: string }>("catalog")).map((x) => x.id).join() === "Brand:New 1" && splitStore.catalogRenames.get("OLD-1") === "Brand:New 1" && (await splitStore.get("catalog", "OLD-1")) === undefined,
    "handoff runtime: store — all(\"catalog\") / get never see a retired stub; catalogRenames hands the redirects to the resolver");
  const renStore = await openStore(
    {
      catalog: docs([{ id: "Brand:New 1", sku: "Brand:New 1", desc: "New thing", unit: "ea", cost: 10, list: 20 }]),
      catalogRenames: [{ id: "OLD-1", sku: "OLD-1", renamedTo: "Brand:New 1" }],
      blobs: docs([{ id: "system_categories", data: { categories: [{ id: "cat-x", name: "Retired SKU", items: [{ sku: "OLD-1", qty: 2 }] }] } }]),
      quotes: [],
    },
    { idb: null },
  );
  configurePorts({ store: renStore, customers: EMPTY_CUSTOMERS, rules: { settings: {}, blobs: {} }, team: [] });
  const ren = await buildEstimatorProps(renStore, null, new URLSearchParams());
  const renItem = ren.initial.systemCategories.find((c) => c.id === "cat-x")?.items[0];
  ok(renItem?.part?.sku === "Brand:New 1" && renItem.part.desc === "New thing" && renItem.part.cost === 10, `handoff runtime: props — a system-category item with a retired sku resolves to the renamed part (got ${JSON.stringify(renItem?.part)})`);
  configurePorts({ store, customers: seedCustomers, rules, team: g.PEAK_TEAM as SeedTeamUser[] });

  // venue order: primary first, then createdAt, then id (venue-types compareVenueOrder)
  const venueDir: SeedCustomers = {
    ...EMPTY_CUSTOMERS,
    companies: [{ id: "co", name: "Order Co" }],
    sites: [
      { id: "s-b", companyId: "co", name: "B", legacyLocId: "locB", createdAt: 200 },
      { id: "s-a", companyId: "co", name: "A", legacyLocId: "locA", createdAt: 300 },
      { id: "s-p", companyId: "co", name: "P", legacyLocId: "locP", isPrimary: true, createdAt: 900 },
      { id: "s-old", companyId: "co", name: "Old", legacyLocId: "locOld", createdAt: 100 },
      { id: "s-c1", companyId: "co", name: "C1", legacyLocId: "locC1", createdAt: 200 },
    ],
  };
  ok(customersFrom(venueDir)[0].locations.map((l) => l.id).join(",") === "locP,locOld,locB,locC1,locA",
    `handoff runtime: customers — venues order primary → createdAt → id (got ${customersFrom(venueDir)[0].locations.map((l) => l.id).join(",")})`);

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

  await handoffActionChecks(ok);
}

/* ------------------------------------------------------------------ PR 2 Task 4: the Estimator's actions in the browser */

const sec = (id: string, items: Array<Partial<SpecSection["items"][number]>>, extra: Partial<SpecSection> = {}): SpecSection =>
  ({ id, name: id, kind: "lighting", freightPct: 0, items: items.map((it, i) => ({ id: i + 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 50, price: 100, ...it })), ...extra }) as SpecSection;

const payloadFor = (sections: SpecSection[], over: Partial<SavePayload> = {}): SavePayload => {
  const t = totals(sections, 0);
  return {
    name: "Test estimate", customer: "", customerId: null, locationId: null, contactName: "", quoteNote: "", assumptions: "", installTimeframe: "TBD",
    paymentTerms: "Unknown", category: "", value: t.grand, margin: t.margin, status: "draft", baseStatus: "draft", sections, mobs: [], groups: [],
    vendorQuotes: [], pdfOptions: { pdfQty: true, pdfNotes: true, pdfCover: true, pdfTerms: true, pdfOptions: true, pdfPrices: true, pdfItemizedAppendix: false, pdfCutSheets: false } as SavePayload["pdfOptions"],
    ...over,
  };
};

export async function handoffActionChecks(ok: Ok) {
  // --- quote-model (pure ports of stores/quotes) ---
  ok(nextQuoteId(["Q-2044", "Q-G001", "L-9999"]).id === "Q-2045" && nextQuoteId([]).id === "Q-2042" && nextQuoteId(["Q-2044"], 2050).id === "Q-2051",
    "handoff actions: nextQuoteId — one past the highest Q-<n>, the last minted, and the 2041 base");
  ok(resolveSaveStatusChange("draft", "draft", "draft").kind === "unchanged" && resolveSaveStatusChange("sent", "draft", "draft").kind === "apply"
    && resolveSaveStatusChange("draft", "draft", "sent").kind === "stalePassive" && resolveSaveStatusChange("won", "draft", "sent").kind === "staleConflict",
    "handoff actions: resolveSaveStatusChange — unchanged / apply / stalePassive / staleConflict");
  const built = buildQuote("Q-9", { name: "", owner: "Ann", value: 10.6, source: "estimator" }, "system", { id: "p", label: "P", stages: [{ id: "st1", label: "One", tag: "draft" }] }, 5);
  ok(built.name === "Untitled estimate" && built.preparedBy === "Ann" && built.value === 11 && built.status === "draft" && built.pipelineId === "p" && built.stage === "st1"
    && built.history.length === 1 && built.review.state === "none" && built.createdAt === 5, "handoff actions: buildQuote — create()'s document (defaults, rounded value, first stage, history)");
  const upd = applyUpdate({ ...built }, { name: "N", value: 99.4, estNo: 7, bonusRecord: { x: 1 }, packageSelection: { drawings: false }, wonRev: 3 } as unknown as Partial<Quote>, 77);
  ok(upd.name === "N" && upd.value === 99 && upd.updatedAt === 77 && upd.estNo === undefined && upd.bonusRecord === undefined && upd.packageSelection === undefined && upd.wonRev === undefined,
    "handoff actions: applyUpdate — merges, rounds value, bumps updatedAt, never writes a number or an owned field");
  const revDoc = { ...built, revisions: [] as QuoteRevision[] };
  pushRevision(revDoc, "Ann", "manual", "m", 1);
  const sentRev = pushRevision(revDoc, "Ann", "sent", "Sent to customer", 2);
  ok(revDoc.revisions.length === 2 && sentRev.rev === 2 && sentRev.docFields?.revNo === 1 && sentRev.spec === null, "handoff actions: pushRevision — 1-based revs; a sent one stamps the next Rev");
  const ctx = { limits: {}, roster: [{ id: "u1", name: "Ann", status: "active", canApprove: true }, { id: "u2", name: "Eve", status: "active", canApprove: false }] };
  const g1 = decideApprovalGate("sent", { ...built, owner: "Eve" }, ctx, {}, 1, "Eve");
  ok(!g1.ok && /approval on record before it can be sent/.test(g1.error), "handoff actions: decideApprovalGate — a non-approver can't send an unapproved quote");
  const g2 = decideApprovalGate("sent", { ...built, owner: "Ann" }, ctx, {}, 1, "Ann");
  ok(g2.ok && g2.stamp?.method === "self" && g2.stamp.decidedBy === "Ann", "handoff actions: decideApprovalGate — an approver owner self-approves on send");
  ok(decideApprovalGate("lost", { ...built }, ctx).ok, "handoff actions: decideApprovalGate — lost / draft are never gated");
  ok(statusFailureMessage(new Error("boom"), "test (expected log)") === STATUS_CHANGE_FAILED, "handoff actions: statusFailureMessage — a defect reads as the generic line");

  // --- save-core (the pure half of saveQuoteAction) ---
  const rewrite = <T,>(x: T) => x;
  const tier = { tier: "base", margin: 0.3 };
  const s1 = [sec("sysA", [{ qty: 2, cost: 50, price: 100 }, { sku: "LAB", qty: 4, cost: 20, price: 40, labor: true }])];
  const plan1 = planSave(null, payloadFor(s1), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(plan1.ok && plan1.patch.spec!.sections[0].items.some(isBonusItem), "handoff actions: planSave — a new draft gets its bonus lines server-side");
  ok(plan1.ok && Math.abs((plan1.patch.value ?? 0) - totals(plan1.patch.spec!.sections, 0).grand) < 0.01 && plan1.patch.pricingTier === "base" && plan1.patch.source === "estimator",
    "handoff actions: planSave — value is the server's own totals() over the stored sections; tier + source stamped");
  const wrongValue = planSave(null, payloadFor(s1, { value: 1 }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(wrongValue.ok && wrongValue.valueAdjusted && wrongValue.patch.value !== 1, "handoff actions: planSave — a posted value that disagrees is replaced, never trusted");
  const neg = planSave(null, payloadFor([sec("n", [{ price: -5 }])]), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(!neg.ok && neg.refusedBeforeWrite === "credit", "handoff actions: planSave — a negative line outside the credit line refuses the save");
  const bigDoc = planSave(null, payloadFor(s1, { document: { type: "doc", content: "x".repeat(10) } as unknown as SavePayload["document"] }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(bigDoc.ok || bigDoc.refusedBeforeWrite === "document", "handoff actions: planSave — a malformed document is sanitized or refused before any write");
  const keepGroups = planSave({ ...built, spec: { sections: [], groups: [{ id: "g-base", name: "Base" }] } } as Quote, payloadFor(s1, { groups: undefined }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(keepGroups.ok && keepGroups.patch.spec!.groups?.[0]?.id === "g-base", "handoff actions: planSave — an older caller without groups keeps the stored ones");
  ok(settleRewardCreditOffline(s1, null).ok, "handoff actions: settleRewardCreditOffline — no credit line, nothing to settle");
  const vqSecs = [sec("v", [{ vendorQuoteId: "vq-live" }])];
  const vqs = vendorQuotesForSave(
    { vendorQuotes: [{ id: "vq-rev", vendor: "Old" }], revisions: [{ spec: { sections: [sec("r", [{ vendorQuoteId: "vq-rev" }])] } } as unknown as QuoteRevision] },
    [{ id: "vq-live", vendor: "A" }, { id: "vq-orphan", vendor: "B" }] as never,
    vqSecs, 1000, () => false,
  );
  ok(vqs.map((v) => v.id).sort().join() === "vq-live,vq-rev", `handoff actions: vendorQuotesForSave — keeps what a live line or a revision names, drops orphans (got ${vqs.map((v) => v.id).join()})`);
  ok(renameMapOf(new Map([["a", "b"], ["b", "c"], ["x", "y"], ["y", "x"]])).get("a") === "c", "handoff actions: renameMapOf — a chain collapses");

  // --- the store-backed repo + actions on the export-v2 slice ---
  const exp = JSON.parse(fs.readFileSync(FIXTURE_V2, "utf8")) as ExportV2;
  const g = sliceGlobals(sliceExport(exp).files);
  const store = await storeFor(g);
  const team: SeedTeamUser[] = [
    { id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" },
    { id: "u2", name: "Eve Estimator", roles: ["Estimator"], status: "active" },
  ];
  configurePorts({ store, customers: g.PEAK_CUSTOMERS as SeedCustomers, rules: g.PEAK_RULES as SeedRules, team });
  users.setCurrent("u1");
  const repo = quoteRepo(store);
  const maxSeedNo = Math.max(...(await store.all<{ estNo?: number }>("quotes")).map((q) => q.estNo ?? 0));
  const [c1, c2] = await Promise.all([repo.create({ name: "One", source: "estimator", owner: "Ann Admin" }), repo.create({ name: "Two", source: "estimator", owner: "Ann Admin" })]);
  ok(c1.id !== c2.id && c1.estNo !== c2.estNo && (c1.estNo ?? 0) > maxSeedNo && (c2.estNo ?? 0) > maxSeedNo,
    `handoff actions: repo.create — concurrent creates get distinct ids and numbers above the seed (${c1.id}/${c1.estNo}, ${c2.id}/${c2.estNo})`);
  await repo.remove(c2.id);
  const c3 = await repo.create({ name: "Three" });
  ok(c3.id !== c2.id && (await repo.get(c2.id)) === null, "handoff actions: repo.remove tombstones; a deleted id is never minted again");
  const order: string[] = [];
  await Promise.all([withLock("k", async () => { await new Promise((r) => setTimeout(r, 5)); order.push("a"); }), withLock("k", async () => void order.push("b"))]);
  ok(order.join() === "a,b", "handoff actions: withLock — one key's calls run one after another");

  // status: a non-approver is refused on send; an approver self-approves, cuts the sent revision and snaps the stage
  users.setCurrent("u2");
  let refused: unknown = null;
  try { await repo.setStatus(c1.id, "sent", "Eve Estimator"); } catch (e) { refused = e; }
  ok(isApprovalGateRefusal(refused) && (await repo.get(c1.id))?.status === "draft", "handoff actions: repo.setStatus — the gate refuses an unapproved send (typed, nothing written)");
  users.setCurrent("u1");
  const sentQ = await repo.setStatus(c1.id, "sent", "Ann Admin");
  ok(sentQ?.status === "sent" && sentQ.review.method === "self" && sentQ.revisions?.at(-1)?.reason === "sent" && sentQ.history.at(-1)?.to === "sent",
    "handoff actions: repo.setStatus — an approver owner's send stamps the approval, history and the sent revision");
  const wonQ = await repo.setStatus(c1.id, "won", "Ann Admin");
  const acts = await store.all<{ kind: string; quoteId: string }>("activity");
  ok(wonQ?.status === "won" && typeof wonQ.wonRev === "number" && acts.some((a) => a.kind === "won" && a.quoteId === c1.id), "handoff actions: repo.setStatus — Won records the won version and runs the onWon port (an activity row)");
  ok((await repo.setQuotePipeline(c1.id, "bid-spec")) === null, "handoff actions: repo.setQuotePipeline — refused outside draft");
  ok((await repo.setStatus(c1.id, "won", "Ann Admin"))?.history.length === wonQ?.history.length, "handoff actions: repo.setStatus — a same-status move is a no-op");

  // the actions themselves
  const A = estimatorActions(store);
  const QA = quotesActions(store);
  const q1 = (await store.get<Quote>("quotes", "Q-G001"))!;
  const sections = (q1.spec as { sections: SpecSection[] }).sections;
  const save1 = await A.saveQuoteAction("Q-G001", payloadFor(sections, { name: "Edited name", customer: "Alpha Schools", customerId: "c-alpha", contactName: "Pat Lee", status: q1.status, baseStatus: q1.status }));
  const after1 = (await repo.get("Q-G001"))!;
  ok(save1.ok && save1.id === "Q-G001" && after1.name === "Edited name" && save1.number === "EST-9001" && save1.updatedAt === after1.updatedAt,
    `handoff actions: saveQuoteAction — an update writes the header and returns the id, number and version (${JSON.stringify({ ok: save1.ok, err: save1.error, n: save1.number })})`);
  ok(after1.value === Math.round(totals((after1.spec as { sections: SpecSection[] }).sections, 0).grand) && (after1.spec as { sections: SpecSection[] }).sections.some((x) => x.items.some(isBonusItem)),
    "handoff actions: saveQuoteAction — the stored sections carry the re-derived bonus lines and the stored value is their total (a re-open shows the same total)");
  ok(save1.next !== undefined && save1.pdf === null && save1.rewardCredit === 0, "handoff actions: saveQuoteAction — next-step view, no PDF, no credit");
  const created = await A.saveQuoteAction(null, payloadFor([sec("sysN", [{ qty: 1 }])], { name: "Brand new" }));
  const createdDoc = created.id ? await repo.get(created.id) : null;
  ok(created.ok && !!createdDoc && createdDoc.owner === "Ann Admin" && createdDoc.status === "draft" && /^EST-\d+$/.test(created.number ?? "") && created.pipelineId !== null,
    `handoff actions: saveQuoteAction — a create mints the quote, numbers it and enters the pipeline (${created.id} ${created.number})`);
  const stale = await A.saveQuoteAction(created.id, payloadFor([sec("sysN", [{ qty: 1 }])], { status: "lost", baseStatus: "sent" }));
  ok(!stale.ok && /changed elsewhere/.test(stale.error ?? "") && (await repo.get(created.id!))?.status === "draft", "handoff actions: saveQuoteAction — a stale tab's status change is refused, the edits still save");
  users.setCurrent("u2");
  const gated = await A.saveQuoteAction(created.id, payloadFor([sec("sysN", [{ qty: 1 }])], { status: "sent", baseStatus: "draft" }));
  ok(!gated.ok && /approval on record/.test(gated.error ?? "") && gated.id === created.id, "handoff actions: saveQuoteAction — a refused status advance keeps the id (the quote saved)");
  users.setCurrent("u1");
  const sa = await A.setStatusAction(created.id!, "lost");
  ok(sa.ok && sa.status === "lost", "handoff actions: setStatusAction — lost is open to anyone");
  const back = await A.setStatusAction(created.id!, "draft");
  ok(back.ok && back.status === "draft", "handoff actions: setStatusAction — back to draft");
  const bogus = await A.setStatusAction(created.id!, "nope" as never);
  ok(!bogus.ok && bogus.status === null, "handoff actions: setStatusAction — an unknown status is refused");

  const nameBefore = (await repo.get(created.id!))!.name;
  const meta = await A.updateQuoteMetaAction(created.id!, { quoteNote: "Note!", name: "  ", status: "won", value: 1 } as never);
  const metaDoc = (await repo.get(created.id!))!;
  ok(meta.ok && metaDoc.quoteNote === "Note!" && metaDoc.name === nameBefore && metaDoc.status === "draft" && metaDoc.value !== 1,
    `handoff actions: updateQuoteMetaAction — the header allowlist only (blank name kept; status/value ignored) (got ${JSON.stringify({ ok: meta.ok, note: metaDoc.quoteNote, name: metaDoc.name, status: metaDoc.status, value: metaDoc.value })})`);
  const sel = await A.updateQuoteMetaAction(created.id!, { packageSelection: { drawings: false } });
  ok(sel.ok && (await repo.get(created.id!))?.packageSelection?.drawings === false, "handoff actions: updateQuoteMetaAction — the package selection merges through its own writer");

  const ppl = await A.setQuotePeopleAction(created.id!, { preparedBy: "Eve Estimator" });
  ok(ppl.ok && ppl.preparedBy === "Eve Estimator" && (await repo.get(created.id!))?.preparedBy === "Eve Estimator", "handoff actions: setQuotePeopleAction — a roster name saves");
  const pplBad = await A.setQuotePeopleAction(created.id!, { owner: "Nobody Here" });
  ok(!pplBad.ok && pplBad.error === "Pick someone on the team.", "handoff actions: setQuotePeopleAction — an unknown name is refused");
  users.setCurrent("u2");
  const pplTake = await A.setQuotePeopleAction(created.id!, { owner: "Eve Estimator" });
  ok(pplTake.ok && pplTake.owner === "Eve Estimator", "handoff actions: setQuotePeopleAction — anyone with create may take a quote over");
  const pplHand = await A.setQuotePeopleAction(created.id!, { owner: "Ann Admin" });
  ok(!pplHand.ok && /Only an approver/.test(pplHand.error ?? ""), "handoff actions: setQuotePeopleAction — a non-approver can't hand the lead to someone else (users.can)");
  const split = await A.saveBonusSplitAction(created.id!, 60);
  ok(!split.ok, "handoff actions: saveBonusSplitAction — approvers only");
  users.setCurrent("u1");
  ok((await A.saveBonusSplitAction(created.id!, 60)).ok && (await repo.get(created.id!))?.estimatorBonusSplit?.leadPct === 60, "handoff actions: saveBonusSplitAction — stores the split");
  ok((await A.saveBonusAlternatesAction(created.id!, [])).error === "Only a won estimate records alternates here", "handoff actions: saveBonusAlternatesAction — won estimates only");

  const pipeIds = (await buildEstimatorProps(store, created.id, new URLSearchParams())).pipelines.quote.map((x) => x.id);
  const curPipe = (await repo.get(created.id!))?.pipelineId;
  const other = pipeIds.find((x) => x !== curPipe);
  if (other) {
    const sp = await A.setQuotePipelineAction(created.id!, other);
    ok(sp.ok && sp.pipelineId === other, "handoff actions: setQuotePipelineAction — a draft switches pipeline, first stage");
  }
  const stageBad = await A.setQuoteStageAction(created.id!, "no-such-stage");
  ok(!stageBad.ok && /stage isn't available/.test(stageBad.error ?? ""), "handoff actions: setQuoteStageAction — a stage outside the pipeline is refused");

  // catalog: search, resolve, custom part
  const catStore = await openStore({ catalog: docs([
    { id: "ETC:CS40", sku: "ETC:CS40", desc: "ColorSource 40 console", category: "Lighting Controls", unit: "ea", cost: 3000, list: 4500, mfr: "ETC" },
    { id: "ETC:CSPAR", sku: "ETC:CSPAR", desc: "ColorSource PAR, XLR, black", category: "Fixtures", unit: "ea", cost: 600, list: 900, mfr: "ETC" },
    { id: "XX:1", sku: "XX:1", desc: "Unrelated", category: "Audio", unit: "ea", cost: 1, list: 2, mfr: "Other" },
  ]), quotes: [] }, { idb: null });
  const CA = estimatorActions(catStore);
  const found = await CA.searchCatalog("ColorSource");
  ok(found.total === 2 && found.hits.every((h) => h.sku.startsWith("ETC:CS")) && found.hits[0].list > 0, `handoff actions: searchCatalog — ranks the local catalog (got ${found.hits.map((h) => h.sku).join()})`);
  ok((await CA.searchCatalog("", "")).total === 0 && (await CA.searchCatalog("", "Audio")).hits[0]?.sku === "XX:1", "handoff actions: searchCatalog — blank query = nothing; a category alone lists it");
  const resolved = await CA.resolveCatalogSkusAction(["etc:cs40", "NOPE"]);
  ok(resolved["etc:cs40"]?.sku === "ETC:CS40" && !("NOPE" in resolved), "handoff actions: resolveCatalogSkusAction — case-insensitive, keyed as asked, unknown absent");
  const dup = await CA.saveEstimatorCustomPartAction({ sku: "ETC:CS40", desc: "d", category: "", unit: "", cost: 1, list: 2, mfr: "", manufacturerPartNumber: "", priceGoodThrough: "" });
  ok(!dup.ok && /already in the catalog/.test(dup.error), "handoff actions: saveEstimatorCustomPartAction — never overwrites a live part");
  const made = await CA.saveEstimatorCustomPartAction({ sku: "CUST-1", desc: "Custom thing", category: "", unit: "", cost: 5, list: 9, mfr: "", manufacturerPartNumber: "", priceGoodThrough: "2026-12-31" });
  const madeDoc = await catStore.get<{ category: string; note: string }>("catalog", "CUST-1");
  ok(made.ok && madeDoc?.category === "Custom Parts" && madeDoc.note === "Price good through 2026-12-31" && (await CA.searchCatalog("Custom thing")).total === 1,
    "handoff actions: saveEstimatorCustomPartAction — writes the catalog overlay; searchable at once");
  ok(!(await CA.saveEstimatorCustomPartAction({ sku: "custom", desc: "x", category: "", unit: "", cost: 1, list: 2, mfr: "", manufacturerPartNumber: "", priceGoodThrough: "" })).ok, "handoff actions: saveEstimatorCustomPartAction — CUSTOM is not a SKU");
  configurePorts({ store, customers: g.PEAK_CUSTOMERS as SeedCustomers, rules: g.PEAK_RULES as SeedRules, team });

  // tiers / travel through the customers port
  const tierR = await A.resolveTierAction("c-alpha", "Pat Lee");
  ok(tierR.ok && tierR.pricingTier === "base" && tierR.label === "Base", `handoff actions: resolveTierAction — via ports (got ${JSON.stringify(tierR)})`);
  ok((await A.travelForSelectionAction("c-alpha", "loc1"))?.miles === 12 && (await A.travelForSelectionAction(null, null)) === null && (await A.travelForSelectionAction("zz", null)) === null,
    "handoff actions: travelForSelectionAction — the venue's travel; no customer / unknown customer → null");

  // search / move / copy
  const hits = await A.searchQuotesAction("9001", null);
  ok(hits[0]?.id === "Q-G001" && hits[0].number === "EST-9001", "handoff actions: searchQuotesAction — the estimate number ranks first");
  ok((await A.searchQuotesAction("", "Q-G001")).every((h) => h.id !== "Q-G001"), "handoff actions: searchQuotesAction — excludes the source");
  const ctxSrc = { customerId: "c-alpha", locationId: "loc1", customer: "Alpha Schools", contactName: "Pat Lee" };
  const mv = await A.moveSystemToEstimateAction(sections[0], { kind: "new" }, ctxSrc, [], "Q-G001");
  const mvDoc = mv.ok ? await repo.get(mv.targetId) : null;
  ok(mv.ok && !!mvDoc?.name.endsWith("(moved)") && mvDoc.customerId === "c-alpha" && mvDoc.contactName === "Pat Lee" && (mvDoc.spec as { sections: SpecSection[] }).sections.length === 1,
    "handoff actions: moveSystemToEstimateAction — a new estimate for the source's customer, with the system");
  const before = ((await repo.get(created.id!))!.spec as { sections: SpecSection[] }).sections.length;
  const mvEx = await A.moveSystemToEstimateAction(sections[0], { kind: "existing", quoteId: created.id! }, ctxSrc);
  const exSecs = ((await repo.get(created.id!))!.spec as { sections: SpecSection[] }).sections;
  const exIds = exSecs.flatMap((x) => x.items.map((it) => `${x.id}:${it.id}`));
  ok(mvEx.ok && exSecs.length === before + 1 && new Set(exIds).size === exIds.length, "handoff actions: moveSystemToEstimateAction — an existing target gains the system, ids unique");
  const vqSec = sec("sysVQ", [{ vendorQuoteId: "vq-carry", sku: "VQ" }, { sku: "PLAIN" }]);
  const mvVq = await A.moveSystemToEstimateAction(vqSec, { kind: "existing", quoteId: created.id! }, ctxSrc, [{ id: "vq-carry", vendor: "Vend" }, { id: "vq-stray", vendor: "Other" }] as never);
  const tgtVq = ((await repo.get(created.id!))!.vendorQuotes ?? []) as Array<{ id: string; addedAt?: number }>;
  ok(mvVq.ok && tgtVq.map((v) => v.id).join() === "vq-carry" && typeof tgtVq[0].addedAt === "number",
    `handoff actions: moveSystemToEstimateAction — only the vendor quotes the moved lines name travel, stamped (got ${JSON.stringify(tgtVq.map((v) => v.id))})`);
  ok(!(await A.moveSystemToEstimateAction(sections[0], { kind: "existing", quoteId: "Q-NOPE" }, ctxSrc)).ok, "handoff actions: moveSystemToEstimateAction — an unknown target is refused");
  const cpSame = await A.copySystemToEstimateAction(sections[0], { kind: "same" }, { ...ctxSrc, tierMargin: 0.3 });
  ok(cpSame.ok && cpSame.kind === "same" && cpSame.section.id !== sections[0].id && cpSame.section.items.length > 0, "handoff actions: copySystemToEstimateAction — same: returns the re-priced section, writes nothing");
  const cpNew = await A.copySystemToEstimateAction(sections[0], { kind: "new" }, { ...ctxSrc, tierMargin: 0.3 });
  const cpId = cpNew.ok && cpNew.kind !== "same" ? cpNew.targetId : "";
  ok(!!cpId && (await repo.get(cpId))?.name.endsWith("(copy)") === true && (await repo.get(cpId))?.pricingTier === "base",
    "handoff actions: copySystemToEstimateAction — new: a copy estimate stamped with the destination tier");

  // quotes/actions
  const fd = new FormData();
  fd.set("id", cpId);
  fd.set("status", "lost");
  await QA.setQuoteStatus(fd);
  ok(!!cpId && (await repo.get(cpId))?.status === "lost", "handoff actions: setQuoteStatus — the hub's form action moves the status");
  const del = await QA.deleteQuoteAction(cpId);
  ok(del.ok && !!cpId && (await repo.get(cpId)) === null, "handoff actions: deleteQuoteAction — a tombstone");

  // refusals
  const ref = refusedEstimatorActions();
  ok(REFUSED_ESTIMATOR_ACTIONS.every((n) => (ref[n] as () => { ok: boolean; error: string })().error === "Not available in the prototype"), "handoff actions: the refused actions return NOT_IN_PROTOTYPE");
}

