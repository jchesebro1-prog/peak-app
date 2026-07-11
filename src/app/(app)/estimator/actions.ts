"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  approve,
  claimReview,
  create,
  get,
  requestChanges,
  setStatus,
  STAGES,
  submitForReview,
  update,
  type Quote,
  type QuoteReview,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import type { SpecMob, SpecSection } from "./types";

/**
 * Estimator server actions — thin, session-gated wrappers over the quotes
 * store (the prototype called window.QuoteStore directly). The estimator
 * writes the prototype's exact payload field names; `contactName` and
 * `quoteNote` ride along on the quote doc exactly as they did in the
 * prototype (the Quote type doesn't promote them — spec/unknown fields
 * round-trip through the doc store).
 */

/** Quote doc fields the estimator writes beyond the promoted Quote columns. */
type QuoteExtras = {
  contactName?: string;
  quoteNote?: string;
  spec?: { sections: SpecSection[]; mobs: SpecMob[] };
};

type QuotePatch = Partial<Quote> & QuoteExtras;

export type SavePayload = {
  name: string;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  contactName: string;
  quoteNote: string;
  value: number;
  margin: number;
  status: QuoteStatus;
  sections: SpecSection[];
  mobs: SpecMob[];
};

export type SaveResult = {
  ok: boolean;
  id: string | null;
  revNum: number;
  updatedAt: number;
  review: QuoteReview | null;
  status: QuoteStatus | null;
};

export type ReviewSync = {
  ok: boolean;
  review: QuoteReview | null;
  status: QuoteStatus | null;
};

function refresh() {
  revalidatePath("/", "layout");
}

async function syncOf(id: string): Promise<ReviewSync> {
  const q = await get(id);
  return { ok: !!q, review: q?.review ?? null, status: q?.status ?? null };
}

/**
 * Save — port of the prototype's doSave(): update when a quote is loaded,
 * create otherwise. spec = { sections, mobs } (sections round-trip the
 * builder; mobs flow to the project on win).
 */
export async function saveQuoteAction(
  loadedId: string | null,
  payload: SavePayload
): Promise<SaveResult> {
  const user = await requireUser();
  const patch: QuotePatch = {
    name: payload.name,
    customer: payload.customer,
    customerId: payload.customerId || null,
    locationId: payload.locationId || null,
    contactName: payload.contactName || "",
    quoteNote: payload.quoteNote || "",
    value: payload.value,
    margin: payload.margin,
    status: payload.status,
    source: "estimator",
    spec: { sections: payload.sections, mobs: payload.mobs },
  };
  let q: Quote | null = null;
  if (loadedId) {
    q = await update(loadedId, patch);
  } else {
    const created = await create({ ...patch, owner: user.name });
    // create() promotes only the declared columns — stamp the extras + status.
    q = await update(created.id, {
      contactName: payload.contactName || "",
      quoteNote: payload.quoteNote || "",
    } as QuotePatch);
    if (payload.status !== "draft") q = await setStatus(created.id, payload.status);
    q = q || created;
  }
  refresh();
  return {
    ok: !!q,
    id: q?.id ?? null,
    revNum: Math.max(1, q?.history?.length || 1),
    updatedAt: q?.updatedAt ?? Date.now(),
    review: q?.review ?? null,
    status: q?.status ?? null,
  };
}

/** Header fields persisted immediately as they change (prototype behavior). */
export async function updateQuoteMetaAction(
  id: string,
  meta: {
    customerId?: string | null;
    locationId?: string | null;
    customer?: string;
    contactName?: string;
    quoteNote?: string;
  }
): Promise<{ ok: boolean }> {
  await requireUser();
  if (!id) return { ok: false };
  const q = await update(id, meta as QuotePatch);
  refresh();
  return { ok: !!q };
}

export async function setStatusAction(
  id: string,
  status: QuoteStatus
): Promise<ReviewSync> {
  await requireUser();
  if (!id || !STAGES.includes(status)) return { ok: false, review: null, status: null };
  await setStatus(id, status);
  refresh();
  return syncOf(id);
}

export async function submitReviewAction(
  id: string,
  reviewer: string | null
): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id) return { ok: false, review: null, status: null };
  await submitForReview(id, { by: user.name, reviewer: reviewer || null });
  refresh();
  return syncOf(id);
}

export async function claimReviewAction(id: string): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id || !can("approve", user.roles))
    return { ok: false, review: null, status: null };
  await claimReview(id, user.name);
  refresh();
  return syncOf(id);
}

export async function approveReviewAction(id: string): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id || !can("approve", user.roles))
    return { ok: false, review: null, status: null };
  await approve(id, { by: user.name });
  refresh();
  return syncOf(id);
}

export async function requestChangesAction(
  id: string,
  note: string
): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id || !can("approve", user.roles) || !(note || "").trim())
    return { ok: false, review: null, status: null };
  await requestChanges(id, { by: user.name, note: note.trim() });
  refresh();
  return syncOf(id);
}

/** "Send to customer →" — moves the approved quote to sent (prototype port). */
export async function sendToCustomerAction(id: string): Promise<ReviewSync> {
  await requireUser();
  if (!id) return { ok: false, review: null, status: null };
  await setStatus(id, "sent");
  refresh();
  return syncOf(id);
}
