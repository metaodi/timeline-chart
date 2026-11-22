/**
 * Drag & drop to reorder list items and move them between lists.
 *
 * Built on pointer events (not HTML5 drag & drop), so it works with mouse,
 * pen and touch – HTML5 drag & drop does not work on iOS. Items are dragged by
 * a handle; a marker line shows where the item will land.
 *
 * @param {HTMLElement} root
 * @param {object} o
 * @param {string} o.handle    selector of the drag handle
 * @param {string} o.item      selector of the draggable item (the handle's ancestor)
 * @param {(el: Element) => HTMLElement|null} o.containerAt  list that accepts a drop at the pointed element
 * @param {(item: HTMLElement, container: HTMLElement, index: number) => void} o.onDrop
 *        index counts the container's items without the dragged one
 * @param {() => HTMLElement} [o.scroller]  element to auto-scroll (default: window)
 */
export function sortable(root, o) {
  root.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest(o.handle);
    if (!handle || !root.contains(handle) || ev.button > 0) return;
    const source = handle.closest(o.item);
    if (!source) return;
    ev.preventDefault();
    start(ev, handle, source);
  });

  function start(ev, handle, source) {
    const box = source.getBoundingClientRect();
    const dx = ev.clientX - box.left;
    const dy = ev.clientY - box.top;
    const ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: `${box.width}px`, left: `${box.left}px`, top: `${box.top}px` });
    document.body.append(ghost);
    const marker = document.createElement('li'); // valid in <ul> lists, display:block via CSS elsewhere
    marker.className = 'drop-marker';
    source.classList.add('drag-source');
    document.body.classList.add('dragging');
    let target = null;
    let lastY = ev.clientY;
    let raf = 0;
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      /* not supported: window listeners still work */
    }

    const place = (x, y) => {
      ghost.style.left = `${x - dx}px`;
      ghost.style.top = `${y - dy}px`;
      const under = document.elementFromPoint(x, y);
      const container = under && root.contains(under) ? o.containerAt(under) : null;
      if (!container) {
        marker.remove();
        target = null;
        return;
      }
      const items = [...container.children].filter((c) => c.matches(o.item) && c !== source);
      let index = items.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      if (index < 0) index = items.length;
      if (items[index]) container.insertBefore(marker, items[index]);
      else container.append(marker);
      target = { container, index };
    };

    // keep scrolling while the pointer rests near an edge
    const autoScroll = () => {
      const sc = o.scroller?.() ?? null;
      const top = sc ? sc.getBoundingClientRect().top : 0;
      const bottom = sc ? sc.getBoundingClientRect().bottom : innerHeight;
      const edge = 48;
      const step = lastY < top + edge ? -12 : lastY > bottom - edge ? 12 : 0;
      if (step) {
        if (sc) sc.scrollTop += step;
        else scrollBy(0, step);
      }
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);

    const move = (e) => {
      lastY = e.clientY;
      place(e.clientX, e.clientY);
    };
    const end = (e) => {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      removeEventListener('keydown', esc, true);
      ghost.remove();
      marker.remove();
      source.classList.remove('drag-source');
      document.body.classList.remove('dragging');
      if (e?.type === 'pointerup' && target) o.onDrop(source, target.container, target.index);
    };
    const esc = (e) => {
      if (e.key === 'Escape') end(null);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    addEventListener('keydown', esc, true);
    place(ev.clientX, ev.clientY);
  }
}

/** Move an element of `from` at index `i` into `to` at index `j` (j counts without the moved element). */
export function moveBetween(from, i, to, j) {
  const [x] = from.splice(i, 1);
  to.splice(Math.max(0, Math.min(j, to.length)), 0, x);
}
