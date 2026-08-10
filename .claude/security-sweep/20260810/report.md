# security-sweep - livros.bobagi.space (2026-08-10)

## Resumo
Backend FastAPI novo (`/opt/comparador-livros/backend`) + extensao MV3. Superficie pequena:
sem contas, sem login, sem dinheiro. Endpoints: `POST /api/searches` (publico, cria busca),
`GET /api/searches/{id}` (publico, le), `POST /api/searches/{id}/results` (ingestao, com chave),
servico estatico, e o unico fetch server-side e a OpenLibrary. **Nenhum achado P0/P1.** 1 achado
P2 (limitacao aceita, documentada). Classes testadas AO VIVO: auth do ingest, allowlist de URL,
XSS/CSP, path traversal, exposicao de arquivo, overflow de campos, injecao SQL, rate limit, SSRF.

## Testado ao vivo (ataque disparado, resultado)
- **Auth do ingest (classe 9):** `POST results` sem chave -> 401, chave errada -> 401
  (`hmac.compare_digest`, timing-safe), chave certa -> 200. OK.
- **Allowlist de URL / anti-XSS-scheme (classe 10):** injetei `javascript:alert(1)` e
  `https://evil.example.com/olx-1234567` como url de oferta -> AMBAS rejeitadas server-side
  (`url_allowed` exige https + host da propria loja); so a URL `sp.olx.com.br` real foi aceita
  (accepted:1). Um link `javascript:`/host falso NUNCA chega ao DOM.
- **XSS (classe 10):** `<script>`/`<img onerror>` no title -> armazenado como texto literal; o
  front renderiza 100% via `textContent`/`el()` (zero innerHTML). CSP na resposta:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'`
  -> script inline nao executa e a pagina nao pode ser emoldurada. OK.
- **Path traversal / exposicao de arquivo (classe 13/15):** `GET /data/livros.db`,
  `/static/../app/main.py`, variantes percent-encoded -> devolvem o SPA fallback (index.html, 200
  inofensivo) ou 404; **o .db e o codigo NAO vazam** (`grep SQLite`/`LIVROS_KEY` = 0). O dir de
  samples e `/data` nao estao montados como estatico. OK.
- **Overflow de campos (classe 5):** title 5000 chars -> 422, query 5000 -> 422, status/loja
  invalidos -> 400, **nunca 500** (bounds do Pydantic + whitelist de store/status). Preco absurdo
  `R$ 9999999,00` -> `price_cents = None` (fora da faixa 1..500000, o backend NAO inventa). OK.
- **Injecao SQL (classe 4):** `search_id` = `' OR 1=1--` -> 404; SQL 100% parametrizado (`?`), sem
  Sprintf/concat. OK.
- **Rate limit (classe 12):** rajada de 40 POST /api/searches concorrentes -> 22x200 + 18x429
  (nginx `limit_req zone=livros_api rate=5r/s burst=20 nodelay`). OK.
- **SSRF (classe 6):** o unico fetch server-side (OpenLibrary) tem **host hardcoded**
  (`openlibrary.org`); o input do usuario vai so como valor de query param, nunca decide host nem
  protocolo. Sem superficie de SSRF. OK.
- **Infra (classe 15):** container binda `127.0.0.1:3065` (nao 0.0.0.0), nginx termina TLS, zona
  proxied pelo Cloudflare com o ufw travado nos ranges do CDN (heranca do box). `client_max_body_size 1m`.

## Achado P2 (limitacao aceita, nao um bug a corrigir agora)
- **A "chave" do ingest e distribuida junto da extensao** (`/ext/livros-coletor.zip` contem
  `config.js` com a `LIVROS_KEY`). Logo NAO e um segredo: quem baixa a extensao le a chave e pode
  chamar `POST results`. **Blast radius real e minimo** e por isso e aceitavel para um teste pessoal:
  (1) so da para poluir uma busca cujo **UUID** o atacante conheca (o id nao e enumeravel e nao ha
  listagem); na pratica, so a busca que ele mesmo criou; (2) toda url de oferta passa pela allowlist
  de host + https, entao nao da para injetar link malicioso; (3) o upload de `sampleHtml` e capado a
  **60 arquivos x 200KB (~12MB)** com poda automatica, e nunca e servido de volta; (4) dado e cache
  efemero (TTL 6h), sem PII, sem dinheiro. **Se um dia isto virar publico/multiusuario**, trocar por:
  chave por-instalacao emitida no primeiro handshake, ou assinar o payload por origem, ou remover o
  upload de HTML. Registrado no README como divida conhecida.

## Nao testavel aqui
- Os parsers das lojas (offscreen/scraper) so rodam no navegador do operador; a robustez deles
  contra HTML malicioso de loja e testada pela telemetria de amostra na 1a rodada real, nao nesta
  sweep server-side. O caminho que importa (ingest -> matching -> DOM) foi coberto acima.

## Re-validado OK (nao regredir)
Auth timing-safe do ingest; allowlist de host nas urls; render por textContent; CSP estrita;
SQL parametrizado; bounds do Pydantic; rate limit nginx; bind 127.0.0.1; fetch server-side de host fixo.
