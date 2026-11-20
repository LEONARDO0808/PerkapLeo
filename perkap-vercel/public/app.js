/* ================= Perkap App (versi Vercel) ================= */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const TOKEN_KEY = 'perkap_token';
  const POLL_MS = 4000;

  const DEFAULT_STATUSES = [
    { key: 'dipakai', label: 'Dipakai', isDone: false },
    { key: 'dipinjam', label: 'Dipinjam', isDone: false },
    { key: 'dikembalikan', label: 'Dikembalikan', isDone: true },
  ];

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    user: null,
    items: [],
    statuses: DEFAULT_STATUSES.slice(),
    filter: 'all',
    sort: 'new',
    peminjam: 'all',
    search: '',
    collapsed: {},
    displayName: '',
  };
  let clockTimer = null;
  let pollTimer = null;
  let lastSnapshot = null;
  let lastStatusSnapshot = null;
  let recentLocal = {};
  let didInitialRender = false;

  /* ---------- API helper ---------- */
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    } catch (e) {
      const err = new Error('Tidak ada koneksi internet');
      err.offline = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      if (res.status === 401 && state.token) { logoutLocal(); }
      throw new Error((data && data.error) || 'Terjadi kesalahan');
    }
    return data;
  }

  /* ================= Offline-first: cache + antrean sinkron ================= */
  const CACHE_ITEMS = 'perkap_cache_items';
  const CACHE_STATUSES = 'perkap_cache_statuses';
  const CACHE_USER = 'perkap_cache_user';
  const QUEUE_KEY = 'perkap_queue';

  function saveCache() {
    try {
      localStorage.setItem(CACHE_ITEMS, JSON.stringify(state.items));
      localStorage.setItem(CACHE_STATUSES, JSON.stringify(state.statuses));
      if (state.user) localStorage.setItem(CACHE_USER, JSON.stringify(state.user));
    } catch (e) {}
  }
  function loadCacheIntoState() {
    try {
      const ci = localStorage.getItem(CACHE_ITEMS);
      if (ci) { const arr = JSON.parse(ci); if (Array.isArray(arr)) state.items = arr; }
      const cs = localStorage.getItem(CACHE_STATUSES);
      if (cs) { const arr = JSON.parse(cs); if (Array.isArray(arr) && arr.length) state.statuses = arr; }
      if (!state.user) {
        const cu = localStorage.getItem(CACHE_USER);
        if (cu) { try { state.user = JSON.parse(cu); } catch (e) {} }
      }
    } catch (e) {}
  }
  function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; } }
  function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {} }
  function tmpId() { return 'tmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function isTempId(id) { return String(id).startsWith('tmp_'); }
  function touchRecent(id) { recentLocal[id] = Date.now(); }
  function clearRecent(id) { delete recentLocal[id]; }
  function hasRecentLocal() {
    const n = Date.now();
    for (const k in recentLocal) {
      if (n - recentLocal[k] < 5000) return true;
      delete recentLocal[k];
    }
    return false;
  }

  function updateOnlineUI() {
    state.online = navigator.onLine;
    const bar = $('#offlineBar');
    if (bar) bar.classList.toggle('hidden', state.online);
    const dot = $('#liveDot');
    if (dot) {
      dot.classList.toggle('on', state.online);
      dot.classList.toggle('offline', !state.online);
      dot.title = state.online ? 'Online' : 'Offline';
    }
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing || !state.token || !navigator.onLine) return;
    const q = loadQueue();
    if (!q.length) return;
    flushing = true;
    try {
      while (q.length) {
        const op = q[0];
        try {
          if (op.op === 'create') {
            const r = await api('/api/items', { method: 'POST', body: JSON.stringify(op.payload) });
            const real = r.item;
            const idx = state.items.findIndex((x) => x.id === op.tempId);
            if (idx >= 0) state.items[idx] = real;
            for (const o of q) { if (o.id === op.tempId) o.id = real.id; }
            q.shift(); delete recentLocal[op.tempId]; touchRecent(real.id);
          } else if (op.op === 'update') {
            if (isTempId(op.id)) { q.shift(); }
            else { await api('/api/items/' + op.id, { method: 'PUT', body: JSON.stringify(op.patch) }); q.shift(); }
          } else if (op.op === 'delete') {
            if (isTempId(op.id)) { q.shift(); }
            else { await api('/api/items/' + op.id, { method: 'DELETE' }); q.shift(); }
          } else { q.shift(); }
        } catch (err) {
          if (err && err.offline) break;   // jaringan putus -> hentikan, simpan sisa antrean
          q.shift();                        // error logis (403/404) -> buang
        }
        saveQueue(q);
        lastSnapshot = JSON.stringify(state.items);
        saveCache();
        render();
      }
    } finally {
      saveQueue(q);
      flushing = false;
      saveCache();
      updateOnlineUI();
    }
  }

  async function saveNewItem(payload) {
    const optimistic = {
      id: tmpId(), nama: payload.nama, jumlah: payload.jumlah,
      satuan: payload.satuan || '', status: payload.status || 'dipakai',
      keterangan: payload.keterangan || '',
      createdBy: state.user ? state.user.username : '',
      createdById: state.user ? state.user.id : null,
      createdAt: Date.now(), updatedAt: Date.now(), _pending: true,
    };
    state.items.unshift(optimistic);
    touchRecent(optimistic.id);
    const q = loadQueue(); q.push({ op: 'create', tempId: optimistic.id, payload }); saveQueue(q);
    lastSnapshot = JSON.stringify(state.items);
    saveCache(); render();
    await flushQueue();
    return optimistic;
  }
  async function saveUpdateItem(id, patch) {
    touchRecent(id);
    const it = state.items.find((x) => x.id === id);
    if (it) { Object.assign(it, patch); it.updatedAt = Date.now(); }
    if (isTempId(id)) {
      const q = loadQueue(); const c = q.find((o) => o.op === 'create' && o.tempId === id);
      if (c) Object.assign(c.payload, patch); saveQueue(q);
    } else {
      const q = loadQueue(); q.push({ op: 'update', id, patch }); saveQueue(q);
    }
    lastSnapshot = JSON.stringify(state.items);
    saveCache(); render();
    await flushQueue();
  }
  async function deleteItemById(id) {
    touchRecent(id);
    state.items = state.items.filter((x) => x.id !== id);
    if (isTempId(id)) {
      const q = loadQueue().filter((o) => !(o.op === 'create' && o.tempId === id) && o.id !== id);
      saveQueue(q);
    } else {
      const q = loadQueue(); q.push({ op: 'delete', id }); saveQueue(q);
    }
    lastSnapshot = JSON.stringify(state.items);
    saveCache(); render();
    await flushQueue();
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  /* ---------- Loading (overlay & tombol) ---------- */
  function showOverlay(text) {
    const o = $('#loadingOverlay'); if (!o) return;
    const t = $('#loadingLabel'); if (t) t.textContent = text || 'Memuat…';
    o.classList.remove('hidden');
  }
  function hideOverlay() { const o = $('#loadingOverlay'); if (o) o.classList.add('hidden'); }
  function setBtnLoading(btn, on, text) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.classList.add('is-loading');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + (text ? ' ' + text : '');
    } else {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    }
  }

  /* ---------- Dialog popup (tengah) pengganti prompt/confirm ---------- */
  function openDialog(opts = {}) {
    return new Promise((resolve) => {
      const bd = $('#dialogBackdrop');
      $('#dialogTitle').textContent = opts.title || '';
      const msg = $('#dialogMsg');
      if (opts.message) { msg.textContent = opts.message; msg.classList.remove('hidden'); }
      else msg.classList.add('hidden');
      const inp = $('#dialogInput');
      if (opts.input) { inp.classList.remove('hidden'); inp.placeholder = opts.input.placeholder || ''; inp.value = opts.input.value || ''; }
      else inp.classList.add('hidden');
      const cw = $('#dialogCheckWrap');
      if (opts.checkbox) { cw.classList.remove('hidden'); $('#dialogCheckLabel').textContent = opts.checkbox.label || ''; $('#dialogCheck').checked = !!opts.checkbox.checked; }
      else cw.classList.add('hidden');
      const ok = $('#dialogOk'), cancel = $('#dialogCancel');
      ok.textContent = opts.okText || 'OK';
      cancel.textContent = opts.cancelText || 'Batal';
      ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      bd.classList.remove('hidden');
      setTimeout(() => { if (opts.input) inp.focus(); else ok.focus(); }, 80);

      function done(res) {
        bd.classList.add('hidden');
        ok.onclick = null; cancel.onclick = null; bd.onclick = null; inp.onkeydown = null;
        document.removeEventListener('keydown', onKey);
        resolve(res);
      }
      function onKey(e) { if (e.key === 'Escape') done({ ok: false }); }
      ok.onclick = () => done({ ok: true, value: opts.input ? inp.value.trim() : undefined, checked: opts.checkbox ? $('#dialogCheck').checked : undefined });
      cancel.onclick = () => done({ ok: false });
      bd.onclick = (e) => { if (e.target === bd) done({ ok: false }); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
      document.addEventListener('keydown', onKey);
    });
  }
  async function confirmDialog(opts) {
    const r = await openDialog({ title: opts.title, message: opts.message, okText: opts.okText || 'OK', cancelText: 'Batal', danger: !!opts.danger });
    return r.ok;
  }

  /* ---------- Theme (gelap/terang) ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('perkap_theme', t); } catch (e) {}
    document.querySelectorAll('.theme-btn').forEach((b) => { b.textContent = t === 'dark' ? '☀️' : '🌙'; });
    const mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', t === 'dark' ? '#0b0f22' : '#f2f4fc');
  }
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  document.querySelectorAll('.theme-btn').forEach((b) => {
    b.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  });
  applyTheme(currentTheme());

  /* ---------- Status helpers ---------- */
  function statusMeta(key) {
    return state.statuses.find((s) => s.key === key) || { key, label: key, isDone: key === 'dikembalikan' };
  }
  function isDoneStatus(it) {
    const meta = statusMeta(it.status);
    if (meta && meta.isDone === true) return true;
    const k = String(it.status || '').toLowerCase();
    const lab = String((meta && meta.label) || '').toLowerCase();
    return k === 'dikembalikan' || k === 'kembali' || k.includes('kembali') || lab.includes('kembali');
  }
  async function loadStatuses() {
    try {
      const r = await api('/api/statuses');
      if (r.statuses && r.statuses.length) {
        const snap = JSON.stringify(r.statuses);
        if (snap !== lastStatusSnapshot) {
          lastStatusSnapshot = snap;
          state.statuses = r.statuses;
          renderTabs();
          saveCache();
        }
      }
    } catch (e) { /* tetap pakai default */ }
  }
  function renderTabs() {
    const wrap = $('#statusTabs');
    if (!wrap) return;
    const list = state.statuses.map((s) => ({ key: s.key, label: s.label }));
    for (const it of state.items) {
      if (!list.some((k) => k.key === it.status)) list.push({ key: it.status, label: statusMeta(it.status).label });
    }
    const counts = { all: state.items.length };
    for (const k of list) counts[k.key] = 0;
    for (const it of state.items) counts[it.status] = (counts[it.status] || 0) + 1;
    if (state.filter !== 'all' && !list.some((k) => k.key === state.filter)) state.filter = 'all';
    let html = `<button class="tab-chip ${state.filter === 'all' ? 'active' : ''}" data-key="all" type="button">Semua <span class="cnt">${counts.all}</span></button>`;
    for (const k of list) {
      html += `<button class="tab-chip ${state.filter === k.key ? 'active' : ''}" data-key="${esc(k.key)}" type="button">${esc(k.label)} <span class="cnt">${counts[k.key] || 0}</span></button>`;
    }
    wrap.innerHTML = html;
  }
  function renderPeminjamOptions() {
    const sel = $('#peminjamSelect');
    if (!sel) return;
    const set = new Set();
    for (const it of state.items) {
      const meta = statusMeta(it.status);
      const isPinjam = it.status === 'dipinjam' || String(meta.label || '').toLowerCase().includes('pinjam');
      const ket = (it.keterangan || '').trim();
      if (isPinjam && ket) set.add(ket);
    }
    const vals = [...set].sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
    const cur = state.peminjam;
    const html = '<option value="all">Semua peminjam</option>' +
      vals.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
    sel.innerHTML = html;
    if (cur !== 'all' && !vals.includes(cur)) { sel.value = 'all'; state.peminjam = 'all'; }
  }
  function fillStatusSelect(selectedKey) {
    const sel = $('#statusInput');
    if (!sel) return;
    const list = state.statuses.slice();
    if (selectedKey && !list.some((s) => s.key === selectedKey)) {
      list.push({ key: selectedKey, label: selectedKey, isDone: false });
    }
    sel.innerHTML = list.map((s) =>
      `<option value="${s.key}" ${s.key === selectedKey ? 'selected' : ''}>${esc(s.label)}</option>`
    ).join('');
  }
  async function onAddStatus() {
    const res = await openDialog({
      title: 'Tambah Status',
      message: 'Nama status baru. Centang bila berarti selesai (barang tercoret).',
      input: { placeholder: 'mis. Rusak / Hilang / Cadangan' },
      checkbox: { label: 'Selesai (barang tercoret)', checked: false },
      okText: 'Simpan',
    });
    if (!res.ok) return;
    const label = (res.value || '').trim();
    if (!label) { toast('Nama status wajib diisi', true); return; }
    showOverlay('Menyimpan status…');
    try {
      const r = await api('/api/statuses', { method: 'POST', body: JSON.stringify({ label, isDone: res.checked }) });
      await loadStatuses();
      fillStatusSelect(r.status.key);
      toast('Status "' + r.status.label + '" ditambahkan');
    } catch (err) { toast(err.message, true); }
    finally { hideOverlay(); }
  }

  /* ---------- Auth screen ---------- */
  function showAuth() { $('#authScreen').classList.remove('hidden'); $('#appScreen').classList.add('hidden'); }
  function showApp() { $('#authScreen').classList.add('hidden'); $('#appScreen').classList.remove('hidden'); }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    $('#loginError').textContent = '';
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setBtnLoading(submitBtn, true, 'Masuk…');
    try {
      const r = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ nama: fd.get('nama') }),
      });
      await onLoggedIn(r.token, r.user);
      if (r.created) toast('Nama baru dibuat. Selamat datang, ' + r.user.username + '!');
      else toast('Selamat datang kembali, ' + r.user.username + '!');
    } catch (err) { $('#loginError').textContent = err.message; }
    finally { setBtnLoading(submitBtn, false); }
  });

  async function onLoggedIn(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem(TOKEN_KEY, token);
    try { localStorage.setItem(CACHE_USER, JSON.stringify(user)); } catch (e) {}
    applyIdentity();
    showApp();
    showOverlay('Memuat data…');
    try {
      await loadStatuses();
      await loadItems();
    } finally {
      hideOverlay();
    }
    startPolling();
  }

  function logoutLocal() {
    state.token = null;
    state.user = null;
    state.items = [];
    state.statuses = DEFAULT_STATUSES.slice();
    lastSnapshot = null;
    localStorage.removeItem(TOKEN_KEY);
    try { localStorage.removeItem(CACHE_USER); saveQueue([]); } catch (e) {}
    stopPolling();
    showAuth();
  }

  $('#logoutBtn') && $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    logoutLocal();
    toast('Anda telah keluar');
  });

  /* ---------- Jam realtime ---------- */
  function startClock() {
    const el = $('#clock');
    if (!el) return;
    const tick = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      el.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    };
    tick();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
  }

  /* ---------- Profil: avatar & nama tampilan ---------- */
  function avatarKey() { return 'perkap_avatar_' + (state.user ? state.user.id : 'x'); }
  function nameKey() { return 'perkap_dispname_' + (state.user ? state.user.id : 'x'); }
  function applyIdentity() {
    if (!state.user) return;
    const storedName = localStorage.getItem(nameKey());
    state.displayName = (storedName && storedName.trim()) || state.user.username;
    const avatar = localStorage.getItem(avatarKey());
    const who = $('#whoami'); if (who) who.textContent = state.displayName;
    [['#avatarImg', '#avatarIcon'], ['#profileAvatarImg', '#profileAvatarIcon']].forEach(([imgSel, iconSel]) => {
      const img = $(imgSel), icon = $(iconSel);
      if (!img) return;
      if (avatar) { img.src = avatar; img.classList.remove('hidden'); if (icon) icon.classList.add('hidden'); }
      else { img.classList.add('hidden'); img.removeAttribute('src'); if (icon) icon.classList.remove('hidden'); }
    });
    const lbl = $('#profileNameLabel'); if (lbl) lbl.textContent = state.displayName;
    const inp = $('#profileNameInput'); if (inp) inp.value = state.displayName;
  }
  function openProfile() { $('#profileError').textContent = ''; applyIdentity(); const vt = $('#voiceConfirmToggle'); if (vt) vt.checked = localStorage.getItem('perkap_voice_confirm') === '1'; const dp = $('#dataPanel'); if (dp) dp.classList.add('hidden'); const dc = $('#dataChev'); if (dc) dc.textContent = '▸'; $('#profileBackdrop').classList.remove('hidden'); }
  function closeProfile() { $('#profileBackdrop').classList.add('hidden'); }
  $('#profileBtn').addEventListener('click', openProfile);
  $('#profileClose').addEventListener('click', closeProfile);
  $('#profileBackdrop').addEventListener('click', (e) => { if (e.target.id === 'profileBackdrop') closeProfile(); });
  $('#profileAvatarBtn').addEventListener('click', () => $('#avatarFile').click());
  $('#avatarFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        let w = img.width, h = img.height;
        const s = Math.min(1, max / Math.max(w, h));
        w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let dataUrl = '';
        try { dataUrl = canvas.toDataURL('image/jpeg', 0.85); } catch (err) { dataUrl = String(reader.result || ''); }
        try { localStorage.setItem(avatarKey(), dataUrl); } catch (err) { $('#profileError').textContent = 'Foto terlalu besar, coba gambar lain.'; return; }
        applyIdentity();
        toast('Foto profil diperbarui');
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(f);
  });
  $('#profileSave').addEventListener('click', () => {
    const val = ($('#profileNameInput').value || '').trim();
    if (val.length < 2) { $('#profileError').textContent = 'Nama minimal 2 karakter'; return; }
    try { localStorage.setItem(nameKey(), val.slice(0, 30)); } catch (e) {}
    applyIdentity(); closeProfile(); toast('Profil disimpan');
  });
  $('#profileLogout').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    closeProfile(); logoutLocal(); toast('Anda telah keluar');
  });
  const vct = $('#voiceConfirmToggle');
  if (vct) vct.addEventListener('change', (e) => {
    try { localStorage.setItem('perkap_voice_confirm', e.target.checked ? '1' : '0'); } catch (x) {}
    toast(e.target.checked ? 'Mode konfirmasi suara: AKTIF' : 'Mode auto-simpan suara');
  });
  const dataToggleEl = $('#dataToggle');
  if (dataToggleEl) dataToggleEl.addEventListener('click', () => {
    const p = $('#dataPanel'); const c = $('#dataChev');
    if (!p) return;
    p.classList.toggle('hidden');
    if (c) c.textContent = p.classList.contains('hidden') ? '▸' : '▾';
  });

  /* ---------- Kelola Status (hapus) ---------- */
  function openStatusManage() { renderStatusList(); $('#statusBackdrop').classList.remove('hidden'); }
  function closeStatusManage() { $('#statusBackdrop').classList.add('hidden'); }
  function renderStatusList() {
    const list = $('#statusList'); if (!list) return;
    const total = state.statuses.length;
    list.innerHTML = state.statuses.map((s) => `
      <div class="status-item">
        <span class="dot" style="background:${statusDotColor(s.key)}"></span>
        <span class="nm">${esc(s.label)}</span>
        ${s.isDone ? '<span class="tag">SELESAI</span>' : ''}
        <button type="button" class="delst" data-del="${esc(s.key)}" ${(total <= 1 || !s.id) ? 'disabled' : ''} title="Hapus status">🗑</button>
      </div>`).join('');
  }
  const smb = $('#statusManageBtn');
  if (smb) smb.addEventListener('click', openStatusManage);
  const scl = $('#statusClose');
  if (scl) scl.addEventListener('click', closeStatusManage);
  const sbd = $('#statusBackdrop');
  if (sbd) sbd.addEventListener('click', (e) => { if (e.target.id === 'statusBackdrop') closeStatusManage(); });
  const slist = $('#statusList');
  if (slist) slist.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn || btn.disabled) return;
    const key = btn.dataset.del;
    const st = state.statuses.find((s) => s.key === key);
    if (!st) return;
    if (!st.id) { toast('Status belum termuat, coba lagi', true); return; }
    const ok = await confirmDialog({ title: 'Hapus Status', message: 'Hapus status "' + st.label + '"? Barang yang memakai status ini akan dipindah ke status lain.', okText: 'Hapus', danger: true });
    if (!ok) return;
    showOverlay('Menghapus status…');
    try {
      await api('/api/statuses?id=' + encodeURIComponent(st.id), { method: 'DELETE' });
      await loadStatuses();
      renderStatusList();
      await loadItems();
      toast('Status dihapus');
    } catch (err) { toast(err.message || 'Gagal menghapus status', true); }
    finally { hideOverlay(); }
  });

  /* ---------- Fitur "All": export & hapus semua ---------- */
  function downloadFile(name, content, mime) {
    try {
      const blob = new Blob([content], { type: mime || 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
    } catch (e) { toast('Gagal membuat file.', true); }
  }
  const ejb = $('#exportJsonBtn');
  if (ejb) ejb.addEventListener('click', () => {
    if (!state.items.length) { toast('Belum ada data', true); return; }
    const data = { exportedAt: new Date().toISOString(), user: state.user ? state.user.username : '', items: state.items };
    downloadFile('perkap-semua-' + Date.now() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('Semua data disimpan (JSON)');
  });
  const ecb = $('#exportCsvBtn');
  if (ecb) ecb.addEventListener('click', () => {
    if (!state.items.length) { toast('Belum ada data', true); return; }
    const rows = [['No', 'Nama', 'Qty', 'Satuan', 'Status', 'Keterangan', 'Diinput oleh']];
    state.items.forEach((it, i) => { rows.push([i + 1, it.nama, it.jumlah, it.satuan || '', statusMeta(it.status).label, it.keterangan || '', it.createdBy || '']); });
    const csv = rows.map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    downloadFile('perkap-semua-' + Date.now() + '.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
    toast('Semua data disimpan (CSV)');
  });
  const dab = $('#deleteAllBtn');
  if (dab) dab.addEventListener('click', async () => {
    if (!state.items.length) { toast('Data sudah kosong'); return; }
    const ok = await confirmDialog({ title: 'Hapus Semua Barang', message: 'Hapus SEMUA barang untuk semua orang? Tindakan ini PERMANEN.', okText: 'Hapus Semua', danger: true });
    if (!ok) return;
    if (!navigator.onLine) { toast('Butuh internet untuk hapus semua di server.', true); return; }
    showOverlay('Menghapus semua…');
    try {
      await flushQueue();
      await api('/api/items', { method: 'DELETE' });
      state.items = [];
      saveQueue([]);
      lastSnapshot = JSON.stringify([]);
      saveCache();
      render();
      closeProfile();
      showResult('Semua barang dihapus', 'Data sudah kosong');
    } catch (e) { toast('Gagal: ' + (e.message || 'error'), true); }
    finally { hideOverlay(); }
  });

  /* ---------- Instalasi PWA (ikon aplikasi di HP) ---------- */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
  window.addEventListener('appinstalled', () => { toast('Aplikasi berhasil dipasang 🎉'); });
  const installBtnEl = $('#installBtn');
  if (installBtnEl) installBtnEl.addEventListener('click', async () => {
    if (deferredInstall) {
      try { deferredInstall.prompt(); await deferredInstall.userChoice; } catch (e) {}
      deferredInstall = null;
      return;
    }
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|ad|od)/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    let msg;
    if (isIOS) msg = 'Di iPhone/iPad (Safari): ketuk tombol Bagikan (kotak dengan panah ke atas) → pilih “Tambah ke Layar Utama” → Tambah.';
    else if (isAndroid) msg = 'Di Chrome Android: ketuk menu ⋮ (kanan atas) → pilih “Instal aplikasi” / “Tambahkan ke Layar Utama”. Setelah itu ikon muncul di menu HP.';
    else msg = 'Di Chrome/Edge desktop: klik ikon “Instal” di address bar, atau menu ⋮ → “Install”.';
    openDialog({ title: 'Cara Install Aplikasi', message: msg, okText: 'Mengerti', cancelText: 'Tutup' });
  });

  /* ---------- Data + polling ---------- */
  async function loadItems() {
    if (!navigator.onLine) { updateOnlineUI(); return; }
    try {
      if (loadQueue().length) await flushQueue();
      if (loadQueue().length) { updateOnlineUI(); return; }
      const r = await api('/api/items');
      const snapshot = JSON.stringify(r.items);
      updateOnlineUI();
      if (hasRecentLocal()) return; // jangan timpa perubahan lokal yang baru (biar tidak balik)
      if (snapshot === lastSnapshot) return;
      const ae = document.activeElement;
      if (ae && ae.tagName === 'SELECT' && ae.closest('.item-list')) {
        state.items = r.items; lastSnapshot = snapshot; saveCache(); return;
      }
      lastSnapshot = snapshot;
      state.items = r.items;
      saveCache();
      render();
    } catch (err) {
      if (err && err.offline) { updateOnlineUI(); return; }
      $('#liveDot').classList.remove('on');
      toast(err.message, true);
    }
  }

  function startPolling() {
    stopPolling();
    $('#liveDot').classList.add('on');
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') { loadItems(); loadStatuses(); }
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    $('#liveDot').classList.remove('on');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.token) loadItems();
  });

  /* ---------- Render ---------- */
  function isMine(it) {
    if (!state.user) return false;
    if (it.createdById != null) return it.createdById === state.user.id;
    return (it.createdBy || '').toLowerCase() === String(state.user.username || '').toLowerCase();
  }

  function computeStats() {
    const s = { total: state.items.length, totalQty: 0, dipakai: 0, dipinjam: 0, dikembalikan: 0 };
    for (const it of state.items) {
      s.totalQty += it.jumlah || 0;
      if (s[it.status] !== undefined) s[it.status] += (it.jumlah || 0);
    }
    return s;
  }

  function renderStats() {
    const s = computeStats();
    const hn = $('#heroName'); if (hn) hn.textContent = state.displayName || (state.user ? state.user.username : '—');
    const hu = $('#heroUnits'); if (hu) hu.textContent = String(s.totalQty);
    const hi = $('#heroItems'); if (hi) hi.textContent = String(s.total);
    const act = (k) => (state.filter === k ? ' active' : '');
    $('#stats').innerHTML = `
      <button type="button" class="stat total${act('all')}" data-key="all"><span class="num">${s.totalQty}</span><span class="lbl">Total Unit</span></button>
      <button type="button" class="stat dipakai${act('dipakai')}" data-key="dipakai"><span class="num">${s.dipakai}</span><span class="lbl">Dipakai</span></button>
      <button type="button" class="stat dipinjam${act('dipinjam')}" data-key="dipinjam"><span class="num">${s.dipinjam}</span><span class="lbl">Dipinjam</span></button>
      <button type="button" class="stat dikembalikan${act('dikembalikan')}" data-key="dikembalikan"><span class="num">${s.dikembalikan}</span><span class="lbl">Kembali</span></button>
    `;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function filteredItems() {
    const q = state.search.trim().toLowerCase();
    const pk = state.peminjam !== 'all' ? state.peminjam.toLowerCase() : '';
    let arr = state.items.filter((it) => {
      if (state.filter !== 'all' && it.status !== state.filter) return false;
      if (pk && !(it.keterangan || '').toLowerCase().includes(pk)) return false;
      if (q) {
        const inNama = (it.nama || '').toLowerCase().includes(q);
        const inKet = (it.keterangan || '').toLowerCase().includes(q);
        if (!inNama && !inKet) return false;
      }
      return true;
    });
    if (state.sort === 'az' || state.sort === 'za') {
      arr = arr.slice().sort((a, b) => {
        const c = String(a.nama || '').localeCompare(String(b.nama || ''), 'id', { sensitivity: 'base' });
        return state.sort === 'az' ? c : -c;
      });
    }
    return arr;
  }

  function itemCardHTML(it) {
    const meta = statusMeta(it.status);
    const done = isDoneStatus(it);
    const mine = isMine(it);
    const optList = state.statuses.slice();
    if (!optList.some((s) => s.key === it.status)) optList.push({ key: it.status, label: meta.label, isDone: false });
    const options = optList.map((s) =>
      `<option value="${s.key}" ${it.status === s.key ? 'selected' : ''}>${esc(s.label)}</option>`
    ).join('');
    const subParts = [];
    if (it.keterangan) subParts.push('📝 ' + esc(it.keterangan));
    if (it.createdBy) subParts.push('oleh ' + esc(it.createdBy) + (mine ? ' (kamu)' : ''));
    if (it._pending) subParts.push('⏳ menunggu sinkron');
    const sub = subParts.join(' · ');
    const sideHtml = mine
      ? `<select class="status-select s-${it.status}" data-action="status">${options}</select>
          <div class="item-btns">
            <button class="mini-btn" data-action="edit" title="Ubah"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
            <button class="mini-btn del" data-action="delete" title="Hapus"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
          </div>`
      : `<span class="status-pill p-${it.status}" title="Hanya bisa dilihat (diinput oleh orang lain)">${esc(meta.label)}</span>`;
    return `
      <article class="item-card st-${it.status} ${done ? 'done' : ''} ${mine ? '' : 'viewonly'}" data-id="${it.id}">
        <div class="item-main">
          <div class="item-line">
            <span class="item-name" title="${esc(it.nama)}">${esc(it.nama)}</span>
            <span class="item-qty"><b>${esc(it.jumlah)}</b> ${esc(it.satuan || 'unit')}</span>
          </div>
          ${sub ? `<div class="item-sub">${sub}</div>` : ''}
        </div>
        <div class="item-side">${sideHtml}</div>
      </article>`;
  }
  function statusDotColor(key) {
    const m = { dipakai: 'var(--dipakai)', dipinjam: 'var(--dipinjam)', dikembalikan: 'var(--dikembalikan)' };
    return m[key] || 'var(--primary)';
  }

  function render() {
    renderTabs();
    renderPeminjamOptions();
    renderStats();
    const list = $('#itemList');
    if (!didInitialRender) { didInitialRender = true; list.classList.add('animate'); setTimeout(() => list.classList.remove('animate'), 500); }
    const items = filteredItems();
    const controls = $('#groupControls');
    const grouped = state.filter === 'all';

    if (!items.length) {
      list.innerHTML = '';
      if (controls) controls.classList.add('hidden');
      $('#emptyState').classList.remove('hidden');
      $('#emptyState').querySelector('p').innerHTML = state.items.length
        ? 'Tidak ada barang yang cocok dengan pencarian/filter.'
        : 'Belum ada barang. Tekan tombol <b>+</b> untuk menambah.';
      return;
    }
    $('#emptyState').classList.add('hidden');
    if (controls) controls.classList.toggle('hidden', !grouped);

    if (!grouped) {
      list.innerHTML = items.map(itemCardHTML).join('');
      return;
    }

    // Tab "Semua": kelompokkan per status (bisa dibuka/ditutup)
    const order = state.statuses.map((s) => ({ key: s.key, label: s.label }));
    for (const it of items) {
      if (!order.some((k) => k.key === it.status)) order.push({ key: it.status, label: statusMeta(it.status).label });
    }
    let html = '';
    for (const g of order) {
      const grp = items.filter((it) => it.status === g.key);
      if (!grp.length) continue;
      const collapsed = !!state.collapsed[g.key];
      html += `<div class="group">
        <button type="button" class="group-head" data-group="${esc(g.key)}">
          <span class="group-dot" style="background:${statusDotColor(g.key)}"></span>
          <span class="group-label">${esc(g.label)}</span>
          <span class="group-count">${grp.length}</span>
          <span class="group-chev ${collapsed ? 'collapsed' : ''}">▾</span>
        </button>
        <div class="group-body ${collapsed ? 'collapsed' : ''}">${grp.map(itemCardHTML).join('')}</div>
      </div>`;
    }
    list.innerHTML = html;
  }

  /* ---------- Item interactions (event delegation) ---------- */
  $('#itemList').addEventListener('change', async (e) => {
    const sel = e.target.closest('.status-select');
    if (!sel) return;
    const card = sel.closest('.item-card');
    const id = card.dataset.id;
    const status = sel.value;
    try {
      await saveUpdateItem(id, { status });
      toast(isDoneStatus({ status }) ? 'Ditandai selesai ✓' : 'Status diperbarui: ' + statusMeta(status).label);
    } catch (err) { toast(err.message, true); }
  });

  $('#itemList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'status') return;
    const card = btn.closest('.item-card');
    const id = card.dataset.id;
    const item = state.items.find((x) => x.id === id);
    if (!item) return;

    if (action === 'edit') openModal(item);
    if (action === 'delete') {
      const okDel = await confirmDialog({
        title: 'Hapus Barang',
        message: `Hapus "${item.nama}"? Tindakan ini tidak bisa dibatalkan.`,
        okText: 'Hapus',
        danger: true,
      });
      if (!okDel) return;
      showOverlay('Menghapus…');
      try { await deleteItemById(id); toast('Barang dihapus'); }
      catch (err) { toast(err.message, true); }
      finally { hideOverlay(); }
    }
  });

  /* ---------- Tabs status & search ---------- */
  $('#statusTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab-chip');
    if (!b) return;
    state.filter = b.dataset.key;
    render();
  });
  $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  $('#peminjamSelect').addEventListener('change', (e) => { state.peminjam = e.target.value; render(); });

  /* ---------- Kartu statistik bisa diklik (jump ke tab) ---------- */
  $('#stats').addEventListener('click', (e) => {
    const s = e.target.closest('.stat');
    if (!s) return;
    state.filter = s.dataset.key || 'all';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- Buka/tutup grup status ---------- */
  $('#itemList').addEventListener('click', (e) => {
    const head = e.target.closest('.group-head');
    if (!head) return;
    const key = head.dataset.group;
    state.collapsed[key] = !state.collapsed[key];
    const grp = head.closest('.group');
    const body = grp && grp.querySelector('.group-body');
    const chev = head.querySelector('.group-chev');
    if (body) body.classList.toggle('collapsed', !!state.collapsed[key]);
    if (chev) chev.classList.toggle('collapsed', !!state.collapsed[key]);
  });
  $('#expandAllBtn').addEventListener('click', () => { state.collapsed = {}; render(); });
  $('#collapseAllBtn').addEventListener('click', () => {
    for (const s of state.statuses) state.collapsed[s.key] = true;
    for (const it of state.items) state.collapsed[it.status] = true;
    render();
  });

  /* ---------- Detail popup saat kartu diketuk ---------- */
  function fmtDate(ms) {
    try { return new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return '-'; }
  }
  function closeDetail() { const b = $('#detailBackdrop'); if (b) b.classList.add('hidden'); }
  function openDetail(it) {
    const meta = statusMeta(it.status);
    const done = isDoneStatus(it);
    const mine = isMine(it);
    const rows = [];
    if (it.keterangan) rows.push(`<div class="detail-row"><span class="k">Keterangan</span><span class="v">${esc(it.keterangan)}</span></div>`);
    rows.push(`<div class="detail-row"><span class="k">Diinput oleh</span><span class="v">${esc(it.createdBy || '-')}${mine ? ' (kamu)' : ''}</span></div>`);
    if (it.createdAt) rows.push(`<div class="detail-row"><span class="k">Dibuat</span><span class="v">${fmtDate(it.createdAt)}</span></div>`);
    if (it.updatedAt) rows.push(`<div class="detail-row"><span class="k">Diperbarui</span><span class="v">${fmtDate(it.updatedAt)}</span></div>`);
    $('#detailBody').innerHTML = `
      <div class="detail-head"><span class="status-pill p-${it.status}">${esc(meta.label)}</span></div>
      <h3 class="detail-title ${done ? 'done-name' : ''}">${esc(it.nama)}</h3>
      <div class="detail-qty"><b>${esc(it.jumlah)}</b> ${esc(it.satuan || 'unit')}</div>
      <div class="detail-rows">${rows.join('')}</div>
      ${mine
        ? `<div class="detail-actions"><button type="button" class="btn btn-ghost" id="detailEdit">✏️ Ubah</button><button type="button" class="btn btn-danger" id="detailDelete">🗑 Hapus</button></div>`
        : `<div class="detail-note">Barang ini diinput orang lain — hanya bisa dilihat.</div>`}
    `;
    $('#detailBackdrop').classList.remove('hidden');
    const ed = $('#detailEdit');
    if (ed) ed.onclick = () => { closeDetail(); openModal(it); };
    const dl = $('#detailDelete');
    if (dl) dl.onclick = async () => {
      const ok = await confirmDialog({ title: 'Hapus Barang', message: `Hapus "${it.nama}"? Tindakan ini tidak bisa dibatalkan.`, okText: 'Hapus', danger: true });
      if (!ok) return;
      closeDetail();
      showOverlay('Menghapus…');
      try { await deleteItemById(it.id); toast('Barang dihapus'); }
      catch (err) { toast(err.message, true); }
      finally { hideOverlay(); }
    };
  }
  $('#detailClose').addEventListener('click', closeDetail);
  $('#detailBackdrop').addEventListener('click', (e) => { if (e.target.id === 'detailBackdrop') closeDetail(); });
  $('#itemList').addEventListener('click', (e) => {
    const card = e.target.closest('.item-card');
    if (!card) return;
    if (e.target.closest('[data-action]') || e.target.closest('.status-select')) return;
    const item = state.items.find((x) => x.id === card.dataset.id);
    if (item) openDetail(item);
  });
  let searchTimer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { state.search = v; render(); }, 120);
  });

  /* ---------- Modal ---------- */
  function openModal(item) {
    $('#modalTitle').textContent = item ? 'Ubah Barang' : 'Tambah Barang';
    $('#itemId').value = item ? item.id : '';
    $('#namaInput').value = item ? item.nama : '';
    $('#jumlahInput').value = item ? item.jumlah : 1;
    $('#satuanInput').value = item ? (item.satuan || '') : '';
    fillStatusSelect(item ? item.status : (state.statuses[0] || {}).key || 'dipakai');
    $('#keteranganInput').value = item ? (item.keterangan || '') : '';
    $('#itemError').textContent = '';
    $('#modalBackdrop').classList.remove('hidden');
    setTimeout(() => $('#namaInput').focus(), 120);
  }
  function closeModal() { $('#modalBackdrop').classList.add('hidden'); }

  $('#addBtn').addEventListener('click', () => openModal(null));
  $('#modalClose').addEventListener('click', closeModal);
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });

  $('#itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#itemId').value;
    const payload = {
      nama: $('#namaInput').value.trim(),
      jumlah: parseInt($('#jumlahInput').value, 10),
      satuan: $('#satuanInput').value.trim(),
      status: $('#statusInput').value,
      keterangan: $('#keteranganInput').value.trim(),
    };
    $('#itemError').textContent = '';
    if (!payload.nama) { $('#itemError').textContent = 'Nama barang wajib diisi'; return; }
    if (!Number.isFinite(payload.jumlah) || payload.jumlah < 0) { $('#itemError').textContent = 'Jumlah harus angka 0 atau lebih'; return; }
    const saveBtn = $('#saveBtn');
    setBtnLoading(saveBtn, true, 'Menyimpan…');
    try {
      if (id) {
        await saveUpdateItem(id, payload);
        toast('Barang diperbarui');
      } else {
        await saveNewItem(payload);
        toast('Barang ditambahkan');
      }
      closeModal();
      loadItems();
    } catch (err) { $('#itemError').textContent = err.message; }
    finally { setBtnLoading(saveBtn, false); }
  });

  /* ---------- Impor (tempel banyak baris) ---------- */
  function openImport() {
    $('#importText').value = '';
    $('#importError').textContent = '';
    $('#importBackdrop').classList.remove('hidden');
    setTimeout(() => $('#importText').focus(), 100);
  }
  function closeImport() { $('#importBackdrop').classList.add('hidden'); }
  $('#importBtn').addEventListener('click', openImport);
  $('#importClose').addEventListener('click', closeImport);
  $('#importCancel').addEventListener('click', closeImport);
  $('#importBackdrop').addEventListener('click', (e) => { if (e.target.id === 'importBackdrop') closeImport(); });

  function parseImport(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      let delim = '\t';
      if (line.includes('\t')) delim = '\t';
      else if (line.includes('|')) delim = '|';
      else if (line.includes(';')) delim = ';';
      else delim = ',';
      let parts = line.split(delim).map((s) => s.trim());
      if (parts.length >= 6 && /^\d+$/.test(parts[0])) parts = parts.slice(1); // buang kolom "No"
      const nama = parts[0] || '';
      if (!nama || /^(no\.?|nama|jenis|nama barang)$/i.test(nama)) continue;
      const jumlah = parseInt(parts[1], 10);
      const satuan = parts[2] || '';
      const statusRaw = (parts[3] || '').toLowerCase();
      const keterangan = parts.slice(4).join(' ').trim();
      let status = 'dipakai';
      if (statusRaw.includes('kembali')) status = 'dikembalikan';
      else if (statusRaw.includes('pinjam')) status = 'dipinjam';
      else if (statusRaw.includes('pakai') || statusRaw.includes('beli') || statusRaw === '') status = 'dipakai';
      else status = statusRaw.slice(0, 30);
      rows.push({ nama, jumlah: Number.isFinite(jumlah) ? jumlah : 0, satuan, status, keterangan });
    }
    return rows;
  }

  async function runImport() {
    const rows = parseImport($('#importText').value);
    if (!rows.length) { $('#importError').textContent = 'Tidak ada data yang bisa diimpor.'; return; }
    $('#importError').textContent = '';
    const btn = $('#importSave');
    setBtnLoading(btn, true, 'Mengimpor…');
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < rows.length; i++) {
        showOverlay('Mengimpor ' + (i + 1) + '/' + rows.length + '…');
        try { await saveNewItem(rows[i]); ok++; }
        catch (e) { fail++; }
      }
    } finally {
      hideOverlay();
      setBtnLoading(btn, false);
    }
    closeImport();
    await loadItems();
    toast(ok + ' barang diimpor' + (fail ? (' • ' + fail + ' gagal') : ''));
  }
  $('#importSave').addEventListener('click', runImport);

  /* ---------- Tambah tombol "kelola status" di form ---------- */
  (function initAddStatusBtn() {
    const sel = $('#statusInput');
    if (!sel || $('#addStatusBtn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'addStatusBtn';
    btn.textContent = '＋ Tambah status';
    btn.style.cssText = 'margin-top:7px;background:none;border:0;color:var(--primary);font-size:12.5px;font-weight:700;padding:2px 0;cursor:pointer;text-align:left;';
    sel.parentNode.appendChild(btn);
    btn.addEventListener('click', onAddStatus);
  })();

  /* ---------- Input suara (tambah barang via mikrofon) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, voiceActive = false, voiceCancelled = false;
  function showVoiceOverlay(txt) { const b = $('#voiceBackdrop'); if (b) { $('#voiceText').textContent = txt || 'Mendengarkan…'; b.classList.remove('hidden'); } }
  function hideVoiceOverlay() { const b = $('#voiceBackdrop'); if (b) b.classList.add('hidden'); }
  function stopVoice() { voiceActive = false; voiceCancelled = true; const v = $('#voiceBtn'); if (v) v.classList.remove('listening'); if (recognition) { try { recognition.stop(); } catch (e) {} } }
  function startVoice() {
    if (!SR) { toast('Input suara tidak didukung browser ini. Pakai Chrome/Edge di HP.', true); return; }
    if (voiceActive) { stopVoice(); hideVoiceOverlay(); return; }
    recognition = new SR();
    recognition.lang = 'id-ID';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3;
    let finalAlts = [];
    let lastShown = '';
    let silenceTimer = null, maxTimer = null, gotSpeech = false;
    voiceCancelled = false;
    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          for (let a = 0; a < res.length; a++) { if (res[a] && res[a].transcript) finalAlts.push(res[a].transcript); }
        } else interim += res[0].transcript;
      }
      const shown = (finalAlts.length ? finalAlts[0] : interim).trim();
      lastShown = shown;
      showVoiceOverlay(shown ? ('“' + shown + '”') : 'Mendengarkan…');
      // Deteksi diam: setelah ada suara, jika hening ~1,1 dtk -> berhenti & proses
      if (shown) {
        gotSpeech = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => { try { recognition.stop(); } catch (err) {} }, 1100);
      }
    };
    recognition.onerror = (e) => {
      voiceActive = false; const v = $('#voiceBtn'); if (v) v.classList.remove('listening'); hideVoiceOverlay();
      if (silenceTimer) clearTimeout(silenceTimer); if (maxTimer) clearTimeout(maxTimer);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Izin mikrofon ditolak. Aktifkan izin mic di browser.', true);
      else if (e.error === 'no-speech') showResult('Tidak terdengar', 'Coba bicara lebih dekat/keras.', true);
      else toast('Gagal mendengar (' + e.error + ').', true);
    };
    recognition.onend = () => {
      voiceActive = false; const v = $('#voiceBtn'); if (v) v.classList.remove('listening'); hideVoiceOverlay();
      if (silenceTimer) clearTimeout(silenceTimer); if (maxTimer) clearTimeout(maxTimer);
      if (voiceCancelled) { voiceCancelled = false; return; }
      const alts = finalAlts.length ? finalAlts : (lastShown ? [lastShown] : []);
      if (alts.length) chooseVoiceAndProcess(alts);
      else showResult('Tidak terdengar', 'Coba bicara lebih dekat/keras.', true);
    };
    voiceActive = true; const vb = $('#voiceBtn'); if (vb) vb.classList.add('listening'); showVoiceOverlay('Mendengarkan…');
    try {
      recognition.start();
      maxTimer = setTimeout(() => { try { recognition.stop(); } catch (e) {} }, 9000);
    } catch (e) { voiceActive = false; if (vb) vb.classList.remove('listening'); hideVoiceOverlay(); toast('Tidak bisa mulai mikrofon.', true); }
  }
  function parseIndoNumber(str) {
    str = String(str).trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    const base = { nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11 };
    const teens = { 'dua belas': 12, 'tiga belas': 13, 'empat belas': 14, 'lima belas': 15, 'enam belas': 16, 'tujuh belas': 17, 'delapan belas': 18, 'sembilan belas': 19 };
    const joined = str.split(/\s+/).join(' ');
    if (base[joined] !== undefined) return base[joined];
    if (teens[joined] !== undefined) return teens[joined];
    let total = 0;
    const w = str.split(/\s+/);
    for (let i = 0; i < w.length; i++) {
      const word = w[i];
      if (word === 'seratus') { total += 100; continue; }
      if (base[word] !== undefined) {
        const next = w[i + 1];
        if (next === 'puluh') { total += base[word] * 10; i++; }
        else if (next === 'ratus') { total += base[word] * 100; i++; }
        else if (next === 'belas') { total += base[word] + 10; i++; }
        else total += base[word];
      }
    }
    return total || null;
  }
  function extractKeterangan(raw) {
    let text = ' ' + String(raw).toLowerCase() + ' ';
    text = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = text.split(' ').filter(Boolean);
    const statusWords = new Set(['pinjam','dipinjam','meminjam','pinjaman','pakai','dipakai','memakai','pemakaian','kembali','dikembalikan','beli','dibeli','pembelian']);
    const unitSet = new Set(['pcs','pc','pack','set','unit','buah','batang','box','dus','lusin','rim','kodi','meter','kg','gram','liter','lembar','pasang','biji']);
    const fillerSet = new Set(['tambah','tambahkan','tambahin','data','barang','input','masukkan','masukan','catat','catatkan','daftar','daftarkan','tolong','mohon','bisa','bantu','coba','ya','yang','untuk','dengan','dan','ada','sebanyak','sejumlah','sedang','sudah','telah','di','ke','dari','buat','sebuah','seorang']);
    const numWords = new Set(['nol','satu','dua','tiga','empat','lima','enam','tujuh','delapan','sembilan','sepuluh','sebelas','puluh','ratus','belas']);
    const triggers = [['atas','nama'],['a','n'],['an'],['oleh'],['dengan','keterangan'],['keterangan'],['dengan','nama'],['nama','peminjam'],['peminjam'],['nama']];
    for (let i = 0; i < tokens.length; i++) {
      for (const trig of triggers) {
        let ok = true;
        for (let k = 0; k < trig.length; k++) { if (tokens[i + k] !== trig[k]) { ok = false; break; } }
        if (!ok) continue;
        const start = i;
        let j = i + trig.length;
        const captured = [];
        while (j < tokens.length) {
          const w = tokens[j];
          if (/^\d+$/.test(w)) break;
          if (statusWords.has(w) || unitSet.has(w) || fillerSet.has(w) || numWords.has(w)) break;
          if (!/^[a-z]+$/.test(w)) break;
          captured.push(w); j++;
        }
        if (captured.length) {
          const ket = captured.join(' ').toUpperCase();
          const keep = tokens.slice(0, start).concat(tokens.slice(j));
          return { text: keep.join(' '), keterangan: ket };
        }
      }
    }
    return { text: tokens.join(' '), keterangan: '' };
  }
  function parseVoice(raw) {
    const ex = extractKeterangan(raw);
    const keterangan = ex.keterangan;
    let text = ' ' + String(ex.text).toLowerCase() + ' ';
    text = text.replace(/[^a-z0-9\s]/g, ' ');
    const tokens = text.split(/\s+/).filter(Boolean);
    const joined = ' ' + tokens.join(' ') + ' ';
    let status = 'dipakai';
    if (joined.includes('kembali')) status = 'dikembalikan';
    else if (joined.includes('pinjam')) status = 'dipinjam';
    else if (joined.includes('pakai') || joined.includes('beli')) status = 'dipakai';
    const fillers = new Set(['tambah','tambahkan','tambahin','data','barang','input','masukkan','masukan','catat','catatkan','daftar','daftarkan','tolong','mohon','bisa','bantu','coba','ya','yang','untuk','dengan','dan','ada','sebanyak','sejumlah','sedang','sudah','telah','di','ke','dari','buat','sebuah','seorang','kira','kirakira']);
    const statusWords = new Set(['pinjam','dipinjam','meminjam','pinjaman','pakai','dipakai','memakai','pemakaian','kembali','dikembalikan','beli','dibeli','pembelian']);
    const unitSet = new Set(['pcs','pc','pack','set','unit','buah','batang','box','dus','lusin','rim','kodi','meter','kg','gram','liter','lembar','pasang','biji']);
    const usedIdx = new Set();
    let jumlah = null;
    for (let i = 0; i < tokens.length; i++) { if (/^\d+$/.test(tokens[i])) { jumlah = parseInt(tokens[i], 10); usedIdx.add(i); break; } }
    if (jumlah === null) {
      const startSet = new Set(['nol','satu','dua','tiga','empat','lima','enam','tujuh','delapan','sembilan','sepuluh','sebelas','seratus']);
      for (let i = 0; i < tokens.length; i++) {
        if (startSet.has(tokens[i])) {
          let j = i; const seq = [];
          while (j < tokens.length && (startSet.has(tokens[j]) || tokens[j] === 'puluh' || tokens[j] === 'ratus' || tokens[j] === 'belas')) {
            seq.push(tokens[j]); j++; if (seq.length >= 4) break;
          }
          const val = parseIndoNumber(seq.join(' '));
          if (val) { jumlah = val; for (let k = i; k < j; k++) usedIdx.add(k); break; }
        }
      }
    }
    let satuan = '';
    for (let i = 0; i < tokens.length; i++) {
      if (!usedIdx.has(i) && unitSet.has(tokens[i])) { satuan = (tokens[i] === 'pc' ? 'pcs' : tokens[i]); usedIdx.add(i); break; }
    }
    const nameTokens = [];
    for (let i = 0; i < tokens.length; i++) {
      if (usedIdx.has(i)) continue;
      const w = tokens[i];
      if (fillers.has(w) || statusWords.has(w)) continue;
      nameTokens.push(w);
    }
    const nama = nameTokens.join(' ').trim().toUpperCase();
    return { nama, jumlah: (jumlah == null ? 1 : jumlah), satuan: (satuan || 'pcs'), status, keterangan: keterangan };
  }
  let resultTimer = null;
  function showResult(title, sub, isErr) {
    const el = $('#resultPop'); if (!el) return;
    const ic = $('#resultIc'); if (ic) ic.textContent = isErr ? '⚠️' : '✅';
    $('#resultTitle').textContent = title;
    $('#resultSub').textContent = sub || '';
    el.classList.toggle('err', !!isErr);
    el.classList.remove('hidden');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.classList.add('hidden'), 250); }, 2000);
  }
  function scoreParsed(p) { let s = 0; if (p.nama) s += 2; if (p.jumlah > 1) s += 1; if (p.status !== 'dipakai') s += 1; if (p.keterangan) s += 1; return s; }
  function chooseVoiceAndProcess(alts) {
    let best = null, bestScore = -1;
    for (const t of alts) { const p = parseVoice(t); const sc = scoreParsed(p); if (sc > bestScore) { bestScore = sc; best = p; } }
    if (!best || !best.nama) { showResult('Suara kurang jelas', 'Coba lagi: “dipinjam 4 meja atas nama LEO”', true); return; }
    processVoiceItem(best);
  }
  async function processVoiceItem(p) {
    const detail = p.nama + ' • ' + p.jumlah + ' ' + p.satuan + ' • ' + statusMeta(p.status).label + (p.keterangan ? (' • ' + p.keterangan) : '');
    if (localStorage.getItem('perkap_voice_confirm') === '1') {
      openModal(null);
      $('#namaInput').value = p.nama;
      $('#jumlahInput').value = p.jumlah;
      $('#satuanInput').value = p.satuan;
      fillStatusSelect(p.status);
      $('#keteranganInput').value = p.keterangan || '';
      toast('Mode konfirmasi — cek lalu Simpan');
      return;
    }
    try {
      await saveNewItem({ nama: p.nama, jumlah: p.jumlah, satuan: p.satuan, status: p.status, keterangan: p.keterangan || '' });
      showResult('Data tersimpan', detail);
    } catch (e) {
      showResult('Gagal menyimpan', 'Coba lagi.', true);
    }
  }
  $('#voiceBtn').addEventListener('click', startVoice);
  $('#voiceCancel').addEventListener('click', () => { stopVoice(); hideVoiceOverlay(); });
  $('#voiceBackdrop').addEventListener('click', (e) => { if (e.target.id === 'voiceBackdrop') { stopVoice(); hideVoiceOverlay(); } });

  // bottom navigation
  const navHomeEl = $('#navHome'), navAddEl = $('#navAdd'), navVoiceEl = $('#navVoice'), navProfileEl = $('#navProfile');
  if (navHomeEl) navHomeEl.addEventListener('click', () => { state.filter = 'all'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  if (navAddEl) navAddEl.addEventListener('click', () => openModal(null));
  if (navVoiceEl) navVoiceEl.addEventListener('click', () => startVoice());
  if (navProfileEl) navProfileEl.addEventListener('click', () => openProfile());

  /* ---------- Boot ---------- */
  async function boot() {
    updateOnlineUI();
    if (!state.token) { showAuth(); return; }
    loadCacheIntoState();
    if (state.user) { applyIdentity(); showApp(); renderTabs(); render(); }
    if (!navigator.onLine) {
      if (state.user) { startPolling(); updateOnlineUI(); } else { showAuth(); }
      return;
    }
    try {
      const r = await api('/api/me');
      state.user = r.user;
      try { localStorage.setItem(CACHE_USER, JSON.stringify(r.user)); } catch (e) {}
      applyIdentity();
      showApp();
      showOverlay('Memuat data…');
      try {
        await loadStatuses();
        await loadItems();
      } finally {
        hideOverlay();
      }
      startPolling();
    } catch (e) {
      if (e && e.offline) {
        if (state.user) { applyIdentity(); showApp(); renderTabs(); render(); startPolling(); updateOnlineUI(); }
        else { showAuth(); }
      } else {
        showAuth();
      }
    }
  }

  /* ---------- Auto UPPERCASE untuk semua input teks ---------- */
  const UPPER_SELECTORS = '#namaInput, #satuanInput, #keteranganInput, #dialogInput, #profileNameInput, #importText, #loginForm input[name="nama"]';
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || !el.matches || !el.matches(UPPER_SELECTORS)) return;
    const s = el.selectionStart, en = el.selectionEnd;
    const up = el.value.toUpperCase();
    if (up !== el.value) {
      el.value = up;
      try { el.setSelectionRange(s, en); } catch (x) {}
    }
  });

  window.addEventListener('online', () => {
    updateOnlineUI();
    toast('Online kembali — menyinkronkan…');
    flushQueue().then(() => loadItems());
  });
  window.addEventListener('offline', () => {
    updateOnlineUI();
    toast('Mode offline — data tersimpan di HP');
  });

  boot();
  startClock();
  (function () {
    let done = false;
    function hideSplash() {
      if (done) return; done = true;
      const sp = document.getElementById('splash');
      if (!sp) return;
      sp.classList.add('hide');
      setTimeout(() => { if (sp) sp.remove(); }, 500);
    }
    window.addEventListener('load', () => setTimeout(hideSplash, 700));
    setTimeout(hideSplash, 3000);
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
