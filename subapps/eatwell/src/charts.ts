// Small SVG charts built with createElementNS (no innerHTML, HB-SEC-04). Each chart carries a text
// alternative (role="img" + aria-label) and colours come from CSS custom properties, so light/dark
// themes and contrast are handled in index.html.
const NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

function root(w: number, h: number, label: string, cls: string): SVGElement {
  return svg('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label, class: cls, preserveAspectRatio: 'xMidYMid meet' });
}

/** Calorie ring: eaten against budget; past 100 % the over part turns to the warning colour. */
export function ring(eaten: number, budget: number, label: string): SVGElement {
  const size = 200;
  const r = 84;
  const c = 2 * Math.PI * r;
  const frac = budget > 0 ? eaten / budget : 0;
  const el = root(size, size, label, 'ring');
  const g = svg('g', { transform: `rotate(-90 ${size / 2} ${size / 2})` });
  g.append(svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-track', fill: 'none', 'stroke-width': 18 }));
  const main = Math.min(frac, 1);
  if (main > 0) g.append(svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-fill', fill: 'none', 'stroke-width': 18, 'stroke-linecap': 'round', 'stroke-dasharray': `${c * main} ${c}` }));
  if (frac > 1) g.append(svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-over', fill: 'none', 'stroke-width': 18, 'stroke-linecap': 'round', 'stroke-dasharray': `${c * Math.min(frac - 1, 1)} ${c}` }));
  el.append(g);
  return el;
}

export interface Bar {
  label: string;
  value: number;
  /** Highlight (e.g. today). */
  current?: boolean;
}

/** Vertical bars with an optional dashed target line (calories vs budget, steps vs goal). */
export function bars(data: Bar[], opts: { target?: number; label: string; format: (n: number) => string }): SVGElement {
  const w = 320;
  const h = 150;
  const top = 14;
  const bottom = 22;
  const max = Math.max(1, opts.target ?? 0, ...data.map((d) => d.value)) * 1.1;
  const el = root(w, h, opts.label, 'bars');
  const bw = w / data.length;
  const y = (v: number) => top + (h - top - bottom) * (1 - v / max);
  data.forEach((d, i) => {
    const x = i * bw + bw * 0.2;
    const by = y(d.value);
    const over = opts.target !== undefined && d.value > opts.target;
    if (d.value > 0) el.append(svg('rect', { x, y: by, width: bw * 0.6, height: Math.max(1, h - bottom - by), rx: 4, class: `bar${d.current ? ' bar-current' : ''}${over ? ' bar-over' : ''}` }));
    const t = svg('text', { x: x + bw * 0.3, y: h - 6, 'text-anchor': 'middle', class: 'axis' });
    t.textContent = d.label;
    el.append(t);
  });
  if (opts.target) {
    const ty = y(opts.target);
    el.append(svg('line', { x1: 0, x2: w, y1: ty, y2: ty, class: 'target' }));
    const t = svg('text', { x: w - 2, y: ty - 4, 'text-anchor': 'end', class: 'axis' });
    t.textContent = opts.format(opts.target);
    el.append(t);
  }
  return el;
}

/** Weight line with dots and an optional goal line. Dates are evenly spaced by calendar day. */
export function line(points: { x: number; y: number }[], opts: { goal?: number; label: string; format: (n: number) => string; xLabels: [string, string] }): SVGElement {
  const w = 320;
  const h = 170;
  const pad = { l: 40, r: 10, t: 12, b: 22 };
  const el = root(w, h, opts.label, 'line');
  const ys = points.map((p) => p.y).concat(opts.goal ? [opts.goal] : []);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(1, maxY - minY);
  const lo = minY - span * 0.15;
  const hi = maxY + span * 0.15;
  const maxX = Math.max(1, ...points.map((p) => p.x));
  const px = (x: number) => pad.l + ((w - pad.l - pad.r) * x) / maxX;
  const py = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  for (const v of [hi - (hi - lo) * 0.1, lo + (hi - lo) * 0.1]) {
    const t = svg('text', { x: pad.l - 6, y: py(v) + 4, 'text-anchor': 'end', class: 'axis' });
    t.textContent = opts.format(v);
    el.append(t, svg('line', { x1: pad.l, x2: w - pad.r, y1: py(v), y2: py(v), class: 'grid' }));
  }
  if (opts.goal) el.append(svg('line', { x1: pad.l, x2: w - pad.r, y1: py(opts.goal), y2: py(opts.goal), class: 'target' }));
  if (points.length > 1) el.append(svg('polyline', { points: points.map((p) => `${px(p.x)},${py(p.y)}`).join(' '), class: 'trend', fill: 'none' }));
  for (const p of points) el.append(svg('circle', { cx: px(p.x), cy: py(p.y), r: 3.5, class: 'dot' }));
  const [a, b] = opts.xLabels;
  const ta = svg('text', { x: pad.l, y: h - 6, class: 'axis' });
  ta.textContent = a;
  const tb = svg('text', { x: w - pad.r, y: h - 6, 'text-anchor': 'end', class: 'axis' });
  tb.textContent = b;
  el.append(ta, tb);
  return el;
}
