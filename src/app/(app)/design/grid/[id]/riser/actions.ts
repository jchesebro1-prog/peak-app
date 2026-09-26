"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import { partForGrid } from "@/lib/design/grid-part-lookup";
import { RISER_OP_NAMES, isEndRef, type EndRef, type RiserOp } from "@/lib/design/grid-riser-doc";
import {
  addDevicesToNode,
  addRiserLink,
  patchRiser,
  removeNodeDevices,
  replaceNodeDevicePart,
  setNodeDeviceQty,
} from "@/lib/stores/grid-riser";

/**
 * Riser editor actions (#209). Same gate as every Grid edit (requireUser);
 * parts are validated here, geometry and the document live in the store.
 */

type Result = { ok: true } | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  "not-found": "Design not found.",
  "no-such-option": "That option was removed — refresh the page.",
  invalid: "That edit isn't valid — check the label and try again.",
  "no-such-space": "That space was removed — refresh the page.",
  "no-sheet": "Upload or generate a plan sheet first — devices need a plan to land on.",
  "bad-qty": "Quantity must be a whole number from 1 to 200.",
  "no-devices": "Those devices are no longer in this space — refresh the page.",
  "bad-end": "One end of that connection is no longer on the design — refresh the page.",
  "bad-length": "Type the cable length in feet (up to 5,000).",
  cap: "This riser already has the maximum number of these — remove one before adding another.",
};

function fail(reason: string): { ok: false; error: string } {
  return { ok: false, error: MESSAGES[reason] || "That change couldn't be saved." };
}

function revalidateGrid(projectId: string) {
  const base = `/design/grid/${encodeURIComponent(projectId)}`;
  revalidatePath(base);
  revalidatePath(`${base}/riser`);
  revalidatePath(`${base}/set`);
  revalidatePath(`${base}/schedule`);
}

async function devicePart(partId: string): Promise<string | null> {
  const part = await partForGrid(partId);
  if (!part) return "Pick a device from the Grid library.";
  if (isPerLengthUnit(part.unit)) return `${part.sku} is a per-length cable — use Connect for cable.`;
  return null;
}

/** Node layout, level lines, conduits, notes, link removal. */
export async function patchRiserAction(projectId: string, optionId: string, op: RiserOp): Promise<Result> {
  await requireUser();
  if (!op || !(RISER_OP_NAMES as readonly string[]).includes(op.op)) return { ok: false, error: "Unknown riser edit." };
  const r = await patchRiser(projectId, optionId, op);
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

/** Connect → a typed-length RiserLink (the client routes same-page device
 *  pairs through addRouteAction instead). */
export async function addRiserLinkAction(
  projectId: string,
  input: { optionId: string; from: EndRef; to: EndRef; partId: string; lengthFt: number }
): Promise<Result> {
  const user = await requireUser();
  if (!isEndRef(input.from) || !isEndRef(input.to)) return fail("bad-end");
  const part = await partForGrid(input.partId);
  if (!part) return { ok: false, error: "Pick a cable from the Grid library." };
  if (!isPerLengthUnit(part.unit))
    return { ok: false, error: `${part.sku} is priced per ${part.unit}, not per length — connections need a per-foot cable.` };
  const r = await addRiserLink(projectId, { ...input, lengthFt: Number(input.lengthFt), by: user.name });
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserAddDevicesAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number }
): Promise<Result> {
  const user = await requireUser();
  const bad = await devicePart(input.partId);
  if (bad) return { ok: false, error: bad };
  const r = await addDevicesToNode(projectId, { ...input, qty: Number(input.qty), by: user.name });
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserSetQtyAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string; qty: number }
): Promise<Result> {
  const user = await requireUser();
  const r = await setNodeDeviceQty(projectId, { ...input, qty: Number(input.qty), by: user.name });
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserReplacePartAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; fromPartId: string; toPartId: string }
): Promise<Result> {
  await requireUser();
  const bad = await devicePart(input.toPartId);
  if (bad) return { ok: false, error: bad };
  const r = await replaceNodeDevicePart(projectId, input);
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}

export async function riserRemoveDevicesAction(
  projectId: string,
  input: { optionId: string; nodeKey: string; partId: string }
): Promise<Result> {
  await requireUser();
  const r = await removeNodeDevices(projectId, input);
  if (!r.ok) return fail(r.reason);
  revalidateGrid(projectId);
  return { ok: true };
}
