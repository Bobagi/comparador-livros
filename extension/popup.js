// Popup da action: abre o site do Farolivro, opcionalmente ja buscando.
// A URL e montada como PREFIXO_FIXO (CONFIG.backend, literal) + '/?q=' +
// encodeURIComponent(query): o host/esquema nunca vem do input, e o
// encodeURIComponent neutraliza qualquer caractere especial -> sem injecao.
import { CONFIG } from './config.js';
import { buildSiteUrl } from './urls.js';

const form = document.getElementById('f');
const input = document.getElementById('q');
const openBtn = document.getElementById('open');

function openSite(query) {
  chrome.tabs.create({ url: buildSiteUrl(CONFIG.backend, query) });
  window.close();
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = input.value.trim();
  if (q.length < 3) return;
  openSite(q);
});

openBtn.addEventListener('click', () => openSite(''));
