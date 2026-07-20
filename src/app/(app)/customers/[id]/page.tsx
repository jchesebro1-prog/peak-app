import { redirect } from "next/navigation";

/** Customers became Companies with the identity core (D85) — old links live on. */
export default async function CustomerRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/companies/${encodeURIComponent(id)}`);
}
