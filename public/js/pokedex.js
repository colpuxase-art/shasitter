(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const money = n => (Math.round(Number(n||0)*100)/100).toFixed(2);
  const todayISO = () => new Date().toISOString().slice(0,10);

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
    const doy = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000);
    return dailyMessages[doy % dailyMessages.length];
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(()=>el.style.display='none', 3000);
  }

  function setPanel(name) {
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    $(`#panel${name[0].toUpperCase()+name.slice(1)}`).classList.add('active');
    document.querySelectorAll('.bn-item').forEach(b=>b.classList.remove('active'));
    $(`#btn${name[0].toUpperCase()+name.slice(1)}`).classList.add('active');
    window[`render${name[0].toUpperCase()+name.slice(1)}`]?.();
  }

  // ACCUEIL
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
      if(!grouped[d]) grouped[d] = [];
      grouped[d].push(b);
    });

    const days = Object.keys(grouped).sort();
    let html = '';
    days.forEach((day,i) => {
      html += `
        <div class="accordion-item">
          <h2 class="accordion-header"><button class="accordion-button ${i===0?'':'collapsed'}" data-bs-toggle="collapse" data-bs-target="#d${i}">📅 ${day} <span class="badge bg-warning text-dark ms-2">${grouped[day].length}</span></button></h2>
          <div id="d${i}" class="accordion-collapse collapse ${i===0?'show':''}">
            <div class="accordion-body p-2">
              ${grouped[day].map(b => `
                <div class="day-card">
                  <div class="d-flex gap-3">
                    <div style="font-size:3.4rem;">${b.pets?.animal_type==='chat'?'🐱':b.pets?.animal_type==='lapin'?'🐰':'🐾'}</div>
                    <div class="flex-grow-1">
                      <div class="fw-bold fs-5">${b.clients?.name||'—'}</div>
                      <div class="fw-semibold">${b.prestations?.name||'—'}</div>
                      <div class="d-flex gap-2 mt-2 flex-wrap">
                        <span class="slot-pill">${b.slot==='matin'?'🌅 Matin':b.slot==='soir'?'🌙 Soir':'🌅🌙 Matin+soir'}</span>
                        <span class="text-secondary">${b.start_date}${b.start_date!==b.end_date?` → ${b.end_date}`:''}</span>
                      </div>
                      ${b.pets?.name?`<div class="small text-muted mt-1">🐾 ${b.pets.name}</div>`:''}
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

  // COMPTA (fix du dropdown)
  function renderCompta() {
    const c = state.compta || {};
    $('#comptaTotal').textContent = money(c.totalAll ?? c.total ?? 0);
    $('#comptaCo').textContent = money(c.totalCompany ?? c.totalCo ?? 0);
    $('#comptaEmp').textContent = money(c.totalEmployees ?? c.totalEmp ?? 0);

    const sel = $('#comptaClientFilter');
    sel.innerHTML = `<option value="all">Tous les clients</option>` + state.clients.map(cl => `<option value="${cl.id}">${cl.name}</option>`).join('');

    // Quand on change le client
    sel.onchange = () => {
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

  // Autres renders (simples)
  function renderClients() {
    const q = ($('#clientsSearch').value||'').toLowerCase();
    const html = state.clients.filter(c => !q || c.name.toLowerCase().includes(q))
      .map(c => `<div class="card-soft p-3 mb-3"><div class="fw-bold">${c.name}</div><div class="small text-secondary">${c.phone||''} ${c.address||''}</div></div>`).join('');
    $('#clientsList').innerHTML = html || '<div class="text-center py-5 text-secondary">Aucun client</div>';
  }

  function renderPrestations() { /* tu peux laisser vide ou copier l’ancien */ }
  function renderBookings() { /* idem */ }

  function wireEvents() {
    $('#btnHome').onclick = () => setPanel('home');
    $('#btnClients').onclick = () => setPanel('clients');
    $('#btnPrestations').onclick = () => setPanel('prestations');
    $('#btnBookings').onclick = () => setPanel('bookings');
    $('#btnCompta').onclick = () => setPanel('compta');

    $('#clientsSearch').addEventListener('input', renderClients);
    $('#refreshBtn').onclick = loadAll;
    $('#closeBtn').onclick = () => window.Telegram?.WebApp?.close?.();
  }

  async function loadAll() {
    try {
      const [clients, prestations, upcoming, past, compta] = await Promise.all([
        fetch('/api/clients').then(r=>r.json()),
        fetch('/api/prestations').then(r=>r.json()),
        fetch('/api/bookings/upcoming').then(r=>r.json()),
        fetch('/api/bookings/past').then(r=>r.json()),
        fetch('/api/compta/summary').then(r=>r.json())
      ]);

      state.clients = clients||[];
      state.prestations = prestations||[];
      state.upcoming = upcoming||[];
      state.past = past||[];
      state.compta = compta||{};

      renderHome();
      renderCompta();   // important pour initialiser le select
    } catch(e) { toast('Erreur chargement'); }
  }

  document.addEventListener('DOMContentLoaded', () => { wireEvents(); loadAll(); });
})();