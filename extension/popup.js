// Popup da action: abre o site do Farolivro, opcionalmente ja buscando.
// A URL e montada como PREFIXO_FIXO (CONFIG.backend, literal) + '/?q=' +
// encodeURIComponent(query): o host/esquema nunca vem do input, e o
// encodeURIComponent neutraliza qualquer caractere especial -> sem injecao.
import { CONFIG } from './config.js';
import { buildSiteUrl, updateStatusText } from './urls.js';

const form = document.getElementById('f');
const input = document.getElementById('q');
const openBtn = document.getElementById('open');
const updBtn = document.getElementById('upd-btn');
const updMsg = document.getElementById('upd-msg');
const verEl = document.getElementById('ver');

verEl.textContent = 'v' + chrome.runtime.getManifest().version;

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

function showMsg(text) {
  updMsg.textContent = text;
  updMsg.hidden = !text;
}

// "Verificar atualizacao": pergunta a loja e, se houver versao nova, aplica na
// hora (o proprio Chrome ja atualiza sozinho; isto so adianta para "agora").
updBtn.addEventListener('click', () => {
  updBtn.disabled = true;
  showMsg('Checando...');
  new Promise((resolve) => {
    try {
      chrome.runtime.requestUpdateCheck((status, details) => resolve({ status, details }));
    } catch {
      resolve({ status: 'error', details: null });
    }
  }).then(({ status, details }) => {
    showMsg(updateStatusText(status, details && details.version));
    if (status === 'update_available') {
      // reload aplica a versao baixada; o popup fecha junto
      setTimeout(() => { try { chrome.runtime.reload(); } catch { /* noop */ } }, 700);
    } else {
      updBtn.disabled = false;
    }
  });
});
