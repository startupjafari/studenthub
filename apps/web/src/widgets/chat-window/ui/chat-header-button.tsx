'use client'

import type { ComponentProps } from 'react'
import { cn } from '../../../shared/lib/utils'

/**
 * Иконочная кнопка шапки переписки — одна геометрия на все режимы шапки (обычный, поиск,
 * выбор сообщений, полоса закрепа): 44 px под палец и 40 px под курсор, иконка size-5
 * (DESIGN_SYSTEM §4). Кнопки разного размера в одном ряду читались как собранные из разных
 * наборов.
 */
export const CHAT_HEADER_ICON_BTN =
  'flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-muted data-[state=open]:text-foreground lg:size-10 [&_svg]:size-5 [&_svg]:shrink-0'

export function ChatHeaderIconButton({
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'>) {
  return <button type={type} className={cn(CHAT_HEADER_ICON_BTN, className)} {...props} />
}
