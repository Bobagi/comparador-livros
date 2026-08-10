#!/usr/bin/env python3
"""Empacota a extensao em backend/static/ext/livros-coletor.zip,
injetando a LIVROS_KEY do .env no config.js. Rodar da raiz do projeto."""

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
OUT = ROOT / "backend" / "static" / "ext" / "livros-coletor.zip"


def read_key() -> str:
    env = (ROOT / ".env").read_text()
    m = re.search(r"^LIVROS_KEY=(\S+)$", env, re.M)
    if not m:
        sys.exit("LIVROS_KEY nao encontrada no .env")
    return m.group(1)


def main() -> None:
    key = read_key()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in EXT.iterdir() if p.is_file())
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            data = p.read_bytes()
            if p.name == "config.js":
                data = data.replace(b"__LIVROS_KEY__", key.encode())
            z.writestr(f"livros-coletor/{p.name}", data)
    print(f"ok: {OUT} ({OUT.stat().st_size} bytes, {len(files)} arquivos)")


if __name__ == "__main__":
    main()
