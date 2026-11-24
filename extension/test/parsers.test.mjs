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

test('ML: formato de nov/2026 (funcao renomeada + produtos item_offered) vira itens', () => {
  // Fixture SINTETICA que reproduz o formato visto na amostra real enviada pela
  // extensao em 20/10/2026: a chamada deixou de ser `_n.ctx.s.q(` e os produtos
  // vem como {id, name, type:"Product", item_offered:{price, url}}.
  const html = fx('mercadolivre-state-2026-11.html');
  assert.equal(html.includes('_n.ctx.s.q('), false); // o marcador antigo nao existe
  const items = P.storeItems('mercadolivre', html);
  assert.equal(items.length, 2); // sem preco e host estranho ficam de fora
  assert.equal(items[0].title, 'Meu Amigo Dahmer');
  assert.equal(items[0].priceText, 'R$ 68,48');
  assert.equal(items[0].url, 'https://www.mercadolivre.com.br/meu-amigo-dahmer/up/MLBU1092509489');
  // query de rastreio e fragmento saem do link do produto
  assert.equal(items[1].url, 'https://produto.mercadolivre.com.br/MLB-2222222222-meu-amigo-dahmer-_JM');
  assert.equal(items[1].priceText, 'R$ 35,00');
});

test('ML: literal grande sem anuncio nao e parseado (custo) e lixo nao quebra', () => {
  const big = JSON.stringify('0:' + JSON.stringify({ x: 'a'.repeat(5000) }));
  const html = `<script>f(${big});g("quebrado ${'b'.repeat(300)} polycard</script>`;
  assert.deepEqual(P.mlStateItems(html), []);
});

test('canonicalUrl: limpa link do ML e descarta url acima do teto do backend', () => {
  assert.equal(
    P.canonicalUrl('mercadolivre', 'https://produto.mercadolivre.com.br/MLB-1234567890-livro-_JM?tracking_id=abc&x=' + 'y'.repeat(2000)),
    'https://produto.mercadolivre.com.br/MLB-1234567890-livro-_JM');
  assert.equal(P.canonicalUrl('mercadolivre', 'https://www.mercadolivre.com.br/livro/p/MLB12345678?pdp_filters=a'),
    'https://www.mercadolivre.com.br/livro/p/MLB12345678');
  // link de rastreio sem id de produto no caminho e grande demais: fora
  assert.equal(P.canonicalUrl('mercadolivre', 'https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=' + 'x'.repeat(1500)), null);
  // outras lojas: so o teto
  assert.equal(P.canonicalUrl('olx', 'https://www.olx.com.br/livro-123456789?a=1'), 'https://www.olx.com.br/livro-123456789?a=1');
  assert.equal(P.canonicalUrl('olx', 'https://www.olx.com.br/' + 'z'.repeat(1200)), null);
  assert.equal(P.canonicalUrl('mercadolivre', 'nao e url'), null);
});

test('loginWall: Shopee mandando para verificacao/login e detectada; busca normal nao', () => {
  assert.equal(P.loginWall('shopee', 'https://shopee.com.br/verify/traffic/error?home_url=x&is_logged_in=false'), true);
  assert.equal(P.loginWall('shopee', 'https://shopee.com.br/buyer/login?next=%2Fsearch'), true);
  assert.equal(P.loginWall('shopee', 'https://shopee.com.br/search?keyword=livro'), false);
  assert.equal(P.loginWall('shopee', 'https://evil.com/shopee.com.br/verify/traffic'), false);
  assert.equal(P.loginWall('olx', 'https://shopee.com.br/verify/traffic'), false);
  // tela "Login Necessario" na propria url da busca (visto ao vivo em 24/11/2026)
  // na pagina real a tela vem depois de ~75 KB de svg/css
  const tela = '<title>x em Promocao na Shopee Brasil</title>' + '<svg></svg>'.repeat(9000) + '<div>Login Necessário</div><p>Parece que você ainda não está logado.</p>';
  assert.equal(P.loginWall('shopee', 'https://shopee.com.br/search?keyword=x', tela), true);
  assert.equal(P.loginWall('shopee', 'https://shopee.com.br/search?keyword=x', '<div>resultados</div>'), false);
  assert.equal(P.loginWall('olx', 'https://www.olx.com.br/x', tela), false);
});

test('ML: estado CORTADO/invalido (amostra real) ainda rende anuncios pelo extrator tolerante', () => {
  // Trecho de produtos copiado de uma pagina REAL do ML (amostra de 20/10/2026,
  // sem dado de usuario) dentro de um estado propositalmente invalido.
  const html = fx('mercadolivre-real-items-cut.html');
  assert.equal(P.mlStateItems(html).length, 0); // o parser estruturado nao consegue
  const items = P.storeItems('mercadolivre', html);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    title: 'Meu Amigo Dahmer', priceText: 'R$ 68,48',
    url: 'https://www.mercadolivre.com.br/meu-amigo-dahmer/up/MLBU1092509489', seller: null, extra: null,
  });
  // / no titulo vira "/"
  assert.equal(items[1].title, 'Livro - Meu Amigo Dahmer - Novo/lacrado');
  assert.equal(items[1].priceText, 'R$ 93,41');
});

test('ML: extrator tolerante so emite host do ML e ignora preco ausente', () => {
  const mk = (name, price, url) => `{\\"name\\":\\"${name}\\",\\"item_offered\\":{\\"price\\":${price},\\"url\\":\\"${url}\\"}}`;
  const html = '<script>x("' + [
    mk('Livro Bom Demais', 20, 'https:\\u002F\\u002Fwww.mercadolivre.com.br\\u002Flivro\\u002Fup\\u002FMLBU1234567'),
    mk('Livro Host Mau', 20, 'https:\\u002F\\u002Fevil.com\\u002FMLBU1234567'),
    mk('Livro Sem Preco', 'null', 'https:\\u002F\\u002Fwww.mercadolivre.com.br\\u002Fx\\u002Fup\\u002FMLBU7654321'),
  ].join(',') + '")</script>';
  const items = P.mlLooseItems(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Livro Bom Demais');
});

test('ML: extrator tolerante e linear em entrada hostil (sem backtracking catastrofico)', () => {
  const hostile = '"name":"' + 'a'.repeat(300) + '"' + ' '.repeat(790) + '"item_offered":{"price":1';
  const html = hostile.repeat(3000); // ~3,3 MB
  const t0 = Date.now();
  P.mlLooseItems(html);
  assert.ok(Date.now() - t0 < 2000, `demorou ${Date.now() - t0} ms`);
});
