// Documento offscreen: unico lugar do service worker com DOMParser.
// Parsers por loja + fallback generico. Retorna sempre {items, diag}.
(() => {
  'use strict';

  const PRICE_RE = /R\$\s?\d[\d.\s]*(?:,\d{2})?/;

  const HREF_PATTERNS = {
    mercadolivre: /MLB-?\d{6,}|\/p\/MLB\d+|\/up\/MLBU\d+/,
    amazon: /\/dp\/[A-Z0-9]{10}/,
    estantevirtual: /\/livro\/|\/livros\//,
    olx: /-\d{7,}(?:[?#]|$)/,
    enjoei: /\/p\//,
    shopee: /-i\.\d+\.\d+/,
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'parse') return;
    try {
      sendResponse(parse(msg.store, msg.html || '', msg.base || ''));
    } catch (e) {
      sendResponse({ items: [], diag: { parser: 'exception', error: String(e).slice(0, 300) } });
    }
  });

  function parse(store, html, base) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const diag = {
      docTitle: (doc.title || '').slice(0, 120),
      captcha: FaroParsers.looksBlocked(html),
    };
    let items = [];
    let parser = 'generic';
    try {
      if (store === 'mercadolivre') { items = parseML(doc, base); parser = 'ml'; }
      else if (store === 'amazon') { items = parseAmazon(doc, base); parser = 'amazon'; }
      else if (store === 'olx') { items = parseOLX(doc, base, html); parser = 'olx-nextdata'; }
      else if (store === 'estantevirtual') { items = parseEV(doc, base); parser = 'ev'; }
    } catch (e) {
      diag.parserError = String(e).slice(0, 200);
    }
    if (items.length === 0) {
      // Lojas que embutem os anuncios em JSON (EV: JSON-LD; ML: estado da SPA)
      // em vez de expor <a href> no markup.
      items = FaroParsers.storeItems(store, html);
      if (items.length > 0) parser = parser + '+json';
    }
    if (items.length === 0) {
      items = generic(doc, base, HREF_PATTERNS[store]);
      parser = parser + '+generic';
    }
    return { items: items.slice(0, 60), diag: { ...diag, parser, itemCount: items.length } };
  }

  function abs(href, base) {
    try { return new URL(href, base).toString().split('#')[0]; } catch { return null; }
  }

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim().slice(0, 350);
  }

  function parseML(doc, base) {
    const out = [];
    const nodes = doc.querySelectorAll('li.ui-search-layout__item, .poly-card, .ui-search-result__wrapper');
    for (const n of nodes) {
      const titleEl = n.querySelector('.poly-component__title, h2.ui-search-item__title, .ui-search-item__title, h3');
      const linkEl = n.querySelector('a.poly-component__title, a.ui-search-link, a[href*="mercadolivre.com.br"]');
      const url = linkEl && abs(linkEl.getAttribute('href'), base);
      if (!titleEl || !url) continue;
      let priceText = null;
      const priceBox = n.querySelector('.poly-price__current, .ui-search-price__second-line, .ui-search-price');
      if (priceBox) {
        const frac = priceBox.querySelector('.andes-money-amount__fraction');
        const cents = priceBox.querySelector('.andes-money-amount__cents');
        if (frac) priceText = `R$ ${frac.textContent}${cents ? ',' + cents.textContent : ',00'}`;
      }
      if (!priceText) {
        const m = PRICE_RE.exec(n.textContent || '');
        priceText = m ? m[0] : null;
      }
      const seller = n.querySelector('.poly-component__seller, .ui-search-official-store-label');
      out.push({ title: clean(titleEl.textContent), priceText, url, seller: seller ? clean(seller.textContent).slice(0, 120) : null });
    }
    return dedupe(out);
  }

  function parseAmazon(doc, base) {
    const out = [];
    for (const n of doc.querySelectorAll('div[data-component-type="s-search-result"]')) {
      if (n.querySelector('.puis-sponsored-label-text, [data-component-type="sp-sponsored-result"]')) continue;
      const titleEl = n.querySelector('h2 span');
      const linkEl = n.querySelector('a[href*="/dp/"]');
      const url = linkEl && abs(linkEl.getAttribute('href'), base);
      if (!titleEl || !url) continue;
      const priceEl = n.querySelector('.a-price .a-offscreen');
      const extraEl = n.querySelector('.a-size-base.a-color-secondary, .a-row.a-size-base');
      out.push({
        title: clean(titleEl.textContent),
        priceText: priceEl ? clean(priceEl.textContent) : null,
        url,
        extra: extraEl ? clean(extraEl.textContent).slice(0, 300) : null,
      });
    }
    return dedupe(out);
  }

  function parseOLX(doc, base, html) {
    const script = doc.querySelector('script#__NEXT_DATA__');
    if (!script) return [];
    let data;
    try { data = JSON.parse(script.textContent); } catch { return []; }
    const props = (data && data.props && data.props.pageProps) || {};
    const ads = props.ads || (props.adListData && props.adListData.ads) || [];
    const out = [];
    for (const ad of ads) {
      const title = ad.subject || ad.title;
      const url = ad.url || ad.friendlyUrl;
      if (!title || !url) continue;
      out.push({
        title: clean(title),
        priceText: typeof ad.price === 'string' ? ad.price : (ad.priceValue || null),
        url: abs(url, base),
        seller: null,
        extra: clean([ad.location, ad.category].filter(Boolean).join(' ')).slice(0, 200) || null,
      });
    }
    return dedupe(out.filter((i) => i.url));
  }

  function parseEV(doc, base) {
    const out = [];
    for (const a of doc.querySelectorAll('a[href*="/livro/"], a[href*="/livros/"]')) {
      const url = abs(a.getAttribute('href'), base);
      if (!url) continue;
      const scope = a.closest('article, li, div') || a;
      const m = PRICE_RE.exec(scope.textContent || '');
      const title = clean(a.getAttribute('title') || a.textContent);
      if (!title || title.length < 4) continue;
      out.push({ title, priceText: m ? m[0] : null, url, extra: clean(scope.textContent).slice(0, 260) });
    }
    return dedupe(out);
  }

  function generic(doc, base, hrefRe) {
    if (!hrefRe) return [];
    const out = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      const url = abs(a.getAttribute('href'), base);
      if (!url || !hrefRe.test(url)) continue;
      let priceText = null;
      let cardText = '';
      let node = a;
      for (let up = 0; up < 3 && node; up++) {
        const text = node.textContent || '';
        if (text.length < 4000) {
          cardText = text;
          const m = PRICE_RE.exec(text);
          if (m) { priceText = m[0]; break; }
        }
        node = node.parentElement;
      }
      const img = a.querySelector('img[alt]');
      const title = clean((a.getAttribute('title') || (img && img.getAttribute('alt')) || a.textContent || '')
        .replace(PRICE_RE, ' '));
      if (!title || title.length < 4) continue;
      out.push({ title, priceText, url, extra: clean(cardText).slice(0, 260) || null });
    }
    return dedupe(out);
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
})();
