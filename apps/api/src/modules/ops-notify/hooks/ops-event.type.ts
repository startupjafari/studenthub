import type { OpsEventData, OpsEventName } from '../../../common/monitoring'

// Результат маппера вебхука (docs/TELEGRAM_BOT.md §7.3.3).
//
// Мапперы — чистые функции `payload → OpsEvent | null`: ни сети, ни БД, ни очереди. Отсюда
// и тестируемость на зафиксированном реальном payload'е, и невозможность уронить приём
// вебхука бизнес-логикой. `null` значит «это событие нас не касается» — таких большинство:
// внешние сервисы шлют всё подряд, а в канал попадает малая часть.

export interface OpsHookEvent {
  event: OpsEventName
  data: OpsEventData
}

/** Payload вебхука до разбора. Приходит извне — доверия ноль, отсюда `unknown`. */
export type HookPayload = Record<string, unknown>

/** Безопасный доступ к вложенному объекту: внешний payload может быть каким угодно. */
export function obj(source: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

/** Строковое поле или undefined. Числа приводим — id часто приезжают числами. */
export function str(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const value = (source as Record<string, unknown>)[key]
  if (typeof value === 'string') return value || undefined
  if (typeof value === 'number') return String(value)
  return undefined
}

/** Короткий SHA: в канале нужен префикс, а не сорок символов. */
export function shortSha(sha: string | undefined): string | undefined {
  return sha ? sha.slice(0, 7) : undefined
}
