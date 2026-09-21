import { useCallback, useEffect, useState } from 'react'
import {
  closeTicket,
  fetchSupportQueue,
  fetchSupportThread,
  replyToTicket,
  type SupportMessage,
  type SupportTicket,
} from '../api/support'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { useBackButton } from '../telegram/use-telegram'

// Поддержка платформы: очередь обращений и переписка.
//
// Здесь набирают текст — и это единственное место в мини-аппе, где иначе нельзя: ответ
// человеку нельзя выбрать из заготовок. Зато закрытие и возврат — тапы.

type Screen = { kind: 'queue' } | { kind: 'thread'; ticket: SupportTicket }

export function SupportScreen() {
  const [screen, setScreen] = useState<Screen>({ kind: 'queue' })

  return screen.kind === 'queue' ? (
    <QueueView onOpen={(ticket) => setScreen({ kind: 'thread', ticket })} />
  ) : (
    <ThreadView ticket={screen.ticket} onBack={() => setScreen({ kind: 'queue' })} />
  )
}

type QueueState =
  | { status: 'loading' }
  | { status: 'ready'; items: SupportTicket[]; total: number }
  | { status: 'error' }

function QueueView({ onOpen }: { onOpen: (ticket: SupportTicket) => void }) {
  const [state, setState] = useState<QueueState>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const page = await fetchSupportQueue('open')
      setState({ status: 'ready', items: page.items, total: page.total })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Поддержка</h1>
        <p className="hint">
          {state.status === 'ready' ? summary(state.total) : 'Обращения пользователей'}
        </p>
      </header>

      {state.status === 'loading' && <SkeletonList />}

      {state.status === 'error' && (
        <section className="card">
          <p>Не удалось загрузить очередь</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            Повторить
          </button>
        </section>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <section className="card">
          <h2>Пусто</h2>
          <p className="hint">Открытых обращений нет.</p>
        </section>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <section className="list">
          {state.items.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              className="row"
              onClick={() => {
                haptic.tap()
                onOpen(ticket)
              }}
            >
              <span className="row-body">
                <b>
                  {ticket.author
                    ? `${ticket.author.lastName} ${ticket.author.firstName}`
                    : 'Аккаунт удалён'}
                </b>
                <span className="hint">{firstLine(ticket.lastMessage?.text ?? '')}</span>
                {/* Кто ответил последним — главный признак «ждёт ли нас обращение». */}
                <span className="hint">
                  {ticket.lastMessage?.fromAuthor ? 'Ждёт ответа' : 'Ответили'} ·{' '}
                  {formatDate(ticket.updatedAt)}
                </span>
              </span>
              <span className="row-chevron" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

type ThreadState =
  { status: 'loading' } | { status: 'ready'; messages: SupportMessage[] } | { status: 'error' }

function ThreadView({ ticket, onBack }: { ticket: SupportTicket; onBack: () => void }) {
  const [state, setState] = useState<ThreadState>({ status: 'loading' })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBackButton(onBack)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      // Сервер отдаёт свежие сверху (курсорная история), а читать переписку удобно
      // сверху вниз по времени — разворачиваем здесь.
      const messages = await fetchSupportThread(ticket.id)
      setState({ status: 'ready', messages: [...messages].reverse() })
    } catch {
      setState({ status: 'error' })
    }
  }, [ticket.id])

  useEffect(() => {
    void load()
  }, [load])

  const send = useCallback(async () => {
    if (busy || text.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const message = await replyToTicket(ticket.id, text.trim())
      setText('')
      haptic.success()
      setState((prev) =>
        prev.status === 'ready' ? { status: 'ready', messages: [...prev.messages, message] } : prev,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }, [busy, text, ticket.id])

  const finish = useCallback(async () => {
    if (
      !(await confirmAction('Закрыть обращение? Переписка останется, а ответ снова его откроет.'))
    )
      return
    try {
      await closeTicket(ticket.id)
      haptic.success()
      onBack()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось закрыть')
    }
  }, [onBack, ticket.id])

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>
          {ticket.author ? `${ticket.author.lastName} ${ticket.author.firstName}` : 'Обращение'}
        </h1>
        <p className="hint">Открыто {formatDate(ticket.createdAt)}</p>
      </header>

      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && (
        <section className="card">
          <p>Не удалось открыть переписку</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            Повторить
          </button>
        </section>
      )}

      {state.status === 'ready' && (
        <section className="list">
          {state.messages.map((message) => (
            <div key={message.id} className="row row-static">
              <span className="row-body">
                <b>{message.sender.firstName}</b>
                <span>{message.content}</span>
                <span className="hint">{formatDate(message.createdAt)}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      {error && (
        <section className="card">
          <p className="hint-danger">{error}</p>
        </section>
      )}

      <section className="card">
        <textarea
          className="field"
          rows={3}
          placeholder="Ответ"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="fallback-submit"
          disabled={busy || text.trim().length === 0}
          onClick={() => void send()}
        >
          Ответить
        </button>
        <button type="button" className="fallback-submit danger" onClick={() => void finish()}>
          Закрыть обращение
        </button>
      </section>
    </div>
  )
}

function summary(total: number): string {
  if (total === 0) return 'Открытых обращений нет'
  const last = total % 10
  const teen = total % 100 >= 11 && total % 100 <= 14
  const word =
    !teen && last === 1 ? 'обращение' : !teen && last >= 2 && last <= 4 ? 'обращения' : 'обращений'
  return `${total} ${word} ждут ответа`
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return date.toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
  })
}

function SkeletonList() {
  return (
    <section className="list" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="row row-static">
          <span className="row-body">
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-line" />
          </span>
        </div>
      ))}
    </section>
  )
}
