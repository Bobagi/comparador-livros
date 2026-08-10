"""Backend do comparador de livros (livros.bobagi.space).

A VPS NUNCA busca nas lojas (IP de datacenter e bloqueado por todas; medido na
Fase 0). Quem coleta e a extensao de navegador do operador; aqui ficam busca,
normalizacao, matching, cache e o status honesto por loja. Unica chamada
externa server-side: OpenLibrary (metadados, API aberta).
"""

import hashlib
import hmac
import json
import mimetypes
import os

mimetypes.add_type("font/woff2", ".woff2")
import re
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from rapidfuzz import fuzz

from . import matching as M

DATA_DIR = Path(os.environ.get("LIVROS_DATA", "/data"))
DB_PATH = DATA_DIR / "livros.db"
SAMPLES_DIR = DATA_DIR / "samples"
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
LIVROS_KEY = os.environ.get("LIVROS_KEY", "")
CACHE_TTL_S = 6 * 3600
SEARCH_TIMEOUT_S = 150
MAX_SAMPLES = 60

STATUS_VALUES = {"ok", "empty", "blocked", "error"}


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS searches(
                id TEXT PRIMARY KEY,
                query TEXT NOT NULL,
                norm_query TEXT NOT NULL,
                canonical_title TEXT,
                canonical_author TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_searches_norm ON searches(norm_query, created_at);
            CREATE TABLE IF NOT EXISTS store_status(
                search_id TEXT NOT NULL,
                store TEXT NOT NULL,
                status TEXT NOT NULL,
                detail TEXT,
                count INTEGER DEFAULT 0,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (search_id, store)
            );
            CREATE TABLE IF NOT EXISTS offers(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                search_id TEXT NOT NULL,
                store TEXT NOT NULL,
                title_raw TEXT NOT NULL,
                url TEXT NOT NULL,
                seller TEXT,
                price_cents INTEGER,
                condition TEXT,
                formats TEXT,
                tier TEXT NOT NULL,
                score REAL,
                reason TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_offers_search ON offers(search_id);
            """
        )


INDEX_HTML = ""


def build_index() -> None:
    """Carimba as URLs de asset com hash do conteudo: a zona e proxied e o
    Cloudflare cacheia .js/.css/.zip por 4h; sem o carimbo, deploy novo serve
    arquivo velho (armadilha documentada do box)."""
    global INDEX_HTML
    html = (STATIC_DIR / "index.html").read_text()
    stamps = {
        "/static/style.css": STATIC_DIR / "style.css",
        "/static/app.js": STATIC_DIR / "app.js",
        "/static/fonts/faces.css": STATIC_DIR / "fonts" / "faces.css",
        "/ext/livros-coletor.zip": STATIC_DIR / "ext" / "livros-coletor.zip",
    }
    for url, path in stamps.items():
        if path.exists():
            h = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
            html = html.replace(url, f"{url}?v={h}")
    INDEX_HTML = html


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    build_index()
    yield


app = FastAPI(title="Livros Bobagi", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*|https://livros\.bobagi\.space",
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "x-livros-key"],
)


def require_key(x_livros_key: str | None) -> None:
    if not LIVROS_KEY or not x_livros_key or not hmac.compare_digest(x_livros_key, LIVROS_KEY):
        raise HTTPException(401, "chave invalida")


async def openlibrary_lookup(query: str) -> dict | None:
    """Metadados canonicos. Falha em silencio (metadado e enriquecimento, nao gate)."""
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            isbn = M.is_isbn(query)
            if isbn:
                r = await client.get(
                    "https://openlibrary.org/api/books",
                    params={"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"},
                )
                data = r.json().get(f"ISBN:{isbn}")
                if data:
                    return {
                        "title": data.get("title"),
                        "author": " ".join(a.get("name", "") for a in data.get("authors", [])[:2]),
                        "via": "isbn",
                    }
                return None
            r = await client.get(
                "https://openlibrary.org/search.json",
                params={"q": query, "limit": 5, "fields": "title,author_name"},
            )
            best, best_score = None, 0.0
            for doc in r.json().get("docs", []):
                title = doc.get("title") or ""
                author = (doc.get("author_name") or [""])[0]
                # compara contra titulo+autor: a busca do usuario mistura os dois,
                # e titulo traduzido (Duna/Dune) ainda casa no nivel de caracteres
                score = fuzz.token_set_ratio(M.norm(query), M.norm(f"{title} {author}"))
                if score > best_score:
                    best, best_score = {"title": title, "author": author, "via": "search"}, score
            if best and best_score >= 80:
                return best
    except Exception:
        return None
    return None


class SearchIn(BaseModel):
    query: str = Field(min_length=3, max_length=120)
    force: bool = False


class ListingIn(BaseModel):
    title: str = Field(min_length=1, max_length=400)
    priceText: str | None = Field(default=None, max_length=60)
    url: str = Field(min_length=12, max_length=1000)
    seller: str | None = Field(default=None, max_length=120)
    condition: str | None = Field(default=None, max_length=30)
    extra: str | None = Field(default=None, max_length=400)


class ResultsIn(BaseModel):
    store: str
    status: str
    listings: list[ListingIn] = Field(default_factory=list, max_length=60)
    diag: dict | None = None
    sampleHtml: str | None = Field(default=None, max_length=200_000)


@app.get("/health")
def health():
    with db() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}


@app.post("/api/searches")
async def create_search(body: SearchIn):
    norm_query = M.norm(body.query)
    if len(norm_query) < 3:
        raise HTTPException(400, "busca curta demais")
    now = int(time.time())
    with db() as conn:
        if not body.force:
            row = conn.execute(
                "SELECT * FROM searches WHERE norm_query=? AND created_at>? ORDER BY created_at DESC LIMIT 1",
                (norm_query, now - CACHE_TTL_S),
            ).fetchone()
            if row:
                has_results = conn.execute(
                    "SELECT COUNT(*) c FROM store_status WHERE search_id=? AND status IN ('ok','empty','blocked','error')",
                    (row["id"],),
                ).fetchone()["c"]
                if has_results:
                    return {"id": row["id"], "cached": True,
                            "canonical": {"title": row["canonical_title"], "author": row["canonical_author"]}}
    meta = await openlibrary_lookup(body.query)
    sid = str(uuid.uuid4())
    with db() as conn:
        conn.execute(
            "INSERT INTO searches(id, query, norm_query, canonical_title, canonical_author, created_at) VALUES (?,?,?,?,?,?)",
            (sid, body.query.strip(), norm_query,
             (meta or {}).get("title"), (meta or {}).get("author"), now),
        )
        for store in M.STORES:
            conn.execute(
                "INSERT INTO store_status(search_id, store, status, updated_at) VALUES (?,?,?,?)",
                (sid, store, "pending", now),
            )
    return {"id": sid, "cached": False,
            "canonical": meta and {"title": meta.get("title"), "author": meta.get("author")}}


@app.get("/api/searches/{sid}")
def get_search(sid: str):
    with db() as conn:
        s = conn.execute("SELECT * FROM searches WHERE id=?", (sid,)).fetchone()
        if not s:
            raise HTTPException(404, "busca nao encontrada")
        statuses = conn.execute(
            "SELECT store, status, detail, count, updated_at FROM store_status WHERE search_id=?",
            (sid,),
        ).fetchall()
        offers = conn.execute(
            "SELECT store, title_raw, url, seller, price_cents, condition, formats, tier, score, reason "
            "FROM offers WHERE search_id=? ORDER BY price_cents IS NULL, price_cents ASC",
            (sid,),
        ).fetchall()

    age = int(time.time()) - s["created_at"]
    stale_pending = age > SEARCH_TIMEOUT_S

    def status_out(r):
        st = r["status"]
        if st == "pending" and stale_pending:
            st = "sem_coletor"
        return {"store": r["store"], "status": st, "detail": r["detail"], "count": r["count"]}

    confirmadas = {"novo": [], "usado": [], "sem_condicao": []}
    provaveis, filtradas = [], {}
    for o in offers:
        item = {
            "store": o["store"], "title": o["title_raw"], "url": o["url"],
            "seller": o["seller"], "price_cents": o["price_cents"],
            "condition": o["condition"], "formats": json.loads(o["formats"] or "[]"),
            "score": o["score"], "reason": o["reason"],
        }
        if o["tier"] == "confirmada":
            bucket = ("novo" if o["condition"] == "novo"
                      else "usado" if o["condition"] in ("usado", "seminovo")
                      else "sem_condicao")
            confirmadas[bucket].append(item)
        elif o["tier"] == "provavel":
            provaveis.append(item)
        else:
            filtradas.setdefault(o["reason"] or "outro", []).append(item)

    return {
        "id": s["id"], "query": s["query"], "created_at": s["created_at"], "age_s": age,
        "canonical": {"title": s["canonical_title"], "author": s["canonical_author"]},
        "stores": [status_out(r) for r in statuses],
        "confirmadas": confirmadas,
        "provaveis": provaveis,
        "filtradas": {k: {"count": len(v), "itens": v[:10]} for k, v in filtradas.items()},
        "done": all(r["status"] != "pending" for r in statuses) or stale_pending,
    }


@app.post("/api/searches/{sid}/results")
def post_results(sid: str, body: ResultsIn, x_livros_key: str | None = Header(default=None)):
    require_key(x_livros_key)
    if body.store not in M.STORES:
        raise HTTPException(400, "loja desconhecida")
    if body.status not in STATUS_VALUES:
        raise HTTPException(400, "status invalido")
    now = int(time.time())
    with db() as conn:
        s = conn.execute("SELECT * FROM searches WHERE id=?", (sid,)).fetchone()
        if not s:
            raise HTTPException(404, "busca nao encontrada")
        author_tokens = (s["canonical_author"] or "").split() or None

        accepted = 0
        conn.execute("DELETE FROM offers WHERE search_id=? AND store=?", (sid, body.store))
        for listing in body.listings:
            if not M.url_allowed(body.store, listing.url):
                continue
            res = M.evaluate_listing(
                s["query"], listing.title, listing.extra or "",
                author_tokens=author_tokens, store=body.store,
            )
            cond = res.condition
            if not cond and listing.condition:
                cond = M.classify_condition(listing.condition)
            price = M.parse_price_cents(listing.priceText)
            if price is not None and not (100 <= price <= 5_000_00):
                price = None  # fora da faixa plausivel de livro; nao inventar
            conn.execute(
                "INSERT INTO offers(search_id, store, title_raw, url, seller, price_cents,"
                " condition, formats, tier, score, reason, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (sid, body.store, listing.title.strip(), listing.url, listing.seller,
                 price, cond, json.dumps(sorted(res.formats)), res.tier, res.score,
                 res.reason, now),
            )
            accepted += 1

        detail = None
        if body.diag:
            detail = json.dumps({k: body.diag[k] for k in list(body.diag)[:12]})[:800]
        conn.execute(
            "UPDATE store_status SET status=?, detail=?, count=?, updated_at=? WHERE search_id=? AND store=?",
            (body.status, detail, accepted, now, sid, body.store),
        )

    if body.sampleHtml and body.status in ("empty", "blocked", "error"):
        save_sample(body.store, s["query"], body.sampleHtml)
    return {"ok": True, "accepted": accepted}


def save_sample(store: str, query: str, html: str) -> None:
    safe_q = re.sub(r"[^a-z0-9]+", "-", M.norm(query))[:40]
    path = SAMPLES_DIR / f"{store}-{safe_q}-{int(time.time())}.html"
    path.write_text(html[:200_000], errors="replace")
    files = sorted(SAMPLES_DIR.glob("*.html"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[MAX_SAMPLES:]:
        old.unlink(missing_ok=True)


@app.get("/ext/livros-coletor.zip")
def ext_zip():
    path = STATIC_DIR / "ext" / "livros-coletor.zip"
    if not path.exists():
        raise HTTPException(404, "pacote ainda nao gerado")
    return FileResponse(path, media_type="application/zip", filename="livros-coletor.zip")


@app.get("/")
def index():
    return HTMLResponse(INDEX_HTML)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.exception_handler(404)
async def not_found(request: Request, exc):
    if request.url.path.startswith(("/api/", "/static/", "/ext/")):
        return JSONResponse({"detail": "nao encontrado"}, status_code=404)
    return HTMLResponse(INDEX_HTML, status_code=200)
