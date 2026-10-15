import type { CSSProperties } from "react";
import { loadVendorsPanel } from "@/lib/vendor-quotes/threads-server";
import { VENDOR_COPY, vendorCardGroups } from "@/lib/vendor-quotes/rules";
import type { MailboxViewer } from "@/lib/stores/comms-visibility";
import { VendorGroupsList } from "@/components/vendors/vendor-groups";

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", padding: "14px 18px", marginTop: 18 };

/** #348 slice 4 — a job's Procurement read-through: vendors on its estimate or project, their quotes and the emails filed to them. */
export async function ProjectVendorsCard({ project, viewer }: { project: { id: string; quoteId: string | null }; viewer: MailboxViewer }) {
  const panel = await loadVendorsPanel({ quoteId: project.quoteId, projectId: project.id }, viewer);
  const groups = vendorCardGroups(panel);
  return (
    <div style={CARD}>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>{VENDOR_COPY.procurementTitle}</div>
      <VendorGroupsList groups={groups} emptyText="No vendor quotes or vendor emails for this job yet." />
    </div>
  );
}
