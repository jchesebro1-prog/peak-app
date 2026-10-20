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
import { catalogResolver, keyProductPhotosLocal, loadQuoteDocumentPropsLocal, photoDocIdForSku } from "../handoff/estimator/runtime/loaders/document";
import { loadPackagePreviewLocal } from "../handoff/estimator/runtime/loaders/package";
import { loadCutSheetsLocal } from "../handoff/estimator/runtime/loaders/cut-sheets";
import { REVIEW_DOCS_NOT_IN_PROTOTYPE, reviewActions } from "../handoff/estimator/runtime/actions/review-actions";
import { INTROS_DOC_ID, listIntrosLocal, narrativeActions } from "../handoff/estimator/runtime/actions/narrative-actions";
import { libraryActions } from "../handoff/estimator/runtime/actions/library-actions";
import { clientPackageActions } from "../handoff/estimator/runtime/actions/client-package-actions";
import { packageActions, refusedPackageActions, REFUSED_PACKAGE_ACTIONS } from "../handoff/estimator/runtime/actions/package-actions";
import { outputActions } from "../handoff/estimator/runtime/actions/output-actions";
import { pdfActions } from "../handoff/estimator/runtime/actions/pdf-actions";
import { assetUrl, PLACEHOLDER_DIR } from "../handoff/estimator/runtime/assets";
import { POPOUT_NOTICE, PRINT_FOOTER_TEXT, previewTargetOf, windowOpenRoute } from "../handoff/estimator/ui/preview-routes";
import { cutSheetAppendixModels } from "../handoff/estimator/runtime/loaders/cut-sheets";
import { packagePanelFor } from "../handoff/estimator/runtime/actions/package-actions";
import { driftClean, driftMessages, driftOf, parsePortSources, PORT_SOURCES_FILE, sha256Of, updatedPortSources } from "../handoff/estimator/port-drift";
import { APP_OVERRIDES, exportNames } from "../handoff/estimator/esbuild-plugins";
import { fmt } from "@/lib/estimating-core/pricing";
import { CUT_SHEETS_NO_QUOTE, CUT_SHEETS_WRONG_TYPE } from "@/lib/curtain-cut-sheets/model";
import { REVIEW_COMMENT_COPY } from "@/lib/estimate-review/comments";
import { previewPath } from "@/lib/estimate-output/package-preview";
import * as nodePath from "node:path";
import { NOT_IN_PROTOTYPE } from "../handoff/estimator/runtime/actions-registry";
import { reviewOps } from "../handoff/estimator/runtime/review-ops";
import { composeHistoryUrl, mapAppHref, normalizedLocation, parseRoute, routeHash, routeSearch, sameRoute, type Route } from "../handoff/estimator/runtime/routes";
import { filterRows, listRows, statusCounts, updatedLabel } from "../handoff/estimator/runtime/estimates-list-model";
import { canonicalTotals } from "../handoff/estimator/runtime/estimate-totals";
import { runReset } from "../handoff/estimator/runtime/reset";
import { nextStepActions } from "../handoff/estimator/runtime/actions/next-step-actions";
import {
  NO_FOLLOW_UP_TASK, REFUSED_SEND_ACTIONS, refusedSendActions, SEND_COPY, sendActions, SIMULATED_LINK, SIMULATED_SEND_MARK, TRACK_GONE, trackedEmailsOf,
} from "../handoff/estimator/runtime/actions/send-actions";
import { emptyBidPanel, miscActions, PARTIES_ACTIONS_KEY, QUOTES_HUB_ACTIONS_KEY } from "../handoff/estimator/runtime/actions/misc-refusals";
import { actionRegistrations } from "../handoff/estimator/runtime/actions/registrations";
import { prototypeNotesFor } from "../handoff/estimator/ui/send-overrides";
import { onRefresh } from "../handoff/estimator/runtime/router";
import { canAttestApproval, decidableUnderLock, validateAttestationNote } from "../handoff/estimator/runtime/quote-model";
import { unregisteredExports } from "../handoff/estimator/verify";

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
  ok(e2.raw === 9100 && e2.canonical === 9300, `handoff runtime: expectedEstimatorTotals — Q-G002's alternate sits in an Alternate group, so it stays out of the total through normalizeSystemOrder (got ${e2.raw} → ${e2.canonical})`);
  const sentQ = expectedEstimatorTotals({ ...gq("Q-G001"), status: "sent" }, { blobs: {} });
  ok(sentQ.canonical === sentQ.raw && !sentQ.priceRound && !sentQ.bonusLines, "handoff runtime: expectedEstimatorTotals — a sent quote without bonus lines prices as stored");

  await handoffActionChecks(ok);
  await handoffReviewChecks(ok);
  await handoffSendChecks(ok);
  await handoffShellChecks(ok);
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
  // a document over the caps (16 × 20,000-char paragraphs > the 200 KB JSON cap) refuses the whole save before any write
  const hugeDoc = { type: "doc", content: Array.from({ length: 16 }, () => ({ type: "paragraph", content: [{ type: "text", text: "x".repeat(20000) }] })) } as unknown as SavePayload["document"];
  const bigDoc = planSave(null, payloadFor(s1, { document: hugeDoc }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(!bigDoc.ok && bigDoc.refusedBeforeWrite === "document" && /too large/.test(bigDoc.error), "handoff actions: planSave — a package document over the caps refuses the save before any write");
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
  // the document gate end to end: an over-cap document refuses the save, returns no id / number, and the stored quote is untouched
  const storedBeforeDoc = JSON.stringify(await store.get("quotes", "Q-G001"));
  const quotesBeforeDoc = (await store.all("quotes")).length;
  const hugeDocPayload = { type: "doc", content: Array.from({ length: 16 }, () => ({ type: "paragraph", content: [{ type: "text", text: "x".repeat(20000) }] })) } as unknown as SavePayload["document"];
  const docRefused = await A.saveQuoteAction("Q-G001", payloadFor(sections, { name: "Should not save", document: hugeDocPayload }));
  const docRefusedNew = await A.saveQuoteAction(null, payloadFor(sections, { name: "Should not create", document: hugeDocPayload }));
  ok(!docRefused.ok && docRefused.id === null && docRefused.number === null && /too large/.test(docRefused.error ?? "") && JSON.stringify(await store.get("quotes", "Q-G001")) === storedBeforeDoc,
    "handoff actions: saveQuoteAction — an over-cap package document refuses the save: no id, no number, the stored quote unchanged");
  ok(!docRefusedNew.ok && docRefusedNew.id === null && docRefusedNew.number === null && (await store.all("quotes")).length === quotesBeforeDoc, "handoff actions: saveQuoteAction — an over-cap document on a NEW estimate creates nothing");
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
  const noOffice = await A.travelForSelectionAction("c-beta", null);
  ok(customers.hasVenue(null, "c-beta") === (noOffice !== null) && (customers.hasVenue(null, "c-alpha") ? (await A.travelForSelectionAction("c-alpha", null)) !== null : true),
    `handoff actions: travelForSelectionAction — null only when there is no venue (a venue with no estimate still answers all-null) (got ${JSON.stringify(noOffice)})`);

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

  // --- review fixes: id / number reuse, bonus roster, raw writes ---
  {
    const mk = async (extra: Array<{ id: string } & Record<string, unknown>>, teamIn: SeedTeamUser[]) => {
      const st = await openStore({ quotes: docs(extra), catalog: [], fixtures: [] }, { idb: null });
      configurePorts({ store: st, customers: EMPTY_CUSTOMERS, rules: { settings: {}, blobs: {} }, team: teamIn });
      return st;
    };
    const q0 = (id: string, estNo: number, over: Record<string, unknown> = {}) =>
      ({ id, estNo, name: id, status: "draft", quoteType: "system", source: "estimator", value: 0, margin: 0, createdAt: 1, updatedAt: 1, history: [], revisions: [], spec: { sections: [], mobs: [] }, ...over });
    const t2: SeedTeamUser[] = [
      { id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" },
      { id: "u3", name: "Gone Person", roles: ["Estimator"], status: "inactive" },
    ];

    // deleting the highest seed quote never frees its id or its estimate number
    const stR = await mk([q0("Q-2050", 1050), q0("Q-2060", 1060)], t2);
    const repoR = quoteRepo(stR);
    await repoR.remove("Q-2060");
    const nq = await repoR.create({ name: "After delete" });
    const nq2 = await repoR.create({ name: "After delete 2" });
    ok(nq.id === "Q-2061" && (nq.estNo ?? 0) === 1061 && nq2.id === "Q-2062" && (nq2.estNo ?? 0) === 1062,
      `handoff actions: repo.create — after deleting the highest SEED quote, its id and estimate number are never reused (got ${nq.id}/${nq.estNo}, ${nq2.id}/${nq2.estNo})`);
    ok((await stR.allIncludingDeleted<{ id: string }>("quotes")).some((q) => q.id === "Q-2060") && !(await stR.all<{ id: string }>("quotes")).some((q) => q.id === "Q-2060"),
      "handoff store: allIncludingDeleted lists a tombstoned seed doc; all() does not");
    await repoR.remove(nq2.id);
    const nq3 = await repoR.create({ name: "After deleting a new one" });
    ok(nq3.id === "Q-2063" && (nq3.estNo ?? 0) === 1063, `handoff actions: repo.create — a deleted NEW quote's id and number are remembered too (got ${nq3.id}/${nq3.estNo})`);

    // the roster: users.all() stays active-only, everyone() adds the inactive (name + status + roles only)
    ok(users.all().map((u) => u.id).join() === "u1" && users.everyone().map((u) => u.id).join() === "u1,u3", "handoff runtime: users.all — active only; users.everyone — inactive included");
    users.setCurrent("u3");
    ok(users.current().id === "u1", "handoff runtime: users.setCurrent — an inactive user can't be acted as");

    // a won quote's bonus record resolves an inactive owner's userId from the FULL roster
    const AR = estimatorActions(stR);
    const gp = await AR.saveQuoteAction(null, payloadFor([sec("bon", [{ qty: 2, cost: 50, price: 100 }, { sku: "LAB", qty: 4, cost: 20, price: 40, labor: true }])], { name: "Gone owner" }));
    await repoR.update(gp.id!, { owner: "Gone Person", preparedBy: "Ann Admin" } as Partial<Quote>);
    const wonGp = await repoR.setStatus(gp.id!, "won", "Ann Admin", { bypassApprovalGate: "historical-import" } as never);
    const credits = (wonGp?.bonusRecord as { credits?: Array<{ name: string; userId: string | null }> } | null | undefined)?.credits ?? [];
    ok(credits.length > 0 && credits.find((c) => c.name === "Gone Person")?.userId === "u3" && credits.find((c) => c.name === "Ann Admin")?.userId === "u1",
      `handoff actions: bonus record — an inactive owner still resolves to a userId (got ${JSON.stringify(credits)})`);

    // writes mutate the RAW stored doc: a legacy stage key stays as stored after an unrelated update; reads still normalize
    const stW = await mk([q0("Q-2070", 1070, { stage: "legacy-stage-key" })], t2);
    const repoW = quoteRepo(stW);
    const readBefore = await repoW.get("Q-2070");
    await repoW.update("Q-2070", { name: "Renamed" });
    const rawAfter = (await stW.get<Quote>("quotes", "Q-2070"))!;
    const readAfter = (await repoW.get("Q-2070"))!;
    ok(rawAfter.name === "Renamed" && rawAfter.stage === "legacy-stage-key" && rawAfter.pipelineId === undefined, `handoff actions: repo.update — the stored doc keeps its raw legacy stage (got ${rawAfter.stage}/${rawAfter.pipelineId})`);
    ok(!!readBefore && readBefore.stage !== "legacy-stage-key" && readAfter.stage !== "legacy-stage-key" && !!readAfter.pipelineId && readAfter.name === "Renamed",
      "handoff actions: repo.get — reads still normalize onto the pipeline");
    await repoW.setQuotePeople("Q-2070", { preparedBy: "Ann Admin" });
    ok((await stW.get<Quote>("quotes", "Q-2070"))?.stage === "legacy-stage-key", "handoff actions: repo.setQuotePeople — another raw patch keeps the legacy stage too");
  }

  // refusals
  const ref = refusedEstimatorActions();
  ok(REFUSED_ESTIMATOR_ACTIONS.every((n) => (ref[n] as () => { ok: boolean; error: string })().error === "Not available in the prototype"), "handoff actions: the refused actions return NOT_IN_PROTOTYPE");
}


/* ------------------------------------------------------------------ PR 2 Task 5: customer-facing views + their actions */

export async function handoffReviewChecks(ok: Ok) {
  const cust: SeedCustomers = {
    companies: [{ id: "c1", name: "Acme Theatre" }],
    sites: [{ id: "s1", companyId: "c1", name: "Main Hall", city: "Madison", isPrimary: true }],
    contacts: [{ id: "k1", firstName: "Pat", lastName: "Lee", homeCompanyId: "c1", title: "TD", isPrimary: true }],
    contactEmails: [], contactPhones: [], geoCache: [],
  };
  const team: SeedTeamUser[] = [
    { id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" },
    { id: "u2", name: "Eve Estimator", roles: ["Estimator"], status: "active" },
    { id: "u3", name: "Rex Reviewer", roles: ["Reviewer"], status: "active" },
  ];
  const sections = [
    sec("s1", [{ sku: "ETC:CS15", desc: "ColorSource 15", qty: 4, cost: 900, price: 1250 }, { sku: "LAB", desc: "Install", qty: 8, cost: 55, price: 95, labor: true }], { name: "Stage lighting" }),
    sec("s2", [{ sku: "ETC:CS15", desc: "Spare", qty: 1, cost: 900, price: 1250 }], { name: "Spares" }),
  ];
  const q1 = { id: "Q-3001", estNo: 3001, name: "Main stage", status: "draft", quoteType: "system", source: "estimator", customerId: "c1", customer: "Acme Theatre", owner: "Ann Admin", createdAt: 1, updatedAt: 1_790_000_000_000, history: [], revisions: [], notIncluded: null, spec: { sections, mobs: [] } };
  const wonQ = { id: "Q-3002", estNo: 3002, name: "Old job", status: "won", quoteType: "system", source: "estimator", customerId: "c1", tierMargin: 0.3, createdAt: 1, updatedAt: 1_780_000_000_000, history: [], revisions: [],
    spec: { sections: [sec("w1", [{ sku: "ETC:CS15", desc: "ColorSource 15", qty: 2, cost: 800, price: 1100 }], { name: "Dimming rack" })], mobs: [] } };
  const flame = { id: "Q-3003", estNo: 3003, name: "Flame", status: "draft", quoteType: "flame", source: "flame", createdAt: 1, updatedAt: 1, history: [], revisions: [], spec: {} };
  const curtainQ = { id: "Q-3004", estNo: 3004, name: "Drapes", status: "draft", quoteType: "system", source: "estimator", createdAt: 1, updatedAt: 1, history: [], revisions: [],
    spec: { mobs: [], sections: [{ id: "c1", name: "Curtains", kind: "materials", mfr: "", freightPct: 0, items: [
      { id: 1, sku: "X", desc: "Main Drape", qty: 2, unit: "ea", cost: 0, price: 0, curtain: true,
        curtainInputs: { name: "Main Drape", fabricSku: "FAB-CH25", fabricName: "Charisma Velour 25 oz", qty: "2", width: "21.5", height: "18", fullness: "50", mountType: "wall-hookloop" } },
    ] }] } };
  const catalog = [
    { id: "ETC:CS15", sku: "ETC:CS15", desc: "ColorSource 15 fixture", category: "Lighting", unit: "ea", cost: 900, list: 1300, mfr: "ETC", manufacturerModelNumber: "CS15" },
    { id: "FAB-CH25", sku: "FAB-CH25", desc: "Charisma Velour 25 oz", category: "Fabric", unit: "lin-yd", cost: 20, list: 30, oz: 25, ozBasis: "lin-yd", boltWidthIn: 54 },
  ];
  const rules: SeedRules = { settings: { companyName: "Peak Systems Group" }, blobs: {
    estimate_output_defaults: { notIncluded: "Permits\nPower", website: "" },
    narrative_intros: { intros: [{ id: "NI-aaaaaaaa", title: "Lighting", text: "Lights.", updatedAt: 1, updatedBy: "Ann Admin" }] },
  } };
  const store = await openStore({ quotes: docs([q1, wonQ, flame, curtainQ]), catalog: docs(catalog), fixtures: [], blobs: Object.entries(rules.blobs).map(([id, data]) => ({ id, data }) as { id: string }), settings: [{ id: "main", data: rules.settings } as { id: string }] }, { idb: null });
  configurePorts({ store, customers: cust, rules, team });
  users.setCurrent("u1");
  const grand1 = totals(sections, 0).grand;

  // --- the document loader port (document-loader.ts over the store) ---
  const doc = await loadQuoteDocumentPropsLocal(store, "Q-3001");
  ok(!!doc && doc.custName === "Acme Theatre" && doc.attnLine === "Pat Lee · TD" && doc.venueLabel === "Main Hall — Madison" && doc.projectName === "Main stage",
    `handoff review: document loader — the customer, attn contact ladder and primary venue come from the customer port (got ${doc?.custName} / ${doc?.attnLine} / ${doc?.venueLabel})`);
  ok(!!doc && doc.t.grand === grand1 && doc.quoteId === "EST-3001" && doc.rewardsLine === "" && doc.companyName === "Peak Systems Group" && doc.ownerName === "Ann Admin",
    "handoff review: document loader — totals of the SAVED sections, the estimate number, no rewards line, settings' company");
  ok((await loadQuoteDocumentPropsLocal(store, "Q-nope")) === null && (await loadQuoteDocumentPropsLocal(store, null)) === null, "handoff review: document loader — a missing quote is null");
  await store.put("quotes", { ...q1, name: "Renamed in the overlay" });
  ok((await loadQuoteDocumentPropsLocal(store, "Q-3001"))?.projectName === "Renamed in the overlay", "handoff review: document loader — reads the overlay (a saved edit shows)");
  await store.put("quotes", q1);
  const partOf = await catalogResolver(store);
  const kpSections = [{ ...sections[0], presentation: "narrative", keyProducts: [{ lineKey: "1", sku: "ETC:CS15", text: "x", photo: true }] }] as unknown as SpecSection[];
  ok(photoDocIdForSku("ETC:CS15") === null && Object.keys(keyProductPhotosLocal(kpSections, null, partOf)).length === 0, "handoff review: no packaged photos yet → no key-product photo (Task 11 plugs them in)");

  // --- the package loader port (package-live-loader.ts) ---
  const pkg = await loadPackagePreviewLocal(store, "Q-3001", "narrative", "./lh.jpg");
  ok(!!pkg && pkg.model.total === fmt(grand1) && pkg.model.logo.src === "./lh.jpg" && pkg.model.logo.full && pkg.model.view === "narrative" && pkg.model.scopes.length === 2,
    `handoff review: package loader — the saved total, the full letterhead and one scope per printed system (got ${pkg?.model.total}, ${pkg?.model.scopes.length})`);
  ok(!!pkg && pkg.model.notIncluded.join("|") === "Permits|Power" && pkg.model.bomHref === previewPath("Q-3001", "package", "bom") && pkg.model.narrativeHref === previewPath("Q-3001", "package"),
    "handoff review: package loader — Not included from the Estimate output default (notIncluded null); the toggle links name the preview route");
  ok(!!pkg && pkg.extras.plans.length === 0 && pkg.extras.downloads === null && Object.keys(pkg.extras.datasheets).length === 0, "handoff review: package loader — no part documents → no datasheet links, downloads or plans");
  const pkgBom = await loadPackagePreviewLocal(store, "Q-3001", "bom", "./lh.jpg");
  ok(pkgBom?.model.view === "bom" && (await loadPackagePreviewLocal(store, "Q-nope", "bom", "x")) === null, "handoff review: package loader — the BOM view; a missing quote is null");

  // --- the cut-sheet loader port (curtain-cut-sheets/load.ts) ---
  const noQ = await loadCutSheetsLocal(store, "Q-nope");
  const wrongType = await loadCutSheetsLocal(store, "Q-3003");
  ok(!noQ.ok && noQ.error === CUT_SHEETS_NO_QUOTE && !wrongType.ok && wrongType.error === CUT_SHEETS_WRONG_TYPE, "handoff review: cut sheets — a missing quote / a non-system quote refuse with the app's copy");
  const none = await loadCutSheetsLocal(store, "Q-3001");
  ok(none.ok && none.models.client.length === 0, "handoff review: cut sheets — an estimate with no curtains has no sheets");
  const cs = await loadCutSheetsLocal(store, "Q-3004");
  ok(cs.ok && cs.models.client.length === 1 && cs.models.submittal.length === 1 && cs.models.client[0].sheetNo === "CS-1" && cs.result.types[0].curtains[0].fabric?.sku === "FAB-CH25",
    `handoff review: cut sheets — a curtain line gets CS-1 in both styles, its fabric from the store's catalog (got ${cs.ok ? cs.models.client.map((m) => m.sheetNo).join() : "error"})`);
  // The print route's #292 appendix: Client sheets only when the saved quote's PDF options ask for them.
  await store.put("quotes", { ...curtainQ, pdfOptions: { pdfCutSheets: true } });
  const csOn = await loadCutSheetsLocal(store, "Q-3004");
  ok(cutSheetAppendixModels(csOn).length === 1 && cutSheetAppendixModels(csOn)[0].sheetNo === "CS-1" && cutSheetAppendixModels(csOn)[0] === (csOn.ok ? csOn.models.client[0] : null),
    "handoff review: cut-sheet appendix — pdfCutSheets on + a curtain → the Client-style sheets print after the document");
  ok(cutSheetAppendixModels(cs).length === 0 && cutSheetAppendixModels(none).length === 0 && cutSheetAppendixModels(noQ).length === 0 && cutSheetAppendixModels(null).length === 0,
    "handoff review: cut-sheet appendix — option off (the default), no curtains, a failed load or nothing loaded → none");
  await store.put("quotes", { ...curtainQ, pdfOptions: { pdfCutSheets: false } });
  ok(cutSheetAppendixModels(await loadCutSheetsLocal(store, "Q-3004")).length === 0, "handoff review: cut-sheet appendix — pdfCutSheets explicitly off → none");
  await store.put("quotes", curtainQ);

  // --- review comments (the `reviewComments` collection) ---
  const ra = reviewActions(store);
  const l0 = await ra.listReviewCommentsAction("Q-3001");
  ok(l0.ok && l0.comments.length === 0 && l0.numbered.length === 0, "handoff review: listReviewCommentsAction — an empty list is { ok, comments: [], numbered: [] }");
  ok(!(await ra.listReviewCommentsAction("Q-nope")).ok, "handoff review: listReviewCommentsAction — a missing quote refuses");
  const before = JSON.stringify(await store.get("quotes", "Q-3001"));
  const [a1, a2] = await Promise.all([ra.addReviewCommentAction("Q-3001", null, "  Whole thing  "), ra.addReviewCommentAction("Q-3001", "s2", "Spares too many")]);
  const after2 = await ra.listReviewCommentsAction("Q-3001");
  ok(a1.ok && a2.ok && after2.ok && after2.comments.length === 2 && after2.comments[0].body === "Whole thing" && after2.comments.every((c) => c.by === "Ann Admin" && /^rc-/.test(c.id)),
    "handoff review: addReviewCommentAction — two at once both land, bodies cleaned, author = the acting user");
  ok(after2.ok && after2.numbered.length === 2 && JSON.stringify(await store.get("quotes", "Q-3001")) === before, "handoff review: comments are numbered against the saved systems and never touch the quote doc (no updatedAt bump)");
  const bad = await ra.addReviewCommentAction("Q-3001", "gone-system", "x");
  const empty = await ra.addReviewCommentAction("Q-3001", null, "   ");
  ok(!bad.ok && bad.error === REVIEW_COMMENT_COPY.noSystem && !empty.ok && empty.error === REVIEW_COMMENT_COPY.empty, "handoff review: addReviewCommentAction — a system not on the saved estimate / an empty body refuse with the app's copy");
  const cid = after2.ok ? after2.comments[0].id : "";
  users.setCurrent("u2");
  const del2 = await ra.deleteReviewCommentAction("Q-3001", cid);
  ok(!del2.ok && del2.error === REVIEW_COMMENT_COPY.cantDelete, "handoff review: deleteReviewCommentAction — someone else's comment is refused for a non-approver");
  const res = await ra.resolveReviewCommentAction("Q-3001", cid);
  const res2 = await ra.resolveReviewCommentAction("Q-3001", cid);
  ok(res.ok && res.comments[0].resolvedBy === "Eve Estimator" && res.numbered.length === 1 && res2.ok && res2.comments[0].resolvedBy === "Eve Estimator", "handoff review: resolveReviewCommentAction — resolves once (idempotent), drops it from the numbered list");
  users.setCurrent("u3");
  ok(!(await ra.resolveReviewCommentAction("Q-3001", cid)).ok, "handoff review: resolveReviewCommentAction — needs Create (a Reviewer can't)");
  const del3 = await ra.deleteReviewCommentAction("Q-3001", cid);
  ok(del3.ok && del3.comments.length === 1, "handoff review: deleteReviewCommentAction — an approver deletes any comment");
  const missing = await ra.deleteReviewCommentAction("Q-3001", cid);
  ok(!missing.ok && missing.error === REVIEW_COMMENT_COPY.missing, "handoff review: deleteReviewCommentAction — an already-gone comment says so");
  const docsR = await ra.reviewDocsAction("Q-3001");
  ok(!docsR.ok && docsR.error === REVIEW_DOCS_NOT_IN_PROTOTYPE, "handoff review: reviewDocsAction — { ok: false } with the prototype's note (no part documents)");
  users.setCurrent("u1");

  // --- narrative: key-product library, paragraphs, intros ---
  const na = narrativeActions(store);
  const lib = await na.keyProductLibraryAction(["ETC:CS15", "NOPE", "line:7", " ETC:CS15 "], { "ASM-1": "ETC:CS15" });
  ok(lib["ETC:CS15"]?.inCatalog === true && lib["ETC:CS15"].desc === "ColorSource 15 fixture" && lib["ETC:CS15"].paragraph === null && lib["ETC:CS15"].photoDocId === null && lib["ETC:CS15"].modelPart?.manufacturerModelNumber === "CS15",
    "handoff review: keyProductLibraryAction — a catalog part's row (desc, no paragraph, no photo yet, model fields)");
  ok(lib.NOPE?.inCatalog === false && !("line:7" in lib) && Object.keys(lib).length === 2, "handoff review: keyProductLibraryAction — a miss gets a row; line tokens get none; skus deduped");
  const viaLib = await na.keyProductLibraryAction(["ASM-1"], { "ASM-1": "ETC:CS15" });
  ok(viaLib["ASM-1"]?.inCatalog === true && viaLib["ASM-1"].viaSku === "ETC:CS15", "handoff review: keyProductLibraryAction — an assembly alias reads its member (viaSku)");
  const saved = await na.saveProductParagraphAction("ETC:CS15", "A bright fixture.", null);
  ok(saved.ok && saved.row.paragraph === "A bright fixture." && saved.row.paragraphUpdatedBy === "Ann Admin" && (await store.get<{ narrativeText?: string }>("catalog", "ETC:CS15"))?.narrativeText === "A bright fixture.",
    "handoff review: saveProductParagraphAction — writes narrativeText to the catalog overlay and answers the fresh row");
  const stale = await na.saveProductParagraphAction("ETC:CS15", "Again", null);
  ok(!stale.ok && !!stale.stale && stale.stale.paragraph === "A bright fixture.", "handoff review: saveProductParagraphAction — a stale expectUpdatedAt is refused with the current paragraph");
  ok(!(await na.saveProductParagraphAction("NOPE", "x")).ok && !(await na.saveProductParagraphAction("ETC:CS15", "  ")).ok, "handoff review: saveProductParagraphAction — not a catalog part / empty text refuse");
  users.setCurrent("u3");
  const noCreate = await na.saveProductParagraphAction("ETC:CS15", "x");
  const noIntro = await na.upsertSystemIntroAction({ title: "T", text: "x" });
  ok(!noCreate.ok && noCreate.error === "Needs the Create permission." && !noIntro.ok, "handoff review: library writes need Create (a Reviewer is refused)");
  users.setCurrent("u1");
  ok((await listIntrosLocal(store)).map((i) => i.id).join() === "NI-aaaaaaaa", "handoff review: intros — seeded from the narrative_intros blob");
  const up = await na.upsertSystemIntroAction({ title: "Audio", text: "Sound." });
  ok(up.ok && /^NI-[0-9a-z]{8}$/.test(up.id ?? "") && up.intros.length === 2 && (await store.get<{ intros: unknown[] }>("intros", INTROS_DOC_ID))?.intros.length === 2,
    "handoff review: upsertSystemIntroAction — a new NI- id, the list stored in the intros collection");
  const propsAfter = await buildEstimatorProps(store, "Q-3001", new URLSearchParams());
  ok(propsAfter.narrativeIntros.length === 2 && propsAfter.narrativeIntros.some((i) => i.title === "Audio"), "handoff review: the Estimator props read the intros the store holds (a reload sees a saved intro)");
  const delI = await na.deleteSystemIntroAction("NI-aaaaaaaa");
  ok(delI.ok && delI.intros.length === 1 && (await listIntrosLocal(store)).length === 1, "handoff review: deleteSystemIntroAction — one operation on the stored list");

  // --- system library ---
  const la = libraryActions(store);
  const hits = await la.searchSystemLibraryAction("dimming");
  ok(hits.length === 1 && hits[0].systemName === "Dimming rack" && hits[0].customer === "Acme Theatre" && hits[0].status === "won", "handoff review: searchSystemLibraryAction — a won estimate's system, by name, with the customer's name");
  ok((await la.searchSystemLibraryAction("stage lighting")).length === 0, "handoff review: searchSystemLibraryAction — drafts never join the library");
  const entry = await la.getSystemLibraryEntryAction(hits[0]?.key ?? "");
  ok(!!entry && entry.quoteId === "Q-3002" && (await la.getSystemLibraryEntryAction("nope")) === null, "handoff review: getSystemLibraryEntryAction — the entry by key; an unknown key is null");
  const loaded = await la.loadLibrarySystemAction(hits[0]?.key ?? "", { tierMargin: 0.3 });
  ok(loaded.ok && loaded.systemName === "Dimming rack" && loaded.estNumber === "EST-3002" && loaded.section.items.length === 1 && loaded.section.items[0].cost === 900 && loaded.costsUpdated > 0,
    `handoff review: loadLibrarySystemAction — re-priced at today's catalog cost (got ${loaded.ok ? `${loaded.section.items[0].cost}, ${loaded.costsUpdated} updated` : loaded.error})`);
  const gone = await la.loadLibrarySystemAction("Q-3002:live:missing", { tierMargin: null });
  ok(!gone.ok && !(await la.loadLibrarySystemAction("garbage", { tierMargin: null })).ok, "handoff review: loadLibrarySystemAction — a missing system / a malformed key refuse");

  // --- package panel, client package, output, PDF status ---
  const pa = packageActions(store);
  const panel = await pa.packagePanelAction("Q-3001");
  ok(panel.ok && panel.panel.files.length === 0 && panel.panel.responses.length === 0 && !panel.panel.canSend && !panel.panel.uploads && panel.panel.grid === null && !panel.panel.gridEligible && panel.panel.peakHeader === true && Array.isArray(panel.panel.gaps),
    "handoff review: packagePanelAction — a shape-valid panel with no files, uploads, Grid or sends");
  ok(!(await pa.packagePanelAction("Q-nope")).ok, "handoff review: packagePanelAction — a missing quote refuses");
  // The Peak header default comes from the sliced settings (letterhead-server.ts loadPeakHeaderDefault: on unless stored false).
  await store.put("settings", { id: "main", data: { ...rules.settings, peakHeader: false } });
  const offPanel = await pa.packagePanelAction("Q-3001");
  await store.put("quotes", { ...q1, packagePeakHeader: true });
  const ownPanel = await pa.packagePanelAction("Q-3001");
  ok(offPanel.ok && offPanel.panel.peakHeaderDefault === false && offPanel.panel.peakHeader === false && ownPanel.ok && ownPanel.panel.peakHeaderDefault === false && ownPanel.panel.peakHeader === true,
    "handoff review: packagePanelAction — settings.peakHeader false → default off; the quote's own choice still wins");
  await store.put("quotes", q1);
  await store.put("settings", { id: "main", data: rules.settings });
  ok(packagePanelFor(q1 as unknown as Quote, {}).peakHeaderDefault === true && packagePanelFor(q1 as unknown as Quote, { peakHeader: "junk" }).peakHeaderDefault === true && packagePanelFor(q1 as unknown as Quote, { peakHeader: false }).peakHeaderDefault === false,
    "handoff review: packagePanelFor — absent / non-false peakHeader → on (peakHeaderDefault's rule)");
  const refusedP = refusedPackageActions();
  ok(REFUSED_PACKAGE_ACTIONS.every((n) => (refusedP[n] as () => { ok: boolean; error: string })().error === "Not available in the prototype"), "handoff review: the package panel's writes refuse with NOT_IN_PROTOTYPE");
  const cp = await clientPackageActions().clientPackageDocsAction({ sections });
  ok(cp.ok && cp.rows.length === 0 && cp.truncated === 0, "handoff review: clientPackageDocsAction — the empty success (no part documents)");
  const oa = outputActions();
  const sg = await oa.surveyGoalsAction("");
  const sg2 = await oa.surveyGoalsAction("SV-1");
  const sv = await oa.siteVisitGoalsAction({ quoteId: "Q-3001", customerId: "c1" });
  ok(!sg.ok && sg.error === "No site visit is linked." && !sg2.ok && sg2.error === "That site visit no longer exists." && sv.ok && sv.options.length === 0, "handoff review: output actions — no site visits in the prototype (the originals' own answers)");
  const pdfA = pdfActions(store);
  ok((await pdfA.quotePdfStatusAction("Q-3001")) === null && (await pdfA.retryQuotePdfAction("Q-nope")) === null, "handoff review: quotePdfStatusAction — no stored PDF reads null (pdfView)");

  // --- the asset rewrite and the preview routes ---
  ok(assetUrl("/placeholders/allowance.webp") === PLACEHOLDER_DIR + "allowance.webp" && assetUrl("/api/part-documents/pd%201") === PLACEHOLDER_DIR + "coming-soon.webp"
    && assetUrl("./app/assets/x.jpg") === "./app/assets/x.jpg" && assetUrl("data:image/png;base64,AA") === "data:image/png;base64,AA" && assetUrl("/other/x.png") === "/other/x.png",
    "handoff review: assetUrl — placeholders → app/assets/placeholders, part documents → the placeholder chain's last link, anything else unchanged");
  const t1 = previewTargetOf("/estimator/cut-sheets?id=Q-1&style=client");
  const t2 = previewTargetOf("/estimator-preview/Q%2D1?tab=package&view=bom");
  const t3 = previewTargetOf("/estimator-preview/Q-1?tab=bom");
  ok(t1?.kind === "cutsheets" && t1.style === "client" && t1.quoteId === "Q-1" && t2?.kind === "package" && t2.view === "bom" && t2.quoteId === "Q-1" && t3?.kind === "bom"
    && previewTargetOf("/estimator/cut-sheets?id=Q-1")?.kind === "cutsheets" && (previewTargetOf("/estimator/cut-sheets?id=Q-1") as { style?: string }).style === "submittal"
    && previewTargetOf("/estimator?id=Q-1") === null && previewTargetOf("https://example.com/estimator-preview/Q-1") === null && previewTargetOf("/estimator/cut-sheets") === null,
    "handoff review: previewTargetOf — the two routes parse (style / tab / view); anything else, another site, or no id is null");
  const r = windowOpenRoute;
  ok(r("", "_blank").kind === "deferred" && r("about:blank", "_blank").kind === "deferred",
    'handoff review: windowOpenRoute — openCutSheets\' exact shape (window.open("", "_blank"), no features) → the stand-in');
  ok(r("", "peak-pop:estimate:Q-1", "width=800").kind === "popout" && r("/estimator?id=Q-1", "peak-pop:estimate:Q-1").kind === "popout",
    "handoff review: windowOpenRoute — a peak-pop:* target (the ⧉ pop-out) → the notice, whatever the URL");
  ok(r("", "_blank", "noopener").kind === "real" && r("").kind === "real" && r("", "other").kind === "real" && r("https://example.com", "_blank").kind === "real",
    "handoff review: windowOpenRoute — any other empty-URL open (features, another target) and other URLs → the real window.open");
  const pv = r("/estimator/cut-sheets?id=Q-1", "_blank", "noopener");
  ok(pv.kind === "preview" && pv.target.kind === "cutsheets", "handoff review: windowOpenRoute — a preview route → the overlay");
  ok(POPOUT_NOTICE === "Pop-out windows aren't available in the prototype" && PRINT_FOOTER_TEXT === "Confidential — Peak Systems Group · prototype", "handoff review: the pop-out notice and print footer copy");

  // --- the port drift guard (port-drift.ts; run by handoff:verify --drift, never by test:specs) ---
  const man = parsePortSources({ ports: [{ port: "h/a.ts", what: "x", originals: [{ path: "src/a.ts", sha256: sha256Of("one") }, { path: "src/b.ts", sha256: sha256Of("two") }] }, { port: "h/gone.ts", what: "y", originals: [{ path: "src/c.ts", sha256: sha256Of("three") }] }] });
  const files: Record<string, string> = { "h/a.ts": "", "src/a.ts": "one", "src/b.ts": "two", "src/c.ts": "three" };
  const hashOf = (p: string) => (p in files ? sha256Of(files[p]) : null);
  const clean = driftOf(man, hashOf, (p) => p in files || p === "h/gone.ts");
  ok(driftClean(clean) && clean.checked === 3 && driftMessages(clean).length === 0, "handoff drift: unchanged originals → clean");
  files["src/b.ts"] = "two, edited";
  delete files["src/c.ts"];
  const dirty = driftOf(man, hashOf, (p) => p in files);
  const msgs = driftMessages(dirty);
  ok(!driftClean(dirty) && dirty.changed.length === 1 && dirty.changed[0].original === "src/b.ts" && dirty.missing[0]?.original === "src/c.ts" && dirty.portsMissing.join() === "h/gone.ts"
    && msgs[0] === `re-check h/a.ts against src/b.ts, then update ${PORT_SOURCES_FILE} with \`--drift --update\`` && msgs.length === 3,
    "handoff drift: a changed original names its port and the re-check; a gone original and a missing port are listed too");
  const upd = updatedPortSources(man, hashOf);
  ok(upd.ports[0].originals[1].sha256 === sha256Of("two, edited") && upd.ports[1].originals[0].sha256 === sha256Of("three") && driftOf(upd, hashOf, () => true).changed.length === 0,
    "handoff drift: --update stamps current hashes (a gone original keeps its old one)");
  let threw = false;
  try {
    parsePortSources({ ports: [{ port: "x", what: "y", originals: [] }] });
  } catch {
    threw = true;
  }
  ok(threw, "handoff drift: a port with no originals is a malformed manifest");
  const real = parsePortSources(JSON.parse(fs.readFileSync(PORT_SOURCES_FILE, "utf8")));
  ok(real.ports.length >= 13 && real.ports.every((p) => fs.existsSync(p.port) && p.originals.every((o) => /^[0-9a-f]{64}$/.test(o.sha256))),
    `handoff drift: ${PORT_SOURCES_FILE} parses, every port module exists and every original has a stamped hash (whether originals still match is --drift's job)`);

  // --- the component overrides export every value name their originals do ---
  for (const [orig, repl] of Object.entries(APP_OVERRIDES)) {
    const want = exportNames(fs.readFileSync(orig, "utf8"));
    const have = new Set(exportNames(fs.readFileSync(nodePath.join("handoff/estimator", repl), "utf8")));
    const missingNames = want.filter((n) => !have.has(n));
    ok(want.length > 0 && missingNames.length === 0, `handoff review: override ${orig} → ${repl} exports every name the original does (missing: ${missingNames.join(", ") || "none"})`);
  }
}

/* ------------------------------------------------------------------ PR 2 Task 6: Send & track (simulated), the next-step flow, the refusals */

export async function handoffSendChecks(ok: Ok) {
  const cust: SeedCustomers = {
    companies: [{ id: "c1", name: "Acme Theatre" }],
    sites: [{ id: "s1", companyId: "c1", name: "Main Hall", city: "Madison", isPrimary: true }],
    contacts: [{ id: "k1", firstName: "Pat", lastName: "Lee", homeCompanyId: "c1", title: "TD", isPrimary: true }],
    contactEmails: [{ id: "e2", contactId: "k1", email: "pat.other@acme.test", isPrimary: false }, { id: "e1", contactId: "k1", email: "pat@acme.test", isPrimary: true }],
    contactPhones: [], geoCache: [],
  };
  const team: SeedTeamUser[] = [
    { id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" },
    { id: "u2", name: "Eve Estimator", roles: ["Estimator"], status: "active" },
    { id: "u3", name: "Rex Reviewer", roles: ["Reviewer"], status: "active" },
    { id: "u4", name: "Mia Manager", roles: ["Manager"], status: "active" },
  ];
  const sections = [sec("s1", [{ sku: "ETC:CS15", desc: "ColorSource 15", qty: 4, cost: 900, price: 1250 }], { name: "Stage lighting" })];
  const base = { quoteType: "system", source: "estimator", customerId: "c1", customer: "Acme Theatre", contactName: "Pat Lee", owner: "Ann Admin", createdAt: 1, history: [], revisions: [], spec: { sections, mobs: [] } };
  const qa = { ...base, id: "Q-4001", estNo: 4001, name: "Main stage", status: "draft", updatedAt: 1_790_000_000_000 };
  const qb = { ...base, id: "Q-4002", estNo: 4002, name: "Second", status: "draft", updatedAt: 1_790_000_000_000, vendorQuotes: [{ id: "vq1", vendorCompanyId: "c1", quoteNumber: "V-1", total: 10 }, { id: "vq2", vendorCompanyId: "c-gone" }] };
  const qc = { ...base, id: "Q-4003", estNo: 4003, name: "Third", status: "draft", updatedAt: 1_790_000_000_000 };
  const qWon = { ...base, id: "Q-4004", estNo: 4004, name: "Closed", status: "won", updatedAt: 1 };
  const { status: _noStatus, ...qNoStatus } = { ...base, id: "Q-4006", estNo: 4006, name: "Fixture-like", status: "draft", updatedAt: 1_790_000_000_000 }; // the golden fixtures carry no status
  void _noStatus;
  const flame = { id: "Q-4005", estNo: 4005, name: "Flame", status: "draft", quoteType: "flame", source: "flame", createdAt: 1, updatedAt: 1, history: [], revisions: [], spec: {} };
  const store = await openStore({ quotes: docs([qa, qb, qc, qWon, flame, qNoStatus]), catalog: [], fixtures: [], blobs: [], settings: [{ id: "main", data: { companyName: "Peak Systems Group" } } as { id: string }] }, { idb: null });
  configurePorts({ store, customers: cust, rules: { settings: { companyName: "Peak Systems Group" }, blobs: {} }, team });
  const repo = quoteRepo(store);
  const ops = reviewOps(repo);
  const NS = nextStepActions(store);
  let refreshes = 0;
  const offRefresh = onRefresh(() => void refreshes++);
  const as = (id: string) => {
    users.setCurrent(id);
    const u = users.current();
    return { name: u.name, roles: u.roles ?? [] };
  };

  // --- the pure review rules (quotes.ts) ---
  ok(!validateAttestationNote("  ").ok && validateAttestationNote(" by phone ").ok && (validateAttestationNote(" by phone ") as { note: string }).note === "by phone",
    "handoff send: validateAttestationNote — a blank note is refused, a note is trimmed");
  ok(!canAttestApproval({ state: "changes" } as Quote["review"]).ok && canAttestApproval(null).ok, "handoff send: canAttestApproval — a reviewer's changes can't be attested past");
  const inRev = { status: "draft", updatedAt: 5, review: { state: "in_review" } } as unknown as Quote;
  ok(decidableUnderLock(inRev, {}) && !decidableUnderLock(inRev, { expectUpdatedAt: 4 }) && !decidableUnderLock({ ...inRev, review: { state: "none" } } as Quote, {})
    && decidableUnderLock({ ...inRev, review: { state: "none" } } as Quote, { allowUnsubmitted: true }) && !decidableUnderLock({ ...inRev, status: "sent", review: { state: "none" } } as Quote, { allowUnsubmitted: true }),
    "handoff send: decidableUnderLock — in review at the version shown; approve-only also takes an unsubmitted DRAFT");

  // --- the review ops (quote-review-ops.ts), through the next-step actions ---
  as("u2");
  const sub = await NS.nsSubmitAction("Q-4001", null);
  ok(sub.ok && sub.status === "draft" && sub.review?.state === "in_review" && sub.review.submittedBy === "Eve Estimator" && !!sub.next && /^In review/.test(sub.next.pill.label),
    `handoff send: nsSubmitAction — a non-owner Estimator submits; the sync carries review, status and the re-evaluated next step (${sub.next?.pill.label})`);
  ok(refreshes >= 1, "handoff send: a successful next-step action refreshes the page (revalidatePath → router.refresh)");
  const again = await NS.nsSubmitAction("Q-4001", null);
  ok(!again.ok && again.error === "This quote is already waiting for approval." && again.review?.state === "in_review", "handoff send: submitting twice — 'already waiting', the fresh state still returned");
  as("u1");
  const own = await NS.nsApproveAction("Q-4001");
  ok(!own.ok && /can't approve your own quote/.test(own.error ?? ""), "handoff send: the owner can't approve their own quote in review");
  as("u2");
  ok(!(await NS.nsApproveAction("Q-4001")).ok, "handoff send: an Estimator (no approve) can't decide");
  as("u4");
  const stale = await NS.nsApproveAction("Q-4001", 123);
  ok(!stale.ok && stale.error === "This quote changed since you opened it — reload to review the current version." && stale.review?.state === "in_review",
    "handoff send: approving a version the approver wasn't shown is refused (CHANGED_SINCE), nothing decided");
  const shown = (await repo.get("Q-4001"))!.updatedAt;
  const appr = await NS.nsApproveAction("Q-4001", shown);
  const apprQ = (await repo.get("Q-4001"))!;
  ok(appr.ok && apprQ.review.state === "approved" && apprQ.review.method === "in_app" && apprQ.review.decidedBy === "Mia Manager" && apprQ.review.submittedBy === "Eve Estimator" && !!apprQ.review.approvedAgainst,
    "handoff send: a Manager approves the version shown — in_app, decidedBy, the submitter kept, the approval fingerprint stamped");
  as("u2");
  ok((await NS.nsWithdrawAction("Q-4001")).error === "This quote isn't waiting for approval.", "handoff send: withdraw after the decision — not waiting");
  // send back + resubmit + attest
  as("u2");
  await NS.nsSubmitAction("Q-4002", null);
  as("u3");
  ok((await NS.nsSendBackAction("Q-4002", "  ")).error === "Say what needs to change.", "handoff send: send back needs a note");
  const back = await NS.nsSendBackAction("Q-4002", "Add labor");
  ok(back.ok && back.review?.state === "changes" && back.review.note === "Add labor" && back.review.decidedBy === "Rex Reviewer" && /^Changes requested/.test(back.next?.pill.label ?? ""),
    "handoff send: a Reviewer sends it back — changes, the note, the pill");
  as("u1");
  const att = await NS.nsAttestAction("Q-4002", "Reviewed by Jeff on a call");
  ok(!att.ok && /asked for changes/.test(att.error ?? ""), "handoff send: the owner can't attest past a reviewer's changes");
  as("u2");
  const resub = await NS.nsSubmitAction("Q-4002", "Rex Reviewer");
  ok(resub.ok && resub.review?.state === "in_review" && resub.review.reviewer === "Rex Reviewer", "handoff send: resubmit after changes, assigned to a named approver");
  ok((await NS.nsSubmitAction("Q-4003", "Nobody Here")).error === "Pick an approver from the list.", "handoff send: an assignee must be an approver on the roster");
  ok((await NS.nsWithdrawAction("Q-4002")).ok && (await repo.get("Q-4002"))!.review.state === "none", "handoff send: the submitter withdraws");
  as("u1");
  ok((await NS.nsAttestAction("Q-4002", "")).error?.startsWith("An attested approval requires a note") === true, "handoff send: attest needs a note");
  const attOk = await NS.nsAttestAction("Q-4002", "Reviewed by Jeff on a Teams call");
  ok(attOk.ok && attOk.review?.state === "approved" && (await repo.get("Q-4002"))!.review.method === "attested", "handoff send: the owner attests an off-platform review");
  // approve-only on an unsubmitted draft, then a non-approver's send (gate passes on the approval)
  as("u4");
  const only = await NS.nsApproveAction("Q-4003", (await repo.get("Q-4003"))!.updatedAt);
  ok(only.ok && only.review?.state === "approved" && only.review.reviewer === "Mia Manager", "handoff send: Approve only (owner sends) on a draft that was never submitted");
  // send-to-customer gating
  as("u2");
  const fresh = await repo.create({ name: "Unapproved", source: "estimator", owner: "Eve Estimator" });
  const gated = await NS.nsSendAction(fresh.id);
  ok(!gated.ok && /approval on record before it can be sent/.test(gated.error ?? "") && (await repo.get(fresh.id))!.status === "draft", "handoff send: an Estimator can't send an unapproved quote (the gate), nothing written");
  as("u3");
  const sendRex = await NS.nsSendAction("Q-4003");
  ok(sendRex.ok && sendRex.status === "sent" && (await repo.get("Q-4003"))!.revisions?.at(-1)?.reason === "sent" && (await repo.get("Q-4003"))!.review.state === "approved",
    "handoff send: an approver (Reviewer: approve, no send) may send — status sent, the sent revision cut, the approval still stamped (approved earlier by Mia)");
  // an owner who holds approve self-approves on send (method "self")
  as("u1");
  const selfQ = await repo.create({ name: "Owner sends", source: "estimator", owner: "Ann Admin", spec: { sections, mobs: [] } } as Partial<Quote>);
  const selfSend = await NS.nsSendAction(selfQ.id);
  const selfAfter = (await repo.get(selfQ.id))!;
  ok(selfSend.ok && selfAfter.status === "sent" && selfAfter.review.state === "approved" && selfAfter.review.method === "self" && selfAfter.review.decidedBy === "Ann Admin",
    `handoff send: an owner holding approve self-approves on send — method "self", decidedBy the owner (${JSON.stringify(selfAfter.review)})`);
  // a quote stored with NO status (the golden fixtures) reads as a draft everywhere: it can be submitted, and the stored doc keeps no status
  as("u2");
  const nsq = (await repo.get("Q-4006"))!;
  const nsSub = await NS.nsSubmitAction("Q-4006", null);
  const nsStored = await store.get<{ status?: string; review?: { state: string } }>("quotes", "Q-4006");
  ok(nsq.status === "draft" && nsSub.ok && nsSub.review?.state === "in_review" && nsStored?.review?.state === "in_review" && nsStored.status === undefined,
    `handoff send: a status-less quote reads as a draft — Submit works, and the stored doc is not given the default (${nsStored?.status})`);
  as("u3");
  ok((await NS.nsSendAction("Q-4003")).error === "This quote has already been sent.", "handoff send: sending twice — already sent");
  ok((await ops.sendQuoteToCustomer("Q-nope", { name: "x", roles: ["Admin"] })).ok === false && (await NS.nsSendAction("Q-nope")).next === null, "handoff send: a missing quote — not found, next null");

  // --- send-actions (Send & track) ---
  const SA = sendActions(store);
  as("u1");
  const defs = await SA.estimateEmailDefaultsAction("Q-4001");
  ok(defs.ok && defs.to === "pat@acme.test" && defs.cc === "" && defs.subject === "Main stage — estimate EST-4001" && defs.body.startsWith("Hi Pat,") && defs.body.includes("{link}") && defs.body.includes("Thanks,\nAnn Admin") && !defs.gmailConnected,
    `handoff send: estimateEmailDefaultsAction — To = the contact's primary email, the subject / greeting / {link} line / sign-off, Gmail not connected (${JSON.stringify(defs).slice(0, 160)})`);
  ok((await SA.estimateEmailDefaultsAction("Q-4005")).ok === false && (await SA.estimateEmailDefaultsAction("Q-nope")).ok === false, "handoff send: defaults — a flame quote isn't an estimate; a missing quote is gone");
  const errOf = (r: { ok: boolean }) => (r as { error?: string }).error;
  const input = (over: Record<string, unknown> = {}) => ({ to: "pat@acme.test", cc: "pat@acme.test, boss@acme.test", subject: "Main stage — estimate EST-4001", body: "Hi Pat,\nSee {link}\nThanks", attachEstimate: true, attachCover: true, followUpDays: 5, ...over });
  ok(errOf(await SA.sendEstimateEmailAction("Q-4001", input({ to: "" }))) === SEND_COPY.noTo, "handoff send: send — no To is refused");
  ok(errOf(await SA.sendEstimateEmailAction("Q-4001", input({ to: "not-an-address" }))) === SEND_COPY.badTo(["not-an-address"]), "handoff send: send — a bad To names it");
  ok(errOf(await SA.sendEstimateEmailAction("Q-4001", input({ followUpDays: 4 }))) === SEND_COPY.badFollowUp, "handoff send: send — the follow-up must be one of the choices");
  const staleSend = await SA.sendEstimateEmailAction("Q-4001", input({ asOf: 42 }));
  ok(!staleSend.ok && staleSend.error === SEND_COPY.changedSince && staleSend.next !== undefined && staleSend.status === "draft", "handoff send: a version the sender wasn't shown — refused, with the fresh view to retry against");
  ok(errOf(await SA.sendEstimateEmailAction("Q-4004", input())) === SEND_COPY.closed, "handoff send: a won estimate can't be emailed");
  as("u2");
  const gatedSend = await SA.sendEstimateEmailAction(fresh.id, input());
  ok(!gatedSend.ok && /approval on record/.test(gatedSend.error) && !(await store.all<{ quoteId: string }>("activity")).some((a) => a.quoteId === fresh.id),
    "handoff send: the approval gate refuses the first send — nothing recorded, nothing marked");
  const actsBefore = (await store.all("activity")).length;
  const [p1, p2] = await Promise.all([SA.sendEstimateEmailAction("Q-4001", input()), SA.sendEstimateEmailAction("Q-4001", input())]);
  const sentOk = p1.ok ? p1 : p2;
  const other = p1.ok ? p2 : p1;
  ok(sentOk.ok && !other.ok && other.error === SEND_COPY.inProgress, `handoff send: two sends at once — one goes, the other is 'in progress' (${JSON.stringify([p1.ok, p2.ok])})`);
  const sq = (await repo.get("Q-4001"))!;
  const acts = (await store.all<Record<string, unknown>>("activity")).filter((a) => a.quoteId === "Q-4001" && a.kind === "email");
  ok(sentOk.ok && sentOk.delivery === "local" && sentOk.status === "sent" && sq.status === "sent" && sq.revisions?.at(-1)?.reason === "sent" && sq.estimateEmails?.length === 1 && sq.estimateEmails[0].threadId === sentOk.threadId,
    "handoff send: the first send marks the draft sent (the sent revision) and records the email on the quote");
  const row = acts[0] as { to: string[]; cc?: string[]; body: string; attachments?: string[]; rev?: number; by: string } | undefined;
  ok((await store.all("activity")).length === actsBefore + 1 && !!row && row.to.join() === "pat@acme.test" && row.cc?.join() === "boss@acme.test" && row.body.includes(SIMULATED_LINK) && !row.body.includes("{link}")
    && row.attachments?.join() === "EST-4001.pdf,EST-4001 Cover.pdf" && row.rev === sq.revisions?.at(-1)?.rev && row.by === "Eve Estimator",
    `handoff send: the email port records one row — To, Cc without the To, the body with the link placeholder, the would-be attachments, the rev (${JSON.stringify(row).slice(0, 220)})`);
  ok(sentOk.ok && (sentOk.warning ?? "").includes("Simulated") && (sentOk.warning ?? "").includes(NO_FOLLOW_UP_TASK) && sentOk.next !== undefined, "handoff send: the result says it was simulated, that no follow-up task was made, and carries the next step");
  const resend = await SA.sendEstimateEmailAction("Q-4001", input({ followUpDays: 0, attachCover: false }));
  ok(resend.ok && resend.status === "sent" && (await repo.get("Q-4001"))!.estimateEmails?.length === 2 && !(resend.warning ?? "").includes(NO_FOLLOW_UP_TASK), "handoff send: a re-send on a sent quote records a second email, status stays sent");
  const track = await SA.sendTrackAction("Q-4001");
  ok(track.ok && track.emails.length === 2 && track.emails.every((e) => e.messages.length === 1 && e.messages[0].snippet.startsWith(SIMULATED_SEND_MARK) && e.delivery === "local" && !e.canReply && e.rev >= 1)
    && track.emails[0].sentAt >= track.emails[1].sentAt && track.newReplies === 0 && track.opens.total === 0,
    "handoff send: sendTrackAction — each recorded email, newest first, reads 'Sent (simulated)', delivered locally, no Reply");
  ok((await SA.sendTrackAction("Q-nope")).ok === false && ((await SA.sendTrackAction("Q-nope")) as { error: string }).error === TRACK_GONE, "handoff send: track — a missing quote is 'Not found.'");
  ok(trackedEmailsOf({ estimateEmails: [{ threadId: "gone", rev: 1, at: 1, by: "x", to: "y" }] } as unknown as Quote, []).length === 0, "handoff send: track — a recorded email with no activity row is skipped");
  // the email port throwing after the draft was marked sent → the original's partial result (not a throw), with the fresh view
  as("u1");
  const failQ = await repo.create({ name: "Port fails", source: "estimator", owner: "Ann Admin", customerId: "c1", customer: "Acme Theatre", spec: { sections, mobs: [] } } as Partial<Quote>);
  const realSend = email.send;
  email.send = async () => {
    throw new Error("port down");
  };
  let partial: Awaited<ReturnType<typeof SA.sendEstimateEmailAction>> | null = null;
  let partialThrew = false;
  try {
    partial = await SA.sendEstimateEmailAction(failQ.id, input({ subject: "Port fails", followUpDays: 0 }));
  } catch {
    partialThrew = true;
  }
  const retry = await SA.sendEstimateEmailAction("Q-4001", input({ followUpDays: 0 })).catch(() => null);
  email.send = realSend;
  const failAfter = (await repo.get(failQ.id))!;
  ok(!partialThrew && partial !== null && !partial.ok && partial.error === SEND_COPY.partialNoThread && partial.markedSent === true && partial.status === "sent" && partial.next !== undefined
    && failAfter.status === "sent" && !failAfter.estimateEmails?.length,
    `handoff send: the email port throwing after mark-sent → the partial result (markedSent, the fresh view), not a throw (${JSON.stringify(partial)?.slice(0, 160)})`);
  ok(retry !== null && !retry.ok && retry.error === SEND_COPY.notSent && !("markedSent" in retry && retry.markedSent), "handoff send: the port throwing on an already-sent quote → the plain 'didn't go out' (nothing marked)");
  const R = refusedSendActions();
  ok(REFUSED_SEND_ACTIONS.every((n) => JSON.stringify((R[n] as () => unknown)()) === JSON.stringify(NOT_IN_PROTOTYPE)), "handoff send: Open in Inbox / Reply / Mark read refuse");
  // Won → the onWon note shows in the prototype log
  as("u1");
  await repo.setStatus("Q-4001", "won", "Ann Admin");
  const notes = prototypeNotesFor(await store.all("activity"), "Q-4001");
  ok(notes.length === 1 && notes[0].kind === "won" && /Would create install project/.test(notes[0].note ?? ""), "handoff send: Mark Won → the prototype log lists the onWon port's note (emails are the card's)");

  // --- the misc registrations: shape-valid empties and refusals ---
  const M = miscActions(store);
  const call = (file: string, name: string, ...args: unknown[]) => (M[file][name] as (...a: unknown[]) => Promise<unknown> | unknown)(...args);
  const bp = (await call("src/app/(app)/estimator/bid-actions.ts", "bidPanelAction", "Q-4002")) as { ok: boolean; panel?: ReturnType<typeof emptyBidPanel> };
  ok(bp.ok && bp.panel!.bidders.length === 0 && !bp.panel!.canEdit && !bp.panel!.canSend && bp.panel!.ownerName === "Acme Theatre" && bp.panel!.rev === 1,
    "handoff send: bidPanelAction — the original's empty panel (no bidders, nothing editable)");
  ok(((await call("src/app/(app)/estimator/bid-actions.ts", "bidPanelAction", "Q-nope")) as { ok: boolean }).ok === false, "handoff send: bidPanelAction — a missing quote refuses");
  as("u2");
  const shDraft = (await call("src/app/(app)/estimator/share-actions.ts", "shareLinkStatusAction", "Q-4002")) as { ok: boolean; status: { state: string; canSend: boolean; link: unknown; sentRevs: unknown[] } };
  const shSent = (await call("src/app/(app)/estimator/share-actions.ts", "shareLinkStatusAction", "Q-4003")) as { ok: boolean; status: { state: string; sentRevs: unknown[] } };
  ok(shDraft.ok && shDraft.status.state === "not-sent" && shDraft.status.canSend && shDraft.status.link === null && shDraft.status.sentRevs.length === 0 && shSent.status.state === "ok" && shSent.status.sentRevs.length === 1,
    "handoff send: shareLinkStatusAction — the online state and sent revisions, no link (none can be minted)");
  const vp = (await call("src/app/(app)/estimator/vendor-actions.ts", "vendorsPanelAction", "Q-4002")) as { ok: boolean; companies: Array<{ id: string; name: string }>; threads: unknown[] };
  ok(vp.ok && vp.companies.map((c) => `${c.id}=${c.name}`).join() === "c1=Acme Theatre,c-gone=c-gone" && vp.threads.length === 0, "handoff send: vendorsPanelAction — the quote's vendor companies, named from the directory (else the id), no threads");
  ok(Array.isArray(await call(PARTIES_ACTIONS_KEY, "listPartiesAction", "quote", "Q-4001")) && ((await call(PARTIES_ACTIONS_KEY, "listPartiesAction", "quote", "Q-4001")) as unknown[]).length === 0,
    "handoff send: listPartiesAction — the original's list type, empty");
  const rc = (await call("src/app/(app)/rewards/actions.ts", "rewardCreditInfoAction", "c1", "Q-4001")) as { enabled: boolean; balance: number };
  ok(rc.enabled === false && rc.balance === 0 && (await call("src/app/(app)/rewards/actions.ts", "purchasePerksBannerAction", "c1")) === "", "handoff send: Rewards off — credit info disabled, no perks banner");
  ok(((await call("src/app/(app)/inbox/link-popup-actions.ts", "searchLinkTargetsAction", "acme")) as { companies: unknown[] }).companies.length === 0
    && ((await call("src/app/(app)/vendors/actions.ts", "searchVendorCompaniesAction", "acme")) as unknown[]).length === 0, "handoff send: the list-returning searches answer empty lists (no refusal member in their types)");
  ok(JSON.stringify(await call("src/app/(app)/estimator/bid-actions.ts", "addBidderAction", "Q-4001", {})) === JSON.stringify(NOT_IN_PROTOTYPE)
    && ((await call("src/app/(app)/estimator/bid-send-actions.ts", "sendToBidderAction", "Q-4001", "pty_1")) as { partyId: string; scope: string; ok: boolean }).scope === "quote"
    && ((await call("src/app/(app)/estimator/vendor-pdf-actions.ts", "readVendorPdfAction", {})) as { runId: unknown }).runId === null
    && (await call(QUOTES_HUB_ACTIONS_KEY, "saveQuoteRevisionAction", new FormData())) === undefined,
    "handoff send: refusals — NOT_IN_PROTOTYPE, the richer refusal shapes (bidder send, vendor PDF), the hub's void form actions");

  // --- every registered file covers every export of its "use server" original ---
  const regs = new Map<string, Set<string>>();
  for (const [file, impls] of actionRegistrations(store)) regs.set(file, new Set([...(regs.get(file) ?? []), ...Object.keys(impls)]));
  const gaps = [...regs].flatMap(([file, have]) => exportNames(fs.readFileSync(file, "utf8")).filter((n) => !have.has(n)).map((n) => `${file}#${n}`));
  ok(regs.size >= 22 && gaps.length === 0, `handoff send: every registered "use server" file covers all its exports (${regs.size} files; missing: ${gaps.join(", ") || "none"})`);
  ok(unregisteredExports({ "a.ts": ["x", "y"], "b.ts": ["z"] }, ["a.ts#x"]).join() === "a.ts#y,b.ts#z", "handoff send: unregisteredExports — the discovered exports with no registration (verify --all-steps)");
  offRefresh();
  configurePorts({ store: null, customers: null, rules: null, team: null });
}


/** Task 7 — the shell's pure parts: hash routes, app-path mapping, history rewriting, the Estimates list's rows, Reset. */
export async function handoffShellChecks(ok: Ok) {
  const FILE = "file:///Users/x/prototype/index.html";
  const estimate = (id: string): Route => ({ name: "estimate", id });
  const same = (a: Route, b: Route) => sameRoute(a, b);

  // --- parseRoute / routeHash / routeSearch ---
  ok(same(parseRoute("", ""), { name: "estimates" }) && same(parseRoute("#/estimates", ""), { name: "estimates" }) && same(parseRoute("#/", ""), { name: "estimates" }), "handoff shell: no route (or #/estimates) is the Estimates list");
  ok(same(parseRoute("#/estimate/Q-G001", "?id=Q-G001&step=review"), estimate("Q-G001")) && same(parseRoute("#/estimate/new", "?new=1"), estimate("new")), "handoff shell: #/estimate/<id> and #/estimate/new");
  ok(same(parseRoute("#/estimate/Q%20x", ""), estimate("Q x")) && routeHash(estimate("Q x")) === "#/estimate/Q%20x", "handoff shell: an estimate id is URI-encoded in the hash and decoded back");
  ok(same(parseRoute("#/catalog", ""), { name: "catalog" }) && same(parseRoute("#/assemblies", ""), { name: "assemblies" }) && same(parseRoute("#/rules", ""), { name: "rules" }), "handoff shell: #/catalog, #/assemblies, #/rules");
  ok(parseRoute("#/zzz", "").name === "unknown" && parseRoute("#/estimate", "").name === "unknown" && parseRoute("#/estimate/a/b", "").name === "unknown" && parseRoute("#/catalog/x", "").name === "unknown", "handoff shell: an unknown hash route is 'unknown', never a screen");
  ok(same(parseRoute("", "?id=Q-G002&step=send"), estimate("Q-G002")) && same(parseRoute("", "?new=1"), estimate("new")) && same(parseRoute("#systems", "?id=Q-G002"), estimate("Q-G002")) && same(parseRoute("#systems", ""), { name: "estimates" }), "handoff shell: a pre-shell deep link (?id= / ?new=1, or an in-page anchor) names its estimate");
  ok(routeSearch(estimate("Q-1")) === "?id=Q-1" && routeSearch(estimate("new")) === "?new=1" && routeSearch({ name: "catalog" }) === "", "handoff shell: routeSearch — the Estimator's ?id= / ?new=1, nothing for the other screens");

  // --- mapAppHref ---
  const on = estimate("Q-G001");
  const list: Route = { name: "estimates" };
  const map = (href: string, cur: Route = on) => mapAppHref(href, cur);
  const routeOf = (href: string, cur: Route = on) => {
    const t = map(href, cur);
    return t.kind === "route" ? `${routeHash(t.route)}${t.search}` : t.kind;
  };
  ok(routeOf("/estimator?id=Q-2041") === "#/estimate/Q-2041?id=Q-2041" && routeOf("/estimator?id=Q-2041&step=review") === "#/estimate/Q-2041?id=Q-2041&step=review", "handoff shell: /estimator?id=X → #/estimate/X, the Estimator's own params kept");
  ok(routeOf("/quotes") === "#/estimates" && routeOf("/catalog") === "#/catalog" && routeOf("/design/assemblies") === "#/assemblies" && routeOf("/estimating-rules") === "#/rules" && routeOf("/quotes/") === "#/estimates", "handoff shell: /quotes, /catalog, /design/assemblies, /estimating-rules → their routes");
  ok(map("?step=review").kind === "page" && map("/estimator?step=review").kind === "page" && map("/estimator?step=package&ptab=client#systems", on).kind === "page", "handoff shell: a query change on the open estimate stays on the page");
  const withAnchor = map("?step=package&ptab=client#systems");
  ok(withAnchor.kind === "page" && withAnchor.anchor === "systems" && withAnchor.search === "?step=package&ptab=client", "handoff shell: an in-page anchor rides a same-page change (scrolled to, never the route)");
  ok(routeOf("/estimator?step=review", list) === "#/estimate/new?new=1&step=review" && routeOf("/estimator", list) === "#/estimate/new?new=1" && routeOf("/estimator?new=1", on) === "#/estimate/new?new=1", "handoff shell: /estimator with no id and no open estimate (or ?new=1) starts a new estimate");
  ok(map("/design/grid/G-1").kind === "unsupported" && map("/design/specs/new?quote=Q-1").kind === "unsupported" && map("/catalog/documents").kind === "unsupported" && map("/design/assemblies/rack/R1").kind === "unsupported" && map("/inbox").kind === "unsupported", "handoff shell: any other app path is not part of the prototype");
  const unsupported = map("/design/grid/G-1?x=1");
  ok(unsupported.kind === "unsupported" && unsupported.path === "/design/grid/G-1?x=1", "handoff shell: the notice names the path");
  ok(map("https://example.com/").kind === "external" && map("mailto:a@b.test").kind === "external" && map("images/x.webp").kind === "external" && map("./a").kind === "external" && map("//cdn.test/a").kind === "external" && map("").kind === "external", "handoff shell: other sites, mailto:, packaged files and relative paths are the browser's");
  ok(map("#systems").kind === "anchor" && routeOf("#/catalog") === "#/catalog" && map("#/zzz").kind === "unsupported", "handoff shell: #anchor scrolls; #/route routes; an unknown #/route is not part of the prototype");

  // --- composeHistoryUrl: the Estimator rewrites the search; the hash is the shell's ---
  const at = (hash: string, search = "") => `${FILE}${search}${hash}`;
  const c1 = composeHistoryUrl(at("#/estimate/Q-G001", "?id=Q-G001"), "/Users/x/prototype/index.html?id=Q-G001&step=review");
  ok(c1.url === "/Users/x/prototype/index.html?id=Q-G001&step=review#/estimate/Q-G001" && !c1.explicit && c1.anchor === null, "handoff shell: pushState(pathname + ?search) keeps the route hash");
  const c2 = composeHistoryUrl(at("#/estimate/new", "?new=1"), "/Users/x/prototype/index.html?new=1&id=Q-2045");
  ok(c2.url.endsWith("#/estimate/Q-2045") && !c2.explicit, "handoff shell: a first save puts ?id= in the search → the hash follows to the new id");
  const c3 = composeHistoryUrl(at("#/estimate/new", "?new=1"), "/Users/x/prototype/index.html?new=1&step=package");
  ok(c3.url.endsWith("#/estimate/new"), "handoff shell: a new estimate with no id yet keeps #/estimate/new");
  const c4 = composeHistoryUrl(at("#/estimate/Q-G001", "?id=Q-G001"), "/Users/x/prototype/index.html?id=Q-G001&step=package&ptab=client#systems");
  ok(c4.anchor === "systems" && c4.url.endsWith("#/estimate/Q-G001") && c4.url.includes("ptab=client"), "handoff shell: #systems is taken out of the URL (scrolled to) — the route hash stays");
  const c5 = composeHistoryUrl(at("#/estimates"), "/Users/x/prototype/index.html#/estimate/Q-1");
  ok(c5.explicit && c5.url.endsWith("#/estimate/Q-1"), "handoff shell: a #/route URL is the shell's own and passes through");
  const c6 = composeHistoryUrl(at("", "?id=Q-G002"), "/Users/x/prototype/index.html?id=Q-G002&step=send");
  ok(c6.url.endsWith("#/estimate/Q-G002"), "handoff shell: with no hash yet (a pre-shell deep link) the route is derived from the search");

  // --- normalizedLocation ---
  ok(normalizedLocation(at("#/estimate/Q-G001", "?id=Q-G001&step=review")) === null && normalizedLocation(at("#/estimates")) === null && normalizedLocation(at("#/estimate/new", "?new=1")) === null, "handoff shell: a consistent location is left alone");
  ok(normalizedLocation(at("", "?id=Q-G001&step=review"))?.endsWith("?id=Q-G001&step=review#/estimate/Q-G001") === true, "handoff shell: ?id= with no hash gets its hash");
  ok(normalizedLocation(at("#/estimate/Q-G002", "?id=Q-G001&step=send"))?.endsWith("?id=Q-G002&step=send#/estimate/Q-G002") === true, "handoff shell: the hash wins over a stale ?id=");
  ok(normalizedLocation(at("#/estimates", "?id=Q-G001&step=send"))?.endsWith("/index.html#/estimates") === true && normalizedLocation(at("#/catalog", "?x=1"))?.endsWith("index.html#/catalog") === true, "handoff shell: a stale search is dropped from a non-estimate route");
  ok(normalizedLocation(at("#/estimate/Q-9", ""))?.endsWith("?id=Q-9#/estimate/Q-9") === true && normalizedLocation(at("#/estimate/new", ""))?.endsWith("?new=1#/estimate/new") === true, "handoff shell: an estimate route typed without a search gets ?id= / ?new=1");
  ok(normalizedLocation(at("#/zzz")) === null, "handoff shell: an unknown route is left as typed");

  // --- the Estimates list rows ---
  const sec = (price: number, cost: number) => [{ id: "s1", name: "Sys", items: [{ id: "i1", sku: "X", desc: "A part", qty: 1, cost, price, unit: "ea", margin: null }] }];
  const mk = (id: string, extra: Record<string, unknown> = {}) => ({ id, estNo: null, name: id + " name", customer: "Acme", owner: "Ann", updatedAt: 1, status: "draft", quoteType: "system", source: "estimator", spec: { sections: sec(1000, 800), groups: [] }, ...extra });
  const quotes = [
    mk("Q-1", { updatedAt: 100, estNo: 1001, status: "sent" }),
    mk("Q-2", { updatedAt: 300, name: "Zeta", customer: "Beta Hall" }),
    mk("Q-3", { updatedAt: 200, quoteType: "flame_test" }),
    mk("Q-4", { updatedAt: 300, status: undefined, customer: "" }),
    mk("Q-5", { updatedAt: 50, status: "won", owner: "Bob", name: "" }),
  ];
  const general: Record<string, unknown> = {};
  const rows = listRows(quotes, general, (q) => (q.customerId ? "Resolved" : q.customer ?? ""));
  ok(rows.map((r) => r.id).join() === "Q-2,Q-4,Q-1,Q-5", `handoff shell: the list is system estimates only, newest first, ties by id (${rows.map((r) => r.id).join()})`);
  ok(rows[0].number === "Q-2" && rows[2].number === "EST-1001" && rows[3].name === "Untitled estimate", "handoff shell: number = displayQuoteNumber (EST-#### once numbered, else the id); a missing name reads Untitled estimate");
  ok(rows[1].status === "draft" && rows[2].status === "sent", "handoff shell: a quote with no status is a draft (the golden fixtures carry none)");
  const t2 = canonicalTotals(quotes[1], general);
  ok(rows[0].grand === t2.canonical && rows[0].total === `$${t2.canonical.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "handoff shell: a row's total is the Estimator's canonical grand total, printed like its header");
  ok(expectedEstimatorTotals(quotes[1] as never, { blobs: {} }).canonical === t2.canonical && t2.raw === totals(sec(1000, 800) as never, 0).grand, "handoff shell: verify's expectedEstimatorTotals and the list read the same canonicalTotals (raw = the stored sections' totals)");
  ok(filterRows(rows, "draft", "").map((r) => r.id).join() === "Q-2,Q-4" && filterRows(rows, "all", "beta").map((r) => r.id).join() === "Q-2" && filterRows(rows, "all", "EST-1001").map((r) => r.id).join() === "Q-1" && filterRows(rows, "won", "bob").length === 1 && filterRows(rows, "sent", "bob").length === 0, "handoff shell: the status filter and the search (number, name, customer, owner) combine");
  const counts = statusCounts(rows);
  ok(counts.all === 4 && counts.draft === 2 && counts.sent === 1 && counts.won === 1 && counts.lost === 0, "handoff shell: status counts");
  ok(updatedLabel(Date.UTC(2026, 9, 14, 3, 0)) === "Oct 13, 2026" && updatedLabel(0) === "—", "handoff shell: Updated prints in Chicago time (Oct 14 03:00 UTC is still Oct 13 there)");
  ok(listRows([mk("Q-9", { customerId: "c1" })], general, (q) => (q.customerId ? "Resolved Co" : ""))[0].customer === "Resolved Co", "handoff shell: the customer column resolves a customer id");

  // --- Reset ---
  const blocked = await runReset({ reset: () => Promise.reject(new Error(RESET_BLOCKED_MESSAGE)) });
  ok(!blocked.ok && blocked.error === "Close other prototype windows and try again.", "handoff shell: a blocked reset surfaces the store's message verbatim");
  const odd = await runReset({ reset: () => Promise.reject("boom") });
  ok(!odd.ok && odd.error.includes("did not go through"), "handoff shell: a reset that rejects with a non-Error still reads sensibly");
  let called = 0;
  const fine = await runReset({ reset: async () => void (called += 1) });
  ok(fine.ok && called === 1, "handoff shell: a clean reset resolves ok after exactly one store.reset()");
}
