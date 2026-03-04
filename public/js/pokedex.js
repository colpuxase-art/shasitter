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
    toast._t = setTimeout(() => (el.style.display = 'none'), 2800);
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

  // ────────────────────────────────────────────────
  //   AFFICHAGE GROUPÉ PAR JOUR (nouveau style cartes)
  // ────────────────────────────────────────────────
  function renderGroupedReservations(containerId, bookings, isPast = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (!bookings || bookings.length === 0) {
      container.innerHTML = `<div class="text-center text-muted py-4">Aucune réservation</div>`;
      return;
    }

    // Grouper par date de début
    const groups = {};
    bookings.forEach(b => {
      const key = b.start_date || '0000-00-00';
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });

    const sortedDates = Object.keys(groups).sort();

    sortedDates.forEach(dateKey => {
      const group = groups[dateKey];

      // Label jour humain
      let label = dateKey;
      const d = new Date(dateKey);
      const today = new Date();
      today.setHours(0,0,0,0);
      const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));

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

      group.forEach(b => {
        const client = b.clients?.name || 'Client inconnu';
        const pet = b.pets?.name || '';
        const animalType = b.prestations?.animal_type || pet || '';
        const emoji = getAnimalEmoji(animalType);
        const presta = b.prestations?.name || '—';
        const slot = slotLabel(b.slot);
        const range = b.start_date === b.end_date 
          ? b.start_date 
          : `${b.start_date} → ${b.end_date}`;
        const price = money(b.total_chf ?? b.total_override ?? 0);

        const card = document.createElement('div');
        card.className = `res-card ${isPast ? 'res-past' : ''}`;
        card.setAttribute('data-booking-id', b.id);
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
        container.appendChild(card);
      });
    });
  }

  function getAnimalEmoji(text = '') {
    const t = text.toLowerCase();
    if (t.includes('chat')) return '🐱';
    if (t.includes('chien')) return '🐶';
    if (t.includes('lapin')) return '🐰';
    if (t.includes('oiseau') || t.includes('perroquet')) return '🐦';
    if (t.includes('rongeur') || t.includes('hamster')) return '🐹';
    return '🐾';
  }

  function renderHome() {
    const up = state.upcoming || [];
    const past = state.past || [];

    $('#kpiUpcomingCount').textContent = String(up.length);
    $('#kpiPastCount').textContent = String(past.length);

    const next = up[0];
    $('#kpiNextBooking').textContent = next 
      ? `${next.start_date} · ${next.clients?.name || ''} · ${next.prestations?.name || ''}`
      : '—';

    if (state.compta) {
      const totalAll = state.compta.totalAll ?? state.compta.total_all ?? state.compta.total ?? 0;
      const totalEmp = state.compta.totalEmp ?? state.compta.totalEmployees ?? state.compta.total_employee ?? 0;
      const totalCo = state.compta.totalCo ?? state.compta.totalCompany ?? state.compta.total_company ?? 0;

      $('#kpiTotalAll').textContent = money(totalAll);
      $('#kpiTotalEmployees').textContent = money(totalEmp);
      $('#kpiTotalCompany').textContent = money(totalCo);
    }

    renderGroupedReservations('upcomingList', up);
    renderGroupedReservations('pastList', past, true);
  }

  function renderClients() {
    const q = ($('#clientsSearch')?.value || '').trim().toLowerCase();
    const list = (state.clients || [])
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q))
      .slice(0, 200);

    const wrap = $('#clientsList');
    if (!wrap) return;

    wrap.innerHTML = list
      .map(
        (c) => `
        <div class="list-group mb-2">
          <div class="list-group-item text-white">
            <div class="fw-bold">👤 ${c.name} <span class="text-secondary">#${c.id}</span></div>
            <div class="small text-secondary">${c.phone ? '📞 ' + c.phone : '📞 —'} · ${c.address ? '📍 ' + c.address : '📍 —'}</div>
          </div>
        </div>
      `
      )
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

    grid.innerHTML =
      list
        .map((p) => {
          const ico = p.category === 'pack' ? '📦' : p.category === 'service' ? '🧾' : p.category === 'supplement' ? '🧩' : p.category === 'menage' ? '🧼' : '🧾';
          const more = [
            p.category ? p.category : null,
            p.animal_type ? p.animal_type : null,
            p.category === 'pack' && p.visits_per_day ? `${p.visits_per_day} visite/j` : null,
            p.duration_min ? `${p.duration_min} min` : null,
          ]
            .filter(Boolean)
            .join(' · ');

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
        })
        .join('') || `<div class="text-secondary">Aucune prestation.</div>`;
  }

  function getBookingsFiltered() {
    const clientId = ($('#bookingsClientFilter')?.value || '').trim();
    const from = ($('#bookingsFrom')?.value || '').trim();
    const to = ($('#bookingsTo')?.value || '').trim();

    let all = [...(state.upcoming || []), ...(state.past || [])];
    all.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '') || (a.id - b.id));

    if (clientId && clientId !== 'all') all = all.filter((b) => String(b.client_id) === String(clientId));
    if (from) all = all.filter((b) => (b.end_date || b.start_date || '9999-99-99') >= from);
    if (to) all = all.filter((b) => (b.start_date || '0000-00-00') <= to);

    return all;
  }

  function renderBookingsPanel() {
    const list = getBookingsFiltered();
    const t = todayISO();

    const up = list.filter((b) => (b.end_date || b.start_date || '9999-99-99') >= t);
    const past = list.filter((b) => (b.end_date || b.start_date || '0000-00-00') < t);

    renderGroupedReservations('bookingsUpcoming', up);
    renderGroupedReservations('bookingsPast', past, true);
  }

  // ────────────────────────────────────────────────
  //   EXPORT ICS AMÉLIORÉ
  // ────────────────────────────────────────────────
  function icsEscape(s) {
    return String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function buildICS(bookings) {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShaSitter//Reservations//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

    for (const b of bookings) {
      const uid = `booking-${b.id}@shasitter-${Date.now()}`;
      const dtStart = (b.start_date || '').replace(/-/g, '') + 'T080000Z';
      const dtEnd = (b.end_date || b.start_date || '').replace(/-/g, '') + 'T200000Z';
      const summary = `${b.clients?.name || 'Client'} — ${b.prestations?.name || 'Prestation'} (${slotLabel(b.slot)})`;
      const desc = [
        `Client: ${b.clients?.name || ''}`,
        `Animal: ${b.pets?.name || ''}`,
        `Total: ${money(b.total_chf ?? 0)} CHF`,
        b.notes ? `Notes: ${b.notes}` : ''
      ].filter(Boolean).join('\\n');

      lines.push(
        'BEGIN:VEVENT',
        `UID:${icsEscape(uid)}`,
        `DTSTAMP:${now}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(desc)}`,
        'END:VEVENT'
      );
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function download(filename, content, mime = 'text/calendar;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
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

    const byMonth = c.byMonth ?? c.months ?? [];
    const topClients = c.topClients ?? [];
    const topPrestations = c.topPrestations ?? [];

    const monthsEl = $('#comptaMonths');
    const clientsEl = $('#comptaClients');
    const prestaEl = $('#comptaPrestations');

    if (monthsEl) {
      monthsEl.innerHTML =
        byMonth
          .map((x) => `
            <div class="d-flex justify-content-between py-1 border-bottom" style="border-color: rgba(255,255,255,.08)!important;">
              <div>${x.month}</div>
              <div class="fw-bold">${money(x.total)} CHF</div>
            </div>
          `)
          .join('') || `<div class="text-secondary">—</div>`;
    }

    if (clientsEl) {
      clientsEl.innerHTML =
        topClients
          .map((x) => `
            <div class="d-flex justify-content-between py-1 border-bottom" style="border-color: rgba(255,255,255,.08)!important;">
              <div>${x.client ?? x.name ?? ('Client #' + x.id)}</div>
              <div class="fw-bold">${money(x.total)} CHF</div>
            </div>
          `)
          .join('') || `<div class="text-secondary">—</div>`;
    }

    if (prestaEl) {
      prestaEl.innerHTML =
        topPrestations
          .map((x) => `
            <div class="d-flex justify-content-between py-1 border-bottom" style="border-color: rgba(255,255,255,.08)!important;">
              <div>${x.prestation ?? x.name ?? ('Prestation #' + x.id)}</div>
              <div class="fw-bold">${money(x.total)} CHF</div>
            </div>
          `)
          .join('') || `<div class="text-secondary">—</div>`;
    }
  }

  async function openEditBooking(id) {
    const modalEl = $('#modalEditBooking');
    if (!modalEl) return;

    let b;
    try {
      b = await fetchJSON(`/api/bookings/${id}`);
    } catch (err) {
      toast('Impossible de charger la réservation');
      return;
    }

    $('#ebId').textContent = String(b.id);
    $('#ebPrestation').value = b.prestation_id ?? '';
    $('#ebStart').value = b.start_date || '';
    $('#ebEnd').value = b.end_date || '';
    $('#ebSlot').value = b.slot || 'matin';
    $('#ebTotalOverride').value = b.total_chf ?? b.total_override ?? '';

    if (!state.bsModal) state.bsModal = new bootstrap.Modal(modalEl);
    state.bsModal.show();
  }

  async function saveEditBooking() {
    const id = Number($('#ebId')?.textContent || '');
    if (!Number.isFinite(id)) return;

    const payload = {
      prestation_id: Number($('#ebPrestation')?.value || 0) || null,
      start_date: $('#ebStart')?.value || null,
      end_date: $('#ebEnd')?.value || null,
      slot: $('#ebSlot')?.value || null,
      total_override: $('#ebTotalOverride')?.value ? Number($('#ebTotalOverride').value) : null,
    };

    try {
      await fetchJSON(`/api/bookings/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      state.bsModal?.hide();
      toast('✅ Réservation mise à jour.');
      await loadAll();
    } catch (err) {
      toast('Erreur lors de la sauvegarde : ' + err.message);
    }
  }

  async function deleteBooking() {
    const id = Number($('#ebId')?.textContent || '');
    if (!Number.isFinite(id)) return;
    if (!confirm('Supprimer cette réservation ?')) return;

    try {
      await fetchJSON(`/api/bookings/${id}`, { method: 'DELETE' });
      state.bsModal?.hide();
      toast('🗑️ Réservation supprimée.');
      await loadAll();
    } catch (err) {
      toast('Erreur suppression : ' + err.message);
    }
  }

  function wireEvents() {
    // Navigation
    $('#btnHome')?.addEventListener('click', () => setPanel('home'));
    $('#btnClients')?.addEventListener('click', () => setPanel('clients'));
    $('#btnPrestations')?.addEventListener('click', () => setPanel('prestations'));
    $('#btnBookings')?.addEventListener('click', () => setPanel('bookings'));
    $('#btnCompta')?.addEventListener('click', () => setPanel('compta'));

    // Recherche / filtres
    $('#clientsSearch')?.addEventListener('input', renderClients);
    $('#clientsClear')?.addEventListener('click', () => {
      $('#clientsSearch').value = '';
      renderClients();
    });

    $('#prestaSearch')?.addEventListener('input', renderPrestations);
    $('#prestaClear')?.addEventListener('click', () => {
      $('#prestaSearch').value = '';
      renderPrestations();
    });
    $('#prestaAnimalFilter')?.addEventListener('change', renderPrestations);

    $('#bookingsClientFilter')?.addEventListener('change', renderBookingsPanel);
    $('#bookingsFrom')?.addEventListener('change', renderBookingsPanel);
    $('#bookingsTo')?.addEventListener('change', renderBookingsPanel);
    $('#bookingsReset')?.addEventListener('click', () => {
      $('#bookingsClientFilter').value = '';
      $('#bookingsFrom').value = '';
      $('#bookingsTo').value = '';
      renderBookingsPanel();
    });

    // Export ICS
    $('#bookingsExportAll')?.addEventListener('click', () => {
      const list = getBookingsFiltered();
      if (!list.length) return toast('Rien à exporter.');

      const ics = buildICS(list);
      download('shasitter-reservations.ics', ics, 'text/calendar;charset=utf-8');
      toast('📅 Fichier .ics généré');
    });

    $('#refreshBtn')?.addEventListener('click', loadAll);

    $('#themeBtn')?.addEventListener('click', () => {
      document.body.classList.toggle('bg-dark');
      toast('✨ Thème basculé.');
    });

    $('#closeBtn')?.addEventListener('click', () => {
      try {
        if (window.Telegram?.WebApp) window.Telegram.WebApp.close();
        else toast('Telegram WebApp non détecté.');
      } catch {
        toast('Impossible de fermer via Telegram.');
      }
    });

    // Modal
    $('#ebSave')?.addEventListener('click', () => saveEditBooking().catch((e) => toast(e.message)));
    $('#ebDelete')?.addEventListener('click', () => deleteBooking().catch((e) => toast(e.message)));

    // Ouvrir édition sur clic réservation
    document.body.addEventListener('click', (e) => {
      const el = e.target?.closest?.('[data-booking-id]');
      if (!el) return;
      const id = Number(el.getAttribute('data-booking-id'));
      if (!Number.isFinite(id)) return;
      openEditBooking(id).catch((err) => toast(err.message));
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

      state.clients = clients || [];
      state.prestations = prestations || [];
      state.upcoming = (upcoming || []).sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '') || (a.id - b.id));
      state.past = (past || []).sort((a, b) => (b.start_date || '').localeCompare(a.start_date || '') || (b.id - a.id));
      state.compta = compta || null;

      // Remplir filtre clients
      const sel = $('#bookingsClientFilter');
      if (sel) {
        sel.innerHTML = `<option value="">Tous les clients</option>` + 
          state.clients.map((c) => `<option value="${c.id}">${c.name} (#${c.id})</option>`).join('');
      }

      // Remplir select prestation modal
      const ps = $('#ebPrestation');
      if (ps) {
        ps.innerHTML = `<option value="">—</option>` + 
          state.prestations.filter((p) => p.active !== false).map((p) => `<option value="${p.id}">${p.name} (#${p.id})</option>`).join('');
      }

      // Rendu selon onglet actif
      renderHome();
      if (state.activePanel === 'clients') renderClients();
      if (state.activePanel === 'prestations') renderPrestations();
      if (state.activePanel === 'bookings') renderBookingsPanel();
      if (state.activePanel === 'compta') renderCompta();

      const year = $('#year');
      if (year) year.textContent = String(new Date().getFullYear());
    } catch (e) {
      console.error(e);
      toast('Erreur chargement: ' + (e?.message || e));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();