import { redirect } from "next/navigation";

/**
 * Lineset Weights merged into the Lineset Builder (PUNCHLIST #6, D78) —
 * this route now just forwards, preserving saved-design deep links
 * (?design= loads legacy weights records via the Builder's adapter).
 */
export default async function WeightsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const design = Array.isArray(sp.design) ? sp.design[0] : sp.design;
  redirect(
    "/design-studio/lineset" + (design ? "?design=" + encodeURIComponent(design) : "")
  );
}
