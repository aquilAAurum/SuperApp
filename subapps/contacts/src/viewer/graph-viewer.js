// Supra Contacts graph viewer. Plain browser JS, inlined into the exported HTML by src/graph.ts.
// Rules (Supra subapp CSP): no network, no HTML-string sinks, no dynamic code; all text goes through textContent.
// Two hosts: the exported HTML (data in <script id="data">, mounted automatically at the end of this
// file) and the Supra Contacts subapp, which builds the same DOM and calls
// globalThis.mountSupraGraph(data, { onOpen }) itself. Returns { destroy } so a host can unmount it.
(() => {
  "use strict";
function mountSupraGraph(DATA, opts = {}) {
  const onOpen = typeof opts.onOpen === "function" ? opts.onOpen : null;
  let stopped = false;
  const $ = (id) => document.getElementById(id);
  const N = DATA.nodes.length, L = DATA.links.length;
  const nodes = DATA.nodes, links = DATA.links;

  // ------------------------------------------------------------------ vocabulary
  const KIND = {
    person: { c: "#3b5bff", l: "People" }, organization: { c: "#1ed760", l: "Organizations" }, role: { c: "#ff2d2d", l: "Roles" },
    project: { c: "#ff7a3d", l: "Projects" }, event: { c: "#e040fb", l: "Events" }, group: { c: "#18d4e6", l: "Groups" },
    note: { c: "#cfcfcf", l: "Other notes" }, mention: { c: "#9a9a9a", l: "Unlinked names" },
  };
  const GHOST = "#5f5f5f";
  const REL = {
    work: { l: "Employment", r: ["works_at", "worked_at"] },
    involve: { l: "Roles, projects, lists", r: ["involved_in", "listed_under"] },
    people: { l: "Person ↔ person", r: ["knows", "key_contact", "primary_contact", "reports_to"] },
    affil: { l: "Schools, networks, related orgs", r: ["alumnus_of", "member_of", "related_to", "subsidiary_of", "owner"] },
    mention: { l: "Body mentions", r: ["mentions"] },
  };
  const relBit = {};
  Object.keys(REL).forEach((g, i) => REL[g].r.forEach((r) => (relBit[r] = 1 << i)));
  const AFFIL = 1 << Object.keys(REL).indexOf("affil");
  const lmask = new Uint8Array(L);
  links.forEach((l, k) => { for (const r of l.r.split(",")) lmask[k] |= relBit[r] ?? AFFIL; });
  const adj = Array.from({ length: N }, () => []);
  links.forEach((l, k) => { adj[l.s].push(k); adj[l.t].push(k); });
  const other = (k, i) => (links[k].s === i ? links[k].t : links[k].s);
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const lower = nodes.map((n) => n.t.toLowerCase());
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

  // ------------------------------------------------------------------ persisted preferences
  const store = {
    get(k, d) { try { const v = localStorage.getItem("supra-graph:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("supra-graph:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem("supra-graph:" + k); } catch { /* ignore */ } },
  };
  const big = N > 400;
  const st = Object.assign({
    kinds: Object.keys(KIND).filter((k) => k !== "mention"),
    rels: Object.keys(REL),
    ghosts: true, fold: big, labels: true, minDeg: 0, color: "kind", islands: big,
  }, store.get("prefs", {}));
  if (st.color === "tier") st.color = "seniority"; // saved before the O-6 split
  const savePrefs = () => store.set("prefs", st);
  let selected = -1, hover = -1, focusDepth = 0, path = null, query = "";
  const expanded = new Set();

  // ------------------------------------------------------------------ communities (label propagation; deterministic)
  const community = new Int32Array(N);
  {
    for (let i = 0; i < N; i++) community[i] = i;
    const order = [...Array(N).keys()].sort((a, b) => adj[b].length - adj[a].length);
    for (let it = 0; it < 12; it++) {
      let changed = 0;
      for (const i of order) {
        if (nodes[i].k === "mention") continue;
        const w = new Map();
        for (const k of adj[i]) { if (lmask[k] & 16) continue; const c = community[other(k, i)]; w.set(c, (w.get(c) || 0) + links[k].w); }
        let best = community[i], bw = 0;
        for (const [c, v] of w) if (v > bw || (v === bw && c < best)) { bw = v; best = c; }
        if (best !== community[i]) { community[i] = best; changed++; }
      }
      if (!changed) break;
    }
  }
  // Merge tiny communities (label propagation leaves many) into the cluster they're most tied to.
  for (let pass = 0; pass < 3; pass++) {
    const size = new Map(); for (let i = 0; i < N; i++) size.set(community[i], (size.get(community[i]) || 0) + 1);
    let moved = 0;
    for (let i = 0; i < N; i++) {
      if (size.get(community[i]) >= 6) continue;
      const w = new Map();
      for (const k of adj[i]) { const c = community[other(k, i)]; if (size.get(c) >= 6) w.set(c, (w.get(c) || 0) + links[k].w); }
      let best = -1, bw = 0; for (const [c, v] of w) if (v > bw) { bw = v; best = c; }
      if (best >= 0) { community[i] = best; moved++; }
    }
    if (!moved) break;
  }
  const PALETTE = ["#3b82f6", "#22c55e", "#ef4444", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#eab308", "#8b5cf6"];
  const commColor = new Map();
  {
    const size = new Map();
    for (let i = 0; i < N; i++) size.set(community[i], (size.get(community[i]) || 0) + 1);
    [...size.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n], idx) => { if (n >= 6) commColor.set(c, PALETTE[idx % PALETTE.length]); });
  }
  const commName = (c) => { let best = -1; for (let i = 0; i < N; i++) if (community[i] === c && nodes[i].k !== "person" && (best < 0 || adj[i].length > adj[best].length)) best = i; return best >= 0 ? nodes[best].t : "cluster"; };
  const SEN = [...new Set(nodes.map((n) => n.sen).filter(Boolean))].sort();
  const RELS = [...new Set(nodes.map((n) => n.rel).filter(Boolean))].sort();

  function color(i) {
    const n = nodes[i];
    switch (st.color) {
      case "community": return commColor.get(community[i]) || GHOST;
      case "reach":
        if (n.k !== "person") return "#5a5a5a";
        if (!n.due) return n.g ? GHOST : "#6b7bd6";
        return n.due < today ? "#ff453a" : n.due <= soon ? "#ffb020" : "#30d158";
      case "seniority": return n.sen ? PALETTE[SEN.indexOf(n.sen) % PALETTE.length] : GHOST;
      case "relationship": return n.rel ? PALETTE[RELS.indexOf(n.rel) % PALETTE.length] : GHOST;
      default: return n.g ? GHOST : (KIND[n.k] || KIND.note).c;
    }
  }
  function legendItems() {
    switch (st.color) {
      case "community": return [...commColor.entries()].slice(0, 8).map(([c, col]) => [col, commName(c)]);
      case "reach": return [["#ff453a", "Overdue"], ["#ffb020", "Due in 14 days"], ["#30d158", "Scheduled"], ["#6b7bd6", "No schedule"]];
      case "seniority": return SEN.slice(0, 10).map((t, i) => [PALETTE[i % PALETTE.length], t]);
      case "relationship": return RELS.slice(0, 10).map((t, i) => [PALETTE[i % PALETTE.length], t]);
      default: return [...Object.entries(KIND).filter(([k]) => st.kinds.includes(k)).map(([, v]) => [v.c, v.l]), [GHOST, "No note yet"]];
    }
  }

  // ------------------------------------------------------------------ visibility (recomputed on change, not per frame)
  const vis = new Uint8Array(N), evis = new Uint8Array(L), vdeg = new Int32Array(N), folded = new Int32Array(N);
  let act = [], actLinks = [], local = null;
  function bfs(src, depth, edgeOk) {
    const dist = new Map([[src, 0]]); let frontier = [src];
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const a of frontier) for (const k of adj[a]) { if (!edgeOk(k)) continue; const o = other(k, a); if (!dist.has(o)) { dist.set(o, d); next.push(o); } }
      frontier = next;
    }
    return dist;
  }
  function recompute() {
    const kinds = new Set(st.kinds);
    const relMask = st.rels.reduce((m, g) => m | (1 << Object.keys(REL).indexOf(g)), 0);
    const pinned = new Set(path || []);
    if (selected >= 0) pinned.add(selected);
    const base = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      base[i] = pinned.has(i) || (kinds.has(n.k) && (st.ghosts || !n.g)) ? 1 : 0;
    }
    const edgeOk = (k) => (lmask[k] & relMask) !== 0 && base[links[k].s] && base[links[k].t];
    local = focusDepth > 0 && selected >= 0 ? bfs(selected, focusDepth, edgeOk) : null;
    if (local) for (let i = 0; i < N; i++) if (!local.has(i) && !pinned.has(i)) base[i] = 0;
    const degree = () => { vdeg.fill(0); for (let k = 0; k < L; k++) if (edgeOk(k)) { vdeg[links[k].s]++; vdeg[links[k].t]++; } };
    degree();
    if (st.minDeg > 0) { for (let i = 0; i < N; i++) if (base[i] && vdeg[i] < st.minDeg && !pinned.has(i)) base[i] = 0; degree(); }
    folded.fill(0);
    vis.set(base);
    if (st.fold && !local) {
      for (let i = 0; i < N; i++) {
        if (!base[i] || vdeg[i] !== 1 || pinned.has(i)) continue;
        let j = -1; for (const k of adj[i]) if (edgeOk(k)) { j = other(k, i); break; }
        if (j >= 0 && vdeg[j] > 1 && !expanded.has(j) && j !== selected) { vis[i] = 0; folded[j]++; }
      }
    }
    act = []; actLinks = [];
    for (let i = 0; i < N; i++) if (vis[i]) act.push(i);
    for (let k = 0; k < L; k++) { evis[k] = edgeOk(k) && vis[links[k].s] && vis[links[k].t] ? 1 : 0; if (evis[k]) actLinks.push(k); }
    const nf = folded.reduce((a, b) => a + b, 0);
    $("stats").textContent = `${act.length} of ${N} nodes · ${actLinks.length} links` + (nf ? ` · ${nf} folded into hubs` : "") + (local ? ` · ${focusDepth}-hop view` : "");
    renderLegend();
  }

  // ------------------------------------------------------------------ positions (remembered between visits)
  const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N), fixed = new Uint8Array(N);
  const r = nodes.map((n) => (n.k === "mention" ? 2 : 2.4 + Math.sqrt(n.d) * 1.5));
  let alpha = 1;
  function seed(keepSaved) {
    const saved = keepSaved ? store.get("pos", {}) : {};
    let hits = 0;
    for (let i = 0; i < N; i++) {
      const p = saved[nodes[i].id];
      if (p) { x[i] = p[0]; y[i] = p[1]; hits++; }
      else if (st.islands) { const c = commSeed.get(community[i]) || [0, 0], a = Math.random() * 6.283, d = 40 * Math.sqrt(Math.random()); x[i] = c[0] + Math.cos(a) * d; y[i] = c[1] + Math.sin(a) * d; }
      else { const a = i * 2.399963, d = 14 * Math.sqrt(i + 1); x[i] = Math.cos(a) * d; y[i] = Math.sin(a) * d; }
      vx[i] = vy[i] = 0;
    }
    // new nodes start next to a neighbour that already has a place
    if (hits) for (let i = 0; i < N; i++) if (!saved[nodes[i].id]) for (const k of adj[i]) { const o = other(k, i); if (saved[nodes[o].id]) { x[i] = x[o] + (Math.random() - 0.5) * 30; y[i] = y[o] + (Math.random() - 0.5) * 30; break; } }
    alpha = hits > N * 0.6 ? 0.12 : 1;
  }
  // Cluster seeds on a golden-angle spiral, biggest clusters in the middle.
  const commSeed = new Map(), commSize = new Map();
  {
    for (let i = 0; i < N; i++) commSize.set(community[i], (commSize.get(community[i]) || 0) + 1);
    // spacing grows with cluster size so big clusters get room
    let k = 0;
    [...commSize.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => { if (n < 6) return; const a = k * 2.399963, d = 260 * Math.sqrt(k); commSeed.set(c, [Math.cos(a) * d, Math.sin(a) * d]); k++; });
  }
  const savePositions = () => { const o = {}; for (let i = 0; i < N; i++) o[nodes[i].id] = [Math.round(x[i]), Math.round(y[i])]; store.set("pos", o); };

  // ------------------------------------------------------------------ force layout over visible nodes (Barnes–Hut)
  const CAP = N * 4 + 16;
  const qx = new Float64Array(CAP), qy = new Float64Array(CAP), qm = new Float64Array(CAP), qbx = new Float64Array(CAP), qby = new Float64Array(CAP), qbs = new Float64Array(CAP);
  const qkid = new Int32Array(CAP * 4), qleaf = new Int32Array(CAP), qstack = new Int32Array(CAP);
  let qused = 0;
  function qnew(bx, by, bs) { const c = qused++; qx[c] = qy[c] = qm[c] = 0; qleaf[c] = -1; qkid.fill(-1, c * 4, c * 4 + 4); qbx[c] = bx; qby[c] = by; qbs[c] = bs; return c; }
  function qchild(nd, i) {
    const h = qbs[nd] / 2, cx = x[i] >= qbx[nd] + h ? 1 : 0, cy = y[i] >= qby[nd] + h ? 1 : 0, q = nd * 4 + cy * 2 + cx;
    if (qkid[q] < 0) { if (qused >= CAP) return -1; qkid[q] = qnew(qbx[nd] + cx * h, qby[nd] + cy * h, h); }
    return qkid[q];
  }
  function qinsert(i) {
    let nd = 0;
    for (let depth = 0; ; depth++) {
      if (qm[nd] === 0) { qx[nd] = x[i]; qy[nd] = y[i]; qm[nd] = 1; qleaf[nd] = i; return; }
      if (qleaf[nd] >= 0 && depth <= 40) { const j = qleaf[nd], c = qchild(nd, j); qleaf[nd] = -2; if (c >= 0) { qx[c] = x[j]; qy[c] = y[j]; qm[c] = 1; qleaf[c] = j; } }
      qx[nd] += x[i]; qy[nd] += y[i]; qm[nd] += 1;
      if (depth > 40) return;
      nd = qchild(nd, i); if (nd < 0) return;
    }
  }
  function tick() {
    if (!act.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of act) { if (x[i] < minX) minX = x[i]; if (y[i] < minY) minY = y[i]; if (x[i] > maxX) maxX = x[i]; if (y[i] > maxY) maxY = y[i]; }
    qused = 0; qnew(minX, minY, Math.max(maxX - minX, maxY - minY) + 1);
    for (const i of act) qinsert(i);
    const rep = 60 * alpha, theta2 = 0.81, maxD2 = 350 * 350;
    for (const i of act) {
      let sp = 0; qstack[sp++] = 0;
      while (sp) {
        const nd = qstack[--sp]; if (qm[nd] === 0 || qleaf[nd] === i) continue;
        let dx = qx[nd] / qm[nd] - x[i], dy = qy[nd] / qm[nd] - y[i], d2 = dx * dx + dy * dy;
        const far = (qbs[nd] * qbs[nd]) / (d2 + 1e-9) < theta2;
        if (d2 > maxD2 && far) continue;
        if (qleaf[nd] >= 0 || far) { if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; } const f = (rep * qm[nd]) / d2; vx[i] -= dx * f; vy[i] -= dy * f; }
        else for (let q = 0; q < 4; q++) { const c = qkid[nd * 4 + q]; if (c >= 0) qstack[sp++] = c; }
      }
    }
    for (const k of actLinks) {
      const a = links[k].s, b = links[k].t;
      const dx = x[b] + vx[b] - x[a] - vx[a], dy = y[b] + vy[b] - y[a] - vy[a], d = Math.sqrt(dx * dx + dy * dy) || 1;
      const da = vdeg[a] || 1, db = vdeg[b] || 1, bias = da / (da + db);
      const cross = st.islands && !local && community[a] !== community[b] ? 0.12 : 1; // loose ties between clusters
      const f = ((d - 34) / d) * alpha * cross / Math.min(da, db);
      vx[b] -= dx * f * bias; vy[b] -= dy * f * bias; vx[a] += dx * f * (1 - bias); vy[a] += dy * f * (1 - bias);
    }
    const islands = st.islands && !local;
    for (const i of act) {
      // islands: each cluster is anchored at its own seed point instead of the global centre
      const a = islands && commSize.get(community[i]) >= 6 ? commSeed.get(community[i]) : null;
      if (a) { vx[i] += (a[0] - x[i]) * 0.1 * alpha; vy[i] += (a[1] - y[i]) * 0.1 * alpha; }
      else { vx[i] -= x[i] * 0.012 * alpha; vy[i] -= y[i] * 0.012 * alpha; }
      if (fixed[i]) { vx[i] = vy[i] = 0; continue; }
      vx[i] *= 0.6; vy[i] *= 0.6;
      const sp = Math.hypot(vx[i], vy[i]); if (sp > 40) { vx[i] *= 40 / sp; vy[i] *= 40 / sp; }
      x[i] += vx[i]; y[i] += vy[i];
    }
    alpha = Math.max(alpha * 0.985, 0.002);
  }
  const reheat = (a) => { alpha = Math.max(alpha, a); settled = false; };

  // ------------------------------------------------------------------ drawing
  const canvas = $("c"), ctx = canvas.getContext("2d");
  let scale = 1, ox = 0, oy = 0, dpr = 1, W = 0, H = 0, settled = false;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let BG = css("--bg"), TEXT = css("--text"), EDGE = css("--edge");
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { BG = css("--bg"); TEXT = css("--text"); EDGE = css("--edge"); });
  function resize() { dpr = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; }
  function fit(only) {
    const set = only || act; if (!set.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of set) { minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]); }
    scale = Math.min(W / (maxX - minX + 120), (H - 80) / (maxY - minY + 120), 3);
    ox = W / 2 - ((minX + maxX) / 2) * scale; oy = (H + 40) / 2 - ((minY + maxY) / 2) * scale;
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const focus = path && path.length ? -1 : hover >= 0 ? hover : selected;
    const near = new Set();
    if (focus >= 0) { near.add(focus); for (const k of adj[focus]) if (evis[k]) near.add(other(k, focus)); }
    const pathSet = new Set(path || []);
    const q = query.toLowerCase();
    const dimmed = (i) => (path ? !pathSet.has(i) : focus >= 0 ? !near.has(i) : q ? !lower[i].includes(q) : false);
    const [vx0, vy0] = toWorld(0, 0), [vx1, vy1] = toWorld(W, H);
    const onScreen = (i) => x[i] > vx0 - 50 && x[i] < vx1 + 50 && y[i] > vy0 - 50 && y[i] < vy1 + 50;
    // edges: one batched path for the background, highlighted ones on top
    const lw = 0.7 / Math.sqrt(scale);
    ctx.lineWidth = lw;
    ctx.strokeStyle = `rgba(${EDGE},${focus >= 0 || path ? 0.1 : 0.38})`;
    ctx.beginPath();
    const hi = [];
    for (const k of actLinks) {
      const a = links[k].s, b = links[k].t;
      if ((focus >= 0 && (a === focus || b === focus)) || (path && pathSet.has(a) && pathSet.has(b) && Math.abs(path.indexOf(a) - path.indexOf(b)) === 1)) { hi.push(k); continue; }
      ctx.moveTo(x[a], y[a]); ctx.lineTo(x[b], y[b]);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(157,124,255,.95)"; ctx.lineWidth = path ? 3 / scale : 1.3 / scale;
    ctx.beginPath();
    for (const k of hi) { const a = links[k].s, b = links[k].t; ctx.moveTo(x[a], y[a]); ctx.lineTo(x[b], y[b]); }
    ctx.stroke();
    // nodes
    for (const i of act) {
      if (!onScreen(i)) continue;
      ctx.globalAlpha = dimmed(i) ? 0.13 : 1;
      ctx.fillStyle = color(i);
      ctx.beginPath(); ctx.arc(x[i], y[i], r[i], 0, Math.PI * 2);
      if (nodes[i].k === "mention") { ctx.lineWidth = 1 / scale; ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); } else ctx.fill();
      if (i === selected) { ctx.strokeStyle = TEXT; ctx.lineWidth = 2 / scale; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // fold badges
    ctx.font = `${10 / scale}px system-ui, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const i of act) {
      if (!folded[i] || !onScreen(i) || (r[i] * scale < 4 && i !== selected) || dimmed(i)) continue;
      ctx.fillStyle = color(i); ctx.fillText("+" + folded[i], x[i] + r[i] + 2 / scale, y[i] - r[i]);
    }
    if (st.labels) drawLabels(focus, near, pathSet, q, dimmed, onScreen);
  }
  // Labels by priority (selection, path, neighbours, matches, then biggest hubs), skipping overlaps.
  function drawLabels(focus, near, pathSet, q, dimmed, onScreen) {
    const fs = 11.5;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fs}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
    const cand = [];
    for (const i of act) {
      if (!onScreen(i)) continue;
      let p = r[i] * scale;
      if (i === focus || i === selected) p += 1e6; else if (pathSet.has(i)) p += 1e5; else if (near.has(i) && focus >= 0) p += 1e4; else if (q && lower[i].includes(q)) p += 1e3; else if (dimmed(i)) continue;
      if (p < 3.2 && scale < 2.5) continue;
      cand.push([p, i]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    const placed = [];
    ctx.lineWidth = 3; ctx.strokeStyle = BG; ctx.fillStyle = TEXT;
    for (const [, i] of cand.slice(0, 400)) {
      const t = nodes[i].t, w = ctx.measureText(t).width, sx = x[i] * scale + ox, sy = (y[i] + r[i]) * scale + oy + 2;
      const box = [sx - w / 2 - 2, sy - 1, sx + w / 2 + 2, sy + fs + 1];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box); ctx.strokeText(t, sx, sy); ctx.fillText(t, sx, sy);
      if (placed.length > 140) break;
    }
  }

  // ------------------------------------------------------------------ pointer: pan, zoom, drag, pinch, pick
  const toWorld = (px, py) => [(px - ox) / scale, (py - oy) / scale];
  function pick(px, py) {
    const [wx, wy] = toWorld(px, py); let best = -1, bd = Infinity;
    for (const i of act) { const dx = x[i] - wx, dy = y[i] - wy, d = dx * dx + dy * dy, rr = Math.max(r[i], 7 / scale); if (d < rr * rr && d < bd) { bd = d; best = i; } }
    return best;
  }
  const pointers = new Map();
  let drag = null, pinch = null;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), scale, ox, oy, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; drag = null; return; }
    const i = pick(e.clientX, e.clientY);
    drag = { i, sx: e.clientX, sy: e.clientY, ox, oy, moved: false };
    if (i >= 0) { fixed[i] = 1; reheat(0.15); }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], k = Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d;
      const [wx, wy] = [(pinch.mx - pinch.ox) / pinch.scale, (pinch.my - pinch.oy) / pinch.scale];
      scale = Math.min(Math.max(pinch.scale * k, 0.05), 12); ox = (a[0] + b[0]) / 2 - wx * scale; oy = (a[1] + b[1]) / 2 - wy * scale;
      return;
    }
    if (!drag) { const h = pick(e.clientX, e.clientY); if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 ? "pointer" : "grab"; } return; }
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.i >= 0) { const [wx, wy] = toWorld(e.clientX, e.clientY); x[drag.i] = wx; y[drag.i] = wy; }
    else { ox = drag.ox + e.clientX - drag.sx; oy = drag.oy + e.clientY - drag.sy; }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (drag && drag.i >= 0) { fixed[drag.i] = 0; if (drag.moved) savePositions(); }
    if (drag && !drag.moved) select(drag.i, false);
    drag = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { hover = -1; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015), [wx, wy] = toWorld(e.clientX, e.clientY);
    scale = Math.min(Math.max(scale * k, 0.05), 12); ox = e.clientX - wx * scale; oy = e.clientY - wy * scale;
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => { const i = pick(e.clientX, e.clientY); if (i >= 0) { select(i, true); setFocus(focusDepth || 1); } });

  // ------------------------------------------------------------------ DOM helpers
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) { if (k === "style") n.style.cssText = v; else if (k.startsWith("aria-") || k === "role") n.setAttribute(k, v); else n[k] = v; }
    for (const k of kids) if (k !== null && k !== undefined) n.append(k);
    return n;
  }
  const dot = (c) => el("i", { className: "dot", style: "background:" + c });
  function center(i) { ox = W / 2 - x[i] * scale; oy = (W <= 640 && selected >= 0 ? H * 0.27 : H / 2) - y[i] * scale; }

  // ------------------------------------------------------------------ selection panel
  const panel = $("panel");
  function select(i, recenter) {
    selected = i; path = null;
    if (i < 0) focusDepth = 0;
    try { history.replaceState(null, "", i >= 0 ? "#n=" + nodes[i].id : location.pathname + location.search); } catch { /* file:// */ }
    recompute(); reheat(0.08);
    if (recenter && i >= 0) center(i);
    renderPanel();
  }
  function setFocus(d) { focusDepth = d; recompute(); reheat(0.3); fitSoon = 25; renderPanel(); }
  function renderPanel() {
    panel.replaceChildren();
    if (selected < 0) { panel.classList.remove("open"); return; }
    const i = selected, n = nodes[i];
    panel.append(el("h2", { textContent: n.t }), el("div", { className: "meta", textContent: [(KIND[n.k] || KIND.note).l.replace(/s$/, ""), n.g ? "no note yet" : null, adj[i].length + " links"].filter(Boolean).join(" · ") }));
    const dl = el("dl");
    for (const [k, v] of [["Title", n.job], ["Org", n.org], ["Seniority", n.sen], ["Relationship", n.rel], ["Email", n.email], ["Phone", n.phone], ["Reach out", n.due ? n.due + (n.due < today ? " (overdue)" : "") : null]]) if (v) dl.append(el("dt", { textContent: k }), el("dd", { textContent: v }));
    if (dl.childNodes.length) panel.append(dl);

    const seg = el("div", { className: "seg", role: "group", "aria-label": "Neighbourhood depth" });
    for (const [d, label] of [[0, "All"], [1, "1 hop"], [2, "2 hops"], [3, "3 hops"]]) seg.append(el("button", { type: "button", textContent: label, "aria-pressed": String(focusDepth === d), onclick: () => setFocus(d) }));
    panel.append(el("div", { className: "row" }, seg, el("button", { className: "btn small", type: "button", textContent: "Close", onclick: () => select(-1) })));
    if (onOpen && !n.g && n.k !== "mention") panel.append(el("div", { className: "row" }, el("button", { className: "btn small", type: "button", textContent: "Open card", onclick: () => onOpen(n.id) })));

    // path finder
    const pin = el("input", { type: "search", placeholder: "How am I connected to…", "aria-label": "Find path to" });
    const go = () => { const t = bestMatch(pin.value); if (t >= 0) findPath(i, t); };
    pin.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    panel.append(el("div", { className: "row" }, pin, el("button", { className: "btn small", type: "button", textContent: "Path", onclick: go })));
    if (path) {
      if (!path.length) panel.append(el("p", { className: "hint", textContent: "No path with the current filters." }));
      else {
        const ol = el("ol", { className: "path" });
        path.forEach((p, idx) => {
          let rel = "";
          if (idx > 0) { const k = adj[p].find((k2) => other(k2, p) === path[idx - 1]); rel = k !== undefined ? links[k].r.replace(/_/g, " ").replace(/,/g, ", ") : ""; }
          ol.append(el("li", null, el("button", { type: "button", onclick: () => { center(p); } }, dot(color(p)), nodes[p].t, el("small", { textContent: rel }))));
        });
        panel.append(el("h3", { textContent: `Path · ${path.length - 1} steps` }), ol);
      }
    }

    // neighbours grouped by kind
    const groups = {};
    for (const k of adj[i]) { const o = other(k, i); (groups[nodes[o].k] ||= new Map()).set(o, links[k].r); }
    for (const kind of Object.keys(KIND)) {
      const items = groups[kind]; if (!items) continue;
      panel.append(el("h3", { textContent: `${KIND[kind].l} (${items.size})` }));
      const ul = el("ul");
      [...items.entries()].sort((a, b) => nodes[a[0]].t.localeCompare(nodes[b[0]].t)).slice(0, 200).forEach(([o, rel]) => {
        ul.append(el("li", null, el("button", { type: "button", onclick: () => select(o, true) }, dot(color(o)), nodes[o].t, el("small", { textContent: rel.replace(/_/g, " ").replace(/,/g, ", ") }))));
      });
      panel.append(ul);
    }
    panel.classList.add("open");
  }
  function findPath(a, b) {
    const relMask = st.rels.reduce((m, g) => m | (1 << Object.keys(REL).indexOf(g)), 0);
    const prev = new Map([[a, -1]]); let frontier = [a];
    while (frontier.length && !prev.has(b)) {
      const next = [];
      for (const u of frontier) for (const k of adj[u]) { if (!(lmask[k] & relMask)) continue; const v = other(k, u); if (!prev.has(v)) { prev.set(v, u); next.push(v); } }
      frontier = next;
    }
    path = [];
    if (prev.has(b)) { for (let v = b; v !== -1; v = prev.get(v)) path.unshift(v); }
    recompute(); reheat(0.1);
    if (path.length) { fitSoon = 0; fit(path); }
    renderPanel();
  }

  // ------------------------------------------------------------------ search with results list
  const qInput = $("q"), res = $("res");
  let resItems = [], resIdx = -1;
  function matches(text, limit) {
    const t = text.trim().toLowerCase(); if (!t) return [];
    const out = [];
    for (let i = 0; i < N; i++) { const p = lower[i].indexOf(t); if (p >= 0) out.push([p === 0 ? 0 : lower[i][p - 1] === " " ? 1 : 2, -adj[i].length, i]); }
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || lower[a[2]].localeCompare(lower[b[2]]));
    return out.slice(0, limit).map((m) => m[2]);
  }
  const bestMatch = (t) => matches(t, 1)[0] ?? -1;
  function renderResults() {
    res.replaceChildren();
    resItems.forEach((i, idx) => {
      const li = el("li", { role: "option", id: "r" + idx, "aria-selected": String(idx === resIdx), onclick: () => choose(i) }, dot(color(i)), nodes[i].t, el("small", { textContent: (KIND[nodes[i].k] || KIND.note).l.replace(/s$/, "") + (vis[i] ? "" : " · hidden") }));
      res.append(li);
    });
    res.classList.toggle("open", resItems.length > 0);
    qInput.setAttribute("aria-expanded", String(resItems.length > 0));
  }
  function choose(i) { resItems = []; renderResults(); qInput.value = ""; query = ""; qInput.blur(); select(i, true); }
  qInput.addEventListener("input", () => { query = qInput.value.trim(); resItems = matches(query, 8); resIdx = resItems.length ? 0 : -1; renderResults(); });
  qInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (resItems.length) { resIdx = (resIdx + (e.key === "ArrowDown" ? 1 : resItems.length - 1)) % resItems.length; renderResults(); } }
    else if (e.key === "Enter" && resIdx >= 0) { e.preventDefault(); choose(resItems[resIdx]); }
    else if (e.key === "Escape") { qInput.value = ""; query = ""; resItems = []; renderResults(); }
  });
  qInput.addEventListener("blur", () => setTimeout(() => { resItems = []; renderResults(); }, 150));
  const onKey = (e) => {
    if (e.key === "/" && document.activeElement !== qInput) { e.preventDefault(); qInput.focus(); }
    else if (e.key === "Escape" && document.activeElement !== qInput) { select(-1); }
  };
  addEventListener("keydown", onKey);

  // ------------------------------------------------------------------ filters drawer
  const drawer = $("drawer");
  $("filters").onclick = () => { const open = !drawer.classList.contains("open"); drawer.classList.toggle("open", open); $("filters").setAttribute("aria-expanded", String(open)); };
  function check(label, on, onChange, extra) {
    const box = el("input", { type: "checkbox", checked: on, onchange: () => onChange(box.checked) });
    return el("label", null, box, ...(extra ? [extra[0]] : []), label, extra ? el("small", { textContent: extra[1] }) : null);
  }
  function renderDrawer() {
    drawer.replaceChildren();
    const counts = {}; for (const n of nodes) counts[n.k] = (counts[n.k] || 0) + 1;
    drawer.append(el("h3", { textContent: "Show" }));
    for (const [k, v] of Object.entries(KIND)) {
      if (!counts[k]) continue;
      drawer.append(check(v.l, st.kinds.includes(k), (on) => { st.kinds = on ? [...st.kinds, k] : st.kinds.filter((x2) => x2 !== k); changed(); }, [dot(v.c), String(counts[k])]));
    }
    const ghosts = nodes.filter((n) => n.g).length;
    drawer.append(check("Notes not created yet", st.ghosts, (on) => { st.ghosts = on; changed(); }, [dot(GHOST), String(ghosts)]));
    drawer.append(el("h3", { textContent: "Connections" }));
    for (const [g, v] of Object.entries(REL)) drawer.append(check(v.l, st.rels.includes(g), (on) => { st.rels = on ? [...st.rels, g] : st.rels.filter((x2) => x2 !== g); changed(); }));
    drawer.append(el("h3", { textContent: "Declutter" }));
    drawer.append(check("Fold single-link nodes into their hub (+N)", st.fold, (on) => { st.fold = on; expanded.clear(); changed(); }));
    drawer.append(check("Labels", st.labels, (on) => { st.labels = on; changed(); }));
    drawer.append(check("Group clusters into islands", st.islands, (on) => { st.islands = on; savePrefs(); store.del("pos"); seed(false); fitSoon = 60; }));
    const val = el("small", { textContent: String(st.minDeg) });
    const range = el("input", { type: "range", min: "0", max: "12", value: String(st.minDeg), "aria-label": "Minimum links", oninput: () => { st.minDeg = +range.value; val.textContent = range.value; changed(); } });
    drawer.append(el("label", null, "Minimum links", val), range, el("p", { className: "hint", textContent: "Hide nodes with fewer links. Selected and path nodes always stay." }));
    drawer.append(el("h3", { textContent: "Layout" }));
    drawer.append(el("div", { className: "row" },
      el("button", { className: "btn small", type: "button", textContent: "Re-run layout", onclick: () => { store.del("pos"); seed(false); fitSoon = 60; } }),
      el("button", { className: "btn small", type: "button", textContent: "Reset filters", onclick: () => { store.del("prefs"); location.reload(); } })));
  }
  function changed() { savePrefs(); recompute(); reheat(0.25); if (selected >= 0) renderPanel(); }

  // ------------------------------------------------------------------ colour lens + legend
  const colorSel = $("color");
  colorSel.value = st.color;
  colorSel.onchange = () => { st.color = colorSel.value; savePrefs(); renderLegend(); if (selected >= 0) renderPanel(); };
  function renderLegend() { $("legend").replaceChildren(...legendItems().map(([c, t]) => el("span", null, dot(c), t))); }
  $("fit").onclick = () => fit();

  // ------------------------------------------------------------------ start
  window.__supraGraph = { x, y, community, get scale() { return scale; }, get alpha() { return alpha; }, get visible() { return act.length; }, select: (id) => select(byId.get(id) ?? -1, true) };
  resize(); addEventListener("resize", resize);
  seed(true); renderDrawer(); recompute();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (let i = 0, n = reduce ? 300 : alpha < 0.5 ? 5 : 80; i < n; i++) tick();
  fit();
  let fitSoon = alpha < 0.5 ? 0 : 40;
  const hash = /#n=([a-z0-9]{15})/.exec(location.hash);
  if (hash && byId.has(hash[1])) select(byId.get(hash[1]), true);
  (function frame() {
    if (alpha > 0.003) {
      const t0 = performance.now(); do tick(); while (performance.now() - t0 < 10 && alpha > 0.003);
      if (fitSoon > 0 && !drag && !pinch) { fitSoon--; fit(local ? act : undefined); }
    } else if (!settled) { settled = true; savePositions(); }
    draw(); if (!stopped) requestAnimationFrame(frame);
  })();
  return {
    destroy() { stopped = true; removeEventListener("resize", resize); removeEventListener("keydown", onKey); if (window.__supraGraph?.x === x) delete window.__supraGraph; },
  };
}
  globalThis.mountSupraGraph = mountSupraGraph;
  const embedded = typeof document !== "undefined" && document.getElementById("data");
  if (embedded) mountSupraGraph(JSON.parse(embedded.textContent));
})();
