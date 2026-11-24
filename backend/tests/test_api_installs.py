"""Testes do registro por instalacao e da autenticacao do POST de resultados.

O pacote da extensao e publico (Chrome Web Store), entao a seguranca do
endpoint de ingestao depende inteiramente do que esta travado aqui:
token por instalacao (hash no banco), chave master do .env, teto de
registros por IP, rate limit por instalacao e recusa de busca velha.
"""

import importlib
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

MASTER = "chave-master-de-teste"


@pytest.fixture()
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("LIVROS_DATA", str(tmp_path))
    monkeypatch.setenv("LIVROS_KEY", MASTER)
    import app.main as m

    m = importlib.reload(m)

    async def no_lookup(query):
        return None

    monkeypatch.setattr(m, "openlibrary_lookup", no_lookup)
    with TestClient(m.app) as client:
        yield m, client


def register(client):
    r = client.post("/api/installs")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] and data["token"]
    return data


def create_search(client, query="devoradores de estrelas andy weir"):
    r = client.post("/api/searches", json={"query": query})
    assert r.status_code == 200
    return r.json()["id"]


def post_results(client, sid, headers):
    body = {"store": "olx", "status": "empty", "listings": []}
    return client.post(f"/api/searches/{sid}/results", json=body, headers=headers)


def test_registro_devolve_credencial_e_guarda_so_o_hash(api):
    m, client = api
    cred = register(client)
    with m.db() as conn:
        row = conn.execute("SELECT * FROM installs WHERE id=?", (cred["id"],)).fetchone()
    assert row is not None
    assert cred["token"] not in (row["token_hash"] or "")
    assert len(row["token_hash"]) == 64  # sha256 hex, nunca o token em claro


def test_token_de_instalacao_autentica_e_token_errado_nao(api):
    m, client = api
    cred = register(client)
    sid = create_search(client)
    ok = post_results(client, sid, {"x-livros-install": cred["id"], "x-livros-key": cred["token"]})
    assert ok.status_code == 200
    bad = post_results(client, sid, {"x-livros-install": cred["id"], "x-livros-key": "x" * 43})
    assert bad.status_code == 401
    outro = register(client)
    cruzado = post_results(client, sid, {"x-livros-install": cred["id"], "x-livros-key": outro["token"]})
    assert cruzado.status_code == 401


def test_chave_master_continua_valendo_e_sem_credencial_e_401(api):
    m, client = api
    sid = create_search(client)
    assert post_results(client, sid, {"x-livros-key": MASTER}).status_code == 200
    assert post_results(client, sid, {"x-livros-key": "errada"}).status_code == 401
    assert post_results(client, sid, {}).status_code == 401
    # id de instalacao inexistente nao cai no caminho da master
    assert post_results(client, sid, {"x-livros-install": "nao-existe", "x-livros-key": MASTER}).status_code == 401


def test_teto_de_registros_por_ip(api, monkeypatch):
    m, client = api
    monkeypatch.setattr(m, "INSTALLS_PER_IP_PER_DAY", 3)
    for _ in range(3):
        register(client)
    r = client.post("/api/installs")
    assert r.status_code == 429


def test_rate_limit_por_instalacao(api, monkeypatch):
    m, client = api
    monkeypatch.setattr(m, "POSTS_PER_WINDOW", 2)
    cred = register(client)
    sid = create_search(client)
    h = {"x-livros-install": cred["id"], "x-livros-key": cred["token"]}
    assert post_results(client, sid, h).status_code == 200
    assert post_results(client, sid, h).status_code == 200
    assert post_results(client, sid, h).status_code == 429
    # a chave master nao passa pelo teto por instalacao
    assert post_results(client, sid, {"x-livros-key": MASTER}).status_code == 200


def test_race_teto_por_ip_e_atomico(api, monkeypatch):
    """Dispara N registros CONCORRENTES do mesmo IP: o SELECT COUNT->INSERT so
    respeita o teto se for atomico (BEGIN IMMEDIATE). Sem isso a rajada le o
    mesmo count velho e todos passam. Endpoints sync do FastAPI rodam no
    threadpool, entao as chamadas concorrem de verdade contra o mesmo DB."""
    m, client = api
    monkeypatch.setattr(m, "INSTALLS_PER_IP_PER_DAY", 5)
    n = 40
    with ThreadPoolExecutor(max_workers=n) as ex:
        codes = [f.result().status_code for f in [ex.submit(client.post, "/api/installs") for _ in range(n)]]
    with m.db() as conn:
        rows = conn.execute("SELECT COUNT(*) c FROM installs").fetchone()["c"]
    assert codes.count(200) == 5, codes.count(200)
    assert rows == 5, rows  # nunca mais que o teto, mesmo sob rajada


def test_race_rate_limit_por_instalacao_e_atomico(api, monkeypatch):
    """N posts concorrentes com o MESMO token: o ler-posts->UPDATE so segura o
    teto se atomico. Prova que a rajada nao fura POSTS_PER_WINDOW."""
    m, client = api
    monkeypatch.setattr(m, "POSTS_PER_WINDOW", 10)
    cred = register(client)
    sid = create_search(client)
    h = {"x-livros-install": cred["id"], "x-livros-key": cred["token"]}
    body = {"store": "olx", "status": "empty", "listings": []}
    n = 60
    with ThreadPoolExecutor(max_workers=n) as ex:
        codes = [f.result().status_code for f in
                 [ex.submit(client.post, f"/api/searches/{sid}/results", json=body, headers=h) for _ in range(n)]]
    assert codes.count(200) == 10, codes.count(200)
    assert codes.count(429) == n - 10


def test_busca_velha_nao_aceita_resultado(api):
    m, client = api
    cred = register(client)
    sid = create_search(client)
    with m.db() as conn:
        conn.execute(
            "UPDATE searches SET created_at=? WHERE id=?",
            (int(time.time()) - m.RESULTS_MAX_AGE_S - 5, sid),
        )
    r = post_results(client, sid, {"x-livros-install": cred["id"], "x-livros-key": cred["token"]})
    assert r.status_code == 410


def test_amostra_salva_redige_email(api):
    """Pagina de loja logada carrega o e-mail do proprio usuario; a amostra
    gravada em disco nao pode guardar isso."""
    m, client = api
    m.save_sample("mercadolivre", "livro teste", '<html>"email": "fulano.tal+x@gmail.com"</html>')
    files = list(m.SAMPLES_DIR.glob("mercadolivre-livro-teste-*.html"))
    assert files, "amostra nao foi gravada"
    body = files[-1].read_text()
    assert "fulano.tal+x@gmail.com" not in body
    assert "***@***" in body


def _auth(cred):
    return {"x-livros-install": cred["id"], "x-livros-key": cred["token"]}


def test_anuncio_invalido_nao_derruba_o_lote(api):
    """Regressao real (nov/2026): o link de rastreio do Mercado Livre passava de
    1000 caracteres, o lote inteiro tomava 422 e a loja ficava 'pendente'.
    Agora cada anuncio e validado sozinho."""
    m, client = api
    cred = register(client)
    sid = create_search(client, "o pequeno principe")
    rastreio = "https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=" + "x" * 1500
    body = {
        "store": "mercadolivre",
        "status": "ok",
        "listings": [
            {"title": "O Pequeno Principe edicao de bolso", "priceText": "R$ 19,90",
             "url": "https://produto.mercadolivre.com.br/MLB-1234567890-o-pequeno-principe-_JM"},
            {"title": "O Pequeno Principe capa dura", "priceText": 39.9,
             "url": "https://produto.mercadolivre.com.br/MLB-3234567890-o-pequeno-principe-_JM"},
            {"title": "O Pequeno Principe patrocinado", "url": rastreio},
            {"title": "x" * 900, "priceText": "R$ 25,00",
             "url": "https://produto.mercadolivre.com.br/MLB-2234567890-o-pequeno-principe-_JM"},
            {"title": "O Pequeno Principe sem url"},
            "isto nem e um objeto",
        ],
    }
    r = client.post(f"/api/searches/{sid}/results", json=body, headers=_auth(cred))
    assert r.status_code == 200, r.text
    # o bom, o de preco numerico e o de titulo enorme (cortado) entram; o link
    # de rastreio gigante, o sem url e o lixo nao-objeto ficam de fora
    assert r.json()["accepted"] == 3
    data = client.get(f"/api/searches/{sid}").json()
    ml = next(s for s in data["stores"] if s["store"] == "mercadolivre")
    assert ml["status"] == "ok" and ml["count"] == 3
    with m.db() as conn:
        rows = conn.execute("SELECT url, title_raw, price_cents FROM offers WHERE search_id=?", (sid,)).fetchall()
    assert all(len(r_["url"]) <= m.URL_MAX for r_ in rows)
    assert all(len(r_["title_raw"]) <= 400 for r_ in rows)
    assert not any("click1" in r_["url"] for r_ in rows)
    assert 3990 in [r_["price_cents"] for r_ in rows]


def test_status_login_aceito(api):
    m, client = api
    cred = register(client)
    sid = create_search(client)
    body = {"store": "shopee", "status": "login", "listings": []}
    r = client.post(f"/api/searches/{sid}/results", json=body, headers=_auth(cred))
    assert r.status_code == 200
    data = client.get(f"/api/searches/{sid}").json()
    assert next(s for s in data["stores"] if s["store"] == "shopee")["status"] == "login"


def test_status_desconhecido_continua_recusado(api):
    m, client = api
    cred = register(client)
    sid = create_search(client)
    body = {"store": "shopee", "status": "hackeado", "listings": []}
    r = client.post(f"/api/searches/{sid}/results", json=body, headers=_auth(cred))
    assert r.status_code == 400


def test_lote_com_mais_de_60_anuncios_e_recusado(api):
    m, client = api
    cred = register(client)
    sid = create_search(client)
    item = {"title": "livro qualquer", "url": "https://www.olx.com.br/livro-1234567890"}
    body = {"store": "olx", "status": "ok", "listings": [item] * 61}
    r = client.post(f"/api/searches/{sid}/results", json=body, headers=_auth(cred))
    assert r.status_code == 422


def test_sem_extensao_nao_cria_busca_fantasma(api):
    """Sem a extensao o site pede so o cache: 40 de 50 buscas reais ficaram
    'pendentes' para sempre porque eram criadas sem ninguem para coletar."""
    m, client = api
    r = client.post("/api/searches", json={"query": "vargas llosa", "only_cached": True})
    assert r.status_code == 200
    assert r.json()["id"] is None
    with m.db() as conn:
        assert conn.execute("SELECT COUNT(*) c FROM searches").fetchone()["c"] == 0


def test_sem_extensao_ainda_ve_o_que_ja_foi_farejado(api):
    m, client = api
    cred = register(client)
    sid = create_search(client, "vargas llosa")
    body = {"store": "olx", "status": "empty", "listings": []}
    assert client.post(f"/api/searches/{sid}/results", json=body, headers=_auth(cred)).status_code == 200
    r = client.post("/api/searches", json={"query": "Vargas Llosa", "only_cached": True})
    assert r.json() == {"id": sid, "cached": True, "canonical": {"title": None, "author": None}}


def test_outra_instalacao_nao_sequestra_busca_alheia(api):
    """Ataque confirmado ao vivo (24/11/2026): a 2a instalacao descobria o id
    repetindo a consulta e trocava os anuncios da vitima por um golpe."""
    m, client = api
    a, ev = register(client), register(client)
    sid = create_search(client, "livro sequestro teste")
    ok = {"store": "olx", "status": "ok", "listings": [
        {"title": "livro sequestro teste", "priceText": "R$ 50,00",
         "url": "https://www.olx.com.br/livro-sequestro-teste-1234567890"}]}
    assert client.post(f"/api/searches/{sid}/results", json=ok, headers=_auth(a)).status_code == 200
    golpe = {"store": "olx", "status": "ok", "listings": [
        {"title": "livro sequestro teste", "priceText": "R$ 1,00",
         "url": "https://www.olx.com.br/golpe-0000000001"}]}
    assert client.post(f"/api/searches/{sid}/results", json=golpe, headers=_auth(ev)).status_code == 403
    apaga = {"store": "amazon", "status": "blocked", "listings": []}
    assert client.post(f"/api/searches/{sid}/results", json=apaga, headers=_auth(ev)).status_code == 403
    data = client.get(f"/api/searches/{sid}").json()
    precos = [o["price_cents"] for g in data["confirmadas"].values() for o in g] + [o["price_cents"] for o in data["provaveis"]]
    assert precos == [5000]
    # a dona continua entregando as outras lojas
    assert client.post(f"/api/searches/{sid}/results", json=apaga, headers=_auth(a)).status_code == 200


def test_corrida_pela_posse_da_busca_tem_um_dono_so(api):
    m, client = api
    creds = [register(client) for _ in range(6)]
    sid = create_search(client, "livro corrida posse")
    body = {"store": "olx", "status": "empty", "listings": []}

    def send(c):
        return client.post(f"/api/searches/{sid}/results", json=body, headers=_auth(c)).status_code

    with ThreadPoolExecutor(max_workers=6) as ex:
        codes = list(ex.map(send, creds))
    assert codes.count(200) == 1 and codes.count(403) == 5, codes
