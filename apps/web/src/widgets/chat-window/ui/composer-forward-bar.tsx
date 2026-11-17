'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Forward, MessageSquareOff, MessageSquareText, Send, User, UserX, X } from 'lucide-react'
import { RowContextMenu } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { plainPreview, senderName } from '../lib/format'
import { hasForwardCaptions, type ForwardDraft } from '../lib/use-forward-draft'

/**
 * Плашка пересылки над полем ввода (Telegram ComposerEmbeddedMessage в режиме пересылки).
 *
 * Одно сообщение — имя автора и начало текста; несколько — «Пересланные сообщения (N)» и
 * от кого. Нажатие по плашке — меню Telegram: показать/скрыть имя отправителя, подписи,
 * сменить получателя, не пересылать. Крестик — то же «не пересылать» одним касанием.
 */
export function ComposerForwardBar({
  draft,
  className,
  onToggleSender,
  onToggleCaptions,
  onChangeRecipient,
  onCancel,
}: {
  draft: ForwardDraft
  className?: string
  onToggleSender: () => void
  onToggleCaptions: () => void
  onChangeRecipient: () => void
  onCancel: () => void
}) {
  const t = useTranslations('Chats')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const count = draft.messages.length
  const first = draft.messages[0]
  const names = [...new Set(draft.messages.map((m) => senderName(m)))]
  const captions = hasForwardCaptions(draft.messages)

  const title =
    count === 1
      ? draft.hideSender
        ? t('tgComposer2.forwardSenderHidden')
        : first
          ? senderName(first)
          : ''
      : t('tgComposer2.forwardCount', { count })
  const subtitle =
    count === 1 && first
      ? (draft.hideCaptions && first.media.length > 0 ? '' : plainPreview(first.content)) ||
        t('attachment')
      : draft.hideSender
        ? t('tgComposer2.forwardNamesHidden')
        : t('tgComposer2.forwardFrom', { names: names.join(', ') })

  const openMenu = (e: React.MouseEvent<HTMLElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    // Клавиатура (Enter по кнопке) даёт нулевые координаты — ставим меню у плашки.
    const keyboard = e.clientX === 0 && e.clientY === 0
    setMenu({ x: keyboard ? box.left + 24 : e.clientX, y: keyboard ? box.top : e.clientY })
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-2xl px-3 py-2 duration-200 animate-in fade-in slide-in-from-bottom-2 lg:rounded-md',
        className,
      )}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e)
      }}
    >
      <Forward className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="h-8 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
      <button
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        title={t('tgComposer2.forwardOptions')}
        className="min-w-0 flex-1 cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="block truncate text-xs font-medium text-primary">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </button>
      <button
        type="button"
        aria-label={t('tgComposer2.forwardCancel')}
        title={t('tgComposer2.forwardCancel')}
        onClick={onCancel}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
      {menu && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t('tgComposer2.forwardOptions')}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'sender',
              icon: draft.hideSender ? User : UserX,
              label: draft.hideSender
                ? t('tgComposer2.forwardShowSender', { count })
                : t('tgComposer2.forwardHideSender', { count }),
              onClick: onToggleSender,
            },
            ...(captions
              ? [
                  {
                    key: 'captions',
                    icon: draft.hideCaptions ? MessageSquareText : MessageSquareOff,
                    label: draft.hideCaptions
                      ? t('tgComposer2.forwardShowCaptions', { count })
                      : t('tgComposer2.forwardHideCaptions', { count }),
                    onClick: onToggleCaptions,
                  },
                ]
              : []),
            {
              key: 'recipient',
              icon: Send,
              label: t('tgComposer2.forwardChangeRecipient'),
              onClick: onChangeRecipient,
            },
            {
              key: 'cancel',
              icon: X,
              label: t('tgComposer2.forwardCancel'),
              onClick: onCancel,
              danger: true,
            },
          ]}
        />
      )}
    </div>
  )
}
