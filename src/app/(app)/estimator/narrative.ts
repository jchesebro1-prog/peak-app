import type { SpecSection } from "./types";

function clauseForSection(sec: SpecSection): string | null {
  const items = (sec.items || []).filter((it) => !it.option && it.qty > 0);
  if (!items.length) return null;
  if (sec.kind === "labor") {
    return "installation, commissioning, project management, and field coordination";
  }
  const names = items
    .map((it) => (it.allowance ? `a budget allowance for ${it.desc}` : it.desc))
    .slice(0, 3);
  const extra = items.length - names.length;
  const listed = names.join(", ");
  return extra > 0 ? `${listed}, and ${extra} additional items` : listed;
}

export function buildEstimatorNarrative(sections: SpecSection[]): string {
  const visible = (sections || []).filter((sec) => (sec.items || []).some((it) => !it.option && it.qty > 0));
  if (!visible.length) {
    return "This proposal covers the systems reviewed with your team, with final quantities and coordination to be confirmed before release.";
  }
  const materialClauses = visible
    .filter((sec) => sec.kind !== "labor")
    .map((sec) => {
      const clause = clauseForSection(sec);
      return clause ? `${sec.name} including ${clause}` : null;
    })
    .filter(Boolean) as string[];
  const laborClause = visible
    .filter((sec) => sec.kind === "labor")
    .map((sec) => clauseForSection(sec))
    .find(Boolean);

  const sentences: string[] = [];
  if (materialClauses.length) {
    sentences.push(`This proposal includes ${materialClauses.join("; ")}.`);
  } else {
    sentences.push("This proposal includes the systems and equipment reviewed with your team.");
  }
  if (laborClause) {
    sentences.push(`The quoted scope also covers ${laborClause}.`);
  }
  sentences.push("Final quantities, mounting conditions, and field coordination will be confirmed before release for order.");
  return sentences.join(" ");
}
