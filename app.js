/*
 * Agralytic AI — App shell shared by every page.
 * Navbar/Footer/TabBar injection, theme & accessibility, API client, profiles,
 * geolocation, toasts/modals, PWA registration, voice agronomist chatbot (Feature #3), onboarding.
 */
(function () {
  'use strict';
  const KB = window.AgraKB;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('agra.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('agra.' + k, JSON.stringify(v)); } catch { /* quota */ } },
    del(k) { localStorage.removeItem('agra.' + k); }
  };

  /* ---------------- Theme & accessibility ---------------- */
  document.documentElement.dataset.theme = 'dark'; // the Specimen Lab design is dark by intent
  if (store.get('easy', false)) document.documentElement.dataset.easy = '1';

  /* ---------------- API ---------------- */
  async function api(path, { method = 'GET', body, quiet = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = store.get('token');
    if (token) headers['X-Agra-Token'] = token;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (!quiet) toast('You are offline — this action needs internet.', 'warn');
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!quiet) toast(data.error || `Request failed (${res.status})`, 'error');
      const err = new Error(data.error || res.status); err.status = res.status; throw err;
    }
    return data;
  }

  /* ---------------- Toast / modal ---------------- */
  function toast(msg, type = 'ok', ms = 4200) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(30px)'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, ms);
  }
  function modal(html, { onMount, wide = false } = {}) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'max-width:760px' : ''}"><button class="icon-btn x" aria-label="Close">✕</button>${html}</div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    $('.x', back).onclick = close;
    if (onMount) onMount(back.firstElementChild, close);
    return close;
  }

  /* ---------------- Profile ---------------- */
  const AVATARS = ['🌱', '🌿', '🍀', '🌻', '🦋', '🐝', '🐞', '🔬', '🧪', '🛡️', '🦅', '🐢'];
  const profile = {
    get user() { return store.get('user'); },
    get token() { return store.get('token'); },
    async refresh() {
      if (!this.token) return null;
      try { const me = await api('/api/me', { quiet: true }); store.set('user', me.user); store.set('stats', me.stats); renderProfileChip(); return me; } catch (e) { if (e.status === 401) { store.del('token'); store.del('user'); renderProfileChip(); } return null; }
    },
    ensure(reason = 'to earn points and join the community') {
      if (this.token) return Promise.resolve(this.user);
      return new Promise((resolve) => {
        modal(`<h2>Become a Bio-Agent 🛡️</h2>
          <p class="muted">Create an anonymous profile ${esc(reason)}. <b>Please don’t use your real full name</b> — a nickname keeps you safe.</p>
          <form id="pf">
            <div class="field"><label class="f" for="pf-n">Nickname</label><input id="pf-n" class="input" maxlength="24" required placeholder="e.g. LeafNinja" autocomplete="off"></div>
            <div class="field"><label class="f" for="pf-s">School or community (optional)</label><input id="pf-s" class="input" maxlength="60" placeholder="e.g. SMA Negeri 1"></div>
            <label class="f">Avatar</label><div class="row" id="pf-a" style="margin-bottom:16px">${AVATARS.map((a, i) => `<button type="button" class="icon-btn ${i === 0 ? 'on' : ''}" data-a="${a}" style="font-size:1.3rem">${a}</button>`).join('')}</div>
            <button class="btn btn-primary btn-block btn-lg">Create my profile</button>
            <p class="hint center" style="margin-top:10px">No email, no phone, no password. Your secret key stays on this device.</p>
          </form>`, {
          onMount(m, close) {
            let avatar = AVATARS[0];
            $$('#pf-a button', m).forEach((b) => b.onclick = () => { $$('#pf-a button', m).forEach((x) => x.style.borderColor = ''); b.style.borderColor = 'var(--primary)'; avatar = b.dataset.a; });
            $('#pf-a button', m).style.borderColor = 'var(--primary)';
            $('#pf', m).onsubmit = async (e) => {
              e.preventDefault();
              try {
                const r = await api('/api/users', { method: 'POST', body: { nickname: $('#pf-n', m).value, school: $('#pf-s', m).value, avatar } });
                store.set('token', r.token); store.set('user', r.user); store.set('stats', r.stats);
                renderProfileChip(); close(); toast(`Welcome, Agent ${r.user.nickname}! 🎉`); resolve(r.user);
              } catch { /* toast shown */ }
            };
            setTimeout(() => $('#pf-n', m).focus(), 50);
          }
        });
      });
    }
  };

  function renderProfileChip() {
    const el = $('#profile-chip');
    if (!el) return;
    const u = profile.user; const s = store.get('stats');
    el.innerHTML = u ? `<span class="av">${esc(u.avatar)}</span><span class="nm">${esc(u.nickname)} · Lv ${s ? s.level : 1}</span>` : '<span class="av">👤</span><span class="nm">Join</span>';
  }
  function showProfile() {
    const u = profile.user;
    if (!u) return profile.ensure();
    const s = store.get('stats') || { total: 0, level: 1, badges: [], counts: {} };
    const ALL = [['📸', 'First Responder'], ['🩺', 'Plant Doctor'], ['🧪', 'Eco Alchemist'], ['🎓', 'Certified Bio-Agent'], ['🛡️', 'Biosecurity Champion'], ['🤝', 'Community Healer'], ['♻️', 'Zero-Waste Hero'], ['🏆', 'Biosecurity Legend']];
    const owned = new Set(s.badges.map((b) => b.name));
    modal(`<div class="row"><div class="avatar" style="width:64px;height:64px;font-size:2rem">${esc(u.avatar)}</div><div><h2 style="margin:0">${esc(u.nickname)}</h2><div class="muted">${esc(u.school || 'Independent Bio-Agent')}</div></div></div>
      <div class="divider"></div>
      <div class="row between"><b>Level ${s.level}</b><span class="muted">${s.total} / ${s.nextLevelAt} pts</span></div>
      <div class="bar" style="margin:8px 0 18px"><i style="width:${Math.min(100, (s.total / s.nextLevelAt) * 100)}%"></i></div>
      <div class="grid g4" style="gap:10px;margin-bottom:18px">${[['📸', s.counts.scans || 0, 'scans'], ['🧪', s.counts.recipes || 0, 'recipes'], ['🎓', s.counts.quizzes || 0, 'quizzes'], ['💬', s.counts.posts || 0, 'posts']].map(([i, n, l]) => `<div class="card flat center" style="padding:12px"><div>${i}</div><b>${n}</b><div class="small muted">${l}</div></div>`).join('')}</div>
      <h3>Badges</h3><div class="badges">${ALL.map(([i, n]) => `<div class="badge ${owned.has(n) ? '' : 'locked'}"><div class="b">${i}</div>${n}</div>`).join('')}</div>
      <div class="divider"></div><button class="btn btn-sm btn-ghost" id="logout">Sign out on this device</button>`, {
      onMount(m, close) { $('#logout', m).onclick = () => { if (confirm('Your profile key will be removed from this device. Continue?')) { store.del('token'); store.del('user'); store.del('stats'); renderProfileChip(); close(); } }; }
    });
    profile.refresh();
  }

  /* ---------------- Location ---------------- */
  let locPromise = null;
  function getLocation({ prompt = true } = {}) {
    const cached = store.get('loc');
    if (cached && Date.now() - cached.at < 30 * 60000) return Promise.resolve(cached);
    if (!prompt && !cached) return Promise.resolve(null);
    if (locPromise) return locPromise;
    locPromise = new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(cached || null);
      navigator.geolocation.getCurrentPosition((p) => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude, at: Date.now(), source: 'gps' };
        store.set('loc', loc); resolve(loc);
      }, () => resolve(cached || null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
    }).finally(() => { locPromise = null; });
    return locPromise;
  }
  const DEFAULT_LOC = { lat: 1.3521, lng: 103.8198, source: 'default (Singapore)' };

  /* ---------------- Layout injection (Specimen Lab chrome) ---------------- */
  const PAGES = {
    index: ['index.html', 'Home', 'The cinematic overview', 'powdery_mildew'],
    dashboard: ['dashboard.html', 'Field desk', 'Your telemetry, weather risk and calendar', 'nutrient_deficiency'],
    scanner: ['scanner.html', 'Bio-Scanner', 'Diagnose a leaf on your device in three seconds', 'early_blight'],
    prescription: ['prescription.html', 'Prescription', 'Organic remedies from your own kitchen', 'downy_mildew'],
    radar: ['radar.html', 'Outbreak radar', 'Live red zones and spore drift', 'late_blight'],
    community: ['community.html', 'Community', 'Stories, missions, the Bio-Defender board', 'rust'],
    marketplace: ['marketplace.html', 'Seed swap', 'Trade kitchen waste, seeds and harvest', 'leaf_spot'],
    lab: ['lab.html', 'The lab', 'Open the AI and train it yourself', 'mosaic_virus']
  };
  const MINOR = { faq: ['faq.html', 'Knowledge base'], about: ['about.html', 'The science'], contact: ['contact.html', 'Contact & support'] };
  const LABEL = { ...Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, v[1]])), ...Object.fromEntries(Object.entries(MINOR).map(([k, v]) => [k, v[1]])) };

  function injectLayout() {
    const page = document.body.dataset.page || 'index';
    const landing = page === 'index';
    const header = document.createElement('header');
    header.className = 'ch-nav';
    header.innerHTML = `<a class="ch-word" href="index.html" aria-label="Agralytic AI home">agralytic<i></i></a>
      ${landing ? '' : `<span class="ch-here">Now viewing <b>${esc(LABEL[page] || '')}</b></span>`}
      <span class="ch-status"><span class="online-dot" id="online-dot"></span><span id="ch-status">Reading the field…</span></span>
      ${landing ? '' : '<button class="ch-tool" id="easy-btn" title="Easy-read mode (bigger text)" aria-label="Toggle large text">Aa</button><button class="profile-chip" id="profile-chip" aria-label="My Bio-Agent profile"></button>'}
      <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="ch-menu"><span id="menu-label">Menu</span><span class="bars"></span></button>`;
    const menu = document.createElement('nav');
    menu.className = 'ch-menu'; menu.id = 'ch-menu'; menu.setAttribute('aria-label', 'Main');
    menu.innerHTML = `<ul class="ch-list">${Object.entries(PAGES).map(([k, [href, l, d, plate]]) => `<li><a href="${href}" data-plate="${plate}" ${k === page ? 'aria-current="page"' : ''}>${l} <small>${d}</small></a></li>`).join('')}</ul>
      <div class="ch-aside"><div class="links">${Object.entries(MINOR).map(([k, [href, l]]) => `<a href="${href}" ${k === page ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</div>
      <p>Edge AI · offline-first · privacy by design.<br>Built for the Young AI Innovators challenge.</p><button class="btn btn-sm" id="install-btn" hidden>Install the app</button></div>`;
    const extras = document.createElement('div');
    extras.innerHTML = '<div class="grain" aria-hidden="true"></div><div class="cursor" aria-hidden="true"></div><div class="cursor-ring" aria-hidden="true"><span></span></div><div class="ch-preview" id="ch-preview" aria-hidden="true"></div><div class="ch-curtain" aria-hidden="true"></div>';
    document.body.prepend(menu); document.body.prepend(header); document.body.append(...extras.children);
    const skip = document.createElement('a'); skip.href = '#main'; skip.className = 'sr-only'; skip.textContent = 'Skip to content'; document.body.prepend(skip);

    if (!landing) {
      const tab = document.createElement('nav');
      tab.className = 'tabbar'; tab.setAttribute('aria-label', 'Quick navigation');
      tab.innerHTML = [['dashboard', 'Desk'], ['radar', 'Radar'], ['scanner', 'Scan'], ['prescription', 'Treat'], ['community', 'Hub']]
        .map(([p, l]) => `<a href="${PAGES[p][0]}" class="${p === page ? 'active' : ''} ${p === 'scanner' ? 'scan' : ''}">${l}</a>`).join('');
      document.body.appendChild(tab);
      const foot = document.createElement('footer');
      foot.className = 'site';
      foot.innerHTML = `<div class="container">
        <div class="foot-big"><a class="text-cta" href="scanner.html">Scan a leaf now <span>→</span></a><p>Detect plant disease in seconds, treat it with kitchen-safe remedies, and stop outbreaks before they become epidemics.</p></div>
        <div class="foot-grid">
          <div><a class="ch-word" href="index.html">agralytic<i></i></a><div class="sdg"><span>SDG 2 Zero hunger</span><span>SDG 12</span><span>SDG 13 Climate</span><span>SDG 15 Life on land</span></div></div>
          <div><h4>Platform</h4>${['scanner', 'prescription', 'radar', 'dashboard'].map((p) => `<a href="${PAGES[p][0]}">${PAGES[p][1]}</a>`).join('')}</div>
          <div><h4>People</h4>${['community', 'marketplace', 'lab'].map((p) => `<a href="${PAGES[p][0]}">${PAGES[p][1]}</a>`).join('')}</div>
          <div><h4>Learn</h4>${Object.values(MINOR).map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div>
        </div>
        <div class="foot-meta"><span>© ${new Date().getFullYear()} Agralytic AI · on-device diagnosis · EXIF/GPS stripped · locations rounded to ~100 m · no trackers</span><span>Not a substitute for professional agronomic advice in severe cases.</span></div></div>`;
      document.body.appendChild(foot);
      $('#easy-btn').onclick = () => {
        const on = !document.documentElement.dataset.easy;
        if (on) document.documentElement.dataset.easy = '1'; else delete document.documentElement.dataset.easy;
        store.set('easy', on); toast(on ? 'Easy-read mode on: bigger text' : 'Normal text size');
      };
      $('#profile-chip').onclick = showProfile;
      renderProfileChip();
    }
    chrome();
  }

  /* ---------------- Chrome behaviour: menu, hover reveal, cursor, grain, transitions ---------------- */
  function chrome() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const lerp = (a, b, t) => a + (b - a) * t;
    // grain
    const g = document.createElement('canvas'); g.width = g.height = 140; const gx = g.getContext('2d'); const gi = gx.createImageData(140, 140);
    for (let i = 0; i < gi.data.length; i += 4) { const v = Math.random() * 255; gi.data[i] = gi.data[i + 1] = gi.data[i + 2] = v; gi.data[i + 3] = 255; }
    gx.putImageData(gi, 0, 0); document.documentElement.style.setProperty('--noise', `url(${g.toDataURL()})`);
    // nav background after scroll
    const nav = $('.ch-nav');
    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 30);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    // menu
    const btn = $('#menu-btn');
    const toggle = (open = !document.documentElement.classList.contains('menu-open')) => {
      document.documentElement.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', open); $('#menu-label').textContent = open ? 'Close' : 'Menu';
      document.body.style.overflow = open ? 'hidden' : '';
    };
    btn.addEventListener('click', () => toggle());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
    $$('.ch-list a').forEach((a, i) => { a.style.transitionDelay = `${0.22 + i * 0.05}s`; });
    // hover reveal: any element with data-plate shows a specimen plate that follows the pointer
    const pv = $('#ch-preview'); const pos = { x: 0, y: 0, tx: 0, ty: 0 }; const cache = {};
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[data-plate]');
      if (!t || !window.AgraSamples?.plate || !fine) return;
      const id = t.dataset.plate;
      if (!cache[id]) cache[id] = window.AgraSamples.plate(id, 21, 280, 374, 1.15);
      pv.innerHTML = ''; pv.appendChild(cache[id]);
      pos.x = pos.tx = e.clientX + 120; pos.y = pos.ty = e.clientY; pv.classList.add('on');
    });
    document.addEventListener('pointerout', (e) => { const t = e.target.closest('[data-plate]'); if (t && !t.contains(e.relatedTarget)) pv.classList.remove('on'); });
    addEventListener('pointermove', (e) => { pos.tx = e.clientX + 120; pos.ty = e.clientY; }, { passive: true });
    // custom cursor
    const dot = $('.cursor'); const ring = $('.cursor-ring'); const lab = $('span', ring);
    const m = { x: innerWidth / 2, y: innerHeight / 2 }; const r = { ...m };
    if (fine && !reduce) {
      document.documentElement.classList.add('has-cursor');
      addEventListener('pointermove', (e) => { document.documentElement.classList.add('cursor-live'); m.x = e.clientX; m.y = e.clientY; dot.style.transform = `translate(${m.x}px,${m.y}px)`; }, { passive: true });
      document.addEventListener('pointerover', (e) => {
        ring.classList.remove('is-link', 'is-label', 'is-field');
        if (e.target.closest('input, textarea, select, .map, canvas.view, .cal')) { ring.classList.add('is-field'); return; }
        const t = e.target.closest('a, button, label, summary, [data-cursor]');
        if (!t) return;
        if (t.dataset.cursor) { lab.textContent = t.dataset.cursor; ring.classList.add('is-label'); } else ring.classList.add('is-link');
      });
    } else { dot.remove(); ring.remove(); }
    // page transition: curtain before same-site navigation
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || reduce || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname || url.pathname.startsWith('/api/')) return;
      e.preventDefault(); document.documentElement.classList.add('leaving');
      setTimeout(() => { location.href = url.href; }, 420);
    });
    addEventListener('pageshow', () => document.documentElement.classList.remove('leaving'));
    // one easing loop
    const loop = () => {
      r.x = lerp(r.x, m.x, 0.18); r.y = lerp(r.y, m.y, 0.18);
      if (ring.isConnected) ring.style.transform = `translate(${r.x}px,${r.y}px)`;
      pos.x = lerp(pos.x, pos.tx, 0.12); pos.y = lerp(pos.y, pos.ty, 0.12);
      pv.style.left = pos.x + 'px'; pv.style.top = pos.y + 'px';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // live status line
    api('/api/stats', { quiet: true }).then((s) => { $('#ch-status').textContent = `${s.activeOutbreaks} outbreak zone${s.activeOutbreaks === 1 ? '' : 's'} live`; }).catch(() => { $('#ch-status').textContent = 'Offline mode'; });
  }

  /* ---------------- Online status ---------------- */
  function updateOnline() {
    const d = $('#online-dot'); if (!d) return;
    d.classList.toggle('off', !navigator.onLine);
    d.title = navigator.onLine ? 'Online' : 'Offline — scans are saved and synced later';
  }
  window.addEventListener('online', () => { updateOnline(); toast('Back online — syncing saved scans…'); window.dispatchEvent(new Event('agra:sync')); });
  window.addEventListener('offline', () => { updateOnline(); toast('Offline mode: you can still scan. Reports will sync later.', 'warn'); });

  /* ---------------- PWA ---------------- */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; const b = $('#install-btn'); if (b) b.hidden = false; });
  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'sync-scans') window.dispatchEvent(new Event('agra:sync')); });
        return reg;
      }).catch(() => {});
    }
    document.addEventListener('click', async (e) => {
      if (e.target.id === 'install-btn' && deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; e.target.hidden = true; }
    });
  }

  /* ---------------- Speech ---------------- */
  const voice = {
    lang: store.get('voiceLang', 'en-US'),
    speak(text, onend) {
      if (!('speechSynthesis' in window)) { onend && onend(); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[*_#>`]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''));
      u.lang = this.lang; u.rate = store.get('easy', false) ? 0.85 : 0.98;
      const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').startsWith(this.lang.slice(0, 2)));
      if (v) u.voice = v;
      u.onend = () => onend && onend();
      speechSynthesis.speak(u);
    },
    stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
    recognizer() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return null;
      const r = new SR(); r.lang = this.lang; r.interimResults = false; r.maxAlternatives = 1;
      return r;
    }
  };

  /* ---------------- Chatbot (Voice-Guided Agronomist) ---------------- */
  const chat = {
    open: false, history: store.get('chat', []), context: store.get('chatCtx', {}), guide: null, handsFree: false, listening: false, rec: null,
    setContext(ctx) { Object.assign(this.context, ctx); store.set('chatCtx', this.context); },
    mount() {
      const fab = document.createElement('button');
      fab.className = 'fab-chat'; fab.setAttribute('aria-label', 'Open voice agronomist'); fab.title = 'Ask the AI agronomist'; fab.innerHTML = 'Ask<span class="fab-long"> the agronomist</span>';
      fab.onclick = () => this.toggle();
      document.body.appendChild(fab);
    },
    toggle(force) {
      this.open = force ?? !this.open;
      let p = $('.chat-panel');
      if (!this.open) { p && p.remove(); voice.stop(); this.stopListening(); return; }
      if (p) return;
      p = document.createElement('section');
      p.className = 'chat-panel'; p.setAttribute('aria-label', 'AI agronomist chat');
      p.innerHTML = `<div class="chat-head"><div class="avatar" style="background:rgba(255,255,255,.2)">🧑‍🌾</div><div class="ttl">Agro-Assistant<small id="chat-mode">Voice & text · hands-free ready</small></div>
        <button id="chat-lang" title="Voice language">${voice.lang === 'id-ID' ? 'ID' : 'EN'}</button><button id="chat-hf" title="Hands-free mode">🙌</button><button id="chat-x" title="Close">✕</button></div>
        <div class="chat-body" id="chat-body" aria-live="polite"></div>
        <div class="chat-quick" id="chat-quick"></div>
        <form class="chat-foot" id="chat-form"><button type="button" class="icon-btn mic" id="chat-mic" aria-label="Speak">🎙️</button><input class="input" id="chat-in" placeholder="Ask or say “read the recipe”…" autocomplete="off"><button class="btn btn-primary btn-sm" aria-label="Send">➤</button></form>`;
      document.body.appendChild(p);
      $('#chat-x').onclick = () => this.toggle(false);
      $('#chat-lang').onclick = (e) => { voice.lang = voice.lang === 'en-US' ? 'id-ID' : 'en-US'; store.set('voiceLang', voice.lang); e.target.textContent = voice.lang === 'id-ID' ? 'ID' : 'EN'; toast(`Voice language: ${voice.lang === 'id-ID' ? 'Bahasa Indonesia' : 'English'}`); };
      $('#chat-hf').onclick = (e) => { this.handsFree = !this.handsFree; e.target.style.background = this.handsFree ? '#fff' : ''; e.target.style.color = this.handsFree ? '#15803d' : ''; $('#chat-mode').textContent = this.handsFree ? 'Hands-free ON — just talk, I will listen after I speak' : 'Voice & text · hands-free ready'; if (this.handsFree) this.listen(); else this.stopListening(); };
      $('#chat-mic').onclick = () => (this.listening ? this.stopListening() : this.listen());
      $('#chat-form').onsubmit = (e) => { e.preventDefault(); const v = $('#chat-in').value.trim(); if (v) { $('#chat-in').value = ''; this.send(v); } };
      const quick = ['Read the recipe', 'How much baking soda?', 'What is a spore?', 'How do I treat powdery mildew?', 'Can viruses be cured?'];
      $('#chat-quick').innerHTML = quick.map((q) => `<button class="chip btnish" type="button">${q}</button>`).join('');
      $$('#chat-quick button').forEach((b) => b.onclick = () => this.send(b.textContent));
      if (!this.history.length) this.history.push({ role: 'assistant', content: `Hi! I’m your AI agronomist 🌿 Ask me anything about plant diseases, or tap 🎙️ and speak — perfect when your hands are dirty.${this.context.recipeId ? `\n\nI see you have the “${KB.recipe(this.context.recipeId)?.name}” recipe open. Say “read the recipe” and I’ll guide you step by step.` : ''}` });
      this.render();
      setTimeout(() => $('#chat-in').focus(), 50);
    },
    render() {
      const b = $('#chat-body'); if (!b) return;
      b.innerHTML = this.history.map((m) => `<div class="msg ${m.role === 'user' ? 'me' : 'bot'}">${esc(m.content)}</div>`).join('');
      b.scrollTop = b.scrollHeight;
      store.set('chat', this.history.slice(-30));
    },
    say(text) {
      this.history.push({ role: 'assistant', content: text }); this.render();
      voice.speak(text, () => { if (this.handsFree && this.open) this.listen(); });
    },
    async send(text) {
      this.history.push({ role: 'user', content: text }); this.render();
      const t = text.toLowerCase();
      // Guided recipe mode — handled locally so it works offline and hands-free.
      const recipe = KB.recipe(this.context.recipeId);
      if (/(read|baca).*(recipe|resep)|start guide|mulai/.test(t)) {
        if (!recipe) return this.say('Open a recipe on the Eco-Prescription page first, then say “read the recipe”.');
        this.guide = { i: 0 };
        const ing = recipe.ingredients.filter((x) => x.perLitre).map((x) => `${x.perLitre} ${x.unit} ${x.name}`).join(', ');
        return this.say(`${recipe.name}. For one litre you need: ${ing}. Say “next” for step one.`);
      }
      if (this.guide && recipe) {
        if (/(next|lanjut|berikut|done|selesai|ok)/.test(t)) {
          if (this.guide.i >= recipe.steps.length) { this.guide = null; window.dispatchEvent(new CustomEvent('agra:guide-done')); return this.say('All steps completed. Great job, Bio-Agent! Remember to spray at the recommended time.'); }
          const s = recipe.steps[this.guide.i]; this.guide.i++;
          window.dispatchEvent(new CustomEvent('agra:guide-step', { detail: this.guide.i }));
          return this.say(`Step ${this.guide.i} of ${recipe.steps.length}: ${s}`);
        }
        if (/(repeat|again|ulang)/.test(t)) return this.say(`Step ${this.guide.i}: ${recipe.steps[Math.max(0, this.guide.i - 1)]}`);
        if (/(back|previous|kembali)/.test(t)) { this.guide.i = Math.max(1, this.guide.i - 1); return this.say(`Step ${this.guide.i}: ${recipe.steps[this.guide.i - 1]}`); }
        if (/(stop|berhenti|cancel)/.test(t)) { this.guide = null; return this.say('Guide stopped.'); }
      }
      const typing = document.createElement('div'); typing.className = 'msg bot typing'; typing.textContent = 'Thinking…';
      $('#chat-body')?.appendChild(typing);
      try {
        const r = await api('/api/chat', { method: 'POST', body: { messages: this.history.slice(-10), context: this.context }, quiet: true });
        typing.remove(); this.say(r.reply);
      } catch {
        typing.remove();
        this.say('I am offline right now. I can still read recipes aloud: open a recipe and say “read the recipe”.');
      }
    },
    listen() {
      const r = voice.recognizer();
      if (!r) { toast('Voice input is not supported in this browser — try Chrome or Edge.', 'warn'); return; }
      this.stopListening();
      this.rec = r; this.listening = true; $('#chat-mic')?.classList.add('on');
      r.onresult = (e) => { const said = e.results[0][0].transcript; this.send(said); };
      r.onend = () => { this.listening = false; $('#chat-mic')?.classList.remove('on'); };
      r.onerror = () => { this.listening = false; $('#chat-mic')?.classList.remove('on'); };
      voice.stop();
      try { r.start(); } catch { /* already started */ }
    },
    stopListening() { if (this.rec) { try { this.rec.abort(); } catch { /* noop */ } } this.listening = false; $('#chat-mic')?.classList.remove('on'); }
  };

  /* ---------------- Onboarding ---------------- */
  function onboarding(force = false) {
    if (!force && store.get('onboarded')) return;
    const steps = [
      ['📸', 'Scan a leaf', 'Point your camera at a sick leaf. The AI runs inside your phone — no upload needed — and answers in about 3 seconds.'],
      ['🧪', 'Treat it naturally', 'Get a safe, organic recipe from kitchen ingredients, with a dose calculator and a step-by-step checklist.'],
      ['🗺️', 'Protect your neighbours', 'Your anonymous report feeds the Outbreak Radar. When >3 cases appear within 1 km, nearby residents get an early warning.']
    ];
    let i = 0;
    const close = modal('<div id="ob"></div>', {
      onMount(m, closeFn) {
        const draw = () => {
          const [ic, t, d] = steps[i];
          $('#ob', m).innerHTML = `<div class="center"><div style="font-size:4rem;margin:10px 0">${ic}</div><div class="eyebrow" style="justify-content:center">Step ${i + 1} of 3</div><h2>${t}</h2><p class="muted">${d}</p>
            <div class="row" style="justify-content:center;margin:14px 0">${steps.map((_, k) => `<span style="width:${k === i ? 26 : 8}px;height:8px;border-radius:8px;background:${k === i ? 'var(--primary)' : 'var(--border)'};transition:.3s"></span>`).join('')}</div>
            <div class="row" style="justify-content:center"><button class="btn btn-ghost" id="ob-skip">Skip</button><button class="btn btn-primary" id="ob-next">${i < 2 ? 'Next →' : 'Start scanning 📸'}</button></div></div>`;
          $('#ob-skip', m).onclick = () => { store.set('onboarded', true); closeFn(); };
          $('#ob-next', m).onclick = () => { if (i < 2) { i++; draw(); } else { store.set('onboarded', true); closeFn(); if (document.body.dataset.page !== 'scanner') location.href = 'scanner.html'; } };
        };
        draw();
      }
    });
    return close;
  }

  /* ---------------- Misc UI helpers ---------------- */
  function countUp(el, to, { decimals = 0, duration = 1400, suffix = '' } = {}) {
    const from = Number(el.dataset.v || 0); const start = performance.now();
    el.dataset.v = to;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration); const e = 1 - Math.pow(1 - p, 3);
      el.textContent = (from + (to - from) * e).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function reveal() {
    if (!('IntersectionObserver' in window)) { $$('.reveal').forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    $$('.reveal').forEach((e) => io.observe(e));
  }
  const timeAgo = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  };
  const diseaseChip = (id) => { const d = KB.disease(id); if (!d) return ''; const t = KB.PATHOGEN_TYPES[d.type]; return `<span class="chip" style="color:${t.color};border-color:${t.color}33">${d.emoji} ${esc(d.name)}</span>`; };

  /* Simple dependency-free SVG line/bar chart */
  function chart(el, series, { type = 'line', labels = [], height = 220, max, colors = ['#00ff66', '#e5e1d8', '#ffb547'], yFmt = (v) => v } = {}) {
    const w = el.clientWidth || 600; const h = height; const pad = { l: 38, r: 10, t: 12, b: 26 };
    const all = series.flatMap((s) => s.data);
    const top = max ?? Math.max(1, ...all) * 1.12;
    const n = Math.max(...series.map((s) => s.data.length));
    const x = (i) => pad.l + (n === 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - (type === 'bar' ? 0 : 1)));
    const y = (v) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = (top * k) / 4; g += `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${yFmt(+v.toFixed(2))}</text>`; }
    const step = Math.ceil(labels.length / 10) || 1;
    labels.forEach((l, i) => { if (i % step === 0) g += `<text x="${type === 'bar' ? x(i) + (w - pad.l - pad.r) / n / 2 : x(i)}" y="${h - 6}" text-anchor="middle">${esc(l)}</text>`; });
    series.forEach((s, si) => {
      const c = s.color || colors[si % colors.length];
      if (type === 'bar') {
        const bw = ((w - pad.l - pad.r) / n) * 0.62;
        s.data.forEach((v, i) => { g += `<rect x="${x(i) + ((w - pad.l - pad.r) / n - bw) / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, y(0) - y(v))}" rx="0" fill="${c}" opacity=".95"><title>${esc(labels[i] || '')}: ${v}</title></rect>`; });
      } else {
        const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        g += `<polyline points="${pad.l},${y(0)} ${pts} ${x(s.data.length - 1)},${y(0)}" fill="${c}" opacity=".10"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
    });
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px">${g}</svg>`;
  }

  /* ---------------- Boot ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    injectLayout();
    updateOnline();
    registerSW();
    chat.mount();
    reveal();
    profile.refresh();
    if (document.body.dataset.page === 'dashboard') setTimeout(() => onboarding(), 900);
  });

  window.Agra = { $, $$, esc, store, api, toast, modal, profile, getLocation, DEFAULT_LOC, voice, chat, onboarding, countUp, reveal, timeAgo, diseaseChip, chart, KB };
})();
