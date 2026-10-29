/**
 * Estimator handoff — browser implementations of src/app/(app)/estimator/narrative-actions.ts (the narrative
 * column's key-product library and the system-intro library), type-enforced against the originals.
 *
 *   keyProductLibraryAction    src/lib/narrative/library.ts keyProductLibrary over the store's catalog
 *                              (renames followed); `photoDocId` comes from the packaged photos (Task 11 —
 *                              none until then), `fallbackDocId` is null (no manufacturer images are sliced).
 *   saveProductParagraphAction catalog.ts saveProductParagraph → the part's `narrativeText` /
 *                              `narrativeUpdatedAt` / `narrativeUpdatedBy` in the catalog overlay (the stale
 *                              check against `expectUpdatedAt` kept).
 *   upsert/deleteSystemIntro   stores/narrative-intros.ts: ONE operation applied to the stored list
 *                              (narrative/intros.ts applyIntroOp), the list kept in the `intros` collection
 *                              (doc "narrative_intros", seeded from the blob of the same name).
 *
 * Every write needs Create (`ports.users`), answered with the original's message. Plan: PR 2 Task 5.
 */
import type * as Original from "@/app/(app)/estimator/narrative-actions";
import { isLineToken, MAX_LIBRARY_SKUS, MAX_PARAGRAPH, type KeyProductLibraryRow } from "@/app/(app)/estimator/narrative";
import { applyIntroOp, newIntroId, type IntroOp } from "@/lib/narrative/intros";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { HandoffStore } from "../store";
import { refreshPortsFromStore, users } from "../ports";
import { bySkuResolver, INTROS_DOC_ID, listIntrosLocal, liveCatalog, type IntrosDoc, type LivePart } from "../readers";

export { INTROS_DOC_ID, listIntrosLocal, type IntrosDoc };
import { photoDocIdForSku } from "../loaders/document";
import { withLock } from "../quote-repo";
import type { Impl as ImplOf } from "./util";

export const NARRATIVE_ACTIONS_KEY = "src/app/(app)/estimator/narrative-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

const NEEDS_CREATE = "Needs the Create permission.";
/** A client-sent alias longer than this is ignored (library.ts MAX_ALIAS_SKU). */
const MAX_ALIAS_SKU = 200;

/** library.ts keyProductLibrary over the store's live parts (pure given `partOf`). */
export function keyProductLibraryFrom(skus: readonly string[], aliases: Readonly<Record<string, string>> | null | undefined, partOf: (sku: string) => LivePart | undefined): Record<string, KeyProductLibraryRow> {
  const wanted = [
    ...new Set(
      (skus || [])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s && !isLineToken(s)),
    ),
  ].slice(0, MAX_LIBRARY_SKUS);
  const via = new Map<string, string>();
  for (const sku of wanted) {
    const m = aliases && Object.hasOwn(aliases, sku) ? aliases[sku] : undefined;
    const member = typeof m === "string" ? m.trim() : "";
    if (member && member !== sku && !isLineToken(member) && member.length <= MAX_ALIAS_SKU) via.set(sku, member);
  }
  const read = (sku: string) => via.get(sku) ?? sku;
  const out: Record<string, KeyProductLibraryRow> = {};
  for (const sku of wanted) {
    const p = partOf(read(sku));
    const text = p?.narrativeText && p.narrativeText.trim() ? p.narrativeText : null;
    out[sku] = {
      inCatalog: !!p,
      desc: p?.desc || "",
      paragraph: text,
      paragraphUpdatedAt: text ? p?.narrativeUpdatedAt ?? null : null,
      paragraphUpdatedBy: text ? p?.narrativeUpdatedBy ?? null : null,
      photoDocId: p ? photoDocIdForSku(p.sku) : null,
      // No manufacturer images in the slice: a part with no photo has no fallback image either.
      fallbackDocId: null,
      fallbackLabel: null,
      ...(p && via.has(sku) ? { viaSku: p.sku } : {}),
      ...(p
        ? { modelPart: { sku: p.sku, ...(p.manufacturerModelNumber ? { manufacturerModelNumber: p.manufacturerModelNumber } : {}), ...(p.manufacturerPartNumber ? { manufacturerPartNumber: p.manufacturerPartNumber } : {}) } }
        : {}),
    };
  }
  return out;
}

export function narrativeActions(store: HandoffStore): { [K in keyof A]: Impl<K> } {
  const resolver = async () => bySkuResolver(await liveCatalog(store), store.catalogRenames);

  const keyProductLibraryAction: Impl<"keyProductLibraryAction"> = async (skus, aliases) => {
    // #332: aliases are untrusted client input — only string → string entries reach the read.
    const clean: Record<string, string> = {};
    if (aliases && typeof aliases === "object" && !Array.isArray(aliases)) {
      for (const [k, v] of Object.entries(aliases).slice(0, MAX_LIBRARY_SKUS)) if (typeof k === "string" && typeof v === "string") clean[k] = v;
    }
    return keyProductLibraryFrom(Array.isArray(skus) ? skus.slice(0, MAX_LIBRARY_SKUS) : [], clean, await resolver());
  };

  const saveProductParagraphAction: Impl<"saveProductParagraphAction"> = async (sku, text, expectUpdatedAt) => {
    if (!users.can("create")) return { ok: false, error: NEEDS_CREATE };
    const user = users.current();
    const key = String(sku || "").trim();
    const body = String(text ?? "").replace(/\r\n?/g, "\n").trim();
    if (!body) return { ok: false, error: "Write the paragraph first." };
    if (body.length > MAX_PARAGRAPH) return { ok: false, error: `Keep the paragraph under ${MAX_PARAGRAPH.toLocaleString("en-US")} characters.` };
    const expect = expectUpdatedAt === undefined ? undefined : typeof expectUpdatedAt === "number" ? expectUpdatedAt : null;
    const part = key ? (await resolver())(key) : undefined;
    if (!part) return { ok: false, error: "Only catalog parts have a library paragraph." };
    if (expect !== undefined && (part.narrativeUpdatedAt ?? null) !== expect) {
      return { ok: false, error: "The library paragraph changed since you loaded it.", stale: { paragraph: part.narrativeText ?? null, updatedAt: part.narrativeUpdatedAt ?? null } };
    }
    // mergeUpsert onto the live part (a renamed part's old SKU lands on the part under its own sku/id).
    const stored = (await store.get<LivePart>("catalog", part.id)) ?? part;
    // mergeUpsert → writePart stamps updatedAt on every write (pricedAt stays: the price did not move)
    const now = Date.now();
    const saved: CatalogPart & { id: string } = { ...stored, narrativeText: body, narrativeUpdatedAt: now, narrativeUpdatedBy: user.name, updatedAt: now };
    await store.put("catalog", saved);
    const rows = keyProductLibraryFrom([saved.sku], null, await resolver());
    return { ok: true, row: rows[saved.sku] };
  };

  /** One intro operation on the stored list (stores/narrative-intros write()). */
  const writeIntro = (op: IntroOp) =>
    // #343: one operation on the STORED list, one write at a time (the blob's row lock).
    withLock("blob:narrative_intros", async () => {
      const by = users.current().name;
      await refreshPortsFromStore(store);
      const res = applyIntroOp(await listIntrosLocal(store), op, Date.now(), by, () => newIntroId(Math.random));
      // The original revalidates nothing: the caller replaces its list from the answer; the next props read sees the store.
      if (res.ok) await store.put<IntrosDoc>("intros", { id: INTROS_DOC_ID, intros: res.list });
      return res;
    });

  const upsertSystemIntroAction: Impl<"upsertSystemIntroAction"> = async (input) => {
    if (!users.can("create")) return { ok: false, error: NEEDS_CREATE };
    const res = await writeIntro({ kind: "upsert", intro: input });
    return res.ok ? { ok: true, intros: res.list, id: res.id } : { ok: false, error: res.error };
  };

  const deleteSystemIntroAction: Impl<"deleteSystemIntroAction"> = async (id) => {
    if (!users.can("create")) return { ok: false, error: NEEDS_CREATE };
    const res = await writeIntro({ kind: "delete", id: String(id || "") });
    return res.ok ? { ok: true, intros: res.list, id: null } : { ok: false, error: res.error };
  };

  return { keyProductLibraryAction, saveProductParagraphAction, upsertSystemIntroAction, deleteSystemIntroAction };
}
