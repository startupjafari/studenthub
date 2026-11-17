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
  const t = useTranslations('Chats')
  const label =
    status === 'waitingForNetwork'
      ? t('tgShell.waitingForNetwork')
      : status === 'connecting'
        ? t('tgShell.connecting')
        : t('tgShell.updating')
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
