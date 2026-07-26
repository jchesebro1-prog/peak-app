"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keyword filter input (#18) — debounced URL-as-state push (300ms), the
 * companies FilterBar idiom, incl. its render-time derived-state reset.
 * LATENT until keyword authoring lands (plan 05, #23): the server page only
 * renders it when at least one company actually carries a keyword.
 */
export function KwInput({
  kw,
  params,
}: {
  kw: string;
  /** Every OTHER active filter param, server-prebuilt (default-stripped). */
  params: Array<[string, string]>;
}) {
  const router = useRouter();
  const [text, setText] = useState(kw);
  const [prevKw, setPrevKw] = useState(kw);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (prevKw !== kw) {
    setPrevKw(kw);
    setText(kw);
  }
  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = new URLSearchParams();
      for (const [k, val] of params) p.set(k, val);
      if (v.trim()) p.set("kw", v.trim());
      const s = p.toString();
      router.push("/opportunities" + (s ? "?" + s : ""));
    }, 300);
  };
  return (
    <input
      value={text}
      onChange={(e) => onSearch(e.target.value)}
      placeholder="Keyword…"
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        color: "#16181d",
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 9,
        padding: "9px 12px",
        width: 150,
      }}
    />
  );
}
