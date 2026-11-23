/** Download / clipboard helpers. */
import { inlineCssVars } from './svg-vars.js';
import { embedInSvg, embedInPng } from './embed.js';

function slug(name) {
  return (
    String(name || 'timeline')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'timeline'
  );
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Size of the SVG from its viewBox (Mermaid sets width=100% + max-width). */
function svgSize(svgEl) {
  const vb = svgEl.viewBox?.baseVal;
  if (vb && vb.width && vb.height) return { width: vb.width, height: vb.height };
  const r = svgEl.getBoundingClientRect();
  return { width: r.width, height: r.height };
}

/** Standalone SVG markup with explicit size and a background colour. */
export function svgMarkup(svgEl, background) {
  const clone = svgEl.cloneNode(true);
  const { width, height } = svgSize(svgEl);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.style.maxWidth = '';
  clone.style.height = '';
  // Concrete colours instead of CSS variables, so other programs show the same colours.
  inlineCssVars(clone);
  if (background) {
    // A real rectangle: a CSS background on <svg> is ignored by many programs.
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', background);
    clone.insertBefore(rect, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

/** SVG download; with `state` the app state is embedded (<metadata>) for a 1:1 restore. */
export function downloadSvg(svgEl, title, background, state) {
  const markup = svgMarkup(svgEl, background);
  const blob = new Blob([state ? embedInSvg(markup, state) : markup], { type: 'image/svg+xml;charset=utf-8' });
  download(blob, `${slug(title)}.svg`);
}

/** PNG sizes offered in the UI: pixel density ("2x") or a target width ("1920px"). */
export const PNG_SIZES = ['1x', '2x', '3x', '4x', '1280px', '1920px', '2560px', '3840px'];
export const DEFAULT_PNG_SIZE = '2x';
/** Largest canvas browsers reliably draw (iOS Safari: 16.7 megapixels, 16384px a side). */
const MAX_PIXELS = 16777216;
const MAX_SIDE = 16384;

/** A valid PNG size ("2x", "1920px") or ''. */
export function cleanPngSize(size) {
  const s = String(size ?? '').trim().toLowerCase();
  let m;
  if ((m = /^([1-4])x$/.exec(s))) return `${m[1]}x`;
  if ((m = /^(\d{2,5})px$/.exec(s))) return `${Math.max(100, Math.min(MAX_SIDE, Number(m[1])))}px`;
  return '';
}

/**
 * Scale factor for rasterising a `width` × `height` SVG at `size` ("2x" or "1920px"),
 * reduced so the canvas stays within what browsers can draw.
 */
export function pngScale(width, height, size) {
  const s = cleanPngSize(size) || DEFAULT_PNG_SIZE;
  let scale = s.endsWith('px') ? Number(s.slice(0, -2)) / Math.max(1, width) : Number(s.slice(0, -1));
  scale = Math.min(scale, MAX_SIDE / Math.max(1, width), MAX_SIDE / Math.max(1, height));
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
  return scale;
}

export async function pngBlob(svgEl, background, size = DEFAULT_PNG_SIZE) {
  const { width, height } = svgSize(svgEl);
  const scale = pngScale(width, height, size);
  const img = new Image();
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup(svgEl, background));
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Could not rasterise the SVG'));
    img.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'),
  );
}

/** PNG download; with `state` the app state is embedded (iTXt chunk) for a 1:1 restore. */
export async function downloadPng(svgEl, title, background, state, size = state?.pngSize) {
  let blob = await pngBlob(svgEl, background, size);
  if (state) blob = new Blob([embedInPng(new Uint8Array(await blob.arrayBuffer()), state)], { type: 'image/png' });
  download(blob, `${slug(title)}.png`);
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts / older mobile browsers
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Copy not supported');
}
