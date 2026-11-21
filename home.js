/* Home / Dashboard */
(function () {
  'use strict';
  const { $, $$, esc, api, store, toast, getLocation, DEFAULT_LOC, countUp, chart, timeAgo, KB } = window.Agra;

  /* ---------- Hero animation: scanning leaf with AR markers ---------- */
  function hero() {
    const c = $('#hero-canvas'); if (!c) return;
    const leaf = document.createElement('canvas');
    window.AgraSamples.draw(leaf, 'powdery_mildew', 3, { size: 520, augment: false });
    const ctx = c.getContext('2d');
    // knock out the paper background into a circle
    const targets = [[0.42, 0.38], [0.58, 0.55], [0.47, 0.7]];
    let t = 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function frame() {
      t += 0.016;
      ctx.clearRect(0, 0, 560, 560);
      ctx.save(); ctx.beginPath(); ctx.arc(280, 280, 250, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(leaf, 20, 20, 520, 520);
      const y = 40 + ((Math.sin(t * 1.2) + 1) / 2) * 480;
      const g = ctx.createLinearGradient(0, y - 40, 0, y + 4); g.addColorStop(0, 'rgba(163,230,53,0)'); g.addColorStop(1, 'rgba(163,230,53,.55)');
      ctx.fillStyle = g; ctx.fillRect(0, y - 40, 560, 44);
      ctx.fillStyle = '#a3e635'; ctx.fillRect(0, y, 560, 3);
      ctx.restore();
      ctx.strokeStyle = 'rgba(34,197,94,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(280, 280, 252, 0, Math.PI * 2); ctx.stroke();
      targets.forEach(([x, yy], i) => {
        const px = 20 + x * 520, py = 20 + yy * 520; const pr = 18 + Math.sin(t * 3 + i) * 5;
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.3); ctx.stroke();
        ctx.strokeStyle = `rgba(239,68,68,${0.5 - ((t * 0.8 + i * 0.3) % 1) * 0.5})`; ctx.beginPath(); ctx.arc(px, py, pr + ((t * 40 + i * 12) % 30), 0, 6.3); ctx.stroke();
      });
      if (!reduce) requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---------- Telemetry ---------- */
  async function stats() {
    try {
      const s = await api('/api/stats', { quiet: true });
      countUp($('#m-scans'), s.leavesScanned);
      $('#m-scans-t').textContent = `${s.bioAgents} Bio-Agents · ${s.last7.reduce((a, d) => a + d.count, 0)} scans this week`;
      countUp($('#m-kg'), s.pesticideKgDiverted, { decimals: 2 });
      $('#m-water').textContent = `≈ ${(s.groundwaterLitresProtected / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} million litres of water kept below the EU pesticide limit`;
      countUp($('#m-ob'), s.activeOutbreaks);
      chart($('#week-chart'), [{ data: s.last7.map((d) => d.count) }], { type: 'bar', labels: s.last7.map((d) => d.day), height: 190 });
    } catch {
      $('#live-chip').className = 'chip amber'; $('#live-chip').textContent = '● OFFLINE';
    }
  }

  /* ---------- Geo alert banner + weather ---------- */
  async function geo() {
    const b = $('#geo-banner');
    let loc = await getLocation({ prompt: true });
    const approx = !loc;
    if (!loc) loc = DEFAULT_LOC;
    try {
      const r = await api(`/api/alerts/nearby?lat=${loc.lat}&lng=${loc.lng}&radius=1.5`, { quiet: true });
      const where = approx ? ' (demo location: Singapore — allow location for your area)' : '';
      if (r.outbreaks.length) {
        const o = r.outbreaks[0];
        b.className = 'banner danger';
        b.innerHTML = `<span class="grow"><b>Outbreak warning:</b> ${o.count} cases of ${esc(o.disease)} clustered ${o.distanceKm} km from your position${where}. Check your plants now!</span><a class="btn btn-sm btn-danger" href="radar.html">View radar</a>`;
      } else if (r.cases > 0) {
        b.className = 'banner warn';
        b.innerHTML = `<span class="grow"><b>Heads-up:</b> ${r.cases} case${r.cases > 1 ? 's' : ''} of plant disease (mostly ${esc(r.top.disease)}) detected within 1.5 km of you in the last 14 days${where}. Scan your plants!</span><a class="btn btn-sm" href="scanner.html">Scan now</a>`;
      } else {
        b.className = 'banner safe';
        b.innerHTML = `<span class="grow">No active plant-disease outbreak within 1.5 km${where}. Keep scanning weekly to stay ahead.</span>`;
      }
    } catch {
      b.className = 'banner info'; b.innerHTML = '<span class="grow">Offline — outbreak alerts will refresh when you reconnect. Scanning still works.</span>';
    }
    try {
      const w = await api(`/api/weather?lat=${loc.lat}&lng=${loc.lng}`, { quiet: true });
      const ring = $('#risk-ring'); ring.style.setProperty('--p', w.fungalRisk);
      ring.style.setProperty('--c', w.fungalRisk >= 70 ? 'var(--danger)' : w.fungalRisk >= 45 ? 'var(--warn)' : 'var(--primary)');
      $('#risk-v').textContent = w.fungalRisk + '%';
      $('#wx').innerHTML = `<dt>Temp</dt><dd>${w.temperature.toFixed(1)} °C</dd><dt>Humidity</dt><dd>${Math.round(w.humidity)}%</dd><dt>Wind</dt><dd>${w.windSpeed.toFixed(1)} m/s</dd><dt>Rain (6h)</dt><dd>${Math.round(w.rainChance6h)}%</dd>`;
      $('#wx-advice').innerHTML = `${w.fungalRisk >= 70 ? '🍄 <b>High fungal pressure</b> — inspect leaves today. ' : ''}${esc(w.sprayAdvice)}${w.source === 'estimate' ? ' <span class="faint">(estimated)</span>' : ''}`;
      store.set('weather', w);
    } catch { $('#wx-advice').textContent = 'Weather unavailable offline.'; }
  }

  /* ---------- On-device history ---------- */
  async function history() {
    const items = await window.AgraDB.history(4).catch(() => []);
    if (!items.length) return;
    $('#history').innerHTML = items.map((h) => {
      const d = KB.disease(h.diseaseId);
      return `<a class="queue-item" href="prescription.html?d=${h.diseaseId}&s=${h.severity}" style="color:inherit;text-decoration:none"><img src="${h.thumb}" alt=""><div style="flex:1"><b>${d.emoji} ${esc(d.name)}</b><div class="small muted">${h.confidence}% · severity ${h.severity}% · ${timeAgo(h.at)}</div></div><span>›</span></a>`;
    }).join('');
  }

  /* ---------- Feature grid ---------- */
  const FEATURES = [
    ['🎯', 'Real-time AR overlays', 'Animated arrows point at the infection centre on the live camera.', 'scanner'],
    ['⏳', 'Disease timeline slider', 'See the leaf in 3, 7 and 14 days if left untreated.', 'scanner'],
    ['🎙️', 'Voice agronomist', 'Hands-free recipe reading for dirty hands, elders and kids.', 'prescription'],
    ['🗓️', 'Drag-and-drop scheduler', 'Visual plant-care calendar on your dashboard.', 'index#scheduler'],
    ['🔬', 'Microscopic simulator', 'Watch spores, bacteria and viruses invade leaf cells.', 'lab'],
    ['🎓', 'Bio-Agent quizzes', 'Train your eye and earn reputation points.', 'community'],
    ['💧', 'Eco-impact counter', 'Your action translated into litres of protected water.', 'prescription'],
    ['🃏', 'Pathology wiki-cards', 'Collectible cards with history and stats of each disease.', 'faq'],
    ['📡', 'Automated outbreak alerts', 'Twilio SMS/WhatsApp when a cluster forms — no human needed.', 'radar'],
    ['📲', 'Offline-first PWA', 'Install it; scanning and dictionary work without signal.', 'faq'],
    ['⭐', 'Crowdsourced bio-rating', 'Bad recipes are auto-demoted by statistical confidence.', 'prescription'],
    ['🕶️', 'Metadata stripper', 'EXIF/GPS removed, faces blurred, location rounded.', 'community']
  ];
  function features() {
    const PLATES = ['early_blight', 'rust', 'downy_mildew', 'nutrient_deficiency', 'mosaic_virus', 'leaf_spot', 'healthy', 'anthracnose', 'late_blight', 'powdery_mildew', 'bacterial_blight', 'early_blight'];
    $('#features').innerHTML = FEATURES.map(([, t, d, p], k) => `<li class="reveal" style="--rx:${k % 2 ? 24 : -24}px"><a href="${p.startsWith('index') ? 'dashboard.html' + p.replace('index', '') : p + '.html'}" data-plate="${PLATES[k]}"><b>${t}</b><span>${d}</span><em>${{ scanner: 'Bio-Scanner', prescription: 'Prescription', lab: 'The lab', community: 'Community', faq: 'Knowledge base', radar: 'Radar' }[p] || 'Field desk'}</em></a></li>`).join('');
    window.Agra.reveal();
  }
  function greet() {
    const h = new Date().getHours(); const u = window.Agra.profile.user;
    $('#greet').innerHTML = `${h < 11 ? 'Good morning' : h < 16 ? 'Good afternoon' : 'Good evening'},<br><em>${u ? esc(u.nickname) : 'field agent'}.</em>`;
  }

  /* ---------- Drag-and-drop crop scheduler (Feature #4) ---------- */
  const ACTIONS = [['💧', 'Water'], ['🧪', 'Organic spray'], ['📸', 'Re-scan'], ['✂️', 'Prune'], ['🌱', 'Fertilize'], ['🧺', 'Harvest']];
  const PLANTS = ['🍅 Tomato', '🌶️ Chilli', '🥒 Cucumber', '🌾 Rice', '🌿 Basil', '🫘 Beans', '🥬 Spinach', '🥭 Mango'];
  let month = new Date(); month.setDate(1);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tasks = () => store.get('schedule', []);
  function saveTasks(list) {
    store.set('schedule', list);
    clearTimeout(saveTasks.t);
    saveTasks.t = setTimeout(() => { if (store.get('token')) api('/api/schedule', { method: 'PUT', body: { items: list }, quiet: true }).catch(() => {}); }, 800);
  }
  function renderCal() {
    $('#cal-title').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));
    const today = ymd(new Date()); const list = tasks();
    let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const key = ymd(d);
      const its = list.filter((t) => t.date === key);
      html += `<div class="day ${key === today ? 'today' : ''} ${d.getMonth() !== month.getMonth() ? 'out' : ''}" data-date="${key}"><span class="dn">${d.getDate()}</span>${its.map((t) => `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}" title="${esc(t.plant)} — ${esc(t.action)}">${esc(t.icon)}<span class="t">${esc(t.action)}</span></div>`).join('')}</div>`;
    }
    $('#cal').innerHTML = html;
  }
  function scheduler() {
    $('#palette').innerHTML = ACTIONS.map(([i, a]) => `<div class="task" data-new="${a}" data-icon="${i}">${i} ${a}</div>`).join('');
    $('#plant-sel').innerHTML = PLANTS.map((p) => `<option>${p}</option>`).join('');
    renderCal();
    $('#cal-prev').onclick = () => { month.setMonth(month.getMonth() - 1); renderCal(); };
    $('#cal-next').onclick = () => { month.setMonth(month.getMonth() + 1); renderCal(); };
    $('#cal-clear').onclick = () => { if (confirm('Remove all scheduled tasks?')) { saveTasks([]); renderCal(); } };

    // Pointer-based drag & drop (works for mouse AND touch, unlike HTML5 DnD)
    let drag = null;
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.task'); if (!el || !el.closest('#scheduler')) return;
      e.preventDefault();
      const ghost = el.cloneNode(true);
      Object.assign(ghost.style, { position: 'fixed', zIndex: 200, pointerEvents: 'none', opacity: 0.9, boxShadow: 'var(--shadow-lg)', left: e.clientX - 30 + 'px', top: e.clientY - 16 + 'px', transform: 'rotate(-3deg)' });
      document.body.appendChild(ghost);
      drag = { el, ghost, x0: e.clientX, y0: e.clientY, moved: false };
    });
    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) drag.moved = true;
      drag.ghost.style.left = e.clientX - 30 + 'px'; drag.ghost.style.top = e.clientY - 16 + 'px';
      $$('.day.over').forEach((d) => d.classList.remove('over'));
      const day = document.elementFromPoint(e.clientX, e.clientY)?.closest('.day');
      if (day) day.classList.add('over');
    });
    document.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const { el, ghost, moved } = drag; drag = null; ghost.remove();
      $$('.day.over').forEach((d) => d.classList.remove('over'));
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const day = target?.closest('.day'); let list = tasks();
      if (!moved && el.dataset.id) { // tap = toggle done
        const t = list.find((x) => x.id === el.dataset.id); if (t) { t.done = !t.done; if (t.done) toast(`✅ ${t.action} done for ${t.plant}`); }
      } else if (target?.closest('#cal-clear') && el.dataset.id) { list = list.filter((x) => x.id !== el.dataset.id); toast('Task removed'); }
      else if (day && el.dataset.new) list.push({ id: Math.random().toString(36).slice(2, 10), date: day.dataset.date, icon: el.dataset.icon, action: el.dataset.new, plant: $('#plant-sel').value, done: false });
      else if (day && el.dataset.id) { const t = list.find((x) => x.id === el.dataset.id); if (t) t.date = day.dataset.date; }
      else return;
      saveTasks(list); renderCal();
    });
  }

  $('#tour-btn').onclick = () => window.Agra.onboarding(true);
  greet(); stats(); geo(); history(); features(); scheduler();
  setInterval(stats, 30000);
  window.addEventListener('agra:synced', stats);
  if (store.get('token')) api('/api/schedule', { quiet: true }).then((rows) => { if (rows.length && !tasks().length) { saveTasks(rows.map(({ id, date, icon, action, plant, done }) => ({ id, date, icon, action, plant, done }))); renderCal(); } }).catch(() => {});
})();
