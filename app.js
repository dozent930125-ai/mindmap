(() => {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'mindmap-canvas-v1';
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 4;
  const GRID = 20;
  const MAX_PORTS = 12;
  const PORT_GAP = 8; // arrow tip stops this far outside the port centre

  const COLORS = [
    { fill: '#ffffff', stroke: '#9aa1ae' },
    { fill: '#fff1ee', stroke: '#ff6d5a' },
    { fill: '#fff7e0', stroke: '#e6a700' },
    { fill: '#eaf8ee', stroke: '#2fa65a' },
    { fill: '#e8f1ff', stroke: '#3b7ddd' },
    { fill: '#f3ecff', stroke: '#8a5cf6' },
    { fill: '#f1f2f4', stroke: '#4b5263' },
  ];

  const DEFAULT_SIZE = {
    rect: { w: 160, h: 80 },
    ellipse: { w: 140, h: 100 },
    diamond: { w: 150, h: 110 },
    text: { w: 160, h: 44 },
  };

  const DEFAULT_LABEL = { rect: '새 도형', ellipse: '새 원', diamond: '조건', text: '텍스트' };

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
  const propColors = $('#prop-colors');
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

  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const snapshot = () => JSON.stringify(state);
  const findNode = (id) => state.nodes.find((n) => n.id === id);
  const findEdge = (id) => state.edges.find((e) => e.id === id);

  // ---------- History & persistence ----------
  function checkpoint() {
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
      state = { nodes: data.nodes || [], edges: data.edges || [] };
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

  function curve(p1, dir1, p2, dir2) {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const c = Math.max(40, Math.min(160, Math.abs(p2.x - p1.x) / 2 + dist / 6));
    return `M${p1.x},${p1.y} C${p1.x + dir1 * c},${p1.y} ${p2.x + dir2 * c},${p2.y} ${p2.x},${p2.y}`;
  }

  const sideDir = (side) => (side === 'left' ? -1 : 1);

  function edgePath(edge) {
    const a = findNode(edge.from.node);
    const b = findNode(edge.to.node);
    if (!a || !b) return '';
    const p1 = portWorld(a, edge.from.side, edge.from.index);
    const p2 = portWorld(b, edge.to.side, edge.to.index);
    const d2 = sideDir(edge.to.side);
    return curve(p1, sideDir(edge.from.side), { x: p2.x + d2 * PORT_GAP, y: p2.y }, d2);
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
      (selection && selection.kind === 'node' && selection.id === node.id ? ' selected' : '');
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.w}px`;
    el.style.height = `${node.h}px`;
    const color = COLORS[node.color] || COLORS[0];
    el.style.setProperty('--fill', color.fill);
    el.style.setProperty('--stroke', color.stroke);
    syncShape(el, node);
    const label = el.querySelector('.label');
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
    propType.value = node.type;
    propLeft.textContent = node.ports.left;
    propRight.textContent = node.ports.right;
    [...propColors.children].forEach((s, i) => s.classList.toggle('active', i === (node.color || 0)));
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
      color: 0,
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
    if (target) {
      target.el.classList.add('target');
      const n = findNode(target.port.node);
      const p = portWorld(n, target.port.side, target.port.index);
      d2 = sideDir(target.port.side);
      p2 = { x: p.x + d2 * PORT_GAP, y: p.y };
    } else {
      p2 = toWorld(ev.clientX, ev.clientY);
      d2 = p2.x >= p1.x ? -1 : 1;
    }
    draftEdge.setAttribute('d', curve(p1, d1, p2, d2));
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
    const tag = ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ev.target.isContentEditable) return;
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
      state = { nodes: data.nodes, edges: data.edges };
      selection = null;
      render();
      fitView();
    } catch (_) {
      alert('올바른 마인드맵 JSON 파일이 아닙니다.');
    }
  });

  // ---------- Properties panel ----------
  COLORS.forEach((c, i) => {
    const s = document.createElement('button');
    s.className = 'swatch';
    s.style.background = c.fill;
    s.style.borderColor = c.stroke;
    s.style.boxShadow = `inset 0 0 0 2px ${c.stroke}`;
    s.title = `색상 ${i + 1}`;
    s.addEventListener('click', () => {
      const node = findNode(selection.id);
      if (!node || node.color === i) return;
      checkpoint();
      node.color = i;
      render();
      save();
    });
    propColors.appendChild(s);
  });

  propLabel.addEventListener('focus', () => checkpoint());
  propLabel.addEventListener('input', () => {
    const node = selection && findNode(selection.id);
    if (!node) return;
    node.label = propLabel.value;
    renderNode(node);
    save();
  });

  propType.addEventListener('change', () => {
    const node = selection && findNode(selection.id);
    if (!node) return;
    checkpoint();
    node.type = propType.value;
    render();
    save();
  });

  panel.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-port]');
    if (!btn) return;
    const node = selection && findNode(selection.id);
    if (node) setPortCount(node, btn.dataset.port, node.ports[btn.dataset.port] + Number(btn.dataset.d));
  });

  window.addEventListener('resize', applyView);

  // ---------- Boot ----------
  function seed() {
    const mk = (type, x, y, label, color, ports) => ({
      id: uid(), type, x, y, ...DEFAULT_SIZE[type], label, color, ports: ports || { left: 1, right: 1 },
    });
    const center = mk('rect', -80, -40, '중심 주제', 1, { left: 1, right: 2 });
    const a = mk('ellipse', 200, -140, '아이디어 A', 4);
    const b = mk('diamond', 200, 40, '결정 B', 2);
    const note = mk('text', -80, -150, '더블클릭해서 이름을 바꿔보세요', 0);
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
