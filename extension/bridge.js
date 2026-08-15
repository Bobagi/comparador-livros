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

  // O site pede uma checagem de atualizacao; devolvemos o status por evento.
  document.addEventListener('livros:check-update', () => {
    const emit = (detail) => document.dispatchEvent(
      new CustomEvent('livros:update-status', { detail: JSON.stringify(detail) }));
    try {
      chrome.runtime.sendMessage({ type: 'checkUpdate' })
        .then((res) => emit(res || { status: 'error' }))
        .catch(() => emit({ status: 'error' }));
    } catch {
      // contexto da extensao invalidado (ela acabou de recarregar): recarregar
      // a pagina reconecta na versao nova
      emit({ status: 'error' });
    }
  });
})();
