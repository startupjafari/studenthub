'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Delete } from 'lucide-react'
import { MOTION } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { ComposerEmojiTab } from './composer-emoji-tab'

/**
 * Панель на экране с учётом ухода: после `open = false` она ещё `MOTION.exit` мс видна с
 * анимацией исчезновения (Telegram гасит меню, а не выдёргивает его). Повторное открытие
 * посреди ухода просто отменяет уход.
 */
export function useSymbolMenuPresence(open: boolean): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open || !mounted) return
    const id = setTimeout(() => setMounted(false), MOTION.exit)
    return () => clearTimeout(id)
  }, [open, mounted])
  return { mounted: open || mounted, closing: !open && mounted }
}

/** Кнопка ⌫ нижней полосы — круг 34 px, как в Telegram. */
const footerButton =
  'flex size-[2.125rem] shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20'

/**
 * Панель эмодзи поля ввода в духе Telegram: эмодзи вставляются в текст, панель остаётся
 * открытой.
 *
 * Два вида: `popover` — над кнопкой смайла на ПК, `dock` — на месте клавиатуры на телефоне.
 */
export function ComposerSymbolMenu({
  variant,
  onEmoji,
  onBackspace,
}: {
  variant: 'popover' | 'dock'
  onEmoji: (emoji: string) => void
  /** Кнопка ⌫ на панели эмодзи (Telegram): стереть знак перед курсором поля ввода. */
  onBackspace?: () => void
}) {
  const t = useTranslations('Chats')

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-popover',
        variant === 'popover'
          ? 'h-[22.375rem] w-[24rem] rounded-xl border border-border shadow-lg'
          : // Telegram на телефоне: панель 17,6875rem на месте клавиатуры, во всю ширину.
            'h-[min(50dvh,17.6875rem)] w-full',
      )}
    >
      <div className="min-h-0 flex-1" role="region" aria-label={t('emoji')}>
        <ComposerEmojiTab variant={variant} onPick={onEmoji} />
      </div>
      {onBackspace && (
        // Нижняя полоса 48 px: ⌫ — у правого края, как в Telegram.
        <div className="relative flex h-12 shrink-0 items-center justify-center border-t border-border">
          <BackspaceButton label={t('tgComposer2.backspace')} onPress={onBackspace} />
        </div>
      )}
    </div>
  )
}

/** Задержка до автоповтора и его шаг — как у клавиши Backspace на клавиатуре. */
const REPEAT_DELAY_MS = 400
const REPEAT_EVERY_MS = 70

/**
 * ⌫ панели эмодзи. Нажатие стирает один знак, удержание — стирает подряд, как клавиша на
 * клавиатуре. Фокус из поля не уводит: на телефоне иначе спрятавшаяся клавиатура тут же
 * поднималась бы снова, а курсор терял место.
 */
function BackspaceButton({ label, onPress }: { label: string; onPress: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressRef = useRef(onPress)
  pressRef.current = onPress
  const stop = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])
  const repeat = (): void => {
    pressRef.current()
    timer.current = setTimeout(repeat, REPEAT_EVERY_MS)
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        stop()
        pressRef.current()
        timer.current = setTimeout(repeat, REPEAT_DELAY_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // Клавиатура: Enter/Space дают click без pointerdown — стираем по нему.
      onClick={(e) => {
        if (e.detail === 0) pressRef.current()
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        footerButton,
        'absolute right-1 top-1/2 -translate-y-1/2 touch-none text-foreground/60 hover:bg-muted-foreground/[0.08] hover:text-foreground',
      )}
    >
      <Delete className="size-5" aria-hidden />
    </button>
  )
}
