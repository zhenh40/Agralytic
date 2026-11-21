/*
 * Agralytic AI — Plant Biosecurity Platform
 * Express backend: REST API + static PWA hosting.
 *   npm install && npm start   →   http://localhost:3000
 */
'use strict';
// Load .env if present (Node ≥ 20.12 built-in; no dotenv dependency needed)
try { if (require('fs').existsSync(require('path').join(__dirname, '.env'))) process.loadEnvFile(require('path').join(__dirname, '.env')); } catch { /* older Node: set env vars manually */ }
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./server/db');
const geo = require('./server/geo');
const notify = require('./server/notify');
const ai = require('./server/ai');
const quiz = require('./server/quiz');
const { seed } = require('./server/seed');
const KB = require('./public/js/knowledge.js');

const PORT = process.env.PORT || 3000;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

/* ---------------- Security headers ---------------- */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://images.unsplash.com",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'self'"
  ].join('; '));
  next();
});

/* ---------------- Rate limiting (in-memory token bucket) ---------------- */
const buckets = new Map();
function rateLimit(name, perMinute) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const b = buckets.get(key) || { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
    b.at = now;
    if (b.tokens < 1) return res.status(429).json({ error: 'Too many requests — please slow down.' });
    b.tokens -= 1;
    buckets.set(key, b);
    next();
  };
}
setInterval(() => { const cut = Date.now() - 600000; for (const [k, b] of buckets) if (b.at < cut) buckets.delete(k); }, 300000).unref();

/* ---------------- Helpers ---------------- */
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const BLOCKED_WORDS = /\b(fuck|shit|bitch|bangsat|anjing|kontol|goblok)\b/i;
const clean = (s) => s.replace(BLOCKED_WORDS, '***');
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const DAY = 86400000;

function auth(req, _res, next) {
  const t = req.get('X-Agra-Token');
  if (t) {
    const h = hashToken(t);
    req.user = db.find('users', (u) => u.tokenHash === h) || null;
  }
  next();
}
const requireUser = (req, res, next) => (req.user ? next() : bad(res, 'Create a Bio-Agent profile first.', 401));
app.use('/api', auth);

const POINT_CAPS = { scan: 20, recipe: 5, quiz: 3, post: 5, share: 5, rating: 10, 'outbreak-report': 3, like: 30 };
function award(userId, amount, reason) {
  const today = db.filter('points', (p) => p.userId === userId && p.reason === reason && Date.now() - p.createdAt < DAY).length;
  if (today >= (POINT_CAPS[reason] || 10)) return 0;
  db.insert('points', { userId, amount, reason }, 'pts');
  return amount;
}

function userStats(userId) {
  const pts = db.filter('points', (p) => p.userId === userId);
  const count = (r) => pts.filter((p) => p.reason === r).length;
  const total = pts.reduce((a, p) => a + p.amount, 0);
  const badges = [];
  if (count('scan') >= 1) badges.push({ id: 'first-scan', name: 'First Responder', icon: '📸' });
  if (count('scan') >= 10) badges.push({ id: 'plant-doctor', name: 'Plant Doctor', icon: '🩺' });
  if (count('recipe') >= 3) badges.push({ id: 'eco-alchemist', name: 'Eco Alchemist', icon: '🧪' });
  if (count('quiz') >= 2) badges.push({ id: 'bio-agent', name: 'Certified Bio-Agent', icon: '🎓' });
  if (count('outbreak-report') >= 1) badges.push({ id: 'biosecurity-champion', name: 'Biosecurity Champion', icon: '🛡️' });
  if (count('post') >= 2) badges.push({ id: 'community-healer', name: 'Community Healer', icon: '🤝' });
  if (count('share') >= 2) badges.push({ id: 'zero-waste', name: 'Zero-Waste Hero', icon: '♻️' });
  if (total >= 500) badges.push({ id: 'legend', name: 'Biosecurity Legend', icon: '🏆' });
  const level = Math.floor(Math.sqrt(total / 25)) + 1;
  return { total, level, nextLevelAt: 25 * level * level, badges, counts: { scans: count('scan'), recipes: count('recipe'), quizzes: count('quiz'), posts: count('post') } };
}
const publicUser = (u) => (u ? { id: u.id, nickname: u.nickname, school: u.school, avatar: u.avatar } : { nickname: 'Anonymous', avatar: '🌱' });

/* ======================= API ======================= */
app.get('/api/health', (_req, res) => res.json({ ok: true, claude: ai.claudeEnabled(), notify: notify.mode(), time: Date.now() }));

/* ---------- Profiles ---------- */
app.post('/api/users', rateLimit('users', 5), (req, res) => {
  const nickname = clean(str(req.body.nickname, 24));
  if (nickname.length < 3) return bad(res, 'Nickname must be at least 3 characters (please do not use your real full name).');
  if (db.find('users', (u) => u.nickname.toLowerCase() === nickname.toLowerCase())) return bad(res, 'Nickname already taken.');
  const token = crypto.randomBytes(24).toString('hex');
  const user = db.insert('users', { nickname, school: clean(str(req.body.school, 60)), avatar: str(req.body.avatar, 8) || '🌱', tokenHash: hashToken(token) }, 'usr');
  res.json({ token, user: publicUser(user), stats: userStats(user.id) });
});
app.get('/api/me', requireUser, (req, res) => res.json({ user: publicUser(req.user), stats: userStats(req.user.id) }));
app.post('/api/me/points', requireUser, (req, res) => {
  const reason = str(req.body.reason, 20);
  const amounts = { recipe: 15, share: 8 };
  if (!amounts[reason]) return bad(res, 'Unknown action');
  const got = award(req.user.id, amounts[reason], reason);
  res.json({ awarded: got, stats: userStats(req.user.id) });
});

/* ---------- Stats / telemetry ---------- */
app.get('/api/stats', (_req, res) => {
  const scans = db.all('scans');
  const recipePoints = db.filter('points', (p) => p.reason === 'recipe').length;
  const treated = scans.filter((s) => s.diseaseId !== 'healthy').length;
  const pesticideMl = treated * 2 * 3 + recipePoints * 2 * 4; // 2 ml/L concentrate avoided × typical sprays
  const byDisease = {};
  scans.forEach((s) => { byDisease[s.diseaseId] = (byDisease[s.diseaseId] || 0) + 1; });
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(); start.setHours(0, 0, 0, 0); const t0 = start.getTime() - (6 - i) * DAY;
    return { day: new Date(t0).toISOString().slice(5, 10), count: scans.filter((s) => s.createdAt >= t0 && s.createdAt < t0 + DAY).length };
  });
  res.json({
    leavesScanned: scans.length,
    pesticideKgDiverted: +(pesticideMl / 1000).toFixed(2),
    groundwaterLitresProtected: Math.round(KB.ECO.litresProtected(pesticideMl)),
    activeOutbreaks: db.filter('outbreaks', (o) => o.active).length,
    bioAgents: db.all('users').length,
    subscribers: db.filter('subscribers', (s) => s.active).length,
    byDisease, last7
  });
});

/* ---------- Scans + outbreak engine ---------- */
app.post('/api/scans', rateLimit('scans', 30), async (req, res) => {
  const diseaseId = str(req.body.diseaseId, 40);
  if (!KB.disease(diseaseId)) return bad(res, 'Unknown diagnosis');
  const confidence = Math.max(0, Math.min(100, num(req.body.confidence) || 0));
  const severity = Math.max(0, Math.min(100, num(req.body.severity) || 0));
  let lat = num(req.body.lat); let lng = num(req.body.lng);
  const hasLoc = geo.validCoord(lat, lng) && req.body.shareLocation !== false;
  if (hasLoc) ({ lat, lng } = geo.anonymise(lat, lng));
  const scan = db.insert('scans', {
    userId: req.user?.id || null, diseaseId, confidence, severity, plant: str(req.body.plant, 40) || null,
    engine: str(req.body.engine, 30) || 'edge', lat: hasLoc ? lat : null, lng: hasLoc ? lng : null,
    capturedAt: num(req.body.capturedAt) || Date.now(), offlineQueued: !!req.body.offlineQueued, demo: !!req.body.demo
  }, 'scn');
  let points = 0;
  if (req.user) points += award(req.user.id, 10, 'scan');

  let outbreak = null; let alerts = [];
  if (hasLoc && confidence >= 40) {
    const cluster = geo.detectCluster(scan, db.filter('scans', (s) => s.lat !== null));
    if (cluster) {
      const existing = db.find('outbreaks', (o) => o.active && o.diseaseId === cluster.diseaseId && geo.haversineKm(o.center, cluster.center) <= 1.2);
      const levelUp = existing && existing.level !== cluster.level;
      outbreak = existing ? db.update('outbreaks', existing.id, { center: cluster.center, radiusKm: cluster.radiusKm, count: cluster.count, level: cluster.level, scanIds: cluster.scanIds })
        : db.insert('outbreaks', { ...cluster, active: true }, 'obk');
      if (!existing || levelUp || cluster.count > (existing?.notifiedAtCount || 0) + 2) {
        alerts = await notify.dispatchOutbreak(outbreak, KB.disease(diseaseId).name);
        db.update('outbreaks', outbreak.id, { notifiedAtCount: cluster.count });
      }
      if (req.user) points += award(req.user.id, 40, 'outbreak-report');
    }
  }
  res.json({ scan, outbreak, alertsSent: alerts.length, alertsSimulated: alerts.filter((a) => a.status === 'simulated').length, points });
});

app.get('/api/scans', (req, res) => {
  const days = Math.min(90, num(req.query.days) || 30);
  const since = Date.now() - days * DAY;
  const disease = str(req.query.disease, 40);
  const rows = db.filter('scans', (s) => s.lat !== null && s.createdAt >= since && (!disease || s.diseaseId === disease));
  res.json(rows.map(({ id, diseaseId, lat, lng, severity, confidence, createdAt, plant }) => ({ id, diseaseId, lat, lng, severity, confidence, createdAt, plant })));
});

app.get('/api/outbreaks', (_req, res) => {
  const now = Date.now();
  // Auto-expire outbreaks with no new case for 14 days.
  db.all('outbreaks').forEach((o) => { if (o.active && now - (o.updatedAt || o.createdAt) > geo.WINDOW_MS) { o.active = false; db.save(); } });
  res.json(db.filter('outbreaks', (o) => o.active).map((o) => ({ ...o, disease: KB.disease(o.diseaseId)?.name })));
});

app.get('/api/alerts/nearby', (req, res) => {
  const lat = num(req.query.lat); const lng = num(req.query.lng);
  if (!geo.validCoord(lat, lng)) return bad(res, 'lat/lng required');
  const radius = Math.min(50, num(req.query.radius) || 1.5);
  const p = { lat, lng };
  const since = Date.now() - 14 * DAY;
  const cases = db.filter('scans', (s) => s.lat !== null && s.createdAt >= since && !geo.NON_CONTAGIOUS.has(s.diseaseId) && geo.haversineKm(p, s) <= radius);
  const counts = {};
  cases.forEach((s) => { counts[s.diseaseId] = (counts[s.diseaseId] || 0) + 1; });
  const outbreaks = db.filter('outbreaks', (o) => o.active && geo.haversineKm(p, o.center) <= radius + o.radiusKm)
    .map((o) => ({ id: o.id, diseaseId: o.diseaseId, disease: KB.disease(o.diseaseId)?.name, level: o.level, count: o.count, distanceKm: +geo.haversineKm(p, o.center).toFixed(2) }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  res.json({ radiusKm: radius, cases: cases.length, top: top ? { diseaseId: top[0], disease: KB.disease(top[0]).name, count: top[1] } : null, outbreaks });
});

/* ---------- Early-warning subscriptions ---------- */
app.post('/api/subscribers', rateLimit('subs', 5), (req, res) => {
  const channel = str(req.body.channel, 10);
  if (!['sms', 'whatsapp', 'telegram'].includes(channel)) return bad(res, 'Choose SMS, WhatsApp or Telegram');
  const contact = str(req.body.contact, 40).replace(/[\s-]/g, '');
  if (channel === 'telegram' ? !/^-?\d{5,15}$/.test(contact) : !/^\+\d{8,15}$/.test(contact)) return bad(res, channel === 'telegram' ? 'Enter your numeric Telegram chat ID' : 'Use international format, e.g. +6281234567890');
  const lat = num(req.body.lat); const lng = num(req.body.lng);
  if (!geo.validCoord(lat, lng)) return bad(res, 'Location required to know which outbreaks concern you');
  if (!req.body.consent) return bad(res, 'Consent is required (a parent/guardian must agree for users under 18).');
  const radiusKm = Math.max(0.5, Math.min(10, num(req.body.radiusKm) || 2));
  const hash = notify.hashContact(contact);
  const a = geo.anonymise(lat, lng);
  const existing = db.find('subscribers', (s) => s.contactHash === hash);
  const unsubscribeCode = crypto.randomBytes(8).toString('hex');
  const row = existing
    ? db.update('subscribers', existing.id, { channel, lat: a.lat, lng: a.lng, radiusKm, active: true, unsubscribeCode })
    : db.insert('subscribers', { channel, contactEnc: notify.encrypt(contact), contactHash: hash, contactMasked: notify.mask(contact), lat: a.lat, lng: a.lng, radiusKm, active: true, unsubscribeCode }, 'sub');
  const m = notify.mode();
  res.json({ id: row.id, masked: row.contactMasked, radiusKm, unsubscribeCode, live: !!m[channel] });
});
app.post('/api/subscribers/unsubscribe', (req, res) => {
  const code = str(req.body.code, 40);
  const s = db.find('subscribers', (x) => x.unsubscribeCode === code);
  if (!s) return bad(res, 'Code not found', 404);
  db.update('subscribers', s.id, { active: false });
  res.json({ ok: true });
});
app.get('/api/alerts/log', (_req, res) => {
  res.json(db.all('alerts').slice(-25).reverse().map(({ id, channel, to, body, status, createdAt, error }) => ({ id, channel, to, body, status, createdAt, error })));
});

/* ---------- Weather (proxy + cache + graceful fallback) ---------- */
const weatherCache = new Map();
app.get('/api/weather', rateLimit('weather', 30), async (req, res) => {
  const lat = num(req.query.lat); const lng = num(req.query.lng);
  if (!geo.validCoord(lat, lng)) return bad(res, 'lat/lng required');
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60000) return res.json(hit.data);
  let data;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability&forecast_days=1&wind_speed_unit=ms`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('weather ' + r.status);
    const j = await r.json();
    const c = j.current;
    const rainNext = Math.max(...(j.hourly?.precipitation_probability || [0]).slice(new Date().getUTCHours(), new Date().getUTCHours() + 6));
    data = { source: 'open-meteo', temperature: c.temperature_2m, humidity: c.relative_humidity_2m, precipitation: c.precipitation, windSpeed: c.wind_speed_10m, windDirection: c.wind_direction_10m, rainChance6h: rainNext };
  } catch {
    // Deterministic tropical fallback so the UI keeps working offline / in restricted networks.
    const h = new Date().getHours();
    data = { source: 'estimate', temperature: 29 - Math.abs(h - 14) * 0.4, humidity: 78, precipitation: 0, windSpeed: 3.2, windDirection: 135, rainChance6h: 40 };
  }
  // Fungal risk index (simple agronomic rule: warm + humid + leaf wetness).
  const t = data.temperature; const rh = data.humidity;
  let risk = 0;
  if (t >= 15 && t <= 32) risk += 35;
  if (rh >= 70) risk += 25; if (rh >= 85) risk += 20;
  if (data.precipitation > 0 || data.rainChance6h > 60) risk += 20;
  data.fungalRisk = Math.min(100, risk);
  data.sprayAdvice = data.rainChance6h > 60 ? 'Rain likely within 6 h — postpone spraying (it would wash off).' : data.windSpeed > 5 ? 'Too windy for spraying — drift risk.' : 'Good conditions for spraying in the early morning or at dusk.';
  weatherCache.set(key, { at: Date.now(), data });
  res.json(data);
});

/* ---------- Recipes, prescription & bio-rating ---------- */
function ratingsMap() {
  const m = {};
  db.all('ratings').forEach((r) => { (m[r.recipeId] = m[r.recipeId] || []).push(r); });
  return m;
}
app.get('/api/recipes', (_req, res) => {
  const m = ratingsMap();
  const all = [...KB.RECIPES.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, kind: r.kind, evidence: r.evidence, targets: r.targets, summary: r.summary })),
    ...db.all('communityRecipes').map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, kind: r.kind, evidence: 'community', targets: r.targets, summary: r.summary, community: true, author: publicUser(db.byId('users', r.userId)).nickname }))];
  res.json(all.map((r) => ({ ...r, rating: ai.bioRating(m[r.id] || []) })));
});
app.post('/api/recipes/:id/rate', rateLimit('rate', 20), (req, res) => {
  const id = req.params.id;
  if (!KB.recipe(id) && !db.byId('communityRecipes', id)) return bad(res, 'Recipe not found', 404);
  const stars = Math.round(num(req.body.stars));
  if (!(stars >= 1 && stars <= 5)) return bad(res, 'Stars 1–5');
  const userId = req.user?.id || `anon:${crypto.createHash('sha1').update(req.ip || '').digest('hex').slice(0, 10)}`;
  db.remove('ratings', (r) => r.recipeId === id && r.userId === userId);
  db.insert('ratings', { recipeId: id, userId, stars, worked: !!req.body.worked }, 'rat');
  if (req.user) award(req.user.id, 3, 'rating');
  res.json(ai.bioRating(db.filter('ratings', (r) => r.recipeId === id)));
});
app.post('/api/recipes', requireUser, rateLimit('newrecipe', 3), (req, res) => {
  const name = clean(str(req.body.name, 60));
  const targets = (Array.isArray(req.body.targets) ? req.body.targets : []).filter((t) => KB.disease(t)).slice(0, 5);
  const steps = (Array.isArray(req.body.steps) ? req.body.steps : []).map((s) => clean(str(s, 240))).filter(Boolean).slice(0, 10);
  const ingredients = (Array.isArray(req.body.ingredients) ? req.body.ingredients : []).map((i) => ({ key: str(i.name, 20).toLowerCase(), name: clean(str(i.name, 60)), perLitre: Math.max(0, num(i.perLitre) || 0), unit: str(i.unit, 6), kitchen: true })).filter((i) => i.name).slice(0, 8);
  if (name.length < 4 || !targets.length || steps.length < 2 || !ingredients.length) return bad(res, 'Name, at least one target disease, 2 steps and 1 ingredient are required.');
  const row = db.insert('communityRecipes', {
    userId: req.user.id, name, emoji: '🧑‍🔬', kind: 'spray', evidence: 'community', community: true, targets,
    summary: clean(str(req.body.summary, 240)), ingredients, active: null, steps,
    safety: ['Community recipe — not yet verified. Always test on 2–3 leaves first.'], schedule: { everyDays: 7, times: 3, timeOfDay: 'evening' }, sources: ['Community submission'], pesticideEquivalentMl: 2
  }, 'crc');
  award(req.user.id, 8, 'share');
  res.json(row);
});

app.post('/api/prescription', rateLimit('rx', 20), async (req, res) => {
  const diseaseId = str(req.body.diseaseId, 40);
  if (!KB.disease(diseaseId)) return bad(res, 'Unknown disease');
  const pantry = (Array.isArray(req.body.pantry) ? req.body.pantry : []).map((p) => str(p, 40)).filter(Boolean).slice(0, 30);
  const volumeL = Math.max(0.25, Math.min(20, num(req.body.volumeL) || 1));
  const severity = Math.max(0, Math.min(100, num(req.body.severity) || 20));
  const rx = ai.buildPrescription({ diseaseId, severity, pantry, volumeL, ratingsByRecipe: ratingsMap(), extraRecipes: db.all('communityRecipes') });

  // Geographic matching: who nearby offers the ingredients I am missing? (blueprint: "Pencocokan Geografis")
  const lat = num(req.body.lat); const lng = num(req.body.lng);
  if (geo.validCoord(lat, lng) && rx.primary) {
    const words = rx.primary.missing.join(' ').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    rx.nearbyIngredients = db.filter('listings', (l) => l.status === 'open' && l.type !== 'request' && words.some((w) => (l.title + ' ' + l.description).toLowerCase().includes(w)))
      .map((l) => ({ id: l.id, title: l.title, type: l.type, distanceKm: +geo.haversineKm({ lat, lng }, l).toFixed(1) }))
      .filter((l) => l.distanceKm <= 15).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 4);
  }
  rx.aiNotes = await ai.prescriptionNotes(rx, { plant: str(req.body.plant, 40), weather: req.body.weather || null, pantry });
  rx.engine = rx.aiNotes ? `rules+${ai.MODEL}` : 'rules';
  res.json(rx);
});

/* ---------- Chat & second opinion ---------- */
app.post('/api/chat', rateLimit('chat', 20), async (req, res) => {
  const history = (Array.isArray(req.body.messages) ? req.body.messages : []).filter((m) => m && typeof m.content === 'string').slice(-12);
  if (!history.length) return bad(res, 'Empty message');
  const out = await ai.chat(history, { diseaseId: str(req.body.context?.diseaseId, 40), recipeId: str(req.body.context?.recipeId, 40) });
  res.json(out);
});
app.post('/api/second-opinion', rateLimit('vision', 6), async (req, res) => {
  const dataUrl = str(req.body.image, 1_500_000);
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return bad(res, 'Image must be a base64 data URL (jpeg/png/webp).');
  res.json(await ai.secondOpinion(m[2], m[1], str(req.body.heuristicTop, 40)));
});

/* ---------- Community ---------- */
app.get('/api/posts', (req, res) => {
  const sort = req.query.sort === 'top' ? (a, b) => b.likes - a.likes : (a, b) => b.createdAt - a.createdAt;
  const d = str(req.query.disease, 40);
  res.json(db.filter('posts', (p) => !p.hidden && (!d || p.diseaseId === d)).sort(sort).slice(0, 50).map((p) => ({
    id: p.id, title: p.title, body: p.body, diseaseId: p.diseaseId, image: p.image, likes: p.likes, createdAt: p.createdAt,
    author: publicUser(db.byId('users', p.userId)), comments: p.comments.slice(-20).map((c) => ({ ...c, author: publicUser(db.byId('users', c.userId)) })),
    liked: !!(req.user && p.likedBy.includes(req.user.id))
  })));
});
app.post('/api/posts', requireUser, rateLimit('post', 5), (req, res) => {
  const title = clean(str(req.body.title, 120)); const body = clean(str(req.body.body, 2000));
  if (title.length < 5 || body.length < 10) return bad(res, 'Title (5+) and story (10+ characters) are required.');
  let image = null;
  if (req.body.image) {
    image = str(req.body.image, 400_000);
    if (!/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(image)) return bad(res, 'Invalid image');
  }
  const diseaseId = KB.disease(req.body.diseaseId) ? req.body.diseaseId : null;
  const p = db.insert('posts', { userId: req.user.id, title, body, diseaseId, image, likes: 0, likedBy: [], comments: [] }, 'pst');
  award(req.user.id, 5, 'post');
  res.json({ id: p.id });
});
app.post('/api/posts/:id/like', requireUser, (req, res) => {
  const p = db.byId('posts', req.params.id);
  if (!p) return bad(res, 'Not found', 404);
  const i = p.likedBy.indexOf(req.user.id);
  if (i >= 0) { p.likedBy.splice(i, 1); p.likes--; } else { p.likedBy.push(req.user.id); p.likes++; if (p.userId !== req.user.id) award(p.userId, 2, 'like'); }
  db.save();
  res.json({ likes: p.likes, liked: i < 0 });
});
app.post('/api/posts/:id/comments', requireUser, rateLimit('comment', 10), (req, res) => {
  const p = db.byId('posts', req.params.id);
  if (!p) return bad(res, 'Not found', 404);
  const text = clean(str(req.body.text, 500));
  if (text.length < 2) return bad(res, 'Comment too short');
  const c = { id: db.id('cmt'), userId: req.user.id, text, createdAt: Date.now() };
  p.comments.push(c); db.save();
  res.json({ ...c, author: publicUser(req.user) });
});
app.post('/api/posts/:id/report', rateLimit('report', 10), (req, res) => {
  const p = db.byId('posts', req.params.id);
  if (!p) return bad(res, 'Not found', 404);
  p.reports = (p.reports || 0) + 1;
  if (p.reports >= 3) p.hidden = true; // community moderation
  db.save();
  res.json({ ok: true });
});

app.get('/api/leaderboard', (req, res) => {
  const since = req.query.range === 'all' ? 0 : Date.now() - 7 * DAY;
  const totals = {};
  db.filter('points', (p) => p.createdAt >= since).forEach((p) => { totals[p.userId] = (totals[p.userId] || 0) + p.amount; });
  const users = Object.entries(totals).map(([id, pts]) => { const u = db.byId('users', id); return u && { ...publicUser(u), points: pts, badges: userStats(id).badges.map((b) => b.icon) }; }).filter(Boolean).sort((a, b) => b.points - a.points).slice(0, 20);
  const schools = {};
  users.forEach((u) => { if (u.school) schools[u.school] = (schools[u.school] || 0) + u.points; });
  res.json({ users, schools: Object.entries(schools).map(([school, points]) => ({ school, points })).sort((a, b) => b.points - a.points).slice(0, 10) });
});

app.get('/api/quiz', (_req, res) => res.json(quiz.publicSet(6)));
app.post('/api/quiz/submit', rateLimit('quiz', 10), (req, res) => {
  const answers = (Array.isArray(req.body.answers) ? req.body.answers : []).slice(0, 20).map((a) => ({ id: str(a.id, 10), choice: Math.round(num(a.choice)) }));
  const graded = quiz.grade(answers);
  const correct = graded.filter((g) => g.correct).length;
  let awarded = 0;
  if (req.user && graded.length) awarded = award(req.user.id, correct * 5, 'quiz');
  if (req.user) db.insert('quizAttempts', { userId: req.user.id, correct, total: graded.length }, 'qza');
  res.json({ graded, correct, total: graded.length, awarded });
});

/* ---------- Marketplace / Seed swap ---------- */
app.get('/api/listings', (req, res) => {
  const lat = num(req.query.lat); const lng = num(req.query.lng);
  const hasLoc = geo.validCoord(lat, lng);
  const cat = str(req.query.category, 20);
  const rows = db.filter('listings', (l) => l.status !== 'closed' && (!cat || l.category === cat)).map((l) => ({
    id: l.id, type: l.type, category: l.category, title: l.title, description: l.description, price: l.price, status: l.status, createdAt: l.createdAt,
    author: publicUser(db.byId('users', l.userId)), mine: !!(req.user && l.userId === req.user.id),
    distanceKm: hasLoc && l.lat !== null ? +geo.haversineKm({ lat, lng }, l).toFixed(1) : null,
    requests: req.user && l.userId === req.user.id ? db.filter('listingRequests', (r) => r.listingId === l.id).map((r) => ({ message: r.message, from: publicUser(db.byId('users', r.userId)).nickname, createdAt: r.createdAt })) : undefined
  }));
  rows.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || b.createdAt - a.createdAt);
  res.json(rows);
});
app.post('/api/listings', requireUser, rateLimit('listing', 5), (req, res) => {
  const type = str(req.body.type, 10); const category = str(req.body.category, 10);
  if (!['give', 'swap', 'sell', 'request'].includes(type)) return bad(res, 'Invalid type');
  if (!['kitchen', 'harvest', 'seeds', 'tools'].includes(category)) return bad(res, 'Invalid category');
  const title = clean(str(req.body.title, 80));
  if (title.length < 4) return bad(res, 'Title too short');
  let lat = num(req.body.lat); let lng = num(req.body.lng);
  if (geo.validCoord(lat, lng)) ({ lat, lng } = geo.anonymise(lat, lng)); else { lat = null; lng = null; }
  const row = db.insert('listings', { userId: req.user.id, type, category, title, description: clean(str(req.body.description, 400)), price: type === 'sell' ? Math.max(0, num(req.body.price) || 0) : 0, lat, lng, status: 'open' }, 'lst');
  award(req.user.id, 8, 'share');
  res.json(row);
});
app.post('/api/listings/:id/request', requireUser, rateLimit('lreq', 10), (req, res) => {
  const l = db.byId('listings', req.params.id);
  if (!l) return bad(res, 'Not found', 404);
  if (l.userId === req.user.id) return bad(res, 'This is your own listing');
  db.insert('listingRequests', { listingId: l.id, userId: req.user.id, message: clean(str(req.body.message, 300)) || 'I am interested!' }, 'lrq');
  res.json({ ok: true });
});
app.post('/api/listings/:id/status', requireUser, (req, res) => {
  const l = db.byId('listings', req.params.id);
  if (!l || l.userId !== req.user.id) return bad(res, 'Not allowed', 403);
  const status = str(req.body.status, 10);
  if (!['open', 'reserved', 'closed'].includes(status)) return bad(res, 'Invalid status');
  db.update('listings', l.id, { status });
  res.json({ ok: true });
});

/* ---------- Crop scheduler ---------- */
app.get('/api/schedule', requireUser, (req, res) => res.json(db.filter('schedules', (s) => s.userId === req.user.id)));
app.put('/api/schedule', requireUser, (req, res) => {
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 200).map((i) => ({
    id: str(i.id, 30) || db.id('sch'), date: /^\d{4}-\d{2}-\d{2}$/.test(i.date) ? i.date : null, plant: str(i.plant, 30), icon: str(i.icon, 8), action: str(i.action, 80), done: !!i.done
  })).filter((i) => i.date);
  db.remove('schedules', (s) => s.userId === req.user.id);
  items.forEach((i) => db.insert('schedules', { ...i, userId: req.user.id }, 'sch'));
  res.json({ saved: items.length });
});

/* ---------- Contact ---------- */
app.post('/api/contact', rateLimit('contact', 3), (req, res) => {
  const name = str(req.body.name, 60); const message = str(req.body.message, 2000); const topic = str(req.body.topic, 30);
  const email = str(req.body.email, 120);
  if (name.length < 2 || message.length < 10) return bad(res, 'Name and a message (10+ characters) are required.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Invalid email');
  const row = db.insert('contacts', { name, email, topic, message }, 'ctc');
  res.json({ ok: true, ticket: row.id.slice(-6).toUpperCase() });
});

/* ---------- Model status (Diagnostics Lab) ---------- */
app.get('/api/model/status', (_req, res) => {
  const fs = require('fs');
  const dir = path.join(__dirname, 'public', 'model');
  const has = fs.existsSync(path.join(dir, 'model.json'));
  let metrics = null;
  try { metrics = JSON.parse(fs.readFileSync(path.join(dir, 'metrics.json'), 'utf8')); } catch { /* none */ }
  const scans = db.all('scans');
  res.json({ tfjsModel: has, metrics, totalScans: scans.length, avgConfidence: scans.length ? +(scans.reduce((a, s) => a + s.confidence, 0) / scans.length).toFixed(1) : 0, claude: ai.claudeEnabled() });
});

/* ---------------- Static PWA ---------------- */
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, file) {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
    if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
  }
}));
app.use('/api', (_req, res) => bad(res, 'Not found', 404));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

if (require.main === module) {
  seed();
  app.listen(PORT, () => {
    console.log(`\n🌿 Agralytic AI running →  http://localhost:${PORT}`);
    console.log(`   Claude reasoning: ${ai.claudeEnabled() ? 'ON (' + ai.MODEL + ')' : 'OFF (offline knowledge engine) — set ANTHROPIC_API_KEY to enable'}`);
    const m = notify.mode();
    console.log(`   Alerts: SMS ${m.sms ? 'LIVE' : 'simulated'} · WhatsApp ${m.whatsapp ? 'LIVE' : 'simulated'} · Telegram ${m.telegram ? 'LIVE' : 'simulated'}\n`);
  });
}
module.exports = app;
