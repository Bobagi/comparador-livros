# Kit de publicacao na Chrome Web Store · Farolivro

Tudo que o formulario da loja pede, pronto para colar. O pacote a enviar e o
`backend/static/ext/livros-coletor.zip` (gerado por `scripts/build-extension.py`,
sem segredo nenhum dentro; e o mesmo zip servido no site).

> **★ REJEICAO da v0.2.0 (2026-08-11) e como este kit corrige:** a v0.2.0 ("Livros
> Bobagi - Coletor") foi **rejeitada por "Spam de palavra-chave"** (ref. `Yellow
> Argon`): a Chrome Web Store marcou a **lista das seis lojas** na descricao
> ("Mercado Livre, Amazon.com.br, Estante Virtual, OLX, Enjoei e Shopee") como
> palavras-chave excessivas/irrelevantes de marcas de 3os. **A descricao abaixo ja
> foi corrigida** (nao enumera as marcas; descreve a funcao de forma generica). A
> revisao terminou (como rejeicao), entao **agora e a hora de subir a v0.3.0
> Farolivro** com esta descricao nova - resolve o rebrand e a rejeicao de uma vez.
> NAO use "Contestar": corrigir o texto e reenviar aprova mais rapido. Regra
> duravel: na ficha da CWS, **nao liste nomes de lojas/marcas de 3os** (isso conta
> como keyword spam); a lista das lojas suportadas fica no site, nao na ficha.

## Passos da conta (so o dono faz, ~10 min + US$ 5 uma vez)

1. Entrar em https://chrome.google.com/webstore/devconsole com a conta Google.
2. Pagar a taxa unica de registro de desenvolvedor (US$ 5).
3. Confirmar o e-mail de contato do desenvolvedor (a loja manda um link).
4. Na aba Conta, declarar-se **nao comerciante** (non-trader; projeto pessoal
   gratuito, sem transacao). Exigencia europeia (DSA), aparece no formulario.
5. "Novo item" -> enviar o `livros-coletor.zip` -> preencher com o conteudo
   abaixo -> "Enviar para revisao".

Revisao tipica: 1 a 3 dias (pode demorar mais por causa das permissoes de host).
Cada atualizacao futura passa por revisao de novo, quase sempre mais rapida.

## Ficha (aba "Detalhes do item")

- **Idioma da ficha:** Portugues (Brasil)
- **Nome:** ja vem do manifest: `Farolivro`
- **Resumo** (ja vem do manifest): `Fareje o menor preco de um livro, novo ou usado, em 6 lojas ao mesmo tempo, a partir do seu navegador. So age quando voce pede uma busca; nao le sua navegacao.`
- **Categoria:** Compras (Shopping)
- **Descricao (colar):**

```
Farolivro fareja o menor preco de um livro, NOVO ou USADO, comparando varios
marketplaces brasileiros de uma vez, sem voce abrir site por site. E o
companheiro do site livros.bobagi.space, onde os resultados aparecem lado a
lado, agrupados por novo e usado.

Por que uma extensao? Muitos sites bloqueiam buscas automatizadas vindas de
servidores. O Farolivro faz a busca a partir do SEU navegador, como se voce
mesmo abrisse cada site, e envia os anuncios encontrados (titulo, preco, link)
para o comparativo.

Como usar:
1. Instale o Farolivro.
2. Abra livros.bobagi.space (o indicador "Farolivro conectado" acende).
3. Busque por titulo, autor ou ISBN e veja as ofertas agrupadas em novo e
   usado, com o status honesto de cada fonte.

Privacidade, direto ao ponto:
- So age quando VOCE pede uma busca no site. Nunca roda nas paginas que voce
  visita nem le sua navegacao.
- Coleta apenas o texto da busca e o conteudo publico das paginas de resultado
  de busca. Nada de contas, cookies, historico ou dado pessoal.
- Sem anuncios, sem rastreadores, codigo aberto:
  https://github.com/Bobagi/comparador-livros

Politica de privacidade: https://livros.bobagi.space/privacidade
Projeto pessoal, sem afiliacao com nenhuma loja.
```

- **Icone da loja (128x128):** `docs/cws/icon128.png` (focinho Farolivro)
- **Screenshots (1280x800):** `docs/cws/screenshot-1-home.png` e
  `docs/cws/screenshot-2-resultados.png`
- **Site oficial:** `https://livros.bobagi.space`

## Aba "Praticas de privacidade"

- **Finalidade unica (colar):**

```
Comparar precos de livros: quando o usuario pede uma busca no site
livros.bobagi.space, o Farolivro consulta as paginas publicas de resultado de
busca de seis lojas brasileiras e envia os anuncios encontrados (titulo,
preco, link) ao site, que monta o comparativo. Nada roda sem pedido do
usuario.
```

- **Justificativa de cada permissao (colar em cada campo):**
  - `offscreen`: "Interpretar (DOMParser) o HTML das paginas de busca das lojas; o service worker MV3 nao tem DOM."
  - `storage`: "Guardar o identificador aleatorio de instalacao que autentica os envios ao backend. Nenhum dado pessoal."
  - `scripting`: "Injetar o leitor de pagina somente nas abas que a propria extensao abre (lojas que exigem renderizacao). Nunca roda nas abas do usuario."
  - **Permissoes de host** (uma justificativa geral): "As seis lojas: buscar a pagina publica de resultados a pedido do usuario. livros.bobagi.space: receber o pedido de busca e devolver os resultados. O Farolivro so age apos um pedido explicito do usuario no site."
- **Uso de codigo remoto:** Nao.
- **Dados de usuario coletados:** marcar somente **"Conteudo do site"**
  (website content) - conteudo das paginas publicas de resultado de busca das
  lojas, enviado ao backend do proprio produto para montar o comparativo.
  Todo o resto (PII, saude, financeiro, autenticacao, comunicacao, localizacao,
  historico, atividade do usuario): NAO.
- **Certificacoes** (as 3 caixas): nao vendemos dados; uso restrito a
  finalidade unica; nada de creditworthiness. Marcar as tres.
- **URL da politica de privacidade:** `https://livros.bobagi.space/privacidade`

## Aba "Distribuicao"

- **Visibilidade: Nao listada** (recomendado por ora): qualquer pessoa com o
  link instala em 1 clique, mas a extensao nao aparece na busca da loja.
  Combina com o estagio atual (uso pessoal + convidados) e com a nota de
  ToS/escala do README. Virar "Publica" depois e so trocar o campo.
- **Paises:** todos (ou so Brasil, indiferente).
- **Preco:** gratuito.

## Depois da aprovacao

1. Me mandar a URL da ficha (`https://chromewebstore.google.com/detail/<id>`).
2. Eu troco o painel de instalacao do site (zip + modo desenvolvedor) por um
   botao "Adicionar ao Chrome" com a URL, e o zip vira fallback.
3. Atualizacoes futuras: `python3 scripts/build-extension.py`, subir a nova
   versao (bump no `manifest.json`) no painel e enviar para revisao; quem ja
   instalou recebe sozinho.
