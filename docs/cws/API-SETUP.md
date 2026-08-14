# Publicar o Farolivro por API (Chrome Web Store API) - setup unico

Objetivo: deixar o Claude subir novas versoes da extensao e publicar sozinho
(`scripts/cws.py`), do mesmo jeito que ja faz com a Play Store (Tic Tac Verse).

## O que a API FAZ e o que NAO faz (honesto)

- **Faz:** subir um novo pacote (.zip) no item + **publicar** (enviar pra revisao).
  O `name`/`description` que atualizam vem do manifesto dentro do zip.
- **NAO faz:** editar a **descricao longa**, screenshots, icone da loja ou
  categoria da ficha (isso continua no painel). Como a v0.3.0 ja foi aprovada com
  a descricao limpa, isso nao e problema para as proximas versoes.
- **Publicar pela API ainda passa pela REVISAO do Google** (nao e instantaneo),
  igual ao painel.

## Passos que SO VOCE faz (uma vez, ~10 min, na sua conta Google)

Precisa ser feito com a **mesma conta que e dona da extensao** (gustavoperin067).

1. **Ligar a API.** GCP Console -> "APIs e servicos" -> "Ativar APIs" -> procure
   **"Chrome Web Store API"** -> Ativar. (Pode ser no mesmo projeto do OAuth do
   AdMob, tanto faz.)

2. **Criar um OAuth client "Aplicativo da Web".** "APIs e servicos" ->
   "Credenciais" -> "Criar credenciais" -> "ID do cliente OAuth" -> tipo
   **Aplicativo da Web** -> em "URIs de redirecionamento autorizados" adicione
   exatamente `https://developers.google.com/oauthplayground` -> Criar. Anote o
   **client_id** e o **client_secret**.
   > ⚠️ **NAO escolha "Extensao do Chrome"** (parece o certo, mas NAO e): esse
   > tipo pede um "ID do item" e serve para uma extensao autenticar usuarios em
   > APIs do Google de dentro dela, nao para publicar na loja. So o
   > **"Aplicativo da Web"** aceita a URI de redirecionamento do Playground. O
   > client "Desktop" do AdMob tambem nao serve aqui (sem redirect do Playground).

3. **Pegar o refresh token** no OAuth Playground:
   - Abra https://developers.google.com/oauthplayground
   - Engrenagem (canto sup. direito) -> marque **"Use your own OAuth credentials"**
     -> cole o client_id e client_secret do passo 2.
   - No campo **"Input your own scopes"** cole:
     `https://www.googleapis.com/auth/chromewebstore` -> **Authorize APIs** ->
     faca login com a conta dona da extensao -> permita.
   - Em "Step 2" clique **"Exchange authorization code for tokens"** e copie o
     **Refresh token**.

4. **Me mande** (aqui no chat, ou escreva voce mesmo nos arquivos por SSH):
   - client_id e client_secret (do passo 2)
   - refresh_token (do passo 3)
   Eu gravo em `/root/.config/bobagi-google/cws-client.json` e `cws-token.json`
   (chmod 600, fora do repo). *Obs.: sao segredos; se preferir nao colar no chat,
   crie os dois arquivos por SSH no formato abaixo.*

```
# /root/.config/bobagi-google/cws-client.json
{"installed":{"client_id":"...","client_secret":"..."}}
# /root/.config/bobagi-google/cws-token.json
{"refresh_token":"..."}
```

## Depois do setup (eu faco)

```bash
python3 scripts/cws.py doctor                # confere auth + estado do item
python3 scripts/cws.py upload-publish backend/static/ext/livros-coletor.zip
```

Isso sobe a v0.4.0 e envia pra revisao. Dai em diante, toda versao nova eu subo
e publico por aqui, sem voce abrir o painel.

## Nota de validade

A API v1.1 usada pelo `cws.py` funciona **ate 2026-10-15**; depois disso o Google
exige a v2. Quando chegar perto, eu migro o script (os endpoints mudam, a ideia e
a mesma).
