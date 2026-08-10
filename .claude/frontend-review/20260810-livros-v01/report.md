# frontend-review - livros.bobagi.space v0.1 (2026-08-10)

## Resumo
Primeira review da UI do comparador de livros (estado sem coletor, estado com resultados
semeado com ofertas reais da Fase 0, 390/768/1280/1440). Sinais automaticos limpos
(0 overflow horizontal, 0 offCanvas, 0 erro de console). Foram achados e CORRIGIDOS na
sessao: 1 P1, 3 P2 e 2 achados de codigo que screenshots quase nao revelam (fontes
quebradas em silencio e cache de borda servindo asset velho). Estado final: aprovado
para o teste do operador.

## Achados (todos corrigidos nesta sessao)
- **P1 feedback fora da tela + chip mentiroso (busca sem coletor, 390x844):** a mensagem
  "sem o coletor nada e buscado" renderizava no FIM da pagina (invisivel no fold) e os
  chips diziam "coletando..." sem coletor conectado. Fix: `#msg` movido para logo abaixo
  do botao Buscar (visivel no fold, borda warn) e chips passam a dizer "aguardando
  coletor" quando a extensao nao esta conectada (`app.js STATUS_LABEL_NO_EXT`).
- **P2 fontes quebradas em silencio (Pilar 2):** `fonts/faces.css` copiado de outro
  projeto apontava `url('/fonts/...')`, caminho inexistente aqui; o fallback SPA de 404
  devolvia o index.html com 200, entao as fontes "carregavam" HTML e a pagina caia no
  fallback do sistema sem nenhum erro. Fix: paths reescritos para `/static/fonts/` +
  MIME `font/woff2` registrado no backend.
- **P2 cache de borda (Pilar 2, armadilha conhecida do box):** zona proxied, Cloudflare
  cacheia .js/.css/.zip por 4h; rebuild + force-recreate continuava servindo app.js
  VELHO (`cf-cache-status: HIT`). Fix estrutural: o backend carimba as URLs de asset
  com hash de conteudo no boot (`build_index()`), incluindo o zip da extensao.
- **P2 tap targets 19-22px:** links do bloco Filtrados e o link do zip. Fix:
  `display:inline-flex; min-height:24px` para `.panel a` e `.f-item a`.
- **P2 foco de teclado invisivel:** so o input tinha focus ring. Fix: regra global
  `a/button/summary:focus-visible` com outline no token amarelo.

## Pontos fortes (nao regredir)
- Honestidade por loja e o centro da UI: chips ok/bloqueado/vazio/aguardando por loja,
  grupo "Provaveis (confira antes de confiar)" com motivo em cada card, e bloco
  "Filtrados" expansivel com motivo e contagem.
- Zero estilo inline (CSP `script-src 'self'; style-src 'self'` passa limpa), zero
  framework, render 100% via textContent (XSS-safe por construcao).
- Identidade do portfolio (tokens --yellow/--text, Archivo/Space Grotesk/JetBrains,
  marca "B bobagi"), sem paleta inventada.
- Mobile: cards colapsam para 1 coluna, meta em flex-wrap, form com flex-wrap.

## Como reproduzir o estado com resultados
Reseed: `bash <scratchpad>/reseed.sh` (cria busca "duna frank herbert" e ingere ofertas
reais da Fase 0 nas 6 lojas via API com a LIVROS_KEY). A busca de demo foi APAGADA ao
final da review para a primeira busca real do operador nao cair em cache sintetico.
