"""Сводка .xcresult: сколько тестов выполнено, прошло, упало и пропущено.

Ноль выполненных — провал (код 1): зелёная сводка без тестов ничего не доказывает.
Запуск: python3 scripts/xcresult_summary.py build/test-output/ui.xcresult ui
"""
import json
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: xcresult_summary.py <bundle.xcresult> <name>", file=sys.stderr)
        return 2
    bundle, name = sys.argv[1], sys.argv[2]
    try:
        raw = subprocess.run(
            ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", bundle],
            check=True, capture_output=True, text=True,
        ).stdout
        data = json.loads(raw)
    except (subprocess.CalledProcessError, json.JSONDecodeError, FileNotFoundError) as error:
        print(f"## {name}\n\nНе удалось прочитать {bundle}: {error}\n")
        return 1
    passed = data.get("passedTests", 0)
    failed = data.get("failedTests", 0)
    skipped = data.get("skippedTests", 0)
    expected = data.get("expectedFailures", 0)
    total = data.get("totalTestCount", passed + failed + skipped + expected)
    print(f"## {name}\n")
    print(f"- выполнено: {total}, прошло: {passed}, упало: {failed}, пропущено: {skipped}, ожидаемых падений: {expected}")
    for failure in data.get("testFailures", [])[:30]:
        print(f"  - ✗ {failure.get('testName')}: {failure.get('failureText', '').strip()[:300]}")
    print()
    if total == 0:
        print("  - ✗ Ни одного выполненного теста — считаю провалом.\n")
        return 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
