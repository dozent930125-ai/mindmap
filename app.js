(() => {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'mindmap-canvas-v1';
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 4;
  const GRID = 20;
  const MAX_PORTS = 12;
  const PORT_GAP = 8; // arrow tip stops this far outside the port centre

  const EDGE_STUB = 20; // minimum straight run out of / into a port
  const CORNER_RADIUS = 10;

  const TRANSPARENT = 'transparent';
  const FILL_COLORS = [TRANSPARENT, '#ffffff', '#f3f4f6', '#fff1ee', '#fff6db', '#e9f8ef', '#e8f1ff', '#f2ecff', '#fdecf5', '#1f2330'];
  const STROKE_COLORS = ['#cfd4dc', '#9aa1ae', '#1f2330', '#ff6d5a', '#f0a500', '#22a55b', '#3b7ddd', '#8a5cf6', '#e2559b'];
  const TEXT_COLORS = ['#1f2330', '#4b5563', '#9aa1ae', '#ffffff', '#ff6d5a', '#d48a00', '#1f9d55', '#2f6fd6', '#7c4ddf'];

  // Palette from the first version, used to migrate saved maps.
  const LEGACY_COLORS = [
    ['#ffffff', '#9aa1ae'], ['#fff1ee', '#ff6d5a'], ['#fff7e0', '#e6a700'], ['#eaf8ee', '#2fa65a'],
    ['#e8f1ff', '#3b7ddd'], ['#f3ecff', '#8a5cf6'], ['#f1f2f4', '#4b5263'],
  ];

  const DEFAULT_SIZE = {
    rect: { w: 160, h: 80 },
    ellipse: { w: 140, h: 100 },
    diamond: { w: 150, h: 110 },
    text: { w: 160, h: 44 },
  };

  const DEFAULT_LABEL = { rect: '새 도형', ellipse: '새 원', diamond: '조건', text: '텍스트' };

  const SHAPE_STYLE = { fill: '#ffffff', stroke: '#cfd4dc', strokeWidth: 1.5, textColor: '#1f2330', fontSize: 15, fontWeight: 500 };
  const TEXT_STYLE = { fill: TRANSPARENT, stroke: '#1f2330', strokeWidth: 0, textColor: '#1f2330', fontSize: 18, fontWeight: 600 };
  const defaultStyle = (type) => ({ ...(type === 'text' ? TEXT_STYLE : SHAPE_STYLE) });

  function migrateNode(n) {
    if (n.fill === undefined) {
      const [fill, stroke] = LEGACY_COLORS[n.color || 0] || LEGACY_COLORS[0];
      Object.assign(n, n.type === 'text' ? { ...TEXT_STYLE, stroke } : { ...SHAPE_STYLE, fill, stroke });
      delete n.color;
    }
    return n;
  }

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const viewport = $('#viewport');
  const world = $('#world');
  const nodeLayer = $('#node-layer');
  const edgeLayer = $('#edge-layer');
  const draftEdge = $('#draft-edge');
  const zoomLabel = $('#zoom-label');
  const panel = $('#panel');
  const propLabel = $('#prop-label');
  const propType = $('#prop-type');
  const propWeight = $('#prop-weight');
  const propSize = $('#prop-size');
  const propTextColor = $('#prop-text-color');
  const propFill = $('#prop-fill');
  const propStroke = $('#prop-stroke');
  const propStrokeWidth = $('#prop-stroke-width');
  const propStrokeWidthLabel = $('#prop-stroke-width-label');
  const propLeft = $('#prop-left');
  const propRight = $('#prop-right');
  const btnUndo = $('#btn-undo');
  const btnRedo = $('#btn-redo');
  const btnDelete = $('#btn-delete');
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- State ----------
  let state = { nodes: [], edges: [] };
  let view = { x: 0, y: 0, k: 1 };
  let selection = null; // { kind: 'node' | 'edge', id }
  let editingId = null;
  let drag = null;
  const undoStack = [];
  const redoStack = [];
  const nodeEls = new Map();
  let lastEdit = { key: null, time: 0 };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const snapshot = () => JSON.stringify(state);
  const findNode = (id) => state.nodes.find((n) => n.id === id);
  const findEdge = (id) => state.edges.find((e) => e.id === id);

  // ---------- History & persistence ----------
  function checkpoint() {
    lastEdit = { key: null, time: 0 };
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }

  function restore(json) {
    state = JSON.parse(json);
    if (selection && !(selection.kind === 'node' ? findNode(selection.id) : findEdge(selection.id))) {
      selection = null;
    }
    render();
    save();
  }

  function undo() {
    if (!undoStack.length) return;
    lastEdit = { key: null, time: 0 };
    redoStack.push(snapshot());
    restore(undoStack.pop());
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    btnUndo.disabled = !undoStack.length;
    btnRedo.disabled = !redoStack.length;
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, view }));
      } catch (_) { /* storage unavailable: keep working in memory */ }
    }, 150);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      state = { nodes: (data.nodes || []).map(migrateNode), edges: data.edges || [] };
      if (data.view) view = data.view;
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------- Geometry ----------
  function toWorld(clientX, clientY) {
    const r = viewport.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  }

  // Port position relative to the node's top-left, placed on the shape's outline.
  function portLocal(node, side, index) {
    const count = node.ports[side];
    const t = (index + 1) / (count + 1);
    const y = node.h * t;
    let inset = 0;
    if (node.type === 'diamond') {
      inset = (node.w / 2) * Math.abs(2 * t - 1);
    } else if (node.type === 'ellipse') {
      const u = 2 * t - 1;
      inset = (node.w / 2) * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
    }
    return { x: side === 'left' ? inset : node.w - inset, y };
  }

  function portWorld(node, side, index) {
    const p = portLocal(node, side, index);
    return { x: node.x + p.x, y: node.y + p.y };
  }

  const sideDir = (side) => (side === 'left' ? -1 : 1);
  const nodeBox = (n) => ({ top: n.y, bottom: n.y + n.h });

  // Push y past any node the horizontal run [x0, x1] would cut through.
  function clearY(y, x0, x1, dir) {
    for (let guard = 0; guard < 50; guard++) {
      const hit = state.nodes.find((n) => n.x < x1 && n.x + n.w > x0 &&
        y > n.y - EDGE_STUB / 2 && y < n.y + n.h + EDGE_STUB / 2);
      if (!hit) return y;
      y = dir > 0 ? hit.y + hit.h + EDGE_STUB : hit.y - EDGE_STUB;
    }
    return y;
  }

  // A horizontal line that clears both end boxes (and other nodes), used when an edge has to double back.
  function detourY(p1, p2, a, b, x0, x1) {
    const cost = (y) => Math.abs(y - p1.y) + Math.abs(y - p2.y);
    const candidates = [
      clearY(Math.max(a.bottom, b.bottom) + EDGE_STUB * 1.5, x0, x1, 1),
      clearY(Math.min(a.top, b.top) - EDGE_STUB * 1.5, x0, x1, -1),
    ];
    const gapTop = Math.min(a.bottom, b.bottom);
    const gapBottom = Math.max(a.top, b.top);
    if (gapBottom - gapTop >= EDGE_STUB * 2) {
      const mid = (gapTop + gapBottom) / 2;
      if (clearY(mid, x0, x1, 1) === mid) candidates.push(mid);
    }
    return candidates.reduce((best, y) => (cost(y) < cost(best) ? y : best));
  }

  // Orthogonal route: leaves p1 horizontally in dir1 and enters p2 horizontally from dir2's side.
  function orthoPoints(p1, d1, p2, d2, boxA, boxB) {
    const s1x = p1.x + d1 * EDGE_STUB;
    const s2x = p2.x + d2 * EDGE_STUB;
    if (d1 !== d2) {
      if ((s2x - s1x) * d1 >= 0) {
        // Target lies ahead: one vertical run halfway between.
        const mx = Math.round((p1.x + p2.x) / 2);
        return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
      }
      // Target is behind: go out, around, and back in.
      const my = detourY(p1, p2, boxA, boxB, Math.min(s1x, s2x), Math.max(s1x, s2x));
      return [p1, { x: s1x, y: p1.y }, { x: s1x, y: my }, { x: s2x, y: my }, { x: s2x, y: p2.y }, p2];
    }
    // Both ports face the same way: run past the outermost one.
    const x = d1 > 0 ? Math.max(s1x, s2x) : Math.min(s1x, s2x);
    return [p1, { x, y: p1.y }, { x, y: p2.y }, p2];
  }

  // Polyline with rounded corners.
  function roundedPath(pts) {
    const clean = [];
    for (const p of pts) {
      const last = clean[clean.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
      clean.push(p);
    }
    for (let i = clean.length - 2; i > 0; i--) {
      const a = clean[i - 1], b = clean[i], c = clean[i + 1];
      if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) {
        clean.splice(i, 1);
      }
    }
    let d = `M${clean[0].x},${clean[0].y}`;
    for (let i = 1; i < clean.length - 1; i++) {
      const prev = clean[i - 1], cur = clean[i], next = clean[i + 1];
      const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
      const r = Math.min(CORNER_RADIUS, l1 / 2, l2 / 2);
      const ax = cur.x - ((cur.x - prev.x) / l1) * r;
      const ay = cur.y - ((cur.y - prev.y) / l1) * r;
      const bx = cur.x + ((next.x - cur.x) / l2) * r;
      const by = cur.y + ((next.y - cur.y) / l2) * r;
      d += ` L${ax},${ay} Q${cur.x},${cur.y} ${bx},${by}`;
    }
    const end = clean[clean.length - 1];
    return `${d} L${end.x},${end.y}`;
  }

  function edgePath(edge) {
    const a = findNode(edge.from.node);
    const b = findNode(edge.to.node);
    if (!a || !b) return '';
    const p1 = portWorld(a, edge.from.side, edge.from.index);
    const p2 = portWorld(b, edge.to.side, edge.to.index);
    const d2 = sideDir(edge.to.side);
    const tip = { x: p2.x + d2 * PORT_GAP, y: p2.y };
    return roundedPath(orthoPoints(p1, sideDir(edge.from.side), tip, d2, nodeBox(a), nodeBox(b)));
  }

  // ---------- Rendering ----------
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    const g = GRID * view.k;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomLabel.textContent = `${Math.round(view.k * 100)}%`;
  }

  function buildNodeEl(node) {
    const el = document.createElement('div');
    el.className = 'node';
    el.dataset.id = node.id;

    const shape = document.createElement('div');
    shape.className = 'shape';
    el.appendChild(shape);

    const label = document.createElement('div');
    label.className = 'label';
    el.appendChild(label);

    for (const side of ['left', 'right']) {
      const ctrl = document.createElement('div');
      ctrl.className = `port-ctrl ${side}`;
      ctrl.innerHTML =
        `<button data-port="${side}" data-d="-1" title="포트 줄이기">−</button>` +
        `<span>${side === 'left' ? '◀' : ''} <b></b> ${side === 'right' ? '▶' : ''}</span>` +
        `<button data-port="${side}" data-d="1" title="포트 늘리기">+</button>`;
      el.appendChild(ctrl);
    }

    const resize = document.createElement('div');
    resize.className = 'resize';
    el.appendChild(resize);

    el._ports = { left: [], right: [] };
    el._type = null;
    return el;
  }

  function syncShape(el, node) {
    if (el._type === node.type) return;
    el._type = node.type;
    const shape = el.querySelector('.shape');
    shape.innerHTML = node.type === 'diamond'
      ? '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,1 99,50 50,99 1,50"/></svg>'
      : '';
  }

  function syncPorts(el, node) {
    const connected = new Set();
    for (const e of state.edges) {
      if (e.from.node === node.id) connected.add(`${e.from.side}:${e.from.index}`);
      if (e.to.node === node.id) connected.add(`${e.to.side}:${e.to.index}`);
    }
    for (const side of ['left', 'right']) {
      const list = el._ports[side];
      const count = node.ports[side];
      while (list.length < count) {
        const p = document.createElement('div');
        p.className = 'port';
        p.dataset.side = side;
        p.dataset.index = String(list.length);
        el.appendChild(p);
        list.push(p);
      }
      while (list.length > count) list.pop().remove();
      list.forEach((p, i) => {
        const pos = portLocal(node, side, i);
        p.style.left = `${pos.x}px`;
        p.style.top = `${pos.y}px`;
        p.classList.toggle('connected', connected.has(`${side}:${i}`));
      });
      el.querySelector(`.port-ctrl.${side} b`).textContent = count;
    }
  }

  function renderNode(node) {
    let el = nodeEls.get(node.id);
    if (!el) {
      el = buildNodeEl(node);
      nodeEls.set(node.id, el);
      nodeLayer.appendChild(el);
    }
    el.className = `node ${node.type}` +
      (selection && selection.kind === 'node' && selection.id === node.id ? ' selected' : '') +
      (node.fill === TRANSPARENT ? ' no-fill' : '') +
      (!node.strokeWidth ? ' no-stroke' : '');
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.w}px`;
    el.style.height = `${node.h}px`;
    el.style.setProperty('--fill', node.fill);
    el.style.setProperty('--stroke', node.stroke);
    el.style.setProperty('--sw', `${node.strokeWidth}px`);
    syncShape(el, node);
    const label = el.querySelector('.label');
    label.style.color = node.textColor;
    label.style.fontSize = `${node.fontSize}px`;
    label.style.fontWeight = String(node.fontWeight);
    if (editingId !== node.id && label.textContent !== node.label) label.textContent = node.label;
    syncPorts(el, node);
  }

  function renderNodes() {
    const alive = new Set();
    state.nodes.forEach((n, i) => {
      renderNode(n);
      alive.add(n.id);
      const el = nodeEls.get(n.id);
      el.style.zIndex = String(i + 1);
    });
    for (const [id, el] of nodeEls) {
      if (!alive.has(id)) {
        el.remove();
        nodeEls.delete(id);
      }
    }
  }

  function renderEdges() {
    edgeLayer.textContent = '';
    for (const e of state.edges) {
      const d = edgePath(e);
      if (!d) continue;
      const selected = selection && selection.kind === 'edge' && selection.id === e.id;
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('class', 'edge-hit');
      hit.setAttribute('d', d);
      hit.dataset.id = e.id;
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('class', 'edge' + (selected ? ' selected' : ''));
      line.setAttribute('d', d);
      line.setAttribute('marker-end', `url(#${selected ? 'arrow-selected' : 'arrow'})`);
      edgeLayer.append(hit, line);
    }
  }

  function renderPanel() {
    const node = selection && selection.kind === 'node' ? findNode(selection.id) : null;
    panel.hidden = !node;
    btnDelete.disabled = !selection;
    if (!node) return;
    if (document.activeElement !== propLabel) propLabel.value = node.label;
    [...propType.children].forEach((b) => b.classList.toggle('active', b.dataset.type === node.type));
    propWeight.value = String(node.fontWeight);
    if (document.activeElement !== propSize) propSize.value = node.fontSize;
    propStrokeWidth.value = node.strokeWidth;
    propStrokeWidthLabel.textContent = node.strokeWidth ? `${node.strokeWidth}px` : '없음';
    syncSwatches(propTextColor, node.textColor);
    syncSwatches(propFill, node.fill);
    syncSwatches(propStroke, node.stroke);
    propLeft.textContent = node.ports.left;
    propRight.textContent = node.ports.right;
  }

  function render() {
    renderNodes();
    renderEdges();
    renderPanel();
  }

  // ---------- Mutations ----------
  function addNode(type, at) {
    checkpoint();
    const size = DEFAULT_SIZE[type];
    if (!at) {
      const r = viewport.getBoundingClientRect();
      at = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      // Nudge so repeated adds don't stack exactly on top of each other.
      const offset = (state.nodes.length % 6) * 24;
      at = { x: at.x + offset, y: at.y + offset };
    }
    const node = {
      id: uid(),
      type,
      x: Math.round(at.x - size.w / 2),
      y: Math.round(at.y - size.h / 2),
      w: size.w,
      h: size.h,
      label: DEFAULT_LABEL[type],
      ...defaultStyle(type),
      ports: { left: 1, right: 1 },
    };
    state.nodes.push(node);
    selection = { kind: 'node', id: node.id };
    render();
    save();
    return node;
  }

  function setPortCount(node, side, count) {
    count = clamp(count, 0, MAX_PORTS);
    if (count === node.ports[side]) return;
    checkpoint();
    node.ports[side] = count;
    // Drop edges attached to ports that no longer exist.
    state.edges = state.edges.filter((e) =>
      !(e.from.node === node.id && e.from.side === side && e.from.index >= count) &&
      !(e.to.node === node.id && e.to.side === side && e.to.index >= count));
    render();
    save();
  }

  function deleteSelection() {
    if (!selection) return;
    checkpoint();
    if (selection.kind === 'node') {
      const id = selection.id;
      state.nodes = state.nodes.filter((n) => n.id !== id);
      state.edges = state.edges.filter((e) => e.from.node !== id && e.to.node !== id);
    } else {
      state.edges = state.edges.filter((e) => e.id !== selection.id);
    }
    selection = null;
    render();
    save();
  }

  function select(sel) {
    selection = sel;
    if (sel && sel.kind === 'node') {
      // Bring selected node to front.
      const i = state.nodes.findIndex((n) => n.id === sel.id);
      if (i >= 0 && i !== state.nodes.length - 1) state.nodes.push(state.nodes.splice(i, 1)[0]);
    }
    render();
  }

  function connect(from, to) {
    if (from.node === to.node && from.side === to.side && from.index === to.index) return;
    const same = (a, b) => a.node === b.node && a.side === b.side && a.index === b.index;
    if (state.edges.some((e) => (same(e.from, from) && same(e.to, to)) || (same(e.from, to) && same(e.to, from)))) return;
    checkpoint();
    const edge = { id: uid(), from, to };
    state.edges.push(edge);
    selection = { kind: 'edge', id: edge.id };
    render();
    save();
  }

  // ---------- Label editing ----------
  function startEdit(id) {
    const node = findNode(id);
    const el = nodeEls.get(id);
    if (!node || !el) return;
    if (editingId) finishEdit(true);
    editingId = id;
    const label = el.querySelector('.label');
    label.classList.add('editing');
    try { label.contentEditable = 'plaintext-only'; } catch (_) { label.contentEditable = 'true'; }
    if (label.contentEditable !== 'plaintext-only') label.contentEditable = 'true';
    label.focus();
    const range = document.createRange();
    range.selectNodeContents(label);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  function finishEdit(commit) {
    if (!editingId) return;
    const id = editingId;
    const el = nodeEls.get(id);
    const node = findNode(id);
    editingId = null;
    if (!el || !node) return;
    const label = el.querySelector('.label');
    label.classList.remove('editing');
    label.contentEditable = 'false';
    const text = label.innerText.replace(/\n+$/, '');
    if (commit && text !== node.label) {
      checkpoint();
      node.label = text;
      save();
    }
    window.getSelection().removeAllRanges();
    render();
  }

  // ---------- Pointer interactions ----------
  function portFromEl(el) {
    const nodeEl = el.closest('.node');
    return { node: nodeEl.dataset.id, side: el.dataset.side, index: Number(el.dataset.index) };
  }

  function nearestPort(node, pt) {
    let best = null;
    let bestD = Infinity;
    for (const side of ['left', 'right']) {
      for (let i = 0; i < node.ports[side]; i++) {
        const p = portWorld(node, side, i);
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < bestD) { bestD = d; best = { node: node.id, side, index: i }; }
      }
    }
    return best;
  }

  function dropTargetAt(clientX, clientY, from) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const portEl = el.closest('.port');
    if (portEl) return { port: portFromEl(portEl), el: portEl };
    const nodeEl = el.closest('.node');
    if (nodeEl) {
      const node = findNode(nodeEl.dataset.id);
      const port = node && nearestPort(node, toWorld(clientX, clientY));
      if (port && !(port.node === from.node && port.side === from.side && port.index === from.index)) {
        const pEl = nodeEls.get(port.node)._ports[port.side][port.index];
        return { port, el: pEl };
      }
    }
    return null;
  }

  viewport.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    const t = ev.target;

    if (t.closest('.port-ctrl')) return; // handled by click
    if (t.closest('.label.editing')) return; // let the user place the caret

    if (editingId) finishEdit(true);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();

    const start = { cx: ev.clientX, cy: ev.clientY };
    const nodeEl = t.closest('.node');

    if (ev.button === 1 || !nodeEl && !t.classList.contains('edge-hit')) {
      // Pan (middle button anywhere, or left button on empty canvas).
      if (ev.button === 0 && selection) select(null);
      drag = { kind: 'pan', ...start, vx: view.x, vy: view.y };
      viewport.classList.add('panning');
    } else if (t.classList.contains('edge-hit')) {
      select({ kind: 'edge', id: t.dataset.id });
      return;
    } else if (t.classList.contains('port')) {
      const from = portFromEl(t);
      drag = { kind: 'connect', ...start, from, target: null };
      updateDraft(ev);
    } else if (t.classList.contains('resize')) {
      const node = findNode(nodeEl.dataset.id);
      drag = { kind: 'resize', ...start, id: node.id, w: node.w, h: node.h, moved: false };
    } else {
      const node = findNode(nodeEl.dataset.id);
      select({ kind: 'node', id: node.id });
      drag = { kind: 'move', ...start, id: node.id, x: node.x, y: node.y, moved: false };
    }
    ev.preventDefault();
  });

  function updateDraft(ev) {
    const from = findNode(drag.from.node);
    const p1 = portWorld(from, drag.from.side, drag.from.index);
    const d1 = sideDir(drag.from.side);
    const target = dropTargetAt(ev.clientX, ev.clientY, drag.from);
    if (drag.target && drag.target.el !== (target && target.el)) drag.target.el.classList.remove('target');
    drag.target = target;
    let p2;
    let d2;
    let boxB;
    if (target) {
      target.el.classList.add('target');
      const n = findNode(target.port.node);
      const p = portWorld(n, target.port.side, target.port.index);
      d2 = sideDir(target.port.side);
      p2 = { x: p.x + d2 * PORT_GAP, y: p.y };
      boxB = nodeBox(n);
    } else {
      p2 = toWorld(ev.clientX, ev.clientY);
      d2 = p2.x >= p1.x ? -1 : 1;
      boxB = { top: p2.y, bottom: p2.y };
    }
    draftEdge.setAttribute('d', roundedPath(orthoPoints(p1, d1, p2, d2, nodeBox(from), boxB)));
    draftEdge.setAttribute('marker-end', 'url(#arrow-selected)');
  }

  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = (ev.clientX - drag.cx) / view.k;
    const dy = (ev.clientY - drag.cy) / view.k;

    if (drag.kind === 'pan') {
      view.x = drag.vx + (ev.clientX - drag.cx);
      view.y = drag.vy + (ev.clientY - drag.cy);
      applyView();
    } else if (drag.kind === 'move') {
      const node = findNode(drag.id);
      if (!drag.moved) {
        if (Math.hypot(dx, dy) * view.k < 3) return;
        checkpoint();
        drag.moved = true;
      }
      node.x = Math.round(drag.x + dx);
      node.y = Math.round(drag.y + dy);
      renderNode(node);
      renderEdges();
    } else if (drag.kind === 'resize') {
      const node = findNode(drag.id);
      if (!drag.moved) { checkpoint(); drag.moved = true; }
      node.w = Math.max(60, Math.round(drag.w + dx));
      node.h = Math.max(32, Math.round(drag.h + dy));
      renderNode(node);
      renderEdges();
    } else if (drag.kind === 'connect') {
      updateDraft(ev);
    }
  });

  function endDrag() {
    if (!drag) return;
    if (drag.kind === 'connect') {
      draftEdge.setAttribute('d', '');
      draftEdge.removeAttribute('marker-end');
      if (drag.target) {
        drag.target.el.classList.remove('target');
        connect(drag.from, drag.target.port);
      }
    } else if (drag.kind === 'pan') {
      viewport.classList.remove('panning');
    }
    if (drag.moved || drag.kind === 'pan') save();
    drag = null;
  }

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  viewport.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.port-ctrl button');
    if (!btn) return;
    const node = findNode(btn.closest('.node').dataset.id);
    setPortCount(node, btn.dataset.port, node.ports[btn.dataset.port] + Number(btn.dataset.d));
  });

  viewport.addEventListener('dblclick', (ev) => {
    const nodeEl = ev.target.closest('.node');
    if (ev.target.closest('.port, .port-ctrl, .resize')) return;
    if (nodeEl) {
      startEdit(nodeEl.dataset.id);
    } else if (!ev.target.classList.contains('edge-hit')) {
      const node = addNode('rect', toWorld(ev.clientX, ev.clientY));
      startEdit(node.id);
    }
  });

  viewport.addEventListener('keydown', (ev) => {
    if (!ev.target.classList.contains('editing')) return;
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      finishEdit(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finishEdit(false);
    }
  });

  viewport.addEventListener('focusout', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('editing')) finishEdit(true);
  });

  // Zoom with the wheel, anchored at the cursor.
  viewport.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
    zoomAt(ev.clientX, ev.clientY, view.k * factor);
  }, { passive: false });

  function zoomAt(clientX, clientY, k) {
    k = clamp(k, MIN_ZOOM, MAX_ZOOM);
    const r = viewport.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    view.x = px - ((px - view.x) / view.k) * k;
    view.y = py - ((py - view.y) / view.k) * k;
    view.k = k;
    applyView();
    save();
  }

  function zoomCenter(mult) {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.k * mult);
  }

  function fitView() {
    const r = viewport.getBoundingClientRect();
    if (!state.nodes.length) {
      view = { x: r.width / 2, y: r.height / 2, k: 1 };
    } else {
      const minX = Math.min(...state.nodes.map((n) => n.x));
      const minY = Math.min(...state.nodes.map((n) => n.y));
      const maxX = Math.max(...state.nodes.map((n) => n.x + n.w));
      const maxY = Math.max(...state.nodes.map((n) => n.y + n.h));
      const pad = 80;
      const k = clamp(Math.min(r.width / (maxX - minX + pad * 2), r.height / (maxY - minY + pad * 2)), MIN_ZOOM, 1.5);
      view = {
        k,
        x: r.width / 2 - ((minX + maxX) / 2) * k,
        y: r.height / 2 - ((minY + maxY) / 2) * k,
      };
    }
    applyView();
    save();
  }

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    const typing = t.tagName === 'TEXTAREA' || t.isContentEditable ||
      (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'number'));
    if (typing) return;
    if (t.tagName === 'SELECT' && !(ev.ctrlKey || ev.metaKey)) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      ev.shiftKey ? redo() : undo();
    } else if (mod && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      redo();
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      deleteSelection();
    } else if (ev.key === 'Enter' && selection && selection.kind === 'node') {
      ev.preventDefault();
      startEdit(selection.id);
    } else if (ev.key === 'Escape') {
      select(null);
    }
  });

  // ---------- Toolbar ----------
  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => addNode(b.dataset.add)));
  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnDelete.addEventListener('click', deleteSelection);
  $('#btn-zoom-in').addEventListener('click', () => zoomCenter(1.2));
  $('#btn-zoom-out').addEventListener('click', () => zoomCenter(1 / 1.2));
  $('#btn-fit').addEventListener('click', fitView);

  $('#btn-clear').addEventListener('click', () => {
    if (!state.nodes.length) return;
    if (!confirm('캔버스를 모두 지울까요? (실행 취소로 되돌릴 수 있습니다)')) return;
    checkpoint();
    state = { nodes: [], edges: [] };
    selection = null;
    render();
    save();
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mindmap.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const fileInput = $('#file-input');
  $('#btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('bad format');
      checkpoint();
      state = { nodes: data.nodes.map(migrateNode), edges: data.edges };
      selection = null;
      render();
      fitView();
    } catch (_) {
      alert('올바른 마인드맵 JSON 파일이 아닙니다.');
    }
  });

  // ---------- Properties panel ----------
  const selectedNode = () => (selection && selection.kind === 'node' ? findNode(selection.id) : null);

  // Consecutive edits of the same property (typing, dragging a slider or colour picker)
  // collapse into a single undo step.
  function editNode(key, fn) {
    const node = selectedNode();
    if (!node) return;
    const k = `${key}:${node.id}`;
    const now = Date.now();
    if (lastEdit.key !== k || now - lastEdit.time > 1000) checkpoint();
    lastEdit = { key: k, time: now };
    fn(node);
    render();
    save();
  }

  function buildSwatches(container, colors, prop, title) {
    for (const c of colors) {
      const s = document.createElement('button');
      s.className = 'swatch' + (c === TRANSPARENT ? ' transparent' : '');
      s.dataset.color = c;
      s.style.background = c;
      s.title = c === TRANSPARENT ? '없음 (투명)' : c;
      s.addEventListener('click', () => editNode(prop, (n) => { n[prop] = c; }));
      container.appendChild(s);
    }
    const custom = document.createElement('label');
    custom.className = 'swatch custom';
    custom.title = `${title} 직접 선택`;
    const input = document.createElement('input');
    input.type = 'color';
    input.addEventListener('input', () => editNode(prop, (n) => { n[prop] = input.value; }));
    custom.appendChild(input);
    container.appendChild(custom);
  }

  function syncSwatches(container, value) {
    let matched = false;
    for (const s of container.querySelectorAll('.swatch[data-color]')) {
      const on = s.dataset.color.toLowerCase() === String(value).toLowerCase();
      s.classList.toggle('active', on);
      matched = matched || on;
    }
    const custom = container.querySelector('.swatch.custom');
    custom.classList.toggle('active', !matched);
    if (!matched) custom.style.background = value;
    else custom.style.background = '';
    const input = custom.querySelector('input');
    if (value !== TRANSPARENT && document.activeElement !== input) input.value = value;
  }

  buildSwatches(propTextColor, TEXT_COLORS, 'textColor', '글자색');
  buildSwatches(propFill, FILL_COLORS, 'fill', '채우기 색');
  buildSwatches(propStroke, STROKE_COLORS, 'stroke', '외곽선 색');

  propLabel.addEventListener('input', () => editNode('label', (n) => { n.label = propLabel.value; }));

  propType.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-type]');
    if (btn) editNode('type', (n) => { n.type = btn.dataset.type; });
  });

  propWeight.addEventListener('change', () => editNode('fontWeight', (n) => { n.fontWeight = Number(propWeight.value); }));

  const setFontSize = (v) => {
    if (!Number.isFinite(v)) return;
    editNode('fontSize', (n) => { n.fontSize = clamp(Math.round(v), 8, 120); });
  };
  propSize.addEventListener('input', () => { if (propSize.value !== '') setFontSize(Number(propSize.value)); });
  propSize.addEventListener('blur', () => renderPanel());

  propStrokeWidth.addEventListener('input', () =>
    editNode('strokeWidth', (n) => { n.strokeWidth = Number(propStrokeWidth.value); }));

  panel.addEventListener('click', (ev) => {
    const node = selectedNode();
    if (!node) return;
    const portBtn = ev.target.closest('[data-port]');
    if (portBtn) setPortCount(node, portBtn.dataset.port, node.ports[portBtn.dataset.port] + Number(portBtn.dataset.d));
    const sizeBtn = ev.target.closest('[data-size]');
    if (sizeBtn) setFontSize(node.fontSize + Number(sizeBtn.dataset.size));
  });

  window.addEventListener('resize', applyView);

  // ---------- Boot ----------
  function seed() {
    const mk = (type, x, y, label, style, ports) => ({
      id: uid(), type, x, y, ...DEFAULT_SIZE[type], label,
      ...defaultStyle(type), ...style, ports: ports || { left: 1, right: 1 },
    });
    const center = mk('rect', -80, -40, '중심 주제',
      { fill: '#fff1ee', stroke: '#ff6d5a', strokeWidth: 2, fontSize: 17, fontWeight: 700 }, { left: 1, right: 2 });
    const a = mk('ellipse', 200, -150, '아이디어 A', { fill: '#e8f1ff', stroke: '#3b7ddd' });
    const b = mk('diamond', 200, 50, '결정 B', { fill: '#fff6db', stroke: '#f0a500' });
    const note = mk('text', -100, -150, '더블클릭해서 이름을 바꿔보세요', { w: 200, fontSize: 16, fontWeight: 500, textColor: '#4b5563' });
    state.nodes = [note, center, a, b];
    state.edges = [
      { id: uid(), from: { node: center.id, side: 'right', index: 0 }, to: { node: a.id, side: 'left', index: 0 } },
      { id: uid(), from: { node: center.id, side: 'right', index: 1 }, to: { node: b.id, side: 'left', index: 0 } },
    ];
  }

  const hadSaved = load();
  if (!hadSaved) seed();
  render();
  if (hadSaved && view.k) applyView(); else fitView();
  updateHistoryButtons();
})();
