/**
 * Curtain mounts (#292 §1.6) — the hardware each mount type uses when a
 * curtain has NO track: one settings blob, one top-level key per mount type
 * id (track_series idiom). Pure and client-safe; the store is
 * src/lib/stores/curtain-mounts.ts. Starts empty, never seeded, survives
 * go-live (clearDemoData never touches blobs).
 */
import { isMountTypeId, type CurtainMountTypeId } from "@/lib/curtain-cut-sheets/vocab";

export const CURTAIN_MOUNTS_BLOB = "curtain_mount_hardware";
export const MOUNT_ROWS_MAX = 30;
export const MOUNT_QTY_MAX = 1000;
const SKU_MAX = 80;

export type MountQtyRule =
  | { kind: "perCurtain"; qty: number } // qty per curtain
  | { kind: "perFtWidth"; qty: number; everyFt: number } // qty × ceil(W ÷ everyFt) per curtain
  | { kind: "perMark"; qty: number }; // qty × top-finish marks per curtain (ties, hooks)
export type MountHardwareRow = { sku: string; rule: MountQtyRule };
export type CurtainMountHardware = { rows: MountHardwareRow[]; updatedBy?: string; updatedAt?: number };

export const MOUNT_RULE_LABELS: Record<MountQtyRule["kind"], string> = {
  perCurtain: "Per curtain",
  perFtWidth: "Per feet of width",
  perMark: "Per grommet / carrier",
};

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}

function cleanRule(raw: unknown): MountQtyRule | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const qty = num(r.qty);
  if (!Number.isFinite(qty) || qty <= 0 || qty > MOUNT_QTY_MAX) return null;
  if (r.kind === "perCurtain" || r.kind === "perMark") return { kind: r.kind, qty };
  if (r.kind === "perFtWidth") {
    const everyFt = num(r.everyFt);
    if (!Number.isFinite(everyFt) || everyFt <= 0) return null;
    return { kind: "perFtWidth", qty, everyFt };
  }
  return null;
}

export function sanitizeMountRows(raw: unknown): MountHardwareRow[] {
  const out: MountHardwareRow[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const row = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
    const sku = typeof row?.sku === "string" ? row.sku.trim().slice(0, SKU_MAX) : "";
    const rule = cleanRule(row?.rule);
    if (!sku || !rule) continue;
    out.push({ sku, rule });
    if (out.length >= MOUNT_ROWS_MAX) break;
  }
  return out;
}

export type MountRowsCheck = { ok: true; rows: MountHardwareRow[] } | { ok: false; error: string };

/**
 * Strict form of sanitizeMountRows for a SAVE: names the first row that would
 * be dropped (blank part, bad quantity, bad every-ft) or the row cap, so a bad
 * row is refused instead of vanishing under a "Saved." message. Pure; the
 * Curtain mounts client runs the same check before submitting.
 */
export function validateMountRows(raw: unknown): MountRowsCheck {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MOUNT_ROWS_MAX) return { ok: false, error: `At most ${MOUNT_ROWS_MAX} rows per mount type.` };
  for (let i = 0; i < list.length; i++) {
    const row = list[i] && typeof list[i] === "object" ? (list[i] as Record<string, unknown>) : null;
    const sku = typeof row?.sku === "string" ? row.sku.trim() : "";
    const name = `Row ${i + 1}${sku ? ` (${sku})` : ""}`;
    if (!sku) return { ok: false, error: `${name}: pick a part.` };
    const rule = row?.rule && typeof row.rule === "object" ? (row.rule as Record<string, unknown>) : null;
    const qty = num(rule?.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MOUNT_QTY_MAX) return { ok: false, error: `${name}: quantity must be a number above 0 (up to ${MOUNT_QTY_MAX}).` };
    if (rule?.kind === "perFtWidth") {
      const everyFt = num(rule.everyFt);
      if (!Number.isFinite(everyFt) || everyFt <= 0) return { ok: false, error: `${name}: "every N feet" must be a number above 0.` };
    } else if (rule?.kind !== "perCurtain" && rule?.kind !== "perMark") {
      return { ok: false, error: `${name}: unknown quantity rule.` };
    }
  }
  return { ok: true, rows: sanitizeMountRows(list) };
}

export function sanitizeCurtainMounts(raw: unknown): Partial<Record<CurtainMountTypeId, CurtainMountHardware>> {
  const out: Partial<Record<CurtainMountTypeId, CurtainMountHardware>> = {};
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(r)) {
    if (!isMountTypeId(id) || !v || typeof v !== "object") continue;
    const hw = v as Record<string, unknown>;
    const entry: CurtainMountHardware = { rows: sanitizeMountRows(hw.rows) };
    if (typeof hw.updatedBy === "string") entry.updatedBy = hw.updatedBy;
    if (typeof hw.updatedAt === "number" && Number.isFinite(hw.updatedAt)) entry.updatedAt = hw.updatedAt;
    out[id] = entry;
  }
  return out;
}

/** One curtain's quantity for one row. */
export function mountRowQty(rule: MountQtyRule, curtain: { widthFt: number; marks: number }): number {
  switch (rule.kind) {
    case "perCurtain":
      return rule.qty;
    case "perFtWidth":
      return curtain.widthFt > 0 ? rule.qty * Math.ceil(curtain.widthFt / rule.everyFt - 1e-9) : 0;
    case "perMark":
      return rule.qty * Math.max(0, curtain.marks);
  }
}

/** The row "+ Add part" adds on the Curtain mounts screen. */
export const BLANK_MOUNT_DRAFT = { sku: "", kind: "perCurtain", qty: "1", everyFt: "" } as const;

/** An "+ Add part" row nobody touched — dropped before validation (final review #11); a partly filled row still refuses (client and server). */
export function isPristineMountDraft(r: { sku: string; kind: string; qty: string; everyFt: string }): boolean {
  return r.sku.trim() === "" && r.kind === BLANK_MOUNT_DRAFT.kind && r.qty.trim() === BLANK_MOUNT_DRAFT.qty && r.everyFt.trim() === "";
}
