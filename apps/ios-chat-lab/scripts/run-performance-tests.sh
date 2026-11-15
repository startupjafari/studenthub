#!/usr/bin/env bash
# Замеры производительности Chat Lab (macOS + Xcode 26+), Release.
#
#   ./scripts/run-performance-tests.sh            на подключённом iPhone, иначе на симуляторе
#   ./scripts/run-performance-tests.sh --simulator
#
# Что меряется (Tests/ChatLabPerfTests):
#   - запуск до первого кадра (XCTApplicationLaunchMetric);
#   - прокрутка 300+ сообщений: XCTOSSignpostMetric.scrollDecelerationMetric / scrollDraggingMetric
#     (hitch time ratio, число подвисаний, кадры) + собственный монитор кадров приложения
#     (CADisplayLink, perf.summary) — его числа сверяются с Tests/perf-baseline.json;
#   - открытие клавиатуры, контекстного меню, просмотрщика, отправка (XCTClockMetric + сигнпосты);
#   - CPU и память при прокрутке (XCTCPUMetric, XCTMemoryMetric).
# Результат: build/test-output/perf.xcresult, perf-summary.md.
#
# Симулятор не показывает частоту iPhone (ProMotion 120 Гц): числа с симулятора — только
# для поиска регрессий между прогонами, а не обещание плавности. Итог — на устройстве.

source "$(dirname "$0")/lib.sh"

force_sim=false
[[ "${1:-}" == "--simulator" ]] && force_sim=true

is_macos || die "Замеры XCTest/Instruments — только на macOS с Xcode 26+. На Linux доступна сборка: scripts/build.sh"
require_macos_tools
cd "$LAB_DIR"
generate_project
mkdir -p "$OUTPUT_DIR"

destination=""
if [[ "$force_sim" == false ]]; then
  device="$(list_connected_iphones | head -1 | cut -f1)"
  if [[ -n "$device" ]]; then
    [[ -f "$SIGNING_FILE" ]] || die "Для iPhone нужна подпись: ./scripts/setup.sh"
    destination="id=$device"
    info "Устройство: $device"
  fi
fi
if [[ -z "$destination" ]]; then
  udid="$(pick_simulator)" || die "Нет симулятора iPhone"
  destination="id=$udid"
  warn "Замеры на симуляторе: годятся для сравнения прогонов, но не для оценки плавности на iPhone."
fi

result="$OUTPUT_DIR/perf.xcresult"
rm -rf "$result"
set +e
xcodebuild test -project "$PROJECT" -scheme ChatLabPerf -configuration Release -destination "$destination" \
  -derivedDataPath build/DerivedData -resultBundlePath "$result" -allowProvisioningUpdates \
  2>&1 | tee "$OUTPUT_DIR/perf.log" | grep -E "Test Case .*(passed|failed)|measured|error:|\*\* TEST|PERF "
status=${PIPESTATUS[0]}
set -e

python3 "$LAB_DIR/scripts/xcresult_summary.py" "$result" perf > "$OUTPUT_DIR/perf-summary.md" || true
# Строки «PERF name=… fps=… hitches=…» печатают сами тесты — сверка с базой.
python3 "$LAB_DIR/scripts/perf_check.py" "$OUTPUT_DIR/perf.log" "$LAB_DIR/Tests/perf-baseline.json" >> "$OUTPUT_DIR/perf-summary.md"
check=$?
cat "$OUTPUT_DIR/perf-summary.md"
[[ $status -eq 0 && $check -eq 0 ]] && ok "Замеры в пределах базы" || die "Замеры: есть провалы или регрессии (см. $OUTPUT_DIR/perf-summary.md)"
