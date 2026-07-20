import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  displayName,
  emailsFor,
  getContact,
  phonesFor,
} from "@/lib/identity/contacts";
import { getCompany, allCompanies } from "@/lib/identity/companies";
import { allUsers } from "@/lib/users";
import {
  CONTACT_STATUS_LABEL,
  type ContactStatus,
} from "@/lib/identity/config";
import { shortDate } from "@/lib/format";
import { Avatar } from "@/components/ui";
import EditPersonModal from "../edit-modal";
import type { SavePersonInput } from "../types";

export const metadata = { title: "Person — Peak Backend" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
};
const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 18px 12px",
  borderBottom: "1px solid #f0f1f4",
};

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

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, { id }, sp] = await Promise.all([requireUser(), params, searchParams]);
  const person = await getContact(id);
  if (!person) notFound();

  const [company, emails, phones, users, companies] = await Promise.all([
    getCompany(person.homeCompanyId),
    emailsFor(person.id),
    phonesFor(person.id),
    allUsers(),
    allCompanies(),
  ]);

  const edit = one(sp.edit);
  const name = displayName(person);
  const status = (person.status as ContactStatus) in STATUS_CHIP ? (person.status as ContactStatus) : "active";
  const chip = STATUS_CHIP[status];
  const owner = person.ownerUserId ? users.find((u) => u.id === person.ownerUserId) : null;
  const linkedUser = person.userId ? users.find((u) => u.id === person.userId) : null;

  const editInitial: SavePersonInput = {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    title: person.title,
    homeCompanyId: person.homeCompanyId,
    status: person.status,
    isPrimary: person.isPrimary,
    emails: emails.map((e) => ({ value: e.email, label: e.label, isPrimary: e.isPrimary })),
    phones: phones.map((p) => ({ value: p.phone, label: p.label, isPrimary: p.isPrimary })),
  };

  const channelRow = (
    key: string,
    value: string,
    labelText: string,
    isPrimary: boolean,
    href?: string
  ) => (
    <div
      key={key}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderBottom: "1px solid #f5f6f8" }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8c919c", textTransform: "uppercase", letterSpacing: ".04em", width: 52, flexShrink: 0 }}>
        {labelText}
      </span>
      {href ? (
        <a href={href} style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#16181d", textDecoration: "none", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value}
        </a>
      ) : (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, flex: 1 }}>{value}</span>
      )}
      {isPrimary && (
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}>primary</span>
      )}
    </div>
  );

  return (
    <div className="pk-content" style={{ maxWidth: 720 }}>
      <Link
        href="/people"
        style={{ display: "inline-block", fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none", marginBottom: 14 }}
      >
        ‹ All people
      </Link>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <span style={{ width: 54, height: 54, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 17, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
          {initialsOf(name) || "?"}
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>{name}</span>
            {status !== "active" && (
              <span style={{ fontSize: 11, fontWeight: 600, color: chip.ink, background: chip.soft, borderRadius: 6, padding: "3px 9px" }}>
                {CONTACT_STATUS_LABEL[status]}
              </span>
            )}
            {person.isPrimary && company && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, #fff)", borderRadius: 6, padding: "3px 9px" }}>
                Primary contact
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#8c919c", marginTop: 3 }}>
            {[
              person.title,
              company ? undefined : person.homeCompanyId ? "(company removed)" : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || (company ? "" : "No title")}
            {company && (
              <>
                {person.title ? " · " : ""}
                <Link href={`/companies/${encodeURIComponent(company.id)}`} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
                  {company.name}
                </Link>
              </>
            )}
          </div>
        </div>
        <Link
          href={`/people/${encodeURIComponent(person.id)}?edit=1`}
          style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 14px", textDecoration: "none", flexShrink: 0 }}
        >
          Edit
        </Link>
      </div>

      {/* channels */}
      <div style={card}>
        <div style={cardHead}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Reach</span>
        </div>
        {emails.map((e) => channelRow("e" + e.id, e.email, e.label, e.isPrimary, `mailto:${e.email}`))}
        {phones.map((p) => channelRow("p" + p.id, p.phone, p.label, p.isPrimary, `tel:${p.phone.replace(/[^+\d]/g, "")}`))}
        {emails.length === 0 && phones.length === 0 && (
          <div style={{ padding: "26px 18px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            No email or phone on file yet.
          </div>
        )}
      </div>

      {/* record meta */}
      <div style={card}>
        <div style={cardHead}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Record</span>
        </div>
        <div style={{ padding: "13px 18px", display: "grid", gap: 9, fontSize: 12.5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ color: "#8c919c" }}>Added</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{shortDate(person.createdAt)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ color: "#8c919c" }}>Last updated</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{shortDate(person.updatedAt)}</span>
          </div>
          {owner && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span style={{ color: "#8c919c" }}>Owner</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Avatar name={owner.name} initials={owner.initials} color={owner.color} size={20} />
                {owner.name}
              </span>
            </div>
          )}
          {linkedUser && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ color: "#8c919c" }}>Team login</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{linkedUser.email}</span>
            </div>
          )}
        </div>
      </div>

      {edit === "1" && (
        <EditPersonModal
          mode="edit"
          initial={editInitial}
          companyOptions={companies.map((c) => ({ id: c.id, name: c.name }))}
          closeHref={`/people/${encodeURIComponent(person.id)}`}
        />
      )}
    </div>
  );
}
