/* index.cjs — ShaSitter — TELEGRAM PRIVATE ADMIN + DASHBOARD + BOOKINGS SMART SLOTS + SUPPLEMENTS + ANTI-409 */

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const WEBAPP_URL = process.env.WEBAPP_URL || "https://shasitter.onrender.com";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN manquant");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE manquants");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

/* ================== ADMIN ================== */
const ADMIN_IDS = new Set([6675436692]); // <-- ton ID Telegram
const isAdmin = (chatId) => ADMIN_IDS.has(chatId);

/* ================== TELEGRAM BOT — ANTI-409 HARD FIX ==================
   Render peut lancer 2 instances pendant un deploy => 409 getUpdates
   On auto-répare : stopPolling -> deleteWebhook -> restartPolling
*/
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
let pollingStarted = false;

async function startPollingSafe() {
  if (pollingStarted) return;
  pollingStarted = true;

  try {
    await bot.deleteWebHook({ drop_pending_updates: true });
  } catch {}

  try {
    bot.startPolling({ interval: 300, params: { timeout: 10 } });
    console.log("✅ Telegram polling démarré");
  } catch (e) {
    pollingStarted = false;
    console.error("❌ startPolling error:", e.message);
  }
}

async function restartPollingSafe() {
  try {
    pollingStarted = false;
    try { bot.stopPolling(); } catch {}
    try { await bot.deleteWebHook({ drop_pending_updates: true }); } catch {}
  } catch {}
  await new Promise((r) => setTimeout(r, 1500));
  await startPollingSafe();
}

bot.on("polling_error", async (err) => {
  const msg = err?.message || "";
  if (msg.includes("409")) {
    console.error("⚠️ 409 détecté -> restart polling...");
    await restartPollingSafe();
    return;
  }
  console.error("erreur : [polling_error]", err);
});

startPollingSafe();

/* ================== HELPERS ================== */
function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
async function answerCbq(q) {
  try { await bot.answerCallbackQuery(q.id); } catch {}
}
function money2(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return confirms2(x);
}
function confirms2(x){ return Math.round(x * 100) / 100; }

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
function addDaysISO(dateISO, days) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const ANIMALS = ["chat", "lapin", "autre"];
const SLOTS = ["matin", "soir", "matin_soir"];

function slotLabel(s) {
  return s === "matin" ? "🌅 Matin" : s === "soir" ? "🌙 Soir" : "🌅🌙 Matin + soir";
}
function animalLabel(a) {
  return a === "chat" ? "🐱 Chat" : a === "lapin" ? "🐰 Lapin" : "🐾 Autre";
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
async function dbListPetsByClient(clientId, activeOnly = true) {
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

async function dbListPrestationsAll() {
  const { data, error } = await sb.from("prestations").select("*").eq("active", true).order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbGetPrestation(id) {
  const { data, error } = await sb.from("prestations").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function dbInsertBooking(payload) {
  const { data, error } = await sb.from("bookings").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}
async function dbDeleteBooking(id) {
  const bid = Number(id);
  if (!Number.isFinite(bid)) throw new Error("invalid_id");

  // pivots optionnels si tu les ajoutes plus tard
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

function computeEmployeeSplit(total, employee_id, employee_percent) {
  if (!employee_id) {
    return { employee_percent: 0, employee_part_chf: 0, company_part_chf: money2(total) };
  }
  const p = Math.max(0, Math.min(100, Number(employee_percent || 0)));
  const emp = money2((total * p) / 100);
  const co = money2(total - emp);
  return { employee_percent: Math.floor(p), employee_part_chf: emp, company_part_chf: co };
}

/* ================== API (Dashboard) ================== */
app.get("/api/prestations", async (req, res) => {
  try { res.json(await dbListPrestationsAll()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/clients", async (req, res) => {
  try { res.json(await dbListClients()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/bookings/upcoming", async (req, res) => {
  try { res.json(await dbUpcomingBookings()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/bookings/past", async (req, res) => {
  try { res.json(await dbPastBookings()); }
  catch (e) { res.status(500).json({ error: "db_error", message: e.message }); }
});
app.get("/api/clients/:id/bookings", async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId)) return res.status(400).json({ error: "bad_request" });
    const { data, error } = await sb
      .from("bookings")
      .select("id,client_id,pet_id,prestation_id,slot,start_date,end_date,days_count,total_chf,status,notes,prestations(name),pets(name)")
      .eq("client_id", clientId)
      .order("start_date", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
app.delete("/api/bookings/:id", async (req, res) => {
  try {
    await dbDeleteBooking(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});

// (optionnel) si ton front fait pas DELETE
app.post("/api/bookings/delete", async (req, res) => {
  try {
    const { id } = req.body || {};
    await dbDeleteBooking(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});

/* ================== START SERVER ================== */
app.listen(PORT, () => console.log(`✅ Serveur Web sur :${PORT}`));

/* ================== BOT MENUS ================== */
async function sendMainMenu(chatId) {
  return bot.sendMessage(
    chatId,
    "╭────────────────────╮\n" +
      "   🐾 *ShaSitter — Admin*\n" +
      "╰────────────────────╯\n\n" +
      "Choisis une action :",
    {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "📅 Nouvelle réservation", callback_data: "m_book" }],
        [{ text: "⏰ Réservations à venir", callback_data: "list_upcoming" }],
        [{ text: "🧾 Réservations passées", callback_data: "list_past" }],
        [{ text: "👤 Clients", callback_data: "m_clients" }],
        [{ text: "🌐 Dashboard (Mini App)", web_app: { url: WEBAPP_URL } }],
      ]),
    }
  );
}
async function sendClientsMenu(chatId) {
  const clients = await dbListClients();
  const rows = clients.slice(0, 25).map((c) => [{ text: `👤 #${c.id} ${c.name}`, callback_data: `cl_open_${c.id}` }]);
  rows.push([{ text: "⬅️ Retour", callback_data: "back_main" }]);
  return bot.sendMessage(chatId, "👤 *Clients*\n\nChoisis :", { parse_mode: "Markdown", ...kb(rows) });
}

/* ================== BOOKING STATE ================== */
const wBooking = new Map();
const wBookingCtx = new Map(); // chatId -> { clientId }
const wClientInline = new Map(); // simple “create client” in booking
const wPetInline = new Map(); // create pet in booking

function pushStep(st, step) {
  st.history = st.history || [];
  st.history.push(step);
}
function popStep(st) {
  st.history = st.history || [];
  return st.history.pop();
}
function bkNavRow() {
  return [{ text: "⬅️ Retour", callback_data: "bk_back" }, { text: "❌ Annuler", callback_data: "bk_cancel" }];
}
function bkBackBtn() {
  return { text: "⬅️ Retour", callback_data: "bk_back" };
}
function setBkState(chatId, st) { wBooking.set(chatId, st); }
function getBkState(chatId) { return wBooking.get(chatId); }
function cancelBooking(chatId) {
  wBooking.delete(chatId);
  return bot.sendMessage(chatId, "❌ Réservation annulée.", kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
}

/* ================== PRESTATIONS FILTER + PAGINATION ==================
   👉 important: tu voyais “des prestations manquantes” car on montrait max 25.
   Ici: pagination.
*/
function filterPrestationsForBooking(all, { animal_type, needed_visits, category }) {
  return all.filter((p) => {
    if (!p.active) return false;
    if (category && p.category !== category) return false;
    // animal match (ou 'autre' accepté)
    if (animal_type && !(p.animal_type === animal_type || p.animal_type === "autre")) return false;
    // visits_per_day => 1 ou 2 selon besoin
    if (needed_visits && Number(p.visits_per_day) !== Number(needed_visits)) return false;
    return true;
  });
}

async function renderPickPrestation(chatId, title, st, keyToStore, opts) {
  const all = await dbListPrestationsAll();
  const list = filterPrestationsForBooking(all, opts);

  const pageSize = 10;
  st.data._presta_pick = { keyToStore, opts, title };
  st.data._presta_page = st.data._presta_page ?? 0;

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(st.data._presta_page, totalPages - 1);
  st.data._presta_page = page;

  const slice = list.slice(page * pageSize, page * pageSize + pageSize);

  const rows = slice.map((p) => [
    { text: `🧾 ${p.name} • ${p.price_chf} CHF`, callback_data: `bk_pickpresta_${p.id}` },
  ]);

  const nav = [];
  if (page > 0) nav.push({ text: "⬅️", callback_data: "bk_preva" });
  nav.push({ text: `Page ${page + 1}/${totalPages}`, callback_data: "noop" });
  if (page < totalPages - 1) nav.push({ text: "➡️", callback_data: "bk_nexta" });
  rows.push(nav);

  rows.push([bkBackBtn()]);

  setBkState(chatId, st);
  return bot.sendMessage(chatId, title, { parse_mode: "Markdown", ...kb(rows) });
}

/* ================== SUPPLEMENTS PICK ==================
   On prend prestations.category='supplement'
   billing_type :
   - unique : qty=1
   - par_action : qty demandé
   - par_chat : qty demandé
*/
async function renderSupplements(chatId, st) {
  const all = await dbListPrestationsAll();
  const sups = all.filter((p) => p.active && p.category === "supplement");

  st.data.supplements = st.data.supplements || [];
  const chosen = st.data.supplements;

  const txtChosen = chosen.length
    ? chosen.map((x) => `• ${x.name} x${x.qty} = ${money2(x.total)} CHF`).join("\n")
    : "— Aucun";

  const rows = sups.slice(0, 20).map((p) => [
    { text: `➕ ${p.name} • ${p.price_chf} CHF`, callback_data: `bk_sup_${p.id}` },
  ]);

  rows.push([{ text: "✅ Terminer suppléments", callback_data: "bk_sup_done" }]);
  rows.push([bkBackBtn()]);

  return bot.sendMessage(
    chatId,
    `🧶 *Suppléments*\n\nChoisis (tu peux en ajouter plusieurs) :\n\nSélection actuelle:\n${txtChosen}`,
    { parse_mode: "Markdown", ...kb(rows) }
  );
}

function supplementsTotal(st) {
  const arr = st.data.supplements || [];
  return money2(arr.reduce((a, x) => a + Number(x.total || 0), 0));
}

/* ================== SMART SLOT SPLIT (NO DB CHANGE) ==================
   Multi-jours:
   - 1er jour: slot_start (matin/soir/matin_soir)
   - jours du milieu: toujours matin_soir
   - dernier jour: slot_end (matin/soir/matin_soir)

   On crée jusqu'à 3 bookings selon le cas.
*/
function buildSegments(st) {
  const d = st.data;
  const start = d.start_date;
  const end = d.end_date;
  const nDays = daysInclusive(start, end);

  if (nDays <= 0) throw new Error("Dates invalides");
  if (nDays === 1) {
    // un seul booking
    return [{
      slot: d.slot_single, // matin/soir/matin_soir
      start_date: start,
      end_date: end,
      prestation_id: d.prestation_single_day, // choisi selon 1 ou 2 visites
    }];
  }

  const segs = [];
  const startSlot = d.slot_start;
  const endSlot = d.slot_end;

  // day1
  if (startSlot === "matin") segs.push({ slot: "matin", start_date: start, end_date: start, prestation_id: d.prestation_matin });
  if (startSlot === "soir") segs.push({ slot: "soir", start_date: start, end_date: start, prestation_id: d.prestation_soir });
  if (startSlot === "matin_soir") segs.push({ slot: "matin_soir", start_date: start, end_date: start, prestation_id: d.prestation_full });

  // middle full-days
  const midStart = addDaysISO(start, 1);
  const midEnd = addDaysISO(end, -1);
  const midDays = daysInclusive(midStart, midEnd);
  if (midDays >= 1) {
    segs.push({ slot: "matin_soir", start_date: midStart, end_date: midEnd, prestation_id: d.prestation_full });
  }

  // last day
  if (endSlot === "matin") segs.push({ slot: "matin", start_date: end, end_date: end, prestation_id: d.prestation_matin });
  if (endSlot === "soir") segs.push({ slot: "soir", start_date: end, end_date: end, prestation_id: d.prestation_soir });
  if (endSlot === "matin_soir") segs.push({ slot: "matin_soir", start_date: end, end_date: end, prestation_id: d.prestation_full });

  // si start_date+1 > end_date-1, mid segment n’existe pas (ex: 2 jours)
  // on garde day1 + day2 et c’est ok.

  return segs;
}

/* ================== BOOKING FLOW ================== */
async function renderBookingStep(chatId) {
  const st = getBkState(chatId);
  if (!st) return;
  const d = st.data || {};

  const clientTxt = async () => {
    if (!d.client_id) return "—";
    try { const c = await dbGetClient(d.client_id); return `${c.name} (#${c.id})`; } catch { return `Client #${d.client_id}`; }
  };
  const petTxt = async () => {
    if (!d.pet_id) return "—";
    try { const p = await dbGetPet(d.pet_id); return `${p.name} (${animalLabel(p.animal_type)}) (#${p.id})`; } catch { return `Animal #${d.pet_id}`; }
  };

  if (st.step === "pick_client") {
    const clients = await dbListClients();
    const rows = [
      [{ text: "➕ Nouveau client", callback_data: "bk_client_new" }],
      ...clients.slice(0, 20).map((c) => [{ text: `👤 ${c.name} (#${c.id})`, callback_data: `bk_client_${c.id}` }]),
      [{ text: "⬅️ Retour", callback_data: "back_main" }],
    ];
    return bot.sendMessage(chatId, "📅 *Nouvelle réservation*\n\n1/8 — Choisis le client :", { parse_mode: "Markdown", ...kb(rows) });
  }

  if (st.step === "pick_pet") {
    const pets = await dbListPetsByClient(d.client_id, true);
    const rows = [
      [{ text: "➕ Ajouter un animal", callback_data: "bk_pet_new" }],
      ...pets.slice(0, 20).map((p) => [{ text: `🐾 ${p.name} (${animalLabel(p.animal_type)})`, callback_data: `bk_pet_${p.id}` }]),
      [bkBackBtn()],
    ];
    return bot.sendMessage(chatId, `2/8 — Choisis l’animal\n\nClient: *${await clientTxt()}*`, { parse_mode: "Markdown", ...kb(rows) });
  }

  if (st.step === "pet_new_type") {
    return bot.sendMessage(chatId, "➕ Nouvel animal — Type ?", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🐱 Chat", callback_data: "bk_pet_type_chat" }],
        [{ text: "🐰 Lapin", callback_data: "bk_pet_type_lapin" }],
        [{ text: "🐾 Autre", callback_data: "bk_pet_type_autre" }],
        [bkBackBtn()],
      ]),
    });
  }

  if (st.step === "start_date") {
    return bot.sendMessage(chatId, `3/8 — Envoie la *date début* (YYYY-MM-DD)\n\nClient: *${await clientTxt()}*\nAnimal: *${await petTxt()}*`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }

  if (st.step === "end_date") {
    return bot.sendMessage(chatId, `4/8 — Envoie la *date fin* (YYYY-MM-DD)\n\nDébut: *${d.start_date}*`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }

  // si 1 seul jour => slot unique
  if (st.step === "slot_single") {
    return bot.sendMessage(chatId, "5/8 — Choisis le créneau (1 jour) :", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🌅 Matin (1 visite)", callback_data: "bk_slot_single_matin" }],
        [{ text: "🌙 Soir (1 visite)", callback_data: "bk_slot_single_soir" }],
        [{ text: "🌅🌙 Matin+soir (2 visites)", callback_data: "bk_slot_single_matin_soir" }],
        [bkBackBtn()],
      ]),
    });
  }

  // si plusieurs jours => slot start/end
  if (st.step === "slot_start") {
    return bot.sendMessage(chatId, "5/8 — Début : quel créneau le *1er jour* ?", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🌅 Matin (1 visite)", callback_data: "bk_slot_start_matin" }],
        [{ text: "🌙 Soir (1 visite)", callback_data: "bk_slot_start_soir" }],
        [{ text: "🌅🌙 Matin+soir (2 visites)", callback_data: "bk_slot_start_matin_soir" }],
        [bkBackBtn()],
      ]),
    });
  }

  if (st.step === "slot_end") {
    return bot.sendMessage(chatId, "6/8 — Fin : quel créneau le *dernier jour* ?", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🌅 Matin (1 visite)", callback_data: "bk_slot_end_matin" }],
        [{ text: "🌙 Soir (1 visite)", callback_data: "bk_slot_end_soir" }],
        [{ text: "🌅🌙 Matin+soir (2 visites)", callback_data: "bk_slot_end_matin_soir" }],
        [bkBackBtn()],
      ]),
    });
  }

  // pick prestations selon besoin
  if (st.step === "pick_presta_single_day") {
    const pet = await dbGetPet(d.pet_id);
    const needed_visits = d.slot_single === "matin_soir" ? 2 : 1;
    return renderPickPrestation(
      chatId,
      `6/8 — Choisis la prestation (1 jour)\n\nBesoin: *${needed_visits} visite(s)*\nAnimal: *${animalLabel(pet.animal_type)}*`,
      st,
      "prestation_single_day",
      { animal_type: pet.animal_type, needed_visits, category: "pack" }
    );
  }

  if (st.step === "pick_presta_full") {
    const pet = await dbGetPet(d.pet_id);
    return renderPickPrestation(
      chatId,
      `7/8 — Prestation pour les *jours complets* (matin+soir)\nAnimal: *${animalLabel(pet.animal_type)}*`,
      st,
      "prestation_full",
      { animal_type: pet.animal_type, needed_visits: 2, category: "pack" }
    );
  }

  if (st.step === "pick_presta_matin") {
    const pet = await dbGetPet(d.pet_id);
    return renderPickPrestation(
      chatId,
      `7/8 — Prestation pour un *Matin seul* (1 visite)\nAnimal: *${animalLabel(pet.animal_type)}*`,
      st,
      "prestation_matin",
      { animal_type: pet.animal_type, needed_visits: 1, category: "pack" }
    );
  }

  if (st.step === "pick_presta_soir") {
    const pet = await dbGetPet(d.pet_id);
    return renderPickPrestation(
      chatId,
      `7/8 — Prestation pour un *Soir seul* (1 visite)\nAnimal: *${animalLabel(pet.animal_type)}*`,
      st,
      "prestation_soir",
      { animal_type: pet.animal_type, needed_visits: 1, category: "pack" }
    );
  }

  if (st.step === "supplements") {
    return renderSupplements(chatId, st);
  }

  if (st.step === "share_employee") {
    const emps = await dbListEmployees();
    const rows = [[{ text: "— Aucun employé", callback_data: "bk_emp_none" }]];
    rows.push(...emps.slice(0, 20).map((e) => [{ text: `👩‍💼 ${e.name} (défaut ${e.default_percent}%)`, callback_data: `bk_emp_${e.id}` }]));
    rows.push([bkBackBtn()]);
    return bot.sendMessage(chatId, "8/8 — Attribuer à un employé ?", { parse_mode: "Markdown", ...kb(rows) });
  }

  if (st.step === "employee_percent") {
    const e = d.employee_id ? await dbGetEmployee(d.employee_id) : null;
    const suggested = e?.default_percent ?? 0;
    return bot.sendMessage(chatId, `Envoie le *% employé* (0-100)\nExemple: ${suggested}`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }

  if (st.step === "recap") {
    const supTotal = supplementsTotal(st);

    // segments
    const segs = buildSegments(st);

    // compute each segment total
    const detail = [];
    let total = 0;

    for (const seg of segs) {
      const presta = await dbGetPrestation(seg.prestation_id);
      const days = daysInclusive(seg.start_date, seg.end_date);
      const t = money2(Number(presta.price_chf) * days);
      total += t;
      detail.push(`• ${seg.start_date}→${seg.end_date} — *${slotLabel(seg.slot)}* — ${presta.name} — *${t} CHF*`);
    }

    total = money2(total + supTotal);

    const split = computeEmployeeSplit(total, d.employee_id, d.employee_percent);
    const empLine = d.employee_id ? `Employé: *${split.employee_percent}%* → *${split.employee_part_chf} CHF*` : `Employé: *aucun*`;

    return bot.sendMessage(
      chatId,
      `🧾 *Récapitulatif*\n\n` +
        `Client: *${await clientTxt()}*\n` +
        `Animal: *${await petTxt()}*\n` +
        `Période: *${d.start_date} → ${d.end_date}*\n\n` +
        `📌 *Découpage (calcul correct)*\n${detail.join("\n")}\n\n` +
        `🧶 Suppléments: *${supTotal} CHF*\n\n` +
        `💵 Total: *${total} CHF*\n` +
        `${empLine}\n` +
        `ShaSitter: *${split.company_part_chf} CHF*`,
      {
        parse_mode: "Markdown",
        ...kb([
          [{ text: "✅ Confirmer", callback_data: "bk_confirm" }],
          [{ text: "⬅️ Retour", callback_data: "bk_back" }],
          [{ text: "❌ Annuler", callback_data: "bk_cancel" }],
        ]),
      }
    );
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

  if (q.data === "noop") return;

  if (q.data === "back_main") return sendMainMenu(chatId);

  if (q.data === "m_clients") return sendClientsMenu(chatId);

  if (q.data === "list_upcoming") {
    const rows = await dbUpcomingBookings();
    if (!rows.length) return bot.sendMessage(chatId, "⏰ Aucune réservation à venir.", kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
    const txt = rows.slice(0, 30).map((b) => {
      const c = b.clients?.name || "—";
      const pet = b.pets?.name ? ` • 🐾 ${b.pets.name}` : "";
      const p = b.prestations?.name || "—";
      return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${pet} • ${p} • ${b.total_chf} CHF`;
    }).join("\n");
    return bot.sendMessage(chatId, `⏰ *À venir*:\n\n${txt}`, { parse_mode: "Markdown", ...kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]) });
  }

  if (q.data === "list_past") {
    const rows = await dbPastBookings();
    if (!rows.length) return bot.sendMessage(chatId, "🧾 Aucune réservation passée.", kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
    const txt = rows.slice(0, 30).map((b) => {
      const c = b.clients?.name || "—";
      const pet = b.pets?.name ? ` • 🐾 ${b.pets.name}` : "";
      const p = b.prestations?.name || "—";
      return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${pet} • ${p} • ${b.total_chf} CHF`;
    }).join("\n");
    return bot.sendMessage(chatId, `🧾 *Passées*:\n\n${txt}`, { parse_mode: "Markdown", ...kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]) });
  }

  // NEW BOOKING
  if (q.data === "m_book") {
    wBooking.set(chatId, { step: "pick_client", data: {}, history: [] });
    return renderBookingStep(chatId);
  }

  // booking nav
  if (q.data === "bk_cancel") return cancelBooking(chatId);
  if (q.data === "bk_back") {
    const st = getBkState(chatId);
    if (!st) return sendMainMenu(chatId);
    const prev = popStep(st);
    if (!prev) {
      wBooking.delete(chatId);
      return sendMainMenu(chatId);
    }
    st.step = prev;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // choose client
  if (q.data === "bk_client_new") {
    wClientInline.set(chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "👤 Nouveau client — Envoie le *nom* :", { parse_mode: "Markdown", ...kb([bkNavRow()]) });
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

  // choose pet
  if (q.data === "bk_pet_new") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "pet_new_type";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data?.startsWith("bk_pet_type_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const t = q.data.replace("bk_pet_type_", "");
    if (!ANIMALS.includes(t)) return;
    wPetInline.set(chatId, { step: "name", data: { animal_type: t } });
    pushStep(st, st.step);
    st.step = "pet_new_name";
    setBkState(chatId, st);
    return bot.sendMessage(chatId, `Envoie le *nom* de l’animal.\nType: ${animalLabel(t)}`, { parse_mode: "Markdown", ...kb([bkNavRow()]) });
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

  // prestations pagination nav
  if (q.data === "bk_preva") {
    const st = getBkState(chatId);
    if (!st) return;
    st.data._presta_page = Math.max(0, (st.data._presta_page || 0) - 1);
    setBkState(chatId, st);
    // re-render current prestation screen
    const pick = st.data._presta_pick;
    if (!pick) return;
    st.step = st.step; // same
    return renderPickPrestation(chatId, pick.title, st, pick.keyToStore, pick.opts);
  }
  if (q.data === "bk_nexta") {
    const st = getBkState(chatId);
    if (!st) return;
    st.data._presta_page = (st.data._presta_page || 0) + 1;
    setBkState(chatId, st);
    const pick = st.data._presta_pick;
    if (!pick) return;
    return renderPickPrestation(chatId, pick.title, st, pick.keyToStore, pick.opts);
  }

  // pick prestation from list
  if (q.data?.startsWith("bk_pickpresta_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const id = Number(q.data.replace("bk_pickpresta_", ""));
    const pick = st.data._presta_pick;
    if (!pick) return;
    st.data[pick.keyToStore] = id;

    // flow routing
    if (st.step === "pick_presta_single_day") {
      pushStep(st, st.step);
      st.step = "supplements";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }

    if (st.step === "pick_presta_full") {
      pushStep(st, st.step);
      st.step = "pick_presta_matin";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }
    if (st.step === "pick_presta_matin") {
      pushStep(st, st.step);
      st.step = "pick_presta_soir";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }
    if (st.step === "pick_presta_soir") {
      pushStep(st, st.step);
      st.step = "supplements";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }
  }

  // single-day slot
  if (q.data?.startsWith("bk_slot_single_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const s = q.data.replace("bk_slot_single_", "");
    if (!SLOTS.includes(s)) return;
    pushStep(st, st.step);
    st.data.slot_single = s;
    st.step = "pick_presta_single_day";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // multi-day start/end slot
  if (q.data?.startsWith("bk_slot_start_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const s = q.data.replace("bk_slot_start_", "");
    if (!SLOTS.includes(s)) return;
    pushStep(st, st.step);
    st.data.slot_start = s;
    st.step = "slot_end";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data?.startsWith("bk_slot_end_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const s = q.data.replace("bk_slot_end_", "");
    if (!SLOTS.includes(s)) return;
    pushStep(st, st.step);
    st.data.slot_end = s;
    st.step = "pick_presta_full";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // supplements add
  if (q.data?.startsWith("bk_sup_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const sid = Number(q.data.replace("bk_sup_", ""));
    const p = await dbGetPrestation(sid);

    st.data._pending_sup = { id: p.id, name: p.name, price: Number(p.price_chf), billing_type: p.billing_type };
    setBkState(chatId, st);

    if (p.billing_type === "unique") {
      st.data.supplements = st.data.supplements || [];
      st.data.supplements.push({ id: p.id, name: p.name, qty: 1, unit: Number(p.price_chf), total: Number(p.price_chf) });
      delete st.data._pending_sup;
      setBkState(chatId, st);
      return renderSupplements(chatId, st);
    }

    return bot.sendMessage(chatId, `Quantité pour *${p.name}* ? (ex: 1, 2, 3)`, { parse_mode: "Markdown", ...kb([bkNavRow()]) });
  }

  if (q.data === "bk_sup_done") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "share_employee";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // employee
  if (q.data === "bk_emp_none") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.data.employee_id = null;
    st.data.employee_percent = 0;
    st.step = "recap";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data?.startsWith("bk_emp_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const id = Number(q.data.replace("bk_emp_", ""));
    pushStep(st, st.step);
    st.data.employee_id = id;
    st.step = "employee_percent";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // confirm => create 1..3 bookings
  if (q.data === "bk_confirm") {
    const st = getBkState(chatId);
    if (!st) return;

    try {
      const d = st.data;
      const segs = buildSegments(st);

      const supArr = d.supplements || [];
      const supTotal = supplementsTotal(st);

      // total supplements -> on met tout sur le 1er segment (simple, total exact)
      // (si tu veux, je peux répartir “par_jour” plus tard)
      let created = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const presta = await dbGetPrestation(seg.prestation_id);
        const days = daysInclusive(seg.start_date, seg.end_date);
        let t = money2(Number(presta.price_chf) * days);
        if (i === 0) t = money2(t + supTotal);

        const split = computeEmployeeSplit(t, d.employee_id, d.employee_percent);

        const payload = {
          client_id: d.client_id,
          pet_id: d.pet_id,
          prestation_id: seg.prestation_id,
          slot: seg.slot,
          start_date: seg.start_date,
          end_date: seg.end_date,
          days_count: days,
          total_chf: t,
          employee_id: d.employee_id || null,
          employee_percent: split.employee_percent,
          employee_part_chf: split.employee_part_chf,
          company_part_chf: split.company_part_chf,
          notes: JSON.stringify({ supplements: supArr, smart_split: true }),
          status: "confirmed",
        };

        const row = await dbInsertBooking(payload);
        created.push(row);
      }

      wBooking.delete(chatId);

      const msg =
        `✅ *Réservation confirmée*\n\n` +
        `Segments créés: *${created.length}*\n` +
        created.map((b) => `• #${b.id} — ${b.start_date}→${b.end_date} — ${slotLabel(b.slot)} — *${b.total_chf} CHF*`).join("\n");

      return bot.sendMessage(chatId, msg, { parse_mode: "Markdown", ...kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]) });
    } catch (e) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, `❌ Erreur: ${e.message}`, kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
    }
  }

  // open client
  if (q.data?.startsWith("cl_open_")) {
    const id = Number(q.data.replace("cl_open_", ""));
    const c = await dbGetClient(id);
    wBookingCtx.set(chatId, { clientId: id });
    return bot.sendMessage(chatId, `👤 *${c.name}* (#${c.id})`, {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "📅 Prestations (client)", callback_data: `cl_book_${c.id}` }],
        [{ text: "⬅️ Retour", callback_data: "m_clients" }],
      ]),
    });
  }

  // client bookings list + delete
  if (q.data?.startsWith("cl_book_")) {
    const clientId = Number(q.data.replace("cl_book_", ""));
    const c = await dbGetClient(clientId);

    const { data, error } = await sb
      .from("bookings")
      .select(`*, pets(name,animal_type), prestations(name)`)
      .eq("client_id", clientId)
      .order("start_date", { ascending: false });

    if (error) return bot.sendMessage(chatId, `❌ DB: ${error.message}`);

    const rows = (data || []).slice(0, 20).map((b) => [
      { text: `#${b.id} • ${b.start_date}→${b.end_date} • ${b.prestations?.name || "—"} • ${b.total_chf} CHF`, callback_data: `bk_delask_${b.id}` },
    ]);
    rows.push([{ text: "➕ Nouvelle réservation", callback_data: "m_book" }]);
    rows.push([{ text: "⬅️ Retour", callback_data: `cl_open_${clientId}` }]);

    return bot.sendMessage(chatId, `📅 Prestations — *${c.name}*\n\n(Click sur une ligne pour supprimer)`, { parse_mode: "Markdown", ...kb(rows) });
  }

  if (q.data?.startsWith("bk_delask_")) {
    const bid = Number(q.data.replace("bk_delask_", ""));
    const backClient = wBookingCtx.get(chatId)?.clientId;
    const back = backClient ? `cl_book_${backClient}` : "back_main";
    return bot.sendMessage(chatId, `⚠️ Supprimer la réservation #${bid} ?`, {
      ...kb([
        [{ text: "🗑️ Oui supprimer", callback_data: `bk_del_yes_${bid}` }],
        [{ text: "⬅️ Retour", callback_data: back }],
      ]),
    });
  }

  if (q.data?.startsWith("bk_del_yes_")) {
    const bid = Number(q.data.replace("bk_del_yes_", ""));
    await dbDeleteBooking(bid);
    const backClient = wBookingCtx.get(chatId)?.clientId;
    const back = backClient ? `cl_book_${backClient}` : "back_main";
    return bot.sendMessage(chatId, "✅ Supprimé.", kb([[{ text: "⬅️ Retour", callback_data: back }]]));
  }
});

/* ================== TEXT INPUT ================== */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!isAdmin(chatId)) return;
  if (text.startsWith("/")) return;

  // client inline creation
  const ci = wClientInline.get(chatId);
  if (ci) {
    if (ci.step === "name") {
      ci.data.name = text;
      ci.step = "phone";
      wClientInline.set(chatId, ci);
      return bot.sendMessage(chatId, "Téléphone (ou `-`) :");
    }
    if (ci.step === "phone") {
      ci.data.phone = text === "-" ? "" : text;
      ci.step = "address";
      wClientInline.set(chatId, ci);
      return bot.sendMessage(chatId, "Adresse (ou `-`) :");
    }
    if (ci.step === "address") {
      ci.data.address = text === "-" ? "" : text;

      const { data, error } = await sb
        .from("clients")
        .insert({ name: ci.data.name, phone: ci.data.phone, address: ci.data.address, notes: "" })
        .select("*")
        .single();

      wClientInline.delete(chatId);

      if (error) return bot.sendMessage(chatId, `❌ Client KO: ${error.message}`);
      const st = getBkState(chatId);
      if (!st) return sendMainMenu(chatId);
      pushStep(st, st.step);
      st.data.client_id = data.id;
      st.step = "pick_pet";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }
  }

  // pet inline creation
  const st = getBkState(chatId);
  if (st && st.step === "pet_new_name") {
    const pi = wPetInline.get(chatId);
    if (!pi) return;
    const name = text;
    if (!name) return bot.sendMessage(chatId, "❌ Envoie un nom.");

    const pet = await dbInsertPet({
      client_id: st.data.client_id,
      name,
      animal_type: pi.data.animal_type || "chat",
      notes: "",
      active: true,
    });

    wPetInline.delete(chatId);

    pushStep(st, st.step);
    st.data.pet_id = pet.id;
    st.step = "start_date";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // booking typed steps
  if (st) {
    if (st.step === "start_date") {
      if (!isValidISODate(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      pushStep(st, st.step);
      st.data.start_date = text;
      st.step = "end_date";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }

    if (st.step === "end_date") {
      if (!isValidISODate(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      pushStep(st, st.step);
      st.data.end_date = text;

      const n = daysInclusive(st.data.start_date, st.data.end_date);
      if (n <= 0) return bot.sendMessage(chatId, "❌ Date fin avant date début.");

      // route: 1 jour => slot unique, sinon slot_start
      st.step = n === 1 ? "slot_single" : "slot_start";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }

    // supplement qty typed
    if (st.data?._pending_sup) {
      const qty = Number(text);
      if (!Number.isFinite(qty) || qty <= 0) return bot.sendMessage(chatId, "❌ Mets une quantité > 0 (ex: 1, 2, 3)");
      const sup = st.data._pending_sup;
      st.data.supplements = st.data.supplements || [];
      st.data.supplements.push({
        id: sup.id,
        name: sup.name,
        qty: Math.floor(qty),
        unit: money2(sup.price),
        total: money2(sup.price * Math.floor(qty)),
      });
      delete st.data._pending_sup;
      setBkState(chatId, st);
      return renderSupplements(chatId, st);
    }

    if (st.step === "employee_percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets un nombre 0-100");
      pushStep(st, st.step);
      st.data.employee_percent = Math.floor(p);
      st.step = "recap";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }
  }
});
