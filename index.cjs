/* index.cjs — ShaSitter (PRIVATE Telegram mini-app) — CLEAN + PETS + MENUS + BACK + 409 FIX */

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

/* ================== TELEGRAM BOT (409 FIX — STABLE) ==================
   - IMPORTANT: sur Render => WEB_CONCURRENCY=1
   - On force deleteWebhook(drop_pending_updates) puis startPolling
   - Anti double-start polling + retry + stopPolling sur 409
*/
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

let _pollingStarting = false;
async function startTelegramPolling() {
  if (_pollingStarting) return;
  _pollingStarting = true;

  try {
    // 1) coupe tout webhook éventuel
    try {
      await bot.deleteWebHook({ drop_pending_updates: true });
    } catch {}

    // 2) stop tout polling précédent (évite double polling dans le même process)
    try {
      await bot.stopPolling();
    } catch {}

    // 3) démarre le polling proprement
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
    try {
      bot.stopPolling();
    } catch {}
    setTimeout(startTelegramPolling, 3000);
  }
});

// Évite que Node 22 tue le process sur un rejet non géré.
process.on("unhandledRejection", (reason) => {
  console.error("❌ Rejet non géré :", reason);
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
  // 🔓 Pas de blocage API côté dashboard.
  // Le bot est déjà privé (admin Telegram), donc on laisse passer.
  return next();
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
// ---- Packs: détection famille + optimisation Duo "illimitée" (par période sélectionnée) ----
function packFamilyFromName(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("essentiel")) return "essentiel";
  if (n.includes("tendresse")) return "tendresse";
  if (n.includes("confort")) return "confort";
  if (n.includes("complic")) return "complicite"; // complicité / complicite
  if (n.includes("sur-mesure") || n.includes("sur mesure")) return "sur-mesure";
  return null;
}

const _packPriceCache = new Map();

async function getPackPricesForFamily(animalType, family) {
  const key = `${animalType}::${family}`;
  if (_packPriceCache.has(key)) return _packPriceCache.get(key);

  const patternByFamily = {
    "essentiel": "%essentiel%",
    "tendresse": "%tendresse%",
    "confort": "%confort%",
    "complicite": "%complic%",
    "sur-mesure": "%sur-mesure%",
  };
  const ilike = patternByFamily[family] || `%${family}%`;

  async function queryWithPackFamily() {
    const { data, error } = await sb
      .from("prestations")
      .select("id,name,price_chf,visits_per_day,animal_type,category,pack_family")
      .eq("category", "pack")
      .eq("animal_type", animalType)
      .eq("pack_family", family)
      .in("visits_per_day", [1, 2])
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  async function queryWithName() {
    const { data, error } = await sb
      .from("prestations")
      .select("id,name,price_chf,visits_per_day,animal_type,category")
      .eq("category", "pack")
      .eq("animal_type", animalType)
      .ilike("name", ilike)
      .in("visits_per_day", [1, 2])
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  let rows = [];
  try {
    rows = await queryWithPackFamily();
  } catch (e) {
    rows = await queryWithName();
  }

  const simple = rows.find((r) => Number(r.visits_per_day) === 1) || null;
  const duo = rows.find((r) => Number(r.visits_per_day) === 2) || null;

  const res = {
    simplePrice: Number(simple?.price_chf || 0),
    duoPrice: Number(duo?.price_chf || 0),
  };
  _packPriceCache.set(key, res);
  return res;
}

async function optimizePackTotalsForSegments(segInfos) {
  const byGroup = new Map();
  for (let i = 0; i < segInfos.length; i++) {
    const info = segInfos[i];
    if (!info) continue;
    if (info.presta?.category !== "pack") continue;
    if (!info.family) continue;
    const gk = `${info.animalType}::${info.family}`;
    if (!byGroup.has(gk)) byGroup.set(gk, []);
    byGroup.get(gk).push({ idx: i, ...info });
  }

  const out = new Array(segInfos.length).fill(null);

  for (const [gk, items] of byGroup.entries()) {
    const [animalType, family] = gk.split("::");
    const totalUnits = items.reduce((a, it) => a + Number(it.units || 0), 0);
    if (totalUnits <= 0) continue;

    const { simplePrice, duoPrice } = await getPackPricesForFamily(animalType, family);

    const duos = Math.floor(totalUnits / 2);
    const rest = totalUnits % 2;

    const totalCost = money2(duos * Number(duoPrice || 0) + rest * Number(simplePrice || 0));

    const perUnit = totalUnits ? (Number(totalCost) / totalUnits) : 0;
    let acc = 0;
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      const isLast = j === items.length - 1;
      const t = isLast ? money2(Number(totalCost) - acc) : money2(perUnit * Number(it.units || 0));
      acc = money2(acc + t);
      out[it.idx] = t;
    }
  }

  for (let i = 0; i < segInfos.length; i++) {
    if (out[i] == null) out[i] = segInfos[i]?.baseTotal ?? 0;
  }
  return out;
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
/* ================== ADVANCED DAY-BY-DAY PLANNER (MODE AVANCÉ) ==================
   Objectif:
   - Pour une période, choisir pour CHAQUE jour: matin / soir / matin+soir / aucun
   - Choisir la prestation du matin et/ou du soir
   - Auto-optimisation: si matin+soir sont le même pack_family => utiliser le pack Duo correspondant (visits_per_day=2)
   - Regroupement en segments (plages de dates) pour insérer moins de lignes en DB
*/
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

// Alias utilisé par certains callbacks (évite ReferenceError)
function ensureDayPlan(st, dateISO) {
  const data = st?.data || st || {};
  return getDayPlan(data, dateISO);
}

function dayPlanIsComplete(plan) {
  if (!plan || !plan.slot) return false;
  if (plan.slot === "none") return true;
  if (plan.slot === "matin") return !!plan.matin_id;
  if (plan.slot === "soir") return !!plan.soir_id;
  if (plan.slot === "matin_soir") return !!plan.matin_id && !!plan.soir_id;
  return false;
}
async function getDuoForFamily(packFamily, animalType) {
  if (!packFamily) return null;
  const { data, error } = await sb
    .from("prestations")
    .select("*")
    .eq("active", true)
    .eq("category", "pack")
    .eq("visits_per_day", 2)
    .eq("pack_family", packFamily)
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw error;
  const duo = (data || [])[0] || null;
  return duo;
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

async function dbDeleteBooking(id) {
  // supprime la réservation + pivots si présents
  const bid = Number(id);
  if (!Number.isFinite(bid)) throw new Error("invalid_id");

  // pivots optionnels (si tables existent)
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

// ✅ Liste des réservations d’un client (pour onglet "Clients" → supprimer une prestation)
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

// ✅ Suppression d’une réservation (utilisé par: clients / à venir / passées)
app.delete("/api/bookings/:id", requireAdminWebApp, async (req, res) => {
  try {
    await dbDeleteBooking(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});


// ✅ Lire une réservation (pour modal edit)
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

// ✅ Modifier une réservation (dashboard: à venir / passées / client)

app.put("/api/bookings/:id", requireAdminWebApp, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_request" });

    const { prestation_id, slot, start_date, end_date, employee_id, employee_percent, total_override } = req.body || {};
    if (!prestation_id || !start_date || !end_date) return res.status(400).json({ error: "bad_request" });

    const presta = await dbGetPrestation(Number(prestation_id));
    const days = daysInclusive(start_date, end_date);
    if (days < 1) return res.status(400).json({ error: "bad_dates" });

    // Calcul total selon catégorie
    let baseTotal = 0;
    const price = Number(presta.price_chf || 0);

    if (presta.category === "pack") {
      baseTotal = money2(price * days);
    } else if (presta.category === "service") {
      const mult = slot === "matin_soir" ? 2 : 1;
      baseTotal = money2(price * days * mult);
    } else if (presta.category === "devis") {
      const ov = Number(String(total_override ?? "").replace(",", "."));
      baseTotal = Number.isFinite(ov) && ov >= 0 ? money2(ov) : money2(price);
    } else {
      // supplement / menage -> unique
      baseTotal = money2(price);
    }

    const empId = employee_id ? Number(employee_id) : null;
    const empPct = empId ? Math.max(0, Math.min(100, Number(employee_percent || 0))) : 0;
    const empPart = empId ? money2((baseTotal * empPct) / 100) : 0;
    const coPart = empId ? money2(baseTotal - empPart) : baseTotal;

    const payload = {
      prestation_id: Number(prestation_id),
      slot: slot || null,
      start_date,
      end_date,
      days_count: presta.category === "pack" || presta.category === "service" ? days : 1,
      total_chf: baseTotal,
      employee_id: empId,
      employee_percent: empId ? empPct : 0,
      employee_part_chf: empPart,
      company_part_chf: coPart,
    };

    const { data, error } = await sb.from("bookings").update(payload).eq("id", id).select("*").single();
    if (error) throw error;

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "db_error", message: e.message });
  }
});
// fallback: si ton front ne peut pas faire DELETE
app.post("/api/bookings/delete", requireAdminWebApp, async (req, res) => {
  try {
    const { id } = req.body || {};
    await dbDeleteBooking(id);
    res.json({ ok: true });
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
      .map(([id, total]) => ({ id: Number(id), client: cName.get(id) || `Client #${id}`, name: cName.get(id) || `Client #${id}`, total: money2(total) }));

    const topPrestations = [...byPresta.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, total]) => ({ id: Number(id), prestation: pName.get(id) || `Prestation #${id}`, name: pName.get(id) || `Prestation #${id}`, total: money2(total) }));

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
  const petTxt = async () => {
    if (!d.pet_id) return "—";
    try {
      const p = await dbGetPet(d.pet_id);
      return `${p.name} (${animalLabel(p.animal_type)}) (#${p.id})`;
    } catch {
      return `Animal #${d.pet_id}`;
    }
  };

  async function getPetAnimalType() {
    if (!d.pet_id) return null;
    try {
      const p = await dbGetPet(d.pet_id);
      return p.animal_type || null;
    } catch {
      return null;
    }
  }

  function needVisitsFromSlot(slot) {
    return slot === "matin_soir" ? 2 : 1;
  }

  
function needVisitsFromSlot(slot) {
  return slot === "matin_soir" ? 2 : 1;
}

function visitsMultiplierFromSlot(slot) {
  return slot === "matin_soir" ? 2 : 1;
}

// Expose helper globally (safe for callbacks/eval)
globalThis.visitsMultiplierFromSlot = visitsMultiplierFromSlot;
// Alias (legacy)
globalThis.visitsMultiplierFromSlot = visitsMultiplierFromSlot;


function computeLineTotalGlobal(presta, days, slot) {
  const price = Number(presta?.price_chf || 0);
  if (presta?.category === "pack") return money2(price * days); // pack = par jour
  if (presta?.category === "service") return money2(price * days * visitsMultiplierFromSlot(slot)); // service = par visite
  // supplement / menage / devis = unique
  return money2(price);
}

/**
 * Applique la règle "Duo" même si les 2 visites ne sont pas le même jour :
 * - On compte toutes les visites des packs "1 visite/jour" par pack_family
 * - Pour chaque paire (2 visites), on applique le tarif Duo (visits_per_day=2) au lieu de 2x tarif solo.
 * - Techniquement: on calcule un discount, puis on le répartit sur les segments concernés (sans passer en négatif).
 */
async function applyDuoDiscountAcrossPeriod(segs, petAnimalType) {
  if (!Array.isArray(segs) || !segs.length) return { segs, duoSummary: [] };

  // Précharge prestations + calcule baseTotal
  const prestaCache = new Map();
  async function getPresta(id) {
    const k = String(id);
    if (prestaCache.has(k)) return prestaCache.get(k);
    const p = await dbGetPrestation(id);
    prestaCache.set(k, p);
    return p;
  }

  const segInfos = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s?.prestation_id) {
      segInfos.push(null);
      continue;
    }
    const p = await getPresta(s.prestation_id);
    const days = daysInclusive(s.start_date, s.end_date);

    const baseTotal = computeLineTotalGlobal(p, days, s.slot);

    s._presta = p;
    s._days = days;
    s._baseTotal = baseTotal;
    s._adjTotal = baseTotal;

    const family = p.pack_family || packFamilyFromName(p.name);
    const units = (p.category === "pack") ? (days * Number(p.visits_per_day || 1)) : 0;

    segInfos.push({ seg: s, presta: p, days, baseTotal, units, family, animalType: p.animal_type || (petAnimalType || "autre") });
  }

  // Calcule les totaux optimisés (2 unités => pack Duo) puis applique aux segments
  const adjTotals = await optimizePackTotalsForSegments(segInfos.map((x) => x || { baseTotal: 0 }));
  for (let i = 0; i < segs.length; i++) {
    const t = adjTotals[i];
    if (typeof t === "number" && Number.isFinite(t) && t >= 0) segs[i]._adjTotal = money2(t);
  }

  // Résumé (pour info) : par famille, combien de paires + économie
  const byFam = new Map(); // key => {units, base, adj, pairs}
  for (const info of segInfos) {
    if (!info) continue;
    const p = info.presta;
    if (p.category !== "pack") continue;
    if (!info.family) continue;

    const key = `${info.animalType}::${info.family}`;
    const cur = byFam.get(key) || { units: 0, base: 0, adj: 0 };
    cur.units += Number(info.units || 0);
    cur.base += Number(info.baseTotal || 0);
    cur.adj += Number(info.seg?._adjTotal || info.baseTotal || 0);
    byFam.set(key, cur);
  }

  const duoSummary = [];
  for (const [key, v] of byFam.entries()) {
    const [animalType, family] = key.split("::");
    const pairs = Math.floor(Number(v.units || 0) / 2);
    const discountTotal = money2(Number(v.base || 0) - Number(v.adj || 0));
    if (pairs >= 1 && discountTotal > 0) {
      // essaye de récupérer le nom du duo, sinon fallback
      let duoName = `Pack Duo (${family})`;
      try {
        const duo = await getDuoForFamily(family, animalType || petAnimalType || null);
        if (duo?.name) duoName = duo.name;
      } catch (e) {}
      duoSummary.push({ family, pairs, discountTotal, duoName });
    }
  }

  return { segs, duoSummary };
}

function filterPrestations(prestas, { categories, animal_type, visits_per_day }) {
  const cats = Array.isArray(categories) ? categories : (categories ? [categories] : null);

  return (prestas || []).filter((p) => {
    if (p.active === false) return false;

    if (cats && !cats.includes(p.category)) return false;

    // animal filter (autre = compatible)
    if (animal_type && !(p.animal_type === animal_type || p.animal_type === "autre")) return false;

    // visits_per_day only applies to PACKS
    if (visits_per_day && p.category === "pack" && Number(p.visits_per_day) !== Number(visits_per_day)) return false;

    return true;
  });
}

async function renderPrestaPicker(title, storeKey, { categories, animal_type, visits_per_day }) {
  const all = await dbListPrestations(true);

  const list = filterPrestations(all, { categories, animal_type, visits_per_day });

  if (!list.length) {
    return bot.sendMessage(
      chatId,
      `❌ Aucune prestation trouvée.\n\nFiltres: ${(Array.isArray(categories) ? categories.join(",") : (categories || "—"))} / ${animalLabel(animal_type || "autre")} / ${visits_per_day || "—"} visite(s)`,
      { ...kb([bkNavRow()]) }
    );
  }

  const pageSize = 10;
  d._presta_page = Number(d._presta_page || 0);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  if (d._presta_page > totalPages - 1) d._presta_page = totalPages - 1;
  if (d._presta_page < 0) d._presta_page = 0;

  d._presta_ctx = { title, storeKey, categories, animal_type, visits_per_day };
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

  
function addonsTotal() {
  const arr = d.addons || [];
  return money2(arr.reduce((a, x) => a + Number(x.total || 0), 0));
}

function addonsText() {
  const arr = d.addons || [];
  if (!arr.length) return "— Aucun";
  return arr.map((x) => `• ${x.name}${x.qty ? ` (x${x.qty})` : ''} = ${money2(x.total)} CHF`).join("\n");
}

function devisTotal() {
  return money2(Number(d.devis_amount || 0));
}

  function buildSegments() {
  // Mode avancé: jour par jour
  if (Array.isArray(d.dates) && d.dates.length && d.day_plans) {
    const segsDaily = [];
    for (const date of d.dates) {
      const plan = getDayPlan(d, date);
      if (!plan.slot || plan.slot === "none") continue;
      if (plan.slot === "matin") segsDaily.push({ slot: "matin", start_date: date, end_date: date, prestation_id: plan.matin_id });
      else if (plan.slot === "soir") segsDaily.push({ slot: "soir", start_date: date, end_date: date, prestation_id: plan.soir_id });
      else if (plan.slot === "matin_soir") {
        // auto-duo pack si possible sera calculé plus bas (async), ici on garde les 2 ids
        segsDaily.push({ slot: "matin_soir", start_date: date, end_date: date, prestation_id: null, matin_id: plan.matin_id, soir_id: plan.soir_id });
      }
    }
    return segsDaily;
  }

  // Mode historique
  const start = d.start_date;
  const end = d.end_date;
  const nDays = daysInclusive(start, end);
  if (nDays < 1) throw new Error("Dates invalides (fin avant début ?)");

  if (nDays === 1) {
    if (!d.slot_single || !d.prestation_single_day) throw new Error("Infos manquantes (slot/prestation)");
    return [{ slot: d.slot_single, start_date: start, end_date: end, prestation_id: d.prestation_single_day }];
  }

  if (!d.slot_start || !d.slot_end || !d.prestation_full) throw new Error("Infos manquantes (slots/prestations)");

  const segs = [];
  if (d.slot_start === "matin") segs.push({ slot: "matin", start_date: start, end_date: start, prestation_id: d.prestation_matin });
  if (d.slot_start === "soir") segs.push({ slot: "soir", start_date: start, end_date: start, prestation_id: d.prestation_soir });
  if (d.slot_start === "matin_soir") segs.push({ slot: "matin_soir", start_date: start, end_date: start, prestation_id: d.prestation_full });

  const midStart = addDaysISO(start, 1);
  const midEnd = addDaysISO(end, -1);
  const midDays = daysInclusive(midStart, midEnd);
  if (midDays >= 1) segs.push({ slot: "matin_soir", start_date: midStart, end_date: midEnd, prestation_id: d.prestation_full });

  if (d.slot_end === "matin") segs.push({ slot: "matin", start_date: end, end_date: end, prestation_id: d.prestation_matin });
  if (d.slot_end === "soir") segs.push({ slot: "soir", start_date: end, end_date: end, prestation_id: d.prestation_soir });
  if (d.slot_end === "matin_soir") segs.push({ slot: "matin_soir", start_date: end, end_date: end, prestation_id: d.prestation_full });

  for (const s of segs) if (!s.prestation_id) throw new Error("Prestation manquante pour un segment");
  return segs;
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
// 5) day slot (mode avancé)
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

  const tools = [];
  if (idx > 0) tools.push({ text: "📋 Copier jour précédent", callback_data: "bk_day_copy_prev" });
  tools.push({ text: "📌 Appliquer ce modèle aux jours restants", callback_data: "bk_day_apply_all" });
  rows.push(tools);

  rows.push(bkNavRow());
  return bot.sendMessage(chatId, `5/9 — Choisis le créneau pour ce jour\n\n${summary}`, { parse_mode: "Markdown", ...kb(rows) });
}

// 6) pick prestation matin for a given day
if (step === "day_pick_matin") {
  const animal_type = await getPetAnimalType();
  const dates = d.dates || [];
  const idx = Number(d.day_index || 0);
  const date = dates[idx];
  return renderPrestaPicker(
    `6/9 — Choisis la prestation *Matin*\n\nJour: *${date}*\nAnimal: *${animalLabel(animal_type || "autre")}*`,
    "__day_matin",
    { categories: ["pack","service"], animal_type, visits_per_day: 1 }
  );
}

// 7) pick prestation soir for a given day
if (step === "day_pick_soir") {
  const animal_type = await getPetAnimalType();
  const dates = d.dates || [];
  const idx = Number(d.day_index || 0);
  const date = dates[idx];
  return renderPrestaPicker(
    `7/9 — Choisis la prestation *Soir*\n\nJour: *${date}*\nAnimal: *${animalLabel(animal_type || "autre")}*`,
    "__day_soir",
    { categories: ["pack","service"], animal_type, visits_per_day: 1 }
  );
}


  // 5) slot (1 jour)
  if (step === "slot_single") {
    return bot.sendMessage(chatId, "5/9 — Créneau (1 jour) :", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🌅 Matin (1 visite)", callback_data: "bk_slot_single_matin" }],
        [{ text: "🌙 Soir (1 visite)", callback_data: "bk_slot_single_soir" }],
        [{ text: "🌅🌙 Matin+soir (2 visites)", callback_data: "bk_slot_single_matin_soir" }],
        bkNavRow(),
      ]),
    });
  }

  // 5) slot start (multi)
  if (step === "slot_start") {
    return bot.sendMessage(chatId, "5/9 — 1er jour : quel créneau ?", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🌅 Matin (1 visite)", callback_data: "bk_slot_start_matin" }],
        [{ text: "🌙 Soir (1 visite)", callback_data: "bk_slot_start_soir" }],
        [{ text: "🌅🌙 Matin+soir (2 visites)", callback_data: "bk_slot_start_matin_soir" }],
        bkNavRow(),
      ]),
    });
  }

  // 6) slot end (multi)
  if (step === "slot_end") {
    return bot.sendMessage(chatId, "6/9 — Dernier jour : quel créneau ?", {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "🌅 Matin (1 visite)", callback_data: "bk_slot_end_matin" }],
        [{ text: "🌙 Soir (1 visite)", callback_data: "bk_slot_end_soir" }],
        [{ text: "🌅🌙 Matin+soir (2 visites)", callback_data: "bk_slot_end_matin_soir" }],
        bkNavRow(),
      ]),
    });
  }

  // prestations selection
  if (step === "pick_presta_single_day") {
    const animal_type = await getPetAnimalType();
    const visits = needVisitsFromSlot(d.slot_single);
    return renderPrestaPicker(
      `6/9 — Choisis la prestation (packs)\n\nBesoin: *${visits} visite(s)*\nAnimal: *${animalLabel(animal_type || "autre")}*`,
      "prestation_single_day",
      { categories: ["pack","service"], animal_type, visits_per_day: visits }
    );
  }

  if (step === "pick_presta_full") {
    const animal_type = await getPetAnimalType();
    return renderPrestaPicker(
      `7/9 — Prestation pour les *jours complets* (matin+soir)\nAnimal: *${animalLabel(animal_type || "autre")}*`,
      "prestation_full",
      { categories: ["pack","service"], animal_type, visits_per_day: 2 }
    );
  }

  if (step === "pick_presta_matin") {
    const animal_type = await getPetAnimalType();
    return renderPrestaPicker(
      `7/9 — Prestation pour un *Matin seul* (1 visite)\nAnimal: *${animalLabel(animal_type || "autre")}*`,
      "prestation_matin",
      { categories: ["pack","service"], animal_type, visits_per_day: 1 }
    );
  }

  if (step === "pick_presta_soir") {
    const animal_type = await getPetAnimalType();
    return renderPrestaPicker(
      `7/9 — Prestation pour un *Soir seul* (1 visite)\nAnimal: *${animalLabel(animal_type || "autre")}*`,
      "prestation_soir",
      { categories: ["pack","service"], animal_type, visits_per_day: 1 }
    );
  }

  
// addons (suppléments + ménage) + devis en plus
if (step === "addons") {
  const all = await dbListPrestations(true);
  const addons = (all || []).filter((p) => (p.category === "supplement" || p.category === "menage") && p.active !== false);

  const pageSize = 10;
  d._addon_page = Number(d._addon_page || 0);
  const totalPages = Math.max(1, Math.ceil(addons.length / pageSize));
  if (d._addon_page > totalPages - 1) d._addon_page = totalPages - 1;
  if (d._addon_page < 0) d._addon_page = 0;

  const slice = addons.slice(d._addon_page * pageSize, d._addon_page * pageSize + pageSize);

  const rows = slice.map((p) => {
    const badge = p.category === "menage" ? "🧼" : "🧶";
    return [{ text: `➕ ${badge} ${p.name} • ${p.price_chf} CHF`, callback_data: `bk_add_${p.id}` }];
  });

  const nav = [];
  if (d._addon_page > 0) nav.push({ text: "⬅️", callback_data: "bk_add_prev" });
  nav.push({ text: `Page ${d._addon_page + 1}/${totalPages}`, callback_data: "noop" });
  if (d._addon_page < totalPages - 1) nav.push({ text: "➡️", callback_data: "bk_add_next" });
  if (nav.length) rows.push(nav);

  rows.push([{ text: "🧾 Ajouter un devis personnalisé", callback_data: "bk_devis" }]);
  rows.push([{ text: "✅ Terminer (options)", callback_data: "bk_add_done" }]);
  rows.push(bkNavRow());

  const devisLine = Number(d.devis_amount || 0) > 0 ? `\n🧾 Devis: *${money2(d.devis_amount)} CHF*` : "";
  return bot.sendMessage(chatId, `🧩 *Options (uniques)*\n\nSélection actuelle:\n${addonsText()}${devisLine}`, {
    parse_mode: "Markdown",
    ...kb(rows),
  });
}

if (step === "devis_amount") {
  return bot.sendMessage(chatId, "🧾 Entre le *montant du devis* (CHF). Ex: 120", {
    parse_mode: "Markdown",
    ...kb([bkNavRow()]),
  });
}

if (step === "devis_note") {
  return bot.sendMessage(chatId, "📝 Note devis (ou envoie - pour ignorer)", {
    parse_mode: "Markdown",
    ...kb([bkNavRow()]),
  });
}if (step === "addon_qty") {
  const pend = d._addon_pending;
  if (!pend) return bot.sendMessage(chatId, "❌ Option manquante.", { ...kb([bkNavRow()]) });
  const label = pend.qty_label || "Quantité";
  return bot.sendMessage(chatId, `🔢 ${label} — Envoie un nombre (ex: 2)\n\nOption: *${pend.name}* (${pend.price_chf} CHF)`, {
    parse_mode: "Markdown",
    ...kb([bkNavRow()]),
  });
}



  // share employee?
  if (step === "share_employee") {
    return bot.sendMessage(chatId, "8/9 — Partager avec un employé ?", {
      ...kb([
        [{ text: "✅ Oui", callback_data: "bk_share_yes" }],
        [{ text: "❌ Non", callback_data: "bk_share_no" }],
        bkNavRow(),
      ]),
    });
  }

  // pick employee
  if (step === "pick_employee") {
    const emps = (await dbListEmployees()).filter((e) => e.active === true);
    const rows = [
      [{ text: "Aucun employé", callback_data: "bk_emp_none" }],
      ...emps.slice(0, 25).map((e) => [{ text: `👩‍💼 ${e.name} (#${e.id})`, callback_data: `bk_emp_${e.id}` }]),
      bkNavRow(),
    ];
    return bot.sendMessage(chatId, "Choisis l’employé :", { ...kb(rows) });
  }

  // employee percent
  if (step === "employee_percent") {
    return bot.sendMessage(chatId, "Pourcentage employé (0-100). Ex: 30", { ...kb([bkNavRow()]) });
  }

  // recap
  
// recap
if (step === "recap") {
  try {
    async function compileSegments() {
  // Si mode avancé (day_plans) présent => on compile jour par jour
  if (Array.isArray(d.dates) && d.dates.length && d.day_plans) {
    const dates = d.dates;
    const segmentsDaily = [];
    for (const date of dates) {
      const plan = getDayPlan(d, date);
      if (!plan.slot) continue;
      if (plan.slot === "none") continue;

      if (plan.slot === "matin") {
        segmentsDaily.push({ slot: "matin", start_date: date, end_date: date, prestation_id: plan.matin_id });
        continue;
      }
      if (plan.slot === "soir") {
        segmentsDaily.push({ slot: "soir", start_date: date, end_date: date, prestation_id: plan.soir_id });
        continue;
      }

      // matin_soir
      const pM = await dbGetPrestation(plan.matin_id);
      const pS = await dbGetPrestation(plan.soir_id);

      // Auto-duo uniquement pour les PACKS avec même pack_family
      if (pM.category === "pack" && pS.category === "pack" && pM.pack_family && pM.pack_family === pS.pack_family) {
        const duo = await getDuoForFamily(pM.pack_family, null);
        if (duo?.id) {
          segmentsDaily.push({ slot: "matin_soir", start_date: date, end_date: date, prestation_id: duo.id, _autoDuo: true });
          continue;
        }
      }

      // Sinon 2 lignes (matin + soir)
      segmentsDaily.push({ slot: "matin", start_date: date, end_date: date, prestation_id: plan.matin_id });
      segmentsDaily.push({ slot: "soir", start_date: date, end_date: date, prestation_id: plan.soir_id });
    }

    // Regroupe les jours consécutifs (même slot + même prestation_id) en plages
    const sorted = segmentsDaily.sort((a,b)=> (a.start_date+b.slot+a.prestation_id).localeCompare(b.start_date+b.slot+b.prestation_id));
    // On ne peut pas simplement trier comme ça; on va regrouper par (slot,prestation) en respectant la chronologie des dates
    const byKey = new Map();
    // We'll rebuild in chronological order
    const chronological = segmentsDaily.sort((a,b)=> a.start_date.localeCompare(b.start_date) || a.slot.localeCompare(b.slot) || (a.prestation_id-b.prestation_id));
    const segs = [];
    for (const item of chronological) {
      if (!item.prestation_id) continue;
      const last = segs[segs.length-1];
      if (last && last.slot===item.slot && Number(last.prestation_id)===Number(item.prestation_id) && addDaysISO(last.end_date,1)===item.start_date) {
        last.end_date = item.end_date;
      } else {
        segs.push({ ...item });
      }
    }
    return segs;
  }

  // Sinon mode historique (ancien) : segments 1er/jours complets/dernier
  return buildSegments();
}

const segs = await compileSegments();

// Duo illimité: ajuste les totaux des packs sur la période (2 visites => Duo, même si pas le même jour)
try {
  const segInfos = [];
  for (const seg of segs) {
    const presta = await dbGetPrestation(seg.prestation_id);
    const days = daysInclusive(seg.start_date, seg.end_date);
    if (days < 1) continue;

    let baseTotal = 0;
    if (presta.category === "pack") baseTotal = money2(Number(presta.price_chf || 0) * days);
    else if (presta.category === "service") baseTotal = money2(Number(presta.price_chf || 0) * days * visitsMultiplierFromSlot(seg.slot));
    else baseTotal = money2(Number(presta.price_chf || 0));

    const family = presta.pack_family || packFamilyFromName(presta.name);
    const units = presta.category === "pack" ? (days * Number(presta.visits_per_day || 1)) : 0;

    segInfos.push({ seg, presta, days, baseTotal, units, family, animalType: presta.animal_type || "autre" });
  }
  const adj = await optimizePackTotalsForSegments(segInfos);
  for (let i = 0; i < segs.length; i++) {
    if (typeof adj[i] === "number") segs[i]._adjTotal = adj[i];
  }
} catch (e) {
  // silencieux: si config DB sans duo / sans colonne, on retombe sur les totaux standards
}


// Duo illimité: ajuste les totaux des packs sur la période (2 visites => Duo, même si pas le même jour)
try {
  const segInfos = [];
  for (const seg of segs) {
    const presta = await dbGetPrestation(seg.prestation_id);
    const days = daysInclusive(seg.start_date, seg.end_date);
    if (days < 1) continue;

    let baseTotal = 0;
    if (presta.category === "pack") baseTotal = money2(Number(presta.price_chf || 0) * days);
    else if (presta.category === "service") baseTotal = money2(Number(presta.price_chf || 0) * days * visitsMultiplierFromSlot(seg.slot));
    else baseTotal = money2(Number(presta.price_chf || 0));

    const family = presta.pack_family || packFamilyFromName(presta.name);
    const units = presta.category === "pack" ? (days * Number(presta.visits_per_day || 1)) : 0;

    segInfos.push({ seg, presta, days, baseTotal, units, family, animalType: presta.animal_type || "autre" });
  }
  const adj = await optimizePackTotalsForSegments(segInfos);
  for (let i = 0; i < segs.length; i++) {
    if (typeof adj[i] === "number") segs[i]._adjTotal = adj[i];
  }
} catch (e) {
  // silencieux: si config DB sans duo / sans colonne, on retombe sur les totaux standards
}


    const petRow = d.pet_id ? await dbGetPet(d.pet_id) : null;
    const duoRes = await applyDuoDiscountAcrossPeriod(segs, petRow?.animal_type || null);
    const segs2 = duoRes.segs;
    const duoSummary = duoRes.duoSummary;

    let total = 0;
    const lines = [];

    for (const seg of segs2) {
  // Mode avancé: si seg.slot=matin_soir mais prestation_id vide => on essaie auto-duo (packs mêmes familles) sinon on split
  if (seg.slot === "matin_soir" && !seg.prestation_id && seg.matin_id && seg.soir_id) {
    const pM = await dbGetPrestation(seg.matin_id);
    const pS = await dbGetPrestation(seg.soir_id);

    if (pM.category === "pack" && pS.category === "pack" && pM.pack_family && pM.pack_family === pS.pack_family) {
      const duo = await getDuoForFamily(pM.pack_family, null);
      if (duo?.id) {
        seg.prestation_id = duo.id;
      }
    }

    // si toujours pas de prestation_id => on split en 2 segments (matin + soir)
    if (!seg.prestation_id) {
      // insert matin
      const segM = { slot: "matin", start_date: seg.start_date, end_date: seg.end_date, prestation_id: seg.matin_id };
      const segS = { slot: "soir", start_date: seg.start_date, end_date: seg.end_date, prestation_id: seg.soir_id };
      // on traite en "inline" en réutilisant le code d'insertion via une mini-fonction
      const toInsert = [segM, segS];
      for (const ss of toInsert) {
        const presta = await dbGetPrestation(ss.prestation_id);
        const days = daysInclusive(ss.start_date, ss.end_date);
        if (days < 1) continue;

        const total = await computeLineTotal(presta, days, ss.slot);

        const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
        const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
        const coPart = d.employee_id ? money2(total - empPart) : total;

        const payload = {
          group_id,
          client_id: d.client_id,
          pet_id: d.pet_id || null,
          prestation_id: ss.prestation_id,
          slot: ss.slot,
          start_date: ss.start_date,
          end_date: ss.end_date,
          days_count: days,
          total_chf: total,
          employee_id: d.employee_id || null,
          employee_percent: d.employee_id ? empPercent : 0,
          employee_part_chf: empPart,
          company_part_chf: coPart,
          notes: d.notes || "",
          status: "confirmed",
        };
        created.push(await dbInsertBooking(payload));
      }
      continue; // skip the rest of the outer loop for this seg
    }
  }

      const presta = await dbGetPrestation(seg.prestation_id);
      const days = daysInclusive(seg.start_date, seg.end_date);

      let t = 0;
      // si optimisation Duo appliquée, on prend le total ajusté
      if (typeof seg._adjTotal === "number") t = seg._adjTotal;
      else if (presta.category === "pack") t = money2(Number(presta.price_chf) * days);
      else if (presta.category === "service") t = money2(Number(presta.price_chf) * days * visitsMultiplierFromSlot(seg.slot));
      else t = money2(Number(presta.price_chf) || 0);

      total += t;

      const multTxt = presta.category === "service" ? ` (x${visitsMultiplierFromSlot(seg.slot)}/jour)` : "";
      lines.push(`• ${seg.start_date}→${seg.end_date} — *${slotLabel(seg.slot)}* — ${presta.name}${multTxt} — *${t} CHF*`);
    }

    const optT = addonsTotal();
    const dvT = devisTotal();
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
        `📌 *Découpage*\n${lines.join("\n")}\n\n` +
        `${duoSummary?.length ? ('✅ Duo appliqué: ' + duoSummary.map(x=>`${x.pairs}× ${x.duoName} (−${money2(x.discountTotal)} CHF)`).join(' • ') + '\n\n') : ''}` +
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

  /* ----- GLOBAL NAV ----- */
  if (q.data === "back_main") return sendMainMenu(chatId);

  if (q.data === "m_emps") return sendEmployeesMenu(chatId);
  if (q.data === "m_clients") return sendClientsMenu(chatId);
  if (q.data === "m_prestas") return sendPrestationsMenu(chatId);

  if (q.data === "m_book") {
    wBooking.set(chatId, { step: "pick_client", data: {}, history: [] });
    return renderBookingStep(chatId);
  }

  /* ----- LISTS: upcoming / past / compta ----- */
  if (q.data === "list_upcoming") {
    const rows = await dbUpcomingBookings();
    if (!rows.length) return bot.sendMessage(chatId, "⏰ Aucune réservation à venir.", kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]));
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
    return bot.sendMessage(chatId, `⏰ *À venir*:\n\n${txt}`, { parse_mode: "Markdown", ...kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]) });
  }

  if (q.data === "list_past") {
    const rows = await dbPastBookings();
    if (!rows.length) return bot.sendMessage(chatId, "🧾 Aucune réservation passée.", kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]));
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
    return bot.sendMessage(chatId, `🧾 *Passées*:\n\n${txt}`, { parse_mode: "Markdown", ...kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]) });
  }

  if (q.data === "show_compta") {
    const { data, error } = await sb.from("bookings").select("total_chf,employee_part_chf,company_part_chf");
    if (error) return bot.sendMessage(chatId, `❌ Compta: ${error.message}`, kb([[{ text: "⬅️ Retour", callback_data: "back_main" }]]));
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
    // mini wizard client inline
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

  if (q.data === "bk_pet_new") {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.step = "pet_new_name";
    setBkState(chatId, st);

    return bot.sendMessage(chatId, "🐾 Nouvel animal — Envoie le *nom* (ex: Minou) :", {
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

  
  if (q.data === "noop") return;

  if (q.data?.startsWith("bk_pet_")) {
    const st = getBkState(chatId);
    if (!st) return;
    pushStep(st, st.step);
    st.data.pet_id = Number(q.data.replace("bk_pet_", ""));
    st.step = "start_date";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // Pagination prestations
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

  // Choix prestation (picker)
  if (q.data?.startsWith("bk_pickpresta_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const id = Number(q.data.replace("bk_pickpresta_", ""));
    const ctx = st.data._presta_ctx;
    if (!ctx?.storeKey) return;

    pushStep(st, st.step);
    // Stockage spécial mode avancé
if (ctx.storeKey === "__day_matin" || ctx.storeKey === "__day_soir") {
  const dates = st.data.dates || [];
  const idx = Number(st.data.day_index || 0);
  const date = dates[idx];
  const plan = getDayPlan(st.data, date);
  if (ctx.storeKey === "__day_matin") plan.matin_id = id;
  if (ctx.storeKey === "__day_soir") plan.soir_id = id;
  st.data.day_plans = st.data.day_plans || {};
  st.data.day_plans[date] = plan;
} else {
  st.data[ctx.storeKey] = id;
}
    st.data._presta_page = 0; // reset page

    const needM = st.data.slot_start === "matin" || st.data.slot_end === "matin";
    const needS = st.data.slot_start === "soir" || st.data.slot_end === "soir";

    if (st.step === "day_pick_matin") {
      // si slot = matin => retour sur écran jour (et potentiellement auto-jour suivant),
      // sinon on enchaîne sur le choix du soir.
      const dates = st.data.dates || [];
      const date = dates[Number(st.data.day_index || 0)];
      const plan = getDayPlan(st.data, date);
      if (plan.slot === "matin") st.step = "day_slot";
      else st.step = "day_pick_soir";
    } else if (st.step === "day_pick_soir") {
      st.step = "day_slot";
    } else if (st.step === "pick_presta_single_day") {
      st.step = "addons";
    } else if (st.step === "pick_presta_full") {
      st.step = needM ? "pick_presta_matin" : (needS ? "pick_presta_soir" : "addons");
    } else if (st.step === "pick_presta_matin") {
      st.step = needS ? "pick_presta_soir" : "addons";
    } else if (st.step === "pick_presta_soir") {
      st.step = "addons";
    }

    // ✅ MODE AVANCÉ: auto-passer au jour suivant quand le jour est complet
    if (st.step === "day_slot") {
      const dates = st.data.dates || [];
      const idx = Number(st.data.day_index || 0);
      const date = dates[idx];
      const plan = date ? getDayPlan(st.data, date) : null;

      const complete = plan ? dayPlanIsComplete(plan) : false;
      if (complete) {
        if (idx < dates.length - 1) {
          st.data.day_index = idx + 1;
        } else {
          // dernier jour terminé => options
          st.step = "addons";
        }
      }
    }

    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // Slots (1 jour)
  if (q.data?.startsWith("bk_slot_single_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const slot = q.data.replace("bk_slot_single_", "");
    if (!SLOTS.includes(slot)) return;
    pushStep(st, st.step);
    st.data.slot_single = slot;
    st.step = "pick_presta_single_day";
    st.data._presta_page = 0;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // Slots (multi jours)
  if (q.data?.startsWith("bk_slot_start_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const slot = q.data.replace("bk_slot_start_", "");
    if (!SLOTS.includes(slot)) return;
    pushStep(st, st.step);
    st.data.slot_start = slot;
    st.step = "slot_end";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  if (q.data?.startsWith("bk_slot_end_")) {
    const st = getBkState(chatId);
    if (!st) return;
    const slot = q.data.replace("bk_slot_end_", "");
    if (!SLOTS.includes(slot)) return;
    pushStep(st, st.step);
    st.data.slot_end = slot;
    st.step = "pick_presta_full";
    st.data._presta_page = 0;
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }/* ===== MODE AVANCÉ: DAY PLANNER CALLBACKS ===== */
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
  // reset selections if slot changes
  if (slot === "none") { plan.matin_id = null; plan.soir_id = null; }
  if (slot === "matin") { plan.soir_id = null; }
  if (slot === "soir") { plan.matin_id = null; }
  st.data.day_plans = st.data.day_plans || {};
  st.data.day_plans[date] = plan;

  pushStep(st, st.step);
  if (slot === "none") {
    // si "Aucun ce jour" => jour complet, on avance automatiquement
    const dates2 = Array.isArray(st.data.dates) ? st.data.dates : [];
    const idx2 = Number(st.data.day_index || 0);
    let next2 = idx2 + 1;
    while (next2 < dates2.length) {
      const dd = dates2[next2];
      const pl = st.data.day_plans?.[dd];
      if (!pl || !dayPlanIsComplete(pl)) break;
      next2++;
    }
    if (next2 >= dates2.length) {
      st.step = "addons";
    } else {
      st.data.day_index = next2;
      st.step = "day_slot";
    }
  } else if (slot === "matin") {
    st.step = "day_pick_matin";
    st.data._presta_page = 0;
  } else if (slot === "soir") {
    st.step = "day_pick_soir";
    st.data._presta_page = 0;
  } else {
    // matin_soir
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
    if (!dates.length) return;

    const idx = Number(st.data.day_index || 0);
    const curDate = dates[idx] || null;
    if (!curDate) return;

    const plan = ensureDayPlan(st, curDate);
    if (!dayPlanIsComplete(plan)) {
      return bot.sendMessage(chatId, "❌ Choisis d’abord le créneau + les prestations pour ce jour.", kb([[{ text: "⬅️ Retour", callback_data: "bk_back" }]]));
    }

    // jump to next incomplete day; if none -> options
    let next = idx + 1;
    while (next < dates.length) {
      const dp = ensureDayPlan(st, dates[next]);
      if (!dayPlanIsComplete(dp)) break;
      next++;
    }

    if (next >= dates.length) {
      pushStep(st, st.step);
      st.step = "addons";
    } else {
      st.data.day_index = next;
      st.step = "day_slot";
    }

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



  
// Options (suppléments + ménage) — UNIQUES
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
  if (exists) {
    return renderBookingStep(chatId);
  }

  // Si supplément avec quantité (ex: multi-chat) => demander qty
  if (p.ask_qty) {
    pushStep(st, st.step);
    st.data._addon_pending = { id: p.id, name: p.name, price_chf: Number(p.price_chf || 0), qty_label: p.qty_label || "Quantité" };
    st.step = "addon_qty";
    setBkState(chatId, st);
    return renderBookingStep(chatId);
  }

  // sinon ajout direct
  st.data.addons.push({
    id: p.id,
    name: p.name,
    qty: 1,
    total: Number(p.price_chf || 0),
    category: p.category,
  });
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

  
if (q.data === "bk_confirm") {
  const st = getBkState(chatId);
  if (!st) return;
  const d = st.data || {};

  function buildSegments() {
    const start = d.start_date;
    const end = d.end_date;
    const nDays = daysInclusive(start, end);
    if (nDays < 1) throw new Error("Dates invalides (fin avant début ?)");

    // 1 jour
    if (nDays === 1) {
      if (!d.slot_single || !d.prestation_single_day) throw new Error("Infos manquantes (slot/prestation)");
      return [{ slot: d.slot_single, start_date: start, end_date: end, prestation_id: d.prestation_single_day }];
    }

    // multi jours
    if (!d.slot_start || !d.slot_end || !d.prestation_full) throw new Error("Infos manquantes (slots/prestations)");

    const segs = [];

    // day1
    if (d.slot_start === "matin") segs.push({ slot: "matin", start_date: start, end_date: start, prestation_id: d.prestation_matin });
    if (d.slot_start === "soir") segs.push({ slot: "soir", start_date: start, end_date: start, prestation_id: d.prestation_soir });
    if (d.slot_start === "matin_soir") segs.push({ slot: "matin_soir", start_date: start, end_date: start, prestation_id: d.prestation_full });

    // middle full-days
    const midStart = addDaysISO(start, 1);
    const midEnd = addDaysISO(end, -1);
    const midDays = daysInclusive(midStart, midEnd);
    if (midDays >= 1) segs.push({ slot: "matin_soir", start_date: midStart, end_date: midEnd, prestation_id: d.prestation_full });

    // last day
    if (d.slot_end === "matin") segs.push({ slot: "matin", start_date: end, end_date: end, prestation_id: d.prestation_matin });
    if (d.slot_end === "soir") segs.push({ slot: "soir", start_date: end, end_date: end, prestation_id: d.prestation_soir });
    if (d.slot_end === "matin_soir") segs.push({ slot: "matin_soir", start_date: end, end_date: end, prestation_id: d.prestation_full });

    // sécurités
    for (const s of segs) {
      if (!s.prestation_id) throw new Error("Prestation manquante pour un segment");
    }
    return segs;
  }

  async function computeLineTotal(presta, days, slot) {
    const price = Number(presta.price_chf || 0);
    if (presta.category === "pack") return money2(price * days); // prix pack déjà "par jour"
    if (presta.category === "service") return money2(price * days * visitsMultiplierFromSlot(slot)); // service = par visite
    // options/devis: unique
    return money2(price);
  }

  try {
    const group_id = crypto.randomUUID();
    async function compileSegments() {
  // Si mode avancé (day_plans) présent => on compile jour par jour
  if (Array.isArray(d.dates) && d.dates.length && d.day_plans) {
    const dates = d.dates;
    const segmentsDaily = [];
    for (const date of dates) {
      const plan = getDayPlan(d, date);
      if (!plan.slot) continue;
      if (plan.slot === "none") continue;

      if (plan.slot === "matin") {
        segmentsDaily.push({ slot: "matin", start_date: date, end_date: date, prestation_id: plan.matin_id });
        continue;
      }
      if (plan.slot === "soir") {
        segmentsDaily.push({ slot: "soir", start_date: date, end_date: date, prestation_id: plan.soir_id });
        continue;
      }

      // matin_soir
      const pM = await dbGetPrestation(plan.matin_id);
      const pS = await dbGetPrestation(plan.soir_id);

      // Auto-duo uniquement pour les PACKS avec même pack_family
      if (pM.category === "pack" && pS.category === "pack" && pM.pack_family && pM.pack_family === pS.pack_family) {
        const duo = await getDuoForFamily(pM.pack_family, null);
        if (duo?.id) {
          segmentsDaily.push({ slot: "matin_soir", start_date: date, end_date: date, prestation_id: duo.id, _autoDuo: true });
          continue;
        }
      }

      // Sinon 2 lignes (matin + soir)
      segmentsDaily.push({ slot: "matin", start_date: date, end_date: date, prestation_id: plan.matin_id });
      segmentsDaily.push({ slot: "soir", start_date: date, end_date: date, prestation_id: plan.soir_id });
    }

    // Regroupe les jours consécutifs (même slot + même prestation_id) en plages
    const sorted = segmentsDaily.sort((a,b)=> (a.start_date+b.slot+a.prestation_id).localeCompare(b.start_date+b.slot+b.prestation_id));
    // On ne peut pas simplement trier comme ça; on va regrouper par (slot,prestation) en respectant la chronologie des dates
    const byKey = new Map();
    // We'll rebuild in chronological order
    const chronological = segmentsDaily.sort((a,b)=> a.start_date.localeCompare(b.start_date) || a.slot.localeCompare(b.slot) || (a.prestation_id-b.prestation_id));
    const segs = [];
    for (const item of chronological) {
      if (!item.prestation_id) continue;
      const last = segs[segs.length-1];
      if (last && last.slot===item.slot && Number(last.prestation_id)===Number(item.prestation_id) && addDaysISO(last.end_date,1)===item.start_date) {
        last.end_date = item.end_date;
      } else {
        segs.push({ ...item });
      }
    }
    return segs;
  }

  // Sinon mode historique (ancien) : segments 1er/jours complets/dernier
  return buildSegments();
}

const segs = await compileSegments();

    const petRow = d.pet_id ? await dbGetPet(d.pet_id) : null;
    const duoRes = await applyDuoDiscountAcrossPeriod(segs, petRow?.animal_type || null);
    const segs2 = duoRes.segs;

    const created = [];

    // 1) segments (pack/service)
    for (const seg of segs2) {
      const presta = await dbGetPrestation(seg.prestation_id);
      const days = daysInclusive(seg.start_date, seg.end_date);
      if (days < 1) continue;

      const baseTotal = await computeLineTotal(presta, days, seg.slot);
      const total = (typeof seg._adjTotal === "number") ? seg._adjTotal : baseTotal;

      const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
      const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
      const coPart = d.employee_id ? money2(total - empPart) : total;

      const payload = {
        group_id,
        client_id: d.client_id,
        pet_id: d.pet_id || null,
        prestation_id: seg.prestation_id,
        slot: seg.slot,
        start_date: seg.start_date,
        end_date: seg.end_date,
        days_count: days,
        total_chf: total,
        employee_id: d.employee_id || null,
        employee_percent: d.employee_id ? empPercent : 0,
        employee_part_chf: empPart,
        company_part_chf: coPart,
        notes: d.notes || "",
        status: "confirmed",
      };

      created.push(await dbInsertBooking(payload));
    }

    // 2) options uniques (suppléments + ménage)
    const addons = d.addons || [];
    for (const a of addons) {
      const presta = await dbGetPrestation(a.id);
      const total = money2(Number(a.total || presta.price_chf || 0)); // unique (avec qty si applicable)

      const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
      const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
      const coPart = d.employee_id ? money2(total - empPart) : total;

      const payload = {
        group_id,
        client_id: d.client_id,
        pet_id: d.pet_id || null,
        prestation_id: presta.id,
        slot: null,
        start_date: d.start_date,
        end_date: d.end_date,
        days_count: 1,
        total_chf: total,
        employee_id: d.employee_id || null,
        employee_percent: d.employee_id ? empPercent : 0,
        employee_part_chf: empPart,
        company_part_chf: coPart,
        notes: "",
        status: "confirmed",
      };

      created.push(await dbInsertBooking(payload));
    }

    // 3) devis personnalisé (unique, montant libre)
    const devisAmt = Number(d.devis_amount || 0);
    if (Number.isFinite(devisAmt) && devisAmt > 0) {
      // on utilise la prestation "Devis personnalisé" (category=devis) si elle existe
      const all = await dbListPrestations(true);
      const devisPresta = (all || []).find((p) => p.category === "devis") || null;
      if (devisPresta) {
        const total = money2(devisAmt);

        const empPercent = d.employee_id ? Number(d.employee_percent || 0) : 0;
        const empPart = d.employee_id ? money2((total * empPercent) / 100) : 0;
        const coPart = d.employee_id ? money2(total - empPart) : total;

        const payload = {
          group_id,
          client_id: d.client_id,
          pet_id: d.pet_id || null,
          prestation_id: devisPresta.id,
          slot: null,
          start_date: d.start_date,
          end_date: d.end_date,
          days_count: 1,
          total_chf: total,
          employee_id: d.employee_id || null,
          employee_percent: d.employee_id ? empPercent : 0,
          employee_part_chf: empPart,
          company_part_chf: coPart,
          notes: d.devis_note || "",
          status: "confirmed",
        };

        created.push(await dbInsertBooking(payload));
      }
    }

    wBooking.delete(chatId);

    // recap
    const recap = created
      .map((b) => `• #${b.id} — ${b.start_date || "—"}→${b.end_date || "—"} — ${b.slot ? slotLabel(b.slot) : "—"} — *${b.total_chf} CHF*`)
      .join("\n");

    return bot.sendMessage(chatId, `✅ *Garde confirmée*\n\nGroup: \`${group_id}\`\n\nLignes créées: *${created.length}*\n${recap}`, {
      parse_mode: "Markdown",
      ...kb([[{ text: "⬅️ Menu", callback_data: "back_main" }]]),
    });
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
    return bot.sendMessage(chatId, `👩‍💼 *${e.name}* (#${e.id})\nTel: ${e.phone || "—"}\n% défaut: ${e.default_percent}%\nActif: ${e.active ? "✅" : "⛔"}`, {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "✏️ Modifier", callback_data: `emp_edit_${e.id}` }],
        [{ text: e.active ? "⛔ Désactiver" : "✅ Activer", callback_data: `emp_toggle_${e.id}` }],
        [{ text: "🗑️ Supprimer", callback_data: `emp_del_${e.id}` }],
        [{ text: "⬅️ Retour", callback_data: "emp_list" }],
      ]),
    });
  }

  if (q.data?.startsWith("emp_toggle_")) {
    const id = Number(q.data.replace("emp_toggle_", ""));
    const e = await dbGetEmployee(id);
    await dbUpdateEmployee(id, { active: !e.active });
    return bot.sendMessage(chatId, "✅ Mis à jour.", kb([[{ text: "⬅️ Retour", callback_data: `emp_open_${id}` }]]));
  }

  if (q.data && /^(emp_del_\d+)$/.test(q.data)) {
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
      ]),
    });
  }

  if (q.data && /^(cl_del_\d+)$/.test(q.data)) {
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
        { text: `${animalLabel(p.animal_type)} ${p.name} ${p.active ? "✅" : "⛔"} (#${p.id})`, callback_data: `pet_open_${p.id}` },
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
        [{ text: "⬅️ Retour", callback_data: `pet_list_${clientId}` }, { text: "❌ Annuler", callback_data: "pet_cancel" }],
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

  if (q.data && /^(pet_del_\d+)$/.test(q.data)) {
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

  if (q.data && /^(pre_del_\d+)$/.test(q.data)) {
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
// devis amount / note
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

// addon qty
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

      // Mode avancé: planning jour par jour
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
          st.step = "pick_pet";
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