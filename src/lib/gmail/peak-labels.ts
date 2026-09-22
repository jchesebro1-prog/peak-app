/**
 * #96 §3 — the app-owned Gmail label namespace. Pure: names in, commands out.
 * Everything under Peak/ is ours; nothing else is ever read or written.
 */
import type { CommThread } from "@/lib/stores/comms";

export const PEAK_PREFIX = "Peak/";
const STATUS_LABEL: Record<string, string> = {
  waiting_us: "Peak/Status/Needs reply",
  waiting_them: "Peak/Status/Waiting",
  closed: "Peak/Status/Done",
};
const LABEL_STATUS: Record<string, "waiting_us" | "waiting_them" | "closed"> = {
  "Peak/Status/Needs reply": "waiting_us",
  "Peak/Status/Waiting": "waiting_them",
  "Peak/Status/Done": "closed",
};
const WORK_FOLDER: Record<string, "project" | "lead" | "quote"> = { Projects: "project", Leads: "lead", Quotes: "quote" };
const FOLDER_FOR_WORK: Record<string, string> = { project: "Projects", lead: "Leads", quote: "Quotes" };

export type PeakCommand =
  | { kind: "customer"; name: string }
  | { kind: "status"; status: "waiting_us" | "waiting_them" | "closed" }
  | { kind: "assign"; firstName: string }
  | { kind: "newLead" }
  | { kind: "work"; type: "project" | "lead" | "quote"; id: string };

export function parsePeakLabel(name: string): PeakCommand | null {
  if (!name.startsWith(PEAK_PREFIX)) return null;
  if (name === "Peak/New lead") return { kind: "newLead" };
  if (LABEL_STATUS[name]) return { kind: "status", status: LABEL_STATUS[name] };
  const rest = name.slice(PEAK_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const folder = rest.slice(0, slash);
  const leaf = rest.slice(slash + 1).trim();
  if (!leaf) return null;
  if (folder === "Customers") return { kind: "customer", name: leaf };
  if (folder === "Assign") return { kind: "assign", firstName: leaf };
  if (WORK_FOLDER[folder]) return { kind: "work", type: WORK_FOLDER[folder], id: leaf };
  return null;
}

export function labelForStatus(status: string): string | null {
  return STATUS_LABEL[status] || null;
}

export function desiredPeakLabels(
  t: Pick<CommThread, "customer" | "status" | "assignedTo" | "link">
): string[] {
  const out: string[] = [];
  if (t.customer) out.push("Peak/Customers/" + t.customer.replace(/\//g, "-"));
  const s = labelForStatus(t.status);
  if (s) out.push(s);
  if (t.assignedTo) out.push("Peak/Assign/" + t.assignedTo.split(" ")[0]);
  if (t.link && FOLDER_FOR_WORK[t.link.type]) out.push("Peak/" + FOLDER_FOR_WORK[t.link.type] + "/" + t.link.id);
  return out;
}

export function diffLabels(desired: string[], current: string[]): { add: string[]; remove: string[] } {
  const want = new Set(desired);
  const have = new Set(current);
  return {
    add: desired.filter((n) => !have.has(n)),
    remove: current.filter((n) => n.startsWith(PEAK_PREFIX) && !want.has(n)),
  };
}
