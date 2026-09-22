"""Local replacement for the old PHP save/load/dirlist endpoints.

The original code kept .syx dumps under the Apache DOCUMENT_ROOT's syx/
folder; here that becomes backend/data/syx next to this package.
"""
from __future__ import annotations

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "syx"
DATA_DIR.mkdir(parents=True, exist_ok=True)


class InvalidFilename(ValueError):
    pass


def _safe_path(filename: str) -> Path:
    # Reject path separators / traversal - filename must stay inside DATA_DIR.
    candidate = (DATA_DIR / filename).resolve()
    if candidate.parent != DATA_DIR:
        raise InvalidFilename(f"invalid filename: {filename}")
    return candidate


def save(filename: str, data: list[int]) -> None:
    path = _safe_path(filename)
    path.write_bytes(bytes(data))


def load(filename: str) -> list[int]:
    path = _safe_path(filename)
    if not path.is_file():
        raise FileNotFoundError(filename)
    return list(path.read_bytes())


def list_files() -> list[dict]:
    entries = []
    for entry in sorted(DATA_DIR.iterdir()):
        if entry.is_file():
            stat = entry.stat()
            entries.append(
                {
                    "name": entry.name,
                    "size": stat.st_size,
                    "lastmod": stat.st_mtime,
                }
            )
    return entries
