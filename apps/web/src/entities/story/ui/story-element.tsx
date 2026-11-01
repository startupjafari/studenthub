'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { StoryElementInput } from '@studenthub/shared-schemas'
import { cn } from '../../../shared/lib/utils'
import type { StoryElement } from '../model/types'

// Размер шрифта — в процентах ширины кадра (`cqw`, контейнер — слой элементов): одна и та
// же сторис одинаково выглядит в превью редактора, на телефоне и в колонке на десктопе.
const BASE_CQW = { text: 6, emoji: 14, mention: 5 } as const

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

/**
 * Сам элемент без позиционирования: текст с подложкой, эмодзи или плашка отметки. Общий
 * для просмотра и для редактора — там его оборачивают в перетаскиваемую рамку.
 */
export function StoryElementBody({
  element,
  mentionName,
}: {
  element: StoryElementInput | StoryElement
  /** Имя отметки: в выдаче его кладёт сервер, в редакторе — выбор из поиска. */
  mentionName?: string
}): ReactNode {
  const fontSize = `${BASE_CQW[element.type] * element.scale}cqw`
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
  return (
    <span
      className={cn(
        'block max-w-[80cqw] leading-tight font-semibold break-words whitespace-pre-wrap',
        FONT_CLASS[element.font],
        ALIGN_CLASS[element.align],
        element.background === 'none' && 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]',
        element.background !== 'none' && 'rounded-[0.3em] px-[0.45em] py-[0.15em]',
        element.background === 'solid' && (isLight(element.color) ? 'bg-black/75' : 'bg-white/90'),
        element.background === 'soft' && 'bg-black/35',
      )}
      style={{ fontSize, color: element.color }}
    >
      {element.text}
    </span>
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
}: {
  elements: StoryElement[]
  onMention?: (userId: string) => void
  /** Подпись отметки для читалки: «Открыть профиль {name}». */
  mentionLabel?: (name: string) => string
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
        return (
          <div key={key} className="absolute" style={style}>
            <StoryElementBody element={element} />
          </div>
        )
      })}
    </div>
  )
}
