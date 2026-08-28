// Реестр служебных событий (docs/TELEGRAM_BOT.md §4.2) — единственное место, где событие
// заводится. Добавить событие = добавить строку сюда и вызвать `OpsNotifier.emit()`.
//
// Почему реестр, а не «ещё один вызов send() где-то в коде»: тема, дедупликация и порог
// троттлинга должны быть видны одним списком. Иначе через полгода на вопрос «почему канал
// звенит» придётся читать весь бэкенд.

/** Темы супергруппы (§3.1). ID тем — в переменных окружения, здесь только смысл. */
export type OpsTopic = 'deploy' | 'alerts' | 'digest'

/** Статус определяет эмодзи первой строки (§4.4) и проходимость сквозь тишину (§3.5). */
export type OpsStatus = 'ok' | 'error' | 'warn' | 'info'

/** Поле второй строки: `label: value` либо просто `value`, если подпись не нужна. */
export interface OpsField {
  label?: string
  field: string
}

/** Кнопка-ссылка (§3.4). `field` — поле данных с URL; не URL — кнопки не будет. */
export interface OpsLink {
  label: string
  field: string
}

/** Потолок частоты события независимо от ключа дедупликации. */
export interface OpsThrottle {
  max: number
  windowSec: number
}

export interface OpsEventSpec {
  topic: OpsTopic
  status: OpsStatus
  /** Первая строка после эмодзи. Поддерживает подстановку `{поле}` из данных события. */
  title: string
  fields?: readonly OpsField[]
  links?: readonly OpsLink[]
  /**
   * Поля, образующие ключ дедупликации. Повтор с тем же ключом в пределах `dedupeTtl`
   * не отправляется. Пустой список = ключ по одному имени события.
   */
  dedupe?: readonly string[]
  /** Окно дедупликации в секундах. 0 или не задано — дедупликации нет. */
  dedupeTtl?: number
  throttle?: OpsThrottle
  /** Доставить без звука: старт инстанса и правки статуса будить никого не должны. */
  silent?: boolean
  /**
   * Поле данных, по значению которого сообщение считается «тем же» и переписывается,
   * а не отправляется заново (§3.2). Так на релиз в канале остаётся одна строка вместо трёх:
   * 🟡 «деплой начался» превращается в 🟢 или 🔴 правкой.
   */
  editKey?: string
}

export const OPS_EVENTS = {
  // Старт инстанса. Он же «тестовое событие» при первой настройке бота: задал токен —
  // перезапустил API — увидел строку в теме «Деплой».
  // Дедупликация по версии на 5 минут гасит рестарт-шторм: в цикле падений нужен один
  // сигнал, а не сорок.
  appStarted: {
    topic: 'deploy',
    status: 'info',
    title: 'API запущен',
    fields: [{ label: 'версия', field: 'release' }],
    dedupe: ['release'],
    dedupeTtl: 300,
    silent: true,
  },

  // ─── Инциденты (§2.2) ─────────────────────────────────────────────────────────────
  //
  // События смены состояния (`*Recovered`, `*Up`) намеренно без дедупликации: гистерезис
  // в `OpsPolicyService.transitioned` уже гарантирует одно сообщение на смену состояния,
  // а окно дедупликации поверх него проглотило бы «выздоровление» после долгой аварии.

  // Самая дешёвая проверка с самой высокой отдачей: расхождение репозитория и БД на проде
  // проявилось бы только рантайм-ошибкой. Сутки дедупликации — рестарт-шторм не должен
  // повторять один и тот же список.
  migrationsPending: {
    topic: 'alerts',
    status: 'error',
    title: 'Неприменённые миграции: {count}',
    fields: [{ field: 'names' }],
    dedupe: ['names'],
    dedupeTtl: 86_400,
  },
  cronFailed: {
    topic: 'alerts',
    status: 'error',
    title: 'Cron-задача {job} упала',
    fields: [
      { label: 'ошибка', field: 'error' },
      { label: 'sentry', field: 'sentryEventId' },
    ],
    dedupe: ['job'],
    dedupeTtl: 600,
  },
  // Тишина задачи — такой же инцидент, как исключение, хотя ошибки не было (§2.2).
  cronSilent: {
    topic: 'alerts',
    status: 'warn',
    title: 'Cron-задача {job} молчит',
    fields: [
      { label: 'последний запуск', field: 'lastRun' },
      { label: 'период', field: 'period' },
    ],
  },
  cronResumed: {
    topic: 'alerts',
    status: 'ok',
    title: 'Cron-задача {job} снова идёт по расписанию',
  },
  queueBacklog: {
    topic: 'alerts',
    status: 'warn',
    title: 'Очередь {queue} копится: {waiting} в ожидании',
    dedupe: ['queue'],
    dedupeTtl: 1800,
  },
  queueFailing: {
    topic: 'alerts',
    status: 'warn',
    title: 'В очереди {queue} растут падения: {failed}',
    fields: [{ label: 'последняя', field: 'lastError' }],
    dedupe: ['queue'],
    dedupeTtl: 1800,
  },
  dependencyDown: {
    topic: 'alerts',
    status: 'error',
    title: 'Зависимость {name} недоступна',
    fields: [{ label: 'причина', field: 'reason' }],
  },
  dependencyUp: {
    topic: 'alerts',
    status: 'ok',
    title: 'Зависимость {name} снова отвечает',
  },
  publicUrlDown: {
    topic: 'alerts',
    status: 'error',
    title: 'Приложение недоступно снаружи',
    fields: [{ field: 'url' }, { label: 'причина', field: 'reason' }],
  },
  publicUrlUp: {
    topic: 'alerts',
    status: 'ok',
    title: 'Приложение снова отвечает снаружи',
    fields: [{ field: 'url' }],
  },

  // ─── Релизы и код (§2.1) ──────────────────────────────────────────────────────────
  //
  // Три события деплоя делят один `editKey`: сообщение отправляется на старте и дважды
  // переписывается. Дедупликации у них нет намеренно — каждое обязано изменить строку.
  deployStarted: {
    topic: 'deploy',
    status: 'warn',
    title: 'Деплой {service} начался',
    fields: [{ label: 'ветка', field: 'branch' }, { field: 'sha' }, { field: 'author' }],
    links: [{ label: 'Логи Railway', field: 'logsUrl' }],
    editKey: 'deploymentId',
    silent: true,
  },
  deploySucceeded: {
    topic: 'deploy',
    status: 'ok',
    title: 'Деплой {service} прошёл',
    fields: [{ label: 'ветка', field: 'branch' }, { field: 'sha' }, { field: 'author' }],
    links: [{ label: 'Логи Railway', field: 'logsUrl' }],
    editKey: 'deploymentId',
    silent: true,
  },
  deployFailed: {
    topic: 'deploy',
    status: 'error',
    title: 'Деплой {service} — упал',
    fields: [{ label: 'ветка', field: 'branch' }, { field: 'sha' }, { field: 'author' }],
    links: [{ label: 'Логи Railway', field: 'logsUrl' }],
    editKey: 'deploymentId',
  },
  // Что уехало на прод. Отдельным сообщением, а не строкой в 🟢: список коммитов длинный,
  // а первая строка релиза должна оставаться читаемой в списке чатов.
  deployChangelog: {
    topic: 'deploy',
    status: 'info',
    title: 'Уехало на прод: {count} коммитов',
    fields: [{ field: 'commits' }],
    links: [{ label: 'Сравнение', field: 'compareUrl' }],
    silent: true,
  },
  ciFailed: {
    topic: 'deploy',
    status: 'error',
    title: 'CI упал на шаге «{step}»',
    fields: [{ label: 'ветка', field: 'branch' }, { field: 'sha' }],
    links: [{ label: 'Прогон', field: 'runUrl' }],
    // Не дедупликация, а правка: сообщение уходит сразу по вебхуку, а затем переписывается,
    // когда у GitHub дочитан упавший шаг. Повторный одинаковый вебхук правкой ничего
    // не меняет и нового сообщения не создаёт.
    editKey: 'runId',
  },
  // Новая группа ошибок из Sentry. Дедупликация по группе: всплеск одной и той же ошибки
  // не должен превращаться в ленту — на то она и группа.
  sentryIssue: {
    topic: 'alerts',
    status: 'error',
    title: '{title}',
    fields: [{ label: 'событий', field: 'count' }],
    links: [{ label: 'Sentry', field: 'issueUrl' }],
    dedupe: ['issueId'],
    dedupeTtl: 3600,
  },
  // Для нерегулярных релизов это единственное напоминание, что накопилось (§2.1).
  branchDrift: {
    topic: 'digest',
    status: 'warn',
    title: '{head} опережает {base} на {ahead} коммитов',
    fields: [{ label: 'последний релиз', field: 'lastRelease' }],
    links: [{ label: 'Сравнение', field: 'compareUrl' }],
    silent: true,
  },

  // ─── Безопасность (§2.4) ──────────────────────────────────────────────────────────
  //
  // В обоих событиях только агрегаты: логинов, ФИО и email здесь нет и быть не может.
  // Число различных IP — признак перебора, а не персональные данные пользователя.
  authFailureSpike: {
    topic: 'alerts',
    status: 'warn',
    title: 'Всплеск отказов авторизации: {total} за {window}',
    fields: [
      { label: 'разных IP', field: 'ips' },
      { label: 'из них throttler', field: 'throttled' },
    ],
    dedupe: [],
    dedupeTtl: 1800,
  },
  adminActions: {
    topic: 'alerts',
    status: 'info',
    title: 'Действия в админке: {count}',
    fields: [{ field: 'actions' }, { label: 'например', field: 'sample' }],
  },

  // Тишина на время работ (§3.5).
  quietStarted: {
    topic: 'alerts',
    status: 'warn',
    title: 'Тишина включена до {until}',
    fields: [{ label: 'проходят только', field: 'passes' }],
    silent: true,
  },
  quietEnded: {
    topic: 'alerts',
    status: 'info',
    title: 'Тишина снята',
    fields: [{ label: 'за время тишины', field: 'summary' }],
  },
} as const satisfies Record<string, OpsEventSpec>

export type OpsEventName = keyof typeof OPS_EVENTS

/** Спека события. Отдельная функция, чтобы вызывающие не индексировали реестр вручную. */
export function opsEventSpec(name: OpsEventName): OpsEventSpec {
  return OPS_EVENTS[name]
}
