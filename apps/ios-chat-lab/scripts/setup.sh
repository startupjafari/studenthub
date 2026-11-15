#!/usr/bin/env bash
# Подготовка окружения Chat Lab.
#
#   macOS:  проверяет Xcode 26+ и XcodeGen, находит вашу команду разработчика (из
#           переменной DEVELOPMENT_TEAM или из сертификата «Apple Development» в связке
#           ключей), пишет её в Config/Signing.local.xcconfig (не в git) и генерирует проект.
#           Чужие сертификаты и настройки подписи не меняет — только читает.
#   Linux/WSL: проверяет Swift и Darwin SDK (xtool) — для проверки компиляции и установки
#           на iPhone через xtool. Симулятор и XCUITest — только на macOS.
#
#   ./scripts/setup.sh
#   DEVELOPMENT_TEAM=ABCDE12345 ./scripts/setup.sh

source "$(dirname "$0")/lib.sh"

if is_macos; then
  require_macos_tools
  ok "Xcode: $(xcodebuild -version | head -1)"
  ok "XcodeGen: $(xcodegen --version 2>/dev/null || echo есть)"

  team="${DEVELOPMENT_TEAM:-}"
  if [[ -z "$team" && -f "$SIGNING_FILE" ]]; then
    team="$(awk -F' *= *' '/DEVELOPMENT_TEAM/ {print $2}' "$SIGNING_FILE" | tr -d ' ')"
  fi
  if [[ -z "$team" ]]; then
    # OU в сертификате разработчика — это Team ID. Берём первый действующий.
    cert="$(security find-certificate -c "Apple Development" -p 2>/dev/null | awk '/BEGIN/{n++} n==1' || true)"
    if [[ -n "$cert" ]]; then
      team="$(echo "$cert" | openssl x509 -noout -subject -nameopt multiline 2>/dev/null | awk -F' = ' '/organizationalUnitName/ {print $2; exit}')"
    fi
  fi
  if [[ -n "$team" ]]; then
    printf '// Создано scripts/setup.sh. Не коммитить.\nDEVELOPMENT_TEAM = %s\n' "$team" > "$SIGNING_FILE"
    ok "Команда разработчика: $team (Config/Signing.local.xcconfig)"
  else
    warn "Команда разработчика не найдена. Для iPhone: войдите в Xcode → Settings → Accounts"
    warn "или запустите: DEVELOPMENT_TEAM=<ваш Team ID> ./scripts/setup.sh"
  fi
  generate_project
  ok "Проект: $PROJECT"
  if devices="$(list_connected_iphones)" && [[ -n "$devices" ]]; then
    ok "Подключённые iPhone:"
    echo "$devices" | sed 's/^/    /'
  else
    warn "iPhone не подключён (или не доверяет этому Mac) — для установки подключите кабелем."
  fi
else
  require_linux_tools
  ok "Swift: $(swift --version 2>&1 | head -1)"
  ok "Darwin SDK: $(swift sdk list | grep darwin)"
  if command -v xtool >/dev/null; then
    ok "xtool: $(xtool --version)"
  else
    warn "xtool не найден — установка на iPhone из Linux недоступна (https://xtool.sh)"
  fi
  warn "Linux/WSL: доступны проверка компиляции (scripts/build.sh) и установка через xtool."
  warn "Симулятор, XCUITest и Instruments — только на macOS с Xcode 26+."
fi
