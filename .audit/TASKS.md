# Задачи

Статусы: [todo] [in_progress] [done] [blocked]. Формат: ID · приоритет · процесс · файлы · критерий готовности.
Задачи, трогающие одни и те же файлы, помечены «после <ID>» — выполняются последовательно.

## Фаза 1 — инвентаризация

- [done] INV-A · группа A → .audit/processes/A.md
- [done] INV-B · группа B → .audit/processes/B.md
- [done] INV-C · группа C → .audit/processes/C.md
- [done] INV-D · группа D → .audit/processes/D.md
- [done] INV-E · группа E → .audit/processes/E.md
- [done] INV-F · группа F → .audit/processes/F.md

## Фаза 2 — аудит

Каждый агент читает `.audit/processes/<группа>.md`, проверяет процессы по коду и пишет
`.audit/findings/<группа>.md` (таблица статусов процессов + проблемы P0/P1/P2 со ссылками на строки).

- [in_progress] AUD-A · группа A → .audit/findings/A.md
- [done] AUD-B · группа B → .audit/findings/B.md
- [in_progress] AUD-C · группа C → .audit/findings/C.md
- [in_progress] AUD-D · группа D → .audit/findings/D.md
- [todo] AUD-E · группа E → .audit/findings/E.md
- [todo] AUD-F · группа F → .audit/findings/F.md

## Фаза 3 — исправления (появится после отчёта)
