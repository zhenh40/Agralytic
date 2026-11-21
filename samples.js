/*
 * Procedural leaf generator.
 * Renders realistic-looking synthetic leaves for 11 conditions. Used for:
 *  - demo samples in the Bio-Scanner (judges can test without a sick plant),
 *  - quiz images, wiki cards,
 *  - the synthetic training/benchmark dataset of the Diagnostics Lab.
 */
(function () {
  'use strict';
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const BACKGROUNDS = ['#f4f1ea', '#ffffff', '#e9e4d8', '#d9d4c8', '#cfd6d0', '#5b4632', '#3e3226', '#c8a27e', '#b9c2c8', '#efe8dd'];

  function leafPath(ctx, cx, cy, L, W, wobble) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - L / 2);
    ctx.bezierCurveTo(cx + W * (0.75 + wobble), cy - L * 0.32, cx + W * 0.62, cy + L * 0.28, cx, cy + L / 2);
    ctx.bezierCurveTo(cx - W * 0.62, cy + L * 0.28, cx - W * (0.75 - wobble), cy - L * 0.32, cx, cy - L / 2);
    ctx.closePath();
  }

  function blob(ctx, x, y, r, rand, points = 9, jag = 0.35) {
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      const rr = r * (1 - jag / 2 + rand() * jag);
      const px = x + Math.cos(a) * rr; const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function randomPointInLeaf(rand, cx, cy, L, W) {
    const t = rand() * 2 - 1; // along length
    const halfW = W * 0.5 * Math.sqrt(Math.max(0, 1 - t * t)) * 0.95;
    return [cx + (rand() * 2 - 1) * halfW, cy + t * L * 0.44];
  }

  /**
   * draw(canvas, diseaseId, seed, {size, augment})
   * augment=true randomises background, lighting, rotation and blur (used for training data).
   */
  function draw(canvas, diseaseId, seed = 1, opts = {}) {
    const size = opts.size || 256;
    const augment = opts.augment !== false;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rand = rng(seed * 7919 + diseaseId.length * 104729);
    const s = size;

    // Background
    ctx.fillStyle = augment ? BACKGROUNDS[Math.floor(rand() * BACKGROUNDS.length)] : '#f4f1ea';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(0,0,0,${rand() * 0.04})`; ctx.fillRect(rand() * s, rand() * s, 2, 2); }

    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(augment ? (rand() - 0.5) * 1.6 : -0.35);
    const scale = augment ? 0.78 + rand() * 0.3 : 0.92;
    ctx.scale(scale, scale);
    ctx.translate(-s / 2, -s / 2);

    const cx = s / 2; const cy = s / 2; const L = s * 0.86; const W = s * (0.42 + rand() * 0.14);
    const wobble = (rand() - 0.5) * 0.12;

    // Leaf base colour
    let hue = 105 + rand() * 25; let sat = 45 + rand() * 20; let lit = 30 + rand() * 10;
    if (diseaseId === 'nutrient_deficiency') { hue = 52 + rand() * 8; sat = 62 + rand() * 15; lit = 52 + rand() * 8; }
    leafPath(ctx, cx, cy, L, W, wobble);
    const grad = ctx.createLinearGradient(cx - W / 2, cy - L / 2, cx + W / 2, cy + L / 2);
    grad.addColorStop(0, `hsl(${hue + 6},${sat}%,${lit + 8}%)`);
    grad.addColorStop(1, `hsl(${hue - 4},${sat}%,${lit - 4}%)`);
    ctx.fillStyle = grad; ctx.fill();
    ctx.save();
    ctx.clip();

    // texture
    for (let i = 0; i < 900; i++) {
      const [x, y] = randomPointInLeaf(rand, cx, cy, L, W);
      ctx.fillStyle = `hsla(${hue + (rand() - 0.5) * 20},${sat}%,${lit + (rand() - 0.5) * 14}%,0.35)`;
      ctx.fillRect(x, y, 2 + rand() * 3, 2 + rand() * 3);
    }

    // veins
    const veinCol = diseaseId === 'nutrient_deficiency' ? `hsl(${110 + rand() * 15},50%,34%)` : `hsla(${hue - 10},40%,${lit + 22}%,0.75)`;
    const drawVeins = (col, wMid) => {
      ctx.strokeStyle = col; ctx.lineCap = 'round';
      ctx.lineWidth = wMid; ctx.beginPath(); ctx.moveTo(cx, cy + L / 2); ctx.quadraticCurveTo(cx + W * 0.04, cy, cx, cy - L / 2); ctx.stroke();
      ctx.lineWidth = wMid * 0.45;
      for (let i = 1; i < 8; i++) {
        const y0 = cy + L / 2 - (i * L) / 8.2;
        [-1, 1].forEach((dir) => { ctx.beginPath(); ctx.moveTo(cx, y0); ctx.quadraticCurveTo(cx + dir * W * 0.25, y0 - L * 0.05, cx + dir * W * 0.46, y0 - L * 0.13); ctx.stroke(); });
      }
    };
    drawVeins(veinCol, s * (diseaseId === 'nutrient_deficiency' ? 0.022 : 0.012));

    const P = () => randomPointInLeaf(rand, cx, cy, L, W);
    switch (diseaseId) {
      case 'powdery_mildew': {
        const n = 7 + Math.floor(rand() * 9);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const r = s * (0.04 + rand() * 0.08);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, 'rgba(250,250,245,0.95)'); g.addColorStop(0.6, 'rgba(238,240,232,0.8)'); g.addColorStop(1, 'rgba(235,238,230,0)');
          ctx.fillStyle = g; blob(ctx, x, y, r, rand, 12, 0.5); ctx.fill();
        }
        for (let i = 0; i < 260; i++) { const [x, y] = P(); ctx.fillStyle = 'rgba(245,245,240,0.7)'; ctx.fillRect(x, y, 2, 2); }
        break;
      }
      case 'early_blight': {
        const n = 4 + Math.floor(rand() * 6);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const r = s * (0.025 + rand() * 0.035);
          ctx.fillStyle = 'rgba(214,196,40,0.85)'; blob(ctx, x, y, r * 1.75, rand, 11, 0.3); ctx.fill();
          ctx.fillStyle = '#6b4423'; blob(ctx, x, y, r, rand, 10, 0.25); ctx.fill();
          ctx.strokeStyle = '#3d2613'; ctx.lineWidth = Math.max(1, s * 0.004);
          for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(x, y, (r * k) / 3.4, 0, Math.PI * 2); ctx.stroke(); }
        }
        break;
      }
      case 'late_blight': {
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const r = s * (0.12 + rand() * 0.14);
          ctx.fillStyle = 'rgba(70,82,52,0.9)'; blob(ctx, x, y, r * 1.18, rand, 14, 0.45); ctx.fill();
          ctx.fillStyle = '#3a2f1e'; blob(ctx, x, y, r, rand, 14, 0.5); ctx.fill();
          ctx.fillStyle = 'rgba(25,20,12,0.6)'; blob(ctx, x + r * 0.1, y, r * 0.55, rand, 10, 0.5); ctx.fill();
        }
        break;
      }
      case 'leaf_spot': {
        const n = 25 + Math.floor(rand() * 40);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const r = s * (0.008 + rand() * 0.012);
          ctx.fillStyle = '#4a2c17'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#b3a38a'; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'rust': {
        for (let i = 0; i < 60; i++) { const [x, y] = P(); ctx.fillStyle = 'rgba(220,200,60,0.45)'; ctx.beginPath(); ctx.arc(x, y, s * 0.02, 0, 6.3); ctx.fill(); }
        const n = 40 + Math.floor(rand() * 60);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const r = s * (0.006 + rand() * 0.01);
          ctx.fillStyle = rand() > 0.3 ? '#e8731a' : '#c2410c'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,170,60,0.9)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, 6.3); ctx.fill();
        }
        break;
      }
      case 'bacterial_blight': {
        ctx.save();
        const segs = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < segs; k++) {
          const t = rand() * 2 - 1; const side = rand() > 0.5 ? 1 : -1;
          const halfW = W * 0.5 * Math.sqrt(1 - t * t);
          const x = cx + side * halfW * 0.98; const y = cy + t * L * 0.44; const r = s * (0.08 + rand() * 0.08);
          ctx.fillStyle = 'rgba(206,190,70,0.92)'; blob(ctx, x, y, r * 1.3, rand, 12, 0.4); ctx.fill();
          ctx.fillStyle = '#9c7a3c'; blob(ctx, x, y, r * 0.85, rand, 12, 0.4); ctx.fill();
        }
        // tip lesion
        ctx.fillStyle = 'rgba(206,190,70,0.92)'; blob(ctx, cx, cy - L * 0.46, s * 0.12, rand, 12, 0.3); ctx.fill();
        ctx.fillStyle = '#a07c40'; blob(ctx, cx, cy - L * 0.48, s * 0.08, rand, 12, 0.3); ctx.fill();
        ctx.restore();
        break;
      }
      case 'mosaic_virus': {
        const n = 12 + Math.floor(rand() * 10);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const r = s * (0.03 + rand() * 0.06);
          ctx.fillStyle = `hsla(${56 + rand() * 10},${70 + rand() * 15}%,${55 + rand() * 10}%,0.85)`; blob(ctx, x, y, r, rand, 10, 0.6); ctx.fill();
        }
        for (let i = 0; i < 8; i++) { const [x, y] = P(); ctx.fillStyle = `hsla(${hue},${sat + 10}%,${lit - 10}%,0.7)`; blob(ctx, x, y, s * 0.04, rand, 8, 0.6); ctx.fill(); }
        break;
      }
      case 'downy_mildew': {
        const n = 5 + Math.floor(rand() * 6);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const w = s * (0.05 + rand() * 0.06); const h = s * (0.04 + rand() * 0.05);
          ctx.fillStyle = 'rgba(214,200,72,0.9)';
          ctx.beginPath(); ctx.moveTo(x - w, y - h); ctx.lineTo(x + w, y - h * 0.8); ctx.lineTo(x + w * 0.9, y + h); ctx.lineTo(x - w * 0.8, y + h * 0.9); ctx.closePath(); ctx.fill();
          if (rand() > 0.4) { ctx.fillStyle = 'rgba(120,92,50,0.85)'; ctx.fillRect(x - w * 0.4, y - h * 0.4, w * 0.8, h * 0.8); }
        }
        break;
      }
      case 'anthracnose': {
        const n = 3 + Math.floor(rand() * 5);
        for (let i = 0; i < n; i++) {
          const [x, y] = P(); const r = s * (0.025 + rand() * 0.04);
          ctx.fillStyle = 'rgba(90,60,30,0.9)'; blob(ctx, x, y, r * 1.25, rand, 10, 0.45); ctx.fill();
          ctx.fillStyle = '#1c130b'; blob(ctx, x, y, r, rand, 10, 0.5); ctx.fill();
          if (rand() > 0.5) { ctx.fillStyle = 'rgba(232,140,110,0.8)'; ctx.beginPath(); ctx.arc(x, y, r * 0.25, 0, 6.3); ctx.fill(); }
        }
        ctx.fillStyle = '#20150c'; blob(ctx, cx, cy - L * 0.47, s * 0.07, rand, 10, 0.4); ctx.fill();
        break;
      }
      case 'nutrient_deficiency': {
        for (let i = 0; i < 14; i++) { const [x, y] = P(); ctx.fillStyle = `hsla(${50 + rand() * 8},80%,${58 + rand() * 10}%,0.45)`; blob(ctx, x, y, s * 0.08, rand, 10, 0.5); ctx.fill(); }
        drawVeins(veinCol, s * 0.02);
        break;
      }
      default: break;
    }
    ctx.restore(); // clip
    // leaf edge
    leafPath(ctx, cx, cy, L, W, wobble);
    ctx.strokeStyle = 'rgba(20,50,20,0.35)'; ctx.lineWidth = s * 0.006; ctx.stroke();
    // stem
    ctx.strokeStyle = `hsl(${hue - 10},40%,28%)`; ctx.lineWidth = s * 0.018; ctx.beginPath(); ctx.moveTo(cx, cy + L / 2); ctx.lineTo(cx + s * 0.02, cy + L / 2 + s * 0.08); ctx.stroke();
    ctx.restore();

    if (augment) {
      // lighting gradient + brightness jitter + slight blur
      const lg = ctx.createLinearGradient(rand() * s, 0, rand() * s, s);
      const b = (rand() - 0.5) * 0.35;
      lg.addColorStop(0, b > 0 ? `rgba(255,255,255,${b * 0.6})` : `rgba(0,0,0,${-b * 0.6})`);
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg; ctx.fillRect(0, 0, s, s);
      if (rand() > 0.5 && 'filter' in ctx) { const tmp = document.createElement('canvas'); tmp.width = s; tmp.height = s; tmp.getContext('2d').drawImage(canvas, 0, 0); ctx.filter = `blur(${(rand() * 1.4).toFixed(2)}px)`; ctx.drawImage(tmp, 0, 0); ctx.filter = 'none'; }
    }
    return canvas;
  }


  /* Duotone "specimen plate": macro crop of a leaf, obsidian→deep green→sand, infection lit in neon. */
  const PAL = { ob: [11, 11, 11], deep: [18, 48, 30], sand: [229, 225, 216], neon: [0, 255, 102] };
  function plate(diseaseId, seed, w, h, zoom = 1.35) {
    const src = document.createElement('canvas');
    draw(src, diseaseId, seed, { size: Math.round(Math.max(w, h) * zoom), augment: false });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, (src.width - w) / 2 + w * 0.06, (src.height - h) / 2 - h * 0.04, w, h, 0, 0, w, h);
    const im = x.getImageData(0, 0, w, h); const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0;
      let hue = 0;
      if (max !== min) { hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4; hue *= 60; if (hue < 0) hue += 360; }
      const L = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      const paper = sat < 0.12 && L > 0.85 && g - r < 8;
      const lesion = !paper && ((hue < 62 && sat > 0.22) || (sat < 0.2 && L > 0.7));
      let col;
      if (paper) col = PAL.ob;
      else if (lesion) { const k = Math.min(1, 0.55 + L * 0.5); col = [0, 255 * k, 102 * k * 0.9 + 10]; }
      else { const t = Math.pow(L, 1.15); col = t < 0.5 ? PAL.ob.map((v, j) => v + (PAL.deep[j] - v) * (t / 0.5)) : PAL.deep.map((v, j) => v + (PAL.sand[j] - v) * ((t - 0.5) / 0.5) * 0.7); }
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
    }
    x.putImageData(im, 0, 0);
    const v = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(11,11,11,0)'); v.addColorStop(1, 'rgba(11,11,11,.75)');
    x.fillStyle = v; x.fillRect(0, 0, w, h);
    return c;
  }

  window.AgraSamples = { draw, plate, rng, LIST: ['healthy', 'powdery_mildew', 'early_blight', 'late_blight', 'leaf_spot', 'rust', 'bacterial_blight', 'mosaic_virus', 'downy_mildew', 'anthracnose', 'nutrient_deficiency'] };
})();
