/**
 * Inbox organization §5 — load a sender-rule list (my rules / company-wide)
 * as plain rows: the rules blob, the customers' names and the team's names.
 */
import { getSenderRules } from "@/lib/stores/inbox-org";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import { allUsers } from "@/lib/users";
import { senderRuleRows, type SenderRuleRowVM } from "./rule-list";

export async function loadSenderRuleRows(which: { scope: "mine"; userId: string } | { scope: "company" }): Promise<SenderRuleRowVM[]> {
  const [rules, users] = await Promise.all([getSenderRules(), allUsers()]);
  const ids = [
    ...new Set(
      rules.flatMap((r) =>
        r.action.type === "file" && (which.scope === "company" ? r.scope === "company" : r.userId === which.userId) ? [r.action.customerId] : []
      )
    ),
  ];
  const names = new Map(await Promise.all(ids.map(async (id) => [id, await customerNameFor(id).catch(() => "")] as const)));
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  return senderRuleRows(rules, which, {
    customer: (id) => names.get(id) || null,
    user: (id) => userNames.get(id) ?? null,
  });
}
