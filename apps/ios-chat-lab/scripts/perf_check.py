"""Сверка замеров perf-тестов с базой.

Тесты печатают строки вида
    PERF name=scroll_history frames=812 fps=118.4 hitches=2 hitchRatioMsPerS=1.8 worstMs=24.9
(числа — из монитора кадров приложения, CADisplayLink). База — Tests/perf-baseline.json:
    {"scroll_history": {"hitchRatioMsPerS": {"max": 5}, "fps": {"min": 55}}, ...}
Нет строки для сценария из базы — провал (сценарий не выполнился). Код 1 при любом нарушении.
"""
import json
import re
import sys


def main() -> int:
    log_path, baseline_path = sys.argv[1], sys.argv[2]
    baseline = json.load(open(baseline_path, encoding="utf-8"))
    measured = {}
    for line in open(log_path, encoding="utf-8", errors="replace"):
        match = re.search(r"PERF name=(\S+)((?: \w+=[-\d.]+)+)", line)
        if not match:
            continue
        values = dict(pair.split("=") for pair in match.group(2).split())
        measured[match.group(1)] = {key: float(value) for key, value in values.items()}
    print("## Сверка с базой (Tests/perf-baseline.json)\n")
    print("| сценарий | метрика | значение | граница | итог |")
    print("|---|---|---|---|---|")
    failed = False
    for name, limits in baseline.items():
        if name.startswith("_"):
            continue
        if name not in measured:
            print(f"| {name} | — | нет замера | — | ✗ |")
            failed = True
            continue
        for metric, bound in limits.items():
            value = measured[name].get(metric)
            if value is None:
                print(f"| {name} | {metric} | нет | — | ✗ |")
                failed = True
                continue
            ok = True
            if "max" in bound and value > bound["max"]:
                ok = False
            if "min" in bound and value < bound["min"]:
                ok = False
            limit = f"≤ {bound['max']}" if "max" in bound else f"≥ {bound['min']}"
            print(f"| {name} | {metric} | {value:g} | {limit} | {'✓' if ok else '✗'} |")
            failed |= not ok
    print()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
