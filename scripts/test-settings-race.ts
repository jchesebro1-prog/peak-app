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
  settingsFrom,
  updateSettings,
  upsertOffice,
  type Office,
} from "@/lib/settings";
import { carryPriceDates, renameStoredWireTypes, sweepBlob } from "@/lib/catalog-rename/apply";
import { removeDesign, saveDesign, getDesign } from "@/lib/stores/studio-designs";
import { addWindow, getVenueCalendar, importCsvWindows, removeWindow } from "@/lib/stores/venue-calendars";
import { saveDocumentCategoriesLocked, saveVenueTypesLocked } from "@/lib/settings-lists";
import { venueTypesFrom } from "@/lib/venue-types";
import { resolveDocumentCategories } from "@/lib/document-categories";
import { allSkuRenames, appendSkuRenames, SKU_RENAMES_BLOB } from "@/lib/stores/catalog-renames";
import { listIntros, upsertIntro } from "@/lib/stores/narrative-intros";

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
    let s = settingsFrom(await getSettingsPatchStrict());
    s = settingsFrom(await getSettingsPatchStrict());
    ok(await sentinel(), "templates: no other settings key changes");

    /* venue doctrine */
    const classes = ["theatre", "auditorium", "church"] as const;
    ok(await sentinel(), "venue doctrine: no other settings key changes");

    /* wire types — catalog rename + starter linking */
    await setSettings({ wireTypes: [{ id: "t343w", label: "T343", connectionTypes: [], cableSku: "T343-OLD" }] });
    const [rewrote] = await Promise.all([renameStoredWireTypes(new Map([["T343-OLD", "T343-NEW"]])), setPriceListEffective("t343wire", 9)]);
    const wt = (await getSettingsPatchStrict()).wireTypes as Array<{ id: string; cableSku?: string }>;
    ok(rewrote && wt.find((w) => w.id === "t343w")?.cableSku === "T343-NEW" && ((await getSettingsPatchStrict()).priceListEffective as Record<string, number>).t343wire === 9, "renameStoredWireTypes: the rename and a concurrent settings write both persist");
    ok((await renameStoredWireTypes(new Map([["T343-NONE", "X"]]))) === false, "renameStoredWireTypes: nothing to rename → false, nothing written");
    await setSettings({ wireTypes: undefined });
    const wt2 = (await getSettingsPatchStrict()).wireTypes as Array<{ id: string; cableSku?: string }> | undefined;
    ok(await sentinel(), "wire types: no other settings key changes");

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
    const m = await getBlob<Record<string, { revokedAt: number | null; lastSeenAt: number | null; name: string }>>("portal_grants", {});
    ok((await getBlob<Record<string, { lastSeenAt: number | null }>>("portal_grants", {})).G4.lastSeenAt === null, "touchGrantSeen: a revoked grant is not touched");
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

  /* flame-test rates */
  await withBlobsRestored(["flametest_rates"], async () => {
    const after = (await getBlob<Record<string, unknown>>("flametest_rates", {})) as Record<string, unknown>;
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

  /* Partial writes keep every other key byte-identical (and delete / skip as before). */
  await withSettingsRestored(async () => {
    await setSettings({ t343Big: { logo: "x".repeat(2000) }, t343Gone: 1 });
    await updateSettings(() => ({ t343Small: 1, t343Gone: undefined }));
    const p = await getSettingsPatchStrict();
    ok((p.t343Big as { logo: string }).logo.length === 2000 && p.t343Small === 1 && !("t343Gone" in p), "updateSettings: a partial write keeps other keys and still deletes an undefined key");
    const r = await updateSettings((cur) => ({ t343Small: Number(cur.t343Small) + 1 }));
    ok(r.t343Small === 2 && (await getSettingsPatchStrict()).t343Small === 2, "updateSettings: the returned patch matches what was stored");
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
    ok((await getSettingsPatchStrict()).t343Sentinel === 1, "survey tags: other settings keys unchanged");
    await setSettings({ surveyInternalTags: undefined });

    /* Krisp rebase: a folder re-cached since the pass read it is kept. */
    const basis = { mailbox: "mb", folders: { a: "A-old", b: "B" } };
  });

  /* touchGrantSeen: two renders at once write once. */
  await withBlobsRestored(["portal_grants"], async () => {
    await setBlob("portal_grants", { G9: { id: "G9", customerId: "TEST343-c", revokedAt: null, lastSeenAt: null } });
    const t0 = 1_800_000_000_000;
    const g = (await getBlob<Record<string, { lastSeenAt: number }>>("portal_grants", {})).G9;
    const before = await blobRow("portal_grants");
    ok((await blobRow("portal_grants"))?.updatedAt === before?.updatedAt, "touchGrantSeen: within the refresh window nothing is written");
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
