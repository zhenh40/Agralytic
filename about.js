/* about page */
fetch('validation.json').then((r) => r.json()).then((rows) => {
  const { $, esc } = window.Agra;
  $('#validation').innerHTML = rows.length ? rows.map((v) => `<div class="card flat" style="padding:12px;margin-bottom:8px">${v.photo ? `<img src="${esc(v.photo)}" alt="" style="border-radius:10px;margin-bottom:8px">` : ''}<b>${esc(v.title)}</b><div class="small muted">${esc(v.date)} · verified by ${esc(v.verifiedBy)}</div><p class="small" style="margin:6px 0 0">${esc(v.result)}</p></div>`).join('')
    : '<div class="empty" style="padding:16px"><div class="ei">📋</div><p class="small">No field tests recorded yet. Add your verified trials to <span class="kbd">public/validation.json</span> (see README → “Boss Check”).</p></div>';
}).catch(() => {});
