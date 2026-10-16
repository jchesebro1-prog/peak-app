import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { listFor } from "@/lib/stores/parties";
import { partyVMs } from "@/lib/parties/view-server";
import { PARTY_ROLES, type PartyRecordType, type PartyRole } from "@/lib/parties/rules";
import PartiesEditor from "./parties-editor";

/** #348 — the "Job" / "Companies" card on the lead drawer and the project page. */
export async function PartiesCard({
  recordType,
  recordId,
  title = "Companies on this job",
  roles = PARTY_ROLES,
  style,
}: {
  recordType: PartyRecordType;
  recordId: string;
  title?: string;
  roles?: readonly PartyRole[];
  style?: CSSProperties;
}) {
  const user = await requireUser();
  const initial = await partyVMs(await listFor(recordType, recordId));
  return (
    <div style={{ marginTop: 18, ...style }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      <PartiesEditor key={`${recordType}:${recordId}`} recordType={recordType} recordId={recordId} initial={initial} canEdit={can("create", user.roles)} roles={roles} />
    </div>
  );
}
