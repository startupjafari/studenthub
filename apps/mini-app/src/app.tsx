import { useCallback, useEffect, useState } from 'react'
import { haptic, initTelegram, isTelegram, startParam } from './telegram/webapp'
import { openSession, type MiniUser } from './api/client'
import { LinkScreen } from './screens/link'
import { ComplaintsScreen } from './screens/complaints'
import { ControlScreen } from './screens/control'
import { SupportScreen } from './screens/support'
import { OverviewScreen } from './screens/overview'
import { fetchBadges, type Badges } from './api/badges'
import { t } from './i18n'

// Мини-апп для администраторов и модераторов платформы.
//
// Единственный вход — подписанный initData от Telegram: при старте он меняется на короткий
// токен. Дальше возможны ровно три исхода, и каждому соответствует экран.
//
// Отказ сессии НЕ означает «не привязан»: сервер одинаково отвечает «нет доступа» и когда
// привязки нет, и когда роль больше не та — по разнице ответов вычислялось бы, кто из
// админов привязан (docs/PROJECT.md §Мини-апп). Клиент причину не знает и потому предлагает
// единственное действие, которое способно помочь: ввести код. Нет доступа в принципе —
// код не подойдёт, и об этом скажет уже сам ответ на привязку.

type Tab = 'complaints' | 'support' | 'control'

// Вкладки мини-аппа. «Управление» — только администратору: рычаги платформы пишет он
// один, и показывать модератору вкладку, где сервер всё равно откажет, значило бы
// обещать несуществующее действие.
const TABS: {
  id: Tab
  labelKey: 'tabComplaints' | 'tabSupport' | 'tabControl'
  adminOnly?: boolean
}[] = [
  { id: 'complaints', labelKey: 'tabComplaints' },
  { id: 'support', labelKey: 'tabSupport' },
  { id: 'control', labelKey: 'tabControl', adminOnly: true },
]

type State =
  | { status: 'starting' }
  | { status: 'outside' }
  | { status: 'link' }
  | { status: 'ready'; user: MiniUser }

export function App() {
  const [state, setState] = useState<State>({ status: 'starting' })
  // Ссылка из уведомления: `complaint_<id>` / `support_<id>`. Читается один раз при
  // старте — дальше человек ходит по вкладкам сам, и возвращать его к той же карточке
  // при каждом рендере было бы навязчиво.
  const [deepLink] = useState(() => startParam())
  const [tab, setTab] = useState<Tab>(deepLink?.kind === 'support' ? 'support' : 'complaints')

  useEffect(() => initTelegram(), [])

  const start = useCallback(async () => {
    if (!isTelegram()) {
      setState({ status: 'outside' })
      return
    }
    try {
      setState({ status: 'ready', user: await openSession() })
    } catch {
      setState({ status: 'link' })
    }
  }, [])

  useEffect(() => {
    void start()
  }, [start])

  return (
    <div className="app">
      <main className="content">
        {state.status === 'starting' && <Starting />}
        {state.status === 'outside' && <Outside />}
        {state.status === 'link' && (
          <LinkScreen onLinked={(user) => setState({ status: 'ready', user })} />
        )}
        {state.status === 'ready' && (
          <ReadyView role={state.user.role} tab={tab} onTab={setTab} deepLink={deepLink} />
        )}
      </main>
    </div>
  )
}

function ReadyView({
  role,
  tab,
  onTab,
  deepLink,
}: {
  role: MiniUser['role']
  tab: Tab
  onTab: (tab: Tab) => void
  deepLink: { kind: 'complaint' | 'support'; id: string } | null
}) {
  const isAdmin = role === 'PLATFORM_ADMIN'
  const tabs = TABS.filter((item) => isAdmin || !item.adminOnly)
  // Модератор, стоящий на вкладке администратора, получил бы пустой экран: сводим к
  // первой доступной, а не рисуем заглушку «нет прав» там, где вкладки просто нет.
  const active = tabs.some((item) => item.id === tab) ? tab : 'complaints'
  const badges = useBadges()

  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={active === item.id}
            onClick={() => {
              haptic.select()
              onTab(item.id)
            }}
          >
            {t(item.labelKey)}
            {/* Счётчик отвечает на вопрос «есть ли работа» без открытия вкладки:
                до него приходилось обходить все три по очереди. */}
            {badgeFor(item.id, badges) > 0 && (
              <span className="tab-badge">{badgeFor(item.id, badges)}</span>
            )}
          </button>
        ))}
      </div>
      {active === 'complaints' && (
        <ComplaintsScreen initialId={deepLink?.kind === 'complaint' ? deepLink.id : undefined} />
      )}
      {active === 'support' && (
        <SupportScreen initialId={deepLink?.kind === 'support' ? deepLink.id : undefined} />
      )}
      {active === 'control' && (
        <>
          <OverviewScreen />
          <ControlScreen />
        </>
      )}
    </>
  )
}

/**
 * Числа на вкладках. Запрашиваются один раз при открытии: мини-апп живёт минуты, и
 * опрос ради счётчика, который человек и так увидит, войдя во вкладку, не нужен.
 */
function useBadges(): Badges {
  const [badges, setBadges] = useState<Badges>({ complaints: 0, support: 0 })

  useEffect(() => {
    // Счётчики — украшение: их отказ не должен ничего ломать и ничего сообщать.
    fetchBadges()
      .then(setBadges)
      .catch(() => undefined)
  }, [])

  return badges
}

function badgeFor(tab: Tab, badges: Badges): number {
  if (tab === 'complaints') return badges.complaints
  if (tab === 'support') return badges.support
  return 0
}

function Starting() {
  // Пустой экран без слова «загрузка»: обмен занимает доли секунды, и надпись успевает
  // только моргнуть. Заголовок держит место, чтобы страница не прыгнула.
  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{t('appName')}</h1>
        <p className="hint">{t('checkingAccess')}</p>
      </header>
    </div>
  )
}

function Outside() {
  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{t('outsideTitle')}</h1>
        <p className="hint">{t('outsideHint')}</p>
      </header>
      <section className="card">
        <p className="hint">{t('outsideBody')}</p>
      </section>
    </div>
  )
}
