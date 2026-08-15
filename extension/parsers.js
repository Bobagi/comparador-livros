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
      let data;
      try { data = JSON.parse(neutralizeRefs(frag)); } catch { continue; }
      walkPolycards(data, out, 0, { nodes: 0 });
      if (out.length >= CAPS.items) break;
    }
    return dedupe(out).slice(0, CAPS.items);
  }

  // Extrai o payload JSON de cada `_n.ctx.s.q("N:...")` do HTML (a string e um
  // literal JS escapado; JSON.parse desescapa e resolve \uXXXX corretamente).
  function mlFragments(html) {
    const frags = [];
    const marker = '_n.ctx.s.q("';
    let from = 0;
    while (frags.length < CAPS.scripts) {
      const at = html.indexOf(marker, from);
      if (at === -1) break;
      const litStart = at + marker.length - 1; // aponta pro "
      const litEnd = endOfJsString(html, litStart);
      from = litEnd + 1;
      if (litEnd <= litStart || litEnd - litStart > CAPS.scriptLen) continue;
      let s;
      try { s = JSON.parse(html.slice(litStart, litEnd + 1)); } catch { continue; }
      const colon = s.indexOf(':');
      if (colon > 0 && colon < 12) frags.push(s.slice(colon + 1)); // tira o "N:"
    }
    return frags;
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
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const v = node[key];
      if (v && typeof v === 'object') walkPolycards(v, out, depth + 1, budget);
    }
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
    let url = typeof md.url === 'string' ? md.url.split('#')[0] : null;
    // so prefixa https em url "nua" (sem esquema); url com esquema :// fica como
    // esta - assim um valor envenenado tipo "javascript:..." nao vira https falso
    if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[a-z]+:/i.test(url)) {
      url = 'https://' + url.replace(/^\/+/, '');
    }
    // defesa na origem: o parser do ML so emite host do proprio ML (o backend
    // re-checa com url_allowed, mas nao emitir lixo e o principio)
    if (!title || title.length < CAPS.titleMin || !url ||
        !/^https:\/\/([\w-]+\.)*mercadoli(vre|bre)\.com(\.br)?(\/|$)/i.test(url)) return null;
    const priceText = fmtBRL(price);
    // sem preco E sem cara de anuncio de produto (MLB...) e card de navegacao,
    // nao oferta - fica de fora
    if (!priceText && !/MLB-?\d{6,}|\/MLB\d+|count/.test(url)) return null;
    return { title, priceText, url, seller: null, extra: null };
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
    return items;
  }

  // Amostra de falha UTIL: o corte cego dos primeiros 150KB mandava so o
  // <head>; aqui vao o inicio da pagina + as regioes onde os dados moram
  // (JSON-LD, permalink, estado embutido), cada uma marcada com o offset real.
  function buildSample(html, cap) {
    cap = cap || 150_000;
    html = String(html || '');
    if (html.length <= cap) return html;
    const marks = [];
    const re = /application\/ld\+json|__PRELOADED_STATE__|"permalink"|"item_list_name"|"itemListElement"/g;
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

  const api = { looksBlocked, storeItems, jsonLdItems, mlStateItems, buildSample, neutralizeRefs };
  root.FaroParsers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
