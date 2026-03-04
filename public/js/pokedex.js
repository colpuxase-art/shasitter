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
  const today = () => new Date().toISOString().slice(0, 10);

  // Messages motivants – rotation par jour de l'année
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

  function getDailyMotivation() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now - start) / 86400000);
    return dailyMessages[doy % dailyMessages.length];
  }

  function toast(msg) {
    const el = $('#toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => el.style.display = 'none', 3000);
  }

  function setPanel(name) {
    state.activePanel = name;

    $$('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('#panel' + name[0].toUpperCase() + name.slice(1));
    if (panel) panel.classList.add('active');

    $$('.bn-item').forEach(b => b.classList.remove('active'));
    const btn = $('#btn' + name[0].toUpperCase() + name.slice(1));
    if (btn) btn.classList.add('active');

    if (name === 'home')     renderHome();
    if (name === 'clients')  renderClients();
    if (name === 'prestations') renderPrestations();
    if (name === 'bookings') renderBookings();
    if (name === 'compta')   renderCompta();
  }

  // ────────────────────────────────────────────────
  // ACCUEIL – uniquement à venir + accordion par jour
  // ────────────────────────────────────────────────
  function renderHome() {
    $('#dailyMessage').textContent = getDailyMotivation();

    const c = state.compta || {};
    $('#kpiTotalAll').textContent     = money(c.totalAll ?? c.total ?? 0);
    $('#kpiTotalCompany').textContent = money(c.totalCompany ?? c.totalCo ?? 0);
    $('#kpiTotalEmployees').textContent = money(c.totalEmployees ?? c.totalEmp ?? 0);

    const upcoming = state.upcoming || [];

    // Grouper par date de début
    const byDay = {};
    upcoming.forEach(b => {
      const key = b.start_date || 'sans-date';
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(b);
    });

    const sortedDays = Object.keys(byDay).sort();

    let html = '';
    sortedDays.forEach((day, idx) => {
      const bookings = byDay[day];
      const isFirst = idx === 0;

      html += `
        <div class="accordion-item bg-transparent border-0">
          <h2 class="accordion-header">
            <button class="accordion-button ${isFirst ? '' : 'collapsed'} text-white fw-semibold"
                    type="button" data-bs-toggle="collapse" data-bs-target="#collapseDay${idx}">
              📅 ${day} <span class="badge bg-secondary ms-3">${bookings.length}</span>
            </button>
          </h2>
          <div id="collapseDay${idx}" class="accordion-collapse collapse ${isFirst ? 'show' : ''}">
            <div class="accordion-body px-1 pb-3">
              ${bookings.map(b => `
                <div class="day-card p-3 mb-3 rounded-4 border border-secondary-subtle bg-dark-subtle bg-opacity-25">
                  <div class="d-flex align-items-start gap-3">
                    <div style="font-size:3.4rem; line-height:1;">
                      ${b.pets?.animal_type === 'chat' ? '🐱' :
                        b.pets?.animal_type === 'lapin' ? '🐰' : '🐾'}
                    </div>
                    <div class="flex-grow-1">
                      <div class="fs-5 fw-bold">${b.clients?.name || '—'}</div>
                      <div class="fw-medium">${b.prestations?.name || '—'}</div>
                      <div class="small text-secondary mt-1">
                        ${b.slot === 'matin' ? '🌅 Matin' :
                          b.slot === 'soir' ? '🌙 Soir' : '🌅🌙 Matin + Soir'}
                        • ${b.start_date}${b.start_date !== b.end_date ? ` → ${b.end_date}` : ''}
                      </div>
                      ${b.pets?.name ? `<div class="small text-muted mt-1">🐾 ${b.pets.name}</div>` : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    });

    $('#upcomingAccordion').innerHTML = html || `
      <div class="text-center py-5 text-secondary">
        Aucune réservation à venir pour le moment
      </div>
    `;
  }

  // ────────────────────────────────────────────────
  // RÉSERVATIONS (à venir + passées)
  // ────────────────────────────────────────────────
  function renderBookings() {
    const cid = $('#bookingsClientFilter')?.value || '';

    const allBookings = [...(state.upcoming || []), ...(state.past || [])];
    let filtered = allBookings;

    if (cid && cid !== 'all') {
      filtered = filtered.filter(b => String(b.client_id) === cid);
    }

    const upcoming = filtered.filter(b => b.end_date >= today());
    const past     = filtered.filter(b => b.end_date <  today());

    $('#bookingsUpcoming').innerHTML = upcoming.map(b => `
      <div class="list-group-item bg-dark border-secondary text-white mb-2 rounded-3 p-3">
        <div class="d-flex justify-content-between">
          <div>
            <div class="fw-bold">${b.clients?.name || '—'} #${b.id}</div>
            <div class="small">${b.prestations?.name || '—'}</div>
            <div class="small text-secondary">
              ${b.slot === 'matin' ? '🌅' : b.slot === 'soir' ? '🌙' : '🌅🌙'}
              • ${b.start_date} → ${b.end_date}
            </div>
            ${b.pets?.name ? `<div class="small text-muted">🐾 ${b.pets.name}</div>` : ''}
          </div>
          <div class="text-end fw-bold fs-5">${money(b.total_chf)} CHF</div>
        </div>
      </div>
    `).join('') || '<p class="text-secondary text-center py-4">Aucune réservation à venir</p>';

    $('#bookingsPast').innerHTML = past.map(b => `
      <div class="list-group-item bg-dark border-secondary text-white mb-2 rounded-3 p-3 opacity-85">
        <div class="d-flex justify-content-between">
          <div>
            <div class="fw-bold">${b.clients?.name || '—'} #${b.id}</div>
            <div class="small">${b.prestations?.name || '—'}</div>
            <div class="small text-secondary">
              ${b.slot === 'matin' ? '🌅' : b.slot === 'soir' ? '🌙' : '🌅🌙'}
              • ${b.start_date} → ${b.end_date}
            </div>
            ${b.pets?.name ? `<div class="small text-muted">🐾 ${b.pets.name}</div>` : ''}
          </div>
          <div class="text-end fw-bold fs-5">${money(b.total_chf)} CHF</div>
        </div>
      </div>
    `).join('') || '<p class="text-secondary text-center py-4">Aucune réservation passée</p>';
  }

  // ────────────────────────────────────────────────
  // Événements
  // ────────────────────────────────────────────────
  function wireEvents() {
    $('#btnHome')?.addEventListener('click',     () => setPanel('home'));
    $('#btnClients')?.addEventListener('click',  () => setPanel('clients'));
    $('#btnPrestations')?.addEventListener('click', () => setPanel('prestations'));
    $('#btnBookings')?.addEventListener('click', () => setPanel('bookings'));
    $('#btnCompta')?.addEventListener('click',   () => setPanel('compta'));

    // Exemples de filtres (à compléter selon tes besoins)
    $('#bookingsClientFilter')?.addEventListener('change', renderBookings);
    $('#refreshBtn')?.addEventListener('click', loadAll);
    $('#closeBtn')?.addEventListener('click', () => window.Telegram?.WebApp?.close?.());

    // Swipe vertical désactivé (évite de fermer l’app par erreur)
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.disableVerticalSwipes?.();
    }
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

      state.clients     = clients     || [];
      state.prestations = prestations || [];
      state.upcoming    = upcoming    || [];
      state.past        = past        || [];
      state.compta      = compta      || {};

      // Remplir le select client (exemple)
      const sel = $('#bookingsClientFilter');
      if (sel) {
        sel.innerHTML = `<option value="all">Tous les clients</option>` +
          state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }

      renderHome();
      if (state.activePanel === 'bookings') renderBookings();
      // ... appelle les autres render si besoin

      $('#year').textContent = new Date().getFullYear();
    } catch (err) {
      console.error(err);
      toast('Erreur lors du chargement des données');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    loadAll();
  });
})();