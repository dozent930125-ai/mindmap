(() => {
  'use strict';

  // Chat with Claude, available when the page is opened on claude.ai (the `sample` capability).
  // In "edit together" mode Claude also gets tools that change the map through MindmapBridge.
  const CHAT_KEY = 'mindmap-chat-v1';
  const MAX_TURNS = 40;
  const MAX_HISTORY_CHARS = 30000;

  const $ = (s) => document.querySelector(s);
  const chat = $('#chat');
  const log = $('#chat-log');
  const form = $('#chat-form');
  const input = $('#chat-input');
  const btnSend = $('#chat-send');
  const btnStop = $('#chat-stop');
  const btnChat = $('#btn-chat');
  const modeTabs = $('#chat-mode');
  const modelSelect = $('#chat-model');
  const contextNote = $('#chat-context');

  const RULES = [
    '당신은 사용자의 아이디어 브레인스토밍을 돕는 파트너입니다.',
    '한국어로 자연스럽고 간결하게 답하세요. 필요할 때만 짧은 목록을 쓰고, 긴 서론은 생략하세요.',
  ].join('\n');

  const MAP_RULES = `아래 <map>은 사용자가 지금 보고 있는 마인드맵(JSON)입니다.
- nodes: id, type(rect 사각형 | ellipse 원 | diamond 마름모 | text 테두리 없는 글자), label(이름), x/y(왼쪽 위 좌표, px, x는 오른쪽·y는 아래로 증가), w/h(크기), 색·글자 스타일.
- edges: from → to 화살표. selected: 사용자가 지금 선택한 도형 id.

사용자가 마인드맵을 바꿔 달라고 하면(추가, 보완, 정리, 간격 조절, 이름·색 변경, 연결, 삭제 등) 도구로 직접 수정하세요. 질문이나 의견만 원하면 도구를 쓰지 말고 답만 하세요.
수정 요령:
- 흐름은 왼쪽 → 오른쪽입니다. 새 하위 아이디어는 부모의 오른쪽(부모 x + 부모 w + 80 정도)에, 형제끼리는 세로로 (높이 + 30) 간격을 두고 놓으세요. 다른 도형과 겹치지 않게 하세요.
- add_nodes의 parent에 기존 id나 같은 호출 안의 ref를 넣으면 화살표도 함께 만들어집니다. 여러 개를 한 번에 추가하세요.
- 간격 조절이나 정리는 auto_layout(gapX 가로 간격, gapY 세로 간격)을 쓰거나 update_nodes로 x/y를 직접 바꾸세요.
- 사용자가 요청하지 않은 도형은 지우지 마세요. 기존 스타일(색·글자 크기)은 주변 도형과 어울리게 맞추세요.
- 수정을 마치면 무엇을 바꿨는지 1~3줄로 짧게 알려주세요.`;

  const SUGGESTIONS = {
    free: ['새 프로젝트 아이디어 같이 떠올려줘', '브레인스토밍 잘하는 방법 알려줘'],
    map: ['이 구조에서 보완할 아이디어를 추가해줘', '도형 간격을 보기 좋게 정리해줘', '이 마인드맵 요약해줘'],
  };

  const ERRORS = {
    not_granted: 'Claude 사용이 허용되지 않았어요. 이 페이지를 다시 열고 허용을 누르면 대화할 수 있어요.',
    sampling_disabled: '이 계정에서는 Claude 대화를 쓸 수 없어요.',
    rate_limited: '요청이 너무 많거나 사용량 한도에 닿았어요. 잠시 후 다시 보내 주세요.',
    session_expired: 'claude.ai 로그인이 만료됐어요. 다시 로그인한 뒤 보내 주세요.',
    prompt_too_large: '대화나 마인드맵이 너무 길어요. "대화 지우기"를 누른 뒤 다시 시도해 주세요.',
    refused: 'Claude가 이 요청에는 답하지 않았어요. 표현을 바꿔서 다시 물어봐 주세요.',
    empty_completion: '답변이 비어 있어요. 요청을 조금 더 구체적으로 적어 주세요.',
    tools_unavailable: '이 화면에서는 Claude가 마인드맵을 직접 수정할 수 없어요. 대화만 가능해요.',
  };
  const HIDE_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
  const TIER_NAMES = { quick: '빠른 모델', default: '기본 모델', complex: '최고 성능 모델' };

  let sample = null;
  let toolsOk = false;
  let maxTools = 0;
  let turns = [];   // [{ role, content, acts? }]
  let mode = 'map';
  let tier = 'default';
  let ctl = null;

  function loadHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(CHAT_KEY));
      if (data && Array.isArray(data.turns)) turns = data.turns;
      if (data && (data.mode === 'free' || data.mode === 'map')) mode = data.mode;
      if (data && data.tier in TIER_NAMES) tier = data.tier;
    } catch (_) { /* start fresh */ }
  }

  function saveHistory() {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify({ turns, mode, tier })); } catch (_) { /* per-viewer only */ }
  }

  // ---------- Rendering ----------
  const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(t) {
    return escapeHtml(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  // Small Markdown subset: headings, bullet/numbered lists, bold, inline code, paragraphs.
  function markdown(text) {
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
        closeList();
        out.push(`<p class="h">${inline(m[1])}</p>`);
      } else if (!line.trim()) {
        closeList();
      } else {
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList();
    return out.join('');
  }

  function bubble(role, text, acts) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    if (role === 'assistant') {
      const a = document.createElement('div');
      a.className = 'acts';
      const body = document.createElement('div');
      body.className = 'body';
      el.append(a, body);
      for (const t of acts || []) addAct(el, t);
    }
    setBubble(el, role, text);
    log.appendChild(el);
    return el;
  }

  function setBubble(el, role, text) {
    if (role === 'assistant') el.querySelector('.body').innerHTML = markdown(text);
    else el.textContent = text;
  }

  function addAct(el, text) {
    const a = el.querySelector('.acts');
    const row = document.createElement('div');
    row.className = 'act';
    row.textContent = `✓ ${text}`;
    a.appendChild(row);
  }

  function scrollToEnd() {
    log.scrollTop = log.scrollHeight;
  }

  function renderLog() {
    log.textContent = '';
    if (!turns.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      const p = document.createElement('p');
      p.textContent = mode === 'map'
        ? (toolsOk
          ? 'Claude가 마인드맵을 읽고, 부탁하면 도형·글자·화살표를 직접 추가하고 고쳐요. 바뀐 내용은 Ctrl+Z로 되돌릴 수 있어요.'
          : 'Claude가 지금 마인드맵의 도형과 연결을 읽고 함께 이야기해요.')
        : '마인드맵과 상관없이 자유롭게 아이디어를 이야기해요.';
      empty.appendChild(p);
      for (const s of SUGGESTIONS[mode]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = s;
        b.addEventListener('click', () => send(s));
        empty.appendChild(b);
      }
      log.appendChild(empty);
      return;
    }
    for (const t of turns) bubble(t.role, t.content, t.acts);
    scrollToEnd();
  }

  function renderMode() {
    for (const b of modeTabs.children) {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    modelSelect.value = tier;
    renderContext();
  }

  function renderContext() {
    const bridge = window.MindmapBridge;
    if (mode !== 'map' || !bridge) {
      contextNote.hidden = true;
      return;
    }
    const c = bridge.counts();
    contextNote.hidden = false;
    const canEdit = toolsOk && bridge.canEdit();
    contextNote.textContent = `Claude가 보는 마인드맵: 도형 ${c.nodes}개 · 연결 ${c.edges}개` +
      (c.selected ? ` · 선택 ${c.selected}개` : '') + (canEdit ? ' · 직접 수정 가능' : ' · 읽기만');
  }

  function setBusy(on) {
    btnSend.disabled = on;
    btnStop.hidden = !on;
  }

  // ---------- Tools Claude can call (edit-together mode) ----------
  const STYLE_PROPS = {
    fill: { type: 'string', description: "채우기 색 '#rrggbb' 또는 'transparent'" },
    stroke: { type: 'string', description: "외곽선 색 '#rrggbb'" },
    strokeWidth: { type: 'number', description: '외곽선 굵기 0~12 (0 = 없음)' },
    textColor: { type: 'string', description: "글자색 '#rrggbb'" },
    fontSize: { type: 'number', description: '글자 크기 px (8~120)' },
    fontWeight: { type: 'number', description: '글자 굵기 100~900' },
  };
  const GEOMETRY_PROPS = {
    label: { type: 'string', description: '도형 안의 글자(이름)' },
    type: { type: 'string', enum: ['rect', 'ellipse', 'diamond', 'text'] },
    x: { type: 'number' }, y: { type: 'number' },
    w: { type: 'number', description: '너비 (기본 사각형 160, 원 140, 마름모 150, 텍스트 160)' },
    h: { type: 'number', description: '높이 (기본 사각형 80, 원 100, 마름모 110, 텍스트 44)' },
  };

  function buildTools(session, reply) {
    const act = (t) => { addAct(reply, t); scrollToEnd(); };
    return [
      {
        name: 'get_map',
        description: 'Returns the current mind map as JSON {nodes, edges, selected}. Use it to re-read coordinates after changes.',
        execute: () => session.getMap(),
      },
      {
        name: 'add_nodes',
        description: 'Adds shapes or text boxes. Give each a ref; set parent to an existing node id or another ref in this call to also draw an arrow parent → new node. Returns [{ref, id}].',
        inputSchema: {
          type: 'object',
          properties: {
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ref: { type: 'string', description: '이 호출 안에서 쓰는 임시 이름' },
                  parent: { type: 'string', description: '부모 도형 id 또는 ref (화살표 부모 → 새 도형)' },
                  ...GEOMETRY_PROPS,
                  ...STYLE_PROPS,
                },
                required: ['label', 'x', 'y'],
              },
            },
          },
          required: ['nodes'],
        },
        execute: ({ nodes }) => {
          const list = Array.isArray(nodes) ? nodes : [];
          const created = session.addNodes(list);
          const idOf = new Map(created.filter((c) => c.ref).map((c) => [String(c.ref), c.id]));
          const edges = [];
          list.forEach((src, i) => {
            if (!src || !src.parent || !created[i]) return;
            const from = idOf.get(String(src.parent)) || String(src.parent);
            edges.push({ from, to: created[i].id });
          });
          const linked = edges.length ? session.addEdges(edges).length : 0;
          act(`도형 ${created.length}개 추가${linked ? ` · 화살표 ${linked}개 연결` : ''}`);
          return created.map((c) => ({ ref: c.ref, id: c.id }));
        },
      },
      {
        name: 'update_nodes',
        description: 'Changes existing nodes by id: label, type, position, size, colours, font, and port counts. Only the given fields change. Returns the updated ids.',
        inputSchema: {
          type: 'object',
          properties: {
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  ...GEOMETRY_PROPS,
                  ...STYLE_PROPS,
                  ports: { type: 'object', properties: { left: { type: 'number' }, right: { type: 'number' } }, description: '양옆 화살표 연결점 개수 (0~12)' },
                },
                required: ['id'],
              },
            },
          },
          required: ['nodes'],
        },
        execute: ({ nodes }) => {
          const done = session.updateNodes(Array.isArray(nodes) ? nodes : []);
          act(`도형 ${done.length}개 수정`);
          return done;
        },
      },
      {
        name: 'delete_nodes',
        description: 'Deletes nodes by id, with their arrows. Only when the user asked for removal. Returns how many were deleted.',
        inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
        execute: ({ ids }) => {
          const n = session.deleteNodes(Array.isArray(ids) ? ids : []);
          act(`도형 ${n}개 삭제`);
          return n;
        },
      },
      {
        name: 'add_edges',
        description: 'Draws arrows between existing nodes (from → to). Sides default to from:right, to:left. Returns the new edge ids.',
        inputSchema: {
          type: 'object',
          properties: {
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string' }, to: { type: 'string' },
                  fromSide: { type: 'string', enum: ['left', 'right'] },
                  toSide: { type: 'string', enum: ['left', 'right'] },
                },
                required: ['from', 'to'],
              },
            },
          },
          required: ['edges'],
        },
        execute: ({ edges }) => {
          const ids = session.addEdges(Array.isArray(edges) ? edges : []);
          act(`화살표 ${ids.length}개 연결`);
          return ids;
        },
      },
      {
        name: 'delete_edges',
        description: 'Removes arrows, given as edge ids or {from, to} node id pairs. Returns how many were removed.',
        inputSchema: {
          type: 'object',
          properties: { edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } }, ids: { type: 'array', items: { type: 'string' } } },
        },
        execute: ({ edges, ids }) => {
          const n = session.deleteEdges([...(Array.isArray(ids) ? ids : []), ...(Array.isArray(edges) ? edges : [])]);
          act(`화살표 ${n}개 삭제`);
          return n;
        },
      },
      {
        name: 'auto_layout',
        description: 'Tidies node positions into left-to-right columns that follow the arrows. gapX = horizontal gap between columns, gapY = vertical gap between nodes (px). Optional ids limits it to those nodes. Returns how many nodes moved.',
        inputSchema: {
          type: 'object',
          properties: { gapX: { type: 'number' }, gapY: { type: 'number' }, ids: { type: 'array', items: { type: 'string' } } },
        },
        execute: (args) => {
          const n = session.autoLayout(args || {});
          act(`도형 ${n}개 자동 정렬`);
          return n;
        },
      },
      {
        name: 'fit_view',
        description: "Zooms the user's screen so the whole map is visible. Use after large changes.",
        execute: () => session.fitView(),
      },
    ].slice(0, maxTools || undefined);
  }

  // ---------- Sending ----------
  function buildInput(withTools) {
    let lead = RULES;
    if (mode === 'map' && window.MindmapBridge) {
      const rules = withTools ? MAP_RULES : MAP_RULES.split('\n\n')[0] + '\n마인드맵을 직접 수정할 수는 없으니, 바꾸면 좋을 점은 제안으로 알려주세요.';
      lead += `\n\n${rules}\n\n<map>\n${window.MindmapBridge.describe().slice(0, 30000)}\n</map>`;
    }
    // Keep the most recent turns within budget; history must start on a user turn.
    let history = turns.slice(-MAX_TURNS).map(({ role, content }) => ({ role, content }));
    while (history.reduce((n, t) => n + t.content.length, 0) > MAX_HISTORY_CHARS && history.length > 1) {
      history = history.slice(1);
    }
    while (history.length && history[0].role !== 'user') history = history.slice(1);
    return [{ role: 'user', content: lead }, ...history];
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || !sample || ctl) return;
    if (!turns.length) log.textContent = '';
    turns.push({ role: 'user', content: text });
    bubble('user', text);
    input.value = '';
    const reply = bubble('assistant', '');
    reply.classList.add('thinking');
    reply.querySelector('.body').textContent = '생각하는 중…';
    scrollToEnd();
    saveHistory();

    const bridge = window.MindmapBridge;
    const withTools = mode === 'map' && toolsOk && bridge && bridge.canEdit();
    const session = withTools ? bridge.session() : null;
    const options = {
      cache: false,
      modelTier: tier,
      onText: ({ text: t }) => {
        reply.classList.remove('thinking');
        setBubble(reply, 'assistant', t);
        scrollToEnd();
      },
    };
    if (withTools) options.tools = buildTools(session, reply);

    ctl = new AbortController();
    options.signal = ctl.signal;
    setBusy(true);
    const acts = () => [...reply.querySelectorAll('.act')].map((a) => a.textContent.replace(/^✓ /, ''));
    try {
      const res = await sample(buildInput(withTools), options);
      reply.classList.remove('thinking');
      setBubble(reply, 'assistant', res.text);
      turns.push({ role: 'assistant', content: res.text, acts: acts() });
      if (res.truncated) note(reply, '답변이 길어서 중간에 끊겼어요. "이어서 해줘"라고 보내면 계속해요.');
      if (res.modelTierApplied && res.modelTierApplied !== tier) {
        note(reply, `요금제에 따라 ${TIER_NAMES[res.modelTierApplied] || res.modelTierApplied}로 답했어요.`);
      }
    } catch (e) {
      const code = e && e.code;
      reply.classList.remove('thinking');
      if (e && e.text) {
        setBubble(reply, 'assistant', e.text);
        turns.push({ role: 'assistant', content: e.text, acts: acts() });
      } else if (acts().length) {
        setBubble(reply, 'assistant', '');
        turns.push({ role: 'assistant', content: '(수정 중에 멈췄어요)', acts: acts() });
      } else {
        reply.remove();
      }
      if (code !== 'cancelled') {
        const msg = ERRORS[code] || '연결에 문제가 있어 답변이 끊겼어요. 다시 보내 주세요.';
        note(log.lastElementChild || log, msg, true);
      }
      if (code === 'tools_unavailable') { toolsOk = false; renderContext(); }
      if (HIDE_CODES.has(code)) disableChat(ERRORS[code] || '이 화면에서는 Claude 대화를 쓸 수 없어요.');
    } finally {
      ctl = null;
      setBusy(false);
      if (session && session.changed) offerUndo(session);
      saveHistory();
      scrollToEnd();
    }
  }

  function offerUndo(session) {
    const el = document.createElement('div');
    el.className = 'chat-note undo';
    const label = document.createElement('span');
    label.textContent = 'Claude가 마인드맵을 수정했어요.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link';
    btn.textContent = '되돌리기';
    btn.addEventListener('click', () => {
      if (session.undo()) {
        label.textContent = '수정 전으로 되돌렸어요.';
      } else {
        label.textContent = '그 뒤에 다른 변경이 있어서 여기서는 되돌릴 수 없어요. Ctrl+Z를 이용하세요.';
      }
      btn.remove();
    });
    el.append(label, btn);
    log.appendChild(el);
  }

  function note(after, msg, error) {
    const el = document.createElement('div');
    el.className = 'chat-note' + (error ? ' error' : '');
    el.textContent = msg;
    if (after === log) log.appendChild(el); else after.after(el);
  }

  function disableChat(msg) {
    btnSend.disabled = true;
    input.disabled = true;
    input.placeholder = msg;
  }

  // ---------- Open / close ----------
  function openChat(open) {
    chat.hidden = !open;
    document.body.classList.toggle('chat-open', open);
    btnChat.classList.toggle('active', open);
    window.dispatchEvent(new Event('resize'));
    if (open) {
      renderContext();
      input.focus();
    }
  }

  btnChat.addEventListener('click', () => openChat(chat.hidden));
  $('#chat-close').addEventListener('click', () => openChat(false));

  modeTabs.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    renderMode();
    if (!turns.length) renderLog();
    saveHistory();
  });

  modelSelect.addEventListener('change', () => {
    tier = modelSelect.value;
    saveHistory();
  });

  $('#chat-clear').addEventListener('click', () => {
    if (ctl) ctl.abort();
    turns = [];
    saveHistory();
    renderLog();
  });

  btnStop.addEventListener('click', () => { if (ctl) ctl.abort(); });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    send(input.value);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      send(input.value);
    }
  });

  // Keep the "what Claude sees" line current while the map changes.
  setInterval(() => { if (!chat.hidden) renderContext(); }, 1000);

  // ---------- Boot ----------
  (async () => {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    sample = await window.claude.use('sample');
    if (!sample) return;
    try {
      const limits = await sample.limits();
      toolsOk = !!(limits && limits.tools);
      maxTools = limits && limits.tools ? limits.tools.maxCount : 0;
    } catch (_) {
      toolsOk = false;
    }
    loadHistory();
    renderMode();
    renderLog();
    btnChat.hidden = false;
  })();
})();
