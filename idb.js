/*
 * Offline-first storage (Feature #10 + blueprint "Jika Offline: Simpan di IndexedDB").
 *  - history: every diagnosis the user made (thumbnail + result), kept on-device only
 *  - outbox:  anonymous reports waiting for a connection; flushed on 'online' / Background Sync
 */
(function () {
  'use strict';
  const DB = 'agralytic'; const VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('history')) d.createObjectStore('history', { keyPath: 'id' }).createIndex('at', 'at');
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const AgraDB = {
    async addHistory(item) { item.id = item.id || uid(); item.at = item.at || Date.now(); await tx('history', 'readwrite', (s) => s.put(item)); return item; },
    async history(limit = 50) { const all = await tx('history', 'readonly', (s) => s.getAll()); return (all || []).sort((a, b) => b.at - a.at).slice(0, limit); },
    async clearHistory() { await tx('history', 'readwrite', (s) => s.clear()); },
    async queue(report) { report.id = report.id || uid(); report.queuedAt = Date.now(); await tx('outbox', 'readwrite', (s) => s.put(report)); return report; },
    async outbox() { return (await tx('outbox', 'readonly', (s) => s.getAll())) || []; },
    async remove(id) { await tx('outbox', 'readwrite', (s) => s.delete(id)); },
    /** Send queued reports. Returns number synced. */
    async flush() {
      if (!navigator.onLine) return 0;
      const items = await this.outbox(); let ok = 0;
      for (const it of items) {
        try {
          const body = { ...it.payload, offlineQueued: true };
          const headers = { 'Content-Type': 'application/json' };
          const tok = window.Agra?.store.get('token'); if (tok) headers['X-Agra-Token'] = tok;
          const r = await fetch('/api/scans', { method: 'POST', headers, body: JSON.stringify(body) });
          if (r.ok || r.status === 400) { await this.remove(it.id); ok++; }
        } catch { break; }
      }
      return ok;
    }
  };
  window.addEventListener('agra:sync', async () => {
    const n = await AgraDB.flush().catch(() => 0);
    if (n && window.Agra) window.Agra.toast(`✅ ${n} offline scan report${n > 1 ? 's' : ''} synced to the Outbreak Radar`);
    window.dispatchEvent(new CustomEvent('agra:synced', { detail: n }));
  });
  window.AgraDB = AgraDB;
})();
