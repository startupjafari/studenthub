#!/usr/bin/env bash
# Сборка и установка приложения на iPhone по кабелю без Mac — через xtool (README,
# «Сборка на iPhone без Mac»).
#
# ЧТО ДЕЛАЕТ
#   1. Выбирает адрес API. По умолчанию — тестовая среда на Railway (деплой с develop),
#      `pnpm dev` на компьютере не нужен. С --local — `pnpm dev` на этом компьютере по
#      адресу в локальной сети: localhost из xcconfig не годится, на телефоне это сам
#      телефон.
#   2. Готовит .device/ — Info.plist и таблицы строк (scripts/device_bundle.py).
#   3. Запускает `xtool dev`: сборка, подпись, установка и запуск на телефоне.
#
#   ./scripts/device.sh                 из apps/ios, сервер на Railway
#   ./scripts/device.sh --local         сервер — `pnpm dev` на этом компьютере
#   ./scripts/device.sh --prepare-only  только .device/, без xtool (для VS Code)
#
# Переменные:
#   API_BASE_URL  адрес API целиком (например https://api.example.kz/api/v1) —
#                 перекрывает и Railway, и --local
#   WEB_BASE_URL  адрес веба для ссылок «Поделиться»
#   API_PORT      порт `pnpm dev` для --local (по умолчанию 3001)
#   WEB_PORT      порт веба для --local (по умолчанию 3000)

set -euo pipefail

cd "$(dirname "$0")/.."

# Тестовая среда на Railway: деплоится с develop.
RAILWAY_API_BASE_URL=https://studenthub-back-production.up.railway.app/api/v1
RAILWAY_WEB_BASE_URL=https://studenthub-front-production.up.railway.app

# Свои флаги разбираем здесь, остальные уходят в `xtool dev`.
local_server=false
prepare_only=false
xtool_args=()
for arg in "$@"; do
  case "$arg" in
    --local) local_server=true ;;
    --prepare-only) prepare_only=true ;;
    *) xtool_args+=("$arg") ;;
  esac
done

# Адрес компьютера в сети Wi-Fi. В WSL с сетью NAT у Linux свой внутренний адрес
# (172.x), телефону он недоступен — нужен адрес Windows, а до WSL запрос доводит
# portproxy (README).
lan_ip() {
  local powershell=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
  if grep -qi microsoft /proc/version && [[ -x "$powershell" ]]; then
    "$powershell" -NoProfile -Command \
      '(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1).IPv4Address.IPAddress' \
      | tr -d '\r'
  else
    hostname -I | awk '{print $1}'
  fi
}

if [[ -n "${API_BASE_URL:-}" ]]; then
  health_url="${API_BASE_URL%/}/health"
elif [[ "$local_server" == true ]]; then
  ip="$(lan_ip)"
  if [[ -z "$ip" ]]; then
    echo "Не удалось определить адрес компьютера в сети. Задайте API_BASE_URL вручную." >&2
    exit 1
  fi
  API_BASE_URL="http://${ip}:${API_PORT:-3001}/api/v1"
  WEB_BASE_URL="${WEB_BASE_URL:-http://${ip}:${WEB_PORT:-3000}}"
  # Свой адрес в сети из WSL не проверить: запрос изнутри на адрес Windows режет
  # брандмауэр, даже когда телефон доходит. Поэтому проверяем сам `pnpm dev`.
  health_url="http://localhost:${API_PORT:-3001}/api/v1/health"
else
  API_BASE_URL="$RAILWAY_API_BASE_URL"
  WEB_BASE_URL="${WEB_BASE_URL:-$RAILWAY_WEB_BASE_URL}"
  health_url="${API_BASE_URL}/health"
fi

python3 -I scripts/device_bundle.py "$API_BASE_URL" "${WEB_BASE_URL:-}"

if [[ "$prepare_only" == true ]]; then
  exit 0
fi

if ! command -v xtool >/dev/null; then
  echo "xtool не установлен: https://xtool.sh/documentation/xtooldocs/installation-linux" >&2
  exit 1
fi

# WSL: с проброшенным через usbipd телефоном xtool зависает на шаге Connecting. Если
# в Windows работает служба Apple (приложение «Apple Devices») и её порт 27015
# проброшен до WSL (README), ходим к телефону через неё.
if [[ -z "${USBMUXD_SOCKET_ADDRESS:-}" ]] && grep -qi microsoft /proc/version; then
  gateway="$(ip route list default | awk '{print $3; exit}')"
  if timeout 2 bash -c ">/dev/tcp/${gateway}/27015" 2>/dev/null; then
    # Открытый порт ещё не значит, что служба жива: portproxy принимает соединение и
    # без неё. Спрашиваем у службы список устройств.
    if USBMUXD_SOCKET_ADDRESS="${gateway}:27015" timeout 5 idevice_id -l >/dev/null 2>&1; then
      export USBMUXD_SOCKET_ADDRESS="${gateway}:27015"
      echo "Телефон — через службу Apple в Windows (${USBMUXD_SOCKET_ADDRESS})"
    else
      echo "Порт 27015 проброшен, но служба Apple в Windows не отвечает — запущено ли «Apple Devices»?" >&2
      exit 1
    fi
  fi
fi

# Если API не запущен, приложение откроется на экран входа с ошибкой связи.
# Предупреждаем заранее.
if ! curl -fsS -m 5 -o /dev/null "$health_url" 2>/dev/null; then
  if [[ "$local_server" == true ]]; then
    echo "Внимание: ${health_url} не отвечает — запущен ли pnpm dev?" >&2
  else
    echo "Внимание: ${health_url} не отвечает — сервер недоступен или ещё выкатывается." >&2
  fi
fi

exec xtool dev "${xtool_args[@]}"
