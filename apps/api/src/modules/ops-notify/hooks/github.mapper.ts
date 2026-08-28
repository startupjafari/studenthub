import { obj, shortSha, str, type HookPayload, type OpsHookEvent } from './ops-event.type'

// Вебхук GitHub Actions → упавший CI (docs/TELEGRAM_BOT.md §2.1, T-8).
//
// Важна не красная галочка, а ШАГ: `lint`, `typecheck`, `test (unit)`, `test (e2e)` или
// `build` — по нему сразу понятно, чинить код или инфраструктуру. Из вебхука известен
// только прогон целиком; конкретный шаг дочитывает `GithubApiService` уже в воркере,
// потому что маппер обязан остаться чистой функцией (§7.3.3).
//
// Успешные прогоны и промежуточные состояния в канал не идут: зелёный CI — это норма,
// а о норме служебный канал молчит.

export function mapGithubHook(payload: HookPayload): OpsHookEvent | null {
  const run = obj(payload, 'workflow_run')
  if (!run) return null
  if (str(payload, 'action') !== 'completed') return null
  if (str(run, 'conclusion') !== 'failure') return null

  const runId = str(run, 'id')
  if (!runId) return null

  return {
    event: 'ciFailed',
    data: {
      runId,
      // Пока — имя workflow. Воркер уточнит его до имени упавшего шага, если задан токен.
      step: str(run, 'name') ?? 'CI',
      ...optional('branch', str(run, 'head_branch')),
      ...optional('sha', shortSha(str(run, 'head_sha'))),
      ...optional('runUrl', str(run, 'html_url')),
    },
  }
}

function optional(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {}
}
