import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  fetchComplaints,
  fetchResolutionMedian,
  resolveComplaint,
  takeComplaint,
  type Complaint,
  type ComplaintPage,
  type ComplaintPriority,
  type ComplaintTarget,
} from '../api/complaints'
import { ComplaintScreen } from './complaint'
import { haptic } from '../telegram/webapp'
import { Tabs } from '../ui/tabs'
import { ScreenHeader } from '../ui/screen-header'
import { StatePlate } from '../ui/state-plate'
import { SkeletonList } from '../ui/skeleton'
import { t } from '../i18n'
import {
  IconChevron,
  IconTargetComment,
  IconTargetMessage,
  IconTargetPost,
  IconTargetStory,
  IconTargetUser,
} from '../ui/icons'
import { Tile, type TileTone } from '../ui/tile'
import { SwipeRow } from '../ui/swipe-row'
import { usePullToRefresh } from '../telegram/use-pull-to-refresh'
import { navigate } from '../lib/navigate'
import { dayLabel, formatAge, formatHours, formatShortTime } from '../lib/format'

// Очередь модерации — то, ради чего мини-апп существует: разобрать жалобу с телефона,
// не дожидаясь возвращения к столу.
//
// Порядок строк задаёт сервер: необработанные раньше, внутри — по приоритету, внутри —
// свежие. Своей сортировки здесь нет намеренно, иначе очередь в телефоне и очередь в
// веб-админке разъехались бы, и двое модераторов разбирали бы разное. Фильтр по приоритету
// сортировку не меняет — он только сужает выборку, и делает это сервер.

const PRIORITY_KEY = {
  HIGH: 'priorityHigh',
  MEDIUM: 'priorityMedium',
  LOW: 'priorityLow',
} as const

const TARGET_KEY = {
  USER: 'targetUser',
  MESSAGE: 'targetMessage',
  POST: 'targetPost',
  STORY: 'targetStory',
  COMMENT: 'targetComment',
} as const

const PRIORITIES: ComplaintPriority[] = ['HIGH', 'MEDIUM', 'LOW']

// Приоритет — цветом плитки: красная у срочного, оранжевая у обычного, серая у низкого.
// Цвет считывается до чтения — «что горит» видно, не читая строку, — а слово остаётся в
// подписи для читалок и для тех, кто цвет не различает.
const PRIORITY_TONE: Record<ComplaintPriority, TileTone> = {
  HIGH: 'red',
  MEDIUM: 'orange',
  LOW: 'gray',
}

// Что обжаловано — рисунком в плитке: пост, история и человек в очереди выглядят по-разному.
const TARGET_ICON: Record<ComplaintTarget, () => ReactNode> = {
  POST: () => <IconTargetPost size={17} />,
  STORY: () => <IconTargetStory size={17} />,
  COMMENT: () => <IconTargetComment size={17} />,
  MESSAGE: () => <IconTargetMessage size={17} />,
  USER: () => <IconTargetUser size={17} />,
}

/** Сколько висит «Отменить» после свайпа, прежде чем решение уйдёт на сервер. */
const UNDO_MS = 4000

type Tab = 'open' | 'done'

type State = { status: 'loading' } | { status: 'ready'; page: ComplaintPage } | { status: 'error' }

/** `initialId` — жалоба из ссылки в уведомлении: открываем её сразу, минуя очередь. */
export function ComplaintsScreen({ initialId }: { initialId?: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [tab, setTab] = useState<Tab>('open')
  const [priority, setPriority] = useState<ComplaintPriority | null>(null)
  // Открытая карточка. Возврат из неё перезапрашивает очередь: за время разбора её мог
  // изменить второй модератор, а разобранной жалобы в ней уже нет.
  const [openId, setOpenId] = useState<string | null>(initialId ?? null)
  // Разбор подряд: порядок очереди на момент входа в первую карточку и сколько разобрано.
  // Снимок, а не живой список: пока модератор решает, второй мог разобрать соседнюю
  // жалобу, и живой порядок сдвигался бы у него под пальцем. Жалоба, которую уже
  // разобрал кто-то другой, ответит отказом сервера — это видно на её карточке.
  const [triage, setTriage] = useState<{ ids: string[]; done: number } | null>(null)
  // Свайп «нарушения нет» не уходит на сервер сразу: строка пропадает, внизу четыре
  // секунды висит «Отменить», и только потом отправляется решение. Отмена после отправки
  // была бы уже переоткрытием жалобы — отдельным событием в журнале, а не «ой, не то».
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [toast, setToast] = useState<{ id: string; text: string; undo?: () => void } | null>(null)
  const pending = useRef<{ id: string; timer: number } | null>(null)
  // Медиана времени разбора. Живёт рядом с разобранными: очередь отвечает на «сколько
  // осталось», а медиана — на «быстро ли команда с этим справляется». Считается за
  // месяц по всем жалобам, поэтому фильтр приоритета её не трогает.
  const [median, setMedian] = useState<number | null>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const page = await fetchComplaints({
        status: tab === 'open' ? 'PENDING' : 'RESOLVED',
        ...(priority ? { priority } : {}),
      })
      setState({ status: 'ready', page })
      // Скрытой остаётся только та, чьё решение ещё ждёт отправки: остальные либо уже
      // ушли из очереди на сервере, либо вернулись по отмене.
      setHidden(pending.current ? new Set([pending.current.id]) : new Set())
    } catch {
      setState({ status: 'error' })
    }
  }, [tab, priority])

  useEffect(() => {
    void load()
  }, [load])

  // Тянем один раз при переходе на вкладку и молчим по отказу: список разобранных важнее
  // цифры над ним, и ронять экран ради неё нельзя.
  useEffect(() => {
    if (tab !== 'done' || median !== null) return
    fetchResolutionMedian()
      .then((hours) => setMedian(hours))
      .catch(() => undefined)
  }, [tab, median])

  const restore = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Отправить отложенное решение сейчас. Зовётся по таймеру, перед следующим свайпом и
  // при уходе с экрана: закрыть очередь — не значит передумать.
  const commitPending = useCallback(() => {
    const p = pending.current
    if (!p) return
    window.clearTimeout(p.timer)
    pending.current = null
    setToast((current) => (current?.id === p.id ? null : current))
    resolveComplaint(p.id, 'DISMISS').catch(() => {
      haptic.error()
      restore(p.id)
      setToast({ id: p.id, text: t('complaintSwipeFailed') })
    })
  }, [restore])

  useEffect(() => () => commitPending(), [commitPending])

  const dismissBySwipe = useCallback(
    (id: string) => {
      commitPending()
      haptic.success()
      setHidden((prev) => new Set(prev).add(id))
      const timer = window.setTimeout(commitPending, UNDO_MS)
      pending.current = { id, timer }
      setToast({
        id,
        text: t('complaintSwipeDismissed'),
        undo: () => {
          window.clearTimeout(timer)
          pending.current = null
          haptic.select()
          restore(id)
          setToast(null)
        },
      })
    },
    [commitPending, restore],
  )

  const takeBySwipe = useCallback(
    (id: string) => {
      takeComplaint(id)
        .then(() => {
          haptic.success()
          setToast({ id, text: t('complaintSwipeTaken') })
          window.setTimeout(() => setToast((c) => (c?.id === id && !c.undo ? null : c)), 2500)
          void load()
        })
        .catch(() => {
          haptic.error()
          setToast({ id, text: t('complaintTakeError') })
        })
    },
    [load],
  )

  // Потянуть вниз — перезапросить очередь: до этого она обновлялась только повторным
  // открытием приложения.
  const { pull, ready, progress } = usePullToRefresh(load)

  const open = (id: string): void => {
    // Подряд разбирают только очередь: у разобранных решения уже приняты.
    if (tab === 'open' && state.status === 'ready') {
      setTriage({ ids: state.page.items.map((item) => item.id), done: 0 })
    }
    navigate(() => setOpenId(id))
  }

  const backToList = (): void => {
    navigate(() => {
      setOpenId(null)
      setTriage(null)
    }, 'back')
    void load()
  }

  if (openId !== null) {
    const ids = triage?.ids ?? []
    const at = ids.indexOf(openId)
    const inTriage = triage !== null && at >= 0

    // Следующая после решения: разобранная уходит из снимка, и на её месте оказывается
    // следующая. Пропущенная остаётся — к ней можно вернуться из списка.
    const advance = (resolved: boolean): void => {
      if (!triage || at < 0) return backToList()
      const rest = resolved ? ids.filter((value) => value !== openId) : ids
      const next = resolved ? rest[at] : ids[at + 1]
      if (!next) return backToList()
      // Следующая въезжает тем же движением, что открытие из списка: это шаг вперёд
      // по очереди, а не возврат.
      navigate(() => {
        setTriage({ ids: rest, done: triage.done + (resolved ? 1 : 0) })
        setOpenId(next)
        window.scrollTo({ top: 0 })
      })
    }

    return (
      <ComplaintScreen
        // key — чтобы следующая жалоба открылась с чистого листа: комментарий, код и срок
        // блокировки от прошлой не должны перейти на неё.
        key={openId}
        id={openId}
        onBack={backToList}
        onDone={() => advance(true)}
        onSkip={inTriage && at < ids.length - 1 ? () => advance(false) : undefined}
        triage={inTriage ? { done: triage.done, left: ids.length - at } : undefined}
      />
    )
  }

  // То, что видно: без строки, чьё решение ждёт отправки. Пустота считается по ней же —
  // иначе, смахнув последнюю жалобу, человек видел бы пустой экран без «очередь разобрана».
  const visible = state.status === 'ready' ? state.page.items.filter((i) => !hidden.has(i.id)) : []

  return (
    <div className="screen" style={{ paddingTop: pull }}>
      {pull > 0 && (
        <p
          className={`pull-hint${ready ? ' ready' : ''}`}
          style={{ opacity: progress, transform: `scale(${0.7 + 0.3 * progress})` }}
        >
          {ready ? '↻' : '↓'}
        </p>
      )}
      <ScreenHeader
        title={t('complaintsTitle')}
        subtitle={
          state.status === 'ready' ? summary(state.page, tab, median) : t('complaintsSubtitle')
        }
        tabs={
          <Tabs
            items={[
              { id: 'open', label: t('complaintsTabOpen') },
              { id: 'done', label: t('complaintsTabDone') },
            ]}
            active={tab}
            onSelect={setTab}
          />
        }
      />

      <div className="chips-grid">
        <button
          type="button"
          className="chip"
          aria-pressed={priority === null}
          onClick={() => {
            haptic.select()
            setPriority(null)
          }}
        >
          {t('complaintsFilterAll')}
        </button>
        {PRIORITIES.map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={priority === value}
            onClick={() => {
              haptic.select()
              setPriority(value)
            }}
          >
            {t(PRIORITY_KEY[value])}
          </button>
        ))}
      </div>

      {state.status === 'loading' && <SkeletonList />}

      {state.status === 'error' && (
        <StatePlate title={t('complaintsLoadError')} onRetry={() => void load()} />
      )}

      {state.status === 'ready' && visible.length === 0 && (
        <EmptyState tab={tab} filtered={priority !== null} />
      )}

      {state.status === 'ready' && visible.length > 0 && (
        <ComplaintList
          items={visible}
          onOpen={open}
          // Разобранные свайпами не решают: решение там уже принято.
          swipes={tab === 'open' ? { dismiss: dismissBySwipe, take: takeBySwipe } : undefined}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="toast-action" onClick={toast.undo}>
              {t('swipeUndo')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Список с разделителями по дням. Сплошная лента отметок времени не отвечает на вопрос
 * «это сегодняшнее или лежит с прошлой недели», а он важнее самого времени.
 */
function ComplaintList({
  items,
  onOpen,
  swipes,
}: {
  items: Complaint[]
  onOpen: (id: string) => void
  swipes?: { dismiss: (id: string) => void; take: (id: string) => void }
}) {
  const groups = useMemo(() => groupByDay(items), [items])

  return (
    <>
      {groups.map((group) => (
        <section className="list" key={group.label}>
          <p className="list-day">{group.label}</p>
          {group.items.map((complaint) => (
            <SwipeRow
              key={complaint.id}
              // Влево — «нарушения нет» (с отменой), вправо — «беру в работу». Взятую
              // другим брать уже нечего — у неё правого свайпа нет.
              right={
                swipes
                  ? {
                      label: t('complaintDismiss'),
                      tone: 'neutral',
                      onCommit: () => swipes.dismiss(complaint.id),
                    }
                  : undefined
              }
              left={
                swipes && !complaint.reviewingBy
                  ? {
                      label: t('complaintTake'),
                      tone: 'accent',
                      onCommit: () => swipes.take(complaint.id),
                    }
                  : undefined
              }
            >
              <button
                type="button"
                className="row"
                onClick={() => {
                  haptic.tap()
                  onOpen(complaint.id)
                }}
              >
                <Tile tone={PRIORITY_TONE[complaint.priority]}>
                  {TARGET_ICON[complaint.targetType]()}
                </Tile>
                <span className="row-body">
                  <b>{t(TARGET_KEY[complaint.targetType])}</b>
                  {/* Текст жалобы — чужие слова о третьем лице: показываем первую строку,
                    целиком он читается на карточке, где рядом есть контекст. */}
                  <span className="hint">{firstLine(complaint.reason)}</span>
                  <span className="hint">
                    {t(PRIORITY_KEY[complaint.priority])} · {formatShortTime(complaint.createdAt)}
                  </span>
                </span>
                <span className="row-chevron" aria-hidden>
                  <IconChevron size={17} />
                </span>
              </button>
            </SwipeRow>
          ))}
        </section>
      ))}
    </>
  )
}

/**
 * Пустых состояний три, и они говорят разное: «разобрано» — заслуга, «никто не жаловался» —
 * свойство молодой платформы, «под фильтр ничего не попало» — подсказка снять фильтр.
 * Один текст на все три случая врал бы в двух из них.
 */
function EmptyState({ tab, filtered }: { tab: Tab; filtered: boolean }) {
  if (tab === 'done') {
    return <StatePlate title={t('complaintsEmptyTitle')} text={t('complaintsDoneEmpty')} />
  }
  return (
    <StatePlate
      title={filtered ? t('complaintsQueueEmpty') : t('complaintsNeverTitle')}
      text={filtered ? t('complaintsEmptyText') : t('complaintsNeverText')}
    />
  )
}

/**
 * Подзаголовок очереди. Кроме числа показывает, сколько ждёт самая старая жалоба, — но
 * только когда вся очередь уместилась на странице: иначе «самая старая» оказалась бы самой
 * старой из загруженных, то есть неправдой.
 */
function summary(page: ComplaintPage, tab: Tab, median: number | null): string {
  if (tab === 'done') {
    return median === null
      ? t('complaintsTabDone')
      : t('complaintsMedian', { value: formatHours(median) })
  }
  if (page.total === 0) return t('complaintsQueueEmpty')

  const counted = t('complaintsInQueue', { count: page.total })
  if (page.items.length < page.total) return counted

  const oldest = page.items.reduce(
    (min, item) => Math.min(min, new Date(item.createdAt).getTime()),
    Date.now(),
  )
  return `${counted} · ${t('complaintsOldest', { age: formatAge(oldest) })}`
}

function groupByDay(items: Complaint[]): { label: string; items: Complaint[] }[] {
  const groups: { label: string; items: Complaint[] }[] = []
  for (const item of items) {
    const label = dayLabel(item.createdAt)
    const last = groups.at(-1)
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

function firstLine(reason: string): string {
  const line = reason.split('\n')[0] ?? ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}
