/* index.cjs — ShaSitter (PRIVATE Telegram mini-app) — V5 CLEAN (V4 compat + V5 groups/segments) */

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");
const { createEvents } = require("ics");
const PDFDocument = require("pdfkit");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;

/* ================== ENV ================== */
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const WEBAPP_URL = process.env.WEBAPP_URL;

const SHANA_CHAT_ID = process.env.SHANA_CHAT_ID; // Telegram chat id de Shana (rappels internes)
const REMINDERS_ENABLED = (process.env.REMINDERS_ENABLED || "true").toLowerCase() === "true";
const REMINDER_HOURS_BEFORE = Number(process.env.REMINDER_HOURS_BEFORE || 3);

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN manquant");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE manquants");
  process.exit(1);
}
if (!WEBAPP_URL) {
  console.error("⚠️ WEBAPP_URL manquant (Render env). Exemple: https://xxx.onrender.com");
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

/* ================== ADMIN ================== */
const ADMIN_IDS = new Set([6675436692,8275234190]); // <-- ton ID Telegram
const isAdmin = (chatId) => ADMIN_IDS.has(chatId);

/* ================== TELEGRAM BOT (409 FIX — STABLE) ================== */
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

let _pollingStarting = false;
async function startTelegramPolling() {
  if (_pollingStarting) return;
  _pollingStarting = true;

  try {
    try { await bot.deleteWebHook({ drop_pending_updates: true }); } catch {}
    try { await bot.stopPolling(); } catch {}
    await bot.startPolling({ restart: true, timeout: 10 });
    console.log("✅ Le sondage Telegram a commencé");
  } catch (e) {
    console.error("❌ startPolling err:", e?.message || e);
    setTimeout(startTelegramPolling, 2500);
  } finally {
    _pollingStarting = false;
  }
}
startTelegramPolling();

bot.on("polling_error", (e) => {
  const msg = e?.message || String(e || "");
  console.error("❌ polling_error :", msg);
  if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
    try { bot.stopPolling(); } catch {}
    setTimeout(startTelegramPolling, 3000);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Rejet non géré :", reason);
});

function safeStopPolling() {
  try { bot.stopPolling(); } catch {}
}
process.on("SIGTERM", () => { safeStopPolling(); process.exit(0); });
process.on("SIGINT", () => { safeStopPolling(); process.exit(0); });

/* ================== WEBAPP AUTH (tu laisses ouvert) ================== */
function requireAdminWebApp(req, res, next) {
  // Le bot est privé (admin Telegram), donc dashboard OK
  return next();
}

/* ================== UI HELPERS ================== */
function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
async function answerCbq(q) {
  try { await bot.answerCallbackQuery(q.id); } catch {}
}
function webAppUrl() {
  return WEBAPP_URL || "https://shasitter.onrender.com";
}
function money2(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}
function utcTodayISO() {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function daysInclusive(startDate, endDate) {
  const a = new Date(`${startDate}T00:00:00Z`);
  const b = new Date(`${endDate}T00:00:00Z`);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff + 1;
}
function addDaysISO(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/* ================== ADVANCED DAY PLANNER (V5 logique) ================== */
function buildDateList(startISO, endISO) {
  const n = daysInclusive(startISO, endISO);
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDaysISO(startISO, i));
  return out;
}
function getDayPlan(d, dateISO) {
  d.day_plans = d.day_plans || {};
  if (!d.day_plans[dateISO]) d.day_plans[dateISO] = { slot: null, matin_id: null, soir_id: null };
  return d.day_plans[dateISO];
}
function ensureDayPlan(st, dateISO) {
  // alias safe (évite bug "ensureDayPlan is not defined")
  return getDayPlan(st.data, dateISO);
}
function dayPlanIsComplete(plan) {
  if (!plan || !plan.slot) return false;
  if (plan.slot === "none") return true;
  if (plan.slot === "matin") return !!plan.matin_id;
  if (plan.slot === "soir") return !!plan.soir_id;
  if (plan.slot === "matin_soir") return !!plan.matin_id && !!plan.soir_id;
  return false;
}

const ANIMALS = ["chat", "lapin", "autre"];
const SLOTS = ["matin", "soir", "matin_soir"];

function slotLabel(s) {
  return s === "matin" ? "🌅 Matin" : s === "soir" ? "🌙 Soir" : "🌅🌙 Matin + soir";
}
function animalLabel(a) {
  return a === "chat" ? "🐱 Chat" : a === "lapin" ? "🐰 Lapin" : "🐾 Autre";
}
function visitsMultiplierFromSlot(slot) {
  return slot === "matin_soir" ? 2 : 1;
}

/* ================== DB HELPERS ================== */
async function dbListClients() {
  const { data, error } = await sb.from("clients").select("*").order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbGetClient(id) {
  const { data, error } = await sb.from("clients").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function dbInsertClient(payload) {
  const { data, error } = await sb.from("clients").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}
async function dbUpdateClient(id, payload) {
  const { data, error } = await sb.from("clients").update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
async function dbDeleteClient(id) {
  const { error } = await sb.from("clients").delete().eq("id", id);
  if (error) throw error;
  return true;
}

async function dbListEmployees() {
  const { data, error } = await sb.from("employees").select("*").order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbGetEmployee(id) {
  const { data, error } = await sb.from("employees").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function dbInsertEmployee(payload) {
  const { data, error } = await sb.from("employees").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}
async function dbUpdateEmployee(id, payload) {
  const { data, error } = await sb.from("employees").update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
async function dbDeleteEmployee(id) {
  const { error } = await sb.from("employees").delete().eq("id", id);
  if (error) throw error;
  return true;
}

async function dbListPrestations(activeOnly = false) {
  let q = sb.from("prestations").select("*").order("id", { ascending: true });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
async function dbGetPrestation(id) {
  const { data, error } = await sb.from("prestations").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function dbInsertPrestation(payload) {
  const { data, error } = await sb.from("prestations").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}
async function dbUpdatePrestation(id, payload) {
  const { data, error } = await sb.from("prestations").update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
async function dbDeletePrestation(id) {
  const { error } = await sb.from("prestations").delete().eq("id", id);
  if (error) throw error;
  return true;
}

async function dbListPetsByClient(clientId, activeOnly = false) {
  let q = sb.from("pets").select("*").eq("client_id", clientId).order("id", { ascending: true });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
async function dbGetPet(id) {
  const { data, error } = await sb.from("pets").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function dbInsertPet(payload) {
  const { data, error } = await sb.from("pets").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}
async function dbUpdatePet(id, payload) {
  const { data, error } = await sb.from("pets").update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
async function dbDeletePet(id) {
  const { error } = await sb.from("pets").delete().eq("id", id);
  if (error) throw error;
  return true;
}

/* V4 legacy bookings insert (compat) */
async function dbInsertBooking(payload) {
  const { data, error } = await sb.from("bookings").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

async function dbDeleteBooking(id) {
  const bid = Number(id);
  if (!Number.isFinite(bid)) throw new Error("invalid_id");
  try { await sb.from("booking_pets").delete().eq("booking_id", bid); } catch {}
  try { await sb.from("booking_supplements").delete().eq("booking_id", bid); } catch {}
  const { error } = await sb.from("bookings").delete().eq("id", bid);
  if (error) throw error;
  return true;
}

async function dbUpcomingBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(`*, clients (*), pets (*), prestations (*), employees (*)`)
    .gte("end_date", iso)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbPastBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(`*, clients (*), pets (*), prestations (*), employees (*)`)
    .lt("end_date", iso)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* ================== V5 DB HELPERS (groups + segments) ================== */
async function v5UpsertGroup({ group_id, client_id, start_date, end_date, notes, employee_id, employee_percent, status }) {
  const payload = {
    id: group_id,
    client_id,
    start_date,
    end_date,
    notes: notes || "",
    employee_id: employee_id || null,
    employee_percent: employee_id ? Number(employee_percent || 0) : 0,
    status: status || "confirmed",
  };

  // upsert
  const { error } = await sb.from("booking_groups").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

function splitDuoPriceDuration(presta, priceChf, durationMin) {
  const vpd = Number(presta.visits_per_day || 1);
  if (presta.category === "pack" && vpd === 2) {
    return {
      price_per_visit: money2(Number(priceChf || 0) / 2),
      duration_per_visit: Math.floor(Number(durationMin || 0) / 2),
    };
  }
  return { price_per_visit: money2(priceChf), duration_per_visit: Math.floor(durationMin || 0) };
}

// IMPORTANT: booking_segments = 1 ligne = 1 visite (matin ou soir)
async function v5InsertSegments({ group_id, client_id, pet_id, employee_id, notes, dayPlans }) {
  const rows = [];

  for (const date of Object.keys(dayPlans || {})) {
    const plan = dayPlans[date];
    if (!plan?.slot || plan.slot === "none") continue;

    if (plan.slot === "matin") {
      const presta = await dbGetPrestation(plan.matin_id);
      const { price_per_visit, duration_per_visit } = splitDuoPriceDuration(presta, presta.price_chf, presta.duration_min);
      rows.push({
        group_id,
        client_id,
        pet_id: pet_id || null,
        prestation_id: presta.id,
        date,
        slot: "matin",
        duration_min: duration_per_visit,
        price_chf: price_per_visit,
        employee_id: employee_id || null,
        notes: notes || "",
      });
      continue;
    }

    if (plan.slot === "soir") {
      const presta = await dbGetPrestation(plan.soir_id);
      const { price_per_visit, duration_per_visit } = splitDuoPriceDuration(presta, presta.price_chf, presta.duration_min);
      rows.push({
        group_id,
        client_id,
        pet_id: pet_id || null,
        prestation_id: presta.id,
        date,
        slot: "soir",
        duration_min: duration_per_visit,
        price_chf: price_per_visit,
        employee_id: employee_id || null,
        notes: notes || "",
      });
      continue;
    }

    // matin_soir
    // On veut 2 visites: matin + soir
    const prestaM = await dbGetPrestation(plan.matin_id);
    const prestaS = await dbGetPrestation(plan.soir_id);

    // Si duo pack (visits_per_day=2) choisi à la place des deux (ton auto-duo)
    // Ici: si les deux sont des packs de même family -> on cherche le pack duo et on l’utilise pour les 2 visites
    if (prestaM.category === "pack" && prestaS.category === "pack" && prestaM.pack_family && prestaM.pack_family === prestaS.pack_family) {
      const { data, error } = await sb
        .from("prestations")
        .select("*")
        .eq("active", true)
        .eq("category", "pack")
        .eq("visits_per_day", 2)
        .eq("pack_family", prestaM.pack_family)
        .limit(1);

      if (error) throw error;
      const duo = (data || [])[0];

      if (duo) {
        const { price_per_visit, duration_per_visit } = splitDuoPriceDuration(duo, duo.price_chf, duo.duration_min);
        rows.push({
          group_id, client_id, pet_id: pet_id || null, prestation_id: duo.id,
          date, slot: "matin",
          duration_min: duration_per_visit,
          price_chf: price_per_visit,
          employee_id: employee_id || null,
          notes: notes || "",
        });
        rows.push({
          group_id, client_id, pet_id: pet_id || null, prestation_id: duo.id,
          date, slot: "soir",
          duration_min: duration_per_visit,
          price_chf: price_per_visit,
          employee_id: employee_id || null,
          notes: notes || "",
        });
        continue;
      }
    }

    // Sinon: 2 prestations séparées
    const { price_per_visit: pm, duration_per_visit: dm } = splitDuoPriceDuration(prestaM, prestaM.price_chf, prestaM.duration_min);
    const { price_per_visit: ps, duration_per_visit: ds } = splitDuoPriceDuration(prestaS, prestaS.price_chf, prestaS.duration_min);

    rows.push({
      group_id, client_id, pet_id: pet_id || null, prestation_id: prestaM.id,
      date, slot: "matin",
      duration_min: dm,
      price_chf: pm,
      employee_id: employee_id || null,
      notes: notes || "",
    });
    rows.push({
      group_id, client_id, pet_id: pet_id || null, prestation_id: prestaS.id,
      date, slot: "soir",
      duration_min: ds,
      price_chf: ps,
      employee_id: employee_id || null,
      notes: notes || "",
    });
  }

  if (!rows.length) return;

  // insert en bulk
  const { error } = await sb.from("booking_segments").insert(rows);
  if (error) throw error;
}

async function v5RecalcGroupTotals(group_id) {
  // recalcul via segments
  const { data, error } = await sb
    .from("booking_segments")
    .select("price_chf,duration_min")
    .eq("group_id", group_id);

  if (error) throw error;

  const segs = data || [];
  const total_chf = money2(segs.reduce((a, s) => a + Number(s.price_chf || 0), 0));
  const total_duration_min = segs.reduce((a, s) => a + Number(s.duration_min || 0), 0);

  const { error: e2 } = await sb
    .from("booking_groups")
    .update({ total_chf, total_duration_min })
    .eq("id", group_id);

  if (e2) throw e2;
}

/* ================== API (Dashboard legacy + V5) ================== */
app.get("/api/prestations", requireAdminWebApp, async (req, res) => {
  try { res.json(await dbListPrestations(false)); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/clients", requireAdminWebApp, async (req, res) => {
  try { res.json(await dbListClients()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/employees", requireAdminWebApp, async (req, res) => {
  try { res.json(await dbListEmployees()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/bookings/upcoming", requireAdminWebApp, async (req, res) => {
  try { res.json(await dbUpcomingBookings()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/bookings/past", requireAdminWebApp, async (req, res) => {
  try { res.json(await dbPastBookings()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/clients/:id/bookings", requireAdminWebApp, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId)) return res.status(400).json({ error: "bad_request" });

    const { data, error } = await sb
      .from("bookings")
      .select("id,start_date,end_date,total_chf,prestation_id,prestations(name)")
      .eq("client_id", clientId)
      .order("start_date", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
app.delete("/api/bookings/:id", requireAdminWebApp, async (req, res) => {
  try { await dbDeleteBooking(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/bookings/:id", requireAdminWebApp, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_request" });

    const { data, error } = await sb
      .from("bookings")
      .select(`*, clients (*), pets (*), prestations (*), employees (*)`)
      .eq("id", id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});

/* ================== MENUS ================== */
function sendMainMenu(chatId) {
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ App privée ShaSitter. Accès refusé.");
  return bot.sendMessage(chatId, "🐱 *ShaSitter — Menu Admin*\nChoisis une catégorie 👇", {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "📊 Ouvrir l’app (dashboard)", web_app: { url: webAppUrl() } }],
      [
        { text: "👩‍💼 Employés", callback_data: "m_emps" },
        { text: "👤 Clients", callback_data: "m_clients" },
      ],
      [
        { text: "🧾 Prestations (catalogue)", callback_data: "m_prestas" },
        { text: "📅 Réservations (période)", callback_data: "m_book" },
      ],
      [
        { text: "⏰ À venir", callback_data: "list_upcoming" },
        { text: "🧾 Passées", callback_data: "list_past" },
      ],
      [{ text: "💰 Comptabilité", callback_data: "show_compta" }],
    ]),
  });
}

function sendEmployeesMenu(chatId) {
  return bot.sendMessage(chatId, "👩‍💼 *Employés* — Choisis :", {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "📋 Mes employés", callback_data: "emp_list" }],
      [{ text: "➕ Ajouter employé", callback_data: "emp_add" }],
      [{ text: "⬅️ Retour", callback_data: "back_main" }],
    ]),
  });
}
function sendClientsMenu(chatId) {
  return bot.sendMessage(chatId, "👤 *Clients* — Choisis :", {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "📋 Mes clients", callback_data: "cl_list" }],
      [{ text: "➕ Ajouter client", callback_data: "cl_add" }],
      [{ text: "⬅️ Retour", callback_data: "back_main" }],
    ]),
  });
}
function sendPrestationsMenu(chatId) {
  return bot.sendMessage(chatId, "🧾 *Prestations (catalogue)* — Choisis :", {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "📋 Mes prestations", callback_data: "pre_list" }],
      [{ text: "➕ Ajouter prestation", callback_data: "pre_add" }],
      [{ text: "⬅️ Retour", callback_data: "back_main" }],
    ]),
  });
}

/* ================== WIZARDS STATE ================== */
const wClient = new Map();
const wEmployee = new Map();
const wPresta = new Map();
const wPet = new Map();
const wBooking = new Map();

function cancelWizard(map, chatId, label) {
  map.delete(chatId);
  return bot.sendMessage(chatId, `❌ ${label} annulé.`, kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
}

/* ================== BOOKING FLOW ================== */
function bkNavRow() {
  return [{ text: "⬅️ Retour", callback_data: "bk_back" }, { text: "❌ Annuler", callback_data: "bk_cancel" }];
}
function setBkState(chatId, st) { wBooking.set(chatId, st); }
function getBkState(chatId) { return wBooking.get(chatId); }
function pushStep(st, step) { st.history = st.history || []; st.history.push(step); }
function popStep(st) { st.history = st.history || []; return st.history.pop(); }

function filterPrestations(prestas, { categories, animal_type, visits_per_day }) {
  const cats = Array.isArray(categories) ? categories : (categories ? [categories] : null);
  return (prestas || []).filter((p) => {
    if (p.active === false) return false;
    if (cats && !cats.includes(p.category)) return false;
    if (animal_type && !(p.animal_type === animal_type || p.animal_type === "autre")) return false;
    if (visits_per_day && p.category === "pack" && Number(p.visits_per_day) !== Number(visits_per_day)) return false;
    return true;
  });
}

async function renderPrestaPicker(chatId, st, title, storeKey, { categories, animal_type, visits_per_day }) {
  const d = st.data || {};
  const all = await dbListPrestations(true);
  const list = filterPrestations(all, { categories, animal_type, visits_per_day });

  if (!list.length) {
    return bot.sendMessage(chatId, `❌ Aucune prestation trouvée.`, { ...kb([bkNavRow()]) });
  }

  const pageSize = 10;
  d._presta_page = Number(d._presta_page || 0);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  d._presta_page = Math.max(0, Math.min(d._presta_page, totalPages - 1));

  d._presta_ctx = { title, storeKey, categories, animal_type, visits_per_day };
  st.data = d;
  setBkState(chatId, st);

  const slice = list.slice(d._presta_page * pageSize, d._presta_page * pageSize + pageSize);

  const rows = slice.map((p) => {
    const badge =
      p.category === "pack" ? "📦" :
      p.category === "service" ? "🧾" :
      p.category === "menage" ? "🧼" :
      p.category === "supplement" ? "🧶" :
      p.category === "devis" ? "🧾" : "🧾";

    const extra = p.category === "pack" ? `(${p.visits_per_day} visite/j)` : (p.category === "service" ? `(${p.duration_min} min)` : "");
    return [{ text: `${badge} ${p.name} ${extra} • ${p.price_chf} CHF`, callback_data: `bk_pickpresta_${p.id}` }];
  });

  const nav = [];
  if (d._presta_page > 0) nav.push({ text: "⬅️", callback_data: "bk_preva" });
  nav.push({ text: `Page ${d._presta_page + 1}/${totalPages}`, callback_data: "noop" });
  if (d._presta_page < totalPages - 1) nav.push({ text: "➡️", callback_data: "bk_nexta" });
  rows.push(nav);

  rows.push(bkNavRow());
  return bot.sendMessage(chatId, title, { parse_mode: "Markdown", ...kb(rows) });
}

function addonsTotal(d) {
  const arr = d.addons || [];
  return money2(arr.reduce((a, x) => a + Number(x.total || 0), 0));
}
function addonsText(d) {
  const arr = d.addons || [];
  if (!arr.length) return "— Aucun";
  return arr.map((x) => `• ${x.name}${x.qty ? ` (x${x.qty})` : ""} = ${money2(x.total)} CHF`).join("\n");
}
function devisTotal(d) {
  return money2(Number(d.devis_amount || 0));
}

/* ================== BOOKING STEP RENDER ================== */
async function renderBookingStep(chatId) {
  const st = getBkState(chatId);
  if (!st) return;
  const d = st.data || {};
  const step = st.step;

  const clientTxt = async () => {
    if (!d.client_id) return "—";
    try { const c = await dbGetClient(d.client_id); return `${c.name} (#${c.id})`; }
    catch { return `Client #${d.client_id}`; }
  };
  const petTxt = async () => {
    if (!d.pet_id) return "—";
    try { const p = await dbGetPet(d.pet_id); return `${p.name} (${animalLabel(p.animal_type)}) (#${p.id})`; }
    catch { return `Animal #${d.pet_id}`; }
  };
  async function getPetAnimalType() {
    if (!d.pet_id) return null;
    try { const p = await dbGetPet(d.pet_id); return p.animal_type || null; }
    catch { return null; }
  }

  // 1) client
  if (step === "pick_client") {
    const clients = await dbListClients();
    const rows = [
      [{ text: "➕ Nouveau client", callback_data: "bk_client_new" }],
      ...clients.slice(0, 25).map((c) => [{ text: `👤 ${c.name} (#${c.id})`, callback_data: `bk_client_${c.id}` }]),
      [{ text: "⬅️ Retour", callback_data: "back_main" }],
    ];
    return bot.sendMessage(chatId, "📅 *Nouvelle réservation*\n\n1/9 — Choisis le client :", { parse_mode: "Markdown", ...kb(rows) });
  }

  // 2) pet
  if (step === "pick_pet") {
    const pets = await dbListPetsByClient(d.client_id, true);
    const rows = [
      [{ text: "➕ Nouvel animal", callback_data: "bk_pet_new" }],
      ...pets.slice(0, 25).map((p) => [{ text: `${animalLabel(p.animal_type)} ${p.name} (#${p.id})`, callback_data: `bk_pet_${p.id}` }]),
      bkNavRow(),
    ];
    return bot.sendMessage(chatId, `2/9 — Choisis l’animal :\n\nClient: *${await clientTxt()}*`, { parse_mode: "Markdown", ...kb(rows) });
  }

  // 3) start_date
  if (step === "start_date") {
    return bot.sendMessage(chatId, `3/9 — Envoie la *date début* (YYYY-MM-DD)\n\nClient: *${await clientTxt()}*\nAnimal: *${await petTxt()}*`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }

  // 4) end_date
  if (step === "end_date") {
    return bot.sendMessage(chatId, `4/9 — Envoie la *date fin* (YYYY-MM-DD)\n\nDébut: *${d.start_date}*`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }

  // 5) day_slot (mode avancé)
  if (step === "day_slot") {
    const dates = d.dates || [];
    const idx = Number(d.day_index || 0);
    const date = dates[idx];
    if (!date) return bot.sendMessage(chatId, "❌ Aucune date (période invalide).", { ...kb([bkNavRow()]) });

    const plan = getDayPlan(d, date);
    const summary =
      `📅 Jour: *${date}* (${idx + 1}/${dates.length})\n` +
      `Créneau: *${plan.slot ? slotLabel(plan.slot) : "—"}*\n` +
      `Matin: *${plan.matin_id ? "#" + plan.matin_id : "—"}*\n` +
      `Soir: *${plan.soir_id ? "#" + plan.soir_id : "—"}*\n`;

    const rows = [
      [{ text: "🌅 Matin", callback_data: "bk_day_slot_matin" }],
      [{ text: "🌙 Soir", callback_data: "bk_day_slot_soir" }],
      [{ text: "🌅🌙 Matin + soir", callback_data: "bk_day_slot_matin_soir" }],
      [{ text: "⛔ Aucun ce jour", callback_data: "bk_day_slot_none" }],
    ];

    const nav = [];
    if (idx > 0) nav.push({ text: "⬅️ Jour précédent", callback_data: "bk_day_prev" });
    nav.push({ text: "➡️ Jour suivant", callback_data: "bk_day_next" });
    rows.push(nav);

    rows.push([
      { text: "📋 Copier jour précédent", callback_data: "bk_day_copy_prev" },
      { text: "📌 Appliquer ce modèle aux jours restants", callback_data: "bk_day_apply_all" },
    ]);

    rows.push(bkNavRow());
    return bot.sendMessage(chatId, `5/9 — Choisis le créneau pour ce jour\n\n${summary}`, { parse_mode: "Markdown", ...kb(rows) });
  }

  // 6) day_pick_matin
  if (step === "day_pick_matin") {
    const animal_type = await getPetAnimalType();
    const dates = d.dates || [];
    const idx = Number(d.day_index || 0);
    const date = dates[idx];
    return renderPrestaPicker(
      chatId, st,
      `6/9 — Choisis la prestation *Matin*\n\nJour: *${date}*\nAnimal: *${animalLabel(animal_type || "autre")}*`,
      "__day_matin",
      { categories: ["pack", "service"], animal_type, visits_per_day: 1 }
    );
  }

  // 7) day_pick_soir
  if (step === "day_pick_soir") {
    const animal_type = await getPetAnimalType();
    const dates = d.dates || [];
    const idx = Number(d.day_index || 0);
    const date = dates[idx];
    return renderPrestaPicker(
      chatId, st,
      `7/9 — Choisis la prestation *Soir*\n\nJour: *${date}*\nAnimal: *${animalLabel(animal_type || "autre")}*`,
      "__day_soir",
      { categories: ["pack", "service"], animal_type, visits_per_day: 1 }
    );
  }

  // addons
  if (step === "addons") {
    const all = await dbListPrestations(true);
    const addons = (all || []).filter((p) => (p.category === "supplement" || p.category === "menage") && p.active !== false);

    const pageSize = 10;
    d._addon_page = Number(d._addon_page || 0);
    const totalPages = Math.max(1, Math.ceil(addons.length / pageSize));
    d._addon_page = Math.max(0, Math.min(d._addon_page, totalPages - 1));

    const slice = addons.slice(d._addon_page * pageSize, d._addon_page * pageSize + pageSize);

    const rows = slice.map((p) => {
      const badge = p.category === "menage" ? "🧼" : "🧶";
      return [{ text: `➕ ${badge} ${p.name} • ${p.price_chf} CHF`, callback_data: `bk_add_${p.id}` }];
    });

    const nav = [];
    if (d._addon_page > 0) nav.push({ text: "⬅️", callback_data: "bk_add_prev" });
    nav.push({ text: `Page ${d._addon_page + 1}/${totalPages}`, callback_data: "noop" });
    if (d._addon_page < totalPages - 1) nav.push({ text: "➡️", callback_data: "bk_add_next" });
    rows.push(nav);

    rows.push([{ text: "🧾 Ajouter un devis personnalisé", callback_data: "bk_devis" }]);
    rows.push([{ text: "✅ Terminer (options)", callback_data: "bk_add_done" }]);
    rows.push(bkNavRow());

    const devisLine = Number(d.devis_amount || 0) > 0 ? `\n🧾 Devis: *${money2(d.devis_amount)} CHF*` : "";
    return bot.sendMessage(chatId, `🧩 *Options (uniques)*\n\nSélection actuelle:\n${addonsText(d)}${devisLine}`, {
      parse_mode: "Markdown",
      ...kb(rows),
    });
  }

  if (step === "devis_amount") {
    return bot.sendMessage(chatId, "🧾 Entre le *montant du devis* (CHF). Ex: 120", { parse_mode: "Markdown", ...kb([bkNavRow()]) });
  }
  if (step === "devis_note") {
    return bot.sendMessage(chatId, "📝 Note devis (ou envoie - pour ignorer)", { parse_mode: "Markdown", ...kb([bkNavRow()]) });
  }
  if (step === "addon_qty") {
    const pend = d._addon_pending;
    if (!pend) return bot.sendMessage(chatId, "❌ Option manquante.", { ...kb([bkNavRow()]) });
    const label = pend.qty_label || "Quantité";
    return bot.sendMessage(chatId, `🔢 ${label} — Envoie un nombre (ex: 2)\n\nOption: *${pend.name}* (${pend.price_chf} CHF)`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }

  if (step === "share_employee") {
    return bot.sendMessage(chatId, "8/9 — Partager avec un employé ?", {
      ...kb([
        [{ text: "✅ Oui", callback_data: "bk_share_yes" }],
        [{ text: "❌ Non", callback_data: "bk_share_no" }],
        bkNavRow(),
      ]),
    });
  }

  if (step === "pick_employee") {
    const emps = (await dbListEmployees()).filter((e) => e.active === true);
    const rows = [
      [{ text: "Aucun employé", callback_data: "bk_emp_none" }],
      ...emps.slice(0, 25).map((e) => [{ text: `👩‍💼 ${e.name} (#${e.id})`, callback_data: `bk_emp_${e.id}` }]),
      bkNavRow(),
    ];
    return bot.sendMessage(chatId, "Choisis l’employé :", { ...kb(rows) });
  }

  if (step === "employee_percent") {
    return bot.sendMessage(chatId, "Pourcentage employé (0-100). Ex: 30", { ...kb([bkNavRow()]) });
  }

  // recap
  if (step === "recap") {
    try {
      const dates = d.dates || [];
      const plans = d.day_plans || {};
      let total = 0;
      const lines = [];

      // calcul preview via day_plans (même logique que V5 segments)
      for (const date of dates) {
        const plan = plans[date];
        if (!plan?.slot || plan.slot === "none") continue;

        const addLine = async (slot, prestation_id, labelSlot) => {
          const presta = await dbGetPrestation(prestation_id);
          let linePrice = 0;

          // packs: par jour; services: par visite; mais ici on est par visite => on considère prix par visite pour v5
          if (presta.category === "pack" && Number(presta.visits_per_day) === 2) linePrice = money2(Number(presta.price_chf || 0) / 2);
          else linePrice = money2(Number(presta.price_chf || 0));

          total += linePrice;
          lines.push(`• ${date} — *${labelSlot}* — ${presta.name} — *${linePrice} CHF*`);
        };

        if (plan.slot === "matin") await addLine("matin", plan.matin_id, slotLabel("matin"));
        if (plan.slot === "soir") await addLine("soir", plan.soir_id, slotLabel("soir"));
        if (plan.slot === "matin_soir") {
          // Duo auto si possible
          const pM = await dbGetPrestation(plan.matin_id);
          const pS = await dbGetPrestation(plan.soir_id);

          if (pM.category === "pack" && pS.category === "pack" && pM.pack_family && pM.pack_family === pS.pack_family) {
            const { data } = await sb
              .from("prestations")
              .select("*")
              .eq("active", true)
              .eq("category", "pack")
              .eq("visits_per_day", 2)
              .eq("pack_family", pM.pack_family)
              .limit(1);
            const duo = (data || [])[0];
            if (duo) {
              await addLine("matin", duo.id, "🌅 Matin (duo)");
              await addLine("soir", duo.id, "🌙 Soir (duo)");
              continue;
            }
          }

          await addLine("matin", plan.matin_id, slotLabel("matin"));
          await addLine("soir", plan.soir_id, slotLabel("soir"));
        }
      }

      const optT = addonsTotal(d);
      const dvT = devisTotal(d);
      total = money2(total + optT + dvT);

      const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
      const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
      const coPart = d.employee_id ? money2(total - empPart) : total;

      d.total_chf = total;
      d.employee_part_chf = empPart;
      d.company_part_chf = coPart;
      setBkState(chatId, st);

      const empLine = d.employee_id ? `Employé: *${empPercent}%* → *${empPart} CHF*` : `Employé: *aucun*`;
      const devisLine = dvT > 0 ? `🧾 Devis: *${dvT} CHF*` : `🧾 Devis: —`;

      return bot.sendMessage(
        chatId,
        `🧾 *Récapitulatif*\n\n` +
          `Client: *${await clientTxt()}*\n` +
          `Animal: *${await petTxt()}*\n` +
          `Période: *${d.start_date} → ${d.end_date}*\n\n` +
          `📌 *Visites*\n${lines.join("\n") || "—"}\n\n` +
          `🧩 Options: *${optT} CHF*\n` +
          `${devisLine}\n\n` +
          `Total: *${total} CHF*\n` +
          `${empLine}\n` +
          `ShaSitter: *${coPart} CHF*`,
        {
          parse_mode: "Markdown",
          ...kb([
            [{ text: "✅ Confirmer", callback_data: "bk_confirm" }],
            [{ text: "⬅️ Retour (modifier)", callback_data: "bk_back" }],
            [{ text: "❌ Annuler", callback_data: "bk_cancel" }],
          ]),
        }
      );
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Erreur: ${e.message}`, { ...kb([bkNavRow()]) });
    }
  }
}

/* ================== /start ================== */
bot.onText(/\/start/, (msg) => sendMainMenu(msg.chat.id));

/* ================== CALLBACKS ================== */
bot.on("callback_query", async (q) => {
  const chatId = q?.message?.chat?.id;
  if (!chatId) return;
  await answerCbq(q);
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ Accès refusé.");

  // NAV
  if (q.data === "back_main") return sendMainMenu(chatId);
  if (q.data === "m_emps") return sendEmployeesMenu(chatId);
  if (q.data === "m_clients") return sendClientsMenu(chatId);
  if (q.data === "m_prestas") return sendPrestationsMenu(chatId);

  if (q.data === "m_book") {
    wBooking.set(chatId, { step: "pick_client", data: {}, history: [] });
    return renderBookingStep(chatId);
  }

  if (q.data === "noop") return;

  // booking nav
  if (q.data === "bk_cancel") return cancelWizard(wBooking, chatId, "Réservation");
  if (q.data === "bk_back") {
    const st = getBkState(chatId);
    if (!st) return;
    const prev = popStep(st);
    if (!prev) { wBooking.delete(chatId); return sendMainMenu(chatId); }
    st.step = prev;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // pick client
  if (q.data === "bk_client_new") {
    wClient.set(chatId, { step: "bk_name", data: { _returnToBooking: true }, history: [] });
    return bot.sendMessage(chatId, "👤 Nouveau client — Envoie le *nom* :", {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: "bk_back" }]]),
    });
  }
  if (q.data?.startsWith("bk_client_")) {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.data.client_id = Number(q.data.replace("bk_client_", ""));
    st.step = "pick_pet";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // pet new
  if (q.data === "bk_pet_new") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "pet_new_name";
    setBkState(chatId, st);

    return bot.sendMessage(chatId, "🐾 Nouvel animal — Choisis le type puis envoie le nom :", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🐱 Chat", callback_data: "pet_new_type_chat" }],
        [{ text: "🐰 Lapin", callback_data: "pet_new_type_lapin" }],
        [{ text: "🐾 Autre", callback_data: "pet_new_type_autre" }],
        bkNavRow(),
      ]),
    });
  }
  if (q.data?.startsWith("pet_new_type_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const t = q.data.replace("pet_new_type_", "");
    if (!ANIMALS.includes(t)) return;
    st.data._pet_new_type = t;
    setBkState(chatId, st);
    return bot.sendMessage(chatId, `OK. Type: ${animalLabel(t)}\nMaintenant envoie le *nom* de l’animal :`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }
  if (q.data?.startsWith("bk_pet_")) {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.data.pet_id = Number(q.data.replace("bk_pet_", ""));
    st.step = "start_date";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // pagination presta
  if (q.data === "bk_preva") {
    const st = getBkState(chatId);
    if (!st) return;
    st.data._presta_page = Math.max(0, Number(st.data._presta_page || 0) - 1);
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }
  if (q.data === "bk_nexta") {
    const st = getBkState(chatId);
    if (!st) return;
    st.data._presta_page = Number(st.data._presta_page || 0) + 1;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // pick prestation
  if (q.data?.startsWith("bk_pickpresta_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const id = Number(q.data.replace("bk_pickpresta_", ""));
    const ctx = st.data._presta_ctx;
    if (!ctx?.storeKey) return;

    pushStep(st, st.step);

    if (ctx.storeKey === "__day_matin" || ctx.storeKey === "__day_soir") {
      const dates = st.data.dates || [];
      const idx = Number(st.data.day_index || 0);
      const date = dates[idx];
      const plan = getDayPlan(st.data, date);
      if (ctx.storeKey === "__day_matin") plan.matin_id = id;
      if (ctx.storeKey === "__day_soir") plan.soir_id = id;
      st.data.day_plans[date] = plan;

      // auto advance if complete
      if (dayPlanIsComplete(plan)) {
        if (idx < dates.length - 1) {
          st.data.day_index = idx + 1;
          st.step = "day_slot";
        } else {
          st.step = "addons";
        }
      } else {
        // if matin_soir and just picked matin -> go pick soir
        if (plan.slot === "matin_soir" && !plan.soir_id) st.step = "day_pick_soir";
        else st.step = "day_slot";
      }

    } else {
      st.data[ctx.storeKey] = id;
    }

    st.data._presta_page = 0;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  /* ===== MODE AVANCÉ DAY SLOT CALLBACKS ===== */
  if (q.data?.startsWith("bk_day_slot_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const slot = q.data.replace("bk_day_slot_", "");
    const dates = st.data.dates || [];
    const idx = Number(st.data.day_index || 0);
    const date = dates[idx];
    if (!date) return;

    const plan = getDayPlan(st.data, date);
    plan.slot = slot;

    if (slot === "none") { plan.matin_id = null; plan.soir_id = null; }
    if (slot === "matin") { plan.soir_id = null; }
    if (slot === "soir") { plan.matin_id = null; }

    st.data.day_plans[date] = plan;

    pushStep(st, st.step);

    if (slot === "none") {
      if (idx >= dates.length - 1) st.step = "addons";
      else { st.data.day_index = idx + 1; st.step = "day_slot"; }
    } else if (slot === "matin") {
      st.step = "day_pick_matin";
      st.data._presta_page = 0;
    } else if (slot === "soir") {
      st.step = "day_pick_soir";
      st.data._presta_page = 0;
    } else {
      st.step = "day_pick_matin";
      st.data._presta_page = 0;
    }

    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_day_prev") {
    const st = getBkState(chatId);
    if (!st) return;
    st.data.day_index = Math.max(0, Number(st.data.day_index || 0) - 1);
    st.step = "day_slot";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_day_next") {
    const st = getBkState(chatId);
    if (!st) return;

    const dates = Array.isArray(st.data.dates) ? st.data.dates : [];
    const idx = Number(st.data.day_index || 0);
    const curDate = dates[idx];
    if (!curDate) return;

    const plan = ensureDayPlan(st, curDate);
    if (!dayPlanIsComplete(plan)) {
      return bot.sendMessage(chatId, "❌ Choisis d’abord le créneau + les prestations pour ce jour.", kb([[{ text: "⬅️ Retour", callback_data: "bk_back" }]]));
    }

    let next = idx + 1;
    while (next < dates.length) {
      const dp = ensureDayPlan(st, dates[next]);
      if (!dayPlanIsComplete(dp)) break;
      next++;
    }

    if (next >= dates.length) st.step = "addons";
    else { st.data.day_index = next; st.step = "day_slot"; }

    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_day_copy_prev") {
    const st = getBkState(chatId);
    if (!st) return;
    const dates = st.data.dates || [];
    const idx = Number(st.data.day_index || 0);
    if (idx <= 0) return;

    const prevDate = dates[idx - 1];
    const curDate = dates[idx];
    const prevPlan = getDayPlan(st.data, prevDate);
    const curPlan = getDayPlan(st.data, curDate);

    st.data.day_plans[curDate] = { ...curPlan, slot: prevPlan.slot, matin_id: prevPlan.matin_id, soir_id: prevPlan.soir_id };
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_day_apply_all") {
    const st = getBkState(chatId);
    if (!st) return;
    const dates = st.data.dates || [];
    const idx = Number(st.data.day_index || 0);
    const date = dates[idx];
    const plan = date ? getDayPlan(st.data, date) : null;

    if (!dayPlanIsComplete(plan)) {
      return bot.sendMessage(chatId, "❌ D’abord complète ce jour (créneau + prestations), puis applique.", { ...kb([bkNavRow()]) });
    }

    for (let i = idx; i < dates.length; i++) {
      const di = dates[i];
      st.data.day_plans[di] = { slot: plan.slot, matin_id: plan.matin_id || null, soir_id: plan.soir_id || null };
    }
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  /* ===== OPTIONS ===== */
  if (q.data && /^bk_add_\d+$/.test(q.data)) {
    const st = getBkState(chatId);
    if (!st) return;
    const pid = Number(q.data.replace("bk_add_", ""));
    const p = await dbGetPrestation(pid);

    if (!(p.category === "supplement" || p.category === "menage")) {
      return bot.sendMessage(chatId, "❌ Cette prestation n’est pas une option.", kb([[{ text: "⬅️ Retour", callback_data: "bk_back" }]]));
    }

    st.data.addons = st.data.addons || [];
    const exists = st.data.addons.some((x) => Number(x.id) === Number(p.id));
    if (exists) return renderBookingStep(chatId);

    if (p.ask_qty) {
      pushStep(st, st.step);
      st.data._addon_pending = { id: p.id, name: p.name, price_chf: Number(p.price_chf || 0), qty_label: p.qty_label || "Quantité" };
      st.step = "addon_qty";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }

    st.data.addons.push({ id: p.id, name: p.name, qty: 1, total: Number(p.price_chf || 0), category: p.category });
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_add_prev") {
    const st = getBkState(chatId);
    if (!st) return;
    st.data._addon_page = Number(st.data._addon_page || 0) - 1;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }
  if (q.data === "bk_add_next") {
    const st = getBkState(chatId);
    if (!st) return;
    st.data._addon_page = Number(st.data._addon_page || 0) + 1;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_devis") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "devis_amount";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_add_done") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "share_employee";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_share_yes") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "pick_employee";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_share_no") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.data.employee_id = null;
    st.data.employee_percent = 0;
    st.step = "recap";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data?.startsWith("bk_emp_") || q.data === "bk_emp_none") {
    const st = getBkState(chatId);
    if (!st) return;

    pushStep(st, st.step);

    if (q.data === "bk_emp_none") {
      st.data.employee_id = null;
      st.data.employee_percent = 0;
      st.step = "recap";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }

    const id = Number(q.data.replace("bk_emp_", ""));
    st.data.employee_id = id;
    st.step = "employee_percent";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  /* ===== CONFIRM: write V4 bookings + V5 groups/segments ===== */
  if (q.data === "bk_confirm") {
    const st = getBkState(chatId);
    if (!st) return;
    const d = st.data || {};

    try {
      // group_id unique
      const group_id = crypto.randomUUID();

      // 1) V4 legacy inserts (compat) -> on met juste une ligne "résumé" pour conserver l’historique
      //    (on garde ton ancien principe: 1 ligne par segment / addon / devis)
      //    MAIS la V5 vérité sera booking_segments.
      const createdLegacy = [];

      // segments day_plans => on convertit en legacy bookings (facultatif mais conservé)
      const dates = d.dates || [];
      const plans = d.day_plans || {};
      const allPrestas = await dbListPrestations(true);
      const devisPresta = (allPrestas || []).find((p) => p.category === "devis") || null;

      // helper compute legacy total per day for display (simple)
      async function legacyInsertLine({ prestation_id, slot, start_date, end_date, total_chf, days_count, notes }) {
        const empId = d.employee_id ? Number(d.employee_id) : null;
        const empPct = empId ? Math.max(0, Math.min(100, Number(d.employee_percent || 0))) : 0;
        const empPart = empId ? money2((total_chf * empPct) / 100) : 0;
        const coPart = empId ? money2(total_chf - empPart) : total_chf;

        const payload = {
          group_id,
          client_id: d.client_id,
          pet_id: d.pet_id || null,
          prestation_id,
          slot: slot || null,
          start_date,
          end_date,
          days_count,
          total_chf: money2(total_chf),
          employee_id: empId,
          employee_percent: empId ? empPct : 0,
          employee_part_chf: empPart,
          company_part_chf: coPart,
          notes: notes || "",
          status: "confirmed",
        };

        createdLegacy.push(await dbInsertBooking(payload));
      }

      // legacy: une ligne pack/service par jour (ou par plage) -> simple: on met une ligne "GLOBAL"
      // Pour éviter de casser ton dashboard V4 actuel, on fait une seule ligne “résumé”
      // (tu peux enlever si tu veux).
      const start_date = d.start_date;
      const end_date = d.end_date;
      await legacyInsertLine({
        prestation_id: (plans[dates[0]]?.matin_id) || (plans[dates[0]]?.soir_id) || allPrestas[0]?.id,
        slot: null,
        start_date,
        end_date,
        total_chf: Number(d.total_chf || 0),
        days_count: daysInclusive(start_date, end_date),
        notes: d.notes || "",
      });

      // legacy: options
      const addons = d.addons || [];
      for (const a of addons) {
        await legacyInsertLine({
          prestation_id: a.id,
          slot: null,
          start_date,
          end_date,
          total_chf: Number(a.total || 0),
          days_count: 1,
          notes: "",
        });
      }

      // legacy: devis
      const devisAmt = Number(d.devis_amount || 0);
      if (devisPresta && Number.isFinite(devisAmt) && devisAmt > 0) {
        await legacyInsertLine({
          prestation_id: devisPresta.id,
          slot: null,
          start_date,
          end_date,
          total_chf: devisAmt,
          days_count: 1,
          notes: d.devis_note || "",
        });
      }

      // 2) V5 write: booking_groups + booking_segments (source de vérité)
      await v5UpsertGroup({
        group_id,
        client_id: d.client_id,
        start_date: d.start_date,
        end_date: d.end_date,
        notes: d.notes || "",
        employee_id: d.employee_id || null,
        employee_percent: d.employee_id ? Number(d.employee_percent || 0) : 0,
        status: "confirmed",
      });

      await v5InsertSegments({
        group_id,
        client_id: d.client_id,
        pet_id: d.pet_id || null,
        employee_id: d.employee_id || null,
        notes: d.notes || "",
        dayPlans: d.day_plans || {},
      });

      await v5RecalcGroupTotals(group_id);

      wBooking.delete(chatId);

      const recap = createdLegacy
        .map((b) => `• #${b.id} — ${b.start_date || "—"}→${b.end_date || "—"} — *${b.total_chf} CHF*`)
        .join("\n");

      return bot.sendMessage(chatId, `✅ *Garde confirmée*\n\nGroup: \`${group_id}\`\n\nLegacy lignes: *${createdLegacy.length}*\n${recap}`, {
        parse_mode: "Markdown",
        ...kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]),
      });
    } catch (e) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, `❌ Ajout KO: ${e.message}`, kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
    }
  }

  // autres menus (employés/clients/prestas/pets) => je te laisse ton existant ici
  // (tu peux coller tes blocs tels quels après cette section si tu veux)
});

/* ================== TEXT INPUT HANDLER ================== */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!isAdmin(chatId)) return;
  if (text.startsWith("/")) return;

  // BOOKING typed steps
  const bk = getBkState(chatId);
  if (bk) {
    const d = bk.data || {};

    if (bk.step === "devis_amount") {
      const amt = Number(String(text).replace(",", "."));
      if (!Number.isFinite(amt) || amt < 0) return bot.sendMessage(chatId, "❌ Envoie un montant valide (ex: 120)");
      bk.data.devis_amount = money2(amt);
      pushStep(bk, bk.step);
      bk.step = "devis_note";
      setBkState(chatId, bk);
      return renderBookingStep(chatId);
    }

    if (bk.step === "devis_note") {
      const note = String(text || "").trim();
      bk.data.devis_note = note === "-" ? "" : note;
      pushStep(bk, bk.step);
      bk.step = "addons";
      setBkState(chatId, bk);
      return renderBookingStep(chatId);
    }

    if (bk.step === "addon_qty") {
      const pend = bk.data._addon_pending;
      const qty = Number(text);
      if (!pend) {
        bk.step = "addons";
        setBkState(chatId, bk);
        return renderBookingStep(chatId);
      }
      if (!Number.isFinite(qty) || qty < 1) return bot.sendMessage(chatId, "❌ Envoie un nombre >= 1");
      const qn = Math.floor(qty);
      bk.data.addons = bk.data.addons || [];
      bk.data.addons.push({
        id: pend.id,
        name: pend.name,
        qty: qn,
        total: money2(Number(pend.price_chf || 0) * qn),
        category: "supplement",
      });
      delete bk.data._addon_pending;
      pushStep(bk, bk.step);
      bk.step = "addons";
      setBkState(chatId, bk);
      return renderBookingStep(chatId);
    }

    if (bk.step === "pet_new_name") {
      if (!d.client_id) return bot.sendMessage(chatId, "❌ Client manquant.");
      const name = text;
      if (!name) return bot.sendMessage(chatId, "❌ Envoie un nom.");
      const type = d._pet_new_type || "chat";
      try {
        const pet = await dbInsertPet({ client_id: d.client_id, name, animal_type: type, notes: "", active: true });
        pushStep(bk, bk.step);
        bk.data.pet_id = pet.id;
        delete bk.data._pet_new_type;
        bk.step = "start_date";
        setBkState(chatId, bk);
        return renderBookingStep(chatId);
      } catch (e) {
        wBooking.delete(chatId);
        return bot.sendMessage(chatId, `❌ Création animal KO: ${e.message}`);
      }
    }

    if (bk.step === "start_date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      pushStep(bk, bk.step);
      bk.data.start_date = text;
      bk.step = "end_date";
      setBkState(chatId, bk);
      return renderBookingStep(chatId);
    }

    if (bk.step === "end_date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      pushStep(bk, bk.step);
      bk.data.end_date = text;

      const days = daysInclusive(bk.data.start_date, bk.data.end_date);
      if (days < 1) return bot.sendMessage(chatId, "❌ Dates invalides (fin avant début ?)");

      bk.data.dates = buildDateList(bk.data.start_date, bk.data.end_date);
      bk.data.day_index = 0;
      bk.data.day_plans = {};
      bk.step = "day_slot";

      setBkState(chatId, bk);
      return renderBookingStep(chatId);
    }

    if (bk.step === "employee_percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets un nombre 0-100");
      pushStep(bk, bk.step);
      bk.data.employee_percent = Math.floor(p);
      bk.step = "recap";
      setBkState(chatId, bk);
      return renderBookingStep(chatId);
    }
  }

  // tes wizards clients/employés/pets/prestas => tu peux garder ton code actuel (identique)
});

/* ================== V5 — AGENDA / EXPORT / PDF ================== */

// GET /api/agenda?date=YYYY-MM-DD | range=today|tomorrow|week|upcoming|past&client_id=&employee_id=&status=
app.get("/api/agenda", async (req, res) => {
  try {
    const { date, range, client_id, employee_id, status } = req.query;

    let q = sb.from("v_agenda_segments").select("*");

    if (client_id) q = q.eq("client_id", client_id);
    if (employee_id) q = q.eq("employee_id", employee_id);
    if (status) q = q.eq("status", status);

    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);

    if (date) q = q.eq("date", date);
    else if (range === "today") q = q.eq("date", fmt(today));
    else if (range === "tomorrow") { const t = new Date(today); t.setDate(t.getDate() + 1); q = q.eq("date", fmt(t)); }
    else if (range === "week") { const end = new Date(today); end.setDate(end.getDate() + 7); q = q.gte("date", fmt(today)).lt("date", fmt(end)); }
    else if (range === "past") q = q.lt("date", fmt(today));
    else if (range === "upcoming") q = q.gte("date", fmt(today));

    q = q.order("date", { ascending: true })
         .order("slot", { ascending: true })
         .order("start_time", { ascending: true, nullsFirst: false });

    const { data, error } = await q;
    if (error) return res.status(500).json({ error });
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Export Google Calendar (ICS) — GET /api/export/:groupId
app.get("/api/export/:groupId", async (req, res) => {
  try {
    const groupId = req.params.groupId;

    const { data, error } = await sb
      .from("v_agenda_segments")
      .select("*")
      .eq("group_id", groupId)
      .order("date", { ascending: true })
      .order("slot", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: false });

    if (error) return res.status(500).json({ error });
    const segments = data || [];
    if (!segments.length) return res.status(404).send("No segments for this group_id");

    const events = segments.map((seg) => {
      const d = new Date(seg.date);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const da = d.getDate();

      let hh = seg.slot === "soir" ? 18 : 9;
      let mm = 0;
      if (seg.start_time) {
        const [H, M] = String(seg.start_time).split(":");
        hh = parseInt(H || "0", 10);
        mm = parseInt(M || "0", 10);
      }

      const durMin = Number(seg.duration_min || 30);

      const title = `ShaSitter — ${seg.client_name}${seg.pet_name ? " — " + seg.pet_name : ""}`;
      const description =
        `Client: ${seg.client_name}\n` +
        (seg.client_phone ? `Tel: ${seg.client_phone}\n` : "") +
        `Adresse: ${seg.address_final || seg.client_address || ""}\n` +
        `Créneau: ${seg.slot}\n` +
        `Prestation: ${seg.prestation_name}\n` +
        (seg.notes ? `Notes: ${seg.notes}\n` : "");

      return {
        title,
        description,
        start: [y, m, da, hh, mm],
        duration: { minutes: durMin },
        location: seg.address_final || seg.client_address || "",
      };
    });

    createEvents(events, (err, value) => {
      if (err) return res.status(500).json({ error: err });
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="shasitter-${groupId}.ics"`);
      return res.send(value);
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// PDF Devis/Facture — GET /api/documents/:type/:groupId
app.get("/api/documents/:type/:groupId", async (req, res) => {
  try {
    const type = req.params.type;
    const groupId = req.params.groupId;
    if (!["devis", "facture"].includes(type)) return res.status(400).json({ error: "type must be devis or facture" });

    const { data, error } = await sb
      .from("v_agenda_segments")
      .select("*")
      .eq("group_id", groupId)
      .order("date", { ascending: true })
      .order("slot", { ascending: true });

    if (error) return res.status(500).json({ error });
    const segments = data || [];
    if (!segments.length) return res.status(404).send("No segments for this group_id");

    const first = segments[0];
    const total = segments.reduce((acc, s) => acc + Number(s.price_chf || 0), 0);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${groupId}.pdf"`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text(`ShaSitter — ${type === "devis" ? "Devis" : "Facture"}`, { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555").text(`Généré le: ${new Date().toLocaleString("fr-CH")}`);
    doc.moveDown();

    doc.fillColor("#000").fontSize(12).text(`Client: ${first.client_name}`);
    if (first.client_phone) doc.text(`Téléphone: ${first.client_phone}`);
    if (first.client_address) doc.text(`Adresse: ${first.client_address}`);
    doc.moveDown();

    doc.fontSize(12).text("Détail des visites", { underline: true });
    doc.moveDown(0.5);

    segments.forEach((s) => {
      const line = `${s.date} — ${String(s.slot).toUpperCase()} — ${s.prestation_name}${s.pet_name ? " — " + s.pet_name : ""} — ${Number(s.price_chf || 0).toFixed(2)} CHF`;
      doc.fontSize(11).text(line);
      if (s.notes) doc.fontSize(9).fillColor("#555").text(`Notes: ${s.notes}`).fillColor("#000");
    });

    doc.moveDown();
    doc.fontSize(14).text(`Total: ${total.toFixed(2)} CHF`, { align: "right" });

    doc.end();
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

/* ================== V5 — Rappels internes (Shana only) ================== */
const _sentReminders = new Map();
function _cleanupSent() {
  const now = Date.now();
  for (const [k, ts] of _sentReminders.entries()) {
    if (now - ts > 24 * 60 * 60 * 1000) _sentReminders.delete(k);
  }
}
function startV5ReminderCron() {
  if (!REMINDERS_ENABLED) return;
  if (!SHANA_CHAT_ID) {
    console.warn("⚠️ SHANA_CHAT_ID manquant: rappels désactivés");
    return;
  }

  cron.schedule("*/5 * * * *", async () => {
    try {
      _cleanupSent();

      const now = new Date();
      const target = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 60 * 60 * 1000);
      const dateStr = target.toISOString().slice(0, 10);

      const { data, error } = await sb
        .from("v_agenda_segments")
        .select("*")
        .eq("date", dateStr)
        .eq("status", "pending")
        .order("slot", { ascending: true })
        .order("start_time", { ascending: true, nullsFirst: false });

      if (error) return;

      (data || []).forEach((seg) => {
        const key = `${seg.segment_id}:${REMINDER_HOURS_BEFORE}`;
        if (_sentReminders.has(key)) return;

        const msg =
          `🔔 Rappel visite (${REMINDER_HOURS_BEFORE}h avant)\n\n` +
          `Client: ${seg.client_name}\n` +
          (seg.pet_name ? `Animal: ${seg.pet_name}\n` : "") +
          `Adresse: ${seg.address_final || seg.client_address || ""}\n` +
          `Créneau: ${seg.slot}\n` +
          `Prestation: ${seg.prestation_name}\n` +
          (seg.notes ? `Notes: ${seg.notes}\n` : "");

        bot.sendMessage(SHANA_CHAT_ID, msg).catch(() => {});
        _sentReminders.set(key, Date.now());
      });
    } catch {}
  });
}
startV5ReminderCron();

/* ================== START LISTEN ================== */
app.listen(PORT, () => console.log("ShaSitter server running on", PORT));
