(() => {
  'use strict';

  // Chat with Claude, available when the page is opened on claude.ai (the `sample` capability).
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
  const contextNote = $('#chat-context');

  const RULES = [
    '당신은 사용자의 아이디어 브레인스토밍을 돕는 파트너입니다.',
    '한국어로 자연스럽고 간결하게 답하세요. 필요할 때만 짧은 목록을 쓰고, 긴 서론은 생략하세요.',
  ].join('\n');

  const MAP_RULES = [
    '아래는 사용자가 지금 화면에서 보고 있는 마인드맵입니다.',
    '도형 이름과 화살표 연결(A → B는 A에서 B로 이어진다는 뜻)을 근거로 답하고,',
    '도형을 언급할 때는 이름을 그대로 쓰세요. 마인드맵을 직접 수정할 수는 없으니, 추가하면 좋을 도형이나 연결은 제안으로 알려주세요.',
  ].join('\n');

  const SUGGESTIONS = {
    free: ['새 프로젝트 아이디어 같이 떠올려줘', '브레인스토밍 잘하는 방법 알려줘'],
    map: ['이 마인드맵 요약해줘', '빠진 아이디어를 제안해줘', '구조를 어떻게 개선하면 좋을까?'],
  };

  const ERRORS = {
    not_granted: 'Claude 사용이 허용되지 않았어요. 이 페이지를 다시 열고 허용을 누르면 대화할 수 있어요.',
    sampling_disabled: '이 계정에서는 Claude 대화를 쓸 수 없어요.',
    rate_limited: '요청이 너무 많아요. 잠시 후 다시 보내 주세요.',
    session_expired: 'claude.ai 로그인이 만료됐어요. 다시 로그인한 뒤 보내 주세요.',
    prompt_too_large: '대화가 너무 길어요. "대화 지우기"를 누른 뒤 다시 시도해 주세요.',
    refused: 'Claude가 이 요청에는 답하지 않았어요. 표현을 바꿔서 다시 물어봐 주세요.',
    empty_completion: '답변이 비어 있어요. 질문을 조금 더 구체적으로 적어 주세요.',
  };
  const HIDE_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);

  let sample = null;
  let turns = [];   // [{ role, content }]
  let mode = 'map';
  let ctl = null;

  function loadHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(CHAT_KEY));
      if (data && Array.isArray(data.turns)) turns = data.turns;
      if (data && (data.mode === 'free' || data.mode === 'map')) mode = data.mode;
    } catch (_) { /* start fresh */ }
  }

  function saveHistory() {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify({ turns, mode })); } catch (_) { /* per-viewer only */ }
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

  function bubble(role, text) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    setBubble(el, role, text);
    log.appendChild(el);
    return el;
  }

  function setBubble(el, role, text) {
    if (role === 'assistant') el.innerHTML = markdown(text);
    else el.textContent = text;
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
        ? 'Claude가 지금 마인드맵의 도형과 연결을 읽고 함께 이야기해요.'
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
    for (const t of turns) bubble(t.role, t.content);
    scrollToEnd();
  }

  function renderMode() {
    for (const b of modeTabs.children) {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
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
    contextNote.textContent = `Claude가 보는 마인드맵: 도형 ${c.nodes}개 · 연결 ${c.edges}개` +
      (c.selected ? ` · 선택 ${c.selected}개` : '');
  }

  function setBusy(on) {
    btnSend.disabled = on;
    btnStop.hidden = !on;
    input.disabled = false;
  }

  // ---------- Sending ----------
  function buildInput() {
    let lead = RULES;
    if (mode === 'map' && window.MindmapBridge) {
      lead += `\n\n${MAP_RULES}\n\n<마인드맵>\n${window.MindmapBridge.describe().slice(0, 20000)}\n</마인드맵>`;
    }
    // Keep the most recent turns within budget; history must start on a user turn.
    let history = turns.slice(-MAX_TURNS);
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
    reply.textContent = '생각하는 중…';
    scrollToEnd();
    saveHistory();

    ctl = new AbortController();
    setBusy(true);
    try {
      const { text: answer, truncated } = await sample(buildInput(), {
        cache: false,
        signal: ctl.signal,
        onText: ({ text: t }) => {
          reply.classList.remove('thinking');
          setBubble(reply, 'assistant', t);
          scrollToEnd();
        },
      });
      reply.classList.remove('thinking');
      setBubble(reply, 'assistant', answer);
      turns.push({ role: 'assistant', content: answer });
      if (truncated) note(reply, '답변이 길어서 중간에 끊겼어요. "이어서 말해줘"라고 보내면 계속해요.');
    } catch (e) {
      const code = e && e.code;
      reply.classList.remove('thinking');
      if (e && e.text) {
        setBubble(reply, 'assistant', e.text);
        turns.push({ role: 'assistant', content: e.text });
      } else {
        reply.remove();
      }
      if (code !== 'cancelled') {
        const msg = ERRORS[code] || '연결에 문제가 있어 답변이 끊겼어요. 다시 보내 주세요.';
        note(log.lastElementChild || log, msg, true);
      }
      if (HIDE_CODES.has(code)) disableChat(ERRORS[code] || '이 화면에서는 Claude 대화를 쓸 수 없어요.');
    } finally {
      ctl = null;
      setBusy(false);
      saveHistory();
      scrollToEnd();
    }
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
    loadHistory();
    renderMode();
    renderLog();
    btnChat.hidden = false;
  })();
})();
