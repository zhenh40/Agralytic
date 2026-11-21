/* Marketplace / Seed Swap page */
(function () {
  'use strict';
  const { $, $$, esc, api, toast, modal, profile, getLocation, timeAgo } = window.Agra;
  let cat = ''; let rows = []; let loc = null;
  const TYPE = { give: ['🎁', 'Free'], swap: ['🔄', 'Swap'], sell: ['🏷️', 'For sale'], request: ['🙋', 'Wanted'] };
  const CAT = { kitchen: '🥚', seeds: '🌱', harvest: '🧺', tools: '🧰' };

  async function load() {
    try {
      rows = await api(`/api/listings?${cat ? 'category=' + cat + '&' : ''}${loc ? `lat=${loc.lat}&lng=${loc.lng}` : ''}`, { quiet: true });
      render();
    } catch { $('#list').innerHTML = '<div class="card empty"><div class="ei">📴</div>Marketplace needs a connection.</div>'; }
  }
  function render() {
    const show = $('#mine').checked ? rows.filter((r) => r.mine) : rows;
    ['give', 'swap', 'sell', 'request'].forEach((t, i) => { $(['#k-give', '#k-swap', '#k-sell', '#k-req'][i]).textContent = rows.filter((r) => r.type === t).length; });
    $('#list').innerHTML = show.length ? show.map((r) => `<div class="card listing hover">
      <div class="row between"><div class="lt type-${r.type}">${CAT[r.category] || '📦'}</div><div class="row"><span class="chip">${TYPE[r.type][0]} ${TYPE[r.type][1]}</span>${r.status === 'reserved' ? '<span class="chip amber">Reserved</span>' : ''}</div></div>
      <h3 style="margin:0">${esc(r.title)}</h3><p class="small muted" style="margin:0">${esc(r.description)}</p>
      <div class="row between small"><span>${esc(r.author.avatar)} ${esc(r.author.nickname)}</span><span class="muted">${r.distanceKm !== null ? `📍 ${r.distanceKm} km` : ''} · ${timeAgo(r.createdAt)}</span></div>
      <div class="row between">${r.type === 'sell' ? `<span class="price">${Number(r.price).toLocaleString()}</span>` : '<span class="price grad-text">Free</span>'}
        ${r.mine ? `<div class="row"><button class="btn btn-sm" data-st="${r.id}" data-v="${r.status === 'open' ? 'reserved' : 'open'}">${r.status === 'open' ? 'Mark reserved' : 'Reopen'}</button><button class="btn btn-sm btn-ghost" data-st="${r.id}" data-v="closed">Close</button></div>` : `<button class="btn btn-sm btn-primary" data-req="${r.id}">${r.type === 'request' ? 'I can help' : 'Request'}</button>`}</div>
      ${r.mine && r.requests && r.requests.length ? `<div class="card flat small" style="padding:10px"><b>📨 ${r.requests.length} request(s)</b>${r.requests.map((q) => `<div>• <b>${esc(q.from)}</b>: ${esc(q.message)}</div>`).join('')}</div>` : ''}
    </div>`).join('') : '<div class="card empty" style="grid-column:1/-1"><div class="ei">🧺</div>Nothing here yet. Be the first to share!</div>';
    $$('[data-req]').forEach((b) => b.onclick = () => request(b.dataset.req));
    $$('[data-st]').forEach((b) => b.onclick = async () => { try { await api(`/api/listings/${b.dataset.st}/status`, { method: 'POST', body: { status: b.dataset.v } }); load(); } catch { /* toast */ } });
  }
  async function request(id) {
    await profile.ensure('to contact neighbours safely'); if (!profile.token) return;
    const r = rows.find((x) => x.id === id);
    modal(`<h2>📨 Message ${esc(r.author.nickname)}</h2><p class="muted small">About: <b>${esc(r.title)}</b>. Don’t share your phone number or home address — suggest a public meeting point.</p>
      <textarea class="input" id="msg" maxlength="300">Hi! I’d love this for my organic remedy. Could we meet at the community garden on Saturday?</textarea>
      <button class="btn btn-primary btn-block" id="send" style="margin-top:12px">Send request</button>`, {
      onMount(m, close) { $('#send', m).onclick = async () => { try { await api(`/api/listings/${id}/request`, { method: 'POST', body: { message: $('#msg', m).value } }); close(); toast('Request sent! The owner will see it in their listing.'); } catch { /* toast */ } }; }
    });
  }
  $('#new').onclick = async () => {
    await profile.ensure('to create a listing'); if (!profile.token) return;
    modal(`<h2>➕ New listing</h2><form id="lf">
      <div class="grid g2" style="gap:10px"><div class="field"><label class="f">Type</label><select class="input" name="type"><option value="give">🎁 Give for free</option><option value="swap">🔄 Swap</option><option value="sell">🏷️ Sell</option><option value="request">🙋 I need…</option></select></div>
      <div class="field"><label class="f">Category</label><select class="input" name="category"><option value="kitchen">🥚 Kitchen waste</option><option value="seeds">🌱 Seeds</option><option value="harvest">🧺 Harvest</option><option value="tools">🧰 Tools</option></select></div></div>
      <div class="field"><label class="f">Title</label><input class="input" name="title" required maxlength="80" placeholder="e.g. Banana peels, 1 kg / week"></div>
      <div class="field"><label class="f">Description</label><textarea class="input" name="description" maxlength="400"></textarea></div>
      <div class="field hidden" id="price-f"><label class="f">Price (local currency)</label><input class="input" type="number" name="price" min="0"></div>
      <button class="btn btn-primary btn-block">Publish (+8 points)</button></form>`, {
      onMount(m, close) {
        const f = $('#lf', m);
        f.type.onchange = () => $('#price-f', m).classList.toggle('hidden', f.type.value !== 'sell');
        f.onsubmit = async (e) => {
          e.preventDefault();
          try { await api('/api/listings', { method: 'POST', body: { type: f.type.value, category: f.category.value, title: f.title.value, description: f.description.value, price: f.price.value, lat: loc?.lat, lng: loc?.lng } }); close(); toast('Listing published ♻️'); load(); profile.refresh(); } catch { /* toast */ }
        };
      }
    });
  };
  $$('#cat button').forEach((b) => b.onclick = () => { $$('#cat button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); cat = b.dataset.c; load(); });
  $('#mine').onchange = render;
  getLocation({ prompt: true }).then((l) => { loc = l; load(); });
})();
