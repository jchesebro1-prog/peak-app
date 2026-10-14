/* S8 Project and quote — budget, deadline, decision maker, quote format (rule X3). Off on a condition
   visit; the assessor can switch it on. */
import type { ScopeDef } from "../types";
import { date, num, one, RULE_ONLY, text, yn } from "../q";

export const PROJECT_SCOPE: ScopeDef = {
  code: "S8",
  key: "project",
  title: "Project and quote",
  modules: [
    {
      id: "project.details",
      title: "Project",
      when: RULE_ONLY,
      questions: [
        date("project.deadline", "Completion deadline"),
        num("project.budget", "Budget"),
        one("project.pricing", "Budgetary or firm pricing", "pricing"),
        one("project.type", "Project type", "project_type"),
        yn("project.larger_project", "Part of a larger building project?"),
        text("project.decision_maker", "Final decision maker"),
        text("project.other_firms", "Other firms involved"),
      ],
    },
  ],
};
