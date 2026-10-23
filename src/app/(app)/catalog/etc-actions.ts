"use server";

/**
 * #368 — Catalog → Import → Connect a manufacturer (ETC). Every action but
 * the status read is admin-only (`manage_users`, the Catalog's other admin
 * tools' gate), and every one of them refuses on a Vercel preview deploy or
 * with ETC_SYNC_DISABLED=true (`etcBlockedReason`, the drawer's own copy).
 * Nothing here returns the API key: the drawer gets `last4`
 * through `etcStatus()`; the key is decrypted only inside the ETC client.
 */
import { revalidatePath } from "next/cache";
import { requirePerm, requireUser } from "@/lib/session";
import { clearEtcKey, etcBlockedReason, etcStatus, readEtcConnection, recordEtcTest, saveEtcKey, setEtcAccount, type EtcStatus } from "@/lib/dealer-api/connections";
import { listAccounts, type EtcAccount } from "@/lib/dealer-api/etc/client";
import { applyBatch, ETC_IMPORT_BUDGET_MS, pullAll, type EtcBatchResult, type EtcPullResult } from "@/lib/dealer-api/etc/apply";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { invalidateSystemLibrary } from "@/lib/narrative/system-library-index";

type Fail = { ok: false; error: string };

/** Anyone signed in sees the status line. */
export async function etcStatusAction(): Promise<EtcStatus> {
  await requireUser();
  return etcStatus();
}

export async function saveEtcKeyAction(key: string): Promise<{ ok: true; status: EtcStatus } | Fail> {
  const user = await requirePerm("manage_users");
  const blocked = etcBlockedReason();
  if (blocked) return { ok: false, error: blocked };
  try {
    await saveEtcKey(typeof key === "string" ? key : "", user.name);
  } catch (e) {
    // saveEtcKey's messages never carry the key.
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the key." };
  }
  return { ok: true, status: await etcStatus() };
}

export async function clearEtcKeyAction(): Promise<{ ok: true; status: EtcStatus } | Fail> {
  await requirePerm("manage_users");
  const blocked = etcBlockedReason();
  if (blocked) return { ok: false, error: blocked };
  await clearEtcKey();
  return { ok: true, status: await etcStatus() };
}

/**
 * Test connection: list the key's business accounts. One → picked; the picked
 * one gone → cleared; several → the admin picks.
 */
export async function testEtcAction(): Promise<{ ok: true; accounts: EtcAccount[]; status: EtcStatus } | Fail> {
  await requirePerm("manage_users");
  const blocked = etcBlockedReason();
  if (blocked) return { ok: false, error: blocked };
  const r = await listAccounts();
  if (!r.ok) {
    // Remembered so the drawer stops saying "Connected" until a test succeeds.
    await recordEtcTest(false, r.message);
    return { ok: false, error: r.message };
  }
  await recordEtcTest(true, "");
  const conn = await readEtcConnection();
  const current = conn.accountId ? r.data.find((a) => a.id === conn.accountId) : undefined;
  if (r.data.length === 1) await setEtcAccount(r.data[0].id, r.data[0].name);
  else if (current) await setEtcAccount(current.id, current.name);
  else if (conn.accountId) await setEtcAccount(null, null);
  if (!r.data.length) return { ok: false, error: "The key works, but it can't see any ETC business account." };
  return { ok: true, accounts: r.data, status: await etcStatus() };
}

/** Pick one of the key's accounts — checked against ETC again, never trusted from the client. */
export async function pickEtcAccountAction(accountId: string): Promise<{ ok: true; status: EtcStatus } | Fail> {
  await requirePerm("manage_users");
  const blocked = etcBlockedReason();
  if (blocked) return { ok: false, error: blocked };
  const r = await listAccounts();
  if (!r.ok) return { ok: false, error: r.message };
  const a = r.data.find((x) => x.id === String(accountId ?? ""));
  if (!a) return { ok: false, error: "That account isn't on this key." };
  await setEtcAccount(a.id, a.name);
  return { ok: true, status: await etcStatus() };
}

/** Pull prices: fetch the four lists and return the preview. Writes no part. */
export async function pullEtcAction(): Promise<EtcPullResult> {
  await requirePerm("manage_users");
  const blocked = etcBlockedReason();
  if (blocked) return { ok: false, error: blocked };
  return pullAll();
}

/** One Import batch (≤ 40 s); the drawer loops until `finished`. */
export async function importEtcBatchAction(): Promise<EtcBatchResult> {
  await requirePerm("manage_users");
  const blocked = etcBlockedReason();
  if (blocked) return { ok: false, error: blocked };
  const r = await applyBatch({ budgetMs: ETC_IMPORT_BUDGET_MS });
  if (r.ok) {
    // The portal catalog and the system library cache parts and prices.
    invalidatePortalIndex();
    invalidateSystemLibrary();
  }
  if (r.ok && r.finished) revalidatePath("/catalog");
  return r;
}
