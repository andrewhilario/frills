// Client-side transparent PNG exporter for Frills Stream Outline:
// Clones the rendered vector SVG, strips editor-only guides, inlines same-origin /decor/ & /api/media/ images
// as base64 data URIs, draws onto an offscreen transparent HiDPI canvas (1x 1080p Free, 2x 4K Plus), and returns a PNG Blob.

const dataUrlCache = new Map();

async function fetchAsDataUrl(url) {
  if (!url || url.startsWith("data:")) return url;
  if (dataUrlCache.has(url)) return dataUrlCache.get(url);
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return "";
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read_failed"));
      reader.readAsDataURL(blob);
    });
    if (dataUrl) dataUrlCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return "";
  }
}

/**
 * Renders `svgEl` to a transparent PNG `Blob` at `scale` (1 = native 1080p/box, 2 = crisp 4K).
 * Uses a `data:image/svg+xml` source so it complies strictly with Frills' `img-src 'self' data:` CSP.
 */
export async function exportOutlinePng(svgEl, { scale = 1 } = {}) {
  if (!svgEl) throw new Error("No outline SVG to export.");
  const width = Math.max(1, Number(svgEl.getAttribute("data-w") || svgEl.getAttribute("width")) || 1920);
  const height = Math.max(1, Number(svgEl.getAttribute("data-h") || svgEl.getAttribute("height")) || 1080);
  const mult = Math.max(1, Math.min(2, Number(scale) || 1));

  const clone = svgEl.cloneNode(true);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  // Remove editor-only guides (TikTok safe zones & cutout placeholder labels)
  for (const guide of clone.querySelectorAll("[data-editor-only]")) guide.remove();

  // Inline every same-origin <image> as a data URI so isolated SVG-as-Image rendering paints all decor & mascots cleanly
  const images = [...clone.querySelectorAll("image")];
  await Promise.all(
    images.map(async (img) => {
      const href = img.getAttribute("href") || img.getAttribute("xlink:href") || "";
      if (!href) return;
      const inlined = await fetchAsDataUrl(href);
      if (inlined) {
        img.setAttribute("href", inlined);
        img.removeAttribute("xlink:href");
      } else {
        img.remove();
      }
    }),
  );

  const xml = new XMLSerializer().serializeToString(clone);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

  const loaded = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Could not rasterize SVG outline."));
    im.src = svgDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * mult);
  canvas.height = Math.round(height * mult);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(loaded, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))), "image/png");
  });
  return { blob, width: canvas.width, height: canvas.height };
}

/** Triggers a browser download of `blob` as `filename`. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
