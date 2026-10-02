/** #296 — a PNG's pixel size from its IHDR chunk, or null when the bytes aren't a PNG. Pure. */
export function pngSize(png: Buffer): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || !sig.every((b, i) => png[i] === b) || png.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
