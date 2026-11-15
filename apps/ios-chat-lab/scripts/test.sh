#!/usr/bin/env bash
# Автотесты Chat Lab (macOS + Xcode 26+).
#
#   ./scripts/test.sh            unit + UI на симуляторе
#   ./scripts/test.sh unit       только unit (логика, раскладка, хранилище, мок)
#   ./scripts/test.sh ui         только UI-сценарии (XCUITest)
#   ./scripts/test.sh all        unit + UI + замеры (scripts/run-performance-tests.sh)
#   SIMULATOR="iPhone 17" ./scripts/test.sh
#
# Результат: build/test-output/<набор>.xcresult и summary.md (число выполненных/упавших).
# Ноль выполненных тестов считается провалом.
# Linux/WSL: только проверка компиляции приложения — тесты здесь не запускаются.

source "$(dirname "$0")/lib.sh"

suite="${1:-default}"
cd "$LAB_DIR"

if ! is_macos; then
  warn "XCTest/XCUITest запускаются только на macOS с симулятором или iPhone."
  warn "Здесь выполняю то, что возможно: проверку компиляции приложения."
  exec "$LAB_DIR/scripts/build.sh"
fi

require_macos_tools
generate_project
mkdir -p "$OUTPUT_DIR"
udid="$(pick_simulator)" || die "Нет доступного симулятора iPhone. Xcode → Settings → Components → iOS 26"
info "Симулятор: $udid"
xcrun simctl boot "$udid" >/dev/null 2>&1 || true

run_suite() {
  local name="$1"; shift
  local result="$OUTPUT_DIR/$name.xcresult"
  rm -rf "$result"
  info "Тесты: $name"
  set +e
  xcodebuild test -project "$PROJECT" -scheme ChatLab -destination "id=$udid" \
    -derivedDataPath build/DerivedData -resultBundlePath "$result" \
    -parallel-testing-enabled NO "$@" 2>&1 | tee "$OUTPUT_DIR/$name.log" | grep -E "Test Case .*(passed|failed)|error:|\*\* TEST"
  local status=${PIPESTATUS[0]}
  set -e
  python3 "$LAB_DIR/scripts/xcresult_summary.py" "$result" "$name" | tee -a "$OUTPUT_DIR/summary.md"
  return $status
}

: > "$OUTPUT_DIR/summary.md"
failed=0
case "$suite" in
  unit) run_suite unit -only-testing:ChatLabTests || failed=1 ;;
  ui) run_suite ui -only-testing:ChatLabUITests || failed=1 ;;
  default)
    run_suite unit -only-testing:ChatLabTests || failed=1
    run_suite ui -only-testing:ChatLabUITests || failed=1
    ;;
  all)
    run_suite unit -only-testing:ChatLabTests || failed=1
    run_suite ui -only-testing:ChatLabUITests || failed=1
    "$LAB_DIR/scripts/run-performance-tests.sh" || failed=1
    ;;
  *) die "Неизвестный набор: $suite (unit | ui | all)" ;;
esac

echo
cat "$OUTPUT_DIR/summary.md"
[[ $failed -eq 0 ]] && ok "Все наборы прошли" || die "Есть упавшие тесты — см. $OUTPUT_DIR"
