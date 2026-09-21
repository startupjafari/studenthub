import { useCallback, useEffect, useState } from 'react'
import {
  fetchHealth,
  fetchInvitesFunnel,
  fetchOverview,
  fetchQueues,
  fetchTopActions,
  fetchUniversitySizes,
  type HealthReport,
  type InvitesFunnel,
  type PlatformOverview,
  type QueueCount,
  type TopAction,
  type UniversitySize,
} from '../api/overview'
import { t } from '../i18n'

// Сводка платформы: утренний взгляд «всё ли в порядке» до того, как открыть ноутбук.
//
// Здесь то, что читается с ладони: числа, форма кривой за последние дни, короткие списки
// и живость сервисов. Тепловая карта активности 7×24 сюда не попала, хотя ручка для неё
// есть: на телефоне она превращается в картинку, по которой ничего не решить. Разрезы,
// требующие сравнения и масштаба, остаются в вебе.

interface Extras {
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
      const [overview, health, invites, universities, actions, queues] = await Promise.all([
        fetchOverview(),
        fetchHealth().catch(() => null),
        fetchInvitesFunnel().catch(() => null),
        fetchUniversitySizes().catch(() => []),
        fetchTopActions().catch(() => []),
        fetchQueues().catch(() => []),
      ])
      setState({
        status: 'ready',
        overview,
        health,
        extras: { invites, universities, actions, queues },
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
        <section className="card">
          <h2>{t('overviewTopUniversities')}</h2>
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
        </section>
      )}

      {extras.actions.length > 0 && (
        <section className="card">
          <h2>{t('overviewTopActions')}</h2>
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
        </section>
      )}

      {/* Очереди показываем только когда в них что-то есть: пустая таблица нулей
          каждое утро приучает не смотреть на этот блок вовсе. */}
      {extras.queues.some((queue) => queue.waiting > 0 || queue.failed > 0) && (
        <section className="card">
          <h2>{t('queuesTitle')}</h2>
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
        </section>
      )}

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
