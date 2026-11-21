/* Diagnostics Lab page */
(function () {
  'use strict';
  const { $, $$, esc, api, toast, store, chart, KB } = window.Agra;
  const V = window.AgraVision; const S = window.AgraSamples;
  let src = document.createElement('canvas'); let seed = 1; let params = { ...V.DEFAULTS };

  const PARAMS = [
    ['satMin', 'Green saturation threshold', 0.05, 0.5, 0.01, 'Lower = pale green counts as healthy tissue'],
    ['whiteSat', 'Powder max saturation', 0.05, 0.4, 0.01, 'How grey/white a pixel must be to count as mildew'],
    ['whiteVal', 'Powder min brightness', 0.4, 0.95, 0.01, ''],
    ['darkVal', 'Necrosis darkness cut-off', 0.05, 0.4, 0.01, 'Pixels darker than this = dead tissue'],
    ['minSpot', 'Minimum lesion size (px)', 1, 20, 1, 'Ignore specks smaller than this (noise filter)'],
    ['closeR', 'Leaf-closing radius', 0.02, 0.15, 0.005, 'Morphological closing that fills holes in the leaf mask'],
    ['temperature', 'Softmax temperature', 0.3, 3, 0.1, 'Higher = less confident, smoother probabilities']
  ];

  /* ---------------- Playground ---------------- */
  $('#pg-dz').innerHTML = S.LIST.map((id) => `<option value="${id}">${KB.disease(id).emoji} ${esc(KB.disease(id).name)}</option>`).join('');
  $('#pg-dz').value = 'early_blight';
  function renderParams() {
    $('#params').innerHTML = PARAMS.map(([k, l, mn, mx, st, h]) => `<div class="field" style="margin-bottom:8px"><label class="f small" for="p-${k}">${l}: <span class="mono" id="pv-${k}">${params[k]}</span></label><input type="range" id="p-${k}" min="${mn}" max="${mx}" step="${st}" value="${params[k]}">${h ? `<div class="hint">${h}</div>` : ''}</div>`).join('');
    PARAMS.forEach(([k]) => { $('#p-' + k).oninput = (e) => { params[k] = +e.target.value; $('#pv-' + k).textContent = params[k]; run(); }; });
  }
  function drawTo(id, c) { const el = $(id); el.width = c.width; el.height = c.height; el.getContext('2d').drawImage(c, 0, 0); }
  function run() {
    const r = V.analyze(src, params); const ex = r._ex;
    $('#pg-ms').textContent = `${r.ms} ms`;
    drawTo('#pp-0', src); drawTo('#pp-1', V.maskCanvas(ex, 'leaf')); drawTo('#pp-2', V.maskCanvas(ex, 'classes')); drawTo('#pp-3', V.maskCanvas(ex, 'lesion'));
    const c3 = $('#pp-3').getContext('2d'); c3.strokeStyle = '#fde047'; c3.lineWidth = 1;
    ex.blobs.slice(0, 30).forEach((b) => { c3.strokeRect(b.box[0] - 1, b.box[1] - 1, b.box[2] - b.box[0] + 3, b.box[3] - b.box[1] + 3); });
    $('#pg-probs').innerHTML = r.ranked.slice(0, 5).map((x) => `<span class="name">${KB.disease(x.id).emoji} ${esc(KB.disease(x.id).name)}</span><span class="pct">${(x.p * 100).toFixed(1)}%</span><div class="bar"><i style="width:${x.p * 100}%"></i></div>`).join('');
    $('#pg-feat').innerHTML = V.FEATURES.map((f) => `<tr><td>${f}</td><td><div class="bar" style="height:6px;width:90px;display:inline-block;vertical-align:middle;margin-right:8px"><i style="width:${Math.min(100, Math.abs(r.features[f]) * 100)}%"></i></div>${r.features[f].toFixed(3)}</td></tr>`).join('');
    const m = V.getModel();
    if (m) {
      const h = V.forward(m, r.vector).hdn; const mx = Math.max(...h.map(Math.abs), 1e-6);
      $('#pg-neurons').innerHTML = h.map((v, i) => `<div title="neuron ${i + 1}: ${v.toFixed(2)}" style="aspect-ratio:1;border-radius:4px;background:rgba(34,197,94,${Math.max(0.06, v / mx)})"></div>`).join('');
    }
  }
  function newLeaf() { seed = Math.floor(Math.random() * 99999); S.draw(src, $('#pg-dz').value, seed, { size: 320, augment: true }); run(); }
  $('#pg-dz').onchange = newLeaf; $('#pg-new').onclick = newLeaf;
  $('#pg-reset').onclick = () => { params = { ...V.DEFAULTS }; renderParams(); run(); };
  $('#pg-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; src = (await V.sanitize(f, { maxSize: 480 })).canvas; run(); };

  /* ---------------- Training tracker ---------------- */
  function showModel(m, label) {
    if (!m) return;
    const h = m.meta.history || [];
    chart($('#tr-chart'), [{ data: h.map((x) => x.loss), color: '#22c55e' }, { data: h.map((x) => x.valAcc ?? x.acc), color: '#0ea5e9' }], { labels: h.map((x) => x.epoch), height: 230, max: Math.max(1, ...h.map((x) => x.loss)) * 1.05 });
    const acc = m.meta.testAcc ?? h.at(-1)?.valAcc;
    $('#tm-acc').textContent = acc ? (acc * 100).toFixed(1) + '%' : '–';
    $('#tm-acc-s').textContent = label;
    $('#tm-n').textContent = (m.meta.samples || m.meta.dataset?.train || 0).toLocaleString();
    $('#tm-p').textContent = (m.W1.length * m.W1[0].length + m.b1.length + m.W2.length * m.W2[0].length + m.b2.length).toLocaleString();
    const M = m.meta.testConfusion || m.meta.confusion;
    if (M) {
      const ab = V.LABELS.map((l) => KB.disease(l).emoji);
      $('#cm').innerHTML = `<tr><th></th>${ab.map((a) => `<th>${a}</th>`).join('')}</tr>` + M.map((row, i) => { const tot = row.reduce((a, b) => a + b, 0) || 1; return `<tr><th title="${esc(KB.disease(V.LABELS[i]).name)}">${ab[i]}</th>${row.map((v, j) => `<td style="background:${i === j ? `rgba(34,197,94,${0.15 + 0.85 * v / tot})` : v ? `rgba(239,68,68,${0.2 + 0.8 * v / tot})` : 'transparent'};font-weight:${v ? 800 : 400}">${v || ''}</td>`).join('')}</tr>`; }).join('');
    }
  }
  let shipped = null;
  fetch('featurenet.json').then((r) => r.json()).then((m) => { shipped = m; const custom = store.get('featurenet'); showModel(custom || m, custom ? 'your browser-trained model' : 'shipped model, unseen test set'); }).catch(() => {});
  V.loadModel().then(run);
  api('/api/model/status', { quiet: true }).then((s) => {
    $('#tm-scans').textContent = s.totalScans.toLocaleString(); $('#tm-conf').textContent = `avg confidence ${s.avgConfidence}%`;
    $('#tf-status').innerHTML = s.tfjsModel ? '<b class="grad-text">Deep model detected and active.</b>' : 'Deep model not installed yet on this server.';
  }).catch(() => {});

  $('#tr-n').oninput = () => { $('#tr-n-v').textContent = $('#tr-n').value; };
  $('#tr-e').oninput = () => { $('#tr-e-v').textContent = $('#tr-e').value; };
  $('#tr-go').onclick = async () => {
    const btn = $('#tr-go'); btn.disabled = true;
    const per = +$('#tr-n').value; const epochs = +$('#tr-e').value;
    $('#tr-status').textContent = `Generating ${per * 11} augmented training leaves + validation set…`;
    const tr = await V.buildDataset(per, Math.floor(Math.random() * 1e5), (p) => { $('#tr-bar').style.width = (p * 45) + '%'; });
    const va = await V.buildDataset(12, 77777, (p) => { $('#tr-bar').style.width = (45 + p * 10) + '%'; });
    $('#tr-status').textContent = 'Training… (stochastic gradient descent with momentum)';
    await new Promise((r) => setTimeout(r, 30));
    let m = null; let ep = 0; const all = []; const chunk = 10;
    while (ep < epochs) {
      const n = Math.min(chunk, epochs - ep);
      m = V.train(tr, { epochs: n, val: va, init: m, epochOffset: ep, totalEpochs: epochs, onEpoch: (h) => all.push(h) });
      ep += n;
      $('#tr-bar').style.width = (55 + (ep / epochs) * 45) + '%';
      chart($('#tr-chart'), [{ data: all.map((x) => x.loss), color: '#22c55e' }, { data: all.map((x) => x.valAcc), color: '#0ea5e9' }], { labels: all.map((x) => x.epoch), height: 230, max: Math.max(1, ...all.map((x) => x.loss)) * 1.05 });
      $('#tr-status').textContent = `Epoch ${ep}/${epochs} · loss ${all.at(-1).loss.toFixed(3)} · val acc ${(all.at(-1).valAcc * 100).toFixed(1)}%`;
      await new Promise((r) => setTimeout(r, 16));
    }
    m.meta.history = all.filter((_, i) => i % 2 === 1 || i === all.length - 1).map((h) => ({ epoch: h.epoch, loss: +h.loss.toFixed(4), acc: +h.acc.toFixed(4), valLoss: +h.valLoss.toFixed(4), valAcc: +h.valAcc.toFixed(4) }));
    const te = await V.buildDataset(10, 424242);
    let ok = 0; te.X.forEach((x, i) => { const p = V.softmax(V.forward(m, x).out); if (p.indexOf(Math.max(...p)) === te.Y[i]) ok++; });
    m.meta.testAcc = ok / te.X.length; m.meta.testConfusion = V.confusion(m, te); m.meta.samples = tr.X.length;
    V.setModel(m, true); showModel(m, 'your browser-trained model'); run();
    $('#tr-status').innerHTML = `✅ Done! Test accuracy <b>${(m.meta.testAcc * 100).toFixed(1)}%</b> on ${te.X.length} unseen leaves. Your model is now used by the Bio-Scanner on this device.`;
    btn.disabled = false; toast('Model trained and activated on this device 🧠');
  };
  $('#tr-reset').onclick = () => { store.del('featurenet'); if (shipped) { V.setModel(shipped); showModel(shipped, 'shipped model, unseen test set'); run(); } toast('Using the shipped model again'); };

  /* ---------------- Micro simulator ---------------- */
  let micro = null;
  function makeMicro(type) {
    if (micro) micro.destroy();
    micro = window.AgraMicro.create($('#mi'), { type, onUpdate: (s) => { $('#mi-cap').innerHTML = `<b>${esc(s.stage.title)}</b> — ${s.stage.text}`; $('#mi-ps').style.width = s.photosynthesis + '%'; $('#mi-psv').textContent = s.photosynthesis + '%'; if (document.activeElement?.id !== 'mi-p') $('#mi-p').value = s.progress; } });
    $('#mi-play').textContent = '▶ Play';
  }
  $$('#mi-type button').forEach((b) => b.onclick = () => { $$('#mi-type button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); makeMicro(b.dataset.t); });
  $('#mi-play').onclick = () => { if (micro.playing) { micro.pause(); $('#mi-play').textContent = '▶ Play'; } else { micro.play(); $('#mi-play').textContent = '⏸ Pause'; } };
  $('#mi-p').oninput = (e) => { micro.pause(); micro.progress = +e.target.value; $('#mi-play').textContent = '▶ Play'; };

  renderParams(); S.draw(src, 'early_blight', 7, { size: 320, augment: false }); makeMicro('fungal');
})();
