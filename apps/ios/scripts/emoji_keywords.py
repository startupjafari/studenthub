#!/usr/bin/env python3
"""Словарь поиска emoji по-русски и по-казахски из CLDR.

Источник — аннотации Unicode CLDR (cldr-json, лицензия Unicode License v3, она разрешает
копирование и распространение с сохранением уведомления — оно в шапке генерируемого
файла). Ключевые слова и короткие названия (`tts`) складываются в одну строку на emoji:

    emoji<TAB>слова через пробел

Запуск: python3 scripts/emoji_keywords.py   (скачивает JSON, пишет Swift-файл)
"""
import json
import pathlib
import urllib.request

BASE = "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json"
SOURCES = [
    f"{BASE}/cldr-annotations-full/annotations/{{lang}}/annotations.json",
    f"{BASE}/cldr-annotations-derived-full/annotationsDerived/{{lang}}/annotations.json",
]
LANGS = ["ru", "kk"]
OUT = pathlib.Path(__file__).resolve().parent.parent / "Sources/Features/Chats/Thread/Emoji/EmojiKeywords.generated.swift"


def load(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        data = json.load(response)
    root = data.get("annotations") or data.get("annotationsDerived")
    return root["annotations"]


def main():
    words = {}
    for lang in LANGS:
        for index, template in enumerate(SOURCES):
            for emoji, entry in load(template.format(lang=lang)).items():
                key = emoji.replace("️", "")
                # Производные — только флаги: оттенки кожи и прочее дали бы тысячи строк.
                if index == 1 and not all(0x1F1E6 <= ord(c) <= 0x1F1FF for c in key):
                    continue
                bag = words.setdefault(key, [])
                for word in entry.get("default", []) + entry.get("tts", []):
                    for part in word.lower().replace(":", " ").replace(",", " ").split():
                        if len(part) > 1 and part not in bag:
                            bag.append(part)
    lines = [f"{emoji}\t{' '.join(bag)}" for emoji, bag in sorted(words.items()) if bag]
    body = "\n".join(lines)
    OUT.write_text(
        "// Сгенерировано scripts/emoji_keywords.py — не править руками.\n"
        "//\n"
        "// Данные: Unicode CLDR (https://github.com/unicode-org/cldr-json), аннотации emoji\n"
        "// для ru и kk. Copyright © 1991-2025 Unicode, Inc. Распространяется по Unicode\n"
        "// License v3 (https://www.unicode.org/license.txt).\n\n"
        "enum EmojiKeywordsData {\n"
        f"    static let raw = #\"\"\"\n{body}\n\"\"\"#\n"
        "}\n",
        encoding="utf-8",
    )
    print(f"{OUT.name}: {len(lines)} emoji, {OUT.stat().st_size // 1024} КБ")


main()
