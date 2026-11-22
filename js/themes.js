/**
 * Colour presets for the Pele renderer.
 *
 * Pele styles diagrams with CSS custom properties (see https://pele.run/theming),
 * so a "theme" is just a set of variables. They are applied to the preview and
 * written into exported SVG/PNG files. The preset ids match Mermaid theme names,
 * which are also written into the Mermaid code for use in other Mermaid tools.
 * Add a preset here (and its id to THEMES in model.js) to offer a new theme.
 */
export const PRESETS = {
  default: {
    label: 'Default',
    vars: {
      '--pele-bg': '#ffffff',
      '--pele-fg': '#1f1f1f',
      series: ['#4c78a8', '#f58518', '#54a24b', '#e45756', '#72b7b2', '#b279a2', '#eeca3b', '#9d755d'],
    },
  },
  neutral: {
    label: 'Neutral',
    vars: {
      '--pele-bg': '#ffffff',
      '--pele-fg': '#222222',
      '--pele-muted': '#555555',
      series: ['#3d3d3d', '#5c5c5c', '#7a7a7a', '#4a5560', '#68707a', '#2f2f2f', '#868686', '#555d66'],
    },
  },
  dark: {
    label: 'Dark',
    vars: {
      '--pele-bg': '#1e1f24',
      '--pele-fg': '#e8e9ee',
      '--pele-muted': '#9da2b3',
      '--pele-line': '#c9ccd6',
      '--pele-surface': '#2a2c34',
      '--pele-surface-alt': '#33363f',
      '--pele-border': '#4a4e5c',
      '--pele-accent': '#8b85ff',
      series: ['#6c8ef5', '#f5a35c', '#6cc56a', '#f07272', '#5fc4bd', '#c58ad1', '#e8cd5a', '#c09477'],
    },
  },
  forest: {
    label: 'Forest',
    vars: {
      '--pele-bg': '#fbfdf8',
      '--pele-fg': '#1d2b1a',
      '--pele-muted': '#4f6b48',
      '--pele-line': '#2f4a29',
      '--pele-accent': '#3f7d32',
      series: ['#2f6b2f', '#5a8f29', '#7a9a3a', '#3e7d6b', '#6b8e23', '#4d6b2f', '#8aa34a', '#2e5e4e'],
    },
  },
  base: {
    label: 'Warm',
    vars: {
      '--pele-bg': '#fffcf0',
      '--pele-fg': '#100f0f',
      '--pele-muted': '#6f6e69',
      '--pele-line': '#100f0f',
      '--pele-surface': '#f2f0e5',
      '--pele-surface-alt': '#e6e4d9',
      '--pele-border': '#cecdc3',
      '--pele-accent': '#205ea6',
      series: ['#d14d41', '#da702c', '#d0a215', '#879a39', '#3aa99f', '#4385be', '#8b7ec8', '#ce5d97'],
    },
  },
};

/**
 * CSS custom properties for a timeline's theme.
 * @param {string} theme preset id
 * @param {boolean} singleColour use the first series colour for every section
 * @returns {Record<string, string>}
 */
export function themeVars(theme, singleColour = false) {
  const { series, ...vars } = (PRESETS[theme] ?? PRESETS.default).vars;
  series.forEach((c, i) => (vars[`--pele-series-${i + 1}`] = singleColour ? series[0] : c));
  return vars;
}

/** Pele's built-in values for variables a preset does not set. */
const PELE_DEFAULTS = { '--pele-bg': '#ffffff', '--pele-surface': '#f3f3f3' };

export const themeColour = (vars, name) => vars[name] ?? PELE_DEFAULTS[name];

/** Mix two #rrggbb colours (t = share of b). */
export function mixHex(a, b, t = 0.5) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/**
 * Colour of a Gantt row stripe: "none" (background shows through), "surface"
 * (the theme's light grey), "mix" (halfway between background and surface: a
 * very subtle grey) or a #rrggbb colour.
 */
export function rowColour(token, vars) {
  if (token === 'none') return 'none';
  const surface = themeColour(vars, '--pele-surface');
  if (token === 'surface') return surface;
  if (token === 'mix') return mixHex(themeColour(vars, '--pele-bg'), surface, 0.5);
  return /^#[0-9a-f]{6}$/i.test(token) ? token : surface;
}

export function applyVars(el, vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}
