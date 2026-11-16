#!/usr/bin/env bash
# Страж предупреждений Swift (docs/IOS_RULES.md 4.2.x). Глобальный
# SWIFT_TREAT_WARNINGS_AS_ERRORS не включаем — уже накопленные предупреждения сделали бы
# сборку красной; вместо этого число предупреждений не растёт. Падает, если в логе сборки
# уникальных предупреждений компилятора в Sources и Tests:
#   - больше базы из scripts/warnings-baseline.txt — новое предупреждение надо убрать;
#   - меньше базы — базу надо уменьшить до нового числа (только сужается), иначе в
#     освободившееся место тихо вернётся новое предупреждение.
# Предупреждения пакетов (SourcePackages) и инструментов не считаются.
#
# Лог — от чистой сборки (CI, ios.yml): инкрементальная сборка на Mac перекомпилирует не
# всё, и предупреждений в её логе меньше настоящего.
#
#   scripts/check_warnings.sh build/test-output/build.log
set -euo pipefail

cd "$(dirname "$0")/.."
export LC_ALL=C

LOG=${1:?путь к логу xcodebuild}
BASELINE=scripts/warnings-baseline.txt

base=$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$BASELINE" | grep -E '^[0-9]+$' | head -1)
[ -n "$base" ] || { echo "::error file=apps/ios/$BASELINE::нет числа в $BASELINE" >&2; exit 2; }

# Пустой или оборванный лог дал бы «0 предупреждений» и ложную просьбу уменьшить базу.
grep -q 'BUILD SUCCEEDED' "$LOG" || { echo "::error::$LOG — не лог успешной сборки, считать нечего" >&2; exit 2; }

# Одно и то же предупреждение xcodebuild печатает по разу на архитектуру или шаг — уникальные.
warnings=$(grep -E '^/.*/apps/ios/(Sources|Tests)/.*\.swift:[0-9]+:[0-9]+: warning: ' "$LOG" | sort -u || true)
count=$(printf '%s' "$warnings" | grep -c . || true)

if [ "$count" -gt "$base" ]; then
    echo "::error::Предупреждений Swift $count, база $base (IOS_RULES 4.2.x) — уберите новые, базу не поднимайте"
    printf '%s\n' "$warnings" | sed 's#^.*/apps/ios/##'
    exit 1
fi
if [ "$count" -lt "$base" ]; then
    echo "::error file=apps/ios/$BASELINE::Предупреждений Swift $count, база $base — уменьшите базу в $BASELINE до $count (только сужается)"
    exit 1
fi
echo "Предупреждений Swift: $count, база $base."
