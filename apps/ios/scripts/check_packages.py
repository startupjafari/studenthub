#!/usr/bin/env python3
"""Сверка версий пакетов Swift (docs/IOS_RULES.md 14.1.2).

Версии пакетов записаны в трёх местах, и каждое читает своя сборка:
  Package.swift     — сборка xtool (Linux/WSL), `exact:`;
  project.yml       — сборка Xcode (CI, Mac), `exactVersion:`;
  Package.resolved  — транзитивные пакеты (Starscream у Socket.IO) и ревизии, в git.
Dependabot поднимает версию в Package.swift и Package.resolved, project.yml он не видит —
без сверки Xcode тихо остался бы на старой версии. Падает, если:
  - зависимость в Package.swift или project.yml не точная;
  - версия в Package.swift не совпадает с Package.resolved;
  - один и тот же пакет в Package.swift и project.yml разных версий.

С аргументом — путь к Package.resolved, который написал Xcode после сборки, — ещё и
проверяет, что Xcode взял ровно версии из закоммиченного файла и из project.yml
(scripts/test.sh после сборки).

    scripts/check_packages.py [путь/к/Package.resolved Xcode]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []


def fail(file: str, message: str) -> None:
    errors.append(f"::error file=apps/ios/{file}::{message}")


def key(url: str) -> str:
    """Адрес пакета без регистра, `.git` и косой черты в конце — как его сравнивает SwiftPM."""
    url = url.strip().lower().rstrip("/")
    return url[:-4] if url.endswith(".git") else url


def manifest() -> dict[str, str]:
    text = (ROOT / "Package.swift").read_text()
    found: dict[str, str] = {}
    for match in re.finditer(r'\.package\(\s*url:\s*"([^"]+)"\s*,\s*([^)]*)\)', text):
        url, requirement = match.groups()
        exact = re.fullmatch(r'exact:\s*"([^"]+)"\s*', requirement)
        if not exact:
            fail("Package.swift", f"{url}: версия не точная ({requirement.strip()}) — нужен exact:")
            continue
        found[key(url)] = exact.group(1)
    return found


def project() -> dict[str, tuple[str, str | None]]:
    """Блок `packages:` из project.yml: адрес → (имя, exactVersion)."""
    lines = (ROOT / "project.yml").read_text().splitlines()
    found: dict[str, tuple[str, str | None]] = {}
    inside = False
    name = url = version = None

    def flush() -> None:
        if name is None:
            return
        if url is None:
            fail("project.yml", f"пакет {name} без url")
        elif version is None:
            fail("project.yml", f"пакет {name}: версия не точная — нужен exactVersion:")
            found[key(url)] = (name, None)
        else:
            found[key(url)] = (name, version)

    for line in lines:
        if not inside:
            inside = line.rstrip() == "packages:"
            continue
        if line and not line[0].isspace() and not line.startswith("#"):
            break
        if re.match(r"^  [A-Za-z0-9_.-]+:\s*$", line):
            flush()
            name, url, version = line.strip().rstrip(":"), None, None
        elif m := re.match(r"^    url:\s*(\S+)", line):
            url = m.group(1)
        elif m := re.match(r'^    exactVersion:\s*"?([^"\s]+)"?', line):
            version = m.group(1)
    flush()
    return found


def resolved(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text())
    return {key(pin["location"]): pin["state"].get("version") or pin["state"].get("revision", "?") for pin in data["pins"]}


def main() -> int:
    swift = manifest()
    yml = project()
    committed_path = ROOT / "Package.resolved"
    if not committed_path.exists():
        fail("Package.resolved", "нет Package.resolved — соберите пакет (xtool dev build) и закоммитьте его")
        committed: dict[str, str] = {}
    else:
        committed = resolved(committed_path)

    for url, version in swift.items():
        pinned = committed.get(url)
        if committed and pinned != version:
            fail("Package.resolved", f"{url}: в Package.swift {version}, в Package.resolved {pinned} — пересоберите пакет")

    for url, (name, version) in yml.items():
        if url in swift and version is not None and swift[url] != version:
            fail("project.yml", f"{name}: в project.yml {version}, в Package.swift {swift[url]} — версии должны совпадать")

    if len(sys.argv) > 1:
        xcode_path = Path(sys.argv[1])
        if not xcode_path.exists():
            fail("project.yml", f"Xcode не записал {xcode_path} — нечего сверять")
        else:
            xcode = resolved(xcode_path)
            # Прямые пакеты xtool и транзитивные — те же версии и у Xcode.
            for url, version in committed.items():
                if xcode.get(url) != version:
                    fail("Package.resolved", f"{url}: Xcode взял {xcode.get(url)}, закоммичено {version}")
            for url, (name, version) in yml.items():
                if version is not None and xcode.get(url) != version:
                    fail("project.yml", f"{name}: Xcode взял {xcode.get(url)}, в project.yml {version}")
            for url, version in xcode.items():
                if url not in committed and url not in yml:
                    fail("Package.resolved", f"{url} {version}: новый транзитивный пакет у Xcode — закрепите версию: exactVersion в project.yml")

    for line in errors:
        print(line)
    if errors:
        print("Версии пакетов Swift расходятся (scripts/check_packages.py).", file=sys.stderr)
        return 1
    print(f"Пакеты в порядке: {len(swift)} в Package.swift, {len(yml)} в project.yml, {len(committed)} в Package.resolved.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
