(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    clients: [],
    prestations: [],
    upcoming: [],
    past: [],
    allBookings: [],
    compta: null,
    activePanel: 'home',
    bsModal: null,
  };

  // Messages spéciaux qui tournent chaque jour
  const specialMessages = [
    "💜 Message spécial 💜 Shana, tu es née pour prendre soin d’eux 🐾 Ton attention et ta douceur font toute la différence. ShaSitter brille grâce à toi ✨",
    "Chaque jour avec les animaux est une petite aventure remplie d’amour 💜 Tu es leur héroïne quotidienne !",
    "Ta patience et ton sourire illuminent leurs journées 🌟 Continue de répandre cette magie !",
    "Les petites pattes qui t’attendent chaque matin… c’est toi qui rends ça possible 🐱🐶 Merci 💕",
    "Tu ne fais pas que garder des animaux, tu crées des souvenirs et du bonheur 🐾✨",
    "Shana, ton énergie positive est contagieuse… même les chats ronronnent plus fort grâce à toi 😺",
    "Chaque câlin, chaque promenade, chaque gamelle : tu mets du cœur partout 💜",
    "Le monde a besoin de personnes comme toi : douces, attentives et passionnées 🐕‍🦺❤️",
    "ShaSitter c’est plus qu’un service, c’est une histoire d’amour pour les animaux grâce à toi 🌈",
    "Tu es leur refuge, leur joie, leur confidente… et ça, c’est immense 🐾✨"
  ];

  const money = n => (Math.round((Number(n || 0)) * 100) / 100).toFixed(2);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  const slotLabel = s => {
    if (s === 'matin') return '🌅 Matin';
    if (s === 'soir') return '🌙 Soir';
    if (s === 'matin_soir') return '🌅🌙 Matin+soir';
    return s || '—';
  };

  const capitalize = str => str ? str.charAt(0).toUpperCase() + str.slice(1) : '';

  const formatDateLabel = (dateStr, isPast = false) => {
    const d = new Date(dateStr);
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((d - today) / 86400000);
    if (!isPast) {
      if (diff === 1) return 'Demain';
      if (diff === 2) return 'Après-demain';
      if (diff > 2 && diff <= 7) return `Dans ${diff} jours`;
    } else {
      if (diff === 0) return 'Aujourd’hui';
      if (diff === -1) return 'Hier';
    }
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  const getAnimalEmoji = t => {
    t = t.toLowerCase();
    if (t.includes('chat')) return '🐱';
    if (t.includes('chien')) return '🐶';
    if (t.includes('lapin')) return '🐰';
    return '🐾';
  };

  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  function toast(msg, duration = 2800) {
    const el = $('#toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.style.display = 'none', duration);
  }

  function setPanel(name) {
    state.activePanel = name;
    $$('.panel').forEach(p => p.classList.remove('active'));
    $('#panel' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.add('active');

    $$('.bn-item').forEach(b => b.classList.remove('active'));
    $('#btn' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.add('active');

    const renders = {
      home: renderHome,
      clients: renderClients,
      prestations: renderPrestations,
      bookings: renderBookingsPanel,
      compta: renderCompta
    };
    renders[name]?.();
  }

  const createResCard = (b, isPast = false) => {
    const client = b.clients?.name || '—';
    const pet = b.pets?.name || '';
    const emoji = getAnimalEmoji(b.prestations?.animal_type || pet || '');
    const presta = b.prestations?.name || '—';
    const slot = slotLabel(b.slot);
    const range = b.start_date === b.end_date ? b.start_date : `${b.start_date} → ${b.end_date}`;

    const card = document.createElement('div');
    card.className = `res-card ${isPast ? 'res-past' : ''}`;
    card.dataset.bookingId = b.id;
    card.innerHTML = `
      <div class="res-icon">${emoji}</div>
      <div class="res-main">
        <div class="res-client">${client}</div>
        <div class="res-subtitle">${presta} · ${slot}</div>
        ${pet ? `<div class="res-subtitle small">${pet}</div>` : ''}
        <div class="res-slot-badge">${range}</div>
      </div>
    `;
    return card;
  };

  function renderGroupedReservations(containerId, bookings, isPast = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!bookings?.length) {
      container.innerHTML = `<div class="text-center text-muted py-5">Aucune réservation</div>`;
      return;
    }

    const groups = {};
    bookings.forEach(b => {
      const key = b.start_date || '0000-00-00';
      groups[key] = groups[key] || [];
      groups[key].push(b);
    });

    const sortedDates = Object.keys(groups).sort();
    let index = 0;

    for (const dateKey of sortedDates) {
      const group = groups[dateKey];
      const label = formatDateLabel(dateKey, isPast);

      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = capitalize(label);
      container.appendChild(header);

      const groupContainer = document.createElement('div');
      groupContainer.className = 'reservation-day-group';
      if (index >= 3) groupContainer.classList.add('collapsed');
      container.appendChild(groupContainer);

      group.forEach(b => groupContainer.appendChild(createResCard(b, isPast)));

      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        groupContainer.classList.toggle('collapsed');
      });

      index++;
    }
  }

  function renderHome() {
    const up = state.upcoming || [];

    $('#kpiUpcomingCount').textContent = up.length;

    const next = up[0];
    $('#kpiNextBooking').textContent = next
      ? `${next.start_date} · ${next.clients?.name || ''} · ${next.prestations?.name || ''}`
      : '—';

    if (state.compta) {
      const ta = state.compta.totalAll ?? state.compta.total ?? 0;
      const te = state.compta.totalEmp ?? 0;
      const tc = state.compta.totalCo ?? 0;
      $('#kpiTotalAll').textContent = money(ta);
      $('#kpiTotalEmployees').textContent = money(te);
      $('#kpiTotalCompany').textContent = money(tc);
    }

    // Message spécial du jour
    const today = new Date();
    const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    const message = specialMessages[dayOfYear % specialMessages.length];
    $('.pokedex-header .message-special')?.textContent = message;

    renderGroupedReservations('upcomingList', up);
  }

  function renderClients() {
    const container = $('#clientsList');
    if (!container) return;

    const q = ($('#clientsSearch')?.value || '').trim().toLowerCase();
    const filtered = state.clients.filter(c => !q || c.name?.toLowerCase().includes(q));

    container.innerHTML = filtered.map(c => `
      <div class="card card-soft mb-3 client-card" data-client-id="${c.id}" style="cursor:pointer;">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <h5 class="mb-1">${c.name} <small class="text-muted">#${c.id}</small></h5>
              ${c.phone ? `<div class="small muted">📞 ${c.phone}</div>` : ''}
              ${c.address ? `<div class="small muted">📍 ${c.address}</div>` : ''}
            </div>
            <div class="text-warning fw-bold">→</div>
          </div>
        </div>
      </div>
    `).join('') || `<div class="text-center text-muted py-5">Aucun client trouvé</div>`;
  }

  function renderPrestations() {
    const q = ($('#prestaSearch')?.value || '').trim().toLowerCase();
    const animal = $('#prestaAnimalFilter')?.value || 'all';

    const list = state.prestations.filter(p => {
      if (p.active === false) return false;
      if (animal !== 'all' && p.animal_type !== animal) return false;
      if (q && !p.name?.toLowerCase().includes(q)) return false;
      return true;
    });

    const grid = $('#prestationsGrid');
    grid.innerHTML = list.map(p => {
      const ico = p.category === 'pack' ? '📦' : '🧾';
      const more = [p.category, p.animal_type, p.visits_per_day ? `${p.visits_per_day} visite/j` : null]
        .filter(Boolean).join(' · ');

      return `
        <div class="card card-soft mb-4">
          <div class="card-body">
            <div class="d-flex justify-content-between gap-3 align-items-center">
              <div class="fw-bold fs-5">${ico} ${p.name}</div>
              <div class="fw-bold text-warning">${money(p.price_chf)} CHF</div>
            </div>
            <div class="small text-secondary mt-2">${more || '—'}</div>
            ${p.description ? `<div class="small text-secondary mt-3">${p.description}</div>` : ''}
          </div>
        </div>
      `;
    }).join('') || `<div class="text-center text-muted py-5">Aucune prestation trouvée</div>`;
  }

  function renderBookingsPanel() {
    const filtered = getBookingsFiltered();
    const t = todayISO();
    const upcoming = filtered.filter(b => (b.end_date || b.start_date || '9999') >= t);
    const past = filtered.filter(b => (b.end_date || b.start_date || '0000') < t);

    renderGroupedReservations('bookingsUpcoming', upcoming);
    renderGroupedReservations('bookingsPast', past, true);
  }

  function renderCompta() {
    const c = state.compta || {};
    const container = $('#panelCompta .card-body');
    if (!container) {
      $('#panelCompta').innerHTML = '<div class="card card-soft"><div class="card-body text-center text-muted py-5">Chargement des données...</div></div>';
      return;
    }

    container.innerHTML = `
      <h4 class="mb-4">💰 Comptabilité</h4>
      <div class="row g-3">
        <div class="col-6 col-md-4">
          <div class="mini text-center">
            <div class="small muted">Total facturé</div>
            <div class="fs-4 fw-bold">${money(c.totalAll || c.total || 0)} CHF</div>
          </div>
        </div>
        <div class="col-6 col-md-4">
          <div class="mini text-center">
            <div class="small muted">Part employés</div>
            <div class="fs-4 fw-bold text-danger">${money(c.totalEmp || 0)} CHF</div>
          </div>
        </div>
        <div class="col-6 col-md-4">
          <div class="mini text-center">
            <div class="small muted">Part ShaSitter</div>
            <div class="fs-4 fw-bold text-warning">${money(c.totalCo || 0)} CHF</div>
          </div>
        </div>
      </div>
      <div class="text-muted small mt-4 text-center">Plus de statistiques bientôt disponibles ✨</div>
    `;
  }

  // === Fonctions manquantes que tu avais avant (minimales) ===
  function getBookingsFiltered() {
    const clientId = $('#bookingsClientFilter')?.value;
    const from = $('#bookingsFrom')?.value;
    const to = $('#bookingsTo')?.value;

    let list = [...state.allBookings];
    if (clientId) list = list.filter(b => String(b.client_id) === clientId);
    if (from) list = list.filter(b => (b.end_date || b.start_date) >= from);
    if (to) list = list.filter(b => (b.start_date) <= to);
    return list;
  }

  function renderClientDetail(id) { /* à compléter si besoin */ }
  async function openEditBooking(id) { /* ton code */ }
  async function saveEditBooking() { /* ton code */ }
  async function deleteBooking() { /* ton code */ }

  function wireEvents() {
    ['Home','Clients','Prestations','Bookings','Compta'].forEach(n => {
      $(`#btn${n}`)?.addEventListener('click', () => setPanel(n.toLowerCase()));
    });

    $('#clientsSearch')?.addEventListener('input', renderClients);
    $('#prestaSearch')?.addEventListener('input', renderPrestations);
    $('#prestaAnimalFilter')?.addEventListener('change', renderPrestations);

    $('#bookingsClientFilter, #bookingsFrom, #bookingsTo')?.forEach(el => el.addEventListener('change', renderBookingsPanel));
    $('#bookingsReset')?.addEventListener('click', () => {
      $('#bookingsClientFilter').value = '';
      $('#bookingsFrom').value = '';
      $('#bookingsTo').value = '';
      renderBookingsPanel();
    });

    $('#bookingsExportAll')?.addEventListener('click', () => {
      const list = getBookingsFiltered();
      if (list.length) {
        download('shasitter-reservations.ics', buildICS(list));
        toast('Fichier .ics généré');
      } else toast('Rien à exporter');
    });

    $('#refreshBtn')?.addEventListener('click', loadAll);
    $('#themeBtn')?.addEventListener('click', () => document.body.classList.toggle('bg-dark'));
    $('#closeBtn')?.addEventListener('click', () => window.Telegram?.WebApp?.close?.());

    document.body.addEventListener('click', e => {
      const clientCard = e.target.closest('.client-card');
      if (clientCard) renderClientDetail(clientCard.dataset.clientId);

      const booking = e.target.closest('[data-booking-id]');
      if (booking) openEditBooking(Number(booking.dataset.bookingId));
    });
  }

  async function loadAll() {
    try {
      const [c, p, u, pa, co] = await Promise.all([
        fetchJSON('/api/clients'),
        fetchJSON('/api/prestations'),
        fetchJSON('/api/bookings/upcoming'),
        fetchJSON('/api/bookings/past'),
        fetchJSON('/api/compta/summary')
      ]);

      state.clients = c || [];
      state.prestations = p || [];
      state.upcoming = u || [];
      state.past = pa || [];
      state.allBookings = [...u, ...pa];
      state.compta = co || null;

      renderHome();
      if (state.activePanel !== 'home') setPanel(state.activePanel);
    } catch (e) {
      toast('Erreur chargement');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();