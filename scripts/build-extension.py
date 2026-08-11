#!/usr/bin/env python3
"""Empacota a extensao em backend/static/ext/livros-coletor.zip.

O zip resultante e IDENTICO ao enviado a Chrome Web Store: nao carrega
segredo nenhum (a extensao se registra no backend no primeiro uso, via
POST /api/installs). Rodar da raiz do projeto."""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
OUT = ROOT / "backend" / "static" / "ext" / "livros-coletor.zip"


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in EXT.rglob("*") if p.is_file())
    # Arquivos na RAIZ do zip (sem pasta interna): o "Extrair tudo" do Windows
    # ja cria uma pasta com o nome do zip; se o zip tambem tivesse uma pasta
    # dentro, viraria livros-coletor/livros-coletor/manifest.json e o Chrome
    # nao acha o manifesto ("manifest missing").
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.writestr(str(p.relative_to(EXT)), p.read_bytes())
    print(f"ok: {OUT} ({OUT.stat().st_size} bytes, {len(files)} arquivos)")


if __name__ == "__main__":
    main()
