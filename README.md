# Comparador de precos de livros (novos + usados) - Brasil

Projeto pessoal do operador. Estado atual: **Fase 0 concluida (2026-08-10), portao APROVADO; nenhum codigo escrito ainda.** A spec completa foi colada na conversa de 2026-08-10 (busca por titulo/autor/ISBN, ofertas agregadas de ML/Shopee/Amazon/Enjoei/Estante Virtual/OLX, frete no preco final, honestidade sobre cobertura parcial; fase 2 = historico + alertas de preco).

## Decisoes fechadas em 2026-08-10
- **Arquitetura: Opcao A refinada** - extensao de navegador (MV3, uso pessoal via load unpacked) faz TODO o fetch das lojas no navegador do operador (IP residencial, sessao real); backend na VPS faz apenas normalizacao, matching, cache, historico e alertas. **NUNCA fazer fetch de loja a partir da VPS** (IP de datacenter e bloqueado por todas; re-verificado nesta data: Amazon 503, OLX 403, Estante captcha ShieldSquare, ML e Enjoei devolvem shell sem produto, APIs ML/Shopee 403).
- **API do ML esta morta ate com token** (403 PolicyAgent em /sites/MLB/search para apps comuns, 2025-2026, multiplos relatos, sem desbloqueio documentado; afiliados ML sem API oficial). Estante Virtual e Enjoei: zero canal oficial. Amazon PA-API exige 3 vendas como associado (+manutencao); Shopee affiliate API exige aprovacao + ativacao manual. Ou seja: a perna "APIs oficiais" so vale para METADADOS (OpenLibrary funciona sem key; Google Books precisa de API key, sem ela da 429).
- **Fase 1 (vertical): direito/concurso** - maior dispersao absoluta medida (livro de R$ 182 novo com usado a fracao) e edicao codificada no titulo (12a/13a/14a ed + ano + "conforme Lei X"), o que facilita o matching. Manga em catalogo (Berserk v1) teve a MENOR dispersao em reais (~R$ 12); o caso forte de manga e volume esgotado, nao vol em reimpressao.
- **Fase 2 (primeira loja ponta a ponta): Estante Virtual** (HTML server-side, pagina por edicao com ISBN = matching quase gratis), depois ML (volume + C2C), depois OLX/Enjoei (texto livre, matching pesado), Shopee por ultimo (mais hostil; raspar o DOM da pagina, nao a API v4).

## Fase 0 - dados
- `fase0/ofertas.csv` - ofertas reais coletadas (5 livros x 6 lojas) via snippets de busca externa em 2026-08-10. Colunas: livro, loja, preco_min, preco_max, condicao, edicao_nota, confianca, url. Separador virgula, decimal ponto.
- `fase0/ruido-matching.csv` - anuncios EXCLUIDOS (kits/lotes, PDF, outra edicao, outro autor, DVD/figure do filme). E a semente do dataset rotulado de matching (meta: 40+ anuncios, medir precisao/recall, falso positivo pior que falso negativo).
- **Limite de metodo:** precos vieram de snippets de indice de busca (idade desconhecida, dias a semanas), nenhum confirmado na pagina viva (bloqueio de datacenter). Frete NAO medido (nenhum snippet expoe). Validacao pendente barata: operador abrir ~10 URLs do CSV no navegador e conferir se o preco bate.

## Divida conhecida (aceita para o teste pessoal)
- **A LIVROS_KEY do ingest viaja dentro da extensao** (`/ext/livros-coletor.zip`), entao NAO e
  segredo: quem baixa le a chave. Aceitavel agora porque so da para poluir uma busca cujo UUID o
  atacante conheca (nao enumeravel, sem listagem), toda url passa por allowlist de host+https, o
  upload de HTML e capado a 60x200KB com poda e nunca servido de volta, e o dado e cache efemero sem
  PII/dinheiro. Se virar publico/multiusuario: chave por-instalacao no handshake, ou assinar o
  payload por origem, ou remover o upload. Detalhe em `.claude/security-sweep/20260810/report.md`.

## Dispersao medida (mesma edicao, entre lojas, sem frete)
- Devoradores de Estrelas (Suma, brochura): novo 59,00 a 143,90; usado 65,00. Spread R$ 84,90. Obs: o usado custa MAIS que o novo mais barato.
- Manual Dir. Penal PG Sanches: geracao atual (13a/14a ed) 130 a 182,15 = R$ 52,15; usados de edicoes antigas desde R$ 6. Maior dor em reais.
- 1984 (Cia das Letras, brochura): usado 10 a novo 66,75 = R$ 56,75. O MESMO catalogo ML variou 24,94 a 66,75 entre snapshots.
- Duna (Aleph, capa dura): usado 44,90 a novo 78,99 = R$ 34,09.
- Berserk v1 Ed. Luxo: 25 a 36,65 = R$ 11,65 (unico abaixo do portao; item barato de catalogo, em pre-venda de reimpressao na Amazon).
- Mediana dos spreads: ~R$ 52. Portao do operador (seguir se R$ 40+): **APROVADO**.

## Fatos colaterais uteis
- "Devoradores de Estrelas" e da **Suma de Letras** (grupo Cia das Letras), ISBN 9788556511218 - nao Arqueiro. O filme (mar/2026) encheu as buscas de DVD/Blu-ray/figures que o matching precisa excluir.
- Paginas de catalogo do ML agregam vendedores e o preco do buy box oscila muito (3 snapshots do mesmo catalogo com 3 precos): historico de preco (fase 4) tem materia-prima real.
- Shopee e Enjoei nao expoem preco nem em snippet nem em HTML sem JS: so saem com browser real (confirmacao pratica da arquitetura de extensao).
