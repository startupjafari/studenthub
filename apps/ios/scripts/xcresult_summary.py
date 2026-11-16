#!/usr/bin/env python3
"""Сводка одного .xcresult в Markdown: сколько тестов выполнено, прошло, упало.

    python3 scripts/xcresult_summary.py build/test-output/unit.xcresult unit

Нужен Xcode 16+ (`xcresulttool get test-results summary`). Пишет в stdout — test.sh
дописывает его в summary.md и в сводку шага GitHub Actions.
"""

import json
import subprocess
import sys


def main() -> int:
    path, suite = sys.argv[1], sys.argv[2]
    try:
        raw = subprocess.run(
            ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", path, "--format", "json"],
            check=True, capture_output=True, text=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        print(f"### {suite}: отчёт не прочитан\n\n`{error}`\n")
        return 1

    data = json.loads(raw)
    total = data.get("totalTestCount", 0)
    passed = data.get("passedTests", 0)
    failed = data.get("failedTests", 0)
    skipped = data.get("skippedTests", 0)
    expected = data.get("expectedFailures", 0)
    result = data.get("result", "?")
    mark = "✅" if result == "Passed" else ("⚠️" if result == "Skipped" else "❌")

    print(f"### {mark} {suite}: {result}\n")
    print("| Выполнено | Прошло | Упало | Пропущено | Ожидаемые падения |")
    print("|---:|---:|---:|---:|---:|")
    print(f"| {total - skipped} | {passed} | {failed} | {skipped} | {expected} |\n")

    failures = data.get("testFailures", [])
    if failures:
        print("<details open><summary>Падения</summary>\n")
        for failure in failures[:50]:
            name = failure.get("testIdentifierString") or failure.get("testName", "?")
            text = (failure.get("failureText") or "").strip().replace("\n", " ")
            print(f"- `{name}` — {text[:400]}")
        if len(failures) > 50:
            print(f"- … и ещё {len(failures) - 50}")
        print("\n</details>\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
