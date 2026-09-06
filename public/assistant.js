/* ============================================================
 * Stockie — AI assistant floating widget.
 * Loaded AFTER addon.js. Strings come from the addon's i18n
 * table via window.__smI18n.t() so language switching works
 * without a refresh.
 * ============================================================ */
(function () {
  'use strict';
  if (window.__stockieLoaded) return;
  window.__stockieLoaded = true;

  const $ = (s, r = document) => r.querySelector(s);

  // Wait briefly for the addon's IIFE to expose __smI18n. If addon.js
  // fails to load, we fall back to a tiny English-only table so the
  // widget still works.
  const fallbackI18n = {
    en: {
      stockie_title: 'Stockie', stockie_fab_title: 'Open Stockie (AI assistant)',
      stockie_placeholder: 'Ask Stockie anything…', stockie_send: 'Send',
      stockie_clear: 'Clear chat', stockie_thinking: 'Stockie is thinking…',
      stockie_status_checking: 'checking…', stockie_status_unavailable: 'unavailable',
      stockie_status_not_configured: 'not configured', stockie_status_sign_in: 'sign in to use',
      stockie_status_error: 'error',
      stockie_not_configured_long: 'Stockie is not configured on this server.',
      stockie_greeting: "Hi! I'm Stockie, your Stockroom assistant.",
      stockie_cancelled: '✕ Cancelled', stockie_applying: '⏳ Applying…',
      stockie_confirm: 'Confirm', stockie_cancel: 'Cancel',
      stockie_error_prefix: 'Error: ',
    },
  };
  function t(k, ...args) {
    const i18n = window.__smI18n;
    if (i18n) return i18n.t(k, ...args);
    const v = (fallbackI18n.en && fallbackI18n.en[k]) || k;
    return typeof v === 'function' ? v(...args) : v;
  }

  // ---- Styles (kept inline so no separate CSS file to wire up) ----
  const CSS = `
  .stockie-fab {
    position: fixed; right: 18px; bottom: 18px; z-index: 9999;
    width: 54px; height: 54px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent, #7c5cff), #4ecdc4);
    color: #fff; border: none; cursor: pointer;
    box-shadow: 0 8px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08) inset;
    display: inline-flex; align-items: center; justify-content: center;
    transition: transform .15s, box-shadow .15s;
  }
  .stockie-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,.45); }
  .stockie-fab svg { width: 26px; height: 26px; }
  .stockie-panel {
    position: fixed; right: 18px; bottom: 82px; z-index: 9998;
    width: 380px; max-width: calc(100vw - 24px);
    height: 540px; max-height: calc(100vh - 110px);
    background: var(--bg-1, #1a1d2e);
    border: 1px solid var(--line, #2c3146);
    border-radius: 14px;
    box-shadow: 0 18px 50px rgba(0,0,0,.5);
    display: none; flex-direction: column; overflow: hidden;
    font: inherit;
    direction: inherit;
  }
  .stockie-panel.open { display: flex; }
  .stockie-head {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    background: linear-gradient(135deg, rgba(124,92,255,.18), rgba(78,205,196,.12));
    border-bottom: 1px solid var(--line, #2c3146);
  }
  .stockie-head .dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--good, #4ade80); box-shadow: 0 0 6px var(--good, #4ade80);
  }
  .stockie-head .dot.off { background: #888; box-shadow: none; }
  .stockie-head h4 { margin: 0; font-size: 14px; font-weight: 600; }
  .stockie-head .status { font-size: 11px; color: var(--text-1, #aaa); margin-left: auto; }
  .stockie-msgs {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .stockie-msg {
    max-width: 90%; padding: 8px 12px;
    border-radius: 12px; font-size: 13px; line-height: 1.45;
    word-wrap: break-word;
  }
  .stockie-msg.user {
    align-self: flex-end;
    background: var(--accent, #7c5cff); color: #fff;
  }
  .stockie-msg.bot {
    align-self: flex-start;
    background: var(--bg-2, #232744); color: var(--text-0, #e7e9f3);
    border: 1px solid var(--line, #2c3146);
  }
  .stockie-msg.err { border-color: var(--bad, #ef4444); color: var(--bad, #ef4444); }
  .stockie-msg pre {
    background: var(--bg-3, #11142a); padding: 6px 8px;
    border-radius: 6px; font-size: 11px; margin: 6px 0 0;
    overflow-x: auto; white-space: pre-wrap;
  }
  .stockie-reads {
    font-size: 11px; color: var(--text-1, #aaa);
    margin-top: 6px; padding-top: 6px;
    border-top: 1px dashed var(--line, #2c3146);
  }
  .stockie-reads summary { cursor: pointer; }
  .stockie-proposal {
    margin-top: 8px; padding: 10px;
    background: rgba(124,92,255,.10);
    border: 1px solid var(--accent, #7c5cff);
    border-radius: 8px;
  }
  .stockie-proposal .label { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  .stockie-proposal .args {
    font-family: ui-monospace, monospace;
    font-size: 11px; color: var(--text-1, #aaa);
    margin-bottom: 8px; word-break: break-word;
  }
  .stockie-proposal .actions { display: flex; gap: 6px; }
  .stockie-proposal button {
    padding: 6px 12px; border-radius: 6px;
    border: 1px solid var(--line, #2c3146);
    background: var(--bg-2, #232744); color: var(--text-0, #e7e9f3);
    cursor: pointer; font-size: 12px;
  }
  .stockie-proposal button.primary {
    background: var(--accent, #7c5cff); border-color: var(--accent, #7c5cff); color: #fff;
  }
  .stockie-proposal button.danger {
    background: var(--bad, #ef4444); border-color: var(--bad, #ef4444); color: #fff;
  }
  .stockie-proposal button:disabled { opacity: .55; cursor: not-allowed; }
  .stockie-input {
    border-top: 1px solid var(--line, #2c3146);
    padding: 10px; display: flex; gap: 6px;
  }
  .stockie-input textarea {
    flex: 1; resize: none; min-height: 38px; max-height: 120px;
    padding: 8px 10px; background: var(--bg-2, #232744);
    border: 1px solid var(--line, #2c3146); color: var(--text-0, #e7e9f3);
    border-radius: 8px; font: inherit; font-size: 13px;
  }
  .stockie-input textarea:focus { outline: none; border-color: var(--accent, #7c5cff); }
  .stockie-input button {
    padding: 0 14px; border-radius: 8px;
    background: var(--accent, #7c5cff); color: #fff; border: none;
    cursor: pointer; font-size: 13px;
  }
  .stockie-input button:disabled { opacity: .55; cursor: not-allowed; }
  .stockie-spinner {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid var(--text-1, #aaa);
    border-top-color: var(--accent, #7c5cff);
    border-radius: 50%;
    animation: stockie-spin .8s linear infinite;
  }
  @keyframes stockie-spin { to { transform: rotate(360deg); } }
  .stockie-msgs code { background: var(--bg-3, #11142a); padding: 1px 4px; border-radius: 4px; font-size: 12px; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // ---- State ----
  const history = [];
  let panelOpen = false;
  let enabled = false;
  let pending = false;

  // ---- Build the DOM once ----
  const fab = document.createElement('button');
  fab.className = 'stockie-fab';
  fab.title = t('stockie_fab_title');
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  fab.addEventListener('click', () => toggle());

  const panel = document.createElement('div');
  panel.className = 'stockie-panel';
  panel.innerHTML = `
    <div class="stockie-head">
      <span class="dot off" id="stockie-dot"></span>
      <h4 id="stockie-title">${escapeHtml(t('stockie_title'))}</h4>
      <span class="status" id="stockie-status">${escapeHtml(t('stockie_status_checking'))}</span>
      <button id="stockie-clear" title="${escapeHtml(t('stockie_clear'))}" style="margin-left:8px;padding:2px 8px;border-radius:6px;background:transparent;border:1px solid var(--line,#2c3146);color:var(--text-1,#aaa);cursor:pointer;font-size:11px">${escapeHtml(t('stockie_clear'))}</button>
    </div>
    <div class="stockie-msgs" id="stockie-msgs"></div>
    <form class="stockie-input">
      <textarea id="stockie-text" placeholder="${escapeHtml(t('stockie_placeholder'))}" rows="1"></textarea>
      <button type="submit" id="stockie-send">${escapeHtml(t('stockie_send'))}</button>
    </form>
  `;
  document.body.appendChild(panel);
  document.body.appendChild(fab);

  const msgsEl = $('#stockie-msgs');
  const textEl = $('#stockie-text');
  const sendBtn = $('#stockie-send');
  const statusEl = $('#stockie-status');
  const dotEl = $('#stockie-dot');
  const titleEl = $('#stockie-title');
  const clearBtn = $('#stockie-clear');

  function toggle() {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
    if (panelOpen) setTimeout(() => textEl.focus(), 50);
  }

  // ---- Re-apply translations on language change ----
  function applyLocal() {
    fab.title = t('stockie_fab_title');
    titleEl.textContent = t('stockie_title');
    clearBtn.textContent = t('stockie_clear');
    clearBtn.title = t('stockie_clear');
    textEl.placeholder = t('stockie_placeholder');
    sendBtn.textContent = t('stockie_send');
    // Mirror addon's document direction
    const dir = (window.__smI18n && window.__smI18n.getLang() === 'ar') ? 'rtl' : 'ltr';
    panel.style.direction = dir;
  }
  // Listen for storage events (the addon persists sm_lang to localStorage)
  window.addEventListener('storage', (e) => {
    if (e.key === 'sm_lang') { applyLocal(); setStatus(currentStatusKey, currentStatusOn); }
  });
  // Poll the addon's lang getter every 2s (cheap) so manual changes via
  // the language switcher are picked up even without storage events.
  let lastLang = null;
  setInterval(() => {
    const cur = window.__smI18n ? window.__smI18n.getLang() : 'en';
    if (cur !== lastLang) { lastLang = cur; applyLocal(); setStatus(currentStatusKey, currentStatusOn); }
  }, 2000);
  setTimeout(() => { lastLang = window.__smI18n ? window.__smI18n.getLang() : 'en'; }, 200);

  // ---- Status probe ----
  let currentStatusKey = 'stockie_status_checking';
  let currentStatusOn = false;
  function setStatus(key, on) {
    currentStatusKey = key;
    currentStatusOn = on;
    const txt = t(key) || t('stockie_status_error');
    if (typeof txt === 'function') {
      // stockie_status_ready takes a tool count; without one we just show "ready"
      statusEl.textContent = t('stockie_status_ready', 0).replace(' · 0 ', ' · ');
    } else {
      statusEl.textContent = txt;
    }
    dotEl.classList.toggle('off', !on);
  }
  async function probeStatus() {
    try {
      const tk = localStorage.getItem('sm_jwt');
      if (!tk) { setStatus('stockie_status_sign_in', false); return; }
      const r = await fetch('/api/assistant/status', { headers: { Authorization: 'Bearer ' + tk } });
      if (!r.ok) { setStatus('stockie_status_unavailable', false); return; }
      const j = await r.json();
      enabled = !!j.enabled;
      if (enabled) {
        statusEl.textContent = t('stockie_status_ready', j.tools);
        dotEl.classList.remove('off');
        currentStatusOn = true;
      } else {
        setStatus('stockie_status_not_configured', false);
      }
    } catch (e) { setStatus('stockie_status_error', false); }
  }

  // ---- Chat send ----
  async function send(text) {
    if (!text || pending) return;
    if (!enabled) { appendMsg('bot', t('stockie_not_configured_long'), 'err'); return; }

    history.push({ role: 'user', content: text });
    appendMsg('user', text);
    pending = true; sendBtn.disabled = true;
    const typing = appendSpinner();

    try {
      const tk = localStorage.getItem('sm_jwt');
      const r = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({ messages: history }),
      });
      typing.remove();
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
        appendMsg('bot', t('stockie_error_prefix') + (err.error || r.statusText), 'err');
        return;
      }
      const out = await r.json();
      history.push({ role: 'assistant', content: out.reply || '(no reply)' });
      renderAssistant(out);
    } catch (e) {
      typing.remove();
      appendMsg('bot', t('stockie_network_error', e.message), 'err');
    } finally {
      pending = false; sendBtn.disabled = false; textEl.focus();
    }
  }

  function appendMsg(role, content, klass) {
    const div = document.createElement('div');
    div.className = 'stockie-msg ' + role + (klass ? ' ' + klass : '');
    div.innerHTML = renderMarkdown(content);
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }
  function appendSpinner() {
    const div = document.createElement('div');
    div.className = 'stockie-msg bot';
    div.innerHTML = '<span class="stockie-spinner"></span> ' + escapeHtml(t('stockie_thinking'));
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  function renderMarkdown(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function renderAssistant(out) {
    if (out.reply) appendMsg('bot', out.reply);

    if (out.reads && out.reads.length) {
      const det = document.createElement('details');
      det.className = 'stockie-reads';
      det.style.cssText = 'align-self:flex-start;max-width:90%;padding:6px 10px;background:var(--bg-2,#232744);border:1px solid var(--line,#2c3146);border-radius:10px;font-size:11px;color:var(--text-1,#aaa);';
      det.innerHTML = '<summary>' + escapeHtml(t('stockie_reads_summary', out.reads.length)) + '</summary>' +
        out.reads.map(r => '<div style="margin-top:4px"><code>' + escapeHtml(r.tool) + '</code> ' + escapeHtml(JSON.stringify(r.args || {})) + '</div>').join('');
      msgsEl.appendChild(det);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    if (out.pending_writes && out.pending_writes.length) {
      for (const p of out.pending_writes) {
        const card = document.createElement('div');
        card.className = 'stockie-proposal';
        card.style.alignSelf = 'flex-start';
        card.style.maxWidth = '90%';
        const lbl = t('stockie_propose') + ' ' + p.label;
        card.innerHTML = `
          <div class="label">${escapeHtml(lbl)}</div>
          <div class="args">${escapeHtml(JSON.stringify(p.args, null, 0))}</div>
          <div class="actions">
            <button class="primary" data-action="confirm">${escapeHtml(t('stockie_confirm'))}</button>
            <button data-action="cancel">${escapeHtml(t('stockie_cancel'))}</button>
          </div>
        `;
        const btns = card.querySelectorAll('button');
        btns[0].addEventListener('click', () => executeProposal(p, card));
        btns[1].addEventListener('click', () => {
          card.querySelector('.label').textContent = t('stockie_cancelled');
          btns.forEach(b => b.disabled = true);
          history.push({ role: 'user', content: '[Cancelled proposal: ' + p.label + ']' });
        });
        msgsEl.appendChild(card);
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    }
  }

  async function executeProposal(p, card) {
    const btns = card.querySelectorAll('button');
    btns.forEach(b => b.disabled = true);
    card.querySelector('.label').textContent = t('stockie_applying');
    try {
      const tk = localStorage.getItem('sm_jwt');
      const r = await fetch('/api/assistant/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({ tool: p.tool, args: p.args }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      card.querySelector('.label').textContent = t('stockie_done', p.label);
      const argsEl = card.querySelector('.args');
      if (argsEl) argsEl.innerHTML = '<pre>' + escapeHtml(JSON.stringify(j, null, 2)) + '</pre>';
      history.push({ role: 'user', content: '[Confirmed: ' + p.label + ' — result: ' + JSON.stringify(j) + ']' });
    } catch (e) {
      card.querySelector('.label').textContent = t('stockie_failed', e.message);
      btns[0].disabled = false;
      btns[1].disabled = false;
      history.push({ role: 'user', content: '[Proposal failed: ' + e.message + ']' });
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ---- Wire up ----
  panel.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = textEl.value.trim();
    if (!v) return;
    textEl.value = '';
    send(v);
  });
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = textEl.value.trim();
      if (!v) return;
      textEl.value = '';
      send(v);
    }
  });
  clearBtn.addEventListener('click', () => {
    history.length = 0;
    msgsEl.innerHTML = '';
    appendMsg('bot', t('stockie_greeting'));
  });

  // ---- Lifecycle ----
  function syncVisibility() {
    const hasToken = !!localStorage.getItem('sm_jwt');
    fab.style.display = hasToken ? '' : 'none';
    if (hasToken) probeStatus();
  }
  window.addEventListener('storage', (e) => {
    if (e.key === 'sm_jwt') syncVisibility();
  });
  setInterval(syncVisibility, 30000);
  setTimeout(syncVisibility, 300);
  setTimeout(syncVisibility, 1500);

  // Initial greeting (or no-op if not yet signed in)
  if (localStorage.getItem('sm_jwt')) {
    appendMsg('bot', t('stockie_greeting'));
  }
})();
