import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { parseRegisterFilters } from "@/lib/assessments/register";
import { FINDING_KEY_RE } from "@/lib/assessments/findings-quote";
import { loadRegister } from "@/lib/assessments/register-server";
import FindingsRegister from "./controls";

export const metadata = { title: "Findings — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/**
 * The findings register (#340, spec §3 "Register screens"): every finding across assessments, filtered by
 * ?customer= ?venue= ?category= ?rating= ?status= ?priority= ?budget= (and ?voided=1, ?open=1 hides closed), Immediate attention pinned
 * first. Select rows for bulk Triage, Quote these findings or Export CSV; a row opens the finding sheet.
 * ?focus=<key> scrolls to that finding and opens it (⌘K) — shown even when the filters would leave it out.
 */
export default async function FindingsRegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const filters = parseRegisterFilters(sp);
  const focusRaw = one(sp.focus);
  const focus = FINDING_KEY_RE.test(focusRaw) ? focusRaw : "";
  const data = await loadRegister(filters, focus ? [focus] : []);
  return (
    <FindingsRegister
      rows={data.rows}
      customers={data.customers}
      venues={data.venues}
      total={data.total}
      filters={filters}
      focus={focus}
      canEdit={can("create", user.roles)}
      me={{ id: user.id, name: user.name }}
    />
  );
}
