#!/usr/bin/env bash
# Страж слоёв iOS (docs/IOS_RULES.md 9.1.2, 9.1.3). Падает, если:
#   а) файл в Sources/Features, Sources/App или Sources/DesignSystem импортирует GRDB —
#      запросы к базе живут в Sources/Core (тип запросов области), экраны получают
#      готовые значения и потоки;
#   б) файл в Sources/Core импортирует UIKit или SwiftUI — ядро без UI-фреймворков:
#      UI-помощники в DesignSystem/Features/App, системные сервисы за протоколом
#      (как BackgroundActivity в SessionStore).
#
# Исключения — scripts/layers-allowlist.txt, путь от apps/ios на строку (`#` — комментарий).
# Список только сужается: путь, который правило больше не нарушает (или файла нет),
# тоже роняет проверку — его надо вычеркнуть, иначе туда тихо вернётся нарушение.
#
# Без Xcode и Swift — работает и на Linux, и на macOS (bash 3.2, BSD grep).
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

scan 'GRDB' Sources/Features Sources/App Sources/DesignSystem | sort -u >"$tmp/grdb"
scan 'UIKit|SwiftUI' Sources/Core | sort -u >"$tmp/ui"
sort -u "$tmp/grdb" "$tmp/ui" >"$tmp/violations"

if [ -f "$ALLOWLIST" ]; then
    sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$ALLOWLIST" | grep -v '^$' | sort -u >"$tmp/allowed" || true
else
    : >"$tmp/allowed"
fi

comm -23 "$tmp/violations" "$tmp/allowed" >"$tmp/new"
comm -13 "$tmp/violations" "$tmp/allowed" >"$tmp/stale"

failed=0
while IFS= read -r file; do
    [ -n "$file" ] || continue
    failed=1
    if grep -qxF "$file" "$tmp/grdb"; then
        echo "::error file=apps/ios/$file::$file: import GRDB вне Sources/Core (IOS_RULES 9.1.2) — запросы к базе перенесите в тип запросов области в Core"
    else
        echo "::error file=apps/ios/$file::$file: import UIKit/SwiftUI в Sources/Core (IOS_RULES 9.1.3) — UI-часть в DesignSystem/Features/App, системный сервис за протоколом"
    fi
done <"$tmp/new"

while IFS= read -r file; do
    [ -n "$file" ] || continue
    failed=1
    echo "::error file=apps/ios/$ALLOWLIST::$file больше не нарушает правила слоёв — уберите его из $ALLOWLIST (список только сужается)"
done <"$tmp/stale"

if [ "$failed" -ne 0 ]; then
    echo "Проверка слоёв не прошла (scripts/check_layers.sh)." >&2
    exit 1
fi
echo "Слои в порядке: $(wc -l <"$tmp/allowed" | tr -d ' ') исключений в $ALLOWLIST."
