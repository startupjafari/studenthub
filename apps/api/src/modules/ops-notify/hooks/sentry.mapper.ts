import { obj, str, type HookPayload, type OpsHookEvent } from './ops-event.type'

// Вебхук Sentry → новая группа ошибок (docs/TELEGRAM_BOT.md §2.2, T-7).
//
// В канал идёт ТИП исключения и текст ошибки — технические строки, а не содержимое
// запроса пользователя. Сам payload Sentry возит и стектрейсы, и фрагменты данных, поэтому
// берём ровно три поля и ничего «на всякий случай» (§0.1.1); остальное режет санитайзер.
//
// Дедупликация по `issueId` в реестре: всплеск одной и той же ошибки — это одна группа
// и одно сообщение, иначе канал заливает лентой.

export function mapSentryHook(payload: HookPayload): OpsHookEvent | null {
  const action = str(payload, 'action')
  // Интересует появление и возврат проблемы. `resolved`/`assigned`/`ignored` — работа
  // в трекере, о ней в служебном чате знать незачем.
  if (action && !['created', 'triggered', 'regression', 'unresolved'].includes(action)) {
    return null
  }

  const data = obj(payload, 'data')
  const issue = obj(data, 'issue') ?? obj(payload, 'issue')
  if (!issue) return null

  const issueId = str(issue, 'id')
  if (!issueId) return null

  return {
    event: 'sentryIssue',
    data: {
      issueId,
      // metadata.value — текст исключения, title — «Тип: текст». Берём title, он читается.
      title: str(issue, 'title') ?? str(obj(issue, 'metadata'), 'type') ?? 'Ошибка в Sentry',
      ...(str(issue, 'count') ? { count: str(issue, 'count') as string } : {}),
      ...(issueUrl(issue) ? { issueUrl: issueUrl(issue) as string } : {}),
    },
  }
}

/** Ссылка на группу: `web_url` есть в новых версиях, `permalink` — в старых. */
function issueUrl(issue: Record<string, unknown>): string | undefined {
  return str(issue, 'web_url') ?? str(issue, 'permalink') ?? str(issue, 'url')
}
