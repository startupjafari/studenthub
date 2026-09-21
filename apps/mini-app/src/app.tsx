import { useCallback, useEffect, useState } from 'react'
import { initTelegram, isTelegram } from './telegram/webapp'
import { openSession, type MiniUser } from './api/client'
import { LinkScreen } from './screens/link'
import { ComplaintsScreen } from './screens/complaints'

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

type State =
  | { status: 'starting' }
  | { status: 'outside' }
  | { status: 'link' }
  | { status: 'ready'; user: MiniUser }

export function App() {
  const [state, setState] = useState<State>({ status: 'starting' })

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
        {state.status === 'ready' && <ComplaintsScreen />}
      </main>
    </div>
  )
}

function Starting() {
  // Пустой экран без слова «загрузка»: обмен занимает доли секунды, и надпись успевает
  // только моргнуть. Заголовок держит место, чтобы страница не прыгнула.
  return (
    <div className="screen">
      <header className="screen-head">
        <h1>StudentHub</h1>
        <p className="hint">Проверяем доступ…</p>
      </header>
    </div>
  )
}

function Outside() {
  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Откройте из Telegram</h1>
        <p className="hint">Мини-апп работает внутри клиента Telegram</p>
      </header>
      <section className="card">
        <p className="hint">
          Приложение подтверждает вас подписью, которую выдаёт Telegram при открытии. В обычном
          браузере такой подписи нет, поэтому очередь жалоб здесь недоступна.
        </p>
      </section>
    </div>
  )
}
