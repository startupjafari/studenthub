#!/usr/bin/env bash
# Все проверки iOS одной командой — на Mac с Xcode или на macOS-раннере CI.
#
#   scripts/test.sh build           # только сборка приложения и тестов (то же, что гоняет PR)
#   scripts/test.sh                 # pr: unit + snapshot + ui
#   scripts/test.sh unit snapshot   # выбранные наборы
#   scripts/test.sh full            # pr + perf + ui-extended (ночной прогон)
#   scripts/test.sh snapshot --record   # переснять эталоны снимков
#
# Наборы:
#   build        только сборка: компилируется приложение и все таргеты тестов, симулятор
#                не загружается, тесты не запускаются
#   unit         StudentHubTests — логика, модели, движение (MotionTests и др.)
#   snapshot     StudentHubSnapshotTests — снимки компонентов: темы, размеры, шрифт
#   ui           StudentHubUITests, критичные сценарии на mock API
#   ui-extended  StudentHubUITests целиком, включая живой сервер (нужна учётка)
#   perf         StudentHubPerfTests — запуск, прокрутка, переходы; сверка с baseline
#   scroll       только замер плавности ленты переписки (ScrollSmoothnessTests): строки
#                SCROLL_REPORT в сводке, сравнение положений раскладки в одном прогоне
#   bench        тот же замер без XCUITest: приложение ставится и запускается `simctl`,
#                чат открывается сам, лента листает себя сама (ScrollBenchmark); строки
#                SCROLL_BENCH в сводке. Раннер UI-тестов включает доступность и опрашивает
#                дерево элементов — замер через него мерит в основном сам тест
#
# Переменные: SH_TEST_DEVICE (iPhone 17 Pro), SH_TEST_OS (последняя доступная iOS),
# SH_TEST_OUTPUT (build/test-output), SH_PERF_FLAGS (положение флагов второй волны для
# всего прогона: `all=0`, `all=1`, `chatHeightCache=1,…`). Результаты:
#   <output>/<набор>.xcresult      — открыть в Xcode или `xcrun xcresulttool`
#   <output>/artifacts/<набор>/    — вложения тестов (скриншоты, снимки), видео
#   <output>/snapshot-diffs/       — reference/actual/diff расходящихся снимков
#   <output>/summary.md            — сводка: сколько выполнено, что упало
# Код выхода ненулевой, если упал хоть один набор.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Нужен macOS с Xcode: симулятор iOS не запускается в Linux/WSL." >&2
  echo "Из WSL — scripts/ci-results.sh (результаты CI) или запуск workflow iOS в GitHub." >&2
  exit 2
fi

RECORD=0
BUILD_ONLY=0
SUITES=()
for arg in "$@"; do
  case "$arg" in
    --record) RECORD=1 ;;
    build) BUILD_ONLY=1 ;;
    pr) SUITES+=(unit snapshot ui) ;;
    full) SUITES+=(unit snapshot ui-extended perf) ;;
    unit | snapshot | ui | ui-extended | perf | scroll | bench) SUITES+=("$arg") ;;
    -h | --help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Неизвестный набор: $arg" >&2; exit 2 ;;
  esac
done
[[ ${#SUITES[@]} -eq 0 && $BUILD_ONLY -eq 0 ]] && SUITES=(unit snapshot ui)

DEVICE="${SH_TEST_DEVICE:-iPhone 17 Pro}"
OUTPUT="${SH_TEST_OUTPUT:-$ROOT/build/test-output}"
DERIVED="$ROOT/build/DerivedData"
mkdir -p "$OUTPUT"
: >"$OUTPUT/summary.md"

log() { printf '\n▶ %s\n' "$*"; }

# --- Проект -----------------------------------------------------------------------
if ! command -v xcodegen >/dev/null; then
  echo "Нет xcodegen: brew install xcodegen" >&2
  exit 2
fi
log "Генерация проекта (XcodeGen)"
xcodegen generate --quiet

# --- Симулятор ---------------------------------------------------------------------
# Имя + последняя доступная iOS (или SH_TEST_OS). UDID, а не имя в -destination: на
# раннере одно имя бывает у нескольких рантаймов, и xcodebuild выбирает не тот.
UDID="$(xcrun simctl list devices available -j | python3 -c '
import json, os, sys
name, want = sys.argv[1], os.environ.get("SH_TEST_OS", "")
best = None
for runtime, devices in json.load(sys.stdin)["devices"].items():
    if "iOS" not in runtime:
        continue
    version = tuple(int(p) for p in runtime.rsplit("iOS-", 1)[-1].split("-"))
    if want and ".".join(map(str, version)) != want:
        continue
    for device in devices:
        if device["name"] == name and (best is None or version > best[0]):
            best = (version, device["udid"])
print(best[1] if best else "")
' "$DEVICE")"
if [[ -z "$UDID" ]]; then
  echo "Нет симулятора «$DEVICE»${SH_TEST_OS:+ с iOS $SH_TEST_OS}. Доступные:" >&2
  xcrun simctl list devices available | grep -i iphone >&2
  exit 2
fi
log "Симулятор: $DEVICE ($UDID)"
# Для одной сборки симулятор только называет платформу и архитектуру — загружать его
# не нужно, это пара минут на раннере.
if [[ ${#SUITES[@]} -gt 0 ]]; then
  xcrun simctl boot "$UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$UDID" -b >/dev/null
  # Строка состояния — одна и та же в каждом снимке: время, сеть, заряд.
  xcrun simctl status_bar "$UDID" override --time "9:41" --dataNetwork wifi --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 || true
  # Светлая тема и крупность шрифта по умолчанию — снимки из UI-тестов от них зависят.
  xcrun simctl ui "$UDID" appearance light || true
  xcrun simctl ui "$UDID" content_size large 2>/dev/null || true
fi

DESTINATION="id=$UDID"

# --- Сборка -------------------------------------------------------------------------
log "Сборка для тестов"
set +e
xcodebuild build-for-testing \
  -project StudentHub.xcodeproj -scheme StudentHub \
  -destination "$DESTINATION" -derivedDataPath "$DERIVED" \
  -resultBundlePath "$OUTPUT/build.xcresult" \
  CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO \
  | tee "$OUTPUT/build.log" | grep -E "error:|warning: unreachable|BUILD (SUCCEEDED|FAILED)|\*\* "
BUILD_STATUS=${PIPESTATUS[0]}
set -e
rm -rf "$OUTPUT/build.xcresult" 2>/dev/null || true
if [[ $BUILD_STATUS -ne 0 ]]; then
  {
    echo "## iOS: сборка упала"
    echo '```'
    grep -E "error:" "$OUTPUT/build.log" | head -40
    echo '```'
  } >>"$OUTPUT/summary.md"
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && cat "$OUTPUT/summary.md" >>"$GITHUB_STEP_SUMMARY"
  exit 1
fi

if [[ ${#SUITES[@]} -eq 0 ]]; then
  echo "## iOS: сборка прошла, тесты не запускались" >>"$OUTPUT/summary.md"
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && cat "$OUTPUT/summary.md" >>"$GITHUB_STEP_SUMMARY"
  cat "$OUTPUT/summary.md"
  exit 0
fi

# --- Наборы -------------------------------------------------------------------------
FAILED=()
run_suite() {
  local suite="$1"
  shift
  local result="$OUTPUT/$suite.xcresult"
  local artifacts="$OUTPUT/artifacts/$suite"
  rm -rf "$result" "$artifacts"
  mkdir -p "$artifacts"

  local video_pid=""
  if [[ "$suite" == ui* || "$suite" == perf || "$suite" == scroll ]]; then
    # Видео прогона: --force перезаписывает, SIGINT корректно закрывает файл.
    xcrun simctl io "$UDID" recordVideo --codec h264 --force "$artifacts/run.mp4" >/dev/null 2>&1 &
    video_pid=$!
    sleep 1
  fi

  log "Набор: $suite"
  set +e
  # Окружение раннеру — с префиксом TEST_RUNNER_ (xcodebuild снимает его сам).
  local perf=0
  [[ "$suite" == perf || "$suite" == scroll ]] && perf=1
  env TEST_RUNNER_SNAPSHOT_STRICT=1 \
    TEST_RUNNER_SH_PERF="$perf" \
    TEST_RUNNER_SH_PERF_FLAGS="${SH_PERF_FLAGS:-}" \
    TEST_RUNNER_SNAPSHOT_RECORD="$RECORD" \
    TEST_RUNNER_SNAPSHOT_ARTIFACTS="$OUTPUT/snapshot-diffs" \
    xcodebuild test-without-building \
    -project StudentHub.xcodeproj -scheme StudentHub \
    -destination "$DESTINATION" -derivedDataPath "$DERIVED" \
    -resultBundlePath "$result" \
    "$@" 2>&1 | tee "$artifacts/xcodebuild.log" \
    | grep -E "Test (Suite|Case) .*(passed|failed|skipped)|error:|Executed|\*\* TEST" | grep -vE "Test Case .*passed"
  local status=${PIPESTATUS[0]}
  set -e

  if [[ -n "$video_pid" ]]; then
    kill -INT "$video_pid" 2>/dev/null || true
    wait "$video_pid" 2>/dev/null || true
  fi

  # Вложения (скриншоты UI-тестов, снимки, метрики) — обычными файлами рядом с отчётом.
  xcrun xcresulttool export attachments --path "$result" --output-path "$artifacts/attachments" \
    >/dev/null 2>&1 || true

  python3 "$ROOT/scripts/xcresult_summary.py" "$result" "$suite" >>"$OUTPUT/summary.md" || true

  # Замер плавности (`ScrollSmoothnessTests`) печатает итог строками — в сводку как есть.
  if grep -q 'SCROLL_REPORT variant=' "$artifacts/xcodebuild.log"; then
    {
      echo "### Плавность ленты ($suite)"
      echo '```'
      grep -o 'SCROLL_REPORT variant=.*' "$artifacts/xcodebuild.log" | sort -u
      echo '```'
    } >>"$OUTPUT/summary.md"
  fi

  if [[ "$suite" == perf && $status -eq 0 ]]; then
    python3 "$ROOT/scripts/perf_check.py" "$result" "$ROOT/Tests/perf-baseline.json" \
      --output "$artifacts/metrics.json" >>"$OUTPUT/summary.md" || status=1
  fi

  [[ $status -ne 0 ]] && FAILED+=("$suite")
  return 0
}

# Замер плавности без XCUITest: положения раскладки ленты по очереди, каждое — чистый
# запуск приложения. Итог пишет само приложение в tmp своего контейнера.
BENCH_VARIANTS=("build:" "noEstimates:chatEstimatedHeights=0" "heightCache:chatHeightCache=1")
run_bench() {
  local artifacts="$OUTPUT/artifacts/bench"
  mkdir -p "$artifacts"
  log "Набор: bench"
  local app bundle="kz.studenthub.app" status=0
  app="$(find "$DERIVED/Build/Products" -maxdepth 2 -name StudentHub.app -path '*iphonesimulator*' | head -1)"
  if [[ -z "$app" ]]; then
    echo "Нет собранного StudentHub.app в $DERIVED" >&2
    FAILED+=(bench)
    return 0
  fi
  xcrun simctl install "$UDID" "$app"
  : >"$artifacts/results.txt"
  local variant name flags container result
  for variant in "${BENCH_VARIANTS[@]}"; do
    name="${variant%%:*}"
    flags="${variant#*:}"
    xcrun simctl terminate "$UDID" "$bundle" 2>/dev/null || true
    container="$(xcrun simctl get_app_container "$UDID" "$bundle" data)"
    rm -f "$container/tmp/scroll-bench.txt"
    SIMCTL_CHILD_SH_UITEST_MOCK=1 SIMCTL_CHILD_SH_UITEST_LARGE=1 SIMCTL_CHILD_SH_UITEST_SCENARIO=student \
      SIMCTL_CHILD_SH_PERF_FLAGS="$flags" SIMCTL_CHILD_SH_SCROLL_BENCH="$name" \
      xcrun simctl launch "$UDID" "$bundle" -AppleLanguages '(ru)' -AppleLocale ru_RU >/dev/null
    # Чат открывает сама оболочка (`ScrollBenchmark.chatToOpen`): ссылка через
    # `simctl openurl` упирается в системный вопрос «Открыть в…».
    result="$container/tmp/scroll-bench.txt"
    for _ in $(seq 1 120); do
      [[ -s "$result" ]] && break
      sleep 1
    done
    if [[ -s "$result" ]]; then
      cat "$result" | tee -a "$artifacts/results.txt"
    else
      echo "SCROLL_BENCH variant=$name нет отчёта за 120 с" | tee -a "$artifacts/results.txt"
      xcrun simctl io "$UDID" screenshot "$artifacts/$name-timeout.png" >/dev/null 2>&1 || true
      status=1
    fi
  done
  xcrun simctl terminate "$UDID" "$bundle" 2>/dev/null || true
  {
    echo "### Плавность ленты без XCUITest (bench)"
    echo '```'
    cat "$artifacts/results.txt"
    echo '```'
  } >>"$OUTPUT/summary.md"
  [[ $status -ne 0 ]] && FAILED+=(bench)
  return 0
}

for suite in "${SUITES[@]}"; do
  case "$suite" in
    unit) run_suite unit -only-testing:StudentHubTests ;;
    snapshot) run_suite snapshot -only-testing:StudentHubSnapshotTests ;;
    # Критичные сценарии — только mock API: без сервера и без учётки, воспроизводимо.
    ui) run_suite ui -only-testing:StudentHubUITests -skip-testing:StudentHubUITests/ChatFlowsUITests ;;
    ui-extended) run_suite ui-extended -only-testing:StudentHubUITests ;;
    perf) run_suite perf -only-testing:StudentHubPerfTests ;;
    scroll) run_suite scroll -only-testing:StudentHubPerfTests/ScrollSmoothnessTests ;;
    bench) run_bench ;;
  esac
done

if [[ "$RECORD" == 1 ]]; then
  log "Эталоны записаны. Посмотрите их глазами перед коммитом:"
  git -C "$ROOT" status --short -- 'Tests/**/__Snapshots__' || true
fi

[[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && cat "$OUTPUT/summary.md" >>"$GITHUB_STEP_SUMMARY"
cat "$OUTPUT/summary.md"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "Упали наборы: ${FAILED[*]}" >&2
  exit 1
fi
