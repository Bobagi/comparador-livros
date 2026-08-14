# Kit de publicacao na Chrome Web Store · Farolivro

Tudo que o formulario da loja pede, pronto para colar. O pacote a enviar e o
`backend/static/ext/livros-coletor.zip` (gerado por `scripts/build-extension.py`,
sem segredo nenhum dentro; e o mesmo zip servido no site).

> **★ ESTADO (2026-08-14):** a **v0.3.0 Farolivro esta APROVADA e no ar**
> (`chromewebstore.google.com/detail/farolivro/jnkjabpgnocifbnnceoepijbcggmkkek`).
> Este kit agora e da **v0.4.0**, uma ATUALIZACAO com: (a) **popup na barra**
> (botao "Farejar" + "Abrir o Farolivro"), para o usuario iniciar a busca sem
> ter o site aberto; (b) **migracao de dominio** para `farolivro.bobagi.space`
> (o antigo `livros.bobagi.space` segue valido, por isso os DOIS hosts estao nas
> permissoes). Nenhuma permissao sensivel nova (o `action`/popup nao e permissao;
> `scripting`/`storage`/`offscreen` inalterados). **Historico:** a v0.2.0 ("Livros
> Bobagi - Coletor") foi rejeitada por "Spam de palavra-chave" (listava as seis
> lojas por nome na descricao). **Regra duravel que continua valendo: NAO liste
> nomes de lojas/marcas de 3os na ficha** (keyword spam); a lista fica no site.

## Passos (atualizacao de item ja aprovado; ~5 min)

1. Entrar em https://chrome.google.com/webstore/devconsole com a conta Google
   (a taxa de US$ 5 e o e-mail de contato ja foram feitos na 1a publicacao).
2. Abrir o item **Farolivro** -> **Pacote -> Enviar novo pacote** ->
   `backend/static/ext/livros-coletor.zip` (ja e a v0.4.0, com o popup).
3. **Ficha da loja:** conferir que a Descricao e a de baixo (sem nomes de loja) e
   trocar os screenshots pelos de `docs/cws/` se quiser mostrar o popup.
4. **Salvar -> Enviar para revisao.** Quem ja tem a v0.3.0 recebe a v0.4.0 sozinho.

Revisao tipica: 1 a 3 dias. Uma versao nova com host novo (`farolivro`) pode
demorar um pouco mais por reavaliarem as permissoes de host.

## Ficha (aba "Detalhes do item")

- **Idioma da ficha:** Portugues (Brasil)
- **Nome:** ja vem do manifest: `Farolivro`
- **Resumo** (ja vem do manifest; limite de **132 caracteres**): `Fareje o menor preco de um livro, novo ou usado, em varias lojas de uma vez. Nao le sua navegacao.`
- **Categoria:** Compras (Shopping)
- **Descricao (colar):**

```
Farolivro fareja o menor preco de um livro, NOVO ou USADO, comparando varios
marketplaces brasileiros de uma vez, sem voce abrir site por site. E o
companheiro do site farolivro.bobagi.space, onde os resultados aparecem lado a
lado, agrupados por novo e usado.

Por que uma extensao? Muitos sites bloqueiam buscas automatizadas vindas de
servidores. O Farolivro faz a busca a partir do SEU navegador, como se voce
mesmo abrisse cada site, e envia os anuncios encontrados (titulo, preco, link)
para o comparativo.

Como usar:
1. Instale o Farolivro.
2. Clique no icone do Farolivro na barra do navegador, digite um livro e ele
   abre o comparativo ja farejando (ou abra farolivro.bobagi.space direto).
3. Veja as ofertas agrupadas em novo e usado, com o status honesto de cada
   fonte.

Privacidade, direto ao ponto:
- So age quando VOCE pede uma busca no site. Nunca roda nas paginas que voce
  visita nem le sua navegacao.
- Coleta apenas o texto da busca e o conteudo publico das paginas de resultado
  de busca. Nada de contas, cookies, historico ou dado pessoal.
- Sem anuncios, sem rastreadores, codigo aberto:
  https://github.com/Bobagi/comparador-livros

Politica de privacidade: https://farolivro.bobagi.space/privacidade
Projeto pessoal, sem afiliacao com nenhuma loja.
```

- **Icone da loja (128x128):** `docs/cws/icon128.png` (focinho Farolivro)
- **Screenshots (1280x800):** `docs/cws/screenshot-1-home.png` e
  `docs/cws/screenshot-2-resultados.png`
- **Site oficial:** `https://farolivro.bobagi.space`

## Aba "Praticas de privacidade"

- **Finalidade unica (colar):**

```
Comparar precos de livros: quando o usuario pede uma busca no site
farolivro.bobagi.space, o Farolivro consulta as paginas publicas de resultado de
busca de seis lojas brasileiras e envia os anuncios encontrados (titulo,
preco, link) ao site, que monta o comparativo. Nada roda sem pedido do
usuario.
```

- **Justificativa de cada permissao (colar em cada campo):**
  - `offscreen`: "Interpretar (DOMParser) o HTML das paginas de busca das lojas; o service worker MV3 nao tem DOM."
  - `storage`: "Guardar o identificador aleatorio de instalacao que autentica os envios ao backend. Nenhum dado pessoal."
  - `scripting`: "Injetar o leitor de pagina somente nas abas que a propria extensao abre (lojas que exigem renderizacao). Nunca roda nas abas do usuario."
  - **Permissoes de host** (uma justificativa geral): "As seis lojas: buscar a pagina publica de resultados a pedido do usuario. farolivro.bobagi.space (e livros.bobagi.space, o dominio anterior do mesmo produto, mantido durante a migracao): receber o pedido de busca e devolver os resultados. O Farolivro so age apos um pedido explicito do usuario no site."
- **Uso de codigo remoto:** Nao.
- **Dados de usuario coletados:** marcar somente **"Conteudo do site"**
  (website content) - conteudo das paginas publicas de resultado de busca das
  lojas, enviado ao backend do proprio produto para montar o comparativo.
  Todo o resto (PII, saude, financeiro, autenticacao, comunicacao, localizacao,
  historico, atividade do usuario): NAO.
- **Certificacoes** (as 3 caixas): nao vendemos dados; uso restrito a
  finalidade unica; nada de creditworthiness. Marcar as tres.
- **URL da politica de privacidade:** `https://farolivro.bobagi.space/privacidade`

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
