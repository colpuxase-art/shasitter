(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    clients:     [],
    prestations: [],
    upcoming:    [],
    past:        [],
    compta:      null,
    activePanel: 'home'
  };

  const money = n => (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // Messages du jour pour Shana
  const dailyMessages = [
    "Shana, ta douceur transforme chaque visite en moment magique 🐾✨",
    "Aujourd’hui, les animaux t’attendent avec impatience ! Tu es leur préférée 💖",
    "Shana, ton attention et ton amour font toute la différence 🌟🐱",
    "Chaque patte que tu caresses est plus heureuse grâce à toi 🐰❤️",
    "ShaSitter brille grâce à ta gentillesse infinie ! Continue comme ça 👏",
    "Shana, tu es la super nounou dont rêvent tous les animaux 🦸‍♀️🐾",
    "Tes visites apportent joie et sérénité à nos amis à quatre pattes 😺",
    "Shana, merci d’être si exceptionnelle avec eux tous les jours 🙏💕",
    "Aujourd’hui est un jour parfait pour chouchouter encore plus ! 🌈🐾",
    "Ton cœur grand comme l’univers rend ShaSitter unique 🪐❤️"
  ];

  function getDailyMessage() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now - start) / (1000*60*60*24));
    return dailyMessages[doy % dailyMessages.length];
  }

  function toast(msg) {
    const el = $('#toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.style.display = 'none', 3000);
  }

  function setPanel(name) {
    state.activePanel = name;
    $$('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('#panel' + name[0].toUpperCase() + name.slice(1));
    if (panel) panel.classList.add('active');

    $$('.bn-item').forEach(b => b.classList.remove('active'));
    const btn = $('#btn' + name[0].toUpperCase() + name.slice(1));
    if (btn) btn.classList.add('active');

    if (name === 'home') renderHome();
    if (name === 'clients') renderClients();
    if (name === 'prestations') renderPrestations();
    if (name === 'bookings') renderBookings();
    if (name === 'compta') renderCompta();
  }

  // ===================== ACCUEIL =====================
  function renderHome() {
    $('#dailyMessage').textContent = getDailyMessage();

    const c = state.compta || {};
    $('#kpiTotalAll').textContent = money(c.totalAll ?? c.total ?? 0);
    $('#kpiTotalCompany').textContent = money(c.totalCompany ?? c.totalCo ?? 0);
    $('#kpiTotalEmployees').textContent = money(c.totalEmployees ?? c.totalEmp ?? 0);

    const up = state.upcoming || [];

    // Group by day
    const grouped = {};
    up.forEach(b => {
      const d = b.start_date || '0000-00-00';
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(b);
    });

    const days = Object.keys(grouped).sort();
    let html = '';
    days.forEach((day, i) => {
      const items = grouped[day];
      html += `
        <div class="accordion-item">
          <h2 class="accordion-header">
            <button class="accordion-button ${i===0?'':'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#day${day.replace(/-/g,'')}">
              📅 ${day} <span class="badge bg-warning text-dark ms-3">${items.length}</span>
            </button>
          </h2>
          <div id="day${day.replace(/-/g,'')}" class="accordion-collapse collapse ${i===0?'show':''}">
            <div class="accordion-body p-2">
              ${items.map(b => `
                <div class="day-card p-3 mb-3">
                  <div class="d-flex gap-3 align-items-start">
                    <div style="font-size:3.2rem;flex-shrink:0;">
                      ${b.pets?.animal_type === 'chat' ? '🐱' : b.pets?.animal_type === 'lapin' ? '🐰' : '🐾'}
                    </div>
                    <div class="flex-grow-1">
                      <div class="fw-bold fs-5">${b.clients?.name || '—'}</div>
                      <div class="fw-semibold">${b.prestations?.name || '—'}</div>
                      <div class="small text-secondary">
                        ${b.slot === 'matin' ? '🌅 Matin' : b.slot === 'soir' ? '🌙 Soir' : '🌅🌙 Matin + soir'} • 
                        ${b.start_date}${b.start_date !== b.end_date ? ` → ${b.end_date}` : ''}
                      </div>
                      ${b.pets?.name ? `<div class="small text-muted">🐾 ${b.pets.name}</div>` : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>`;
    });

    $('#upcomingAccordion').innerHTML = html || `<div class="text-center py-5 text-secondary">Aucune réservation à venir</div>`;
  }

  // ===================== CLIENTS =====================
  function renderClients() {
    const q = ($('#clientsSearch')?.value || '').trim().toLowerCase();
    const list = state.clients.filter(c => !q || c.name.toLowerCase().includes(q));

    $('#clientsList').innerHTML = list.map(c => `
      <div class="card-soft p-3 mb-3">
        <div class="fw-bold fs-5">👤 ${c.name}</div>
        <div class="small text-secondary">${c.phone ? '📞 ' + c.phone : ''} ${c.address ? '📍 ' + c.address : ''}</div>
      </div>
    `).join('') || `<div class="text-center py-5 text-secondary">Aucun client trouvé</div>`;
  }

  // ===================== PRESTATIONS =====================
  function renderPrestations() {
    const q = ($('#prestaSearch')?.value || '').trim().toLowerCase();
    const animalFilter = $('#prestaAnimalFilter')?.value || 'all';

    let filtered = state.prestations.filter(p => p.active !== false);

    if (animalFilter !== 'all') filtered = filtered.filter(p => p.animal_type === animalFilter);
    if (q) filtered = filtered.filter(p => p.name.toLowerCase().includes(q));

    $('#prestationsGrid').innerHTML = filtered.map(p => `
      <div class="card-soft p-3 mb-3">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="fw-bold fs-5">${p.name}</div>
            <div class="small text-secondary">${p.animal_type ? animalLabel(p.animal_type) : ''} • ${p.category || ''}</div>
          </div>
          <div class="text-end fw-bold fs-5">${money(p.price_chf)} CHF</div>
        </div>
        ${p.description ? `<div class="small text-muted mt-2">${p.description}</div>` : ''}
      </div>
    `).join('') || `<div class="text-center py-5 text-secondary">Aucune prestation</div>`;
  }

  function animalLabel(a) {
    return a === 'chat' ? '🐱 Chat' : a === 'lapin' ? '🐰 Lapin' : '🐾 Autre';
  }

  // ===================== RÉSERVATIONS =====================
  function renderBookings() {
    const cid = $('#bookingsClientFilter')?.value || 'all';
    let list = [...state.upcoming, ...state.past];

    if (cid !== 'all') list = list.filter(b => String(b.client_id) === cid);

    const upcoming = list.filter(b => b.end_date >= todayISO());
    const past = list.filter(b => b.end_date < todayISO());

    $('#bookingsUpcoming').innerHTML = upcoming.map(bookingItem).join('') || '<div class="text-center py-4 text-secondary">Rien à venir</div>';
    $('#bookingsPast').innerHTML = past.map(bookingItem).join('') || '<div class="text-center py-4 text-secondary">Aucune passée</div>';
  }

  function bookingItem(b) {
    return `
      <div class="card-soft p-3 mb-3">
        <div class="d-flex justify-content-between">
          <div>
            <div class="fw-bold">${b.clients?.name || '—'} <span class="text-secondary">#${b.id}</span></div>
            <div class="small">${b.prestations?.name || '—'}</div>
            <div class="small text-secondary">
              ${b.slot === 'matin' ? '🌅' : b.slot === 'soir' ? '🌙' : '🌅🌙'} • ${b.start_date} → ${b.end_date}
            </div>
            ${b.pets?.name ? `<div class="small text-muted">🐾 ${b.pets.name}</div>` : ''}
          </div>
          <div class="text-end fw-bold">${money(b.total_chf)} CHF</div>
        </div>
      </div>`;
  }

  // ===================== COMPTA =====================
  function renderCompta() {
    const c = state.compta || {};
    $('#comptaTotal').textContent = money(c.totalAll ?? c.total ?? 0);
    $('#comptaCo').textContent = money(c.totalCompany ?? c.totalCo ?? 0);
    $('#comptaEmp').textContent = money(c.totalEmployees ?? c.totalEmp ?? 0);

    // Client filter
    const sel = $('#comptaClientFilter');
    if (sel) {
      sel.innerHTML = `<option value="all">Tous les clients</option>` +
        state.clients.map(cl => `<option value="${cl.id}">${cl.name}</option>`).join('');
    }

    // When a client is selected
    const cid = $('#comptaClientFilter').value;
    const detailsBox = $('#clientComptaDetails');
    if (cid && cid !== 'all') {
      const all = [...state.upcoming, ...state.past];
      const clientBookings = all.filter(b => String(b.client_id) === cid);
      const total = clientBookings.reduce((sum, b) => sum + Number(b.total_chf || 0), 0);
      const co = clientBookings.reduce((sum, b) => sum + Number(b.company_part_chf || 0), 0);
      const emp = clientBookings.reduce((sum, b) => sum + Number(b.employee_part_chf || 0), 0);

      $('#cClientTotal').textContent = money(total);
      $('#cClientCo').textContent = money(co);
      $('#cClientEmp').textContent = money(emp);
      detailsBox.style.display = 'flex';
    } else {
      detailsBox.style.display = 'none';
    }
  }

  // ===================== EVENTS =====================
  function wireEvents() {
    $('#btnHome').onclick = () => setPanel('home');
    $('#btnClients').onclick = () => setPanel('clients');
    $('#btnPrestations').onclick = () => setPanel('prestations');
    $('#btnBookings').onclick = () => setPanel('bookings');
    $('#btnCompta').onclick = () => setPanel('compta');

    $('#clientsSearch')?.addEventListener('input', renderClients);
    $('#prestaSearch')?.addEventListener('input', renderPrestations);
    $('#prestaAnimalFilter')?.addEventListener('change', renderPrestations);
    $('#bookingsClientFilter')?.addEventListener('change', renderBookings);
    $('#comptaClientFilter')?.addEventListener('change', renderCompta);

    $('#refreshBtn').onclick = loadAll;
    $('#closeBtn').onclick = () => window.Telegram?.WebApp?.close?.();

    // Disable vertical swipe (Telegram mobile)
    if (window.Telegram?.WebApp) window.Telegram.WebApp.disableVerticalSwipes?.();
  }

  async function loadAll() {
    try {
      const [clients, prestations, upcoming, past, compta] = await Promise.all([
        fetch('/api/clients').then(r => r.json()),
        fetch('/api/prestations').then(r => r.json()),
        fetch('/api/bookings/upcoming').then(r => r.json()),
        fetch('/api/bookings/past').then(r => r.json()),
        fetch('/api/compta/summary').then(r => r.json())
      ]);

      state.clients = clients || [];
      state.prestations = prestations || [];
      state.upcoming = upcoming || [];
      state.past = past || [];
      state.compta = compta || {};

      // Populate client filters
      const bc = $('#bookingsClientFilter');
      if (bc) bc.innerHTML = `<option value="all">Tous les clients</option>` + state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

      const cc = $('#comptaClientFilter');
      if (cc) cc.innerHTML = `<option value="all">Tous les clients</option>` + state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

      // Render current panel
      if (state.activePanel === 'home') renderHome();
      if (state.activePanel === 'clients') renderClients();
      if (state.activePanel === 'prestations') renderPrestations();
      if (state.activePanel === 'bookings') renderBookings();
      if (state.activePanel === 'compta') renderCompta();

      $('#year').textContent = new Date().getFullYear();
    } catch (e) {
      console.error(e);
      toast('❌ Erreur de chargement : ' + (e.message || e));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();