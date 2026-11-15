#!/usr/bin/env bash
# Сборка Chat Lab.
#
#   ./scripts/build.sh                 macOS: Debug под симулятор; Linux: проверка компиляции под iOS
#   ./scripts/build.sh --release       Release
#   ./scripts/build.sh --device        macOS: сборка под iPhone (нужна команда, scripts/setup.sh)
#   ./scripts/build.sh --app           Linux: собрать .app через xtool (подпись — при установке)
#
# Код выхода — код самой сборки (не конвейера).

source "$(dirname "$0")/lib.sh"

configuration=Debug
device=false
app=false
for arg in "$@"; do
  case "$arg" in
    --release) configuration=Release ;;
    --device) device=true ;;
    --app) app=true ;;
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
  if [[ "$app" == true ]]; then
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
