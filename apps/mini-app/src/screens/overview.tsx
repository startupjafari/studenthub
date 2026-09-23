import { useCallback, useEffect, useState } from 'react'
import {
  fetchActivity,
  fetchHealth,
  fetchInvitesFunnel,
  fetchOverview,
  fetchChanges,
  fetchQueues,
  fetchStorage,
  fetchTopActions,
  fetchUniversitySizes,
  type ActivityGrid,
  type HealthReport,
  type InvitesFunnel,
  type PlatformOverview,
  type PlatformChange,
  type QueueCount,
  type StorageUsage,
  type TopAction,
  type UniversitySize,
} from '../api/overview'
import { t } from '../i18n'
import { Fold } from '../ui/fold'
import { formatShortTime } from '../lib/format'

// Сводка платформы: утренний взгляд «всё ли в порядке» до того, как открыть ноутбук.
//
// Здесь то, что читается с ладони: числа, форма кривой за последние дни, короткие списки
// и живость сервисов. Тепловая карта 7×24 читается силуэтом — где темно, там людей нет, —
// и отвечает на единственный вопрос, который задают с телефона рядом с рычагом техработ:
// когда платформу можно останавливать. Точные числа по часам остаются в вебе.

interface Extras {
  activity: ActivityGrid | null
  storage: StorageUsage | null
  changes: PlatformChange[]
  queues: QueueCount[]
  invites: InvitesFunnel | null
  universities: UniversitySize[]
  actions: TopAction[]
}

type State =
  | { status: 'loading' }
  | {
      status: 'ready'
      overview: PlatformOverview
      health: HealthReport | null
      extras: Extras
    }
  | { status: 'error' }

/** Сколько вузов показывать: список из сотни строк на телефоне не читают. */
const TOP_UNIVERSITIES = 5
const TOP_ACTIONS = 5

const HEALTH_LABEL = {
  database: 'healthDatabase',
  redis: 'healthRedis',
  minio: 'healthStorage',
} as const

export function OverviewScreen() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      // Разрезы и живость читаются параллельно, и отказ любого из них не ломает сводку:
      // главные числа обязаны показаться, даже если один агрегат не посчитался. Недоступный
      // /health — сам по себе ответ, а не причина прятать всё остальное.
      const [overview, health, invites, universities, actions, queues, storage, changes, activity] =
        await Promise.all([
          fetchOverview(),
          fetchHealth().catch(() => null),
          fetchInvitesFunnel().catch(() => null),
          fetchUniversitySizes().catch(() => []),
          fetchTopActions().catch(() => []),
          fetchQueues().catch(() => []),
          fetchStorage().catch(() => null),
          fetchChanges().catch(() => []),
          fetchActivity().catch(() => null),
        ])
      setState({
        status: 'ready',
        overview,
        health,
        extras: { invites, universities, actions, queues, storage, changes, activity },
      })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'loading') {
    return (
      <section className="card">
        <h2>{t('overviewTitle')}</h2>
        <p className="hint">{t('controlReading')}</p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="card">
        <h2>{t('overviewTitle')}</h2>
        <p className="hint">{t('overviewError')}</p>
        <button type="button" className="fallback-submit" onClick={() => void load()}>
          {t('retry')}
        </button>
      </section>
    )
  }

  const { overview, health, extras } = state

  return (
    <>
      {/* Живость сервисов — первым блоком. Сводку открывают утром с одним вопросом:
          всё ли работает. Внизу, под тепловой картой и журналом изменений, ответ лежал
          дальше, чем этот вопрос задают. */}
      {health && (
        <section className="card">
          <h2>{t('healthTitle')}</h2>
          <div className="list">
            {(Object.keys(HEALTH_LABEL) as (keyof HealthReport)[]).map((key) => (
              <div className="toggle-row" key={key}>
                <span>{t(HEALTH_LABEL[key])}</span>
                <span className={health[key] === 'ok' ? 'toggle-state' : 'toggle-state off'}>
                  {health[key] === 'ok' ? t('healthOk') : t('healthFail')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>{t('overviewTitle')}</h2>
        <p className="hint">{t('overviewHint')}</p>
        <div className="stats">
          <Stat label={t('overviewUniversities')} value={overview.universities.active} />
          <Stat label={t('overviewUsers')} value={overview.users.total} />
          <Stat label={t('overviewDau')} value={overview.activeUsers.dau} />
          <Stat label={t('overviewWau')} value={overview.activeUsers.wau} />
          <Stat label={t('overviewComplaints')} value={overview.complaints.pending} />
        </div>
      </section>

      {/* Спарклайн по тем же данным, что уже приехали со сводкой: отдельного запроса
          «рост пользователей» не нужно, а форма кривой отвечает на «растём ли мы»
          быстрее любого числа. */}
      {overview.users.spark.length > 1 && (
        <section className="card">
          <h2>{t('overviewTrend')}</h2>
          <Spark points={overview.users.spark} label={t('overviewUsers')} />
          <Spark points={overview.complaints.spark} label={t('overviewComplaints')} />
        </section>
      )}

      {extras.invites && extras.invites.total > 0 && (
        <section className="card">
          <h2>{t('overviewInvites')}</h2>
          <p className="hint">
            {t('overviewInvitesUsed', {
              used: extras.invites.used,
              total: extras.invites.total,
              conversion: Math.round(extras.invites.conversion),
            })}
          </p>
        </section>
      )}

      {extras.universities.length > 0 && (
        <Fold title={t('overviewTopUniversities')} state={String(extras.universities.length)}>
          <div className="list">
            {[...extras.universities]
              .sort((a, b) => b.total - a.total)
              .slice(0, TOP_UNIVERSITIES)
              .map((university) => (
                <div className="toggle-row" key={university.id}>
                  <span>{university.name}</span>
                  <span className="toggle-state">
                    {university.students.toLocaleString()} {t('overviewStudents')}
                  </span>
                </div>
              ))}
          </div>
        </Fold>
      )}

      {extras.actions.length > 0 && (
        <Fold title={t('overviewTopActions')}>
          <div className="list">
            {extras.actions.slice(0, TOP_ACTIONS).map((action) => (
              <div className="toggle-row" key={action.action}>
                {/* Машинный код действия — он же и в журнале аудита: свой перевод
                    развёл бы два названия одного события. */}
                <span className="mono">{action.action}</span>
                <span className="toggle-state">{action.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Fold>
      )}

      {/* Очереди показываем только когда в них что-то есть: пустая таблица нулей
          каждое утро приучает не смотреть на этот блок вовсе. */}
      {extras.queues.some((queue) => queue.waiting > 0 || queue.failed > 0) && (
        <Fold
          title={t('queuesTitle')}
          state={t('queuesWaiting', {
            count: extras.queues.reduce((sum, queue) => sum + queue.waiting, 0),
          })}
        >
          <div className="list">
            {extras.queues
              .filter((queue) => queue.waiting > 0 || queue.failed > 0)
              .map((queue) => (
                <div className="toggle-row" key={queue.name}>
                  <span className="mono">{queue.name}</span>
                  <span className={queue.failed > 0 ? 'toggle-state off' : 'toggle-state'}>
                    {queue.failed > 0
                      ? t('queuesFailed', { count: queue.failed })
                      : t('queuesWaiting', { count: queue.waiting })}
                  </span>
                </div>
              ))}
          </div>
        </Fold>
      )}

      {extras.storage && (
        <Fold title={t('storageTitle')} state={formatBytes(extras.storage.bytes)}>
          <p className="hint">
            {t('storageUsed', {
              files: extras.storage.files.toLocaleString(),
              size: formatBytes(extras.storage.bytes),
            })}
          </p>
        </Fold>
      )}

      {extras.activity && extras.activity.max > 0 && <ActivityCard grid={extras.activity} />}

      {/* Кто двигал рычаги: без ответа на «кто включил техработы» команда жить не может,
          а публичное состояние его не отдаёт — посетителю знать незачем. */}
      {extras.changes.length > 0 && (
        <Fold title={t('changesTitle')}>
          <div className="list">
            {extras.changes.slice(0, 5).map((change) => (
              <div className="toggle-row" key={`${change.action}-${change.at}`}>
                <span className="mono">{change.action}</span>
                <span className="toggle-state">
                  {t('changesBy', {
                    who: change.by ? change.by.firstName : t('changesNobody'),
                    when: formatShortTime(change.at),
                  })}
                </span>
              </div>
            ))}
          </div>
        </Fold>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <b>{value.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  )
}

/**
 * Спарклайн: форма важнее значений, поэтому ни осей, ни подписей. Рисуется SVG, а не
 * библиотекой графиков — кривая из десяти точек не стоит двухсот килобайт в бандле,
 * который открывают по мобильной сети.
 */
function Spark({ points, label }: { points: number[]; label: string }) {
  const max = Math.max(...points, 1)
  const step = 100 / Math.max(points.length - 1, 1)
  const path = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${index * step} ${30 - (value / max) * 28}`)
    .join(' ')

  return (
    <div className="spark-row">
      <span className="hint">{label}</span>
      <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
        <path d={path} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="hint">{points.at(-1)?.toLocaleString() ?? 0}</span>
    </div>
  )
}

/** Байты в человеческий вид. Точность до десятых: «1.4 ГБ» читается, «1.42 ГБ» — нет. */
function formatBytes(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * Активность по дням недели и часам.
 *
 * На ладони её читают не по числам, а по силуэту: где темно — там людей нет, и именно туда
 * ставят техработы. Поэтому здесь нет ни осей с цифрами, ни подписи каждого часа — только
 * сетка, засечки в полночь, шесть, полдень и шесть вечера, и буква дня слева.
 *
 * Плотность считается от самой горячей клетки недели, а не от абсолютного числа: в тихую
 * неделю карта иначе была бы равномерно чёрной и не отвечала бы ни на что.
 */
function ActivityCard({ grid }: { grid: ActivityGrid }) {
  const days = [
    t('dayMon'),
    t('dayTue'),
    t('dayWed'),
    t('dayThu'),
    t('dayFri'),
    t('daySat'),
    t('daySun'),
  ]

  return (
    <Fold title={t('activityTitle')}>
      <p className="hint">{t('activityHint')}</p>
      <div className="heatmap">
        {grid.cells.map((hours, dow) => (
          <div className="heatmap-row" key={dow}>
            <span className="heatmap-day">{days[dow]}</span>
            {hours.map((value, hour) => (
              <span
                key={hour}
                className="heatmap-cell"
                // Ноль оставляем видимым контуром, а не пустотой: пропуск в сетке
                // читался бы как «данных нет», а это «здесь никого не было».
                style={{ opacity: value === 0 ? 0.08 : 0.2 + (0.8 * value) / grid.max }}
                aria-hidden
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-scale">
        <span>{t('activityMidnight')}</span>
        <span>{t('activityNoon')}</span>
        <span>{t('activityEvening')}</span>
      </div>
    </Fold>
  )
}
