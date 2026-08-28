import { obj, shortSha, str, type HookPayload, type OpsHookEvent } from './ops-event.type'

// Вебхук Railway → событие деплоя (docs/TELEGRAM_BOT.md §2.1, T-7).
//
// Одно сообщение на релиз, а не три: все три статуса делят `deploymentId` как `editKey`,
// и воркер переписывает ту же строку (§3.2).
//
// Payload Railway описан нестрого и менялся между версиями, поэтому читаем защитно: нет
// поля — нет строки в сообщении, а не исключение на приёме вебхука.

/** Промежуточные статусы: деплой идёт. Все они дают одно и то же 🟡. */
const IN_PROGRESS = new Set(['QUEUED', 'INITIALIZING', 'BUILDING', 'DEPLOYING', 'WAITING'])
const FAILED = new Set(['FAILED', 'CRASHED'])

export function mapRailwayHook(payload: HookPayload): OpsHookEvent | null {
  const status = str(payload, 'status')?.toUpperCase()
  if (!status) return null

  const event =
    status === 'SUCCESS'
      ? 'deploySucceeded'
      : FAILED.has(status)
        ? 'deployFailed'
        : IN_PROGRESS.has(status)
          ? 'deployStarted'
          : null
  // REMOVED, SLEEPING и прочее — не про релиз, в канал не идут.
  if (!event) return null

  const deployment = obj(payload, 'deployment')
  const meta = obj(deployment, 'meta')
  const deploymentId = str(deployment, 'id')
  if (!deploymentId) return null

  return {
    event,
    data: {
      deploymentId,
      service: str(obj(payload, 'service'), 'name') ?? 'api',
      // Ветка и коммит приезжают в meta развёртывания; на ручном деплое их нет.
      ...optional('branch', str(meta, 'branch')),
      ...optional('sha', shortSha(str(meta, 'commitHash'))),
      ...optional('author', str(obj(deployment, 'creator'), 'name')),
      ...optional('fullSha', str(meta, 'commitHash')),
      ...optional('logsUrl', deployUrl(payload, deploymentId)),
    },
  }
}

/** Поле с пустым значением в сообщение не идёт — билдер пропустит, но и data чище. */
function optional(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {}
}

/**
 * Ссылка на логи — то, что нужно в 90% разборов (§2.1). Railway не присылает её готовой,
 * но адрес детерминирован по id проекта, окружения и сервиса.
 */
function deployUrl(payload: HookPayload, deploymentId: string): string | undefined {
  const projectId = str(obj(payload, 'project'), 'id')
  const environmentId = str(obj(payload, 'environment'), 'id')
  const serviceId = str(obj(payload, 'service'), 'id')
  if (!projectId || !environmentId || !serviceId) return undefined
  return `https://railway.app/project/${projectId}/service/${serviceId}?environmentId=${environmentId}&id=${deploymentId}`
}
