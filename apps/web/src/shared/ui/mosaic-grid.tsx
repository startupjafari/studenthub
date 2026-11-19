import type { ComponentProps } from 'react'
import { cn } from 'shared/lib/utils'

// Сетка плиток профиля (посты, фото, видео, статьи): ровные квадраты одного размера, как
// в Instagram. Раньше это была мозаика из высоких и широких плиток по циклу — выглядела
// случайной и мешала читать сетку. Теперь ряды одинаковые: три колонки, на широком
// контейнере — четыре, чтобы плитки не раздувались до полуэкрана.
//
// Колонки — по ширине самого контейнера (`@container`), а не окна: сетка стоит рядом с
// боковой панелью фильтров, и окно ничего не говорит о её реальной ширине.

/** Сетка плиток. Дети — `MosaicTile`. */
export function MosaicGrid({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className="@container w-full">
      <div className={cn('grid grid-cols-3 gap-1 sm:gap-2 @4xl:grid-cols-4', className)} {...props}>
        {children}
      </div>
    </div>
  )
}

/** Квадратная плитка: содержимое растягивается на всю плитку. */
export function MosaicTile({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'group/tile relative aspect-square min-w-0 overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10',
        className,
      )}
      {...props}
    />
  )
}
