/**
 * Business-data snapshot for the "Ask about your business data" assistant
 * (Phase 8, MASTER-QUESTIONS D5). Server-only: it reads the live stores and
 * renders a compact plain-text snapshot the AI answers questions over. Kept in
 * the assistant route folder so the ai/ layer stays store-decoupled.
 *
 * The snapshot is deliberately compact — enough facts to answer the common
 * "how's the pipeline / what's due / who's waiting" questions with real numbers
 * and names, without dumping every record. The model is instructed (in
 * features.answerBusinessQuestion) to answer ONLY from this snapshot and to say
 * so when a question needs data that isn't here.
 */

import { money } from "@/lib/format";
import * as Quotes from "@/lib/stores/quotes";
import * as Customers from "@/lib/stores/customers";
import * as Leads from "@/lib/stores/leads";
import * as Projects from "@/lib/stores/projects";
import * as Flame from "@/lib/stores/flame-jobs";
import * as Repairs from "@/lib/stores/repair-jobs";
import * as Comms from "@/lib/stores/comms";

function line(label: string, value: string | number): string {
  return `- ${label}: ${value}`;
}

export async function buildBusinessSnapshot(me: string): Promise<string> {
  const out: string[] = [];
  const asOf = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  out.push(`As of ${asOf}. Signed-in user: ${me}.`);

  /* ---- Quotes / pipeline ---- */
  try {
    const quotes = await Quotes.getAll();
    const by = (s: string) => quotes.filter((q) => q.status === s);
    const draft = by("draft");
    const sent = by("sent");
    const won = by("won");
    const lost = by("lost");
    const openValue = [...draft, ...sent].reduce((n, q) => n + (q.value || 0), 0);
    const wonValue = won.reduce((n, q) => n + (q.value || 0), 0);
    out.push("");
    out.push("QUOTES / PIPELINE");
    out.push(line("Total quotes", quotes.length));
    out.push(
      line(
        "By stage",
        `draft ${draft.length}, sent ${sent.length}, won ${won.length}, lost ${lost.length}`
      )
    );
    out.push(line("Open pipeline value (draft+sent)", money(openValue)));
    out.push(line("Won value", money(wonValue)));
    // A few biggest open quotes, with customer + value.
    const topOpen = [...draft, ...sent]
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 6);
    if (topOpen.length) {
      out.push("Largest open quotes:");
      for (const q of topOpen) {
        out.push(
          `  · ${q.name || q.id} — ${q.customer || "(unlinked)"} — ${money(
            q.value
          )} [${Quotes.STAGE_LABEL[q.status]}]${
            q.owner ? " · owner " + q.owner : ""
          }`
        );
      }
    }
  } catch (e) {
    console.error("[assistant] quotes snapshot failed:", e);
  }

  /* ---- Leads ---- */
  try {
    const open = await Leads.open();
    const followUps = await Leads.followUps();
    const unassigned = await Leads.unassigned();
    out.push("");
    out.push("LEADS");
    out.push(line("Open leads", open.length));
    out.push(line("Needing follow-up", followUps.length));
    out.push(line("Unassigned", unassigned.length));
  } catch (e) {
    console.error("[assistant] leads snapshot failed:", e);
  }

  /* ---- Flame-test renewals ---- */
  try {
    const due = await Flame.renewals({ dueOnly: true });
    const overdue = due.filter((r) => r._renewal.state === "overdue");
    const dueSoon = due.filter((r) => r._renewal.state === "due_soon");
    out.push("");
    out.push("FLAME-TEST RENEWALS");
    out.push(line("Overdue", overdue.length));
    out.push(line("Due soon", dueSoon.length));
    const show = [...overdue, ...dueSoon].slice(0, 8);
    if (show.length) {
      out.push("Due venues:");
      for (const r of show) {
        out.push(
          `  · ${r.customer || "(customer)"}${
            r.venue ? " — " + r.venue : ""
          } — ${r._renewal.state}${
            r._renewal.days != null ? " (" + r._renewal.days + "d)" : ""
          }`
        );
      }
    }
  } catch (e) {
    console.error("[assistant] flame snapshot failed:", e);
  }

  /* ---- Repairs ---- */
  try {
    const all = await Repairs.getAll();
    const openJobs = all.filter((r) => r.stage !== "completed");
    out.push("");
    out.push("REPAIRS");
    out.push(line("Open repair jobs", openJobs.length));
    out.push(line("Completed", all.length - openJobs.length));
  } catch (e) {
    console.error("[assistant] repairs snapshot failed:", e);
  }

  /* ---- Projects ---- */
  try {
    const all = await Projects.getAllProjects();
    const active = all.filter((p) => p.stage !== "complete");
    out.push("");
    out.push("PROJECTS / INSTALLS");
    out.push(line("Active projects/orders", active.length));
    out.push(line("Total", all.length));
  } catch (e) {
    console.error("[assistant] projects snapshot failed:", e);
  }

  /* ---- Inbox ---- */
  try {
    const needs = await Comms.needsReplyCount(me);
    const unread = await Comms.unreadCount(me);
    out.push("");
    out.push("INBOX (your view)");
    out.push(line("Threads needing a reply", needs));
    out.push(line("Unread", unread));
  } catch (e) {
    console.error("[assistant] inbox snapshot failed:", e);
  }

  /* ---- Customers ---- */
  try {
    const all = await Customers.all();
    out.push("");
    out.push("CUSTOMERS");
    out.push(line("Total customers", all.length));
  } catch (e) {
    console.error("[assistant] customers snapshot failed:", e);
  }

  return out.join("\n");
}
