import { useCallback, useEffect, useState } from 'react'
import {
  announceRelease,
  fetchPlatformState,
  setBanner,
  setMaintenance,
  setNotifications,
  setSections,
  setSeason,
  setDuty,
  fetchDuty,
  fetchTeam,
  undoLastChange,
  BANNER_AUDIENCES,
  BANNER_PRESETS,
  NOTIFICATION_KINDS,
  SEASONS,
  SECTIONS,
  type Duty,
  type NotificationKind,
  type NotificationSettings,
  type PlatformState,
  type TeamLink,
} from '../api/platform'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { t } from '../i18n'
import { locale, type MessageKey } from '../i18n'
import { formatDateTime } from '../lib/format'
import { applyFontScale, isLargeFont } from '../lib/font-scale'
import { Fold } from '../ui/fold'
import { StatePlate } from '../ui/state-plate'
import { Tile } from '../ui/tile'
import {
  IconBanner,
  IconBell,
  IconDuty,
  IconMaintenance,
  IconRelease,
  IconSeason,
  IconSections,
  IconTextSize,
  IconUndo,
} from '../ui/icons'

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

// Когда начать. Плановая остановка задаётся тем же действием, что и обычная: два
// объявления об одном событии (баннер «сегодня в 22:00» и отдельно техработы) расходятся.
const MAINTENANCE_STARTS = [0, 2, 6, 12]
const BANNER_PERIODS = [
  { minutes: 60, key: 'bannerPeriodHour' },
  { minutes: 60 * 24, key: 'bannerPeriodDay' },
  { minutes: 60 * 24 * 3, key: 'bannerPeriod3Days' },
] as const

type Load = { status: 'loading' } | { status: 'ready'; state: PlatformState } | { status: 'error' }

export function ControlScreen({ userId }: { userId: string }) {
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

  // Свой .screen у загрузки: без него строка состояния прижималась к самому краю экрана.
  if (load.status === 'loading')
    return (
      <div className="screen">
        <Head hint={t('controlReading')} />
      </div>
    )
  if (load.status === 'error') {
    return (
      <div className="screen">
        <Head hint={t('controlSubtitle')} />
        <StatePlate title={t('controlReadError')} onRetry={() => void reload()} />
      </div>
    )
  }

  const { state } = load

  return (
    <div className="screen">
      {/* Заголовка экрана здесь нет намеренно: где мы находимся, сказано вкладкой сверху,
          а повторять это третьей строкой подряд — отдавать телефону место под надпись,
          которую и так прочитали. */}
      {error && (
        <section className="card">
          <p className="hint-danger">{error}</p>
        </section>
      )}

      {/*
       * Рычаги собраны в группы, а не выложены девятью отдельными карточками.
       *
       * Порознь между ними оставался одинаковый зазор, и лента читалась как девять
       * равнозначных экранов. Группами видно устройство раздела: что показывают всем
       * (техработы, баннер, разделы, оформление, «Что нового»), чем распоряжается команда
       * (уведомления, дежурство) и что настраивает себе сам смотрящий (размер текста,
       * откат последнего изменения).
       */}
      <section className="card fold-group">
        <MaintenanceCard state={state} busy={busy} run={run} />
        <BannerCard state={state} busy={busy} run={run} />
        <SectionsCard state={state} busy={busy} run={run} />
        <SeasonCard state={state} busy={busy} run={run} />
        <ReleaseCard state={state} busy={busy} run={run} />
      </section>

      <section className="card fold-group">
        <NotificationsCard state={state} busy={busy} run={run} userId={userId} />
        <DutyCard busy={busy} setError={setError} />
      </section>

      <section className="card fold-group">
        <FontCard />
        <UndoCard busy={busy} run={run} />
      </section>

      {/* Какая сборка открыта. Не украшение: сервисы на Railway однажды разъехались по
          веткам, и мини-апп неделю ходил в бэкенд за маршрутами, которых там не было. */}
      <p className="footnote">{t('aboutVersion', { version: __APP_VERSION__ })}</p>
    </div>
  )
}

type Run = (question: string, action: () => Promise<PlatformState>) => Promise<void>

/**
 * Дежурство по очереди.
 *
 * До него дежурного назначали руками — то есть он оставался прежним, пока кто-нибудь не
 * вспоминал, что дежурит уже месяц. Порядок задаётся касаниями: номер у чипа и есть
 * очередь, а передаёт её сервер по понедельникам.
 *
 * Список людей — те, кто привязал Telegram: дежурить может только тот, кому бот в
 * принципе может написать. Заодно это и есть список привязок команды, которого на экране
 * до сих пор не было, хотя ручка для него давно есть.
 */
function DutyCard({ busy, setError }: { busy: boolean; setError: (text: string | null) => void }) {
  const [team, setTeam] = useState<TeamLink[] | null>(null)
  const [duty, setDutyState] = useState<Duty | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void Promise.all([fetchTeam(), fetchDuty()])
      .then(([people, current]) => {
        setTeam(people)
        setDutyState(current)
      })
      .catch(() => setTeam([]))
  }, [])

  if (team === null || duty === null) return null
  if (team.length === 0) return null

  const order = duty.rotation
  const toggle = async (userId: string): Promise<void> => {
    const next = order.includes(userId) ? order.filter((id) => id !== userId) : [...order, userId]
    haptic.select()
    setSaving(true)
    setError(null)
    try {
      setDutyState(await setDuty(next))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dutyError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Fold
      icon={
        <Tile tone="indigo">
          <IconDuty size={17} />
        </Tile>
      }
      title={t('dutyTitle')}
      state={order.length > 1 ? t('dutyStateRota', { count: order.length }) : t('dutyStateManual')}
    >
      <p className="hint">{order.length > 1 ? t('dutyHint') : t('dutyHintSingle')}</p>
      <div className="chips">
        {team.map((person) => {
          const place = order.indexOf(person.userId)
          return (
            <button
              key={person.userId}
              type="button"
              className="chip"
              aria-pressed={place >= 0}
              disabled={busy || saving}
              onClick={() => void toggle(person.userId)}
            >
              {place >= 0 ? `${place + 1}. ` : ''}
              {person.name}
              {person.userId === duty.dutyUserId ? ` · ${t('dutyNow')}` : ''}
            </button>
          )
        })}
      </div>
      {/* Привязка, которой не пользовались месяцами, — это доступ, о котором забыли все,
          включая её владельца. Видно её здесь же: список тот же самый. */}
      {team.map((person) => (
        <p key={person.userId} className="hint">
          {person.name} ·{' '}
          {person.lastSeenAt
            ? t('dutySeen', { when: formatDateTime(person.lastSeenAt) })
            : t('dutyNeverSeen')}
        </p>
      ))}
    </Fold>
  )
}

/**
 * Верни как было. Стоит последней и намеренно скромно: это не рычаг, а исправление
 * промаха по соседнему рычагу. Сервер сам откажет, если отменять нечего, изменение
 * старше получаса или откат включил бы техработы, — и его отказ мы и покажем.
 */
function UndoCard({ busy, run }: { busy: boolean; run: Run }) {
  return (
    <Fold
      icon={
        <Tile tone="gray">
          <IconUndo size={17} />
        </Tile>
      }
      title={t('undoTitle')}
    >
      <p className="hint">{t('undoHint')}</p>
      <button
        type="button"
        className="fallback-submit secondary"
        disabled={busy}
        onClick={() => void run(t('undoConfirm'), () => undoLastChange())}
      >
        {t('undoAction')}
      </button>
    </Fold>
  )
}

function MaintenanceCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const [code, setCode] = useState('')
  const [minutes, setMinutes] = useState<number | null>(null)
  const [startsIn, setStartsIn] = useState(0)
  const active = state.maintenance

  return (
    <Fold
      icon={
        <Tile tone="orange">
          <IconMaintenance size={17} />
        </Tile>
      }
      title={t('maintenanceTitle')}
      // Состояние в заголовке: «идут ли сейчас техработы» — вопрос, ради которого этот
      // раздел и открывали чаще прочих.
      state={
        active
          ? active.active
            ? t('maintenanceStateOn')
            : t('maintenanceStatePlanned')
          : t('maintenanceStateOff')
      }
    >
      <h2 className="fold-sub">{active ? t('maintenanceOnTitle') : t('maintenanceOffTitle')}</h2>
      <p className="hint">
        {active
          ? active.active
            ? t('maintenanceOnHint', { until: formatDateTime(active.until) })
            : t('maintenancePlannedHint', {
                from: formatDateTime(active.startsAt ?? active.until),
                until: formatDateTime(active.until),
              })
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
      <div className="chips-grid">
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
      <div className="chips-grid">
        {MAINTENANCE_STARTS.map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={startsIn === value}
            disabled={busy}
            onClick={() => {
              haptic.select()
              setStartsIn(value)
            }}
          >
            {value === 0 ? t('maintenanceStartNow') : t('maintenanceStartIn', { count: value })}
          </button>
        ))}
      </div>

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
            () => setMaintenance(minutes, code, startsIn * 60),
          ).then(() => setCode(''))
        }
      >
        {active ? t('maintenanceExtend', { count: minutes ?? 0 }) : t('maintenanceEnable')}
      </button>
    </Fold>
  )
}

function BannerCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const [preset, setPreset] = useState<(typeof BANNER_PRESETS)[number] | null>(null)
  const [audience, setAudience] = useState<string[]>([])
  // Свой текст. Заготовки остаются первыми и это не вкусовщина: набрать объявление на трёх
  // языках с телефона — работа на несколько минут, а заготовка вешается одним касанием.
  // Но случай «у нас своё, ни на что не похожее» существует, и раньше он упирался в ноутбук,
  // которого у дежурного может не быть.
  const [custom, setCustom] = useState<{ ru: string; kk: string; en: string } | null>(null)
  const [level, setLevel] = useState<'INFO' | 'WARNING'>('INFO')
  // Все три языка обязательны: строка на двух из трёх — дыра в интерфейсе у тех, кому не
  // повезло с локалью. Проверяем здесь же, чтобы кнопка не предлагала заведомый отказ.
  const customReady =
    custom !== null &&
    custom.ru.trim().length > 0 &&
    custom.kk.trim().length > 0 &&
    custom.en.trim().length > 0
  const active = state.banner
  const lang = locale()

  if (active) {
    return (
      <Fold
        icon={
          <Tile tone="purple">
            <IconBanner size={17} />
          </Tile>
        }
        title={t('bannerTitle')}
        state={t('bannerStateOn')}
      >
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
      </Fold>
    )
  }

  return (
    <Fold
      icon={
        <Tile tone="purple">
          <IconBanner size={17} />
        </Tile>
      }
      title={t('bannerTitle')}
      state={t('bannerStateOff')}
    >
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

      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={custom !== null}
          disabled={busy}
          onClick={() => {
            haptic.select()
            setPreset(null)
            setCustom((prev) => (prev ? null : { ru: '', kk: '', en: '' }))
          }}
        >
          {t('bannerCustom')}
        </button>
      </div>

      {custom && (
        <>
          <p className="hint">{t('bannerCustomHint')}</p>
          {(['ru', 'kk', 'en'] as const).map((code) => (
            <input
              key={code}
              className="field"
              maxLength={300}
              placeholder={t(`bannerLang_${code}` as MessageKey)}
              aria-label={t(`bannerLang_${code}` as MessageKey)}
              value={custom[code]}
              onChange={(event) => setCustom({ ...custom, [code]: event.target.value })}
            />
          ))}
          <div className="chips">
            {(['INFO', 'WARNING'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="chip"
                aria-pressed={level === value}
                disabled={busy}
                onClick={() => {
                  haptic.select()
                  setLevel(value)
                }}
              >
                {value === 'INFO' ? t('bannerLevelInfo') : t('bannerLevelWarning')}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Предпросмотр ровно тем же текстом, который увидят пользователи: объявление
          вешают один раз и сразу всем, переделать его «как увидят» уже нельзя. */}
      {preset && (
        <>
          <p className="hint">{t('bannerPreview')}</p>
          <p className="preview">{preset.text[lang]}</p>
        </>
      )}
      {customReady && (
        <>
          <p className="hint">{t('bannerPreview')}</p>
          <p className="preview">{custom[lang]}</p>
        </>
      )}

      {/* Прицел по ролям — тапом; по вузам их сотня, и такой список задаётся из веба. */}
      <p className="hint">{t('bannerAudience')}</p>
      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={audience.length === 0}
          disabled={busy}
          onClick={() => {
            haptic.select()
            setAudience([])
          }}
        >
          {t('bannerAudienceAll')}
        </button>
        {BANNER_AUDIENCES.map((item) => {
          const chosen = item.roles.every((role) => audience.includes(role))
          return (
            <button
              key={item.key}
              type="button"
              className="chip"
              aria-pressed={chosen}
              disabled={busy}
              onClick={() => {
                haptic.select()
                setAudience((prev) =>
                  chosen
                    ? prev.filter((role) => !item.roles.includes(role as never))
                    : [...new Set([...prev, ...item.roles])],
                )
              }}
            >
              {t(item.labelKey)}
            </button>
          )
        })}
      </div>

      <div className="chips-grid">
        {BANNER_PERIODS.map(({ minutes, key }) => (
          <button
            key={minutes}
            type="button"
            className="chip"
            disabled={busy || (preset === null && !customReady)}
            onClick={() =>
              void run(
                t('bannerConfirmOn', {
                  preset: preset ? t(preset.labelKey) : t('bannerCustom'),
                  period: t(key),
                }),
                () =>
                  setBanner(
                    minutes,
                    preset ?? undefined,
                    audience,
                    customReady ? custom : undefined,
                    level,
                  ),
              ).then(() => {
                setPreset(null)
                setCustom(null)
                setLevel('INFO')
                setAudience([])
              })
            }
          >
            {t('bannerFor', { period: t(key) })}
          </button>
        ))}
      </div>
    </Fold>
  )
}

function SectionsCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const disabled = new Set(state.disabledSections)

  return (
    <Fold
      icon={
        <Tile tone="blue">
          <IconSections size={17} />
        </Tile>
      }
      title={t('sectionsTitle')}
      state={
        disabled.size > 0 ? t('sectionsStateOff', { count: disabled.size }) : t('sectionsStateAll')
      }
    >
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
    </Fold>
  )
}

/**
 * Праздничное оформление. Календарь праздников живёт в самом вебе и сюда не приезжает —
 * здесь ровно два действия, которых календарь дать не может: погасить всё (траур, авария,
 * любое «сегодня не время») и показать сезон вне его даты.
 */
function SeasonCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const { off, override } = state.season
  const picked = SEASONS.find((season) => season.key === override) ?? null

  return (
    <Fold
      icon={
        <Tile tone="pink">
          <IconSeason size={17} />
        </Tile>
      }
      title={t('seasonTitle')}
      state={off ? t('seasonStateOff') : picked ? t(picked.labelKey) : t('seasonStateCalendar')}
    >
      <p className="hint">{t('seasonHint')}</p>

      <button
        type="button"
        className="toggle-row"
        disabled={busy}
        onClick={() => {
          void run(off ? t('seasonConfirmOn') : t('seasonConfirmOff'), () =>
            setSeason(!off, override),
          )
        }}
      >
        <span>{t('seasonSwitch')}</span>
        <span className={off ? 'toggle-state off' : 'toggle-state'}>
          {off ? t('sectionOff') : t('sectionOn')}
        </span>
      </button>

      {/* Выбор сезона остаётся доступным и при выключенном оформлении: сначала готовят,
          потом включают — обратный порядок означал бы праздник, мелькнувший у всех. */}
      <div className="list">
        <button
          type="button"
          className="toggle-row"
          disabled={busy || override === null}
          onClick={() => {
            void run(t('seasonConfirmCalendar'), () => setSeason(off, null))
          }}
        >
          <span>{t('seasonPickCalendar')}</span>
          <span className={override === null ? 'toggle-state' : 'toggle-state off'}>
            {override === null ? t('sectionOn') : t('sectionOff')}
          </span>
        </button>
        {SEASONS.map(({ key, labelKey }) => {
          const name = t(labelKey)
          const active = override === key
          return (
            <button
              key={key}
              type="button"
              className="toggle-row"
              disabled={busy || active}
              onClick={() => {
                void run(t('seasonConfirmPick', { name }), () => setSeason(off, key))
              }}
            >
              <span>{name}</span>
              <span className={active ? 'toggle-state' : 'toggle-state off'}>
                {active ? t('sectionOn') : t('sectionOff')}
              </span>
            </button>
          )
        })}
      </div>
    </Fold>
  )
}

function ReleaseCard({ state, busy, run }: { state: PlatformState; busy: boolean; run: Run }) {
  const [version, setVersion] = useState('')

  return (
    <Fold
      icon={
        <Tile tone="green">
          <IconRelease size={17} />
        </Tile>
      }
      title={t('releaseTitle')}
      state={state.announcedVersion ?? t('releaseStateNone')}
    >
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
    </Fold>
  )
}

/**
 * Строка состояния над рычагами.
 *
 * Названия раздела здесь больше нет: его вместе с переключателем «Сводка / Рычаги»
 * рисует общая шапка над экраном (app.tsx), и собственный заголовок «Управление» стоял
 * бы прямо под точно таким же. Осталось то, чего в шапке нет, — что сейчас происходит.
 */
function Head({ hint }: { hint: string }) {
  return <p className="hint">{hint}</p>
}

/**
 * Уведомления команде. Четыре решения, каждое — выбор из готовых вариантов: часы тишины,
 * что присылать, кто дежурит и когда приходит сводка.
 *
 * Произвольные часы не вводятся намеренно. «Не будить с 22 до 8» — решение о ночи, а не
 * о минутах; поле ввода времени на телефоне стоит трёх тапов и даёт точность, которой
 * здесь некуда деться.
 */
function NotificationsCard({
  state,
  busy,
  run,
  userId,
}: {
  state: PlatformState
  busy: boolean
  run: Run
  userId: string
}) {
  const current = state.notifications
  const [draft, setDraft] = useState<NotificationSettings>(current)

  const quietOptions: { labelKey: MessageKey; from: number | null; to: number | null }[] = [
    { labelKey: 'notifQuietOff', from: null, to: null },
    { labelKey: 'notifQuietNight', from: 22, to: 8 },
    { labelKey: 'notifQuietEvening', from: 19, to: 9 },
  ]
  const digestOptions: { labelKey: MessageKey; hour: number | null }[] = [
    { labelKey: 'notifDigestOff', hour: null },
    { labelKey: 'notifDigestMorning', hour: 9 },
    { labelKey: 'notifDigestEvening', hour: 18 },
  ]

  const toggleKind = (kind: NotificationKind): void => {
    haptic.select()
    setDraft((prev) => ({
      ...prev,
      muted: prev.muted.includes(kind)
        ? prev.muted.filter((item) => item !== kind)
        : [...prev.muted, kind],
    }))
  }

  return (
    <Fold
      icon={
        <Tile tone="red">
          <IconBell size={17} />
        </Tile>
      }
      title={t('notifTitle')}
      state={
        current.quietFrom === null
          ? t('notifStateAll')
          : t('notifStateQuiet', { from: current.quietFrom, to: current.quietTo ?? 0 })
      }
    >
      <p className="hint">{t('notifHint')}</p>

      <p className="hint">{t('notifQuiet')}</p>
      <div className="chips-grid">
        {quietOptions.map((option) => (
          <button
            key={option.labelKey}
            type="button"
            className="chip"
            aria-pressed={draft.quietFrom === option.from && draft.quietTo === option.to}
            disabled={busy}
            onClick={() => {
              haptic.select()
              setDraft((prev) => ({ ...prev, quietFrom: option.from, quietTo: option.to }))
            }}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <p className="hint">{t('notifKinds')}</p>
      <div className="chips-grid">
        {NOTIFICATION_KINDS.map(({ key, labelKey }) => (
          <button
            key={key}
            type="button"
            className="chip"
            // Нажатая фишка = «присылать». Хранится обратное (список выключенного),
            // чтобы новый вид уведомления по умолчанию доходил.
            aria-pressed={!draft.muted.includes(key)}
            disabled={busy}
            onClick={() => toggleKind(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      <p className="hint">{t('notifDuty')}</p>
      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={draft.dutyUserId === null}
          disabled={busy}
          onClick={() => {
            haptic.select()
            setDraft((prev) => ({ ...prev, dutyUserId: null }))
          }}
        >
          {t('notifDutyTeam')}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={draft.dutyUserId === userId}
          disabled={busy}
          onClick={() => {
            haptic.select()
            setDraft((prev) => ({ ...prev, dutyUserId: userId }))
          }}
        >
          {t('notifDutyMe')}
        </button>
      </div>

      <p className="hint">{t('notifDigest')}</p>
      <div className="chips-grid">
        {digestOptions.map((option) => (
          <button
            key={option.labelKey}
            type="button"
            className="chip"
            aria-pressed={draft.digestHour === option.hour}
            disabled={busy}
            onClick={() => {
              haptic.select()
              setDraft((prev) => ({ ...prev, digestHour: option.hour }))
            }}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="fallback-submit"
        disabled={busy}
        onClick={() => void run(t('notifConfirm'), () => setNotifications(draft))}
      >
        {t('notifSave')}
      </button>
    </Fold>
  )
}

/**
 * Размер текста. Настройка устройства, а не человека: с телефона хочется крупнее, с
 * планшета может и нет, — поэтому живёт в localStorage мини-аппа, а не на сервере.
 */
function FontCard() {
  const [large, setLarge] = useState(isLargeFont)

  return (
    <Fold
      icon={
        <Tile tone="teal">
          <IconTextSize size={17} />
        </Tile>
      }
      title={t('fontTitle')}
      state={large ? t('fontStateLarge') : t('fontStateNormal')}
    >
      <p className="hint">{t('fontHint')}</p>
      <div className="chips-grid">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            className="chip"
            aria-pressed={large === value}
            onClick={() => {
              haptic.select()
              applyFontScale(value)
              setLarge(value)
            }}
          >
            {value ? t('fontLarge') : t('fontNormal')}
          </button>
        ))}
      </div>
    </Fold>
  )
}
