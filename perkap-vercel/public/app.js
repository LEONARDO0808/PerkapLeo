/* ================= Perkap App (versi Vercel) ================= */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const TOKEN_KEY = 'perkap_token';
  const POLL_MS = 4000;

  const STATUS_LABEL = {
    dipakai: 'Sedang Dipakai',
    dipinjam: 'Dipinjam',
    dikembalikan: 'Sudah Dikembalikan',
  };
  const STATUS_SHORT = {
    dipakai: 'Dipakai',
    dipinjam: 'Dipinjam',
    dikembalikan: 'Dikembalikan',
  };

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    user: null,
    items: [],
    filter: 'all',
    search: '',
  };
  let pollTimer = null;

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

  /* ---------- Auth screen ---------- */
  function showAuth() { $('#authScreen').classList.remove('hidden'); $('#appScreen').classList.add('hidden'); }
  function showApp() { $('#authScreen').classList.add('hidden'); $('#appScreen').classList.remove('hidden'); }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    $('#loginError').textContent = '';
    try {
      const r = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ nama: fd.get('nama') }),
      });
      onLoggedIn(r.token, r.user);
      if (r.created) toast('Nama baru dibuat. Selamat datang, ' + r.user.username + '!');
      else toast('Selamat datang kembali, ' + r.user.username + '!');
    } catch (err) { $('#loginError').textContent = err.message; }
  });

  function onLoggedIn(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem(TOKEN_KEY, token);
    $('#whoami').textContent = user.username;
    showApp();
    loadItems();
    startPolling();
  }

  function logoutLocal() {
    state.token = null;
    state.user = null;
    state.items = [];
    localStorage.removeItem(TOKEN_KEY);
    stopPolling();
    showAuth();
  }

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    logoutLocal();
    toast('Anda telah keluar');
  });

  /* ---------- Data + polling (pengganti SSE di serverless) ---------- */
  async function loadItems() {
    try {
      const r = await api('/api/items');
      state.items = r.items;
      render();
      $('#liveDot').classList.add('on');
    } catch (err) {
      $('#liveDot').classList.remove('on');
      toast(err.message, true);
    }
  }

  function startPolling() {
    stopPolling();
    $('#liveDot').classList.add('on');
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') loadItems();
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
      const done = it.status === 'dikembalikan';
      const mine = isMine(it);
      const options = Object.keys(STATUS_SHORT).map((v) =>
        `<option value="${v}" ${it.status === v ? 'selected' : ''}>${STATUS_SHORT[v]}</option>`
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
        : `<span class="status-pill p-${it.status}" title="Hanya bisa dilihat (diinput oleh orang lain)">${STATUS_SHORT[it.status]}</span>`;
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
      render();
      toast(status === 'dikembalikan' ? 'Ditandai sudah dikembalikan ✓' : 'Status diperbarui: ' + STATUS_LABEL[status]);
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
      try {
        await api('/api/items/' + id, { method: 'DELETE' });
        state.items = state.items.filter((x) => x.id !== id);
        render();
        toast('Barang dihapus');
      } catch (err) { toast(err.message, true); }
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
    $('#statusInput').value = item ? item.status : 'dipakai';
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
  });

  /* ---------- Boot ---------- */
  async function boot() {
    if (!state.token) { showAuth(); return; }
    try {
      const r = await api('/api/me');
      state.user = r.user;
      $('#whoami').textContent = r.user.username;
      showApp();
      loadItems();
      startPolling();
    } catch (e) {
      showAuth();
    }
  }
  boot();

  // daftarkan service worker (PWA install di HTTPS Vercel)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
