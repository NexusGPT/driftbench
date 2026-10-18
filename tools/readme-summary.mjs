/**
 * The summary chart of the README: the five public benchmarks side by side, driftbench the only coloured
 * bar, every competitor grey with its own fill pattern, bars ranked within each benchmark, and an axis
 * break between 30 and 50. It draws only what `rows` holds, and `tools/readme-charts.mjs` fills `rows`
 * from the same bars as the per-benchmark charts. The SVG is rendered by .github/readme/render.mjs.
 *
 * rows: [{ id, name, unit, n, definition, cells: [{ name, score, refused? }] }], the first cell driftbench.
 */
const W = 800;
const H = 810;
const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);
const num = (v) => v.toLocaleString('en-US');
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// the lower segment of the axis, 0 to 30, and the upper one, 50 to 100; 30 to 50 is omitted
const sy = (v) => (v <= 30 ? 518 - v * 1.8 : 436 - (v - 50) * 5.2);
const SANS = 'Geist, ui-sans-serif, system-ui, sans-serif';
const MONO = "'Geist Mono', ui-monospace, Menlo, monospace";
const SERIF = "'Libre Caslon Display', Georgia, serif";
// the fill of each competitor, in the order of the legend
const FILL = { promptfoo: 1, DeepEval: 2, Inspect: 3, Langfuse: 4, LangWatch: 5 };

export function summarySvg(dark, { rows, title, model, sources, notes }) {
  for (const r of rows) {
    for (const c of r.cells) {
      if (c.score > 30 && c.score < 50)
        throw new Error(`${r.name}: a score of ${c.score} falls inside the axis break`);
      if (c.score < 0 || c.score > 100) throw new Error(`${r.name}: invalid score ${c.score}`);
    }
  }
  const p = dark
    ? {
        bg: '#0B0B0C',
        ink: '#F5F3F0',
        muted: '#B4B5BA',
        grid: '#303136',
        blue: '#9DBDF2',
        grey: '#404247',
        pattern: '#96999F',
        solid: '#B1B3B8',
        edge: '#92959B',
      }
    : {
        bg: '#F6F8FB',
        ink: '#0E1116',
        muted: '#555B65',
        grid: '#D9DDE4',
        blue: '#2F5FD0',
        grey: '#E0E1E4',
        pattern: '#8A8D94',
        solid: '#C4C6CC',
        edge: '#9C9FA6',
      };
  let s = '';
  const text = (x, y, t, size = 12, color = p.ink, anchor = 'start', font = SANS, weight = 400, cls = '') => {
    s += `<text class="${cls}" x="${x}" y="${y}" fill="${color}" font-family="${font}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${esc(t)}</text>`;
  };
  const line = (x, y, x2, y2, color = p.grid, width = 1) => {
    s += `<path d="M${x},${y} L${x2},${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  };
  const rect = (x, y, w, h, fill, stroke = 'none') => {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;
  };
  const patterns = [
    `<path d="M-2,2 L2,-2 M0,7 L7,0 M5,9 L9,5" stroke="${p.pattern}" stroke-width="1.1"/>`,
    `<circle cx="2" cy="2" r=".9" fill="${p.pattern}"/><circle cx="5.5" cy="5.5" r=".9" fill="${p.pattern}"/>`,
    `<path d="M0,0 L7,7 M7,0 L0,7" stroke="${p.pattern}" stroke-width=".85"/>`,
    `<path d="M0,2 H7 M0,5.5 H7" stroke="${p.pattern}" stroke-width=".9"/>`,
  ];
  s += `<defs>${patterns
    .map(
      (body, i) =>
        `<pattern id="fill${i + 1}" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="${p.grey}"/>${body}</pattern>`,
    )
    .join('')}</defs>`;
  const fill = (name) =>
    name === 'driftbench' ? p.blue : FILL[name] === 5 ? p.solid : `url(#fill${FILL[name]})`;
  const edge = (name) => (name === 'driftbench' ? 'none' : p.edge);
  const names = rows[0].cells.map((c) => c.name);

  rect(0, 0, W, H, p.bg);
  text(32, 59, title, 38, p.ink, 'start', SERIF);
  text(768, 57, 'Scores out of 100', 11, p.muted, 'end', MONO);
  names.forEach((name, i) => {
    const x = 32 + i * 124;
    rect(x, 91, 18, 16, fill(name), edge(name));
    text(x + 25, 103, name, 11, p.ink, 'start', SANS, name === 'driftbench' ? 600 : 400);
  });
  line(32, 125, 768, 125);
  text(54, 150, 'Score', 11, p.muted);
  text(768, 150, 'Bars ranked within each benchmark', 11, p.muted, 'end');
  for (const v of [0, 30, 50, 60, 70, 80, 90, 100]) {
    const y = sy(v);
    line(54, y, 768, y);
    text(43, y + 3.7, v, 10, p.muted, 'end', MONO);
  }
  line(49, 449, 57, 443, p.muted, 1.2);
  line(49, 455, 57, 449, p.muted, 1.2);
  rows.forEach((r, j) => {
    const ranked = [...r.cells].sort((a, b) => b.score - a.score);
    let lastY = -100;
    ranked.forEach((c, k) => {
      const x = 59 + j * 143 + k * 23;
      const y = sy(c.score);
      const bw = 17;
      const ours = c.name === 'driftbench';
      if (c.score >= 50) {
        rect(x, 464, bw, 54, fill(c.name), edge(c.name));
        rect(x, y, bw, 436 - y, fill(c.name), edge(c.name));
        s += `<path d="M${x},440 l${bw},-5 M${x},460 l${bw},-5" stroke="${ours ? p.blue : p.edge}" stroke-width="1.1"/>`;
      } else rect(x, y, bw, 518 - y, fill(c.name), p.edge);
      let labelY = y - 9;
      // a label wider than its bar slot is lifted above its neighbour, with a short leader
      while (Math.abs(labelY - lastY) < 17) labelY -= 17;
      lastY = labelY;
      if (labelY < y - 9) line(x + bw / 2, labelY + 4, x + bw / 2, y - 3, p.muted, 0.65);
      text(x + bw / 2, labelY, fmt(c.score), 10.5, p.ink, 'middle', MONO, ours ? 600 : 400, 'score');
    });
    text(59 + j * 143 + 66, 546, r.name, 14, p.ink, 'middle', SANS, 500);
  });
  text(54, 568, 'Axis break: 30 to 50 omitted. The lower section uses a compressed scale.', 10.5, p.muted);
  line(32, 586, 768, 586);
  rows.forEach((r, i) => {
    const y = 610 + i * 27;
    text(32, y, r.name, 12, p.ink, 'start', SANS, 600);
    text(149, y, r.definition, 11.4, p.muted);
    text(768, y, `${num(r.n)} ${r.unit}`, 10.5, p.ink, 'end', MONO);
  });
  notes.forEach((n, i) => {
    text(149, 739 + i * 17, n, 11.4, p.muted);
  });
  line(32, 773, 768, 773);
  text(32, 794, `Source: ${sources}. ${model}.`, 10, p.muted, 'start', MONO);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}, grouped bars with a split score axis">${s}</svg>`;
}
