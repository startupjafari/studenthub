import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchComplaints,
  fetchResolutionMedian,
  type Complaint,
  type ComplaintPage,
  type ComplaintPriority,
} from '../api/complaints'
import { ComplaintScreen } from './complaint'
import { haptic } from '../telegram/webapp'
import { Tabs } from '../ui/tabs'
import { t } from '../i18n'
import { usePullToRefresh } from '../telegram/use-pull-to-refresh'
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

// Три уровня — три цвета: красный у срочного, акцентный у обычного, серый у низкого.
const PRIORITY_TONE: Record<ComplaintPriority, string> = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: '',
}

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

  // Потянуть вниз — перезапросить очередь: до этого она обновлялась только повторным
  // открытием приложения.
  const { pull, ready, progress } = usePullToRefresh(load)

  if (openId !== null) {
    return (
      <ComplaintScreen
        id={openId}
        onBack={() => {
          setOpenId(null)
          void load()
        }}
      />
    )
  }

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
      <header className="screen-head">
        <h1>{t('complaintsTitle')}</h1>
        <p className="hint">
          {state.status === 'ready' ? summary(state.page, tab, median) : t('complaintsSubtitle')}
        </p>
      </header>

      <Tabs
        items={[
          { id: 'open', label: t('complaintsTabOpen') },
          { id: 'done', label: t('complaintsTabDone') },
        ]}
        active={tab}
        onSelect={setTab}
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
        <section className="card">
          <p>{t('complaintsLoadError')}</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            {t('retry')}
          </button>
        </section>
      )}

      {state.status === 'ready' && state.page.items.length === 0 && (
        <EmptyState tab={tab} filtered={priority !== null} />
      )}

      {state.status === 'ready' && state.page.items.length > 0 && (
        <ComplaintList items={state.page.items} onOpen={setOpenId} />
      )}
    </div>
  )
}

/**
 * Список с разделителями по дням. Сплошная лента отметок времени не отвечает на вопрос
 * «это сегодняшнее или лежит с прошлой недели», а он важнее самого времени.
 */
function ComplaintList({ items, onOpen }: { items: Complaint[]; onOpen: (id: string) => void }) {
  const groups = useMemo(() => groupByDay(items), [items])

  return (
    <>
      {groups.map((group) => (
        <section className="list" key={group.label}>
          <p className="list-day">{group.label}</p>
          {group.items.map((complaint) => (
            <button
              key={complaint.id}
              type="button"
              className="row"
              onClick={() => {
                haptic.tap()
                onOpen(complaint.id)
              }}
            >
              {/* Цвет считывается до чтения: «что горит» видно, не читая строку.
                  Слово «Срочно» остаётся ниже — для читалок и для тех, кто цвет не
                  различает, точка ничего не значит. */}
              <span className={`priority-dot ${PRIORITY_TONE[complaint.priority]}`} aria-hidden />
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
                ›
              </span>
            </button>
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
    return (
      <section className="card">
        <h2>{t('complaintsEmptyTitle')}</h2>
        <p className="hint">{t('complaintsDoneEmpty')}</p>
      </section>
    )
  }
  return (
    <section className="card">
      <h2>{filtered ? t('complaintsQueueEmpty') : t('complaintsNeverTitle')}</h2>
      <p className="hint">{filtered ? t('complaintsEmptyText') : t('complaintsNeverText')}</p>
    </section>
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

function SkeletonList() {
  // Скелетон, а не спиннер: высота строк известна заранее, и список не прыгает,
  // когда данные приезжают.
  return (
    <section className="list" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
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
