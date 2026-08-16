"""Testes do que o site anuncia sobre si: a versao mais recente da extensao
(lida do zip servido e injetada no <meta name="farolivro-ext">) e as rotas de
descoberta (robots.txt e sitemap.xml, que sem rota propria cairiam no
catch-all e devolveriam o index)."""

import importlib
import json
import zipfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("LIVROS_DATA", str(tmp_path))
    monkeypatch.setenv("LIVROS_KEY", "chave-master-de-teste")
    import app.main as m

    m = importlib.reload(m)
    with TestClient(m.app) as client:
        yield m, client


def fake_static(tmp_path, manifest):
    static = tmp_path / "static"
    (static / "ext").mkdir(parents=True)
    (static / "index.html").write_text(
        '<meta name="farolivro-ext" content="__EXT_VERSION__">'
    )
    with zipfile.ZipFile(static / "ext" / "livros-coletor.zip", "w") as z:
        z.writestr("manifest.json", json.dumps(manifest))
    return static


def test_versao_da_extensao_vem_do_zip_e_entra_no_meta(api, tmp_path, monkeypatch):
    m, _ = api
    monkeypatch.setattr(m, "STATIC_DIR", fake_static(tmp_path, {"version": "9.9.9"}))
    assert m.ext_version() == "9.9.9"
    m.build_index()
    assert 'content="9.9.9"' in m.INDEX_HTML
    assert "__EXT_VERSION__" not in m.INDEX_HTML


def test_versao_invalida_ou_zip_quebrado_viram_string_vazia(api, tmp_path, monkeypatch):
    m, _ = api
    monkeypatch.setattr(
        m, "STATIC_DIR", fake_static(tmp_path, {"version": '"><script>x</script>'})
    )
    assert m.ext_version() == ""
    monkeypatch.setattr(m, "STATIC_DIR", tmp_path / "nao-existe")
    assert m.ext_version() == ""


def test_robots_e_sitemap_nao_caem_no_catch_all(api):
    _, client = api
    robots = client.get("/robots.txt")
    assert robots.status_code == 200
    assert "Sitemap: https://farolivro.bobagi.space/sitemap.xml" in robots.text
    assert "<html" not in robots.text.lower()

    sitemap = client.get("/sitemap.xml")
    assert sitemap.status_code == 200
    assert sitemap.headers["content-type"].startswith("application/xml")
    assert "<loc>https://farolivro.bobagi.space/</loc>" in sitemap.text
    assert "<loc>https://farolivro.bobagi.space/privacidade</loc>" in sitemap.text
