(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    clients: [],
    prestations: [],
    upcoming: [],
    past: [],
    compta: null,
    activePanel: 'home',
    bsModal: null,
  };

  // ==================== MESSAGES SPÉCIAUX (change chaque jour) ====================
  const specialMessages = [
    "Shana, tu es née pour prendre soin d’eux 🐾 Ton attention et ta douceur font toute la différence. ShaSitter brille grâce à toi ✨",
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

  const money = (n) => (Math.round((Number(n || 0)) * 100) / 100).toFixed(2);
  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const slotLabel = (s) => (s === 'matin' ? '🌅 Matin' : s === 'soir' ? '🌙 Soir' : '🌅🌙 Matin+soir');

  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${txt ? ` — ${txt}` : ''}`);
    }
    return res.json();
  }

  function toast(msg) {
    const el = $('#toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.style.display = 'none'), 2200);
  }

  function setPanel(name) {
    state.activePanel = name;

    $$('.panel').forEach((p) => p.classList.remove('active'));
    const panel = $('#panel' + name[0].toUpperCase() + name.slice(1));
    if (panel) panel.classList.add('active');

    $$('.bn-item').forEach((b) => b.classList.remove('active'));
    const btn = $('#btn' + name[0].toUpperCase() + name.slice(1));
    if (btn) btn.classList.add('active');

    if (name === 'home') renderHome();
    if (name === 'clients') renderClients();
    if (name === 'prestations') renderPrestations();
    if (name === 'bookings') renderBookingsPanel();
    if (name === 'compta') renderCompta();
  }

  // ==================== RENDER HOME - SEULEMENT À VENIR + ACCORDION ====================
  function renderHome() {
    const up = state.upcoming || [];

    $('#kpiUpcomingCount').textContent = up.length;
    $('#kpiNextBooking').textContent = up[0] 
      ? `${up[0].start_date} · ${up[0].clients?.name || ''} · ${up[0].prestations?.name || ''}`
      : '—';

    if (state.compta) {
      $('#kpiTotalAll').textContent = money(state.compta.totalAll ?? state.compta.total ?? 0);
      $('#kpiTotalCompany').textContent = money(state.compta.totalCo ?? state.compta.totalCompany ?? 0);
      $('#kpiTotalEmployees').textContent = money(state.compta.totalEmp ?? state.compta.totalEmployees ?? 0);
    }

    // Message spécial qui change chaque jour
    const dayIndex = new Date().getDate() % specialMessages.length;
    $('.message-special').textContent = specialMessages[dayIndex];

    const container = $('#upcomingList');
    container.innerHTML = '';

    if (!up.length) {
      container.innerHTML = '<div class="text-center text-muted py-4">Aucune réservation à venir</div>';
      return;
    }

    // Grouper par date
    const groups = {};
    up.forEach(b => {
      const key = b.start_date || '0000-00-00';
      groups[key] = groups[key] || [];
      groups[key].push(b);
    });

    const sortedDates = Object.keys(groups).sort();

    sortedDates.forEach((dateKey, index) => {
      const group = groups[dateKey];

      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = dateKey; // Tu peux améliorer le label si tu veux
      container.appendChild(header);

      const groupDiv = document.createElement('div');
      groupDiv.className = 'reservation-day-group';
      if (index >= 3) groupDiv.classList.add('collapsed'); // Les 3 premiers ouverts
      container.appendChild(groupDiv);

      group.forEach(b => {
        const card = document.createElement('div');
        card.className = 'res-card';
        card.innerHTML = `
          <div class="res-icon">${getAnimalEmoji(b)}</div>
          <div class="res-main">
            <div class="res-client">${b.clients?.name || '—'}</div>
            <div class="res-subtitle">${b.prestations?.name || '—'} • ${slotLabel(b.slot)}</div>
            ${b.pets?.name ? `<div class="res-subtitle small">${b.pets.name}</div>` : ''}
            <div class="small muted">${b.start_date} → ${b.end_date || b.start_date}</div>
          </div>
        `;
        groupDiv.appendChild(card);
      });

      // Accordion
      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        groupDiv.classList.toggle('collapsed');
      });
    });
  }

  function getAnimalEmoji(b) {
    const type = (b.prestations?.animal_type || b.pets?.name || '').toLowerCase();
    if (type.includes('chat')) return '🐱';
    if (type.includes('chien')) return '🐶';
    if (type.includes('lapin')) return '🐰';
    return '🐾';
  }

  // ==================== TES FONCTIONS ORIGINALES (inchangées) ====================
  function renderClients() {
    const q = ($('#clientsSearch')?.value || '').trim().toLowerCase();
    const list = (state.clients || [])
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q))
      .slice(0, 200);

    const wrap = $('#clientsList');
    if (!wrap) return;

    wrap.innerHTML = list
      .map((c) => `
        <div class="list-group mb-2">
          <div class="list-group-item text-white">
            <div class="fw-bold">👤 ${c.name} <span class="text-secondary">#${c.id}</span></div>
            <div class="small text-secondary">${c.phone ? '📞 ' + c.phone : '📞 —'} · ${c.address ? '📍 ' + c.address : '📍 —'}</div>
          </div>
        </div>
      `)
      .join('') || `<div class="text-secondary">Aucun client.</div>`;
  }

  function renderPrestations() {
    const q = ($('#prestaSearch')?.value || '').trim().toLowerCase();
    const animal = ($('#prestaAnimalFilter')?.value || 'all').trim();

    const list = (state.prestations || []).filter((p) => {
      if (p.active === false) return false;
      if (animal !== 'all' && p.animal_type !== animal) return false;
      if (q && !(p.name || '').toLowerCase().includes(q)) return false;
      return true;
    });

    const grid = $('#prestationsGrid');
    if (!grid) return;

    grid.innerHTML = list.map((p) => {
      const ico = p.category === 'pack' ? '📦' : '🧾';
      const more = [p.category, p.animal_type, p.visits_per_day ? `${p.visits_per_day} visite/j` : null]
        .filter(Boolean).join(' · ');

      return `
        <div class="card card-soft mb-2">
          <div class="card-body">
            <div class="d-flex justify-content-between gap-3">
              <div class="fw-bold">${ico} ${p.name}</div>
              <div class="fw-bold">${money(p.price_chf)} CHF</div>
            </div>
            <div class="small text-secondary mt-1">${more || '—'}</div>
            ${p.description ? `<div class="small text-secondary mt-2">${p.description}</div>` : ''}
          </div>
        </div>
      `;
    }).join('') || `<div class="text-secondary">Aucune prestation.</div>`;
  }

  function getBookingsFiltered() {
    const clientId = ($('#bookingsClientFilter')?.value || '').trim();
    const from = ($('#bookingsFrom')?.value || '').trim();
    const to = ($('#bookingsTo')?.value || '').trim();

    let all = [...(state.upcoming || []), ...(state.past || [])];
    all.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '') || (a.id - b.id));

    if (clientId) all = all.filter((b) => String(b.client_id) === String(clientId));
    if (from) all = all.filter((b) => (b.end_date || '') >= from);
    if (to) all = all.filter((b) => (b.start_date || '') <= to);

    return all;
  }

  function renderBookingsPanel() {
    const list = getBookingsFiltered();
    const t = todayISO();

    const up = list.filter((b) => (b.end_date || '') >= t);
    const past = list.filter((b) => (b.end_date || '') < t);

    const upEl = $('#bookingsUpcoming');
    const pastEl = $('#bookingsPast');

    if (upEl) upEl.innerHTML = up.map(bookingItem).join('') || `<div class="text-secondary small py-2">Rien à venir.</div>`;
    if (pastEl) pastEl.innerHTML = past.map(bookingItem).join('') || `<div class="text-secondary small py-2">Rien en historique.</div>`;
  }

  function renderCompta() {
    const c = state.compta;
    if (!c) return;

    const totalAll = c.totalAll ?? c.total_all ?? c.total ?? 0;
    const totalEmp = c.totalEmp ?? c.totalEmployees ?? c.total_employee ?? 0;
    const totalCo = c.totalCo ?? c.totalCompany ?? c.total_company ?? 0;

    const elTotal = $('#comptaTotal');
    const elEmp = $('#comptaEmp');
    const elCo = $('#comptaCo');

    if (elTotal) elTotal.textContent = money(totalAll);
    if (elEmp) elEmp.textContent = money(totalEmp);
    if (elCo) elCo.textContent = money(totalCo);

    // ... reste de ta fonction originale ...
  }

  // ==================== TON CODE ORIGINAL POUR LE RESTE ====================
  // (bookingItem, openEditBooking, saveEditBooking, deleteBooking, wireEvents, loadAll, etc.)
  // Colle ici tout le reste de ton fichier original sans rien changer

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();