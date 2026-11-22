import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { embedInSvg, stateFromSvg, embedInPng, stateFromPng, readPngText, isPng } from '../js/embed.js';
import { normalize } from '../js/model.js';
import { ganttExample } from '../js/examples.js';

/** A valid 1×1 PNG built with node's zlib. */
function tinyPng() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** All chunk CRCs of a PNG are valid. */
function crcsValid(bytes) {
  const b = Buffer.from(bytes);
  for (let p = 8; p < b.length; ) {
    const len = b.readUInt32BE(p);
    if (zlib.crc32(b.subarray(p + 4, p + 8 + len)) !== b.readUInt32BE(p + 8 + len)) return false;
    p += 12 + len;
  }
  return true;
}

const state = () => {
  const s = normalize(ganttExample('2026-01-05'));
  s.title = 'Plan – Ü & <b>"x"</b>';
  s.gantt.sections[0].tasks[0].note = 'Notiz mit Umlauten äöü, Emoji 🚀 und </metadata> im Text';
  s.gantt.sections[0].tasks[0].link = 'https://example.com/?a=1&b=2';
  return s;
};

test('SVG: state round-trips through <metadata>, also with special characters', () => {
  const s = state();
  const svg = embedInSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>', s);
  assert.match(svg, /^<svg[^>]*><metadata id="timeline-builder">/);
  assert.doesNotMatch(svg, /<\/metadata> im Text/); // escaped, cannot close the element early
  assert.deepEqual(stateFromSvg(svg), s);
});

test('SVG without app data gives null', () => {
  assert.equal(stateFromSvg('<svg><metadata>other</metadata></svg>'), null);
  assert.equal(stateFromSvg('<svg></svg>'), null);
});

test('PNG: state round-trips through an iTXt chunk, file stays valid', () => {
  const png = tinyPng();
  assert.ok(isPng(png) && crcsValid(png));
  const s = state();
  const out = embedInPng(png, s);
  assert.ok(isPng(out) && crcsValid(out), 'all CRCs valid');
  assert.deepEqual(stateFromPng(out), s);
  assert.equal(readPngText(out, 'other-key'), null);
  assert.equal(stateFromPng(png), null); // plain PNG: nothing embedded
});
