/** Download / clipboard helpers. */

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
  if (background) clone.style.backgroundColor = background;
  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(svgEl, title, background) {
  const blob = new Blob([svgMarkup(svgEl, background)], { type: 'image/svg+xml;charset=utf-8' });
  download(blob, `${slug(title)}.svg`);
}

export async function pngBlob(svgEl, background, scale = 2) {
  const { width, height } = svgSize(svgEl);
  const img = new Image();
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup(svgEl, background));
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Could not rasterise the SVG'));
    img.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
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

export async function downloadPng(svgEl, title, background) {
  download(await pngBlob(svgEl, background), `${slug(title)}.png`);
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
