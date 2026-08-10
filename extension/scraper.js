// Content script das lojas. PASSIVO: so age quando o service worker manda
// {type:'scrape'} (aba aberta pela propria extensao). Nao le navegacao normal.
(() => {
  'use strict';

  const PRICE_RE = /R\$\s?\d[\d.\s]*(?:,\d{2})?/;
  const CAPTCHA_RE = /captcha|hcaptcha|recaptcha|shieldsquare|perfdrive|robot check|algo deu errado/i;

  const HREF_PATTERNS = {
    mercadolivre: /MLB-?\d{6,}|\/p\/MLB\d+|\/up\/MLBU\d+/,
    amazon: /\/dp\/[A-Z0-9]{10}/,
    estantevirtual: /\/livro\/|\/livros\//,
    olx: /-\d{7,}(?:[?#]|$)/,
    enjoei: /\/p\//,
    shopee: /-i\.\d+\.\d+/,
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'scrape') return;
    const items = extract(HREF_PATTERNS[msg.store]);
    const htmlHead = document.documentElement.outerHTML.slice(0, 60000);
    const resp = {
      items,
      diag: {
        docTitle: document.title.slice(0, 120),
        ready: document.readyState,
        captcha: CAPTCHA_RE.test(htmlHead),
        anchors: document.querySelectorAll('a[href]').length,
      },
    };
    if (msg.wantSample && items.length === 0) {
      resp.sample = document.documentElement.outerHTML.slice(0, 150000);
    }
    sendResponse(resp);
  });

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim().slice(0, 350);
  }

  function extract(hrefRe) {
    if (!hrefRe) return [];
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(a.getAttribute('href'), location.href).toString().split('#')[0]; } catch { continue; }
      if (!hrefRe.test(url)) continue;
      const key = url.split('?')[0];
      if (seen.has(key)) continue;
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
      seen.add(key);
      out.push({ title, priceText, url, extra: clean(cardText).slice(0, 260) || null });
      if (out.length >= 60) break;
    }
    return out;
  }
})();
