/* index.cjs — ShaSitter (PRIVATE Telegram mini-app) — SQL aligned + Pets + Full button flow */

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
const WEBAPP_URL = process.env.WEBAPP_URL; // ex: https://xxx.onrender.com

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN manquant");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE manquants");
  process.exit(1);
}
if (!WEBAPP_URL) console.error("⚠️ WEBAPP_URL manquant (Render env). Exemple: https://xxx.onrender.com");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

/* ================== ADMIN ================== */
const ADMIN_IDS = new Set([6675436692]); // <-- ton ID
const isAdmin = (chatId) => ADMIN_IDS.has(chatId);

/* ================== TELEGRAM BOT (polling safe) ================== */
const bot = new TelegramBot(BOT_TOKEN, {
  polling: { interval: 300, autoStart: true, params: { timeout: 10 } },
});

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
  if (!initData) return res.status(401).json({ error: "missing_initdata" });

  const v = checkTelegramInitData(initData, BOT_TOKEN);
  if (!v.ok) return res.status(401).json({ error: "bad_initdata", reason: v.reason });

  const uid = extractUserIdFromInitData(initData);
  if (!uid || !ADMIN_IDS.has(uid)) return res.status(403).json({ error: "forbidden" });

  req.tg_user_id = uid;
  next();
}

/* ================== HELPERS ================== */
const ANIMALS = ["chat", "lapin", "autre"];
const SLOTS = ["matin", "soir", "matin_soir"];

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

function slotLabel(s) {
  return s === "matin" ? "🌅 Matin" : s === "soir" ? "🌙 Soir" : "🌅🌙 Matin + soir";
}
function animalLabel(a) {
  return a === "chat" ? "🐱 Chat" : a === "lapin" ? "🐰 Lapin" : "🐾 Autre";
}

async function answerCbq(q) {
  try {
    await bot.answerCallbackQuery(q.id);
  } catch {}
}

function webAppUrl() {
  return WEBAPP_URL || "https://shasitter.onrender.com";
}

function kbWrap(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

/* ================== DB HELPERS (aligned SQL) ================== */
async function dbListPrestations() {
  const { data, error } = await sb.from("prestations").select("*").order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbListClients() {
  const { data, error } = await sb.from("clients").select("*").order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbListEmployees() {
  const { data, error } = await sb.from("employees").select("*").order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function dbListPetsByClient(clientId) {
  const { data, error } = await sb.from("pets").select("*").eq("client_id", clientId).order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function dbInsertPrestation(p) {
  const payload = {
    name: p.name,
    animal_type: p.animal_type,
    price_chf: p.price_chf ?? 0,
    description: p.description ?? "",
    visits_per_day: p.visits_per_day ?? 1,
    duration_min: p.duration_min ?? 15,
    image_url: p.image_url ?? "",
    active: p.active !== false,
  };
  const { data, error } = await sb.from("prestations").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

async function dbInsertClient(c) {
  const payload = {
    name: c.name,
    phone: c.phone ?? "",
    address: c.address ?? "",
    notes: c.notes ?? "",
  };
  const { data, error } = await sb.from("clients").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

async function dbInsertEmployee(e) {
  const payload = {
    name: e.name,
    phone: e.phone ?? "",
    default_percent: e.default_percent ?? 0,
    active: e.active !== false,
  };
  const { data, error } = await sb.from("employees").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

async function dbInsertPet(p) {
  const payload = {
    client_id: p.client_id,
    name: p.name,
    animal_type: p.animal_type,
    notes: p.notes ?? "",
    active: p.active !== false,
  };
  const { data, error } = await sb.from("pets").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

async function dbInsertBooking(b) {
  const { data, error } = await sb.from("bookings").insert(b).select("*").single();
  if (error) throw error;
  return data;
}

async function dbUpcomingBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(`*, clients (*), prestations (*), employees (*), pets (*)`)
    .gte("end_date", iso)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function dbPastBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(`*, clients (*), prestations (*), employees (*), pets (*)`)
    .lt("end_date", iso)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* ================== API (Dashboard = affichage ONLY) ================== */
app.get("/api/prestations", requireAdminWebApp, async (req, res) => {
  try {
    res.json(await dbListPrestations());
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
      byClient.set(String(b.client_id), (byClient.get(String(b.client_id)) || 0) + Number(b.total_chf || 0));
      byPresta.set(String(b.prestation_id), (byPresta.get(String(b.prestation_id)) || 0) + Number(b.total_chf || 0));
    }

    const clients = await dbListClients();
    const prestas = await dbListPrestations();
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

/* ================== MENU /start ================== */
function sendMainMenu(chatId) {
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ App privée ShaSitter. Accès refusé.");

  return bot.sendMessage(chatId, "🐱 *ShaSitter — Menu Admin*\nTout se gère ici 👇", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Ouvrir l’app (dashboard)", web_app: { url: webAppUrl() } }],
        [
          { text: "➕ Ajouter prestation (catalogue)", callback_data: "add_presta" },
          { text: "👤 Ajouter client", callback_data: "add_client" },
        ],
        [
          { text: "📅 Ajouter réservation (client+animal+période)", callback_data: "add_booking" },
          { text: "👩‍💼 Ajouter employé", callback_data: "add_employee" },
        ],
        [
          { text: "⏰ Réservations à venir", callback_data: "list_upcoming" },
          { text: "🧾 Réservations passées", callback_data: "list_past" },
        ],
        [{ text: "💰 Comptabilité", callback_data: "show_compta" }],
      ],
    },
  });
}
bot.onText(/\/start/, (msg) => sendMainMenu(msg.chat.id));

/* ================== WIZARDS STATE ================== */
const wPresta = new Map();   // catalogue
const wClient = new Map();   // client direct (menu)
const wEmployee = new Map(); // employee
const wBooking = new Map();  // reservation flow

function cancelWizard(map, chatId, label) {
  map.delete(chatId);
  return bot.sendMessage(chatId, `❌ ${label} annulé.`);
}

/* ================== PRESTATION CATALOGUE (buttons) ================== */
function prestaAnimalButtons() {
  return [
    [{ text: "🐱 Chat", callback_data: "presta_an_chat" }],
    [{ text: "🐰 Lapin", callback_data: "presta_an_lapin" }],
    [{ text: "🐾 Autre", callback_data: "presta_an_autre" }],
    [{ text: "❌ Annuler", callback_data: "presta_cancel" }],
  ];
}
function visitsButtons() {
  return [
    [{ text: "1 visite / jour", callback_data: "presta_vis_1" }],
    [{ text: "2 visites / jour", callback_data: "presta_vis_2" }],
    [{ text: "⬅️ Retour", callback_data: "presta_back" }, { text: "❌ Annuler", callback_data: "presta_cancel" }],
  ];
}
function durationButtons() {
  const mins = [15, 20, 30, 45, 60, 90];
  const rows = mins.map((m) => [{ text: `${m} min / jour`, callback_data: `presta_dur_${m}` }]);
  rows.push([{ text: "⬅️ Retour", callback_data: "presta_back" }, { text: "❌ Annuler", callback_data: "presta_cancel" }]);
  return rows;
}

/* ================== BOOKING NAV ================== */
function bkNavRow() {
  return [{ text: "⬅️ Retour", callback_data: "bk_back" }, { text: "❌ Annuler", callback_data: "bk_cancel" }];
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

/* ================== BOOKING RENDER ================== */
async function renderBookingStep(chatId) {
  const st = getBkState(chatId);
  if (!st) return;

  const d = st.data || {};
  const step = st.step;

  const getClient = async () => {
    if (!d.client_id) return null;
    const { data, error } = await sb.from("clients").select("*").eq("id", d.client_id).single();
    if (error) return null;
    return data;
  };

  const getPet = async () => {
    if (!d.pet_id) return null;
    const { data, error } = await sb.from("pets").select("*").eq("id", d.pet_id).single();
    if (error) return null;
    return data;
  };

  const getPresta = async () => {
    if (!d.prestation_id) return null;
    const { data, error } = await sb.from("prestations").select("*").eq("id", d.prestation_id).single();
    if (error) return null;
    return data;
  };

  // 1) Pick or create client
  if (step === "pick_client") {
    const clients = await dbListClients();
    const rows = [];
    rows.push([{ text: "➕ Nouveau client", callback_data: "bk_client_new" }]);
    for (const c of clients.slice(0, 30)) {
      rows.push([{ text: `👤 ${c.name} (#${c.id})`, callback_data: `bk_client_${c.id}` }]);
    }
    rows.push([{ text: "❌ Annuler", callback_data: "bk_cancel" }]);

    return bot.sendMessage(chatId, "📅 *Nouvelle réservation*\n\n1/8 — Choisis un client :", {
      parse_mode: "Markdown",
      ...kbWrap(rows),
    });
  }

  // 2) Pick or create pet
  if (step === "pick_pet") {
    const c = await getClient();
    if (!c) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, "❌ Client introuvable. Recommence.");
    }

    const pets = await dbListPetsByClient(c.id);
    const rows = [];
    rows.push([{ text: "➕ Nouvel animal (donner un nom)", callback_data: "bk_pet_new" }]);
    for (const p of pets.filter((x) => x.active !== false).slice(0, 30)) {
      rows.push([{ text: `${animalLabel(p.animal_type)} ${p.name} (#${p.id})`, callback_data: `bk_pet_${p.id}` }]);
    }
    rows.push(bkNavRow());

    return bot.sendMessage(chatId, `2/8 — Choisis l’animal :\n\nClient: *${c.name}*`, {
      parse_mode: "Markdown",
      ...kbWrap(rows),
    });
  }

  // 3) Pick prestation
  if (step === "pick_presta") {
    const c = await getClient();
    const p = await getPet();
    if (!c || !p) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, "❌ Client/animal manquant. Recommence.");
    }

    const prestas = await dbListPrestations();
    const rows = prestas
      .filter((x) => x.active !== false)
      .filter((x) => x.animal_type === p.animal_type) // on propose celles qui match l’animal
      .slice(0, 40)
      .map((x) => [
        {
          text: `🧾 ${x.name} • ${x.price_chf} CHF`,
          callback_data: `bk_presta_${x.id}`,
        },
      ]);

    if (!rows.length) {
      rows.push([{ text: "⚠️ Aucune prestation pour cet animal", callback_data: "noop" }]);
    }

    rows.push(bkNavRow());
    return bot.sendMessage(
      chatId,
      `3/8 — Choisis la prestation :\n\nClient: *${c.name}*\nAnimal: *${p.name}* (${animalLabel(p.animal_type)})`,
      { parse_mode: "Markdown", ...kbWrap(rows) }
    );
  }

  // 4) Slot
  if (step === "pick_slot") {
    const c = await getClient();
    const p = await getPet();
    const pr = await getPresta();
    const rows = [
      [{ text: "🌅 Matin", callback_data: "bk_slot_matin" }],
      [{ text: "🌙 Soir", callback_data: "bk_slot_soir" }],
      [{ text: "🌅🌙 Matin + soir", callback_data: "bk_slot_matin_soir" }],
      bkNavRow(),
    ];
    return bot.sendMessage(
      chatId,
      `4/8 — Choisis le créneau :\n\nClient: *${c?.name || "—"}*\nAnimal: *${p?.name || "—"}*\nPrestation: *${pr?.name || "—"}*`,
      { parse_mode: "Markdown", ...kbWrap(rows) }
    );
  }

  // 5) start date
  if (step === "start_date") {
    const c = await getClient();
    const p = await getPet();
    const pr = await getPresta();
    return bot.sendMessage(
      chatId,
      `5/8 — Envoie la *date début* (YYYY-MM-DD)\n\nClient: *${c?.name || "—"}*\nAnimal: *${p?.name || "—"}*\nPrestation: *${pr?.name || "—"}*\nCréneau: *${slotLabel(d.slot)}*`,
      { parse_mode: "Markdown", ...kbWrap([bkNavRow()]) }
    );
  }

  // 6) end date
  if (step === "end_date") {
    return bot.sendMessage(chatId, `6/8 — Envoie la *date fin* (YYYY-MM-DD)\n\nDébut: *${d.start_date}*`, {
      parse_mode: "Markdown",
      ...kbWrap([bkNavRow()]),
    });
  }

  // 7) employee optional
  if (step === "pick_employee") {
    const emps = await dbListEmployees();
    const rows = [];
    rows.push([{ text: "Aucun employé", callback_data: "bk_emp_none" }]);
    for (const e of emps.filter((x) => x.active !== false).slice(0, 30)) {
      rows.push([{ text: `👩‍💼 ${e.name} (#${e.id})`, callback_data: `bk_emp_${e.id}` }]);
    }
    rows.push(bkNavRow());
    return bot.sendMessage(chatId, "7/8 — Assigner un employé ? (optionnel)", { ...kbWrap(rows) });
  }

  // 7b) employee percent
  if (step === "employee_percent") {
    return bot.sendMessage(chatId, "Pourcentage employé (0-100). Exemple: 30", { ...kbWrap([bkNavRow()]) });
  }

  // 8) recap confirm
  if (step === "recap") {
    const c = await getClient();
    const p = await getPet();
    const pr = await getPresta();
    if (!c || !p || !pr) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, "❌ Données manquantes. Recommence.");
    }

    const days = daysInclusive(d.start_date, d.end_date);
    if (days < 1) return bot.sendMessage(chatId, "❌ Dates invalides (fin avant début ?)");

    const slotMult = d.slot === "matin_soir" ? 2 : 1;
    const total = money2(Number(pr.price_chf) * days * slotMult);

    const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
    const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
    const coPart = d.employee_id ? money2(total - empPart) : total;

    d.days_count = days;
    d.total_chf = total;
    d.employee_part_chf = empPart;
    d.company_part_chf = coPart;

    setBkState(chatId, st);

    const rows = [
      [{ text: "✅ Confirmer", callback_data: "bk_confirm" }],
      [{ text: "⬅️ Retour (modifier)", callback_data: "bk_back" }],
      [{ text: "❌ Annuler", callback_data: "bk_cancel" }],
    ];

    const empLine = d.employee_id ? `Employé: *${empPercent}%* → *${empPart} CHF*` : `Employé: *aucun*`;

    return bot.sendMessage(
      chatId,
      `🧾 *Récap réservation*\n\n` +
        `Client: *${c.name}*\n` +
        `Animal: *${p.name}* (${animalLabel(p.animal_type)})\n` +
        `Prestation: *${pr.name}*\n` +
        `Créneau: *${slotLabel(d.slot)}* (x${slotMult})\n` +
        `Période: *${d.start_date} → ${d.end_date}* (*${days} jours*)\n\n` +
        `Total: *${total} CHF*\n` +
        `${empLine}\n` +
        `ShaSitter: *${coPart} CHF*`,
      { parse_mode: "Markdown", ...kbWrap(rows) }
    );
  }
}

/* ================== CALLBACKS (ONE handler only) ================== */
bot.on("callback_query", async (q) => {
  const chatId = q?.message?.chat?.id;
  if (!chatId) return;
  await answerCbq(q);

  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ Accès refusé.");

  /* MENU */
  if (q.data === "add_presta") {
    wPresta.set(chatId, { step: "name", data: {}, history: [] });
    return bot.sendMessage(chatId, "➕ *Nouvelle prestation (catalogue)*\n\n1/6 — Envoie le *nom*.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "❌ Annuler", callback_data: "presta_cancel" }]] },
    });
  }

  if (q.data === "add_client") {
    wClient.set(chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "👤 *Nouveau client*\n\n1/4 — Envoie le *nom*.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "❌ Annuler", callback_data: "client_cancel" }]] },
    });
  }

  if (q.data === "add_employee") {
    wEmployee.set(chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "👩‍💼 *Nouvel employé*\n\n1/3 — Envoie le *nom*.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "❌ Annuler", callback_data: "emp_cancel" }]] },
    });
  }

  if (q.data === "add_booking") {
    wBooking.set(chatId, { step: "pick_client", data: {}, history: [] });
    return renderBookingStep(chatId);
  }

  if (q.data === "list_upcoming") {
    const rows = await dbUpcomingBookings();
    if (!rows.length) return bot.sendMessage(chatId, "⏰ Aucune réservation à venir.");
    const txt = rows
      .slice(0, 30)
      .map((b) => {
        const c = b.clients?.name || "—";
        const pet = b.pets?.name ? ` • 🐾 ${b.pets.name}` : "";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${pet} • ${p}${emp} • ${b.total_chf} CHF`;
      })
      .join("\n");
    return bot.sendMessage(chatId, `⏰ *À venir*:\n\n${txt}`, { parse_mode: "Markdown" });
  }

  if (q.data === "list_past") {
    const rows = await dbPastBookings();
    if (!rows.length) return bot.sendMessage(chatId, "🧾 Aucune réservation passée.");
    const txt = rows
      .slice(0, 30)
      .map((b) => {
        const c = b.clients?.name || "—";
        const pet = b.pets?.name ? ` • 🐾 ${b.pets.name}` : "";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${pet} • ${p}${emp} • ${b.total_chf} CHF`;
      })
      .join("\n");
    return bot.sendMessage(chatId, `🧾 *Passées*:\n\n${txt}`, { parse_mode: "Markdown" });
  }

  if (q.data === "show_compta") {
    const { data, error } = await sb.from("bookings").select("total_chf,employee_part_chf,company_part_chf");
    if (error) return bot.sendMessage(chatId, `❌ Compta: ${error.message}`);
    const rows = data || [];
    const totalAll = rows.reduce((a, b) => a + Number(b.total_chf || 0), 0);
    const totalEmp = rows.reduce((a, b) => a + Number(b.employee_part_chf || 0), 0);
    const totalCo = rows.reduce((a, b) => a + Number(b.company_part_chf || 0), 0);
    return bot.sendMessage(
      chatId,
      `💰 *Comptabilité*\n\nTotal: *${money2(totalAll)} CHF*\nEmployés: *${money2(totalEmp)} CHF*\nShaSitter: *${money2(totalCo)} CHF*`,
      { parse_mode: "Markdown" }
    );
  }

  /* CANCELS */
  if (q.data === "client_cancel") return cancelWizard(wClient, chatId, "Client");
  if (q.data === "emp_cancel") return cancelWizard(wEmployee, chatId, "Employé");

  /* BOOKING cancel/back */
  if (q.data === "bk_cancel") return cancelWizard(wBooking, chatId, "Réservation");
  if (q.data === "bk_back") {
    const st = getBkState(chatId);
    if (!st) return;
    const prev = popStep(st);
    if (!prev) return cancelWizard(wBooking, chatId, "Réservation");
    st.step = prev;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  /* BOOKING pick/create client */
  if (q.data === "bk_client_new") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "client_new_name";
    setBkState(chatId, st);
    return bot.sendMessage(chatId, "1/3 — Envoie le *nom du client*.", { parse_mode: "Markdown", ...kbWrap([bkNavRow()]) });
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

  /* BOOKING pet */
  if (q.data === "bk_pet_new") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "pet_new_name";
    setBkState(chatId, st);
    return bot.sendMessage(chatId, "Envoie le *nom de l’animal* (ex: Minou).", { parse_mode: "Markdown", ...kbWrap([bkNavRow()]) });
  }

  if (q.data?.startsWith("bk_pet_")) {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.data.pet_id = Number(q.data.replace("bk_pet_", ""));
    st.step = "pick_presta";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  /* BOOKING prestation */
  if (q.data?.startsWith("bk_presta_")) {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.data.prestation_id = Number(q.data.replace("bk_presta_", ""));
    st.step = "pick_slot";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  /* BOOKING slot */
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

  /* BOOKING employee */
  if (q.data?.startsWith("bk_emp_")) {
    const st = getBkState(chatId);
    if (!st) return;

    pushStep(st, st.step);

    const id = q.data.replace("bk_emp_", "");
    if (id === "none") {
      st.data.employee_id = null;
      st.data.employee_percent = 0;
      st.step = "recap";
      setBkState(chatId, st);
      return renderBookingStep(chatId);
    }

    st.data.employee_id = Number(id);
    st.step = "employee_percent";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data === "bk_confirm") {
    const st = getBkState(chatId);
    if (!st) return;
    const d = st.data || {};

    try {
      const { data: presta, error: pErr } = await sb.from("prestations").select("*").eq("id", d.prestation_id).single();
      if (pErr) throw pErr;

      const days = daysInclusive(d.start_date, d.end_date);
      if (days < 1) throw new Error("Dates invalides (fin avant début ?)");

      const slotMult = d.slot === "matin_soir" ? 2 : 1;
      const total = money2(Number(presta.price_chf) * days * slotMult);

      const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
      const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
      const coPart = d.employee_id ? money2(total - empPart) : total;

      const payload = {
        client_id: d.client_id,
        pet_id: d.pet_id,
        prestation_id: d.prestation_id,
        slot: d.slot,
        start_date: d.start_date,
        end_date: d.end_date,
        days_count: days,
        total_chf: total,
        employee_id: d.employee_id || null,
        employee_percent: d.employee_id ? empPercent : 0,
        employee_part_chf: empPart,
        company_part_chf: coPart,
        notes: "",
        status: "confirmed",
      };

      const inserted = await dbInsertBooking(payload);
      wBooking.delete(chatId);

      return bot.sendMessage(
        chatId,
        `✅ *Réservation ajoutée*\n\n#${inserted.id} • ${inserted.start_date}→${inserted.end_date}\nTotal: *${inserted.total_chf} CHF*`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, `❌ Ajout KO: ${e.message}`);
    }
  }

  /* PRESTATION catalogue buttons */
  if (q.data === "presta_cancel") return cancelWizard(wPresta, chatId, "Prestation (catalogue)");

  if (q.data === "presta_back") {
    const st = wPresta.get(chatId);
    if (!st) return;
    const prev = (st.history || []).pop();
    if (!prev) return cancelWizard(wPresta, chatId, "Prestation (catalogue)");
    st.step = prev;
    wPresta.set(chatId, st);

    if (st.step === "animal") return bot.sendMessage(chatId, "2/6 — Type animal :", { ...kbWrap(prestaAnimalButtons()) });
    if (st.step === "visits") return bot.sendMessage(chatId, "4/6 — Visites par jour :", { ...kbWrap(visitsButtons()) });
    if (st.step === "duration") return bot.sendMessage(chatId, "5/6 — Durée totale par jour :", { ...kbWrap(durationButtons()) });
    return;
  }

  if (q.data?.startsWith("presta_an_")) {
    const st = wPresta.get(chatId);
    if (!st) return;
    const a = q.data.replace("presta_an_", "");
    if (!ANIMALS.includes(a)) return;
    st.history = st.history || [];
    st.history.push(st.step);
    st.data.animal_type = a;
    st.step = "price";
    wPresta.set(chatId, st);
    return bot.sendMessage(chatId, `3/6 — Prix CHF (ex: 15, 46, 55)\n\nAnimal: ${animalLabel(a)}`);
  }

  if (q.data?.startsWith("presta_vis_")) {
    const st = wPresta.get(chatId);
    if (!st) return;
    const v = Number(q.data.replace("presta_vis_", ""));
    if (![1, 2].includes(v)) return;
    st.history = st.history || [];
    st.history.push(st.step);
    st.data.visits_per_day = v;
    st.step = "duration";
    wPresta.set(chatId, st);
    return bot.sendMessage(chatId, "5/6 — Durée totale par jour :", { ...kbWrap(durationButtons()) });
  }

  if (q.data?.startsWith("presta_dur_")) {
    const st = wPresta.get(chatId);
    if (!st) return;
    const m = Number(q.data.replace("presta_dur_", ""));
    if (!Number.isFinite(m) || m <= 0) return;
    st.history = st.history || [];
    st.history.push(st.step);
    st.data.duration_min = Math.floor(m);
    st.step = "desc";
    wPresta.set(chatId, st);
    return bot.sendMessage(chatId, "6/6 — Description (tu peux coller tout le texte).");
  }
});

/* ================== TEXT INPUT HANDLER ================== */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!isAdmin(chatId)) return;
  if (text.startsWith("/")) return;

  /* BOOKING typed steps */
  const bk = getBkState(chatId);
  if (bk) {
    const d = bk.data || {};

    // new client flow inside booking
    if (bk.step === "client_new_name") {
      if (!text) return bot.sendMessage(chatId, "❌ Envoie un nom client.");
      pushStep(bk, bk.step);
      bk.data._new_client = { name: text };
      bk.step = "client_new_phone";
      setBkState(chatId, bk);
      return bot.sendMessage(chatId, "2/3 — Téléphone (ou `-`)", { ...kbWrap([bkNavRow()]) });
    }
    if (bk.step === "client_new_phone") {
      pushStep(bk, bk.step);
      bk.data._new_client.phone = text === "-" ? "" : text;
      bk.step = "client_new_address";
      setBkState(chatId, bk);
      return bot.sendMessage(chatId, "3/3 — Adresse (ou `-`)", { ...kbWrap([bkNavRow()]) });
    }
    if (bk.step === "client_new_address") {
      try {
        pushStep(bk, bk.step);
        bk.data._new_client.address = text === "-" ? "" : text;
        bk.data._new_client.notes = "";
        const created = await dbInsertClient(bk.data._new_client);
        bk.data.client_id = created.id;
        delete bk.data._new_client;
        bk.step = "pick_pet";
        setBkState(chatId, bk);
        return renderBookingStep(chatId);
      } catch (e) {
        wBooking.delete(chatId);
        return bot.sendMessage(chatId, `❌ Création client KO: ${e.message}`);
      }
    }

    // new pet name
    if (bk.step === "pet_new_name") {
      if (!d.client_id) return bot.sendMessage(chatId, "❌ Client manquant.");
      if (!text) return bot.sendMessage(chatId, "❌ Envoie un nom.");
      pushStep(bk, bk.step);
      bk.data._new_pet = { name: text };
      bk.step = "pet_new_animal";
      setBkState(chatId, bk);
      return bot.sendMessage(chatId, "Type d’animal :", {
        ...kbWrap([
          [{ text: "🐱 Chat", callback_data: "pet_an_chat" }],
          [{ text: "🐰 Lapin", callback_data: "pet_an_lapin" }],
          [{ text: "🐾 Autre", callback_data: "pet_an_autre" }],
          bkNavRow(),
        ]),
      });
    }

    // dates / percent
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
      bk.step = "pick_employee";
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

  /* PET animal buttons are handled here via callback_query:
     we add a tiny listener by checking msg? no, use callback_query for pet_an_*
     => handled below by a second callback? NO. We do it here by adding a dedicated callback handler is not possible.
     So we add it in callback_query section quickly by using bot.on('callback_query') above.
  */

  /* PRESTATION catalogue typed steps */
  const ps = wPresta.get(chatId);
  if (ps) {
    const d = ps.data;

    if (ps.step === "name") {
      d.name = text;
      ps.history = ps.history || [];
      ps.history.push(ps.step);
      ps.step = "animal";
      wPresta.set(chatId, ps);
      return bot.sendMessage(chatId, "2/6 — Type animal :", { ...kbWrap(prestaAnimalButtons()) });
    }

    if (ps.step === "price") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return bot.sendMessage(chatId, "❌ Prix invalide");
      d.price_chf = money2(n);
      ps.history = ps.history || [];
      ps.history.push(ps.step);
      ps.step = "visits";
      wPresta.set(chatId, ps);
      return bot.sendMessage(chatId, "4/6 — Visites par jour :", { ...kbWrap(visitsButtons()) });
    }

    if (ps.step === "desc") {
      d.description = text || "";
      d.image_url = "";
      d.active = true;

      try {
        const inserted = await dbInsertPrestation(d);
        wPresta.delete(chatId);
        return bot.sendMessage(chatId, `✅ Prestation ajoutée: #${inserted.id} — ${inserted.name} (${inserted.animal_type})`);
      } catch (e) {
        wPresta.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout prestation KO: ${e.message}`);
      }
    }
  }

  /* CLIENT wizard (menu direct) */
  const cs = wClient.get(chatId);
  if (cs) {
    const d = cs.data;

    if (cs.step === "name") {
      d.name = text;
      cs.step = "phone";
      wClient.set(chatId, cs);
      return bot.sendMessage(chatId, "2/4 — Téléphone");
    }
    if (cs.step === "phone") {
      d.phone = text;
      cs.step = "address";
      wClient.set(chatId, cs);
      return bot.sendMessage(chatId, "3/4 — Adresse");
    }
    if (cs.step === "address") {
      d.address = text;
      cs.step = "notes";
      wClient.set(chatId, cs);
      return bot.sendMessage(chatId, "4/4 — Notes (ou `-`)");
    }
    if (cs.step === "notes") {
      d.notes = text === "-" ? "" : text;
      try {
        const inserted = await dbInsertClient(d);
        wClient.delete(chatId);
        return bot.sendMessage(chatId, `✅ Client ajouté: #${inserted.id} — ${inserted.name}`);
      } catch (e) {
        wClient.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout client KO: ${e.message}`);
      }
    }
  }

  /* EMPLOYEE wizard */
  const es = wEmployee.get(chatId);
  if (es) {
    const d = es.data;

    if (es.step === "name") {
      d.name = text;
      es.step = "phone";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "2/3 — Téléphone (ou `-`)");
    }
    if (es.step === "phone") {
      d.phone = text === "-" ? "" : text;
      es.step = "percent";
      wEmployee.set(chatId, es);
      return bot.sendMessage(chatId, "3/3 — Pourcentage par défaut (0-100)");
    }
    if (es.step === "percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets un nombre 0-100");
      d.default_percent = Math.floor(p);
      d.active = true;

      try {
        const inserted = await dbInsertEmployee(d);
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `✅ Employé ajouté: #${inserted.id} — ${inserted.name} (${inserted.default_percent}%)`);
      } catch (e) {
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout employé KO: ${e.message}`);
      }
    }
  }
});

/* ================== EXTRA callback for PET animal type (inside same file) ================== */
bot.on("callback_query", async (q) => {
  const chatId = q?.message?.chat?.id;
  if (!chatId) return;

  // We already have a callback handler above; to avoid double-processing,
  // we only handle pet_an_* here and ignore everything else.
  if (!q.data?.startsWith("pet_an_")) return;

  await answerCbq(q);
  if (!isAdmin(chatId)) return;

  const bk = getBkState(chatId);
  if (!bk || bk.step !== "pet_new_animal") return;

  const a = q.data.replace("pet_an_", "");
  if (!ANIMALS.includes(a)) return;

  try {
    const d = bk.data || {};
    const petName = d._new_pet?.name;
    if (!d.client_id || !petName) throw new Error("Client/nom animal manquant.");

    const created = await dbInsertPet({
      client_id: d.client_id,
      name: petName,
      animal_type: a,
      notes: "",
      active: true,
    });

    delete d._new_pet;
    d.pet_id = created.id;

    pushStep(bk, bk.step);
    bk.step = "pick_presta";
    setBkState(chatId, bk);
    return renderBookingStep(chatId);
  } catch (e) {
    wBooking.delete(chatId);
    return bot.sendMessage(chatId, `❌ Création animal KO: ${e.message}`);
  }
});

/* ================== START LISTEN ================== */
app.listen(PORT, () => console.log("ShaSitter server running on", PORT));
