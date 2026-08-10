"""Nucleo de normalizacao, classificacao e matching de anuncios de livros.

Regra de ouro do produto: falso positivo (mostrar o livro errado) e MUITO pior
que falso negativo. Na duvida, rebaixa para "provavel" ou filtra com motivo.
Todo comportamento aqui e travado por backend/tests/test_matching.py, que usa
anuncios reais rotulados na Fase 0 (fase0/*.csv).
"""

import re
import unicodedata
from dataclasses import dataclass, field

from rapidfuzz import fuzz

SCORE_THRESHOLD = 82

STORES = ["mercadolivre", "amazon", "estantevirtual", "olx", "enjoei", "shopee"]

STORE_HOSTS = {
    "mercadolivre": (".mercadolivre.com.br", ".mercadolibre.com", ".meli.leitura.com.br"),
    "amazon": (".amazon.com.br",),
    "estantevirtual": (".estantevirtual.com.br",),
    "olx": (".olx.com.br",),
    "enjoei": (".enjoei.com.br",),
    "shopee": (".shopee.com.br",),
}

STOPWORDS = {
    "de", "da", "do", "das", "dos", "e", "o", "a", "os", "as", "um", "uma",
    "em", "no", "na", "nos", "nas", "para", "por", "com", "sem", "ao", "the",
}

# Palavras de anuncio que nao carregam identidade do livro.
NOISE_TOKENS = {
    "livro", "livros", "frete", "gratis", "gratuito", "promocao", "oferta",
    "original", "envio", "imediato", "entrega", "rapida", "novo", "nova",
    "usado", "usada", "seminovo", "seminova", "lacrado", "lacrada",
    "desapego", "brinde", "parcelamento", "juros", "leia", "descricao",
    "portugues", "idioma", "fisico", "impresso", "exemplar", "unidade",
    "paginas", "pag", "pags", "pp",
}

# Vocabulario de edicao: vira flag, nao identidade.
EDITION_TOKENS = {
    "vol", "volume", "volumes", "unico", "edicao", "ed", "reimpressao",
    "capa", "dura", "mole", "comum", "brochura", "bolso", "pocket",
    "especial", "luxo", "limitada", "sobrecapa", "ilustrada", "definitiva",
    "atualizada", "revisada", "ampliada", "conforme", "lei", "editora",
    "edition", "deluxe",
}

PUBLISHER_TOKENS = {
    "aleph", "suma", "panini", "juspodivm", "arqueiro", "sextante",
    "intrinseca", "rocco", "record", "darkside", "fronteira", "companhia",
    "letras", "schwarcz", "saraiva", "atlas", "forense", "revan", "jbc",
    "newpop", "pipoca", "nanquim", "veneta", "todavia", "zahar", "globo",
    "moderna", "atica", "scipione", "ftd", "leya", "galera", "seguinte",
}

DIGITAL_RE = re.compile(
    r"\b(pdf|e ?-?book|kindle|epub|mobi|audiobook|audio ?livro|audible|"
    r"resumo|resumos|digital|download)\b"
)
NOTBOOK_RE = re.compile(
    r"\b(dvd|blu ?-?ray|4k|boneco|figure|funko|estatueta|miniatura|poster|"
    r"cartaz|caneca|camiseta|camisa|chaveiro|adesivo|quadro|placa|mousepad|"
    r"totem|filme dublado|dublado e legendado)\b"
)
KIT_RE = re.compile(
    r"\b(kit|lote|colecao|combo|box|pack|trilogia|duologia|tetralogia|"
    r"completo|completa|brinde)\b"
    r"|\b\d{1,3}\s*(?:ao|ate)\s*\d{1,3}\b"
    r"|\b\d{1,3}\s*-\s*\d{1,3}\b"
    r"|(?:\d{1,3}\s*,\s*){2,}"
    r"|\b\d{1,2}\s+livros\b"
    r"|\+"
)
QUADRINHOS_RE = re.compile(r"\b(quadrinhos|hq|graphic ?novel)\b")

VOLUME_RE = re.compile(r"\b(?:vol|volume|tomo|livro|n|no|num|numero)\s*\.?\s*(\d{1,3})\b|#(\d{1,3})\b")

CONDITION_NEW_RE = re.compile(r"\b(lacrad[oa]|nunca (?:usad[oa]|lid[oa])|novo)\b")
CONDITION_SEMI_RE = re.compile(r"\bsemi ?-?nov[oa]\b")
CONDITION_USED_RE = re.compile(r"\b(usad[oa]|desapego|sebo|marcas de uso|leve desgaste)\b")

ISBN_RE = re.compile(r"^(?:97[89][- ]?)?(?:\d[- ]?){9}[\dxX]$")

PRICE_RE = re.compile(r"(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?")
PRICE_US_RE = re.compile(r"(\d+)\.(\d{2})\b")


def strip_accents(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", text)
        if unicodedata.category(ch) != "Mn"
    )


def soft_norm(text: str) -> str:
    """minusculas + sem acento, preservando pontuacao (para regex de kit '+')."""
    return strip_accents((text or "").lower())


def norm(text: str) -> str:
    s = soft_norm(text)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def toks(text: str) -> list[str]:
    return [t for t in norm(text).split() if t not in STOPWORDS]


def content_tokens(text: str) -> set[str]:
    """Tokens que carregam identidade (sem ruido de anuncio nem vocabulario de edicao)."""
    return {
        t for t in toks(text)
        if t not in NOISE_TOKENS and t not in EDITION_TOKENS and not t.isdigit()
    }


def is_isbn(query: str) -> str | None:
    q = query.strip().replace("-", "").replace(" ", "")
    if ISBN_RE.match(query.strip()):
        return q
    if re.fullmatch(r"\d{9}[\dxX]|\d{13}", q):
        return q
    return None


def parse_price_cents(text: str | None) -> int | None:
    if not text:
        return None
    s = soft_norm(text).replace("r$", " ").strip()
    m = PRICE_US_RE.search(s)
    if m and "," not in s:
        return int(m.group(1)) * 100 + int(m.group(2))
    m = PRICE_RE.search(s)
    if not m:
        return None
    inteiro = int(m.group(1).replace(".", ""))
    cents = int(m.group(2).ljust(2, "0")) if m.group(2) else 0
    return inteiro * 100 + cents


def classify_condition(text: str) -> str | None:
    s = soft_norm(text)
    if CONDITION_SEMI_RE.search(s):
        return "seminovo"
    if CONDITION_NEW_RE.search(s):
        return "novo"
    if CONDITION_USED_RE.search(s):
        return "usado"
    return None


def extract_formats(text: str) -> set[str]:
    s = soft_norm(text)
    fmts: set[str] = set()
    if re.search(r"capa\s*dura", s):
        fmts.add("capa dura")
    if re.search(r"capa\s*(mole|comum|flexivel)|brochura", s):
        fmts.add("brochura")
    if re.search(r"\b(bolso|pocket)\b", s):
        fmts.add("bolso")
    return fmts


def extract_volumes(text: str) -> set[int]:
    s = soft_norm(text)
    vols: set[int] = set()
    for m in VOLUME_RE.finditer(s):
        raw = m.group(1) or m.group(2)
        v = int(raw)
        if 0 < v < 200:
            vols.add(v)
    return vols


CONFLICT_PAIRS = [("geral", "especial")]


@dataclass
class MatchResult:
    tier: str  # confirmada | provavel | filtrada
    score: float
    reason: str | None = None
    condition: str | None = None
    formats: set[str] = field(default_factory=set)


def evaluate_listing(
    query: str,
    title: str,
    description: str = "",
    author_tokens: list[str] | None = None,
    store: str | None = None,
) -> MatchResult:
    """Decide o destino de um anuncio para uma busca.

    author_tokens: tokens do autor canonico quando conhecidos (OpenLibrary ou
    campo explicito). Sem eles, a regra de autor divergente nao se aplica
    (limitacao documentada no README).
    """
    full = f"{title} {description}".strip()
    soft = soft_norm(full)
    q_toks = toks(query)
    q_set = set(q_toks)
    l_set = set(toks(full))

    score = fuzz.token_set_ratio(" ".join(q_toks), " ".join(toks(full)))
    cond = classify_condition(full)
    fmts = extract_formats(full)
    base = dict(score=score, condition=cond, formats=fmts)

    if DIGITAL_RE.search(soft):
        return MatchResult("filtrada", reason="digital (ebook/pdf/audio/resumo)", **base)
    if NOTBOOK_RE.search(soft):
        return MatchResult("filtrada", reason="nao e livro", **base)
    if QUADRINHOS_RE.search(soft) and not QUADRINHOS_RE.search(soft_norm(query)):
        return MatchResult("filtrada", reason="edicao em quadrinhos", **base)
    if KIT_RE.search(soft):
        return MatchResult("filtrada", reason="kit/lote/box", **base)

    q_vols = extract_volumes(query)
    l_vols = extract_volumes(full)
    if q_vols and l_vols and q_vols.isdisjoint(l_vols):
        return MatchResult("filtrada", reason="outro volume", **base)

    for a, b in CONFLICT_PAIRS:
        if a in q_set and b in l_set and a not in l_set:
            return MatchResult("filtrada", reason=f"'{b}' diverge de '{a}' na busca", **base)
        if b in q_set and a in l_set and b not in l_set:
            return MatchResult("filtrada", reason=f"'{a}' diverge de '{b}' na busca", **base)

    q_pub = q_set & PUBLISHER_TOKENS
    l_pub = l_set & PUBLISHER_TOKENS
    if q_pub and l_pub and q_pub.isdisjoint(l_pub):
        return MatchResult("filtrada", reason="editora divergente", **base)

    # Busca com editora ("1984 companhia das letras") nao pode perder o anuncio
    # C2C curto ("1984 george orwell"): se TODOS os tokens nao-editora da busca
    # estao no anuncio, o titulo bate por contencao, e a editora ausente
    # rebaixa para "provavel" mais abaixo.
    q_core = [t for t in q_toks if t not in PUBLISHER_TOKENS]
    matched_via_core = (
        score < SCORE_THRESHOLD and bool(q_core) and set(q_core) <= l_set
    )
    if matched_via_core:
        score = 100.0
        base["score"] = score

    # Anuncio C2C curto ("Duna capa dura") nao confirma o autor que veio na
    # busca; com autor canonico conhecido, os tokens dele sao opcionais e o
    # resto da busca contida no anuncio rebaixa para "provavel" (nao some).
    if score < SCORE_THRESHOLD and author_tokens:
        a_opt = {strip_accents(a.lower()) for a in author_tokens if len(a) >= 3}
        q_core2 = {t for t in q_core if t not in a_opt}
        if q_core2 and q_core2 <= l_set:
            q_fmts2 = extract_formats(query)
            if q_fmts2 and fmts and q_fmts2.isdisjoint(fmts):
                return MatchResult("filtrada", reason="formato divergente (capa dura x brochura)", **base)
            return MatchResult("provavel", reason="anuncio curto: autor nao confirmado", **base)

    if score < SCORE_THRESHOLD:
        return MatchResult("filtrada", reason=f"titulo nao bate (score {score:.0f})", **base)

    q_fmts = extract_formats(query)
    if q_fmts and fmts and q_fmts.isdisjoint(fmts):
        return MatchResult("filtrada", reason="formato divergente (capa dura x brochura)", **base)

    # Regras de rebaixamento para "provavel" (mostrado a parte, com aviso).
    extras = {
        t for t in (content_tokens(full) - content_tokens(query))
        if len(t) >= 4 and t not in PUBLISHER_TOKENS
    }
    if author_tokens:
        a_set = {strip_accents(a.lower()) for a in author_tokens if len(a) >= 3}
        author_present = bool(a_set & l_set)
        if not author_present and extras:
            return MatchResult(
                "provavel", reason="autor nao aparece no anuncio e ha termos estranhos", **base
            )
    if matched_via_core and q_pub and not l_pub:
        return MatchResult("provavel", reason="editora pedida nao confirmada no anuncio", **base)
    if q_fmts and not fmts:
        return MatchResult("provavel", reason="formato pedido nao confirmado no anuncio", **base)

    return MatchResult("confirmada", **base)


def url_allowed(store: str, url: str) -> bool:
    m = re.match(r"https://([^/]+)/", url + "/")
    if not m:
        return False
    host = m.group(1).lower()
    return any(
        host == suffix.lstrip(".") or host.endswith(suffix)
        for suffix in STORE_HOSTS.get(store, ())
    )
