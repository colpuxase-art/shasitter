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

  // Carte réservation réutilisable
  const createResCard = (b, isPast = false) => {
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

  async function renderClientDetail(clientId) {
    const panel = $('#clientDetailPanel');
    if (!panel) return;

    const client = state.clients.find(c => c.id == clientId);
    if (!client) return toast("Client introuvable");

    $('#clientDetailName').textContent = client.name;

    const bookings = state.allBookings.filter(b => b.client_id == clientId);
    const totalCHF = bookings.reduce((sum, b) => sum + (Number(b.total_chf) || 0), 0);

    const byPresta = {};
    bookings.forEach(b => {
      const name = b.prestations?.name || 'Inconnu';
      byPresta[name] = byPresta[name] || { count: 0, total: 0 };
      byPresta[name].count++;
      byPresta[name].total += Number(b.total_chf) || 0;
    });

    let html = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div class="fs-5 fw-bold">Total payé</div>
        <div class="fs-4 text-warning">${money(totalCHF)} CHF</div>
      </div>
      <hr class="border-warning opacity-50 my-3">
      <div class="small fw-bold mb-2">Par prestation :</div>
    `;

    Object.entries(byPresta)
      .sort(([,a], [,b]) => b.total - a.total)
      .forEach(([name, {count, total}]) => {
        html += `<div class="d-flex justify-content-between py-1"><div>${name}</div><div><strong>${count}×</strong> ${money(total)} CHF</div></div>`;
      });

    $('#clientStats').innerHTML = html || '<div class="text-muted">Aucune prestation</div>';

    renderGroupedReservations('clientResaList', bookings);
    panel.style.display = 'block';
  }

  function closeClientDetail() {
    $('#clientDetailPanel').style.display = 'none';
  }

  function getUpcomingAndPast(bookings) {
    const t = todayISO();
    return {
      upcoming: bookings.filter(b => (b.end_date || b.start_date || '9999-99-99') >= t),
      past: bookings.filter(b => (b.end_date || b.start_date || '0000-00-00') < t)
    };
  }

  function renderBookingsPanel() {
    const filtered = getBookingsFiltered();
    const { upcoming, past } = getUpcomingAndPast(filtered);
    renderGroupedReservations('bookingsUpcoming', upcoming);
    renderGroupedReservations('bookingsPast', past, true);
  }

  function buildICS(bookings) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShaSitter//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

    bookings.forEach(b => {
      const uid = `shasitter-${b.id}-${Date.now()}`;
      const start = (b.start_date || '').replace(/-/g,'') + 'T080000Z';
      const end = (b.end_date || b.start_date || '').replace(/-/g,'') + 'T200000Z';
      const summary = `${b.clients?.name || '?'} — ${b.prestations?.name || '?'} (${slotLabel(b.slot)})`;
      const desc = `Client: ${b.clients?.name||''}\\nAnimal: ${b.pets?.name||''}\\nMontant: ${money(b.total_chf||0)} CHF`;

      lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').split('.')[0]}Z`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${summary}`, `DESCRIPTION:${desc}`, 'END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function download(filename, content, mime = 'text/calendar;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function wireEvents() {
    // Navigation
    ['Home','Clients','Prestations','Bookings','Compta'].forEach(n => {
      $(`#btn${n}`)?.addEventListener('click', () => setPanel(n.toLowerCase()));
    });

    // Recherche
    $('#clientsSearch')?.addEventListener('input', renderClients);
    $('#clientsClear')?.addEventListener('click', () => { $('#clientsSearch').value = ''; renderClients(); });

    $('#prestaSearch')?.addEventListener('input', renderPrestations);
    $('#prestaClear')?.addEventListener('click', () => { $('#prestaSearch').value = ''; renderPrestations(); });
    $('#prestaAnimalFilter')?.addEventListener('change', renderPrestations);

    $('#bookingsClientFilter')?.addEventListener('change', renderBookingsPanel);
    $('#bookingsFrom')?.addEventListener('change', renderBookingsPanel);
    $('#bookingsTo')?.addEventListener('change', renderBookingsPanel);
    $('#bookingsReset')?.addEventListener('click', () => {
      $('#bookingsClientFilter').value = ''; $('#bookingsFrom').value = ''; $('#bookingsTo').value = '';
      renderBookingsPanel();
    });

    // Export
    $('#bookingsExportAll')?.addEventListener('click', () => {
      const list = getBookingsFiltered();
      if (!list.length) return toast('Rien à exporter');
      download('shasitter-reservations.ics', buildICS(list));
      toast('Fichier .ics généré');
    });

    // Autres boutons
    $('#refreshBtn')?.addEventListener('click', loadAll);
    $('#themeBtn')?.addEventListener('click', () => { document.body.classList.toggle('bg-dark'); toast('Thème basculé'); });
    $('#closeBtn')?.addEventListener('click', () => window.Telegram?.WebApp?.close?.() || toast('Fermeture impossible'));

    // Détail client
    $('#closeClientDetail')?.addEventListener('click', closeClientDetail);

    // Clics délégués
    document.body.addEventListener('click', e => {
      const clientCard = e.target.closest('.client-card');
      if (clientCard) {
        const id = clientCard.dataset.clientId;
        if (id) renderClientDetail(id);
      }

      const booking = e.target.closest('[data-booking-id]');
      if (booking) {
        const id = Number(booking.dataset.bookingId);
        if (id) openEditBooking(id).catch(err => toast(err.message));
      }
    });

    // Modal
    $('#ebSave')?.addEventListener('click', () => saveEditBooking().catch(e => toast(e.message)));
    $('#ebDelete')?.addEventListener('click', () => deleteBooking().catch(e => toast(e.message)));
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
      state.allBookings = [...upcoming, ...past];
      state.compta = compta || null;

      const clientSel = $('#bookingsClientFilter');
      if (clientSel) clientSel.innerHTML = `<option value="">Tous</option>` + state.clients.map(c => `<option value="${c.id}">${c.name} (#${c.id})</option>`).join('');

      const ps = $('#ebPrestation');
      if (ps) ps.innerHTML = `<option value="">—</option>` + state.prestations.filter(p => p.active !== false).map(p => `<option value="${p.id}">${p.name} (#${p.id})</option>`).join('');

      renderHome();
      if (state.activePanel in {clients:1,prestations:1,bookings:1,compta:1}) setPanel(state.activePanel);

      $('#year').textContent = new Date().getFullYear();
    } catch (err) {
      console.error(err);
      toast('Erreur chargement');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();