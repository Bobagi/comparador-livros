"""Testes do nucleo de matching, travados com anuncios REAIS rotulados na
Fase 0 (2026-08-10). Regra do produto: falso positivo e pior que falso
negativo, entao todo caso de ruido DEVE terminar fora de 'confirmada'.
"""

import pytest

from app.matching import (
    classify_condition,
    evaluate_listing,
    extract_formats,
    is_isbn,
    parse_price_cents,
    url_allowed,
)

Q_DEVORADORES = ("devoradores de estrelas andy weir", ["Andy", "Weir"])
Q_BERSERK = ("berserk vol 1 edicao de luxo", ["Kentaro", "Miura"])
Q_SANCHES = ("manual de direito penal parte geral rogerio sanches", ["Rogerio", "Sanches", "Cunha"])
Q_1984 = ("1984 george orwell companhia das letras", ["George", "Orwell"])
Q_DUNA = ("duna frank herbert aleph capa dura", ["Frank", "Herbert"])


def run(q, title, extra=""):
    query, author = q
    return evaluate_listing(query, title, extra, author_tokens=author)


# Ofertas reais da Fase 0 que DEVEM ser aceitas (confirmada ou provavel).

ACCEPT_CONFIRMADA = [
    (Q_DEVORADORES, "Livro Devoradores De Estrelas"),
    (Q_DEVORADORES, "Livro Devoradores de Estrelas, de Weir, Andy. Editora Suma de Letras, capa mole"),
    (Q_BERSERK, "Berserk Vol. 1: Edicao de Luxo, de Miura, Kentaro. Editorial Panini Brasil LTDA, capa mole em portugues, 2021"),
    (Q_SANCHES, "Manual De Direito Penal Parte Geral Volume Unico - 13 Edicao 2024 Juspodivm - Conforme Lei 14.811/24 - Rogerio Sanches Cunha"),
    (Q_1984, "1984, de George Orwell. Editora Companhia das Letras, capa mole em portugues, 2019"),
    (Q_DUNA, "Livro Duna - Frank Herbert - Capa Dura - Volume 1"),
]

ACCEPT_ANY_TIER = [
    # Titulo curto sem autor: aceitavel como confirmada OU provavel, nunca filtrada.
    (Q_SANCHES, "Manual de Direito Penal - Parte Geral"),
    (Q_1984, "Vendo livro usado 1984 - George Orwell"),
]


@pytest.mark.parametrize("q,title", ACCEPT_CONFIRMADA)
def test_ofertas_reais_confirmadas(q, title):
    r = run(q, title)
    assert r.tier == "confirmada", (title, r.tier, r.reason, r.score)


@pytest.mark.parametrize("q,title", ACCEPT_ANY_TIER)
def test_ofertas_reais_nao_filtradas(q, title):
    r = run(q, title)
    assert r.tier in ("confirmada", "provavel"), (title, r.tier, r.reason)


# Ruido real da Fase 0 que NUNCA pode sair como confirmada.

NOISE = [
    (Q_DEVORADORES, "Devoradores de estrelas eBook Kindle", "digital"),
    (Q_DEVORADORES, "Audiolivro Devoradores de estrelas Audible", "digital"),
    (Q_DEVORADORES, "DVD Devoradores De Estrelas (2026) (Dublado e Legendado)", "nao e livro"),
    (Q_DEVORADORES, "Devoradores de Estrelas (Project Hail Mary) (2026) Dublado e Legendado Blu-Ray", "nao e livro"),
    (Q_DEVORADORES, "Boneco Rocky Devoradores de Estrelas filme Project Hail Mary alienigena", "nao e livro"),
    (Q_DEVORADORES, "Poster Cartaz Devoradores de Estrelas E", "nao e livro"),
    (Q_DEVORADORES, "Devoradores de estrelas Pre-venda com brinde", "kit/brinde"),
    (Q_BERSERK, "Berserk Edicao De Luxo Manga, Volume 1 Ao 3 - Kit Panini | Frete gratis", "kit"),
    (Q_BERSERK, "Berserk 1 ao 16 volumes (Edicao de Luxo) Panini", "kit"),
    (Q_BERSERK, "Berserk Edicao de Luxo 1-19, 21, 23, 25 e 38", "lote"),
    (Q_BERSERK, "Berserk Vol. 4: Edicao de Luxo", "outro volume"),
    (Q_BERSERK, "Rev Berserk Ed Luxo Vol 002", "outro volume"),
    (Q_SANCHES, "Manual de Direito Penal - Parte Especial - Rogerio Sanches Cunha", "parte especial"),
    (Q_SANCHES, "Rogerio Sanches PDF parte geral", "digital"),
    (Q_SANCHES, "Manual de Direito Penal Brasileiro Parte Geral", "outro autor (Zaffaroni)"),
    (Q_SANCHES, "Livro Manual de Direito Penal Parte Geral Juarez Cirino dos Santos", "outro autor"),
    (Q_1984, "1984 + A Revolucao dos Bichos George Orwell", "combo"),
    (Q_1984, "Livro 1984 (Edicao em quadrinhos) por ORWELL GEORGE", "quadrinhos"),
    (Q_1984, "Livro A Revolucao dos Bichos George Orwell", "outro titulo"),
    (Q_DUNA, "Messias de Duna, livro 2, de Herbert Frank, Editora Aleph, capa mole", "outro volume/formato"),
    (Q_DUNA, "Box Duna Primeira Trilogia Arrakis", "box"),
    (Q_DUNA, "Colecao de 6 livros Duna de Frank Herbert", "colecao"),
    (Q_DUNA, "Duna (completo) Frank Herbert Aleph", "colecao completa"),
    (Q_DUNA, "Duna Segunda Trilogia", "trilogia"),
    (Q_DUNA, "Duna Frank Herbert Editora Nova Fronteira", "editora divergente"),
    (Q_DUNA, "Box Duna serie de Frank Herbert versao pocket", "box"),
]


@pytest.mark.parametrize("q,title,label", NOISE)
def test_ruido_real_nunca_confirmado(q, title, label):
    r = run(q, title)
    assert r.tier != "confirmada", (title, label, r.tier, r.score)


def test_ruido_maioria_filtrada_com_motivo():
    filtrados = sum(1 for q, t, _ in NOISE if run(q, t).tier == "filtrada")
    assert filtrados >= len(NOISE) * 0.8, f"so {filtrados}/{len(NOISE)} filtrados"


# Unidades: preco, condicao, formato, ISBN, hosts.

def test_parse_price_brl():
    assert parse_price_cents("R$ 78,99") == 7899
    assert parse_price_cents("R$ 1.234,56") == 123456
    assert parse_price_cents("R$ 143,9") == 14390
    assert parse_price_cents("R$ 78") == 7800
    assert parse_price_cents("78.99") == 7899
    assert parse_price_cents("sem preco") is None
    assert parse_price_cents(None) is None


def test_preco_no_snippet_do_titulo_ml():
    assert parse_price_cents("Livro Devoradores De Estrelas - R$ 78,99") == 7899


def test_condicao():
    assert classify_condition("livro lacrado nunca aberto") == "novo"
    assert classify_condition("seminovo capa dura") == "seminovo"
    assert classify_condition("usado, com marcas de uso") == "usado"
    assert classify_condition("desapego de estante") == "usado"
    assert classify_condition("nunca usado, no plastico") == "novo"
    assert classify_condition("Editora Nova Fronteira") is None
    assert classify_condition("livro em otimo estado") is None


def test_formatos():
    assert extract_formats("capa dura em portugues") == {"capa dura"}
    assert extract_formats("brochura 414p") == {"brochura"}
    assert extract_formats("edicao de bolso") == {"bolso"}
    assert extract_formats("Berserk vol 1") == set()


def test_isbn():
    assert is_isbn("9788576573135") == "9788576573135"
    assert is_isbn("978-85-7657-313-5") == "9788576573135"
    assert is_isbn("855651121X") == "855651121X"
    assert is_isbn("duna frank herbert") is None
    assert is_isbn("1984") is None


def test_url_allowlist_por_loja():
    assert url_allowed("mercadolivre", "https://produto.mercadolivre.com.br/MLB-123")
    assert url_allowed("mercadolivre", "https://www.meli.leitura.com.br/p/MLB20679953")
    assert url_allowed("olx", "https://sp.olx.com.br/anuncio-123")
    assert not url_allowed("olx", "https://evil.example.com/anuncio-123")
    assert not url_allowed("olx", "https://olx.com.br.evil.example/x")
    assert not url_allowed("amazon", "http://www.amazon.com.br/dp/X")  # http nao


def test_anuncio_c2c_curto_sem_autor_vira_provavel():
    r = run(Q_DUNA, "Duna capa dura", "usado, Fortaleza CE")
    assert r.tier == "provavel", (r.tier, r.reason, r.score)
    r2 = run(Q_1984, "1984", "livro usado")
    assert r2.tier == "provavel", (r2.tier, r2.reason)


def test_anuncio_curto_com_formato_divergente_continua_fora():
    r = run(Q_DUNA, "Duna brochura capa comum", "usado")
    assert r.tier == "filtrada"


def test_formato_divergente_capa_dura_vs_brochura():
    r = run(Q_DUNA, "Duna, de Herbert, Frank. Editora Aleph, capa mole em portugues, 2017")
    assert r.tier == "filtrada"
    assert "formato" in (r.reason or "")


def test_query_sem_formato_aceita_qualquer_capa():
    r = run(Q_1984, "1984 George Orwell Companhia das Letras capa dura edicao especial")
    assert r.tier in ("confirmada", "provavel")
