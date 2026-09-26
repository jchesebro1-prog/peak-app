"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requirePerm } from "@/lib/session";
import { clearCatalogPriceList, get as getPart, mergeUpsert, remove as removePart } from "@/lib/stores/catalog";
import { mfrKey, parseEffectiveDate } from "@/lib/catalog-books";
import { checkSize } from "@/lib/catalog-import-guard";
import { setPriceListEffective, setSettings } from "@/lib/settings";
import { GROUPS, TRADES, type CategoryMap } from "@/lib/catalog-taxonomy";
import { runCatalogImport } from "./import";
import { parsePortsField, serializePorts } from "@/lib/catalog-ports";
import type { Port } from "@/lib/catalog-connect";
import { validateSameAs, optionalPartFields, specSortValue } from "./part-form";
import { articleIdForPart } from "@/lib/specs/articles";
import { allArticles } from "@/lib/stores/spec-articles";
import { allSections } from "@/lib/stores/spec-sections";

type Result = { ok: true } | { ok: false; error: string };

export async function deleteCatalogPriceListAction(formData: FormData): Promise<void> {
  await requirePerm("manage_users");
  if (String(formData.get("confirmation") || "") !== "DELETE") return;
  await clearCatalogPriceList();
  revalidatePath("/catalog");
  redirect("/catalog?reset=1");
}

/** Delete a single catalog part (soft delete). Admin-gated like the other
 *  catalog delete/remove mutations here (bulk price-list clear, datasheet
 *  remove) rather than the plain requireUser() the edit form's upsertPart
 *  uses — deleting a SKU outright is more destructive than editing one. */
export async function deletePartAction(sku: string): Promise<Result> {
  await requirePerm("manage_users");
  const clean = sku.trim();
  if (!clean) return { ok: false, error: "Missing SKU." };
  await removePart(clean);
  revalidatePath("/catalog");
  return { ok: true };
}

/**
 * Catalog mutations. FormData-shaped so forms work without client JS; the SKU
 * is the natural key (catalog.upsert uses it as the document id), so an upsert
 * with an existing SKU edits that part. Invalid input is a silent no-op.
 */

/**
 * Add or edit a single part. The edit form owns sku/desc/category/unit/list/
 * cost/mfr/note and — since #158 — `ports`. It never shows trade, datasheet,
 * discipline/role, costPerSqft, pricedAt, so a save here must not wipe those.
 * mergeUpsert (lib/stores/catalog) loads the existing part and overlays just
 * the form-owned fields; a blanked mfr/note still clears intentionally
 * (undefined wins over whatever was stored).
 *
 * `ports` is forwarded ONLY when the form actually submitted the field. That
 * distinction is load-bearing: mergeUpsert leaves absent keys alone, so a
 * caller that does not own ports (or a pre-#158 form) leaves them untouched,
 * while the ports editor — which always submits, including an empty list —
 * can delete a part's last port. Unknown connection types are refused rather
 * than stored, because validateDeviceWire resolves against CONNECTION_TYPES
 * and a bad value would silently unwire the device (D189).
 *
 * Replacing the ports also clears the `davinci` provenance stamp (#162). The
 * stamp means "the enricher wrote these" — it drives the editor's "These ports
 * came from ETC's DaVinci library" banner and, since the enricher now
 * recognises its own prior writes, whether a later library revision may
 * overwrite them. Leaving it on ports a human just replaced would keep showing
 * a banner about ports DaVinci no longer wrote, and would put the hand edit
 * back in the enricher's path.
 */
export async function upsertPart(formData: FormData): Promise<void> {
  await requireUser();
  const sku = String(formData.get("sku") || "").trim();
  const desc = String(formData.get("desc") || "").trim();
  if (!sku || !desc) return;

  const rawPorts = formData.get("ports");
  let ports: Port[] | undefined;
  if (typeof rawPorts === "string") {
    const parsed = parsePortsField(rawPorts);
    if (!parsed.ok) {
      redirect(`/catalog?edit=${encodeURIComponent(sku)}&partError=${encodeURIComponent(parsed.error)}`);
    }
    ports = parsed.ports;
  }

  // Compared through serializePorts — the same stable key order the editor's
  // hidden field uses — so re-saving the modal without touching the ports is a
  // no-op and keeps the stamp. `undefined` in a mergeUpsert patch drops the key
  // from the stored JSON document, which is how the stamp is cleared.
  const existing = ports ? await getPart(sku) : null;
  const portsReplaced =
    !!existing?.davinci && !!ports && serializePorts(existing.ports ?? []) !== serializePorts(ports);

  await mergeUpsert(sku, {
    ...(portsReplaced ? { davinci: undefined } : {}),
    desc,
    category: String(formData.get("category") || "").trim() || "Uncategorized",
    unit: String(formData.get("unit") || "").trim() || "ea",
    list: num(formData.get("list")),
    cost: num(formData.get("cost")),
    mfr: String(formData.get("mfr") || "").trim() || undefined,
    ...optionalPartFields(formData),
    note: String(formData.get("note") || "").trim() || undefined,
    ...(ports ? { ports } : {}),
  });
  revalidatePath("/", "layout");
  redirect("/catalog");
}

/**
 * Bulk import a price book (upload or paste) → `runCatalogImport` (./import):
 * size cap (#134), parse, the wrong-manufacturer guard (#132), upserts that
 * stamp `pricedAt` with the form's effective date on rows whose price moved
 * (#133), and the manufacturer's book date. Redirects back filtered to that
 * manufacturer with a count so the freshly-added rows are visible.
 */
export async function importCatalog(formData: FormData): Promise<void> {
  await requireUser();
  const mfr = String(formData.get("mfr") || "").trim();
  const defaultCategory = String(formData.get("category") || "").trim();
  const effectiveAt = parseEffectiveDate(String(formData.get("effectiveDate") || ""), Date.now());
  let text = String(formData.get("text") || "");
  let bytes = Buffer.byteLength(text, "utf8");
  const file = formData.get("file");

  // Every failure path redirects with a human message (punch #111) — a silent
  // return left the upload form looking frozen. redirect() throws, so these
  // stay outside any try/catch.
  const fail = (message: string): never => {
    const qs = new URLSearchParams();
    if (mfr) qs.set("mfr", mfr);
    qs.set("importError", message);
    redirect("/catalog?" + qs.toString());
  };

  if (file instanceof File && file.size > 0) {
    // #134 — refuse before reading a big file into memory.
    const size = checkSize(file.size);
    if (!size.ok) return fail(size.error);
    bytes = file.size;
    text = await file.text();
  }

  const res = await runCatalogImport({
    mfr,
    text,
    bytes,
    effectiveAt,
    defaultCategory: defaultCategory || (String(formData.get("prebuilt") || "") === "1" ? "Prebuilt system" : ""),
  });
  if (!res.ok) return fail(res.error);

  revalidatePath("/", "layout");
  const qs = new URLSearchParams();
  qs.set("mfr", res.mfr);
  qs.set("imported", String(res.imported));
  redirect("/catalog?" + qs.toString());
}

function num(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * Save the admin-edited category -> group/trade mapping (punch #39, Task 2).
 * Admin-gated on manage_users (like Settings / Estimating Rules — the
 * codebase's standard admin gate), unlike the other actions in this file
 * which only require a signed-in session.
 *
 * `entries` becomes the ENTIRE stored `catalogCategoryMap` — not a delta.
 * That's intentional: resolveCategoryMap does `{ ...DEFAULT_CATEGORY_MAP,
 * ...stored }`, so whatever is stored wins per key. The editor seeds its
 * state from resolveCategoryMap(stored), so a save legitimately writes the
 * default entries back out alongside any edits; that's expected, not a bug.
 *
 * Every group/trade value is validated against the live GROUPS/TRADES lists
 * before anything is persisted — one bad entry rejects the whole save so a
 * stale client can never wedge a garbage value into settings.
 *
 * Fabric/Labor are stripped before validation/persistence regardless of what
 * the client sends — they're excluded domains (curtain configurator / labor
 * engine; see catalog-taxonomy.ts), and the editor's disabled rows are a UI
 * nicety, not the enforcement: the "Fabric is EXCLUDED" constraint has to
 * hold even against a tampered client that POSTs those keys directly.
 */
export async function saveCategoryMapAction(entries: CategoryMap): Promise<void> {
  await requirePerm("manage_users");

  const { Fabric: _fabric, Labor: _labor, ...clean } = entries;

  for (const [category, entry] of Object.entries(clean)) {
    if (entry.group !== undefined && !(GROUPS as readonly string[]).includes(entry.group)) {
      throw new Error(`"${entry.group}" is not a valid group (category "${category}").`);
    }
    if (entry.trade !== undefined && !(TRADES as readonly string[]).includes(entry.trade)) {
      throw new Error(`"${entry.trade}" is not a valid trade (category "${category}").`);
    }
  }

  await setSettings({ catalogCategoryMap: clean });
  revalidatePath("/catalog");
}

/**
 * #133 — the Catalog banner's inline date input: record (or clear) the date
 * a manufacturer's price list is effective. `mfr` is the display name; it is
 * keyed through mfrKey so every spelling of the manufacturer shares one date.
 */
export async function setPriceListEffectiveAction(mfr: string, at: number | null): Promise<Result> {
  await requireUser();
  const key = mfrKey(mfr);
  if (!key) return { ok: false, error: "Pick a manufacturer." };
  if (at != null && (!Number.isFinite(at) || at <= 0)) return { ok: false, error: "Enter a valid date." };
  await setPriceListEffective(key, at);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Write a part's canonical spec fields (Task 13's panel). Saving here is the
 * review step: whatever the row's provenance was, a human has now read it,
 * so it becomes "authored" — the only state that ever prints (D259).
 */
export async function writePartSpecFieldsAction(input: {
  sku: string;
  specArticleId?: string;
  specTitle?: string;
  specBody?: string;
  specSameAs?: string;
  specSort?: number;
}): Promise<Result> {
  const user = await requirePerm("create"); // returns the user — no second requireUser()
  const sku = String(input.sku || "").trim();
  if (!sku) return { ok: false, error: "A part is required." };
  const part = await getPart(sku);
  if (!part) return { ok: false, error: `Part ${sku} not found.` };

  const sameAs = String(input.specSameAs || "").trim();
  const sameAsError = validateSameAs(sku, sameAs, sameAs ? await getPart(sameAs) : null);
  if (sameAsError) return { ok: false, error: sameAsError };

  const [articles, sections] = await Promise.all([allArticles(), allSections()]);
  const articleId = String(input.specArticleId || "").trim();
  if (articleId && !articles.some((a) => a.id === articleId)) {
    return { ok: false, error: "That article no longer exists — pick another." };
  }
  // D258 mirror: D94's assemble groups by specSectionId, so keep it equal
  // to the section of the article this part will actually print under
  // (explicit, else category default, else adopted legacy pointer). When
  // nothing resolves, leave the stored specSectionId alone.
  const effective = articleIdForPart({ ...part, specArticleId: articleId || undefined }, articles, sections);
  const mirrorSectionId = articles.find((a) => a.id === effective)?.sectionId;

  try {
    // mergeUpsert, never upsert: the part carries ports, trade, pricing and
    // datasheet fields this action knows nothing about.
    await mergeUpsert(sku, {
      specArticleId: articleId || undefined,
      ...(mirrorSectionId ? { specSectionId: mirrorSectionId } : {}),
      specTitle: String(input.specTitle || "").trim() || undefined,
      // mergeUpsert treats a key's mere PRESENCE (even `undefined`) as "the
      // caller owns this field, overwrite it" — only a key's ABSENCE leaves
      // the stored value alone. The panel omits specBody entirely from its
      // request when same-as is set (its textarea is disabled/stale then),
      // so mirror that here: omit the key rather than writing "" over a
      // stored body the caller never actually edited.
      ...(input.specBody !== undefined ? { specBody: String(input.specBody) } : {}),
      specSameAs: sameAs || undefined,
      specSort: specSortValue(input.specSort),
      // Saving here is the review step: whatever the row's provenance was, a
      // human has now read it, so it becomes authored.
      specState: "authored",
      specSource: "authored",
      specUpdatedAt: Date.now(),
      specUpdatedBy: user.name,
    });
  } catch (e) {
    console.error("writePartSpecFieldsAction", e);
    return { ok: false, error: "Could not save the spec text. Try again." };
  }
  revalidatePath("/catalog");
  revalidatePath("/design/specs/library");
  return { ok: true };
}
