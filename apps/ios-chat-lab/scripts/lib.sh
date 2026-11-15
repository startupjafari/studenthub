#!/usr/bin/env bash
# Общие функции скриптов Chat Lab. Подключается через `source`.

set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$LAB_DIR/ChatLab.xcodeproj"
OUTPUT_DIR="$LAB_DIR/build/test-output"
SIGNING_FILE="$LAB_DIR/Config/Signing.local.xcconfig"

if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BOLD=""; RESET=""
fi

info() { echo "${BOLD}==>${RESET} $*"; }
ok() { echo "${GREEN}✓${RESET} $*"; }
warn() { echo "${YELLOW}!${RESET} $*" >&2; }
die() {
  echo "${RED}✗ $*${RESET}" >&2
  exit 1
}

is_macos() { [[ "$(uname -s)" == "Darwin" ]]; }
is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

require_macos_tools() {
  is_macos || return 0
  command -v xcodebuild >/dev/null || die "Нет xcodebuild. Установите Xcode 26+ из App Store и выполните: sudo xcode-select -s /Applications/Xcode.app"
  local version
  version="$(xcodebuild -version 2>/dev/null | awk 'NR==1 {print $2}')"
  local major="${version%%.*}"
  if [[ -z "$major" || "$major" -lt 26 ]]; then
    die "Нужен Xcode 26 или новее (iOS 26 SDK), найден: ${version:-неизвестно}"
  fi
  command -v xcodegen >/dev/null || die "Нет XcodeGen: brew install xcodegen"
}

require_linux_tools() {
  command -v swift >/dev/null || die "Нет Swift. Linux: https://www.swift.org/install/linux/ (swiftly)"
  swift sdk list 2>/dev/null | grep -q darwin || die "Нет Darwin SDK для Swift. Установите xtool и выполните: xtool setup (https://xtool.sh)"
}

generate_project() {
  is_macos || return 0
  info "XcodeGen: генерирую ChatLab.xcodeproj"
  (cd "$LAB_DIR" && xcodegen generate --quiet) || die "xcodegen generate завершился с ошибкой"
}

# Первый доступный симулятор iPhone (по умолчанию iPhone 17 Pro, если есть).
pick_simulator() {
  local preferred="${SIMULATOR:-iPhone 17 Pro}"
  xcrun simctl list devices available -j | python3 -c '
import json, sys
preferred = sys.argv[1]
devices = []
for runtime, items in json.load(sys.stdin)["devices"].items():
    if "iOS" not in runtime:
        continue
    for item in items:
        if item.get("isAvailable") and item["name"].startswith("iPhone"):
            devices.append((runtime, item["name"], item["udid"]))
if not devices:
    sys.exit(1)
devices.sort(key=lambda d: d[0], reverse=True)
for runtime, name, udid in devices:
    if name == preferred:
        print(udid); sys.exit(0)
print(devices[0][2])
' "$preferred"
}

# Подключённые iPhone (macOS): "udid<TAB>имя".
list_connected_iphones() {
  local json
  json="$(mktemp)"
  if xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1; then
    python3 - "$json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for device in data.get("result", {}).get("devices", []):
    props = device.get("hardwareProperties", {})
    conn = device.get("connectionProperties", {})
    if props.get("platform") == "iOS" and conn.get("tunnelState") != "unavailable":
        print(f'{props.get("udid", device.get("identifier"))}\t{device.get("deviceProperties", {}).get("name", "iPhone")}')
PY
  fi
  rm -f "$json"
}
