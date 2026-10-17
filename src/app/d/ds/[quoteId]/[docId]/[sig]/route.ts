import { serveEstimateDatasheet } from "@/lib/estimate-output/datasheet-link-server";

export const dynamic = "force-dynamic";

/** Spec 2026-10-16 §5 — a permanent datasheet link from the estimate PDF's last page. Public (middleware.ts
 *  exempts /d/ds/); the HMAC signature is the only key. */
export async function GET(req: Request, ctx: { params: Promise<{ quoteId: string; docId: string; sig: string }> }) {
  return serveEstimateDatasheet(req, await ctx.params);
}
