/**
 * #343 — read-modify-write races on settings and settings-style blobs.
 * Standalone: `npm run test:settings-race`; also chained into test:specs.
 *
 * Every converted writer is run N times concurrently on DIFFERENT entries of
 * the same map / list: all N must persist, and no other key may change. On
 * dev PGlite there is one connection, so these prove the lock-and-merge
 * semantics and that concurrent callers serialize correctly — not true
 * multi-connection Postgres concurrency (postgres-js in production).
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, blobs } from "@/db/schema";
import { DOC_TABLES } from "@/db/doc-tables";
import { getBlob, setBlob, updateBlob, upsertDoc, type Doc } from "@/db/doc-store";
import {
  getSettingsPatchStrict,
  removeOffice,
  setDefaultQuoteOffice,
  setPriceListEffective,
  setSettings,
  setVenueDoctrineEntry,
  settingsFrom,
  updateSettings,
  upsertOffice,
  writeTemplateOverrides,
  type Office,
} from "@/lib/settings";
import { resolveVenueDoctrine } from "@/lib/venue-doctrine";
import { carryPriceDates, renameStoredWireTypes, sweepBlob } from "@/lib/catalog-rename/apply";
import { linkStoredWireTypes } from "@/lib/design/wire-starter-server";
import { rebaseArchivePatch, saveArchiveSettings } from "@/lib/krisp/archive";
import { revokeGrant, touchGrantSeen } from "@/lib/portal";
import { removeDesign, saveDesign, getDesign } from "@/lib/stores/studio-designs";
import { addWindow, getVenueCalendar, importCsvWindows, removeWindow } from "@/lib/stores/venue-calendars";
import { getDeviceTypes, getGridFavorites, getGridRecent, mergeDeviceType, pushGridRecent, saveDeviceTypes, setDeviceTypeIcons, setDeviceTypeSymbol, toggleGridFavorite } from "@/lib/stores/device-types";
import { saveDocumentCategoriesLocked, saveSurveyTagsLocked, saveVenueTypesLocked } from "@/lib/settings-lists";
import { resolveSurveyTags } from "@/lib/survey-tags";
import { venueTypesFrom } from "@/lib/venue-types";
import { resolveDocumentCategories } from "@/lib/document-categories";
import { DEVICE_TYPES_BLOB, TYPE_MAP_BLOB, favoritesBlobId, recentBlobId } from "@/lib/design/device-types";
import { addSenderRule, appendFilingLogs, getFilingLog, getSenderRules, removeSenderRule, FILING_LOG_BLOB, SENDER_RULES_BLOB, type FilingLogEntry } from "@/lib/stores/inbox-org";
import { allSkuRenames, appendSkuRenames, SKU_RENAMES_BLOB } from "@/lib/stores/catalog-renames";
import { DISMISSED_BLOB_ID, dismissedQuoteIds, removeProject } from "@/lib/stores/projects";
import { getRates as getFlameRates, setRates as setFlameRates } from "@/lib/flametest-engine";
import { listIntros, upsertIntro } from "@/lib/stores/narrative-intros";
import { getSuggestion, linkSuggestionToQuote, quoteIndexBlobId, saveSuggestion, sourceIndexBlobId, suggestionBlobId } from "@/lib/stores/estimate-suggestions";
import { newSuggestionId, type EstimateSuggestion } from "@/lib/assist/features/suggestion";

export type Ok = (cond: boolean, msg: string) => void;

const N = 8;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const json = (v: unknown) => JSON.stringify(v);

/** Snapshot the settings row, run `fn`, put the row back exactly. */
async function withSettingsRestored(fn: () => Promise<void>): Promise<void> {
  const db = await getDb();
  const [before] = await db.select().from(appSettings).where(eq(appSettings.id, "main")).limit(1);
  try {
    await fn();
  } finally {
    await db.delete(appSettings).where(eq(appSettings.id, "main"));
    if (before) await db.insert(appSettings).values(before);
  }
}

/** Snapshot the named blob rows, run `fn`, put them back exactly (absent ones deleted). */
async function withBlobsRestored(ids: string[], fn: () => Promise<void>): Promise<void> {
  const db = await getDb();
  const before = ids.length ? await db.select().from(blobs).where(inArray(blobs.id, ids)) : [];
  try {
    await fn();
  } finally {
    if (ids.length) await db.delete(blobs).where(inArray(blobs.id, ids));
    if (before.length) await db.insert(blobs).values(before);
  }
}

async function settingsRow() {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, "main")).limit(1);
  return row;
}

async function blobRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(blobs).where(eq(blobs.id, id)).limit(1);
  return row;
}

/* ------------------------------------------------------------------ */
/* The helpers themselves                                               */
/* ------------------------------------------------------------------ */

export async function settingsRaceHelperChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  await withSettingsRestored(async () => {
    // Empty table, null patch: no row is created.
    await db.delete(appSettings).where(eq(appSettings.id, "main"));
    const r0 = await updateSettings(() => null);
    ok(json(r0) === "{}" && !(await settingsRow()), "updateSettings: a null patch on an empty table writes nothing (no row)");
    // Empty table: the first insert works, and the patch lands.
    const r1 = await updateSettings((cur) => ({ t343First: Object.keys(cur).length }));
    ok(r1.t343First === 0 && (await getSettingsPatchStrict()).t343First === 0, "updateSettings: the first insert on an empty table creates the row with the patch");
    // Concurrent first writers on an empty table: one inserts, the rest wait and merge.
    await db.delete(appSettings).where(eq(appSettings.id, "main"));
    await Promise.all(range(N).map((i) => updateSettings(() => ({ [`t343Init${i}`]: i }))));
    const init = await getSettingsPatchStrict();
    ok(range(N).every((i) => init[`t343Init${i}`] === i), `updateSettings: ${N} concurrent first writers on an empty table all persist`);

    // Null patch on an existing row: data and updatedAt untouched.
    await setSettings({ t343Keep: "k" });
    const before = await settingsRow();
    const r2 = await updateSettings(() => null);
    const after = await settingsRow();
    ok(json(after?.data) === json(before?.data) && after?.updatedAt === before?.updatedAt && r2.t343Keep === "k", "updateSettings: a null patch writes nothing (data and updatedAt unchanged) and returns the stored patch");

    // Same merge as setSettings: replace per key, undefined deletes.
    await setSettings({ t343Drop: 1, t343Obj: { a: 1 } });
    await updateSettings(() => ({ t343Drop: undefined, t343Obj: { b: 2 } }));
    const m = await getSettingsPatchStrict();
    ok(!("t343Drop" in m) && json(m.t343Obj) === '{"b":2}' && m.t343Keep === "k", "updateSettings: a patch key replaces the stored value, undefined removes it, other keys stay");

    // Serialization: N read-increment-write calls never lose an increment.
    await setSettings({ t343Count: 0 });
    await Promise.all(range(N).map(() => updateSettings((cur) => ({ t343Count: Number(cur.t343Count) + 1 }))));
    ok((await getSettingsPatchStrict()).t343Count === N, `updateSettings: ${N} concurrent read-increment-writes all count (no lost update)`);

    // Joins an outer transaction (no deadlock on PGlite's single connection).
    const { withTransaction } = await import("@/db");
    await withTransaction(async () => {
      await updateSettings(() => ({ t343InTx: 1 }));
      await updateSettings((cur) => ({ t343InTx: Number(cur.t343InTx) + 1 }));
    });
    ok((await getSettingsPatchStrict()).t343InTx === 2, "updateSettings: nested inside withTransaction joins it");
  });

  const B = "TEST343:blob";
  await withBlobsRestored([B], async () => {
    await db.delete(blobs).where(eq(blobs.id, B));
    await updateBlob(B, () => null);
    ok(!(await blobRow(B)), "updateBlob: a null patch on a missing blob writes nothing (no row)");
    await Promise.all(range(N).map((i) => updateBlob(B, () => ({ [`k${i}`]: i }))));
    const g = await getBlob<Record<string, unknown>>(B, {});
    ok(range(N).every((i) => g[`k${i}`] === i), `updateBlob: ${N} concurrent first writers on a missing blob all persist`);
    const before = await blobRow(B);
    await updateBlob(B, () => null);
    const after = await blobRow(B);
    ok(json(after?.data) === json(before?.data) && after?.updatedAt === before?.updatedAt, "updateBlob: a null patch writes nothing (data and updatedAt unchanged)");
    await setBlob(B, { list: [] as number[] });
    await Promise.all(range(N).map((i) => updateBlob(B, (raw) => ({ list: [...((raw.list as number[]) || []), i] }))));
    const l = (await getBlob<{ list: number[] }>(B, { list: [] })).list;
    ok(l.length === N && range(N).every((i) => l.includes(i)), `updateBlob: ${N} concurrent appends to one list all persist`);
    await updateBlob(B, () => ({ k0: undefined, k1: null }));
    const u = await getBlob<Record<string, unknown>>(B, {});
    ok(u.k0 === 0 && u.k1 === null && u.k2 === 2, "updateBlob: setBlob semantics — undefined is skipped, null is stored");
  });
}

/* ------------------------------------------------------------------ */
/* Settings callers                                                      */
/* ------------------------------------------------------------------ */

export async function settingsRaceCallerChecks(ok: Ok): Promise<void> {
  await withSettingsRestored(async () => {
    await setSettings({ t343Sentinel: { s: 1 }, priceListEffective: { t343pre: 1 } });
    const sentinel = async () => json((await getSettingsPatchStrict()).t343Sentinel) === '{"s":1}';

    /* setPriceListEffective */
    const ret = await Promise.all(range(N).map((i) => setPriceListEffective(`t343mfr${i}`, 1000 + i)));
    const ple = (await getSettingsPatchStrict()).priceListEffective as Record<string, number>;
    ok(range(N).every((i) => ple[`t343mfr${i}`] === 1000 + i) && ple.t343pre === 1, `setPriceListEffective: ${N} concurrent manufacturers' dates all persist`);
    ok(await sentinel(), "setPriceListEffective: no other settings key changes");
    ok(ret.every((m, i) => m[`t343mfr${i}`] === 1000 + i && m.t343pre === 1), "setPriceListEffective: each call returns the full map after its write");
    const cleared = await Promise.all([setPriceListEffective("t343mfr0", null), setPriceListEffective("t343mfr1", null)]);
    const ple2 = (await getSettingsPatchStrict()).priceListEffective as Record<string, number>;
    ok(!("t343mfr0" in ple2) && !("t343mfr1" in ple2) && ple2.t343mfr2 === 1002 && !("t343mfr0" in cleared[0]), "setPriceListEffective: concurrent clears both land, the rest stay");
    const noop = await setPriceListEffective("", 5);
    ok(noop.t343mfr2 === 1002 && !("" in noop), "setPriceListEffective: an empty key is a no-op that returns the map");

    /* carryPriceDates (catalog-rename #313) */
    await setPriceListEffective("t343oldmfr", 777);
    await setPriceListEffective("t343keptmfr", 5);
    await Promise.all([
      carryPriceDates([{ fromMfr: "T343 Old Mfr", mfr: "T343 New Mfr" }, { fromMfr: "T343 Old Mfr", mfr: "T343 Kept Mfr" }]),
      setPriceListEffective("t343othermfr", 42),
    ]);
    const ple3 = (await getSettingsPatchStrict()).priceListEffective as Record<string, number>;
    ok(ple3.t343newmfr === 777 && ple3.t343othermfr === 42, "carryPriceDates: carries the date and a concurrent date set both persist");
    ok(ple3.t343keptmfr === 5, "carryPriceDates: never overwrites an existing date (checked under the lock)");

    /* offices */
    await setSettings({ offices: [] });
    const office = (i: number): Office => ({ id: `t343of${i}`, type: "Main Office", name: `Office ${i}`, street: "", city: "", state: "", zip: "", phone: "", lat: null, lng: null, timezone: "America/Chicago" });
    await Promise.all(range(N).map((i) => upsertOffice(office(i), true)));
    let offices = settingsFrom(await getSettingsPatchStrict()).offices;
    ok(offices.length === N && range(N).every((i) => offices.some((o) => o.id === `t343of${i}`)), `upsertOffice: ${N} concurrent new locations all persist`);
    ok(offices.filter((o) => o.quoteDefault).length === 1, "upsertOffice: exactly one becomes the quote default (decided under the lock)");
    await Promise.all([
      upsertOffice({ ...office(2), name: "Renamed 2" }, false),
      upsertOffice({ ...office(3), name: "Renamed 3" }, false),
      removeOffice("t343of4"),
      removeOffice("t343of5"),
      setDefaultQuoteOffice("t343of6"),
    ]);
    offices = settingsFrom(await getSettingsPatchStrict()).offices;
    ok(offices.length === N - 2 && !offices.some((o) => o.id === "t343of4" || o.id === "t343of5"), "removeOffice: concurrent removals of different locations both land");
    ok(offices.find((o) => o.id === "t343of2")?.name === "Renamed 2" && offices.find((o) => o.id === "t343of3")?.name === "Renamed 3", "upsertOffice: concurrent edits of different locations both persist");
    ok(offices.filter((o) => o.quoteDefault).map((o) => o.id).join() === "t343of6", "setDefaultQuoteOffice: lands alongside concurrent edits; one default");
    ok(await sentinel(), "offices: no other settings key changes");
    const before = json(await getSettingsPatchStrict());
    ok((await setDefaultQuoteOffice("t343nope")) === false && json(await getSettingsPatchStrict()) === before, "setDefaultQuoteOffice: an unknown id returns false and writes nothing");
    await setSettings({ offices: [{ ...office(9), quoteDefault: true }, office(10)] });
    await removeOffice("t343of9");
    ok(settingsFrom(await getSettingsPatchStrict()).offices[0]?.quoteDefault === true, "removeOffice: removing the default makes the first remaining one the default");

    /* templates */
    const ids = ["flame_proposal", "consulting_proposal", "inspection_proposal", "repairs_proposal"];
    await Promise.all(ids.map((id, i) => writeTemplateOverrides({ [id]: { f: `v${i}` } }, { by: `u${i}`, at: 100 + i })));
    let s = settingsFrom(await getSettingsPatchStrict());
    ok(ids.every((id, i) => s.templates?.[id]?.f === `v${i}` && s.templatesMeta?.[id]?.by === `u${i}`), `writeTemplateOverrides: ${ids.length} concurrent template saves all persist (with their meta)`);
    await Promise.all([
      writeTemplateOverrides({ flame_proposal: null }, { by: "r", at: 200 }),
      writeTemplateOverrides({ consulting_proposal: {} }, { by: "r2", at: 201 }),
      writeTemplateOverrides({ inspection_proposal: { f: "new" }, repairs_proposal: { f: "new2" } }, { by: "imp", at: 202 }),
    ]);
    s = settingsFrom(await getSettingsPatchStrict());
    ok(!s.templates?.flame_proposal && !s.templates?.consulting_proposal && s.templates?.inspection_proposal?.f === "new" && s.templates?.repairs_proposal?.f === "new2", "writeTemplateOverrides: a reset, an empty save and an import landing together all apply");
    ok(s.templatesMeta?.flame_proposal?.by === "r" && s.templatesMeta?.consulting_proposal?.at === 201 && s.templatesMeta?.repairs_proposal?.by === "imp", "writeTemplateOverrides: every touched template is stamped");
    ok(await sentinel(), "templates: no other settings key changes");

    /* venue doctrine */
    const classes = ["theatre", "auditorium", "church"] as const;
    await Promise.all(classes.map((c, i) => setVenueDoctrineEntry(c, { curtains: `c${i}`, lighting: `l${i}`, confirmed: true })));
    const vd = resolveVenueDoctrine(settingsFrom(await getSettingsPatchStrict()).venueDoctrine);
    ok(classes.every((c, i) => vd[c].curtains === `c${i}` && vd[c].lighting === `l${i}` && vd[c].confirmed), `setVenueDoctrineEntry: ${classes.length} concurrent venue classes all persist`);
    ok(await sentinel(), "venue doctrine: no other settings key changes");

    /* wire types — catalog rename + starter linking */
    await setSettings({ wireTypes: [{ id: "t343w", label: "T343", connectionTypes: [], cableSku: "T343-OLD" }] });
    const [rewrote] = await Promise.all([renameStoredWireTypes(new Map([["T343-OLD", "T343-NEW"]])), setPriceListEffective("t343wire", 9)]);
    const wt = (await getSettingsPatchStrict()).wireTypes as Array<{ id: string; cableSku?: string }>;
    ok(rewrote && wt.find((w) => w.id === "t343w")?.cableSku === "T343-NEW" && ((await getSettingsPatchStrict()).priceListEffective as Record<string, number>).t343wire === 9, "renameStoredWireTypes: the rename and a concurrent settings write both persist");
    ok((await renameStoredWireTypes(new Map([["T343-NONE", "X"]]))) === false, "renameStoredWireTypes: nothing to rename → false, nothing written");
    await setSettings({ wireTypes: undefined });
    const [linked] = await Promise.all([
      linkStoredWireTypes((x) => x, [{ wireTypeId: "cat6", cableSku: "T343-CAT6", symbol: "N", signal: "Network" }]),
      setPriceListEffective("t343link", 11),
    ]);
    const wt2 = (await getSettingsPatchStrict()).wireTypes as Array<{ id: string; cableSku?: string }> | undefined;
    ok(linked > 0 && !!wt2?.some((w) => w.id === "cat6" && w.cableSku === "T343-CAT6") && ((await getSettingsPatchStrict()).priceListEffective as Record<string, number>).t343link === 11, "linkStoredWireTypes: links onto the stored list and a concurrent settings write both persist");
    ok((await linkStoredWireTypes((x) => x, [{ wireTypeId: "cat6", cableSku: "T343-OTHER", symbol: "N", signal: "Network" }])) === 0, "linkStoredWireTypes: an already-linked type is left alone (0, nothing written)");
    ok(await sentinel(), "wire types: no other settings key changes");

    /* krisp archive folder cache */
    await setSettings({ recordingsArchiveMailbox: "t343mb", recordingsArchiveFolders: { a: "A" }, recordingsArchiveFolderId: "root" });
    const basis = { mailbox: "t343mb", folders: { a: "A" } };
    await Promise.all(
      range(N).map((i) => saveArchiveSettings({ recordingsArchiveFolders: { a: "A", [`c${i}`]: `C${i}` }, recordingsArchiveLastRun: { at: i, archived: 1, failed: 0, skipped: null } }, basis))
    );
    let f = (await getSettingsPatchStrict()).recordingsArchiveFolders as Record<string, string>;
    ok(f.a === "A" && range(N).every((i) => f[`c${i}`] === `C${i}`), `saveArchiveSettings: ${N} concurrent passes' new folders all persist`);
    await saveArchiveSettings({ recordingsArchiveFolders: { c0: "C0" }, recordingsArchiveFolderId: "" }, { mailbox: "t343mb", folders: { a: "A", c0: "C0" } });
    f = (await getSettingsPatchStrict()).recordingsArchiveFolders as Record<string, string>;
    ok(!("a" in f) && f.c0 === "C0" && f.c1 === "C1", "saveArchiveSettings: a folder the pass dropped (404) is removed, others' folders stay");
    await setSettings({ recordingsArchiveMailbox: "t343mb2", recordingsArchiveFolders: {}, recordingsArchiveFolderId: null });
    await saveArchiveSettings({ recordingsArchiveFolders: { a: "A", z: "Z" }, recordingsArchiveFolderId: "oldroot", recordingsArchiveLastRun: { at: 99, archived: 0, failed: 0, skipped: null } }, basis);
    const ar = await getSettingsPatchStrict();
    ok(json(ar.recordingsArchiveFolders) === "{}" && ar.recordingsArchiveFolderId === null && (ar.recordingsArchiveLastRun as { at: number }).at === 99, "saveArchiveSettings: the mailbox changed mid-pass → the old Drive's cache is not written back; the last run still lands");
    ok(json(rebaseArchivePatch({}, { recordingsArchiveLastRun: 1 }, basis)) === '{"recordingsArchiveLastRun":1}' && json(rebaseArchivePatch({}, { recordingsArchiveFolders: { x: "X" } }, undefined)) === '{"recordingsArchiveFolders":{"x":"X"}}', "rebaseArchivePatch: no cache keys / no basis → the patch as given");
    ok(await sentinel(), "archive: no other settings key changes");
  });
}

/* ------------------------------------------------------------------ */
/* Blob callers                                                          */
/* ------------------------------------------------------------------ */

export async function settingsRaceBlobChecks(ok: Ok): Promise<void> {
  const db = await getDb();

  /* portal grants */
  await withBlobsRestored(["portal_grants"], async () => {
    const grant = (id: string) => ({ id, customerId: "TEST343-c", name: id, email: `${id}@x.test`, tokenEnc: "", createdAt: 1, createdBy: "t", expiresAt: Date.now() + 1e9, revokedAt: null, lastSeenAt: null });
    await setBlob("portal_grants", { G1: grant("G1"), G2: grant("G2"), G3: grant("G3"), G4: grant("G4") });
    await Promise.all([revokeGrant("G1"), touchGrantSeen("G1", 123), touchGrantSeen("G2", 222), touchGrantSeen("G3", 333), revokeGrant("G4")]);
    const m = await getBlob<Record<string, { revokedAt: number | null; lastSeenAt: number | null; name: string }>>("portal_grants", {});
    ok(!!m.G1.revokedAt && !!m.G4.revokedAt, "revokeGrant: a revoke racing a lastSeenAt touch is never undone");
    ok(m.G2.lastSeenAt === 222 && m.G3.lastSeenAt === 333 && !m.G2.revokedAt, "touchGrantSeen: concurrent touches of different grants both land");
    await touchGrantSeen("G4", 444);
    ok((await getBlob<Record<string, { lastSeenAt: number | null }>>("portal_grants", {})).G4.lastSeenAt === null, "touchGrantSeen: a revoked grant is not touched");
    await revokeGrant("nope");
    ok(!("nope" in (await getBlob<Record<string, unknown>>("portal_grants", {}))), "revokeGrant: an unknown grant writes nothing");
  });

  /* studio designs */
  await withBlobsRestored(["studio_designs"], async () => {
    const made = await Promise.all(range(4).map((i) => saveDesign({ name: `T343 ${i}`, kind: "lineset", customerId: null, customer: "", data: { i }, by: "t" })));
    await Promise.all([removeDesign(made[0].id), removeDesign(made[1].id)]);
    ok(!(await getDesign(made[0].id)) && !(await getDesign(made[1].id)) && !!(await getDesign(made[2].id)) && !!(await getDesign(made[3].id)), "removeDesign: concurrent removals both land; other designs untouched");
  });

  /* venue calendars */
  const loc = "TEST343-loc";
  await withBlobsRestored([`venue_calendar:${loc}`], async () => {
    await setBlob(`venue_calendar:${loc}`, { icsUrl: "https://example.test/cal.ics" });
    await Promise.all(range(N).map((i) => addWindow(loc, { kind: "open", start: 1_000 * i, end: 1_000 * i + 500, allDay: false, label: `w${i}` }, "t")));
    let cal = await getVenueCalendar(loc);
    ok(cal.windows.length === N && range(N).every((i) => cal.windows.some((w) => w.label === `w${i}`)), `addWindow: ${N} concurrent windows all persist`);
    const [w0, w1] = cal.windows;
    await Promise.all([
      removeWindow(loc, w0.id, "t"),
      removeWindow(loc, w1.id, "t"),
      importCsvWindows(loc, "type,start,end,label\nopen,2035-03-01,2035-03-02,csv1", "append", "t"),
      addWindow(loc, { kind: "blocked", start: 1, end: 2, allDay: true, label: "late" }, "t"),
    ]);
    cal = await getVenueCalendar(loc);
    ok(cal.windows.length === N - 2 + 2 && !cal.windows.some((w) => w.id === w0.id || w.id === w1.id) && cal.windows.some((w) => w.label === "csv1") && cal.windows.some((w) => w.label === "late"), "removeWindow / importCsvWindows / addWindow: landing together, every change persists");
    ok(cal.icsUrl === "https://example.test/cal.ics", "venue calendar: the feed keys are untouched");
  });

  /* device types + favourites / recents */
  const U = "TEST343-user";
  await withBlobsRestored([DEVICE_TYPES_BLOB, TYPE_MAP_BLOB, favoritesBlobId(U), recentBlobId(U)], async () => {
    await db.delete(blobs).where(eq(blobs.id, DEVICE_TYPES_BLOB));
    const keys = (await getDeviceTypes()).filter((t) => !t.archived).map((t) => t.key);
    const icons = ["fixture", "dimmer", "speaker", "camera"];
    await Promise.all(icons.map((ic, i) => setDeviceTypeIcons({ [keys[i]]: ic })));
    let types = await getDeviceTypes();
    ok(icons.every((ic, i) => types.find((t) => t.key === keys[i])?.icon === ic), `setDeviceTypeIcons: ${icons.length} concurrent icon edits all persist`);
    const docs = ["PD-T343aaaa", "PD-T343bbbb", "PD-T343cccc"];
    const res = await Promise.all(docs.map((d, i) => setDeviceTypeSymbol(keys[4 + i], d)));
    types = await getDeviceTypes();
    ok(res.every((r) => r.ok) && docs.every((d, i) => types.find((t) => t.key === keys[4 + i])?.symbolDocId === d), `setDeviceTypeSymbol: ${docs.length} concurrent drawing edits all persist`);
    ok(icons.every((ic, i) => types.find((t) => t.key === keys[i])?.icon === ic), "setDeviceTypeSymbol: the icon edits are kept");
    const bad = await setDeviceTypeSymbol("t343-nope", "PD-T343aaaa");
    const bad2 = await setDeviceTypeSymbol("t343-nope", "garbage");
    ok(!bad.ok && bad.error === "That device type no longer exists." && !bad2.ok && bad2.error === "That device type no longer exists.", "setDeviceTypeSymbol: an unknown type is refused first, as before");
    const bad3 = await setDeviceTypeSymbol(keys[0], "garbage");
    ok(!bad3.ok && bad3.error === "Not a document id.", "setDeviceTypeSymbol: a malformed document id is refused");
    const [merged] = await Promise.all([mergeDeviceType(keys[8], keys[9]), setDeviceTypeIcons({ [keys[10]]: "projector" })]);
    types = await getDeviceTypes();
    ok(merged.ok && !!types.find((t) => t.key === keys[8])?.archived && types.find((t) => t.key === keys[10])?.icon === "projector", "mergeDeviceType: the archive and a concurrent icon edit both persist");
    ok(docs.every((d, i) => types.find((t) => t.key === keys[4 + i])?.symbolDocId === d), "mergeDeviceType: archives in the stored list (earlier edits kept)");

    const parts = range(N).map((i) => `T343-P${i}`);
    const favs = await Promise.all(parts.map((p) => toggleGridFavorite(U, p)));
    const fl = await getGridFavorites(U);
    ok(favs.every((r) => r.ok && r.on) && fl.length === N && parts.every((p) => fl.includes(p)), `toggleGridFavorite: ${N} concurrent stars all persist`);
    await Promise.all([toggleGridFavorite(U, parts[0]), toggleGridFavorite(U, parts[1])]);
    ok((await getGridFavorites(U)).length === N - 2, "toggleGridFavorite: concurrent un-stars both land");
    const badFav = await toggleGridFavorite(U, "");
    ok(!badFav.ok, "toggleGridFavorite: a bad id is refused, as before");
    await Promise.all(parts.map((p) => pushGridRecent(U, p)));
    const rl = await getGridRecent(U);
    ok(rl.length === N && parts.every((p) => rl.includes(p)), `pushGridRecent: ${N} concurrent pushes all persist`);
    // catalog-rename sweep racing a star on the same blob
    await Promise.all([
      sweepBlob(favoritesBlobId(U), (raw) => {
        const ids = (raw.ids as string[]) || [];
        return ids.includes(parts[2]) ? { ...raw, ids: ids.map((x) => (x === parts[2] ? "T343-RENAMED" : x)) } : null;
      }),
      toggleGridFavorite(U, "T343-NEWSTAR"),
    ]);
    const fl2 = await getGridFavorites(U);
    ok(fl2.includes("T343-RENAMED") && !fl2.includes(parts[2]) && fl2.includes("T343-NEWSTAR"), "sweepBlob: a rename sweep and a concurrent star on the same blob both persist");
    ok((await sweepBlob(favoritesBlobId(U), () => null)) === 0 && (await sweepBlob("TEST343:missing", () => null)) === 0 && !(await blobRow("TEST343:missing")), "sweepBlob: nothing to change → 0, nothing written");
  });

  /* inbox organization: sender rules + filing log */
  await withBlobsRestored([SENDER_RULES_BLOB, FILING_LOG_BLOB], async () => {
    await db.delete(blobs).where(inArray(blobs.id, [SENDER_RULES_BLOB, FILING_LOG_BLOB]));
    const added = await Promise.all(range(N).map((i) => addSenderRule({ scope: "company", match: { domain: `t343-${i}.test` }, action: { type: "noise" }, createdBy: "t" })));
    let rules = await getSenderRules();
    ok(added.every(Boolean) && rules.length === N && range(N).every((i) => rules.some((r) => r.match.domain === `t343-${i}.test`)), `addSenderRule: ${N} concurrent rules all persist`);
    const [r0, r1] = [added[0]!, added[1]!];
    const removed = await Promise.all([removeSenderRule(r0.id, { userId: "x", admin: true }), removeSenderRule(r1.id, { userId: "x", admin: true }), removeSenderRule(added[2]!.id, { userId: "x", admin: false })]);
    rules = await getSenderRules();
    ok(removed[0] && removed[1] && !removed[2] && rules.length === N - 2, "removeSenderRule: concurrent removals both land; a non-admin can't remove a company rule");
    ok((await removeSenderRule("SR-nope", { userId: "x", admin: true })) === false, "removeSenderRule: an unknown rule returns false");
    const entry = (i: number) => ({ at: i, threadId: `T343-t${i}`, source: "rule", strength: "strong", outcome: "suggested" }) as unknown as FilingLogEntry;
    await Promise.all(range(N).map((i) => appendFilingLogs([entry(i), entry(100 + i)])));
    const log = await getFilingLog();
    ok(log.length === 2 * N && range(N).every((i) => log.some((e) => e.threadId === `T343-t${i}`)), `appendFilingLogs: ${N} concurrent appends all persist`);
    ok((await getSenderRules()).length === N - 2, "filing log: the sender rules blob is untouched");
  });

  /* catalog SKU renames log */
  await withBlobsRestored([SKU_RENAMES_BLOB], async () => {
    await db.delete(blobs).where(eq(blobs.id, SKU_RENAMES_BLOB));
    await Promise.all(range(N).map((i) => appendSkuRenames([{ from: `T343-F${i}`, to: `T343-T${i}`, model: "M", at: i, by: "t" }])));
    const all = await allSkuRenames();
    ok(all.length === N && range(N).every((i) => all.some((e) => e.from === `T343-F${i}` && e.to === `T343-T${i}`)), `appendSkuRenames: ${N} concurrent appends all persist`);
    await appendSkuRenames([{ from: "T343-F0", to: "T343-T0b", model: "M", at: 99, by: "t" }]);
    const again = await allSkuRenames();
    ok(again.length === N && again[again.length - 1].to === "T343-T0b", "appendSkuRenames: a repeated `from` replaces the earlier entry and sorts last");
  });

  /* projects: dismissed quote ids */
  const pids = range(4).map((i) => `TEST343:proj-${i}`);
  await withBlobsRestored([DISMISSED_BLOB_ID], async () => {
    try {
      for (const [i, id] of pids.entries()) await upsertDoc<Doc>("projects", { id, name: `T343 ${i}`, quoteId: `TEST343-Q${i}`, stage: "", createdAt: 1, updatedAt: 1 } as Doc);
      const before = await dismissedQuoteIds();
      await Promise.all(pids.map((id) => removeProject(id)));
      const after = await dismissedQuoteIds();
      ok(range(4).every((i) => after.includes(`TEST343-Q${i}`)) && before.every((q) => after.includes(q)) && after.length === before.length + 4, "removeProject: 4 concurrent deletes all add their quote to the dismissed list");
    } finally {
      await db.delete(DOC_TABLES.projects).where(inArray(DOC_TABLES.projects.id, pids));
    }
  });

  /* flame-test rates */
  await withBlobsRestored(["flametest_rates"], async () => {
    const base = await getFlameRates();
    const keys = Object.keys(base).filter((k) => typeof (base as Record<string, unknown>)[k] === "number").slice(0, 4);
    await Promise.all(keys.map((k, i) => setFlameRates({ [k]: 9000 + i })));
    const after = (await getBlob<Record<string, unknown>>("flametest_rates", {})) as Record<string, unknown>;
    ok(keys.length >= 2 && keys.every((k, i) => after[k] === 9000 + i), `flametest setRates: ${keys.length} concurrent rate edits all persist`);
    const ret = await setFlameRates({});
    ok(keys.every((k, i) => (ret as Record<string, unknown>)[k] === 9000 + i), "flametest setRates: returns the merged rates after the write");
  });

  /* narrative intros */
  await withBlobsRestored(["narrative_intros"], async () => {
    await db.delete(blobs).where(eq(blobs.id, "narrative_intros"));
    const res = await Promise.all(range(5).map((i) => upsertIntro({ title: `T343 intro ${i}`, text: `Body ${i}` }, "t")));
    const list = await listIntros();
    ok(res.every((r) => r.ok) && list.length === 5 && range(5).every((i) => list.some((x) => x.title === `T343 intro ${i}`)), "upsertIntro: 5 concurrent new intros all persist");
    const dup = await Promise.all([upsertIntro({ title: "T343 same", text: "a" }, "t"), upsertIntro({ title: "T343 same", text: "b" }, "t")]);
    ok(dup.filter((r) => r.ok).length === 1 && (await listIntros()).filter((x) => x.title === "T343 same").length === 1, "upsertIntro: two concurrent intros with one title — exactly one lands (checked under the lock)");
  });

  /* estimate suggestions: first quote wins */
  const mk = (): EstimateSuggestion => ({
    id: newSuggestionId(),
    source: { kind: "thread", id: "TEST343-src", label: "T343" },
    createdBy: { id: "u", name: "U" },
    createdAt: 1,
    customerId: null,
    contactName: null,
    venueId: null,
    leadId: null,
    quoteName: "T343",
    systems: [],
    notes: "",
    truncated: 0,
    runIds: { extract: null, draft: null },
    quoteId: null,
  });
  const a = mk();
  const b = { ...mk(), id: newSuggestionId(Date.now() + 1) };
  const touched = [suggestionBlobId(a.id), suggestionBlobId(b.id), sourceIndexBlobId("thread", "TEST343-src"), quoteIndexBlobId("TEST343-Q1"), quoteIndexBlobId("TEST343-Q2"), quoteIndexBlobId("TEST343-Q3")];
  await withBlobsRestored(touched, async () => {
    await saveSuggestion(a);
    await saveSuggestion(b);
    const links = await Promise.all([linkSuggestionToQuote(a.id, "TEST343-Q1"), linkSuggestionToQuote(a.id, "TEST343-Q2")]);
    const sa = await getSuggestion(a.id);
    const i1 = await getBlob<{ id?: string }>(quoteIndexBlobId("TEST343-Q1"), {});
    const i2 = await getBlob<{ id?: string }>(quoteIndexBlobId("TEST343-Q2"), {});
    ok(links.every(Boolean) && i1.id === a.id && i2.id === a.id, "linkSuggestionToQuote: two quotes linked at once — both quote indexes are written");
    ok(sa?.quoteId === "TEST343-Q1" || sa?.quoteId === "TEST343-Q2", "linkSuggestionToQuote: the suggestion keeps exactly one first quote");
    const claims = await Promise.all([linkSuggestionToQuote(a.id, "TEST343-Q3"), linkSuggestionToQuote(b.id, "TEST343-Q3")]);
    const i3 = await getBlob<{ id?: string }>(quoteIndexBlobId("TEST343-Q3"), {});
    ok(claims.filter(Boolean).length === 1 && (i3.id === a.id) === claims[0], "linkSuggestionToQuote: two suggestions claiming one quote at once — exactly one wins");
    ok((await getSuggestion(a.id))?.quoteId === sa?.quoteId, "linkSuggestionToQuote: a later link never moves the first quote");
  });
}

/* ------------------------------------------------------------------ */
/* Review follow-ups (#343): merging list saves, the lock pins            */
/* ------------------------------------------------------------------ */

export async function settingsRaceFollowupChecks(ok: Ok): Promise<void> {
  const db = await getDb();

  /* The row lock exists: both helpers select FOR UPDATE (source pin + the
     SQL drizzle renders for that exact builder chain). PGlite has one
     connection, so the multi-connection blocking itself is reasoned, not run. */
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const body = (file: string, name: string) => {
    const s = readFileSync(join(process.cwd(), file), "utf8");
    const i = s.indexOf(`export async function ${name}(`);
    return i < 0 ? "" : s.slice(i, s.indexOf("\n}\n", i));
  };
  const us = body("src/lib/settings.ts", "updateSettings");
  const ub = body("src/db/doc-store.ts", "updateBlob");
  ok(/\.from\(appSettings\)\s*\.where\(eq\(appSettings\.id, "main"\)\)\s*\.for\("update"\)/.test(us) && us.includes("withTransaction("), "updateSettings: selects the settings row FOR UPDATE inside a transaction (pin)");
  ok(/\.from\(blobs\)\.where\(eq\(blobs\.id, id\)\)\.for\("update"\)/.test(ub) && ub.includes("withTransaction("), "updateBlob: selects the blob row FOR UPDATE inside a transaction (pin)");
  ok(us.includes("onConflictDoNothing") && ub.includes("onConflictDoNothing") && (us.match(/await lock\(\)/g) || []).length === 2 && (ub.match(/await lock\(\)/g) || []).length === 2, "updateSettings / updateBlob: first insert is ON CONFLICT DO NOTHING, then re-selected FOR UPDATE (pin)");
  const qs = db.select({ data: appSettings.data }).from(appSettings).where(eq(appSettings.id, "main")).for("update").limit(1).toSQL().sql;
  const qb = db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, "x")).for("update").limit(1).toSQL().sql;
  ok(/\bfor update\b/i.test(qs) && /\bfor update\b/i.test(qb), `drizzle renders the lock chain as SQL "… for update" (${qs.replace(/\s+/g, " ").slice(-40)})`);
  ok(us.includes("settingsPatchSql(patch).expr") && /\$\{blobs\.data\} \|\| \$\{JSON\.stringify\(kept\)\}::jsonb/.test(ub), "updateSettings / updateBlob: write only the patched keys (data - dropped || patch), not the whole row (pin)");
  const sa = readFileSync(join(process.cwd(), "src/app/(app)/settings/actions.ts"), "utf8");
  ok(sa.includes('"of" + Date.now() + Math.random().toString(36).slice(2, 6)'), "saveOfficeAction: a new location id carries a random suffix (two in one millisecond stay apart)");
  ok(!readFileSync(join(process.cwd(), "src/lib/stores/inbox-org.ts"), "utf8").includes("function serialized"), "inbox-org: the per-process write queue is gone (the row lock replaced it)");

  /* Partial writes keep every other key byte-identical (and delete / skip as before). */
  await withSettingsRestored(async () => {
    await setSettings({ t343Big: { logo: "x".repeat(2000) }, t343Gone: 1 });
    await updateSettings(() => ({ t343Small: 1, t343Gone: undefined }));
    const p = await getSettingsPatchStrict();
    ok((p.t343Big as { logo: string }).logo.length === 2000 && p.t343Small === 1 && !("t343Gone" in p), "updateSettings: a partial write keeps other keys and still deletes an undefined key");
    const r = await updateSettings((cur) => ({ t343Small: Number(cur.t343Small) + 1 }));
    ok(r.t343Small === 2 && (await getSettingsPatchStrict()).t343Small === 2, "updateSettings: the returned patch matches what was stored");
  });

  /* Device types save: merged with the stored list under the lock. */
  await withBlobsRestored([DEVICE_TYPES_BLOB], async () => {
    await db.delete(blobs).where(eq(blobs.id, DEVICE_TYPES_BLOB));
    const base = await getDeviceTypes();
    const posted = base.map((t) => ({ key: t.key, label: t.key === base[0].key ? "T343 Renamed" : t.label, scope: t.scope, archived: t.archived }));
    const [saved] = await Promise.all([
      saveDeviceTypes(posted),
      setDeviceTypeIcons({ [base[1].key]: "dimmer" }),
      setDeviceTypeSymbol(base[2].key, "PD-T343dddd"),
    ]);
    let types = await getDeviceTypes();
    ok(saved.ok && types.find((t) => t.key === base[0].key)?.label === "T343 Renamed", "saveDeviceTypes: the editor's save lands");
    ok(types.find((t) => t.key === base[1].key)?.icon === "dimmer" && types.find((t) => t.key === base[2].key)?.symbolDocId === "PD-T343dddd", "saveDeviceTypes: an icon and a drawing set at the same moment are kept, not reverted");
    const plus = (label: string) => [...base.map((t) => ({ key: t.key, label: t.label, scope: t.scope, archived: t.archived })), { label, scope: base[0].scope }];
    const both = await Promise.all([saveDeviceTypes(plus("T343 New A")), saveDeviceTypes(plus("T343 New B"))]);
    types = await getDeviceTypes();
    ok(both.every((r) => r.ok) && types.some((t) => t.label === "T343 New A") && types.some((t) => t.label === "T343 New B"), "saveDeviceTypes: two saves each adding a type — neither new type is dropped (the later save archives the other's)");
    const bad = await saveDeviceTypes("nope");
    ok(!bad.ok && bad.error === "Nothing to save.", "saveDeviceTypes: refusals are unchanged");
  });

  await withSettingsRestored(async () => {
    await setSettings({ t343Sentinel: 1 });

    /* Venue types: merged under the lock; an in-use type is never dropped. */
    const base = venueTypesFrom(undefined).map((t) => ({ key: t.key, label: t.label, worksLike: t.worksLike, archived: t.archived }));
    let alphaKey = "";
    const countUsed = async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, k === alphaKey || k.startsWith("t343alpha") ? 1 : 0]));
    const [ra, rb] = await Promise.all([
      saveVenueTypesLocked([...base, { label: "T343 Alpha", worksLike: "proscenium" }], [], countUsed),
      saveVenueTypesLocked([...base, { label: "T343 Beta", worksLike: "proscenium" }], [], countUsed),
      setPriceListEffective("t343venue", 3),
    ]);
    alphaKey = ra.ok ? ra.types.find((t) => t.label === "T343 Alpha")?.key ?? "" : "";
    const vt = venueTypesFrom(settingsFrom(await getSettingsPatchStrict()).venueTypes);
    ok(ra.ok && vt.some((t) => t.label === "T343 Alpha"), "saveVenueTypesLocked: a type in use (Alpha) is never dropped by a save racing it");
    ok(!rb.ok ? /is used by 1 venue/.test(rb.error) : true, "saveVenueTypesLocked: the racing save is refused with the usual in-use message when it would drop it");
    ok(((await getSettingsPatchStrict()).priceListEffective as Record<string, number>).t343venue === 3 && (await getSettingsPatchStrict()).t343Sentinel === 1, "saveVenueTypesLocked: other settings keys unchanged");
    const renamed = await Promise.all([
      saveVenueTypesLocked(vt.map((t) => ({ key: t.key, label: t.key === "church" ? "T343 Church" : t.label, worksLike: t.worksLike, archived: t.archived })), [], async () => ({})),
      saveVenueTypesLocked(vt.map((t) => ({ key: t.key, label: t.label, worksLike: t.worksLike, archived: t.archived })), [], async () => ({})),
    ]);
    ok(renamed.every((r) => r.ok) && renamed[0].ok && renamed[0].renamed.includes("church"), "saveVenueTypesLocked: concurrent whole-list saves both succeed; renamed keys are reported");
    const bad = await saveVenueTypesLocked([], [], async () => ({}));
    ok(!bad.ok, "saveVenueTypesLocked: refusals are unchanged");

    /* Document categories: merged under the lock; a concurrent new row is archived, not lost. */
    await setSettings({ documentCategories: undefined });
    const cats = resolveDocumentCategories(undefined).map((c) => ({ key: c.key, label: c.label, archived: c.archived }));
    const res = await Promise.all([
      saveDocumentCategoriesLocked([...cats, { label: "T343 Cat A" }]),
      saveDocumentCategoriesLocked([...cats, { label: "T343 Cat B" }]),
    ]);
    const stored = resolveDocumentCategories(settingsFrom(await getSettingsPatchStrict()).documentCategories);
    ok(res.every((r) => r.ok) && stored.some((c) => c.label === "T343 Cat A") && stored.some((c) => c.label === "T343 Cat B"), "saveDocumentCategoriesLocked: two saves each adding a category — neither is lost (the later archives the other's)");
    ok(new Set(stored.map((c) => c.key)).size === stored.length, "saveDocumentCategoriesLocked: keys stay unique across the racing saves");
    const badC = await saveDocumentCategoriesLocked("nope");
    ok(!badC.ok && badC.error === "Nothing to save.", "saveDocumentCategoriesLocked: refusals are unchanged");
    ok((await getSettingsPatchStrict()).t343Sentinel === 1, "document categories: other settings keys unchanged");

    /* Final thoughts tags (#344): merged under the lock; a concurrent new tag is kept, not lost. */
    await setSettings({ surveyInternalTags: undefined });
    const tags0 = resolveSurveyTags(undefined).map((t) => ({ id: t.id, label: t.label }));
    const tres = await Promise.all([
      saveSurveyTagsLocked([...tags0, { label: "T344 Tag A" }]),
      saveSurveyTagsLocked([...tags0, { label: "T344 Tag B" }]),
    ]);
    const tstored = resolveSurveyTags(settingsFrom(await getSettingsPatchStrict()).surveyInternalTags);
    ok(tres.every((r) => r.ok) && tstored.some((t) => t.label === "T344 Tag A") && tstored.some((t) => t.label === "T344 Tag B"), "saveSurveyTagsLocked: two saves each adding a tag — neither is lost (the later retires the other's)");
    ok(new Set(tstored.map((t) => t.id)).size === tstored.length, "saveSurveyTagsLocked: ids stay unique across the racing saves");
    const badT = await saveSurveyTagsLocked("nope");
    ok(!badT.ok && badT.error === "Nothing to save.", "saveSurveyTagsLocked: refusals are unchanged");
    ok((await getSettingsPatchStrict()).t343Sentinel === 1, "survey tags: other settings keys unchanged");
    await setSettings({ surveyInternalTags: undefined });

    /* Krisp rebase: a folder re-cached since the pass read it is kept. */
    const basis = { mailbox: "mb", folders: { a: "A-old", b: "B" } };
    const reb = rebaseArchivePatch({ recordingsArchiveMailbox: "mb", recordingsArchiveFolders: { a: "A-new", b: "B" } }, { recordingsArchiveFolders: {} }, basis);
    ok(json(reb.recordingsArchiveFolders) === '{"a":"A-new"}', "rebaseArchivePatch: a dropped key is removed only when the stored id is still the one the pass read");
  });

  /* touchGrantSeen: two renders at once write once. */
  await withBlobsRestored(["portal_grants"], async () => {
    await setBlob("portal_grants", { G9: { id: "G9", customerId: "TEST343-c", revokedAt: null, lastSeenAt: null } });
    const t0 = 1_800_000_000_000;
    await Promise.all([touchGrantSeen("G9", t0), touchGrantSeen("G9", t0 + 1000)]);
    const g = (await getBlob<Record<string, { lastSeenAt: number }>>("portal_grants", {})).G9;
    ok(g.lastSeenAt === t0 || g.lastSeenAt === t0 + 1000, "touchGrantSeen: two parallel touches — the second sees the first's stamp and skips");
    const before = await blobRow("portal_grants");
    await touchGrantSeen("G9", g.lastSeenAt + 60_000);
    ok((await blobRow("portal_grants"))?.updatedAt === before?.updatedAt, "touchGrantSeen: within the refresh window nothing is written");
    await touchGrantSeen("G9", g.lastSeenAt + 11 * 60_000);
    ok((await getBlob<Record<string, { lastSeenAt: number }>>("portal_grants", {})).G9.lastSeenAt === g.lastSeenAt + 11 * 60_000, "touchGrantSeen: past the refresh window it stamps again");
  });
}

// Standalone runner (npm run test:settings-race).
if (process.argv[1] && /test-settings-race\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set; unset it (this suite writes to the DB).");
    process.exit(1);
  }
  if (!process.env.PGLITE_PATH) {
    console.error("Refusing to run: PGLITE_PATH is not set — use `npm run test:settings-race` (a scratch datadir), never the dev DB.");
    process.exit(1);
  }
  (async () => {
    await settingsRaceHelperChecks(ok);
    await settingsRaceCallerChecks(ok);
    await settingsRaceBlobChecks(ok);
    await settingsRaceFollowupChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall settings-race checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
