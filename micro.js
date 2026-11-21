/*
 * The Microscopic Simulator (Feature #5)
 * An animated leaf cross-section showing HOW each pathogen type invades:
 *   fungal   → spore lands → germ tube → appressorium → penetration peg → hyphae + haustoria
 *   oomycete → zoospores swim in a water film → enter stomata → hyphae → sporangiophores exit
 *   bacterial→ rods enter stomata → multiply in intercellular spaces → cells collapse
 *   viral    → aphid stylet injects virions → spread cell-to-cell through plasmodesmata
 *   abiotic  → no invader; chloroplasts fade because nutrients are missing
 * Progress (0–100) is controllable with a slider; photosynthesis output is computed live.
 */
(function () {
  'use strict';
  const STAGES = {
    fungal: [[0, 'Healthy tissue', 'Chloroplasts in the <b>palisade cells</b> capture sunlight.'], [12, 'Spore landing', 'A wind-blown <b>spore</b> lands on the waxy cuticle.'], [25, 'Germination', 'With warmth and humidity the spore grows a <b>germ tube</b>.'], [38, 'Penetration', 'An <b>appressorium</b> presses a peg through the cell wall.'], [55, 'Colonisation', '<b>Hyphae</b> spread between cells and insert <b>haustoria</b> to steal sugars.'], [78, 'Collapse', 'Chloroplasts die → the leaf turns yellow/brown. New spores are released.']],
    oomycete: [[0, 'Healthy tissue', 'Stomata on the underside let CO₂ in.'], [12, 'Water film', 'Rain leaves a film of water — the highway for <b>zoospores</b>.'], [28, 'Swimming', 'Zoospores swim with two flagella toward the <b>stomata</b>.'], [42, 'Invasion', 'They encyst and grow hyphae through the stomatal opening.'], [60, 'Spread', 'Hyphae race through the spongy mesophyll — tissue becomes water-soaked.'], [80, 'Sporulation', '<b>Sporangiophores</b> exit the stomata: grey fuzz under the leaf.']],
    bacterial: [[0, 'Healthy tissue', 'Bacteria cannot pierce the cuticle…'], [14, 'Entry', '…so they enter through <b>stomata</b>, wounds and hydathodes with rain splash.'], [32, 'Multiplication', 'They divide every ~30 min in the water between cells.'], [55, 'Toxins & enzymes', 'Enzymes dissolve cell walls → <b>water-soaked</b> lesions.'], [78, 'Necrosis', 'Cells collapse; bacterial ooze spreads to the next leaf.']],
    viral: [[0, 'Healthy tissue', 'Each cell is connected to its neighbours by tiny channels: <b>plasmodesmata</b>.'], [12, 'Vector feeding', 'An <b>aphid</b> inserts its stylet into a cell.'], [26, 'Infection', '<b>Virions</b> are injected and hijack the cell to copy themselves.'], [45, 'Cell-to-cell spread', 'Movement proteins push the virus through plasmodesmata.'], [70, 'Mosaic', 'Infected cells lose chlorophyll unevenly → <b>mosaic pattern</b>.']],
    abiotic: [[0, 'Healthy tissue', 'Chlorophyll needs nitrogen, magnesium and iron.'], [25, 'Deficiency', 'Roots cannot supply enough nutrients.'], [55, 'Chlorosis', 'Chloroplasts break down → yellow tissue. <b>No germ involved — not contagious.</b>'], [80, 'Recovery possible', 'Feeding the soil restores green colour in new leaves.']],
    none: [[0, 'Healthy tissue', 'A healthy leaf: chloroplasts convert sunlight, water and CO₂ into sugar and oxygen.']]
  };

  function create(canvas, { type = 'fungal', onUpdate } = {}) {
    const ctx = canvas.getContext('2d');
    const W = 960, H = 540; canvas.width = W; canvas.height = H;
    const rand = window.AgraSamples.rng(42);
    let progress = 0; let playing = false; let last = 0; let raf = null; let t = 0;

    // Build tissue geometry
    const cuticleY = 70, epiY = 78, epiH = 40, palY = 122, palH = 150, spY = 278, spH = 170, lowY = 452, lowH = 36;
    const epi = [], pal = [], spg = [], low = [], stomata = [];
    for (let x = 10; x < W - 10;) { const w = 54 + rand() * 18; epi.push({ x, y: epiY, w: w - 4, h: epiH }); x += w; }
    for (let x = 14; x < W - 14;) { const w = 30 + rand() * 8; pal.push({ x, y: palY, w: w - 5, h: palH - rand() * 14, chl: Array.from({ length: 9 }, () => [rand(), rand()]) }); x += w; }
    for (let i = 0; i < 34; i++) spg.push({ x: 40 + rand() * (W - 80), y: spY + 20 + rand() * (spH - 40), r: 22 + rand() * 12, chl: Array.from({ length: 5 }, () => [rand() * 6.28, rand()]) });
    for (let x = 10; x < W - 10;) { const w = 58 + rand() * 14; low.push({ x, y: lowY, w: w - 4, h: lowH }); x += w; }
    [200, 480, 760].forEach((x) => stomata.push({ x, y: lowY + lowH / 2 }));
    const entry = { x: 470, y: cuticleY };
    // infection order: cells sorted by distance from entry point
    const allCells = [...pal.map((c) => ({ c, cx: c.x + c.w / 2, cy: c.y + c.h / 2 })), ...spg.map((c) => ({ c, cx: c.x, cy: c.y }))];
    const origin = type === 'oomycete' || type === 'bacterial' ? { x: stomata[1].x, y: lowY } : entry;
    allCells.forEach((o) => { o.d = Math.hypot(o.cx - origin.x, o.cy - origin.y) + rand() * 60; });
    const maxD = Math.max(...allCells.map((o) => o.d));
    const hyphae = Array.from({ length: 14 }, () => { const pts = [[origin.x, origin.y + (origin.y < 200 ? 10 : -10)]]; let a = origin.y < 200 ? Math.PI / 2 : -Math.PI / 2; for (let i = 0; i < 26; i++) { a += (rand() - 0.5) * 0.9; const [px, py] = pts[pts.length - 1]; pts.push([Math.max(20, Math.min(W - 20, px + Math.cos(a) * 18)), Math.max(palY, Math.min(lowY, py + Math.sin(a) * 14))]); } return pts; });
    const bacteria = Array.from({ length: 160 }, () => ({ x: origin.x + (rand() - 0.5) * 40, y: lowY - 10, tx: 60 + rand() * (W - 120), ty: spY + rand() * spH, a: rand() * 6.28, born: rand() }));
    const zoos = Array.from({ length: 10 }, (_, i) => ({ x: 300 + i * 40, y: H - 22, ph: rand() * 6 }));

    function infectionOf(o) { // 0..1 for a given cell
      const start = (type === 'abiotic') ? 0.2 : 0.38;
      if (type === 'none') return 0;
      const p = progress / 100;
      if (type === 'abiotic') return Math.max(0, Math.min(1, (p - start) / 0.5));
      const reach = (p - start) / (1 - start) * maxD * 1.2;
      return Math.max(0, Math.min(1, (reach - o.d) / 120));
    }
    function cellFill(inf, base) {
      // healthy green → yellow → brown
      const g = [70, 160, 70], y = [210, 196, 70], b = [110, 80, 45];
      const mix = (a, c, k) => a.map((v, i) => v + (c[i] - v) * k);
      const col = inf < 0.5 ? mix(g, y, inf * 2) : mix(y, b, (inf - 0.5) * 2);
      return `rgba(${col.map((v) => v | 0).join(',')},${base})`;
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0c2216'); bg.addColorStop(1, '#03110a');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // sunlight
      ctx.fillStyle = 'rgba(253,224,71,0.07)';
      for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(80 + i * 130, 0); ctx.lineTo(120 + i * 130, 0); ctx.lineTo(60 + i * 130, cuticleY); ctx.lineTo(30 + i * 130, cuticleY); ctx.fill(); }
      // labels
      ctx.font = '600 13px Plus Jakarta Sans, sans-serif'; ctx.fillStyle = 'rgba(220,252,231,.65)';
      [['Cuticle', cuticleY - 6], ['Upper epidermis', epiY + 24], ['Palisade mesophyll', palY + 80], ['Spongy mesophyll', spY + 90], ['Lower epidermis + stomata', lowY + 24]].forEach(([l, y]) => ctx.fillText(l, W - 200, y));
      // cuticle
      ctx.fillStyle = 'rgba(190,242,100,.35)'; ctx.fillRect(0, cuticleY, W, 8);
      // epidermis
      epi.forEach((c) => { ctx.fillStyle = 'rgba(167,243,208,.16)'; ctx.strokeStyle = 'rgba(167,243,208,.5)'; roundRect(c.x, c.y, c.w, c.h, 8); ctx.fill(); ctx.stroke(); });
      // palisade
      const pulse = 0.5 + 0.5 * Math.sin(t * 2);
      let healthy = 0, total = 0;
      pal.forEach((c, i) => {
        const inf = infectionOf(allCells[i]);
        healthy += 1 - inf; total++;
        ctx.fillStyle = cellFill(inf, 0.28); ctx.strokeStyle = cellFill(inf, 0.8); ctx.lineWidth = 1.5;
        roundRect(c.x, c.y, c.w, c.h, 12); ctx.fill(); ctx.stroke();
        c.chl.forEach(([u, v], k) => {
          const x = c.x + 6 + u * (c.w - 12); const y = c.y + 10 + v * (c.h - 20) + Math.sin(t * 1.5 + k + i) * 2;
          ctx.fillStyle = cellFill(Math.min(1, inf * 1.2), 0.95); ctx.beginPath(); ctx.ellipse(x, y, 5, 3.4, 0.4, 0, 6.3); ctx.fill();
          if (inf < 0.3) { ctx.fillStyle = `rgba(253,224,71,${0.25 * pulse * (1 - inf)})`; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.3); ctx.fill(); }
        });
      });
      // spongy
      spg.forEach((c, i) => {
        const inf = infectionOf(allCells[pal.length + i]);
        healthy += 1 - inf; total++;
        ctx.fillStyle = cellFill(inf, 0.22); ctx.strokeStyle = cellFill(inf, 0.7);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r, c.r * 0.8, 0, 0, 6.3); ctx.fill(); ctx.stroke();
        c.chl.forEach(([a, r]) => { ctx.fillStyle = cellFill(inf, 0.9); ctx.beginPath(); ctx.arc(c.x + Math.cos(a + t * 0.2) * c.r * 0.55 * r, c.y + Math.sin(a + t * 0.2) * c.r * 0.45 * r, 3.5, 0, 6.3); ctx.fill(); });
      });
      // lower epidermis + stomata
      low.forEach((c) => { ctx.fillStyle = 'rgba(167,243,208,.14)'; ctx.strokeStyle = 'rgba(167,243,208,.45)'; roundRect(c.x, c.y, c.w, c.h, 8); ctx.fill(); ctx.stroke(); });
      stomata.forEach((s) => { ctx.fillStyle = '#03110a'; ctx.beginPath(); ctx.ellipse(s.x, s.y, 12, 8, 0, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#86efac'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(s.x - 7, s.y, 6, 10, 0, 0, 6.3); ctx.ellipse(s.x + 7, s.y, 6, 10, 0, 0, 6.3); ctx.stroke(); });
      ctx.lineWidth = 1.5;

      const p = progress;
      if (type === 'fungal') drawFungal(p); else if (type === 'oomycete') drawOomycete(p); else if (type === 'bacterial') drawBacteria(p); else if (type === 'viral') drawVirus(p);
      const photosynthesis = Math.round((healthy / total) * 100);
      onUpdate && onUpdate({ progress: p, photosynthesis, stage: stageFor(p) });
    }

    function drawFungal(p) {
      if (p < 8) return;
      const sx = entry.x, sy = entry.y - 26 + Math.min(1, (p - 8) / 6) * 14;
      ctx.fillStyle = '#e9d5ff'; ctx.beginPath(); ctx.ellipse(sx, Math.min(sy, entry.y - 12), 14, 10, 0.3, 0, 6.3); ctx.fill();
      if (p > 22) { ctx.strokeStyle = '#d8b4fe'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx + 10, entry.y - 10); const k = Math.min(1, (p - 22) / 12); ctx.quadraticCurveTo(sx + 30, entry.y - 22, sx + 10 + 40 * k, entry.y - 4); ctx.stroke(); }
      if (p > 34) { ctx.fillStyle = '#c084fc'; ctx.beginPath(); ctx.arc(sx + 50, entry.y - 2, 8, 0, 6.3); ctx.fill(); }
      if (p > 40) {
        const k = Math.min(1, (p - 40) / 50);
        ctx.strokeStyle = 'rgba(216,180,254,.9)'; ctx.lineWidth = 2.5;
        hyphae.forEach((h, i) => { const n = Math.floor(h.length * k * (0.6 + (i % 4) * 0.12)); if (n < 2) return; ctx.beginPath(); ctx.moveTo(sx + 50, entry.y); for (let j = 1; j < n; j++) ctx.lineTo(h[j][0] + (sx + 50 - entry.x), h[j][1]); ctx.stroke(); });
        if (p > 55) { ctx.fillStyle = '#a855f7'; pal.forEach((c, i) => { if (i % 3 === 0 && infectionOf(allCells[i]) > 0.3) { ctx.beginPath(); ctx.arc(c.x + c.w / 2, c.y + 30, 5 + Math.sin(t * 3 + i) * 1.5, 0, 6.3); ctx.fill(); } }); }
      }
      if (p > 80) { for (let i = 0; i < 18; i++) { const a = t * 0.8 + i; ctx.fillStyle = 'rgba(233,213,255,.8)'; ctx.beginPath(); ctx.arc(sx + 50 + Math.cos(i) * 80 + Math.sin(a) * 10, entry.y - 30 - ((t * 30 + i * 20) % 60), 4, 0, 6.3); ctx.fill(); } }
    }
    function drawOomycete(p) {
      if (p > 8) { ctx.fillStyle = `rgba(56,189,248,${Math.min(0.35, (p - 8) / 30)})`; ctx.fillRect(0, lowY + lowH, W, H - lowY - lowH); }
      if (p > 20 && p < 60) zoos.forEach((z, i) => {
        const k = Math.min(1, (p - 20) / 24); const s = stomata[i % 3];
        const x = z.x + (s.x - z.x) * k + Math.sin(t * 6 + z.ph) * 5; const y = z.y + (s.y + 14 - z.y) * k;
        ctx.fillStyle = '#7dd3fc'; ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, 0, 6.3); ctx.fill();
        ctx.strokeStyle = '#bae6fd'; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x - 16, y + Math.sin(t * 10 + i) * 6, x - 24, y); ctx.stroke();
      });
      if (p > 40) {
        const k = Math.min(1, (p - 40) / 45); ctx.strokeStyle = 'rgba(125,211,252,.85)'; ctx.lineWidth = 2.5;
        hyphae.forEach((h, i) => { const s = stomata[i % 3]; const n = Math.floor(h.length * k); if (n < 2) return; ctx.beginPath(); ctx.moveTo(s.x, lowY); for (let j = 1; j < n; j++) ctx.lineTo(h[j][0] - origin.x + s.x, h[j][1]); ctx.stroke(); });
      }
      if (p > 78) stomata.forEach((s) => { ctx.strokeStyle = '#e0f2fe'; ctx.lineWidth = 2; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + k * 12, s.y + 34); ctx.stroke(); ctx.fillStyle = '#f0f9ff'; ctx.beginPath(); ctx.arc(s.x + k * 12, s.y + 36, 4, 0, 6.3); ctx.fill(); } });
    }
    function drawBacteria(p) {
      if (p < 10) return;
      const k = Math.min(1, (p - 10) / 70); const n = Math.floor(bacteria.length * Math.min(1, k * k * 1.4 + 0.05));
      for (let i = 0; i < n; i++) {
        const b = bacteria[i]; const m = Math.min(1, k * 1.3 + b.born * 0.2);
        const x = b.x + (b.tx - b.x) * m + Math.sin(t * 2 + i) * 2; const y = b.y + (b.ty - b.y) * m;
        ctx.save(); ctx.translate(x, y); ctx.rotate(b.a + t * 0.3); ctx.fillStyle = '#fdba74'; roundRect(-6, -2.5, 12, 5, 2.5); ctx.fill(); ctx.restore();
      }
      if (p > 50) { ctx.fillStyle = `rgba(254,215,170,${(p - 50) / 200})`; ctx.fillRect(0, spY, W, spH); }
    }
    function drawVirus(p) {
      if (p > 6 && p < 40) { // aphid
        const ax = entry.x + 40, ay = entry.y - 46;
        ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.ellipse(ax, ay, 34, 20, 0, 0, 6.3); ctx.fill();
        ctx.fillStyle = '#166534'; ctx.beginPath(); ctx.arc(ax - 30, ay, 10, 0, 6.3); ctx.fill();
        ctx.strokeStyle = '#bbf7d0'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(ax - 14 + i * 14, ay + 16); ctx.lineTo(ax - 20 + i * 16, ay + 30); ctx.stroke(); }
        const k = Math.min(1, (p - 6) / 12); ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(ax - 36, ay + 6); ctx.lineTo(ax - 36 - 4 * k, ay + 6 + 80 * k); ctx.stroke();
      }
      if (p > 24) {
        pal.forEach((c, i) => {
          const inf = infectionOf(allCells[i]); if (inf <= 0) return;
          for (let k = 0; k < Math.ceil(inf * 6); k++) { ctx.fillStyle = '#f87171'; const x = c.x + 6 + ((k * 37 + i * 13) % (c.w - 12)); const y = c.y + 20 + ((k * 53 + i * 7) % (c.h - 40)); ctx.beginPath(); for (let s = 0; s < 6; s++) { const a = (s / 6) * 6.283; ctx.lineTo(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5); } ctx.fill(); }
        });
      }
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function stageFor(p) { const st = STAGES[type] || STAGES.none; let cur = st[0]; st.forEach((s) => { if (p >= s[0]) cur = s; }); return { title: cur[1], text: cur[2] }; }

    function loop(now) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
      if (playing) { progress = Math.min(100, progress + dt * 6); if (progress >= 100) playing = false; }
      draw();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return {
      set progress(v) { progress = v; }, get progress() { return progress; },
      play() { if (progress >= 100) progress = 0; playing = true; }, pause() { playing = false; }, get playing() { return playing; },
      destroy() { cancelAnimationFrame(raf); }
    };
  }

  window.AgraMicro = { create, STAGES };
})();
