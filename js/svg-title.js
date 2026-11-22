/**
 * Title alignment. Pele centres the diagram title; this moves it to the left
 * edge of the content (works on the preview and on exported SVGs).
 *
 * @param {SVGSVGElement} svg rendered Pele diagram
 * @param {'center'|'left'} align
 */
export function alignTitle(svg, align) {
  const title = svg?.querySelector('text.pele-title');
  if (!title || align !== 'left') return;
  // Gantt: in line with the section names; timeline: with the leftmost box
  const isGantt = svg.classList.contains('pele-gantt');
  const xs = [...svg.querySelectorAll('rect[x]')]
    .filter((r) => !r.classList.contains('pele-section'))
    .map((r) => Number(r.getAttribute('x')))
    .filter((x) => Number.isFinite(x) && x > 0);
  const left = isGantt ? 16 : Math.min(...xs, 16);
  title.setAttribute('text-anchor', 'start');
  for (const t of [title, ...title.querySelectorAll('tspan')]) if (t.hasAttribute('x')) t.setAttribute('x', String(left));
}
