"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { memberCoverageLabel, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import { setOwnDatasheetAction } from "./actions";

/**
 * One assembly member's datasheet coverage (#DOC, spec §3): "Covered by
 * fixture datasheet" by default, with the "has its own datasheet" toggle.
 * Disabled until the assembly is saved (the pair isn't in the graph yet).
 */
export default function MemberCoverageChip({ parentSku, accessorySku, coverage }: { parentSku: string; accessorySku: string; coverage?: MemberCoverage }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const linked = !!coverage?.linked;
  const covered = linked && !coverage!.own && (coverage!.parentHasDatasheet || coverage!.state === "own");
  return (
    <div style={{ fontSize: 11, color: covered ? "#3a5fb4" : "#8c919c", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span>{memberCoverageLabel(coverage)}</span>
      <label style={{ display: "inline-flex", gap: 4, alignItems: "center", color: "#6b7079", cursor: linked ? "pointer" : "default" }} title={linked ? "" : "Save the assembly first"}>
        <input
          type="checkbox"
          disabled={!linked || pending}
          checked={!!coverage?.own}
          onChange={(e) => {
            const own = e.target.checked;
            setError(null);
            start(async () => {
              const r = await setOwnDatasheetAction(parentSku, accessorySku, own);
              if (!r.ok) setError(r.error);
              else router.refresh();
            });
          }}
        />
        has its own datasheet
      </label>
      {error && <span role="alert" style={{ color: "#b4543a" }}>{error}</span>}
    </div>
  );
}
