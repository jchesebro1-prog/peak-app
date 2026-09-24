import type { Quote, QuoteStatus } from "./quotes";

/** Spawn the downstream record at the status transition that creates it.
 * Every called store uses the ambient DB transaction supplied by setStatus. */
export async function spawnFromQuote(quote: Quote, prevStatus: QuoteStatus): Promise<void> {
  if (quote.quoteType === "consulting") {
    const { ensureEngagementForQuote, syncEngagementsFromQuotes } = await import("./engagements");
    if (quote.status === "sent") await ensureEngagementForQuote(quote.id, "proposal_sent");
    else if (quote.status === "won") await ensureEngagementForQuote(quote.id, "awarded");
    else if (quote.status === "lost") await syncEngagementsFromQuotes();
    return;
  }
  if (quote.status !== "won" || prevStatus === "won") return;
  switch (quote.quoteType) {
    case "flame_test":
      await (await import("./flame-jobs")).createFromQuote(quote.id);
      break;
    case "repair":
      await (await import("./repair-jobs")).createFromQuote(quote.id);
      break;
    case "inspection":
      await (await import("./inspections")).createFromQuote(quote.id);
      break;
    case "rental":
      await (await import("./equipment-bookings")).createFromQuote(quote.id);
      break;
    default:
      await (await import("./projects")).createProjectFromQuote(quote.id);
      break;
  }
}
