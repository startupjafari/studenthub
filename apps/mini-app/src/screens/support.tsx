import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
import { useBackButton } from '../telegram/use-telegram'
import { t } from '../i18n'
import {
  IconBell,
  IconCheck,
  IconChevron,
  IconComplaints,
  IconMic,
  IconSend,
  IconTargetUser,
} from '../ui/icons'
import { Tile, type TileTone } from '../ui/tile'
import { SearchField } from '../ui/search-field'
import { dayLabel, formatDateTime, formatShortTime, initials } from '../lib/format'
import { PersonSummary } from './person-summary'
import { Tabs } from '../ui/tabs'
import { ScreenHeader } from '../ui/screen-header'
import { StatePlate } from '../ui/state-plate'
import { SkeletonList } from '../ui/skeleton'
import { useVoiceRecorder } from '../telegram/use-voice'
import { navigate } from '../lib/navigate'

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
    <QueueView onOpen={(ticket) => navigate(() => setScreen({ kind: 'thread', id: ticket.id }))} />
  ) : (
    <ThreadView
      id={screen.id}
      onBack={() => navigate(() => setScreen({ kind: 'queue' }), 'back')}
    />
  )
}

type QueueState =
  { status: 'loading' } | { status: 'ready'; items: SupportTicket[] } | { status: 'error' }

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
      setState({ status: 'ready', items: page.items })
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
      <ScreenHeader
        title={t('supportTitle')}
        tabs={
          <Tabs
            items={[
              { id: 'open', label: t('supportTabOpen') },
              { id: 'mine', label: t('supportTabMine') },
              { id: 'closed', label: t('supportTabClosed') },
            ]}
            active={tab}
            onSelect={setTab}
          />
        }
      />

      {/* «Мы это уже кому-то отвечали» — вопрос, который без поиска проверить негде. */}
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t('supportSearchPlaceholder')}
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
        <StatePlate title={t('supportLoadError')} onRetry={() => void load()} />
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <StatePlate
          title={t('supportEmptyTitle')}
          text={tab === 'open' ? t('supportEmptyText') : t('supportClosedEmptyText')}
        />
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
                <IconChevron size={17} />
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

  // Поле растёт вместе с текстом, как в Telegram: до пяти строк, дальше прокрутка внутри.
  // Одна строка в покое — пустое поле в три строки занимало треть экрана переписки.
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  // Пока переписка грузится, автора мы ещё не знаем: экран открывается и по ссылке из
  // уведомления, где очереди с его именем не было.
  const ticket = state.status === 'ready' ? state.ticket : null

  return (
    <div className="screen">
      <ScreenHeader title={ticket ? authorName(ticket) : t('supportThreadTitle')} />

      {/* Когда обращение открыли — строкой в карточке, а не подписью под названием
          экрана: это сведение об обращении, и место ему рядом с остальными такими же. */}
      {ticket && (
        <section className="card">
          <p className="hint">{t('supportOpenedAt', { when: formatDateTime(ticket.createdAt) })}</p>
        </section>
      )}

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

      {/* Действия с обращением — строками с плитками, как рычаги в «Управлении», а не
          стопкой одинаковых кнопок: нужное находят по цвету и значку, не читая все четыре. */}
      {ticket && !ticket.closedAt && (
        <section className="list">
          {!ticket.assigneeId && (
            <ActionRow
              tone="blue"
              icon={<IconTargetUser size={17} />}
              disabled={busy}
              onClick={() => void take()}
            >
              {t('supportAssign')}
            </ActionRow>
          )}
          <ActionRow
            tone="orange"
            icon={<IconBell size={17} />}
            disabled={busy}
            onClick={() => void escalate()}
          >
            {t('supportEscalate')}
          </ActionRow>
          {/* Жалоба из обращения: автором сервер сделает автора обращения, а не
              поддержку — жаловался он, и в очереди должно быть видно именно это. */}
          <ActionRow
            tone="red"
            icon={<IconComplaints size={17} />}
            disabled={busy}
            pressed={target !== null}
            onClick={() => setTarget((prev) => (prev ? null : { query: '', found: [] }))}
          >
            {t('supportToComplaint')}
          </ActionRow>
          <ActionRow
            tone="gray"
            icon={<IconCheck size={17} />}
            disabled={busy}
            onClick={() => void finish()}
          >
            {t('supportClose')}
          </ActionRow>
        </section>
      )}

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
          {state.messages.map((message, index) => {
            // «Своё» здесь — сказанное командой платформы: экран читает поддержка, и её
            // реплики должны отличаться от реплик человека, которому отвечают. Автор
            // обращения известен из карточки, остальные участники — команда.
            const fromStaff = ticket?.author ? message.sender.id !== ticket.author.id : false
            // Разделитель дня — плашкой по центру, как в Telegram: переписка поддержки
            // тянется днями, и «вчера» против «сегодня» меняет смысл «ответили быстро».
            const day = dayLabel(message.createdAt)
            const prev = state.messages[index - 1]
            const newDay = !prev || dayLabel(prev.createdAt) !== day
            return (
              <Fragment key={message.id}>
                {newDay && <span className="thread-day">{day}</span>}
                <div className={fromStaff ? 'bubble mine' : 'bubble theirs'}>
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
              </Fragment>
            )
          })}
        </section>
      )}

      {error && (
        <section className="card">
          <p className="hint-danger">{error}</p>
        </section>
      )}

      {/* Поле ввода — последним и прилипает к низу, над панелью разделов: как в Telegram,
          ответ пишут там, где кончается переписка, а не в карточке посреди экрана.
          Круглая кнопка справа — микрофон, пока поле пустое, и «отправить», как только
          в нём появился текст: одна кнопка на одно место, без третьей рядом. */}
      {!ticket?.closedAt && (
        <div className="composer">
          {/* Заготовка подставляется в поле, а не отправляется: это начало ответа. */}
          <div className="composer-templates">
            {REPLY_TEMPLATES.map((template) => (
              <button
                key={template.key}
                type="button"
                className="chip"
                disabled={busy || voice.recording}
                onClick={() => {
                  haptic.select()
                  setText(t(template.textKey))
                  fieldRef.current?.focus()
                }}
              >
                {t(template.labelKey)}
              </button>
            ))}
          </div>
          {voice.recording ? (
            // Запись идёт — только «отменить» и «отправить»: любая третья кнопка в этот
            // момент нажимается случайно.
            <div className="composer-row recording">
              <span className="rec-dot" aria-hidden />
              <span className="composer-rec">
                {t('supportRecording', { seconds: voice.seconds })}
              </span>
              <button type="button" className="composer-text-btn" onClick={voice.cancel}>
                {t('supportVoiceCancel')}
              </button>
              <button
                type="button"
                className="composer-round"
                aria-label={t('supportVoiceSend', { seconds: voice.seconds })}
                onClick={voice.stop}
              >
                <IconSend size={20} />
              </button>
            </div>
          ) : (
            <div className="composer-row">
              <textarea
                ref={fieldRef}
                className="composer-field"
                rows={1}
                placeholder={t('supportReplyPlaceholder')}
                aria-label={t('supportReplyPlaceholder')}
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
              />
              {text.trim().length > 0 || !voice.supported ? (
                <button
                  type="button"
                  className="composer-round"
                  aria-label={t('supportReply')}
                  disabled={busy || text.trim().length === 0}
                  onClick={() => void send()}
                >
                  <IconSend size={20} />
                </button>
              ) : (
                <button
                  type="button"
                  className="composer-round quiet"
                  aria-label={t('supportVoice')}
                  disabled={busy}
                  onClick={() => {
                    haptic.tap()
                    void voice.start().catch(() => setError(t('supportVoiceDenied')))
                  }}
                >
                  <IconMic size={20} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Строка действия: плитка со значком и подпись — как раздел пульта. */
function ActionRow({
  tone,
  icon,
  disabled,
  pressed,
  onClick,
  children,
}: {
  tone: TileTone
  icon: ReactNode
  disabled?: boolean
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="row"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={() => {
        haptic.tap()
        onClick()
      }}
    >
      <Tile tone={tone}>{icon}</Tile>
      <span className="row-body">
        <b>{children}</b>
      </span>
      <span className="row-chevron" aria-hidden>
        <IconChevron size={17} />
      </span>
    </button>
  )
}

function authorName(ticket: SupportTicket): string {
  return ticket.author
    ? `${ticket.author.lastName} ${ticket.author.firstName}`
    : t('supportDeletedAccount')
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}
