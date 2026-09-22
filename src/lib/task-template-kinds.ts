/**
 * The record kinds a task template can attach to (#118, D149) — kept in a
 * DB-free module so client components can import the labels without pulling
 * `@/lib/stores/task-templates` (→ doc-store → db → the `postgres` driver)
 * into the browser bundle. `template-sets-client.tsx` importing the store
 * directly is what broke the production build at 763febd.
 */
export type TemplateRecordKind = "project" | "quote" | "design";
export const TEMPLATE_RECORD_KINDS: TemplateRecordKind[] = ["project", "quote", "design"];
export const TEMPLATE_RECORD_LABEL: Record<TemplateRecordKind, string> = {
  project: "Projects",
  quote: "Quotes",
  design: "Designs",
};
