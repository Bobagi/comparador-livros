// Testes dos parsers puros (node --test). Fixtures em test/fixtures vem de
// paginas REAIS coletadas pela extensao (sem dado pessoal): a da EV com o
// JSON-LD ItemList, a pagina de bloqueio real do ML (suspicious-traffic) e um
// head legitimo do ML que carrega a BIBLIOTECA reCAPTCHA (que nao e bloqueio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require(join(here, '..', 'parsers.js'));

const fx = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

test('EV: JSON-LD ItemList vira itens com titulo, preco e url', () => {
  const items = P.jsonLdItems(fx('estantevirtual-ldjson.html'));
  assert.equal(items.length, 4);
  assert.equal(items[0].title, 'Show Off - How to do Absolutely Everything');
  assert.equal(items[0].priceText, 'R$ 10,00');
  assert.match(items[0].url, /^https:\/\/www\.estantevirtual\.com\.br\/livro\//);
  // mutation check: preco decimal formatado com virgula
  assert.equal(items[1].priceText, 'R$ 45,00');
});

test('EV: storeItems usa o JSON-LD', () => {
  const items = P.storeItems('estantevirtual', fx('estantevirtual-ldjson.html'));
  assert.equal(items.length, 4);
});

test('bloqueio: pagina de verificacao real do ML e detectada', () => {
  assert.equal(P.looksBlocked(fx('mercadolivre-block.html')), true);
});

test('bloqueio: biblioteca reCAPTCHA em pagina legitima NAO conta (o bug do "bloqueado")', () => {
  const html = fx('mercadolivre-legit-recaptcha-lib.html');
  assert.match(html, /recaptcha/); // a fixture realmente carrega a biblioteca
  assert.equal(P.looksBlocked(html), false);
});

test('bloqueio: pagina da EV com resultados nao e bloqueio', () => {
  assert.equal(P.looksBlocked(fx('estantevirtual-ldjson.html')), false);
});

test('ML: estado embutido da SPA vira itens; link de navegacao sem preco fica de fora', () => {
  const state = {
    pageState: {
      initialState: {
        results: [
          { id: 'MLB1', title: 'How to Invent Everything - Ryan North', permalink: 'https://www.mercadolivre.com.br/livro/p/MLB12345678', price: { amount: 59.9 } },
          { id: 'MLB2', title: 'Livro usado em bom estado', permalink: 'https://produto.mercadolivre.com.br/MLB-3456789012-livro', prices: { prices: [{ amount: 80 }, { amount: 64.5 }] } },
          { title: 'Livros, Revistas e Comics', permalink: 'https://lista.mercadolivre.com.br/livros/' },
        ],
      },
    },
  };
  const html = '<html><head></head><body><script>window.__PRELOADED_STATE__ = '
    + JSON.stringify(state) + ';\nfooBar();</script></body></html>';
  const items = P.mlStateItems(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].priceText, 'R$ 59,90');
  // mutation check: com lista de precos, vale o MENOR (promocional)
  assert.equal(items[1].priceText, 'R$ 64,50');
  assert.equal(P.storeItems('mercadolivre', html).length, 2);
});

test('ML: extractFirstJson aguenta chaves e aspas dentro de string e codigo depois', () => {
  const text = 'var x = 1; window.__S__ = {"a":"tem { chave } e \\" aspas","permalink":"https://x.mercadolivre.com.br/MLB-1234567","title":"Titulo bom","price":10}; f();';
  const data = P.extractFirstJson(text);
  assert.equal(data.title, 'Titulo bom');
});

test('DoS: JSON fundo demais nao estoura a pilha (teto de profundidade)', () => {
  let inner = '{"permalink":"https://www.mercadolivre.com.br/x/p/MLB999","title":"Fundo demais","price":1}';
  for (let i = 0; i < 2000; i++) inner = '{"k":' + inner + '}';
  const html = '<script>window.__PRELOADED_STATE__ = ' + inner + ';</script>';
  const items = P.mlStateItems(html); // nao pode lancar
  assert.equal(items.length, 0); // alem do teto de 14 niveis: descartado
});

test('amostra: pagina grande manda o inicio + a regiao onde os dados moram', () => {
  const filler = 'x'.repeat(300000);
  const ld = '<script type="application/ld+json">{"@type":"ItemList","itemListElement":[]}</script>';
  const html = '<html><head>' + filler + ld + '</head><body></body></html>';
  const sample = P.buildSample(html);
  assert.ok(sample.length <= 150000);
  assert.match(sample, /FARO-CUT@/);
  assert.match(sample, /itemListElement/); // a regiao util entrou, mesmo alem do corte
});

test('amostra: pagina pequena vai inteira', () => {
  assert.equal(P.buildSample('<html>oi</html>'), '<html>oi</html>');
});
