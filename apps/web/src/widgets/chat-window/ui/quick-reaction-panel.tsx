'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, SmilePlus } from 'lucide-react'
import { CHAT_REACTION_EMOJIS, DEFAULT_CHAT_REACTION } from '@studenthub/shared-config'
import { EmojiPicker } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ColumnPanel, PanelHeader, SectionTitle } from './column-panel'

// «Быстрая реакция» — экран левой колонки (как «Чёрный список»), повтор раздела Telegram
// «Настройки → Стикеры и эмодзи → Быстрая реакция»: одна отметка в списке быстрых реакций,
// а любая другая — из полного набора эмодзи. Выбранная ставится двойным кликом по сообщению,
// кнопкой у пузыря и стоит первой в ряду реакций меню. Хранится на сервере
// (`PATCH /chats/settings`) — одна на все устройства.

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
  const [pickerOpen, setPickerOpen] = useState(false)
  // Своя реакция вне быстрого набора — первой клеткой, отмеченной: иначе выбор из полного
  // набора ничем бы не отмечался в сетке.
  const options: string[] = (CHAT_REACTION_EMOJIS as readonly string[]).includes(value)
    ? [...CHAT_REACTION_EMOJIS]
    : [value, ...CHAT_REACTION_EMOJIS]

  const pick = (emoji: string): void => {
    // Общая по умолчанию уходит как null: на сервере это «своей нет», а не копия дефолта.
    onChange(emoji === DEFAULT_CHAT_REACTION ? null : emoji)
  }

  return (
    <ColumnPanel embedded={embedded} hidden={hidden}>
      <PanelHeader title={t('tgReactions.quickTitle')} onBack={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        <p className="px-1 text-sm text-muted-foreground">{t('tgReactions.quickHint')}</p>
        <div>
          <SectionTitle>{t('tgReactions.quickListTitle')}</SectionTitle>
          {/* Сеткой, а не строками: у эмодзи нет имён, и строка «👍 — Реакция» ничего бы
              не добавила к самому значку. Отмеченная клетка — с кольцом и галочкой. */}
          <div
            role="radiogroup"
            aria-label={t('tgReactions.quickTitle')}
            className="grid grid-cols-4 gap-2 px-1"
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
                    'relative flex aspect-square cursor-pointer items-center justify-center rounded-xl text-3xl leading-none outline-none transition-[background-color,transform] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-95',
                    checked ? 'bg-primary/10 ring-2 ring-primary' : 'bg-muted/50',
                  )}
                >
                  <span aria-hidden>{emoji}</span>
                  {checked && (
                    <span className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" aria-hidden />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
            className="mt-2 flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left text-sm text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/10"
          >
            <SmilePlus className="size-5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('tgReactions.quickOther')}</span>
          </button>
        </div>
        {pickerOpen && (
          <EmojiPicker
            className="max-w-full self-center duration-(--motion-menu) animate-in fade-in-0 slide-in-from-top-1"
            searchPlaceholder={t('emojiSearch')}
            onPick={(emoji) => {
              pick(emoji)
              setPickerOpen(false)
            }}
          />
        )}
      </div>
    </ColumnPanel>
  )
}
