/* faq page */
(function () {
  const { $, $$, esc, KB } = window.Agra;
  $('#types').innerHTML = Object.entries(KB.PATHOGEN_TYPES).filter(([k]) => k !== 'none').map(([k, t]) => `<div class="card hover" data-s="${esc(t.label + ' ' + t.explain)}"><div style="font-size:2rem">${t.icon}</div><h3 style="color:${t.color}">${esc(t.label)}</h3><p class="small muted" style="margin:0">${esc(t.explain)}</p></div>`).join('');
  const RAR = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
  $('#tcards').innerHTML = KB.DISEASES.map((d, i) => {
    const t = KB.PATHOGEN_TYPES[d.type];
    const stat = (l, v) => `<div class="stat">${l}<div class="bar"><i style="width:${v * 20}%"></i></div></div>`;
    return `<div class="tcard rar-${d.rarity}" data-id="${d.id}" data-s="${esc(d.name + ' ' + d.scientific + ' ' + d.symptoms.join(' '))}" tabindex="0" role="button" aria-label="${esc(d.name)} card, tap to flip"><div class="tcard-inner">
      <div class="tcard-face tcard-front"><div class="row between"><span class="rar">${RAR[d.rarity]}</span><span class="chip" style="color:${t.color}">${t.icon} ${esc(t.label.split(' (')[0])}</span></div>
        <canvas class="art" data-d="${d.id}" data-seed="${30 + i}"></canvas>
        <b>${d.emoji} ${esc(d.name)}</b><i class="small muted">${esc(d.scientific)}</i>
        <div class="stats">${stat('Spread speed', d.spreadSpeed)}${stat('Damage', d.severityBase)}${stat('Hosts', Math.min(5, d.hosts.length))}${stat('Treatable', d.type === 'viral' ? 0 : d.type === 'abiotic' ? 5 : d.type === 'oomycete' ? 2 : 3)}</div>
        <div class="faint small center collected-mark" style="margin-top:6px"></div></div>
      <div class="tcard-face tcard-back"><b>${d.emoji} ${esc(d.name)}</b><p><b>📜 History.</b> ${esc(d.history)}</p><p><b>🌬️ Spread.</b> ${esc(d.spread)}</p><p><b>🛑 Stop it.</b> ${esc(d.prevention.join('; '))}.</p><p><b>🌱 Hosts.</b> ${esc(d.hosts.join(', '))}</p><a href="prescription.html?d=${d.id}" data-stop>Treatment →</a></div>
    </div></div>`;
  }).join('');
  $$('canvas.art').forEach((c) => window.AgraSamples.draw(c, c.dataset.d, +c.dataset.seed, { size: 220, augment: false }));
  $$('[data-stop]').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  $$('.tcard').forEach((c) => { c.onclick = () => c.classList.toggle('flip'); c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.classList.toggle('flip'); } }; });
  window.AgraDB.history(500).then((h) => {
    const got = new Set(h.map((x) => x.diseaseId));
    $$('.tcard').forEach((c) => { if (got.has(c.dataset.id)) { c.querySelector('.collected-mark').innerHTML = '<span class="chip green">✔ Collected</span>'; } else c.querySelector('.tcard-front').style.filter = 'saturate(.55)'; });
    $('#collected').textContent = `${[...got].filter((x) => KB.disease(x)).length} / ${KB.DISEASES.length} collected`;
  }).catch(() => {});
  $('#gloss').innerHTML = KB.GLOSSARY.map((g) => `<div data-s="${esc(g.term + ' ' + g.def)}"><b>${esc(g.term)}</b>${esc(g.def)}</div>`).join('');
  $('#faq').innerHTML = KB.FAQ.map((f) => `<details class="faq" data-s="${esc(f.q + ' ' + f.a)}"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  $('#trouble').innerHTML = KB.TROUBLESHOOT.map((t) => `<details class="faq" data-s="${esc(t.issue + ' ' + t.fix)}"><summary>🔧 ${esc(t.issue)}</summary><p>${esc(t.fix)}</p></details>`).join('');
  $('#search').oninput = (e) => { const q = e.target.value.toLowerCase(); $$('[data-s]').forEach((el) => { el.style.display = !q || el.dataset.s.toLowerCase().includes(q) ? '' : 'none'; }); };
  if (!('serviceWorker' in navigator)) $('#offline-chip').textContent = 'Offline mode needs a modern browser';
  if (location.hash === '#cards') setTimeout(() => $('#cards').scrollIntoView(), 200);
})();
