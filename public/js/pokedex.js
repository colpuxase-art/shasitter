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

  async function apiRequest(url, opts = {}) {
    const initData = tg?.initData || "";
    const method = (opts.method || "GET").toUpperCase();
    const headers = {
      "X-Telegram-InitData": initData,
    };

    const init = { method, cache: "no-store", headers };

    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.json);
    }

    const r = await fetch(url, init);
    let payload = null;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        payload = await r.json();
      } catch {}
    } else {
      try {
        payload = await r.text();
      } catch {}
    }
    return { ok: r.ok, status: r.status, data: payload };
  }

  function slotLabel(s) {
    if (s === "matin") return "Matin";
    if (s === "soir") return "Soir";
    if (s === "matin_soir") return "Matin + soir";
    return "—";
  }

  /* ================= STATE ================= */
  let prestations = [];
  let clients = [];
  let upcoming = [];
  let past = [];
  let compta = null;

  let selectedClientId = null;
  let selectedClientBookings = [];

  /* ================= UI: NAV ================= */
  const panels = {
    home: $("panelHome"),
    clients: $("panelClients"),
    prestations: $("panelPrestations"),
    bookings: $("panelBookings"),
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
    await refreshSelectedClientBookings();
    renderAll();
    toast("✅ OK");
  });

  /* ================= LOAD ================= */
  async function loadAll() {
    try {
      const [rP, rC, rU, rPa, rCo] = await Promise.all([
        apiRequest("/api/prestations"),
        apiRequest("/api/clients"),
        apiRequest("/api/bookings/upcoming"),
        apiRequest("/api/bookings/past"),
        apiRequest("/api/compta/summary"),
      ]);

      if (!rP.ok || !rC.ok || !rU.ok || !rPa.ok || !rCo.ok) {
        const st = [rP.status, rC.status, rU.status, rPa.status, rCo.status].join(", ");
        throw new Error(`API denied (${st})`);
      }

      prestations = Array.isArray(rP.data) ? rP.data : [];
      clients = Array.isArray(rC.data) ? rC.data : [];
      upcoming = Array.isArray(rU.data) ? rU.data : [];
      past = Array.isArray(rPa.data) ? rPa.data : [];
      compta = rCo.data && typeof rCo.data === "object" ? rCo.data : null;
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

  async function loadClientBookings(clientId) {
    const r = await apiRequest(`/api/clients/${clientId}/bookings`);
    if (!r.ok) throw new Error(r?.data?.message || "API KO");
    return Array.isArray(r.data) ? r.data : [];
  }

  async function refreshSelectedClientBookings() {
    if (!selectedClientId) {
      selectedClientBookings = [];
      return;
    }
    try {
      selectedClientBookings = await loadClientBookings(selectedClientId);
    } catch (e) {
      console.error(e);
      toast("❌ Impossible de charger les prestations client");
      selectedClientBookings = [];
    }
  }

  /* ================= MODAL EDIT BOOKING ================= */
  let currentEditBookingId = null;
  const modalEl = $("editBookingModal");
  const bsModal = modalEl && window.bootstrap ? new window.bootstrap.Modal(modalEl) : null;

  function fillPrestaSelect() {
    const sel = $("editPrestation");
    if (!sel) return;
    sel.innerHTML = prestations
      .filter((p) => p.active !== false)
      .map((p) => `<option value="${p.id}">${safe(p.name)} — ${money(p.price_chf)} CHF</option>`)
      .join("");
  }

  function openEditBooking(b) {
    currentEditBookingId = b.id;
    fillPrestaSelect();

    $("editTitle").textContent = `✏️ Modifier réservation #${b.id}`;
    $("editStart").value = safe(b.start_date);
    $("editEnd").value = safe(b.end_date);
    $("editSlot").value = safe(b.slot || "matin");
    $("editPrestation").value = String(b.prestation_id);
    $("editHint").textContent = "Astuce: changer la prestation/dates recalcule le total automatiquement.";

    bsModal?.show();
  }

  async function saveEditBooking() {
    if (!currentEditBookingId) return;

    const payload = {
      prestation_id: Number($("editPrestation").value),
      start_date: $("editStart").value,
      end_date: $("editEnd").value,
      slot: $("editSlot").value,
    };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.end_date)) {
      toast("❌ Dates invalides");
      return;
    }

    const r = await apiRequest(`/api/bookings/${currentEditBookingId}`, { method: "PUT", json: payload });
    if (!r.ok) {
      toast("❌ Modification KO");
      console.error(r);
      return;
    }

    toast("✅ Modifié");
    bsModal?.hide();
    currentEditBookingId = null;

    await loadAll();
    await refreshSelectedClientBookings();
    renderAll();
  }

  $("editSaveBtn")?.addEventListener("click", saveEditBooking);

  /* ================= ACTIONS (delete / edit / view client bookings) ================= */
  async function deleteBooking(id) {
    if (!confirm(`Supprimer la réservation #${id} ?`)) return;
    const r = await apiRequest(`/api/bookings/${id}`, { method: "DELETE" });
    if (!r.ok) {
      toast("❌ Suppression KO");
      console.error(r);
      return;
    }
    toast("🗑️ Supprimé");
    await loadAll();
    await refreshSelectedClientBookings();
    renderAll();
  }

  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const viewBtn = t.closest("[data-action='view-client-bookings']");
    if (viewBtn) {
      const cid = Number(viewBtn.getAttribute("data-client-id"));
      if (!Number.isFinite(cid)) return;

      selectedClientId = cid;
      toast("📅 Chargement…");
      await refreshSelectedClientBookings();
      renderClientBookings();
      toast("✅ OK");
      return;
    }

    const delBtn = t.closest("[data-action='delete-booking']");
    if (delBtn) {
      const id = Number(delBtn.getAttribute("data-booking-id"));
      if (!Number.isFinite(id)) return;
      await deleteBooking(id);
      return;
    }

    const editBtn = t.closest("[data-action='edit-booking']");
    if (editBtn) {
      const id = Number(editBtn.getAttribute("data-booking-id"));
      if (!Number.isFinite(id)) return;

      // source: client bookings list first, else upcoming/past
      const b =
        selectedClientBookings.find((x) => x.id === id) ||
        upcoming.find((x) => x.id === id) ||
        past.find((x) => x.id === id);

      if (!b) {
        toast("❌ Booking introuvable");
        return;
      }

      openEditBooking({
        id: b.id,
        prestation_id: b.prestation_id,
        start_date: b.start_date,
        end_date: b.end_date,
        slot: b.slot,
      });
      return;
    }
  });

  $("clientBookingsClose")?.addEventListener("click", () => {
    selectedClientId = null;
    selectedClientBookings = [];
    renderClientBookings();
  });

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
    $("kpiTotalEmployees").textContent = compta ? money(compta.totalEmployees ?? compta.totalEmployee) : "—";

    const upEl = $("upcomingList");
    const paEl = $("pastList");
    if (upEl) upEl.innerHTML = "";
    if (paEl) paEl.innerHTML = "";

    const makeItem = (b) => {
      const c = b.clients?.name || "—";
      const p = b.prestations?.name || "—";
      const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
      const slot = b.slot ? ` • ${slotLabel(b.slot)}` : "";
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

  /* ================= RENDER CLIENT BOOKINGS (selected client) ================= */
  function renderClientBookings() {
    const wrap = $("clientBookingsWrap");
    const title = $("clientBookingsTitle");
    const sub = $("clientBookingsSubtitle");
    const list = $("clientBookingsList");

    if (!wrap || !list || !title || !sub) return;

    if (!selectedClientId) {
      wrap.style.display = "none";
      list.innerHTML = "";
      return;
    }

    const c = clients.find((x) => x.id === selectedClientId);
    title.textContent = `📅 Prestations — ${safe(c?.name || "Client")}`;
    sub.textContent = `Client #${selectedClientId} • ${selectedClientBookings.length} réservation(s)`;
    wrap.style.display = "block";

    if (!selectedClientBookings.length) {
      list.innerHTML = `<div class="muted">Aucune réservation pour ce client.</div>`;
      return;
    }

    list.innerHTML = selectedClientBookings
      .slice(0, 40)
      .map((b) => {
        const prestaName = b.prestations?.name || "—";
        const petName = b.pets?.name ? `🐾 ${b.pets.name}` : "";
        return `
          <div class="list-group-item rounded-3 mb-2">
            <div class="d-flex justify-content-between gap-2 flex-wrap">
              <div>
                <div class="fw-bold">#${b.id} • ${prestaName}</div>
                <div class="muted">${safe(b.start_date)} → ${safe(b.end_date)} • ⏰ ${slotLabel(b.slot)} ${petName}</div>
                <div class="muted small">Statut: ${safe(b.status || "—")}</div>
              </div>
              <div class="text-end">
                <div class="badge text-bg-danger">${money(b.total_chf)} CHF</div>
                <div class="mt-2 d-flex gap-2 justify-content-end flex-wrap">
                  <button class="btn btn-sm btn-outline-warning" data-action="edit-booking" data-booking-id="${b.id}">✏️</button>
                  <button class="btn btn-sm btn-outline-danger" data-action="delete-booking" data-booking-id="${b.id}">🗑️</button>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
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
                  <div class="d-flex justify-content-between gap-2 flex-wrap">
                    <div class="fw-bold">#${c.id} • ${safe(c.name)}</div>
                    <div class="d-flex gap-2">
                      <button class="btn btn-sm btn-outline-warning" data-action="view-client-bookings" data-client-id="${c.id}">📅 Prestations</button>
                      <span class="badge text-bg-warning text-dark">Client</span>
                    </div>
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

    renderClientBookings();
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

  /* ================= RENDER BOOKINGS (global) ================= */
  function renderBookings() {
    const up = $("bookingsUpcoming");
    const pa = $("bookingsPast");
    if (up) up.innerHTML = "";
    if (pa) pa.innerHTML = "";

    const makeItem = (b) => {
      const c = b.clients?.name || "—";
      const p = b.prestations?.name || "—";
      const emp = b.employees?.name ? `👩‍💼 ${b.employees.name}` : "—";
      const slot = slotLabel(b.slot);
      return `
        <div class="list-group-item rounded-3 mb-2">
          <div class="d-flex justify-content-between gap-2 flex-wrap">
            <div>
              <div class="fw-bold">#${b.id} • ${c}</div>
              <div class="muted">${safe(b.start_date)} → ${safe(b.end_date)} • ${safe(b.days_count)} jour(s)</div>
              <div class="muted">🐾 ${p} • ⏰ ${slot}</div>
              <div class="muted">Employé: ${emp}</div>
            </div>
            <div class="text-end">
              <div class="badge text-bg-danger">Total ${money(b.total_chf)} CHF</div>
              <div class="mt-2 d-flex gap-2 justify-content-end flex-wrap">
                <button class="btn btn-sm btn-outline-warning" data-action="edit-booking" data-booking-id="${b.id}">✏️</button>
                <button class="btn btn-sm btn-outline-danger" data-action="delete-booking" data-booking-id="${b.id}">🗑️</button>
              </div>
            </div>
          </div>
          <div class="mt-2 d-flex gap-2 flex-wrap">
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
    $("comptaEmp").textContent = compta ? money(compta.totalEmployees ?? compta.totalEmployee) : "—";
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

    if (clientsEl) {
      clientsEl.innerHTML =
        (compta.topClients || [])
          .slice(0, 10)
          .map(
            (c) =>
              `<div class="d-flex justify-content-between mb-1"><div class="muted">${safe(c.name)}</div><div class="fw-bold">${money(c.total)} CHF</div></div>`
          )
          .join("") || `<div class="muted">—</div>`;
    }

    if (prestaEl) {
      prestaEl.innerHTML =
        (compta.topPrestations || [])
          .slice(0, 10)
          .map(
            (p) =>
              `<div class="d-flex justify-content-between mb-1"><div class="muted">${safe(p.name)}</div><div class="fw-bold">${money(p.total)} CHF</div></div>`
          )
          .join("") || `<div class="muted">—</div>`;
    }
  }

  function renderAll() {
    renderHome();
    renderClients();
    renderPrestations();
    renderBookings();
    renderCompta();
  }

  /* ================= INIT ================= */
  (async () => {
    await loadAll();
    await refreshSelectedClientBookings();
    renderAll();
  })();
})();
