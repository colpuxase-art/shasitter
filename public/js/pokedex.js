
(() => {
  'use strict';

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const state = {
    clients: [],
    prestations: [],
    upcoming: [],
    past: [],
    compta: null,
    pie: null,
    activePanel: 'home',
  };

  const fmtCHF = (n) => (Math.round((Number(n||0))*100)/100).toFixed(2);
  const slotLabel = (s) => s === 'matin' ? '🌅 Matin' : s === 'soir' ? '🌙 Soir' : '🌅🌙 Matin+soir';

  async function fetchJSON(url, opts={}) {
    const res = await fetch(url, { headers: { 'Content-Type':'application/json' }, ...opts });
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      throw new Error(`${res.status} ${res.statusText} - ${txt}`);
    }
    return res.json();
  }

  function toast(msg) {
    const t = $('#toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 2200);
  }

  function setPanel(name) {
    state.activePanel = name;
    $$('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('#panel' + name[0].toUpperCase() + name.slice(1));
    if (panel) panel.classList.add('active');

    $$('#bottomNav .navBtn').forEach(b => b.classList.remove('active'));
    const btn = $('#btn' + name[0].toUpperCase() + name.slice(1));
    if (btn) btn.classList.add('active');
  }

  function bookingCard(b) {
    const c = b.clients?.name || '—';
    const pet = b.pets?.name ? `🐾 ${b.pets.name}` : '🐾 —';
    const p = b.prestations?.name || '—';
    const emp = b.employees?.name ? `👩‍💼 ${b.employees.name}` : '';
    const range = b.start_date === b.end_date ? b.start_date : `${b.start_date} → ${b.end_date}`;
    const badge = `<span class="badge">${slotLabel(b.slot)}</span>`;
    return `
      <div class="item clickable" data-booking-id="${b.id}">
        <div class="row">
          <div class="title">${c} <span class="muted">#${b.id}</span></div>
          <div class="price">${fmtCHF(b.total_chf)} CHF</div>
        </div>
        <div class="sub">${pet} · ${p} ${emp ? '· '+emp : ''}</div>
        <div class="sub">${badge} <span class="muted">·</span> ${range} <span class="muted">·</span> ${b.days_count || ''} jour(s)</div>
      </div>
    `;
  }

  function renderHome() {
    const up = state.upcoming || [];
    const past = state.past || [];
    $('#kpiUpcomingCount').textContent = String(up.length);
    $('#kpiPastCount').textContent = String(past.length);

    const next = up[0];
    $('#kpiNextBooking').textContent = next ? `${next.start_date} · ${next.clients?.name || ''} · ${(next.prestations?.name || '')}` : '—';

    // KPI totals from compta summary if available
    if (state.compta) {
      $('#kpiTotalAll').textContent = `${fmtCHF(state.compta.totalAll)} CHF`;
      $('#kpiTotalEmployees').textContent = `${fmtCHF(state.compta.totalEmp)} CHF`;
      $('#kpiTotalCompany').textContent = `${fmtCHF(state.compta.totalCo)} CHF`;
    }

    $('#upcomingList').innerHTML = up.slice(0, 8).map(bookingCard).join('') || `<div class="empty">Aucune réservation à venir.</div>`;
    $('#pastList').innerHTML = past.slice(0, 8).map(bookingCard).join('') || `<div class="empty">Aucune réservation passée.</div>`;
  }

  function renderClients() {
    const q = ($('#clientsSearch').value || '').trim().toLowerCase();
    const list = state.clients
      .filter(c => !q || (c.name||'').toLowerCase().includes(q))
      .slice(0, 100);
    $('#clientsList').innerHTML = list.map(c => `
      <div class="item">
        <div class="row">
          <div class="title">👤 ${c.name} <span class="muted">#${c.id}</span></div>
        </div>
        <div class="sub">${c.phone ? '📞 '+c.phone : '📞 —'} · ${c.address ? '📍 '+c.address : '📍 —'}</div>
      </div>
    `).join('') || `<div class="empty">Aucun client.</div>`;
  }

  function renderPrestations() {
    const q = ($('#prestaSearch').value || '').trim().toLowerCase();
    const animal = ($('#prestaAnimalFilter').value || 'all');
    const list = (state.prestations || []).filter(p => {
      if (animal !== 'all' && p.animal_type !== animal && p.animal_type !== 'autre') return false;
      if (q && !(p.name||'').toLowerCase().includes(q)) return false;
      return p.active !== false;
    });
    $('#prestationsGrid').innerHTML = list.map(p => `
      <div class="tile">
        <div class="row">
          <div class="title">${p.category === 'pack' ? '📦' : p.category === 'service' ? '🧾' : p.category === 'supplement' ? '🧩' : p.category === 'menage' ? '🧼' : '🧾'} ${p.name}</div>
          <div class="price">${fmtCHF(p.price_chf)} CHF</div>
        </div>
        <div class="sub">${p.animal_type} · ${p.category}${p.category==='pack' ? ` · ${p.visits_per_day} visite/j` : ''}${p.duration_min ? ` · ${p.duration_min} min` : ''}</div>
        ${p.description ? `<div class="muted" style="margin-top:6px; font-size:12px;">${p.description}</div>` : ''}
      </div>
    `).join('') || `<div class="empty">Aucune prestation.</div>`;
  }

  function getBookingsFiltered() {
    const clientId = ($('#bookingsClientFilter').value || '').trim();
    const from = ($('#bookingsFrom').value || '').trim();
    const to = ($('#bookingsTo').value || '').trim();

    let all = [...(state.upcoming||[]), ...(state.past||[])];
    // sort by start_date asc
    all.sort((a,b)=> (a.start_date||'').localeCompare(b.start_date||'') || (a.id-b.id));

    if (clientId) all = all.filter(b => String(b.client_id) === String(clientId));
    if (from) all = all.filter(b => (b.end_date||'') >= from);
    if (to) all = all.filter(b => (b.start_date||'') <= to);
    return all;
  }

  function renderBookingsPanel() {
    const list = getBookingsFiltered();
    $('#bookingsUpcoming').innerHTML = list.filter(b => (b.end_date||'') >= todayISO()).map(bookingCard).join('') || `<div class="empty">Rien à afficher.</div>`;
    $('#bookingsPast').innerHTML = list.filter(b => (b.end_date||'') < todayISO()).map(bookingCard).join('') || `<div class="empty">Rien à afficher.</div>`;
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function icsEscape(s) {
    return String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  }

  function download(filename, text, mime='text/plain') {
    const blob = new Blob([text], {type:mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function buildICS(bookings) {
    const now = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ShaSitter//Reservations//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    for (const b of bookings) {
      const uid = `booking-${b.id}@shasitter`;
      const dtStart = (b.start_date||'').replace(/-/g,'') + 'T090000Z';
      const dtEnd = (b.end_date||b.start_date||'').replace(/-/g,'') + 'T100000Z';
      const summary = `${b.clients?.name || 'Client'} — ${b.prestations?.name || 'Prestation'} (${slotLabel(b.slot)})`;
      const desc = `Client: ${b.clients?.name || ''}\nAnimal: ${b.pets?.name || ''}\nTotal: ${fmtCHF(b.total_chf)} CHF\nNotes: ${b.notes||''}`;
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

  function renderCompta() {
    const c = state.compta;
    if (!c) return;
    $('#comptaTotal').textContent = `${fmtCHF(c.totalAll)} CHF`;
    $('#comptaEmp').textContent = `${fmtCHF(c.totalEmp)} CHF`;
    $('#comptaCo').textContent = `${fmtCHF(c.totalCo)} CHF`;

    // months / top clients / top prestations (lists)
    $('#comptaMonths').innerHTML = (c.byMonth||[]).map(x => `
      <div class="rowLine"><div>${x.month}</div><div class="price">${fmtCHF(x.total)} CHF</div></div>
    `).join('') || `<div class="empty">—</div>`;

    $('#comptaClients').innerHTML = (c.topClients||[]).map(x => `
      <div class="rowLine"><div>${x.client}</div><div class="price">${fmtCHF(x.total)} CHF</div></div>
    `).join('') || `<div class="empty">—</div>`;

    $('#comptaPrestations').innerHTML = (c.topPrestations||[]).map(x => `
      <div class="rowLine"><div>${x.prestation}</div><div class="price">${fmtCHF(x.total)} CHF</div></div>
    `).join('') || `<div class="empty">—</div>`;

    // pie chart
    const canvas = $('#comptaPie');
    if (canvas && window.Chart) {
      const labels = (c.topPrestations||[]).map(x => x.prestation);
      const data = (c.topPrestations||[]).map(x => Number(x.total||0));
      if (state.pie) state.pie.destroy();
      state.pie = new Chart(canvas, {
        type: 'pie',
        data: { labels, datasets: [{ data }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });
    }
  }

  async function openEditBooking(id) {
    const modal = $('#modalEditBooking');
    if (!modal) return;
    const b = await fetchJSON(`/api/bookings/${id}`);
    $('#ebId').textContent = `#${b.id}`;
    $('#ebPrestation').value = b.prestation_id || '';
    $('#ebStart').value = b.start_date || '';
    $('#ebEnd').value = b.end_date || '';
    $('#ebSlot').value = b.slot || 'matin';
    $('#ebTotalOverride').value = b.total_chf ?? '';
    modal.classList.add('open');
  }

  async function saveEditBooking() {
    const modal = $('#modalEditBooking');
    const id = Number(($('#ebId').textContent||'').replace('#',''));
    if (!Number.isFinite(id)) return;

    const payload = {
      prestation_id: Number($('#ebPrestation').value || 0) || null,
      start_date: $('#ebStart').value,
      end_date: $('#ebEnd').value,
      slot: $('#ebSlot').value,
      total_override: $('#ebTotalOverride').value ? Number($('#ebTotalOverride').value) : null
    };
    await fetchJSON(`/api/bookings/${id}`, { method:'PUT', body: JSON.stringify(payload) });
    modal.classList.remove('open');
    await loadAll();
    toast('✅ Réservation mise à jour.');
  }

  async function deleteBooking() {
    const id = Number(($('#ebId').textContent||'').replace('#',''));
    if (!Number.isFinite(id)) return;
    if (!confirm('Supprimer cette réservation ?')) return;
    await fetchJSON(`/api/bookings/${id}`, { method:'DELETE' });
    $('#modalEditBooking').classList.remove('open');
    await loadAll();
    toast('🗑️ Réservation supprimée.');
  }

  function wireEvents() {
    // nav
    $('#btnHome').addEventListener('click', ()=>setPanel('home'));
    $('#btnClients').addEventListener('click', ()=>{ setPanel('clients'); renderClients(); });
    $('#btnPrestations').addEventListener('click', ()=>{ setPanel('prestations'); renderPrestations(); });
    $('#btnBookings').addEventListener('click', ()=>{ setPanel('bookings'); renderBookingsPanel(); });
    $('#btnCompta').addEventListener('click', ()=>{ setPanel('compta'); renderCompta(); });

    // search / filters
    $('#clientsSearch').addEventListener('input', renderClients);
    $('#clientsClear').addEventListener('click', ()=>{ $('#clientsSearch').value=''; renderClients(); });

    $('#prestaSearch').addEventListener('input', renderPrestations);
    $('#prestaClear').addEventListener('click', ()=>{ $('#prestaSearch').value=''; renderPrestations(); });
    $('#prestaAnimalFilter').addEventListener('change', renderPrestations);

    $('#bookingsClientFilter').addEventListener('change', renderBookingsPanel);
    $('#bookingsFrom').addEventListener('change', renderBookingsPanel);
    $('#bookingsTo').addEventListener('change', renderBookingsPanel);
    $('#bookingsReset').addEventListener('click', ()=>{
      $('#bookingsClientFilter').value = '';
      $('#bookingsFrom').value = '';
      $('#bookingsTo').value = '';
      renderBookingsPanel();
    });

    $('#bookingsExportAll').addEventListener('click', ()=>{
      const list = getBookingsFiltered();
      if (!list.length) return toast('Rien à exporter.');
      const ics = buildICS(list);
      download('shasitter-reservations.ics', ics, 'text/calendar');
      toast('📅 Export .ics généré.');
    });

    $('#refreshBtn').addEventListener('click', loadAll);

    // modal
    $('#ebSave').addEventListener('click', saveEditBooking);
    $('#ebDelete').addEventListener('click', deleteBooking);
    $('#closeBtn').addEventListener('click', ()=>$('#modalEditBooking').classList.remove('open'));
    $('#modalEditBooking').addEventListener('click', (e)=>{
      if (e.target && e.target.id === 'modalEditBooking') $('#modalEditBooking').classList.remove('open');
    });

    // click booking to edit
    document.body.addEventListener('click', (e)=>{
      const el = e.target.closest?.('[data-booking-id]');
      if (!el) return;
      const id = Number(el.getAttribute('data-booking-id'));
      if (!Number.isFinite(id)) return;
      openEditBooking(id).catch(err=>toast(err.message));
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
      state.upcoming = (upcoming || []).sort((a,b)=> (a.start_date||'').localeCompare(b.start_date||'') || (a.id-b.id));
      state.past = (past || []).sort((a,b)=> (b.start_date||'').localeCompare(a.start_date||'') || (b.id-a.id));
      state.compta = compta || null;

      // fill booking filter dropdown
      const sel = $('#bookingsClientFilter');
      sel.innerHTML = `<option value="">Tous les clients</option>` + state.clients.map(c=>`<option value="${c.id}">${c.name} (#${c.id})</option>`).join('');

      // fill prestation select in modal
      const ps = $('#ebPrestation');
      ps.innerHTML = `<option value="">—</option>` + state.prestations.filter(p=>p.active!==false).map(p=>`<option value="${p.id}">${p.name} (#${p.id})</option>`).join('');

      renderHome();
      if (state.activePanel === 'clients') renderClients();
      if (state.activePanel === 'prestations') renderPrestations();
      if (state.activePanel === 'bookings') renderBookingsPanel();
      if (state.activePanel === 'compta') renderCompta();

      $('#year').textContent = String(new Date().getFullYear());
    } catch (e) {
      console.error(e);
      toast('Erreur chargement: ' + e.message);
    }
  }

  // init
  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();
