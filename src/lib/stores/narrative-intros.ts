import { randomInt } from "node:crypto";
import { getBlob, setBlob } from "@/db/doc-store";
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
  const list = await listIntros();
  const res = applyIntroOp(list, op, Date.now(), by, () => newIntroId(() => randomInt(0, 36) / 36));
  if (!res.ok) return res;
  await setBlob(INTROS_BLOB, { intros: res.list });
  return res;
}

export function upsertIntro(input: unknown, by: string) {
  return write({ kind: "upsert", intro: input }, by);
}

export function deleteIntro(id: string, by: string) {
  return write({ kind: "delete", id: String(id || "") }, by);
}
