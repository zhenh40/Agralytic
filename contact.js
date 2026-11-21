/* contact page */
(function () {
  const { $, api, toast, esc } = window.Agra;
  $('#open-chat').onclick = () => window.Agra.chat.toggle(true);
  $('#cf').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/contact', { method: 'POST', body: { name: $('#n').value, email: $('#e').value, topic: $('#t').value, message: $('#m').value } }); $('#out').innerHTML = `<div class="banner safe"><span class="bi">✅</span><span class="grow">Thanks! Your ticket number is <b>#${esc(r.ticket)}</b>.</span></div>`; e.target.reset(); } catch { /* toast shown */ }
  };
  $('#wipe').onclick = async () => {
    if (!confirm('Delete scan history, schedule, chat and preferences stored on this device?')) return;
    await window.AgraDB.clearHistory().catch(() => {});
    Object.keys(localStorage).filter((k) => k.startsWith('agra.')).forEach((k) => localStorage.removeItem(k));
    toast('All on-device data deleted.');
  };
})();
