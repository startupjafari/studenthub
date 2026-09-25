import { useCallback, useEffect, useState } from 'react'
import {
  assignTicket,
  closeTicket,
  escalateTicket,
  fetchSupportQueue,
  fetchSupportThread,
  fetchTagCounts,
  mergeTicket,
  replyToTicket,
  sendVoiceReply,
  setTicketTags,
  REPLY_TEMPLATES,
  SUPPORT_TAGS,
  SUPPORT_TAG_KEY,
  type QueueScope,
  type SupportMessage,
  type SupportTag,
  type SupportTicket,
} from '../api/support'
import { ApiError } from '../api/client'
import { createComplaintFromSupport } from '../api/complaints'
import { searchPeople, type Person } from '../api/people'
import { confirmAction, haptic, setClosingConfirmation } from '../telegram/webapp'
import { useBackButton, useMainButton } from '../telegram/use-telegram'
import { t } from '../i18n'
import { formatDateTime, formatShortTime, initials } from '../lib/format'
import { PersonSummary } from './person-summary'
import { Tabs } from '../ui/tabs'
import { useVoiceRecorder } from '../telegram/use-voice'

// Поддержка платформы: очередь обращений и переписка.
//
// Здесь набирают текст — и это единственное место в мини-аппе, где иначе нельзя: ответ
// человеку нельзя выбрать из заготовок. Зато закрытие и возврат — тапы.

type Screen = { kind: 'queue' } | { kind: 'thread'; id: string }
type Tab = 'open' | 'mine' | 'closed'

// Вкладка задаёт сразу две вещи: какие обращения показывать и чьи. «Мои» — то, что
// человек взял на себя; без них все видят всё и никто ни за что не отвечает.
// Та же задержка поиска, что в разделе «Люди»: без неё каждая буква уходит в сеть.
const PERSON_SEARCH_DELAY_MS = 350

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
  // Тег служит сразу двумя способами: как фильтр очереди и как ответ на «о чём
  // спрашивают чаще». Счётчики за 30 дней приходят отдельно и по отказу молчат.
  const [tag, setTag] = useState<SupportTag | null>(null)
  const [counts, setCounts] = useState<{ tag: SupportTag; count: number }[]>([])

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const { status, assignee } = TAB_QUERY[tab]
      const page = await fetchSupportQueue(status, assignee, search, tag ?? undefined)
      setState({ status: 'ready', items: page.items, total: page.total })
    } catch {
      setState({ status: 'error' })
    }
  }, [tab, search, tag])

  useEffect(() => {
    void fetchTagCounts()
      .then(setCounts)
      .catch(() => undefined)
  }, [])

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

      <Tabs
        items={[
          { id: 'open', label: t('supportTabOpen') },
          { id: 'mine', label: t('supportTabMine') },
          { id: 'closed', label: t('supportTabClosed') },
        ]}
        active={tab}
        onSelect={setTab}
      />

      {/* «Мы это уже кому-то отвечали» — вопрос, который без поиска проверить негде. */}
      <input
        className="field"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('supportSearchPlaceholder')}
        aria-label={t('supportSearchPlaceholder')}
      />

      {/* Теги показываются только те, что реально встречались за месяц: полный список
          из семи чипов на телефоне занимает экран и половину времени врёт нулями. */}
      {counts.length > 0 && (
        <div className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={tag === null}
            onClick={() => {
              haptic.select()
              setTag(null)
            }}
          >
            {t('complaintsFilterAll')}
          </button>
          {counts.map((row) => (
            <button
              key={row.tag}
              type="button"
              className="chip"
              aria-pressed={tag === row.tag}
              onClick={() => {
                haptic.select()
                setTag((prev) => (prev === row.tag ? null : row.tag))
              }}
            >
              {t(SUPPORT_TAG_KEY[row.tag])} · {row.count}
            </button>
          ))}
        </div>
      )}

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
              <span className="avatar-sm" aria-hidden>
                {initials(authorName(ticket))}
              </span>
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
  | {
      status: 'ready'
      ticket: SupportTicket
      messages: SupportMessage[]
      mergedCount: number
      siblings: { id: string; createdAt: string; closed: boolean }[]
    }
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
      const { ticket, messages, mergedCount, siblings } = await fetchSupportThread(id)
      setState({
        status: 'ready',
        ticket,
        messages: [...messages].reverse(),
        mergedCount,
        siblings,
      })
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

  // Перевод обращения в жалобу. Человека выбирают поиском прямо здесь: имя обидчика
  // лежит в тексте обращения, и заставлять модератора уходить в раздел «Люди», запоминать
  // фамилию и возвращаться — ровно тот тупик, ради которого это и делалось.
  const [target, setTarget] = useState<{ query: string; found: Person[] } | null>(null)
  // Зависимость — строка запроса, а не сам объект: результат поиска кладётся в тот же
  // объект, и эффект, завязанный на него, перезапускал бы поиск от собственного ответа.
  const targetQuery = target?.query ?? null

  useEffect(() => {
    if (targetQuery === null || targetQuery.trim().length < 2) return
    const timer = setTimeout(() => {
      void searchPeople(targetQuery)
        .then((page) => setTarget((prev) => (prev ? { ...prev, found: page.items } : prev)))
        .catch(() => undefined)
    }, PERSON_SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [targetQuery])

  const fileComplaint = useCallback(
    async (person: Person) => {
      const name = `${person.lastName} ${person.firstName}`
      if (!(await confirmAction(t('supportComplaintConfirm', { name })))) return
      setError(null)
      try {
        await createComplaintFromSupport(id, person.id)
        haptic.success()
        setTarget(null)
        setError(t('supportComplaintCreated'))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('supportComplaintError'))
      }
    },
    [id],
  )

  // Тег снимается тем же касанием, каким ставится: отдельная кнопка «убрать» на чипе
  // не помещается, а «поставил не тот» — самая частая ошибка из трёх касаний.
  const toggleTag = useCallback(
    async (value: SupportTag) => {
      const current = state.status === 'ready' ? state.ticket.tags : []
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
      // Больше трёх сервер не примет: набор, означающий всё, не означает ничего.
      if (next.length > 3) {
        setError(t('supportTagsLimit'))
        return
      }
      setError(null)
      // Ставим сразу: отметка должна отзываться под пальцем, а не через круг по сети.
      setState((prev) =>
        prev.status === 'ready' ? { ...prev, ticket: { ...prev.ticket, tags: next } } : prev,
      )
      try {
        await setTicketTags(id, next)
        haptic.select()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('supportTagsError'))
        setState((prev) =>
          prev.status === 'ready' ? { ...prev, ticket: { ...prev.ticket, tags: current } } : prev,
        )
      }
    },
    [id, state],
  )

  // Голосовой ответ: на телефоне надиктовать быстрее, чем набрать, и именно этим
  // поддержка с телефона и занимается. Отправляем сразу по остановке записи — как в
  // чатах платформы: предпрослушивание на этом экране означало бы третью кнопку.
  const voice = useVoiceRecorder((file) => {
    setBusy(true)
    setError(null)
    void sendVoiceReply(id, file)
      .then(() => {
        haptic.success()
        return load()
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : t('supportVoiceError')),
      )
      .finally(() => setBusy(false))
  })

  // Склейка дублей. Список веток того же человека приходит вместе с перепиской: искать
  // дубль в очереди по фамилии и запоминать id — работа, которую делать незачем.
  const merge = useCallback(
    async (intoId: string, when: string) => {
      if (!(await confirmAction(t('supportMergeConfirm', { when })))) return
      setError(null)
      try {
        await mergeTicket(id, intoId)
        haptic.success()
        // Уходим в целевую ветку: эта закрыта и сама по себе больше не существует.
        onBack()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('supportMergeError'))
      }
    },
    [id, onBack],
  )

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

  // Набранный, но не отправленный ответ свайп вниз стирал молча — а набирают его на
  // телефоне долго. Спрашиваем подтверждение, только пока в поле что-то есть.
  useEffect(() => {
    setClosingConfirmation(text.trim().length > 0)
    return () => setClosingConfirmation(false)
  }, [text])

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

      {/* Кто спрашивает. Роль и вуз объясняют половину вопросов: «почему не вижу
          ведомость» от студента и от преподавателя — два разных ответа, а до карточки
          это выяснялось встречным вопросом и сутками ожидания. */}
      {ticket?.author && (
        <PersonSummary userId={ticket.author.id} title={t('supportAuthorTitle')} />
      )}

      {state.status === 'ready' && state.mergedCount > 0 && (
        <section className="card">
          <p className="hint">{t('supportMergedHere', { count: state.mergedCount })}</p>
        </section>
      )}

      {state.status === 'ready' && state.siblings.length > 0 && !ticket?.closedAt && (
        <section className="card">
          <h2>{t('supportMergeTitle')}</h2>
          <p className="hint">{t('supportMergeHint')}</p>
          <div className="chips">
            {state.siblings.map((sibling) => {
              const when = formatDateTime(sibling.createdAt)
              return (
                <button
                  key={sibling.id}
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => void merge(sibling.id, when)}
                >
                  {when}
                  {sibling.closed ? ` · ${t('supportMergeClosed')}` : ''}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* О чём обращение. Не для порядка: из этих отметок складывается ответ на
          «поддержка отвечает на одно и то же» — шестьдесят вопросов про доступ за месяц
          это задача продукту, а ощущение усталости — нет. */}
      {ticket && (
        <section className="card">
          <h2>{t('supportTagsTitle')}</h2>
          <div className="chips">
            {SUPPORT_TAGS.map((value) => (
              <button
                key={value}
                type="button"
                className="chip"
                aria-pressed={ticket.tags.includes(value)}
                disabled={busy}
                onClick={() => void toggleTag(value)}
              >
                {t(SUPPORT_TAG_KEY[value])}
              </button>
            ))}
          </div>
          <p className="hint">{t('supportTagsHint')}</p>
        </section>
      )}

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
        <section className="thread">
          {state.messages.map((message) => {
            // «Своё» здесь — сказанное командой платформы: экран читает поддержка, и её
            // реплики должны отличаться от реплик человека, которому отвечают. Автор
            // обращения известен из карточки, остальные участники — команда.
            const fromStaff = ticket?.author ? message.sender.id !== ticket.author.id : false
            return (
              <div key={message.id} className={fromStaff ? 'bubble mine' : 'bubble theirs'}>
                {!fromStaff && <span className="bubble-author">{message.sender.firstName}</span>}
                <span>{message.content}</span>
                {/* Вложение объясняет больше абзаца текста; скачать его из мини-аппа
                    нельзя, но знать, что оно есть, модератор обязан. */}
                {message.media && message.media.length > 0 && (
                  <span className="bubble-meta">
                    {t('supportAttachments', { count: message.media.length })}
                  </span>
                )}
                <span className="bubble-meta">{formatShortTime(message.createdAt)}</span>
              </div>
            )
          })}
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
        {/* Запись идёт — на экране только «отправить» и «отменить»: любая третья кнопка
            в этот момент нажимается случайно. */}
        {voice.supported &&
          (voice.recording ? (
            <div className="chips">
              <button type="button" className="chip" onClick={voice.stop}>
                {t('supportVoiceSend', { seconds: voice.seconds })}
              </button>
              <button type="button" className="chip" onClick={voice.cancel}>
                {t('supportVoiceCancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="fallback-submit secondary"
              disabled={busy}
              onClick={() => {
                haptic.tap()
                void voice.start().catch(() => setError(t('supportVoiceDenied')))
              }}
            >
              {t('supportVoice')}
            </button>
          ))}

        {ticket && !ticket.assigneeId && !ticket.closedAt && (
          <button
            type="button"
            className="fallback-submit secondary"
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
              className="fallback-submit secondary"
              disabled={busy}
              onClick={() => void escalate()}
            >
              {t('supportEscalate')}
            </button>
            {/* Жалоба из обращения: автором сервер сделает автора обращения, а не
                поддержку — жаловался он, и в очереди должно быть видно именно это. */}
            <button
              type="button"
              className="fallback-submit secondary"
              disabled={busy}
              onClick={() => {
                haptic.tap()
                setTarget((prev) => (prev ? null : { query: '', found: [] }))
              }}
            >
              {t('supportToComplaint')}
            </button>
            <button type="button" className="fallback-submit danger" onClick={() => void finish()}>
              {t('supportClose')}
            </button>
          </>
        )}
      </section>

      {target !== null && (
        <section className="card">
          <h2>{t('supportComplaintTarget')}</h2>
          <input
            className="field"
            placeholder={t('peopleSearchPlaceholder')}
            aria-label={t('supportComplaintTarget')}
            autoCapitalize="off"
            autoCorrect="off"
            value={target.query}
            onChange={(event) => setTarget({ query: event.target.value, found: target.found })}
          />
          {target.found.length === 0 && <p className="hint">{t('supportComplaintHint')}</p>}
          {target.found.map((person) => (
            <button
              key={person.id}
              type="button"
              className="row"
              onClick={() => void fileComplaint(person)}
            >
              <span className="row-body">
                <b>
                  {person.lastName} {person.firstName}
                </b>
                <span className="hint">{person.email}</span>
              </span>
            </button>
          ))}
        </section>
      )}
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
