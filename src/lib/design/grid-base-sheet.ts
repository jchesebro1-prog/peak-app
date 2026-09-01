import type { VenueDims } from "./venue-dims";

/**
 * A generated Grid sheet is intentionally an ordinary SVG image. The editor
 * already treats images as plan sheets, which keeps generated and uploaded
 * plans on the same canvas and lets a later upload remain a separate sheet.
 */
export function generatedBaseSheet(dims: VenueDims): { dataUrl: string; name: string } {
  const stageWidth = Math.max(dims.stageWidthFt || dims.proWidthFt, dims.proWidthFt);
  const stageDepth = Math.max(dims.stageDepthFt, 1);
  const margin = 100;
  const usableWidth = 1000;
  const scale = usableWidth / stageWidth;
  const planWidth = stageWidth * scale;
  const planDepth = stageDepth * scale;
  const viewHeight = Math.max(680, planDepth + margin * 2 + 120);
  const stageX = margin;
  const stageY = margin + 70;
  const proWidth = Math.min(dims.proWidthFt, stageWidth) * scale;
  const proX = stageX + (planWidth - proWidth) / 2;
  const gridLines = Array.from({ length: Math.floor(stageDepth / 5) }, (_, i) => {
    const y = stageY + (i + 1) * 5 * scale;
    return `<line x1="${stageX}" y1="${y}" x2="${stageX + planWidth}" y2="${y}" class="grid"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${viewHeight}" viewBox="0 0 1200 ${viewHeight}">
  <style>
    text { font-family: Arial, sans-serif; fill: #30343b; }
    .grid { stroke: #d9dde3; stroke-width: 1; stroke-dasharray: 6 7; }
    .dim { font-size: 18px; fill: #667085; }
    .label { font-size: 20px; font-weight: 700; letter-spacing: .08em; }
  </style>
  <rect width="1200" height="${viewHeight}" fill="#ffffff"/>
  <text x="${stageX}" y="44" class="label">GENERATED VENUE PLAN</text>
  <text x="${stageX}" y="68" class="dim">${stageWidth}' W × ${stageDepth}' D · 1 square = 5'</text>
  <rect x="${stageX}" y="${stageY}" width="${planWidth}" height="${planDepth}" fill="#f8fafc" stroke="#1f2937" stroke-width="3"/>
  ${gridLines}
  <line x1="${proX}" y1="${stageY}" x2="${proX + proWidth}" y2="${stageY}" stroke="#b08d4a" stroke-width="8"/>
  <text x="${stageX + planWidth / 2}" y="${stageY - 16}" text-anchor="middle" class="dim">PROSCENIUM ${dims.proWidthFt}'</text>
  <text x="${stageX + planWidth / 2}" y="${stageY + planDepth / 2}" text-anchor="middle" class="label">STAGE</text>
  <text x="${stageX + planWidth / 2}" y="${stageY + planDepth + 38}" text-anchor="middle" class="dim">UPSTAGE / BACK WALL</text>
  <text x="${stageX + planWidth + 22}" y="${stageY + planDepth / 2}" class="dim" transform="rotate(90 ${stageX + planWidth + 22} ${stageY + planDepth / 2})">${stageDepth}' DEPTH</text>
</svg>`;
  return {
    name: "Generated venue plan",
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
}
