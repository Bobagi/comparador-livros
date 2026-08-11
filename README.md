# Comparador de preços de livros (novos + usados) · Brasil

Compara o preço de um livro em várias lojas ao mesmo tempo, cobrindo o que os
comparadores existentes ignoram: os **marketplaces C2C e de usados** (OLX, Enjoei,
Mercado Livre de pessoa física) além do varejo. Dado um título, autor ou ISBN, mostra
numa tela só as ofertas reais (preço, loja, condição, link), agrupadas por novo/usado.

Lojas cobertas: Mercado Livre, Amazon.com.br, Estante Virtual, OLX, Enjoei, Shopee.

> Projeto pessoal, sem afiliação com nenhuma das lojas. Rodando em
> `https://livros.bobagi.space`.

## A ideia central: a coleta roda no navegador, não no servidor

A parte contraintuitiva do projeto. Todas essas lojas **bloqueiam requisições vindas de
servidores** (IP de datacenter): de uma VPS, as 6 devolvem captcha, 403 ou uma casca de
página sem produto nenhum. Isso foi medido, não suposto (veja `fase0/`). Não é problema
de código ou de headers, é reputação de IP.

A solução é a mesma do Keepa: **o fetch acontece numa extensão de navegador**, no
navegador do próprio usuário (IP residencial, sessão real), onde não há nada de anômalo.
O servidor **nunca raspa loja nenhuma**; ele só faz:

- normalização de título/autor e **matching fuzzy** (é o núcleo difícil, veja abaixo);
- classificação de condição (novo/usado/seminovo/lacrado) e de edição (capa dura vs
  brochura, volume, etc.);
- exclusão de ruído (kits, PDFs, "resumos", DVD/pôster do filme, outro autor);
- cache, e um status honesto por loja (loja que falhou aparece como falha, nunca some).

```
livros.bobagi.space  (site normal, abre no navegador)
        |
   extensão MV3 no navegador do usuário  --fetch-->  as 6 lojas (IP residencial)
        |  (manda o DOM cru; quando um parser falha, manda amostra do HTML)
        v
   backend (FastAPI)  ->  normaliza + matching + cache + honestidade por loja
```

### Por que não um site que raspa no servidor, ou só APIs oficiais?

Foram as três opções avaliadas:

- **Servidor raspando via proxy residencial:** funciona sem instalar nada, mas custa
  dinheiro real (US$ 3 a 15/GB; a feature de alerta de usados, que exige varredura
  recorrente, empurra para ~US$ 90 a 270/mês) e é frágil.
- **Só APIs oficiais:** cobre no máximo Amazon + Shopee. A API de busca do Mercado Livre
  passou a devolver 403 mesmo com token OAuth (2025+), e OLX/Enjoei/Estante Virtual não
  têm API pública. Isso mata justamente o diferencial (C2C/usado).
- **Extensão (escolhida):** cobertura completa das 6 lojas, custo zero, sem proxy.

## O problema difícil: matching

Em OLX, Enjoei e ML de pessoa física não há ISBN nem catálogo. O anúncio é texto livre
("Livro Devoradores de Estrelas Andy Weir seminovo capa dura", "Kit 3 livros", "resumo em
PDF"). O `backend/app/matching.py` resolve isso com uma regra de ouro: **um falso positivo
(mostrar o livro errado) é muito pior que um falso negativo.** Na dúvida, o anúncio cai num
grupo separado "Provavel (confira)" com o motivo, ou é filtrado, nunca confirmado às cegas.

O comportamento é travado por `backend/tests/test_matching.py`, montado com **anúncios
reais** rotulados à mão (as ofertas boas confirmam; kits/PDF/outro autor/outra edição nunca
confirmam), e validado com mutação (quebrar a lógica de propósito deixa a suíte vermelha).

## Rodar localmente

Requisitos: Docker + Docker Compose.

```bash
# 1. chave MASTER do backend (dev local / curl; a extensão não usa essa chave)
python3 -c "import secrets; print('LIVROS_KEY=' + secrets.token_urlsafe(32))" > .env

# 2. empacota a extensão e sobe o backend
python3 scripts/build-extension.py
docker compose up -d --build

# 3. testes (matching + autenticação da ingestão)
docker compose run --rm --no-deps web python -m pytest tests/
```

O site fica em `http://127.0.0.1:3065`. Baixe a extensão pelo link da própria página
(`/ext/livros-coletor.zip`), extraia, e carregue em `chrome://extensions` com o Modo do
desenvolvedor ligado ("Carregar sem compactação", aponte para a pasta que contém o
`manifest.json`). Recarregue a página: o chip no topo deve virar "Farolivro conectado".

### Como a extensão se autentica (sem segredo no pacote)

O pacote da extensão é público (é o mesmo zip enviado à Chrome Web Store), então ele
**não carrega chave nenhuma**. No primeiro uso a extensão se registra no backend
(`POST /api/installs`), recebe um id + token próprios da instalação e guarda no
`chrome.storage.local`; o backend guarda só o sha256 do token. Controles de abuso:
teto de registros por IP/dia, rate limit de envios por instalação, busca velha
(15 min+) não aceita mais resultado, e o rate limit do nginx em `/api/`.
A `LIVROS_KEY` do `.env` continua existindo apenas como chave master de
desenvolvimento (testes via curl).

## Estrutura

```
backend/
  app/main.py        API FastAPI (busca, ingestão de resultados, cache, estático)
  app/matching.py    normalização + matching + classificação (o núcleo, com testes)
  tests/             suíte de matching com anúncios reais
  static/            o site (HTML/CSS/JS puro, zero framework)
extension/           a extensão MV3 (service worker + offscreen parser + content scripts)
scripts/build-extension.py   empacota a extensão (zip idêntico ao da Chrome Web Store)
fase0/               a pesquisa de validação (ofertas reais + o dataset de ruído)
```

## Fase 0: existe produto? (a pesquisa que veio antes do código)

Antes de escrever qualquer coisa, medi a dispersão real de preço de 5 livros nas 6 lojas
(`fase0/ofertas.csv`), com cada preço atrelado a uma URL e um trecho de evidência. O portão
era: se a diferença entre o mais barato e o mais caro do mesmo livro for menor que ~R$ 15,
não há produto. Resultado (mediana de spread ~R$ 52, sem contar frete):

| Livro | Faixa (mesma edição) | Spread |
|---|---|---|
| Devoradores de Estrelas (Suma, brochura) | usado R$ 65 · novo R$ 59 a 143,90 | R$ 84,90 |
| 1984 (Cia. das Letras) | usado R$ 10 · novo R$ 66,75 | R$ 56,75 |
| Manual de Direito Penal PG (Sanches) | usado antigo R$ 6 · novo R$ 130 a 182 | R$ 52,15 |
| Duna (Aleph, capa dura) | usado R$ 44,90 · novo R$ 78,99 | R$ 34,09 |
| Berserk Vol. 1 Ed. Luxo | R$ 25 a 36,65 | R$ 11,65 |

Conclusões que guiaram o produto: o vertical inicial é **direito/concurso** (maior dor em
reais e edição codificada no título, o que facilita o matching); o usado nem sempre é o mais
barato (em Devoradores, o usado custa mais que o novo mais barato); e mangá de catálogo em
reimpressão tem spread pequeno demais (o caso forte de mangá é volume esgotado).

`fase0/ruido-matching.csv` é a semente do dataset de matching: anúncios reais que **não** são
o livro (kits, PDF, DVD/figure do filme, outro autor, box), rotulados com o motivo.

## Limitações honestas

- **Frete ainda não entra no total** (cada oferta mostra "+ frete a calcular"). Num livro
  usado de R$ 30, o frete pode ser metade do preço; é a próxima peça importante.
- Os preços da Fase 0 vieram de snippets de busca (idade de dias a semanas), não de página
  confirmada ao vivo (a VPS é bloqueada). Servem para medir dispersão, não como preço atual.
- **Legal/ToS:** raspar marketplace fere os Termos de Uso da maioria das lojas, mesmo com
  dado público. Este projeto é de uso pessoal e baixo volume; respeita rate limiting, não
  recria catálogo integral e não coleta dado pessoal de vendedor. Distribuição pública em
  escala mudaria essa análise.

## Licença

MIT. Veja [LICENSE](LICENSE).
