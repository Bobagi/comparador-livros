// Service worker: recebe um pedido de coleta da pagina, visita as lojas a
// partir do navegador do usuario (fetch ou aba de fundo), envia o resultado
// bruto ao backend e, quando um parser falha, envia amostra do HTML para
// calibracao. Nunca age sem um pedido explicito da pagina.
import { CONFIG } from './config.js';
import { pageAllowed } from './urls.js';
import './parsers.js'; // classic script: registra self.FaroParsers

const STORES = ['mercadolivre', 'amazon', 'estantevirtual', 'olx', 'enjoei', 'shopee'];
const TAB_ONLY = new Set(['enjoei', 'shopee']);

const queue = [];
let running = false;

// Credencial propria da instalacao: registrada no primeiro uso (o pacote da
// loja nao carrega segredo nenhum) e guardada no storage local.
async function getAuth(forceNew = false) {
  if (!forceNew) {
    const st = await chrome.storage.local.get(['installId', 'installToken']);
    if (st.installId && st.installToken) return { id: st.installId, token: st.installToken };
  }
  try {
    const r = await fetch(`${CONFIG.backend}/api/installs`, { method: 'POST' });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || !data.id || !data.token) return null;
    await chrome.storage.local.set({ installId: data.id, installToken: data.token });
    return { id: data.id, token: data.token };
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener(() => { getAuth().catch(() => {}); });

const PAGE_HOSTS = CONFIG.pageHosts || [CONFIG.backend];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !pageAllowed(PAGE_HOSTS, sender.url)) return;
  if (msg.type === 'collect') {
    queue.push(msg.job);
    runQueue();
    return;
  }
  if (msg.type === 'checkUpdate') {
    runUpdateCheck().then(sendResponse);
    return true; // resposta assincrona
  }
});

// Pede ao Chrome para checar a loja por uma versao mais nova E, se houver,
// aplica na hora (reload da extensao) em vez de esperar o auto-update passivo.
// So funciona para a extensao instalada PELA loja; em modo desenvolvedor a API
// lanca e caimos no status 'error' (tratado como texto amigavel no cliente).
async function runUpdateCheck() {
  const current = chrome.runtime.getManifest().version;
  const { status, details } = await new Promise((resolve) => {
    try {
      chrome.runtime.requestUpdateCheck((st, dt) => resolve({ status: st, details: dt }));
    } catch {
      resolve({ status: 'error', details: null });
    }
  });
  if (status === 'update_available') {
    // responde primeiro; o reload derruba o service worker
    setTimeout(() => { try { chrome.runtime.reload(); } catch { /* noop */ } }, 500);
    return { status, current, version: (details && details.version) || null };
  }
  return { status: status || 'error', current };
}

async function runQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      await runJob(job);
    }
  } finally {
    running = false;
  }
}

function searchUrl(store, query) {
  const enc = encodeURIComponent(query);
  switch (store) {
    case 'mercadolivre': {
      const slug = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, '-');
      return `https://lista.mercadolivre.com.br/${slug}`;
    }
    case 'amazon': return `https://www.amazon.com.br/s?k=${enc}&i=stripbooks`;
    case 'estantevirtual': return `https://www.estantevirtual.com.br/busca?q=${enc}`;
    case 'olx': return `https://www.olx.com.br/brasil?q=${enc}`;
    case 'enjoei': return `https://www.enjoei.com.br/s?q=${enc}`;
    case 'shopee': return `https://shopee.com.br/search?keyword=${enc}`;
  }
}

// Lojas em paralelo (ate 3 por vez): em uso real a coleta sequencial das 6
// passou de 200 s e o site desistia antes. Cada loja e um host diferente, entao
// o paralelismo nao aumenta o ritmo de pedidos em nenhuma delas. Aba de fundo
// continua uma por vez (trava abaixo) para nao abrir varias abas no navegador.
const PARALLEL = 3;

async function runJob(job) {
  const pending = [...STORES];
  async function worker() {
    while (pending.length) {
      const store = pending.shift();
      let payload;
      try {
        payload = await collectStore(store, job.query);
      } catch (e) {
        payload = { status: 'error', listings: [], diag: { error: String(e).slice(0, 300) } };
      }
      await postResults(job.searchId, store, payload);
      await sleep(300 + Math.random() * 700);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

let tabChain = Promise.resolve();
function withTabLock(fn) {
  const run = tabChain.then(fn, fn);
  tabChain = run.catch(() => {});
  return run;
}

async function collectStore(store, query) {
  const url = searchUrl(store, query);
  if (!TAB_ONLY.has(store)) {
    const viaFetch = await tryFetch(store, url);
    if (viaFetch.status === 'ok') return viaFetch;
    // fetch nao rendeu (SPA, parser falhou ou desafio anti-bot que uma aba
    // real resolve sozinha): tenta aba de fundo antes de desistir
    const viaTab = await tryTab(store, url);
    if (viaTab.status === 'ok') return viaTab;
    viaTab.diag = { ...viaFetch.diag, fallback: true, ...viaTab.diag };
    if (!viaTab.sampleHtml) viaTab.sampleHtml = viaFetch.sampleHtml;
    // bloqueio confirmado no fetch vence um "empty"/"error" inconclusivo da aba
    if (viaFetch.status === 'blocked' && viaTab.status !== 'blocked') viaTab.status = 'blocked';
    return viaTab;
  }
  return tryTab(store, url);
}

async function tryFetch(store, url) {
  let resp, html;
  try {
    resp = await fetch(url, {
      credentials: 'include',
      headers: { 'accept-language': 'pt-BR,pt;q=0.9' },
    });
    html = await resp.text();
  } catch (e) {
    return { status: 'error', listings: [], diag: { mode: 'fetch', error: String(e).slice(0, 300) } };
  }
  const diag = { mode: 'fetch', http: resp.status, htmlLen: html.length };
  // Primeiro tenta extrair: pagina com anuncios parseados e OK mesmo que
  // carregue a biblioteca de um captcha (o ML faz isso em toda pagina).
  const parsed = await parseInOffscreen(store, html, url);
  if (parsed.items.length > 0) {
    return { status: 'ok', listings: parsed.items, diag: { ...diag, ...parsed.diag } };
  }
  const blocked = resp.status === 403 || resp.status === 429 || self.FaroParsers.looksBlocked(html);
  return {
    status: blocked ? 'blocked' : 'empty',
    listings: [],
    diag: { ...diag, ...parsed.diag, captcha: blocked },
    sampleHtml: self.FaroParsers.buildSample(html),
  };
}

// Uma promessa so: com lojas em paralelo, duas chamadas simultaneas nao podem
// criar o documento duas vezes nem mandar o parse antes de ele existir.
let offscreenReady = null;
function ensureOffscreen() {
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Parse do HTML das paginas de busca das lojas',
    }).catch(() => { /* ja existe (service worker reiniciado): seguir */ });
  }
  return offscreenReady;
}

async function parseInOffscreen(store, html, base) {
  await ensureOffscreen();
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'parse', store, html, base });
  } catch (e) {
    resp = null;
  }
  return resp || { items: [], diag: { parser: 'sem resposta do offscreen' } };
}

function tryTab(store, url) {
  return withTabLock(() => tryTabNow(store, url));
}

async function tryTabNow(store, url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitTabComplete(tab.id, 25000);
    // O scraper NAO e content script declarado: e injetado so nas abas que a
    // propria extensao abre (nunca roda na navegacao normal do usuario).
    let injected = false;
    for (let i = 0; i < 6; i++) {
      await sleep(1500);
      try {
        if (!injected) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['parsers.js', 'scraper.js'] });
          injected = true;
        }
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'scrape', store, wantSample: i >= 4 });
        if (resp && resp.diag && resp.diag.loginWall) {
          // a loja so mostra a busca para quem esta logado nela: o site avisa
          // o usuario em vez de dizer "vazio"
          return { status: 'login', listings: [], diag: { mode: 'tab', loginWall: true } };
        }
        if (resp && resp.items && resp.items.length > 0) {
          return { status: 'ok', listings: resp.items, diag: { mode: 'tab', ...resp.diag } };
        }
        if (resp && i >= 4) {
          const blocked = resp.diag && resp.diag.captcha;
          return {
            status: blocked ? 'blocked' : 'empty',
            listings: [],
            diag: { mode: 'tab', ...resp.diag },
            sampleHtml: resp.sample || undefined,
          };
        }
      } catch {
        // pagina ainda carregando ou navegou (listener perdido): injeta de novo
        injected = false;
      }
    }
    return { status: 'error', listings: [], diag: { mode: 'tab', error: 'scraper nao respondeu' } };
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function postResults(searchId, store, payload) {
  const body = {
    store,
    status: payload.status,
    listings: (payload.listings || []).slice(0, 60),
    diag: payload.diag || {},
    sampleHtml: payload.status === 'ok' ? undefined : payload.sampleHtml,
  };
  let auth = await getAuth();
  for (let attempt = 0; attempt < 2 && auth; attempt++) {
    try {
      const r = await fetch(`${CONFIG.backend}/api/searches/${encodeURIComponent(searchId)}/results`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-livros-install': auth.id,
          'x-livros-key': auth.token,
        },
        body: JSON.stringify(body),
      });
      if (r.status !== 401) return;
      // credencial perdida no servidor: registra de novo e tenta uma vez
      auth = await getAuth(true);
    } catch (e) {
      console.warn('livros: falha ao enviar resultados', store, e);
      return;
    }
  }
  if (!auth) console.warn('livros: sem credencial de instalacao (backend fora do ar?)');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
