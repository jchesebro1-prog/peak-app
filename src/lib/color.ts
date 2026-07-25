/**
 * Accent-contrast helper (D117): the accent is user-selectable, so text on
 * accent surfaces must adapt — near-black on light accents (gold default),
 * white on dark ones. Threshold via WCAG relative luminance.
 */
export function accentContrast(hex: string): "#16181b" | "#fff" {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.18 ? "#16181b" : "#fff";
}
