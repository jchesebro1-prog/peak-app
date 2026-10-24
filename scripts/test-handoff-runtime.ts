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
import { DB_KEY_MAX, DB_NAME, dbNameFor, overlayFromRows, overlayMerge, openStore, RESET_BLOCKED_MESSAGE, storeSeedFrom, type HandoffStore } from "../handoff/estimator/runtime/store";
import {
  blobData, clock, configurePorts, customers, customersFrom, email, nextEstNoFrom, numbering, onWon, refreshPortsFromStore, resolveTierFor, travelFromParts, users,
} from "../handoff/estimator/runtime/ports";
import { bySkuResolver, buildEstimatorProps } from "../handoff/estimator/runtime/props/estimator";
import type { SeedCustomers, SeedRules, SeedTeamUser } from "../handoff/estimator/runtime/seed";
import { sliceExport, type ExportV2 } from "../handoff/estimator/slice";
import { sanitizeQuote } from "../handoff/estimator/slice-rules";
import { expectedEstimatorTotals } from "../handoff/estimator/verify";
import type { Ok } from "./test-inbox-org";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import type { SavePayload } from "@/app/(app)/estimator/actions";
import type { SpecSection } from "@/lib/estimating-core/types";
import { customerLines, totals } from "@/lib/estimating-core/pricing";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { DEFAULT_BONUS_RATES } from "@/lib/estimate-bonus/flags";
import {
  applyUpdate, buildQuote, decideApprovalGate, isApprovalGateRefusal, nextQuoteId, pushRevision, resolveSaveStatusChange, STATUS_CHANGE_FAILED, statusFailureMessage,
} from "../handoff/estimator/runtime/quote-model";
import { quoteRepo, withLock } from "../handoff/estimator/runtime/quote-repo";
import { planSave, settleRewardCreditOffline, vendorQuotesForSave } from "../handoff/estimator/runtime/actions/save-core";
import { estimatorActions, refusedEstimatorActions, REFUSED_ESTIMATOR_ACTIONS, REFUSED_ESTIMATOR_FORMS, REFUSED_ESTIMATOR_RESULT_ACTIONS } from "../handoff/estimator/runtime/actions/estimator-actions";
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
import { assetUrl, PLACEHOLDER_DIR, partDocumentSrc, partPhotoSrc } from "../handoff/estimator/runtime/assets";
import { applyDraft, addLineSell, browseCatalog, draftFromPart, facetLabel, money, pageBounds, PAGE_SIZE, parsePrice, partFingerprint, skuIndex, validateSku } from "../handoff/estimator/runtime/catalog-model";
import { rankCatalogParts } from "@/lib/estimating-core/catalog-rank";
import type { LivePart } from "../handoff/estimator/runtime/readers";
import { POPOUT_NOTICE, PRINT_FOOTER_TEXT, previewTargetOf, windowOpenRoute } from "../handoff/estimator/ui/preview-routes";
import { cutSheetAppendixModels } from "../handoff/estimator/runtime/loaders/cut-sheets";
import { bomModelPartsLocal } from "../handoff/estimator/runtime/loaders/document";
import { preflightSend } from "../handoff/estimator/runtime/actions/send-actions";
import { BOX_SALE_LABOR_MESSAGE } from "@/lib/estimate-box-sale/rules";
import { withoutBasisKeys } from "@/lib/markup/settings";
import { reviewTabsFor } from "@/lib/estimate-review/review-ui";
import { stepViewsFor } from "../handoff/estimator/verify";
import { revisionDocFields } from "../handoff/estimator/runtime/quote-model";
import { packagePanelFor } from "../handoff/estimator/runtime/actions/package-actions";
import { claimsPort, driftClean, driftMessages, driftOf, parsePortSources, PORT_SCAN_DIR, PORT_SOURCES_FILE, sha256Of, unknownPorts, unlistedPorts, updatedPortSources } from "../handoff/estimator/port-drift";
import { APP_OVERRIDES, BAKED_MODULES, bakedSource, exportNames } from "../handoff/estimator/esbuild-plugins";
import { fmt } from "@/lib/estimating-core/pricing";
import { CUT_SHEETS_NO_QUOTE, CUT_SHEETS_WRONG_TYPE } from "@/lib/curtain-cut-sheets/model";
import { REVIEW_COMMENT_COPY } from "@/lib/estimate-review/comments";
import { previewPath } from "@/lib/estimate-output/package-preview";
import * as nodePath from "node:path";
import { NOT_IN_PROTOTYPE } from "../handoff/estimator/runtime/actions-registry";
import { reviewOps } from "../handoff/estimator/runtime/review-ops";
import { adoptedLocation, composeHistoryUrl, foreignOnly, mapAppHref, newTabHref, normalizedLocation, parseRoute, routeHash, routeSearch, sameRoute, withForeignParams, type Route } from "../handoff/estimator/runtime/routes";
import { filterRows, listRows, statusCounts, updatedLabel } from "../handoff/estimator/runtime/estimates-list-model";
import { canonicalTotals } from "../handoff/estimator/runtime/estimate-totals";
import { runReset } from "../handoff/estimator/runtime/reset";
import { ADOPTED_KEY, adopt, adopted } from "../handoff/estimator/runtime/adopted";
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
import { ASSEMBLIES_ACTIONS_KEY, assembliesActions, refusedAssembliesActions } from "../handoff/estimator/runtime/actions/assemblies-actions";
import { createFixtureLocal, getFixtureLocal, removeFixtureLocal } from "../handoff/estimator/runtime/fixtures-repo";
import { assemblyAccessoryLinks, buildAssemblyBuilderProps, rackDefaultsNow } from "../handoff/estimator/runtime/props/assemblies";
import { loadRackForSheetsLocal } from "../handoff/estimator/runtime/loaders/rack";
import { getManyLocal, listFixtures } from "../handoff/estimator/runtime/readers";
import { memberCoverageLabel, pairKey } from "@/lib/part-docs/assembly-graph";
import { emptyRackLayout } from "@/lib/rack/layout";
import type { FixtureInput, FixtureRecord } from "@/lib/fixture-assemblies";

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
  const calls = { opens: 0, deletes: 0, names: [] as string[] };
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
    open(name?: string) {
      const r: Req = {};
      calls.opens++;
      calls.names.push(`open ${name}`);
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
    deleteDatabase(name?: string) {
      const r: Req = {};
      calls.deletes++;
      calls.names.push(`delete ${name}`);
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
  // final review B9: the overlay database is keyed by the snapshot
  ok(dbNameFor("2026-10-20T15:04:05.123Z") === "peak-estimator-handoff:2026-10-20T15:04:05.123Z" && dbNameFor(null) === DB_NAME && dbNameFor("") === DB_NAME && dbNameFor(42) === DB_NAME,
    "handoff runtime B9: dbNameFor — peak-estimator-handoff:<exportedAt>; none → the bare name");
  ok(dbNameFor("a b/c<d>é") === "peak-estimator-handoff:abcd" && dbNameFor("x".repeat(200)).length === DB_NAME.length + 1 + DB_KEY_MAX && dbNameFor("A") !== dbNameFor("B"),
    "handoff runtime B9: dbNameFor — odd characters dropped, capped, and two snapshots never share a name");
  {
    const fake = fakeIdb();
    const a = await openStore({ meta: docs([{ id: "s1" }]) }, { idb: fake.factory, dbName: dbNameFor("snap-A") });
    await a.put("meta", { id: "edit-on-A" });
    ok(a.dbName === "peak-estimator-handoff:snap-A" && fake.calls.names.includes("open peak-estimator-handoff:snap-A"), "handoff runtime B9: openStore opens the snapshot's own database");
    await a.reset();
    ok(fake.calls.names.includes("delete peak-estimator-handoff:snap-A") && !fake.calls.names.some((n) => n === `delete ${DB_NAME}`), "handoff runtime B9: Reset deletes the snapshot's database (not the bare name)");
    const dflt = await openStore({ meta: [] }, { idb: null });
    ok(dflt.dbName === DB_NAME, "handoff runtime B9: no dbName → DB_NAME");
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
  // a stamped (already markup-basis) blob is read as stored; an UNSTAMPED one is a margin-era blob and converts once, whole-% (#367)
  configurePorts({ customers: tierCustomers, rules: { settings: {}, blobs: { pricing_rules: { "tiers.gold": 18, _pricingBasis: "markup" } } } });
  ok(customers.tierFor("co", "Sil Ver") === "silver" && customers.tierFor("co") === "gold" && customers.tierFor("zz") === "base", "handoff runtime: customers.tierFor — contact, then company, then base");
  ok(resolveTierFor("co").markup === 0.18 && resolveTierFor("co", "Sil Ver").markup === 0.28 && resolveTierFor(null).markup === 0.43, "handoff runtime: resolveTierFor — Estimating Rules markup (a stamped blob as stored), else the tier default (markup: Silver 28, Base 43)");
  configurePorts({ rules: { settings: {}, blobs: { pricing_rules: { "tiers.gold": 18, "tiers.silver": 22 } } } });
  ok(resolveTierFor("co").markup === 0.22 && resolveTierFor("co", "Sil Ver").markup === 0.28, "handoff runtime: resolveTierFor — a margin-era (unstamped) pricing_rules blob converts once: Gold 18 % margin → 22 % markup, Silver 22 → 28");

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
  ok(fresh.initial.pricingTier === "base" && fresh.initial.tierMargin === 0.43 && fresh.next === null, "handoff runtime: props — a new estimate opens at its tier, no next step");
  const unknown = await buildEstimatorProps(store, "Q-NOPE", new URLSearchParams());
  ok(unknown.initial.loadedId === null && unknown.initial.projectName === "New estimate", "handoff runtime: props — an unknown id opens a clean estimate");

  {
    // final review B11: the props read quotes through quoteRepo(store).get — a doc with no status reads as "draft",
    // exactly as the actions see it, and the store keeps it as stored
    const noStatus: Record<string, unknown> = { ...(await store.get<Record<string, unknown>>("quotes", "Q-G001"))!, id: "Q-NOSTATUS" };
    delete noStatus.status;
    await store.put("quotes", noStatus as { id: string });
    const pn = await buildEstimatorProps(store, "Q-NOSTATUS", new URLSearchParams());
    const fromRepo = await quoteRepo(store).get("Q-NOSTATUS");
    ok(pn.initial.loadedId === "Q-NOSTATUS" && pn.initial.status === "draft" && fromRepo?.status === "draft" && pn.initial.stage === fromRepo?.stage,
      `handoff runtime B11: props read through quoteRepo — no status → draft, the same stage the repo reads (${pn.initial.status} / ${pn.initial.stage} vs ${fromRepo?.stage})`);
    ok(!("status" in ((await store.get<Record<string, unknown>>("quotes", "Q-NOSTATUS")) ?? {})), "handoff runtime B11: …and the stored doc is left as stored (no status written)");
    await store.remove("quotes", "Q-NOSTATUS");
  }
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
  await handoffBoxSaleChecks(ok);
  await handoffDiscountChecks(ok);
  await handoffMarkupChecks(ok);
  await handoffShellChecks(ok);
  await handoffAssemblyChecks(ok);
  await handoffRulesChecks(ok);
}

/* ------------------------------------------------------------------ PR 2 Task 4: the Estimator's actions in the browser */

const sec = (id: string, items: Array<Partial<SpecSection["items"][number]>>, extra: Partial<SpecSection> = {}): SpecSection =>
  ({ id, name: id, kind: "lighting", freightPct: 0, items: items.map((it, i) => ({ id: i + 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 50, price: 100, ...it })), ...extra }) as SpecSection;

const payloadFor = (sections: SpecSection[], over: Partial<SavePayload> = {}): SavePayload => {
  const t = totals(sections, 0);
  return {
    name: "Test estimate", customer: "", customerId: null, locationId: null, contactName: "", quoteNote: "", assumptions: "", installTimeframe: "TBD",
    paymentTerms: "Unknown", category: "", value: t.grand, markup: t.markup, status: "draft", baseStatus: "draft", sections, mobs: [], groups: [],
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
  const tier = { tier: "base", markup: 0.43 };
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
  {
    // final review B14: won → draft (a revise) after a post-win edit puts the won version back (reopenPlanFor /
    // applyReopen; the edit is kept as a "manual" revision), and re-winning keeps it. No Rewards credit in the prototype.
    const wonSecs = [{ id: "s1", name: "Rig", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "X:1", desc: "Hoist", qty: 2, unit: "ea", cost: 100, price: 200 }] }];
    const editSecs = [{ ...wonSecs[0], items: [{ ...wonSecs[0].items[0], qty: 5 }] }];
    const r = await repo.create({ name: "Reopen", source: "estimator", owner: "Ann Admin", spec: { sections: wonSecs, mobs: [] } as never, value: 400 });
    await repo.setStatus(r.id, "sent", "Ann Admin");
    const won1 = (await repo.setStatus(r.id, "won", "Ann Admin"))!;
    await repo.update(r.id, { spec: { sections: editSecs, mobs: [] } as never, value: 1000 });
    const revsBefore = (await repo.get(r.id))!.revisions?.length ?? 0;
    const reopened = (await repo.setStatus(r.id, "draft", "Ann Admin"))!;
    const qtyOf = (q: Quote | null) => ((q?.spec as { sections: SpecSection[] } | null)?.sections[0]?.items[0]?.qty);
    ok(reopened.status === "draft" && qtyOf(reopened) === 2 && reopened.value === won1.value && reopened.value === 400,
      `handoff actions B14: won → draft restores the won version's sections and value (qty ${qtyOf(reopened)}, value ${reopened.value} vs ${won1.value})`);
    const autosave = reopened.revisions?.at(-1);
    ok((reopened.revisions?.length ?? 0) === revsBefore + 1 && autosave?.reason === "manual" && /reopening/i.test(autosave?.note ?? "") &&
      ((autosave?.spec as { sections: SpecSection[] } | null)?.sections[0]?.items[0]?.qty === 5),
      "handoff actions B14: …the post-win edit is snapshotted first (a manual revision noted as the reopen autosave)");
    const rewon = (await repo.setStatus(r.id, "won", "Ann Admin"))!;
    ok(rewon.status === "won" && qtyOf(rewon) === 2 && rewon.value === 400 && typeof rewon.wonRev === "number",
      `handoff actions B14: re-winning keeps the won version (qty ${qtyOf(rewon)}, value ${rewon.value}, wonRev ${rewon.wonRev})`);
    {
      // …and the same restore works on a bundled Won estimate: wonRev rides the slice (sanitizeQuote), the revision it
      // names ships too, a post-win edit is made, and reopening puts the won version back.
      const shipped = sanitizeQuote(JSON.parse(JSON.stringify(rewon)) as never) as unknown as Quote;
      ok(typeof shipped.wonRev === "number" && (shipped.revisions ?? []).some((rv) => rv.rev === shipped.wonRev), "handoff actions B14: a bundled Won estimate ships wonRev and the revision it points at");
      await store.put("quotes", { ...shipped, id: "Q-WON-SHIPPED", spec: { sections: editSecs, mobs: [] }, value: 1000 } as unknown as { id: string });
      const back = (await repo.setStatus("Q-WON-SHIPPED", "draft", "Ann Admin"))!;
      ok(back.status === "draft" && qtyOf(back) === 2 && back.value === 400, `handoff actions B14: reopening a bundled Won estimate restores the won version (qty ${qtyOf(back)}, value ${back.value})`);
      await repo.remove("Q-WON-SHIPPED");
    }
    await repo.remove(r.id);
  }

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
  ]), quotes: [], catalogRenames: [{ id: "80-0043", sku: "80-0043", renamedTo: "ETC:CS40" }] }, { idb: null });
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
  {
    // final review B12: writePart's stamps, and catalogGet's rename-following refusal
    const stamped = await catStore.get<{ updatedAt?: number; pricedAt?: number }>("catalog", "CUST-1");
    ok(typeof stamped?.updatedAt === "number" && Math.abs(stamped.updatedAt - Date.now()) < 5000 && stamped.pricedAt === stamped.updatedAt,
      `handoff actions B12: saveEstimatorCustomPartAction stamps updatedAt and pricedAt like writePart (got ${JSON.stringify(stamped)})`);
    const retired = await CA.saveEstimatorCustomPartAction({ sku: "80-0043", desc: "Old order number", category: "", unit: "", cost: 1, list: 2, mfr: "", manufacturerPartNumber: "", priceGoodThrough: "" });
    ok(!retired.ok && /80-0043 is already in the catalog/.test(retired.error) && !(await catStore.get("catalog", "80-0043")),
      "handoff actions B12: a retired SKU (renamed to a live part) is refused like catalogGet does — nothing written");
  }
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
  ok(REFUSED_ESTIMATOR_RESULT_ACTIONS.every((n) => (ref[n] as () => { ok: boolean; error: string })().error === "Not available in the prototype"), "handoff actions: the refused actions return NOT_IN_PROTOTYPE");
  ok(REFUSED_ESTIMATOR_FORMS.length === 3 && (await Promise.all(REFUSED_ESTIMATOR_FORMS.map((n) => (ref[n] as () => Promise<unknown>)()))).every((v) => v === undefined) &&
    REFUSED_ESTIMATOR_ACTIONS.length === REFUSED_ESTIMATOR_RESULT_ACTIONS.length + REFUSED_ESTIMATOR_FORMS.length,
    "handoff actions B13: the void quote-task form actions refuse by resolving to nothing, as their originals' signatures say (formRefusals)");
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
  ok(photoDocIdForSku("ETC:CS15") === null && Object.keys(keyProductPhotosLocal(kpSections, null, partOf)).length === 0, "handoff review: no packaged photos yet → no key-product photo");
  {
    // the packaged photo map (window.PEAK_PHOTOS = { bySku, byDoc }): the printed key-product photo comes from the same sku → doc → file lookup as the Catalog thumbnails
    const hadWin = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { value: { PEAK_PHOTOS: { bySku: { "ETC:CS15": "PD-15" }, byDoc: { "PD-15": "images/PD-15.webp" } } }, configurable: true, writable: true });
    try {
      const kp = keyProductPhotosLocal(kpSections, null, partOf);
      ok(photoDocIdForSku("ETC:CS15") === "PD-15" && kp["ETC:CS15"]?.src === "images/PD-15.webp", `handoff review: a key product's printed photo is the packaged one, through the same map as the Catalog thumbnails (${JSON.stringify(kp)})`);
    } finally {
      if (hadWin) Object.defineProperty(globalThis, "window", hadWin);
      else delete (globalThis as Record<string, unknown>).window;
    }
  }

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
  // final review A4: a lin-yd fabric weighs only with its bolt width (the slice now ships boltWidthIn)
  ok(cs.ok && typeof cs.result.types[0].weightLbTotal === "number" && cs.result.types[0].weightLbTotal > 0,
    `handoff review A4: cut sheets — a lin-yd fabric WITH boltWidthIn yields a weight (got ${cs.ok ? cs.result.types[0].weightLbTotal : "error"})`);
  {
    const fab = await store.get<Record<string, unknown>>("catalog", "FAB-CH25");
    const { boltWidthIn: _bw, ...noBolt } = fab!;
    void _bw;
    await store.put("catalog", noBolt as { id: string });
    const csNoBolt = await loadCutSheetsLocal(store, "Q-3004");
    ok(csNoBolt.ok && csNoBolt.result.types[0].weightLbTotal === null, "handoff review A4: cut sheets — the same fabric WITHOUT boltWidthIn has no weight (so the slice must carry it)");
    await store.put("catalog", fab as { id: string });
  }
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
  {
    const after = await store.get<{ updatedAt?: number; narrativeUpdatedAt?: number }>("catalog", "ETC:CS15");
    ok(typeof after?.updatedAt === "number" && after.updatedAt === after.narrativeUpdatedAt, `handoff review B12: saveProductParagraphAction bumps the part's updatedAt (writePart) — got ${JSON.stringify(after)}`);
  }
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
  await store.put("quotes", { ...(sanitizeQuote({ ...q1, packagePeakHeader: true } as never) as object), id: q1.id } as { id: string }); // round-trips the slice rules
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
    && msgs[0] === `re-check h/a.ts against src/b.ts, then update ${PORT_SOURCES_FILE} with \`--drift --update h/a.ts\`` && msgs.length === 3,
    "handoff drift: a changed original names its port and the re-check; a gone original and a missing port are listed too");
  const upd = updatedPortSources(man, hashOf);
  ok(upd.ports[0].originals[1].sha256 === sha256Of("two, edited") && upd.ports[1].originals[0].sha256 === sha256Of("three") && driftOf(upd, hashOf, () => true).changed.length === 0,
    "handoff drift: --update stamps current hashes (a gone original keeps its old one)");
  // Task 10 — `--drift --update <port> …` re-stamps the named entries only.
  files["src/c.ts"] = "three, edited";
  const one = updatedPortSources(man, hashOf, ["h/a.ts"]);
  ok(one.ports[0].originals[1].sha256 === sha256Of("two, edited") && one.ports[1] === man.ports[1] && one.ports[1].originals[0].sha256 === sha256Of("three"),
    "handoff drift: --update <port> re-stamps that entry only (every other entry left exactly as it was)");
  ok(updatedPortSources(man, hashOf, []).ports.every((p, i) => p === man.ports[i]) && unknownPorts(man, ["h/a.ts", "h/typo.ts"]).join() === "h/typo.ts" && unknownPorts(man, ["h/gone.ts"]).length === 0,
    "handoff drift: an empty name list stamps nothing; unknownPorts names a port the manifest lacks (verify refuses to write then)");
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
  // final review A8: completeness — a runtime module that says it ports a src/ module must have an entry
  ok(claimsPort("/**\n * Estimator handoff — browser implementations of src/app/(app)/x/actions.ts.\n */\nexport {};") &&
    claimsPort("/** the browser port of src/lib/a.ts */") && claimsPort('/** helpers */\nimport type * as Original from "@/app/(app)/x/actions";') &&
    !claimsPort("/** the shell's routes (pure) */\nexport {};") && !claimsPort("/** mentions src/lib/a.ts only as a reference */"),
    "handoff drift A8: claimsPort — a header naming a src/ file with port / implementations of, or an `import type * as Original`, claims a port; a plain mention does not");
  {
    const fake = { ports: [{ port: "r/listed.ts", what: "", originals: [{ path: "src/a.ts", sha256: "x" }] }] };
    const bodies: Record<string, string> = { "r/listed.ts": "/** port of src/a.ts */", "r/new.ts": "/** the browser port of src/b.ts */", "r/pure.ts": "/** pure */", "r/notes.md": "/** port of src/c.ts */" };
    ok(unlistedPorts(fake, Object.keys(bodies), (f) => bodies[f]).join() === "r/new.ts", "handoff drift A8: unlistedPorts names a claimed port with no manifest entry (only .ts/.tsx modules)");
    const walk = (d: string): string[] => fs.readdirSync(d).sort().flatMap((n) => (fs.statSync(nodePath.join(d, n)).isDirectory() ? walk(`${d}/${n}`) : [`${d}/${n}`]));
    const unlisted = unlistedPorts(real, walk(PORT_SCAN_DIR), (f) => fs.readFileSync(f, "utf8"));
    ok(unlisted.length === 0, `handoff drift A8: every runtime module that claims a port is in ${PORT_SOURCES_FILE} (unlisted: ${unlisted.join(", ") || "none"})`);
    for (const f of ["estimator-actions", "place-system", "client-package-actions", "output-actions", "pdf-actions", "quotes-actions"])
      ok(real.ports.some((p) => p.port === `handoff/estimator/runtime/actions/${f}.ts`), `handoff drift A8: ${f}.ts has a manifest entry`);
  }

  // --- the component overrides export every value name their originals do (a BAKED data override: see handoffRulesChecks) ---
  for (const [orig, repl] of Object.entries(APP_OVERRIDES)) {
    if (BAKED_MODULES.includes(repl)) continue;
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
/* ------------------------------------------------------------------ the merge of #362–#365: Box goods sale, Show on BOM, model numbers */

export async function handoffBoxSaleChecks(ok: Ok) {
  const T = "handoff box sale";
  // --- quote-model: the flag is stored only as true on a system estimate (buildQuote / applyUpdate / revisionDocFields) ---
  const pl = null;
  const on = buildQuote("Q-1", { name: "Box", source: "estimator", boxSale: true }, "system", pl, 5);
  ok(on.boxSale === true, `${T}: buildQuote — boxSale true on a system estimate is stored`);
  ok(!("boxSale" in buildQuote("Q-2", { name: "Box", source: "estimator", boxSale: false }, "system", pl, 5)) && !("boxSale" in buildQuote("Q-3", { name: "x", source: "estimator" }, "system", pl, 5)),
    `${T}: buildQuote — false / absent leaves a normal estimate's doc (no key)`);
  ok(!("boxSale" in buildQuote("Q-4", { name: "x", source: "estimator", boxSale: true }, "flame_test", pl, 5)) && !("boxSale" in buildQuote("Q-5", { name: "x", source: "portal-catalog", boxSale: true }, "system", pl, 5)),
    `${T}: buildQuote — a service quote and a portal-catalog quote never carry the flag`);
  const off = applyUpdate({ ...on }, { boxSale: false } as Partial<Quote>, 9);
  const keep = applyUpdate({ ...on }, { name: "Renamed" } as Partial<Quote>, 9);
  const setOn = applyUpdate({ ...buildQuote("Q-6", { name: "n", source: "estimator" }, "system", pl, 5) }, { boxSale: true } as Partial<Quote>, 9);
  const portalOn = applyUpdate({ ...buildQuote("Q-7", { name: "n", source: "portal-catalog" }, "system", pl, 5) }, { boxSale: true } as Partial<Quote>, 9);
  ok(!("boxSale" in off) && keep.boxSale === true && setOn.boxSale === true && !("boxSale" in portalOn),
    `${T}: applyUpdate — false removes the key, a patch without it leaves it, true sets it, a portal quote can't take it`);
  ok(revisionDocFields(on).boxSale === true && !("boxSale" in revisionDocFields(off)), `${T}: revisionDocFields — the sent revision freezes the flag only when it is on`);

  // --- planSave: the labor refusal, an older caller, the patch ---
  const rewrite = <T,>(x: T) => x;
  const tier = { tier: "base", markup: 0.43 };
  const plain = [sec("sysA", [{ qty: 2, cost: 50, price: 100 }])];
  const withLabor = [sec("sysA", [{ qty: 2, cost: 50, price: 100 }]), sec("sysB", [{ sku: "LAB", qty: 4, cost: 20, price: 40, labor: true }], { name: "Install" })];
  const okPlan = planSave(null, payloadFor(plain, { boxSale: true }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(okPlan.ok && okPlan.patch.boxSale === true, `${T}: planSave — a labor-free box sale saves with boxSale true`);
  const laborPlan = planSave(null, payloadFor(withLabor, { boxSale: true }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(!laborPlan.ok && laborPlan.refusedBeforeWrite === "boxsale" && laborPlan.error === BOX_SALE_LABOR_MESSAGE,
    `${T}: planSave — any labor line refuses the whole save with the app's message`);
  const overheadPlan = planSave(null, payloadFor([sec("o", [{ qty: 1, cost: 5, price: 9, laborOverhead: "mobilization" } as never])], { boxSale: true }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(!overheadPlan.ok && overheadPlan.refusedBeforeWrite === "boxsale", `${T}: planSave — a mobilization / travel (laborOverhead) line counts as labor`);
  const normalWithLabor = planSave(null, payloadFor(withLabor), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(normalWithLabor.ok && normalWithLabor.patch.boxSale === false, `${T}: planSave — a normal estimate keeps its labor (boxSale false)`);
  const stored = { ...on, id: "Q-1" } as Quote;
  const oldCaller = planSave(stored, payloadFor(plain, { boxSale: undefined }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(oldCaller.ok && oldCaller.patch.boxSale === true, `${T}: planSave — an older caller (no flag) keeps the stored one`);
  const offPlan = planSave(stored, payloadFor(withLabor, { boxSale: false }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(offPlan.ok && offPlan.patch.boxSale === false, `${T}: planSave — turning the switch off lets the labor save again`);
  const svc = planSave({ ...stored, quoteType: "flame_test" } as Quote, payloadFor(plain, { boxSale: true }), { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite });
  ok(svc.ok && svc.patch.boxSale === false, `${T}: planSave — a non-system quote never becomes a box sale`);

  // --- the store-backed actions ---
  const cust: SeedCustomers = {
    companies: [{ id: "c1", name: "Acme Theatre" }],
    sites: [{ id: "s1", companyId: "c1", name: "Main Hall", city: "Madison", isPrimary: true }],
    contacts: [{ id: "k1", firstName: "Pat", lastName: "Lee", homeCompanyId: "c1", title: "TD", isPrimary: true }],
    contactEmails: [{ id: "e1", contactId: "k1", email: "pat@acme.test", isPrimary: true }], contactPhones: [], geoCache: [],
  };
  const team: SeedTeamUser[] = [{ id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" }];
  const lines = [
    { id: 1, sku: "ETC:CS15", desc: "ColorSource 15 fixture", qty: 4, unit: "ea", cost: 900, price: 1250 },
    { id: 2, sku: "ETC:CS15", desc: "CS15 spot", qty: 1, unit: "ea", cost: 900, price: 1250, manufacturerModelNumber: "FROZEN-1" },
    { id: 3, sku: "CUSTOM", desc: "Custom bracket", qty: 1, unit: "ea", cost: 10, price: 30 },
    { id: 4, sku: "NOT-IN-CATALOG", desc: "Mystery part", qty: 1, unit: "ea", cost: 10, price: 30 },
  ];
  const boxSecs = [{ id: "s1", name: "Stage lighting", kind: "lighting", freightPct: 0, items: lines }];
  const base = { quoteType: "system", source: "estimator", customerId: "c1", customer: "Acme Theatre", contactName: "Pat Lee", owner: "Ann Admin", createdAt: 1, history: [], revisions: [] };
  const qBox = { ...base, id: "Q-5001", estNo: 5001, name: "Box order", status: "draft", updatedAt: 1_790_000_000_000, boxSale: true, spec: { sections: boxSecs, mobs: [] } };
  const qPlain = { ...base, id: "Q-5002", estNo: 5002, name: "Normal", status: "draft", updatedAt: 1_790_000_000_000, spec: { sections: boxSecs, mobs: [] } };
  const laborSec = { id: "sL", name: "Install", kind: "labor", freightPct: 0, items: [{ id: 1, sku: "LAB", desc: "Install", qty: 4, unit: "ea", cost: 20, price: 40, labor: true }] };
  const qBoxLabor = { ...base, id: "Q-5003", estNo: 5003, name: "Box with labor", status: "draft", updatedAt: 1_790_000_000_000, boxSale: true, spec: { sections: [...boxSecs, laborSec], mobs: [] } };
  const catalog = docs([
    { id: "ETC:CS15", sku: "ETC:CS15", desc: "ColorSource 15 fixture", category: "Lighting", unit: "ea", cost: 900, list: 1250, mfr: "ETC", manufacturerPartNumber: "7410A1015", manufacturerModelNumber: "CS15" },
  ]);
  const store = await openStore({ quotes: docs([qBox, qPlain, qBoxLabor]), catalog, fixtures: [], blobs: [], settings: [{ id: "main", data: { companyName: "Peak Systems Group" } } as { id: string }] }, { idb: null });
  configurePorts({ store, customers: cust, rules: { settings: { companyName: "Peak Systems Group" }, blobs: {} }, team });
  users.setCurrent("u1");
  const repo = quoteRepo(store);
  const A = estimatorActions(store);

  // props: the stored flag, false for a new estimate unless ?box=1
  const pBox = await buildEstimatorProps(store, "Q-5001", new URLSearchParams());
  const pPlain = await buildEstimatorProps(store, "Q-5002", new URLSearchParams());
  const pNew = await buildEstimatorProps(store, null, new URLSearchParams("new=1"));
  const pNewBox = await buildEstimatorProps(store, null, new URLSearchParams("new=1&box=1"));
  const pOpenIgnoresBox = await buildEstimatorProps(store, "Q-5002", new URLSearchParams("box=1"));
  ok(pBox.initial.boxSale === true && pPlain.initial.boxSale === false && pNew.initial.boxSale === false && pNewBox.initial.boxSale === true && pOpenIgnoresBox.initial.boxSale === false,
    `${T}: props — initial.boxSale is the stored flag; a new estimate is false unless ?box=1; ?box=1 never flips a saved one`);

  // save: refused with labor (nothing written, no id), accepted without
  const before = (await store.all("quotes")).length;
  const refusedSave = await A.saveQuoteAction("Q-5002", payloadFor([...(boxSecs as never as SpecSection[]), laborSec as never as SpecSection], { boxSale: true, name: "Normal" }));
  ok(!refusedSave.ok && refusedSave.id === null && refusedSave.number === null && refusedSave.error === BOX_SALE_LABOR_MESSAGE && (await repo.get("Q-5002"))!.boxSale !== true && (await store.all("quotes")).length === before,
    `${T}: saveQuoteAction — a box sale with labor is refused with no id and nothing written`);
  const created = await A.saveQuoteAction(null, payloadFor([sec("n1", [{ qty: 1, cost: 10, price: 30 }])], { boxSale: true, name: "Fresh box" }));
  const createdQ = created.id ? await repo.get(created.id) : null;
  ok(created.ok && createdQ?.boxSale === true, `${T}: saveQuoteAction — a new box sale is created with the flag stored`);
  const toggledOff = await A.saveQuoteAction(created.id, payloadFor([sec("n1", [{ qty: 1, cost: 10, price: 30 }])], { boxSale: false, name: "Fresh box" }));
  ok(toggledOff.ok && !("boxSale" in ((await repo.get(created.id!)) ?? {})), `${T}: saveQuoteAction — switching it off removes the key (a normal estimate's doc)`);
  const stillOld = await A.saveQuoteAction("Q-5001", payloadFor(boxSecs as never, { boxSale: undefined, name: "Box order" }));
  ok(stillOld.ok && (await repo.get("Q-5001"))!.boxSale === true, `${T}: saveQuoteAction — an older caller (no flag) keeps the stored one`);

  // a sent revision freezes the flag (the approver is the owner)
  const sentBox = await repo.setStatus("Q-5001", "sent", "Ann Admin");
  ok(sentBox?.revisions?.at(-1)?.docFields?.boxSale === true, `${T}: a sent revision's docFields freezes boxSale`);
  const sentPlain = await repo.setStatus("Q-5002", "sent", "Ann Admin");
  ok(!!sentPlain?.revisions?.at(-1) && !("boxSale" in (sentPlain.revisions!.at(-1)!.docFields ?? {})), `${T}: …and a normal estimate's revision carries no key`);

  // Move / Copy: a labor system into an existing box sale is refused; a new estimate copies the stored source's flag
  const ctx = { customerId: "c1", locationId: null, customer: "Acme Theatre", contactName: "Pat Lee", tierMargin: 0.3 };
  const laborSection = { ...laborSec, id: "sysLab" } as never;
  const intoBox = await A.moveSystemToEstimateAction(laborSection, { kind: "existing", quoteId: "Q-5001" }, ctx, [], "Q-5002");
  ok(!intoBox.ok && (intoBox as { error: string }).error === BOX_SALE_LABOR_MESSAGE && !JSON.stringify((await repo.get("Q-5001"))!.spec).includes("sysLab"), `${T}: Move into an existing box sale — a system with labor is refused before anything is written`);
  const copyIntoBox = await A.copySystemToEstimateAction({ ...laborSec, id: "sysLab2" } as never, { kind: "existing", quoteId: "Q-5001" }, ctx, [], "Q-5002");
  ok(!copyIntoBox.ok, `${T}: Copy into an existing box sale — refused the same way`);
  const okInto = await A.moveSystemToEstimateAction({ id: "sysOk", name: "Gear", kind: "lighting", freightPct: 0, items: [{ id: 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 5, price: 9 }] } as never, { kind: "existing", quoteId: "Q-5001" }, ctx, [], null);
  ok(okInto.ok, `${T}: Move a labor-free system into a box sale is fine`);
  const moveNewBox = await A.moveSystemToEstimateAction({ id: "sysM", name: "Rig", kind: "lighting", freightPct: 0, items: [{ id: 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 5, price: 9 }] } as never, { kind: "new" }, ctx, [], "Q-5001");
  const moveNewPlain = await A.moveSystemToEstimateAction({ id: "sysN", name: "Rig2", kind: "lighting", freightPct: 0, items: [{ id: 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 5, price: 9 }] } as never, { kind: "new" }, ctx, [], "Q-5002");
  const moveNewUnsaved = await A.moveSystemToEstimateAction({ id: "sysU", name: "Rig3", kind: "lighting", freightPct: 0, items: [{ id: 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 5, price: 9 }] } as never, { kind: "new" }, ctx, [], null);
  ok(moveNewBox.ok && (await repo.get(moveNewBox.targetId))!.boxSale === true && moveNewPlain.ok && (await repo.get(moveNewPlain.targetId))!.boxSale !== true && moveNewUnsaved.ok && (await repo.get(moveNewUnsaved.targetId))!.boxSale !== true,
    `${T}: Move → New estimate copies the STORED source's flag (a normal or unsaved source gives a normal estimate)`);
  const copyNewBox = await A.copySystemToEstimateAction({ id: "sysC", name: "Rig4", kind: "lighting", freightPct: 0, items: [{ id: 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 5, price: 9 }] } as never, { kind: "new" }, ctx, [], "Q-5001");
  ok(copyNewBox.ok && copyNewBox.kind === "new" && (await repo.get(copyNewBox.targetId))!.boxSale === true, `${T}: Copy → New estimate copies the stored source's flag too`);

  // send: labor still on a box sale (a restored revision) is never sent; the estimate PDF always rides, a cover never does
  const pre = preflightSend({ roles: ["Admin"] }, (await repo.get("Q-5003"))!, { to: "pat@acme.test", cc: "", subject: "s", body: "b", attachEstimate: false, attachCover: false, followUpDays: 0 });
  ok("ok" in pre && pre.ok === false && pre.error === BOX_SALE_LABOR_MESSAGE, `${T}: preflightSend — a box sale that still carries labor is refused`);
  const SA = sendActions(store);
  const sendIn = { to: "pat@acme.test", cc: "", subject: "Box order — quote EST-5001", body: "See {link}", attachEstimate: false, attachCover: true, followUpDays: 0 };
  const boxSend = await SA.sendEstimateEmailAction("Q-5001", sendIn);
  const boxRow = (await store.all<{ quoteId: string; attachments?: string[] }>("activity")).find((a) => a.quoteId === "Q-5001");
  ok(boxSend.ok && boxRow?.attachments?.join() === "EST-5001.pdf", `${T}: send — a box sale's email always carries the estimate PDF and never a cover (got ${boxRow?.attachments?.join()})`);
  const plainSend = await SA.sendEstimateEmailAction("Q-5002", { ...sendIn, subject: "Normal — estimate EST-5002" });
  const plainRow = (await store.all<{ quoteId: string; attachments?: string[] }>("activity")).find((a) => a.quoteId === "Q-5002");
  ok(plainSend.ok && plainRow?.attachments?.join() === "EST-5002 Cover.pdf", `${T}: send — a normal estimate follows the composer's ticks (got ${plainRow?.attachments?.join()})`);
  const defs = await SA.estimateEmailDefaultsAction("Q-5001");
  const defsPlain = await SA.estimateEmailDefaultsAction("Q-5002");
  ok(defs.ok && /quote EST-5001/.test(defs.subject) && defsPlain.ok && /estimate EST-5002/.test(defsPlain.subject), `${T}: defaults — the subject says "quote" for a box sale and "estimate" otherwise (${defs.ok ? defs.subject : ""})`);

  // package panel: no gap chips on a box sale
  const panelBox = packagePanelFor((await repo.get("Q-5001"))!, {});
  const panelPlain = packagePanelFor({ ...(await repo.get("Q-5002"))!, spec: { sections: [{ ...boxSecs[0], narrative: "" , presentation: "narrative", keyProducts: [{ lineId: 1, sku: "ETC:CS15" }] }], mobs: [] } } as never, {});
  ok(panelBox.gaps.length === 0 && panelPlain.gaps.length > 0, `${T}: package panel — a box sale has no gap chips (a normal estimate with a missing goal / paragraph has ${panelPlain.gaps.length})`);

  // loaders: the document is the BOM view in the web layout with models; the package page is the itemized list; no cut-sheet appendix
  const docBox = await loadQuoteDocumentPropsLocal(store, "Q-5001");
  const docPlain = await loadQuoteDocumentPropsLocal(store, "Q-5002");
  ok(!!docBox && docBox.layout === "web" && docBox.showModels === true && docBox.detail === "itemized" && docBox.pdfItemizedAppendix === false && !!docPlain && docPlain.layout !== "web" && docPlain.showModels !== true,
    `${T}: loader — a box sale's document is the BOM view in the web layout; a normal one is untouched`);
  const mp = docBox?.bomModelParts ?? {};
  ok(mp["ETC:CS15"]?.manufacturerModelNumber === "CS15" && mp["ETC:CS15"].manufacturerPartNumber === "7410A1015" && !("CUSTOM" in mp) && !("NOT-IN-CATALOG" in mp),
    `${T}: BOM models — the catalog's model fields for plain catalog SKUs only (no CUSTOM, no unknown part): ${Object.keys(mp).join()}`);
  const direct = bomModelPartsLocal(boxSecs as never, (sku) => (sku === "ETC:CS15" ? (catalog[0] as never) : undefined));
  ok(Object.keys(direct ?? {}).join() === "ETC:CS15" && JSON.stringify(direct!["ETC:CS15"]) === JSON.stringify({ sku: "ETC:CS15", manufacturerModelNumber: "CS15", manufacturerPartNumber: "7410A1015" }), `${T}: bomModelPartsLocal — only the model fields cross (sku, model, MFR P/N)`);
  const pkgBox = await loadPackagePreviewLocal(store, "Q-5001", "narrative", "/letterhead.jpg");
  const pkgPlain = await loadPackagePreviewLocal(store, "Q-5002", "narrative", "/letterhead.jpg");
  ok(pkgBox?.model.boxSale === true && pkgBox.model.view === "bom" && pkgBox.model.summary === "" && pkgBox.model.document === undefined && pkgPlain?.model.boxSale !== true && pkgPlain?.model.view === "narrative",
    `${T}: loader — a box sale's package page is the itemized list (BOM view, no summary / document); a normal one is the narrative`);
  const csOn = await loadCutSheetsLocal(store, "Q-5001");
  ok(cutSheetAppendixModels(csOn).length === 0, `${T}: cut-sheet appendix — never on a box sale's PDF`);

  // the review / walk lists
  ok(reviewTabsFor(true).join() === "document,bom" && reviewTabsFor(false).length === 6, `${T}: Customer review offers Document + BOM only on a box sale`);
  ok(stepViewsFor(true).every((v) => !/ptab=(narrative|client)/.test(v.query)) && stepViewsFor(true).find((v) => v.query === "step=review")?.tabs?.join() === "Document,BOM" && stepViewsFor(false).length === 6,
    `${T}: verify --all-steps — a box sale is walked through its own tabs, a normal estimate through all of them`);

  // the live BOM tab's model read (bomModelPartsAction)
  const live = await A.bomModelPartsAction(["ETC:CS15", " ETC:CS15 ", "NOPE", "__proto__", ""]);
  ok(Object.keys(live).join() === "ETC:CS15" && live["ETC:CS15"].manufacturerModelNumber === "CS15", `${T}: bomModelPartsAction — the live BOM tab reads the same facts (unknown / blank / __proto__ absent)`);
}

/* ------------------------------------------------------------------ the merge of #366: project discounts */

export async function handoffDiscountChecks(ok: Ok) {
  const T = "handoff discounts";
  const rewrite = <T,>(x: T) => x;
  const tier = { tier: "base", markup: 0.43 };
  const mk = () => [sec("sysA", [
    { sku: "ETC:CS15", desc: "CS15 fixture", qty: 4, cost: 900, price: 1250 },
    { sku: "CUSTOM", desc: "Hand cost", qty: 1, cost: 700, price: 1000, custom: true },
  ])];
  const deps = { bonusRates: DEFAULT_BONUS_RATES, tier, rewriteSpec: rewrite, userId: "u1", now: 1234 };
  const none = planSave(null, payloadFor(mk()), deps);
  const disc = planSave(null, payloadFor(mk(), { projectDiscounts: { "ETC:CS15": { pct: 10, note: "ETC reg pricing", by: "FORGED", at: 1 }, CUSTOM: { pct: 50, note: "" }, "": { pct: 5 } } }), deps);
  const lines = disc.ok ? (disc.patch.spec!.sections[0].items as Array<Record<string, unknown>>) : [];
  const l0 = lines.find((i) => i.sku === "ETC:CS15");
  const lc = lines.find((i) => i.sku === "CUSTOM");
  ok(none.ok && disc.ok && l0?.cost === 810 && l0.catalogCost === 900 && l0.projectDiscountPct === 10 && lc?.cost === 700 && !("catalogCost" in (lc ?? {})),
    `${T}: planSave — the map is applied server-side (cost 900 → 810, catalogCost kept); a custom line is never discounted`);
  const map = disc.ok ? (disc.patch.spec as { projectDiscounts?: Record<string, { by: string; at: number; pct: number; note: string }> }).projectDiscounts : undefined;
  ok(!!map && Object.keys(map).join() === "ETC:CS15" && map["ETC:CS15"].by === "u1" && map["ETC:CS15"].at === 1234 && map["ETC:CS15"].note === "ETC reg pricing",
    `${T}: planSave — sanitized (bad entries dropped) and re-stamped by the saver; a posted by / at is never trusted`);
  ok(none.ok && !("projectDiscounts" in none.patch.spec!) && disc.ok && none.patch.value === disc.patch.value,
    `${T}: planSave — no map stores no key; the customer's total is identical with and without the discount (${none.ok ? none.patch.value : ""})`);
  const costOf = (p: typeof disc) => (p.ok ? p.patch.spec!.sections.flatMap((s) => s.items).filter((i) => !isBonusItem(i)).reduce((a, i) => a + i.qty * i.cost, 0) : 0);
  const marginOf = (p: typeof disc) => (p.ok ? totals(p.patch.spec!.sections, 0).markup : 0);
  ok(costOf(disc) === costOf(none) - 4 * 90 && marginOf(disc) > marginOf(none), `${T}: planSave — cost drops by exactly the discounted dollars and the margin rises (${marginOf(none).toFixed(4)} → ${marginOf(disc).toFixed(4)})`);
  const prior = { quoteType: "system", status: "draft", source: "estimator", spec: { sections: [], mobs: [], projectDiscounts: map } } as unknown as Quote;
  const keep = planSave(prior, payloadFor(mk()), { ...deps, userId: "u9", now: 9999 });
  const kmap = keep.ok ? (keep.patch.spec as { projectDiscounts?: Record<string, { by: string; at: number }> }).projectDiscounts : undefined;
  ok(keep.ok && kmap?.["ETC:CS15"]?.by === "u1" && kmap["ETC:CS15"].at === 1234 && (keep.patch.spec!.sections[0].items as Array<Record<string, unknown>>)[0].cost === 810,
    `${T}: planSave — an older caller (no map) keeps the stored one, with its original by / at, and re-applies it`);
  const cleared = planSave(prior, payloadFor(mk(), { projectDiscounts: {} }), deps);
  ok(cleared.ok && !("projectDiscounts" in cleared.patch.spec!) && (cleared.patch.spec!.sections[0].items as Array<Record<string, unknown>>)[0].cost === 900 && !("catalogCost" in (cleared.patch.spec!.sections[0].items[0] as object)),
    `${T}: planSave — an empty map removes the discount (normal cost back, no catalogCost)`);

  // --- store-backed: props read it back, a sent revision freezes the stamped lines, Move / Copy carry it, the document never shows it ---
  const cust: SeedCustomers = { companies: [{ id: "c1", name: "Acme Theatre" }], sites: [], contacts: [], contactEmails: [], contactPhones: [], geoCache: [] };
  const team: SeedTeamUser[] = [{ id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" }];
  const catalog = docs([{ id: "ETC:CS15", sku: "ETC:CS15", desc: "ColorSource 15 fixture", category: "Lighting", unit: "ea", cost: 900, list: 1250, mfr: "ETC", manufacturerModelNumber: "CS15" }]);
  const store = await openStore({ quotes: [], catalog, fixtures: [], blobs: [], settings: [{ id: "main", data: { companyName: "Peak Systems Group" } } as { id: string }] }, { idb: null });
  configurePorts({ store, customers: cust, rules: { settings: { companyName: "Peak Systems Group" }, blobs: {} }, team });
  users.setCurrent("u1");
  const repo = quoteRepo(store);
  const A = estimatorActions(store);
  const saved = await A.saveQuoteAction(null, payloadFor(mk(), { name: "Discounted", customerId: "c1", customer: "Acme Theatre", projectDiscounts: { "ETC:CS15": { pct: 10, note: "ETC reg pricing" } } as never }));
  const id = saved.id!;
  const q1 = (await repo.get(id))!;
  const props = await buildEstimatorProps(store, id, new URLSearchParams());
  const newProps = await buildEstimatorProps(store, null, new URLSearchParams("new=1"));
  ok(saved.ok && (q1.spec as { projectDiscounts?: object }).projectDiscounts !== undefined && props.initial.projectDiscounts?.["ETC:CS15"]?.pct === 10 && props.initial.projectDiscounts["ETC:CS15"].by === "u1" && !newProps.initial.projectDiscounts,
    `${T}: saveQuoteAction + props — stored in spec.projectDiscounts, passed to the Estimator re-validated; a new estimate has none`);
  const sent = await repo.setStatus(id, "sent", "Ann Admin");
  const frozen = (sent?.revisions?.at(-1)?.spec as { sections: SpecSection[]; projectDiscounts?: object } | null);
  ok(frozen?.sections[0].items.find((i) => i.sku === "ETC:CS15")?.catalogCost === 900 && !!frozen.projectDiscounts, `${T}: a sent revision freezes the stamped lines and the map`);
  // The customer document renders from customerLines (QuoteDocument itself imports a .jpg, so it can't load in Node): the rows are
  // the same with and without the discount, and carry neither the stamp nor a cost.
  const doc = await loadQuoteDocumentPropsLocal(store, id);
  // (a row's `item` is the whole stored line, as for `cost`; the document prints desc, qty, unit and ext only.)
  const shown = (sec: SpecSection) => JSON.stringify(customerLines(sec).map((r) => ({ desc: r.item?.desc, qty: r.item?.qty, unit: r.item?.unit, ext: r.ext })));
  const rowsDisc = shown(doc!.sections[0]);
  const rowsNone = shown(none.ok ? none.patch.spec!.sections[0] : doc!.sections[0]);
  ok(!!doc && rowsDisc === rowsNone && !/catalogCost|projectDiscount|\b810\b|\b900\b/.test(rowsDisc) && doc.sections[0].items.some((i) => i.catalogCost === 900),
    `${T}: the customer rows (desc / qty / unit / ext — all the document prints) are identical with and without the discount`);
  const ctx = { customerId: "c1", locationId: null, customer: "Acme Theatre", contactName: "", tierMargin: 0.3 };
  const sys = (n: string) => ({ id: n, name: n, kind: "lighting", mfr: "", freightPct: 0, items: [{ id: 1, sku: "ETC:CS15", desc: "CS15", qty: 2, unit: "ea", cost: 900, price: 1250 }] }) as never;
  const mvNew = await A.moveSystemToEstimateAction(sys("m1"), { kind: "new" }, ctx, [], id, undefined);
  const mvNewPosted = await A.moveSystemToEstimateAction(sys("m2"), { kind: "new" }, ctx, [], id, { "ETC:CS15": { pct: 20, note: "better" } });
  const cpNew = await A.copySystemToEstimateAction(sys("c1x"), { kind: "new" }, ctx, [], id, undefined);
  const cost = async (qid: string) => ((await repo.get(qid))!.spec as { sections: SpecSection[] }).sections[0].items[0].cost;
  ok(mvNew.ok && (await cost(mvNew.targetId)) === 810 && !!((await repo.get(mvNew.targetId))!.spec as { projectDiscounts?: object }).projectDiscounts,
    `${T}: Move → New estimate carries the stored source's entry for the system's SKUs (cost 810)`);
  ok(mvNewPosted.ok && (await cost(mvNewPosted.targetId)) === 720 && ((await repo.get(mvNewPosted.targetId))!.spec as { projectDiscounts: Record<string, { by: string }> }).projectDiscounts["ETC:CS15"].by === "u1",
    `${T}: Move → New with the builder's posted map re-stamps it like a save (cost 720)`);
  ok(cpNew.ok && cpNew.kind === "new" && (await cost(cpNew.targetId)) === 810, `${T}: Copy → New estimate carries it too`);
  const plain = await A.saveQuoteAction(null, payloadFor(mk(), { name: "Plain" }));
  const mvExisting = await A.moveSystemToEstimateAction(sys("m3"), { kind: "existing", quoteId: plain.id! }, ctx, [], id, { "ETC:CS15": { pct: 30, note: "ignored" } });
  const existingItems = ((await repo.get(plain.id!))!.spec as { sections: SpecSection[]; projectDiscounts?: object });
  ok(mvExisting.ok && existingItems.sections.flatMap((s) => s.items).filter((i) => i.sku === "ETC:CS15").every((i) => i.cost === 900 && !("catalogCost" in i)) && !existingItems.projectDiscounts,
    `${T}: Move into an existing estimate — the target's own map decides (it has none: normal cost, no key)`);
  const mvDiscTarget = await A.moveSystemToEstimateAction(sys("m4"), { kind: "existing", quoteId: id }, ctx, [], null);
  const tgt = (await repo.get(id))!.spec as { sections: SpecSection[]; projectDiscounts?: object };
  ok(mvDiscTarget.ok && tgt.sections.flatMap((s) => s.items).filter((i) => i.sku === "ETC:CS15").every((i) => i.cost === 810) && !!tgt.projectDiscounts,
    `${T}: Move into a discounted estimate — it applies and keeps its own map (spec rebuild carries projectDiscounts)`);
}

/* ------------------------------------------------------------------ the merge of #367: margin → markup */

export async function handoffMarkupChecks(ok: Ok) {
  const T = "handoff markup";
  const { hydrateDoc, convertQuoteDoc } = await import("@/lib/markup/doc-basis");
  const { marginToMarkup } = await import("@/lib/markup");
  const { MARGIN_KEYS, rateBlobOnMarkupBasis } = await import("../handoff/estimator/markup-basis");
  const Pricing = await import("@/lib/stores/pricing");

  // MARGIN_KEYS is the one copied list (stores/pricing.ts keeps it private and reaches the database): pin it to the original's source
  {
    const src = fs.readFileSync("src/lib/stores/pricing.ts", "utf8");
    const body = /const MARGIN_KEYS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src)?.[1] ?? "";
    const names: Record<string, string> = { PRICING_RULES_BLOB: "pricing_rules", FLAMETEST_RATES_BLOB: Pricing.FLAMETEST_RATES_BLOB, REPAIR_RATES_BLOB: Pricing.REPAIR_RATES_BLOB, INSPECTION_RATES_BLOB: Pricing.INSPECTION_RATES_BLOB, CATALOG_RATES_BLOB: Pricing.CATALOG_RATES_BLOB };
    const parsed = [...body.matchAll(/\[(\w+),\s*\[([^\]]*)\],\s*(true|false)\]/g)].map((m) => [names[m[1]], [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]), m[3] === "true"] as const);
    ok(parsed.length === 5 && JSON.stringify(parsed) === JSON.stringify(MARGIN_KEYS), `${T}: MARGIN_KEYS equals stores/pricing.ts's own list (${parsed.length} blobs)`);
  }

  // --- a margin-era quote: converts on read exactly as the app's hydrateDoc, no sell moves ---
  const sections = [{ id: "s1", name: "Gear", kind: "lighting", mfr: "", freightPct: 5, priceRound: 25, items: [
    { id: 1, sku: "ETC:CS15", desc: "CS15", qty: 4, unit: "ea", cost: 900, price: 1285.71 },
    { id: 2, sku: "X", desc: "Console", qty: 1, unit: "ea", cost: 2000, price: 2857.14 },
  ], laborGroups: { g1: { draft: { margin: "30" } } } }];
  const era = {
    id: "Q-7001", estNo: 7001, name: "Margin era", status: "draft", quoteType: "system", source: "estimator", customerId: "c1", customer: "Acme",
    owner: "Ann Admin", createdAt: 1, updatedAt: 1_700_000_000_000, history: [], value: 8000, margin: 0.3, pricingTier: "base", tierMargin: 0.3,
    revisions: [{ rev: 1, at: 2, by: "x", reason: "sent", note: "", name: "Margin era", value: 7000, margin: 0.25, tierMargin: 0.27, spec: JSON.parse(JSON.stringify({ sections })) }],
    spec: { sections, mobs: [] },
  };
  const stamped = { ...era, id: "Q-7002", estNo: 7002, pricingBasis: "markup", margin: 0.43, tierMargin: 0.43 };
  const store = await openStore({ quotes: docs([era, stamped]), catalog: [], fixtures: [], blobs: [], settings: [{ id: "main", data: { companyName: "Peak Systems Group" } } as { id: string }] }, { idb: null });
  configurePorts({ store, customers: EMPTY_CUSTOMERS, rules: { settings: {}, blobs: {} }, team: [{ id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" }] });
  users.setCurrent("u1");
  const repo = quoteRepo(store);
  const q = (await repo.get("Q-7001"))! as Quote & { pricingBasis?: string };
  const appRead = hydrateDoc("quotes", structuredClone(era) as unknown as Record<string, unknown>) as unknown as Quote;
  ok(q.pricingBasis === "markup" && Math.abs(q.margin - marginToMarkup(0.3)) < 1e-12 && Math.abs((q.tierMargin ?? 0) - 3 / 7) < 1e-12 && q.margin !== 0.3,
    `${T}: a margin-era quote reads as markup (margin 0.30 → ${q.margin.toFixed(6)}, tierMargin → ${q.tierMargin?.toFixed(6)}), stamped`);
  ok(JSON.stringify({ ...q, id: 0 }) === JSON.stringify({ ...appRead, id: 0 }) || JSON.stringify(q.revisions) === JSON.stringify(appRead.revisions) && q.margin === appRead.margin && q.tierMargin === appRead.tierMargin,
    `${T}: …identical to the app's own hydrateDoc over the same row (one converter, imported)`);
  const rev = q.revisions![0] as unknown as { margin: number; tierMargin: number };
  const draft = ((q.spec as { sections: Array<{ laborGroups: { g1: { draft: { margin: string } } } }> }).sections[0].laborGroups.g1.draft.margin);
  ok(Math.abs(rev.margin - 1 / 3) < 1e-12 && Math.abs(rev.tierMargin - marginToMarkup(0.27)) < 1e-12 && Math.abs(parseFloat(draft) - 42.857142857) < 1e-6, `${T}: …its revisions and a labor draft's percent string convert too (0.25 → 0.3333, "30" → "${draft}")`);
  const stamped2 = (await repo.get("Q-7002"))!;
  ok(stamped2.margin === 0.43 && stamped2.tierMargin === 0.43, `${T}: a stamped doc is honoured exactly — never converted twice`);
  // prices to the cent, totals().markup matches the app's
  const spec = q.spec as { sections: SpecSection[] };
  ok(JSON.stringify(spec.sections[0].items.map((i) => [i.price, i.cost])) === JSON.stringify((era.spec.sections[0].items as Array<{ price: number; cost: number }>).map((i) => [i.price, i.cost])) && q.value === 8000,
    `${T}: …line prices, costs and the saved value are untouched to the cent`);
  const tAfter = totals(spec.sections, 0);
  const tApp = totals((appRead.spec as { sections: SpecSection[] }).sections, 0);
  ok(tAfter.markup === tApp.markup && tAfter.grand === tApp.grand && tAfter.markup > 0.4 && tAfter.markup < 0.45, `${T}: totals().markup is the app's (${tAfter.markup.toFixed(4)}) and the grand total is the same`);
  // the list model and props read the same converted doc
  const props = await buildEstimatorProps(store, "Q-7001", new URLSearchParams());
  ok(Math.abs((props.initial.tierMargin ?? 0) - 3 / 7) < 1e-12, `${T}: props — the Estimator opens it with the converted tier markup (${props.initial.tierMargin?.toFixed(4)})`);
  // an overlay save is born stamped and never converts again
  const saved = await estimatorActions(store).saveQuoteAction("Q-7001", payloadFor(spec.sections as SpecSection[], { name: "Margin era", customerId: "c1", customer: "Acme" }));
  const raw = (await store.get<Record<string, unknown>>("quotes", "Q-7001"))!;
  ok(saved.ok && raw.pricingBasis === "markup" && (await repo.get("Q-7001"))!.margin === raw.margin,
    `${T}: a save writes the doc stamped and a re-read does not convert it again`);
  const created = await repo.create({ name: "New", source: "estimator", margin: 0.43, tierMargin: 0.43 });
  ok((created as Quote & { pricingBasis?: string }).pricingBasis === "markup" && (await repo.get(created.id))!.margin === 0.43, `${T}: a new quote is born stamped (buildQuote)`);
  await repo.update(created.id, { pricingBasis: undefined, margin: 0.5 } as never);
  ok(((await store.get<Record<string, unknown>>("quotes", created.id))!).pricingBasis === "markup" && (await repo.get(created.id))!.margin === 0.5, `${T}: a patch can never clear the stamp (update() owns it)`);

  // --- rate blobs: converted once, whole-%, stamped; a stamped blob and a missing one are left alone ---
  const blobs = {
    pricing_rules: { "tiers.base": 30, "tiers.gold": 20, "tiers.employee": 5, "system.baseMargin": 30, "labor.audio.pct": 15 },
    catalog_rates: { defaultMargin: 0.3 },
    repair_rates: { margin: 0.3, partsMargin: 0.27, callout: 150 },
    flametest_rates: { margin: 0.43, _pricingBasis: "markup" },
  };
  const bstore = await openStore({ quotes: [], catalog: [], fixtures: [], blobs: Object.entries(blobs).map(([id, data]) => ({ id, data }) as { id: string }), settings: [] }, { idb: null });
  const pr = ((await bstore.get<{ data: Record<string, unknown> }>("blobs", "pricing_rules"))!).data;
  const cr = ((await bstore.get<{ data: Record<string, unknown> }>("blobs", "catalog_rates"))!).data;
  const rr = ((await bstore.get<{ data: Record<string, unknown> }>("blobs", "repair_rates"))!).data;
  const ft = ((await bstore.get<{ data: Record<string, unknown> }>("blobs", "flametest_rates"))!).data;
  ok(pr["tiers.base"] === 43 && pr["tiers.gold"] === 25 && pr["tiers.employee"] === 5 && pr["system.baseMargin"] === 43 && pr["labor.audio.pct"] === 15 && pr._pricingBasis === "markup" && (pr._marginBackup as Record<string, number>)["tiers.gold"] === 20,
    `${T}: pricing_rules converts once — Base 30 → 43, Gold 20 → 25, Employee 5 → 5, other keys untouched, the old values kept in _marginBackup`);
  ok(cr.defaultMargin === 0.43 && rr.margin === 0.43 && rr.partsMargin === 0.37 && rr.callout === 150 && ft.margin === 0.43, `${T}: the service / catalog fraction blobs convert (0.30 → 0.43, 0.27 → 0.37); a stamped blob is read as stored`);
  ok(rateBlobOnMarkupBasis("pricing_rules", pr) === pr && rateBlobOnMarkupBasis("track_series", { a: 1 }) !== undefined && rateBlobOnMarkupBasis("catalog_rates", undefined) === undefined, `${T}: converting twice is a no-op (the stamp), an unlisted blob is untouched`);
  configurePorts({ rules: { settings: {}, blobs: { pricing_rules: blobs.pricing_rules } } });
  ok(resolveTierFor(null).markup === 0.43, `${T}: the ports read the converted blob too (blobData)`);
  await refreshPortsFromStore(bstore);
  ok(resolveTierFor(null).markup === 0.43 && blobData("pricing_rules")["tiers.gold"] === 25, `${T}: …and after a store refresh (tier markup ${resolveTierFor(null).markup})`);
  const PR = await import("../handoff/estimator/runtime/pricing-rules");
  ok((await PR.value(bstore, "tiers.gold")) === 25 && (await PR.value(bstore, "catalog.defaultMargin")) === 43 && (await PR.value(bstore, "repair.partsMargin")) === 37, `${T}: Estimating Rules shows the converted values (Gold 25, catalog 43, repair parts 37)`);
  await PR.setValue(bstore, "tiers.gold", 31);
  ok((await PR.value(bstore, "tiers.gold")) === 31 && (await PR.value(bstore, "tiers.base")) === 43, `${T}: an edit on a converted blob never converts again (Gold → 31, Base still 43)`);
  const fresh = await openStore({ quotes: [], catalog: [], fixtures: [], blobs: [], settings: [] }, { idb: null });
  await PR.setValue(fresh, "catalog.defaultMargin", 50);
  ok((await PR.value(fresh, "catalog.defaultMargin")) === 50 && (((await fresh.get<{ data: Record<string, unknown> }>("blobs", "catalog_rates"))!).data._pricingBasis === "markup"), `${T}: a blob that was never stored is written stamped (an edit of 50 reads 50, not converted)`);

  // --- the slicer converts at slice time with the same functions ---
  const { sliceExport } = await import("../handoff/estimator/slice");
  const exp = JSON.parse(fs.readFileSync(FIXTURE_V2, "utf8")) as ExportV2;
  const marginExp = JSON.parse(JSON.stringify(exp)) as ExportV2;
  const row = (marginExp.collections!.quotes as Array<{ id: string; doc: Record<string, unknown> }>).find((r) => r.id === "Q-G001")!;
  Object.assign(row.doc, { margin: 0.3, tierMargin: 0.3, value: 6744 });
  delete row.doc.pricingBasis;
  marginExp.blobs = [...(marginExp.blobs ?? []).filter((b) => b.id !== "pricing_rules"), { id: "pricing_rules", data: { "tiers.base": 30, "tiers.gold": 20 } } as never];
  const sl = sliceExport(marginExp);
  const g = sliceGlobals(sl.files);
  const sq = (g.PEAK_ESTIMATES as Array<Record<string, unknown>>).find((x) => x.id === "Q-G001")!;
  const sr = (g.PEAK_RULES as { blobs: Record<string, Record<string, unknown>> }).blobs.pricing_rules;
  ok(sq.pricingBasis === "markup" && !("margin" in sq) && Math.abs((sq.tierMargin as number) - 3 / 7) < 1e-12 && JSON.stringify(sq.spec) === JSON.stringify(row.doc.spec),
    `${T}: the slicer ships a margin-era quote on the markup basis (stamped, tierMargin 0.30 → 0.4286; margin itself never ships), its spec (line prices) untouched`);
  ok(sr["tiers.base"] === 43 && sr["tiers.gold"] === 25 && sr._pricingBasis === "markup", `${T}: …and a margin-era pricing_rules blob converted and stamped (Base 43, Gold 25)`);
  const again = sliceExport(JSON.parse(JSON.stringify(marginExp)) as ExportV2);
  ok(sl.files["data/estimates.js"] === again.files["data/estimates.js"] && JSON.stringify(sanitizeQuote(sanitizeQuote(row.doc as never))) === JSON.stringify(sanitizeQuote(row.doc as never)), `${T}: slicing is deterministic and sanitizeQuote is idempotent over the conversion`);
  // a stamped quote and a stamped blob in the export pass through exactly
  const stampedExp = JSON.parse(JSON.stringify(exp)) as ExportV2;
  const srow = (stampedExp.collections!.quotes as Array<{ id: string; doc: Record<string, unknown> }>).find((r) => r.id === "Q-G001")!;
  Object.assign(srow.doc, { pricingBasis: "markup", margin: 0.43, tierMargin: 0.37 });
  const sg = sliceGlobals(sliceExport(stampedExp).files);
  const ssq = (sg.PEAK_ESTIMATES as Array<Record<string, unknown>>).find((x) => x.id === "Q-G001")!;
  ok(ssq.tierMargin === 0.37 && ssq.pricingBasis === "markup", `${T}: a stamped quote in the export is shipped as stored (the stamp is honoured at slice time too)`);
  void convertQuoteDoc;
}

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
  ok(map("/design/grid/G-1").kind === "unsupported" && map("/design/specs/new?quote=Q-1").kind === "unsupported" && map("/catalog/documents").kind === "unsupported" && map("/design/assemblies/rack/R1/x").kind === "unsupported" && map("/inbox").kind === "unsupported", "handoff shell: any other app path is not part of the prototype (a rack's sheets route since Task 9; a deeper path does not)");
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
  ok(normalizedLocation(at("#/estimates", "?id=Q-G001&step=send"))?.endsWith("/index.html#/estimates") === true && normalizedLocation(at("#/catalog", "?step=review&ptab=client"))?.endsWith("index.html#/catalog") === true, "handoff shell: a stale (page-owned) search is dropped from a non-estimate route");
  ok(normalizedLocation(at("#/catalog", "?x=1")) === null && normalizedLocation(at("#/estimates", "?v=7&id=Q-G001&step=send"))?.endsWith("/index.html?v=7#/estimates") === true, "handoff shell: a host's own param (?v=, ?x=) stays on a non-estimate route");
  ok(normalizedLocation(at("#/estimate/Q-9", "?token=abc"))?.endsWith("?token=abc&id=Q-9#/estimate/Q-9") === true, "handoff shell: …and on an estimate route");

  // --- a host's params survive every navigation (an Artifact may add a version / token param) ---
  ok(withForeignParams("?id=Q-1", "?v=3&id=Q-2&step=send") === "?id=Q-1&v=3" && withForeignParams("", "?v=3&step=send") === "?v=3" && withForeignParams("?id=Q-1", "?step=send") === "?id=Q-1" && withForeignParams("?v=4", "?v=3") === "?v=4", "handoff shell: withForeignParams carries the host's params, never the page's own, never over a named one");
  ok(withForeignParams("", "?tag=a&tag=b") === "?tag=a&tag=b" && foreignOnly("?id=Q-1&v=3&ptab=client&lead=L-1") === "?v=3" && foreignOnly("?step=review") === "", "handoff shell: repeated host params kept; foreignOnly strips the page's params (incl. intake hand-off ones)");
  // goTo = pushState(pathname + withForeignParams(routeSearch(route), location.search) + routeHash(route)), then composeHistoryUrl.
  const goToUrl = (here: string, r: Route) => composeHistoryUrl(here, "/Users/x/prototype/index.html" + withForeignParams(routeSearch(r), new URL(here).search) + routeHash(r)).url;
  const g1 = goToUrl(at("#/estimates", "?v=3"), estimate("Q-1"));
  const g2 = goToUrl("file://" + g1, { name: "catalog" });
  const g3 = goToUrl("file://" + g2, { name: "estimates" });
  ok(g1.endsWith("index.html?id=Q-1&v=3#/estimate/Q-1") && g2.endsWith("index.html?v=3#/catalog") && g3.endsWith("index.html?v=3#/estimates"), `handoff shell: a host param survives goTo round trips list → estimate → catalog → list (${g1} · ${g2} · ${g3})`);
  const s1 = composeHistoryUrl(at("#/estimate/Q-1", "?id=Q-1&v=3"), "/Users/x/prototype/index.html?id=Q-1&step=package");
  const s2 = composeHistoryUrl("file://" + s1.url, "/Users/x/prototype/index.html?id=Q-1");
  ok(s1.url.endsWith("?id=Q-1&step=package&v=3#/estimate/Q-1") && s2.url.endsWith("?id=Q-1&v=3#/estimate/Q-1"), "handoff shell: the Estimator's own step pushes (which never name the host's params) keep them");
  const s3 = composeHistoryUrl(at("#/estimate/new", "?new=1&v=3"), "/Users/x/prototype/index.html?new=1&id=Q-2045");
  ok(s3.url.endsWith("?new=1&id=Q-2045&v=3#/estimate/Q-2045"), "handoff shell: …and the first save's id rewrite");

  // --- a new estimate's older history entries follow its first save ---
  ok(adoptedLocation(at("#/estimate/new", "?new=1&step=package&v=3"), "Q-2045")?.endsWith("index.html?step=package&v=3&id=Q-2045#/estimate/Q-2045") === true, "handoff shell: an entry of a saved new estimate is re-pointed at the saved id (its step and host params kept)");
  ok(adoptedLocation(at("#/estimate/Q-1", "?id=Q-1"), "Q-2045") === null && adoptedLocation(at("#/estimates"), "Q-2045") === null && adoptedLocation(at("#/estimate/new", "?new=1"), "new") === null, "handoff shell: only #/estimate/new entries are re-pointed, and only at a real id");
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

  // --- the Catalog screen's rules (Task 8) ---
  {
    const P = (sku: string, over: Record<string, unknown> = {}) => ({ id: sku, sku, desc: `${sku} desc`, category: "Audio", unit: "ea", cost: 100, list: 200, mfr: "Acme", ...over }) as LivePart;
    const cat = [
      P("ETC:CS40", { desc: "ColorSource 40 console", category: "Controls", mfr: "ETC", manufacturerModelNumber: "CS40" }),
      P("ETC:CSPAR", { desc: "ColorSource PAR", category: "Fixtures", mfr: "ETC", cost: 0 }),
      P("Shure:SM58", { desc: "Dynamic mic", category: "Audio", mfr: "Shure", formerSkus: ["SM58-OLD"] }),
      P("Shure:SM57", { desc: "Instrument mic", category: "Audio", mfr: "Shure" }),
      P("Blank:1", { desc: "Nothing", category: "", mfr: "" }),
    ];
    const skus = (xs: LivePart[]) => xs.map((x) => x.sku).join();
    // the ranking is the picker's: same function, same order — for a query, and for the empty query (alphabetical by description)
    for (const q of ["", "colorsource", "mic", "sm5", "etc"]) {
      ok(skus(browseCatalog(cat, { query: q, category: null, mfr: null }).rows) === skus(rankCatalogParts(cat, q).map((r) => r.p)), `handoff catalog: browse "${q}" lists rankCatalogParts' order`);
    }
    const catStoreA = await openStore({ catalog: docs(cat as never), quotes: [] }, { idb: null });
    const picker = (await estimatorActions(catStoreA).searchCatalog("mic")).hits.map((h) => h.sku).join();
    ok(picker === skus(browseCatalog(cat, { query: "mic", category: null, mfr: null }).rows), `handoff catalog: the Estimator picker (searchCatalog) and the Catalog search agree (${picker})`);
    // facets: exact match, crossed counts, "(none)" for blank
    const all = browseCatalog(cat, { query: "", category: null, mfr: null });
    ok(all.categories.map((f) => `${f.value}:${f.count}`).join() === "Audio:2,:1,Controls:1,Fixtures:1" && all.manufacturers.map((f) => `${f.value}:${f.count}`).join() === "ETC:2,Shure:2,:1", `handoff catalog: facet counts — biggest first, ties by name (${all.categories.map((f) => `${f.value}:${f.count}`).join()})`);
    ok(facetLabel("") === "(none)" && facetLabel("Audio") === "Audio", "handoff catalog: a blank facet value reads (none)");
    const byMfr = browseCatalog(cat, { query: "", category: null, mfr: "Shure" });
    ok(skus(byMfr.rows) === "Shure:SM58,Shure:SM57" && byMfr.categories.length === 1 && byMfr.categories[0].value === "Audio" && byMfr.manufacturers.length === 3, "handoff catalog: a manufacturer pick narrows the rows and the category counts, not its own facet's list");
    const both = browseCatalog(cat, { query: "", category: "Audio", mfr: "ETC" });
    ok(both.rows.length === 0, "handoff catalog: category AND manufacturer both apply");
    ok(skus(browseCatalog(cat, { query: "", category: "", mfr: "" }).rows) === "Blank:1", "handoff catalog: a blank category / manufacturer is a real facet value");
    ok(skus(browseCatalog(cat, { query: "sm58-old", category: null, mfr: null }).rows) === "Shure:SM58", "handoff catalog: a former SKU finds the part (the picker's rule)");
    // paging
    ok(JSON.stringify(pageBounds(250, 0)) === JSON.stringify({ page: 0, pages: 3, start: 0, end: 100 }) && pageBounds(250, 2).end === 250 && pageBounds(250, 9).page === 2 && pageBounds(250, -3).page === 0 && pageBounds(0, 0).pages === 1 && pageBounds(0, 0).end === 0 && PAGE_SIZE === 100, "handoff catalog: pageBounds — 100 a page, clamped, an empty list is one page");
    ok(money(1234.5) === "$1,234.50" && money(undefined) === "$0.00" && money(0) === "$0.00", "handoff catalog: money cells print dollars and cents");
    // SKUs: live, formerSkus, retired stubs, case-insensitive
    const idx = skuIndex(cat, new Map([["RETIRED:OLD", "ETC:CS40"]]));
    ok(validateSku("", idx) === "A SKU is required." && validateSku("  ", idx) === "A SKU is required.", "handoff catalog: validateSku — blank refused");
    ok(/reserved/.test(validateSku("custom", idx) ?? "") && /under 120/.test(validateSku("x".repeat(121), idx) ?? "") && /control/.test(validateSku("a\u0001b", idx) ?? ""), "handoff catalog: validateSku — CUSTOM, over-long and control characters refused");
    ok(/ETC:CS40 is already in the catalog/.test(validateSku("etc:cs40", idx) ?? "") && /already in the catalog/.test(validateSku(" Shure:SM57 ", idx) ?? ""), "handoff catalog: validateSku — a live SKU is taken, in any case, trimmed");
    ok(/retired by a SKU rename/.test(validateSku("retired:old", idx) ?? "") && /retired by a SKU rename/.test(validateSku("sm58-old", idx) ?? ""), "handoff catalog: validateSku — a retired SKU (rename stub or a part's formerSkus) is never reused");
    ok(validateSku("Brand:Model 9", idx) === null, "handoff catalog: validateSku — a fresh Brand:Model SKU (spaces fine) is free");
    // drafts
    const base = P("ETC:CS40", { desc: "ColorSource 40 console", cost: 3000, list: 4500, mfr: "ETC", pricedAt: 111, updatedAt: 111, ruHeight: 2, rackMount: "rack", note: "kept", deviceTypeKey: "dt" });
    const d0 = draftFromPart(base);
    ok(d0.sku === "ETC:CS40" && d0.cost === "3000" && d0.list === "4500" && d0.rack.ruHeight === "2" && d0.rack.rackMount === "rack" && d0.rack.depthIn === "", "handoff catalog: draftFromPart — a part's own values, rack blanks stay blank");
    ok(draftFromPart(null).unit === "ea" && draftFromPart(null).cost === "0" && draftFromPart(null).sku === "", "handoff catalog: draftFromPart(null) — a blank new part");
    const same = applyDraft(base, d0, { now: 999, by: "Ann" });
    ok(same.ok && same.part.pricedAt === 111 && same.part.updatedAt === 999 && same.part.note === "kept" && (same.part as { deviceTypeKey?: string }).deviceTypeKey === "dt" && same.part.ruHeight === 2, "handoff catalog: applyDraft — an untouched price keeps pricedAt; fields the editor doesn't own ride along");
    const moved = applyDraft(base, { ...d0, list: "$4,600.50" }, { now: 999, by: "Ann" });
    ok(moved.ok && moved.part.list === 4600.5 && moved.part.cost === 3000 && moved.part.pricedAt === 999, "handoff catalog: applyDraft — a moved list price re-stamps pricedAt (writePart's rule); \"$4,600.50\" parses");
    const cleared = applyDraft(base, { ...d0, mfr: "", manufacturerModelNumber: "  CS-40  ", rack: { ...d0.rack, ruHeight: "", rackMount: "" } }, { now: 5, by: "Ann" });
    ok(cleared.ok && !("mfr" in cleared.part) && cleared.part.manufacturerModelNumber === "CS-40" && !("ruHeight" in cleared.part) && !("rackMount" in cleared.part), "handoff catalog: applyDraft — a blank optional field or rack field clears the key; text is trimmed");
    const nar = applyDraft(base, { ...d0, narrativeText: "  Para\r\nTwo  " }, { now: 7, by: "Ann Admin" });
    ok(nar.ok && nar.part.narrativeText === "Para\nTwo" && nar.part.narrativeUpdatedAt === 7 && nar.part.narrativeUpdatedBy === "Ann Admin", "handoff catalog: applyDraft — a new narrative paragraph is normalized and stamped with when and who");
    const nar2 = applyDraft(nar.ok ? nar.part : base, { ...draftFromPart(nar.ok ? nar.part : base), narrativeText: "" }, { now: 8, by: "Bob" });
    ok(nar2.ok && !("narrativeText" in nar2.part) && !("narrativeUpdatedAt" in nar2.part) && !("narrativeUpdatedBy" in nar2.part), "handoff catalog: applyDraft — clearing the paragraph drops its three keys");
    const nar3 = applyDraft(nar.ok ? nar.part : base, { ...draftFromPart(nar.ok ? nar.part : base), cost: "5" }, { now: 9, by: "Bob" });
    ok(nar3.ok && nar3.part.narrativeUpdatedAt === 7 && nar3.part.narrativeUpdatedBy === "Ann Admin", "handoff catalog: applyDraft — an untouched paragraph keeps its stamp");
    const bad = applyDraft(base, { ...d0, desc: " ", cost: "-1", list: "abc", rack: { ...d0.rack, ruHeight: "0.3" } }, { now: 1, by: "A" });
    ok(!bad.ok && !!bad.errors.desc && !!bad.errors.cost && !!bad.errors.list && /RU height/.test(bad.errors.rack ?? ""), "handoff catalog: applyDraft — every invalid field is reported at once");
    ok(!applyDraft(base, { ...d0, cost: "10000001" }, { now: 1, by: "A" }).ok && applyDraft(base, { ...d0, cost: "", list: "" }, { now: 1, by: "A" }).ok, "handoff catalog: applyDraft — an absurd price is refused; a blank price is 0");
    const keep = applyDraft(base, { ...d0, sku: "OTHER:SKU" }, { now: 1, by: "A" });
    ok(keep.ok && keep.part.sku === "ETC:CS40" && keep.part.id === "ETC:CS40", "handoff catalog: applyDraft — an existing part's SKU never changes");
    const fresh = applyDraft(null, { ...draftFromPart(null), sku: " NEW:1 ", desc: "A new part", cost: "10", list: "25" }, { now: 50, by: "A", index: idx });
    ok(fresh.ok && fresh.part.id === "NEW:1" && fresh.part.sku === "NEW:1" && fresh.part.category === "Uncategorized" && fresh.part.unit === "ea" && fresh.part.pricedAt === 50 && fresh.part.updatedAt === 50, "handoff catalog: applyDraft — a new part: id = sku, upsertPart's default category, priced now");
    const dupNew = applyDraft(null, { ...draftFromPart(null), sku: "shure:sm58", desc: "x" }, { now: 1, by: "A", index: idx });
    ok(!dupNew.ok && /already in the catalog/.test(dupNew.errors.sku ?? ""), "handoff catalog: applyDraft — a new part's SKU must be unique against the index");
    // parsePrice: plain decimals only; no silent sub-cent rounding; an untouched field round-trips
    const pp = (raw: string, stored?: number) => { const r = parsePrice(raw, stored); return r.ok ? r.value : r.error; };
    ok(pp("$1,234.50") === 1234.5 && pp("1,234") === 1234 && pp("12") === 12 && pp(".5") === 0.5 && pp("") === 0 && pp("  $ 7.25 ") === 7.25 && pp("1,234,567.89") === 1234567.89, "handoff catalog: parsePrice — $, valid thousands commas, decimals, blank = 0");
    ok(["0x10", "1e3", "1E3", "1,23,4", "12,34", "1234,567", ",100", "1,,000", "-5", "+5", "5.", ".", "1.2.3", "abc", "Infinity", "$$5", "5 5"].every((raw) => pp(raw) === "Enter a number, zero or more."), "handoff catalog: parsePrice — hex, exponent, garbled commas, signs and junk refused");
    ok(pp("1.234") === "Use at most 2 decimal places." && pp("0.005") === "Use at most 2 decimal places." && pp("12.345", 12.34) === "Use at most 2 decimal places.", "handoff catalog: parsePrice — more than 2 decimals is refused, never rounded");
    ok(pp("12.345", 12.345) === 12.345 && pp("1.5", 1.5) === 1.5, "handoff catalog: parsePrice — a >2-decimal value equal to the stored one is accepted unchanged");
    {
      const sub = P("SUB:1", { desc: "Sub-cent part", cost: 12.345, list: 20.999, pricedAt: 5 });
      const keepSub = applyDraft(sub, { ...draftFromPart(sub), desc: "Sub-cent part 2" }, { now: 9, by: "A" });
      ok(keepSub.ok && keepSub.part.cost === 12.345 && keepSub.part.list === 20.999 && keepSub.part.pricedAt === 5, "handoff catalog: applyDraft — an untouched sub-cent price round-trips exactly and keeps pricedAt");
      const typedSub = applyDraft(sub, { ...draftFromPart(sub), cost: "12.346" }, { now: 9, by: "A" });
      ok(!typedSub.ok && typedSub.errors.cost === "Use at most 2 decimal places.", "handoff catalog: applyDraft — a typed sub-cent price is refused with the message");
      const hexCost = applyDraft(base, { ...d0, cost: "0x10" }, { now: 1, by: "A" });
      ok(!hexCost.ok && !!hexCost.errors.cost, "handoff catalog: applyDraft — a hex cost is refused");
    }
    // fabric guard: the app's own fabricRateProblem / fabricFactsProblem over the facts a part already carries
    {
      const fab = P("FAB:1", { desc: "Velour", category: "Fabric", unit: "sqft", cost: 2, list: 3, curtainAreaRate: 4.5, oz: 25, ozBasis: "lin-yd", flameRating: "NFPA 701" });
      const fd = draftFromPart(fab);
      const toCat = applyDraft(fab, { ...fd, category: "Cable" }, { now: 1, by: "A" });
      ok(!toCat.ok && /Only a fabric part \(category Fabric/.test(toCat.errors.category ?? ""), "handoff catalog: fabric guard — moving a fabric out of Fabric is refused with the app's rate message");
      const soft = P("FAB:2", { desc: "Sewn goods", category: "Theatrical/Soft Goods", unit: "sq ft", curtainAreaRate: 3 });
      ok(applyDraft(soft, draftFromPart(soft), { now: 1, by: "A" }).ok, "handoff catalog: fabric guard — Soft Goods sold per sq ft is still a fabric");
      const softUnit = applyDraft(soft, { ...draftFromPart(soft), unit: "ea" }, { now: 1, by: "A" });
      ok(!softUnit.ok && /Only a fabric part/.test(softUnit.errors.category ?? softUnit.errors.unit ?? "") && !!softUnit.errors.unit, "handoff catalog: fabric guard — changing Soft Goods away from per-sq-ft is refused (error on the unit)");
      const ozOnly = P("FAB:3", { desc: "Weighted", category: "Fabric", unit: "lin-yd", oz: 20, ozBasis: "lin-yd" });
      const ozMove = applyDraft(ozOnly, { ...draftFromPart(ozOnly), category: "Hardware" }, { now: 1, by: "A" });
      ok(!ozMove.ok && /weight or flame rating/.test(ozMove.errors.category ?? ""), "handoff catalog: fabric guard — a weight / flame rating strands too (the app's facts message)");
      const flameOnly = P("FAB:4", { desc: "Rated", category: "Fabric", unit: "lin-yd", flameRating: "NFPA 701" });
      ok(!applyDraft(flameOnly, { ...draftFromPart(flameOnly), category: "Hardware" }, { now: 1, by: "A" }).ok && applyDraft(flameOnly, { ...draftFromPart(flameOnly), desc: "Rated 2" }, { now: 1, by: "A" }).ok, "handoff catalog: fabric guard — a fabric edited in place saves; a non-fabric part is never blocked");
      ok(applyDraft(base, { ...d0, category: "Anything" }, { now: 1, by: "A" }).ok && applyDraft(null, { ...draftFromPart(null), sku: "Z:1", desc: "z", category: "Cable" }, { now: 1, by: "A", index: idx }).ok, "handoff catalog: fabric guard — ordinary parts and new parts are unaffected");
    }
    ok(partFingerprint({ a: 1, b: { y: 2, x: [3, { q: 1, p: 2 }] } }) === partFingerprint({ b: { x: [3, { p: 2, q: 1 }], y: 2 }, a: 1 }) && partFingerprint({ a: 1 }) !== partFingerprint({ a: 2 }), "handoff catalog: partFingerprint — key order never matters, a changed value does");
    // what a catalog price does to an estimate line: catalogAddPrice
    ok(addLineSell({ cost: 0, list: 733 }, 0.43) === 733 && addLineSell({ cost: 294, list: 1200 }, 0.43) === 420.42 && addLineSell({ cost: 100, list: 5 }, null) === 143 && addLineSell({ cost: 0, list: 9 }, null) === 9,
      "handoff catalog: addLineSell — no cost sells at list; a cost sells at cost × (1 + markup), list ignored (the markup defaults to 43%)");
    // edit → the picker and the resolver read the overlay at once; Reset puts it back
    const stCat = await openStore({ catalog: docs(cat as never), quotes: [] }, { idb: null });
    const edited = applyDraft(cat[1], { ...draftFromPart(cat[1]), list: "955.5" }, { now: 1, by: "A" });
    if (edited.ok) await stCat.put("catalog", edited.part);
    const hit = (await estimatorActions(stCat).searchCatalog("ETC:CSPAR")).hits[0];
    ok(hit?.sku === "ETC:CSPAR" && hit.list === 955.5 && hit.cost === 0, "handoff catalog: a saved edit is what the Estimator's picker returns (list 955.5, cost 0)");
    await stCat.reset();
    ok((await estimatorActions(stCat).searchCatalog("ETC:CSPAR")).hits[0]?.list === 200, "handoff catalog: Reset restores the slice's price");
    // thumbnails: the packaged photo when the package ships one, else the "coming soon" placeholder
    ok(partPhotoSrc("ETC:CS40") === PLACEHOLDER_DIR + "coming-soon.webp", "handoff catalog: partPhotoSrc — no packaged photo → the placeholder");
    const hadWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { value: { PEAK_PHOTOS: { bySku: { "ETC:CS40": "PD-40", "Shure:SM58": "PD-GONE" }, byDoc: { "PD-40": "images/PD-40.webp" } } }, configurable: true, writable: true });
    try {
      ok(partPhotoSrc("ETC:CS40") === "images/PD-40.webp" && partPhotoSrc("Shure:SM58") === PLACEHOLDER_DIR + "coming-soon.webp" && partPhotoSrc("constructor") === PLACEHOLDER_DIR + "coming-soon.webp",
        "handoff catalog: partPhotoSrc — PEAK_PHOTOS.bySku[sku] → byDoc[docId] when present; a sku whose doc has no file, or an Object.prototype name, gets the placeholder");
      ok(photoDocIdForSku("ETC:CS40") === "PD-40" && photoDocIdForSku("Shure:SM58") === null && partDocumentSrc("PD-40") === "images/PD-40.webp" && assetUrl("/api/part-documents/PD-40") === "images/PD-40.webp" && assetUrl("/api/part-documents/PD-x") === PLACEHOLDER_DIR + "coming-soon.webp",
        "handoff catalog: the document lookups use the same map — photoDocIdForSku, partDocumentSrc and /api/part-documents/<docId> all resolve through it");
    } finally {
      if (hadWindow) Object.defineProperty(globalThis, "window", hadWindow);
      else delete (globalThis as Record<string, unknown>).window;
    }
  }

  // --- Reset ---
  const blocked = await runReset({ reset: () => Promise.reject(new Error(RESET_BLOCKED_MESSAGE)) });
  ok(!blocked.ok && blocked.error === "Close other prototype windows and try again.", "handoff shell: a blocked reset surfaces the store's message verbatim");
  const odd = await runReset({ reset: () => Promise.reject("boom") });
  ok(!odd.ok && odd.error.includes("did not go through"), "handoff shell: a reset that rejects with a non-Error still reads sensibly");
  let called = 0;
  const fine = await runReset({ reset: async () => void (called += 1) });
  ok(fine.ok && called === 1, "handoff shell: a clean reset resolves ok after exactly one store.reset()");

  // --- Reset clears the new-estimate adoption (sessionStorage key + in-memory map) only when it succeeded ---
  {
    const g = globalThis as unknown as Record<string, unknown>;
    const had = Object.getOwnPropertyDescriptor(g, "sessionStorage");
    const mem = new Map<string, string>();
    Object.defineProperty(g, "sessionStorage", { configurable: true, value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } });
    try {
      adopt("e1", "Q-9");
      ok(mem.has(ADOPTED_KEY) && adopted.get("e1") === "Q-9", "handoff shell: adopt() records token → id in memory and sessionStorage");
      await runReset({ reset: () => Promise.reject(new Error("blocked")) });
      ok(mem.has(ADOPTED_KEY) && adopted.get("e1") === "Q-9", "handoff shell: a FAILED reset keeps the adoption (nothing was discarded)");
      await runReset({ reset: async () => {} });
      ok(!mem.has(ADOPTED_KEY) && adopted.size === 0, "handoff shell: a successful reset clears peak-handoff-adopted and the in-memory adoption map");
    } finally {
      if (had) Object.defineProperty(g, "sessionStorage", had);
      else delete g.sessionStorage;
    }
  }

  // --- Modified / middle clicks on app links: the new-tab URL ---
  {
    const here = { href: "file:///pkg/index.html?v=42&id=Q-1&step=package#/estimate/Q-1", search: "?v=42&id=Q-1&step=package", hash: "#/estimate/Q-1" };
    const route = newTabHref(mapAppHref("/estimator?id=Q-2", parseRoute(here.hash, here.search)), here);
    ok(route === "file:///pkg/index.html?id=Q-2&v=42#/estimate/Q-2", `handoff shell: ctrl/middle-click on /estimator?id= opens the route's hash URL, host params kept, owned params replaced (${route})`);
    ok(newTabHref(mapAppHref("/quotes", parseRoute(here.hash, here.search)), here) === "file:///pkg/index.html?v=42#/estimates", "handoff shell: …/quotes opens #/estimates without the Estimator's params");
    const page = newTabHref(mapAppHref("/estimator?step=review", parseRoute(here.hash, here.search)), here);
    ok(page === "file:///pkg/index.html?step=review&id=Q-1&v=42#/estimate/Q-1", `handoff shell: a same-page query change opens the same estimate in a new tab (${page})`);
    ok(newTabHref(mapAppHref("/design/grid/G-1", parseRoute(here.hash, here.search)), here) === null && newTabHref(mapAppHref("#systems", parseRoute(here.hash, here.search)), here) === null, "handoff shell: an unmapped app path or an anchor has no tab of its own (notice / in-place scroll)");
    ok(!/^$/.test(route ?? "") && (route ?? "").includes("#/"), "handoff shell: the new-tab URL is a full URL with a #/ route (never window.open(\"\"), which is the cut-sheet stand-in)");
  }

  // --- history patch: a refused pushState/replaceState announces nothing and cannot recurse ---
  {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = ["window", "sessionStorage"].map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
    let refuse = false;
    let calls = 0;
    const loc = { href: "file:///pkg/index.html?id=Q-7", get search() { return new URL(this.href).search; }, get hash() { return new URL(this.href).hash; }, get pathname() { return new URL(this.href).pathname; } };
    const hist = {
      state: null as unknown,
      pushState(state: unknown, _u: string, url?: string | URL | null) {
        calls += 1;
        if (refuse) throw new DOMException("refused", "SecurityError");
        this.state = state;
        if (url != null) loc.href = new URL(String(url), loc.href).href;
      },
      replaceState(state: unknown, _u: string, url?: string | URL | null) {
        calls += 1;
        if (refuse) throw new DOMException("refused", "SecurityError");
        this.state = state;
        if (url != null) loc.href = new URL(String(url), loc.href).href;
      },
    };
    const win = Object.assign(new EventTarget(), { history: hist, location: loc });
    Object.defineProperty(g, "window", { configurable: true, value: win });
    Object.defineProperty(g, "sessionStorage", { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const nav = await import("../handoff/estimator/shims/next-navigation");
      let events = 0;
      nav.subscribeLocation((c) => {
        events += 1;
        if (c.source === "nav") nav.normalizeLocation(); // a listener that re-normalizes on every announced change
      });
      refuse = true;
      calls = 0;
      events = 0;
      nav.normalizeLocation();
      ok(calls === 1 && events === 0, `handoff shell: a refused replaceState in normalizeLocation announces no change and is tried once (${calls} calls, ${events} events)`);
      calls = 0;
      window.history.pushState(null, "", "?step=package");
      ok(calls === 1 && events === 0, `handoff shell: a refused pushState announces no change (${calls} calls, ${events} events)`);
      refuse = false;
      calls = 0;
      events = 0;
      nav.normalizeLocation();
      ok(calls === 1 && events === 1 && loc.href.endsWith("#/estimate/Q-7"), `handoff shell: a successful normalize announces once, and a re-entrant normalize from its own listener is a no-op (${calls} calls, ${events} events, ${loc.href})`);
    } finally {
      console.warn = warn;
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(g, k, d);
        else delete g[k];
      }
    }
  }
}


/* ------------------------------------------------------------------ PR 2 Task 9: the Assembly Builder and racks */

/** Task 9 — the Assembly Builder's routes, props, fixtures store port, actions and the rack sheets' loader. */
export async function handoffAssemblyChecks(ok: Ok) {
  // --- routes ---
  const rack = parseRoute("#/assemblies/rack/SA-1%20X", "");
  ok(rack.name === "rack" && rack.id === "SA-1 X" && routeHash(rack) === "#/assemblies/rack/SA-1%20X" && routeSearch(rack) === "", "handoff assemblies: #/assemblies/rack/<id> is the rack route (id decoded, hash re-encoded, no search)");
  ok(parseRoute("#/assemblies/rack", "").name === "unknown" && parseRoute("#/assemblies/rack/a/b", "").name === "unknown" && parseRoute("#/assemblies/x", "").name === "unknown" && parseRoute("#/assemblies", "").name === "assemblies",
    "handoff assemblies: a rack route needs exactly one id; #/assemblies stays the builder");
  ok(sameRoute({ name: "rack", id: "A" }, { name: "rack", id: "A" }) && !sameRoute({ name: "rack", id: "A" }, { name: "rack", id: "B" }) && !sameRoute({ name: "rack", id: "A" }, { name: "assemblies" }), "handoff assemblies: sameRoute compares rack ids");
  const mapped = mapAppHref("/design/assemblies/rack/SA-1%20X", { name: "assemblies" });
  ok(mapped.kind === "route" && mapped.route.name === "rack" && (mapped.route as { id: string }).id === "SA-1 X", `handoff assemblies: the builder's Submittal link /design/assemblies/rack/<id> → the rack route (${JSON.stringify(mapped)})`);
  ok(mapAppHref("/design/assemblies/rack/A/b", { name: "assemblies" }).kind === "unsupported" && mapAppHref("/api/racks/SA-1/submittal", { name: "rack", id: "SA-1" }).kind === "unsupported",
    "handoff assemblies: a deeper path and the submittal zip / csv routes are not in the prototype (the notice)");
  ok(newTabHref(mapped, { href: "file:///p/index.html?v=1#/assemblies", search: "?v=1", hash: "#/assemblies" }) === "file:///p/index.html?v=1#/assemblies/rack/SA-1%20X", "handoff assemblies: a modified click on Submittal opens the rack route in a new tab (host params kept)");

  // --- a store: four parts (one renamed), the convert flag, rack defaults absent ---
  const part = (sku: string, over: Record<string, unknown> = {}) => ({ id: sku, sku, desc: `${sku} desc`, category: "Lighting", unit: "ea", cost: 100, list: 180, mfr: "Acme", ...over });
  const catalog = docs([
    part("ETC:S4", { cost: 300, list: 500, pricedAt: 1_700_000_000_000 }),
    part("ETC:LENS", { cost: 40, list: 75 }),
    part("ETC:YOKE", { cost: 10, list: 20 }),
    part("AV:AMP", { cost: 400, list: 700, ruHeight: 2, weightLb: 30, powerWatts: 200, rackMount: "rack" }),
    { id: "OLD:LENS", sku: "OLD:LENS", renamedTo: "ETC:LENS" },
  ]);
  const team: SeedTeamUser[] = [
    { id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" },
    { id: "u3", name: "Rex Reviewer", roles: ["Reviewer"], status: "active" },
  ];
  const seedRules = { settings: { companyName: "Peak Systems Group", priceListEffective: { acme: 1_710_000_000_000 } }, blobs: { fixtures_convert: { convertedAt: 1 } } };
  const mk = (rules: { settings: Record<string, unknown>; blobs: Record<string, unknown> }, fixtures: Array<{ id: string }> = []) =>
    openStore(
      storeSeedFrom({ estimates: [], catalog: catalog as never, fixtures: fixtures as never, rules: rules as SeedRules, meta: null }),
      { idb: null },
    );
  const store = await mk(seedRules);
  configurePorts({ store, customers: EMPTY_CUSTOMERS, rules: null, team });
  users.setCurrent("u1");
  let refreshes = 0;
  const offRefresh = onRefresh(() => void refreshes++);
  const A = assembliesActions(store);

  // --- props on an empty slice: an empty list renders cleanly ---
  const p0 = await buildAssemblyBuilderProps(store);
  ok(p0.initial.length === 0 && p0.parts.length === 0 && JSON.stringify(p0.coverage) === "{}" && p0.portalCategories.length === 0 && JSON.stringify(p0.rackDefaults) === "{}" && p0.priceListEffective.acme === 1_710_000_000_000,
    "handoff assemblies: no fixtures → an empty list, no parts, no coverage; rack_defaults absent → {} (the app's defaults); priceListEffective from the settings");

  // --- the picker search is the Estimator's ---
  const s1 = await A.searchAssemblyPartsAction("etc");
  const est = await estimatorActions(store).searchCatalog("etc", "", 40);
  ok(s1.total === est.total && s1.hits.map((h) => h.sku).join() === est.hits.map((h) => h.sku).join() && s1.hits.every((h) => "cost" in h && "list" in h && !("model" in h)),
    `handoff assemblies: searchAssemblyPartsAction ranks exactly like searchCatalog, reshaped to PartHit (${s1.hits.map((h) => h.sku).join()})`);
  ok((await A.searchAssemblyPartsAction("a", 1)).hits.length === 1 && (await A.searchAssemblyPartsAction("a", 9999)).hits.length <= 100 && (await A.searchAssemblyPartsAction("  ")).hits.length === 0,
    "handoff assemblies: the picker limit is clamped (clampPickerLimit); a blank query finds nothing");
  ok(((await A.searchAssemblyPartsAction("amp")).hits[0]?.rack?.ruHeight ?? 0) === 2, "handoff assemblies: hits carry the part's rack facts (the rack tray reads them)");

  // --- saveFixtureAction: validation, snapshot, stamps ---
  const fx = (over: Partial<FixtureInput> = {}): FixtureInput => ({ id: null, kind: "fixture", label: "Source Four", description: "", lightEngineSku: "ETC:S4", lensSku: "OLD:LENS", lines: { data: [], power: [], mounting: [{ sku: "ETC:YOKE", qty: 2 }], accessories: [] }, ...over }) as FixtureInput;
  ok(JSON.stringify(await A.saveFixtureAction(fx({ label: "  " }))) === JSON.stringify({ ok: false, error: "Add a label." }) && !(await A.saveFixtureAction(fx({ lightEngineSku: "" }))).ok,
    "handoff assemblies: saveFixtureAction refuses what sanitizeFixtureInput refuses (no label, no light engine)");
  ok(!(await A.saveFixtureAction(fx({ id: "SA-NOPE" }))).ok && ((await A.saveFixtureAction(fx({ id: "SA-NOPE" }))) as { error: string }).error === "This assembly was deleted — reload the page.", "handoff assemblies: saving an id with no row is refused as deleted");
  refreshes = 0;
  const r1 = await A.saveFixtureAction(fx());
  ok(r1.ok && /^SA-[0-9A-Z]+$/.test((r1 as { id: string }).id) && refreshes === 1, `handoff assemblies: a new fixture saves with an SA-<TS36> id and refreshes the screen (${JSON.stringify(r1)})`);
  const id1 = (r1 as { id: string }).id;
  const rec1 = (await getFixtureLocal(store, id1))!;
  // OLD:LENS was renamed to ETC:LENS: getMany follows the rename, but resolveFixture keys by the line's own sku — the app's behaviour.
  ok(!!rec1 && rec1.createdBy === "Ann Admin" && rec1.updatedBy === "Ann Admin" && rec1.snapshot!.cost === 300 + 2 * 10 && rec1.snapshot!.price === 500 + 2 * 20 && rec1.snapshot!.pricedAt === 1_710_000_000_000,
    `handoff assemblies: the snapshot prices from this record's SKUs at save (renamed lens unmatched by its old sku, as the app), pricesAsOf from priceListEffective (${JSON.stringify(rec1?.snapshot)})`);
  const r2 = await A.saveFixtureAction(fx({ lensSku: "ETC:LENS" }));
  const rec2 = (await getFixtureLocal(store, (r2 as { id: string }).id))!;
  ok(rec2.snapshot!.cost === 300 + 40 + 20 && rec2.snapshot!.price === 500 + 75 + 40, `handoff assemblies: light engine + lens + 2 yokes snapshot cost 360 / sell 615 (${JSON.stringify(rec2.snapshot)})`);
  ok(!(await A.saveFixtureAction(fx({ id: id1, kind: "system", scope: "Audio", parts: [{ sku: "AV:AMP", qty: 1 }] }))).ok, "handoff assemblies: an assembly can't change kind after it's created");

  // --- update keeps id / kind / created stamps / legacy-only keys, clears needsReview and a cleared optional ---
  await store.put("fixtures", { ...rec1, needsReview: true, position: "FOH 1", lightEngineName: "legacy name" });
  users.setCurrent("u3");
  const r3 = await A.saveFixtureAction(fx({ id: id1, label: "Source Four v2", position: "" }));
  const rec3 = (await store.get<FixtureRecord & Record<string, unknown>>("fixtures", id1))!;
  ok(r3.ok && rec3.label === "Source Four v2" && rec3.createdBy === "Ann Admin" && rec3.updatedBy === "Rex Reviewer" && rec3.createdAt === rec1.createdAt && rec3.lightEngineName === "legacy name" && !("needsReview" in rec3) && !("position" in rec3),
    "handoff assemblies: an update keeps id, kind and created stamps, carries legacy-only keys, drops needsReview and a cleared optional (anyone signed in may save)");
  users.setCurrent("u1");

  // --- props after saves: parts referenced, coverage from the implied accessory links ---
  const p1 = await buildAssemblyBuilderProps(store);
  ok(p1.initial.map((f) => f.label).join() === "Source Four,Source Four v2" && p1.parts.map((h) => h.sku).sort().join() === "ETC:LENS,ETC:S4,ETC:YOKE",
    `handoff assemblies: the list is by label; parts = only the SKUs saved fixtures reference, renames followed (${p1.parts.map((h) => h.sku).join()})`);
  const cov = p1.coverage[pairKey("ETC:S4", "ETC:YOKE")];
  ok(!!cov && cov.linked && !cov.own && memberCoverageLabel(cov) === "Fixture has no datasheet yet" && assemblyAccessoryLinks(p1.initial).every((l) => l.source === "assembly" && l.sourceRef?.startsWith("fixture:")),
    "handoff assemblies: a saved fixture's members read as linked (the links saveFixtureAction would sync), with no datasheets in the prototype");
  ok(JSON.stringify(await A.saveFixtureAction(fx({ portalCategory: "Lighting packages" }))).includes('"ok":true') && (await buildAssemblyBuilderProps(store)).portalCategories.join() === "Lighting packages",
    "handoff assemblies: the portal categories datalist is the fixtures' own, unique and sorted");

  // --- the Estimator sees the saved fixtures (after a refresh) at the builder's sell ---
  const eprops = await buildEstimatorProps(store, null, new URLSearchParams());
  const asm = eprops.fixtureAssemblies.find((a) => a.id === rec2.id);
  ok(!!asm && asm.kind === "fixture" && asm.components.reduce((n, c) => n + c.list * c.defaultQty, 0) === 615, "handoff assemblies: the Estimator's + Add assembly lists the saved fixture, its components summing to the builder's sell");

  // --- delete: a soft-delete marker; listFixtures and the Estimator skip it; the id is never minted again ---
  refreshes = 0;
  ok(JSON.stringify(await A.deleteFixtureAction(rec2.id)) === '{"ok":true}' && refreshes === 1, "handoff assemblies: deleteFixtureAction answers { ok: true } and refreshes");
  const marker = await store.get<{ deleted?: boolean; label?: string }>("fixtures", rec2.id);
  ok(marker?.deleted === true && marker.label === rec2.label && (await getFixtureLocal(store, rec2.id)) === null && !(await listFixtures(store)).some((f) => f.id === rec2.id)
    && !(await buildEstimatorProps(store, null, new URLSearchParams())).fixtureAssemblies.some((a) => a.id === rec2.id),
    "handoff assemblies: a deleted fixture is a marker row (body kept), reads as missing and leaves the builder and the Estimator");
  ok(!(await A.saveFixtureAction(fx({ id: rec2.id }))).ok, "handoff assemblies: saving a deleted fixture is refused");
  const fixedNow = 1_790_000_000_000;
  const clean = { kind: "hardware", label: "Chain", description: "", lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [{ sku: "ETC:YOKE", qty: 1 }] } as never;
  const c1 = await createFixtureLocal(store, clean, "Ann Admin", { cost: 0, price: 0, pricedAt: null }, fixedNow);
  await removeFixtureLocal(store, c1.id);
  const c2 = await createFixtureLocal(store, clean, "Ann Admin", { cost: 0, price: 0, pricedAt: null }, fixedNow);
  const c3 = await createFixtureLocal(store, clean, "Ann Admin", { cost: 0, price: 0, pricedAt: null }, fixedNow);
  ok(c1.id === `SA-${fixedNow.toString(36).toUpperCase()}` && c2.id === `${c1.id}-2` && c3.id === `${c1.id}-3`, `handoff assemblies: a same-millisecond id takes -2, -3 — a deleted id is never minted again (${c1.id}, ${c2.id}, ${c3.id})`);

  // --- the settings-backed fallback while unconverted ---
  const legacy = [{ id: "fa-1", name: "Legacy PAR", components: [{ sku: "ETC:S4", label: "PAR", role: "fixture", defaultQty: 1 }] }];
  const un = await mk({ settings: { fixtureAssemblies: legacy }, blobs: {} });
  configurePorts({ store: un, rules: null });
  await refreshPortsFromStore(un);
  ok((await listFixtures(un)).map((f) => f.id).join() === "fa-1" && (await getFixtureLocal(un, "fa-1"))?.label === "Legacy PAR", "handoff assemblies: unconverted → the settings-backed assemblies are served in memory");
  const U = assembliesActions(un);
  const up = await U.saveFixtureAction({ id: "fa-1", kind: "fixture", label: "Legacy PAR (edited)", description: "", lightEngineSku: "ETC:S4", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] } } as FixtureInput);
  ok(up.ok && (await un.get<{ label: string; legacy?: unknown }>("fixtures", "fa-1"))?.label === "Legacy PAR (edited)" && (await listFixtures(un)).length === 1, "handoff assemblies: saving an in-memory fa- record writes its row under the same id (listed once)");
  const un2 = await mk({ settings: { fixtureAssemblies: legacy }, blobs: {} });
  configurePorts({ store: un2, rules: null });
  await refreshPortsFromStore(un2);
  await assembliesActions(un2).deleteFixtureAction("fa-1");
  ok((await listFixtures(un2)).length === 0 && (await un2.get<{ deleted?: boolean }>("fixtures", "fa-1"))?.deleted === true, "handoff assemblies: deleting an in-memory fa- record leaves a marker, so the settings copy stays gone");
  const un3 = await mk({ settings: { fixtureAssemblies: legacy }, blobs: {} }, [{ id: "fa-1", label: "Seed row", kind: "fixture", lightEngineSku: "ETC:S4" } as { id: string }]);
  configurePorts({ store: un3, rules: null });
  await refreshPortsFromStore(un3);
  await un3.remove("fixtures", "fa-1");
  ok((await listFixtures(un3)).length === 0 && (await getFixtureLocal(un3, "fa-1")) === null, "handoff assemblies: a deleted seed row is never replaced by the settings copy");
  configurePorts({ store, rules: null });
  await refreshPortsFromStore(store);

  // --- rack defaults ---
  users.setCurrent("u3");
  ok(JSON.stringify(await A.saveRackDefaultsAction({ blankSku: "ETC:YOKE" })) === JSON.stringify({ ok: false, error: "Needs the Create permission." }), "handoff assemblies: saveRackDefaultsAction needs Create");
  users.setCurrent("u1");
  const d1 = await A.saveRackDefaultsAction({ blankSku: " ETC:YOKE ", ventSku: "x".repeat(81), junk: 1 } as never);
  ok(d1.ok && JSON.stringify((d1 as { value: unknown }).value) === '{"blankSku":"ETC:YOKE"}' && JSON.stringify(rackDefaultsNow()) === '{"blankSku":"ETC:YOKE"}', "handoff assemblies: rack defaults are sanitized and stored under `defaults`");
  await A.saveRackDefaultsAction({ ventSku: "ETC:LENS" });
  ok(JSON.stringify(rackDefaultsNow()) === '{"ventSku":"ETC:LENS"}', "handoff assemblies: a save replaces the defaults (a cleared SKU clears)");
  ok((await buildAssemblyBuilderProps(store)).parts.some((h) => h.sku === "ETC:LENS") && (await buildAssemblyBuilderProps(store)).rackDefaults.ventSku === "ETC:LENS", "handoff assemblies: the builder's props carry the defaults and price their SKUs");

  // --- a rack: save, then its sheets ---
  const layout = emptyRackLayout(12);
  layout.placements.push({ id: "RP-1", kind: "device", sku: "AV:AMP", ruStart: 1, ruHeight: 2, face: "front" });
  const rr = await A.saveFixtureAction({ id: null, kind: "rack", label: "Amp rack", description: "", scope: "Audio", lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [{ sku: "ETC:YOKE", qty: 4 }], rack: layout } as FixtureInput);
  ok(rr.ok, `handoff assemblies: a rack with one device and a rack-level part saves (${JSON.stringify(rr)})`);
  const rid = (rr as { id: string }).id;
  const rackRec = (await getFixtureLocal(store, rid))!;
  ok(rackRec.snapshot!.price === 700 + 4 * 20 && rackRec.snapshot!.cost === 400 + 4 * 10, `handoff assemblies: a rack prices its placements and rack-level parts (${JSON.stringify(rackRec.snapshot)})`);
  ok(!(await A.saveFixtureAction({ id: null, kind: "rack", label: "Empty", description: "", scope: "Audio", lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [], rack: emptyRackLayout() } as FixtureInput)).ok,
    "handoff assemblies: an empty rack is refused (sanitizeFixtureInput)");
  const sheets = await loadRackForSheetsLocal(store, rid, fixedNow);
  ok(!!sheets && sheets.rec.id === rid && sheets.lookup("AV:AMP")?.found === true && sheets.lookup("AV:AMP")?.ruHeight === 2 && sheets.dateLabel === "Sep 21, 2026" && sheets.company.name === "Peak Systems Group" && sheets.company.offices.length === 2,
    `handoff assemblies: loadRackForSheetsLocal — the rack, a lookup over its SKUs, the Chicago date, Peak's branding (${sheets?.dateLabel})`);
  ok(JSON.stringify(sheets!.submittal) === JSON.stringify((await import("@/lib/rack/submittal")).rackSubmittal(rackRec, sheets!.lookup)), "handoff assemblies: the submittal is the app's rackSubmittal over that lookup");
  ok((await loadRackForSheetsLocal(store, id1)) === null && (await loadRackForSheetsLocal(store, "SA-NOPE")) === null && (await loadRackForSheetsLocal(store, "")) === null, "handoff assemblies: not a rack / missing / blank id → null (the page's notFound)");
  await A.deleteFixtureAction(rid);
  ok((await loadRackForSheetsLocal(store, rid)) === null, "handoff assemblies: a deleted rack has no sheets");
  ok((await getManyLocal(store, ["OLD:LENS", "ETC:LENS", "NOPE"])).map((p) => p.sku).join() === "ETC:LENS", "handoff assemblies: getManyLocal follows renames, dedupes, drops unknown SKUs");

  // --- registrations: the datasheet toggle is refused; every export of the original is registered ---
  ok(JSON.stringify(await (refusedAssembliesActions().setOwnDatasheetAction as () => Promise<unknown>)()) === JSON.stringify(NOT_IN_PROTOTYPE), "handoff assemblies: setOwnDatasheetAction is refused (NOT_IN_PROTOTYPE)");
  const regs = actionRegistrations(store).filter(([k]) => k === ASSEMBLIES_ACTIONS_KEY).flatMap(([, impls]) => Object.keys(impls));
  const want = exportNames(fs.readFileSync(ASSEMBLIES_ACTIONS_KEY, "utf8"));
  ok(want.length === 5 && want.every((n) => regs.includes(n)), `handoff assemblies: all ${want.length} exports of the builder's actions are registered (${regs.join(", ")})`);

  offRefresh();
  configurePorts({ store: null, customers: null, rules: null, team: null });
}

/* ------------------------------------------------------------------ PR 2 Task 10: Estimating Rules */

/** Task 10 — the rules registry (baked), the rules store port, the editors' props and actions, and pricing reading the store. */
export async function handoffRulesChecks(ok: Ok) {
  const Pricing = await import("@/lib/stores/pricing");
  const Registry = await import("../handoff/estimator/runtime/baked/pricing-registry");
  const VenueClasses = await import("@/lib/stores/venue-classes");
  const BakedVenue = await import("../handoff/estimator/runtime/baked/venue-classes");
  const PR = await import("../handoff/estimator/runtime/pricing-rules");
  const RP = await import("../handoff/estimator/runtime/props/rules");
  const RA = await import("../handoff/estimator/runtime/actions/rules-actions");
  const { RULES_PAGES } = await import("../handoff/estimator/runtime/routes");
  const { NOT_IN_PROTOTYPE: NIP } = await import("../handoff/estimator/runtime/actions-registry");
  const { resolveVenueDoctrine } = await import("@/lib/venue-doctrine");

  // --- baking: the bundle's copy of each baked module is the app's own values ---
  const evalBaked = (src: string): Record<string, unknown> => {
    // Evaluated in this realm (a vm context's objects carry another realm's prototypes, which isDeepStrictEqual compares).
    const exportsObj: Record<string, unknown> = {};
    new Function("exportsObj", src.replace(/^export const (\w+) = /gm, "exportsObj.$1 = "))(exportsObj);
    return exportsObj;
  };
  const { isDeepStrictEqual } = await import("node:util");
  const bakedReg = evalBaked(bakedSource(Registry as unknown as Record<string, unknown>));
  ok(isDeepStrictEqual(bakedReg.GROUPS, Pricing.GROUPS) && isDeepStrictEqual(bakedReg.FLAMETEST_RATE_DEFAULTS, Pricing.FLAMETEST_RATE_DEFAULTS) && bakedReg.CATALOG_RATES_BLOB === "catalog_rates" && Object.keys(bakedReg).length === 12,
    "handoff rules: the baked pricing registry IS the app's GROUPS + engine defaults (bakedSource round-trips, 12 exports)");
  const bakedVenue = evalBaked(bakedSource(BakedVenue as unknown as Record<string, unknown>));
  ok(isDeepStrictEqual(bakedVenue.VENUE_CLASSES, VenueClasses.VENUE_CLASSES) && Object.keys(bakedVenue).join() === "VENUE_CLASSES", "handoff rules: the baked venue classes are the original's VENUE_CLASSES");
  const overrideNames = exportNames(fs.readFileSync("handoff/estimator/runtime/baked/venue-classes.ts", "utf8"));
  const controlsImports = /import \{([^}]*)\} from "@\/lib\/stores\/venue-classes"/.exec(fs.readFileSync("src/app/(app)/estimating-rules/controls.tsx", "utf8"))?.[1].split(",").map((x) => x.trim()).filter((x) => x && !x.startsWith("type ")) ?? [];
  ok(APP_OVERRIDES["src/lib/stores/venue-classes.ts"] === "runtime/baked/venue-classes.ts" && BAKED_MODULES.includes("runtime/baked/venue-classes.ts") && controlsImports.length > 0 && controlsImports.every((n) => overrideNames.includes(n)) && overrideNames.every((n) => exportNames(fs.readFileSync("src/lib/stores/venue-classes.ts", "utf8")).includes(n)),
    `handoff rules: the venue-classes override exports every value controls.tsx imports (${controlsImports.join()}), each an export of the original`);
  let bakeThrew = 0;
  for (const bad of [{ f: () => 1 }, { n: NaN }, { u: undefined }, { m: new Map() }]) {
    try {
      bakedSource(bad as Record<string, unknown>);
    } catch {
      bakeThrew++;
    }
  }
  ok(bakeThrew === 4 && bakedSource({ B: [1, "x"], A: { k: null } }) === '// Baked at build time from the app (handoff/estimator/esbuild-plugins.ts bakePlugin) — do not edit.\nexport const A = {"k":null};\nexport const B = [1,"x"];\n',
    "handoff rules: bakedSource — sorted `export const` JSON literals; a function / NaN / undefined / Map refuses");

  // --- a store: parts, an Admin and an Estimator, a Gold company, a labor % that follows a stored install % ---
  const part = (sku: string, over: Record<string, unknown> = {}) => ({ id: sku, sku, desc: `${sku} desc`, category: "Rigging", unit: "ea", cost: 100, list: 180, mfr: "Acme", ...over });
  const catalog = docs([part("ADC:280"), part("ADC:SPL"), part("ADC:CAR"), part("ADC:MC"), part("ADC:END"), part("ADC:BC"), part("ADC:CLAMP", { cost: 12, list: 20 }), { id: "OLD:CAR", sku: "OLD:CAR", renamedTo: "ADC:CAR" }]);
  const team: SeedTeamUser[] = [
    { id: "u1", name: "Ann Admin", roles: ["Admin"], status: "active" },
    { id: "u2", name: "Eve Estimator", roles: ["Estimator"], status: "active" },
  ];
  const cust: SeedCustomers = { ...EMPTY_CUSTOMERS, companies: [{ id: "co-g", name: "Gold Co", pricingTier: "gold" }] };
  const rulesSeed: SeedRules = { settings: { companyName: "Peak Systems Group" }, blobs: { pricing_rules: { "system.installPct": 15 }, fixtures_convert: { convertedAt: 1 } } };
  const store = await openStore(storeSeedFrom({ estimates: [], catalog: catalog as never, fixtures: [], rules: rulesSeed, meta: null }), { idb: null });
  configurePorts({ store, customers: cust, rules: null, team });
  users.setCurrent("u1");
  let refreshes = 0;
  const offRefresh = onRefresh(() => void refreshes++);
  await refreshPortsFromStore(store);

  // --- pricing-rules: value / defaultOf / setValue / resetValue / resetAll / exports ---
  ok((await PR.value(store, "tiers.gold")) === 25 && (await PR.defaultOf(store, "tiers.gold")) === 25 && (await PR.value(store, "nope")) === null && (await PR.value(store, "system.rollup")) === null,
    "handoff rules: a general rate reads its registry default; an unknown id or a formula → null");
  ok((await PR.value(store, "labor.audio.pct")) === 15 && (await PR.defaultOf(store, "labor.audio.pct")) === 15, "handoff rules: an unset labor % follows the stored install % (#232) — value and default 15");
  ok((await PR.value(store, "catalog.defaultMargin")) === 43 && (await PR.value(store, "fixture.mountCclamp")) === 18, "handoff rules: engine rates read their engine defaults (a pctStored fraction shown as a percent)");
  await PR.setValue(store, "tiers.gold", 999);
  ok((await PR.value(store, "tiers.gold")) === 150, "handoff rules: setValue clamps to the rate's max (999 → 150, the markup slider's top, #367)");
  await PR.setValue(store, "catalog.defaultMargin", "35");
  const catBlob = (await store.get<{ data: Record<string, number> }>("blobs", "catalog_rates"))?.data;
  ok(catBlob?.defaultMargin === 0.35 && (await PR.value(store, "catalog.defaultMargin")) === 35, "handoff rules: a pctStored engine rate stores a fraction in its own blob (35 → catalog_rates.defaultMargin 0.35)");
  await PR.setValue(store, "labor.audio.pct", 22);
  await PR.resetValue(store, "labor.audio.pct");
  ok((await store.get<{ data: Record<string, unknown> }>("blobs", "pricing_rules"))?.data["labor.audio.pct"] === null && (await PR.value(store, "labor.audio.pct")) === 15, "handoff rules: resetValue on a labor % clears it to null — it follows the install % again");
  await PR.resetValue(store, "tiers.gold");
  ok((await store.get<{ data: Record<string, unknown> }>("blobs", "pricing_rules"))?.data["tiers.gold"] === 25, "handoff rules: resetValue on any other rate writes its registry def");
  await Promise.all([PR.setBlobLocal(store, "pricing_rules", { "tiers.silver": 21 }), PR.setBlobLocal(store, "pricing_rules", { "tiers.copper": 26 })]);
  const pr1 = (await store.get<{ data: Record<string, unknown> }>("blobs", "pricing_rules"))?.data ?? {};
  ok(pr1["tiers.silver"] === 21 && pr1["tiers.copper"] === 26 && pr1["system.installPct"] === 15, "handoff rules: two writes to one blob at once keep both keys (setBlob's per-key merge, serialized)");
  const csv = await PR.exportCSV(store);
  const rows = Pricing.GROUPS.reduce((n, g) => n + g.items.length, 0);
  ok(csv.startsWith("Area,Item,Type,Value,Unit,Detail\n") && csv.trim().split("\n").length >= rows + 1 && csv.includes("Customer tiers,Silver markup,Rate,21,%,"),
    `handoff rules: exportCSV — the header, one line per registry row (${rows}), the stored values`);
  const json = JSON.parse(await PR.exportJSON(store, new Date(Date.UTC(2026, 9, 20)))) as { exportedAt: string; version: number; rates: Record<string, number | null> };
  ok(json.version === 1 && json.exportedAt === "2026-10-20T00:00:00.000Z" && json.rates["tiers.silver"] === 21 && json.rates["catalog.defaultMargin"] === 35 && !("system.rollup" in json.rates), "handoff rules: exportJSON — every rate's value, no formulas");
  ok(/^Peak_estimating_rules_\d{8}\.csv$/.test(PR.exportFileName("csv")) && PR.exportFileName("json", new Date(Date.UTC(2026, 0, 5, 18))) === "Peak_estimating_rules_20260105.json", "handoff rules: exportFileName — Peak_estimating_rules_YYYYMMDD.<ext>");
  ok(PR.exportFileName("csv", new Date(Date.UTC(2026, 0, 5, 3))) === "Peak_estimating_rules_20260104.csv" && PR.exportFileName("csv", new Date(Date.UTC(2026, 6, 1, 4, 59))) === "Peak_estimating_rules_20260630.csv",
    "handoff rules B15: exportFileName stamps the America/Chicago day (03:00 UTC Jan 5 is still Jan 4 in Chicago; DST too), whatever the browser's zone");
  await PR.resetAll(store);
  const prAll = (await store.get<{ data: Record<string, unknown> }>("blobs", "pricing_rules"))?.data ?? {};
  const generalIds = Pricing.GROUPS.flatMap((g) => g.items).filter((it) => it.kind === "rate" && it.store === "general").map((it) => it.id);
  ok(generalIds.every((id) => prAll[id] === null) && prAll["system.installPct"] === 15 && JSON.stringify(withoutBasisKeys(((await store.get<{ data: Record<string, unknown> }>("blobs", "catalog_rates"))?.data) ?? {})) === JSON.stringify(Pricing.CATALOG_RATE_DEFAULTS)
    && JSON.stringify(withoutBasisKeys(((await store.get<{ data: Record<string, unknown> }>("blobs", "flametest_rates"))?.data) ?? {})) === JSON.stringify(Pricing.FLAMETEST_RATE_DEFAULTS),
    "handoff rules: resetAll nulls every general rate (the retired install % untouched) and writes each engine blob back to its defaults");

  // --- props ---
  const p1 = await RP.buildRulesProps(store);
  const goldVM = p1.groups.find((g) => g.key === "tiers")?.items.find((it) => it.id === "tiers.gold");
  ok(p1.isAdmin && p1.groups.length === RP.prototypeRuleGroups(Pricing.GROUPS).length && goldVM?.kind === "rate" && goldVM.value === 25 && goldVM.def === 25 && isDeepStrictEqual(p1.venueDoctrine, resolveVenueDoctrine(undefined)),
    "handoff rules: buildRulesProps — every shown group, each rate's value and effective default, the default venue doctrine");
  {
    // final review B18: the service-quote / portal rules are hidden (they never price a system estimate); the estimate's own stay
    const keys = p1.groups.map((g) => g.key);
    const ids = p1.groups.flatMap((g) => g.items.map((it) => it.id));
    ok(!keys.includes("flame") && !keys.includes("repair") && !keys.includes("inspection") && ["system", "tiers", "travel", "portal", "labor", "bonuses"].every((k) => keys.includes(k)),
      `handoff rules B18: flame / repair / inspection groups hidden; system, tiers, travel, freight, labor, bonuses shown (${keys.join(",")})`);
    ok(ids.includes("travel.roadFactor") && ids.includes("travel.mph") && ids.includes("freight.basePct") && !ids.includes("travel.flyThreshold") && !ids.includes("portal.validityDays") && !ids.includes("travel.fly"),
      "handoff rules B18: the drive-distance knobs and freight stay (they price estimates); flights-over-drive and portal knobs go");
    const csv = await PR.exportCSV(store);
    ok(csv.includes("Flame-test pricing,") && csv.includes("Inspection pricing,") && csv.includes("Portal firm quote valid for"), "handoff rules B18: hidden rules are untouched — Export still carries every rate");
  }
  users.setCurrent("u2");
  const locked = await RP.buildRulesProps(store);
  ok(!locked.isAdmin && locked.groups.length === 0 && !(await RP.buildTrackSeriesProps(store)).isAdmin && !(await RP.buildCurtainMountsProps(store)).isAdmin && !(await RP.buildSystemCategoriesProps(store)).isAdmin,
    "handoff rules: a non-admin gets the pages' lock (no groups, no data)");

  // --- actions: permission, validation, writes, refresh ---
  const regs = new Map<string, Record<string, (...a: unknown[]) => unknown>>();
  for (const [file, impls] of actionRegistrations(store)) regs.set(file, { ...(regs.get(file) ?? {}), ...(impls as Record<string, (...a: unknown[]) => unknown>) });
  const call = (file: string, name: string, ...args: unknown[]) => Promise.resolve(regs.get(file)![name](...args));
  ok(JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "setValueAction", "tiers.gold", 25)) === '{"ok":false}' && JSON.stringify(await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", {})) === JSON.stringify({ ok: false, error: RA.NO_PERMISSION }),
    "handoff rules: a non-admin's writes are refused (the refusal each original's type admits)");
  let exportThrew = false;
  try {
    await call(RA.RULES_ACTIONS_KEY, "exportCsvAction");
  } catch (e) {
    exportThrew = e instanceof Error && e.message === RA.NO_PERMISSION;
  }
  ok(exportThrew, "handoff rules: a non-admin export throws (the original's requirePerm), its type has no refusal");
  users.setCurrent("u1");
  const r0 = refreshes;
  ok(JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "setValueAction", "tiers.gold", "25")) === '{"ok":false}' && JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "setValueAction", "tiers.gold", NaN)) === '{"ok":false}' && refreshes === r0,
    "handoff rules: setValueAction refuses a non-number silently and writes nothing");
  ok(JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "setValueAction", "tiers.gold", 25)) === '{"ok":true}' && refreshes === r0 + 1, "handoff rules: setValueAction writes and refreshes");
  ok(JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "resetItemAction", "system.rollup")) === '{"ok":false}' && JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "resetItemAction", "nope")) === '{"ok":false}', "handoff rules: resetItemAction refuses a formula or an unknown id");
  const csvR = (await call(RA.RULES_ACTIONS_KEY, "exportCsvAction")) as { csv: string; name: string };
  const jsonR = (await call(RA.RULES_ACTIONS_KEY, "exportJsonAction")) as { json: string; name: string };
  ok(csvR.csv.includes("Gold markup,Rate,25,%") && csvR.name.endsWith(".csv") && (JSON.parse(jsonR.json) as { rates: Record<string, number> }).rates["tiers.gold"] === 25 && jsonR.name.endsWith(".json"), "handoff rules: the export actions carry the edited rate and their file names");

  // --- the store is what pricing reads: tiers, fixture rates, bonus, freight, sewing ---
  ok(resolveTierFor("co-g").markup === 0.25 && resolveTierFor("co-g").tier === "gold", "handoff rules: after the edit the Gold company resolves at 25 % (ports read the store, refreshed by the action)");
  const newGold = await buildEstimatorProps(store, null, new URLSearchParams("new=1&customer=co-g"));
  ok(newGold.initial.customerId === "co-g" && newGold.initial.pricingTier === "gold" && newGold.initial.tierMargin === 0.25, `handoff rules: a new estimate for the Gold company opens at the edited 25 % (${newGold.initial.tierMargin})`);
  await call(RA.RULES_ACTIONS_KEY, "setValueAction", "fixture.mountCclamp", 21);
  await call(RA.RULES_ACTIONS_KEY, "setValueAction", "bonus.packagePct", 4);
  await call(RA.RULES_ACTIONS_KEY, "setValueAction", "freight.basePct", 6);
  await call(RA.RULES_ACTIONS_KEY, "setValueAction", "curtains.sewingPct", 12);
  const edited = await buildEstimatorProps(store, null, new URLSearchParams("new=1"));
  ok(edited.fixtureRates.mountCclamp === 21 && edited.bonusRates?.packagePct === 0.04 && edited.freightRule.basePct === 6 && edited.curtainSewingPct === 12 && edited.initial.tierMargin === 0.43,
    `handoff rules: the Estimator's props read the edited fixture rate, bonus, freight and sewing from the store (${JSON.stringify({ c: edited.fixtureRates.mountCclamp, b: edited.bonusRates, f: edited.freightRule.basePct, s: edited.curtainSewingPct })})`);
  ok(JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "resetAllAction")) === '{"ok":true}' && resolveTierFor("co-g").markup === 0.25 && (await buildEstimatorProps(store, null, new URLSearchParams("new=1"))).fixtureRates.mountCclamp === 18,
    "handoff rules: resetAllAction puts every rate back — Gold 25 %, the fixture rate 18");

  // --- venue doctrine ---
  ok(JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "saveVenueDoctrineAction", "arena", { curtains: "", lighting: "", confirmed: true })) === '{"ok":false}'
    && JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "saveVenueDoctrineAction", "theatre", { curtains: 1, lighting: "", confirmed: true })) === '{"ok":false}', "handoff rules: saveVenueDoctrineAction refuses an unknown class or a malformed entry");
  ok(JSON.stringify(await call(RA.RULES_ACTIONS_KEY, "saveVenueDoctrineAction", "theatre", { curtains: "  Velour  " + "x".repeat(600), lighting: "Ion", confirmed: false })) === '{"ok":true}', "handoff rules: saveVenueDoctrineAction saves a valid entry");
  const vd = (await RP.buildRulesProps(store)).venueDoctrine;
  ok(vd.theatre.curtains.startsWith("Velour") && vd.theatre.curtains.length === 500 && vd.theatre.lighting === "Ion" && !vd.theatre.confirmed && isDeepStrictEqual(vd.gym, resolveVenueDoctrine(undefined).gym),
    "handoff rules: the doctrine entry is trimmed to 500 and stored on the settings row; the other classes keep their defaults");

  // --- track series ---
  const seriesIn = (over: Record<string, unknown> = {}) => ({ name: "ADC 280", manufacturer: "ADC", sticks: [{ lengthFt: "16", sku: "ADC:280" }], carrierSpacingIn: "12", hangerSpacingFt: "5", overlapFt: "0",
    parts: { splice: { sku: "ADC:SPL" }, carrier: { sku: "OLD:CAR" }, masterCarrier: { sku: "ADC:MC" }, endStop: { sku: "ADC:END" }, battenClamp: { sku: "ADC:BC" } }, ...over });
  const notLive = (await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", { ...seriesIn(), active: true })) as { ok: boolean; error?: string };
  ok(!notLive.ok && /Can't mark it active yet: .*Carrier/.test(notLive.error ?? ""), `handoff rules: Active is refused while a mapped SKU isn't live (a renamed one counts as unmapped): ${notLive.error}`);
  const made = (await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", { ...seriesIn({ parts: { ...seriesIn().parts, carrier: { sku: "ADC:CAR" } } }), active: true })) as { ok: boolean; id: string };
  const ts1 = (await RP.buildTrackSeriesProps(store)).series.find((s) => s.id === made.id);
  ok(made.ok && made.id === "adc-280" && !!ts1?.active && ts1.updatedBy === "Ann Admin" && ts1.stickLengthFt === 16, `handoff rules: a new series gets an id from its name, saves active and stamped (${made.id})`);
  ok(!((await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", seriesIn({ name: "adc 280" }))) as { ok: boolean }).ok
    && ((await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", seriesIn({ id: "gone-1" }))) as { error?: string }).error === "This series no longer exists — reload the page."
    && ((await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", { name: "" })) as { error?: string }).error === "Give the series a name.",
    "handoff rules: a duplicate name (any case), a vanished id and a blank name are refused");
  const upd = (await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", { ...seriesIn({ id: made.id, sticks: [{ lengthFt: 20, sku: "ADC:280" }], parts: { ...seriesIn().parts, carrier: { sku: "ADC:CAR" } } }), active: true })) as { ok: boolean };
  const estTrack = (await buildEstimatorProps(store, null, new URLSearchParams("new=1"))).trackSeries.find((s) => s.id === made.id);
  ok(upd.ok && estTrack?.stickLengthFt === 20 && estTrack.sticks?.[0].lengthFt === 20 && !!(await buildEstimatorProps(store, null, new URLSearchParams("new=1"))).trackParts["ADC:280"],
    "handoff rules: a stick length edit (16 → 20) is what the Estimator's track configurator reads next (props.trackSeries / trackParts)");
  const tp = await RP.buildTrackSeriesProps(store);
  ok(Object.keys(tp.parts).sort().join() === "ADC:280,ADC:BC,ADC:CAR,ADC:END,ADC:MC,ADC:SPL" && tp.parts["ADC:280"].desc === "ADC:280 desc", "handoff rules: the track series page reads only the series' SKUs");
  ok(JSON.stringify(await call(RA.TRACK_SERIES_ACTIONS_KEY, "deleteTrackSeriesAction", made.id)) === '{"ok":true}' && ((await store.get<{ data: Record<string, unknown> }>("blobs", "track_series"))?.data[made.id] === null)
    && ((await call(RA.TRACK_SERIES_ACTIONS_KEY, "deleteTrackSeriesAction", made.id)) as { error?: string }).error === "This series no longer exists.",
    "handoff rules: delete writes { id: null } (the key stays); a second delete is refused");
  const again = (await call(RA.TRACK_SERIES_ACTIONS_KEY, "saveTrackSeriesAction", seriesIn())) as { ok: boolean; id: string };
  ok(again.ok && again.id !== made.id && again.id.startsWith("adc-280"), `handoff rules: a deleted series' id is never handed out again (${again.id})`);

  // --- curtain mounts ---
  ok(((await call(RA.CURTAIN_MOUNTS_ACTIONS_KEY, "saveCurtainMountAction", "nope", [])) as { error?: string }).error === "Unknown mount type.", "handoff rules: an unknown mount type is refused");
  const { CURTAIN_MOUNT_TYPES } = await import("@/lib/curtain-cut-sheets/vocab");
  const mountId = CURTAIN_MOUNT_TYPES[0].id;
  ok(((await call(RA.CURTAIN_MOUNTS_ACTIONS_KEY, "saveCurtainMountAction", mountId, [{ sku: "NOPE:1", rule: { kind: "perCurtain", qty: 2 } }])) as { error?: string }).error === "Not in the catalog: NOPE:1.", "handoff rules: a SKU missing from the catalog is refused by name");
  ok(JSON.stringify(await call(RA.CURTAIN_MOUNTS_ACTIONS_KEY, "saveCurtainMountAction", mountId, [{ sku: "ADC:CLAMP", rule: { kind: "perCurtain", qty: "2" } }])) === '{"ok":true}', "handoff rules: a valid mount saves");
  const cm = await RP.buildCurtainMountsProps(store);
  ok(cm.mounts[mountId]?.rows[0].sku === "ADC:CLAMP" && cm.mounts[mountId]?.updatedBy === "Ann Admin" && cm.parts["ADC:CLAMP"].cost === 12, "handoff rules: the mount reads back with its part's live facts");

  // --- system categories ---
  const sc0 = await RP.buildSystemCategoriesProps(store);
  ok(sc0.categories.length === 7 && sc0.categories.every((c) => c.items.length === 0), "handoff rules: never saved → the seven default categories, no parts");
  const withPart = sc0.categories.map((c, i) => (i === 0 ? { ...c, items: [{ sku: "OLD:CAR", qty: 2 }] } : c));
  const scR = (await call(RA.SYSTEM_CATEGORIES_ACTIONS_KEY, "saveSystemCategoriesAction", withPart)) as { ok: boolean; categories: Array<{ items: Array<{ sku: string }> }> };
  const sc1 = await RP.buildSystemCategoriesProps(store);
  ok(scR.ok && scR.categories[0].items[0].sku === "OLD:CAR" && sc1.parts["OLD:CAR"]?.sku === "ADC:CAR", "handoff rules: categories save; a renamed SKU resolves to its live part (getManyBySku)");
  ok((await buildEstimatorProps(store, null, new URLSearchParams("new=1"))).initial.systemCategories[0].items[0].part?.sku === "ADC:CAR", "handoff rules: the Estimator's + Add system reads the saved typical parts");
  const hits = (await call(RA.SYSTEM_CATEGORIES_ACTIONS_KEY, "searchCategoryPartsAction", "adc")) as { hits: Array<Record<string, unknown>>; total: number };
  const eq = (await call(RA.GRID_SETTINGS_ACTIONS_KEY, "searchEquipmentPartsAction", "adc")) as { hits: unknown[]; total: number };
  ok(hits.total === 7 && hits.hits.length === 7 && Object.keys(hits.hits[0]).sort().join() === "category,cost,desc,list,sku,unit" && isDeepStrictEqual(eq, hits), "handoff rules: the part pickers search the catalog (EquipPartHit shape; the PartPicker's default search answers the same)");

  // --- the Grid settings / conduit registrations ---
  ok(JSON.stringify(await call(RA.GRID_SETTINGS_ACTIONS_KEY, "saveEquipmentRowAction", "x", {})) === JSON.stringify(NIP) && JSON.stringify(await call(RA.GRID_SETTINGS_ACTIONS_KEY, "saveWireTypesAction", [])) === JSON.stringify(NIP)
    && JSON.stringify(await call(RA.GRID_SETTINGS_ACTIONS_KEY, "saveRiserBoxTypesAction", [])) === JSON.stringify({ ...NIP, errors: [] }) && (await call(RA.GRID_SETTINGS_ACTIONS_KEY, "saveDeviceTypeIconsAction", {})) === undefined
    && JSON.stringify(await call(RA.GRID_SETTINGS_ACTIONS_KEY, "suggestEquipmentPartsAction", "x")) === '{"hits":[]}'
    && JSON.stringify(await call(RA.CONDUIT_SIZES_ACTIONS_KEY, "saveConduitSizesAction", [])) === JSON.stringify(NIP) && JSON.stringify(await call(RA.CONDUIT_SIZES_ACTIONS_KEY, "searchConduitPartsAction", "emt")) === '{"hits":[],"total":0}',
    "handoff rules: the Grid's own settings writers and Conduit sizes are refused (NOT_IN_PROTOTYPE / the richer refusal / void); their searches answer empty");
  const ruleFiles = [RA.RULES_ACTIONS_KEY, RA.TRACK_SERIES_ACTIONS_KEY, RA.CURTAIN_MOUNTS_ACTIONS_KEY, RA.SYSTEM_CATEGORIES_ACTIONS_KEY, RA.CONDUIT_SIZES_ACTIONS_KEY, RA.GRID_SETTINGS_ACTIONS_KEY];
  const gaps = ruleFiles.flatMap((f) => exportNames(fs.readFileSync(f, "utf8")).filter((n) => !(n in (regs.get(f) ?? {}))).map((n) => `${f}#${n}`));
  ok(gaps.length === 0 && ruleFiles.every((f) => regs.has(f)), `handoff rules: every export of the six rules / Grid-settings / conduit action modules is registered (missing: ${gaps.join(", ") || "none"})`);

  // --- routes ---
  ok(RULES_PAGES.every((p) => { const r = parseRoute(`#/rules/${p}`, ""); return r.name === "rules-page" && r.page === p && routeHash(r) === `#/rules/${p}` && routeSearch(r) === ""; }), "handoff rules: #/rules/<page> is each sub-page's route");
  ok(parseRoute("#/rules/conduit-sizes", "").name === "unknown" && parseRoute("#/rules/x/y", "").name === "unknown" && parseRoute("#/rules", "").name === "rules", "handoff rules: Conduit sizes and deeper paths are not routes; #/rules stays the editor");
  ok(sameRoute({ name: "rules-page", page: "track-series" }, { name: "rules-page", page: "track-series" }) && !sameRoute({ name: "rules-page", page: "track-series" }, { name: "rules-page", page: "curtain-mounts" }) && !sameRoute({ name: "rules-page", page: "track-series" }, { name: "rules" }),
    "handoff rules: sameRoute compares the sub-page");
  const ts = mapAppHref("/estimating-rules/track-series", { name: "estimate", id: "Q-1" });
  ok(ts.kind === "route" && ts.route.name === "rules-page" && mapAppHref("/estimating-rules/conduit-sizes", { name: "rules" }).kind === "unsupported" && mapAppHref("/estimating-rules", { name: "rules-page", page: "track-series" }).kind === "route",
    "handoff rules: the Rules cards and the Estimator's “Estimating Rules → Track series” link map to the sub-page; Conduit sizes → the notice; ← Estimating rules → #/rules");
  ok(newTabHref(ts, { href: "file:///p/index.html?v=1#/rules", search: "?v=1", hash: "#/rules" }) === "file:///p/index.html?v=1#/rules/track-series", "handoff rules: a modified click on a card opens the sub-page in a new tab");

  offRefresh();
  configurePorts({ store: null, customers: null, rules: null, team: null });
}
