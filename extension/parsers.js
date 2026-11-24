// Parsers PUROS sobre a string do HTML (sem DOM): rodam no offscreen, no
// scraper injetado nas abas e nos testes de node. Cobrem as lojas que
// deixaram de expor os anuncios como <a href> no markup:
//  - Estante Virtual: resultados vivem num JSON-LD schema.org (ItemList).
//  - Mercado Livre (frontend "search-nordic"): o HTML e um shell de SPA com o
//    estado da busca embutido em <script>; os cards .poly-card nao existem
//    mais no HTML servido.
// Tambem centraliza a deteccao de BLOQUEIO por assinatura de pagina de
// desafio: a mera presenca da biblioteca reCAPTCHA/hCaptcha NAO conta (o ML a
// carrega em toda pagina legitima, e era isso que rotulava busca boa de
// "bloqueado").
(function (root) {
  'use strict';

  // Tetos: HTML de loja e input de terceiro; sem teto, um estado gigante ou
  // um JSON fundo demais viraria DoS no navegador do usuario.
  const CAPS = {
    scriptLen: 3_000_000,
    scripts: 400,
    items: 60,
    depth: 14,
    nodes: 300_000,
    titleMin: 4,
  };

  // Assinaturas de pagina de desafio/recusa REAL, colhidas de amostras:
  //  - suspicious-traffic-frontend: pagina de verificacao do Mercado Livre
  //  - hubo un error accediendo / algo deu errado: erro generico do ML ao fetch
  //  - shieldsquare / perfdrive: captcha da Estante Virtual
  //  - validateCaptcha / robot check / api-services-support: robot page da Amazon
  //  - captcha-delivery.com: desafio DataDome (OLX)
  //  - cf_chl_ / cf-browser-verification: interstitial do Cloudflare
  const BLOCK_RE = /suspicious-traffic-frontend|hubo un error accediendo|algo deu errado|shieldsquare|perfdrive|captcha-delivery\.com|cf_chl_|cf-browser-verification|\/errors\/validateCaptcha|opfcaptcha|robot check|are you a robot|api-services-support@amazon\.com/i;

  function looksBlocked(html) {
    return BLOCK_RE.test(String(html || '').slice(0, 60000));
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 350);
  }

  function fmtBRL(value) {
    const v = Number(value);
    if (!isFinite(v) || v <= 0) return null;
    return 'R$ ' + v.toFixed(2).replace('.', ',');
  }

  function scriptsOf(html) {
    const out = [];
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) && out.length < CAPS.scripts) {
      const text = m[1];
      if (!text || text.length > CAPS.scriptLen) continue;
      out.push({ open: m[0].slice(0, m[0].indexOf('>') + 1), text });
    }
    return out;
  }

  // --- JSON-LD (Estante Virtual e qualquer loja que publique ItemList) ---

  function jsonLdItems(html) {
    const out = [];
    for (const s of scriptsOf(html)) {
      if (!/application\/ld\+json/i.test(s.open)) continue;
      let data;
      try { data = JSON.parse(s.text.trim()); } catch { continue; }
      collectLd(data, out, 0);
      if (out.length >= CAPS.items) break;
    }
    return dedupe(out).slice(0, CAPS.items);
  }

  function collectLd(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > CAPS.depth || out.length >= CAPS.items) return;
    if (Array.isArray(node)) {
      for (const el of node) collectLd(el, out, depth + 1);
      return;
    }
    if (Array.isArray(node['@graph'])) collectLd(node['@graph'], out, depth + 1);
    if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
      for (const el of node.itemListElement) {
        if (out.length >= CAPS.items) break;
        const item = (el && typeof el === 'object' && el.item) || el;
        pushLdProduct(item, out);
      }
      return;
    }
    pushLdProduct(node, out);
  }

  function pushLdProduct(item, out) {
    if (!item || typeof item !== 'object' || item['@type'] !== 'Product') return;
    const url = typeof item.url === 'string' ? item.url.split('#')[0] : null;
    const title = clean(item.name);
    if (!url || !/^https:\/\//.test(url) || title.length < CAPS.titleMin) return;
    let offers = item.offers;
    if (Array.isArray(offers)) offers = offers[0];
    const price = offers && typeof offers === 'object' ? (offers.price ?? offers.lowPrice) : null;
    out.push({ title, priceText: fmtBRL(price), url, seller: null, extra: null });
  }

  // --- Estado embutido do Mercado Livre (search-nordic) ---

  // O frontend "search-nordic" do ML nao poe os cards no HTML: embute o estado
  // da busca num script como `_n.ctx.s.q("0:{...}")` - a string e um JSON
  // serializado com referencias (`@123`, refs de letra unica como `u`,
  // `undefined`/`NaN`). Os campos que queremos (titulo/preco/url) sao LITERAIS
  // inline, entao neutralizamos os tokens nao-JSON (viram null) e parseamos,
  // sem reimplementar o desserializador do ML. Cada produto e um "polycard"
  // (objeto com `components` + `metadata`).
  function mlStateItems(html) {
    const out = [];
    for (const frag of mlFragments(html)) {
      const data = parseState(frag);
      if (data === undefined) continue;
      walkPolycards(data, out, 0, { nodes: 0 });
      if (out.length >= CAPS.items) break;
    }
    return dedupe(out).slice(0, CAPS.items);
  }

  // Extrai o payload JSON do estado embutido. O ML ja trocou o nome da funcao
  // que recebe o estado (`_n.ctx.s.q("0:{...}")` ate out/2026, depois outro
  // formato), entao nao dependemos do nome: qualquer literal de string passado
  // como argumento `("...")` que seja grande e mencione anuncio (polycard ou
  // item_offered) e candidato. O literal e JS escapado; JSON.parse desescapa.
  function mlFragments(html) {
    const frags = [];
    const re = /\(\s*"/g;
    let m;
    while ((m = re.exec(html)) && frags.length < CAPS.scripts) {
      const litStart = m.index + m[0].length - 1; // aponta pro "
      const litEnd = endOfJsString(html, litStart);
      if (litEnd === -1) break;
      re.lastIndex = litEnd + 1;
      const len = litEnd - litStart;
      if (len < 200 || len > CAPS.scriptLen) continue;
      const raw = html.slice(litStart, litEnd + 1);
      if (raw.indexOf('polycard') === -1 && raw.indexOf('item_offered') === -1) continue;
      let s;
      try { s = JSON.parse(raw); } catch { continue; }
      // prefixo de chunk ("0:", "1a:") antes do JSON
      const pre = /^[\w$]{1,10}:/.exec(s);
      frags.push(pre ? s.slice(pre[0].length) : s);
    }
    return frags;
  }

  function parseState(frag) {
    const text = neutralizeRefs(frag);
    try { return JSON.parse(text); } catch { /* tenta do primeiro { ou [ */ }
    const at = text.search(/[{[]/);
    if (at > 0 && at < 40) {
      try { return JSON.parse(text.slice(at)); } catch { /* desiste */ }
    }
    return undefined;
  }

  // Fim de um literal de string JS/JSON comecando em `start` (que e a aspa
  // de abertura), respeitando escapes.
  function endOfJsString(text, start) {
    for (let i = start + 1; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '"') return i;
    }
    return -1;
  }

  // Troca por `null` os tokens que o ML usa e que nao sao JSON valido, so em
  // POSICAO DE VALOR (apos `:` `,` `[`). Valores string comecam com `"` e
  // nunca sao tocados; `true/false/null` sao preservados.
  function neutralizeRefs(payload) {
    return payload
      .replace(/@\d+/g, 'null')
      .replace(/(?<=[:,[])(?!(?:true|false|null)\b)[A-Za-z_$][\w$]*/g, 'null');
  }

  function walkPolycards(node, out, depth, budget) {
    if (!node || typeof node !== 'object') return;
    if (depth > CAPS.depth || budget.nodes++ > CAPS.nodes || out.length >= CAPS.items) return;
    if (!Array.isArray(node) && Array.isArray(node.components) && node.metadata && typeof node.metadata === 'object') {
      const card = readPolycard(node);
      if (card) out.push(card);
    } else if (!Array.isArray(node) && node.item_offered && typeof node.item_offered === 'object') {
      const card = readOfferedProduct(node);
      if (card) out.push(card);
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const v = node[key];
      if (v && typeof v === 'object') walkPolycards(v, out, depth + 1, budget);
    }
  }

  // Formato visto em out/2026: produtos estilo schema.org dentro do estado,
  // {id:"MLB...", name, type:"Product", item_offered:{price, url}}.
  function readOfferedProduct(node) {
    const off = node.item_offered;
    const title = typeof node.name === 'string' ? clean(node.name) : null;
    const url = mlUrl(off.url);
    if (!title || title.length < CAPS.titleMin || !url) return null;
    const priceText = fmtBRL(off.price);
    if (!priceText) return null;
    return { title, priceText, url, seller: null, extra: null };
  }

  // Normaliza url do ML vinda do estado: completa esquema em url "nua", so
  // aceita host do proprio ML e descarta o que passar do teto do backend.
  function mlUrl(value) {
    let url = typeof value === 'string' ? value.split('#')[0] : null;
    // so prefixa https em url "nua" (sem esquema); url com esquema :// fica
    // como esta - assim um valor envenenado tipo "javascript:..." nao vira
    // https falso
    if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[a-z]+:/i.test(url)) {
      url = 'https://' + url.replace(/^\/+/, '');
    }
    // defesa na origem: o parser do ML so emite host do proprio ML (o backend
    // re-checa com url_allowed, mas nao emitir lixo e o principio)
    if (!url || !/^https:\/\/([\w-]+\.)*mercadoli(vre|bre)\.com(\.br)?(\/|$)/i.test(url)) return null;
    return canonicalUrl('mercadolivre', url);
  }

  function readPolycard(node) {
    const md = node.metadata || {};
    let title = null;
    let price = null;
    for (const c of node.components) {
      if (!c || typeof c !== 'object') continue;
      if (c.type === 'title' && c.title && typeof c.title.text === 'string') title = clean(c.title.text);
      if (c.type === 'price' && c.price && c.price.current_price && price == null) price = c.price.current_price.value;
    }
    if (price == null && md.signal && typeof md.signal === 'object') price = md.signal.price;
    const url = mlUrl(md.url);
    if (!title || title.length < CAPS.titleMin || !url) return null;
    const priceText = fmtBRL(price);
    // sem preco E sem cara de anuncio de produto (MLB...) e card de navegacao,
    // nao oferta - fica de fora
    if (!priceText && !/MLB-?\d{6,}|\/MLB\d+|count/.test(url)) return null;
    return { title, priceText, url, seller: null, extra: null };
  }

  // Teto do backend para url de anuncio (acima disso o anuncio e descartado).
  const URL_MAX = 1000;

  // Url de anuncio limpa: no ML, link de produto perde a query de rastreio
  // (fica origem + caminho, que e o link permanente do anuncio); qualquer url
  // acima do teto do backend e descartada aqui (null) em vez de la.
  function canonicalUrl(store, url) {
    if (typeof url !== 'string') return null;
    if (store === 'mercadolivre') {
      try {
        const u = new URL(url);
        if (/MLB[U-]?\d{6,}/.test(u.pathname)) url = u.origin + u.pathname;
      } catch { return null; }
    }
    return url.length > URL_MAX ? null : url;
  }

  // Loja que so mostra a busca para quem esta logado nela: a Shopee manda o
  // visitante deslogado para /verify/traffic ou para a tela de login.
  function loginWall(store, href) {
    if (store !== 'shopee' || typeof href !== 'string') return false;
    return /^https:\/\/([\w-]+\.)*shopee\.com\.br\/(verify\/traffic|buyer\/login)/i.test(href);
  }

  function dedupe(items) {
    const seen = new Set();
    return items.filter((i) => {
      let key;
      try { key = new URL(i.url).origin + new URL(i.url).pathname; } catch { key = i.url; }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Uniao das estrategias por loja. Roda DEPOIS do parser de DOM e ANTES do
  // fallback generico de ancoras.
  function storeItems(store, html) {
    let items = jsonLdItems(html);
    if (items.length === 0 && store === 'mercadolivre') items = mlStateItems(html);
    if (items.length === 0 && store === 'mercadolivre') items = mlLooseItems(html);
    return items;
  }

  // Ultimo recurso do ML, tolerante a estado cortado ou mal formado: le os
  // produtos {name, ..., item_offered:{price, ..., url}} direto do texto,
  // depois de desfazer UM nivel de escape de string JS. Entre o nome e o
  // preco pode haver objeto aninhado de um nivel (ex.: aggregate_rating). Validado contra as
  // amostras reais que a extensao enviou de set a out/2026 (29 a 48 anuncios
  // por pagina onde o parser estruturado dava zero). Quantificadores com teto
  // mantem a regex linear.
  const ML_LOOSE_RE = /"name":"([^"\\]{4,350})"(?:[^{}]|\{[^{}]{0,300}\}){0,800}?"item_offered":\{"price":(\d{1,7}(?:\.\d{1,2})?)[^{}]{0,300}?"url":"(https?:\/\/[^"\\\s]{8,900})"/g;

  function mlLooseItems(html) {
    const text = String(html || '')
      .slice(0, CAPS.scriptLen * 3)
      .replace(/\\"/g, '"')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const out = [];
    ML_LOOSE_RE.lastIndex = 0;
    let m;
    while ((m = ML_LOOSE_RE.exec(text)) && out.length < CAPS.items) {
      const title = clean(m[1]);
      const url = mlUrl(m[3]);
      const priceText = fmtBRL(m[2]);
      if (title.length >= CAPS.titleMin && url && priceText) {
        out.push({ title, priceText, url, seller: null, extra: null });
      }
    }
    return dedupe(out);
  }

  // Amostra de falha UTIL: o corte cego dos primeiros 150KB mandava so o
  // <head>; aqui vao o inicio da pagina + as regioes onde os dados moram
  // (JSON-LD, permalink, estado embutido), cada uma marcada com o offset real.
  function buildSample(html, cap) {
    cap = cap || 150_000;
    html = String(html || '');
    if (html.length <= cap) return html;
    const marks = [];
    const re = /application\/ld\+json|__PRELOADED_STATE__|"permalink"|"item_list_name"|"itemListElement"|item_offered|polycard_client/g;
    let m;
    while ((m = re.exec(html)) && marks.length < 40) marks.push(m.index);
    const head = html.slice(0, 50_000);
    let budget = cap - head.length;
    const taken = [];
    const chunks = [];
    for (const idx of marks) {
      if (budget <= 2000) break;
      const start = Math.max(0, idx - 2000);
      const end = Math.min(html.length, idx + 30_000);
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      const chunk = html.slice(start, Math.min(end, start + budget));
      taken.push([start, start + chunk.length]);
      chunks.push('\n<!--FARO-CUT@' + start + '-->\n' + chunk);
      budget -= chunk.length;
    }
    if (chunks.length === 0) {
      const mark = '\n<!--FARO-CUT-->\n';
      return head + mark + html.slice(-(cap - head.length - mark.length));
    }
    return (head + chunks.join('')).slice(0, cap);
  }

  const api = { looksBlocked, storeItems, jsonLdItems, mlStateItems, mlLooseItems, buildSample, neutralizeRefs, canonicalUrl, loginWall };
  root.FaroParsers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
