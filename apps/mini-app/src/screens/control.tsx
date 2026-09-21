import { useCallback, useEffect, useState } from 'react'
import {
  announceRelease,
  fetchPlatformState,
  setBanner,
  setMaintenance,
  setSections,
  BANNER_PRESETS,
  SECTIONS,
  type PlatformState,
} from '../api/platform'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { t } from '../i18n'
import { locale } from '../i18n'
import { formatDateTime } from '../lib/format'

// Пульт платформы: то, чем админ управляет вебом, не открывая ноутбук.
//
// Экран собран вокруг одного ограничения — это телефон. Поэтому здесь нет ни одного поля
// свободного текста, кроме номера версии и кода подтверждения: сроки и формулировки
// выбираются тапом. Объявление обязано существовать на трёх языках, и набирать их с
// телефона никто не станет — потому вместо поля ввода готовые заготовки.
//
// Каждое действие проходит через нативное подтверждение Telegram: рычаги здесь меняют то,
// что видят все пользователи платформы, и промах по экрану не должен этого делать.

const MAINTENANCE_MINUTES = [15, 30, 60, 120]
const BANNER_PERIODS = [
  { minutes: 60, key: 'bannerPeriodHour' },
  { minutes: 60 * 24, key: 'bannerPeriodDay' },
  { minutes: 60 * 24 * 3, key: 'bannerPeriod3Days' },
] as const

type Load = { status: 'loading' } | { status: 'ready'; state: PlatformState } | { status: 'error' }

export function ControlScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoad({ status: 'loading' })
    try {
      setLoad({ status: 'ready', state: await fetchPlatformState() })
    } catch {
      setLoad({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * Общий путь для всех рычагов: спросить → выполнить → показать новое состояние.
   * Ответ сервера и есть новое состояние, поэтому перезапрашивать его незачем.
   */
  const run = useCallback(
    async (question: string, action: () => Promise<PlatformState>) => {
      if (busy) return
      if (!(await confirmAction(question))) return

      setBusy(true)
      setError(null)
      try {
        const state = await action()
        haptic.success()
        setLoad({ status: 'ready', state })
      } catch (err) {
        // Текст берём из ответа: сервер уже объяснил отказ по-человечески («Неверный код
        // подтверждения»), и подменять его своей формулировкой значило бы врать о причине.
        setError(err instanceof ApiError ? err.message : t('controlApplyError'))
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  if (load.status === 'loading') return <Head hint={t('controlReading')} />
  if (load.status === 'error') {
    return (
      <div className="screen">
        <Head hint={t('controlSubtitle')} />
        <section className="card">
          <p>{t('controlReadError')}</p>
          <button type="button" className="fallback-submit" onClick={() => void reload()}>
            {t('retry')}
          </button>
        </section>
      </div>
    )
  }

  const { state } = load

  return (
    <div className="screen">
      <Head hint={t('controlSubtitle')} />

      {error && (
        <section className="card">
          <p className="hint-danger">{error}</p>
        </section>
      )}

      <MaintenanceCard state={state} busy={busy} run={run} />
      <BannerCard state={state} busy={busy} run={run} />
      <SectionsCard state={state} busy={busy} run={run} />
      <ReleaseCard state={state} busy={busy} run={run} />
    </div>
  )
}

type Run = (question: string, action: () => Promise<PlatformState>) => Promise<void>

function MaintenanceCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const [code, setCode] = useState('')
  const [minutes, setMinutes] = useState<number | null>(null)
  const active = state.maintenance

  return (
    <section className="card">
      <h2>{active ? t('maintenanceOnTitle') : t('maintenanceOffTitle')}</h2>
      <p className="hint">
        {active
          ? t('maintenanceOnHint', { until: formatDateTime(active.until) })
          : t('maintenanceOffHint')}
      </p>

      {active && (
        <button
          type="button"
          className="fallback-submit"
          disabled={busy}
          onClick={() => void run(t('maintenanceConfirmOff'), () => setMaintenance(null))}
        >
          {t('maintenanceDisable')}
        </button>
      )}

      {/* Продление — тот же путь, что включение, и код 2FA нужен так же: платформа
          остаётся остановленной дольше, а это ровно то действие, которое защищали. */}
      <div className="chips">
        {MAINTENANCE_MINUTES.map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={minutes === value}
            disabled={busy}
            onClick={() => {
              haptic.select()
              setMinutes(value)
            }}
          >
            {t('maintenanceMinutes', { count: value })}
          </button>
        ))}
      </div>

      {/* Код 2FA — одно из двух мест в мини-аппе, где что-то набирают: остановка
          платформы не должна быть возможна одним промахом по экрану. */}
      <input
        className="field"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder={t('maintenanceCodePlaceholder')}
        value={code}
        onChange={(e) => setCode(e.target.value.trim())}
      />
      <button
        type="button"
        className="fallback-submit danger"
        disabled={busy || minutes === null || code.length < 6}
        onClick={() =>
          void run(
            active
              ? t('maintenanceConfirmExtend', { count: minutes ?? 0 })
              : t('maintenanceConfirmOn', { count: minutes ?? 0 }),
            () => setMaintenance(minutes, code),
          ).then(() => setCode(''))
        }
      >
        {active ? t('maintenanceExtend', { count: minutes ?? 0 }) : t('maintenanceEnable')}
      </button>
    </section>
  )
}

function BannerCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const [preset, setPreset] = useState<(typeof BANNER_PRESETS)[number] | null>(null)
  const active = state.banner
  const lang = locale()

  if (active) {
    return (
      <section className="card">
        <h2>{t('bannerOnTitle')}</h2>
        <p className="hint">{active.text[lang]}</p>
        <p className="hint">{t('bannerUntil', { until: formatDateTime(active.until) })}</p>
        <button
          type="button"
          className="fallback-submit"
          disabled={busy}
          onClick={() => void run(t('bannerConfirmOff'), () => setBanner(null))}
        >
          {t('bannerRemove')}
        </button>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>{t('bannerOffTitle')}</h2>
      <p className="hint">{t('bannerHint')}</p>
      <div className="chips">
        {BANNER_PRESETS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="chip"
            aria-pressed={preset?.key === item.key}
            disabled={busy}
            onClick={() => {
              haptic.select()
              setPreset(item)
            }}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {/* Предпросмотр ровно тем же текстом, который увидят пользователи: объявление
          вешают один раз и сразу всем, переделать его «как увидят» уже нельзя. */}
      {preset && (
        <>
          <p className="hint">{t('bannerPreview')}</p>
          <p className="preview">{preset.text[lang]}</p>
        </>
      )}

      <div className="chips">
        {BANNER_PERIODS.map(({ minutes, key }) => (
          <button
            key={minutes}
            type="button"
            className="chip"
            disabled={busy || preset === null}
            onClick={() =>
              void run(
                t('bannerConfirmOn', {
                  preset: preset ? t(preset.labelKey) : '',
                  period: t(key),
                }),
                () => setBanner(minutes, preset ?? undefined),
              ).then(() => setPreset(null))
            }
          >
            {t('bannerFor', { period: t(key) })}
          </button>
        ))}
      </div>
    </section>
  )
}

function SectionsCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const disabled = new Set(state.disabledSections)

  return (
    <section className="card">
      <h2>{t('sectionsTitle')}</h2>
      <p className="hint">{t('sectionsHint')}</p>
      <div className="list">
        {SECTIONS.map(({ key, labelKey }) => {
          const off = disabled.has(key)
          const name = t(labelKey)
          return (
            <button
              key={key}
              type="button"
              className="toggle-row"
              disabled={busy}
              onClick={() => {
                const next = new Set(disabled)
                if (off) next.delete(key)
                else next.add(key)
                void run(
                  off ? t('sectionConfirmOn', { name }) : t('sectionConfirmOff', { name }),
                  () => setSections([...next]),
                )
              }}
            >
              <span>{name}</span>
              <span className={off ? 'toggle-state off' : 'toggle-state'}>
                {off ? t('sectionOff') : t('sectionOn')}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ReleaseCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const [version, setVersion] = useState('')

  return (
    <section className="card">
      <h2>{t('releaseTitle')}</h2>
      <p className="hint">
        {state.announcedVersion
          ? t('releaseAnnounced', { version: state.announcedVersion })
          : t('releaseNone')}{' '}
        {t('releaseHint')}
      </p>
      <input
        className="field"
        inputMode="decimal"
        placeholder="1.3.0"
        value={version}
        onChange={(e) => setVersion(e.target.value.trim())}
      />
      <button
        type="button"
        className="fallback-submit"
        disabled={busy || !/^\d+\.\d+\.\d+$/.test(version)}
        onClick={() =>
          void run(t('releaseConfirm', { version }), () => announceRelease(version)).then(() =>
            setVersion(''),
          )
        }
      >
        {t('releaseAnnounce')}
      </button>
    </section>
  )
}

function Head({ hint }: { hint: string }) {
  return (
    <header className="screen-head">
      <h1>{t('controlTitle')}</h1>
      <p className="hint">{hint}</p>
    </header>
  )
}
