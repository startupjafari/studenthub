import { useCallback, useEffect, useState } from 'react'
import {
  assignTicket,
  closeTicket,
  escalateTicket,
  fetchSupportQueue,
  fetchSupportThread,
  replyToTicket,
  REPLY_TEMPLATES,
  type QueueScope,
  type SupportMessage,
  type SupportTicket,
} from '../api/support'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { useBackButton, useMainButton } from '../telegram/use-telegram'
import { t } from '../i18n'
import { formatDateTime, formatShortTime } from '../lib/format'

// Поддержка платформы: очередь обращений и переписка.
//
// Здесь набирают текст — и это единственное место в мини-аппе, где иначе нельзя: ответ
// человеку нельзя выбрать из заготовок. Зато закрытие и возврат — тапы.

type Screen = { kind: 'queue' } | { kind: 'thread'; id: string }
type Tab = 'open' | 'mine' | 'closed'

// Вкладка задаёт сразу две вещи: какие обращения показывать и чьи. «Мои» — то, что
// человек взял на себя; без них все видят всё и никто ни за что не отвечает.
const TAB_QUERY: Record<Tab, { status: 'open' | 'closed'; assignee: QueueScope }> = {
  open: { status: 'open', assignee: 'any' },
  mine: { status: 'open', assignee: 'mine' },
  closed: { status: 'closed', assignee: 'any' },
}

/** `initialId` — обращение из ссылки в уведомлении: открываем его сразу, минуя очередь. */
export function SupportScreen({ initialId }: { initialId?: string }) {
  const [screen, setScreen] = useState<Screen>(
    initialId ? { kind: 'thread', id: initialId } : { kind: 'queue' },
  )

  return screen.kind === 'queue' ? (
    <QueueView onOpen={(ticket) => setScreen({ kind: 'thread', id: ticket.id })} />
  ) : (
    <ThreadView id={screen.id} onBack={() => setScreen({ kind: 'queue' })} />
  )
}

type QueueState =
  | { status: 'loading' }
  | { status: 'ready'; items: SupportTicket[]; total: number }
  | { status: 'error' }

function QueueView({ onOpen }: { onOpen: (ticket: SupportTicket) => void }) {
  const [state, setState] = useState<QueueState>({ status: 'loading' })
  const [tab, setTab] = useState<Tab>('open')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const { status, assignee } = TAB_QUERY[tab]
      const page = await fetchSupportQueue(status, assignee, search)
      setState({ status: 'ready', items: page.items, total: page.total })
    } catch {
      setState({ status: 'error' })
    }
  }, [tab, search])

  // Задержка перед запросом: иначе каждая буква уходит в сеть.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 350)
    return () => clearTimeout(timer)
  }, [load])

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{t('supportTitle')}</h1>
        <p className="hint">
          {state.status === 'ready' && tab === 'open' ? summary(state.total) : t('supportSubtitle')}
        </p>
      </header>

      <div className="tabs" role="tablist">
        {(['open', 'mine', 'closed'] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === value}
            onClick={() => {
              haptic.select()
              setTab(value)
            }}
          >
            {value === 'open'
              ? t('supportTabOpen')
              : value === 'mine'
                ? t('supportTabMine')
                : t('supportTabClosed')}
          </button>
        ))}
      </div>

      {/* «Мы это уже кому-то отвечали» — вопрос, который без поиска проверить негде. */}
      <input
        className="field"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('supportSearchPlaceholder')}
        aria-label={t('supportSearchPlaceholder')}
      />

      {state.status === 'loading' && <SkeletonList />}

      {state.status === 'error' && (
        <section className="card">
          <p>{t('supportLoadError')}</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            {t('retry')}
          </button>
        </section>
      )}

      {/* Подзаголовок уже сказал «открытых обращений нет» — карточка повторяет только
          заголовок и добавляет то, чего в нём не было. */}
      {state.status === 'ready' && state.items.length === 0 && (
        <section className="card">
          <h2>{t('supportEmptyTitle')}</h2>
          <p className="hint">
            {tab === 'open' ? t('supportEmptyText') : t('supportClosedEmptyText')}
          </p>
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
                <b>{authorName(ticket)}</b>
                <span className="hint">{firstLine(ticket.lastMessage?.text ?? '')}</span>
                {/* Кто ответил последним — главный признак «ждёт ли нас обращение». */}
                <span className="hint">
                  {ticket.closedAt
                    ? t('supportClosedAt', { when: formatShortTime(ticket.closedAt) })
                    : `${ticket.lastMessage?.fromAuthor ? t('supportNeedsReply') : t('supportAnswered')} · ${formatShortTime(ticket.updatedAt)}`}
                </span>
                {/* Кто разбирает — видно из очереди: иначе двое берутся за одно, а
                    третье не берёт никто, решив, что его уже взяли. */}
                {ticket.assignee && (
                  <span className="hint">
                    {t('supportAssigned', {
                      name: `${ticket.assignee.lastName} ${ticket.assignee.firstName}`,
                    })}
                  </span>
                )}
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
  | { status: 'loading' }
  | { status: 'ready'; ticket: SupportTicket; messages: SupportMessage[] }
  | { status: 'error' }

function ThreadView({ id, onBack }: { id: string; onBack: () => void }) {
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
      const { ticket, messages } = await fetchSupportThread(id)
      setState({ status: 'ready', ticket, messages: [...messages].reverse() })
    } catch {
      setState({ status: 'error' })
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const send = useCallback(async () => {
    if (busy || text.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const message = await replyToTicket(id, text.trim())
      setText('')
      haptic.success()
      setState((prev) =>
        prev.status === 'ready' ? { ...prev, messages: [...prev.messages, message] } : prev,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('supportSendError'))
    } finally {
      setBusy(false)
    }
  }, [busy, text, id])

  /** Взять на себя. Отказ сервера — не ошибка сети, а «уже взяли», и текст его об этом. */
  const take = useCallback(async () => {
    setError(null)
    try {
      const { assigneeId } = await assignTicket(id, true)
      haptic.success()
      setState((prev) =>
        prev.status === 'ready' ? { ...prev, ticket: { ...prev.ticket, assigneeId } } : prev,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('supportAssignError'))
    }
  }, [id])

  const escalate = useCallback(async () => {
    if (!(await confirmAction(t('supportEscalateConfirm')))) return
    setError(null)
    try {
      await escalateTicket(id)
      haptic.success()
      setError(t('supportEscalated'))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('supportEscalateError'))
    }
  }, [id])

  const finish = useCallback(async () => {
    if (!(await confirmAction(t('supportConfirmClose')))) return
    try {
      await closeTicket(id)
      haptic.success()
      onBack()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('supportCloseError'))
    }
  }, [onBack, id])

  // Главная кнопка Telegram под областью приложения: она не отнимает высоту у переписки,
  // а «Ответить» — единственное главное действие этого экрана. Пустой текст кнопку
  // убирает: кнопка, которая ничего не сделает, хуже её отсутствия.
  useMainButton(text.trim().length > 0 ? t('supportReply') : null, () => void send())

  // Пока переписка грузится, автора мы ещё не знаем: экран открывается и по ссылке из
  // уведомления, где очереди с его именем не было.
  const ticket = state.status === 'ready' ? state.ticket : null

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{ticket ? authorName(ticket) : t('supportThreadTitle')}</h1>
        <p className="hint">
          {ticket
            ? t('supportOpenedAt', { when: formatDateTime(ticket.createdAt) })
            : t('complaintOpening')}
        </p>
      </header>

      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && (
        <section className="card">
          <p>{t('supportThreadError')}</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            {t('retry')}
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
                {/* Вложение объясняет больше абзаца текста; скачать его из мини-аппа
                    нельзя, но знать, что оно есть, модератор обязан. */}
                {message.media && message.media.length > 0 && (
                  <span className="hint">
                    {t('supportAttachments', { count: message.media.length })}
                  </span>
                )}
                <span className="hint">{formatShortTime(message.createdAt)}</span>
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
        {/* Заготовка подставляется в поле, а не отправляется: это начало ответа. */}
        <div className="chips">
          {REPLY_TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => {
                haptic.select()
                setText(t(template.textKey))
              }}
            >
              {t(template.labelKey)}
            </button>
          ))}
        </div>
        <textarea
          className="field"
          rows={3}
          placeholder={t('supportReplyPlaceholder')}
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
          {t('supportReply')}
        </button>
        {ticket && !ticket.assigneeId && !ticket.closedAt && (
          <button
            type="button"
            className="fallback-submit"
            disabled={busy}
            onClick={() => void take()}
          >
            {t('supportAssign')}
          </button>
        )}
        {!ticket?.closedAt && (
          <>
            {/* Эскалация — действие, а не состояние: ответ на неё человек, а не флаг. */}
            <button
              type="button"
              className="fallback-submit"
              disabled={busy}
              onClick={() => void escalate()}
            >
              {t('supportEscalate')}
            </button>
            <button type="button" className="fallback-submit danger" onClick={() => void finish()}>
              {t('supportClose')}
            </button>
          </>
        )}
      </section>
    </div>
  )
}

function authorName(ticket: SupportTicket): string {
  return ticket.author
    ? `${ticket.author.lastName} ${ticket.author.firstName}`
    : t('supportDeletedAccount')
}

function summary(total: number): string {
  return total === 0 ? t('supportNone') : t('supportWaiting', { count: total })
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
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
