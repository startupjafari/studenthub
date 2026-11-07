#!/usr/bin/env bash
# Сборка и установка приложения на iPhone по кабелю без Mac — через xtool (README,
# «Сборка на iPhone без Mac»).
#
# ЧТО ДЕЛАЕТ
#   1. Определяет адрес API, по которому телефон достучится до `pnpm dev` на этом
#      компьютере. localhost из xcconfig не годится: на телефоне это сам телефон.
#   2. Готовит .device/ — Info.plist и таблицы строк (scripts/device_bundle.py).
#   3. Запускает `xtool dev`: сборка, подпись, установка и запуск на телефоне.
#
#   ./scripts/device.sh                 из apps/ios
#   ./scripts/device.sh --prepare-only  только .device/, без xtool (для VS Code)
#
# Переменные:
#   API_BASE_URL  адрес API целиком (например https://api.example.kz/api/v1) — если
#                 задан, адрес компьютера не ищется
#   API_PORT      порт `pnpm dev` (по умолчанию 3001)

set -euo pipefail

cd "$(dirname "$0")/.."

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

if [[ -z "${API_BASE_URL:-}" ]]; then
  ip="$(lan_ip)"
  if [[ -z "$ip" ]]; then
    echo "Не удалось определить адрес компьютера в сети. Задайте API_BASE_URL вручную." >&2
    exit 1
  fi
  API_BASE_URL="http://${ip}:${API_PORT:-3001}/api/v1"
  # Свой адрес в сети из WSL не проверить: запрос изнутри на адрес Windows режет
  # брандмауэр, даже когда телефон доходит. Поэтому проверяем сам `pnpm dev`.
  health_url="http://localhost:${API_PORT:-3001}/api/v1/health"
else
  health_url="${API_BASE_URL%/}/health"
fi

python3 -I scripts/device_bundle.py "$API_BASE_URL"

if [[ "${1:-}" == "--prepare-only" ]]; then
  exit 0
fi

if ! command -v xtool >/dev/null; then
  echo "xtool не установлен: https://xtool.sh/documentation/xtooldocs/installation-linux" >&2
  exit 1
fi

# Если API не запущен, приложение откроется на экран входа с ошибкой связи.
# Предупреждаем заранее.
if ! curl -fsS -m 3 -o /dev/null "$health_url" 2>/dev/null; then
  echo "Внимание: ${health_url} не отвечает — запущен ли pnpm dev?" >&2
fi

exec xtool dev "$@"
