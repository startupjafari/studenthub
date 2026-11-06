import type { ComponentProps } from 'react'
import { cn } from 'shared/lib/utils'

// Мозаика в духе Instagram: три колонки квадратных клеток и плитки трёх форм — квадрат 1:1,
// высокая 1×2 (как Reels) и широкая 2×1 (как 16:9). Форма зависит только от позиции, а не
// от содержимого: сетка выглядит собранной при любом наборе фото, и сортировка не ломает ритм.
//
// Цикл — 14 плиток на 6 рядов без дыр:
//   [высокая слева + 4 квадрата] · [широкая + квадрат] · [4 квадрата + высокая справа] · [квадрат + широкая]
// Высокой справа задана третья колонка, а плотная укладка (`grid-flow-dense`) ставит
// квадраты в свободные клетки слева от неё — порядок плиток в разметке остаётся порядком чтения.
//
// Высота ряда равна ширине колонки: считается от ширины контейнера (`cqw`), поэтому клетки
// квадратные без замеров в JS, а плитки на два ряда или две колонки — ровно вдвое больше.

export type MosaicShape = 'square' | 'tall' | 'wide'

interface Cell {
  shape: MosaicShape
  className: string
}

const SQUARE: Cell = { shape: 'square', className: '' }
const TALL: Cell = { shape: 'tall', className: 'row-span-2' }
const TALL_END: Cell = { shape: 'tall', className: 'col-start-3 row-span-2' }
const WIDE: Cell = { shape: 'wide', className: 'col-span-2' }

const CYCLE: Cell[] = [
  ...[TALL, SQUARE, SQUARE, SQUARE, SQUARE],
  ...[WIDE, SQUARE],
  ...[TALL_END, SQUARE, SQUARE, SQUARE, SQUARE],
  ...[SQUARE, WIDE],
]

const cellAt = (index: number): Cell => CYCLE[index % CYCLE.length] ?? SQUARE

/** Форма плитки на позиции `index` — чтобы подобрать содержимое (например, длину подписи). */
export function mosaicShape(index: number): MosaicShape {
  return cellAt(index).shape
}

/** Сетка-мозаика. Дети — `MosaicTile` с порядковым номером. */
export function MosaicGrid({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className="@container w-full">
      <div
        className={cn(
          'grid grid-flow-dense grid-cols-3 gap-1 auto-rows-[calc((100cqw-0.5rem)/3)] sm:gap-2 sm:auto-rows-[calc((100cqw-1rem)/3)]',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

/** Плитка мозаики: форма по позиции, содержимое растягивается на всю плитку. */
export function MosaicTile({
  index,
  className,
  ...props
}: ComponentProps<'div'> & { index: number }) {
  const cell = cellAt(index)
  return (
    <div
      data-shape={cell.shape}
      className={cn(
        'group/tile relative min-w-0 overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10',
        cell.className,
        className,
      )}
      {...props}
    />
  )
}
