(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    clients: [],
    prestations: [],
    upcoming: [],
    past: [],
    allBookings: [],     // ← nouveau : on garde toutes les réservations ici
    compta: null,
    activePanel: 'home',
    bsModal: null,
  };

  const money = (n) => (Math.round((Number(n || 0)) * 100) / 100).toFixed(2);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  const slotLabel = (s) => {
    if (s === 'matin') return '🌅 Matin';
    if (s === 'soir') return '🌙 Soir';
    if (s === 'matin_soir') return '🌅🌙 Matin+soir';
    return s || '—';
  };

  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
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
    const panel = $('#panel' + name.charAt(0).toUpperCase() + name.slice(1));
    if (panel) panel.classList.add('active');

    $$('.bn-item').forEach(b => b.classList.remove('active'));
    const btn = $('#btn' + name.charAt(0).toUpperCase() + name.slice(1));
    if (btn) btn.classList.add('active');

    if (name === 'home') renderHome();
    if (name === 'clients') renderClients();
    if (name === 'prestations') renderPrestations();
    if (name === 'bookings') renderBookingsPanel();
    if (name === 'compta') renderCompta();
  }

  // ──── AFFICHAGE GROUPÉ PAR JOUR ──── avec accordion
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
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });

    const sortedDates = Object.keys(groups).sort();

    let index = 0;
    for (const dateKey of sortedDates) {
      const group = groups[dateKey];

      let label = dateKey;
      const d = new Date(dateKey);
      const today = new Date(); today.setHours(0,0,0,0);
      const diffDays = Math.round((d - today) / 864e5);

      if (!isPast) {
        if (diffDays === 1) label = 'Demain';
        else if (diffDays === 2) label = 'Après-demain';
        else if (diffDays > 2 && diffDays <= 7) label = `Dans ${diffDays} jours`;
        else label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      } else {
        if (diffDays === 0) label = 'Aujourd’hui';
        else if (diffDays === -1) label = 'Hier';
        else label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      }

      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      container.appendChild(header);

      const groupContainer = document.createElement('div');
      groupContainer.className = 'reservation-day-group';
      if (index >= 3) groupContainer.classList.add('collapsed'); // replié après les 3 premiers
      container.appendChild(groupContainer);

      group.forEach(b => {
        const client = b.clients?.name || '—';
        const pet = b.pets?.name || '';
        const emoji = getAnimalEmoji(b.prestations?.animal_type || pet || '');
        const presta = b.prestations?.name || '—';
        const slot = slotLabel(b.slot);
        const range = b.start_date === b.end_date ? b.start_date : `${b.start_date} → ${b.end_date}`;
        const price = money(b.total_chf ?? b.total_override ?? 0);

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
          <div class="res-price">${price} CHF</div>
        `;
        groupContainer.appendChild(card);
      });

      // toggle accordion
      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        groupContainer.classList.toggle('collapsed');
      });

      index++;
    }
  }

  function getAnimalEmoji(t = '') {
    t = t.toLowerCase();
    if (t.includes('chat')) return '🐱';
    if (t.includes('chien')) return '🐶';
    if (t.includes('lapin')) return '🐰';
    return '🐾';
  }

  function renderHome() {
    const up = state.upcoming || [];
    const past = state.past || [];

    $('#kpiUpcomingCount').textContent = up.length;
    $('#kpiPastCount').textContent = past.length;

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

    renderGroupedReservations('upcomingList', up);
    renderGroupedReservations('pastList', past, true);
  }

  // ──── CLIENTS ────
  function renderClients() {
    const container = $('#clientsList');
    if (!container) return;

    const q = ($('#clientsSearch')?.value || '').trim().toLowerCase();
    const filtered = state.clients.filter(c =>
      !q || c.name?.toLowerCase().includes(q)
    );

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

  async function renderClientDetail(clientId) {
    const panel = $('#clientDetailPanel');
    if (!panel) return;

    const client = state.clients.find(c => c.id == clientId);
    if (!client) return toast("Client introuvable");

    $('#clientDetailName').textContent = client.name;

    // Récupérer TOUTES les réservations du client (on filtre depuis allBookings)
    const clientBookings = state.allBookings.filter(b => b.client_id == clientId);

    // Stats globales
    const totalCHF = clientBookings.reduce((sum, b) => sum + (Number(b.total_chf) || 0), 0);

    // Répartition par prestation
    const byPresta = {};
    clientBookings.forEach(b => {
      const pName = b.prestations?.name || 'Inconnu';
      if (!byPresta[pName]) byPresta[pName] = { count: 0, total: 0 };
      byPresta[pName].count++;
      byPresta[pName].total += Number(b.total_chf) || 0;
    });

    let statsHtml = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div class="fs-5 fw-bold">Total payé</div>
        <div class="fs-4 text-warning">${money(totalCHF)} CHF</div>
      </div>
      <hr class="border-warning opacity-50 my-3">
      <div class="small fw-bold mb-2">Répartition par prestation :</div>
    `;

    Object.entries(byPresta)
      .sort((a,b) => b[1].total - a[1].total)
      .forEach(([name, data]) => {
        statsHtml += `
          <div class="d-flex justify-content-between py-1">
            <div>${name}</div>
            <div><strong>${data.count} ×</strong>  ${money(data.total)} CHF</div>
          </div>
        `;
      });

    $('#clientStats').innerHTML = statsHtml || '<div class="text-muted">Aucune prestation enregistrée</div>';

    // Liste des réservations
    renderGroupedReservations('clientResaList', clientBookings);

    panel.style.display = 'block';
  }

  function closeClientDetail() {
    $('#clientDetailPanel').style.display = 'none';
  }

  function renderBookingsPanel() {
    const list = getBookingsFiltered();
    const t = todayISO();

    const upcoming = list.filter(b => (b.end_date || b.start_date || '9999') >= t);
    const past = list.filter(b => (b.end_date || b.start_date || '0000') < t);

    renderGroupedReservations('bookingsUpcoming', upcoming);
    renderGroupedReservations('bookingsPast', past, true);
  }

  // ──── Export ICS (inchangé mais rappel) ────
  function buildICS(bookings) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ShaSitter//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    bookings.forEach(b => {
      const uid = `shasitter-${b.id}-${Date.now()}`;
      const start = (b.start_date || '').replace(/-/g,'') + 'T080000Z';
      const end   = (b.end_date   || b.start_date || '').replace(/-/g,'') + 'T200000Z';
      const summary = `${b.clients?.name || '?'} — ${b.prestations?.name || '?'} (${slotLabel(b.slot)})`;
      const desc = `Client: ${b.clients?.name||''}\\nAnimal: ${b.pets?.name||''}\\nMontant: ${money(b.total_chf||0)} CHF`;

      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').split('.')[0]}Z`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${desc}`,
        'END:VEVENT'
      );
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function download(filename, content, mime = 'text/calendar;charset=utf-8') {
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ──── Événements ────
  function wireEvents() {
    // ... (navigation, recherche, export, modal, theme, close) restent identiques ...

    // Nouveaux événements
    document.getElementById('closeClientDetail')?.addEventListener('click', closeClientDetail);

    // Clic sur un client → détail
    document.body.addEventListener('click', e => {
      const card = e.target.closest('.client-card');
      if (card) {
        const id = card.dataset.clientId;
        if (id) renderClientDetail(id);
      }

      // Les clics sur résa (édition) déjà présents
      const bookingEl = e.target.closest('[data-booking-id]');
      if (bookingEl) {
        const id = Number(bookingEl.dataset.bookingId);
        if (id) openEditBooking(id).catch(err => toast(err.message));
      }
    });
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

      state.clients      = clients || [];
      state.prestations  = prestations || [];
      state.upcoming     = upcoming || [];
      state.past         = past || [];
      state.allBookings  = [...(upcoming||[]), ...(past||[])];
      state.compta       = compta || null;

      // remplissage filtres (comme avant)

      const clientSel = $('#bookingsClientFilter');
      if (clientSel) {
        clientSel.innerHTML = `<option value="">Tous les clients</option>` +
          state.clients.map(c => `<option value="${c.id}">${c.name} (#${c.id})</option>`).join('');
      }

      const prestaSel = $('#ebPrestation');
      if (prestaSel) {
        prestaSel.innerHTML = `<option value="">—</option>` +
          state.prestations.filter(p => p.active !== false)
            .map(p => `<option value="${p.id}">${p.name} (#${p.id})</option>`).join('');
      }

      renderHome();
      if (state.activePanel === 'clients') renderClients();
      if (state.activePanel === 'prestations') renderPrestations();
      if (state.activePanel === 'bookings') renderBookingsPanel();
      if (state.activePanel === 'compta') renderCompta();

      $('#year').textContent = new Date().getFullYear();
    } catch (err) {
      console.error(err);
      toast('Erreur chargement données');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();