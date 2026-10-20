"use client";

import { useEffect, useRef, useState } from "react";
import { Typeahead } from "@/components/search/typeahead";
import { searchFilingTargetsAction } from "@/app/(app)/inbox/vendor-file-actions";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";
import type { FilingTargetVM } from "@/lib/vendor-quotes/vm";

/**
 * #348 slice 4 — estimate / project search for the Inbox's File and Add-as-vendor-quote dialogs: CompanySearch's
 * debounced Typeahead (220 ms, a stale response never lands) over `searchFilingTargetsAction`. `initial` pre-selects a
 * target and shows its label in the box.
 */
const keyOf = (t: FilingTargetVM) => `${t.type}:${t.id}`;
const labelOf = (t: FilingTargetVM) => t.label;
const passAll = () => true;
const stable = () => 0;
const ALL_KINDS: Array<"quote" | "project"> = ["quote", "project"];

export default function FilingTargetSearch({
  kinds = ALL_KINDS,
  initial = null,
  onPick,
  disabled,
}: {
  kinds?: Array<"quote" | "project">;
  initial?: FilingTargetVM | null;
  onPick: (t: FilingTargetVM) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FilingTargetVM[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<FilingTargetVM | null>(initial);
  const seq = useRef(0);
  const kindsRef = useRef(kinds);
  useEffect(() => {
    kindsRef.current = kinds;
  }, [kinds]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setFailed(false);
      searchFilingTargetsAction(q, kindsRef.current)
        .then((hits) => {
          if (my !== seq.current) return;
          setResults(hits);
          setResultQuery(q);
        })
        .catch(() => {
          if (my === seq.current) setFailed(true);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);
  const trimmed = query.trim();
  const fresh = trimmed.length >= 2 && resultQuery === trimmed;
  return (
    <Typeahead
      items={fresh ? results : []}
      keyOf={keyOf}
      filter={passAll}
      rank={stable}
      labelOf={labelOf}
      selectedKey={picked ? keyOf(picked) : null}
      resolveSelected={() => picked}
      render={(t) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t.label}</span>
          {t.sub ? <span style={{ fontSize: 11, color: "#8c919c" }}>{t.sub}</span> : null}
        </div>
      )}
      onPick={(t) => {
        setPicked(t);
        onPick(t);
      }}
      placeholder={VENDOR_COPY.searchTargets}
      ariaLabel={VENDOR_COPY.searchTargets}
      inputStyle={{ width: "100%", padding: "7px 9px", fontSize: 12.5, border: "1px solid #dfe2e8", borderRadius: 7 }}
      emptyText={failed ? "Search failed — try again." : trimmed.length < 2 ? "Type at least 2 letters." : fresh ? "Nothing matches." : "Searching…"}
      onQueryChange={setQuery}
      disabled={disabled}
    />
  );
}
