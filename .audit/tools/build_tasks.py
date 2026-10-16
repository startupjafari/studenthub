#!/usr/bin/env python3
"""Задачи фазы 3 из .audit/tools/issues.json (его пишет build_report.py).

P0 и P1 — по задаче на проблему. P2 — пакетами по модулю (до 4 проблем). Если задача трогает
файл, который уже трогает более ранняя задача, она помечается «после <ID>»: такие задачи
выполняются последовательно, параллельно — только непересекающиеся по файлам.
Печатает markdown для раздела «Фаза 3» в TASKS.md.
"""
import json
import re
from pathlib import Path

issues = json.loads(Path('.audit/tools/issues.json').read_text())


def module_of(path):
    m = re.match(r'apps/api/src/modules/([\w-]+)', path)
    if m:
        return 'api:' + m.group(1)
    m = re.match(r'apps/api/src/common/([\w-]+)', path)
    if m:
        return 'api-common:' + m.group(1)
    m = re.match(r'apps/web/src/(\w+)/([\w-]+)', path)
    if m:
        return f'web:{m.group(1)}/{m.group(2)}'
    m = re.match(r'(prisma|packages|docs)/([\w-]+)', path)
    if m:
        return f'{m.group(1)}:{m.group(2)}'
    return 'other'


def stops_of(i):
    s = i.get('stops', '').lower()
    out = []
    if 'миграц' in s:
        out.append('миграция')
    if 'контракт' in s:
        out.append('контракт')
    if 'зависим' in s:
        out.append('зависимость')
    return out


tasks = []
for i in issues:
    if i['prio'] in ('P0', 'P1'):
        tasks.append({'id': f'FIX-{i["id"]}', 'prio': i['prio'], 'issues': [i['id']],
                      'paths': set(i['paths']), 'stops': set(stops_of(i)),
                      'title': i['title']})

# P2 — пакеты по (группа, основной модуль)
batches = {}
for i in issues:
    if i['prio'] != 'P2':
        continue
    key = (i['group'], module_of(i['paths'][0]) if i['paths'] else 'other')
    batches.setdefault(key, []).append(i)
for (g, mod), items in sorted(batches.items()):
    for n in range(0, len(items), 4):
        chunk = items[n:n + 4]
        tid = f'P2-{g}-{mod.split(":")[-1].replace("/", "-")}' + (f'-{n // 4 + 1}' if len(items) > 4 else '')
        tasks.append({'id': tid, 'prio': 'P2', 'issues': [c['id'] for c in chunk],
                      'paths': set(p for c in chunk for p in c['paths']),
                      'stops': set(s for c in chunk for s in stops_of(c)),
                      'title': '; '.join(c['title'] for c in chunk)})

# Последовательность по пересечению файлов
lines = []
for idx, t in enumerate(tasks):
    before = [o['id'] for o in tasks[:idx] if o['paths'] & t['paths']]
    dep = f' · после: {", ".join(before[-3:])}' if before else ''
    stop = f' · стоп: {", ".join(sorted(t["stops"]))}' if t['stops'] else ''
    files = ', '.join(sorted(t['paths']))
    lines.append(f'- [todo] {t["id"]} · {t["prio"]} · проблемы: {", ".join(t["issues"])}{dep}{stop}\n'
                 f'  - Суть: {t["title"]}\n'
                 f'  - Файлы: {files}\n'
                 f'  - Готово, когда: исправлено по «Решение» из AUDIT_REPORT.md для {", ".join(t["issues"])}; '
                 f'связанные тесты и eslint зелёные; на сценарий добавлен тест, где это возможно.')
print('\n'.join(lines))
print(f'\n<!-- задач: {len(tasks)}; P0/P1: {sum(1 for t in tasks if t["prio"] != "P2")}; '
      f'P2-пакетов: {sum(1 for t in tasks if t["prio"] == "P2")} -->')
