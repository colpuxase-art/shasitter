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

  const fmtSlot = (s) =>
    s === "matin" ? "🌅 matin" : s === "soir" ? "🌙 soir" : s === "matin_soir" ? "🌅🌙 matin+soir" : safe(s || "—");

  const fmtDateFR = (iso) => {
    const v = safe(iso);
    if (!v) return "—";
    // iso YYYY-MM-DD
    const d = new Date(v + "T00:00:00");
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleDateString("fr-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const badgeStatus = (st) => {
    const s = norm(st);
    if (s === "done") return `<span class="badge text-bg-success">done</span>`;
    if (s === "cancelled") return `<span class="badge text-bg-secondary">cancelled</span>`;
    return `<span class="badge text-bg-warning text-dark">pending</span>`;
  };

  /* ================= STATE ================= */
  let prestations = [];
  let clients = [];
  let upcoming = [];
  let past = [];
  let compta = null;

  // Agenda V5
  let agendaRange = "today";
  let agendaItems = [];

  /* ================= UI: NAV ================= */
  const panels = {
    home: $("panelHome"),
    clients: $("panelClients"),
    prestations: $("panelPrestations"),
    bookings: $("panelBookings"), // -> Agenda
    compta: $("panelCompta"),
  };

  const btns = {
    home: $("btnHome"),
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

    // quand on ouvre l'agenda, on charge si vide
    if (key === "bookings") {
      if (!agendaItems?.length) {
        loadAgenda(agendaRange).then(renderAgenda).catch(() => {});
      }
    }
  }

  btns.home?.addEventListener("click", () => setActiveNav("home"));
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
    await loadAgenda(agendaRange);
    renderAll();
    toast("✅ OK");
  });

  /* ================= BOOKING ACTIONS (EDIT/DELETE) =================
     (legacy V4 modal, on le garde au cas où tu l'utilises encore)
  */
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
      await loadAgenda(agendaRange);
      renderAll();
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
      await loadAgenda(agendaRange);
      renderAll();
    } catch (e) {
      console.error(e);
      toast("❌ Échec suppression");
    }
  }

  $("ebSave")?.addEventListener("click", saveEditBooking);
  $("ebDelete")?.addEventListener("click", () => deleteBooking(ebCurrentId));

  // Delegation click legacy
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!t) return;

    const btnE = t.closest?.(".act-edit-booking");
    if (btnE) return openEditBooking(btnE.getAttribute("data-id"));

    const btnD = t.closest?.(".act-del-booking");
    if (btnD) return deleteBooking(btnD.getAttribute("data-id"));
  });

  /* ================= LOAD (V4 dashboard data) ================= */
  async function loadAll() {
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

  /* ================= LOAD AGENDA V5 ================= */
  async function loadAgenda(range = "today") {
    agendaRange = range;
    try {
      const r = await apiFetch(`/api/agenda?range=${encodeURIComponent(range)}`);
      if (!r.ok) throw new Error("agenda_api");
      agendaItems = await r.json();
    } catch (e) {
      console.error(e);
      agendaItems = [];
      toast("❌ Agenda KO");
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

            const cat = norm(p.category);
            const catBadge =
              cat === "pack" ? `<span class="badge text-bg-warning text-dark">pack</span>` :
              cat === "service" ? `<span class="badge text-bg-danger">service</span>` :
              cat === "supplement" ? `<span class="badge text-bg-secondary">supplement</span>` :
              cat === "menage" ? `<span class="badge text-bg-info text-dark">ménage</span>` :
              cat === "devis" ? `<span class="badge text-bg-light text-dark">devis</span>` :
              `<span class="badge text-bg-secondary">${safe(p.category)}</span>`;

            const priceUnit =
              cat === "service" ? " / visite" :
              (cat === "supplement" || cat === "menage" || cat === "devis") ? " (unique)" :
              " / jour";

            return `
              <div class="col-md-6 col-lg-4">
                <div class="mini h-100">
                  <div class="d-flex justify-content-between gap-2">
                    <div class="fw-bold">${safe(p.name)}</div>
                    <span class="badge ${animalBadge}">${safe(p.animal_type)}</span>
                  </div>
                  <div class="mt-2 d-flex gap-2 flex-wrap">${catBadge}</div>
                  <div class="muted mt-2">
                    💳 <b>${money(p.price_chf)} CHF</b>${priceUnit}
                  </div>
                  <div class="muted">
                    ⏱️ ${safe(p.duration_min)} min • ${safe(p.visits_per_day)} visite(s)/j
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

  /* ================= RENDER AGENDA (V5) ================= */
  function groupAgendaByDate(items) {
    const map = new Map();
    (items || []).forEach((x) => {
      const d = safe(x.date);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(x);
    });
    // sort by date
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  function renderAgenda() {
    const wrap = $("agendaContainer");
    if (!wrap) return;

    const items = agendaItems || [];
    if (!items.length) {
      wrap.innerHTML = `<div class="muted">Aucune visite pour ce filtre.</div>`;
      return;
    }

    const groups = groupAgendaByDate(items);

    wrap.innerHTML = groups
      .map(([date, arr]) => {
        // sort slot then time
        const sorted = arr.slice().sort((a, b) => {
          const sa = safe(a.slot);
          const sb = safe(b.slot);
          if (sa !== sb) return sa.localeCompare(sb);
          return safe(a.start_time).localeCompare(safe(b.start_time));
        });

        const morning = sorted.filter((x) => safe(x.slot) === "matin");
        const evening = sorted.filter((x) => safe(x.slot) === "soir");
        const other = sorted.filter((x) => safe(x.slot) !== "matin" && safe(x.slot) !== "soir");

        const block = (title, list) => {
          if (!list.length) return "";
          const total = list.reduce((a, x) => a + Number(x.price_chf || 0), 0);
          const dur = list.reduce((a, x) => a + Number(x.duration_min || 0), 0);

          return `
            <div class="mini mb-3">
              <div class="d-flex justify-content-between flex-wrap gap-2">
                <div class="fw-bold">${title}</div>
                <div class="muted small">${list.length} visite(s) • ${money(total)} CHF • ${dur} min</div>
              </div>
              <div class="mt-2">
                ${list
                  .map((s) => {
                    const g = safe(s.group_id);
                    const pet = s.pet_name ? ` • 🐾 ${safe(s.pet_name)}` : "";
                    const time = s.start_time ? `⏱️ ${safe(s.start_time).slice(0,5)} ` : "";
                    const addr = safe(s.address_final || s.client_address);
                    const emp = s.employee_name ? `👩‍💼 ${safe(s.employee_name)}` : "—";

                    return `
                      <div class="list-group-item rounded-3 mb-2">
                        <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                          <div>
                            <div class="fw-bold">${time} ${safe(s.client_name)}${pet}</div>
                            <div class="muted">${safe(s.prestation_name)} • ${money(s.price_chf)} CHF • ${safe(s.duration_min)} min</div>
                            <div class="muted small">📍 ${addr || "—"}</div>
                            <div class="muted small">Employé: ${emp} • ${badgeStatus(s.status)}</div>
                            ${s.notes ? `<div class="muted small mt-1">📝 ${safe(s.notes)}</div>` : ""}
                          </div>

                          <div class="d-flex gap-2 flex-wrap justify-content-end">
                            ${g ? `<a class="btn btn-sm btn-outline-light" href="/api/export/${encodeURIComponent(g)}" target="_blank">📅 ICS</a>` : ""}
                            ${g ? `<a class="btn btn-sm btn-outline-warning" href="/api/documents/devis/${encodeURIComponent(g)}" target="_blank">🧾 Devis PDF</a>` : ""}
                            ${g ? `<a class="btn btn-sm btn-outline-danger" href="/api/documents/facture/${encodeURIComponent(g)}" target="_blank">🧾 Facture PDF</a>` : ""}
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </div>
          `;
        };

        return `
          <div class="mb-4">
            <div class="control-pill mb-3">
              <div class="d-flex justify-content-between flex-wrap gap-2 align-items-center">
                <div class="fw-bold">📅 ${fmtDateFR(date)}</div>
                <div class="muted small">Total: ${arr.length} visite(s) • ${money(arr.reduce((a,x)=>a+Number(x.price_chf||0),0))} CHF</div>
              </div>
            </div>

            ${block("🌅 Matin", morning)}
            ${block("🌙 Soir", evening)}
            ${block("📌 Autres", other)}
          </div>
        `;
      })
      .join("");
  }

  /* ================= AGENDA FILTER BUTTONS ================= */
  function setActiveAgendaFilter(range) {
    document.querySelectorAll(".agenda-filter").forEach((b) => b.classList.remove("active"));
    const btn = document.querySelector(`.agenda-filter[data-range="${range}"]`);
    btn?.classList.add("active");
  }

  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    const b = t?.closest?.(".agenda-filter");
    if (!b) return;
    const range = b.getAttribute("data-range");
    if (!range) return;

    setActiveAgendaFilter(range);
    toast("↻ Agenda…");
    await loadAgenda(range);
    renderAgenda();
    toast("✅ OK");
  });

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
    renderClients();
    renderPrestations();
    renderAgenda();
    renderCompta();
  }

  /* ================= INIT ================= */
  (async () => {
    setActiveAgendaFilter(agendaRange);
    await loadAll();
    await loadAgenda(agendaRange);
    renderAll();
  })();
})();
