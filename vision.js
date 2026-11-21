/*
 * Agralytic Vision Engine — 100% on-device ("edge AI") computer vision.
 *
 * Pipeline:  RGB → HSV → pixel classes → leaf segmentation (morphological closing + hole filling
 *            + largest component) → lesion components → 18 interpretable features
 *            → FeatureNet (MLP 18→24→11, trained in-browser) → probabilities, severity, AR targets.
 * Optional:  if /model/model.json exists (TensorFlow.js MobileNetV2 fine-tuned on PlantVillage, see
 *            /training), its prediction is blended in for higher real-world accuracy.
 */
(function () {
  'use strict';
  const LABELS = ['healthy', 'powdery_mildew', 'early_blight', 'late_blight', 'leaf_spot', 'rust', 'bacterial_blight', 'mosaic_virus', 'downy_mildew', 'anthracnose', 'nutrient_deficiency'];
  const FEATURES = ['green', 'yellow', 'brown', 'dark', 'orange', 'white', 'lesion', 'spots', 'meanSpot', 'maxSpot', 'halo', 'edgeLesion', 'yellowBlobs', 'edgeYellow', 'darkShare', 'saturation', 'hue', 'coverage'];
  const SIZE = 160;
  const DEFAULTS = { satMin: 0.15, whiteSat: 0.2, whiteVal: 0.68, darkVal: 0.22, minSpot: 3, closeR: 0.07, temperature: 1 };
  // pixel classes
  const BG = 0, GREEN = 1, YELLOW = 2, BROWN = 3, DARK = 4, ORANGE = 5, WHITE = 6;
  const CLASS_COLORS = [[0, 0, 0, 0], [34, 197, 94, 255], [250, 204, 21, 255], [146, 64, 14, 255], [30, 27, 24, 255], [249, 115, 22, 255], [226, 232, 240, 255]];

  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  /* ---------------- morphology helpers ---------------- */
  function dilate(mask, w, h, r) {
    if (r <= 0) return mask.slice();
    const tmp = new Uint8Array(w * h); const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { // horizontal running count
      let c = 0; const row = y * w;
      for (let x = 0; x < Math.min(r, w); x++) c += mask[row + x];
      for (let x = 0; x < w; x++) {
        if (x + r < w) c += mask[row + x + r];
        if (x - r - 1 >= 0) c -= mask[row + x - r - 1];
        tmp[row + x] = c > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let y = 0; y < Math.min(r, h); y++) c += tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        if (y + r < h) c += tmp[(y + r) * w + x];
        if (y - r - 1 >= 0) c -= tmp[(y - r - 1) * w + x];
        out[y * w + x] = c > 0 ? 1 : 0;
      }
    }
    return out;
  }
  const invert = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };
  const erode = (m, w, h, r) => invert(dilate(invert(m), w, h, r));

  function fillHoles(mask, w, h) {
    const reach = new Uint8Array(w * h); const q = new Int32Array(w * h); let qh = 0, qt = 0;
    const push = (i) => { if (!mask[i] && !reach[i]) { reach[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (qh < qt) {
      const i = q[qh++]; const x = i % w; const y = (i / w) | 0;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = reach[i] ? 0 : 1;
    return out;
  }

  function components(mask, w, h, minSize = 1) {
    const label = new Int32Array(w * h); const q = new Int32Array(w * h); const comps = []; let next = 1;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || label[s]) continue;
      let qh = 0, qt = 0; q[qt++] = s; label[s] = next;
      let area = 0, sx = 0, sy = 0, minx = w, miny = h, maxx = 0, maxy = 0;
      while (qh < qt) {
        const i = q[qh++]; const x = i % w; const y = (i / w) | 0;
        area++; sx += x; sy += y; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of nb) if (j >= 0 && mask[j] && !label[j]) { label[j] = next; q[qt++] = j; }
      }
      if (area >= minSize) comps.push({ id: next, area, cx: sx / area, cy: sy / area, box: [minx, miny, maxx, maxy] });
      next++;
    }
    return { label, comps };
  }

  /* Chamfer distance transform (distance in px to the nearest set pixel). */
  function distanceFrom(mask, w, h) {
    const INF = 1e9; const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
    const a = 1, b = 1.4142;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) { v = Math.min(v, d[i - w] + a); if (x > 0) v = Math.min(v, d[i - w - 1] + b); if (x < w - 1) v = Math.min(v, d[i - w + 1] + b); }
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) { v = Math.min(v, d[i + w] + a); if (x < w - 1) v = Math.min(v, d[i + w + 1] + b); if (x > 0) v = Math.min(v, d[i + w - 1] + b); }
      d[i] = v;
    }
    return d;
  }

  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, max ? d / max : 0, max];
  }

  /* ---------------- feature extraction ---------------- */
  function extract(source, params = {}, size = SIZE) {
    const P = { ...DEFAULTS, ...params };
    const sw = source.videoWidth || source.naturalWidth || source.width; const sh = source.videoHeight || source.naturalHeight || source.height;
    const k = size / Math.max(sw, sh);
    const w = Math.max(8, Math.round(sw * k)); const h = Math.max(8, Math.round(sh * k));
    work.width = w; work.height = h;
    wctx.drawImage(source, 0, 0, w, h);
    const img = wctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const cls = new Uint8Array(n); const H = new Float32Array(n); const S = new Float32Array(n); const V = new Float32Array(n); const gray = new Float32Array(n);
    let sumV = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const [hh, ss, vv] = rgb2hsv(img[p], img[p + 1], img[p + 2]);
      H[i] = hh; S[i] = ss; V[i] = vv; sumV += vv; gray[i] = 0.299 * img[p] + 0.587 * img[p + 1] + 0.114 * img[p + 2];
      let c = BG;
      if (vv < P.darkVal) c = DARK;
      else if (ss < P.whiteSat && vv >= P.whiteVal) c = WHITE;
      else if (hh >= 72 && hh <= 175 && ss >= P.satMin) c = GREEN;
      else if (hh >= 42 && hh < 72 && ss >= 0.28 && vv >= 0.38) c = YELLOW;
      else if (hh >= 14 && hh < 42 && ss >= 0.58 && vv >= 0.6) c = ORANGE;
      else if ((hh < 50 || hh >= 330) && ss >= 0.2 && vv < 0.8) c = BROWN;
      cls[i] = c;
    }
    // ---- leaf segmentation ----
    const seed = new Uint8Array(n);
    for (let i = 0; i < n; i++) seed[i] = cls[i] === GREEN || cls[i] === YELLOW ? 1 : 0;
    const r = Math.max(2, Math.round(size * P.closeR));
    let leaf = fillHoles(erode(dilate(seed, w, h, r), w, h, r), w, h);
    const lc = components(leaf, w, h, 1);
    if (lc.comps.length > 1) {
      const big = lc.comps.reduce((a, b) => (b.area > a.area ? b : a));
      for (let i = 0; i < n; i++) leaf[i] = lc.label[i] === big.id ? 1 : 0;
    }
    let leafArea = 0; for (let i = 0; i < n; i++) leafArea += leaf[i];
    const la = Math.max(1, leafArea);

    // ---- class fractions inside leaf ----
    const cnt = [0, 0, 0, 0, 0, 0, 0]; let satSum = 0, hueSum = 0, hueN = 0;
    const lesion = new Uint8Array(n); const yellow = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!leaf[i]) continue;
      let c = cls[i]; if (c === BG) c = GREEN; // unclassified leaf pixel (e.g. pale green) → treat as tissue
      cnt[c]++; satSum += S[i];
      if (c === BROWN || c === DARK || c === ORANGE || c === WHITE) lesion[i] = 1;
      else { hueSum += H[i]; hueN++; }
      if (c === YELLOW) yellow[i] = 1;
    }
    const frac = cnt.map((c) => c / la);
    const lesionArea = cnt[BROWN] + cnt[DARK] + cnt[ORANGE] + cnt[WHITE];

    // ---- lesion components ----
    const lcmp = components(lesion, w, h, P.minSpot);
    const blobs = lcmp.comps.sort((a, b) => b.area - a.area);
    const spots = blobs.length;
    const meanSpot = spots ? blobs.reduce((a, b) => a + b.area, 0) / spots / la : 0;
    const maxSpot = spots ? blobs[0].area / la : 0;
    const ycmp = components(yellow, w, h, P.minSpot + 1);

    // ---- halo: lesion boundary pixels with yellow nearby ----
    const yNear = dilate(yellow, w, h, 3);
    let boundary = 0, haloHits = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (!lesion[i]) continue;
      if (!lesion[i - 1] || !lesion[i + 1] || !lesion[i - w] || !lesion[i + w]) { boundary++; if (yNear[i]) haloHits++; }
    }
    // ---- margin (edge) ratios ----
    const inner = erode(leaf, w, h, Math.max(2, Math.round(size * 0.06)));
    let edgeL = 0, edgeY = 0;
    for (let i = 0; i < n; i++) { if (leaf[i] && !inner[i]) { if (lesion[i]) edgeL++; if (yellow[i]) edgeY++; } }
    // ---- image quality ----
    let lap = 0, lapN = 0;
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x; const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lap += v * v; lapN++;
    }
    const features = {
      green: frac[GREEN], yellow: frac[YELLOW], brown: frac[BROWN], dark: frac[DARK], orange: frac[ORANGE], white: frac[WHITE],
      lesion: lesionArea / la, spots: Math.log1p(spots) / 4, meanSpot: Math.sqrt(meanSpot) * 5, maxSpot: Math.sqrt(maxSpot) * 3,
      halo: boundary ? haloHits / boundary : 0, edgeLesion: lesionArea ? edgeL / lesionArea : 0,
      yellowBlobs: Math.log1p(ycmp.comps.length) / 3, edgeYellow: cnt[YELLOW] ? edgeY / cnt[YELLOW] : 0,
      darkShare: lesionArea ? cnt[DARK] / lesionArea : 0, saturation: satSum / la, hue: hueN ? (hueSum / hueN - 40) / 100 : 0.5, coverage: leafArea / n
    };
    return {
      w, h, cls, leaf, lesion, yellow, blobs, spotCount: spots, features, vector: FEATURES.map((f) => features[f]),
      quality: { brightness: sumV / n, sharpness: lapN ? lap / lapN : 0, coverage: leafArea / n }
    };
  }

  /* ---------------- FeatureNet (tiny MLP) ---------------- */
  let model = null; // { mean, std, W1, b1, W2, b2, meta }
  function forward(m, x) {
    const z = x.map((v, i) => (v - m.mean[i]) / (m.std[i] || 1));
    const hdn = m.b1.map((b, j) => { let s = b; for (let i = 0; i < z.length; i++) s += m.W1[j][i] * z[i]; return s > 0 ? s : 0.01 * s; });
    const out = m.b2.map((b, k) => { let s = b; for (let j = 0; j < hdn.length; j++) s += m.W2[k][j] * hdn[j]; return s; });
    return { z, hdn, out };
  }
  function softmax(a, T = 1) { const m = Math.max(...a); const e = a.map((v) => Math.exp((v - m) / T)); const s = e.reduce((x, y) => x + y, 0); return e.map((v) => v / s); }

  /* Rule-based prior used only if no trained weights can be loaded (keeps the app usable). */
  function rulePrior(f) {
    const s = {
      healthy: 3 - 40 * f.lesion - 12 * f.yellow,
      powdery_mildew: 60 * f.white - 2,
      early_blight: 18 * f.brown + 5 * f.halo + (f.meanSpot > 0.3 ? 1.5 : -1) - 20 * f.white,
      late_blight: 12 * (f.brown + f.dark) + (f.maxSpot > 0.7 ? 3 : -1) - 15 * f.white,
      leaf_spot: 12 * f.brown + (f.spots > 0.7 ? 2.5 : -1.5) - 20 * f.white,
      rust: 70 * f.orange - 1,
      bacterial_blight: 6 * f.edgeLesion + 8 * f.yellow * f.edgeYellow - 3,
      mosaic_virus: 12 * f.yellow + (f.yellowBlobs > 0.6 ? 2 : -1) - 30 * f.lesion,
      downy_mildew: 8 * f.yellow + 6 * f.brown - 2,
      anthracnose: 30 * f.dark + 4 * f.darkShare - 3,
      nutrient_deficiency: 14 * f.yellow + (f.yellow > 0.35 ? 3 : -2) - 25 * f.lesion
    };
    return LABELS.map((l) => s[l]);
  }

  async function loadModel() {
    const custom = window.Agra?.store.get('featurenet');
    if (custom) { model = custom; return model; }
    try { const r = await fetch('featurenet.json'); if (r.ok) model = await r.json(); } catch { /* offline & uncached */ }
    return model;
  }
  function setModel(m, persist = false) { model = m; if (persist) window.Agra?.store.set('featurenet', m); }

  /* ---------------- Optional TensorFlow.js deep model ---------------- */
  const tfState = { checked: false, model: null, labels: null };
  async function loadTF() {
    if (tfState.checked) return tfState.model;
    tfState.checked = true;
    try {
      const st = await (await fetch('/api/model/status')).json();
      if (!st.tfjsModel) return null;
      if (!window.tf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      tfState.labels = await (await fetch('labels.json')).json();
      tfState.model = await window.tf.loadLayersModel('model.json').catch(() => window.tf.loadGraphModel('model.json'));
    } catch { tfState.model = null; }
    return tfState.model;
  }
  function predictTF(source) {
    const tf = window.tf;
    return tf.tidy(() => {
      const t = tf.browser.fromPixels(source).resizeBilinear([224, 224]).toFloat().div(127.5).sub(1).expandDims(0);
      const out = Array.from(tfState.model.predict(t).dataSync());
      return LABELS.map((l) => { const i = tfState.labels.indexOf(l); return i >= 0 ? out[i] : 0; });
    });
  }

  /* ---------------- Public analyse ---------------- */
  function analyze(source, params = {}) {
    const t0 = performance.now();
    const ex = extract(source, params);
    const T = params.temperature || DEFAULTS.temperature;
    let probs; let engine;
    if (model) { probs = softmax(forward(model, ex.vector).out, T); engine = 'FeatureNet v' + (model.meta?.version || 1); }
    else { probs = softmax(rulePrior(ex.features), T); engine = 'Rule prior'; }
    if (tfState.model) {
      try { const p2 = predictTF(source); const s = p2.reduce((a, b) => a + b, 0) || 1; probs = probs.map((p, i) => 0.3 * p + 0.7 * (p2[i] / s)); engine = 'MobileNetV2 + FeatureNet'; } catch { /* ignore */ }
    }
    const ranked = LABELS.map((id, i) => ({ id, p: probs[i] })).sort((a, b) => b.p - a.p);
    const top = ranked[0];
    const f = ex.features;
    const yellowWeighted = ['mosaic_virus', 'nutrient_deficiency', 'bacterial_blight', 'downy_mildew'].includes(top.id) ? f.yellow : f.yellow * 0.4;
    let severity = top.id === 'healthy' ? Math.min(4, (f.lesion + f.yellow) * 100) : Math.min(100, (f.lesion + yellowWeighted) * 100 * 1.15);
    severity = +severity.toFixed(1);
    const level = severity < 5 ? 1 : severity < 15 ? 2 : severity < 30 ? 3 : severity < 50 ? 4 : 5;
    const q = ex.quality;
    const issues = [];
    if (q.brightness < 0.25) issues.push('too_dark');
    if (q.sharpness < 60) issues.push('blurry');
    if (q.coverage < 0.06) issues.push('no_leaf');
    return {
      ranked, top: top.id, confidence: Math.min(99, Math.round(top.p * 100)), severity, severityLevel: level, features: f, vector: ex.vector,
      blobs: ex.blobs.slice(0, 6).map((b) => ({ x: b.cx / ex.w, y: b.cy / ex.h, r: Math.sqrt(b.area / Math.PI) / ex.w, area: b.area })),
      leafBox: leafBox(ex), quality: q, issues, engine, ms: Math.round(performance.now() - t0), _ex: ex
    };
  }
  function leafBox(ex) {
    let minx = ex.w, miny = ex.h, maxx = 0, maxy = 0;
    for (let y = 0; y < ex.h; y++) for (let x = 0; x < ex.w; x++) if (ex.leaf[y * ex.w + x]) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    return maxx > minx ? [minx / ex.w, miny / ex.h, (maxx + 1) / ex.w, (maxy + 1) / ex.h] : null;
  }

  /* ---------------- Visualisations ---------------- */
  function maskCanvas(ex, mode = 'classes') {
    const c = document.createElement('canvas'); c.width = ex.w; c.height = ex.h;
    const ctx = c.getContext('2d'); const im = ctx.createImageData(ex.w, ex.h);
    for (let i = 0; i < ex.w * ex.h; i++) {
      let col;
      if (mode === 'leaf') col = ex.leaf[i] ? [34, 197, 94, 255] : [15, 23, 42, 255];
      else if (mode === 'lesion') col = ex.lesion[i] ? [239, 68, 68, 255] : ex.leaf[i] ? [20, 83, 45, 255] : [15, 23, 42, 255];
      else col = ex.leaf[i] ? CLASS_COLORS[ex.cls[i] || GREEN] : [15, 23, 42, 255];
      im.data.set(col, i * 4);
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }

  /* ---------------- Disease progression simulator (Feature #2) ---------------- */
  function prepareSimulation(src, displaySize = 320) {
    const ex = extract(src, {}, displaySize);
    const c = document.createElement('canvas'); c.width = ex.w; c.height = ex.h;
    c.getContext('2d').drawImage(src, 0, 0, ex.w, ex.h);
    const base = c.getContext('2d').getImageData(0, 0, ex.w, ex.h);
    const seedMask = new Uint8Array(ex.w * ex.h);
    for (let i = 0; i < seedMask.length; i++) seedMask[i] = ex.lesion[i] || ex.yellow[i] ? 1 : 0;
    const dist = distanceFrom(seedMask, ex.w, ex.h);
    const edgeDist = distanceFrom(invert(ex.leaf), ex.w, ex.h);
    let leafArea = 0; for (let i = 0; i < ex.leaf.length; i++) leafArea += ex.leaf[i];
    const rand = window.AgraSamples ? window.AgraSamples.rng(ex.w * 31 + leafArea) : Math.random;
    const sats = [];
    for (let tries = 0; sats.length < 40 && tries < 4000; tries++) {
      const x = Math.floor(rand() * ex.w); const y = Math.floor(rand() * ex.h);
      if (ex.leaf[y * ex.w + x]) sats.push({ x, y, born: 1 + rand() * 13 });
    }
    return { ex, base, dist, edgeDist, sats, leafArea, hasLesion: seedMask.some((v) => v) };
  }
  function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

  function simulate(prep, out, diseaseId, days) {
    const { ex, base, dist, edgeDist, sats, leafArea } = prep;
    out.width = ex.w; out.height = ex.h;
    const ctx = out.getContext('2d');
    const im = new ImageData(new Uint8ClampedArray(base.data), ex.w, ex.h);
    const d = window.AgraKB.disease(diseaseId);
    if (!d || days === 0 || d.progression === 0) { ctx.putImageData(im, 0, 0); return { severity: null }; }
    const scale = ex.w / 320;
    const rate = d.progression * 1.7 * scale;
    const R = rate * days;
    const spotty = ['fungal', 'oomycete'].includes(d.type);
    const nSats = spotty ? Math.min(sats.length, Math.round(d.progression * days * 1.4)) : 0;
    const type = diseaseId;
    let lesionPx = 0;
    const blend = (p, rgb, a) => { im.data[p] = im.data[p] * (1 - a) + rgb[0] * a; im.data[p + 1] = im.data[p + 1] * (1 - a) + rgb[1] * a; im.data[p + 2] = im.data[p + 2] * (1 - a) + rgb[2] * a; };
    for (let y = 0; y < ex.h; y++) for (let x = 0; x < ex.w; x++) {
      const i = y * ex.w + x; if (!ex.leaf[i]) continue;
      let dd = prep.hasLesion ? dist[i] : 1e9;
      if (type === 'bacterial_blight' && edgeDist[i] <= R * 0.45 && dist[i] <= R * 2.4) dd = Math.min(dd, edgeDist[i]);
      for (let k = 0; k < nSats; k++) {
        const s = sats[k]; if (s.born > days) continue;
        const rr = rate * (days - s.born) * 0.7 + 2 * scale;
        const ds = Math.hypot(x - s.x, y - s.y) - rr;
        if (ds < dd - R) dd = ds + R;
      }
      const noise = (hash(x, y) - 0.5) * 3 * scale;
      const p = i * 4;
      const inside = dd + noise <= R;
      const halo = !inside && dd + noise <= R + 4 * scale;
      if (inside) {
        lesionPx++;
        if (type === 'powdery_mildew') blend(p, [242, 242, 236], 0.82);
        else if (type === 'rust') { if (hash(x * 3, y * 7) < 0.22) blend(p, [226, 108, 24], 0.95); else blend(p, [212, 196, 70], 0.35); }
        else if (type === 'mosaic_virus') { if (hash((x / 6) | 0, (y / 6) | 0) < 0.55) blend(p, [214, 206, 74], 0.65); }
        else if (type === 'nutrient_deficiency') blend(p, [218, 206, 80], 0.45);
        else if (type === 'late_blight') blend(p, [55, 46, 30], 0.85);
        else if (type === 'anthracnose') blend(p, [32, 22, 14], 0.85);
        else blend(p, [110, 70, 36], 0.85);
      } else if (halo && !['powdery_mildew', 'nutrient_deficiency'].includes(type)) blend(p, [214, 196, 40], 0.55);
    }
    const sev = Math.min(100, (lesionPx / Math.max(1, leafArea)) * 100);
    if (sev > 55) { // wilting: desaturate & darken
      const a = Math.min(0.5, (sev - 55) / 80);
      for (let i = 0; i < ex.leaf.length; i++) if (ex.leaf[i]) { const p = i * 4; const g = (im.data[p] + im.data[p + 1] + im.data[p + 2]) / 3; blend(p, [g * 0.7 + 30, g * 0.6 + 20, g * 0.4], a); }
    }
    ctx.putImageData(im, 0, 0);
    return { severity: +sev.toFixed(1) };
  }

  /* ---------------- Training (in-browser) ---------------- */
  function buildDataset(perClass = 60, seedBase = 1, onProgress) {
    const c = document.createElement('canvas'); const X = []; const Y = [];
    let done = 0; const total = perClass * LABELS.length;
    return new Promise((resolve) => {
      const tick = () => {
        const t = performance.now();
        while (done < total && performance.now() - t < 30) {
          const li = done % LABELS.length; const k = Math.floor(done / LABELS.length);
          window.AgraSamples.draw(c, LABELS[li], seedBase + k * 13 + li, { size: 192, augment: true });
          X.push(extract(c).vector); Y.push(li); done++;
        }
        onProgress && onProgress(done / total);
        if (done < total) setTimeout(tick, 0); else resolve({ X, Y });
      };
      tick();
    });
  }

  function train(data, { hidden = 24, epochs = 160, lr = 0.05, val = null, seed = 7, onEpoch, init: warm = null, epochOffset = 0, totalEpochs = null } = {}) {
    const rand = window.AgraSamples.rng(seed + epochOffset);
    const nF = FEATURES.length; const nC = LABELS.length;
    const init = (r, c, s) => Array.from({ length: r }, () => Array.from({ length: c }, () => (rand() * 2 - 1) * s));
    let m;
    if (warm) { // continue training from existing weights (used for the live, chunked training UI)
      m = JSON.parse(JSON.stringify(warm)); hidden = m.b1.length;
    } else {
      const mean = Array(nF).fill(0); const std = Array(nF).fill(0);
      data.X.forEach((x) => x.forEach((v, i) => { mean[i] += v; }));
      mean.forEach((_, i) => { mean[i] /= data.X.length; });
      data.X.forEach((x) => x.forEach((v, i) => { std[i] += (v - mean[i]) ** 2; }));
      std.forEach((_, i) => { std[i] = Math.sqrt(std[i] / data.X.length) || 1; });
      m = { mean, std, W1: init(hidden, nF, Math.sqrt(2 / nF)), b1: Array(hidden).fill(0), W2: init(nC, hidden, Math.sqrt(1 / hidden)), b2: Array(nC).fill(0), meta: { version: 2, labels: LABELS, features: FEATURES, hidden } };
    }
    const total = totalEpochs || epochs;
    const vW1 = init(hidden, nF, 0), vb1 = Array(hidden).fill(0), vW2 = init(nC, hidden, 0), vb2 = Array(nC).fill(0);
    const history = [];
    const idx = data.X.map((_, i) => i);
    const evalSet = (set) => {
      if (!set) return null; let loss = 0, ok = 0;
      set.X.forEach((x, i) => { const p = softmax(forward(m, x).out); loss -= Math.log(p[set.Y[i]] + 1e-9); if (p.indexOf(Math.max(...p)) === set.Y[i]) ok++; });
      return { loss: loss / set.X.length, acc: ok / set.X.length };
    };
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const rate = lr * (1 - (ep + epochOffset) / (total * 1.15));
      let loss = 0, ok = 0;
      for (let b = 0; b < idx.length; b += 16) {
        const batch = idx.slice(b, b + 16);
        const gW1 = init(hidden, nF, 0), gb1 = Array(hidden).fill(0), gW2 = init(nC, hidden, 0), gb2 = Array(nC).fill(0);
        for (const s of batch) {
          const f = forward(m, data.X[s]); const p = softmax(f.out); const y = data.Y[s];
          loss -= Math.log(p[y] + 1e-9); if (p.indexOf(Math.max(...p)) === y) ok++;
          const dOut = p.map((v, k) => v - (k === y ? 1 : 0));
          const dH = Array(hidden).fill(0);
          for (let k = 0; k < nC; k++) { gb2[k] += dOut[k]; for (let j = 0; j < hidden; j++) { gW2[k][j] += dOut[k] * f.hdn[j]; dH[j] += dOut[k] * m.W2[k][j]; } }
          for (let j = 0; j < hidden; j++) { const g = dH[j] * (f.hdn[j] > 0 ? 1 : 0.01); gb1[j] += g; for (let i = 0; i < nF; i++) gW1[j][i] += g * f.z[i]; }
        }
        const bs = batch.length; const mom = 0.9; const l2 = 1e-4;
        for (let j = 0; j < hidden; j++) { for (let i = 0; i < nF; i++) { vW1[j][i] = mom * vW1[j][i] - rate * (gW1[j][i] / bs + l2 * m.W1[j][i]); m.W1[j][i] += vW1[j][i]; } vb1[j] = mom * vb1[j] - rate * gb1[j] / bs; m.b1[j] += vb1[j]; }
        for (let k = 0; k < nC; k++) { for (let j = 0; j < hidden; j++) { vW2[k][j] = mom * vW2[k][j] - rate * (gW2[k][j] / bs + l2 * m.W2[k][j]); m.W2[k][j] += vW2[k][j]; } vb2[k] = mom * vb2[k] - rate * gb2[k] / bs; m.b2[k] += vb2[k]; }
      }
      const v = evalSet(val);
      const rec = { epoch: ep + 1 + epochOffset, loss: loss / idx.length, acc: ok / idx.length, valLoss: v?.loss, valAcc: v?.acc };
      history.push(rec);
      onEpoch && onEpoch(rec);
    }
    m.meta.history = history.filter((_, i) => i % 4 === 3 || i === history.length - 1).map((h) => ({ epoch: h.epoch, loss: +h.loss.toFixed(4), acc: +h.acc.toFixed(4), valLoss: h.valLoss && +h.valLoss.toFixed(4), valAcc: h.valAcc && +h.valAcc.toFixed(4) }));
    if (val) m.meta.confusion = confusion(m, val);
    m.meta.trainedAt = new Date().toISOString();
    m.meta.samples = data.X.length + (val ? val.X.length : 0);
    return m;
  }
  function confusion(m, set) {
    const M = LABELS.map(() => LABELS.map(() => 0));
    set.X.forEach((x, i) => { const p = softmax(forward(m, x).out); M[set.Y[i]][p.indexOf(Math.max(...p))]++; });
    return M;
  }

  /* ---------------- Privacy: Anonymous Metadata Stripper (Feature #12) ---------------- */
  async function inspectExif(file) {
    try {
      const buf = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
      const info = { exif: false, gps: false, bytes: 0, make: false };
      for (let i = 0; i < buf.length - 10; i++) {
        if (buf[i] === 0xff && buf[i + 1] === 0xe1 && buf[i + 4] === 0x45 && buf[i + 5] === 0x78 && buf[i + 6] === 0x69 && buf[i + 7] === 0x66) {
          info.exif = true; info.bytes = (buf[i + 2] << 8) | buf[i + 3];
          const seg = buf.subarray(i + 10, i + 10 + info.bytes);
          for (let k = 0; k < seg.length - 1; k++) { if ((seg[k] === 0x88 && seg[k + 1] === 0x25) || (seg[k] === 0x25 && seg[k + 1] === 0x88)) info.gps = true; if ((seg[k] === 0x01 && seg[k + 1] === 0x0f) || (seg[k] === 0x0f && seg[k + 1] === 0x01)) info.make = true; }
          break;
        }
      }
      return info;
    } catch { return { exif: false, gps: false, bytes: 0 }; }
  }
  /** Re-encode through a canvas: drops EXIF/GPS/device data; blurs faces when the browser supports FaceDetector. */
  async function sanitize(source, { maxSize = 1280, quality = 0.86 } = {}) {
    let bmp = source;
    if (source instanceof Blob) bmp = await createImageBitmap(source, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(source));
    const sw = bmp.videoWidth || bmp.naturalWidth || bmp.width; const sh = bmp.videoHeight || bmp.naturalHeight || bmp.height;
    const k = Math.min(1, maxSize / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    let faces = 0;
    if ('FaceDetector' in window) {
      try {
        const found = await new window.FaceDetector({ fastMode: true }).detect(c);
        found.forEach(({ boundingBox: b }) => { ctx.save(); ctx.filter = 'blur(18px)'; ctx.drawImage(c, b.x, b.y, b.width, b.height, b.x, b.y, b.width, b.height); ctx.restore(); faces++; });
      } catch { /* unsupported */ }
    }
    return { canvas: c, dataUrl: c.toDataURL('image/jpeg', quality), facesBlurred: faces };
  }

  window.AgraVision = { LABELS, FEATURES, DEFAULTS, CLASS_COLORS, extract, analyze, loadModel, setModel, getModel: () => model, loadTF, maskCanvas, prepareSimulation, simulate, buildDataset, train, confusion, softmax, forward, sanitize, inspectExif };
})();
