import { useCallback, useEffect, useState } from 'react'
import {
  fetchHealth,
  fetchOverview,
  type HealthReport,
  type PlatformOverview,
} from '../api/overview'
import { t } from '../i18n'

// Сводка платформы: утренний взгляд «всё ли в порядке» до того, как открыть ноутбук.
//
// Здесь только числа, отвечающие на этот вопрос, и живость сервисов. Графики, разрезы по
// вузам и воронки остаются в вебе — на экране шириной с ладонь они превращаются в
// картинку, по которой ничего не решить.

type State =
  | { status: 'loading' }
  | { status: 'ready'; overview: PlatformOverview; health: HealthReport | null }
  | { status: 'error' }

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
      // Живость читается параллельно и её отказ не ломает сводку: недоступный /health —
      // сам по себе ответ, а не причина не показывать числа.
      const [overview, health] = await Promise.all([
        fetchOverview(),
        fetchHealth().catch(() => null),
      ])
      setState({ status: 'ready', overview, health })
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

  const { overview, health } = state

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
