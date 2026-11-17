'use client'

import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import type { ConnectionStatus } from '../lib/use-connection-status'

/**
 * Заголовок списка чатов на время проблем со связью (Telegram): вместо «Чаты» — крутилка и
 * «Ожидание сети…», «Соединение…» или «Обновление…». Крутилка несёт смысл («процесс идёт»),
 * поэтому при `prefers-reduced-motion` она не гаснет, а замедляется глобальным правилом.
 */
export function ConnectionStatusTitle({ status }: { status: Exclude<ConnectionStatus, 'online'> }) {
  const label = useConnectionLabel(status)
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex min-w-0 flex-1 items-center gap-2 duration-(--motion-page) animate-in fade-in"
    >
      <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      <span className="truncate text-base font-semibold text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * Подпись под названием в шапке переписки на телефоне (Telegram): пока связи нет, вместо
 * «в сети» / «12 участников» — маленькая крутилка и то же «Ожидание сети…». На телефоне
 * список с его заголовком закрыт перепиской, и иначе о потере связи было бы не узнать.
 */
export function ConnectionStatusLine({ status }: { status: Exclude<ConnectionStatus, 'online'> }) {
  const label = useConnectionLabel(status)
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex min-w-0 items-center gap-1.5 duration-(--motion-page) animate-in fade-in"
    >
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  )
}

function useConnectionLabel(status: Exclude<ConnectionStatus, 'online'>): string {
  const t = useTranslations('Chats')
  return status === 'waitingForNetwork'
    ? t('tgShell.waitingForNetwork')
    : status === 'connecting'
      ? t('tgShell.connecting')
      : t('tgShell.updating')
}
