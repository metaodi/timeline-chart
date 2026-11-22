/**
 * Replace CSS custom properties (`var(--x)`) in an SVG with their values.
 *
 * Pele and the theme presets colour diagrams through CSS variables. Browsers
 * understand them, but many programs that open SVG files (older Inkscape,
 * Illustrator, PowerPoint, …) do not. Before export, every `var(...)` is
 * resolved to a concrete value (e.g. `#4c78a8`) and the variable definitions
 * are removed, so the file looks the same everywhere.
 */

/** Custom property declarations ("--name: value") of an inline style string. */
export function parseCustomProps(style) {
  const defs = new Map();
  for (const decl of splitDecls(style)) {
    const i = decl.indexOf(':');
    const name = decl.slice(0, i).trim();
    if (i > 0 && name.startsWith('--')) defs.set(name, decl.slice(i + 1).trim());
  }
  return defs;
}

/** Split "a:b; c:d" on semicolons outside parentheses. */
function splitDecls(style) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(style.slice(start, i));
      start = i + 1;
    }
  }
  out.push(style.slice(start));
  return out.map((d) => d.trim()).filter(Boolean);
}

/**
 * Resolve every `var(--name[, fallback])` in a value, recursively.
 * Unknown variables without a fallback resolve to an empty string.
 */
export function resolveValue(value, defs, seen = new Set()) {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    // find the matching ")" and the first top-level ","
    let depth = 0;
    let comma = -1;
    let end = -1;
    for (let j = at + 3; j < value.length; j++) {
      const ch = value[j];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      } else if (ch === ',' && depth === 1 && comma < 0) comma = j;
    }
    if (end < 0) {
      out += value.slice(at); // malformed: keep as is
      break;
    }
    const name = value.slice(at + 4, comma > 0 ? comma : end).trim();
    const fallback = comma > 0 ? value.slice(comma + 1, end).trim() : '';
    let resolved;
    if (defs.has(name) && !seen.has(name)) {
      resolved = resolveValue(defs.get(name), defs, new Set([...seen, name]));
    }
    if (!resolved) resolved = fallback ? resolveValue(fallback, defs, seen) : '';
    out += resolved;
    i = end + 1;
  }
  return out;
}

/** Resolve all variables in a style string and drop the custom property declarations. */
export function resolveStyle(style, defs) {
  return splitDecls(style)
    .filter((d) => !d.trim().startsWith('--'))
    .map((d) => {
      const i = d.indexOf(':');
      return i < 0 ? d : `${d.slice(0, i).trim()}:${resolveValue(d.slice(i + 1).trim(), defs)}`;
    })
    .filter((d) => !/:\s*$/.test(d))
    .join(';');
}

/**
 * Inline all CSS variables of an SVG element tree (in place).
 * @param {SVGSVGElement} svg
 */
export function inlineCssVars(svg) {
  const elements = [svg, ...svg.querySelectorAll('*')];
  const defs = new Map();
  for (const el of elements) {
    const style = el.getAttribute('style');
    if (style) for (const [k, v] of parseCustomProps(style)) defs.set(k, v);
  }
  for (const el of elements) {
    for (const attr of [...el.attributes]) {
      if (attr.name === 'style' || !attr.value.includes('var(')) continue;
      el.setAttribute(attr.name, resolveValue(attr.value, defs));
    }
    const style = el.getAttribute('style');
    if (style == null) continue;
    const resolved = resolveStyle(style, defs);
    // corner radius given as CSS ("rx:4px") is not understood everywhere: use attributes
    const rx = /(?:^|;)\s*rx\s*:\s*([\d.]+)/.exec(resolved);
    if (rx && el.localName === 'rect' && !el.hasAttribute('rx')) {
      el.setAttribute('rx', rx[1]);
      el.setAttribute('ry', rx[1]);
    }
    if (resolved) el.setAttribute('style', resolved);
    else el.removeAttribute('style');
  }
  return svg;
}
