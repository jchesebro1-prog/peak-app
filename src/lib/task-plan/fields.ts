/** Task-form tier/size chips (spec Part 1 "New fields"). Pure, client-safe. */
import { cleanSize, cleanTier, DEFAULT_SIZE, DEFAULT_TIER, type TaskSize, type TaskTier } from "./types";

type FormLike = { has(name: string): boolean; get(name: string): unknown };

/** A form's High/Normal/Low and S/M/L chips. A form without the chips
 *  changes nothing; a chip value that isn't valid reads as the default. */
export function readTierSize(fd: FormLike): { priority?: TaskTier; size?: TaskSize } {
  const out: { priority?: TaskTier; size?: TaskSize } = {};
  if (fd.has("priority")) out.priority = cleanTier(fd.get("priority")) ?? DEFAULT_TIER;
  if (fd.has("size")) out.size = cleanSize(fd.get("size")) ?? DEFAULT_SIZE;
  return out;
}

/** Only the valid tier/size of an untrusted object (records, JSON action input). */
export function tierSizeOf(input: unknown): { priority?: TaskTier; size?: TaskSize } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: { priority?: TaskTier; size?: TaskSize } = {};
  const p = cleanTier(o.priority);
  const s = cleanSize(o.size);
  if (p) out.priority = p;
  if (s) out.size = s;
  return out;
}
