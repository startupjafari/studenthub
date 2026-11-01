'use client'

import type { ReactNode } from 'react'
import type { StoryRing } from '../../../entities/story'
import { cn } from '../../../shared/lib/utils'

/**
 * Окно просмотра сторис живёт в своём виджете (stories-rail), а виджеты друг друга не
 * импортируют (FSD). Профиль только рисует кольцо и по клику просит открыть сторис —
 * само окно подставляет слой выше (views/profile).
 */
export type RenderStoryViewer = (ring: StoryRing, onClose: () => void) => ReactNode

/**
 * Кольцо вокруг аватара профиля, когда у человека есть живые сторис: яркое — есть
 * непросмотренные, приглушённое — всё уже видели. Тот же вид, что у колец над лентой.
 */
export function StoryAvatarRing({
  ring,
  children,
}: {
  ring: StoryRing | null
  children: ReactNode
}) {
  if (!ring) return <>{children}</>
  return (
    <div
      className={cn(
        'size-full rounded-full p-[3px]',
        ring.hasUnseen
          ? 'bg-gradient-to-br from-primary via-indigo-500 to-violet-500'
          : 'bg-border',
      )}
    >
      {children}
    </div>
  )
}
