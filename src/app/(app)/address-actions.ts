"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePerm, requireUser } from "@/lib/session";
import type { FixAddressResult } from "@/lib/address-verify/fix";
import type { FixTarget, FixTargetDetails, GeoStatus, LatLng, VerifyKind, VerifyList, VerifyStatusFilter } from "@/lib/address-verify/types";

/**
 * Address verification actions (spec 2026-10-09 "Fixing an address", "Where
 * flags show"). Fixing is open to any signed-in user — reps fix the
 * addresses on their own visits; the worklist lives in admin Settings.
 * Every input is untrusted: targets and fixes go through cleanFixTarget /
 * cleanFixInput, strings are type-checked and capped.
 */

export type AddressHit = { title: string; sub: string; street: string; city: string; state: string; zip: string; lat: number; lng: number };

const text = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function fixAddressAction(raw: unknown): Promise<FixAddressResult> {
  const me = await requireUser();
  const { cleanFixInput, fixAddress } = await import("@/lib/address-verify/fix");
  const input = cleanFixInput(raw);
  if (!input) return { ok: false, reason: "invalid" };
  const r = await fixAddress(input, me.id);
  if (r.ok) {
    // Spec trigger "address verified → re-sync upcoming legs touching it":
    // after the response, never blocking the save.
    const pointKey = r.pointKey;
    after(async () => {
      const { resyncForAddress } = await import("@/lib/drive-sync/sync");
      await resyncForAddress(pointKey).catch((err) => console.error("[drive-sync] address re-sync failed:", err));
    });
    revalidatePath("/", "layout");
  }
  return r;
}

export async function loadFixTargetAction(raw: unknown): Promise<FixTargetDetails | null> {
  await requireUser();
  const { cleanFixTarget, loadFixTarget } = await import("@/lib/address-verify/fix");
  const target = cleanFixTarget(raw);
  return target ? loadFixTarget(target) : null;
}

/** Address type-ahead for the Fix dialog (keeps zip for venue picks).
 *  `limit` (1–6, default 6) lets a caller that only wants the best match —
 *  centring the map on open — ask for one. */
export async function searchAddressAction(query: string, limit?: number): Promise<AddressHit[]> {
  await requireUser();
  const q = text(query, 200);
  if (q.length < 3) return [];
  const { search } = await import("@/lib/geo");
  const hits = await search(q, { limit: Math.max(1, Math.min(6, Math.floor(Number(limit)) || 6)) });
  return hits.map((h) => ({ title: h.title, sub: h.sub, street: h.street, city: h.city, state: h.state, zip: h.zip, lat: h.lat, lng: h.lng }));
}

/**
 * Map centre for the pin — the gated structured town lookup (#175 item 3):
 * recentres only on a town it is sure is the right one, else the caller
 * keeps its Wisconsin default.
 */
export async function townCentreForFixAction(city: string, state: string): Promise<LatLng | null> {
  await requireUser();
  const c = text(city, 100);
  const st = text(state, 40);
  if (!c) return null;
  const { searchCity } = await import("@/lib/geo");
  const { samePlace } = await import("@/lib/geo-backfill");
  const [hit] = await searchCity(c, st, { limit: 1 });
  return hit && samePlace(c, hit.city) ? { lat: hit.lat, lng: hit.lng } : null;
}

/**
 * The booking warning: is the address this visit will use verified? Never blocks.
 *
 * "live" mode geocodes an unseen free-text address and WRITES a place-book row
 * per distinct text. Callers must therefore invoke this on blur or debounced
 * (never per keystroke), or every half-typed address leaves a row behind.
 * Task 11's booking form calls it that way.
 */
export async function addressStatusAction(input: {
  customerId?: unknown;
  locationId?: unknown;
  address?: unknown;
}): Promise<{ status: GeoStatus; label: string; fix: FixTarget | null }> {
  await requireUser();
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const { addressStatesForVisits } = await import("@/lib/address-verify/targets");
  const states = await addressStatesForVisits(
    [{ id: "check", customerId: text(r.customerId, 200) || null, locationId: text(r.locationId, 200) || null, address: text(r.address, 300) }],
    "live"
  );
  const st = states.get("check");
  return st ? { status: st.status, label: st.label, fix: st.fix } : { status: "unresolved", label: "", fix: null };
}

export async function listAddressesToVerifyAction(input?: unknown): Promise<VerifyList> {
  await requirePerm("manage_users");
  const { listAddressesToVerify } = await import("@/lib/address-verify/worklist");
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = (["venue", "visit", "lead"] as const).find((k) => k === r.kind) as VerifyKind | undefined;
  const status = (["unverified", "needs_check", "unresolved"] as const).find((k) => k === r.status) as VerifyStatusFilter | undefined;
  return listAddressesToVerify({
    kind: kind ?? "all",
    status: status ?? "unverified",
    q: text(r.q, 100),
    offset: Number(r.offset) || 0,
    limit: Number(r.limit) || 50,
  });
}
