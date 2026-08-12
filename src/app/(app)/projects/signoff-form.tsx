"use client";

import { useMemo, useRef, useState } from "react";
import { GRID_SCOPES } from "@/lib/design/grid-scopes";

const ACCENT = "var(--accent)";

const inputStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "10px 12px",
  outline: "none",
} satisfies React.CSSProperties;

export function ProjectSignoffForm({
  projectId,
  action,
}: {
  projectId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const movedRef = useRef(false);
  const [signatureBlobKey, setSignatureBlobKey] = useState("");
  const [signatureError, setSignatureError] = useState("");

  const scopeLabels = useMemo(() => GRID_SCOPES, []);

  function point(ev: React.PointerEvent<HTMLCanvasElement>) {
    const rect = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function ensureCtx() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#172033";
    return { canvas, ctx };
  }

  function persistSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !movedRef.current) {
      setSignatureBlobKey("");
      return;
    }
    setSignatureBlobKey(canvas.toDataURL("image/png"));
  }

  function begin(ev: React.PointerEvent<HTMLCanvasElement>) {
    const env = ensureCtx();
    if (!env) return;
    const p = point(ev);
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drawingRef.current = true;
    env.ctx.beginPath();
    env.ctx.moveTo(p.x, p.y);
    setSignatureError("");
  }

  function move(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const env = ensureCtx();
    if (!env) return;
    const p = point(ev);
    env.ctx.lineTo(p.x, p.y);
    env.ctx.stroke();
    movedRef.current = true;
    persistSignature();
  }

  function end(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    ev.currentTarget.releasePointerCapture(ev.pointerId);
    persistSignature();
  }

  function clearSignature() {
    const env = ensureCtx();
    if (!env) return;
    env.ctx.clearRect(0, 0, env.canvas.width, env.canvas.height);
    movedRef.current = false;
    setSignatureBlobKey("");
    setSignatureError("");
  }

  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (!signatureBlobKey) {
          ev.preventDefault();
          setSignatureError("Capture a signature before completing the project.");
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input type="hidden" name="id" value={projectId} />
      <input type="hidden" name="signatureBlobKey" value={signatureBlobKey} />
      <input name="name" required placeholder="Customer name (who signed)" style={inputStyle} />
      <input name="role" placeholder="Title / role" defaultValue="Customer" style={inputStyle} />

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#4b5565" }}>Accepted scopes</div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          {scopeLabels.map((scope) => (
            <label
              key={scope}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid #e4e7ec",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                color: "#172033",
              }}
            >
              <input type="checkbox" name={`scope-${scope}`} value="true" defaultChecked />
              <span>{scope}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#4b5565" }}>Signature</div>
          <button
            type="button"
            onClick={clearSignature}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              color: "#516072",
              background: "#fff",
              border: "1px solid #d9dfe8",
              borderRadius: 999,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={560}
          height={180}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{
            width: "100%",
            maxWidth: 560,
            height: 180,
            border: "1px dashed #c9d2df",
            borderRadius: 12,
            background: "#fff",
            touchAction: "none",
          }}
        />
        <div style={{ fontSize: 12, color: signatureError ? "#b42318" : "#8c919c" }}>
          {signatureError || "Draw the customer’s signature here."}
        </div>
      </div>

      <textarea
        name="note"
        placeholder="Notes / punch items (optional)"
        rows={2}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <button
        type="submit"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: ACCENT,
          border: "none",
          padding: "11px 16px",
          borderRadius: 9,
          cursor: "pointer",
          marginTop: 4,
        }}
      >
        Record sign-off &amp; complete
      </button>
    </form>
  );
}
