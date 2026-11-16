#!/usr/bin/env python3
"""Метрики производительности из .xcresult против baseline с допуском.

    python3 scripts/perf_check.py perf.xcresult Tests/perf-baseline.json --output metrics.json

Baseline — `Tests/perf-baseline.json`:

    {
      "tolerance": 0.25,
      "metrics": {
        "StudentHubPerfTests/LaunchPerfTests/testColdLaunch()|Duration (AppLaunch)": {
          "baseline": 1.2, "unit": "s", "tolerance": 0.3
        }
      }
    }

Ключ — идентификатор теста и имя метрики (`displayName` из Xcode). Сравнивается среднее
по повторам; регрессия — среднее больше baseline × (1 + tolerance). Все метрики здесь —
«чем меньше, тем лучше» (время, память, CPU, доля подвисаний).

Метрика без baseline — не ошибка, а строка «новая» в сводке: baseline для неё
переносится из `metrics.json` первого прогона руками, после взгляда на числа.

Числа с симулятора на раннере CI — сравнительные, не абсолютные: они ловят регрессию
между коммитами на одной и той же машине, но ничего не говорят о частоте кадров на
iPhone.
"""

import argparse
import json
import statistics
import subprocess
import sys


def load_metrics(path: str) -> dict:
    raw = subprocess.run(
        ["xcrun", "xcresulttool", "get", "test-results", "metrics", "--path", path, "--format", "json"],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(raw)

    found: dict = {}

    # Схема вывода менялась между версиями Xcode, поэтому обходим дерево и берём любой
    # объект с `testIdentifier`, у которого внутри есть метрики с измерениями.
    def collect_metrics(node, test_id):
        if isinstance(node, dict):
            name = node.get("displayName") or node.get("identifier")
            values = node.get("measurements")
            if name and isinstance(values, list) and values and test_id:
                numbers = [float(v) for v in values if isinstance(v, (int, float))]
                if numbers:
                    found[f"{test_id}|{name}"] = {
                        "unit": node.get("unitOfMeasurement", ""),
                        "values": numbers,
                    }
            for value in node.values():
                collect_metrics(value, test_id)
        elif isinstance(node, list):
            for value in node:
                collect_metrics(value, test_id)

    def walk(node):
        if isinstance(node, dict):
            test_id = node.get("testIdentifier") or node.get("testIdentifierString")
            if test_id:
                collect_metrics(node, test_id)
                return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("xcresult")
    parser.add_argument("baseline")
    parser.add_argument("--output")
    args = parser.parse_args()

    try:
        metrics = load_metrics(args.xcresult)
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError) as error:
        print(f"### ❌ perf: метрики не прочитаны\n\n`{error}`\n")
        return 1

    with open(args.baseline, encoding="utf-8") as file:
        baseline = json.load(file)
    default_tolerance = float(baseline.get("tolerance", 0.25))
    expected = baseline.get("metrics", {})

    rows = []
    regressions = 0
    summary = {}
    for key in sorted(metrics):
        entry = metrics[key]
        mean = statistics.fmean(entry["values"])
        deviation = statistics.pstdev(entry["values"]) if len(entry["values"]) > 1 else 0.0
        summary[key] = {"unit": entry["unit"], "mean": mean, "stdev": deviation, "values": entry["values"]}
        reference = expected.get(key)
        if reference is None:
            rows.append((key, mean, entry["unit"], "—", "🆕 новая"))
            continue
        tolerance = float(reference.get("tolerance", default_tolerance))
        limit = float(reference["baseline"]) * (1 + tolerance)
        if mean > limit:
            regressions += 1
            status = f"❌ > {limit:.4g}"
        else:
            status = "✅"
        rows.append((key, mean, entry["unit"], f'{reference["baseline"]:.4g}', status))

    missing = sorted(set(expected) - set(metrics))

    if args.output:
        with open(args.output, "w", encoding="utf-8") as file:
            json.dump(summary, file, ensure_ascii=False, indent=2)

    print(f"### {'❌' if regressions or missing else '✅'} perf: метрики против baseline (допуск {default_tolerance:.0%})\n")
    if not rows:
        print("Метрик в отчёте нет.\n")
    else:
        print("| Тест · метрика | Среднее | Ед. | Baseline | Итог |")
        print("|---|---:|---|---:|---|")
        for key, mean, unit, reference, status in rows:
            print(f"| `{key}` | {mean:.4g} | {unit} | {reference} | {status} |")
        print()
    for key in missing:
        print(f"- ❌ `{key}`: метрика из baseline не измерена (тест пропал или упал)")
    if missing:
        print()
    print("_Симулятор на раннере CI: числа сравнительные, не частота кадров на iPhone._\n")
    return 1 if regressions or missing else 0


if __name__ == "__main__":
    sys.exit(main())
