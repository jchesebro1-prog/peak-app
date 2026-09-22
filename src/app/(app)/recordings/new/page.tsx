import Link from "next/link";
import { requireUser } from "@/lib/session";
import { RECORDING_PARENT_KINDS, type RecordingParentKind } from "@/lib/stores/recordings";
import { recordingCaptureContext } from "../capture-actions";
import RecorderClient from "./recorder-client";

/**
 * /recordings/new?parent=<kind>:<id> — the full-screen recorder (spec §2.2).
 * Server side we validate the parent ref, enforce the beta gate, and hand the
 * client everything it needs to record, create the record and queue the file.
 */

function parseParent(raw: string | undefined): { kind: RecordingParentKind; id: string } | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  const kind = raw.slice(0, i);
  const id = raw.slice(i + 1).trim();
  if (!id || !(RECORDING_PARENT_KINDS as string[]).includes(kind)) return null;
  return { kind: kind as RecordingParentKind, id };
}

function Notice({ title, body, back }: { title: string; body: string; back?: { href: string; label: string } }) {
  return (
    <div className="pk-content">
      <div className="pk-card" style={{ maxWidth: 520, margin: "40px auto", padding: "22px 24px" }}>
        <div className="pk-page-title">{title}</div>
        <p className="pk-page-sub" style={{ marginTop: 8, lineHeight: 1.5 }}>
          {body}
        </p>
        {back ? (
          <div style={{ marginTop: 16 }}>
            <Link href={back.href} className="pk-btn-outline" style={{ display: "inline-block", padding: "8px 14px" }}>
              {back.label}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default async function NewRecordingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const raw = Array.isArray(params.parent) ? params.parent[0] : params.parent;
  const parent = parseParent(raw);
  if (!parent) {
    return (
      <Notice
        title="Nothing to record against"
        body="Open a site visit, survey, inspection, flame test, repair, project or engagement and use its Record button — recordings always attach to a record."
        back={{ href: "/", label: "Back to Home" }}
      />
    );
  }

  const res = await recordingCaptureContext(parent.kind, parent.id);
  if (!res.ok) {
    return <Notice title="Record not found" body={res.error} back={{ href: "/", label: "Back to Home" }} />;
  }
  if (!res.ctx.canRecord) {
    return (
      <Notice
        title="Recording is in pilot"
        body="Recording is limited to a few named users while the capture → transcript → write-back loop is being proven. Ask an admin to add you under Settings → Beta."
        back={{ href: "/", label: "Back to Home" }}
      />
    );
  }

  return <RecorderClient ctx={res.ctx} />;
}
