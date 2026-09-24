/**
 * DaVinci `library.json` → the committed extract (#162, D8).
 *
 * The full library is 116 MB, gitignored, and exists on one machine. This
 * distils it to the 0.52 MB `data/davinci-extract.json` that ships in the repo:
 * 908 device types, 7,083 indexed identifiers, 2,335 ports and 1,173 document
 * links. Ports are mapped here, once, so the extract is directly reviewable and
 * the enricher never has to reason about DaVinci's UUIDs.
 *
 * Deliberately tolerant of shape but NOT of unknown protocols: mapProtocol
 * throws, and that is the point (D2).
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
      const direction = DIRECTION_MAP[dirs.get(str(p.portDirectionId)) || ""];
      if (!direction) continue;
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
