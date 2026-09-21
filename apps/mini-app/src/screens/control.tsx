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

// Пульт платформы: то, чем админ управляет вебом, не открывая ноутбук.
//
// Экран собран вокруг одного ограничения — это телефон. Поэтому здесь нет ни одного поля
// свободного текста, кроме номера версии: сроки и формулировки выбираются тапом. Объявление
// обязано существовать на трёх языках, и набирать их с телефона никто не станет — потому
// вместо поля ввода готовые заготовки (см. BANNER_PRESETS).
//
// Каждое действие проходит через нативное подтверждение Telegram: рычаги здесь меняют то,
// что видят все пользователи платформы, и промах по экрану не должен этого делать.

const MAINTENANCE_MINUTES = [15, 30, 60, 120]
const BANNER_MINUTES = [
  { minutes: 60, label: 'час' },
  { minutes: 60 * 24, label: 'сутки' },
  { minutes: 60 * 24 * 3, label: '3 дня' },
]

type Load =
  | { status: 'loading' }
  | { status: 'ready'; state: PlatformState }
  | { status: 'error'; message: string }

export function ControlScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoad({ status: 'loading' })
    try {
      setLoad({ status: 'ready', state: await fetchPlatformState() })
    } catch {
      setLoad({ status: 'error', message: 'Не удалось прочитать состояние' })
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
        setError(err instanceof ApiError ? err.message : 'Не удалось применить')
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  if (load.status === 'loading') return <Head hint="Читаем состояние…" />
  if (load.status === 'error') {
    return (
      <div className="screen">
        <Head hint="Управление платформой" />
        <section className="card">
          <p>{load.message}</p>
          <button type="button" className="fallback-submit" onClick={() => void reload()}>
            Повторить
          </button>
        </section>
      </div>
    )
  }

  const { state } = load

  return (
    <div className="screen">
      <Head hint="Управление платформой" />

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

  if (active) {
    return (
      <section className="card">
        <h2>Техработы идут</h2>
        <p className="hint">
          До {formatTime(active.until)}. Все, кроме платформенных ролей, видят заглушку.
        </p>
        <button
          type="button"
          className="fallback-submit"
          disabled={busy}
          onClick={() =>
            void run('Снять режим техработ? Платформа снова откроется всем.', () =>
              setMaintenance(null),
            )
          }
        >
          Снять
        </button>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Техработы</h2>
      <p className="hint">
        Платформа закроется для всех, кроме платформенных ролей, и откроется сама, когда срок
        выйдет.
      </p>
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
            {value} мин
          </button>
        ))}
      </div>
      {/* Код 2FA — единственное место в мини-аппе, где что-то набирают: остановка платформы
          не должна быть возможна одним промахом по экрану. */}
      <input
        className="field"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="Код из приложения-аутентификатора"
        value={code}
        onChange={(e) => setCode(e.target.value.trim())}
      />
      <button
        type="button"
        className="fallback-submit danger"
        disabled={busy || minutes === null || code.length < 6}
        onClick={() =>
          void run(`Остановить платформу на ${minutes} мин? Её увидят все пользователи.`, () =>
            setMaintenance(minutes, code),
          ).then(() => setCode(''))
        }
      >
        Включить техработы
      </button>
    </section>
  )
}

function BannerCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const [preset, setPreset] = useState<(typeof BANNER_PRESETS)[number] | null>(null)
  const active = state.banner

  if (active) {
    return (
      <section className="card">
        <h2>Объявление висит</h2>
        <p className="hint">{active.text.ru}</p>
        <p className="hint">До {formatTime(active.until)}</p>
        <button
          type="button"
          className="fallback-submit"
          disabled={busy}
          onClick={() => void run('Снять объявление?', () => setBanner(null))}
        >
          Снять
        </button>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Объявление</h2>
      <p className="hint">Полоса над приложением у всех пользователей.</p>
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
            {item.label}
          </button>
        ))}
      </div>
      <div className="chips">
        {BANNER_MINUTES.map(({ minutes, label }) => (
          <button
            key={minutes}
            type="button"
            className="chip"
            disabled={busy || preset === null}
            onClick={() =>
              void run(`Повесить объявление «${preset?.label}» на ${label}?`, () =>
                setBanner(minutes, preset ?? undefined),
              ).then(() => setPreset(null))
            }
          >
            На {label}
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
      <h2>Разделы</h2>
      <p className="hint">Погашенный раздел исчезает у всех до возвращения.</p>
      <div className="list">
        {SECTIONS.map(({ key, label }) => {
          const off = disabled.has(key)
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
                  off ? `Вернуть раздел «${label}»?` : `Погасить раздел «${label}» для всех?`,
                  () => setSections([...next]),
                )
              }}
            >
              <span>{label}</span>
              <span className={off ? 'toggle-state off' : 'toggle-state'}>
                {off ? 'Погашен' : 'Работает'}
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
      <h2>«Что нового»</h2>
      <p className="hint">
        {state.announcedVersion
          ? `Объявлена версия ${state.announcedVersion}.`
          : 'Ни одна версия не объявлена.'}{' '}
        Текст заметки едет в сборке веба — здесь только номер.
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
          void run(`Объявить версию ${version}?`, () => announceRelease(version)).then(() =>
            setVersion(''),
          )
        }
      >
        Объявить
      </button>
    </section>
  )
}

function Head({ hint }: { hint: string }) {
  return (
    <header className="screen-head">
      <h1>Управление</h1>
      <p className="hint">{hint}</p>
    </header>
  )
}

/** Только время, если срок истекает сегодня; иначе с датой — «до 14:30» без дня врёт. */
function formatTime(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return date.toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
  })
}
