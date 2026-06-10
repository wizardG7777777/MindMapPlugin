from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def read_json(path: str) -> Any:
    if path == "-":
        return json.load(sys.stdin)
    with Path(path).expanduser().open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: str, value: Any) -> None:
    with Path(path).expanduser().open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def print_json(value: Any) -> None:
    json.dump(value, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
