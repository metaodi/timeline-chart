/**
 * Resizable editor column (desktop): a divider between the editor and the
 * preview that can be dragged (mouse, pen, touch), moved with the arrow keys
 * and reset by double-click. The width is kept in localStorage.
 */

export const EDITOR_MIN = 280; // px
export const PREVIEW_MIN = 360; // px, the preview always keeps at least this much
const KEY = 'timeline-builder:editor-width';

/** Clamp an editor width to what the layout allows (rounded to whole pixels). */
export function clampEditorWidth(width, layoutWidth) {
  const max = Math.max(EDITOR_MIN, layoutWidth - PREVIEW_MIN);
  return Math.round(Math.min(max, Math.max(EDITOR_MIN, width)));
}

/**
 * @param {HTMLElement} layout    the grid (gets the CSS variable --editor-w)
 * @param {HTMLElement} handle    the divider
 * @param {HTMLElement} editor    the editor column (its width is the start value)
 * @param {() => void} onResized  called once a resize is finished
 */
export function bindSplitter(layout, handle, editor, onResized) {
  const innerWidth = () => {
    const cs = getComputedStyle(layout);
    return layout.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const set = (width) => {
    const w = clampEditorWidth(width, innerWidth());
    layout.style.setProperty('--editor-w', `${w}px`);
    handle.setAttribute('aria-valuenow', String(w));
    return w;
  };
  const save = (value) => {
    try {
      if (value) localStorage.setItem(KEY, String(value));
      else localStorage.removeItem(KEY);
    } catch {
      /* optional */
    }
  };

  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved > 0) set(saved);
  } catch {
    /* optional */
  }

  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const startX = ev.clientX;
    const startW = editor.getBoundingClientRect().width;
    let width = startW;
    document.body.classList.add('resizing');
    const move = (e) => {
      width = set(startW + e.clientX - startX);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('resizing');
      if (Math.round(width) !== Math.round(startW)) {
        save(width);
        onResized();
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });

  let keyTimer;
  handle.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 80 : 20;
    const current = editor.getBoundingClientRect().width;
    const target = { ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: Infinity }[ev.key];
    if (target === undefined) return;
    ev.preventDefault();
    save(set(target));
    clearTimeout(keyTimer);
    keyTimer = setTimeout(onResized, 200);
  });

  // Double-click: back to the default width.
  handle.addEventListener('dblclick', () => {
    layout.style.removeProperty('--editor-w');
    handle.removeAttribute('aria-valuenow');
    save(null);
    onResized();
  });
}
