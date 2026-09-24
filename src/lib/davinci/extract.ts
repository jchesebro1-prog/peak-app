/**
 * DaVinci `library.json` → the committed extract (#162, D8).
 *
 * The DaVinci export (`data/davinci/`) is 116 MB — 42 MB of `library.json`
 * plus 73 MB of images — gitignored, and exists on one machine. This distils
 * `library.json` into the ~1.34 MB `data/davinci-extract.json` that ships in
 * the repo: 1,720 device types, 14,108 indexed identifiers, 6,241 ports and
 * 2,836 document links. The extract deliberately covers every eligible type,
 * not just the ones that match today's catalog, so a future price-book
 * import needs no regeneration. Ports are mapped here, once, so the extract
 * is directly reviewable and the enricher never has to reason about
 * DaVinci's UUIDs.
 *
 * Deliberately tolerant of shape but NOT of unknown protocols or port
 * directions: mapProtocol throws and so does an unmapped direction, and
 * that is the point (D2).
 */
import type { Port } from "@/lib/catalog-connect";
import { normalizeSku } from "./sku";
import { DIRECTION_MAP, mapProtocol } from "./protocol-map";
import type { DavinciDoc, DavinciExtract, DavinciRecord } from "./types";

/** ETC's internal scratch category — never a product (D5). */
const EXCLUDED_CATEGORIES = new Set(["Internal-DO NOT USE"]);
const KEPT_DOC_TYPES: Record<string, DavinciDoc["kind"]> = { Datasheet: "datasheet", Manual: "manual" };

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" ? (v as Bag) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Constants are lists of `{ <thing>Id, constantName?, text? }`. */
function labelIndex(list: unknown, idKey: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of arr(list)) {
    const x = bag(raw);
    const id = str(x[idKey]);
    if (id) out.set(id, str(x.text) || str(x.constantName));
  }
  return out;
}

export function extractLibrary(lib: unknown): DavinciExtract {
  const L = bag(lib);
  const C = bag(L.constants);
  const langs = labelIndex(C.languages, "languageId");
  const docTypes = labelIndex(C.documentTypes, "documentTypeId");
  const cats = labelIndex(C.categories, "categoryId");
  const dirs = labelIndex(C.portDirections, "portDirectionId");
  const conns = labelIndex(C.connectorTypes, "connectorTypeId");

  const docs = new Map<string, Bag>();
  for (const raw of arr(bag(L.documents).documents)) {
    const x = bag(raw);
    const id = str(x.documentId);
    if (id) docs.set(id, x);
  }

  const records: DavinciRecord[] = [];
  for (const raw of arr(L.types)) {
    const t = bag(raw);
    const ti = bag(t.typeInformation);
    const category = cats.get(str(ti.categoryId)) || "";
    if (EXCLUDED_CATEGORIES.has(category)) continue;

    const ports: Port[] = [];
    for (const rawPort of arr(t.ports)) {
      const p = bag(rawPort);
      const connector = conns.get(str(p.connectorTypeId)) || "";
      const resolved = mapProtocol(str(p.portProtocolId), connector);
      if ("excluded" in resolved) continue;
      const dirLabel = dirs.get(str(p.portDirectionId)) || "";
      const direction = DIRECTION_MAP[dirLabel];
      if (!direction) {
        throw new Error(
          `#162 unmapped DaVinci port direction "${dirLabel}". A library revision has added a direction: ` +
            `add it to DIRECTION_MAP (src/lib/davinci/protocol-map.ts) after deciding what it is. ` +
            `Refusing to guess — a silently dropped port is missing signal with no indication anything is wrong.`
        );
      }
      ports.push({
        // DaVinci leaves most port names blank; the connector is the most
        // useful thing a human can be shown in its place.
        name: str(p.name) || connector,
        direction,
        connectionType: resolved.connectionType,
      });
    }

    const out: DavinciDoc[] = [];
    for (const id of arr(t.documents)) {
      const d = docs.get(str(id));
      if (!d) continue;
      const m = bag(d.metadata);
      if (langs.get(str(m.language)) !== "English") continue;
      const kind = KEPT_DOC_TYPES[docTypes.get(str(m.type)) || ""];
      if (!kind) continue;
      out.push({ kind, label: str(m.name), url: str(d.url) });
    }

    // A type with neither ports nor documents has nothing to give a catalog row.
    if (!ports.length && !out.length) continue;

    const ids = new Set<string>();
    for (const rawLut of arr(bag(bag(t.partInformation).generatorData).lookupData)) {
      const l = bag(rawLut);
      for (const k of ["modelNumber", "partNumber"] as const) {
        const v = normalizeSku(str(l[k]));
        if (v) ids.add(v);
      }
    }
    if (!ids.size) continue;

    records.push({
      typeId: str(t.typeId),
      displayName: str(ti.displayName),
      category,
      modelNumbers: [...ids],
      ports,
      docs: out,
    });
  }

  return { libraryTimestamp: str(L.timestamp), generatedAt: Date.now(), records };
}
