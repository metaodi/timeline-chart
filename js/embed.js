/**
 * Embed the full app state in exported files, so a diagram can be restored 1:1
 * from its PNG or SVG (Import → open file, or drop the file on the app).
 *
 * - SVG: a `<metadata id="timeline-builder">` element with the JSON.
 * - PNG: an `iTXt` chunk with the keyword "timeline-builder" (UTF-8 text, PNG standard).
 *
 * Pure functions (no DOM), so they run in node tests too.
 */

export const KEY = 'timeline-builder';
const VERSION = 1;

/** JSON payload written into files. */
export function payload(state) {
  return JSON.stringify({ app: KEY, v: VERSION, state });
}

/** The state from a payload, or null. */
export function readPayload(text) {
  try {
    const data = JSON.parse(text);
    return data?.app === KEY && data.state && typeof data.state === 'object' ? data.state : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlUnescape = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** Add the state to SVG markup (right after the opening <svg> tag). */
export function embedInSvg(svg, state) {
  const meta = `<metadata id="${KEY}">${xmlEscape(payload(state))}</metadata>`;
  return svg.replace(/<svg\b[^>]*>/, (open) => open + meta);
}

/** The state embedded in SVG markup, or null. */
export function stateFromSvg(svg) {
  const m = new RegExp(`<metadata[^>]*id="${KEY}"[^>]*>([\\s\\S]*?)</metadata>`).exec(svg);
  if (!m) return null;
  const body = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, '$1');
  return readPayload(m[1].includes('<![CDATA[') ? body : xmlUnescape(body));
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const isPng = (bytes) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);

/** Split a PNG into chunks: [{ type, data, start, end }]. */
function chunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    out.push({ type, data: bytes.subarray(pos + 8, pos + 8 + len), start: pos, end: pos + 12 + len });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Add an iTXt chunk (uncompressed UTF-8) right after IHDR.
 * @param {Uint8Array} bytes PNG file
 */
export function addPngText(bytes, keyword, text) {
  if (!isPng(bytes)) throw new Error('Not a PNG file');
  const enc = new TextEncoder();
  // keyword \0, compression flag 0, method 0, language tag "" \0, translated keyword "" \0, text
  const data = new Uint8Array([...enc.encode(keyword), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const ihdr = chunks(bytes).find((c) => c.type === 'IHDR');
  const extra = chunk('iTXt', data);
  const out = new Uint8Array(bytes.length + extra.length);
  out.set(bytes.subarray(0, ihdr.end), 0);
  out.set(extra, ihdr.end);
  out.set(bytes.subarray(ihdr.end), ihdr.end + extra.length);
  return out;
}

/** Text of the uncompressed iTXt/tEXt chunk with this keyword, or null. */
export function readPngText(bytes, keyword) {
  if (!isPng(bytes)) return null;
  const dec = new TextDecoder();
  for (const c of chunks(bytes)) {
    if (c.type !== 'iTXt' && c.type !== 'tEXt') continue;
    const zero = c.data.indexOf(0);
    if (zero < 0 || dec.decode(c.data.subarray(0, zero)) !== keyword) continue;
    if (c.type === 'tEXt') return new TextDecoder('latin1').decode(c.data.subarray(zero + 1));
    if (c.data[zero + 1] !== 0) continue; // compressed iTXt: not written by this app
    let p = zero + 3;
    p = c.data.indexOf(0, p) + 1; // language tag
    p = c.data.indexOf(0, p) + 1; // translated keyword
    return dec.decode(c.data.subarray(p));
  }
  return null;
}

export function embedInPng(bytes, state) {
  return addPngText(bytes, KEY, payload(state));
}

export function stateFromPng(bytes) {
  const text = readPngText(bytes, KEY);
  return text ? readPayload(text) : null;
}
