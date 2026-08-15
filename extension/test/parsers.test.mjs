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

test('ML: estado search-nordic real (fixture) vira itens com preco', () => {
  // Fixture derivada do formato REAL do ML: _n.ctx.s.q("0:{...}") com refs @N,
  // ref de letra unica (u) e NaN em posicao de valor; polycards com
  // components[title|price] + metadata{url,signal.price}.
  const html = fx('mercadolivre-nordic-state.html');
  const items = P.storeItems('mercadolivre', html);
  assert.equal(items.length, 2); // 2 produtos; o card de navegacao (sem preco/MLB) fica de fora
  assert.equal(items[0].title, 'Livro Teste Um - Capa Dura');
  // componente de preco (59,90) vence o signal (999) - preco exibido e o do componente
  assert.equal(items[0].priceText, 'R$ 59,90');
  assert.match(items[0].url, /^https:\/\/www\.mercadolivre\.com\.br\/.*\/p\/MLB111$/);
  // card patrocinado SEM componente de preco: cai no signal.price (80); url = click-tracker do ML
  assert.equal(items[1].priceText, 'R$ 80,00');
  assert.match(items[1].url, /^https:\/\/click1\.mercadolivre\.com\.br\//);
});

test('ML: parser so emite host do ML (defesa na origem contra url envenenada no estado)', () => {
  const mk = (url, text) => `{"polycard":{"metadata":{"url":${JSON.stringify(url)},"signal":{"price":9}},"components":[{"type":"title","title":{"text":${JSON.stringify(text)}}}]}}`;
  const inner = '0:{"results":[' + [
    mk('www.evil.com/p/MLB1', 'host mau'),
    mk('javascript:alert(1)', 'js url'),
    mk('https://www.mercadolivre.com.br.evil.com/p/MLB2', 'sufixo mau'),
    mk('www.mercadolivre.com.br/livro/p/MLB9', 'Livro OK'),
    mk('click1.mercadolivre.com.br/mclics/count?a=1', 'Patrocinado OK'),
  ].join(',') + ']}';
  const html = '<script>_n.ctx.s.q(' + JSON.stringify(inner) + ')</script>';
  const items = P.storeItems('mercadolivre', html);
  const urls = items.map((i) => i.url);
  assert.equal(items.length, 2); // so os 2 de host ML valido
  assert.ok(urls.every((u) => /^https:\/\/([\w-]+\.)*mercadoli(vre|bre)\.com/.test(u)));
  assert.ok(!urls.some((u) => u.includes('evil.com') || u.startsWith('https://javascript')));
});

test('ML: neutralizeRefs troca so tokens em posicao de valor, nunca dentro de string', () => {
  // @N, ref de letra, NaN viram null; strings com @/palavras ficam intactas
  const raw = '{"a":@12,"b":u,"c":NaN,"d":"preco @promo undefined true","e":[u,@3,1],"f":true}';
  const obj = JSON.parse(P.neutralizeRefs(raw));
  assert.equal(obj.a, null);
  assert.equal(obj.b, null);
  assert.equal(obj.c, null);
  assert.equal(obj.d, 'preco @promo undefined true'); // string preservada
  assert.deepEqual(obj.e, [null, null, 1]);
  assert.equal(obj.f, true); // literal true preservado
});

test('DoS: estado ML fundo demais nao estoura a pilha (teto de profundidade)', () => {
  let inner = '{"components":[{"type":"title","title":{"text":"Fundo demais"}}],"metadata":{"url":"www.mercadolivre.com.br/p/MLB999","signal":{"price":1}}}';
  for (let i = 0; i < 2000; i++) inner = '{"k":' + inner + '}';
  const html = '<script>_n.ctx.s.q(' + JSON.stringify('0:' + inner) + ')</script>';
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
