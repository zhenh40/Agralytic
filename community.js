/* Community Hub page */
(function () {
  'use strict';
  const { $, $$, esc, api, toast, modal, profile, KB, timeAgo, diseaseChip } = window.Agra;
  let sort = 'new'; let lbRange = 'week'; let lbTab = 'agents'; let lbData = null;

  $('#f-dz').innerHTML += KB.DISEASES.map((d) => `<option value="${d.id}">${d.emoji} ${esc(d.name)}</option>`).join('');

  /* ---------------- Forum ---------------- */
  async function loadPosts() {
    try {
      const posts = await api(`/api/posts?sort=${sort}${$('#f-dz').value ? '&disease=' + $('#f-dz').value : ''}`, { quiet: true });
      $('#posts').innerHTML = posts.length ? posts.map(postHtml).join('') : '<div class="card empty"><div class="ei">🌱</div>No stories yet — be the first!</div>';
      bindPosts(posts);
    } catch { $('#posts').innerHTML = '<div class="card empty"><div class="ei">📴</div>Community needs an internet connection.</div>'; }
  }
  function postHtml(p) {
    return `<article class="card post" data-id="${p.id}">
      <div class="post-head"><div class="avatar">${esc(p.author.avatar)}</div><div style="flex:1"><b>${esc(p.author.nickname)}</b><div class="small muted">${esc(p.author.school || '')} · ${timeAgo(p.createdAt)}</div></div>${p.diseaseId ? diseaseChip(p.diseaseId) : ''}</div>
      <h3 style="margin:0">${esc(p.title)}</h3>
      <p style="margin:0;white-space:pre-wrap">${esc(p.body)}</p>
      ${p.image ? `<img src="${p.image}" alt="Leaf photo shared by ${esc(p.author.nickname)}" loading="lazy">` : ''}
      <div class="post-actions"><button class="btn btn-sm ${p.liked ? 'btn-primary' : ''}" data-like>🌿 ${p.likes}</button><button class="btn btn-sm" data-cmt>💬 ${p.comments.length}</button><button class="btn btn-sm btn-ghost" data-report title="Report inappropriate content" style="margin-left:auto">🚩</button></div>
      <div class="comments hidden">${p.comments.map((c) => `<div class="comment"><span>${esc(c.author.avatar)}</span><div><b>${esc(c.author.nickname)}</b> <span class="faint small">${timeAgo(c.createdAt)}</span><div>${esc(c.text)}</div></div></div>`).join('')}
        <form class="row" data-cform><input class="input" placeholder="Write a helpful comment…" maxlength="500" style="flex:1"><button class="btn btn-sm btn-primary">Send</button></form></div>
    </article>`;
  }
  function bindPosts() {
    $$('.post').forEach((el) => {
      const id = el.dataset.id;
      $('[data-like]', el).onclick = async () => { await profile.ensure('to like stories'); if (!profile.token) return; try { const r = await api(`/api/posts/${id}/like`, { method: 'POST' }); const b = $('[data-like]', el); b.textContent = `🌿 ${r.likes}`; b.classList.toggle('btn-primary', r.liked); } catch { /* toast */ } };
      $('[data-cmt]', el).onclick = () => $('.comments', el).classList.toggle('hidden');
      $('[data-report]', el).onclick = async () => { if (confirm('Report this story as inappropriate? 3 reports hide it automatically.')) { await api(`/api/posts/${id}/report`, { method: 'POST' }).catch(() => {}); toast('Thanks — our community moderators will review it.'); } };
      $('[data-cform]', el).onsubmit = async (e) => {
        e.preventDefault(); await profile.ensure('to comment'); if (!profile.token) return;
        const inp = $('input', e.target); if (!inp.value.trim()) return;
        try { const c = await api(`/api/posts/${id}/comments`, { method: 'POST', body: { text: inp.value } }); inp.value = ''; e.target.insertAdjacentHTML('beforebegin', `<div class="comment"><span>${esc(c.author.avatar)}</span><div><b>${esc(c.author.nickname)}</b> <span class="faint small">just now</span><div>${esc(c.text)}</div></div></div>`); } catch { /* toast */ }
      };
    });
  }
  $$('#sort button').forEach((b) => b.onclick = () => { $$('#sort button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); sort = b.dataset.s; loadPosts(); });
  $('#f-dz').onchange = loadPosts;

  $('#new-post').onclick = async () => {
    await profile.ensure('to share your story'); if (!profile.token) return;
    const last = window.Agra.store.get('lastDiagnosis');
    modal(`<h2>✍️ Share a plant-recovery story</h2>
      <form id="pf"><div class="field"><label class="f">Title</label><input class="input" name="title" required maxlength="120" placeholder="How I saved my chillies from anthracnose"></div>
      <div class="field"><label class="f">Disease</label><select class="input" name="dz"><option value="">—</option>${KB.DISEASES.map((d) => `<option value="${d.id}" ${last?.diseaseId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="f">Your story</label><textarea class="input" name="body" required maxlength="2000" placeholder="What did you see? Which recipe did you use? What happened after a week?"></textarea></div>
      <div class="field"><label class="f">Photo (optional)</label><input type="file" accept="image/*" name="img" class="input"><div class="hint" id="img-hint">🛡️ Photos are cleaned on your device: EXIF/GPS removed, faces blurred where supported, resized.</div></div>
      <button class="btn btn-primary btn-block">Publish (+5 points)</button></form>`, {
      onMount(m, close) {
        let image = null;
        $('[name=img]', m).onchange = async (e) => {
          const f = e.target.files[0]; if (!f) return;
          const info = await window.AgraVision.inspectExif(f);
          const clean = await window.AgraVision.sanitize(f, { maxSize: 900, quality: 0.78 });
          image = clean.dataUrl;
          $('#img-hint', m).innerHTML = `✅ Cleaned: ${info.exif ? `removed ${info.bytes} bytes of EXIF${info.gps ? ' <b>incl. GPS location</b>' : ''}` : 'no metadata found'}${clean.facesBlurred ? `, blurred ${clean.facesBlurred} face(s)` : ''}. Size ${(image.length / 1024 * 0.75).toFixed(0)} KB.`;
        };
        $('#pf', m).onsubmit = async (e) => {
          e.preventDefault(); const f = e.target;
          try { await api('/api/posts', { method: 'POST', body: { title: f.title.value, body: f.body.value, diseaseId: f.dz.value || null, image } }); close(); toast('Story published! 🌿'); loadPosts(); profile.refresh(); } catch { /* toast */ }
        };
      }
    });
  };

  /* ---------------- Leaderboard ---------------- */
  async function loadLB() {
    try { lbData = await api(`/api/leaderboard?range=${lbRange}`, { quiet: true }); renderLB(); } catch { $('#lb').innerHTML = '<p class="muted small">Offline.</p>'; }
  }
  function renderLB() {
    if (!lbData) return;
    const me = profile.user?.id;
    $('#lb').innerHTML = lbTab === 'agents'
      ? lbData.users.map((u, i) => `<div class="lb-row" style="${u.id === me ? 'outline:2px solid var(--primary)' : ''}"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span><div class="avatar">${esc(u.avatar)}</div><div><b>${esc(u.nickname)}</b><div class="small muted">${esc(u.school || '')} ${u.badges.join('')}</div></div><span class="lb-pts">${u.points}</span></div>`).join('') || '<p class="muted small">No activity yet this week.</p>'
      : lbData.schools.map((s, i) => `<div class="lb-row" style="grid-template-columns:34px 1fr auto"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span><b>🏫 ${esc(s.school)}</b><span class="lb-pts">${s.points}</span></div>`).join('') || '<p class="muted small">No schools yet.</p>';
  }
  $$('#lb-range button').forEach((b) => b.onclick = () => { $$('#lb-range button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); lbRange = b.dataset.r; loadLB(); });
  $$('.tabs button[data-t]').forEach((b) => b.onclick = () => { $$('.tabs button[data-t]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); lbTab = b.dataset.t; renderLB(); });

  /* ---------------- Quiz (Feature #6) ---------------- */
  let qs = []; let qi = 0; const answers = [];
  $('#quiz-start').onclick = startQuiz;
  async function startQuiz() {
    try { qs = await api('/api/quiz'); } catch { return; }
    qi = 0; answers.length = 0; showQ();
  }
  function showQ() {
    const q = qs[qi];
    $('#quiz').innerHTML = `<div class="row between small muted" style="margin-bottom:8px"><span>Mission ${qi + 1} / ${qs.length}</span><span>${'●'.repeat(qi + 1)}${'○'.repeat(qs.length - qi - 1)}</span></div>
      ${q.kind === 'image' ? '<canvas class="quiz-img" id="qimg"></canvas>' : ''}
      <b style="display:block;margin-bottom:12px">${esc(q.q)}</b>
      ${q.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${String.fromCharCode(65 + i)}. ${esc(o)}</button>`).join('')}`;
    if (q.kind === 'image') window.AgraSamples.draw($('#qimg'), q.sample.disease, q.sample.seed, { size: 256, augment: false });
    $$('.quiz-opt').forEach((b) => b.onclick = () => {
      answers.push({ id: q.id, choice: +b.dataset.i }); b.classList.add('picked');
      $$('.quiz-opt').forEach((x) => { x.disabled = true; });
      setTimeout(() => { qi++; if (qi < qs.length) showQ(); else finish(); }, 380);
    });
  }
  async function finish() {
    try {
      const r = await api('/api/quiz/submit', { method: 'POST', body: { answers } });
      const pct = Math.round((r.correct / r.total) * 100);
      $('#quiz').innerHTML = `<div class="center"><div style="font-size:3rem">${pct >= 80 ? '🏆' : pct >= 50 ? '🎖️' : '🌱'}</div><h3>${r.correct} / ${r.total} correct</h3><p class="muted small">${pct >= 80 ? 'Outstanding, Agent! Certified Bio-Agent material.' : pct >= 50 ? 'Good work — review the explanations below.' : 'Keep training — every expert started here.'}${r.awarded ? ` <b>+${r.awarded} points</b>` : profile.token ? '' : ' <a href="#" id="join">Join to earn points</a>'}</p></div>
        <div class="stack small">${r.graded.map((g, i) => { const q = qs.find((x) => x.id === g.id); return `<div class="card flat" style="padding:12px"><b>${g.correct ? '✅' : '❌'} ${esc(q.q)}</b><div class="muted">Answer: ${esc(q.options[g.answer])}. ${esc(g.explain)}</div></div>`; }).join('')}</div>
        <button class="btn btn-primary btn-block" style="margin-top:12px" id="again">🔁 New mission</button>`;
      $('#again').onclick = startQuiz;
      const j = $('#join'); if (j) j.onclick = (e) => { e.preventDefault(); profile.ensure(); };
      if (r.awarded) { profile.refresh(); loadLB(); }
    } catch { /* toast */ }
  }

  loadPosts(); loadLB();
  if (location.hash === '#quiz') $('#quiz-card').scrollIntoView();
})();
