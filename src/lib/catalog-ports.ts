import { CONNECTION_TYPES, type Port, type PortDirection } from "@/lib/catalog-connect";

/**
 * Parse / validate / serialize the catalog edit form's `ports` field (#158).
 *
 * Pure on purpose: no React and no database, so the rules that decide whether
 * a port is legal live in one place the unit tests, the server action and the
 * Phase 2 importer can all reach.
 *
 * The one rule that matters: `connectionType` must be a member of
 * CONNECTION_TYPES. validateDeviceWire() and compatibleWireTypes() both
 * resolve against that vocabulary, so a typo would not look wrong — it would
 * make the device silently unwireable against everything, with no error
 * anywhere. Refuse loudly instead (D189).
 */

export const PORT_DIRECTIONS: readonly PortDirection[] = ["in", "out", "io"];

export type PortsParse = { ok: true; ports: Port[] } | { ok: false; error: string };

const CONNECTION_SET: ReadonlySet<string> = new Set(CONNECTION_TYPES);

/** Compact JSON with a stable key order, so a no-op save produces no diff. */
export function serializePorts(ports: readonly Port[]): string {
  return JSON.stringify(
    ports.map((p) => ({
      name: p.name,
      direction: p.direction,
      connectionType: p.connectionType,
      ...(p.count != null && p.count !== 1 ? { count: p.count } : {}),
    }))
  );
}

export function parsePortsField(raw: unknown): PortsParse {
  const text = typeof raw === "string" ? raw.trim() : "";
  // A blank field means "no ports" — the editor always submits, and an empty
  // list is how a user deletes the last port. It is NOT an error.
  if (!text) return { ok: true, ports: [] };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ports could not be read. Remove the rows and re-add them." };
  }
  if (!Array.isArray(data)) return { ok: false, error: "Ports must be a list." };

  const ports: Port[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as Record<string, unknown> | null;
    const where = `Port ${i + 1}`;
    if (!row || typeof row !== "object") return { ok: false, error: `${where} is not a port.` };

    const direction = String(row.direction ?? "");
    if (!PORT_DIRECTIONS.includes(direction as PortDirection))
      return { ok: false, error: `${where}: "${direction}" is not a direction (in, out or io).` };

    const connectionType = String(row.connectionType ?? "");
    if (!CONNECTION_SET.has(connectionType))
      return { ok: false, error: `${where}: "${connectionType}" is not a known connection type.` };

    const port: Port = { name: String(row.name ?? "").trim(), direction: direction as PortDirection, connectionType };

    if (row.count != null && row.count !== "") {
      const count = Number(row.count);
      if (!Number.isInteger(count) || count < 1)
        return { ok: false, error: `${where}: count must be a whole number of 1 or more.` };
      if (count !== 1) port.count = count;
    }

    // Two ports with the same name + direction + connectionType are
    // meaningless, and the Grid's device inspector keys its port list on
    // `${port.name}-${port.connectionType}` — shipped code that assumes
    // uniqueness, so a duplicate collides there. Refuse loudly, same as
    // every other malformed row above, rather than silently storing it.
    const dupIndex = ports.findIndex(
      (p) => p.name === port.name && p.direction === port.direction && p.connectionType === port.connectionType
    );
    if (dupIndex !== -1)
      return {
        ok: false,
        error: `${where}: "${port.name || "(unnamed)"}" (${port.direction}, ${port.connectionType}) duplicates Port ${dupIndex + 1}.`,
      };

    ports.push(port);
  }
  return { ok: true, ports };
}
