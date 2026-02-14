(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  /* ================= HELPERS ================= */
  const $ = (id) => document.getElementById(id);
  const safe = (v) => (v == null ? "" : String(v));
  const norm = (v) => safe(v).trim().toLowerCase();
  const money = (n) => {
    const x = Number(n || 0);
    if (!Number.isFinite(x)) return "0.00";
    return (Math.round(x * 100) / 100).toFixed(2);
  };

  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.style.display = "none"), 1600);
  }

  function apiFetch(url) {
    const initData = tg?.initData || "";
    return fetch(url, {
      cache: "no-store",
      headers: {
        "X-Telegram-InitData": initData,
      },
    });
  }

  /* ================= STATE ================= */
  let prestations = [];
  let clients = [];
  let upcoming = [];
  let past = [];
  let compta = null;
  let agenda = [];
  let agendaRange = 'today';

  /* ================= UI: NAV ================= */
  const panels = {
    home: $("panelHome"),
    agenda: $("panelAgenda"),
    clients: $("panelClients"),
    prestations: $("panelPrestations"),
    bookings: $("panelBookings"),
    compta: $("panelCompta"),
  };

  const btns = {
    home: $("btnHome"),
    agenda: $("btnAgenda"),
    clients: $("btnClients"),
    prestations: $("btnPrestations"),
    bookings: $("btnBookings"),
    compta: $("btnCompta"),
  };

  function setActiveNav(key) {
    Object.values(btns).forEach((b) => b && b.classList.remove("active"));
    btns[key]?.classList.add("active");

    Object.values(panels).forEach((p) => p && p.classList.remove("active"));
    panels[key]?.classList.add("active");
  }

  btns.home?.addEventListener("click", () => setActiveNav("home"));
  btns.agenda?.addEventListener("click", async () => { setActiveNav("agenda"); await loadAgenda(agendaRange); });
  btns.clients?.addEventListener("click", () => setActiveNav("clients"));
  btns.prestations?.addEventListener("click", () => setActiveNav("prestations"));
  btns.bookings?.addEventListener("click", () => setActiveNav("bookings"));
  btns.compta?.addEventListener("click", () => setActiveNav("compta"));

  /* ================= THEME + CLOSE + REFRESH ================= */
  $("closeBtn")?.addEventListener("click", () => {
    if (tg) tg.close();
    else window.close();
  });

  $("themeBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("shiny-mode");
    toast(document.body.classList.contains("shiny-mode") ? "✨ Mode ON" : "✨ Mode OFF");
  });

  $("refreshBtn")?.addEventListener("click", async () => {
    toast("↻ Refresh…");
    await loadAll();
    renderAll();
    await loadAgenda('today');
    toast("✅ OK");
  });

  
  /* ================= BOOKING ACTIONS (EDIT/DELETE) ================= */
  let ebModal = null;
  let ebCurrentId = null;

  function getBootstrapModal() {
    const el = document.getElementById("modalEditBooking");
    if (!el || !window.bootstrap) return null;
    if (!ebModal) ebModal = new window.bootstrap.Modal(el);
    return ebModal;
  }

  function fillPrestationOptions(selectedId) {
  const sel = $("ebPrestation");
  if (!sel) return;
  const list = (prestations || []).filter((p) => p.active);
  sel.innerHTML = list
    .map((p) => {
      const badge =
        p.category === "pack" ? "📦" :
        p.category === "service" ? "🧾" :
        p.category === "menage" ? "🧼" :
        p.category === "supplement" ? "🧶" :
        p.category === "devis" ? "🧾" : "🧾";
      const extra =
        p.category === "pack" ? `(${p.visits_per_day} visite/j)` :
        p.category === "service" ? `(${p.duration_min} min)` :
        "";
      return `<option value="${p.id}" ${Number(p.id) === Number(selectedId) ? "selected" : ""}>${badge} ${safe(p.name)} ${extra} • ${money(p.price_chf)} CHF</option>`;
    })
    .join("");
}

  async function openEditBooking(id) {
    try {
      const r = await apiFetch(`/api/bookings/${id}`);
      if (!r.ok) throw new Error("API");
      const b = await r.json();

      ebCurrentId = b.id;
      $("ebId").textContent = String(b.id);
      fillPrestationOptions(b.prestation_id);
      $("ebStart").value = safe(b.start_date);
      $("ebEnd").value = safe(b.end_date);
      $("ebSlot").value = safe(b.slot);
      $("ebTotalOverride").value = safe(b.total_chf);

      getBootstrapModal()?.show();
    } catch (e) {
      console.error(e);
      toast("❌ Impossible d’ouvrir");
    }
  }

  async function saveEditBooking() {
    if (!ebCurrentId) return;
    try {
      const payload = {
        prestation_id: Number($("ebPrestation").value),
        start_date: $("ebStart").value,
        end_date: $("ebEnd").value,
        slot: $("ebSlot").value,
        total_override: $("ebTotalOverride").value,
      };

      const initData = tg?.initData || "";
      const r = await fetch(`/api/bookings/${ebCurrentId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-InitData": initData,
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) throw new Error("API");
      toast("✅ Modifié");
      getBootstrapModal()?.hide();
      await loadAll();
      renderAll();
    await loadAgenda('today');
    } catch (e) {
      console.error(e);
      toast("❌ Échec modification");
    }
  }

  async function deleteBooking(id) {
    if (!id) return;
    if (!confirm(`Supprimer la réservation #${id} ?`)) return;
    try {
      const initData = tg?.initData || "";
      const r = await fetch(`/api/bookings/${id}`, {
        method: "DELETE",
        headers: { "X-Telegram-InitData": initData },
      });
      if (!r.ok) throw new Error("API");
      toast("🗑️ Supprimé");
      await loadAll();
      renderAll();
    await loadAgenda('today');
    } catch (e) {
      console.error(e);
      toast("❌ Échec suppression");
    }
  }

  $("ebSave")?.addEventListener("click", saveEditBooking);
  $("ebDelete")?.addEventListener("click", () => deleteBooking(ebCurrentId));

  // Delegation click
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!t) return;

    const btnE = t.closest?.(".act-edit-booking");
    if (btnE) return openEditBooking(btnE.getAttribute("data-id"));

    const btnD = t.closest?.(".act-del-booking");
    if (btnD) return deleteBooking(btnD.getAttribute("data-id"));
  });

/* ================= LOAD ================= */
  async function loadAll() {
    // si pas Telegram, on affiche accès refusé (car API va 401)
    try {
      const [rP, rC, rU, rPa, rCo] = await Promise.all([
        apiFetch("/api/prestations"),
        apiFetch("/api/clients"),
        apiFetch("/api/bookings/upcoming"),
        apiFetch("/api/bookings/past"),
        apiFetch("/api/compta/summary"),
      ]);

      if (!rP.ok || !rC.ok || !rU.ok || !rPa.ok || !rCo.ok) {
        const st = [rP, rC, rU, rPa, rCo].map((r) => r.status).join(", ");
        throw new Error(`API denied (${st})`);
      }

      prestations = await rP.json();
      clients = await rC.json();
      upcoming = await rU.json();
      past = await rPa.json();
      compta = await rCo.json();
    } catch (e) {
      console.error(e);
      toast("⛔ Accès refusé / API KO (ouvre depuis Telegram admin)");
      prestations = [];
      clients = [];
      upcoming = [];
      past = [];
      compta = null;
    }
  }

  /* ================= RENDER HOME ================= */
  function renderHome() {
    $("kpiUpcomingCount").textContent = safe(upcoming.length);
    $("kpiPastCount").textContent = safe(past.length);

    const next = upcoming[0];
    $("kpiNextBooking").textContent = next
      ? `${safe(next.start_date)} • ${safe(next.clients?.name)} • ${safe(next.prestations?.name)}`
      : "—";

    $("kpiTotalAll").textContent = compta ? money(compta.totalAll) : "—";
    $("kpiTotalCompany").textContent = compta ? money(compta.totalCompany) : "—";
    $("kpiTotalEmployees").textContent = compta ? money(compta.totalEmployee) : "—";

    // Home lists
    const upEl = $("upcomingList");
    const paEl = $("pastList");
    if (upEl) upEl.innerHTML = "";
    if (paEl) paEl.innerHTML = "";

    const makeItem = (b) => {
      const c = b.clients?.name || "—";
      const p = b.prestations?.name || "—";
      const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
      const slot = b.slot ? ` • ${b.slot.replace("matin_soir", "matin+soir")}` : "";
      return `
        <div class="list-group-item rounded-3 mb-2">
          <div class="d-flex justify-content-between flex-wrap gap-2">
            <div>
              <div class="fw-bold">#${b.id} • ${c}</div>
              <div class="muted">${safe(b.start_date)} → ${safe(b.end_date)}${slot}</div>
              <div class="muted">🐾 ${p}${emp}</div>
            </div>
            <div class="text-end">
              <div class="badge text-bg-danger">${money(b.total_chf)} CHF</div>
              <div class="muted small">${safe(b.days_count)} jour(s)</div>
            </div>
          </div>
        </div>
      `;
    };

    if (upEl) {
      const list = upcoming.slice(0, 8);
      upEl.innerHTML = list.length ? list.map(makeItem).join("") : `<div class="muted">Aucune réservation à venir.</div>`;
    }

    if (paEl) {
      const list = past.slice(0, 8);
      paEl.innerHTML = list.length ? list.map(makeItem).join("") : `<div class="muted">Aucune réservation passée.</div>`;
    }
  }

  /* ================= RENDER CLIENTS ================= */
  function renderClients() {
    const list = $("clientsList");
    if (!list) return;

    const q = norm($("clientsSearch")?.value);
    const items = clients.filter((c) => {
      if (!q) return true;
      const hay = [c.name, c.phone, c.address, c.notes].map(norm).join(" ");
      return hay.includes(q);
    });

    if (!items.length) {
      list.innerHTML = `<div class="muted">Aucun client.</div>`;
      return;
    }

    list.innerHTML = `
      <div class="row g-3">
        ${items
          .map((c) => {
            return `
              <div class="col-md-6">
                <div class="mini">
                  <div class="d-flex justify-content-between gap-2">
                    <div class="fw-bold">#${c.id} • ${safe(c.name)}</div>
                    <span class="badge text-bg-warning text-dark">Client</span>
                  </div>
                  <div class="muted mt-1">📞 ${safe(c.phone) || "—"}</div>
                  <div class="muted">📍 ${safe(c.address) || "—"}</div>
                  <div class="muted small mt-2">📝 ${safe(c.notes) || "—"}</div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  $("clientsSearch")?.addEventListener("input", renderClients);
  $("clientsClear")?.addEventListener("click", () => {
    $("clientsSearch").value = "";
    renderClients();
    toast("Recherche client effacée");
  });

  /* ================= RENDER PRESTATIONS ================= */
  function renderPrestations() {
    const grid = $("prestationsGrid");
    if (!grid) return;

    const q = norm($("prestaSearch")?.value);
    const animal = $("prestaAnimalFilter")?.value || "all";

    const items = prestations.filter((p) => {
      if (animal !== "all" && norm(p.animal_type) !== animal) return false;
      if (!q) return true;
      const hay = [p.name, p.animal_type, p.description, p.price_chf, p.visits_per_day, p.duration_min].map(norm).join(" ");
      return hay.includes(q);
    });

    if (!items.length) {
      grid.innerHTML = `<div class="muted">Aucune prestation.</div>`;
      return;
    }

    grid.innerHTML = `
      <div class="row g-3">
        ${items
          .map((p) => {
            const animalBadge =
              norm(p.animal_type) === "chat"
                ? "text-bg-danger"
                : norm(p.animal_type) === "lapin"
                ? "text-bg-warning text-dark"
                : "text-bg-info text-dark";

            return `
              <div class="col-md-6 col-lg-4">
                <div class="mini h-100">
                  <div class="d-flex justify-content-between gap-2">
                    <div class="fw-bold">${safe(p.name)}</div>
                    <span class="badge ${animalBadge}">${safe(p.animal_type)}</span>
                  </div>
                  <div class="muted mt-1">
                    💳 <b>${money(p.price_chf)} CHF</b> / jour
                  </div>
                  <div class="muted">
                    ⏱️ ${safe(p.duration_min)} min/j • ${safe(p.visits_per_day)} visite(s)
                  </div>
                  <div class="muted small mt-2">🧾 ${safe(p.description) || "—"}</div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  $("prestaSearch")?.addEventListener("input", renderPrestations);
  $("prestaAnimalFilter")?.addEventListener("change", renderPrestations);
  $("prestaClear")?.addEventListener("click", () => {
    $("prestaSearch").value = "";
    renderPrestations();
    toast("Recherche prestation effacée");
  });

  /* ================= RENDER BOOKINGS ================= */
  function renderBookings() {
    const up = $("bookingsUpcoming");
    const pa = $("bookingsPast");
    if (up) up.innerHTML = "";
    if (pa) pa.innerHTML = "";

    const makeItem = (b) => {
      const c = b.clients?.name || "—";
      const p = b.prestations?.name || "—";
      const emp = b.employees?.name ? `👩‍💼 ${b.employees.name}` : "—";
      const slot = b.slot ? b.slot.replace("matin_soir", "matin+soir") : "—";
      const isPast = new Date(safe(b.end_date)) < new Date();
      return `
        <div class="list-group-item rounded-3 mb-2">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <div class="fw-bold">#${b.id} • ${c}</div>
              <div class="muted">${safe(b.start_date)} → ${safe(b.end_date)} • ${safe(b.days_count)} jour(s)</div>
              <div class="muted">🐾 ${p} • ⏰ ${slot}</div>
              <div class="muted">Employé: ${emp}</div>
            </div>
            <div class="d-flex gap-2 flex-wrap justify-content-end">
              <button class="btn btn-sm btn-outline-warning act-edit-booking" data-id="${b.id}">✏️</button>
              <button class="btn btn-sm btn-outline-danger act-del-booking" data-id="${b.id}">🗑️</button>
            </div>
          </div>

          <div class="mt-2 d-flex gap-2 flex-wrap">
            <span class="badge text-bg-danger">Total ${money(b.total_chf)} CHF</span>
            <span class="badge text-bg-warning text-dark">ShaSitter ${money(b.company_part_chf)} CHF</span>
            <span class="badge text-bg-secondary">Employé ${money(b.employee_part_chf)} CHF</span>
          </div>
        </div>
      `;
    };

    if (up) up.innerHTML = upcoming.length ? upcoming.map(makeItem).join("") : `<div class="muted">Aucune réservation à venir.</div>`;
    if (pa) pa.innerHTML = past.length ? past.slice(0, 30).map(makeItem).join("") : `<div class="muted">Aucune réservation passée.</div>`;
  }

  /* ================= RENDER COMPTA ================= */
  function renderCompta() {
    $("comptaTotal").textContent = compta ? money(compta.totalAll) : "—";
    $("comptaEmp").textContent = compta ? money(compta.totalEmployee) : "—";
    $("comptaCo").textContent = compta ? money(compta.totalCompany) : "—";

    const monthsEl = $("comptaMonths");
    const clientsEl = $("comptaClients");
    const prestaEl = $("comptaPrestations");

    if (!compta) {
      if (monthsEl) monthsEl.innerHTML = `<div class="muted">—</div>`;
      if (clientsEl) clientsEl.innerHTML = `<div class="muted">—</div>`;
      if (prestaEl) prestaEl.innerHTML = `<div class="muted">—</div>`;
      return;
    }

    // Month bars
    if (monthsEl) {
      const max = Math.max(1, ...(compta.months || []).map((x) => Number(x.total || 0)));
      monthsEl.innerHTML = (compta.months || [])
        .slice(-12)
        .map((m) => {
          const pct = Math.min(100, Math.round((Number(m.total || 0) / max) * 100));
          return `
            <div class="mb-2">
              <div class="d-flex justify-content-between">
                <div class="muted">${safe(m.month)}</div>
                <div class="fw-bold">${money(m.total)} CHF</div>
              </div>
              <div style="height:10px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.10);">
                <div style="height:100%;width:${pct}%;background:rgba(255,193,7,.60)"></div>
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Top clients
    if (clientsEl) {
      clientsEl.innerHTML = (compta.topClients || [])
        .slice(0, 10)
        .map((c) => `<div class="d-flex justify-content-between mb-1"><div class="muted">${safe(c.name)}</div><div class="fw-bold">${money(c.total)} CHF</div></div>`)
        .join("") || `<div class="muted">—</div>`;
    }

    // Top prestas
    if (prestaEl) {
      prestaEl.innerHTML = (compta.topPrestations || [])
        .slice(0, 10)
        .map((p) => `<div class="d-flex justify-content-between mb-1"><div class="muted">${safe(p.name)}</div><div class="fw-bold">${money(p.total)} CHF</div></div>`)
        .join("") || `<div class="muted">—</div>`;
    }
  }

  function renderAll() {
    renderHome();
    renderAgenda();
    renderClients();
    renderPrestations();
    renderBookings();
    renderCompta();
  }


  /* ================= AGENDA V5 ================= */
  async function loadAgenda(range = "today") {
    agendaRange = range;
    const qs = new URLSearchParams();
    qs.set("range", range);

    const r = await apiFetch(`/api/agenda?${qs.toString()}`);
    if (!r.ok) {
      toast("⛔ Agenda indisponible");
      agenda = [];
      renderAgenda();
      return;
    }
    agenda = await r.json();
    renderAgenda();
  }

  function groupByDate(items) {
    const map = new Map();
    (items || []).forEach((it) => {
      const d = it.date;
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(it);
    });
    return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  }

  function renderAgenda() {
    const box = $("agendaContainer");
    if (!box) return;

    const groups = groupByDate(agenda);

    if (!groups.length) {
      box.innerHTML = `
        <div class="card card-soft text-white">
          <div class="card-body">
            <div class="text-secondary">Aucune visite pour cette période.</div>
          </div>
        </div>
      `;
      return;
    }

    const dayCard = (date, items) => {
      const morning = items.filter(x => x.slot === "matin");
      const evening = items.filter(x => x.slot === "soir");

      const mkRow = (s) => `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">
              ${safe(s.start_time || "")} <span class="text-secondary">—</span>
              <strong>${safe(s.client_name)}</strong>
              ${s.pet_name ? `— <span class="text-secondary">${safe(s.pet_name)}</span>` : ""}
            </div>
            <div class="li-sub text-secondary small">
              ${safe(s.prestation_name)} • ${money(s.price_chf)} CHF • ${safe(s.address_final || s.client_address || "")}
            </div>
            ${s.notes ? `<div class="li-sub text-secondary small">📝 ${safe(s.notes)}</div>` : ""}
          </div>
          <div class="li-actions">
            <a class="btn btn-sm btn-outline-light" href="/api/documents/devis/${s.group_id}">Devis PDF</a>
            <a class="btn btn-sm btn-outline-warning" href="/api/documents/facture/${s.group_id}">Facture PDF</a>
            <a class="btn btn-sm btn-outline-info" href="/api/export/${s.group_id}">Google .ics</a>
          </div>
        </div>
      `;

      const section = (title, arr, icon) => `
        <div class="card card-soft text-white mb-3">
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
              <div class="h5 mb-0">${icon} ${title}</div>
              <div class="text-secondary small">${arr.length} visite(s)</div>
            </div>
            <div class="list-plain">
              ${arr.length ? arr.map(mkRow).join("") : `<div class="text-secondary small">—</div>`}
            </div>
          </div>
        </div>
      `;

      return `
        <div class="mb-4">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <div class="h4 mb-0">📆 ${date}</div>
            <div class="text-secondary small">Total: ${money(items.reduce((a,x)=>a+Number(x.price_chf||0),0))} CHF</div>
          </div>
          ${section("Matin", morning, "🌅")}
          ${section("Soir", evening, "🌙")}
        </div>
      `;
    };

    box.innerHTML = groups.map(([d, items]) => dayCard(d, items)).join("");
  }

  // Boutons filtres agenda
  $("agToday")?.addEventListener("click", () => loadAgenda("today"));
  $("agTomorrow")?.addEventListener("click", () => loadAgenda("tomorrow"));
  $("agWeek")?.addEventListener("click", () => loadAgenda("week"));
  $("agUpcoming")?.addEventListener("click", () => loadAgenda("upcoming"));
  $("agPast")?.addEventListener("click", () => loadAgenda("past"));


  /* ================= INIT ================= */
  (async () => {
    await loadAll();
    renderAll();
    await loadAgenda('today');
  })();
})();
