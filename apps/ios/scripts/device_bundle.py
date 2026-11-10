#!/usr/bin/env python3
"""Файлы приложения для сборки на iPhone через xtool — то, что в Xcode делает сам Xcode.

xtool не знает ни XcodeGen, ни xcconfig, ни утилит Xcode, которые компилируют каталог
строк (`xcstringstool`). Поэтому скрипт кладёт в `apps/ios/.device/`:

- `Info.plist` — ключи из `info.properties` в project.yml плюс адрес API этого компьютера.
  xtool сливает его со своим минимальным plist;
- `ru.lproj/Localizable.strings`, `kk.lproj/Localizable.strings` — таблицы строк из
  `Resources/Localizable.xcstrings` в бинарном plist, как их собирает Xcode. Казахских
  переводов не хватает части ключей — там подставляется русская строка, чтобы на экране
  не появлялся голый ключ. Английский не собирается: его нет в CFBundleLocalizations.

Каталог .device/ в git не попадает и пересобирается при каждом запуске scripts/device.sh.

Запуск: python3 apps/ios/scripts/device_bundle.py http://192.168.0.10:3001/api/v1 http://192.168.0.10:3000
"""
import json
import pathlib
import plistlib
import re
import shutil
import sys

IOS = pathlib.Path(__file__).resolve().parents[1]
CATALOG = IOS / "Resources/Localizable.xcstrings"
PROJECT = IOS / "project.yml"
OUT = IOS / ".device"
# Иконка для сборки без Mac: исходник — AppIcon.svg, 1024 — в каталоге ассетов.
ICONS = IOS / "Resources" / "DeviceIcon"
LANGUAGES = ["ru", "kk"]


def project_setting(name: str) -> str:
    """Версию берём из project.yml, чтобы сборка с телефона не расходилась с Xcode."""
    match = re.search(rf'^\s*{name}:\s*"?([^"\n]+)"?\s*$', PROJECT.read_text(encoding="utf-8"), re.M)
    if not match:
        sys.exit(f"В project.yml нет {name}")
    return match.group(1)


def info_plist(api_base_url: str, web_base_url: str) -> dict:
    """Копия `info.properties` из project.yml. Расходится намеренно в трёх местах:

    - нет `UIBackgroundModes: remote-notification` и права `aps-environment`: личный
      Apple ID без платной подписки не подписывает приложение с пушами;
    - `UILaunchScreen` без цвета: цвет живёт в каталоге ассетов, а его без Xcode
      не собрать (экран запуска будет системного цвета);
    - разрешён http: сервер разработки в локальной сети работает без TLS. Это только
      отладочная копия с отдельным bundle ID, в TestFlight она не уходит.
    """
    return {
        "CFBundleDevelopmentRegion": "ru",
        "CFBundleDisplayName": "StudentHub",
        "CFBundleLocalizations": LANGUAGES,
        "CFBundleShortVersionString": project_setting("MARKETING_VERSION"),
        "CFBundleVersion": project_setting("CURRENT_PROJECT_VERSION"),
        "ITSAppUsesNonExemptEncryption": False,
        "CFBundleURLTypes": [
            {"CFBundleURLName": "kz.studenthub.app", "CFBundleURLSchemes": ["studenthub"]},
        ],
        "NSCameraUsageDescription": "Чтобы отсканировать QR-код входа на компьютере.",
        "NSMicrophoneUsageDescription": "Чтобы записать голосовое сообщение.",
        # Запрос «Разрешить доступ к локальной сети» iOS показывает при первом обращении
        # к серверу на компьютере. Без «Разрешить» запросы к API не дойдут.
        "NSLocalNetworkUsageDescription": "Чтобы подключиться к серверу разработки на компьютере.",
        "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
        "UILaunchScreen": {},
        # Иконка без каталога ассетов: PNG 60 pt (@2x, @3x) лежат в корне бандла.
        # xtool сам добавляет и `CFBundleIconFile` из `iconPath` (xtool.yml).
        "CFBundleIcons": {
            "CFBundlePrimaryIcon": {
                # Без `CFBundleIconName`: он указывает в каталог ассетов, которого в этой
                # сборке нет, и система искала бы иконку там.
                "CFBundleIconFiles": ["AppIcon60x60"],
            },
        },
        "UIDeviceFamily": [1],
        "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
        "SHAPIBaseURL": api_base_url,
        "SHWebBaseURL": web_base_url,
        "SHSentryDSN": "",
    }


def string_tables() -> dict[str, dict[str, str]]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    source = catalog.get("sourceLanguage", "ru")
    tables: dict[str, dict[str, str]] = {language: {} for language in LANGUAGES}
    for key, entry in catalog["strings"].items():
        localizations = entry.get("localizations", {})
        fallback = unit(localizations, source) or key
        for language in LANGUAGES:
            tables[language][key] = unit(localizations, language) or fallback
    return tables


def unit(localizations: dict, language: str) -> str | None:
    """Каталог сейчас хранит только простые строки. Множественные формы (`variations`)
    в .strings не переносятся — встретится такая строка, скрипт остановится, а не
    покажет на экране неверную форму."""
    localization = localizations.get(language, {})
    if "variations" in localization or "substitutions" in localization:
        sys.exit(f"Строка с множественными формами ({language}) — scripts/device_bundle.py их не умеет")
    return localization.get("stringUnit", {}).get("value")


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    api_base_url, web_base_url = sys.argv[1], sys.argv[2]

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir()
    with open(OUT / "Info.plist", "wb") as file:
        plistlib.dump(info_plist(api_base_url, web_base_url), file, fmt=plistlib.FMT_XML)
    for icon in sorted(ICONS.glob("AppIcon60x60@*.png")):
        shutil.copy(icon, OUT / icon.name)
    for language, table in string_tables().items():
        directory = OUT / f"{language}.lproj"
        directory.mkdir()
        with open(directory / "Localizable.strings", "wb") as file:
            plistlib.dump(table, file, fmt=plistlib.FMT_BINARY)
        print(f"{language}.lproj: {len(table)} строк")
    print(f"Info.plist: SHAPIBaseURL = {api_base_url}, SHWebBaseURL = {web_base_url}")


if __name__ == "__main__":
    main()
