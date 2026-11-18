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
    search: '',
  };
  let pollTimer = null;
  let lastSnapshot = null;

  /* ---------- API helper ---------- */
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    let data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      if (res.status === 401 && state.token) { logoutLocal(); }
      throw new Error((data && data.error) || 'Terjadi kesalahan');
    }
    return data;
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
    const t = o.querySelector('.loading-text'); if (t) t.textContent = text || 'Memuat…';
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

  /* ---------- Theme (gelap/terang) ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('perkap_theme', t); } catch (e) {}
    document.querySelectorAll('.theme-btn').forEach((b) => { b.textContent = t === 'dark' ? '☀️' : '🌙'; });
    const mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', t === 'dark' ? '#0f1117' : '#4f46e5');
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
  async function loadStatuses() {
    try {
      const r = await api('/api/statuses');
      if (r.statuses && r.statuses.length) state.statuses = r.statuses;
    } catch (e) { /* tetap pakai default */ }
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
    const label = (window.prompt('Nama status baru (mis. Rusak, Hilang, Cadangan):') || '').trim();
    if (!label) return;
    const isDone = window.confirm(
      'Tandai status ini sebagai SELESAI?\n\nOK = saat status ini dipilih, nama barang TERCORET (tanda selesai).\nBatal = status biasa (tidak tercoret).'
    );
    try {
      const r = await api('/api/statuses', { method: 'POST', body: JSON.stringify({ label, isDone }) });
      await loadStatuses();
      fillStatusSelect(r.status.key);
      toast('Status "' + r.status.label + '" ditambahkan');
    } catch (err) { toast(err.message, true); }
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
    $('#whoami').textContent = user.username;
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
    stopPolling();
    showAuth();
  }

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    logoutLocal();
    toast('Anda telah keluar');
  });

  /* ---------- Data + polling ---------- */
  async function loadItems() {
    try {
      const r = await api('/api/items');
      const snapshot = JSON.stringify(r.items);
      $('#liveDot').classList.add('on');
      if (snapshot === lastSnapshot) return; // tidak ada perubahan -> jangan gambar ulang
      const ae = document.activeElement;
      if (ae && ae.tagName === 'SELECT' && ae.closest('.item-list')) {
        state.items = r.items; lastSnapshot = snapshot; return;
      }
      lastSnapshot = snapshot;
      state.items = r.items;
      render();
    } catch (err) {
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
    $('#stats').innerHTML = `
      <div class="stat total"><div class="num">${s.totalQty}</div><div class="lbl">Total Unit</div></div>
      <div class="stat dipakai"><div class="num">${s.dipakai}</div><div class="lbl">Dipakai</div></div>
      <div class="stat dipinjam"><div class="num">${s.dipinjam}</div><div class="lbl">Dipinjam</div></div>
      <div class="stat dikembalikan"><div class="num">${s.dikembalikan}</div><div class="lbl">Kembali</div></div>
    `;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function filteredItems() {
    const q = state.search.trim().toLowerCase();
    return state.items.filter((it) => {
      if (state.filter !== 'all' && it.status !== state.filter) return false;
      if (!q) return true;
      return (it.nama || '').toLowerCase().includes(q) || (it.keterangan || '').toLowerCase().includes(q);
    });
  }

  function render() {
    renderStats();
    const list = $('#itemList');
    const items = filteredItems();

    if (!items.length) {
      list.innerHTML = '';
      $('#emptyState').classList.remove('hidden');
      $('#emptyState').querySelector('p').innerHTML = state.items.length
        ? 'Tidak ada barang yang cocok dengan pencarian/filter.'
        : 'Belum ada barang. Tekan tombol <b>+</b> untuk menambah.';
      return;
    }
    $('#emptyState').classList.add('hidden');

    list.innerHTML = items.map((it) => {
      const meta = statusMeta(it.status);
      const done = !!meta.isDone;
      const mine = isMine(it);
      const optList = state.statuses.slice();
      if (!optList.some((s) => s.key === it.status)) optList.push({ key: it.status, label: meta.label, isDone: false });
      const options = optList.map((s) =>
        `<option value="${s.key}" ${it.status === s.key ? 'selected' : ''}>${esc(s.label)}</option>`
      ).join('');
      const subParts = [];
      if (it.keterangan) subParts.push('📝 ' + esc(it.keterangan));
      if (it.createdBy) subParts.push('oleh ' + esc(it.createdBy) + (mine ? ' (kamu)' : ''));
      const sub = subParts.join(' · ');
      const sideHtml = mine
        ? `<select class="status-select s-${it.status}" data-action="status">${options}</select>
            <div class="item-btns">
              <button class="mini-btn" data-action="edit" title="Ubah">
                <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button class="mini-btn del" data-action="delete" title="Hapus">
                <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>`
        : `<span class="status-pill p-${it.status}" title="Hanya bisa dilihat (diinput oleh orang lain)">${esc(meta.label)}</span>`;
      return `
        <article class="item-card st-${it.status} ${done ? 'done' : ''} ${mine ? '' : 'viewonly'}" data-id="${it.id}">
          <div class="item-main">
            <div class="item-line">
              <span class="item-name" title="${esc(it.nama)}">${esc(it.nama)}</span>
              <span class="item-qty">${esc(it.jumlah)} unit</span>
            </div>
            ${sub ? `<div class="item-sub">${sub}</div>` : ''}
          </div>
          <div class="item-side">${sideHtml}</div>
        </article>`;
    }).join('');
  }

  /* ---------- Item interactions (event delegation) ---------- */
  $('#itemList').addEventListener('change', async (e) => {
    const sel = e.target.closest('.status-select');
    if (!sel) return;
    const card = sel.closest('.item-card');
    const id = card.dataset.id;
    const status = sel.value;
    try {
      await api('/api/items/' + id, { method: 'PUT', body: JSON.stringify({ status }) });
      const it = state.items.find((x) => x.id === id);
      if (it) it.status = status;
      lastSnapshot = JSON.stringify(state.items);
      render();
      const meta = statusMeta(status);
      toast(meta.isDone ? 'Ditandai selesai ✓' : 'Status diperbarui: ' + meta.label);
    } catch (err) { toast(err.message, true); loadItems(); }
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
      if (!confirm(`Hapus "${item.nama}"? Tindakan ini tidak bisa dibatalkan.`)) return;
      showOverlay('Menghapus…');
      try {
        await api('/api/items/' + id, { method: 'DELETE' });
        state.items = state.items.filter((x) => x.id !== id);
        lastSnapshot = JSON.stringify(state.items);
        render();
        toast('Barang dihapus');
      } catch (err) { toast(err.message, true); }
      finally { hideOverlay(); }
    }
  });

  /* ---------- Filters & search ---------- */
  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    document.querySelectorAll('#filters .chip').forEach((c) => c.classList.toggle('active', c === chip));
    render();
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
        await api('/api/items/' + id, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Barang diperbarui');
      } else {
        await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
        toast('Barang ditambahkan');
      }
      closeModal();
      loadItems();
    } catch (err) { $('#itemError').textContent = err.message; }
    finally { setBtnLoading(saveBtn, false); }
  });

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

  /* ---------- Boot ---------- */
  async function boot() {
    if (!state.token) { showAuth(); return; }
    try {
      const r = await api('/api/me');
      state.user = r.user;
      $('#whoami').textContent = r.user.username;
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
      showAuth();
    }
  }
  boot();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
