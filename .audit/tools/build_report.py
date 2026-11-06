#!/usr/bin/env python3
"""Сборка .audit/AUDIT_REPORT.md и черновика задач из .audit/findings/<группа>.md.

Запуск из корня репозитория: python3 .audit/tools/build_report.py
Резюме (раздел 1) пишется вручную в .audit/report_summary.md и вставляется как есть.
"""
import json
import re
from pathlib import Path

ROOT = Path('.audit')
GROUPS = [
    ('A', 'Учётки и доступ'),
    ('B', 'Структура вуза и платформа'),
    ('C', 'Учебный процесс'),
    ('D', 'Услуги, документы, карьера, модерация'),
    ('E', 'Соцчасть и контент'),
    ('F', 'Коммуникации и инфраструктура'),
]
FIELDS = {
    'Процесс': 'process',
    'Где': 'where',
    'Суть': 'what',
    'Решение': 'fix',
    'Файлы для правки': 'files',
    'Стоп-точки': 'stops',
}


def parse_group(g):
    path = ROOT / 'findings' / f'{g}.md'
    if not path.exists():
        return None
    text = path.read_text()
    statuses = []
    for line in text.splitlines():
        m = re.match(rf'^\|\s*({g}-\d+)\s*([^|]*)\|\s*([^|]+)\|\s*(.*?)\s*\|\s*$', line)
        if m:
            statuses.append(
                {'id': m.group(1), 'name': m.group(2).strip(), 'status': m.group(3).strip(),
                 'short': m.group(4).strip()})
    issues = []
    blocks = re.split(r'^(?=#### )', text, flags=re.M)
    for b in blocks:
        m = re.match(rf'^#### ({g}-F\d+)\s*\[(P\d)\]\s*(.+)$', b, flags=re.M)
        if not m:
            continue
        issue = {'id': m.group(1), 'prio': m.group(2), 'title': m.group(3).strip(), 'group': g}
        cur = None
        for line in b.splitlines()[1:]:
            fm = re.match(r'^- ([^:]+):\s*(.*)$', line)
            if fm and fm.group(1).strip() in FIELDS:
                cur = FIELDS[fm.group(1).strip()]
                issue[cur] = fm.group(2).strip()
            elif cur and line.strip() and not line.startswith('#'):
                issue[cur] = (issue.get(cur, '') + ' ' + line.strip()).strip()
        issues.append(issue)
    return {'statuses': statuses, 'issues': issues}


def files_of(issue):
    raw = issue.get('files', '')
    found = re.findall(r'(apps/[\w./\[\]()@-]+|packages/[\w./-]+|prisma/[\w./-]+|docs/[\w./-]+)', raw)
    return sorted({f.rstrip('.,;:)') for f in found})


def main():
    data = {g: parse_group(g) for g, _ in GROUPS}
    all_issues = [i for g, _ in GROUPS if data[g] for i in data[g]['issues']]
    order = {'P0': 0, 'P1': 1, 'P2': 2}
    all_issues.sort(key=lambda i: (order.get(i['prio'], 3), i['group'], i['id']))

    out = ['# Итоговый отчёт аудита', '']
    summary = ROOT / 'report_summary.md'
    out.append('## 1. Резюме')
    out.append('')
    out.append(summary.read_text().strip() if summary.exists() else '(резюме будет дописано)')
    out.append('')

    # Счётчики
    out += ['### Сводка по группам', '', '| Группа | Процессов | Работает | С проблемами | Сломан | P0 | P1 | P2 |',
            '|---|---|---|---|---|---|---|---|']
    tot = {'n': 0, 'ok': 0, 'warn': 0, 'bad': 0, 'P0': 0, 'P1': 0, 'P2': 0}
    for g, name in GROUPS:
        d = data[g]
        if not d:
            out.append(f'| {g} — {name} | — | — | — | — | — | — | — |')
            continue
        st = d['statuses']
        ok = sum(1 for s in st if s['status'].startswith('работает') and 'проблем' not in s['status'])
        warn = sum(1 for s in st if 'проблем' in s['status'])
        bad = sum(1 for s in st if s['status'].startswith('сломан'))
        cnt = {p: sum(1 for i in d['issues'] if i['prio'] == p) for p in ('P0', 'P1', 'P2')}
        out.append(f'| {g} — {name} | {len(st)} | {ok} | {warn} | {bad} | {cnt["P0"]} | {cnt["P1"]} | {cnt["P2"]} |')
        for k, v in (('n', len(st)), ('ok', ok), ('warn', warn), ('bad', bad)):
            tot[k] += v
        for p in ('P0', 'P1', 'P2'):
            tot[p] += cnt[p]
    out.append(f'| **Всего** | **{tot["n"]}** | **{tot["ok"]}** | **{tot["warn"]}** | **{tot["bad"]}** | '
               f'**{tot["P0"]}** | **{tot["P1"]}** | **{tot["P2"]}** |')
    out.append('')

    out += ['## 2. Процессы и статусы', '']
    for g, name in GROUPS:
        d = data[g]
        if not d:
            continue
        out += [f'### {g} — {name}', '', '| Процесс | Статус | Коротко |', '|---|---|---|']
        for s in d['statuses']:
            out.append(f'| {s["id"]} {s["name"]} | {s["status"]} | {s["short"]} |')
        out.append('')

    out += ['## 3. Проблемы', '']
    for p, title in (('P0', 'P0 — критично'), ('P1', 'P1 — важно'), ('P2', 'P2 — желательно')):
        sel = [i for i in all_issues if i['prio'] == p]
        out += [f'### {title} ({len(sel)})', '']
        for i in sel:
            out.append(f'#### {i["id"]} {i["title"]}')
            out.append(f'- Процесс: {i.get("process", "—")}')
            out.append(f'- Файлы: {i.get("files", "—")}')
            out.append(f'- Описание: {i.get("what", "—")}')
            out.append(f'- Решение: {i.get("fix", "—")}')
            out.append(f'- Стоп-точки: {i.get("stops", "—")}')
            out.append('')

    out += ['## 4. Рекомендуемый порядок исправлений', '',
            'Сначала все P0 (данные и доступ), затем P1 по группам, затем P2 пакетами по модулям. '
            'Задачи со стоп-точками («миграция», «контракт», «новая зависимость») выполняются с '
            'созданием миграции/изменения, но применение миграций к БД и изменение публичного '
            'контракта — через `.audit/QUESTIONS.md`. Детальная очередь — `.audit/TASKS.md`.', '']
    for p in ('P0', 'P1'):
        sel = [i for i in all_issues if i['prio'] == p]
        for n, i in enumerate(sel, 1):
            out.append(f'{n}. {i["prio"]} {i["id"]} — {i["title"]}')
        out.append('')

    # Итог фазы 3 пишется вручную в .audit/report_outcome.md и вставляется как есть.
    outcome = ROOT / 'report_outcome.md'
    if outcome.exists():
        out += ['## 5. Итог работ', '', outcome.read_text().strip(), '']

    (ROOT / 'AUDIT_REPORT.md').write_text('\n'.join(out) + '\n')
    (ROOT / 'tools' / 'issues.json').write_text(
        json.dumps([{**i, 'paths': files_of(i)} for i in all_issues], ensure_ascii=False, indent=1))
    print(json.dumps(tot, ensure_ascii=False))


if __name__ == '__main__':
    main()
