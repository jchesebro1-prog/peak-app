import { getAllProjects, pendingConversions, syncProjectsFromQuotes } from "@/lib/stores/projects";
import { all as allCustomers } from "@/lib/stores/customers";
import { activeUsers } from "@/lib/users";
import { ensureProjectTasksMigrated, allTasks, type TaskRecord } from "@/lib/stores/tasks";
import type { Identity } from "./view";

/**
 * Shared loader for the Projects screen (list + detail routes). Mirrors the
 * prototype's on-load `ProjectStore.syncFromQuotes()` — won quotes that carry
 * install labor auto-materialize as projects/orders — then reads the book,
 * pending conversions, the customer directory (for rename-safe names) and the
 * active roster (crew options + note/crew avatars).
 */
export async function loadProjectsData(): Promise<{
  projects: Awaited<ReturnType<typeof getAllProjects>>;
  pending: Awaited<ReturnType<typeof pendingConversions>>;
  custById: Map<string, string>;
  identity: Identity[];
  roster: string[];
  taskRows: TaskRecord[];
  people: { id: string; name: string }[];
}> {
  await syncProjectsFromQuotes();
  const [projects, pending, customers, users] = await Promise.all([
    getAllProjects(),
    pendingConversions(),
    allCustomers(),
    activeUsers(),
  ]);
  // #17: promote any project's still-embedded tasks[] into the tasks
  // collection before reading it, so the detail tasks card (and anything
  // else keyed off allTasks()) always sees the migrated rows.
  await ensureProjectTasksMigrated(projects);
  const taskRows = await allTasks();
  const custById = new Map(customers.map((c) => [c.id, c.name || ""]));
  const identity: Identity[] = users.map((u) => ({
    name: u.name,
    color: u.color,
    initials: u.initials,
  }));
  const roster = users.map((u) => u.name);
  const people = users.map((u) => ({ id: u.id, name: u.name }));
  return { projects, pending, custById, identity, roster, taskRows, people };
}

/** Normalize a searchParams value to a single string. */
export function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const FILTERS = ["active", "risk", "orders", "complete", "all"];
export function normFilter(v: string): string {
  return FILTERS.includes(v) ? v : "active";
}
