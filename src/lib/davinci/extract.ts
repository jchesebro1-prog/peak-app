import type { Port } from "@/lib/catalog-connect";
import { directionFor, mapProtocol } from "./protocol-map";

export type DavinciDoc = { kind: "datasheet" | "manual"; label: string; url: string };
export type DavinciRecord = {
  modelNumbers: string[];
  displayName: string;
  category: string;
  ports: Port[];
  docs: DavinciDoc[];
  typeId: string;
  libraryTimestamp: string;
};

const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const first = (o: Record<string, unknown>, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v != null);

/** Convert the vendor library's JSON shape to the small, reviewable extract shape. */
export function extractLibrary(libraryJson: unknown): DavinciRecord[] {
  const root = (libraryJson && typeof libraryJson === "object" ? libraryJson : {}) as Record<string, unknown>;
  const types = arr(root.deviceTypes ?? root.types ?? root.products);
  const libraryTimestamp = text(root.libraryTimestamp ?? root.timestamp ?? root.exportedAt);
  return types.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    const category = text(first(o, "category", "categoryName"));
    if (category === "Internal-DO NOT USE" || text(first(o, "name", "displayName")) === "RouteStubPrototype") return [];
    const models = arr(o.modelNumbers ?? o.modelNumber ?? o.partNumbers ?? o.partNumber).map(text).filter(Boolean);
    const ports: Port[] = [];
    for (const rawPort of arr(o.ports)) {
      if (!rawPort || typeof rawPort !== "object") continue;
      const p = rawPort as Record<string, unknown>;
      const mapped = mapProtocol(text(first(p, "protocolId", "protocol", "protocolUuid")), text(first(p, "connectorName", "connector", "connectorLabel")));
      if ("excluded" in mapped) continue;
      ports.push({ name: text(first(p, "name", "displayName")) || mapped.connectionType, direction: directionFor(text(first(p, "direction", "directionName"))), connectionType: mapped.connectionType, ...(Number(p.count) > 1 ? { count: Number(p.count) } : {}) });
    }
    const docs: DavinciDoc[] = arr(o.documents ?? o.docs).flatMap((d) => {
      if (!d || typeof d !== "object") return [];
      const x = d as Record<string, unknown>;
      const kindRaw = text(first(x, "kind", "type")).toLowerCase().replace(/[\s_-]+/g, "");
      const kind = kindRaw === "datasheet" ? "datasheet" : kindRaw === "manual" ? "manual" : "";
      const url = text(first(x, "url", "href"));
      if (!url || !kind || (text(first(x, "language", "lang")) && !/^en(?:glish)?$/i.test(text(first(x, "language", "lang"))))) return [];
      return [{ kind: kind as "datasheet" | "manual", label: text(first(x, "label", "name")) || kind, url }];
    });
    if (!models.length) return [];
    return [{ modelNumbers: models, displayName: text(first(o, "displayName", "name")), category, ports, docs, typeId: text(first(o, "id", "typeId", "uuid")), libraryTimestamp }];
  });
}
