"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

/** Compact pointer/touch signature capture for field sign-off. The hidden
 * input keeps the enclosing server-action form progressively enhanced. */
export default function SignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = 600 * ratio;
    canvas.height = 180 * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#16181d";
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * 600, y: ((event.clientY - rect.top) / rect.height) * 180 };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    const p = point(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!p || !ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setHasInk(true);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const p = point(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!p || !ctx) return;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const finish = () => {
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas && inputRef.current && hasInk) inputRef.current.value = canvas.toDataURL("image/png");
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, 600, 180);
    if (inputRef.current) inputRef.current.value = "";
    setHasInk(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="project-signature" style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a" }}>Customer signature</label>
        <span style={{ fontSize: 11, color: "#8c919c" }}>Draw on the phone or trackpad</span>
        {hasInk && <button type="button" onClick={clear} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#8a6d1f", cursor: "pointer", fontSize: 11.5 }}>Clear</button>}
      </div>
      <canvas
        id="project-signature"
        aria-label="Draw customer signature"
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{ width: "100%", maxWidth: 600, height: 180, background: "#fff", border: "1px dashed #cfd4dc", borderRadius: 8, touchAction: "none", cursor: "crosshair" }}
      />
      <input ref={inputRef} type="hidden" name="signature" required defaultValue="" aria-hidden="true" />
    </div>
  );
}
