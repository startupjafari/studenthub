#!/usr/bin/env bash
# Сборка и установка Chat Lab на подключённый iPhone.
#
#   macOS:     xcodebuild (подпись — ваша команда из Config/Signing.local.xcconfig, scripts/setup.sh)
#              + xcrun devicectl install/launch. Сертификаты и профили не меняет; профиль
#              разработки для kz.studenthub.chatlab Xcode создаёт сам (-allowProvisioningUpdates).
#   Linux/WSL: xtool dev (сборка, подпись личным Apple ID, установка, запуск), как
#              apps/ios/scripts/device.sh. Bundle ID — kz.studenthub.chatlab.dev (xtool.yml).
#
#   ./scripts/install-iphone.sh                 первый найденный iPhone
#   ./scripts/install-iphone.sh --udid <UDID>   конкретный
#   ./scripts/install-iphone.sh --release       Release (для честных замеров плавности)
#
# Перед установкой на iPhone: «Настройки → Конфиденциальность → Режим разработчика» включён,
# телефон разблокирован и доверяет компьютеру. Данные приложения переустановка не стирает.

source "$(dirname "$0")/lib.sh"

udid="${DEVICE_UDID:-}"
configuration=Debug
while [[ $# -gt 0 ]]; do
  case "$1" in
    --udid) udid="$2"; shift 2 ;;
    --release) configuration=Release; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "Неизвестный аргумент: $1" ;;
  esac
done

cd "$LAB_DIR"

if is_macos; then
  require_macos_tools
  [[ -f "$SIGNING_FILE" ]] || die "Нет команды разработчика. Запустите ./scripts/setup.sh (или DEVELOPMENT_TEAM=<Team ID> ./scripts/setup.sh)"
  if [[ -z "$udid" ]]; then
    devices="$(list_connected_iphones)"
    [[ -n "$devices" ]] || die "iPhone не найден. Подключите кабелем, разблокируйте, нажмите «Доверять» и включите Режим разработчика."
    udid="$(echo "$devices" | head -1 | cut -f1)"
    info "iPhone: $(echo "$devices" | head -1 | cut -f2) ($udid)"
    [[ $(echo "$devices" | wc -l) -gt 1 ]] && warn "Подключено несколько — выбран первый. Другой: --udid <UDID>"
  fi
  generate_project
  info "Сборка $configuration под iPhone"
  set +e
  xcodebuild -project "$PROJECT" -scheme ChatLab -configuration "$configuration" \
    -destination "id=$udid" -derivedDataPath build/DerivedData -allowProvisioningUpdates build \
    2>&1 | tee build/install.log | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
  status=${PIPESTATUS[0]}
  set -e
  if [[ $status -ne 0 ]]; then
    grep -q "No Account for Team\|requires a development team\|No profiles for" build/install.log &&
      die "Подпись не настроена: Xcode → Settings → Accounts, затем ./scripts/setup.sh. Лог: build/install.log"
    die "Сборка упала (код $status), лог: build/install.log"
  fi
  app="build/DerivedData/Build/Products/$configuration-iphoneos/ChatLab.app"
  [[ -d "$app" ]] || die "Не найден $app"
  info "Установка"
  xcrun devicectl device install app --device "$udid" "$app" || die "Установка не удалась — телефон заблокирован или не доверяет Mac?"
  info "Запуск"
  xcrun devicectl device process launch --device "$udid" kz.studenthub.chatlab >/dev/null || warn "Не удалось запустить автоматически — откройте Chat Lab на телефоне."
  ok "Chat Lab установлен на iPhone"
else
  require_linux_tools
  command -v xtool >/dev/null || die "xtool не установлен: https://xtool.sh/documentation/xtooldocs/installation-linux"
  # WSL: телефон через службу Apple в Windows (порт 27015 проброшен), как в apps/ios.
  if [[ -z "${USBMUXD_SOCKET_ADDRESS:-}" ]] && is_wsl; then
    gateway="$(ip route list default | awk '{print $3; exit}')"
    if timeout 2 bash -c ">/dev/tcp/${gateway}/27015" 2>/dev/null; then
      if USBMUXD_SOCKET_ADDRESS="${gateway}:27015" timeout 5 idevice_id -l >/dev/null 2>&1; then
        export USBMUXD_SOCKET_ADDRESS="${gateway}:27015"
        info "Телефон — через службу Apple в Windows (${USBMUXD_SOCKET_ADDRESS})"
      else
        die "Порт 27015 проброшен, но служба Apple в Windows не отвечает — запущено ли «Apple Devices»?"
      fi
    fi
  fi
  devices="$(timeout 15 xtool devices 2>/dev/null || true)"
  [[ -n "$devices" ]] || warn "xtool не видит iPhone — проверьте кабель/доверие (usbipd или «Apple Devices» в Windows)."
  [[ -n "$devices" ]] && echo "$devices" | sed 's/^/    /'
  args=()
  [[ -n "$udid" ]] && args+=(--udid "$udid")
  [[ "$configuration" == Release ]] && args+=(--configuration release)
  info "xtool dev: сборка, подпись, установка и запуск"
  exec xtool dev run "${args[@]}"
fi
