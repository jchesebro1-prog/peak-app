import { randomInt } from "node:crypto";
import { getBlob, updateBlob } from "@/db/doc-store";
import { applyIntroOp, newIntroId, sanitizeIntroList, type IntroOp, type SystemIntro } from "@/lib/narrative/intros";

/**
 * #293 system-intro library store. One settings blob, no table, no migration
 * (portal_departments / gridDeviceTypes idiom):
 *   narrative_intros   { intros: SystemIntro[] }
 * Writes are ONE operation each (read → applyIntroOp → write), never a
 * full-list replacement from the client. Survives the go-live demo wipe and
 * Clear catalog price list (it's a settings blob).
 */

const INTROS_BLOB = "narrative_intros";

export async function listIntros(): Promise<SystemIntro[]> {
  const row = await getBlob<Record<string, unknown>>(INTROS_BLOB, {});
  return sanitizeIntroList(row.intros);
}

async function write(op: IntroOp, by: string) {
  // #343: the one operation is applied to the STORED list under the blob's
  // row lock, so two intros saved at the same moment both land.
  const now = Date.now();
  const out: { res?: ReturnType<typeof applyIntroOp> } = {};
  await updateBlob(INTROS_BLOB, (raw) => {
    const res = applyIntroOp(sanitizeIntroList(raw.intros), op, now, by, () => newIntroId(() => randomInt(0, 36) / 36));
    out.res = res;
    return res.ok ? { intros: res.list } : null;
  });
  return out.res!;
}

export function upsertIntro(input: unknown, by: string) {
  return write({ kind: "upsert", intro: input }, by);
}

export function deleteIntro(id: string, by: string) {
  return write({ kind: "delete", id: String(id || "") }, by);
}
