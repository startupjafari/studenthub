#!/usr/bin/env bash
# Страж слоёв iOS (docs/IOS_RULES.md 9.1.2, 9.1.3, 14.4.1). Падает, если:
#   а) файл в Sources/Features, Sources/App или Sources/DesignSystem импортирует GRDB —
#      запросы к базе живут в Sources/Core (тип запросов области), экраны получают
#      готовые значения и потоки;
#   б) файл в Sources/Core импортирует UIKit или SwiftUI — ядро без UI-фреймворков:
#      UI-помощники в DesignSystem/Features/App, системные сервисы за протоколом
#      (как BackgroundActivity в SessionStore);
#   в) файл в Sources обращается к URLSession вне сетевого клиента
#      (Core/Network/APIClient.swift) — запросы к API идут через APIClient: токен, повтор,
#      обработка 401; голый URLSession — только загрузки по presigned-адресам из списка;
#   г) файл в Sources открывает адрес сам — `UIApplication.shared.open(` или `openURL(` —
#      вне App/ExternalLinkOpener.swift: ссылка из чата открывается после проверки и
#      подтверждения (IOS_RULES 14.4.1). Без исключения — открытие системных настроек
#      (`UIApplication.openSettingsURLString` в той же или двух строках выше).
# Строки-комментарии (`//`, `///`) не считаются.
#
# Исключения — scripts/layers-allowlist.txt, строка `<правило> <путь от apps/ios>`
# (правила: grdb, ui, urlsession, openurl; `#` — комментарий). Список только сужается:
# исключение, которое больше не нужно (файл не нарушает это правило или его нет), тоже
# роняет проверку — его надо вычеркнуть, иначе туда тихо вернётся нарушение.
#
# Без Xcode и Swift — работает и на Linux, и на macOS (bash 3.2, BSD grep и awk).
#
#   scripts/check_layers.sh
set -euo pipefail

cd "$(dirname "$0")/.."
export LC_ALL=C

ALLOWLIST=scripts/layers-allowlist.txt
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Строка импорта модуля: `import X`, `@preconcurrency import X`, `import struct X.Y`.
import_pattern() {
    printf '^[[:space:]]*(@[A-Za-z_]+[[:space:]]+)*import[[:space:]]+((typealias|struct|class|enum|protocol|let|var|func)[[:space:]]+)?(%s)([.[:space:]]|$)' "$1"
}

# Файлы `.swift` в каталогах `$2…`, импортирующие модули `$1` (альтернативы через `|`).
scan() {
    local modules=$1
    shift
    grep -rlE --include='*.swift' "$(import_pattern "$modules")" "$@" || true
}

# Файлы `.swift` в Sources, где awk-программа `$1` нашла нарушение (печатает FILENAME).
# Строки-комментарии отбрасываются до неё; `settings` — номер последней строки с
# `openSettingsURLString`, сбрасывается на первой строке каждого файла.
scan_lines() {
    find Sources -name '*.swift' -print | sort | tr '\n' '\0' |
        xargs -0 awk "FNR == 1 { settings = -10 } /^[ \t]*\/\// { next } $1" | sort -u
}

scan 'GRDB' Sources/Features Sources/App Sources/DesignSystem | sort -u | sed 's/^/grdb /' >"$tmp/violations"
scan 'UIKit|SwiftUI' Sources/Core | sort -u | sed 's/^/ui /' >>"$tmp/violations"
scan_lines '/(^|[^A-Za-z0-9_])URLSession/ { print FILENAME }' |
    grep -vxF 'Sources/Core/Network/APIClient.swift' | sed 's/^/urlsession /' >>"$tmp/violations" || true
# Настройки: `openSettingsURLString` в строке вызова или до двух строк выше.
scan_lines '/openSettingsURLString/ { settings = FNR }
    /UIApplication\.shared\.open\(|openURL\(/ { if (FNR - settings > 2) print FILENAME }' |
    grep -vxF 'Sources/App/ExternalLinkOpener.swift' | sed 's/^/openurl /' >>"$tmp/violations" || true
sort -u -o "$tmp/violations" "$tmp/violations"

if [ -f "$ALLOWLIST" ]; then
    sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[[:space:]][[:space:]]*/ /g' "$ALLOWLIST" |
        grep -v '^$' | sort -u >"$tmp/allowed" || true
else
    : >"$tmp/allowed"
fi

comm -23 "$tmp/violations" "$tmp/allowed" >"$tmp/new"
comm -13 "$tmp/violations" "$tmp/allowed" >"$tmp/stale"

failed=0
while read -r rule file; do
    [ -n "$file" ] || continue
    failed=1
    case "$rule" in
        grdb) echo "::error file=apps/ios/$file::$file: import GRDB вне Sources/Core (IOS_RULES 9.1.2) — запросы к базе перенесите в тип запросов области в Core" ;;
        ui) echo "::error file=apps/ios/$file::$file: import UIKit/SwiftUI в Sources/Core (IOS_RULES 9.1.3) — UI-часть в DesignSystem/Features/App, системный сервис за протоколом" ;;
        urlsession) echo "::error file=apps/ios/$file::$file: URLSession вне APIClient (IOS_RULES 14.4.1) — запрос к API через APIClient, загрузку файла — через существующие загрузчики (AttachmentUploader, ImageDownloads)" ;;
        openurl) echo "::error file=apps/ios/$file::$file: открытие адреса мимо ExternalLinkOpener (IOS_RULES 14.4.1) — ExternalLinkOpener.open(url)" ;;
    esac
done <"$tmp/new"

while read -r rule file; do
    [ -n "$rule" ] || continue
    failed=1
    if [ -z "$file" ]; then
        echo "::error file=apps/ios/$ALLOWLIST::строка «$rule» без правила — формат «<правило> <путь>»"
    else
        echo "::error file=apps/ios/$ALLOWLIST::$file больше не нарушает правило $rule — уберите «$rule $file» из $ALLOWLIST (список только сужается)"
    fi
done <"$tmp/stale"

if [ "$failed" -ne 0 ]; then
    echo "Проверка слоёв не прошла (scripts/check_layers.sh)." >&2
    exit 1
fi
echo "Слои в порядке: $(wc -l <"$tmp/allowed" | tr -d ' ') исключений в $ALLOWLIST."
