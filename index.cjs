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
const WEBAPP_URL = process.env.WEBAPP_URL; // ex: https://shasitter.onrender.com

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
const ADMIN_IDS = new Set([
  6675436692, // <-- ton ID Telegram (change si besoin)
]);
const isAdmin = (chatId) => ADMIN_IDS.has(chatId);

/* ================== TELEGRAM BOT ================== */
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================== Telegram initData validation (PRIVATE APP) ==================
   On protège TOUTES les routes /api/* via initData Telegram WebApp.
*/
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
  // https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
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

function daysInclusive(startDate, endDate) {
  const a = new Date(`${startDate}T00:00:00Z`);
  const b = new Date(`${endDate}T00:00:00Z`);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff + 1;
}
function money2(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/* ================== DB HELPERS ================== */
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
async function dbInsertPrestation(p) {
  const { data, error } = await sb.from("prestations").insert(p).select("*").single();
  if (error) throw error;
  return data;
}
async function dbInsertClient(c) {
  const { data, error } = await sb.from("clients").insert(c).select("*").single();
  if (error) throw error;
  return data;
}
async function dbInsertEmployee(e) {
  const { data, error } = await sb.from("employees").insert(e).select("*").single();
  if (error) throw error;
  return data;
}
async function dbInsertBooking(b) {
  const { data, error } = await sb.from("bookings").insert(b).select("*").single();
  if (error) throw error;
  return data;
}

function utcTodayISO() {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function dbUpcomingBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(`*, clients (*), prestations (*), employees (*)`)
    .gte("end_date", iso)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function dbPastBookings() {
  const iso = utcTodayISO();
  const { data, error } = await sb
    .from("bookings")
    .select(`*, clients (*), prestations (*), employees (*)`)
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

      const month = String(b.start_date || "").slice(0, 7); // YYYY-MM
      byMonth.set(month, (byMonth.get(month) || 0) + Number(b.total_chf || 0));

      const ckey = String(b.client_id);
      byClient.set(ckey, (byClient.get(ckey) || 0) + Number(b.total_chf || 0));

      const pkey = String(b.prestation_id);
      byPresta.set(pkey, (byPresta.get(pkey) || 0) + Number(b.total_chf || 0));
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

/* ================== BOT MENU /start ================== */
function webAppUrl() {
  return WEBAPP_URL || "https://shasitter.onrender.com";
}

function sendMainMenu(chatId) {
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ App privée ShaSitter. Accès refusé.");

  return bot.sendMessage(chatId, "🐱 *ShaSitter — Menu Admin*\nTout se gère ici 👇", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Ouvrir l’app (dashboard)", web_app: { url: webAppUrl() } }],
        [
          { text: "➕ Ajouter prestation", callback_data: "add_presta" },
          { text: "👤 Ajouter client", callback_data: "add_client" },
        ],
        [
          { text: "📅 Ajouter réservation", callback_data: "add_booking" },
          { text: "👩‍💼 Ajouter employé", callback_data: "add_employee" },
        ],
        [
          { text: "⏰ Prestations à venir", callback_data: "list_upcoming" },
          { text: "🧾 Prestations passées", callback_data: "list_past" },
        ],
        [{ text: "💰 Comptabilité", callback_data: "show_compta" }],
      ],
    },
  });
}

bot.onText(/\/start/, (msg) => sendMainMenu(msg.chat.id));

/* ================== WIZARDS ================== */
const wPresta = new Map();
const wClient = new Map();
const wEmployee = new Map();
const wBooking = new Map();

function cancelWizard(map, chatId, label) {
  map.delete(chatId);
  bot.sendMessage(chatId, `❌ ${label} annulé.`);
}

function slotButtons(prefix) {
  return [
    [{ text: "🌅 Matin", callback_data: `${prefix}_slot_matin` }],
    [{ text: "🌙 Soir", callback_data: `${prefix}_slot_soir` }],
    [{ text: "🌅🌙 Matin + soir", callback_data: `${prefix}_slot_matin_soir` }],
    [{ text: "❌ Annuler", callback_data: `${prefix}_cancel` }],
  ];
}

/* ================== CALLBACKS ================== */
bot.on("callback_query", async (q) => {
  const chatId = q?.message?.chat?.id;
  if (!chatId) return;

  try {
    await bot.answerCallbackQuery(q.id);
  } catch {}

  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ Accès refusé.");

  // MENU
  if (q.data === "add_presta") {
    wPresta.set(chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "➕ *Nouvelle prestation*\n\n1/6 — Envoie le *nom*.", {
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
    const clients = await dbListClients();
    if (!clients.length) return bot.sendMessage(chatId, "Aucun client. Ajoute un client d’abord.");

    wBooking.set(chatId, { step: "pick_client", data: {} });

    const kb = clients.slice(0, 30).map((c) => [{ text: `#${c.id} ${c.name}`, callback_data: `bk_client_${c.id}` }]);
    kb.push([{ text: "❌ Annuler", callback_data: "bk_cancel" }]);

    return bot.sendMessage(chatId, "📅 *Nouvelle réservation*\n\n1/6 — Choisis le client :", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: kb },
    });
  }

  if (q.data === "list_upcoming") {
    const rows = await dbUpcomingBookings();
    if (!rows.length) return bot.sendMessage(chatId, "⏰ Aucune réservation à venir.");
    const txt = rows
      .slice(0, 25)
      .map((b) => {
        const c = b.clients?.name || "—";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c} • ${p}${emp} • ${b.total_chf} CHF`;
      })
      .join("\n");
    return bot.sendMessage(chatId, `⏰ *À venir*:\n\n${txt}`, { parse_mode: "Markdown" });
  }

  if (q.data === "list_past") {
    const rows = await dbPastBookings();
    if (!rows.length) return bot.sendMessage(chatId, "🧾 Aucune réservation passée.");
    const txt = rows
      .slice(0, 25)
      .map((b) => {
        const c = b.clients?.name || "—";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c} • ${p}${emp} • ${b.total_chf} CHF`;
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

  // CANCELS
  if (q.data === "presta_cancel") return cancelWizard(wPresta, chatId, "Prestation");
  if (q.data === "client_cancel") return cancelWizard(wClient, chatId, "Client");
  if (q.data === "emp_cancel") return cancelWizard(wEmployee, chatId, "Employé");
  if (q.data === "bk_cancel") return cancelWizard(wBooking, chatId, "Réservation");

  // BOOKING FLOW
  if (q.data?.startsWith("bk_client_")) {
    const st = wBooking.get(chatId);
    if (!st) return;
    const clientId = Number(q.data.replace("bk_client_", ""));
    st.data.client_id = clientId;

    const prestas = await dbListPrestations();
    if (!prestas.length) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, "Aucune prestation. Ajoute une prestation d’abord.");
    }

    st.step = "pick_presta";
    wBooking.set(chatId, st);

    const kb = prestas.slice(0, 30).map((p) => [
      { text: `#${p.id} ${p.name} (${p.animal_type})`, callback_data: `bk_presta_${p.id}` },
    ]);
    kb.push([{ text: "❌ Annuler", callback_data: "bk_cancel" }]);

    return bot.sendMessage(chatId, "2/6 — Choisis la prestation :", { reply_markup: { inline_keyboard: kb } });
  }

  if (q.data?.startsWith("bk_presta_")) {
    const st = wBooking.get(chatId);
    if (!st) return;
    const prestaId = Number(q.data.replace("bk_presta_", ""));
    st.data.prestation_id = prestaId;

    st.step = "pick_slot";
    wBooking.set(chatId, st);

    return bot.sendMessage(chatId, "3/6 — Choisis le créneau :", {
      reply_markup: { inline_keyboard: slotButtons("bk") },
    });
  }

  if (q.data?.startsWith("bk_slot_")) {
    const st = wBooking.get(chatId);
    if (!st) return;
    const slot = q.data.replace("bk_slot_", "");
    if (!SLOTS.includes(slot)) return;

    st.data.slot = slot;
    st.step = "start_date";
    wBooking.set(chatId, st);

    return bot.sendMessage(chatId, "4/6 — Envoie la date début (YYYY-MM-DD).");
  }

  if (q.data?.startsWith("bk_emp_")) {
    const st = wBooking.get(chatId);
    if (!st) return;

    const id = q.data.replace("bk_emp_", "");
    if (id === "none") {
      st.data.employee_id = null;
      st.data.employee_percent = 0;
    } else {
      st.data.employee_id = Number(id);
    }

    st.step = "employee_percent";
    wBooking.set(chatId, st);
    return bot.sendMessage(chatId, "6/6 — Pourcentage employé (0-100). (Ex: 30)");
  }
});

/* ================== TEXT INPUT HANDLER (Wizards) ================== */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!isAdmin(chatId)) return;
  if (text.startsWith("/")) return;

  // PRESTATION
  const ps = wPresta.get(chatId);
  if (ps) {
    const d = ps.data;

    if (ps.step === "name") {
      d.name = text;
      ps.step = "animal";
      wPresta.set(chatId, ps);
      return bot.sendMessage(chatId, "2/6 — Type animal: `chat` / `lapin` / `autre`");
    }
    if (ps.step === "animal") {
      const a = text.toLowerCase();
      if (!ANIMALS.includes(a)) return bot.sendMessage(chatId, "❌ Mets: chat / lapin / autre");
      d.animal_type = a;
      ps.step = "price";
      wPresta.set(chatId, ps);
      return bot.sendMessage(chatId, "3/6 — Prix CHF (ex: 15, 46, 55)");
    }
    if (ps.step === "price") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return bot.sendMessage(chatId, "❌ Prix invalide");
      d.price_chf = money2(n);
      ps.step = "visits";
      wPresta.set(chatId, ps);
      return bot.sendMessage(chatId, "4/6 — Visites par jour (1 ou 2).");
    }
    if (ps.step === "visits") {
      const v = Number(text);
      if (![1, 2].includes(v)) return bot.sendMessage(chatId, "❌ Mets 1 ou 2");
      d.visits_per_day = v;
      ps.step = "duration";
      wPresta.set(chatId, ps);
      return bot.sendMessage(chatId, "5/6 — Durée totale par jour en minutes (ex: 15, 30, 60, 90).");
    }
    if (ps.step === "duration") {
      const m = Number(text);
      if (!Number.isFinite(m) || m < 0) return bot.sendMessage(chatId, "❌ Durée invalide");
      d.duration_min = Math.floor(m);
      ps.step = "desc";
      wPresta.set(chatId, ps);
      return bot.sendMessage(chatId, "6/6 — Description (tu peux coller tout le texte).");
    }
    if (ps.step === "desc") {
      d.description = text;
      d.image_url = "";
      d.is_active = true;

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

  // CLIENT
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
      d.is_active = true;

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

  // EMPLOYEE
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
      d.is_active = true;

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

  // BOOKING
  const bs = wBooking.get(chatId);
  if (bs) {
    const d = bs.data;

    if (bs.step === "start_date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      d.start_date = text;
      bs.step = "end_date";
      wBooking.set(chatId, bs);
      return bot.sendMessage(chatId, "5/6 — Envoie la date fin (YYYY-MM-DD).");
    }

    if (bs.step === "end_date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      d.end_date = text;

      const emps = await dbListEmployees();
      bs.step = "pick_employee";
      wBooking.set(chatId, bs);

      const kb = emps.slice(0, 20).map((e) => [{ text: `#${e.id} ${e.name}`, callback_data: `bk_emp_${e.id}` }]);
      kb.unshift([{ text: "Aucun employé", callback_data: "bk_emp_none" }]);
      kb.push([{ text: "❌ Annuler", callback_data: "bk_cancel" }]);

      return bot.sendMessage(chatId, "6/6 — Assigner un employé ? (optionnel)", { reply_markup: { inline_keyboard: kb } });
    }

    if (bs.step === "employee_percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets 0-100");
      d.employee_percent = Math.floor(p);

      try {
        const { data: presta, error } = await sb.from("prestations").select("*").eq("id", d.prestation_id).single();
        if (error) throw error;

        const days = daysInclusive(d.start_date, d.end_date);
        if (days < 1) throw new Error("Dates invalides (fin avant début ?)");

        // NOTE: total simple = prix * nb jours.
        // Si tu veux multiplier matin/soir, on pourra le faire (ex: matin_soir => x2).
        const total = money2(Number(presta.price_chf) * days);

        const empPart = d.employee_id ? money2((total * d.employee_percent) / 100) : 0;
        const coPart = d.employee_id ? money2(total - empPart) : total;

        const payload = {
          client_id: d.client_id,
          prestation_id: d.prestation_id,
          slot: d.slot,
          start_date: d.start_date,
          end_date: d.end_date,
          days_count: days,
          total_chf: total,
          employee_id: d.employee_id || null,
          employee_percent: d.employee_id ? d.employee_percent : 0,
          employee_part_chf: empPart,
          company_part_chf: coPart,
          notes: "",
          status: "confirmed",
        };

        const inserted = await dbInsertBooking(payload);
        wBooking.delete(chatId);

        return bot.sendMessage(
          chatId,
          `✅ Réservation ajoutée: #${inserted.id}\n` +
            `Dates: ${inserted.start_date} → ${inserted.end_date} (${inserted.days_count} jours)\n` +
            `Total: ${inserted.total_chf} CHF\n` +
            (inserted.employee_id ? `Employé: ${inserted.employee_percent}%` : `Employé: aucun`)
        );
      } catch (e) {
        wBooking.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout booking KO: ${e.message}`);
      }
    }
  }
});

app.listen(PORT, () => console.log("ShaSitter server running on", PORT));
