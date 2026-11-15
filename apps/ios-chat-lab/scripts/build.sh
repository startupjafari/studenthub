#!/usr/bin/env bash
# Сборка Chat Lab.
#
#   ./scripts/build.sh                 macOS: Debug под симулятор; Linux: проверка компиляции под iOS
#   ./scripts/build.sh --release       Release
#   ./scripts/build.sh --device        macOS: сборка под iPhone (нужна команда, scripts/setup.sh)
#   ./scripts/build.sh --app           Linux: собрать .app через xtool (подпись — при установке)
#   ./scripts/build.sh --tests         Linux: проверить компиляцию unit-, UI- и perf-тестов (без запуска)
#
# Код выхода — код самой сборки (не конвейера).

source "$(dirname "$0")/lib.sh"

configuration=Debug
device=false
app=false
tests=false
for arg in "$@"; do
  case "$arg" in
    --release) configuration=Release ;;
    --device) device=true ;;
    --app) app=true ;;
    --tests) tests=true ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "Неизвестный аргумент: $arg" ;;
  esac
done

cd "$LAB_DIR"
mkdir -p build

if is_macos; then
  require_macos_tools
  generate_project
  if [[ "$device" == true ]]; then
    destination="generic/platform=iOS"
    [[ -f "$SIGNING_FILE" ]] || warn "Нет Config/Signing.local.xcconfig — запустите scripts/setup.sh"
  else
    destination="generic/platform=iOS Simulator"
  fi
  info "xcodebuild $configuration → $destination"
  set +e
  xcodebuild -project "$PROJECT" -scheme ChatLab -configuration "$configuration" \
    -destination "$destination" -derivedDataPath build/DerivedData \
    -allowProvisioningUpdates build 2>&1 | tee build/build.log | grep -E "error:|warning:|BUILD (SUCCEEDED|FAILED)"
  status=${PIPESTATUS[0]}
  set -e
  [[ $status -eq 0 ]] && ok "Сборка прошла (лог: build/build.log)" || die "Сборка упала (код $status), лог: build/build.log"
else
  require_linux_tools
  if [[ "$tests" == true ]]; then
    # Тесты запускает только Xcode, но скомпилировать их можно и здесь: временный пакет,
    # где тестовые файлы — обычные модули поверх XCTest из Darwin SDK.
    check="$LAB_DIR/build/test-check"
    frameworks="$HOME/.swiftpm/swift-sdks/darwin.artifactbundle/Developer/Platforms/iPhoneOS.platform/Developer/Library/Frameworks"
    [[ -d "$frameworks/XCTest.framework" ]] || die "В Darwin SDK нет XCTest.framework ($frameworks)"
    rm -rf "$check"
    mkdir -p "$check/Unit" "$check/UI" "$check/Perf"
    ln -s "$LAB_DIR"/Tests/ChatLabTests/*.swift "$check/Unit/"
    ln -s "$LAB_DIR"/Tests/ChatLabUITests/*.swift "$LAB_DIR"/Tests/Shared/*.swift "$check/UI/"
    ln -s "$LAB_DIR"/Tests/ChatLabPerfTests/*.swift "$LAB_DIR"/Tests/Shared/*.swift "$check/Perf/"
    python3 - "$check/Package.swift" "$frameworks" "$LAB_DIR" <<'PY'
import sys
path, frameworks, lab = sys.argv[1:4]
open(path, "w").write(f'''// swift-tools-version: 6.0
import PackageDescription
let xctest: [SwiftSetting] = [.unsafeFlags(["-F", "{frameworks}"])]
let package = Package(
    name: "ChatLabTestCheck",
    platforms: [.iOS("26.0")],
    dependencies: [.package(path: "{lab}")],
    targets: [
        .target(name: "Unit", dependencies: [.product(name: "ChatLab", package: "ios-chat-lab")], path: "Unit", swiftSettings: xctest),
        .target(name: "UI", path: "UI", swiftSettings: xctest),
        .target(name: "Perf", path: "Perf", swiftSettings: xctest),
    ],
    swiftLanguageModes: [.v5]
)
''')
PY
    info "Проверка компиляции тестов (unit, UI, perf)"
    set +e
    (cd "$check" && swift build --build-system native --swift-sdk arm64-apple-ios 2>&1) | tee build/tests-build.log | grep -E "error:|warning:" | grep -v "build-system"
    status=${PIPESTATUS[0]}
    set -e
    [[ $status -eq 0 ]] && ok "Тесты компилируются (запуск — scripts/test.sh на macOS)" || die "Тесты не компилируются (код $status), лог: build/tests-build.log"
  elif [[ "$app" == true ]]; then
    command -v xtool >/dev/null || die "Нет xtool (https://xtool.sh)"
    info "xtool dev build ($configuration)"
    flag=""
    [[ "$configuration" == Release ]] && flag="--configuration release"
    xtool dev build $flag
    ok "Приложение: xtool/ChatLab.app"
  else
    info "Проверка компиляции под iOS (arm64, Darwin SDK) — $configuration"
    swift_config=debug
    [[ "$configuration" == Release ]] && swift_config=release
    set +e
    swift build --build-system native --swift-sdk arm64-apple-ios -c "$swift_config" 2>&1 | tee build/build.log | grep -E "error:|warning:" | grep -v "build-system"
    status=${PIPESTATUS[0]}
    set -e
    [[ $status -eq 0 ]] && ok "Компилируется (лог: build/build.log)" || die "Ошибка компиляции (код $status), лог: build/build.log"
  fi
fi
