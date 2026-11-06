'use client'

import { lazy, Suspense } from 'react'
import { cn } from '../lib/utils'

// Два размера пикера. Разница не в одной ширине панели: число колонок и клетка связаны —
// frimousse раскладывает ряд на `columns` клеток фиксированного размера, и если их
// произведение шире дорожки, крайние уезжают под обрез. Поэтому размер выбирается
// парой, а не классом снаружи.
//
//  · md — выбор реакции в меню сообщения: панель всплывает у пузыря, и место там дорого;
//  · lg — панель ввода чата: сюда приходят выбирать смайл глазами, и 32-пиксельная клетка
//    превращает выбор в разглядывание.
export const EMOJI_PICKER_SIZES = {
  md: { columns: 9, root: 'h-80 w-[19rem]', cell: 'size-8 text-lg' },
  lg: { columns: 7, root: 'h-[26rem] w-[21rem]', cell: 'size-11 text-[1.75rem]' },
  // dock — панель под полем ввода на телефоне: во всю ширину и примерно в высоту
  // клавиатуры, которую она заменяет. Восемь колонок — столько 44-пиксельных клеток
  // помещается на узком экране, не уезжая под обрез.
  dock: { columns: 8, root: 'h-[min(45dvh,20rem)] w-full', cell: 'size-11 text-[1.75rem]' },
} as const

export interface EmojiPickerProps {
  onPick: (emoji: string) => void
  searchPlaceholder?: string
  className?: string
  /** Размер панели и клетки. `lg` — там, где смайл выбирают, а не подтверждают реакцией. */
  size?: keyof typeof EMOJI_PICKER_SIZES
}

// Сам пикер (frimousse) — отдельным чанком (задача 21.B4): он нужен только по нажатию
// на смайл или реакцию, а статический импорт клал его в бандл ленты и чатов. Пока чанк
// грузится, на месте панели стоит пустая панель того же размера.
const EmojiPickerPanel = lazy(() =>
  import('./emoji-picker-panel').then((m) => ({ default: m.EmojiPickerPanel })),
)

export function EmojiPicker(props: EmojiPickerProps) {
  const scale = EMOJI_PICKER_SIZES[props.size ?? 'md']
  return (
    <Suspense
      fallback={
        <div
          className={cn(
            'rounded-xl border border-border bg-popover shadow-lg',
            scale.root,
            props.className,
          )}
        />
      }
    >
      <EmojiPickerPanel {...props} />
    </Suspense>
  )
}
