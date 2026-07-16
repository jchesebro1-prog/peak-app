import { getBlob, setBlob } from "@/db/doc-store";

/**
 * Design Studio saved designs (IDEAS — design tab, save per venue). Small
 * volume, admin-of-their-own-work; stored as a keyed blob (like portal
 * grants) so no migration is needed. Each design captures a tool's full
 * state (Lineset Builder inputs, or the Lineset Weights schedule) and an
 * optional customer/venue link so it can be reopened later.
 */

export type StudioDesignKind = "lineset" | "weights";

export type StudioDesign = {
  id: string;
  name: string;
  kind: StudioDesignKind;
  customerId: string | null;
  customer: string; // denormalized display name
  /** Tool state — LinesetInputs for "lineset", { defaults, lines } for "weights". */
  data: unknown;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  deleted?: boolean;
};

const BLOB_ID = "studio_designs";
type DesignMap = Record<string, StudioDesign>;

function newId(): string {
  // crypto-random short id (server-side).
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "DS-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function allMap(): Promise<DesignMap> {
  return getBlob<DesignMap>(BLOB_ID, {});
}

/** All live designs, newest first, optionally filtered by kind and/or customer. */
export async function listDesigns(opts: { kind?: StudioDesignKind; customerId?: string } = {}): Promise<StudioDesign[]> {
  const map = await allMap();
  return Object.values(map)
    .filter((d) => !d.deleted)
    .filter((d) => (opts.kind ? d.kind === opts.kind : true))
    .filter((d) => (opts.customerId ? d.customerId === opts.customerId : true))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getDesign(id: string): Promise<StudioDesign | null> {
  const d = (await allMap())[id];
  return d && !d.deleted ? d : null;
}

/** Create or update a design. Returns the saved record. */
export async function saveDesign(input: {
  id?: string | null;
  name: string;
  kind: StudioDesignKind;
  customerId: string | null;
  customer: string;
  data: unknown;
  by: string;
}): Promise<StudioDesign> {
  const now = Date.now();
  const map = await allMap();
  const existing = input.id ? map[input.id] : undefined;
  const design: StudioDesign = {
    id: existing?.id || newId(),
    name: input.name.trim() || "Untitled design",
    kind: input.kind,
    customerId: input.customerId,
    customer: input.customer,
    data: input.data,
    createdBy: existing?.createdBy || input.by,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: input.by,
    deleted: false,
  };
  await setBlob(BLOB_ID, { [design.id]: design });
  return design;
}

/** Soft-delete a design (blob merge can't drop keys). */
export async function removeDesign(id: string): Promise<void> {
  const map = await allMap();
  const d = map[id];
  if (!d) return;
  await setBlob(BLOB_ID, { [id]: { ...d, deleted: true, updatedAt: Date.now() } });
}
