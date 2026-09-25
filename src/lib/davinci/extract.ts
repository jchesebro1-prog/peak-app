/**
 * DaVinci `library.json` → the committed extract (#162, D8).
 *
 * The DaVinci export (`data/davinci/`) is 116 MB — 42 MB of `library.json`
 * plus 73 MB of images — gitignored, and exists on one machine. This distils
 * `library.json` into the ~2.65 MB `data/davinci-extract.json` that ships in
 * the repo: 1,720 device types, 14,108 indexed identifiers, 6,168 ports,
 * 2,828 document links and — since part documents (#207) — the fixture →
 * accessory graph: 6,702 links over 1,753 types. The extract deliberately covers every eligible type,
 * not just the ones that match today's catalog, so a future price-book
 * import needs no regeneration. Ports are mapped here, once, so the extract
 * is directly reviewable and the enricher never has to reason about
 * DaVinci's UUIDs.
 *
 * Deliberately tolerant of shape but NOT of unknown protocols or port
 * directions: mapProtocol throws and so does an unmapped direction, and
 * that is the point (D2).
 *
 * Two collapses happen here and nowhere else, because the extract is what the
 * enricher writes verbatim onto a catalog row:
 *  - ports identical on name+direction+connectionType become ONE port with a
 *    `count` (62 of 1,720 records carry duplicates; a Multiverse Transmitter
 *    has 6 ports, 4 distinct). `catalog-ports.parsePortsField` REFUSES
 *    duplicates — the Grid inspector keys on `${name}-${connectionType}` — so
 *    an un-collapsed record would make the enriched row un-saveable: any later
 *    save of that part, even a price change, would fail validation.
 *  - documents repeating a URL within one record become one (8 records). The
 *    catalog modal renders them with `key={d.url}`, so a repeat is both a
 *    duplicate React key and the same link shown twice.
 */
import type { Port } from "@/lib/catalog-connect";
import { normalizeSku } from "./sku";
import { DIRECTION_MAP, mapProtocol } from "./protocol-map";
import type { DavinciAccessoryLink, DavinciAccessoryType, DavinciDoc, DavinciExtract, DavinciRecord } from "./types";

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

/**
 * DaVinci writes `"2999-12-31 23:59:59"` — a space, no zone. A type is inactive
 * when it is flagged legacy or that date has passed. An absent or unparseable
 * date means "no evidence it was ever retired", which is active: this flag only
 * ever breaks a tie between two records claiming one identifier, so guessing
 * "inactive" on missing data would demote a live type for no reason.
 */
function isActive(typeActive: Bag, now: number): boolean {
  if (typeActive.legacy === true) return false;
  const raw = str(typeActive.endActiveDate).trim();
  if (!raw) return true;
  const ms = Date.parse(raw.replace(" ", "T"));
  return Number.isFinite(ms) ? ms > now : true;
}

export function extractLibrary(lib: unknown): DavinciExtract {
  const L = bag(lib);
  const C = bag(L.constants);
  const langs = labelIndex(C.languages, "languageId");
  const docTypes = labelIndex(C.documentTypes, "documentTypeId");
  const cats = labelIndex(C.categories, "categoryId");
  const dirs = labelIndex(C.portDirections, "portDirectionId");
  const conns = labelIndex(C.connectorTypes, "connectorTypeId");
  const mfrs = labelIndex(C.manufacturers, "manufacturerId");
  const classes = labelIndex(C.productClassifications, "productClassificationId");
  const now = Date.now();

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

    // Keyed on name+direction+connectionType — exactly the triple
    // parsePortsField refuses a repeat of — so a second identical port becomes
    // `count: 2` instead of a row the catalog editor can never save again.
    const ports: Port[] = [];
    const portAt = new Map<string, Port>();
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
      // DaVinci leaves most port names blank; the connector is the most
      // useful thing a human can be shown in its place.
      const name = str(p.name) || connector;
      const key = `${name}\u0000${direction}\u0000${resolved.connectionType}`;
      const already = portAt.get(key);
      if (already) {
        already.count = (already.count ?? 1) + 1;
        continue;
      }
      const port: Port = { name, direction, connectionType: resolved.connectionType };
      portAt.set(key, port);
      ports.push(port);
    }

    const out: DavinciDoc[] = [];
    const seenDocUrls = new Set<string>();
    for (const id of arr(t.documents)) {
      const d = docs.get(str(id));
      if (!d) continue;
      const m = bag(d.metadata);
      if (langs.get(str(m.language)) !== "English") continue;
      const kind = KEPT_DOC_TYPES[docTypes.get(str(m.type)) || ""];
      if (!kind) continue;
      const url = str(d.url);
      // Same URL twice in one type (8 records): the catalog modal keys its list
      // on the URL, so a repeat is a duplicate React key and a doubled link.
      if (seenDocUrls.has(url)) continue;
      seenDocUrls.add(url);
      out.push({ kind, label: str(m.name), url });
    }

    // A type with neither ports nor documents has nothing to give a catalog row.
    if (!ports.length && !out.length) continue;

    const ids = typeModelNumbers(t);
    if (!ids.length) continue;

    records.push({
      typeId: str(t.typeId),
      displayName: str(ti.displayName),
      category,
      manufacturer: mfrs.get(str(ti.manufacturerId)) || "",
      active: isActive(bag(ti.typeActive), now),
      modelNumbers: ids,
      ports,
      docs: out,
    });
  }

  const { accessoryTypes, accessoryLinks } = extractAccessoryGraph(arr(L.types), cats, mfrs, classes);
  return { libraryTimestamp: str(L.timestamp), generatedAt: Date.now(), records, accessoryTypes, accessoryLinks };
}

/** Every model and part number of a type, through normalizeSku. */
function typeModelNumbers(t: Bag): string[] {
  const ids = new Set<string>();
  for (const rawLut of arr(bag(bag(t.partInformation).generatorData).lookupData)) {
    const l = bag(rawLut);
    for (const k of ["modelNumber", "partNumber"] as const) {
      const v = normalizeSku(str(l[k]));
      if (v) ids.add(v);
    }
  }
  return [...ids];
}

/**
 * The fixture → accessory graph (#207, spec §6): `types[].accessories[]`
 * `{ typeId, maxQuantity, userDefinable }`, 7,937 links in the 2026-04-21
 * library. Both ends are kept by typeId, and every type a link touches gets
 * its model numbers here — records[] cannot serve, because it drops types
 * with neither ports nor documents, which is what most accessories are. A
 * link touching ETC's internal scratch category, or a type with no
 * identifiers (nothing a Peak SKU could ever match), is dropped.
 */
function extractAccessoryGraph(
  types: unknown[],
  cats: Map<string, string>,
  mfrs: Map<string, string>,
  classes: Map<string, string>
): { accessoryTypes: Record<string, DavinciAccessoryType>; accessoryLinks: DavinciAccessoryLink[] } {
  const byId = new Map<string, Bag>();
  for (const raw of types) {
    const t = bag(raw);
    const id = str(t.typeId);
    if (id && !EXCLUDED_CATEGORIES.has(cats.get(str(bag(t.typeInformation).categoryId)) || "")) byId.set(id, t);
  }
  const accessoryTypes: Record<string, DavinciAccessoryType> = {};
  const describe = (id: string): boolean => {
    if (accessoryTypes[id]) return true;
    const t = byId.get(id);
    if (!t) return false;
    const modelNumbers = typeModelNumbers(t);
    if (!modelNumbers.length) return false;
    const ti = bag(t.typeInformation);
    accessoryTypes[id] = {
      manufacturer: mfrs.get(str(ti.manufacturerId)) || "",
      classification: classes.get(str(ti.productClassificationId)) || "",
      modelNumbers,
    };
    return true;
  };
  const accessoryLinks: DavinciAccessoryLink[] = [];
  const seen = new Set<string>();
  for (const [parentTypeId, t] of byId) {
    for (const rawAcc of arr(t.accessories)) {
      const a = bag(rawAcc);
      const accessoryTypeId = str(a.typeId);
      if (!accessoryTypeId || accessoryTypeId === parentTypeId) continue;
      const key = `${parentTypeId}\u0000${accessoryTypeId}`;
      if (seen.has(key)) continue;
      if (!describe(parentTypeId) || !describe(accessoryTypeId)) continue;
      seen.add(key);
      const max = Number(a.maxQuantity);
      accessoryLinks.push({
        parentTypeId,
        accessoryTypeId,
        maxQuantity: Number.isFinite(max) && max > 0 ? max : 1,
        userDefinable: a.userDefinable === true,
      });
    }
  }
  return { accessoryTypes, accessoryLinks };
}
