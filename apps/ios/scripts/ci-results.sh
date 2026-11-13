#!/usr/bin/env bash
# Результаты iOS-проверок из GitHub Actions — без Mac и без iPhone (Linux/WSL).
#
#   scripts/ci-results.sh                 # последний прогон iOS на текущей ветке
#   scripts/ci-results.sh --wait          # дождаться окончания идущего прогона
#   scripts/ci-results.sh --run 123456    # конкретный прогон
#   scripts/ci-results.sh --nightly       # последний ночной прогон (ios-nightly.yml)
#
# Скачивает артефакты в apps/ios/build/ci/<id прогона>/ и печатает summary.md: сколько
# тестов выполнено, что упало. Там же — снимки reference/actual/diff, видео прогона
# (artifacts/ui/run.mp4), вложения тестов и .xcresult (открывается в Xcode на любом Mac).
#
# Нужен gh с доступом к репозиторию. В ~/projects-me — аккаунт startupjafari:
#   GH_TOKEN=$(gh auth token --user startupjafari) scripts/ci-results.sh
set -euo pipefail

cd "$(dirname "$0")/.."
WORKFLOW=ios.yml
ARTIFACT=ios-test-results
RUN_ID=""
WAIT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="$2"; shift ;;
    --wait) WAIT=1 ;;
    --nightly) WORKFLOW=ios-nightly.yml; ARTIFACT=ios-nightly-results ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
  shift
done

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ -z "$RUN_ID" ]]; then
  if [[ "$WORKFLOW" == ios-nightly.yml ]]; then
    RUN_ID="$(gh run list --workflow "$WORKFLOW" -L 1 --json databaseId --jq '.[0].databaseId')"
  else
    RUN_ID="$(gh run list --workflow "$WORKFLOW" --branch "$BRANCH" -L 1 --json databaseId --jq '.[0].databaseId')"
  fi
fi
if [[ -z "$RUN_ID" || "$RUN_ID" == null ]]; then
  echo "Прогонов $WORKFLOW для ветки $BRANCH нет. Запушена ли ветка?" >&2
  exit 1
fi

if [[ "$WAIT" == 1 ]]; then
  gh run watch "$RUN_ID" --interval 30 --exit-status >/dev/null || true
fi

gh run view "$RUN_ID" --json status,conclusion,headSha,url,jobs \
  --jq '"Прогон: \(.url)\nКоммит: \(.headSha[0:8])  Статус: \(.status) \(.conclusion)\n" + ([.jobs[] | "  • \(.name): \(.conclusion // .status)"] | join("\n"))'

STATUS="$(gh run view "$RUN_ID" --json status --jq .status)"
if [[ "$STATUS" != completed ]]; then
  echo "Прогон ещё идёт — повторите с --wait." >&2
  exit 3
fi

DEST="build/ci/$RUN_ID"
rm -rf "$DEST"
mkdir -p "$DEST"
if gh run download "$RUN_ID" --dir "$DEST" >/dev/null 2>&1; then
  echo "Артефакты: $(pwd)/$DEST"
else
  echo "Артефактов нет (сборка упала раньше тестов?) — лог задачи:" >&2
  gh run view "$RUN_ID" --log-failed | grep -E "error:|❌|Упали|FAILED" | head -60 >&2 || true
  exit 1
fi

SUMMARY="$(find "$DEST/$ARTIFACT" -name summary.md -print -quit 2>/dev/null || true)"
[[ -n "$SUMMARY" ]] && cat "$SUMMARY"

DIFFS="$(find "$DEST" -path '*snapshot-diffs*' -name diff.png 2>/dev/null | wc -l)"
[[ "$DIFFS" -gt 0 ]] && echo "Расхождений снимков: $DIFFS — $(pwd)/$DEST/$ARTIFACT/snapshot-diffs"
VIDEOS="$(find "$DEST" -name '*.mp4' 2>/dev/null)"
[[ -n "$VIDEOS" ]] && printf 'Видео:\n%s\n' "$VIDEOS"

CONCLUSION="$(gh run view "$RUN_ID" --json conclusion --jq .conclusion)"
[[ "$CONCLUSION" == success ]]
