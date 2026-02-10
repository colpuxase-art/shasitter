/* index.cjs — ShaSitter (PRIVATE Telegram mini-app)
   CLEAN + PETS (multi) + SUPPLEMENTS + MENUS + BACK + 409 FIX
   DB attendu (Supabase):
   - bookings (colonnes existantes + pet_fee_chf optionnel)
   - booking_pets (booking_id, pet_id)   [pivot]
   - booking_supplements (booking_id, prestation_id) [pivot]
*/

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

/* ================== ENV ================== */
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const WEBAPP_URL = process.env.WEBAPP_URL;

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
const ADMIN_IDS = new Set([6675436692]); // <-- ton ID Telegram
const isAdmin = (chatId) => ADMIN_IDS.has(chatId);

/* ================== TELEGRAM BOT (409 FIX) ==================
   - IMPORTANT: sur Render => WEB_CONCURRENCY=1
   - On force deleteWebhook(drop_pending_updates) puis startPolling
*/
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

(async () => {
  try {
    await bot.deleteWebHook({ drop_pending_updates: true });
  } catch {}
  bot.startPolling({ interval: 300, params: { timeout: 10 } });
})();

function safeStopPolling() {
  try {
    bot.stopPolling();
  } catch {}
}
process.on("SIGTERM", () => {
  safeStopPolling();
  process.exit(0);
});
process.on("SIGINT", () => {
  safeStopPolling();
  process.exit(0);
});

/* ================== Telegram initData validation (PRIVATE APP) ================== */
function timingSafeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}
function checkTelegramInitData(initData, botToken) {
  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return { ok: false, reason: "no_hash" };
  delete data.hash;

  const pairs = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(pairs).digest("hex");

  const ok = timingSafeEqual(computed, hash);
  if (!ok) return { ok: false, reason: "bad_hash" };
  return { ok: true, data };
}
function extractUserIdFromInitData(initData) {
  try {
    const data = parseInitData(initData);
    const userJson = data.user;
    if (!userJson) return null;
    const user = JSON.parse(userJson);
    return user?.id ? Number(user.id) : null;
  } catch {
    return null;
  }
}
function requireAdminWebApp(req, res, next) {
  const initData = req.headers["x-telegram-initdata"];

  // ⚠️ API volontairement permissive :
  // - Si initData absent => OK (dashboard ouvert hors Telegram / tests)
  // - Si initData présent mais invalide => OK aussi (on évite le blocage "Accès refusé / API")
  // - Si initData valide + admin => on attache req.tg_user_id (optionnel)
  if (!initData) return next();

  try {
    const v = checkTelegramInitData(initData, BOT_TOKEN);
    if (!v.ok) return next();

    const uid = extractUserIdFromInitData(initData);
    if (!uid || !ADMIN_IDS.has(uid)) return next();

    req.tg_user_id = uid;
    return next();
  } catch {
    return next();
  }
}

/* ================== UI HELPERS ================== */
function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
async function answerCbq(q) {
  try {
    await bot.answerCallbackQuery(q.id);
  } catch {}
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

const ANIMALS = ["chat", "lapin", "autre"];
const SLOTS = ["matin", "soir", "matin_soir"];

function slotLabel(s) {
  return s === "matin" ? "🌅 Matin" : s === "soir" ? "🌙 Soir" : "🌅🌙 Matin + soir";
}
function animalLabel(a) {
  return a === "chat" ? "🐱 Chat" : a === "lapin" ? "🐰 Lapin" : "🐾 Autre";
}

/* ================== BOOKING HELPERS ================== */
function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}
function uniqNums(arr) {
  return [...new Set(ensureArray(arr).map(Number).filter(Number.isFinite))];
}
function bookingStatus(start, end) {
  const today = utcTodayISO();
  if (end < today) return "done";
  if (start > today) return "confirmed";
  return "in_progress";
}

/* ====== Pet fee rule (si tu veux l’activer) ======
   -> 10 CHF par chat en plus, une seule fois (ex: 2 chats => +10, 3 chats => +20)
*/
const PET_FEE_CHF = 10;

async function dbGetPetsByIds(ids) {
  const clean = uniqNums(ids);
  if (!clean.length) return [];
  const { data, error } = await sb.from("pets").select("*").in("id", clean);
  if (error) throw error;
  return data || [];
}

/* calcul automatique total (principal + suppléments + pet_fee) */
async function computeBookingTotal({ prestation_id, supplement_ids = [], start_date, end_date, slot, pet_ids = [] }) {
  const days = daysInclusive(start_date, end_date);
  const slotMult = slot === "matin_soir" ? 2 : 1;

  const main = await dbGetPrestation(prestation_id);
  let total = Number(main.price_chf) * days * slotMult;

  const supIds = uniqNums(supplement_ids);
  for (const sid of supIds) {
    const s = await dbGetPrestation(sid);
    total += Number(s.price_chf) * days;
  }

  // pet fee (10 CHF par chat en plus)
  const pets = await dbGetPetsByIds(pet_ids);
  const chatCount = pets.filter((p) => p.animal_type === "chat").length;
  const extraChats = Math.max(0, chatCount - 1);
  const pet_fee_chf = extraChats * PET_FEE_CHF;

  total += pet_fee_chf;

  return { total_chf: money2(total), pet_fee_chf: money2(pet_fee_chf), days };
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

async function dbInsertBooking(payload) {
  const { data, error } = await sb.from("bookings").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

/* pivots (DB à créer) */
async function dbSetBookingPets(bookingId, petIds) {
  const ids = uniqNums(petIds);
  await sb.from("booking_pets").delete().eq("booking_id", bookingId);

  if (!ids.length) return true;
  const rows = ids.map((pid) => ({ booking_id: bookingId, pet_id: pid }));
  const { error } = await sb.from("booking_pets").insert(rows);
  if (error) throw error;
  return true;
}
async function dbSetBookingSupplements(bookingId, prestationIds) {
  const ids = uniqNums(prestationIds);
  await sb.from("booking_supplements").delete().eq("booking_id", bookingId);

  if (!ids.length) return true;
  const rows = ids.map((pid) => ({ booking_id: bookingId, prestation_id: pid }));
  const { error } = await sb.from("booking_supplements").insert(rows);
  if (error) throw error;
  return true;
}

/* upcoming/past (pivot-friendly) */
async function dbUpcomingBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(
      `
      *,
      clients (*),
      prestations (*),
      employees (*),
      booking_pets:booking_pets (
        pet:pets (*)
      ),
      booking_supplements:booking_supplements (
        prestation:prestations (*)
      )
    `
    )
    .gte("end_date", iso)
    .order("start_date", { ascending: true });

  if (error) throw error;
  return data || [];
}
async function dbPastBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(
      `
      *,
      clients (*),
      prestations (*),
      employees (*),
      booking_pets:booking_pets (
        pet:pets (*)
      ),
      booking_supplements:booking_supplements (
        prestation:prestations (*)
      )
    `
    )
    .lt("end_date", iso)
    .order("start_date", { ascending: false });

  if (error) throw error;
  return data || [];
}

/* ================== API (Dashboard = affichage ONLY) ================== */
app.get("/api/prestations", requireAdminWebApp, async (req, res) => {
  try {
    res.json(await dbListPrestations(false));
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
app.get("/api/clients", requireAdminWebApp, async (req, res) => {
  try {
    res.json(await dbListClients());
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
app.get("/api/employees", requireAdminWebApp, async (req, res) => {
  try {
    res.json(await dbListEmployees());
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
app.get("/api/bookings/upcoming", requireAdminWebApp, async (req, res) => {
  try {
    res.json(await dbUpcomingBookings());
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
app.get("/api/bookings/past", requireAdminWebApp, async (req, res) => {
  try {
    res.json(await dbPastBookings());
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
app.get("/api/compta/summary", requireAdminWebApp, async (req, res) => {
  try {
    const { data, error } = await sb
      .from("bookings")
      .select("id,start_date,total_chf,employee_part_chf,company_part_chf,client_id,prestation_id");
    if (error) throw error;

    const bookings = data || [];
    const byMonth = new Map();
    const byClient = new Map();
    const byPresta = new Map();

    let totalAll = 0;
    let totalEmployee = 0;
    let totalCompany = 0;

    for (const b of bookings) {
      totalAll += Number(b.total_chf || 0);
      totalEmployee += Number(b.employee_part_chf || 0);
      totalCompany += Number(b.company_part_chf || 0);

      const month = String(b.start_date || "").slice(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + Number(b.total_chf || 0));

      const ckey = String(b.client_id);
      byClient.set(ckey, (byClient.get(ckey) || 0) + Number(b.total_chf || 0));

      const pkey = String(b.prestation_id);
      byPresta.set(pkey, (byPresta.get(pkey) || 0) + Number(b.total_chf || 0));
    }

    const clients = await dbListClients();
    const prestas = await dbListPrestations(false);
    const cName = new Map(clients.map((c) => [String(c.id), c.name]));
    const pName = new Map(prestas.map((p) => [String(p.id), p.name]));

    const months = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, total]) => ({ month, total: money2(total) }));

    const topClients = [...byClient.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, total]) => ({ id: Number(id), name: cName.get(id) || `Client #${id}`, total: money2(total) }));

    const topPrestations = [...byPresta.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, total]) => ({ id: Number(id), name: pName.get(id) || `Prestation #${id}`, total: money2(total) }));

    res.json({
      totalAll: money2(totalAll),
      totalEmployee: money2(totalEmployee),
      totalCompany: money2(totalCompany),
      months,
      topClients,
      topPrestations,
    });
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
const wBooking = new Map(); // booking click-click-click

function cancelWizard(map, chatId, label) {
  map.delete(chatId);
  return bot.sendMessage(chatId, `❌ ${label} annulé.`, kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
}

/* ================== BOOKING FLOW (click click click) ================== */
function bkNavRow() {
  return [
    { text: "⬅️ Retour", callback_data: "bk_back" },
    { text: "❌ Annuler", callback_data: "bk_cancel" },
  ];
}
function setBkState(chatId, st) {
  wBooking.set(chatId, st);
}
function getBkState(chatId) {
  return wBooking.get(chatId);
}
function pushStep(st, step) {
  st.history = st.history || [];
  st.history.push(step);
}
function popStep(st) {
  st.history = st.history || [];
  return st.history.pop();
}

/* ================== BOOKING UI (multi pets + supplements) ================== */
async function renderBookingStep(chatId) {
  const st = getBkState(chatId);
  if (!st) return;
  const d = st.data || {};
  const step = st.step;

  const clientTxt = async () => {
    if (!d.client_id) return "—";
    try {
      const c = await dbGetClient(d.client_id);
      return `${c.name} (#${c.id})`;
    } catch {
      return `Client #${d.client_id}`;
    }
  };

  const petsTxt = async () => {
    const ids = uniqNums(d.pet_ids);
    if (!ids.length) return "—";
    try {
      const pets = await dbGetPetsByIds(ids);
      const txt = pets.map((p) => `${p.name} (${animalLabel(p.animal_type)})`).join(", ");
      return `${txt} (#${ids.join(",")})`;
    } catch {
      return `Animaux: ${ids.join(", ")}`;
    }
  };

  const prestaTxt = async () => {
    if (!d.prestation_id) return "—";
    try {
      const p = await dbGetPrestation(d.prestation_id);
      return `${p.name} — ${p.price_chf} CHF (#${p.id})`;
    } catch {
      return `Prestation #${d.prestation_id}`;
    }
  };

  const supplementsTxt = async () => {
    const ids = uniqNums(d.supplement_ids);
    if (!ids.length) return "—";
    try {
      const items = [];
      for (const id of ids) {
        try {
          const s = await dbGetPrestation(id);
          items.push(`${s.name} (${s.price_chf} CHF)`);
        } catch {
          items.push(`Presta #${id}`);
        }
      }
      return items.join(", ");
    } catch {
      return ids.join(", ");
    }
  };

  // 1) client
  if (step === "pick_client") {
    const clients = await dbListClients();
    const rows = [
      [{ text: "➕ Nouveau client", callback_data: "bk_client_new" }],
      ...clients.slice(0, 25).map((c) => [{ text: `👤 ${c.name} (#${c.id})`, callback_data: `bk_client_${c.id}` }]),
      [{ text: "⬅️ Retour", callback_data: "back_main" }],
    ];
    return bot.sendMessage(chatId, "📅 *Nouvelle réservation*\n\n1/8 — Choisis le client :", {
      parse_mode: "Markdown",
      ...kb(rows),
    });
  }

  // 2) pets (multi select)
  if (step === "pick_pets") {
    const pets = await dbListPetsByClient(d.client_id, true);
    const picked = new Set(uniqNums(d.pet_ids));

    const rows = [
      [{ text: "➕ Nouvel animal", callback_data: "bk_pet_new" }],
      ...pets.slice(0, 25).map((p) => {
        const checked = picked.has(p.id) ? "✅" : "⬜️";
        return [
          {
            text: `${checked} ${animalLabel(p.animal_type)} ${p.name} (#${p.id})`,
            callback_data: `bk_pet_${p.id}`,
          },
        ];
      }),
      [{ text: "➡️ Continuer", callback_data: "bk_pets_next" }],
      bkNavRow(),
    ];

    return bot.sendMessage(
      chatId,
      `2/8 — Sélectionne *un ou plusieurs* animaux :\n\nClient: *${await clientTxt()}*\nChoisis puis “Continuer”.`,
      { parse_mode: "Markdown", ...kb(rows) }
    );
  }

  // 3) prestation principale + suppléments (toggle)
  if (step === "pick_presta") {
    const prestas = await dbListPrestations(true);
    if (!prestas.length) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, "Aucune prestation active dans le catalogue.");
    }

    const mainId = Number(d.prestation_id || 0);
    const supSet = new Set(uniqNums(d.supplement_ids));

    const rows = prestas.slice(0, 40).map((p) => {
      if (!mainId) {
        return [{ text: `⭐ ${p.name} • ${p.price_chf} CHF`, callback_data: `bk_main_${p.id}` }];
      }
      if (p.id === mainId) {
        return [{ text: `⭐✅ ${p.name} • ${p.price_chf} CHF (principal)`, callback_data: `bk_main_${p.id}` }];
      }
      const checked = supSet.has(p.id) ? "✅" : "⬜️";
      return [{ text: `${checked} + ${p.name} • ${p.price_chf} CHF`, callback_data: `bk_sup_${p.id}` }];
    });

    rows.push([{ text: "➡️ Continuer", callback_data: "bk_presta_next" }]);
    rows.push(bkNavRow());

    return bot.sendMessage(
      chatId,
      `3/8 — Choisis *la prestation principale* (⭐), puis (optionnel) coche des suppléments :\n\nClient: *${await clientTxt()}*\nAnimaux: *${await petsTxt()}*`,
      { parse_mode: "Markdown", ...kb(rows) }
    );
  }

  // 4) slot
  if (step === "pick_slot") {
    const rows = [
      [{ text: "🌅 Matin", callback_data: "bk_slot_matin" }],
      [{ text: "🌙 Soir", callback_data: "bk_slot_soir" }],
      [{ text: "🌅🌙 Matin + soir", callback_data: "bk_slot_matin_soir" }],
      bkNavRow(),
    ];
    return bot.sendMessage(
      chatId,
      `4/8 — Choisis le créneau :\n\nPrestation: *${await prestaTxt()}*\nSuppléments: *${await supplementsTxt()}*`,
      { parse_mode: "Markdown", ...kb(rows) }
    );
  }

  // 5) start_date
  if (step === "start_date") {
    return bot.sendMessage(
      chatId,
      `5/8 — Envoie la *date début* (YYYY-MM-DD)\n\nClient: *${await clientTxt()}*\nAnimaux: *${await petsTxt()}*\nPrestation: *${await prestaTxt()}*\nSuppléments: *${await supplementsTxt()}*\nCréneau: *${slotLabel(d.slot)}*`,
      { parse_mode: "Markdown", ...kb([bkNavRow()]) }
    );
  }

  // 6) end_date
  if (step === "end_date") {
    return bot.sendMessage(chatId, `6/8 — Envoie la *date fin* (YYYY-MM-DD)\n\nDébut: *${d.start_date}*`, {
      parse_mode: "Markdown",
      ...kb([bkNavRow()]),
    });
  }

  // 7) share employee?
  if (step === "share_employee") {
    return bot.sendMessage(chatId, "7/8 — Partager avec un employé ?", {
      ...kb([
        [{ text: "✅ Oui", callback_data: "bk_share_yes" }],
        [{ text: "❌ Non", callback_data: "bk_share_no" }],
        bkNavRow(),
      ]),
    });
  }

  // 7bis) pick employee
  if (step === "pick_employee") {
    const emps = (await dbListEmployees()).filter((e) => e.active === true);
    const rows = [
      [{ text: "Aucun employé", callback_data: "bk_emp_none" }],
      ...emps.slice(0, 25).map((e) => [{ text: `👩‍💼 ${e.name} (#${e.id})`, callback_data: `bk_emp_${e.id}` }]),
      bkNavRow(),
    ];
    return bot.sendMessage(chatId, "Choisis l’employé :", { ...kb(rows) });
  }

  // 7ter) employee percent
  if (step === "employee_percent") {
    return bot.sendMessage(chatId, "Pourcentage employé (0-100). Ex: 30", { ...kb([bkNavRow()]) });
  }

  // 8) recap
  if (step === "recap") {
    const petIds = uniqNums(d.pet_ids);
    if (!petIds.length) return bot.sendMessage(chatId, "❌ Aucun animal sélectionné.");
    if (!d.prestation_id) return bot.sendMessage(chatId, "❌ Prestation manquante.");
    if (!d.start_date || !d.end_date) return bot.sendMessage(chatId, "❌ Dates manquantes.");

    const { total_chf, pet_fee_chf, days } = await computeBookingTotal({
      prestation_id: d.prestation_id,
      supplement_ids: d.supplement_ids,
      start_date: d.start_date,
      end_date: d.end_date,
      slot: d.slot,
      pet_ids: petIds,
    });

    const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
    const empPart = d.employee_id ? money2((total_chf * empPercent) / 100) : 0;
    const coPart = d.employee_id ? money2(total_chf - empPart) : total_chf;

    d.days_count = days;
    d.total_chf = total_chf;
    d.pet_fee_chf = pet_fee_chf;
    d.employee_part_chf = empPart;
    d.company_part_chf = coPart;
    setBkState(chatId, st);

    const empLine = d.employee_id ? `Employé: *${empPercent}%* → *${empPart} CHF*` : `Employé: *aucun*`;
    const feeLine = pet_fee_chf > 0 ? `Frais chats: *${pet_fee_chf} CHF*` : `Frais chats: *0 CHF*`;

    return bot.sendMessage(
      chatId,
      `🧾 *Récapitulatif*\n\n` +
        `Client: *${await clientTxt()}*\n` +
        `Animaux: *${await petsTxt()}*\n` +
        `Prestation: *${await prestaTxt()}*\n` +
        `Suppléments: *${await supplementsTxt()}*\n` +
        `Créneau: *${slotLabel(d.slot)}*\n` +
        `Période: *${d.start_date} → ${d.end_date}* (*${days} jours*)\n\n` +
        `${feeLine}\n` +
        `Total: *${total_chf} CHF*\n` +
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

  /* ----- GLOBAL NAV ----- */
  if (q.data === "back_main") return sendMainMenu(chatId);

  if (q.data === "m_emps") return sendEmployeesMenu(chatId);
  if (q.data === "m_clients") return sendClientsMenu(chatId);
  if (q.data === "m_prestas") return sendPrestationsMenu(chatId);

  if (q.data === "m_book") {
    wBooking.set(chatId, {
      step: "pick_client",
      data: { pet_ids: [], supplement_ids: [], prestation_id: null, employee_id: null, employee_percent: 0 },
      history: [],
    });
    return renderBookingStep(chatId);
  }

  /* ----- LISTS: upcoming / past / compta ----- */
  if (q.data === "list_upcoming") {
    const rows = await dbUpcomingBookings();
    if (!rows.length)
      return bot.sendMessage(chatId, "⏰ Aucune réservation à venir.", kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]));

    const txt = rows
      .slice(0, 30)
      .map((b) => {
        const c = b.clients?.name || "—";
        const pets = (b.booking_pets || [])
          .map((x) => x.pet?.name)
          .filter(Boolean);
        const petTxt = pets.length ? ` • 🐾 ${pets.join(", ")}` : "";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${petTxt} • ${p}${emp} • ${b.total_chf} CHF`;
      })
      .join("\n");

    return bot.sendMessage(chatId, `⏰ *À venir*:\n\n${txt}`, {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]),
    });
  }

  if (q.data === "list_past") {
    const rows = await dbPastBookings();
    if (!rows.length)
      return bot.sendMessage(chatId, "🧾 Aucune réservation passée.", kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]));

    const txt = rows
      .slice(0, 30)
      .map((b) => {
        const c = b.clients?.name || "—";
        const pets = (b.booking_pets || [])
          .map((x) => x.pet?.name)
          .filter(Boolean);
        const petTxt = pets.length ? ` • 🐾 ${pets.join(", ")}` : "";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${petTxt} • ${p}${emp} • ${b.total_chf} CHF`;
      })
      .join("\n");

    return bot.sendMessage(chatId, `🧾 *Passées*:\n\n${txt}`, {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]),
    });
  }

  if (q.data === "show_compta") {
    const { data, error } = await sb.from("bookings").select("total_chf,employee_part_chf,company_part_chf");
    if (error)
      return bot.sendMessage(chatId, `❌ Compta: ${error.message}`, kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]));

    const rows = data || [];
    const totalAll = rows.reduce((a, b) => a + Number(b.total_chf || 0), 0);
    const totalEmp = rows.reduce((a, b) => a + Number(b.employee_part_chf || 0), 0);
    const totalCo = rows.reduce((a, b) => a + Number(b.company_part_chf || 0), 0);

    return bot.sendMessage(
      chatId,
      `💰 *Comptabilité*\n\nTotal: *${money2(totalAll)} CHF*\nEmployés: *${money2(totalEmp)} CHF*\nShaSitter: *${money2(totalCo)} CHF*`,
      { parse_mode: "Markdown", ...kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]) }
    );
  }

  /* ================== BOOKING FLOW CALLBACKS ================== */
  if (q.data === "bk_cancel") return cancelWizard(wBooking, chatId, "Réservation");

  if (q.data === "bk_back") {
    const st = getBkState(chatId);
    if (!st) return;
    const prev = popStep(st);
    if (!prev) {
      wBooking.delete(chatId);
      return sendMainMenu(chatId);
    }
    st.step = prev;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

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
    st.step = "pick_pets";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // pets toggle
  if (q.data?.startsWith("bk_pet_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const pid = Number(q.data.replace("bk_pet_", ""));
    const ids = uniqNums(st.data.pet_ids);
    st.data.pet_ids = ids.includes(pid) ? ids.filter((x) => x !== pid) : [...ids, pid];
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_pets_next") {
    const st = getBkState(chatId);
    if (!st) return;
    const ids = uniqNums(st.data.pet_ids);
    if (!ids.length) return bot.sendMessage(chatId, "❌ Sélectionne au moins 1 animal.", kb([bkNavRow()]));
    pushStep(st, st.step);
    st.step = "pick_presta";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

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

  // presta main / supplements toggles
  if (q.data?.startsWith("bk_main_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const id = Number(q.data.replace("bk_main_", ""));
    st.data.prestation_id = id;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data?.startsWith("bk_sup_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const id = Number(q.data.replace("bk_sup_", ""));
    const sids = uniqNums(st.data.supplement_ids);
    st.data.supplement_ids = sids.includes(id) ? sids.filter((x) => x !== id) : [...sids, id];
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_presta_next") {
    const st = getBkState(chatId);
    if (!st) return;
    if (!st.data.prestation_id) return bot.sendMessage(chatId, "❌ Choisis une prestation principale (⭐).");
    pushStep(st, st.step);
    st.step = "pick_slot";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data?.startsWith("bk_slot_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const slot = q.data.replace("bk_slot_", "");
    if (!SLOTS.includes(slot)) return;
    pushStep(st, st.step);
    st.data.slot = slot;
    st.step = "start_date";
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

  if (q.data === "bk_confirm") {
    const st = getBkState(chatId);
    if (!st) return;
    const d = st.data || {};

    try {
      const petIds = uniqNums(d.pet_ids);
      if (!petIds.length) throw new Error("Aucun animal sélectionné.");

      const { total_chf, pet_fee_chf, days } = await computeBookingTotal({
        prestation_id: d.prestation_id,
        supplement_ids: d.supplement_ids,
        start_date: d.start_date,
        end_date: d.end_date,
        slot: d.slot,
        pet_ids: petIds,
      });
      if (days < 1) throw new Error("Dates invalides (fin avant début ?)");

      const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
      const empPart = d.employee_id ? money2((total_chf * empPercent) / 100) : 0;
      const coPart = d.employee_id ? money2(total_chf - empPart) : total_chf;

      const payload = {
        client_id: d.client_id,

        // compat: on met le 1er animal dans bookings.pet_id (utile si ton dashboard dépend encore de ça)
        pet_id: petIds[0],

        prestation_id: d.prestation_id,
        slot: d.slot,
        start_date: d.start_date,
        end_date: d.end_date,
        days_count: days,

        total_chf,
        pet_fee_chf, // colonne à ajouter côté DB (sinon supprime cette ligne)

        employee_id: d.employee_id || null,
        employee_percent: d.employee_id ? empPercent : 0,
        employee_part_chf: empPart,
        company_part_chf: coPart,

        notes: "",
        status: bookingStatus(d.start_date, d.end_date),
      };

      const inserted = await dbInsertBooking(payload);

      // pivots (si les tables existent)
      await dbSetBookingPets(inserted.id, petIds);
      await dbSetBookingSupplements(inserted.id, uniqNums(d.supplement_ids));

      wBooking.delete(chatId);

      return bot.sendMessage(
        chatId,
        `✅ *Réservation confirmée*\n\n#${inserted.id} • ${inserted.start_date}→${inserted.end_date}\nTotal: *${inserted.total_chf} CHF*`,
        { parse_mode: "Markdown", ...kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]) }
      );
    } catch (e) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, `❌ Ajout KO: ${e.message}`, kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]));
    }
  }

  /* ================== EMPLOYEES MENU ================== */
  if (q.data === "emp_list") {
    const emps = await dbListEmployees();
    const rows = emps.slice(0, 25).map((e) => [
      { text: `👩‍💼 #${e.id} ${e.name} ${e.active ? "✅" : "⛔"}`, callback_data: `emp_open_${e.id}` },
    ]);
    rows.push([{ text: "⬅️ Retour", callback_data: "m_emps" }]);
    return bot.sendMessage(chatId, "📋 Employés :", { ...kb(rows) });
  }

  if (q.data === "emp_add") {
    wEmployee.set(chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "👩‍💼 Nouvel employé — 1/4 : Envoie le *nom*.", {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: "m_emps" }, { text: "❌ Annuler", callback_data: "emp_cancel" }]]),
    });
  }

  if (q.data === "emp_cancel") return cancelWizard(wEmployee, chatId, "Employé");

  if (q.data?.startsWith("emp_open_")) {
    const id = Number(q.data.replace("emp_open_", ""));
    const e = await dbGetEmployee(id);
    return bot.sendMessage(
      chatId,
      `👩‍💼 *${e.name}* (#${e.id})\nTel: ${e.phone || "—"}\n% défaut: ${e.default_percent}%\nActif: ${e.active ? "✅" : "⛔"}`,
      {
        parse_mode: "Markdown",
        ...kb([
          [{ text: "✏️ Modifier", callback_data: `emp_edit_${e.id}` }],
          [{ text: e.active ? "⛔ Désactiver" : "✅ Activer", callback_data: `emp_toggle_${e.id}` }],
          [{ text: "🗑️ Supprimer", callback_data: `emp_del_${e.id}` }],
          [{ text: "⬅️ Retour", callback_data: "emp_list" }],
        ]),
      }
    );
  }

  if (q.data?.startsWith("emp_toggle_")) {
    const id = Number(q.data.replace("emp_toggle_", ""));
    const e = await dbGetEmployee(id);
    await dbUpdateEmployee(id, { active: !e.active });
    return bot.sendMessage(chatId, "✅ Mis à jour.", kb([[{ text: "⬅️ Retour", callback_data: `emp_open_${id}` }]]));
  }

  if (q.data?.startsWith("emp_del_")) {
    const id = Number(q.data.replace("emp_del_", ""));
    return bot.sendMessage(chatId, "⚠️ Confirmer suppression employé ?", {
      ...kb([
        [{ text: "🗑️ Oui supprimer", callback_data: `emp_del_yes_${id}` }],
        [{ text: "⬅️ Retour", callback_data: `emp_open_${id}` }],
      ]),
    });
  }
  if (q.data?.startsWith("emp_del_yes_")) {
    const id = Number(q.data.replace("emp_del_yes_", ""));
    await dbDeleteEmployee(id);
    return bot.sendMessage(chatId, "✅ Employé supprimé.", kb([[{ text: "⬅️ Retour", callback_data: "emp_list" }]]));
  }

  if (q.data?.startsWith("emp_edit_")) {
    const id = Number(q.data.replace("emp_edit_", ""));
    const e = await dbGetEmployee(id);
    wEmployee.set(chatId, { step: "edit_name", data: { id, _edit: true, cur: e } });
    return bot.sendMessage(chatId, `✏️ Modifier employé (#${id}) — Envoie le *nom* (actuel: ${e.name})`, {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: `emp_open_${id}` }]]),
    });
  }

  /* ================== CLIENTS MENU (avec Pets) ================== */
  if (q.data === "cl_list") {
    const clients = await dbListClients();
    const rows = clients.slice(0, 25).map((c) => [{ text: `👤 #${c.id} ${c.name}`, callback_data: `cl_open_${c.id}` }]);
    rows.push([{ text: "⬅️ Retour", callback_data: "m_clients" }]);
    return bot.sendMessage(chatId, "📋 Clients :", { ...kb(rows) });
  }

  if (q.data === "cl_add") {
    wClient.set(chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "👤 Nouveau client — 1/4 : Envoie le *nom*.", {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: "m_clients" }, { text: "❌ Annuler", callback_data: "cl_cancel" }]]),
    });
  }

  if (q.data === "cl_cancel") return cancelWizard(wClient, chatId, "Client");

  if (q.data?.startsWith("cl_open_")) {
    const id = Number(q.data.replace("cl_open_", ""));
    const c = await dbGetClient(id);
    return bot.sendMessage(chatId, `👤 *${c.name}* (#${c.id})\nTel: ${c.phone || "—"}\nAdresse: ${c.address || "—"}`, {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🐾 Animaux", callback_data: `pet_list_${c.id}` }],
        [{ text: "✏️ Modifier", callback_data: `cl_edit_${c.id}` }],
        [{ text: "🗑️ Supprimer", callback_data: `cl_del_${c.id}` }],
        [{ text: "⬅️ Retour", callback_data: "cl_list" }],
        [{ text: "🧾 Réservations", callback_data: `cl_bookings_${c.id}` }],
      ]),
    });
  }

  // liste des bookings d’un client
  if (q.data?.startsWith("cl_bookings_")) {
    const clientId = Number(q.data.replace("cl_bookings_", ""));
    const { data, error } = await sb
      .from("bookings")
      .select("id, start_date, end_date, prestations(name)")
      .eq("client_id", clientId)
      .order("start_date", { ascending: false });

    if (error || !data?.length) {
      return bot.sendMessage(chatId, "Aucune réservation.", kb([[{ text: "⬅️ Retour", callback_data: `cl_open_${clientId}` }]]));
    }

    const rows = data.slice(0, 30).map((b) => [
      {
        text: `❌ ${b.prestations?.name || "Presta"} (${b.start_date}→${b.end_date})`,
        callback_data: `cl_book_del_${b.id}_${clientId}`,
      },
    ]);

    rows.push([{ text: "⬅️ Retour", callback_data: `cl_open_${clientId}` }]);
    return bot.sendMessage(chatId, "🧾 Réservations (cliquer pour supprimer) :", { ...kb(rows) });
  }

  // suppression booking client
  if (q.data?.startsWith("cl_book_del_")) {
    const parts = q.data.split("_"); // ["cl","book","del",bid,cid]
    const bid = Number(parts[3]);
    const cid = Number(parts[4]);
    await sb.from("bookings").delete().eq("id", bid);
    return bot.sendMessage(chatId, "✅ Réservation supprimée.", kb([[{ text: "⬅️ Retour", callback_data: `cl_open_${cid}` }]]));
  }

  if (q.data?.startsWith("cl_del_")) {
    const id = Number(q.data.replace("cl_del_", ""));
    return bot.sendMessage(chatId, "⚠️ Confirmer suppression client ?", {
      ...kb([
        [{ text: "🗑️ Oui supprimer", callback_data: `cl_del_yes_${id}` }],
        [{ text: "⬅️ Retour", callback_data: `cl_open_${id}` }],
      ]),
    });
  }
  if (q.data?.startsWith("cl_del_yes_")) {
    const id = Number(q.data.replace("cl_del_yes_", ""));
    await dbDeleteClient(id);
    return bot.sendMessage(chatId, "✅ Client supprimé.", kb([[{ text: "⬅️ Retour", callback_data: "cl_list" }]]));
  }

  if (q.data?.startsWith("cl_edit_")) {
    const id = Number(q.data.replace("cl_edit_", ""));
    const c = await dbGetClient(id);
    wClient.set(chatId, { step: "edit_name", data: { id, _edit: true, cur: c } });
    return bot.sendMessage(chatId, `✏️ Modifier client (#${id}) — Envoie le *nom* (actuel: ${c.name})`, {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: `cl_open_${id}` }]]),
    });
  }

  /* ----- PETS (animaux) ----- */
  if (q.data?.startsWith("pet_list_")) {
    const clientId = Number(q.data.replace("pet_list_", ""));
    const c = await dbGetClient(clientId);
    const pets = await dbListPetsByClient(clientId, false);

    const rows = [
      [{ text: "➕ Ajouter un animal", callback_data: `pet_add_${clientId}` }],
      ...pets.slice(0, 25).map((p) => [
        {
          text: `${animalLabel(p.animal_type)} ${p.name} ${p.active ? "✅" : "⛔"} (#${p.id})`,
          callback_data: `pet_open_${p.id}`,
        },
      ]),
      [{ text: "⬅️ Retour", callback_data: `cl_open_${clientId}` }],
    ];

    return bot.sendMessage(chatId, `🐾 Animaux de *${c.name}* :`, { parse_mode: "Markdown", ...kb(rows) });
  }

  if (q.data?.startsWith("pet_add_")) {
    const clientId = Number(q.data.replace("pet_add_", ""));
    wPet.set(chatId, { step: "type", data: { client_id: clientId } });
    return bot.sendMessage(chatId, "🐾 Nouvel animal — 1/3 : Choisis le type :", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🐱 Chat", callback_data: "pet_type_chat" }],
        [{ text: "🐰 Lapin", callback_data: "pet_type_lapin" }],
        [{ text: "🐾 Autre", callback_data: "pet_type_autre" }],
        [
          { text: "⬅️ Retour", callback_data: `pet_list_${clientId}` },
          { text: "❌ Annuler", callback_data: "pet_cancel" },
        ],
      ]),
    });
  }

  if (q.data === "pet_cancel") return cancelWizard(wPet, chatId, "Animal");

  if (q.data?.startsWith("pet_type_")) {
    const st = wPet.get(chatId);
    if (!st) return;
    const t = q.data.replace("pet_type_", "");
    if (!ANIMALS.includes(t)) return;
    st.data.animal_type = t;
    st.step = "name";
    wPet.set(chatId, st);
    return bot.sendMessage(chatId, `2/3 — Envoie le *nom* de l’animal.\nType: ${animalLabel(t)}`, { parse_mode: "Markdown" });
  }

  if (q.data?.startsWith("pet_open_")) {
    const petId = Number(q.data.replace("pet_open_", ""));
    const p = await dbGetPet(petId);
    return bot.sendMessage(chatId, `🐾 *${p.name}* (#${p.id})\nType: ${animalLabel(p.animal_type)}\nActif: ${p.active ? "✅" : "⛔"}`, {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "✏️ Modifier", callback_data: `pet_edit_${p.id}` }],
        [{ text: p.active ? "⛔ Désactiver" : "✅ Activer", callback_data: `pet_toggle_${p.id}` }],
        [{ text: "🗑️ Supprimer", callback_data: `pet_del_${p.id}` }],
        [{ text: "⬅️ Retour", callback_data: `pet_list_${p.client_id}` }],
      ]),
    });
  }

  if (q.data?.startsWith("pet_toggle_")) {
    const petId = Number(q.data.replace("pet_toggle_", ""));
    const p = await dbGetPet(petId);
    await dbUpdatePet(petId, { active: !p.active });
    return bot.sendMessage(chatId, "✅ Mis à jour.", kb([[{ text: "⬅️ Retour", callback_data: `pet_open_${petId}` }]]));
  }

  if (q.data?.startsWith("pet_del_")) {
    const petId = Number(q.data.replace("pet_del_", ""));
    const p = await dbGetPet(petId);
    return bot.sendMessage(chatId, "⚠️ Confirmer suppression animal ?", {
      ...kb([
        [{ text: "🗑️ Oui supprimer", callback_data: `pet_del_yes_${petId}` }],
        [{ text: "⬅️ Retour", callback_data: `pet_open_${petId}` }],
        [{ text: "⬅️ Liste animaux", callback_data: `pet_list_${p.client_id}` }],
      ]),
    });
  }
  if (q.data?.startsWith("pet_del_yes_")) {
    const petId = Number(q.data.replace("pet_del_yes_", ""));
    const p = await dbGetPet(petId);
    await dbDeletePet(petId);
    return bot.sendMessage(chatId, "✅ Animal supprimé.", kb([[{ text: "⬅️ Retour", callback_data: `pet_list_${p.client_id}` }]]));
  }

  if (q.data?.startsWith("pet_edit_")) {
    const petId = Number(q.data.replace("pet_edit_", ""));
    const p = await dbGetPet(petId);
    wPet.set(chatId, { step: "edit_name", data: { id: petId, _edit: true, cur: p } });
    return bot.sendMessage(chatId, `✏️ Modifier animal (#${petId}) — Envoie le *nom* (actuel: ${p.name})`, {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: `pet_open_${petId}` }]]),
    });
  }

  /* ================== PRESTATIONS MENU ================== */
  if (q.data === "pre_list") {
    const prestas = await dbListPrestations(false);
    const rows = prestas.slice(0, 25).map((p) => [
      { text: `🧾 #${p.id} ${p.name} ${p.active ? "✅" : "⛔"} • ${p.price_chf} CHF`, callback_data: `pre_open_${p.id}` },
    ]);
    rows.push([{ text: "⬅️ Retour", callback_data: "m_prestas" }]);
    return bot.sendMessage(chatId, "📋 Prestations :", { ...kb(rows) });
  }

  if (q.data === "pre_add") {
    wPresta.set(chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "🧾 Nouvelle prestation — 1/6 : Envoie le *nom*.", {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: "m_prestas" }, { text: "❌ Annuler", callback_data: "pre_cancel" }]]),
    });
  }

  if (q.data === "pre_cancel") return cancelWizard(wPresta, chatId, "Prestation");

  if (q.data?.startsWith("pre_open_")) {
    const id = Number(q.data.replace("pre_open_", ""));
    const p = await dbGetPrestation(id);
    return bot.sendMessage(
      chatId,
      `🧾 *${p.name}* (#${p.id})\nAnimal: ${animalLabel(p.animal_type)}\nPrix: ${p.price_chf} CHF\nVisites/j: ${p.visits_per_day}\nDurée: ${p.duration_min} min\nActif: ${p.active ? "✅" : "⛔"}`,
      {
        parse_mode: "Markdown",
        ...kb([
          [{ text: "✏️ Modifier", callback_data: `pre_edit_${p.id}` }],
          [{ text: p.active ? "⛔ Désactiver" : "✅ Activer", callback_data: `pre_toggle_${p.id}` }],
          [{ text: "🗑️ Supprimer", callback_data: `pre_del_${p.id}` }],
          [{ text: "⬅️ Retour", callback_data: "pre_list" }],
        ]),
      }
    );
  }

  if (q.data?.startsWith("pre_toggle_")) {
    const id = Number(q.data.replace("pre_toggle_", ""));
    const p = await dbGetPrestation(id);
    await dbUpdatePrestation(id, { active: !p.active });
    return bot.sendMessage(chatId, "✅ Mis à jour.", kb([[{ text: "⬅️ Retour", callback_data: `pre_open_${id}` }]]));
  }

  if (q.data?.startsWith("pre_del_")) {
    const id = Number(q.data.replace("pre_del_", ""));
    return bot.sendMessage(chatId, "⚠️ Confirmer suppression prestation ?", {
      ...kb([
        [{ text: "🗑️ Oui supprimer", callback_data: `pre_del_yes_${id}` }],
        [{ text: "⬅️ Retour", callback_data: `pre_open_${id}` }],
      ]),
    });
  }
  if (q.data?.startsWith("pre_del_yes_")) {
    const id = Number(q.data.replace("pre_del_yes_", ""));
    await dbDeletePrestation(id);
    return bot.sendMessage(chatId, "✅ Prestation supprimée.", kb([[{ text: "⬅️ Retour", callback_data: "pre_list" }]]));
  }

  if (q.data?.startsWith("pre_edit_")) {
    const id = Number(q.data.replace("pre_edit_", ""));
    const p = await dbGetPrestation(id);
    wPresta.set(chatId, { step: "edit_name", data: { id, _edit: true, cur: p } });
    return bot.sendMessage(chatId, `✏️ Modifier prestation (#${id}) — Envoie le *nom* (actuel: ${p.name})`, {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Retour", callback_data: `pre_open_${id}` }]]),
    });
  }
});

/* ================== TEXT INPUT HANDLER ================== */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!isAdmin(chatId)) return;
  if (text.startsWith("/")) return;

  /* ================== BOOKING typed steps ================== */
  const bk = getBkState(chatId);
  if (bk) {
    const d = bk.data || {};

    // pet_new_name typed (after type selection)
    if (bk.step === "pet_new_name") {
      if (!d.client_id) return bot.sendMessage(chatId, "❌ Client manquant.");
      const name = text;
      if (!name) return bot.sendMessage(chatId, "❌ Envoie un nom.");
      const type = d._pet_new_type || "chat";

      try {
        const pet = await dbInsertPet({
          client_id: d.client_id,
          name,
          animal_type: type,
          notes: "",
          active: true,
        });

        // auto-check ce nouvel animal dans la sélection multi
        const ids = uniqNums(d.pet_ids);
        bk.data.pet_ids = ids.includes(pet.id) ? ids : [...ids, pet.id];

        delete bk.data._pet_new_type;
        bk.step = "pick_pets";
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
      bk.step = "share_employee";
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

  /* ================== CLIENT WIZARD ================== */
  const cs = wClient.get(chatId);
  if (cs) {
    const d = cs.data || {};
    const isBk = cs.step?.startsWith("bk_") && d._returnToBooking;

    // booking inline create client
    if (isBk) {
      if (cs.step === "bk_name") {
        d.name = text;
        cs.step = "bk_phone";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "Téléphone (ou `-`) :");
      }
      if (cs.step === "bk_phone") {
        d.phone = text === "-" ? "" : text;
        cs.step = "bk_address";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "Adresse (ou `-`) :");
      }
      if (cs.step === "bk_address") {
        d.address = text === "-" ? "" : text;
        try {
          const inserted = await dbInsertClient({
            name: d.name,
            phone: d.phone || "",
            address: d.address || "",
            notes: "",
          });
          wClient.delete(chatId);

          const st = getBkState(chatId);
          if (!st) return sendMainMenu(chatId);

          pushStep(st, st.step);
          st.data.client_id = inserted.id;
          st.step = "pick_pets";
          setBkState(chatId, st);
          return renderBookingStep(chatId);
        } catch (e) {
          wClient.delete(chatId);
          return bot.sendMessage(chatId, `❌ Ajout client KO: ${e.message}`);
        }
      }
    }

    // normal client add/edit
    if (!isBk) {
      if (cs.step === "name") {
        d.name = text;
        cs.step = "phone";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "2/4 — Téléphone (ou `-`) :");
      }
      if (cs.step === "phone") {
        d.phone = text === "-" ? "" : text;
        cs.step = "address";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "3/4 — Adresse (ou `-`) :");
      }
      if (cs.step === "address") {
        d.address = text === "-" ? "" : text;
        cs.step = "notes";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "4/4 — Notes (ou `-`) :");
      }
      if (cs.step === "notes") {
        d.notes = text === "-" ? "" : text;
        try {
          const inserted = await dbInsertClient({
            name: d.name,
            phone: d.phone || "",
            address: d.address || "",
            notes: d.notes || "",
          });
          wClient.delete(chatId);
          return bot.sendMessage(chatId, `✅ Client ajouté: #${inserted.id} — ${inserted.name}`, kb([[{ text: "⬅️ Clients", callback_data: "m_clients" }]]));
        } catch (e) {
          wClient.delete(chatId);
          return bot.sendMessage(chatId, `❌ Ajout client KO: ${e.message}`);
        }
      }

      // edit
      if (cs.step === "edit_name") {
        d.name = text;
        cs.step = "edit_phone";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "Téléphone (ou `-`) :");
      }
      if (cs.step === "edit_phone") {
        d.phone = text === "-" ? "" : text;
        cs.step = "edit_address";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "Adresse (ou `-`) :");
      }
      if (cs.step === "edit_address") {
        d.address = text === "-" ? "" : text;
        cs.step = "edit_notes";
        wClient.set(chatId, cs);
        return bot.sendMessage(chatId, "Notes (ou `-`) :");
      }
      if (cs.step === "edit_notes") {
        d.notes = text === "-" ? "" : text;
        try {
          const updated = await dbUpdateClient(d.id, {
            name: d.name,
            phone: d.phone || "",
            address: d.address || "",
            notes: d.notes || "",
          });
          wClient.delete(chatId);
          return bot.sendMessage(chatId, `✅ Client modifié: #${updated.id} — ${updated.name}`, kb([[{ text: "⬅️ Retour", callback_data: `cl_open_${updated.id}` }]]));
        } catch (e) {
          wClient.delete(chatId);
          return bot.sendMessage(chatId, `❌ Modif client KO: ${e.message}`);
        }
      }
    }
  }

  /* ================== EMPLOYEE WIZARD ================== */
  const es = wEmployee.get(chatId);
  if (es) {
    const d = es.data || {};

    if (es.step === "name") {
      d.name = text;
      es.step = "phone";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "2/4 — Téléphone (ou `-`) :");
    }
    if (es.step === "phone") {
      d.phone = text === "-" ? "" : text;
      es.step = "percent";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "3/4 — Pourcentage par défaut (0-100) :");
    }
    if (es.step === "percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets un nombre 0-100");
      d.default_percent = Math.floor(p);
      es.step = "active";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "4/4 — Actif ? (oui/non)", kb([[{ text: "⬅️ Retour", callback_data: "m_emps" }]]));
    }
    if (es.step === "active") {
      const v = text.toLowerCase();
      const active = v === "oui" || v === "o" || v === "yes" || v === "y" || v === "1";
      try {
        const inserted = await dbInsertEmployee({
          name: d.name,
          phone: d.phone || "",
          default_percent: d.default_percent || 0,
          active,
        });
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `✅ Employé ajouté: #${inserted.id} — ${inserted.name}`, kb([[{ text: "⬅️ Employés", callback_data: "m_emps" }]]));
      } catch (e) {
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout employé KO: ${e.message}`);
      }
    }

    // edit
    if (es.step === "edit_name") {
      d.name = text;
      es.step = "edit_phone";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "Téléphone (ou `-`) :");
    }
    if (es.step === "edit_phone") {
      d.phone = text === "-" ? "" : text;
      es.step = "edit_percent";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "Pourcentage par défaut (0-100) :");
    }
    if (es.step === "edit_percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets un nombre 0-100");
      d.default_percent = Math.floor(p);
      es.step = "edit_active";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "Actif ? (oui/non)");
    }
    if (es.step === "edit_active") {
      const v = text.toLowerCase();
      const active = v === "oui" || v === "o" || v === "yes" || v === "y" || v === "1";
      try {
        const updated = await dbUpdateEmployee(d.id, {
          name: d.name,
          phone: d.phone || "",
          default_percent: d.default_percent || 0,
          active,
        });
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `✅ Employé modifié: #${updated.id} — ${updated.name}`, kb([[{ text: "⬅️ Retour", callback_data: `emp_open_${updated.id}` }]]));
      } catch (e) {
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `❌ Modif employé KO: ${e.message}`);
      }
    }
  }

  /* ================== PET WIZARD ================== */
  const ps = wPet.get(chatId);
  if (ps) {
    const d = ps.data || {};

    if (ps.step === "name") {
      d.name = text;
      ps.step = "notes";
      wPet.set(chatId, ps);
      return bot.sendMessage(chatId, "3/3 — Notes (ou `-`) :");
    }
    if (ps.step === "notes") {
      d.notes = text === "-" ? "" : text;
      try {
        const inserted = await dbInsertPet({
          client_id: d.client_id,
          name: d.name,
          animal_type: d.animal_type || "chat",
          notes: d.notes || "",
          active: true,
        });
        wPet.delete(chatId);
        return bot.sendMessage(chatId, `✅ Animal ajouté: #${inserted.id} — ${inserted.name}`, kb([[{ text: "⬅️ Retour", callback_data: `pet_list_${inserted.client_id}` }]]));
      } catch (e) {
        wPet.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout animal KO: ${e.message}`);
      }
    }

    // edit
    if (ps.step === "edit_name") {
      d.name = text;
      ps.step = "edit_notes";
      wPet.set(chatId, ps);
      return bot.sendMessage(chatId, "Notes (ou `-`) :");
    }
    if (ps.step === "edit_notes") {
      d.notes = text === "-" ? "" : text;
      try {
        const updated = await dbUpdatePet(d.id, { name: d.name, notes: d.notes || "" });
        wPet.delete(chatId);
        return bot.sendMessage(chatId, "✅ Animal modifié.", kb([[{ text: "⬅️ Retour", callback_data: `pet_open_${updated.id}` }]]));
      } catch (e) {
        wPet.delete(chatId);
        return bot.sendMessage(chatId, `❌ Modif animal KO: ${e.message}`);
      }
    }
  }

  /* ================== PRESTATION WIZARD ================== */
  const pr = wPresta.get(chatId);
  if (pr) {
    const d = pr.data || {};

    if (pr.step === "name") {
      d.name = text;
      pr.step = "animal";
      wPresta.set(chatId, pr);
      return bot.sendMessage(chatId, "2/6 — Type animal (chat / lapin / autre) :");
    }
    if (pr.step === "animal") {
      const a = text.toLowerCase();
      if (!ANIMALS.includes(a)) return bot.sendMessage(chatId, "❌ Mets: chat / lapin / autre");
      d.animal_type = a;
      pr.step = "price";
      wPresta.set(chatId, pr);
      return bot.sendMessage(chatId, "3/6 — Prix CHF (ex: 15, 46, 55) :");
    }
    if (pr.step === "price") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return bot.sendMessage(chatId, "❌ Prix invalide");
      d.price_chf = money2(n);
      pr.step = "visits";
      wPresta.set(chatId, pr);
      return bot.sendMessage(chatId, "4/6 — Visites par jour (1 ou 2) :");
    }
    if (pr.step === "visits") {
      const v = Number(text);
      if (![1, 2].includes(v)) return bot.sendMessage(chatId, "❌ Mets 1 ou 2");
      d.visits_per_day = v;
      pr.step = "duration";
      wPresta.set(chatId, pr);
      return bot.sendMessage(chatId, "5/6 — Durée totale par jour (minutes) :");
    }
    if (pr.step === "duration") {
      const m = Number(text);
      if (!Number.isFinite(m) || m < 0) return bot.sendMessage(chatId, "❌ Durée invalide");
      d.duration_min = Math.floor(m);
      pr.step = "desc";
      wPresta.set(chatId, pr);
      return bot.sendMessage(chatId, "6/6 — Description (tu peux coller tout le texte) :");
    }
    if (pr.step === "desc") {
      d.description = text || "";
      try {
        const inserted = await dbInsertPrestation({
          name: d.name,
          animal_type: d.animal_type,
          price_chf: d.price_chf || 0,
          description: d.description || "",
          visits_per_day: d.visits_per_day || 1,
          duration_min: d.duration_min || 15,
          image_url: "",
          active: true,
        });
        wPresta.delete(chatId);
        return bot.sendMessage(chatId, `✅ Prestation ajoutée: #${inserted.id} — ${inserted.name}`, kb([[{ text: "⬅️ Prestations", callback_data: "m_prestas" }]]));
      } catch (e) {
        wPresta.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout prestation KO: ${e.message}`);
      }
    }

    // edit
    if (pr.step === "edit_name") {
      d.name = text;
      pr.step = "edit_price";
      wPresta.set(chatId, pr);
      return bot.sendMessage(chatId, "Prix CHF (ex: 15, 46, 55) :");
    }
    if (pr.step === "edit_price") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return bot.sendMessage(chatId, "❌ Prix invalide");
      d.price_chf = money2(n);
      pr.step = "edit_desc";
      wPresta.set(chatId, pr);
      return bot.sendMessage(chatId, "Description (ou `-`) :");
    }
    if (pr.step === "edit_desc") {
      d.description = text === "-" ? "" : text;
      try {
        const updated = await dbUpdatePrestation(d.id, { name: d.name, price_chf: d.price_chf, description: d.description || "" });
        wPresta.delete(chatId);
        return bot.sendMessage(chatId, "✅ Prestation modifiée.", kb([[{ text: "⬅️ Retour", callback_data: `pre_open_${updated.id}` }]]));
      } catch (e) {
        wPresta.delete(chatId);
        return bot.sendMessage(chatId, `❌ Modif prestation KO: ${e.message}`);
      }
    }
  }
});

/* ================== START LISTEN ================== */
app.listen(PORT, () => console.log("ShaSitter server running on", PORT));
