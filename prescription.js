/* Eco-Prescription page */
(function () {
  'use strict';
  const { $, $$, esc, api, store, toast, modal, getLocation, KB, chat, voice, profile } = window.Agra;
  const qs = new URLSearchParams(location.search);
  const last = store.get('lastDiagnosis');
  const PANTRY = ['Milk', 'Baking soda', 'Cooking oil', 'Liquid soap', 'Garlic', 'Neem oil', 'Eggshells', 'Banana peels', 'Molasses / sugar', 'Compost', 'Rabbit urine ferment', '70% alcohol', 'Gloves', 'Plastic bags'];
  let pantry = new Set(store.get('pantry', ['Milk', 'Baking soda', 'Cooking oil', 'Liquid soap', 'Garlic', 'Plastic bags', 'Gloves']));
  let rx = null; let primary = null;

  /* ---------- form ---------- */
  $('#dz').innerHTML = KB.DISEASES.map((d) => `<option value="${d.id}">${d.emoji} ${esc(d.name)}</option>`).join('');
  $('#dz').value = qs.get('d') || last?.diseaseId || 'powdery_mildew';
  $('#sev').value = qs.get('s') || (last ? Math.round(last.severity) : 20); $('#sev-v').textContent = $('#sev').value;
  $('#plant').value = qs.get('p') || last?.plant || '';
  $('#sev').oninput = () => { $('#sev-v').textContent = $('#sev').value; };
  function renderPantry() {
    const all = [...new Set([...PANTRY, ...pantry])];
    $('#pantry').innerHTML = all.map((p) => `<button type="button" class="chip btnish ${pantry.has(p) ? 'on' : ''}" data-p="${esc(p)}">${pantry.has(p) ? '✓ ' : ''}${esc(p)}</button>`).join('');
    $$('#pantry button').forEach((b) => b.onclick = () => { const p = b.dataset.p; pantry.has(p) ? pantry.delete(p) : pantry.add(p); store.set('pantry', [...pantry]); renderPantry(); });
  }
  renderPantry();
  $('#pantry-add-btn').onclick = () => { const v = $('#pantry-add').value.trim(); if (v) { pantry.add(v); store.set('pantry', [...pantry]); $('#pantry-add').value = ''; renderPantry(); } };

  /* ---------- generate ---------- */
  async function generate() {
    const btn = $('#gen'); btn.disabled = true; btn.textContent = '🧠 Thinking…';
    const loc = await getLocation({ prompt: false });
    const body = { diseaseId: $('#dz').value, severity: +$('#sev').value, plant: $('#plant').value, volumeL: +$('#vol').value, pantry: [...pantry], weather: store.get('weather'), lat: loc?.lat, lng: loc?.lng };
    try {
      rx = await api('/api/prescription', { method: 'POST', body });
      store.set('lastRx', { body, rx, at: Date.now() });
    } catch {
      const cached = store.get('lastRx');
      if (cached && cached.body.diseaseId === body.diseaseId) { rx = cached.rx; toast('Offline — showing your last saved prescription', 'warn'); } else { btn.disabled = false; btn.textContent = '✨ Generate my prescription'; return; }
    }
    btn.disabled = false; btn.textContent = '✨ Regenerate';
    render();
  }
  $('#gen').onclick = generate;

  function stars(n) { const r = Math.round(n || 0); return '★'.repeat(r) + '☆'.repeat(5 - r); }
  function ratingChip(rt) {
    if (!rt) return '';
    const st = rt.status === 'verified' ? '<span class="chip green">✔ Community verified</span>' : rt.status === 'demoted' ? '<span class="chip red">⚠ Auto-demoted</span>' : '';
    return `<span class="chip amber" title="Bayesian score">${stars(rt.score)} ${rt.score}</span><span class="chip">${rt.count} reviews${rt.successLower !== null && rt.successLower !== undefined ? ` · ≥${Math.round(rt.successLower * 100)}% worked` : ''}</span>${st}`;
  }
  const EVID = { strong: ['green', 'Strong evidence'], moderate: ['blue', 'Peer-reviewed evidence'], limited: ['amber', 'Limited evidence'], traditional: ['amber', 'Traditional practice'], community: ['red', 'Unverified community recipe'] };

  function render() {
    $('#rx').classList.remove('hidden');
    const d = rx.disease;
    $('#urg').className = 'urgency ' + rx.urgency; $('#urg').textContent = rx.urgency === 'none' ? 'healthy' : rx.urgency + ' priority';
    $('#rx-title').textContent = d.name;
    $('#rx-engine').textContent = rx.engine === 'rules' ? '⚙️ Knowledge engine (offline-safe)' : '🧠 Knowledge engine + Claude';
    $('#immediate').innerHTML = rx.immediate.map((i) => `<li>${esc(i)}</li>`).join('') + (rx.callExpert ? '<li><b>Severe case: contact your local agricultural extension officer.</b></li>' : '');
    const w = store.get('weather');
    let notes = rx.aiNotes ? `<div style="white-space:pre-wrap">${esc(rx.aiNotes)}</div>` : '';
    if (w) notes += `<div class="banner ${w.rainChance6h > 60 || w.windSpeed > 5 ? 'warn' : 'safe'}" style="margin-top:10px;padding:10px 12px"><span class="bi">${w.rainChance6h > 60 ? '🌧️' : '☀️'}</span><span class="grow small">${esc(w.sprayAdvice)} (${w.temperature.toFixed(0)} °C, ${Math.round(w.humidity)}% RH)</span></div>`;
    if (!notes) notes = '<p class="muted">Open the dashboard once online to add local weather to your plan.</p>';
    notes += `<p class="small muted" style="margin-top:10px">Prevention: ${rx.prevention.map(esc).join(' · ')}</p>`;
    $('#ai-notes').innerHTML = notes;
    setPrimary(rx.primary);
    $('#alts').innerHTML = rx.alternatives.length ? rx.alternatives.map((a, i) => `<div class="card flat"><div style="font-size:1.6rem">${a.emoji}</div><b>${esc(a.name)}</b><div class="small muted" style="margin:4px 0 8px">${esc(a.summary)}</div><div class="row small">${ratingChip(a.rating)}</div><button class="btn btn-sm" data-i="${i}" style="margin-top:10px">Use this instead</button></div>`).join('') : '<p class="muted">No alternatives for this condition.</p>';
    $$('#alts button').forEach((b) => b.onclick = () => { const a = rx.alternatives[+b.dataset.i]; setPrimary(a); $('#primary').scrollIntoView({ behavior: 'smooth' }); });
    $('#sched').innerHTML = rx.schedule.map((s) => `<li><span class="dt">${s.date}</span><span>${esc(s.action)}</span></li>`).join('') || '<li class="muted">No schedule needed.</li>';
    $('#rx').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setPrimary(p) {
    primary = p; if (!p) { $('#primary').innerHTML = '<p>No recipe available.</p>'; return; }
    chat.setContext({ recipeId: p.id, diseaseId: rx.disease.id });
    const ev = EVID[p.evidence] || EVID.limited;
    const progressKey = 'steps.' + p.id;
    const done = store.get(progressKey, 0);
    $('#primary').innerHTML = `
      <div class="row between"><div class="row"><div style="font-size:2.6rem">${p.emoji}</div><div><div class="eyebrow" style="margin:0">Recommended treatment</div><h2 style="margin:0">${esc(p.name)}</h2></div></div>
        <div class="row"><span class="chip ${ev[0]}">${ev[1]}</span>${p.kind === 'protocol' ? '<span class="chip blue">Isolation protocol</span>' : ''}</div></div>
      <p class="muted" style="margin-top:12px">${esc(p.summary)}</p>
      <div class="row small" style="margin-bottom:16px">${ratingChip(p.rating)}<span class="chip">match with your pantry: ${Math.round(p.pantryMatch * 100)}%</span></div>
      ${p.rating?.status === 'demoted' ? '<div class="banner danger" style="margin-bottom:14px"><span class="bi">⚠️</span><span class="grow small">The community reported this recipe as ineffective or harmful. It was automatically demoted. Choose an alternative.</span></div>' : ''}
      <div class="grid g2">
        <div><h3>🧺 Ingredients (for ${$('#vol').value} L)</h3><ul class="ingredients">${p.ingredients.map((i) => { const miss = p.missing.includes(i.name); return `<li class="${miss ? 'missing' : ''}"><span>${miss ? '🛒 ' : '✅ '}${esc(i.name)}</span><b>${i.amount !== null ? `${i.amount} ${esc(i.unit)}` : ''}</b></li>`; }).join('')}</ul>
          ${rx.nearbyIngredients && rx.nearbyIngredients.length ? `<div class="banner info" style="margin-top:12px;align-items:flex-start"><span class="bi">📍</span><span class="grow small"><b>Missing something? Neighbours can help:</b><br>${rx.nearbyIngredients.map((n) => `${esc(n.title)} — ${n.distanceKm} km`).join('<br>')}<br><a href="marketplace.html">Open Marketplace →</a></span></div>` : p.missing.length ? `<p class="small muted" style="margin-top:10px">Missing ingredients? <a href="marketplace.html">Ask neighbours on the Seed-Swap Marketplace →</a></p>` : ''}
          <h3 style="margin-top:20px">⚠️ Safety</h3><ul class="small" style="padding-left:18px">${p.safety.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
          <p class="cite">Sources: ${p.sources.map(esc).join('; ')}</p>
        </div>
        <div><div class="row between"><h3 style="margin:0">✅ Step-by-step checklist</h3><button class="btn btn-sm" id="voice-guide" title="Hands-free voice guide">🎙️ Voice guide</button></div>
          <p class="small muted">Complete each step to unlock the next.</p>
          <ol class="checklist" id="steps">${p.steps.map((s, i) => `<li data-i="${i}"><span class="num">${i + 1}</span><span class="txt">${esc(s)}</span><button class="icon-btn" data-say="${i}" title="Read aloud" aria-label="Read step ${i + 1} aloud" style="width:34px;height:34px">🔊</button></li>`).join('')}</ol>
          <div id="complete-box"></div>
        </div>
      </div>`;
    const updateSteps = (n) => {
      store.set(progressKey, n);
      $$('#steps li').forEach((li, i) => { li.classList.toggle('done', i < n); li.classList.toggle('current', i === n); li.classList.toggle('locked', i > n); });
      if (n >= p.steps.length) complete(); else $('#complete-box').innerHTML = '';
    };
    $$('#steps li').forEach((li) => li.addEventListener('click', (e) => {
      if (e.target.closest('[data-say]')) return;
      const i = +li.dataset.i; const n = store.get(progressKey, 0);
      if (i === n) updateSteps(n + 1); else if (i === n - 1) updateSteps(n - 1);
    }));
    $$('[data-say]').forEach((b) => b.onclick = () => voice.speak(`Step ${+b.dataset.say + 1}. ${p.steps[+b.dataset.say]}`));
    $('#voice-guide').onclick = () => { chat.toggle(true); setTimeout(() => chat.send('read the recipe'), 200); };
    updateSteps(Math.min(done, p.steps.length));
    // toxicity calc + eco counter follow the chosen recipe
    if (p.active) { $('#tx-recipe').value = p.id; calc('init'); }
    eco(p);
  }
  window.addEventListener('agra:guide-step', (e) => { if (primary) { const n = e.detail; const cur = store.get('steps.' + primary.id, 0); if (n - 1 >= cur) { store.set('steps.' + primary.id, n - 1); setPrimary(primary); } } });
  window.addEventListener('agra:guide-done', () => { if (primary) { store.set('steps.' + primary.id, primary.steps.length); setPrimary(primary); } });

  async function complete() {
    const p = primary; const key = 'completed.' + p.id + '.' + new Date().toISOString().slice(0, 10);
    $('#complete-box').innerHTML = `<div class="banner safe" style="margin-top:14px"><span class="bi">🎉</span><span class="grow">All steps done! Your remedy is ready.</span></div>
      <div class="card flat" style="margin-top:12px"><b>After 7 days — did it work?</b><div class="row" style="margin-top:10px" id="rate"><span id="stars" style="font-size:1.6rem;cursor:pointer;letter-spacing:4px">${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">☆</span>`).join('')}</span>
      <label class="check"><input type="checkbox" id="worked" checked><span class="small">It helped my plant</span></label><button class="btn btn-sm btn-primary" id="send-rate">Submit rating</button></div></div>`;
    let starsN = 4;
    const paint = () => $$('#stars span').forEach((s) => { s.textContent = +s.dataset.n <= starsN ? '★' : '☆'; s.style.color = 'var(--warn)'; });
    paint(); $$('#stars span').forEach((s) => s.onclick = () => { starsN = +s.dataset.n; paint(); });
    $('#send-rate').onclick = async () => {
      try { const r = await api(`/api/recipes/${p.id}/rate`, { method: 'POST', body: { stars: starsN, worked: $('#worked').checked } }); toast(`Thanks! Community score is now ${r.score} (${r.count} reviews)`); loadLibrary(); } catch { /* toast */ }
    };
    if (!store.get(key)) {
      store.set(key, true);
      const life = store.get('ecoLifetime', 0) + (p.kind === 'protocol' ? 3 : 2) * +$('#vol').value * (p.schedule?.times || 1);
      store.set('ecoLifetime', life); eco(p);
      if (profile.token) { api('/api/me/points', { method: 'POST', body: { reason: 'recipe' }, quiet: true }).then((r) => r.awarded && toast(`+${r.awarded} Bio-Agent points 🧪`)).catch(() => {}); }
    }
  }

  /* ---------- Toxicity calculator ---------- */
  const actives = KB.RECIPES.filter((r) => r.active);
  $('#tx-recipe').innerHTML = actives.map((r) => `<option value="${r.id}">${r.emoji} ${esc(r.name)}</option>`).join('');
  function calc(fromSlider) {
    const r = KB.recipe($('#tx-recipe').value); const a = r.active;
    const water = Math.max(0.1, +$('#tx-water').value || 1);
    const slider = $('#tx-slider'); slider.max = a.burn * 1.4; slider.step = a.max > 50 ? 5 : 0.5;
    if (fromSlider === 'init') { slider.value = a.recommended; $('#tx-amt').value = +(a.recommended * water).toFixed(1); }
    if (fromSlider === true) $('#tx-amt').value = +(slider.value * water).toFixed(1);
    const unitTotal = a.unit.split('/')[0] === '%' ? 'ml' : a.unit.split('/')[0];
    $('#tx-amt-l').textContent = `${a.label} (${unitTotal})`;
    const perL = (+$('#tx-amt').value || 0) / water; if (fromSlider !== true) slider.value = perL;
    const pos = Math.min(100, (perL / (a.burn * 1.4)) * 100);
    $('#tx-needle').style.left = `calc(${pos}% - 2px)`;
    let cls, msg;
    if (perL < a.min) { cls = 'info'; msg = `Too weak (${perL.toFixed(1)} ${a.unit}). Below ${a.min} ${a.unit} it will probably not work.`; }
    else if (perL <= a.max) { cls = 'safe'; msg = `Safe dose ✅ ${perL.toFixed(1)} ${a.unit} (recommended ${a.recommended}). Still test on 2–3 leaves first.`; }
    else if (perL < a.burn) { cls = 'warn'; msg = `Strong ⚠️ ${perL.toFixed(1)} ${a.unit} — above the safe max of ${a.max}. Risk of leaf damage on young or stressed plants.`; }
    else { cls = 'danger'; msg = `Phytotoxic ❌ ${perL.toFixed(1)} ${a.unit} — this will burn leaves and roots. Dilute to ≤ ${a.max} ${a.unit}: add ${((+$('#tx-amt').value / a.max) - water).toFixed(1)} L more water.`; }
    $('#tx-verdict').innerHTML = `<div class="banner ${cls}" style="padding:10px 12px"><span class="grow small">${msg}</span></div><p class="small muted" style="margin-top:8px">For ${water} L: ${r.ingredients.filter((i) => i.perLitre && i.key !== 'water').map((i) => `${esc(i.name)} <b>${+(i.perLitre * water).toFixed(1)} ${i.unit}</b>`).join(' · ')}</p>`;
  }
  $('#tx-recipe').onchange = () => calc('init');
  $('#tx-water').oninput = () => calc();
  $('#tx-amt').oninput = () => calc();
  $('#tx-slider').oninput = () => calc(true);
  calc('init');

  /* ---------- Eco impact (Feature #7) ---------- */
  function eco(p) {
    const vol = +$('#vol').value; const times = p.schedule?.times || 1;
    const ml = p.pesticideEquivalentMl * vol * times || rx.eco.pesticideMlAvoided;
    const litres = KB.ECO.litresProtected(ml);
    window.Agra.countUp($('#eco-l'), Math.round(litres));
    $('#eco-ml').textContent = `${ml.toFixed(1)} ml (${times} sprays × ${vol} L)`;
    const life = store.get('ecoLifetime', 0);
    $('#eco-life').textContent = `${life.toFixed(1)} ml → ${Math.round(KB.ECO.litresProtected(life)).toLocaleString()} L water`;
    const waste = p.ingredients.filter((i) => /peel|shell|garlic|milk|coffee/i.test(i.name)).map((i) => i.name.split(' (')[0]);
    $('#eco-waste').textContent = waste.length ? waste.join(', ') : '–';
  }

  /* ---------- Calendar ---------- */
  $('#add-cal').onclick = () => {
    if (!rx) return;
    const list = store.get('schedule', []);
    const plant = $('#plant').value ? '🌿 ' + $('#plant').value : '🌿 My plant';
    rx.schedule.forEach((s) => list.push({ id: Math.random().toString(36).slice(2, 10), date: s.date, icon: s.recipeId ? '🧪' : '📸', action: s.recipeId ? 'Organic spray' : 'Re-scan', plant, done: false }));
    store.set('schedule', list);
    if (store.get('token')) api('/api/schedule', { method: 'PUT', body: { items: list }, quiet: true }).catch(() => {});
    toast(`🗓️ ${rx.schedule.length} tasks added to your dashboard calendar`);
  };

  /* ---------- Library + bio-rating (Feature #11) ---------- */
  async function loadLibrary() {
    try {
      const all = await api('/api/recipes', { quiet: true });
      all.sort((a, b) => (a.rating.status === 'demoted') - (b.rating.status === 'demoted') || b.rating.score - a.rating.score);
      $('#library').innerHTML = all.map((r) => `<div class="card hover" style="${r.rating.status === 'demoted' ? 'opacity:.72' : ''}"><div class="row between"><span style="font-size:1.8rem">${r.emoji}</span>${r.community ? `<span class="chip">by ${esc(r.author)}</span>` : `<span class="chip ${(EVID[r.evidence] || EVID.limited)[0]}">${(EVID[r.evidence] || EVID.limited)[1]}</span>`}</div>
        <h3 style="margin:8px 0 4px">${esc(r.name)}</h3><p class="small muted">${esc(r.summary)}</p>
        <div class="row small">${ratingChip(r.rating)}</div>
        <div class="row small" style="margin-top:10px">${r.targets.slice(0, 3).map((t) => `<span class="chip">${KB.disease(t)?.emoji || ''} ${esc(KB.disease(t)?.name.split(' (')[0] || t)}</span>`).join('')}</div>
        <div class="row" style="margin-top:12px"><button class="btn btn-sm" data-rate="${r.id}">⭐ Rate</button></div></div>`).join('');
      $$('[data-rate]').forEach((b) => b.onclick = () => rateModal(b.dataset.rate, all.find((x) => x.id === b.dataset.rate)));
    } catch { $('#library').innerHTML = '<p class="muted">Library needs a connection.</p>'; }
  }
  function rateModal(id, r) {
    modal(`<h2>${r.emoji} Rate “${esc(r.name)}”</h2><p class="muted small">Your honest review protects other gardeners. Recipes with poor results are demoted automatically.</p>
      <div class="field"><label class="f">Stars</label><div id="rs" style="font-size:2rem;cursor:pointer;color:var(--warn);letter-spacing:6px">${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">☆</span>`).join('')}</div></div>
      <label class="check" style="margin-bottom:16px"><input type="checkbox" id="rw" checked><span>It worked for my plant</span></label>
      <button class="btn btn-primary btn-block" id="rsend">Submit</button>`, {
      onMount(m, close) {
        let n = 4; const paint = () => $$('#rs span', m).forEach((s) => { s.textContent = +s.dataset.n <= n ? '★' : '☆'; });
        paint(); $$('#rs span', m).forEach((s) => s.onclick = () => { n = +s.dataset.n; paint(); });
        $('#rsend', m).onclick = async () => { try { const res = await api(`/api/recipes/${id}/rate`, { method: 'POST', body: { stars: n, worked: $('#rw', m).checked } }); close(); toast(res.status === 'demoted' ? '⚠ This recipe is now auto-demoted by the community' : `Thanks! New score ${res.score}`); loadLibrary(); } catch { /* toast */ } };
      }
    });
  }
  $('#submit-recipe').onclick = async () => {
    await profile.ensure('to share a recipe');
    if (!profile.token) return;
    modal(`<h2>🧑‍🔬 Share your organic recipe</h2><p class="small muted">Community recipes start as <b>unverified</b> and must earn good reviews. Never share anything dangerous (bleach sprays, motor oil, etc.).</p>
      <form id="rf"><div class="field"><label class="f">Recipe name</label><input class="input" name="name" required maxlength="60"></div>
      <div class="field"><label class="f">Works against</label><select class="input" name="targets" multiple size="4">${KB.DISEASES.filter((d) => d.id !== 'healthy').map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select><div class="hint">Ctrl/Cmd-click to choose several.</div></div>
      <div class="field"><label class="f">Ingredients (one per line: name, amount per litre, unit)</label><textarea class="input" name="ing" placeholder="Turmeric powder, 5, g"></textarea></div>
      <div class="field"><label class="f">Steps (one per line)</label><textarea class="input" name="steps"></textarea></div>
      <div class="field"><label class="f">Short summary</label><input class="input" name="summary" maxlength="240"></div>
      <button class="btn btn-primary btn-block">Submit for community review</button></form>`, {
      wide: true,
      onMount(m, close) {
        $('#rf', m).onsubmit = async (e) => {
          e.preventDefault(); const f = e.target;
          const ingredients = f.ing.value.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((x) => x[0]).map(([name, perLitre, unit]) => ({ name, perLitre: +perLitre || 0, unit: unit || '' }));
          try { await api('/api/recipes', { method: 'POST', body: { name: f.name.value, targets: [...f.targets.selectedOptions].map((o) => o.value), ingredients, steps: f.steps.value.split('\n'), summary: f.summary.value } }); close(); toast('Recipe submitted! It will rise as people rate it. +8 points'); loadLibrary(); } catch { /* toast */ }
        };
      }
    });
  };

  loadLibrary();
  if (qs.get('d') || last) generate();
})();
