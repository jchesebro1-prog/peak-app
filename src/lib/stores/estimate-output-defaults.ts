import { getBlob, setBlob } from "@/db/doc-store";
import { ESTIMATE_OUTPUT_BLOB, sanitizeEstimateOutputDefaults, type EstimateOutputDefaults } from "@/lib/estimate-output/fields";

/**
 * #301 slice A — Settings → Estimate output (R17). One settings blob, no
 * table, no migration (the narrative_intros idiom):
 *   estimate_output_defaults   { notIncluded: string; website: string }
 * Survives the go-live demo wipe (it's a settings blob).
 */

export async function getEstimateOutputDefaults(): Promise<EstimateOutputDefaults> {
  return sanitizeEstimateOutputDefaults(await getBlob<Record<string, unknown>>(ESTIMATE_OUTPUT_BLOB, {}));
}

export async function saveEstimateOutputDefaults(input: unknown): Promise<EstimateOutputDefaults> {
  const clean = sanitizeEstimateOutputDefaults(input);
  await setBlob(ESTIMATE_OUTPUT_BLOB, clean);
  return clean;
}
