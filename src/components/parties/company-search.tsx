"use client";

import { useEffect, useRef, useState } from "react";
import { Typeahead } from "@/components/search/typeahead";
import { searchLinkTargetsAction } from "@/app/(app)/inbox/link-popup-actions";
import type { LinkTargetHit } from "@/lib/inbox-link-targets";

/** #348 — debounced company search (the Inbox link sidebar's #121 pattern, companies only). */
const keyOf = (h: LinkTargetHit) => h.id;
const passAll = () => true;
const stable = () => 0;

export default function CompanySearch({
  placeholder,
  disabled,
  onPick,
}: {
  placeholder: string;
  disabled?: boolean;
  onPick: (c: { id: string; name: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTargetHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setFailed(false);
      searchLinkTargetsAction(q, "company")
        .then((g) => {
          if (my !== seq.current) return;
          setResults(g.companies);
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
      render={(h) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{h.label}</span>
          {h.sub ? <span style={{ fontSize: 11, color: "#8c919c" }}>{h.sub}</span> : null}
        </div>
      )}
      onPick={(h) => onPick({ id: h.id, name: h.label })}
      placeholder={placeholder}
      ariaLabel={placeholder}
      inputStyle={{ width: "100%", padding: "7px 9px", fontSize: 12.5, border: "1px solid #dfe2e8", borderRadius: 7 }}
      emptyText={failed ? "Search failed — try again." : trimmed.length < 2 ? "Type at least 2 letters." : fresh ? "Nothing matches." : "Searching…"}
      onQueryChange={setQuery}
      disabled={disabled}
    />
  );
}
