/* ============================================================
   Stockroom SPA — vanilla JS, hash-routed, fetch-based.
   - /login renders on first load, /#/anything renders the shell.
   - All API calls go through api() which attaches the JWT from
     cookie or localStorage. 401s bounce to the login screen.
   ============================================================ */
(function () {
  'use strict';

  // ---- tiny helpers --------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const h = (tag, props = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else if (v === false || v == null) {/* skip */}
      else el.setAttribute(k, String(v));
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  };
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };
  const fmtMoney = (n) => {
    if (!Number.isFinite(+n)) return '—';
    return new Intl.NumberFormat(undefined, { style:'currency', currency:'USD' }).format(+n);
  };

  // ---- API -----------------------------------------------------------
  const TOKEN_KEY = 'sm_jwt';
  const tokenStore = {
    get: () => localStorage.getItem(TOKEN_KEY),
    set: (t) => localStorage.setItem(TOKEN_KEY, t),
    clear: () => localStorage.removeItem(TOKEN_KEY),
  };

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    const tk = tokenStore.get();
    if (tk) headers['Authorization'] = `Bearer ${tk}`;
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch('/api' + path, { credentials: 'include', ...opts, headers });
    if (res.status === 401) {
      tokenStore.clear();
      state.user = null;
      renderLogin();
      throw new Error('Not authenticated');
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    else data = await res.text();
    if (!res.ok) {
      const msg = (data && data.error) || res.statusText || 'Request failed';
      throw new Error(msg);
    }
    return data;
  }

  // ---- Toasts --------------------------------------------------------
  const toast = (msg, kind = '') => {
    const wrap = $('#toast-wrap');
    const t = h('div', { class: 'toast ' + kind }, msg);
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(() => t.remove(), 280);
    }, 3200);
  };

  // ---- Modal ---------------------------------------------------------
  const modal = {
    open(title, bodyEl, opts = {}) {
      $('#modal-title').textContent = title;
      const root = $('#modal-body');
      root.innerHTML = '';
      root.appendChild(bodyEl);
      $('#modal-root').hidden = false;
      if (opts.onClose) this._onClose = opts.onClose;
    },
    close() {
      $('#modal-root').hidden = true;
      $('#modal-body').innerHTML = '';
      if (this._onClose) { this._onClose(); this._onClose = null; }
    },
  };
  $('#modal-close').addEventListener('click', () => modal.close());
  $('#modal-backdrop').addEventListener('click', () => modal.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-root').hidden) modal.close();
  });

  // ---- App state -----------------------------------------------------
  const state = {
    user: null,
    items: [],
    movements: [],
    users: [],
    summary: null,
    selectedItem: null,
    route: 'dashboard',
    filters: { q: '', category: '', low: false },
  };

  // ---- Auth ----------------------------------------------------------
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    const fd = new FormData(e.currentTarget);
    try {
      const { token, user } = await api('/auth/login', {
        method: 'POST',
        body: { username: fd.get('username'), password: fd.get('password') },
      });
      tokenStore.set(token);
      state.user = user;
      renderShell();
      toast('Signed in', 'good');
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    tokenStore.clear();
    state.user = null;
    renderLogin();
  });

  function renderLogin() {
    $('#login-screen').hidden = false;
    $('#app-shell').hidden = true;
    $('#who-name').textContent = '—';
    $('#who-role').textContent = '—';
  }

  function renderShell() {
    $('#login-screen').hidden = true;
    $('#app-shell').hidden = false;
    $('#who-name').textContent = state.user.full_name;
    $('#who-role').textContent = state.user.role + (state.user.role === 'admin' ? ' • full access' : '');
    $$('.admin-only').forEach(el => el.hidden = state.user.role !== 'admin');
    routeTo(location.hash.replace('#', '') || 'dashboard');
  }

  // ---- Routing -------------------------------------------------------
  function setActive(route) {
    $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  }
  // Generation counter. Each call to routeTo() bumps it, and each renderer
  // captures the value at entry. If a renderer resumes from an `await` and
  // the generation has changed, it bails out — this prevents a slow render
  // (e.g. multiple awaits in the dashboard) from clobbering the next page.
  let viewGen = 0;
  // Expose for the add-on (addon.js) so it can bump viewGen and cause any
  // pending v1 render (e.g. a slow dashboard fetch) to bail out instead of
  // clobbering an addon page with stale data.
  window.__smViewGen = () => ++viewGen;
  // Routes handled by the add-on (addon.js). v1 must NOT fall back to
  // dashboard for these — they have their own renderers in addon.js.
  // The addon bumps viewGen and dispatches its own hashchange when needed.
  async function routeTo(route) {
    if (!['dashboard','items','movements','users','alerts','requesters','departments','scan','admin','inventory'].includes(route)) route = 'dashboard';
    state.route = route;
    setActive(route);
    const titles = { dashboard:'Dashboard', items:'Items', movements:'Movements', users:'People' };
    $('#page-title').textContent = titles[route] || 'Stockroom';
    const root = $('#view-root');
    root.innerHTML = '';
    const myGen = ++viewGen;
    const stillHere = () => viewGen === myGen && root === $('#view-root');
    try {
      if (route === 'dashboard'   && stillHere()) await renderDashboard(root, stillHere);
      if (route === 'items'       && stillHere()) await renderItems(root, stillHere);
      if (route === 'movements'   && stillHere()) await renderMovements(root, stillHere);
      if (route === 'users'       && stillHere()) await renderUsers(root, stillHere);
    } catch (e) {
      if (!stillHere()) return;
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'card empty' }, 'Failed to load: ' + e.message));
    }
  }
  window.addEventListener('hashchange', () => routeTo(location.hash.replace('#','')));

  // ---- Dashboard -----------------------------------------------------
  async function renderDashboard(root, stillHere = () => true) {
    const data = await api('/stats/summary');
    if (!stillHere()) return;
    state.summary = data;
    const t = data.totals;
    const last = data.last7days;

    const grid = h('div', { class: 'kpi-grid' },
      kpi('icon-box',     'Items tracked',   t.item_count,           null,           ''),
      kpi('icon-pulse',   'Inventory value', fmtMoney(t.inventory_value), 'all categories', 'good'),
      kpi('icon-alert',   'Low stock',       t.low_stock_count,      'reorder soon', t.low_stock_count > 0 ? 'warn' : ''),
      kpi('icon-history', 'Out of stock',    t.out_of_stock_count,   'zero on hand', t.out_of_stock_count > 0 ? 'bad' : ''),
    );

    const inCard  = miniSparkCard('Stock in (7 days)',  last.in,  'good');
    const outCard = miniSparkCard('Stock out (7 days)', last.out, 'bad');

    const recent = await api('/movements?limit=10');
    if (!stillHere()) return;

    root.appendChild(grid);
    root.appendChild(h('div', { style: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginTop:'14px' } }, inCard, outCard));

    root.appendChild(h('div', { class: 'card', style:{marginTop:'14px'} },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Recent activity'),
        h('span', { class: 'muted' }, 'Last 10 movements')
      ),
      renderMovementsTable(recent.movements, /* compact */ true)
    ));

    const top = data.topConsumed || [];
    const topCard = h('div', { class: 'card', style:{marginTop:'14px'} },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Most-consumed items (30 days)'),
        h('span', { class: 'muted' }, 'by movement count')
      ),
      top.length === 0
        ? h('div', { class: 'empty' }, 'No outgoing movements recorded yet.')
        : h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'SKU'), h('th', {}, 'Movements'))),
            h('tbody', {}, ...top.map(r => h('tr', {}, h('td', {}, r.name), h('td', {}, h('span',{class:'tag'}, r.sku)), h('td', {}, String(r.cnt)))))
          )
    );
    root.appendChild(topCard);
  }

  function kpi(icon, label, value, sub, cls = '') {
    return h('div', { class: 'kpi ' + cls },
      h('div', { class: 'row' },
        h('span', { class: 'muted', style:{display:'inline-flex',alignItems:'center',gap:'8px'} },
          h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse(icon)), label)
      ),
      h('div', { class: 'value' }, String(value)),
      sub ? h('div', { class: 'sub' }, sub) : null
    );
  }
  function iconUse(id) {
    // Build the <use> element via the DOMParser instead of createElementNS.
    // Some browsers (older Samsung Browser, JSDOM) don't resolve `href`
    // on namespaced <use> elements created with createElementNS, even when
    // both `href` and `xlink:href` are set. Parsing a tiny inline SVG
    // string makes the browser's own HTML parser handle the namespace,
    // which is reliable everywhere.
    const ns = 'http://www.w3.org/2000/svg';
    const src = '<svg xmlns="' + ns + '"><use href="#icon-' + id + '"></use></svg>';
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    return doc.documentElement.firstChild; // the <use> element
  }

  function miniSparkCard(label, value, kind) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, label),
        h('span', { class: 'muted' }, 'last 7 days')
      ),
      h('div', { class: 'value', style: { fontSize:'24px', color: kind === 'good' ? 'var(--good)' : (kind === 'bad' ? 'var(--bad)' : 'var(--text-0)')} },
        value, ' ', h('span', { class: 'muted', style:{fontSize:'13px'} }, 'units')
      ),
      spark(value)
    );
  }
  function spark(value) {
    // tiny synthetic sparkline just for visual rhythm
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 120 30');
    svg.setAttribute('width', '120');
    svg.setAttribute('height', '30');
    svg.style.cssText = 'margin-top:8px;width:100%;height:30px;color:var(--accent-2)';
    const v = Number(value) || 0;
    const base = 2 + Math.min(28, v);
    const pts = [4, 8, 6, 12, 10, 18, base];
    const d = 'M0,28 ' + pts.map((p, i) => `L${i*20},${30 - p}`).join(' ') + ' L120,28 Z';
    svg.innerHTML = `<path d="${d}" fill="currentColor" fill-opacity="0.18"/>
                     <path d="${'M0,28 ' + pts.map((p,i)=>'L'+(i*20)+','+(30-p)).join(' ')}" stroke="currentColor" stroke-width="1.5" fill="none"/>`;
    return svg;
  }

  // ---- Items ---------------------------------------------------------
  async function renderItems(root, stillHere = () => true) {
    const params = new URLSearchParams();
    if (state.filters.q)        params.set('q', state.filters.q);
    if (state.filters.category) params.set('category', state.filters.category);
    if (state.filters.low)      params.set('low', '1');
    const { items } = await api('/items?' + params.toString());
    if (!stillHere()) return;
    state.items = items;
    const categories = Array.from(new Set(items.map(i => i.category))).sort();

    const toolbar = h('div', { class: 'toolbar' },
      h('label', { class: 'switch' + (state.filters.low ? ' on' : '') },
        h('input', { type: 'checkbox', checked: state.filters.low, onchange: (e) => { state.filters.low = e.target.checked; routeTo('items'); } }),
        h('span', { class: 'pill' }),
        'Low stock only'
      ),
      h('select', {
        onchange: (e) => { state.filters.category = e.target.value; routeTo('items'); }
      },
        h('option', { value: '' }, 'All categories'),
        ...categories.map(c => h('option', { value: c, selected: c === state.filters.category }, c))
      ),
      h('div', { class: 'grow' }),
      state.user.role === 'admin'
        ? h('button', { class: 'btn btn-primary', onclick: () => openItemEditor(null) },
            h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('plus')),
            'New item')
        : null
    );

    const card = h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Items'),
        h('span', { class: 'muted' }, `${items.length} result${items.length === 1 ? '' : 's'}`)
      ),
      items.length === 0
        ? h('div', { class: 'empty' },
            h('svg', { class: 'illus', 'aria-hidden': 'true' }, iconUse('box')),
            h('div', {}, 'No items match your filters.'))
        : h('div', { style:{overflowX:'auto'} }, renderItemsTable(items))
    );

    root.appendChild(toolbar);
    root.appendChild(card);
  }

  function renderItemsTable(items) {
    // Per-item inventory value = quantity × unit price (purchase_price if
    // set, otherwise unit_price as a fallback). Shown in the rightmost column.
    const valueOf = (it) => {
      const px = (Number(it.purchase_price) > 0) ? Number(it.purchase_price) : Number(it.unit_price || 0);
      return Number(it.quantity || 0) * px;
    };
    return h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'SKU'), h('th', {}, 'Name'), h('th', {}, 'Category'),
        h('th', {}, 'On hand'), h('th', {}, 'Stock level'), h('th', {}, 'Location'),
        h('th', {}, 'Status'), h('th', {}, 'Value'), h('th', {}, '')
      )),
      h('tbody', {}, ...items.map(it => {
        const ratio = Math.max(0, Math.min(1, it.min_quantity > 0 ? (it.quantity / (it.min_quantity * 3)) : 1));
        const klass = it.quantity === 0 ? 'bad' : it.quantity <= it.min_quantity ? 'warn' : 'good';
        return h('tr', {},
          h('td', {}, h('span', { class: 'tag' }, it.sku)),
          h('td', {}, it.name),
          h('td', {}, h('span', { class: 'chip neutral' }, it.category)),
          h('td', {}, h('strong', {}, String(it.quantity)), ' ', h('span', { class: 'muted' }, it.unit)),
          h('td', {}, h('div', { class: 'bar ' + (klass === 'good' ? '' : klass) },
            h('span', { style: { width: (ratio * 100).toFixed(1) + '%' } }))),
          h('td', {}, it.location || h('span', { class: 'muted' }, '—')),
          h('td', {}, statusChip(it)),
          h('td', { class: 'muted', style:{whiteSpace:'nowrap'} }, fmtMoney(valueOf(it))),
          h('td', { style:{whiteSpace:'nowrap'} },
            h('button', { class: 'icon-btn', title: 'Quick stock-out', onclick: () => openQuickStockOut(it) },
              h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('package-out'))),
            h('button', { class: 'icon-btn', title: 'View detail', style: { marginLeft: '4px' }, onclick: () => openItemDetail(it.id) },
              h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('search'))),
            state.user.role === 'admin'
              ? h('button', { class: 'icon-btn', title: 'Edit', style: { marginLeft: '4px' }, onclick: () => openItemEditor(it) },
                  h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('edit')))
              : null
          )
        );
      }))
    );
  }

  function statusChip(it) {
    if (it.quantity === 0)          return h('span', { class: 'chip bad' },    h('span',{class:'dot'}), 'Out of stock');
    if (it.quantity <= it.min_quantity) return h('span', { class: 'chip warn' }, h('span',{class:'dot'}), 'Low stock');
    return h('span', { class: 'chip good' }, h('span',{class:'dot'}), 'In stock');
  }

  async function openItemDetail(id) {
    const { item, movements } = await api('/items/' + id);
    state.selectedItem = item;

    // ---- Build the four tab panels once. Tabs are switched in-place via
    // a single renderTab(name) function that toggles `display` on the
    // panel <div>s. No re-render, no flicker.
    const header = h('div', { class: 'row', style:{gap:'12px', marginBottom:'14px'} },
      h('span', { class: 'tag' }, item.sku),
      h('h3', { style:{margin:'0'} }, item.name),
      h('div', { class:'spacer' }),
      statusChip(item)
    );

    const detailsPanel = h('div', { class: 'tab-panel' },
      h('div', { class: 'row-3' },
        field('Category', item.category),
        field('On hand', `${item.quantity} ${item.unit}`),
        field('Min qty',  `${item.min_quantity} ${item.unit}`),
        field('Unit price', fmtMoney(item.unit_price)),
        field('Purchase price', (Number(item.purchase_price) > 0) ? fmtMoney(item.purchase_price) : '—'),
        field('Total value', fmtMoney((Number(item.purchase_price) > 0 ? Number(item.purchase_price) : Number(item.unit_price || 0)) * Number(item.quantity || 0))),
        field('Location',  item.location || '—'),
        field('Updated',   fmtDate(item.updated_at)),
      ),
      h('div', { class: 'row', style:{gap:'8px', margin:'14px 0 0'} },
        state.user.role === 'admin' ? h('button', { class: 'btn btn-ghost', onclick: () => { modal.close(); openItemEditor(item); } },
          h('svg', { class: 'i-18', 'aria-hidden':'true' }, iconUse('edit')),
          'Edit') : null
      )
    );

    const stockInPanel  = h('div', { class: 'tab-panel' }); // filled below
    const stockOutPanel = h('div', { class: 'tab-panel' });
    const movementsPanel = h('div', { class: 'tab-panel' },
      movements.length === 0
        ? h('div', { class: 'empty muted' }, 'No movements yet.')
        : h('div', { style:{maxHeight:'320px',overflow:'auto'} }, renderMovementsTable(movements, true))
    );

    // Tab buttons (Details / Stock in / Stock out / Movements)
    const tabsBar = h('div', { class: 'tabs' });
    const panels = { details: detailsPanel, in: stockInPanel, out: stockOutPanel, movements: movementsPanel };
    const mkTab = (key, label, iconId) => {
      const btn = h('button', { class: 'tab', 'data-tab': key },
        h('svg', { class: 'i-18', 'aria-hidden':'true' }, iconUse(iconId)),
        h('span', {}, label)
      );
      btn.addEventListener('click', () => setTab(key));
      tabsBar.appendChild(btn);
      return btn;
    };
    const tabBtns = {
      details: mkTab('details', 'Details', 'box'),
      in:      mkTab('in',      'Stock in',  'package-in'),
      out:     mkTab('out',     'Stock out', 'package-out'),
      movements: mkTab('movements', 'Movements', 'history'),
    };

    function setTab(name) {
      for (const k of Object.keys(panels)) {
        panels[k].style.display = (k === name) ? '' : 'none';
        tabBtns[k].classList.toggle('active', k === name);
      }
    }

    // Stock-in and stock-out panels embed a small inline form so the
    // modal doesn't have to pop a second dialog for the most common action.
    function buildMoveForm(type) {
      const isIn = type === 'in';
      const f = h('form', { onsubmit: (e) => { e.preventDefault(); submit(type); } },
        h('div', { class: 'muted', style:{marginBottom:'10px', display:'flex', alignItems:'center', gap:'8px'} },
          h('span', {}, `${isIn ? 'Adding stock' : 'Removing stock'} for `,
            h('strong', {}, item.name),
            ` — current on hand: ${item.quantity} ${item.unit}`),
          h('div', { style:{marginLeft:'auto'} },
            h('button', { type:'button', class:'btn btn-ghost btn-sm',
                          onclick: () => {
                            modal.close();
                            openScanMini((it) => {
                              if (it.id !== item.id) { toast('Wrong item — scanned ' + it.sku, 'bad'); return; }
                              toast('SKU confirmed: ' + it.sku, 'good');
                              openItemDetail(it.id);
                            });
                          } },
              h('svg', { class: 'i-18', 'aria-hidden':'true' }, iconUse('search')),
              'Scan')
          )
        ),
        h('div', { class: 'row-2' },
          h('div', { class: 'field' },
            h('label', {}, 'Quantity *'),
            h('input', { type:'number', min:'1', step:'1', name:'qty', required: true, autofocus: true })),
          h('div', { class: 'field' },
            h('label', {}, isIn ? 'Source / supplier' : 'Taken by'),
            h('input', { type:'text', name:'counter' }))
        ),
        h('div', { class: 'field' },
          h('label', {}, 'Reason'),
          h('input', { type:'text', name:'reason', placeholder: isIn ? 'purchase, transfer…' : 'request, breakage…' })
        ),
        h('div', { class: 'modal-actions' },
          h('button', { type:'submit', class: 'btn ' + (isIn ? 'btn-good' : 'btn-warn') },
            isIn ? 'Add stock' : 'Remove stock'))
      );
      async function submit(t) {
        const fd = new FormData(f);
        const qty = parseInt(fd.get('qty'), 10);
        if (!Number.isFinite(qty) || qty <= 0) return toast('Quantity must be a positive integer', 'bad');
        try {
          await api(`/items/${item.id}/${t}`, {
            method: 'POST',
            body: {
              quantity: qty,
              counterparty: fd.get('counter') || null,
              reason: fd.get('reason') || null,
            }
          });
          toast(t === 'in' ? 'Stock added' : 'Stock removed', 'good');
          modal.close();
          routeTo(state.route);
        } catch (e) { toast(e.message, 'bad'); }
      }
      return f;
    }
    stockInPanel.appendChild(buildMoveForm('in'));
    stockOutPanel.appendChild(buildMoveForm('out'));

    const body = h('div', {},
      header,
      tabsBar,
      detailsPanel,
      stockInPanel,
      stockOutPanel,
      movementsPanel
    );

    setTab('details');
    modal.open(item.name, body);
  }
  window.__smOpenItemDetail = openItemDetail;

  function field(label, value) {
    return h('div', { class: 'field' },
      h('label', {}, label),
      h('div', {}, String(value))
    );
  }

  // Floating "scan a code" mini-modal: prompts for a SKU/barcode,
  // POSTs to /api/scan, and invokes `onFound(item)` with the matched
  // item. If the user closes it without entering a code, calls
  // `onCancel()`. Used by Stock-in/Stock-out/New-item modals so the
  // user can scan from any context, not just the standalone #scan page.
  function openScanMini(onFound, onCancel) {
    const body = h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('div', { class: 'muted', style:{marginBottom:'12px'} },
        'Scan a barcode or type the SKU/codebar, then press Enter.'),
      h('div', { class: 'field' },
        h('label', {}, 'Code'),
        h('input', { type:'text', id:'scan-code', autofocus: true, autocomplete: 'off',
                     placeholder: 'e.g. PEN-001', style:{fontFamily:'ui-monospace,monospace'} })),
      h('div', { id: 'scan-result', style:{marginTop:'8px',fontSize:'12.5px'} }),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: cancel }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn btn-primary',
                      onclick: (e) => { e.preventDefault(); submit(); } }, 'Look up'))
    );
    modal.open('Scan', body);
    function cancel() {
      modal.close();
      if (onCancel) onCancel();
    }
    async function submit() {
      const code = $('#scan-code').value.trim();
      if (!code) { $('#scan-result').textContent = 'Enter a code first.'; return; }
      try {
        const { item } = await api('/scan?code=' + encodeURIComponent(code));
        modal.close();
        if (onFound) onFound(item);
      } catch (e) {
        $('#scan-result').textContent = e.message;
      }
    }
  }
  // Expose for the addon (topbar Scan button, future Scan menu, etc.).
  window.__smOpenScanMini = openScanMini;

  // Quick stock-out from the items table — single-field modal that
  // defaults to the current on-hand quantity, so the most common
  // "I gave the last one away" workflow is one click + enter.
  function openQuickStockOut(item) {
    if (!item) {
      // No item picked yet — open the scan mini-modal first.
      openScanMini((it) => openQuickStockOut(it));
      return;
    }
    const body = h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('div', { class: 'muted', style:{marginBottom:'12px', display:'flex', alignItems:'center', gap:'8px'} },
        h('span', {}, `Removing stock for `, h('strong', {}, item.name),
          ` — current on hand: ${item.quantity} ${item.unit}`),
        h('div', { style:{marginLeft:'auto'} },
          h('button', { type:'button', class:'btn btn-ghost btn-sm',
                        onclick: () => { modal.close(); openScanMini((it) => openQuickStockOut(it)); } },
            h('svg', { class: 'i-18', 'aria-hidden':'true' }, iconUse('search')),
            'Scan')
        )
      ),
      h('div', { class: 'field' },
        h('label', {}, 'Quantity *'),
        h('input', { type:'number', min:'1', step:'1', max: String(item.quantity), id: 'qso-qty', required: true, autofocus: true, value: '1' })),
      h('div', { class: 'field' },
        h('label', {}, 'Taken by'),
        h('input', { type:'text', id: 'qso-counter', placeholder: 'optional' })),
      h('div', { class: 'field' },
        h('label', {}, 'Reason'),
        h('input', { type:'text', id: 'qso-reason', placeholder: 'optional' })),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => modal.close() }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn btn-warn' }, 'Remove stock'))
    );
    modal.open('Stock out — ' + item.name, body);
    async function submit() {
      const qty = parseInt($('#qso-qty').value, 10);
      if (!Number.isFinite(qty) || qty <= 0) return toast('Quantity must be a positive integer', 'bad');
      try {
        await api(`/items/${item.id}/out`, {
          method: 'POST',
          body: {
            quantity: qty,
            counterparty: $('#qso-counter').value || null,
            reason: $('#qso-reason').value || null,
          }
        });
        modal.close();
        toast('Stock removed', 'good');
        routeTo(state.route);
      } catch (e) {
        toast(e.message, 'bad');
      }
    }
  }

  function openMoveDialog(item, type) {
    const isIn = type === 'in';
    const body = h('div', {},
      h('div', { class: 'muted', style:{marginBottom:'12px'} },
        `${isIn ? 'Adding stock' : 'Removing stock'} for `, h('strong', {}, item.name),
        ` — current on hand: ${item.quantity} ${item.unit}`),
      h('div', { class: 'field' },
        h('label', {}, 'Quantity'),
        h('input', { type:'number', min:'1', step:'1', id: 'mv-qty', autofocus: true })
      ),
      h('div', { class: 'row-2' },
        h('div', { class: 'field' },
          h('label', {}, isIn ? 'Source / supplier' : 'Taken by'),
          h('input', { type:'text', id: 'mv-counter' })),
        h('div', { class: 'field' },
          h('label', {}, 'Reason'),
          h('input', { type:'text', id: 'mv-reason', placeholder: isIn ? 'purchase, transfer…' : 'request, breakage…' })
        )
      ),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => modal.close() }, 'Cancel'),
        h('button', { class: 'btn ' + (isIn ? 'btn-good' : 'btn-warn'), onclick: submit }, isIn ? 'Add stock' : 'Remove stock')
      )
    );
    modal.open((isIn ? 'Stock in — ' : 'Stock out — ') + item.name, body);

    async function submit() {
      const qty = parseInt($('#mv-qty').value, 10);
      if (!Number.isFinite(qty) || qty <= 0) return toast('Quantity must be a positive integer', 'bad');
      try {
        await api(`/items/${item.id}/${type}`, {
          method: 'POST',
          body: {
            quantity: qty,
            counterparty: $('#mv-counter').value || null,
            reason: $('#mv-reason').value || null,
          }
        });
        modal.close();
        toast(isIn ? 'Stock added' : 'Stock removed', 'good');
        routeTo(state.route);
      } catch (e) {
        toast(e.message, 'bad');
      }
    }
  }

  function openItemEditor(item) {
    const editing = !!item;
    const body = h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('div', { class: 'row-2' },
        // SKU row: input + Scan button (only on create — editing
        // re-uses the existing SKU and the button makes no sense).
        h('div', { class: 'field' },
          h('label', {}, 'SKU *'),
          h('div', { style:{display:'flex', gap:'6px'} },
            h('input', { name: 'sku', required: true, value: item?.sku || '',
                          disabled: editing,
                          style:{flex:'1', fontFamily:'ui-monospace,monospace'} }),
            editing ? null :
              h('button', { type:'button', class:'btn btn-ghost btn-sm',
                            onclick: () => {
                              modal.close();
                              openScanMini((it) => {
                                toast('Existing item: ' + it.name + ' — opening editor', 'good');
                                openItemEditor(it);
                              }, () => openItemEditor(null));
                            },
                            title: 'Scan a code to autofill' },
                h('svg', { class: 'i-18', 'aria-hidden':'true' }, iconUse('search')),
                'Scan')
          )
        ),
        fieldInput('Category *', 'category', item?.category || '', { required: true })
      ),
      h('div', { class: 'field' },
        h('label', {}, 'Name *'),
        h('input', { name: 'name', required: true, value: item?.name || '' })
      ),
      h('div', { class: 'row-3' },
        fieldInput('Unit', 'unit', item?.unit || 'pcs'),
        fieldInput('Min qty', 'min_quantity', item?.min_quantity ?? 5, { type: 'number', min: '0' }),
        fieldInput('Unit price', 'unit_price', item?.unit_price ?? 0, { type: 'number', step: '0.01', min: '0' })
      ),
      editing ? null : h('div', { class: 'row-2' },
        fieldInput('Opening qty', 'quantity', item?.quantity ?? 0, { type: 'number', min: '0' }),
        fieldInput('Location', 'location', item?.location || '')
      ),
      editing ? h('div', { class: 'field' },
        h('label', {}, 'Location'),
        h('input', { name: 'location', value: item?.location || '' })
      ) : null,
      h('div', { class: 'field' },
        h('label', {}, 'Notes'),
        h('textarea', { name: 'notes', rows: 2 }, item?.notes || '')
      ),
      h('div', { class: 'modal-actions' },
        editing && state.user.role === 'admin'
          ? h('button', { type: 'button', class: 'btn btn-bad', onclick: () => confirmDelete(item) },
              h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('trash')),
              'Delete')
          : null,
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => modal.close() }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, editing ? 'Save changes' : 'Create item')
      )
    );
    modal.open(editing ? 'Edit item' : 'New item', body);

    async function submit() {
      const fd = new FormData(body);
      const payload = {};
      for (const [k, v] of fd.entries()) {
        if (k === 'min_quantity' || k === 'unit_price' || k === 'quantity') payload[k] = +v;
        else payload[k] = v;
      }
      try {
        if (editing) {
          await api(`/items/${item.id}`, { method: 'PATCH', body: payload });
          toast('Item updated', 'good');
        } else {
          await api('/items', { method: 'POST', body: payload });
          toast('Item created', 'good');
        }
        modal.close();
        routeTo(state.route);
      } catch (e) {
        toast(e.message, 'bad');
      }
    }

    function confirmDelete(it) {
      if (!confirm(`Delete "${it.name}"? This will also remove its movement history.`)) return;
      api(`/items/${it.id}`, { method: 'DELETE' })
        .then(() => { toast('Item deleted', 'good'); modal.close(); routeTo(state.route); })
        .catch(e => toast(e.message, 'bad'));
    }
  }

  function fieldInput(label, name, value, attrs = {}) {
    return h('div', { class: 'field' },
      h('label', {}, label),
      h('input', Object.assign({ name, value: value ?? '' }, attrs))
    );
  }

  // ---- Movements -----------------------------------------------------
  async function renderMovements(root, stillHere = () => true) {
    const { movements } = await api('/movements?limit=200');
    if (!stillHere()) return;
    state.movements = movements;
    const card = h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Stock movements'),
        h('span', { class: 'muted' }, `${movements.length} record${movements.length === 1 ? '' : 's'}`)
      ),
      movements.length === 0
        ? h('div', { class: 'empty' },
            h('svg', { class: 'illus', 'aria-hidden': 'true' }, iconUse('history')),
            'No movements yet. Add some stock or hand items out from the Items page.')
        : renderMovementsTable(movements, false)
    );
    root.appendChild(card);
  }

  function renderMovementsTable(rows, compact) {
    return h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'When'),
        h('th', {}, 'Type'),
        h('th', {}, 'Item'),
        h('th', {}, 'Qty'),
        h('th', {}, 'Person'),
        h('th', {}, 'Counterparty'),
        h('th', {}, 'Reason')
      )),
      h('tbody', {}, ...rows.map(m => h('tr', {},
        h('td', { class: 'muted' }, fmtDate(m.created_at)),
        h('td', {}, h('span', { class: 'tag ' + m.type },
          m.type === 'in' ? 'IN' : 'OUT')),
        h('td', {}, m.item_name || `item #${m.item_id}`, m.sku ? ' ' : '', m.sku ? h('span', { class: 'tag' }, m.sku) : null),
        h('td', {}, h('strong', {}, (m.type === 'in' ? '+' : '−') + m.quantity)),
        h('td', {}, m.user_name || h('span', { class: 'muted' }, '—')),
        h('td', {}, m.counterparty || h('span', { class: 'muted' }, '—')),
        h('td', {}, m.reason || h('span', { class: 'muted' }, '—'))
      )))
    );
  }

  // ---- Users (admin) --------------------------------------------------
  async function renderUsers(root, stillHere = () => true) {
    const { users } = await api('/users');
    if (!stillHere()) return;
    // Fetch departments once for the editor dropdowns. Non-fatal if it
    // fails (e.g. a fresh empty DB) — the dropdown will just be empty.
    let departments = [];
    try { ({ departments } = await api('/departments')); } catch {}
    if (!stillHere()) return;
    state.users = users;
    state.departments = departments;

    const roleChip = (role) => {
      const cls = role === 'admin' ? 'good' : role === 'manager' ? 'warn' : 'neutral';
      return h('span', { class: 'chip ' + cls }, role);
    };

    const card = h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'People'),
        h('span', { class: 'muted' }, `${users.length} user${users.length === 1 ? '' : 's'}`)
      ),
      users.length === 0
        ? h('div', { class: 'empty' }, 'No users yet.')
        : h('table', {},
            h('thead', {}, h('tr', {},
              h('th', {}, 'Username'),
              h('th', {}, 'Full name'),
              h('th', {}, 'Email'),
              h('th', {}, 'Role'),
              h('th', {}, 'Department'),
              h('th', {}, 'Created'),
              h('th', {}, '')
            )),
            h('tbody', {}, ...users.map(u => h('tr', { 'data-uid': String(u.id) },
              h('td', {}, h('code', {}, u.username)),
              h('td', {}, u.full_name),
              h('td', { class: 'muted' }, u.email || h('span', { class: 'muted' }, '—')),
              h('td', {}, roleChip(u.role)),
              h('td', { class: 'muted' }, u.department_name || h('span', { class: 'muted' }, '—')),
              h('td', { class: 'muted' }, fmtDate(u.created_at)),
              h('td', { style:{whiteSpace:'nowrap'} },
                h('button', { class: 'icon-btn', title: 'Edit', onclick: () => openUserEditor(u) },
                  h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('edit'))),
                u.id !== state.user.id
                  ? h('button', { class: 'icon-btn', title: 'Remove', style:{marginLeft:'4px'}, onclick: () => removeUser(u) },
                      h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('trash')))
                  : h('span', { class: 'muted', style:{fontSize:'12px',marginLeft:'8px'} }, 'you')
              )
            )))
          )
    );

    const toolbar = h('div', { class: 'toolbar' },
      h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-primary', onclick: () => openUserEditor(null) },
        h('svg', { class: 'i-18', 'aria-hidden': 'true' }, iconUse('plus')),
        'New person')
    );

    root.appendChild(toolbar);
    root.appendChild(card);
  }

  // Single editor used for both create and edit. When `user` is null
  // we're creating; otherwise editing. The fields adapt accordingly.
  function openUserEditor(user) {
    const editing = !!user;
    // Fetch departments if we don't have them yet (e.g. editor opened
    // directly without going through renderUsers first).
    const ensureDepts = () => {
      if (state.departments && state.departments.length) return Promise.resolve(state.departments);
      return api('/departments').then(r => { state.departments = r.departments || []; return state.departments; }).catch(() => []);
    };
    ensureDepts().then(departments => {
      const body = h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('div', { class: 'row-2' },
          fieldInput('Username *', 'username', editing ? user.username : '', { required: true, autocomplete: 'off', disabled: editing }),
          fieldInput('Full name *', 'full_name', editing ? user.full_name : '', { required: true })
        ),
        h('div', { class: 'row-2' },
          fieldInput('Email', 'email', editing ? (user.email || '') : '', { type: 'email', autocomplete: 'off', placeholder: 'optional' }),
          fieldInput(editing ? 'New password (leave blank to keep)' : 'Password *',
                     'password', '', { type: 'password',
                                       required: !editing,
                                       autocomplete: 'new-password',
                                       minlength: editing ? 0 : 6 })
        ),
        h('div', { class: 'row-2' },
          h('div', { class: 'field' },
            h('label', {}, 'Role'),
            h('select', { name: 'role' },
              h('option', { value: 'staff',   selected: !editing || user.role === 'staff'   }, 'Staff'),
              h('option', { value: 'manager', selected: editing && user.role === 'manager' }, 'Manager'),
              h('option', { value: 'admin',   selected: editing && user.role === 'admin'   }, 'Admin')
            )
          ),
          h('div', { class: 'field' },
            h('label', {}, 'Department'),
            h('select', { name: 'department_id' },
              h('option', { value: '' }, '— none —'),
              ...departments.map(d => h('option', {
                value: String(d.id),
                selected: editing && user.department_id === d.id
              }, d.name))
            )
          )
        ),
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => modal.close() }, 'Cancel'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, editing ? 'Save changes' : 'Create user')
        )
      );
      modal.open(editing ? 'Edit ' + user.username : 'New person', body);

      async function submit() {
        const fd = new FormData(body);
        const payload = {};
        for (const [k, v] of fd.entries()) {
          if (k === 'department_id') payload[k] = v === '' ? null : Number(v);
          else payload[k] = v;
        }
        // Empty password on edit means "don't change it".
        if (editing && !payload.password) delete payload.password;
        // Username is immutable on edit.
        if (editing) delete payload.username;
        try {
          if (editing) {
            await api(`/users/${user.id}`, { method: 'PATCH', body: payload });
            toast('User updated', 'good');
          } else {
            await api('/users', { method: 'POST', body: payload });
            toast('User created', 'good');
          }
          modal.close();
          routeTo('users');
        } catch (e) { toast(e.message, 'bad'); }
      }
    });
  }

  function removeUser(u) {
    if (!confirm(`Remove ${u.full_name} (@${u.username})?`)) return;
    api(`/users/${u.id}`, { method: 'DELETE' })
      .then(() => { toast('User removed', 'good'); routeTo('users'); })
      .catch(e => toast(e.message, 'bad'));
  }

  // ---- Global search -------------------------------------------------
  $('#global-search').addEventListener('input', (e) => {
    state.filters.q = e.target.value;
    if (state.route !== 'items') location.hash = '#items';
    else routeTo('items');
  });

  // ---- Boot ----------------------------------------------------------
  async function boot() {
    if (tokenStore.get()) {
      try {
        const { user } = await api('/auth/me');
        state.user = user;
        renderShell();
        return;
      } catch { /* fall through to login */ }
    }
    renderLogin();
  }
  boot();
})();