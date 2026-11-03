'use client'

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, Clock, MapPin, Newspaper, Video } from 'lucide-react'
import type { StoryElementInput } from '@studenthub/shared-schemas'
import { cn } from '../../../shared/lib/utils'
import type { StoryElement, StoryEventCard, StoryPairCard, StoryPostCard } from '../model/types'

// Размер шрифта — в процентах ширины кадра (`cqw`, контейнер — слой элементов): одна и та
// же сторис одинаково выглядит в превью редактора, на телефоне и в колонке на десктопе.
const BASE_CQW = { text: 6, emoji: 14, mention: 5, event: 3.6, post: 3.6, schedule: 3.6 } as const

/**
 * Элемент в любом виде: из запроса, из выдачи (с данными карточки) или из редактора (с
 * превью карточки, выбранной в окне). Данные карточки — необязательные поля: нет их —
 * карточка ещё не собрана, `null` — запись зрителю недоступна.
 */
export type AnyStoryElement = StoryElementInput & {
  name?: string
  event?: StoryEventCard | null
  post?: StoryPostCard | null
  pair?: StoryPairCard | null
}

/** Карточка-стикер: белая плашка с меткой вида сверху и действиями снизу. */
function CardShell({
  icon: Icon,
  label,
  fontSize,
  children,
  actions,
}: {
  icon: typeof CalendarDays
  label: string
  fontSize: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <span
      className="flex w-[62cqw] flex-col gap-[0.35em] rounded-[0.9em] bg-white/95 p-[0.9em] text-left text-black shadow-lg"
      style={{ fontSize }}
    >
      <span className="flex items-center gap-[0.35em] text-[0.8em] font-semibold text-black/60 uppercase">
        <Icon className="size-[1.1em]" aria-hidden />
        {label}
      </span>
      {children}
      {actions}
    </span>
  )
}

/** День карточки пары: дата из стикера в локали зрителя («пн, 2 нояб.»). */
function dayLabel(date: string, locale: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

const FONT_CLASS = { sans: 'font-sans', serif: 'font-serif', mono: 'font-mono' } as const
const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

/** Светлый ли цвет текста — подложка «плотная» берётся контрастной к нему. */
function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}

/** Где стоит элемент: центр — в долях кадра, плюс поворот. Размер задаёт шрифт. */
export function storyElementPlacement(
  element: Pick<StoryElementInput, 'x' | 'y' | 'rotation'>,
): CSSProperties {
  return {
    left: `${element.x * 100}%`,
    top: `${element.y * 100}%`,
    transform: `translate(-50%, -50%) rotate(${element.rotation}deg)`,
  }
}

/** Правка текста прямо на кадре (редактор сторис). */
export interface StoryTextEditing {
  label: string
  maxLength: number
  onInput: (text: string) => void
  onDone: () => void
}

/**
 * Сам элемент без позиционирования: текст с подложкой, эмодзи или плашка отметки. Общий
 * для просмотра и для редактора — там его оборачивают в перетаскиваемую рамку.
 */
export function StoryElementBody({
  element,
  mentionName,
  actions,
  editing,
}: {
  element: AnyStoryElement | StoryElement
  /** Имя отметки: в выдаче его кладёт сервер, в редакторе — выбор из поиска. */
  mentionName?: string
  /** Кнопки карточки-стикера (в просмотре; в редакторе их нет). */
  actions?: ReactNode
  /**
   * Текст правят прямо на кадре: тот же элемент с теми же классами становится полем ввода,
   * поэтому перенос строк при наборе ровно такой, как после публикации.
   */
  editing?: StoryTextEditing
}): ReactNode {
  const t = useTranslations('Stories')
  const locale = useLocale()
  const fontSize = `${BASE_CQW[element.type] * element.scale}cqw`
  if (element.type === 'event') {
    const event = 'event' in element ? element.event : undefined
    return (
      <CardShell
        icon={CalendarDays}
        label={t('eventLabel')}
        fontSize={fontSize}
        actions={event ? actions : undefined}
      >
        {event ? (
          <>
            <span className="line-clamp-2 text-[1.15em] leading-tight font-bold">
              {event.title}
            </span>
            <span className="text-[0.9em] text-black/70">
              {new Date(event.startsAt).toLocaleString(locale, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {(event.location || event.isOnline) && (
              <span className="flex items-center gap-[0.3em] text-[0.9em] text-black/70">
                {event.isOnline ? (
                  <Video className="size-[1em] shrink-0" aria-hidden />
                ) : (
                  <MapPin className="size-[1em] shrink-0" aria-hidden />
                )}
                <span className="truncate">{event.location ?? t('online')}</span>
              </span>
            )}
          </>
        ) : (
          <span className="text-[0.95em] text-black/60">{t('eventUnavailable')}</span>
        )}
      </CardShell>
    )
  }
  if (element.type === 'post') {
    const post = 'post' in element ? element.post : undefined
    return (
      <CardShell
        icon={Newspaper}
        label={t('postLabel')}
        fontSize={fontSize}
        actions={post ? actions : undefined}
      >
        {post ? (
          <>
            <span className="text-[0.85em] font-semibold text-black/70">{post.authorName}</span>
            {post.title && (
              <span className="line-clamp-2 text-[1.1em] leading-tight font-bold">
                {post.title}
              </span>
            )}
            <span className="line-clamp-3 text-[0.9em] text-black/80">{post.excerpt}</span>
          </>
        ) : (
          <span className="text-[0.95em] text-black/60">{t('postUnavailable')}</span>
        )}
      </CardShell>
    )
  }
  if (element.type === 'schedule') {
    const pair = 'pair' in element ? element.pair : undefined
    return (
      <CardShell
        icon={Clock}
        label={t('pairLabel')}
        fontSize={fontSize}
        actions={pair ? actions : undefined}
      >
        {pair ? (
          <>
            <span className="text-[0.9em] font-semibold text-black/70">
              {dayLabel(element.date, locale)} · {pair.startTime}–{pair.endTime}
            </span>
            <span className="line-clamp-2 text-[1.15em] leading-tight font-bold">
              {pair.subject}
            </span>
            {(pair.room || pair.group) && (
              <span className="text-[0.9em] text-black/70">
                {[pair.room, pair.group].filter(Boolean).join(' · ')}
              </span>
            )}
          </>
        ) : (
          <span className="text-[0.95em] text-black/60">{t('pairUnavailable')}</span>
        )}
      </CardShell>
    )
  }
  if (element.type === 'emoji') {
    return (
      <span className="block leading-none select-none" style={{ fontSize }}>
        {element.emoji}
      </span>
    )
  }
  if (element.type === 'mention') {
    const name = mentionName ?? ('name' in element ? element.name : '')
    return (
      <span
        className="block rounded-full bg-white/90 px-[0.6em] py-[0.25em] font-semibold whitespace-nowrap text-black shadow-sm"
        style={{ fontSize }}
      >
        @{name}
      </span>
    )
  }
  const className = cn(
    'block max-w-[80cqw] leading-tight font-semibold break-words whitespace-pre-wrap',
    FONT_CLASS[element.font],
    ALIGN_CLASS[element.align],
    element.background === 'none' && 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]',
    element.background !== 'none' && 'rounded-[0.3em] px-[0.45em] py-[0.15em]',
    element.background === 'solid' && (isLight(element.color) ? 'bg-black/75' : 'bg-white/90'),
    element.background === 'soft' && 'bg-black/35',
  )
  const style = { fontSize, color: element.color }
  if (editing) {
    return <EditableText text={element.text} className={className} style={style} {...editing} />
  }
  return (
    <span className={className} style={style}>
      {element.text}
    </span>
  )
}

/** Текст с курсора: у поля с переносами `innerText` отдаёт и их (в jsdom его нет). */
function readText(el: HTMLElement): string {
  return el.innerText ?? el.textContent ?? ''
}

/** Курсор в конец поля — после того как обрезали лишнее. */
function caretToEnd(el: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * Поле правки текста на кадре. Неуправляемое: текст кладётся один раз при открытии, дальше
 * им владеет браузер, а наружу уходит каждое изменение. Управляемый contentEditable сбивал
 * бы курсор на каждой букве. Открывается с выделенным текстом — подсказку нового элемента
 * сразу заменяют набором; Esc и уход фокуса завершают правку.
 */
function EditableText({
  text,
  className,
  style,
  label,
  maxLength,
  onInput,
  onDone,
}: StoryTextEditing & { text: string; className: string; style: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null)
  const initial = useRef(text)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = initial.current
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [])

  return (
    <span
      ref={ref}
      role="textbox"
      aria-label={label}
      aria-multiline
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      tabIndex={0}
      className={cn(className, 'min-w-[1ch] cursor-text outline-none select-text')}
      style={style}
      onInput={(e) => {
        const el = e.currentTarget
        let value = readText(el)
        if (value.length > maxLength) {
          value = value.slice(0, maxLength)
          el.textContent = value
          caretToEnd(el)
        }
        onInput(value)
      }}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Esc завершает правку, а не закрывает редактор (тот смотрит на defaultPrevented).
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}

/**
 * Слой элементов поверх кадра при просмотре. Сам слой не ловит указатель — под ним жесты
 * сторис (тап, удержание, свайп); кликабельны только отметки людей.
 */
export function StoryElementsLayer({
  elements,
  onMention,
  mentionLabel,
  cardActions,
}: {
  elements: StoryElement[]
  onMention?: (userId: string) => void
  /** Подпись отметки для читалки: «Открыть профиль {name}». */
  mentionLabel?: (name: string) => string
  /** Кнопки карточек-стикеров (подробнее, участвовать, открыть) — решает тот, кто рисует. */
  cardActions?: (element: StoryElement) => ReactNode
}) {
  if (elements.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden @container">
      {elements.map((element, i) => {
        const style = storyElementPlacement(element)
        // Порядок элементов не меняется за время показа кадра — индекс здесь стабилен.
        const key = `${element.type}-${i}`
        if (element.type === 'mention' && onMention) {
          return (
            <button
              key={key}
              type="button"
              className="pointer-events-auto absolute focus-visible:outline-2 focus-visible:outline-white"
              style={style}
              aria-label={mentionLabel?.(element.name) ?? element.name}
              // Жесты кадра (удержание, свайп) не должны срабатывать на нажатии по отметке.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onMention(element.userId)}
            >
              <StoryElementBody element={element} />
            </button>
          )
        }
        const actions = cardActions?.(element)
        if (actions) {
          return (
            <div
              key={key}
              className="pointer-events-auto absolute"
              style={style}
              // Нажатие по карточке и её кнопкам — не жест кадра (не пауза и не свайп).
              onPointerDown={(e) => e.stopPropagation()}
            >
              <StoryElementBody element={element} actions={actions} />
            </div>
          )
        }
        return (
          <div key={key} className="absolute" style={style}>
            <StoryElementBody element={element} />
          </div>
        )
      })}
    </div>
  )
}
