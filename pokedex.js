(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  const state = {
    clients: [],
    prestations: [],
    upcoming: [],
    past: [],
    compta: null,
    activePanel: 'home',
  };

  const money = n => (Math.round((Number(n || 0)) * 100) / 100).toFixed(2);
  const todayISO = () => new Date().toISOString().slice(0,10);

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

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    return res.json();
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2500);
  }

  function setPanel(name) {
    state.activePanel = name;
    $$('.panel').forEach(p => p.classList.remove('active'));
    $('#panel' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.add('active');

    $$('.bn-item').forEach(b => b.classList.remove('active'));
    $('#btn' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.add('active');

    if (name === 'home') renderHome();
    if (name === 'clients') renderClients();
    if (name === 'prestations') renderPrestations();
    if (name === 'bookings') renderBookings();
    if (name === 'compta') renderCompta();
  }

  function renderHome() {
    const up = state.upcoming || [];

    $('#kpiUpcomingCount').textContent = up.length;
    $('#kpiNextBooking').textContent = up[0] ? `${up[0].start_date} · ${up[0].clients?.name || ''}` : '—';

    if (state.compta) {
      $('#kpiTotalAll').textContent = money(state.compta.totalAll || 0);
      $('#kpiTotalCompany').textContent = money(state.compta.totalCo || 0);
      $('#kpiTotalEmployees').textContent = money(state.compta.totalEmp || 0);
    }

    // Message du jour
    const day = new Date().getDate() % specialMessages.length;
    $('.message-special').textContent = specialMessages[day];

    const container = $('#upcomingList');
    container.innerHTML = '';
    if (!up.length) {
      container.innerHTML = '<div class="text-center text-muted py-4">Aucune réservation à venir</div>';
      return;
    }

    const groups = {};
    up.forEach(b => {
      const d = b.start_date;
      groups[d] = groups[d] || [];
      groups[d].push(b);
    });

    Object.keys(groups).sort().forEach(date => {
      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = date;
      container.appendChild(header);

      const groupDiv = document.createElement('div');
      groupDiv.className = 'reservation-day-group';
      container.appendChild(groupDiv);

      groups[date].forEach(b => {
        const card = document.createElement('div');
        card.className = 'res-card';
        card.innerHTML = `
          <div class="res-icon">${getAnimalEmoji(b)}</div>
          <div class="res-main">
            <div class="res-client">${b.clients?.name || '—'}</div>
            <div class="res-subtitle">${b.prestations?.name || '—'} · ${slotLabel(b.slot)}</div>
            ${b.pets?.name ? `<div class="small">${b.pets.name}</div>` : ''}
          </div>
        `;
        groupDiv.appendChild(card);
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

  function renderClients() {
    const q = $('#clientsSearch')?.value?.toLowerCase() || '';
    const container = $('#clientsList');
    container.innerHTML = state.clients
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .map(c => `<div class="card mb-2 p-3">${c.name} (#${c.id})</div>`)
      .join('') || '<div class="text-center text-muted py-4">Aucun client</div>';
  }

  function renderPrestations() {
    const container = $('#prestationsGrid');
    container.innerHTML = state.prestations.map(p => `
      <div class="col-md-6 col-lg-4">
        <div class="card p-3">
          <strong>${p.name}</strong><br>
          <small>${money(p.price_chf)} CHF · ${p.animal_type || '—'}</small>
        </div>
      </div>
    `).join('') || '<div class="col-12 text-center text-muted py-4">Aucune prestation</div>';
  }

  function renderBookings() {
    // À compléter si besoin (upcoming + past)
    $('#bookingsUpcoming').innerHTML = '<div class="text-muted py-4">Chargement...</div>';
    $('#bookingsPast').innerHTML = '<div class="text-muted py-4">Chargement...</div>';
  }

  function renderCompta() {
    const c = state.compta || {};
    $('#comptaContent').innerHTML = `
      <div class="p-3">
        <div>Total : <strong>${money(c.totalAll || 0)} CHF</strong></div>
        <div>Part ShaSitter : <strong>${money(c.totalCo || 0)} CHF</strong></div>
        <div>Part employés : <strong>${money(c.totalEmp || 0)} CHF</strong></div>
        <small class="text-muted mt-3 d-block">Plus de détails à venir</small>
      </div>
    `;
  }

  async function loadAll() {
    try {
      const [clients, prestations, upcoming, past, compta] = await Promise.all([
        fetchJSON('/api/clients'),
        fetchJSON('/api/prestations'),
        fetchJSON('/api/bookings/upcoming'),
        fetchJSON('/api/bookings/past'),
        fetchJSON('/api/compta/summary'),
      ]);

      state.clients = clients || [];
      state.prestations = prestations || [];
      state.upcoming = upcoming || [];
      state.past = past || [];
      state.compta = compta || null;

      renderHome();
      renderClients();
      renderPrestations();
      renderBookings();
      renderCompta();

      $('#year').textContent = new Date().getFullYear();
    } catch (e) {
      console.error(e);
      toast('Erreur de chargement des données');
    }
  }

  function wireEvents() {
    $('#btnHome')?.addEventListener('click', () => setPanel('home'));
    $('#btnClients')?.addEventListener('click', () => setPanel('clients'));
    $('#btnPrestations')?.addEventListener('click', () => setPanel('prestations'));
    $('#btnBookings')?.addEventListener('click', () => setPanel('bookings'));
    $('#btnCompta')?.addEventListener('click', () => setPanel('compta'));

    $('#clientsSearch')?.addEventListener('input', renderClients);
    $('#prestaSearch')?.addEventListener('input', renderPrestations);
    $('#refreshBtn')?.addEventListener('click', loadAll);
    $('#closeBtn')?.addEventListener('click', () => window.Telegram?.WebApp?.close?.());
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();