/* index.cjs — ShaSitter (Telegram Bot + Supabase) — aligned to YOUR SQL schema
   - tables: clients, employees(active), prestations(active), bookings, payments
   - "Ajouter prestation" = Ajouter réservation (période) avec packs + options (boutons)
*/

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

/* ================== APP ================== */
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

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

/* ================== ADMIN ================== */
const ADMIN_IDS = new Set([6675436692]); // <-- ton ID
const isAdmin = (chatId) => ADMIN_IDS.has(chatId);

/* ================== TELEGRAM BOT ==================
   Fix 409: stop polling proprement sur redeploy.
   IMPORTANT: sur Render -> 1 seule instance (WEB_CONCURRENCY=1)
*/
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

/* ================== Telegram WebApp initData validation (optional) ================== */
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

function webAppUrl() {
  return WEBAPP_URL || "https://shasitter.onrender.com";
}
async function answerCbq(q) {
  try {
    await bot.answerCallbackQuery(q.id);
  } catch {}
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
function animalLabel(a) {
  return a === "chat" ? "🐱 Chat" : a === "lapin" ? "🐰 Lapin" : "🐾 Autre";
}
function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
function navRow(prefix) {
  return [
    { text: "⬅️ Retour", callback_data: `${prefix}_back` },
    { text: "❌ Annuler", callback_data: `${prefix}_cancel` },
  ];
}
function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/* ================== PACKS + EXTRAS (from your images) ================== */
/* Packs are saved in prestations (catalogue) automatically.
   Extras are NOT in DB schema => stored in booking.notes JSON and added to total.
*/
const PACKS = {
  chat: {
    1: [
      { key: "essentiel", name: "Essentiel", duration_min: 15, price_chf: 15 },
      { key: "tendresse", name: "Tendresse", duration_min: 30, price_chf: 25 },
      { key: "confort", name: "Confort", duration_min: 45, price_chf: 35 },
      { key: "complicite", name: "Complicité", duration_min: 60, price_chf: 45 },
      { key: "sur_mesure", name: "Sur-mesure", duration_min: 15, price_chf: null }, // prix demandé
    ],
    2: [
      { key: "duo_essentiel", name: "Duo Essentiel", duration_min: 30, price_chf: 26 },
      { key: "duo_tendresse", name: "Duo Tendresse", duration_min: 60, price_chf: 46 },
      { key: "duo_confort", name: "Duo Confort", duration_min: 90, price_chf: 66 },
      { key: "duo_complicite", name: "Duo Complicité", duration_min: 120, price_chf: 86 },
      { key: "duo_sur_mesure", name: "Duo Sur-mesure", duration_min: 30, price_chf: null },
    ],
  },
  // si tu veux des tarifs lapin différents, tu me donnes l'image “packs lapin” et on remplace.
  lapin: {
    1: [
      { key: "essentiel", name: "Essentiel", duration_min: 15, price_chf: 15 },
      { key: "tendresse", name: "Tendresse", duration_min: 30, price_chf: 25 },
      { key: "confort", name: "Confort", duration_min: 45, price_chf: 35 },
      { key: "complicite", name: "Complicité", duration_min: 60, price_chf: 45 },
      { key: "sur_mesure", name: "Sur-mesure", duration_min: 15, price_chf: null },
    ],
    2: [
      { key: "duo_essentiel", name: "Duo Essentiel", duration_min: 30, price_chf: 26 },
      { key: "duo_tendresse", name: "Duo Tendresse", duration_min: 60, price_chf: 46 },
      { key: "duo_confort", name: "Duo Confort", duration_min: 90, price_chf: 66 },
      { key: "duo_complicite", name: "Duo Complicité", duration_min: 120, price_chf: 86 },
      { key: "duo_sur_mesure", name: "Duo Sur-mesure", duration_min: 30, price_chf: null },
    ],
  },
  autre: {
    1: [{ key: "sur_mesure", name: "Sur-mesure", duration_min: 15, price_chf: null }],
    2: [{ key: "duo_sur_mesure", name: "Duo Sur-mesure", duration_min: 30, price_chf: null }],
  },
};

const EXTRAS = [
  { key: "multi_cats", label: "Supplément multi-chats", type: "per_extra_cat_per_day", price_chf: 10 },
  { key: "meds", label: "Médicaments / soins spécifiques", type: "once", price_chf: 10 },
  { key: "water", label: "Arrosage des plantes", type: "once", price_chf: 6 },
  { key: "mail", label: "Relever le courrier", type: "once", price_chf: 6 },
  { key: "keys", label: "Remise des clés", type: "once", price_chf: 6 },
  { key: "shutters", label: "Ouverture / fermeture stores", type: "once", price_chf: 6 },
  { key: "vet", label: "Accompagnement vétérinaire", type: "once", price_chf: 30 },
  { key: "brush", label: "Brossage régulier", type: "once", price_chf: 6 },
  { key: "shopping", label: "Courses / fournitures", type: "once", price_chf: 12 },
  { key: "photos", label: "Envoi photos/vidéos", type: "once", price_chf: 0 },
  { key: "eyes", label: "Nettoyage yeux / oreilles", type: "once", price_chf: 6 },
];

/* ================== DB HELPERS (aligned to your SQL) ================== */
async function dbListPrestationsActive() {
  const { data, error } = await sb
    .from("prestations")
    .select("*")
    .eq("active", true)
    .order("animal_type", { ascending: true })
    .order("visits_per_day", { ascending: true })
    .order("price_chf", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbListClients() {
  const { data, error } = await sb.from("clients").select("*").order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function dbListEmployeesActive() {
  const { data, error } = await sb.from("employees").select("*").eq("active", true).order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function dbInsertClient(c) {
  const { data, error } = await sb.from("clients").insert(c).select("*").single();
  if (error) throw error;
  return data;
}
async function dbInsertEmployee(e) {
  // employees has: name, phone, default_percent, active
  const { data, error } = await sb.from("employees").insert(e).select("*").single();
  if (error) throw error;
  return data;
}
async function dbInsertPrestation(p) {
  // prestations has: name, animal_type, price_chf, visits_per_day, duration_min, description, image_url, active
  const { data, error } = await sb.from("prestations").insert(p).select("*").single();
  if (error) throw error;
  return data;
}
async function dbInsertBooking(b) {
  // bookings: client_id, prestation_id, slot, start_date, end_date, days_count, total_chf,
  // employee_id, employee_percent, employee_part_chf, company_part_chf, notes, status
  const { data, error } = await sb.from("bookings").insert(b).select("*").single();
  if (error) throw error;
  return data;
}
async function dbSetEmployeeActive(id, active) {
  const { error } = await sb.from("employees").update({ active }).eq("id", id);
  if (error) throw error;
}
async function dbSetPrestationActive(id, active) {
  const { error } = await sb.from("prestations").update({ active }).eq("id", id);
  if (error) throw error;
}
async function dbDeleteClient(id) {
  const { error } = await sb.from("clients").delete().eq("id", id);
  if (error) throw error;
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

/* ================== SEED PACKS INTO prestations (once) ================== */
async function ensurePackCatalogue() {
  try {
    const existing = await dbListPrestationsActive();
    const keySet = new Set(
      existing.map((p) => `${p.animal_type}|${p.visits_per_day}|${p.name}|${Number(p.price_chf)}|${p.duration_min}`)
    );

    const toInsert = [];
    for (const animal of Object.keys(PACKS)) {
      for (const visits of [1, 2]) {
        for (const pack of PACKS[animal][visits] || []) {
          if (pack.price_chf == null) continue; // sur-mesure => prix variable, pas seed
          const k = `${animal}|${visits}|${pack.name}|${Number(pack.price_chf)}|${pack.duration_min}`;
          if (!keySet.has(k)) {
            toInsert.push({
              name: pack.name,
              animal_type: animal,
              price_chf: pack.price_chf,
              visits_per_day: visits,
              duration_min: pack.duration_min,
              description: "",
              image_url: "",
              active: true,
            });
          }
        }
      }
    }

    if (toInsert.length) {
      // insert in batch
      const { error } = await sb.from("prestations").insert(toInsert);
      if (error) throw error;
      console.log(`✅ Seed prestations: ${toInsert.length} packs inserted`);
    } else {
      console.log("✅ Seed prestations: already OK");
    }
  } catch (e) {
    console.error("⚠️ ensurePackCatalogue failed:", e.message);
  }
}
ensurePackCatalogue();

/* ================== API (dashboard read-only) ================== */
app.get("/api/prestations", requireAdminWebApp, async (req, res) => {
  try {
    const { data, error } = await sb.from("prestations").select("*").order("id", { ascending: true });
    if (error) throw error;
    res.json(data || []);
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
    const { data, error } = await sb.from("employees").select("*").order("id", { ascending: true });
    if (error) throw error;
    res.json(data || []);
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
    let totalAll = 0;
    let totalEmployee = 0;
    let totalCompany = 0;

    const byMonth = new Map();
    const byClient = new Map();
    const byPresta = new Map();

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
    const { data: prestasAll, error: pErr } = await sb.from("prestations").select("id,name");
    if (pErr) throw pErr;

    const cName = new Map(clients.map((c) => [String(c.id), c.name]));
    const pName = new Map((prestasAll || []).map((p) => [String(p.id), p.name]));

    res.json({
      totalAll: money2(totalAll),
      totalEmployee: money2(totalEmployee),
      totalCompany: money2(totalCompany),
      months: [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, total]) => ({ month, total: money2(total) })),
      topClients: [...byClient.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([id, total]) => ({ id: Number(id), name: cName.get(id) || `Client #${id}`, total: money2(total) })),
      topPrestations: [...byPresta.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([id, total]) => ({ id: Number(id), name: pName.get(id) || `Prestation #${id}`, total: money2(total) })),
    });
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});

/* ================== /start MAIN MENU ================== */
function sendMainMenu(chatId) {
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ App privée ShaSitter. Accès refusé.");
  return bot.sendMessage(chatId, "🐾 *ShaSitter — Menu Admin*\nChoisis :", {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "📊 Ouvrir l’app (dashboard)", web_app: { url: webAppUrl() } }],
      [{ text: "➕ Ajouter prestation (réservation)", callback_data: "bk_start" }],
      [
        { text: "👥 Clients", callback_data: "m_clients" },
        { text: "👩‍💼 Employés", callback_data: "m_emps" },
      ],
      [{ text: "🧾 Packs/Prestations (catalogue)", callback_data: "m_prestas" }],
      [
        { text: "⏰ À venir", callback_data: "list_upcoming" },
        { text: "🧾 Passées", callback_data: "list_past" },
      ],
      [{ text: "💰 Comptabilité", callback_data: "show_compta" }],
    ]),
  });
}
bot.onText(/\/start/, (msg) => sendMainMenu(msg.chat.id));

/* ================== STATES ================== */
const wBooking = new Map(); // réservation
const wClient = new Map();
const wEmployee = new Map();

function cancelWizard(map, chatId, label) {
  map.delete(chatId);
  return bot.sendMessage(chatId, `❌ ${label} annulé.`);
}
function setState(map, chatId, st) {
  map.set(chatId, st);
}
function getState(map, chatId) {
  return map.get(chatId);
}
function pushHist(st) {
  st.history = st.history || [];
  st.history.push(st.step);
}
function popHist(st) {
  st.history = st.history || [];
  return st.history.pop();
}

/* ================== BOOKING FLOW (like your photos) ================== */
async function renderBooking(chatId) {
  const st = getState(wBooking, chatId);
  if (!st) return;
  const d = st.data || {};

  // small labels
  const clientLine = d.client ? `👤 Client: *${d.client.name}* (#${d.client.id})\n` : "";
  const animalLine = d.animal_type ? `🐾 Animal: *${animalLabel(d.animal_type)}*` + (d.animal_name ? ` — *${d.animal_name}*\n` : "\n") : "";
  const packLine = d.pack_name ? `🧾 Pack: *${d.pack_name}* (${d.visits_per_day} visite(s)/jour)\n` : "";
  const periodLine = d.start_date && d.end_date ? `📅 Période: *${d.start_date} → ${d.end_date}*\n` : "";

  if (st.step === "pick_client") {
    const clients = await dbListClients();
    const rows = [
      [{ text: "➕ Nouveau client", callback_data: "bk_new_client" }],
      ...clients.slice(0, 30).map((c) => [{ text: `👤 ${c.name} (#${c.id})`, callback_data: `bk_client_${c.id}` }]),
      [{ text: "❌ Annuler", callback_data: "bk_cancel" }],
    ];
    return bot.sendMessage(chatId, "➕ *Nouvelle prestation (réservation)*\n\n1/8 — À qui ? (choisis un client)", {
      parse_mode: "Markdown",
      ...kb(rows),
    });
  }

  if (st.step === "animal_type") {
    return bot.sendMessage(
      chatId,
      `2/8 — Quel animal ?\n\n${clientLine}`,
      {
        parse_mode: "Markdown",
        ...kb([
          [{ text: "🐱 Chat", callback_data: "bk_an_chat" }],
          [{ text: "🐰 Lapin", callback_data: "bk_an_lapin" }],
          [{ text: "🐾 Autre", callback_data: "bk_an_autre" }],
          navRow("bk"),
        ]),
      }
    );
  }

  if (st.step === "animal_name") {
    return bot.sendMessage(
      chatId,
      `3/8 — Envoie le *nom de l’animal*.\n\n${clientLine}${animalLine}`,
      { parse_mode: "Markdown", ...kb([navRow("bk")]) }
    );
  }

  if (st.step === "pick_visits") {
    return bot.sendMessage(
      chatId,
      `4/8 — Choisis le type de pack\n\n${clientLine}${animalLine}`,
      {
        parse_mode: "Markdown",
        ...kb([
          [{ text: "🐾 Packs 1 visite / jour", callback_data: "bk_vis_1" }],
          [{ text: "🐾 Packs 2 visites / jour", callback_data: "bk_vis_2" }],
          navRow("bk"),
        ]),
      }
    );
  }

  if (st.step === "pick_pack") {
    const animal = d.animal_type || "chat";
    const visits = d.visits_per_day || 1;
    const list = (PACKS[animal] && PACKS[animal][visits]) ? PACKS[animal][visits] : [];

    const rows = list.map((p) => {
      const priceTxt = p.price_chf == null ? "Sur demande" : `${p.price_chf} CHF`;
      const durTxt = `${p.duration_min} min`;
      return [{ text: `${p.name} • ${durTxt} • ${priceTxt}`, callback_data: `bk_pack_${p.key}` }];
    });

    rows.push(navRow("bk"));
    return bot.sendMessage(
      chatId,
      `5/8 — Choisis le pack\n\n${clientLine}${animalLine}🧾 Catégorie: *${visits} visite(s)/jour*`,
      { parse_mode: "Markdown", ...kb(rows) }
    );
  }

  if (st.step === "sur_mesure_price") {
    return bot.sendMessage(
      chatId,
      `Prix “sur-mesure” (CHF par jour) ?\nEx: 55\n\n${clientLine}${animalLine}🧾 Pack: *${d.pack_name}*`,
      { parse_mode: "Markdown", ...kb([navRow("bk")]) }
    );
  }

  if (st.step === "pick_extras") {
    const selected = new Set(d.extras || []);
    const rows = EXTRAS.map((x) => {
      const on = selected.has(x.key);
      const mark = on ? "✅ " : "➕ ";
      const priceTxt =
        x.type === "per_extra_cat_per_day" ? `${x.price_chf} CHF / chat / jour` :
        x.price_chf === 0 ? "Gratuit" :
        `${x.price_chf} CHF`;
      return [{ text: `${mark}${x.label} • ${priceTxt}`, callback_data: `bk_ex_${x.key}` }];
    });

    rows.push([{ text: "➡️ Continuer", callback_data: "bk_ex_done" }]);
    rows.push(navRow("bk"));

    return bot.sendMessage(
      chatId,
      `6/8 — Options supplémentaires (tu peux en sélectionner plusieurs)\n\n${clientLine}${animalLine}${packLine}`,
      { parse_mode: "Markdown", ...kb(rows) }
    );
  }

  if (st.step === "multi_cats_count") {
    return bot.sendMessage(
      chatId,
      `Combien de *chats supplémentaires* ? (nombre)\n\nEx: 1, 2, 3\n\n${clientLine}${animalLine}${packLine}`,
      { parse_mode: "Markdown", ...kb([navRow("bk")]) }
    );
  }

  if (st.step === "start_date") {
    return bot.sendMessage(
      chatId,
      `7/8 — Date début (YYYY-MM-DD)\n\n${clientLine}${animalLine}${packLine}`,
      { parse_mode: "Markdown", ...kb([navRow("bk")]) }
    );
  }

  if (st.step === "end_date") {
    return bot.sendMessage(
      chatId,
      `8/8 — Date fin (YYYY-MM-DD)\n\n${clientLine}${animalLine}${packLine}Début: *${d.start_date}*\n`,
      { parse_mode: "Markdown", ...kb([navRow("bk")]) }
    );
  }

  if (st.step === "pick_employee") {
    const emps = await dbListEmployeesActive();
    const rows = [
      [{ text: "🙅‍♂️ Pas d’employé", callback_data: "bk_emp_none" }],
      ...emps.slice(0, 30).map((e) => [{ text: `👩‍💼 ${e.name} (#${e.id})`, callback_data: `bk_emp_${e.id}` }]),
      navRow("bk"),
    ];
    return bot.sendMessage(
      chatId,
      `Employé ?\n\n${clientLine}${animalLine}${packLine}${periodLine}`,
      { parse_mode: "Markdown", ...kb(rows) }
    );
  }

  if (st.step === "employee_percent") {
    return bot.sendMessage(
      chatId,
      `Pourcentage employé (0-100). Ex: 40`,
      { ...kb([navRow("bk")]) }
    );
  }

  if (st.step === "recap") {
    // compute totals
    const days = daysInclusive(d.start_date, d.end_date);
    if (days < 1) return bot.sendMessage(chatId, "❌ Dates invalides (fin avant début ?)");

    const baseTotal = money2(Number(d.price_per_day || 0) * days);

    // extras
    const extras = d.extras || [];
    let extrasOnce = 0;
    let multiCatsTotal = 0;

    for (const k of extras) {
      const ex = EXTRAS.find((x) => x.key === k);
      if (!ex) continue;

      if (ex.type === "once") extrasOnce += Number(ex.price_chf || 0);
      if (ex.type === "per_extra_cat_per_day") {
        const cnt = Number(d.multi_cats_count || 0);
        if (cnt > 0) multiCatsTotal += Number(ex.price_chf || 0) * cnt * days;
      }
    }

    const total = money2(baseTotal + extrasOnce + multiCatsTotal);

    const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
    const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
    const coPart = d.employee_id ? money2(total - empPart) : total;

    d.days_count = days;
    d.total_chf = total;
    d.employee_part_chf = empPart;
    d.company_part_chf = coPart;

    // friendly extras text
    const extrasText = (() => {
      if (!extras.length) return "—";
      return extras
        .map((k) => {
          const ex = EXTRAS.find((x) => x.key === k);
          if (!ex) return k;
          if (ex.key === "multi_cats") return `${ex.label} (${d.multi_cats_count || 0})`;
          return ex.label;
        })
        .join(", ");
    })();

    const empLine = d.employee_id
      ? `Employé: *${empPercent}%* → *${empPart} CHF*`
      : `Employé: *aucun*`;

    return bot.sendMessage(
      chatId,
      `🧾 *Récapitulatif*\n\n` +
        `${clientLine}` +
        `${animalLine}` +
        `Pack: *${d.pack_name}* — *${d.price_per_day} CHF / jour*\n` +
        `Options: *${extrasText}*\n` +
        `Période: *${d.start_date} → ${d.end_date}* (*${days} jours*)\n\n` +
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
  }
}

/* ================== MENUS: Clients / Employees / Prestations ================== */
async function renderClientsMenu(chatId) {
  const clients = await dbListClients();
  const rows = [
    [{ text: "➕ Ajouter client", callback_data: "cl_add" }],
    ...clients.slice(0, 20).map((c) => [
      { text: `🗑️ Supprimer #${c.id} ${c.name}`, callback_data: `cl_del_${c.id}` },
    ]),
    [{ text: "⬅️ Retour", callback_data: "back_main" }],
  ];
  return bot.sendMessage(chatId, `👥 *Clients*\n(ici: suppression simple)`, { parse_mode: "Markdown", ...kb(rows) });
}
async function renderEmployeesMenu(chatId) {
  const { data, error } = await sb.from("employees").select("*").order("id", { ascending: true });
  if (error) throw error;
  const emps = data || [];
  const rows = [
    [{ text: "➕ Ajouter employé", callback_data: "emp_add" }],
    ...emps.slice(0, 25).map((e) => [
      {
        text: `${e.active ? "✅" : "⛔"} #${e.id} ${e.name} — bascule`,
        callback_data: `emp_toggle_${e.id}_${e.active ? "0" : "1"}`,
      },
    ]),
    [{ text: "⬅️ Retour", callback_data: "back_main" }],
  ];
  return bot.sendMessage(chatId, `👩‍💼 *Employés* (toggle active)`, { parse_mode: "Markdown", ...kb(rows) });
}
async function renderPrestationsMenu(chatId) {
  const { data, error } = await sb.from("prestations").select("*").order("id", { ascending: true });
  if (error) throw error;
  const prestas = data || [];
  const rows = [
    [{ text: "⬅️ Retour", callback_data: "back_main" }],
    ...prestas.slice(0, 30).map((p) => [
      {
        text: `${p.active ? "✅" : "⛔"} #${p.id} ${p.name} (${p.animal_type}, ${p.visits_per_day}v) — bascule`,
        callback_data: `pr_toggle_${p.id}_${p.active ? "0" : "1"}`,
      },
    ]),
  ];
  return bot.sendMessage(chatId, `🧾 *Catalogue Packs/Prestations* (toggle active)`, { parse_mode: "Markdown", ...kb(rows) });
}

/* ================== CALLBACKS ================== */
bot.on("callback_query", async (q) => {
  const chatId = q?.message?.chat?.id;
  if (!chatId) return;
  await answerCbq(q);

  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "⛔ Accès refusé.");

  // global nav
  if (q.data === "back_main") return sendMainMenu(chatId);

  // Lists
  if (q.data === "list_upcoming") {
    const rows = await dbUpcomingBookings();
    if (!rows.length) return bot.sendMessage(chatId, "⏰ Aucune prestation à venir.");
    const txt = rows
      .slice(0, 30)
      .map((b) => {
        let animal = "";
        try {
          const n = b.notes ? JSON.parse(b.notes) : null;
          if (n?.animal_name) animal = ` • 🐾 ${n.animal_name}`;
        } catch {}
        const c = b.clients?.name || "—";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${animal} • ${p}${emp} • ${b.total_chf} CHF`;
      })
      .join("\n");
    return bot.sendMessage(chatId, `⏰ *À venir*:\n\n${txt}`, { parse_mode: "Markdown" });
  }

  if (q.data === "list_past") {
    const rows = await dbPastBookings();
    if (!rows.length) return bot.sendMessage(chatId, "🧾 Aucune prestation passée.");
    const txt = rows
      .slice(0, 30)
      .map((b) => {
        let animal = "";
        try {
          const n = b.notes ? JSON.parse(b.notes) : null;
          if (n?.animal_name) animal = ` • 🐾 ${n.animal_name}`;
        } catch {}
        const c = b.clients?.name || "—";
        const p = b.prestations?.name || "—";
        const emp = b.employees?.name ? ` • 👩‍💼 ${b.employees.name}` : "";
        return `#${b.id} • ${b.start_date}→${b.end_date} • ${c}${animal} • ${p}${emp} • ${b.total_chf} CHF`;
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

  // Sub menus
  if (q.data === "m_clients") return renderClientsMenu(chatId);
  if (q.data === "m_emps") return renderEmployeesMenu(chatId);
  if (q.data === "m_prestas") return renderPrestationsMenu(chatId);

  // Employees toggle
  if (q.data?.startsWith("emp_toggle_")) {
    const [, , idStr, valStr] = q.data.split("_");
    try {
      await dbSetEmployeeActive(Number(idStr), valStr === "1");
      return renderEmployeesMenu(chatId);
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Toggle employé KO: ${e.message}`);
    }
  }

  // Prestations toggle
  if (q.data?.startsWith("pr_toggle_")) {
    const [, , idStr, valStr] = q.data.split("_");
    try {
      await dbSetPrestationActive(Number(idStr), valStr === "1");
      return renderPrestationsMenu(chatId);
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Toggle prestation KO: ${e.message}`);
    }
  }

  // Client add/delete
  if (q.data === "cl_add") {
    setState(wClient, chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "👤 *Nouveau client*\n\n1/4 — Envoie le *nom*.", {
      parse_mode: "Markdown",
      ...kb([[{ text: "❌ Annuler", callback_data: "cl_cancel" }]]),
    });
  }
  if (q.data === "cl_cancel") return cancelWizard(wClient, chatId, "Client");

  if (q.data?.startsWith("cl_del_")) {
    const id = Number(q.data.replace("cl_del_", ""));
    try {
      await dbDeleteClient(id);
      return bot.sendMessage(chatId, `✅ Client #${id} supprimé.`);
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Suppression KO: ${e.message}\n(Si le client a des réservations, c’est normal: FK restrict)`);
    }
  }

  // Employee add
  if (q.data === "emp_add") {
    setState(wEmployee, chatId, { step: "name", data: {} });
    return bot.sendMessage(chatId, "👩‍💼 *Nouvel employé*\n\n1/3 — Envoie le *nom*.", {
      parse_mode: "Markdown",
      ...kb([[{ text: "❌ Annuler", callback_data: "emp_cancel" }]]),
    });
  }
  if (q.data === "emp_cancel") return cancelWizard(wEmployee, chatId, "Employé");

  /* ---------- BOOKING START ---------- */
  if (q.data === "bk_start") {
    setState(wBooking, chatId, { step: "pick_client", data: {}, history: [] });
    return renderBooking(chatId);
  }
  if (q.data === "bk_cancel") return cancelWizard(wBooking, chatId, "Prestation (réservation)");

  if (q.data === "bk_back") {
    const st = getState(wBooking, chatId);
    if (!st) return;
    const prev = popHist(st);
    if (!prev) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, "Annulé.");
    }
    st.step = prev;
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }

  // Booking: pick client
  if (q.data === "bk_new_client") {
    const st = getState(wBooking, chatId);
    if (!st) return;
    pushHist(st);
    st.step = "inline_new_client_name";
    setState(wBooking, chatId, st);
    return bot.sendMessage(chatId, "Nom du *nouveau client* ?", { parse_mode: "Markdown", ...kb([navRow("bk")]) });
  }

  if (q.data?.startsWith("bk_client_")) {
    const id = Number(q.data.replace("bk_client_", ""));
    const st = getState(wBooking, chatId);
    if (!st) return;
    pushHist(st);
    const { data: c, error } = await sb.from("clients").select("*").eq("id", id).single();
    if (error) return bot.sendMessage(chatId, `❌ Client introuvable: ${error.message}`);
    st.data.client = c;
    st.step = "animal_type";
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }

  // Booking: animal type
  if (q.data?.startsWith("bk_an_")) {
    const a = q.data.replace("bk_an_", "");
    if (!ANIMALS.includes(a)) return;
    const st = getState(wBooking, chatId);
    if (!st) return;
    pushHist(st);
    st.data.animal_type = a;
    st.step = "animal_name";
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }

  // Booking: visits
  if (q.data?.startsWith("bk_vis_")) {
    const v = Number(q.data.replace("bk_vis_", ""));
    if (![1, 2].includes(v)) return;
    const st = getState(wBooking, chatId);
    if (!st) return;
    pushHist(st);
    st.data.visits_per_day = v;
    st.step = "pick_pack";
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }

  // Booking: pack selected
  if (q.data?.startsWith("bk_pack_")) {
    const key = q.data.replace("bk_pack_", "");
    const st = getState(wBooking, chatId);
    if (!st) return;

    const animal = st.data.animal_type || "chat";
    const visits = st.data.visits_per_day || 1;
    const pack = (PACKS[animal] && PACKS[animal][visits] ? PACKS[animal][visits] : []).find((x) => x.key === key);
    if (!pack) return bot.sendMessage(chatId, "❌ Pack introuvable.");

    pushHist(st);
    st.data.pack_key = pack.key;
    st.data.pack_name = pack.name;
    st.data.duration_min = pack.duration_min;

    if (pack.price_chf == null) {
      st.step = "sur_mesure_price";
      setState(wBooking, chatId, st);
      return renderBooking(chatId);
    }

    // match prestation_id from DB (seeded packs)
    const { data: presta, error } = await sb
      .from("prestations")
      .select("*")
      .eq("active", true)
      .eq("animal_type", animal)
      .eq("visits_per_day", visits)
      .eq("name", pack.name)
      .eq("duration_min", pack.duration_min)
      .eq("price_chf", pack.price_chf)
      .maybeSingle();

    if (error) return bot.sendMessage(chatId, `❌ DB pack lookup KO: ${error.message}`);
    if (!presta) return bot.sendMessage(chatId, "❌ Pack pas trouvé en DB. (seed?)");

    st.data.prestation_id = presta.id;
    st.data.price_per_day = Number(presta.price_chf);

    st.data.extras = [];
    st.step = "pick_extras";
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }

  // Booking: extras toggle
  if (q.data?.startsWith("bk_ex_")) {
    const k = q.data.replace("bk_ex_", "");
    const st = getState(wBooking, chatId);
    if (!st) return;
    const extras = new Set(st.data.extras || []);
    if (extras.has(k)) extras.delete(k);
    else extras.add(k);
    st.data.extras = [...extras];
    setState(wBooking, chatId, st);

    // if toggled multi_cats, we will ask count later at done
    return renderBooking(chatId);
  }
  if (q.data === "bk_ex_done") {
    const st = getState(wBooking, chatId);
    if (!st) return;
    pushHist(st);

    const extras = st.data.extras || [];
    if (extras.includes("multi_cats")) {
      st.step = "multi_cats_count";
      setState(wBooking, chatId, st);
      return renderBooking(chatId);
    }

    st.step = "start_date";
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }

  // Booking: employee
  if (q.data === "bk_emp_none") {
    const st = getState(wBooking, chatId);
    if (!st) return;
    pushHist(st);
    st.data.employee_id = null;
    st.data.employee_percent = 0;
    st.step = "recap";
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }
  if (q.data?.startsWith("bk_emp_")) {
    const id = Number(q.data.replace("bk_emp_", ""));
    const st = getState(wBooking, chatId);
    if (!st) return;
    pushHist(st);
    st.data.employee_id = id;
    st.step = "employee_percent";
    setState(wBooking, chatId, st);
    return renderBooking(chatId);
  }

  // Booking: confirm
  if (q.data === "bk_confirm") {
    const st = getState(wBooking, chatId);
    if (!st) return;
    const d = st.data || {};

    try {
      const days = daysInclusive(d.start_date, d.end_date);
      if (days < 1) throw new Error("Dates invalides");

      // slot mapping
      // schema slot must be matin/soir/matin_soir
      const slot = d.visits_per_day === 2 ? "matin_soir" : "matin";

      // totals
      const baseTotal = money2(Number(d.price_per_day || 0) * days);

      let extrasOnce = 0;
      let multiCatsTotal = 0;
      for (const k of d.extras || []) {
        const ex = EXTRAS.find((x) => x.key === k);
        if (!ex) continue;
        if (ex.type === "once") extrasOnce += Number(ex.price_chf || 0);
        if (ex.type === "per_extra_cat_per_day") {
          const cnt = Number(d.multi_cats_count || 0);
          if (cnt > 0) multiCatsTotal += Number(ex.price_chf || 0) * cnt * days;
        }
      }

      const total = money2(baseTotal + extrasOnce + multiCatsTotal);

      const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
      const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
      const coPart = d.employee_id ? money2(total - empPart) : total;

      const notesObj = {
        animal_type: d.animal_type,
        animal_name: d.animal_name,
        pack_key: d.pack_key,
        pack_name: d.pack_name,
        visits_per_day: d.visits_per_day,
        extras: d.extras || [],
        multi_cats_count: Number(d.multi_cats_count || 0),
      };

      const payload = {
        client_id: d.client.id,
        prestation_id: d.prestation_id,
        slot,
        start_date: d.start_date,
        end_date: d.end_date,
        days_count: days,
        total_chf: total,
        employee_id: d.employee_id || null,
        employee_percent: d.employee_id ? empPercent : 0,
        employee_part_chf: empPart,
        company_part_chf: coPart,
        notes: JSON.stringify(notesObj),
        status: "confirmed",
      };

      const inserted = await dbInsertBooking(payload);
      wBooking.delete(chatId);

      return bot.sendMessage(
        chatId,
        `✅ *Réservation ajoutée*\n\n#${inserted.id}\n${inserted.start_date} → ${inserted.end_date} (${inserted.days_count} jours)\nTotal: *${inserted.total_chf} CHF*`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      wBooking.delete(chatId);
      return bot.sendMessage(chatId, `❌ Ajout KO: ${e.message}`);
    }
  }
});

/* ================== TEXT INPUT HANDLER ================== */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!isAdmin(chatId)) return;
  if (!text || text.startsWith("/")) return;

  /* ---------- BOOKING typed steps ---------- */
  const bk = getState(wBooking, chatId);
  if (bk) {
    const d = bk.data || {};

    if (bk.step === "inline_new_client_name") {
      if (!text) return bot.sendMessage(chatId, "❌ Envoie un nom.");
      pushHist(bk);
      bk.data._newClient = { name: text };
      bk.step = "inline_new_client_phone";
      setState(wBooking, chatId, bk);
      return bot.sendMessage(chatId, "Téléphone ?", { ...kb([navRow("bk")]) });
    }
    if (bk.step === "inline_new_client_phone") {
      pushHist(bk);
      bk.data._newClient.phone = text;
      bk.step = "inline_new_client_address";
      setState(wBooking, chatId, bk);
      return bot.sendMessage(chatId, "Adresse ?", { ...kb([navRow("bk")]) });
    }
    if (bk.step === "inline_new_client_address") {
      pushHist(bk);
      bk.data._newClient.address = text;
      bk.step = "inline_new_client_notes";
      setState(wBooking, chatId, bk);
      return bot.sendMessage(chatId, "Notes (ou '-') ?", { ...kb([navRow("bk")]) });
    }
    if (bk.step === "inline_new_client_notes") {
      try {
        pushHist(bk);
        bk.data._newClient.notes = text === "-" ? "" : text;

        const c = await dbInsertClient({
          name: bk.data._newClient.name,
          phone: bk.data._newClient.phone || "",
          address: bk.data._newClient.address || "",
          notes: bk.data._newClient.notes || "",
        });

        bk.data.client = c;
        delete bk.data._newClient;

        bk.step = "animal_type";
        setState(wBooking, chatId, bk);
        return renderBooking(chatId);
      } catch (e) {
        wBooking.delete(chatId);
        return bot.sendMessage(chatId, `❌ Création client KO: ${e.message}`);
      }
    }

    if (bk.step === "animal_name") {
      if (!text) return bot.sendMessage(chatId, "❌ Envoie un nom.");
      pushHist(bk);
      bk.data.animal_name = text;
      bk.step = "pick_visits";
      setState(wBooking, chatId, bk);
      return renderBooking(chatId);
    }

    if (bk.step === "sur_mesure_price") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) return bot.sendMessage(chatId, "❌ Prix invalide. Ex: 55");

      // create a prestation row for this custom price (kept active)
      try {
        const animal = bk.data.animal_type || "chat";
        const visits = bk.data.visits_per_day || 1;
        const packName = bk.data.pack_name || "Sur-mesure";

        const presta = await dbInsertPrestation({
          name: `${packName} (${money2(n)} CHF)`,
          animal_type: animal,
          price_chf: money2(n),
          visits_per_day: visits,
          duration_min: Number(bk.data.duration_min || 15),
          description: "Prix sur demande (créé via bot)",
          image_url: "",
          active: true,
        });

        pushHist(bk);
        bk.data.prestation_id = presta.id;
        bk.data.price_per_day = Number(presta.price_chf);
        bk.data.extras = [];
        bk.step = "pick_extras";
        setState(wBooking, chatId, bk);
        return renderBooking(chatId);
      } catch (e) {
        wBooking.delete(chatId);
        return bot.sendMessage(chatId, `❌ Sur-mesure KO: ${e.message}`);
      }
    }

    if (bk.step === "multi_cats_count") {
      const cnt = Number(text);
      if (!Number.isFinite(cnt) || cnt < 0 || cnt > 20) return bot.sendMessage(chatId, "❌ Mets un nombre (0-20).");
      pushHist(bk);
      bk.data.multi_cats_count = Math.floor(cnt);
      bk.step = "start_date";
      setState(wBooking, chatId, bk);
      return renderBooking(chatId);
    }

    if (bk.step === "start_date") {
      if (!isValidISODate(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      pushHist(bk);
      bk.data.start_date = text;
      bk.step = "end_date";
      setState(wBooking, chatId, bk);
      return renderBooking(chatId);
    }

    if (bk.step === "end_date") {
      if (!isValidISODate(text)) return bot.sendMessage(chatId, "❌ Format attendu: YYYY-MM-DD");
      pushHist(bk);
      bk.data.end_date = text;
      bk.step = "pick_employee";
      setState(wBooking, chatId, bk);
      return renderBooking(chatId);
    }

    if (bk.step === "employee_percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets un nombre 0-100");
      pushHist(bk);
      bk.data.employee_percent = Math.floor(p);
      bk.step = "recap";
      setState(wBooking, chatId, bk);
      return renderBooking(chatId);
    }
  }

  /* ---------- CLIENT wizard (menu) ---------- */
  const cs = getState(wClient, chatId);
  if (cs) {
    const d = cs.data;

    if (cs.step === "name") {
      d.name = text;
      cs.step = "phone";
      setState(wClient, chatId, cs);
      return bot.sendMessage(chatId, "2/4 — Téléphone");
    }
    if (cs.step === "phone") {
      d.phone = text;
      cs.step = "address";
      setState(wClient, chatId, cs);
      return bot.sendMessage(chatId, "3/4 — Adresse");
    }
    if (cs.step === "address") {
      d.address = text;
      cs.step = "notes";
      setState(wClient, chatId, cs);
      return bot.sendMessage(chatId, "4/4 — Notes (ou '-')");
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
        return bot.sendMessage(chatId, `✅ Client ajouté: #${inserted.id} — ${inserted.name}`);
      } catch (e) {
        wClient.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout client KO: ${e.message}`);
      }
    }
  }

  /* ---------- EMPLOYEE wizard ---------- */
  const es = getState(wEmployee, chatId);
  if (es) {
    const d = es.data;

    if (es.step === "name") {
      d.name = text;
      es.step = "phone";
      setState(wEmployee, chatId, es);
      return bot.sendMessage(chatId, "2/3 — Téléphone (ou '-')");
    }
    if (es.step === "phone") {
      d.phone = text === "-" ? "" : text;
      es.step = "percent";
      setState(wEmployee, chatId, es);
      return bot.sendMessage(chatId, "3/3 — Pourcentage par défaut (0-100)");
    }
    if (es.step === "percent") {
      const p = Number(text);
      if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(chatId, "❌ Mets un nombre 0-100");
      d.default_percent = Math.floor(p);

      try {
        const inserted = await dbInsertEmployee({
          name: d.name,
          phone: d.phone || "",
          default_percent: d.default_percent,
          active: true, // <-- SQL column is "active"
        });
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `✅ Employé ajouté: #${inserted.id} — ${inserted.name} (${inserted.default_percent}%)`);
      } catch (e) {
        wEmployee.delete(chatId);
        return bot.sendMessage(chatId, `❌ Ajout employé KO: ${e.message}`);
      }
    }
  }
});

/* ================== START LISTEN ================== */
app.listen(PORT, () => console.log("ShaSitter server running on", PORT));
