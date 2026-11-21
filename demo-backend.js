/*
 * Agralytic AI — Static demo runtime.
 * Runs the REAL backend code (server.js + server/*.js) inside the browser, so the site
 * can be hosted as static files (no Node server). It provides tiny stand-ins for
 * express, crypto, fs, the JSON database and the alert dispatcher, then intercepts
 * fetch('/api/...') calls and routes them to the in-browser Express-like app.
 * Data lives in this browser's localStorage. Alerts always run in simulation mode.
 */
(function () {
  'use strict';
  const defs = {}; const cache = {};
  window.__agraDefine = (name, fn) => { defs[name] = fn; };
  const process = { env: { AGRALYTIC_DISABLE_CLAUDE: '1' }, on() {}, loadEnvFile() {} };

  /* ---------- crypto stand-in (demo only — not cryptographically secure) ---------- */
  function hex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
  function fnv(str) { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < str.length; i++) { h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619); h2 = Math.imul(h2 + str.charCodeAt(i), 2246822519); } return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padEnd(16, '0'); }
  const cryptoShim = {
    randomBytes: (n) => ({ toString: () => hex(n) }),
    createHash: () => { let d = ''; const o = { update(x) { d += x; return o; }, digest: () => fnv(d) + fnv('salt' + d) }; return o; },
    createHmac: (_a, k) => cryptoShim.createHash().update(String(k))
  };

  /* ---------- localStorage-backed database with the same API as server/db.js ---------- */
  const KEY = 'agra.demo.db';
  const COLLECTIONS = ['users', 'scans', 'outbreaks', 'subscribers', 'alerts', 'posts', 'listings', 'listingRequests', 'ratings', 'communityRecipes', 'points', 'schedules', 'contacts', 'quizAttempts'];
  let state = null; let t = null;
  function load() {
    if (state) return state;
    try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }
    COLLECTIONS.forEach((c) => { if (!Array.isArray(state[c])) state[c] = []; });
    if (!state.meta) state.meta = { createdAt: Date.now(), seeded: false };
    return state;
  }
  function save() { clearTimeout(t); t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or disabled */ } }, 200); }
  const id = (p) => `${p}_${hex(6)}`;
  const db = {
    get state() { return load(); },
    all: (c) => load()[c], find: (c, f) => load()[c].find(f), filter: (c, f) => load()[c].filter(f), byId: (c, v) => load()[c].find((x) => x.id === v),
    insert(c, doc, prefix = c.slice(0, 3)) { const row = { id: id(prefix), createdAt: Date.now(), ...doc }; load()[c].push(row); save(); return row; },
    update(c, v, patch) { const r = db.byId(c, v); if (!r) return null; Object.assign(r, patch, { updatedAt: Date.now() }); save(); return r; },
    remove(c, f) { const s = load(); const b = s[c].length; s[c] = s[c].filter((x) => !f(x)); save(); return b - s[c].length; },
    save, flush: save, id
  };

  /* ---------- notify stand-in: same behaviour as server/notify.js in simulation mode ---------- */
  function notifyShim() {
    const geo = req('./geo');
    const mask = (c) => (c.length <= 4 ? '••••' : c.slice(0, 3) + '•'.repeat(Math.max(3, c.length - 6)) + c.slice(-3));
    return {
      encrypt: (s) => 'demo:' + btoa(unescape(encodeURIComponent(s))).split('').reverse().join(''),
      mask, hashContact: (c) => fnv('contact' + c),
      mode: () => ({ sms: false, whatsapp: false, telegram: false }),
      async dispatchOutbreak(outbreak, diseaseName) {
        const subs = db.filter('subscribers', (s) => s.active && geo.haversineKm(s, outbreak.center) <= s.radiusKm + outbreak.radiusKm);
        const out = [];
        for (const sub of subs) {
          if (db.find('alerts', (a) => a.subscriberId === sub.id && a.outbreakId === outbreak.id && Date.now() - a.createdAt < 12 * 3600e3)) continue;
          const dist = geo.haversineKm(sub, outbreak.center);
          const body = `🌿 Agralytic ALERT [${outbreak.level.toUpperCase()}]: ${outbreak.count} cases of ${diseaseName} detected ${dist.toFixed(1)} km from your area. Check your plants today, avoid overhead watering and open the Outbreak Radar for organic protection steps. Reply STOP to unsubscribe.`;
          out.push(db.insert('alerts', { subscriberId: sub.id, outbreakId: outbreak.id, channel: sub.channel, to: sub.contactMasked, body, status: 'simulated', error: null }, 'alr'));
        }
        return out;
      }
    };
  }

  /* ---------- express stand-in ---------- */
  function expressShim() {
    const stack = [];
    const compile = (p) => { const keys = []; const re = new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); return { re, keys }; };
    const app = {
      disable() {}, set() {}, listen() { return { close() {}, address: () => ({ port: 0 }) }; },
      use(a, b) { if (typeof a === 'string') stack.push({ prefix: a, fn: b }); else stack.push({ prefix: '', fn: a }); },
      _handle: null
    };
    ['get', 'post', 'put', 'delete'].forEach((m) => { app[m] = (path, ...fns) => { stack.push({ method: m.toUpperCase(), ...compile(path), fns }); }; });
    app._handle = (req) => new Promise((resolve) => {
      const res = {
        statusCode: 200, headers: {},
        setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
        json(d) { resolve({ status: this.statusCode, data: d }); }, sendFile() { resolve({ status: 404, data: { error: 'Not found' } }); }
      };
      let i = 0;
      const next = async (err) => {
        if (err) return resolve({ status: 500, data: { error: 'Server error' } });
        while (i < stack.length) {
          const l = stack[i++];
          if (l.method) {
            if (l.method !== req.method) continue;
            const m = req.path.match(l.re); if (!m) continue;
            req.params = {}; l.keys.forEach((k, j) => { req.params[k] = decodeURIComponent(m[j + 1]); });
            let j = 0;
            const run = async () => { const f = l.fns[j++]; if (!f) return next(); try { await f(req, res, run); } catch (e) { console.error(e); resolve({ status: 500, data: { error: 'Server error' } }); } };
            return run();
          }
          if (l.fn.length === 4) continue; // error handlers
          if (l.prefix && !req.path.startsWith(l.prefix)) continue;
          return l.fn(req, res, next);
        }
        resolve({ status: 404, data: { error: 'Not found' } });
      };
      next();
    });
    return app;
  }
  const express = Object.assign(() => (express._app = expressShim()), { json: () => (_q, _s, n) => n(), static: () => (_q, _s, n) => n() });

  /* ---------- module system ---------- */
  const builtins = {
    express, crypto: cryptoShim, path: { join: (...a) => a.join('/') }, fs: { existsSync: () => false, readFileSync() { throw new Error('no fs'); }, mkdirSync() {}, writeFileSync() {} },
    '@anthropic-ai/sdk': function Anthropic() {}, './db': db, './server/db': db
  };
  function req(name) {
    const key = name.replace(/^\.\.?\/(server\/)?/, '').replace(/^public\/js\//, '').replace(/\.js$/, '');
    if (builtins[name]) return builtins[name];
    if (key === 'knowledge') return window.AgraKB;
    if (key === 'notify') return cache.notify || (cache.notify = notifyShim());
    if (cache[key]) return cache[key].exports;
    const m = { exports: {} }; cache[key] = m;
    const fakeInterval = () => ({ unref() {} });
    defs[key](m, m.exports, req, process, fakeInterval);
    return m.exports;
  }

  /* ---------- boot + fetch interception ---------- */
  let app = null;
  function boot() {
    if (app) return app;
    app = req('server');
    req('seed').seed();
    return app;
  }
  // Inside the claude.ai preview frame outside APIs are blocked; on GitHub Pages / Netlify they work.
  const SANDBOXED = /claude|frame\.localhost/.test(location.hostname);
  window.AgraDemoSandboxed = SANDBOXED;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url, location.href);
    const i = u.pathname.indexOf('/api/');
    // The demo host blocks outside APIs: fail fast so the weather route uses its built-in estimate (no console noise).
    if (u.hostname === 'api.open-meteo.com' && SANDBOXED) throw new TypeError('offline demo');
    if (i === -1 || (u.origin !== location.origin)) return realFetch(input, init);
    const a = boot();
    const headers = new Headers(init.headers || {});
    const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });
    let body = {}; try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    const r = await a._handle({ method: (init.method || 'GET').toUpperCase(), path: u.pathname.slice(i), query, body, ip: 'demo', get: (h) => headers.get(h) });
    return new Response(JSON.stringify(r.data ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  window.AgraDemo = { reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } location.reload(); } };
})();

__agraDefine("server", function (module, exports, require, process, setInterval) { const __dirname = '.'; const Buffer = undefined;
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

});
__agraDefine("geo", function (module, exports, require, process, setInterval) { const __dirname = '.'; const Buffer = undefined;
/*
 * Geospatial helpers + outbreak cluster detection.
 * Rule from the system blueprint: a cluster = MORE THAN 3 infections of the same
 * pathogen within 1 km, in the last 14 days.
 */
'use strict';

const R = 6371; // km
const toRad = (d) => (d * Math.PI) / 180;

function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Privacy: snap to a ~110 m grid so a home address can never be recovered. */
function anonymise(lat, lng) {
  const snap = (v) => Math.round(v * 1000) / 1000;
  return { lat: snap(lat), lng: snap(lng) };
}

function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

const CLUSTER_RADIUS_KM = 1;
const CLUSTER_MIN_CASES = 4; // "> 3"
const WINDOW_MS = 14 * 24 * 3600 * 1000;
const NON_CONTAGIOUS = new Set(['healthy', 'nutrient_deficiency']);

function levelFor(count) {
  if (count >= 10) return 'critical';
  if (count >= 6) return 'warning';
  return 'watch';
}

/**
 * Given the newest scan, find same-disease neighbours and return a cluster description,
 * or null when the threshold is not reached.
 */
function detectCluster(scan, scans, now = Date.now()) {
  if (NON_CONTAGIOUS.has(scan.diseaseId)) return null;
  const neighbours = scans.filter((s) => s.diseaseId === scan.diseaseId &&
    now - s.createdAt <= WINDOW_MS &&
    haversineKm(s, scan) <= CLUSTER_RADIUS_KM);
  if (neighbours.length < CLUSTER_MIN_CASES) return null;
  const center = {
    lat: neighbours.reduce((a, s) => a + s.lat, 0) / neighbours.length,
    lng: neighbours.reduce((a, s) => a + s.lng, 0) / neighbours.length
  };
  const radiusKm = Math.max(0.5, ...neighbours.map((s) => haversineKm(s, center))) + 0.3;
  return { diseaseId: scan.diseaseId, center, radiusKm: +radiusKm.toFixed(2), count: neighbours.length, level: levelFor(neighbours.length), scanIds: neighbours.map((s) => s.id) };
}

module.exports = { haversineKm, anonymise, validCoord, detectCluster, levelFor, CLUSTER_RADIUS_KM, CLUSTER_MIN_CASES, WINDOW_MS, NON_CONTAGIOUS };

});
__agraDefine("ai", function (module, exports, require, process, setInterval) { const __dirname = '.'; const Buffer = undefined;
/*
 * Agralytic AI reasoning layer.
 *  1. Deterministic, offline-safe engines (always available):
 *       - buildPrescription(): ranks organic recipes by pathogen, pantry match,
 *         community bio-rating and evidence level, then builds a dated schedule.
 *       - localAnswer(): retrieval-based agronomist chatbot over the knowledge base.
 *  2. Optional Claude enhancement (when ANTHROPIC_API_KEY or another Anthropic credential is configured):
 *       - personalised prescription notes, free-form chat, and a vision "second opinion".
 *    The deterministic engine is the safety net: Claude never overrides safe concentrations.
 */
'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const KB = require('../public/js/knowledge.js');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
let client = null;
function claudeEnabled() {
  if (process.env.AGRALYTIC_DISABLE_CLAUDE === '1') return false;
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!client) client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

const EVIDENCE_WEIGHT = { strong: 1, moderate: 0.85, limited: 0.65, traditional: 0.55, community: 0.5 };

/* Wilson lower bound — the "Decentralized Crowdsourced Bio-Rating" (Feature #11). */
function wilsonLower(pos, n, z = 1.96) {
  if (n === 0) return null;
  const p = pos / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}
function bioRating(ratings) {
  const n = ratings.length;
  const worked = ratings.filter((r) => r.worked).length;
  const avgStars = n ? ratings.reduce((a, r) => a + r.stars, 0) / n : null;
  const lower = wilsonLower(worked, n);
  // Bayesian prior of 3.5 stars weighted as 5 virtual votes keeps new recipes from jumping around.
  const bayes = (3.5 * 5 + (avgStars || 0) * n) / (5 + n);
  let status = 'active';
  if (n >= 5 && lower !== null && lower < 0.3) status = 'demoted';
  else if (n >= 8 && lower !== null && lower > 0.6 && bayes >= 4) status = 'verified';
  return { count: n, worked, avgStars: avgStars && +avgStars.toFixed(2), successLower: lower && +lower.toFixed(3), score: +bayes.toFixed(2), status };
}

function normalise(s) { return String(s || '').toLowerCase(); }

function buildPrescription({ diseaseId, severity = 20, pantry = [], volumeL = 1, ratingsByRecipe = {}, extraRecipes = [] }) {
  const d = KB.disease(diseaseId);
  if (!d) throw new Error('Unknown disease');
  const pantryText = pantry.map(normalise).join(' ');
  const candidates = [...KB.RECIPES, ...extraRecipes].filter((r) => r.targets.includes(diseaseId));
  const ranked = candidates.map((r) => {
    const rating = bioRating(ratingsByRecipe[r.id] || []);
    const needed = r.ingredients.filter((i) => i.key !== 'water');
    const have = needed.filter((i) => pantryText && i.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && pantryText.includes(w)));
    const pantryMatch = needed.length ? have.length / needed.length : 1;
    const kitchenShare = needed.length ? needed.filter((i) => i.kitchen).length / needed.length : 1;
    let score = 0.45 * (EVIDENCE_WEIGHT[r.evidence] || 0.5) + 0.25 * (rating.score / 5) + 0.2 * pantryMatch + 0.1 * kitchenShare;
    // Severe or highly contagious cases must start with isolation.
    if (r.kind === 'protocol' && (severity >= 35 || d.severityBase >= 4)) score += 0.5;
    if (rating.status === 'demoted') score -= 1;
    return { recipe: r, score: +score.toFixed(3), rating, pantryMatch: +pantryMatch.toFixed(2), missing: needed.filter((i) => !have.includes(i)).map((i) => i.name) };
  }).sort((a, b) => b.score - a.score);

  const primary = ranked.find((x) => x.rating.status !== 'demoted') || ranked[0];
  const alternatives = ranked.filter((x) => x !== primary).slice(0, 3);

  const urgency = d.type === 'none' ? 'none' : severity >= 50 || d.severityBase >= 5 ? 'critical' : severity >= 20 || d.severityBase >= 4 ? 'high' : 'moderate';
  const immediate = [];
  if (d.type === 'none') immediate.push('No treatment needed. Keep scanning weekly and use compost tea to keep soil life strong.');
  else {
    if (d.contagious) immediate.push('Isolate: avoid touching healthy plants after this one; disinfect tools with 70% alcohol.');
    if (severity >= 15 && d.type !== 'abiotic') immediate.push(`Remove the worst leaves (≈${Math.min(30, Math.round(severity / 2))}% of affected foliage) and bag them — do not compost.`);
    if (d.type === 'viral') immediate.push('There is no cure for plant viruses. Uproot infected plants and control aphids/whiteflies.');
    if (d.type === 'bacterial') immediate.push('Do NOT use fungicides — they do not work on bacteria.');
    if (d.type === 'abiotic') immediate.push('This is not contagious. Do not spray pesticides; feed the soil instead.');
    if (d.type === 'oomycete') immediate.push('Keep leaves dry: water only at the base, in the morning.');
  }

  const schedule = [];
  if (primary && primary.recipe.schedule) {
    const s = primary.recipe.schedule;
    const start = new Date();
    for (let i = 0; i < s.times; i++) {
      const dt = new Date(start.getTime() + i * s.everyDays * 86400000);
      schedule.push({ date: dt.toISOString().slice(0, 10), action: `${primary.recipe.name} — ${s.timeOfDay}`, recipeId: primary.recipe.id });
    }
    schedule.push({ date: new Date(start.getTime() + (s.times * s.everyDays) * 86400000).toISOString().slice(0, 10), action: 'Re-scan with Bio-Scanner to confirm recovery', recipeId: null });
  }

  const pesticideMl = primary ? primary.recipe.pesticideEquivalentMl * volumeL * (primary.recipe.schedule ? primary.recipe.schedule.times : 1) : 0;
  return {
    disease: { id: d.id, name: d.name, scientific: d.scientific, type: d.type, contagious: d.contagious },
    urgency,
    immediate,
    primary: primary && serialiseRanked(primary, volumeL),
    alternatives: alternatives.map((a) => serialiseRanked(a, volumeL)),
    schedule,
    prevention: d.prevention,
    eco: { pesticideMlAvoided: +pesticideMl.toFixed(1), litresGroundwaterProtected: Math.round(KB.ECO.litresProtected(pesticideMl)) },
    callExpert: urgency === 'critical' || severity >= 60
  };
}

function serialiseRanked(x, volumeL) {
  const r = x.recipe;
  return {
    id: r.id, name: r.name, emoji: r.emoji, kind: r.kind, evidence: r.evidence, summary: r.summary,
    ingredients: r.ingredients.map((i) => ({ ...i, amount: i.perLitre ? +(i.perLitre * volumeL).toFixed(1) : null })),
    steps: r.steps, safety: r.safety, schedule: r.schedule, sources: r.sources, community: !!r.community,
    active: r.active ? { key: r.active.key, label: r.active.label, unit: r.active.unit, min: r.active.min, recommended: r.active.recommended, max: r.active.max, burn: r.active.burn } : null,
    score: x.score, rating: x.rating, pantryMatch: x.pantryMatch, missing: x.missing
  };
}

/* ---------- Offline chatbot (retrieval over the knowledge base) ---------- */
function localAnswer(message, context = {}) {
  const m = normalise(message);
  const named = KB.DISEASES.find((x) => x.id !== 'healthy' && (m.includes(x.name.toLowerCase().split(' (')[0].split(' / ')[0]) || m.includes(x.id.replace('_', ' ')) || (x.id === 'rust' && /\brust\b/.test(m))));
  const d = named || KB.disease(context.diseaseId);
  // An explicitly mentioned disease wins over the recipe that happens to be open in the app.
  const r = KB.RECIPES.find((x) => m.includes(x.name.toLowerCase()) || x.ingredients.some((i) => i.key !== 'water' && m.includes(i.key))) || (named ? null : KB.recipe(context.recipeId));
  const g = KB.GLOSSARY.find((x) => m.includes(x.term.toLowerCase().split(' (')[0]));

  if (/^(hi|hello|halo|hai|hey)\b/.test(m)) return 'Hello! I am your Agralytic agronomist. Ask me about a disease, a recipe, a dosage, or say "read the recipe" and I will guide you step by step.';
  if (g && /what is|what's|meaning|define|apa itu|arti/.test(m)) return `${g.term}: ${g.def}`;
  if (r && /(dose|dosage|how much|concentrat|ratio|takaran|berapa)/.test(m)) {
    const a = r.active;
    return a ? `${r.name}: use ${a.recommended} ${a.unit} (safe range ${a.min}–${a.max} ${a.unit}). Above ${a.burn} ${a.unit} the leaves can burn. Always test on 2–3 leaves first.` : `${r.name} is a protocol, not a spray — follow its steps.`;
  }
  if (r && /(how|make|step|cara|buat|recipe|resep)/.test(m)) return `${r.emoji} ${r.name}. Steps: ` + r.steps.map((s, i) => `${i + 1}) ${s}`).join(' ');
  if (d && /(treat|cure|fix|obat|spray|what do|what should|help)/.test(m)) {
    const recs = d.recipes.map((id) => KB.recipe(id)).filter(Boolean).map((x) => x.name).join(', ');
    return `${d.name} (${KB.PATHOGEN_TYPES[d.type].label}). Recommended: ${recs}. Prevention: ${d.prevention.join('; ')}.`;
  }
  if (d && /(spread|menyebar|contag|infect)/.test(m)) return `${d.name} spreads by: ${d.spread} Favourable conditions: ${d.conditions}`;
  if (d && /(symptom|look|gejala|sign)/.test(m)) return `${d.name} symptoms: ${d.symptoms.join('; ')}.`;
  if (d) return `${d.emoji} ${d.name} — ${d.symptoms[0]}. Spread: ${d.spread} History: ${d.history}`;
  if (/virus/.test(m)) return KB.PATHOGEN_TYPES.viral.explain;
  if (/bacteri/.test(m)) return KB.PATHOGEN_TYPES.bacterial.explain;
  if (/fung|jamur/.test(m)) return KB.PATHOGEN_TYPES.fungal.explain;
  if (/offline|internet|signal/.test(m)) return KB.FAQ[4].a;
  if (/privacy|photo|data|privasi/.test(m)) return KB.FAQ[0].a;
  if (/accura|akurat|confidence/.test(m)) return KB.FAQ[1].a;
  if (/camera|kamera|blur|dark/.test(m)) return KB.TROUBLESHOOT.map((t) => `${t.issue}: ${t.fix}`).join(' ');
  return 'I can help with plant diseases (e.g. "How do I treat powdery mildew?"), recipes ("How to make neem spray?"), dosages ("How much baking soda?") and terms ("What is a spore?").';
}

/* ---------- Claude helpers ---------- */
const SYSTEM = `You are "Agralytic", a friendly plant-health agronomist inside an educational biosecurity web app used by students, urban farmers and elderly gardeners.
Rules:
- Prefer integrated pest management: prevention, isolation, then organic kitchen remedies. Never recommend synthetic pesticides as a first step, and never recommend anything illegal or dangerous.
- When you mention a homemade spray, never exceed the safe maximum concentrations from this table: ${KB.RECIPES.filter((r) => r.active).map((r) => `${r.name}: max ${r.active.max} ${r.active.unit}`).join('; ')}.
- Viruses cannot be cured; bacteria are not controlled by fungicides; nutrient deficiency is not contagious.
- If the case looks severe or spreading quickly, advise contacting a local agricultural extension officer.
- Use short sentences that a 12-year-old understands. Reply in the same language as the user.`;

function textOf(resp) {
  return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

async function callClaude({ messages, maxTokens = 1200, effort = 'low' }) {
  const resp = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort },
    system: SYSTEM,
    messages
  });
  if (resp.stop_reason === 'refusal') return null;
  return textOf(resp);
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude credentials are invalid';
  if (err instanceof Anthropic.RateLimitError) return 'Claude is rate-limited, using offline engine';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}`;
  return 'Claude unavailable, using offline engine';
}

async function chat(history, context) {
  const last = history[history.length - 1]?.content || '';
  if (!claudeEnabled()) return { reply: localAnswer(last, context), engine: 'offline-kb' };
  try {
    const ctx = context.diseaseId ? `\n[App context: the user's last diagnosis was ${KB.disease(context.diseaseId)?.name || context.diseaseId}${context.recipeId ? `, viewing recipe ${KB.recipe(context.recipeId)?.name}` : ''}.]` : '';
    const msgs = history.slice(-10).map((m, i, arr) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) + (i === arr.length - 1 ? ctx + '\nAnswer in at most 120 words; it may be read aloud.' : '') }));
    if (msgs[0].role !== 'user') msgs.shift();
    const reply = await callClaude({ messages: msgs, maxTokens: 800 });
    return reply ? { reply, engine: 'claude' } : { reply: localAnswer(last, context), engine: 'offline-kb' };
  } catch (err) {
    return { reply: localAnswer(last, context), engine: 'offline-kb', note: describeError(err) };
  }
}

async function prescriptionNotes(rx, { plant, weather, pantry }) {
  if (!claudeEnabled()) return null;
  try {
    const prompt = `Diagnosis: ${rx.disease.name} (${rx.disease.type}), urgency ${rx.urgency}. Plant: ${plant || 'unknown'}.
Weather now: ${weather ? JSON.stringify(weather) : 'unknown'}. Pantry: ${pantry.join(', ') || 'unknown'}.
Chosen recipe: ${rx.primary ? rx.primary.name : 'none'}.
Write 3 short, personalised bullet tips (max 25 words each) that adapt the plan to this plant and weather (e.g. postpone spraying if rain is expected, best time of day). Plain text bullets starting with "- ".`;
    return await callClaude({ messages: [{ role: 'user', content: prompt }], maxTokens: 600 });
  } catch {
    return null;
  }
}

async function secondOpinion(imageBase64, mediaType, heuristicTop) {
  if (!claudeEnabled()) return { available: false };
  const labels = KB.DISEASES.map((d) => d.id).join(', ');
  try {
    const resp = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 1500,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: `The on-device model suggested "${heuristicTop}". Give an independent diagnosis of this leaf. Choose diseaseId from exactly this list: ${labels}. Reply ONLY with JSON: {"diseaseId": "...", "confidence": 0-100, "reasoning": "max 40 words", "visibleSymptoms": ["..."]}` }
        ]
      }]
    });
    if (resp.stop_reason === 'refusal') return { available: true, error: 'declined' };
    const raw = textOf(resp);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { available: true, error: 'unparseable' };
    const parsed = JSON.parse(match[0]);
    if (!KB.disease(parsed.diseaseId)) return { available: true, error: 'unknown label' };
    return { available: true, diseaseId: parsed.diseaseId, confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)), reasoning: String(parsed.reasoning || '').slice(0, 400), visibleSymptoms: (parsed.visibleSymptoms || []).slice(0, 5).map(String) };
  } catch (err) {
    return { available: true, error: describeError(err) };
  }
}

module.exports = { buildPrescription, bioRating, wilsonLower, localAnswer, chat, prescriptionNotes, secondOpinion, claudeEnabled, MODEL };

});
__agraDefine("quiz", function (module, exports, require, process, setInterval) { const __dirname = '.'; const Buffer = undefined;
/* Bio-Agent Training quiz bank (Feature #6). Answers never leave the server. */
'use strict';

const QUESTIONS = [
  { id: 'q1', kind: 'image', sample: { disease: 'powdery_mildew', seed: 11 }, q: 'Bio-Agent, identify this infection!', options: ['Powdery Mildew', 'Rust', 'Mosaic Virus', 'Healthy'], answer: 0, explain: 'White flour-like patches on top of the leaf are the signature of powdery mildew.' },
  { id: 'q2', kind: 'image', sample: { disease: 'early_blight', seed: 7 }, q: 'What causes these target-shaped spots?', options: ['Nutrient deficiency', 'Early Blight (Alternaria)', 'Mosaic Virus', 'Sunburn'], answer: 1, explain: 'Concentric rings + yellow halo = early blight caused by the fungus Alternaria solani.' },
  { id: 'q3', kind: 'image', sample: { disease: 'rust', seed: 3 }, q: 'Name this disease.', options: ['Anthracnose', 'Leaf Spot', 'Rust', 'Downy Mildew'], answer: 2, explain: 'Orange powdery pustules are rust spores (urediniospores).' },
  { id: 'q4', kind: 'image', sample: { disease: 'mosaic_virus', seed: 5 }, q: 'This mottled yellow-green pattern suggests…', options: ['A virus', 'Too much water', 'A fungus', 'Healthy variegation only'], answer: 0, explain: 'A light/dark green mosaic with distortion is typical of viruses such as CMV or TMV.' },
  { id: 'q5', kind: 'image', sample: { disease: 'nutrient_deficiency', seed: 9 }, q: 'The whole leaf is yellow but the veins stay green. Should you spray fungicide?', options: ['Yes, immediately', 'No — it is probably a nutrient deficiency', 'Yes, twice a day', 'Only at night'], answer: 1, explain: 'Interveinal chlorosis is usually an iron/magnesium deficiency — not a germ. Feed the soil instead.' },
  { id: 'q6', kind: 'text', q: 'Which treatment works against a plant VIRUS?', options: ['Baking soda spray', 'Neem oil', 'No spray cures it — remove the plant and control insects', 'Milk spray'], answer: 2, explain: 'Viruses live inside cells. Removal and vector control are the only effective actions.' },
  { id: 'q7', kind: 'text', q: 'What is the safe maximum baking-soda concentration in our recipe?', options: ['1 g/L', '10 g/L', '50 g/L', '100 g/L'], answer: 1, explain: 'Above ~10 g/L the leaves can burn (phytotoxicity).' },
  { id: 'q8', kind: 'text', q: 'Why should neem oil be sprayed at dusk?', options: ['It glows in the dark', 'To protect bees and avoid leaf burn', 'Fungi sleep at night', 'It is cheaper at night'], answer: 1, explain: 'Pollinators are less active at dusk and there is no strong sun to burn oily leaves.' },
  { id: 'q9', kind: 'text', q: 'Which historical disaster was caused by late blight (Phytophthora infestans)?', options: ['The Dust Bowl', 'The Irish Potato Famine', 'The Bengal Famine', 'The Great Fire of London'], answer: 1, explain: 'Late blight destroyed Ireland’s potato crop in 1845–1852.' },
  { id: 'q10', kind: 'text', q: 'How do most bacteria enter a leaf?', options: ['They bite through the cuticle', 'Through wounds and stomata', 'Through roots only', 'They are born inside the leaf'], answer: 1, explain: 'Bacteria cannot pierce leaves; they use natural openings and wounds.' },
  { id: 'q11', kind: 'image', sample: { disease: 'leaf_spot', seed: 21 }, q: 'Many small round spots with pale centres. Most likely?', options: ['Cercospora/Septoria Leaf Spot', 'Late Blight', 'Powdery Mildew', 'Healthy'], answer: 0, explain: 'Numerous small spots with grey/tan centres are classic leaf-spot fungi.' },
  { id: 'q12', kind: 'text', q: 'Outbreak Radar declares a cluster when…', options: ['1 case appears', 'More than 3 cases of the same disease within 1 km', '100 cases in a country', 'It rains'], answer: 1, explain: 'Our early-warning rule is >3 same-pathogen infections within a 1 km radius in 14 days.' },
  { id: 'q13', kind: 'image', sample: { disease: 'healthy', seed: 4 }, q: 'Diagnosis?', options: ['Rust', 'Healthy', 'Bacterial Blight', 'Anthracnose'], answer: 1, explain: 'Even green colour, no lesions — healthy!' },
  { id: 'q14', kind: 'text', q: 'What does "phytotoxicity" mean?', options: ['Plant poison produced by fungi', 'Damage to a plant caused by a too-strong spray', 'A virus disease', 'Photosynthesis at night'], answer: 1, explain: 'Even organic sprays damage leaves if they are too concentrated.' }
];

function publicSet(n = 6) {
  const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, n);
  return shuffled.map(({ answer, explain, ...rest }) => rest);
}

function grade(answers) {
  return answers.map(({ id, choice }) => {
    const q = QUESTIONS.find((x) => x.id === id);
    if (!q) return null;
    return { id, correct: q.answer === choice, answer: q.answer, explain: q.explain };
  }).filter(Boolean);
}

module.exports = { publicSet, grade, QUESTIONS };

});
__agraDefine("seed", function (module, exports, require, process, setInterval) { const __dirname = '.'; const Buffer = undefined;
/*
 * Demo seed data so the Radar, Community, Leaderboard and Marketplace look alive at first launch.
 * All seeded items are flagged `demo: true` and can be wiped with `npm run reset`.
 */
'use strict';
const db = require('./db');
const { detectCluster } = require('./geo');

// Deterministic PRNG so the demo is identical every time.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const HUBS = [
  { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { name: 'Jakarta', lat: -6.2088, lng: 106.8456 },
  { name: 'Denpasar', lat: -8.6705, lng: 115.2126 },
  { name: 'Kuala Lumpur', lat: 3.139, lng: 101.6869 },
  { name: 'Bangkok', lat: 13.7563, lng: 100.5018 },
  { name: 'Manila', lat: 14.5995, lng: 120.9842 }
];
const DISEASES = ['powdery_mildew', 'early_blight', 'leaf_spot', 'rust', 'bacterial_blight', 'mosaic_virus', 'downy_mildew', 'anthracnose', 'late_blight', 'nutrient_deficiency', 'healthy'];
const PLANTS = ['Tomato', 'Chilli', 'Cucumber', 'Rice', 'Basil', 'Beans', 'Spinach', 'Mango'];

const USERS = [
  ['GreenFalcon', 'SMA Harapan Bangsa', '🦅'], ['LeafNinja', 'NUS High School', '🥷'], ['SporeHunter', 'SMP Negeri 3 Denpasar', '🔬'],
  ['BioGuardian', 'Raffles Institution', '🛡️'], ['ChlorophyllKid', 'SMA Labschool Jakarta', '🌱'], ['RootRanger', 'Sekolah Alam Bali', '🌳'],
  ['MossMaster', 'SK Bukit Damansara', '🍃'], ['PetalPilot', 'Bangkok Patana', '🌸']
];

function seed() {
  const s = db.state;
  if (s.meta.seeded) return;
  const r = rng(42);
  const now = Date.now();

  const users = USERS.map(([nickname, school, avatar]) => db.insert('users', { nickname, school, avatar, tokenHash: null, demo: true }, 'usr'));

  // Background scans across SE Asia + engineered clusters.
  const clusters = [
    { hub: 0, d: 'powdery_mildew', n: 7, spread: 0.006 },
    { hub: 0, d: 'early_blight', n: 5, spread: 0.005, dLat: 0.03, dLng: -0.05 },
    { hub: 1, d: 'bacterial_blight', n: 9, spread: 0.007 },
    { hub: 2, d: 'anthracnose', n: 6, spread: 0.006 },
    { hub: 3, d: 'rust', n: 5, spread: 0.005 },
    { hub: 4, d: 'late_blight', n: 11, spread: 0.007 }
  ];
  const addScan = (lat, lng, diseaseId, ageMs) => {
    const u = users[Math.floor(r() * users.length)];
    const row = db.insert('scans', {
      userId: u.id, diseaseId, plant: PLANTS[Math.floor(r() * PLANTS.length)],
      confidence: Math.round(62 + r() * 35), severity: diseaseId === 'healthy' ? 0 : Math.round(5 + r() * 55),
      lat: +lat.toFixed(3), lng: +lng.toFixed(3), demo: true
    }, 'scn');
    row.createdAt = now - ageMs;
    return row;
  };
  for (const c of clusters) {
    const h = HUBS[c.hub];
    for (let i = 0; i < c.n; i++) c.last = addScan(h.lat + (c.dLat || 0) + (r() - 0.5) * c.spread, h.lng + (c.dLng || 0) + (r() - 0.5) * c.spread, c.d, r() * 9 * 86400000);
  }
  for (let i = 0; i < 160; i++) {
    const h = HUBS[Math.floor(r() * HUBS.length)];
    addScan(h.lat + (r() - 0.5) * 0.35, h.lng + (r() - 0.5) * 0.35, DISEASES[Math.floor(r() * DISEASES.length)], r() * 30 * 86400000);
  }
  // Build outbreak records from the clusters.
  const scans = db.all('scans');
  for (const c of clusters) {
    const cl = detectCluster(c.last, scans, now);
    if (cl) db.insert('outbreaks', { ...cl, active: true, demo: true }, 'obk');
  }

  // Points for leaderboard.
  users.forEach((u, i) => {
    const n = 6 + Math.floor(r() * 20);
    for (let k = 0; k < n; k++) {
      const p = db.insert('points', { userId: u.id, amount: [10, 15, 5, 8][k % 4], reason: ['scan', 'recipe', 'quiz', 'share'][k % 4], demo: true }, 'pts');
      p.createdAt = now - r() * 6 * 86400000;
    }
    if (i < 3) db.insert('points', { userId: u.id, amount: 40, reason: 'outbreak-report', demo: true }, 'pts');
  });

  const posts = [
    [0, 'Saved my cucumbers from powdery mildew with milk spray 🥛', 'Scanner said 78% powdery mildew. I sprayed 30% milk every Sunday morning for 3 weeks. New leaves are clean now! Tip: spray in the sun, it works better.', 'powdery_mildew', 34],
    [1, 'Chilli anthracnose — isolation first, then garlic', 'Our school garden had black sunken spots. We bagged all infected fruit, sterilised scissors and used garlic extract as prevention. The Radar showed 5 cases near the canteen!', 'anthracnose', 21],
    [3, 'Rooftop farm report: baking soda burned my basil 😬', 'I used way too much baking soda (I guessed ~25 g/L). The toxicity calculator would have warned me. Lesson learned: max 10 g/L and test first!', 'powdery_mildew', 45],
    [4, 'Yellow leaves were NOT a disease', 'AI said nutrient deficiency, not infection. I almost bought fungicide. Rabbit urine ferment 1:10 fixed it in 2 weeks.', 'nutrient_deficiency', 28],
    [2, 'Mosaic virus on papaya — we removed 2 trees', 'Hard decision but the app explained viruses cannot be cured. We also sprayed soap on aphids. Neighbour trees are still healthy after 1 month.', 'mosaic_virus', 17]
  ];
  posts.forEach(([u, title, body, diseaseId, likes]) => {
    const p = db.insert('posts', { userId: users[u].id, title, body, diseaseId, image: null, likes, likedBy: [], comments: [], demo: true }, 'pst');
    p.createdAt = now - r() * 5 * 86400000;
  });

  const listings = [
    [0, 'give', 'kitchen', 'Crushed eggshells (≈500 g)', 'Perfect for the eggshell & banana-peel mineral tea.', 0, 1.3521, 103.8198],
    [1, 'swap', 'kitchen', 'Garlic skins + 10 old cloves', 'Swap for coffee grounds or banana peels.', 0, 1.3601, 103.8302],
    [3, 'give', 'kitchen', 'Used coffee grounds (2 kg / week)', 'From our school canteen, free every Friday.', 0, 1.3455, 103.8101],
    [5, 'sell', 'harvest', 'Organic chillies saved from anthracnose', 'Treated with garlic extract only. 250 g packs.', 15000, -8.6705, 115.2126],
    [4, 'give', 'seeds', 'Resistant tomato seeds (Ph-3 gene)', 'Late-blight tolerant variety. 30 seeds.', 0, -6.2088, 106.8456],
    [2, 'request', 'kitchen', 'Need: cold-pressed neem oil (100 ml)', 'For rust on our beans. Can swap fresh basil.', 0, -8.665, 115.22],
    [6, 'swap', 'tools', 'Spare 1-litre pressure sprayer', 'Clean, never used with chemicals. Swap for seeds.', 0, 3.139, 101.6869]
  ];
  listings.forEach(([u, type, category, title, description, price, lat, lng]) => {
    db.insert('listings', { userId: users[u].id, type, category, title, description, price, lat, lng, status: 'open', demo: true }, 'lst');
  });

  // Bio-ratings: give one recipe bad reviews to demonstrate auto-demotion.
  const rate = (recipeId, n, workedRatio, stars) => {
    for (let i = 0; i < n; i++) db.insert('ratings', { recipeId, userId: users[i % users.length].id, worked: r() < workedRatio, stars: Math.max(1, Math.min(5, Math.round(stars + (r() - 0.5) * 2))), demo: true }, 'rat');
  };
  rate('milk_spray', 14, 0.85, 4.5);
  rate('bicarbonate_spray', 11, 0.75, 4.1);
  rate('neem_emulsion', 9, 0.8, 4.3);
  rate('garlic_extract', 7, 0.6, 3.6);
  db.insert('communityRecipes', {
    userId: users[7].id, name: 'Chili-Vinegar Super Spray', emoji: '🌶️', kind: 'spray', evidence: 'community', community: true,
    targets: ['powdery_mildew', 'leaf_spot'], summary: 'Community-submitted: chilli + vinegar spray. Reported to burn leaves.',
    ingredients: [{ key: 'vinegar', name: 'Kitchen vinegar', perLitre: 100, unit: 'ml', kitchen: true }, { key: 'chilli', name: 'Chilli paste', perLitre: 30, unit: 'g', kitchen: true }, { key: 'water', name: 'Water', perLitre: 900, unit: 'ml', kitchen: true }],
    active: null, steps: ['Blend chilli with vinegar', 'Dilute with water', 'Spray'], safety: ['Vinegar is acidic and can scorch leaves.'], schedule: { everyDays: 7, times: 2, timeOfDay: 'evening' }, sources: ['Community submission'], pesticideEquivalentMl: 2, demo: true
  }, 'crc');
  const crc = db.all('communityRecipes')[0];
  for (let i = 0; i < 8; i++) db.insert('ratings', { recipeId: crc.id, userId: users[i].id, worked: i === 0, stars: i === 0 ? 3 : 1, demo: true }, 'rat');

  s.meta.seeded = true;
  db.save();
}

module.exports = { seed };

});

document.addEventListener('DOMContentLoaded', () => {
  const b = document.createElement('div');
  b.className = 'container';
  b.innerHTML = '<div class="banner info" style="margin-top:16px;font-size:.86rem"><span class="grow"><b>Static edition.</b> The whole backend runs inside your browser, so your data stays on this device and outbreak alerts are simulated.' + (window.AgraDemoSandboxed ? ' In this preview window the camera, GPS and map tiles are disabled: use <b>Upload photo</b> or the <b>sample leaves</b>.' : '') + '</span><button class="btn btn-sm" id="demo-reset">Reset demo</button></div>';
  const main = document.body.dataset.page && document.getElementById('main'); if (main) main.prepend(b);
  const r = document.getElementById('demo-reset'); if (r) r.onclick = () => window.AgraDemo.reset();
});
