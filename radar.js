/* Outbreak Radar page */
(function () {
  'use strict';
  const { $, $$, esc, api, toast, getLocation, DEFAULT_LOC, KB, timeAgo, store } = window.Agra;
  let days = 14; let loc = null; let channel = 'whatsapp';
  const layers = {};
  const COLORS = { watch: '#eab308', warning: '#f97316', critical: '#dc2626' };

  $('#f-dz').innerHTML += KB.DISEASES.filter((d) => d.contagious).map((d) => `<option value="${d.id}">${d.emoji} ${esc(d.name)}</option>`).join('');
  $('#sim-dz').innerHTML = KB.DISEASES.filter((d) => d.contagious).map((d) => `<option value="${d.id}">${d.emoji} ${esc(d.name)}</option>`).join('');

  if (!window.L) {
    $('#map').innerHTML = '<div class="empty"><div class="ei">🗺️</div>The map library could not load (offline?). Outbreak list and alerts still work.</div>';
  }
  const map = window.L ? L.map('map', { zoomControl: true, attributionControl: true }).setView([DEFAULT_LOC.lat, DEFAULT_LOC.lng], 12) : null;
  let tiles = null;
  function setTiles() {
    if (!map) return;
    if (tiles) map.removeLayer(tiles);
    const dark = document.documentElement.dataset.theme === 'dark';
    tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, { maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
  }
  setTiles(); window.addEventListener('agra:theme', setTiles);

  /* geodesy */
  function dest(lat, lng, bearingDeg, km) {
    const R = 6371; const b = bearingDeg * Math.PI / 180; const p1 = lat * Math.PI / 180; const l1 = lng * Math.PI / 180; const d = km / R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
  }

  let scans = []; let outbreaks = []; let wind = null;
  async function load() {
    const dz = $('#f-dz').value;
    try {
      [scans, outbreaks] = await Promise.all([api(`/api/scans?days=${days}${dz ? '&disease=' + dz : ''}`, { quiet: true }), api('/api/outbreaks', { quiet: true })]);
      if (dz) outbreaks = outbreaks.filter((o) => o.diseaseId === dz);
    } catch { toast('Offline — map data unavailable', 'warn'); }
    draw(); list();
  }

  function draw() {
    if (!map) return;
    Object.values(layers).forEach((l) => map.removeLayer(l));
    // heat
    if ($('#l-heat').checked) {
      const pts = scans.filter((s) => s.diseaseId !== 'healthy').map((s) => [s.lat, s.lng, 0.4 + (s.severity / 100) * 0.6]);
      layers.heat = L.heatLayer ? L.heatLayer(pts, { radius: 28, blur: 22, maxZoom: 15, gradient: { 0.2: '#22c55e', 0.45: '#facc15', 0.7: '#f97316', 1: '#dc2626' } }) : L.layerGroup(pts.map((p) => L.circle([p[0], p[1]], { radius: 180, stroke: false, fillColor: '#ef4444', fillOpacity: 0.15 })));
      layers.heat.addTo(map);
    }
    if ($('#l-pts').checked) {
      layers.pts = L.layerGroup(scans.map((s) => { const d = KB.disease(s.diseaseId); return L.circleMarker([s.lat, s.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: KB.PATHOGEN_TYPES[d.type].color, fillOpacity: 0.9 }).bindPopup(`<b>${d.emoji} ${esc(d.name)}</b><br>${s.plant ? esc(s.plant) + ' · ' : ''}severity ${Math.round(s.severity)}% · ${timeAgo(s.createdAt)}`); })).addTo(map);
    }
    if ($('#l-ob').checked) {
      layers.ob = L.layerGroup(outbreaks.flatMap((o) => {
        const col = COLORS[o.level]; const d = KB.disease(o.diseaseId);
        const zone = L.circle([o.center.lat, o.center.lng], { radius: o.radiusKm * 1000, color: col, weight: 2, fillColor: col, fillOpacity: 0.18, dashArray: '6 6' })
          .bindPopup(`<b>🚨 ${o.level.toUpperCase()} — ${d.emoji} ${esc(d.name)}</b><br>${o.count} cases within ${o.radiusKm} km<br><a href="prescription.html?d=${o.diseaseId}">Organic protection plan →</a>`);
        const pulse = L.circle([o.center.lat, o.center.lng], { radius: o.radiusKm * 1000, color: col, weight: 2, fill: false, className: 'ob-pulse', interactive: false });
        return [zone, pulse];
      })).addTo(map);
    }
    if ($('#l-wind').checked && wind) {
      const to = (wind.windDirection + 180) % 360; const km = Math.max(1, Math.min(6, wind.windSpeed * 0.9));
      layers.wind = L.layerGroup(outbreaks.flatMap((o) => {
        const c = [o.center.lat, o.center.lng];
        const cone = L.polygon([c, dest(o.center.lat, o.center.lng, to - 22, km), dest(o.center.lat, o.center.lng, to, km * 1.1), dest(o.center.lat, o.center.lng, to + 22, km)], { stroke: false, fillColor: '#00ff66', fillOpacity: 0.09, interactive: false });
        const lines = [-18, -9, 0, 9, 18].map((off) => L.polyline([c, dest(o.center.lat, o.center.lng, to + off, km * (1 - Math.abs(off) / 60))], { color: '#00ff66', weight: 2, opacity: 0.8, className: 'spore-line', interactive: false }));
        return [cone, ...lines];
      })).addTo(map);
    }
  }

  function list() {
    $('#ob-count').textContent = outbreaks.length;
    $('#ob-list').innerHTML = outbreaks.length ? outbreaks.sort((a, b) => b.count - a.count).map((o, i) => { const d = KB.disease(o.diseaseId); return `<div class="outbreak-item" data-i="${i}"><span class="lv ${o.level}"></span><div style="flex:1"><b>${d.emoji} ${esc(d.name)}</b><div class="small muted">${o.count} cases · r ${o.radiusKm} km · ${timeAgo(o.updatedAt || o.createdAt)}</div></div><span class="chip ${o.level === 'critical' ? 'red' : 'amber'}">${o.level}</span></div>`; }).join('') : '<div class="empty"><div class="ei">🟢</div>No active red zones.</div>';
    $$('#ob-list .outbreak-item').forEach((el) => el.onclick = () => { const o = outbreaks[+el.dataset.i]; map && map.flyTo([o.center.lat, o.center.lng], 14, { duration: 1.2 }); });
  }

  async function loadWind(lat, lng) {
    try {
      wind = await api(`/api/weather?lat=${lat}&lng=${lng}`, { quiet: true });
      $('#wind-arrow').style.transform = `rotate(${(wind.windDirection + 180) % 360}deg)`;
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      $('#wind-txt').textContent = `${wind.windSpeed.toFixed(1)} m/s from ${dirs[Math.round(wind.windDirection / 45) % 8]}`;
      $('#wind-sub').textContent = `Spores drift up to ~${Math.max(1, Math.min(6, wind.windSpeed * 0.9)).toFixed(1)} km downwind${wind.source === 'estimate' ? ' (estimated)' : ''}`;
      draw();
    } catch { /* offline */ }
  }

  async function locate(fly = true) {
    loc = await getLocation({ prompt: true });
    const here = loc || DEFAULT_LOC;
    if (map && fly) map.setView([here.lat, here.lng], loc ? 14 : 12);
    if (map && loc) { if (layers.me) map.removeLayer(layers.me); layers.me = L.circleMarker([loc.lat, loc.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#0284c7', fillOpacity: 1 }).bindTooltip('You (approx.)').addTo(map); }
    $('#sub-loc').textContent = loc ? '📍 Location: your current position (rounded to ~100 m before saving).' : '📍 Location not shared — using the map centre instead. Drag the map to your garden first.';
    loadWind(here.lat, here.lng);
  }

  /* controls */
  $$('#f-days button').forEach((b) => b.onclick = () => { $$('#f-days button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); days = +b.dataset.d; load(); });
  $('#f-dz').onchange = load;
  ['#l-heat', '#l-pts', '#l-ob', '#l-wind'].forEach((s) => $(s).onchange = draw);
  $('#me').onclick = () => locate(true);

  /* subscription */
  $$('#channel button').forEach((b) => b.onclick = () => {
    $$('#channel button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); channel = b.dataset.c;
    $('#contact-l').textContent = channel === 'telegram' ? 'Telegram chat ID (message @userinfobot to get it)' : 'Phone number (international format)';
    $('#contact').placeholder = channel === 'telegram' ? '123456789' : '+62 812 3456 7890';
  });
  $('#radius').oninput = () => { $('#radius-v').textContent = $('#radius').value; };
  $('#sub-form').onsubmit = async (e) => {
    e.preventDefault();
    const c = map ? map.getCenter() : DEFAULT_LOC;
    const p = loc || { lat: c.lat, lng: c.lng };
    try {
      const r = await api('/api/subscribers', { method: 'POST', body: { channel, contact: $('#contact').value, radiusKm: +$('#radius').value, lat: p.lat, lng: p.lng, consent: $('#consent').checked } });
      store.set('unsubCode', r.unsubscribeCode);
      $('#sub-out').innerHTML = `<div class="banner safe"><span class="bi">🔔</span><span class="grow small"><b>Alerts active for ${esc(r.masked)}</b> within ${r.radiusKm} km. ${r.live ? 'Real messages will be delivered.' : 'Server is in simulation mode — alerts appear in the live log.'}<br>Unsubscribe code: <span class="kbd">${esc(r.unsubscribeCode)}</span> (saved on this device)</span></div>`;
      $('#contact').value = '';
      if (map) { L.circle([p.lat, p.lng], { radius: r.radiusKm * 1000, color: '#0284c7', weight: 1.5, fillOpacity: 0.05, dashArray: '3 6' }).addTo(map).bindTooltip('Your alert area'); }
    } catch { /* toast */ }
  };
  $('#unsub-code').value = store.get('unsubCode', '');
  $('#unsub').onclick = async () => { try { await api('/api/subscribers/unsubscribe', { method: 'POST', body: { code: $('#unsub-code').value } }); toast('Unsubscribed. You will not receive more alerts.'); store.del('unsubCode'); } catch { /* toast */ } };

  /* alert log + mode */
  async function loadLog() {
    try {
      const rows = await api('/api/alerts/log', { quiet: true });
      if (rows.length) $('#log').innerHTML = rows.map((a) => `<div class="msg" style="border-left-color:${a.status === 'sent' ? 'var(--primary)' : a.status === 'simulated' ? 'var(--info)' : 'var(--danger)'}"><div class="row between small"><b>${a.channel === 'whatsapp' ? '💬' : a.channel === 'sms' ? '✉️' : '✈️'} ${esc(a.to)}</b><span class="chip ${a.status === 'sent' ? 'green' : a.status === 'simulated' ? 'blue' : 'red'}">${a.status}</span></div><div style="margin-top:4px">${esc(a.body)}</div><div class="faint small">${timeAgo(a.createdAt)}${a.error ? ' · ' + esc(a.error) : ''}</div></div>`).join('');
    } catch { /* offline */ }
  }
  api('/api/health', { quiet: true }).then((h) => {
    const live = h.notify.sms || h.notify.whatsapp || h.notify.telegram;
    $('#mode-chip').innerHTML = live ? '<span class="chip green">LIVE delivery</span>' : '<span class="chip blue">Simulation mode (no Twilio keys)</span>';
  }).catch(() => {});

  /* demo outbreak */
  $('#simulate').onclick = async () => {
    const btn = $('#simulate'); btn.disabled = true;
    const c = loc || (map ? map.getCenter() : DEFAULT_LOC);
    const dz = $('#sim-dz').value; let last = null;
    for (let i = 0; i < 5; i++) {
      const lat = c.lat + (Math.random() - 0.5) * 0.006; const lng = c.lng + (Math.random() - 0.5) * 0.006;
      try { last = await api('/api/scans', { method: 'POST', body: { diseaseId: dz, confidence: 80 + Math.round(Math.random() * 15), severity: 15 + Math.round(Math.random() * 40), lat, lng, demo: true, engine: 'demo' } }); } catch { break; }
      btn.textContent = `⚡ Report ${i + 1}/5 sent…`;
      await new Promise((r) => setTimeout(r, 450));
    }
    btn.disabled = false; btn.textContent = '⚡ Simulate outbreak near me';
    if (last?.outbreak) toast(`🚨 Red zone declared: ${last.outbreak.count} cases. Alerts dispatched automatically.`, 'error', 6000);
    if (map) map.flyTo([c.lat, c.lng], 14);
    $('#l-ob').checked = true; $('#l-pts').checked = true;
    load(); loadLog();
  };

  locate(true).then(load); loadLog();
  setInterval(() => { load(); loadLog(); }, 30000);
})();
