import type { FontName, TextMask } from "../params";

const WEIGHT: Record<FontName, number> = { Pacifico: 400, Lobster: 400, Fredoka: 600 };
const cache = new Map<string, TextMask>();

/**
 * Rasterises the name with the chosen web font into a coverage mask the
 * generator can turn into a distance field. Returns null for empty text.
 */
export async function textMask(text: string, font: FontName): Promise<TextMask | null> {
  const clean = text.trim();
  if (!clean) return null;
  const px = 180;
  const css = `${WEIGHT[font]} ${px}px "${font}", "Brush Script MT", cursive`;
  const hit = cache.get(`${font}|${clean}`);
  if (hit) return hit;
  let ready = false;
  try {
    await document.fonts.load(css, clean);
    ready = document.fonts.check(`${WEIGHT[font]} ${px}px "${font}"`, clean);
  } catch {
    // fall back to whatever font the browser has
  }
  // a mask drawn before the web font arrived is used once, never cached
  const key = `${font}|${clean}${ready ? "" : "|fallback"}`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = css;
  const m = ctx.measureText(clean);
  const pad = 6;
  const left = Math.ceil(m.actualBoundingBoxLeft);
  const ascent = Math.ceil(m.actualBoundingBoxAscent);
  const width = Math.ceil(left + m.actualBoundingBoxRight) + pad * 2;
  const height = Math.ceil(ascent + m.actualBoundingBoxDescent) + pad * 2;
  canvas.width = width;
  canvas.height = height;
  ctx.font = css;
  ctx.fillStyle = "#fff";
  ctx.fillText(clean, pad + left, pad + ascent);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3]!;
  const mask: TextMask = { width, height, data, baseline: pad + ascent, key };
  if (ready) {
    if (cache.size > 20) cache.clear();
    cache.set(key, mask);
  }
  return mask;
}
