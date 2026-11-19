'use client'

import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { CHAT_REACTION_EMOJIS, DEFAULT_CHAT_REACTION } from '@studenthub/shared-config'
import { cn } from '../../../shared/lib/utils'
import { ColumnPanel, PanelHeader } from './column-panel'

// «Быстрая реакция» — экран левой колонки (как «Чёрный список»), повтор раздела Telegram
// «Настройки → Стикеры и эмодзи → Быстрая реакция»: одна отметка в сетке из сотни эмодзи.
// Выбранная ставится двойным кликом по сообщению, кнопкой у пузыря и стоит первой в ряду
// реакций меню. Хранится на сервере (`PATCH /chats/settings`) — одна на все устройства.
//
// Только сетка: без пояснения, заголовка раздела и «Другой реакции» — сотни вариантов
// хватает, а полный набор эмодзи на этом экране только мешал выбирать.

/**
 * Сотня вариантов: сначала быстрый набор меню (CHAT_REACTION_EMOJIS), за ним — частые эмодзи.
 * Только одиночные пиктограммы: сервер принимает любой один эмодзи (MessageReactionSchema),
 * а составные ZWJ-последовательности на части платформ рисуются раздельно.
 */
const QUICK_REACTION_CHOICES: readonly string[] = [
  ...CHAT_REACTION_EMOJIS,
  ...['😍', '🥰', '😘', '😊', '🙂', '😉', '😎', '🤩', '🥳', '😇', '🤗', '🤔', '🤨', '😐'],
  ...['😏', '🙄', '😬', '😴', '🤤', '😋', '😜', '🤪', '😝', '🤑', '🤭', '🤫', '🤐', '😶'],
  ...['😳', '🥺', '😭', '😤', '😡', '🤬', '😱', '😨', '😰', '😥', '😓', '🤯', '🥴', '😵'],
  ...['🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤠', '🤡', '👻', '💀', '👽', '🤖', '💩', '😺'],
  ...['🙈', '🙉', '🙊', '💯', '💔', '💖', '💘', '💕', '💙', '💚', '💛', '🧡', '💜', '🖤'],
  ...['🤍', '✨', '⭐', '🌟', '⚡', '🌈', '☀️', '🌹', '🌸', '🍀', '🎁', '🏆', '🥇', '🎯'],
  ...['🚀', '💪', '👏', '🙌', '🙏', '🤝', '👌', '✌️'],
]

export function QuickReactionPanel({
  embedded,
  hidden,
  value,
  onChange,
  onClose,
}: {
  embedded: boolean
  hidden: boolean
  value: string
  onChange: (emoji: string | null) => void
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  // Своя реакция вне сотни (выбрана раньше из полного набора) — первой клеткой, отмеченной:
  // иначе текущий выбор ничем бы не отмечался в сетке.
  const options = QUICK_REACTION_CHOICES.includes(value)
    ? QUICK_REACTION_CHOICES
    : [value, ...QUICK_REACTION_CHOICES]

  const pick = (emoji: string): void => {
    // Общая по умолчанию уходит как null: на сервере это «своей нет», а не копия дефолта.
    onChange(emoji === DEFAULT_CHAT_REACTION ? null : emoji)
  }

  return (
    <ColumnPanel embedded={embedded} hidden={hidden}>
      <PanelHeader title={t('tgReactions.quickTitle')} onBack={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* Сетка как у системного выбора эмодзи: клетки без подложки, подсветка по наведению;
            отмеченная — в кольце с галочкой. */}
        <div
          role="radiogroup"
          aria-label={t('tgReactions.quickTitle')}
          className="grid grid-cols-6 gap-1"
        >
          {options.map((emoji) => {
            const checked = emoji === value
            return (
              <button
                key={emoji}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={
                  emoji === DEFAULT_CHAT_REACTION
                    ? t('tgReactions.quickDefaultLabel', { emoji })
                    : emoji
                }
                onClick={() => pick(emoji)}
                className={cn(
                  'relative flex aspect-square cursor-pointer items-center justify-center rounded-lg text-2xl leading-none outline-none transition-[background-color,transform] duration-(--motion-micro) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-90 motion-reduce:transition-none',
                  checked && 'bg-primary/10 ring-2 ring-primary hover:bg-primary/15',
                )}
              >
                <span aria-hidden>{emoji}</span>
                {checked && (
                  <span className="absolute right-0.5 bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-2.5" aria-hidden />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </ColumnPanel>
  )
}
