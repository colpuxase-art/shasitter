(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);

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
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('panel' + name[0].toUpperCase() + name.slice(1));
    if (panel) panel.classList.add('active');

    document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('btn' + name[0].toUpperCase() + name.slice(1));
    if (btn) btn.classList.add('active');

    if (name === 'home') renderHome();
    if (name === 'clients') renderClients();
    if (name === 'prestations') renderPrestations();
    if (name === 'bookings') renderBookings();
    if (name === 'compta') renderCompta();
  }

  // ===================== ACCUEIL (fond sombre + pastilles lisibles) =====================
  function renderHome() {
    $('#dailyMessage').textContent = getDailyMessage();

    const c = state.compta || {};
    $('#kpiTotalAll').textContent = money(c.totalAll ?? c.total ?? 0);
    $('#kpiTotalCompany').textContent = money(c.totalCompany ?? c.totalCo ?? 0);
    $('#kpiTotalEmployees').textContent = money(c.totalEmployees ?? c.totalEmp ?? 0);

    const up = state.upcoming || [];
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
                      <div class="d-flex gap-2 mt-2">
                        <span class="slot-pill">${b.slot === 'matin' ? '🌅 Matin' : b.slot === 'soir' ? '🌙 Soir' : '🌅🌙 Matin + soir'}</span>
                        <span class="text-secondary">${b.start_date}${b.start_date !== b.end_date ? ` → ${b.end_date}` : ''}</span>
                      </div>
                      ${b.pets?.name ? `<div class="small text-muted mt-1">🐾 ${b.pets.name}</div>` : ''}
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

  // ===================== COMPTA (fix détail client) =====================
  function renderCompta() {
    const c = state.compta || {};
    $('#comptaTotal').textContent = money(c.totalAll ?? c.total ?? 0);
    $('#comptaCo').textContent = money(c.totalCompany ?? c.totalCo ?? 0);
    $('#comptaEmp').textContent = money(c.totalEmployees ?? c.totalEmp ?? 0);

    const sel = $('#comptaClientFilter');
    if (sel) {
      sel.innerHTML = `<option value="all">Tous les clients</option>` +
        state.clients.map(cl => `<option value="${cl.id}">${cl.name}</option>`).join('');
    }

    // IMPORTANT : mise à jour quand on choisit un client
    if (sel) sel.onchange = () => {
      const cid = sel.value;
      const box = $('#clientComptaDetails');
      if (cid && cid !== 'all') {
        const all = [...state.upcoming, ...state.past];
        const bs = all.filter(b => String(b.client_id) === cid);
        const total = bs.reduce((s,b)=>s+Number(b.total_chf||0),0);
        const co = bs.reduce((s,b)=>s+Number(b.company_part_chf||0),0);
        const emp = bs.reduce((s,b)=>s+Number(b.employee_part_chf||0),0);

        $('#cClientTotal').textContent = money(total);
        $('#cClientCo').textContent = money(co);
        $('#cClientEmp').textContent = money(emp);
        box.style.display = 'flex';
      } else {
        box.style.display = 'none';
      }
    };
  }

  // Les autres fonctions restent identiques à ton code (clients, prestations, bookings)
  function renderClients() { /* ton code */ }
  function renderPrestations() { /* ton code */ }
  function renderBookings() { /* ton code */ }

  function wireEvents() {
    $('#btnHome').onclick = () => setPanel('home');
    $('#btnClients').onclick = () => setPanel('clients');
    $('#btnPrestations').onclick = () => setPanel('prestations');
    $('#btnBookings').onclick = () => setPanel('bookings');
    $('#btnCompta').onclick = () => setPanel('compta');

    $('#refreshBtn').onclick = loadAll;
    $('#closeBtn').onclick = () => window.Telegram?.WebApp?.close?.();
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

      const bc = $('#bookingsClientFilter');
      if (bc) bc.innerHTML = `<option value="all">Tous les clients</option>` + state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

      const cc = $('#comptaClientFilter');
      if (cc) cc.innerHTML = `<option value="all">Tous les clients</option>` + state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

      if (state.activePanel === 'home') renderHome();
      if (state.activePanel === 'compta') renderCompta();

      $('#year').textContent = new Date().getFullYear();
    } catch (e) {
      toast('❌ Erreur de chargement');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();