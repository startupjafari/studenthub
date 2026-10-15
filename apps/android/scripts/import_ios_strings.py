#!/usr/bin/env python3
"""Перенос строк из каталога iOS в ресурсы Android.

Ключи у платформ общие (план Android, «Что берём из iOS»): одна и та же фраза не
должна звучать на телефонах по-разному. Источник правды — `apps/ios/Resources/
Localizable.xcstrings`; этот скрипт пересобирает из него `values/strings_ios.xml` и
`values-kk/strings_ios.xml`. Руками эти файлы не правятся — правится каталог, затем
скрипт запускается заново. Строки, которых в iOS нет, живут в `strings.xml`.

Имя ресурса — ключ каталога с точками, заменёнными на подчёркивание:
`auth.loginTitle` → `R.string.auth_loginTitle`.

Запуск из корня репозитория: python3 apps/android/scripts/import_ios_strings.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
CATALOG = ROOT / "apps/ios/Resources/Localizable.xcstrings"
RES = ROOT / "apps/android/app/src/main/res"

HEADER = """<?xml version="1.0" encoding="utf-8"?>
<!-- Сгенерировано apps/android/scripts/import_ios_strings.py из каталога iOS. Не править руками. -->
<resources>
"""


def escape(value: str) -> str:
    """Экранирование по правилам строковых ресурсов Android, а не только XML:
    апостроф и кавычка без обратной косой ломают сборку, а `@` и `?` в начале
    строки aapt принимает за ссылку на ресурс."""
    value = placeholders(value)
    value = value.replace("\\", "\\\\").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    value = value.replace("'", "\\'").replace('"', '\\"').replace("\n", "\\n")
    if value[:1] in ("@", "?"):
        value = "\\" + value
    return value


def placeholders(value: str) -> str:
    """Интерполяция Swift `\\(days)` → позиционный параметр Android `%1$s`.

    В каталоге iOS часть строк хранит подстановку в записи Swift, с вложенными скобками
    (`\\(date.formatted(...))`), поэтому разбор идёт со счётчиком скобок, а не
    регулярным выражением. Параметры нумеруются по порядку появления."""
    out, index, i = [], 0, 0
    while i < len(value):
        if value.startswith("\\(", i):
            depth, j = 1, i + 2
            while j < len(value) and depth:
                depth += {"(": 1, ")": -1}.get(value[j], 0)
                j += 1
            index += 1
            out.append(f"%{index}$s")
            i = j
        else:
            out.append(value[i])
            i += 1
    return "".join(out)


def unit(entry: dict, language: str) -> str | None:
    return entry.get("localizations", {}).get(language, {}).get("stringUnit", {}).get("value")


def write(path: pathlib.Path, rows: list[tuple[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [HEADER]
    for key, value in rows:
        lines.append(f'    <string name="{key.replace(".", "_")}">{escape(value)}</string>\n')
    lines.append("</resources>\n")
    path.write_text("".join(lines), encoding="utf-8")


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["strings"]
    russian, kazakh = [], []
    for key in sorted(catalog):
        entry = catalog[key]
        ru = unit(entry, "ru")
        if ru is None:
            continue
        russian.append((key, ru))
        kk = unit(entry, "kk")
        if kk:
            kazakh.append((key, kk))
    write(RES / "values/strings_ios.xml", russian)
    write(RES / "values-kk/strings_ios.xml", kazakh)
    print(f"ru: {len(russian)}, kk: {len(kazakh)}")


if __name__ == "__main__":
    main()
