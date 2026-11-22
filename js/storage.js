/** Persistence: autosave to localStorage and compact share links in the URL hash. */

const KEY = 'timeline-builder:v1';

export function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLocal(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / storage full: autosave is best effort */
  }
}

const toB64url = (bytes) => {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** JSON -> deflate -> base64url ("z" prefix), or plain base64url ("j" prefix) without CompressionStream. */
export async function encodeShare(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream === 'function') {
    return 'z' + toB64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  }
  return 'j' + toB64url(bytes);
}

export async function decodeShare(token) {
  const kind = token[0];
  let bytes = fromB64url(token.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('Unknown share format');
  return JSON.parse(new TextDecoder().decode(bytes));
}
