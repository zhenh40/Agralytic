/* Bio-Scanner page */
(function () {
  'use strict';
  const { $, $$, esc, api, store, toast, getLocation, KB, chat } = window.Agra;
  const V = window.AgraVision;
  const video = $('#video'); const view = $('#view'); const overlay = $('#overlay'); const stage = $('#stage');
  let stream = null; let facing = 'environment'; let torchOn = false; let liveTimer = null; let live = null; let arT = 0; let rafAR = null;
  let current = null; // { canvas, result }
  let micro = null; let simPrep = null; let healthInfo = null;

  V.loadModel().then(() => V.loadTF());
  api('/api/health', { quiet: true }).then((h) => { healthInfo = h; if (!h.claude) $('#second').title = 'Available when the server has a Claude API key configured'; }).catch(() => {});

  /* ---------------- geometry helpers ---------------- */
  function fit(sw, sh, dw, dh, mode) {
    const s = mode === 'cover' ? Math.max(dw / sw, dh / sh) : Math.min(dw / sw, dh / sh);
    return { x: (dw - sw * s) / 2, y: (dh - sh * s) / 2, w: sw * s, h: sh * s };
  }
  function sizeOverlay() {
    const r = stage.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
    overlay.width = r.width * dpr; overlay.height = r.height * dpr;
    return { W: overlay.width, H: overlay.height, dpr };
  }

  /* ---------------- AR overlay (Feature #1) ---------------- */
  function drawAR(result, rect, { live: isLive = true } = {}) {
    const { W, H, dpr } = sizeOverlay();
    const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, W, H);
    if (!result) return;
    const map = (x, y) => [rect.x * dpr + x * rect.w * dpr, rect.y * dpr + y * rect.h * dpr];
    const t = performance.now() / 1000;
    // leaf brackets
    if (result.leafBox && result.quality.coverage > 0.04) {
      const [x0, y0] = map(result.leafBox[0], result.leafBox[1]); const [x1, y1] = map(result.leafBox[2], result.leafBox[3]);
      const L = Math.min(40 * dpr, (x1 - x0) / 4);
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 4 * dpr; ctx.lineCap = 'round'; ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 12;
      [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, sx, sy]) => { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); });
      ctx.shadowBlur = 0;
    }
    if (result.top === 'healthy' || ['mosaic_virus', 'nutrient_deficiency'].includes(result.top)) return;
    // lesion targets with animated AR arrows
    result.blobs.slice(0, isLive ? 3 : 5).forEach((b, i) => {
      const [cx, cy] = map(b.x, b.y); const r = Math.max(10 * dpr, b.r * rect.w * dpr * 1.25);
      const pulse = (Math.sin(t * 4 + i) + 1) / 2;
      ctx.strokeStyle = `rgba(239,68,68,${0.95})`; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(cx, cy, r + pulse * 4 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(239,68,68,${0.6 * (1 - ((t * 0.9 + i * 0.3) % 1))})`; ctx.beginPath(); ctx.arc(cx, cy, r + ((t * 30 + i * 9) % 26) * dpr, 0, Math.PI * 2); ctx.stroke();
      if (i === 0) {
        // arrow from top-right pointing at infection centre
        const ang = -Math.PI / 4; const dist = r + (26 + pulse * 10) * dpr;
        const ax = cx + Math.cos(ang) * dist; const ay = cy + Math.sin(ang) * dist;
        const tx = cx + Math.cos(ang) * (r + 6 * dpr); const ty = cy + Math.sin(ang) * (r + 6 * dpr);
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#ef4444'; ctx.lineWidth = 4 * dpr;
        ctx.beginPath(); ctx.moveTo(ax + 40 * dpr * Math.cos(ang), ay + 40 * dpr * Math.sin(ang)); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 14 * dpr * Math.cos(ang + 0.45), ty + 14 * dpr * Math.sin(ang + 0.45)); ctx.lineTo(tx + 14 * dpr * Math.cos(ang - 0.45), ty + 14 * dpr * Math.sin(ang - 0.45)); ctx.closePath(); ctx.fill();
        const label = isLive ? 'Infection focus' : `${KB.disease(result.top).name} focus`;
        ctx.font = `700 ${13 * dpr}px Plus Jakarta Sans, sans-serif`;
        const lw = ctx.measureText(label).width + 16 * dpr; const lx = Math.min(W - lw - 4, ax + 36 * dpr * Math.cos(ang)); const ly = Math.max(4, ay + 40 * dpr * Math.sin(ang) - 26 * dpr);
        ctx.fillStyle = 'rgba(239,68,68,.92)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, ly, lw, 24 * dpr, 8 * dpr) : ctx.rect(lx, ly, lw, 24 * dpr); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, lx + 8 * dpr, ly + 16.5 * dpr);
      }
    });
  }
  function arLoop() {
    cancelAnimationFrame(rafAR);
    const tick = () => {
      if (stream && live) { const r = stage.getBoundingClientRect(); drawAR(live, fit(video.videoWidth, video.videoHeight, r.width, r.height, 'cover')); }
      else if (current && !stream) { const r = stage.getBoundingClientRect(); drawAR(current.result, fit(current.canvas.width, current.canvas.height, r.width, r.height, 'contain'), { live: false }); }
      rafAR = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------------- Camera ---------------- */
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { toast('Camera not available. Use https:// or upload a photo instead.', 'error'); return; }
    try {
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      video.srcObject = stream; await video.play();
      setMode('camera');
      liveTimer = setInterval(() => { if (video.videoWidth) { live = V.analyze(video); updateHUD(live); } }, 280);
      const track = stream.getVideoTracks()[0]; const caps = track.getCapabilities ? track.getCapabilities() : {};
      $('#torch').classList.toggle('hidden', !caps.torch);
      arLoop();
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in browser settings, or upload a photo.' : 'Could not start the camera: ' + e.message, 'error');
    }
  }
  function stopCamera() {
    clearInterval(liveTimer); live = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; torchOn = false;
  }
  function updateHUD(r) {
    $('#hud-leaf').textContent = r.quality.coverage > 0.06 ? `🌿 leaf ${Math.round(r.quality.coverage * 100)}% of frame` : '🌿 searching…';
    $('#hud-guess').textContent = r.quality.coverage > 0.06 ? `🧠 ${KB.disease(r.top).name} ${r.confidence}%` : '🧠 –';
    let g = 'Hold steady — tap ⭕ to diagnose';
    if (r.issues.includes('too_dark')) g = '💡 Too dark — move to light or tap 🔦';
    else if (r.issues.includes('no_leaf')) g = '🔍 Move closer: fill the frame with one leaf';
    else if (r.issues.includes('blurry')) g = '✋ Image is blurry — hold still / wipe lens';
    else if (r.quality.coverage > 0.92) g = '↔️ A bit further away';
    $('#guide').textContent = g;
  }
  function setMode(mode) {
    const cam = mode === 'camera'; const res = mode === 'result';
    $('#ph').classList.toggle('hidden', cam || res);
    video.classList.toggle('hidden', !cam); view.classList.toggle('hidden', !res);
    ['#hud', '#guide'].forEach((s) => $(s).classList.toggle('hidden', !cam));
    ['#flip', '#shutter', '#stop'].forEach((s) => $(s).classList.toggle('hidden', !cam));
    if (!cam) $('#torch').classList.add('hidden');
    ['#rescan', '#upload2'].forEach((s) => $(s).classList.toggle('hidden', !res));
  }

  $('#start-cam').onclick = startCamera;
  $('#stop').onclick = () => { stopCamera(); setMode(current ? 'result' : 'idle'); overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height); };
  $('#flip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };
  $('#torch').onclick = async () => { try { torchOn = !torchOn; await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: torchOn }] }); } catch { toast('Flashlight not supported on this device', 'warn'); } };
  $('#rescan').onclick = () => { current = null; $('#results').classList.add('hidden'); startCamera(); };
  $('#shutter').onclick = () => {
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    stopCamera();
    diagnose(c, { source: 'camera' });
  };
  const onFile = async (e) => {
    const f = e.target.files[0]; if (!f) return; e.target.value = '';
    const info = await V.inspectExif(f);
    const clean = await V.sanitize(f, { maxSize: 1280 });
    $('#privacy').innerHTML = `<div class="banner safe" style="padding:10px 12px"><span class="bi">🛡️</span><span class="grow small">${info.exif ? `Removed EXIF block (${info.bytes.toLocaleString()} bytes)${info.gps ? ' <b>including GPS coordinates</b>' : ''}${info.make ? ' and phone model' : ''}.` : 'No hidden metadata found.'} ${clean.facesBlurred ? `Blurred ${clean.facesBlurred} face(s).` : ''} Image re-encoded on-device.</span></div>`;
    stopCamera();
    diagnose(clean.canvas, { source: 'upload' });
  };
  $('#file').onchange = onFile; $('#file2').onchange = onFile;

  /* ---------------- Samples ---------------- */
  const SAMPLE_IDS = ['powdery_mildew', 'early_blight', 'late_blight', 'leaf_spot', 'rust', 'bacterial_blight', 'mosaic_virus', 'downy_mildew', 'anthracnose', 'nutrient_deficiency', 'healthy'];
  $('#samples').innerHTML = SAMPLE_IDS.map((id) => `<button data-id="${id}" title="${esc(KB.disease(id).name)}"><canvas></canvas>${esc(KB.disease(id).name.split(' (')[0].split(' / ')[0])}</button>`).join('');
  $$('#samples button').forEach((b, i) => {
    const seed = 500 + i * 7;
    window.AgraSamples.draw($('canvas', b), b.dataset.id, seed, { size: 128, augment: false });
    b.onclick = () => {
      const c = document.createElement('canvas');
      window.AgraSamples.draw(c, b.dataset.id, seed, { size: 640, augment: false });
      stopCamera(); diagnose(c, { source: 'sample' });
    };
  });

  /* ---------------- Diagnose ---------------- */
  async function diagnose(canvas, { source }) {
    setMode('result');
    const r0 = stage.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
    view.width = r0.width * dpr; view.height = r0.height * dpr;
    const vctx = view.getContext('2d'); const rect = fit(canvas.width, canvas.height, r0.width, r0.height, 'contain');
    vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height);
    vctx.drawImage(canvas, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    $('#scanline').classList.remove('hidden');
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    await new Promise((r) => setTimeout(r, 900)); // let the user see the scan happen
    const result = V.analyze(canvas);
    $('#scanline').classList.add('hidden');
    current = { canvas, result, source };
    arLoop();
    if (result.issues.includes('no_leaf')) {
      toast('No leaf found. Fill the frame with one leaf on a plain background.', 'warn', 6000);
    }
    renderResult(result, canvas);
    const thumb = document.createElement('canvas'); thumb.width = 96; thumb.height = 96;
    const tr = fit(canvas.width, canvas.height, 96, 96, 'cover'); thumb.getContext('2d').drawImage(canvas, tr.x, tr.y, tr.w, tr.h);
    window.AgraDB.addHistory({ diseaseId: result.top, confidence: result.confidence, severity: Math.round(result.severity), thumb: thumb.toDataURL('image/jpeg', 0.7), plant: $('#plant').value }).catch(() => {});
    store.set('lastDiagnosis', { diseaseId: result.top, severity: result.severity, confidence: result.confidence, plant: $('#plant').value, at: Date.now() });
    chat.setContext({ diseaseId: result.top, recipeId: null });
    if (!result.issues.includes('no_leaf')) report(result, source);
  }

  function renderResult(r, canvas) {
    const d = KB.disease(r.top); const type = KB.PATHOGEN_TYPES[d.type];
    $('#results').classList.remove('hidden');
    setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    const ring = $('#conf-ring'); ring.style.setProperty('--p', r.confidence);
    ring.style.setProperty('--c', r.confidence >= 75 ? 'var(--primary)' : r.confidence >= 55 ? 'var(--warn)' : 'var(--danger)');
    $('#conf-v').textContent = r.confidence + '%';
    $('#dz-name').textContent = d.name;
    $('#dz-sci').textContent = d.scientific;
    $('#dz-chips').innerHTML = `<span class="chip" style="color:${type.color};border-color:${type.color}55">${type.icon} ${type.label}</span>${d.contagious ? '<span class="chip red">Contagious</span>' : '<span class="chip green">Not contagious</span>'}`;
    $('#dz-meta').innerHTML = `<span>⚙️ ${esc(r.engine)}</span><span>⚡ ${r.ms} ms on-device</span><span>📐 ${r._ex.spotCount} lesion${r._ex.spotCount === 1 ? '' : 's'}</span>`;
    $('#sev-v').textContent = r.severity + '%';
    $$('#sev-scale i').forEach((el, i) => el.classList.toggle('on', i < r.severityLevel));
    $('#sev-label').textContent = ['Trace — monitor', 'Mild — treat early', 'Moderate — treat now', 'Severe — isolate plant', 'Critical — remove & report'][r.severityLevel - 1];
    const rxUrl = `prescription.html?d=${r.top}&s=${Math.round(r.severity)}${$('#plant').value ? '&p=' + encodeURIComponent($('#plant').value) : ''}`;
    $('#go-rx').href = rxUrl; $('#go-rx2').href = rxUrl;
    const al = [];
    if (r.confidence < 60) al.push('<div class="banner warn"><span class="bi">🤔</span><span class="grow">Low confidence. Re-scan closer in daylight, scan the leaf underside, or ask for a cloud second opinion.</span></div>');
    if (r.issues.includes('blurry')) al.push('<div class="banner info"><span class="bi">📷</span><span class="grow">The photo looks blurry — results may be less reliable.</span></div>');
    if (d.severityBase >= 5) al.push('<div class="banner danger"><span class="bi">🚨</span><span class="grow"><b>High-risk pathogen.</b> Isolate this plant today and alert your community.</span></div>');
    $('#dz-alerts').innerHTML = al.join('');

    $('#probs').innerHTML = r.ranked.slice(0, 6).map((x) => { const dd = KB.disease(x.id); return `<span class="name">${dd.emoji} ${esc(dd.name)}</span><span class="pct">${Math.round(x.p * 100)}%</span><div class="bar ${x.id === r.top && x.id !== 'healthy' ? 'red' : ''}"><i style="width:${(x.p * 100).toFixed(1)}%"></i></div>`; }).join('');

    // image + markers, and segmentation mask
    const o = $('#img-orig'); o.width = canvas.width; o.height = canvas.height; const octx = o.getContext('2d'); octx.drawImage(canvas, 0, 0);
    r.blobs.slice(0, 6).forEach((b) => { octx.strokeStyle = '#ef4444'; octx.lineWidth = Math.max(2, canvas.width / 160); octx.beginPath(); octx.arc(b.x * canvas.width, b.y * canvas.height, Math.max(canvas.width / 40, b.r * canvas.width * 1.3), 0, Math.PI * 2); octx.stroke(); });
    const m = V.maskCanvas(r._ex); const mc = $('#img-mask'); mc.width = m.width; mc.height = m.height; mc.getContext('2d').drawImage(m, 0, 0);

    $('#about-dz').innerHTML = `<p><b>Symptoms:</b> ${d.symptoms.map(esc).join(' · ')}</p><p><b>How it spreads:</b> ${esc(d.spread)}</p><p><b>Favourable conditions:</b> ${esc(d.conditions)}</p><p class="muted"><b>📜 History:</b> ${esc(d.history)}</p><a href="faq.html#cards" class="small">Collect the wiki-card →</a>`;
    $('#second-out').innerHTML = '';

    // timeline
    simPrep = V.prepareSimulation(canvas);
    V.simulate(simPrep, $('#sim-a'), r.top, 0);
    $('#sim-days').value = 0; updateSim();
    $('#sim-note').innerHTML = d.progression === 0 ? 'This leaf is healthy — no disease progression expected. 🎉' : d.type === 'abiotic' ? 'Deficiency spreads slowly over the plant but never to neighbours.' : `${esc(d.name)} spread speed: ${'●'.repeat(d.spreadSpeed)}${'○'.repeat(5 - d.spreadSpeed)}. Under ${esc(d.conditions.toLowerCase())}`;

    // anatomy + microscope
    const anat = window.AgraAnatomy.mount($('#anatomy'), $('#anatomy-info'), d.type);
    void anat;
    if (micro) micro.destroy();
    micro = window.AgraMicro.create($('#micro'), {
      type: d.type,
      onUpdate: (s) => { $('#micro-cap').innerHTML = `<b>${esc(s.stage.title)}</b> — ${s.stage.text}`; $('#micro-ps').style.width = s.photosynthesis + '%'; $('#micro-psv').textContent = s.photosynthesis + '%'; if (!document.activeElement || document.activeElement.id !== 'micro-p') $('#micro-p').value = s.progress; }
    });

    // emergency actions
    const acts = [];
    if (d.type === 'none') acts.push('No treatment needed — great job!', 'Keep scanning weekly, especially after rain.', 'Water at the base in the morning.');
    else {
      if (d.contagious) acts.push('Wash hands and avoid touching healthy plants after this one.');
      if (r.severity >= 15 && d.type !== 'abiotic') acts.push('Cut off the worst leaves and seal them in a bag (do not compost).');
      if (d.type === 'viral') acts.push('Uproot the plant — viruses cannot be cured. Control aphids/whiteflies.');
      if (d.type === 'bacterial') acts.push('Do NOT spray fungicide: it does not work on bacteria.');
      if (d.type === 'oomycete') acts.push('Stop overhead watering; keep leaves dry.');
      if (d.type === 'abiotic') acts.push('Do not spray pesticides — this is a nutrient problem, feed the soil.');
      acts.push('Disinfect scissors with 70% alcohol.', 'Open your Eco-Prescription and prepare the organic remedy.');
    }
    $('#act-list').innerHTML = acts.map((a, i) => `<li><span class="num">${i + 1}</span><span class="txt">${esc(a)}</span></li>`).join('');
    $$('#act-list li').forEach((li) => li.onclick = () => li.classList.toggle('done'));
    $('#expert-box').innerHTML = r.severityLevel >= 4 || d.severityBase >= 5
      ? '<b>👩‍🔬 Call an expert</b><p class="small muted" style="margin:6px 0 0">This case is severe. Contact your local agricultural extension officer (Indonesia: <i>Penyuluh Pertanian Lapangan / BPP</i>; Singapore: NParks Plant Health Centre) and show them this diagnosis.</p>'
      : '<b>👩‍🔬 Expert help</b><p class="small muted" style="margin:6px 0 0">If symptoms spread after 2 treatments, contact your local agricultural extension service.</p>';
    showTab('t-diag');
  }

  /* timeline controls */
  function updateSim() {
    if (!simPrep || !current) return;
    const days = +$('#sim-days').value;
    const out = V.simulate(simPrep, $('#sim-b'), current.result.top, days);
    $('#sim-cap').textContent = days === 0 ? 'Today' : `Day ${days} if untreated`;
    const sev = out.severity ?? current.result.severity;
    $('#sim-bar').style.width = Math.min(100, sev) + '%';
    $('#sim-sev').textContent = (days === 0 ? current.result.severity : sev) + '%';
  }
  $('#sim-days').oninput = updateSim;
  $('#sim-play').onclick = () => {
    let d = 0; $('#sim-days').value = 0; updateSim();
    const iv = setInterval(() => { d++; $('#sim-days').value = d; updateSim(); if (d >= 14) clearInterval(iv); }, 380);
  };
  $('#micro-play').onclick = () => { if (!micro) return; if (micro.playing) { micro.pause(); $('#micro-play').textContent = '▶ Play'; } else { micro.play(); $('#micro-play').textContent = '⏸ Pause'; } };
  $('#micro-p').oninput = (e) => { if (micro) { micro.pause(); micro.progress = +e.target.value; $('#micro-play').textContent = '▶ Play'; } };

  function showTab(id) {
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    $$('.tabpanel').forEach((p) => p.classList.toggle('hidden', p.id !== id));
  }
  $$('.tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));

  /* ---------------- Second opinion ---------------- */
  $('#second').onclick = async () => {
    if (!current) return;
    if (!navigator.onLine) return toast('Second opinion needs internet', 'warn');
    if (healthInfo && !healthInfo.claude) { $('#second-out').innerHTML = '<span class="muted">Cloud AI is not configured on this server (set <span class="kbd">ANTHROPIC_API_KEY</span>). The on-device result above is complete.</span>'; return; }
    $('#second').disabled = true; $('#second-out').innerHTML = '<span class="muted">Asking Claude vision… (image is metadata-free)</span>';
    try {
      const clean = await V.sanitize(current.canvas, { maxSize: 768, quality: 0.85 });
      const r = await api('/api/second-opinion', { method: 'POST', body: { image: clean.dataUrl, heuristicTop: current.result.top } });
      if (!r.available || r.error) { $('#second-out').innerHTML = `<span class="muted">Second opinion unavailable (${esc(r.error || 'not configured')}).</span>`; return; }
      const agree = r.diseaseId === current.result.top; const dd = KB.disease(r.diseaseId);
      $('#second-out').innerHTML = `<div class="banner ${agree ? 'safe' : 'warn'}" style="align-items:flex-start"><span class="bi">${agree ? '🤝' : '🔀'}</span><span class="grow"><b>${agree ? 'Agrees' : 'Suggests'}: ${dd.emoji} ${esc(dd.name)} (${r.confidence}%)</b><br><span class="small">${esc(r.reasoning)}</span></span></div>${agree ? '' : `<a class="btn btn-sm" href="prescription.html?d=${r.diseaseId}&s=${Math.round(current.result.severity)}" style="margin-top:8px">Use this diagnosis →</a>`}`;
    } catch { $('#second-out').textContent = 'Could not reach the cloud AI.'; } finally { $('#second').disabled = false; }
  };

  /* ---------------- Community report (online or IndexedDB queue) ---------------- */
  async function report(result, source) {
    const box = $('#report-status');
    if (!$('#consent').checked) { box.innerHTML = '<b>Community report</b><p class="small muted" style="margin:6px 0 0">Not shared (you opted out). Diagnosis stays on this device.</p>'; return; }
    const loc = await getLocation({ prompt: true });
    const payload = { diseaseId: result.top, confidence: result.confidence, severity: result.severity, plant: $('#plant').value || null, engine: result.engine, capturedAt: Date.now(), lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, demo: source === 'sample' };
    if (source === 'sample') { payload.lat = null; payload.lng = null; } // samples never pollute the real map
    if (!navigator.onLine) {
      await window.AgraDB.queue({ payload, diseaseId: result.top });
      box.innerHTML = '<b>📴 Saved offline</b><p class="small muted" style="margin:6px 0 0">Report stored in IndexedDB. It will be sent automatically when you reconnect.</p>';
      if ('serviceWorker' in navigator && 'SyncManager' in window) navigator.serviceWorker.ready.then((reg) => reg.sync.register('agra-sync')).catch(() => {});
      renderQueue();
      return;
    }
    try {
      const r = await api('/api/scans', { method: 'POST', body: payload, quiet: true });
      let html = `<b>✅ Reported anonymously</b><p class="small muted" style="margin:6px 0 0">${payload.lat === null ? (source === 'sample' ? 'Sample scans are not placed on the map.' : 'No location shared, so it is not on the map.') : 'Added to the Outbreak Radar (location rounded to ~100 m).'}${r.points ? ` +${r.points} Bio-Agent points!` : ''}</p>`;
      if (r.outbreak) html += `<div class="banner danger" style="margin-top:10px"><span class="bi">🚨</span><span class="grow small">Your report confirmed an outbreak cluster (${r.outbreak.count} cases ≤ 1 km). ${r.alertsSent} resident(s) notified${r.alertsSimulated ? ' (simulation mode)' : ''}.</span></div>`;
      box.innerHTML = html;
      if (r.points) window.Agra.profile.refresh();
    } catch {
      await window.AgraDB.queue({ payload, diseaseId: result.top });
      box.innerHTML = '<b>📴 Saved offline</b><p class="small muted" style="margin:6px 0 0">Server unreachable — the report is queued on your device.</p>';
      renderQueue();
    }
  }
  async function renderQueue() {
    const items = await window.AgraDB.outbox().catch(() => []);
    $('#q-count').textContent = items.length;
    if (items.length) $('#queue').innerHTML = items.map((i) => `<div class="queue-item">⏳ <div style="flex:1"><b>${esc(KB.disease(i.diseaseId)?.name || i.diseaseId)}</b><div class="faint">queued ${window.Agra.timeAgo(i.queuedAt)}</div></div></div>`).join('') + '<button class="btn btn-sm" id="sync-now">🔄 Sync now</button>';
    const s = $('#sync-now'); if (s) s.onclick = () => window.dispatchEvent(new Event('agra:sync'));
  }
  window.addEventListener('agra:synced', renderQueue);
  renderQueue();
  window.addEventListener('resize', () => { if (current && !stream) diagnoseRedraw(); });
  function diagnoseRedraw() {
    const r0 = stage.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
    view.width = r0.width * dpr; view.height = r0.height * dpr;
    const rect = fit(current.canvas.width, current.canvas.height, r0.width, r0.height, 'contain');
    const vctx = view.getContext('2d'); vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height);
    vctx.drawImage(current.canvas, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
  }
  if (navigator.onLine) window.dispatchEvent(new Event('agra:sync'));
  if (new URLSearchParams(location.search).get('camera') === '1') startCamera();
})();
