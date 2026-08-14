#!/usr/bin/env python3
"""Chrome Web Store API: sobe um novo pacote (.zip) e publica o item Farolivro.

Roda no HOST (nao no container), zero pip (stdlib urllib). Faz o que a Play
Developer API faz para o Tic Tac Verse, so que para extensao: upload + publish.
NAO edita a ficha (descricao longa, screenshots, categoria) - isso a API nao
cobre; fica no painel. A publicacao ainda passa pela REVISAO do Google.

Credenciais (chmod 600, FORA do repo) em /root/.config/bobagi-google/:
  - cws-client.json  (ou reusa admob-client.json): OAuth client "installed"
      {"installed":{"client_id":"...","client_secret":"..."}}
  - cws-token.json:  {"refresh_token":"..."}  (escopo chromewebstore; ver API-SETUP.md)

Uso:
  cws.py doctor                 # confere credenciais + token + estado do item
  cws.py status                 # estado do rascunho (uploadState, erros)
  cws.py upload <arquivo.zip>   # sobe um novo pacote no item
  cws.py publish [default|trustedTesters]
  cws.py upload-publish <zip> [target]

API v1.1 (funciona ate 2026-10-15; migrar para v2 depois). Item fixo abaixo.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ITEM_ID = "jnkjabpgnocifbnnceoepijbcggmkkek"  # Farolivro
CFG = Path("/root/.config/bobagi-google")
API = "https://www.googleapis.com/chromewebstore/v1.1"
UPLOAD = "https://www.googleapis.com/upload/chromewebstore/v1.1"
TOKEN_URL = "https://oauth2.googleapis.com/token"


def _client():
    for name in ("cws-client.json", "admob-client.json"):
        p = CFG / name
        if p.exists():
            d = json.loads(p.read_text())
            c = d.get("installed") or d.get("web") or d
            if c.get("client_id") and c.get("client_secret"):
                return c["client_id"], c["client_secret"], name
    sys.exit("faltando OAuth client em /root/.config/bobagi-google/ (cws-client.json ou admob-client.json)")


def _refresh_token():
    p = CFG / "cws-token.json"
    if not p.exists():
        sys.exit("faltando cws-token.json (refresh_token com escopo chromewebstore; ver docs/cws/API-SETUP.md)")
    return json.loads(p.read_text())["refresh_token"]


def access_token():
    cid, secret, _ = _client()
    body = urllib.parse.urlencode({
        "client_id": cid, "client_secret": secret,
        "refresh_token": _refresh_token(), "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"falha ao trocar refresh_token (HTTP {e.code}): {e.read().decode()[:300]}")


def _headers(tok, extra=None):
    h = {"Authorization": f"Bearer {tok}", "x-goog-api-version": "2"}
    if extra:
        h.update(extra)
    return h


def _call(method, url, tok, data=None, extra_headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=_headers(tok, extra_headers))
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip().startswith("{") else raw)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


def status():
    tok = access_token()
    code, body = _call("GET", f"{API}/items/{ITEM_ID}?projection=DRAFT", tok)
    print(code, json.dumps(body, ensure_ascii=False, indent=2) if isinstance(body, dict) else body)


def upload(zip_path):
    data = Path(zip_path).read_bytes()
    tok = access_token()
    code, body = _call("PUT", f"{UPLOAD}/items/{ITEM_ID}", tok, data=data,
                       extra_headers={"Content-Type": "application/zip"})
    print("upload:", code, json.dumps(body, ensure_ascii=False) if isinstance(body, dict) else body)
    ok = isinstance(body, dict) and body.get("uploadState") in ("SUCCESS", "IN_PROGRESS")
    if not ok:
        sys.exit(1)


def publish(target="default"):
    tok = access_token()
    code, body = _call("POST", f"{API}/items/{ITEM_ID}/publish?publishTarget={target}", tok, data=b"")
    print("publish:", code, json.dumps(body, ensure_ascii=False) if isinstance(body, dict) else body)
    ok = isinstance(body, dict) and "OK" in (body.get("status") or [])
    if not ok:
        sys.exit(1)


def doctor():
    cid, _, src = _client()
    print(f"OAuth client: {src} (…{cid[-24:]})")
    print("refresh_token:", "presente" if (CFG / "cws-token.json").exists() else "FALTANDO")
    if (CFG / "cws-token.json").exists():
        print("access_token:", "OK" if access_token() else "falhou")
        status()


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd == "doctor":
        doctor()
    elif cmd == "status":
        status()
    elif cmd == "upload":
        upload(sys.argv[2])
    elif cmd == "publish":
        publish(sys.argv[2] if len(sys.argv) > 2 else "default")
    elif cmd == "upload-publish":
        upload(sys.argv[2])
        publish(sys.argv[3] if len(sys.argv) > 3 else "default")
    else:
        sys.exit(f"comando desconhecido: {cmd}\n{__doc__}")


if __name__ == "__main__":
    main()
