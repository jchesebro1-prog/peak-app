"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteProjectAction } from "./actions";

/** Two-step inline delete — window.confirm is unavailable in this app. */
export default function DeleteProjectButton({ id }: { id: string }) {
  const router = useRouter();
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const base: React.CSSProperties = {
    borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
    background: "#fff",
    borderRadius: 7,
    padding: "3px 9px",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    color: "#a0442b",
  };
  if (!arm)
    return (
      <button style={base} onClick={() => setArm(true)}>
        Delete
      </button>
    );
  return (
    <span style={{ display: "inline-flex", gap: 5 }}>
      <button
        style={{ ...base, background: "#a0442b", color: "#fff", borderColor: "#a0442b" }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await deleteProjectAction(id);
          router.refresh();
        }}
      >
        {busy ? "Deleting…" : "Really delete"}
      </button>
      <button style={{ ...base, color: "#3d424e" }} onClick={() => setArm(false)}>
        Keep
      </button>
    </span>
  );
}
