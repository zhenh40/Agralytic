/* Agralytic — landing page (hero specimen, loader, ticker, specimen index). Chrome comes from app.js. */
{
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const KB = window.AgraKB; const S = window.AgraSamples;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* Optional photography: add Unsplash photo IDs here (e.g. hero: 'photo-…'). If a photo cannot load,
     the procedural specimen plate underneath stays visible, so nothing ever looks broken. */
  const UNSPLASH = {};
  const unsplash = (id, w) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
  function mount(box, diseaseId, seed, w, h, photoKey, zoom) {
    box.innerHTML = '';
    box.appendChild(S.plate(diseaseId, seed, w, h, zoom));
    const id = photoKey && UNSPLASH[photoKey];
    if (id) { const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.onerror = () => img.remove(); img.src = unsplash(id, w * 2); box.appendChild(img); }
  }

  /* ---------- hero plate + live readout ---------- */
  const hero = $('#plate-media');
  const CYCLE = [['powdery_mildew', 11, 'Podosphaera<br>xanthii', 94.2], ['early_blight', 7, 'Alternaria<br>solani', 91.7], ['rust', 3, 'Puccinia<br>sp.', 96.4], ['anthracnose', 5, 'Colletotrichum<br>sp.', 88.9]];
  let ci = 0;
  function paintHero() {
    const r = hero.getBoundingClientRect(); const k = Math.min(2, devicePixelRatio || 1);
    const [id, seed, name, conf] = CYCLE[ci];
    mount(hero, id, seed, Math.max(60, Math.round(r.width * k * 0.9)), Math.max(80, Math.round(r.height * k * 0.9)), 'hero');
    $('#read-name').innerHTML = name;
    const t0 = performance.now(); const from = 40 + Math.random() * 20;
    const tick = (now) => { const p = Math.min(1, (now - t0) / 1400); $('#read-conf').textContent = (from + (conf - from) * (1 - Math.pow(1 - p, 3))).toFixed(1) + '%'; if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    $('#ms').textContent = 22 + Math.round(Math.random() * 12);
    $('#specimen-no').textContent = 'SG-0' + (4800 + Math.round(Math.random() * 400));
  }
  paintHero();
  if (!reduce) setInterval(() => { ci = (ci + 1) % CYCLE.length; paintHero(); }, 6200);
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(paintHero, 250); });

  /* ---------- intro loader (once per session) ---------- */
  const start = () => document.documentElement.classList.add('is-ready');
  (() => {
    const loader = $('.loader');
    let seen = false; try { seen = !!sessionStorage.getItem('agra.intro'); } catch { /* storage blocked */ }
    if (reduce || seen) { loader.remove(); requestAnimationFrame(start); return; }
    const names = KB.DISEASES.map((d) => d.scientific.split(' (')[0].split(' / ')[0]);
    const t0 = performance.now(); const dur = 1500;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
      $('#count').textContent = Math.round(e * 100);
      const k = Math.floor(e * (names.length - 1));
      $('#names').innerHTML = names.slice(Math.max(0, k - 3), k + 1).map((n, i, a) => (i === a.length - 1 ? `<b>${n}</b>` : n)).join('<br>');
      if (p < 1) return requestAnimationFrame(step);
      loader.classList.add('done'); setTimeout(start, 250); setTimeout(() => loader.remove(), 1300);
      try { sessionStorage.setItem('agra.intro', '1'); } catch { /* private mode */ }
    };
    requestAnimationFrame(step);
  })();

  /* ---------- magnetic seal + plate parallax ---------- */
  const seal = $('.seal'); const plateEl = $('#plate');
  const mag = { x: 0, y: 0, tx: 0, ty: 0 }; const par = { x: 0, y: 0, tx: 0, ty: 0 };
  if (fine && !reduce) {
    seal.addEventListener('pointermove', (e) => { const b = seal.getBoundingClientRect(); mag.tx = (e.clientX - b.left - b.width / 2) * 0.35; mag.ty = (e.clientY - b.top - b.height / 2) * 0.35; });
    seal.addEventListener('pointerleave', () => { mag.tx = 0; mag.ty = 0; });
    addEventListener('pointermove', (e) => { par.tx = (e.clientX / innerWidth - 0.5) * -24; par.ty = (e.clientY / innerHeight - 0.5) * -18; }, { passive: true });
  }

  /* ---------- outbreak ticker (live from the API, falls back to demo data) ---------- */
  const FALLBACK = [['Singapore', 'powdery_mildew', 7], ['Jakarta', 'bacterial_blight', 9], ['Denpasar', 'anthracnose', 6], ['Kuala Lumpur', 'rust', 5], ['Bangkok', 'late_blight', 11]];
  function fillTicker(rows) {
    const html = rows.map(([place, id, n]) => `${place} · ${KB.disease(id)?.name.split(' (')[0] || id} · <b>${n} cases</b>`).join('  —  ');
    $('#ticker').innerHTML = `${html}  —  ${html}  —  `;
  }
  fillTicker(FALLBACK);
  fetch('/api/outbreaks').then((r) => (r.ok ? r.json() : Promise.reject())).then((obs) => {
    if (Array.isArray(obs) && obs.length) fillTicker(obs.slice(0, 8).map((o) => [`${o.center.lat.toFixed(2)}°, ${o.center.lng.toFixed(2)}°`, o.diseaseId, o.count]));
  }).catch(() => {});
  const clock = () => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' local'; };
  clock(); setInterval(clock, 30000);

  /* ---------- specimen index: vertical list, hover reveal via data-plate (app.js) ---------- */
  const SPECS = ['powdery_mildew', 'early_blight', 'late_blight', 'rust', 'mosaic_virus', 'bacterial_blight', 'anthracnose', 'downy_mildew', 'leaf_spot', 'nutrient_deficiency', 'healthy'];
  $('#si-list').innerHTML = SPECS.map((id) => {
    const d = KB.disease(id); const t = KB.PATHOGEN_TYPES[d.type];
    return `<li data-reveal style="--rx:${SPECS.indexOf(id) % 2 ? 30 : -30}px"><a href="scanner.html" data-plate="${id}" data-cursor="scan">
      <span class="si-name">${d.name.split(' (')[0].split(' / ')[0]}</span>
      <span class="si-latin">${d.scientific.split(' (')[0]}</span>
      <span class="si-type">${t.label.split(' (')[0]}</span>
      <span class="si-speed"><i style="--w:${d.spreadSpeed * 20}%"></i>Spread ${d.spreadSpeed}/5</span>
      <span class="si-thumb" data-id="${id}"></span></a></li>`;
  }).join('');
  if (!fine) $$('.si-thumb').forEach((el, i) => el.appendChild(S.plate(el.dataset.id, 40 + i, 152, 192, 1.1)));

  /* ---------- asymmetric reveals ---------- */
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal]').forEach((el) => io.observe(el));

  /* ---------- easing loop ---------- */
  function loop() {
    mag.x = lerp(mag.x, mag.tx, 0.15); mag.y = lerp(mag.y, mag.ty, 0.15);
    seal.style.translate = `${mag.x}px ${mag.y}px`;
    par.x = lerp(par.x, par.tx, 0.06); par.y = lerp(par.y, par.ty, 0.06);
    hero.style.translate = `${par.x}px ${par.y + scrollY * -0.08}px`;
    plateEl.style.opacity = String(Math.max(0, 1 - scrollY / (innerHeight * 0.9)));
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
