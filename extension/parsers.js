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

  function mlStateItems(html) {
    const out = [];
    for (const s of scriptsOf(html)) {
      if (s.text.indexOf('"permalink"') === -1) continue;
      const data = extractFirstJson(s.text);
      if (!data) continue;
      walkMl(data, out, 0, { nodes: 0 });
      if (out.length >= CAPS.items) break;
    }
    return dedupe(out).slice(0, CAPS.items);
  }

  // Extrai o primeiro objeto JSON balanceado do texto do script
  // (window.__X__ = {...}; possivelmente seguido de mais codigo).
  function extractFirstJson(text) {
    let from = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = text.indexOf('{', from);
      if (start === -1) return null;
      const raw = balancedSlice(text, start);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { from = start + 1; }
    }
    return null;
  }

  function balancedSlice(text, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function walkMl(node, out, depth, budget) {
    if (!node || typeof node !== 'object') return;
    if (depth > CAPS.depth || budget.nodes++ > CAPS.nodes || out.length >= CAPS.items) return;
    if (!Array.isArray(node)) {
      const url = typeof node.permalink === 'string' ? node.permalink.split('#')[0] : null;
      const title = clean(node.title || node.name);
      if (url && /^https:\/\//.test(url) && title.length >= CAPS.titleMin) {
        const priceText = mlPrice(node);
        // Sem preco e sem cara de anuncio (MLB...), e link de navegacao
        // (categoria/busca relacionada), nao produto: fica de fora.
        if (priceText || /MLB-?\d{6,}|\/p\/MLB\d+|\/up\/MLBU\d+/.test(url)) {
          const seller = clean(node.official_store_name || (node.seller_info && node.seller_info.name) || '');
          out.push({ title, priceText, url, seller: seller || null, extra: null });
        }
      }
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const v = node[key];
      if (v && typeof v === 'object') walkMl(v, out, depth + 1, budget);
    }
  }

  function mlPrice(node) {
    if (node.sale_price && typeof node.sale_price === 'object' && node.sale_price.amount != null) {
      return fmtBRL(node.sale_price.amount);
    }
    if (typeof node.price === 'number') return fmtBRL(node.price);
    if (node.price && typeof node.price === 'object' && node.price.amount != null) {
      return fmtBRL(node.price.amount);
    }
    const list = node.prices && Array.isArray(node.prices.prices) ? node.prices.prices : null;
    if (list && list.length) {
      const amounts = list.map((p) => p && p.amount).filter((a) => typeof a === 'number' && a > 0);
      if (amounts.length) return fmtBRL(Math.min.apply(null, amounts));
    }
    return null;
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

  const api = { looksBlocked, storeItems, jsonLdItems, mlStateItems, buildSample, extractFirstJson };
  root.FaroParsers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
