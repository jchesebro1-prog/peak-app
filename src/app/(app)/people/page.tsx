import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  allContacts,
  displayName,
  emailsForContacts,
  phonesForContacts,
} from "@/lib/identity/contacts";
import { allCompanies } from "@/lib/identity/companies";
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABEL,
  type ContactStatus,
} from "@/lib/identity/config";
import EditPersonModal from "./edit-modal";
import { PeopleFilterBar } from "./controls";
import type { SavePersonInput } from "./types";

export const metadata = { title: "People — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .pe-row:hover { background: #fafbff; }
  @media (max-width: 720px) {
    .pe-row-channels { display: none !important; }
  }
`;

const STATUS_CHIP: Record<ContactStatus, { ink: string; soft: string }> = {
  active: { ink: "#1f7a52", soft: "#e7f4ee" },
  former: { ink: "#8c919c", soft: "#f1f2f5" },
  do_not_contact: { ink: "#b03a2e", soft: "#faece9" },
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, people, companies] = await Promise.all([
    requireUser(),
    searchParams,
    allContacts(),
    allCompanies(),
  ]);
  const [emailsBy, phonesBy] = await Promise.all([
    emailsForContacts(people.map((p) => p.id)),
    phonesForContacts(people.map((p) => p.id)),
  ]);

  const q = one(sp.q);
  const companyParam = one(sp.company) || "all";
  // Pickers default to active (spec §5.4) — search finds everyone on demand.
  const status = one(sp.status) || "active";
  const edit = one(sp.edit);

  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  const ql = q.trim().toLowerCase();
  const filtered = people.filter((p) => {
    if (status !== "all" && p.status !== status) return false;
    if (companyParam !== "all" && p.homeCompanyId !== companyParam) return false;
    if (ql) {
      const hay = [
        displayName(p),
        p.title,
        p.homeCompanyId ? companyName.get(p.homeCompanyId) || "" : "",
        ...(emailsBy.get(p.id) ?? []).map((e) => e.email),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });

  const companyOptions = companies.map((c) => ({ id: c.id, name: c.name }));
  const statusOptions = [
    ...CONTACT_STATUSES.map((s) => ({ value: s, label: CONTACT_STATUS_LABEL[s] })),
    { value: "all", label: "Everyone" },
  ];

  const hasPeople = people.length > 0;

  return (
    <>
      <style>{CSS}</style>
      <div className="pk-content" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>People</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>
              {filtered.length}
              {status !== "all" ? ` ${CONTACT_STATUS_LABEL[status as ContactStatus] ?? status}` : ""}
            </span>
          </div>
          <Link
            href="/people?edit=new"
            style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}
          >
            + New
          </Link>
        </div>

        {hasPeople && (
          <PeopleFilterBar
            q={q}
            company={companyParam}
            status={status}
            companyOptions={companyOptions}
            statusOptions={statusOptions}
          />
        )}

        {!hasPeople ? (
          <div className="pk-card" style={{ padding: "60px 30px", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>No people yet</div>
            <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6 }}>
              People are the contacts your quotes, projects and portals link to.
            </div>
            <Link
              href="/people?edit=new"
              style={{ display: "inline-block", marginTop: 16, fontSize: 13, fontWeight: 600, color: "#fff", background: "var(--accent)", borderRadius: 9, padding: "11px 18px", textDecoration: "none" }}
            >
              + New person
            </Link>
          </div>
        ) : (
          <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
            {filtered.map((p) => {
              const name = displayName(p);
              const chip = STATUS_CHIP[(p.status as ContactStatus) in STATUS_CHIP ? (p.status as ContactStatus) : "active"];
              const email = (emailsBy.get(p.id) ?? [])[0]?.email || "";
              const phone = (phonesBy.get(p.id) ?? [])[0]?.phone || "";
              const sub = [
                p.title,
                p.homeCompanyId ? companyName.get(p.homeCompanyId) : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <Link
                  key={p.id}
                  href={`/people/${encodeURIComponent(p.id)}`}
                  className="pe-row"
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
                >
                  <span style={{ width: 38, height: 38, borderRadius: "50%", background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                    {initialsOf(name) || "?"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {name}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#8c919c", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {sub || "—"}
                    </span>
                  </span>
                  <span className="pe-row-channels" style={{ textAlign: "right", flexShrink: 0, minWidth: 0, maxWidth: 220 }}>
                    <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {email || "—"}
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>
                      {phone || " "}
                    </span>
                  </span>
                  {p.status !== "active" && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: chip.ink, background: chip.soft, borderRadius: 6, padding: "3px 8px", flexShrink: 0 }}>
                      {CONTACT_STATUS_LABEL[(p.status as ContactStatus)] ?? p.status}
                    </span>
                  )}
                </Link>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: "50px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                {ql
                  ? `No people match “${q.trim()}”.`
                  : status !== "all"
                    ? "No people with this status. Switch the filter to Everyone to see all."
                    : "No people match these filters."}
              </div>
            )}
          </div>
        )}
      </div>

      {edit === "new" && (
        <EditPersonModal
          mode="new"
          initial={null as SavePersonInput | null}
          companyOptions={companyOptions}
          closeHref="/people"
        />
      )}
    </>
  );
}
