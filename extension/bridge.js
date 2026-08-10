// Ponte entre a pagina livros.bobagi.space e o service worker da extensao.
// Mundos isolados: todo payload de evento trafega como JSON string.
(() => {
  'use strict';

  function announce() {
    document.dispatchEvent(new CustomEvent('livros:ext-ready', {
      detail: JSON.stringify({ version: chrome.runtime.getManifest().version }),
    }));
  }

  document.addEventListener('livros:ping', announce);
  announce();

  document.addEventListener('livros:collect', (ev) => {
    let job = null;
    try { job = JSON.parse(ev.detail || 'null'); } catch { return; }
    if (!job || typeof job.searchId !== 'string' || typeof job.query !== 'string') return;
    chrome.runtime.sendMessage({ type: 'collect', job: { searchId: job.searchId, query: job.query } })
      .catch(() => {});
  });
})();
