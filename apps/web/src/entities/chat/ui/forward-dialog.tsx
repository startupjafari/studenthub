'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bookmark, Check, MessagesSquare, Search } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  Input,
  Modal,
  SegmentedTabs,
  type SegmentedTabItem,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { identityColor, identityInitials } from '../../../shared/lib'
import type { ChatListItem } from '../model/types'

// ── Визуал строки (Telegram-стиль) ───────────────────────────────────────────
// Аватар — цветной кружок с инициалами (картинок у чатов нет; как в сайдбаре).

/**
 * Вкладка-фильтр над списком получателей. Готовый набор id, а не правило: папки живут в
 * `widgets/chat-window` вместе со списком чатов, и тянуть их сюда значило бы завести импорт
 * из вышестоящего слоя. `chatIds: null` — «Все».
 */
export interface ForwardTab {
  id: string
  label: string
  chatIds: string[] | null
}

// Диалог пересылки (Ф9+, §5 карты): множественный выбор получателей с поиском, вкладками
// папок, «Избранным» сверху и подписью к пересылаемому.
// Подпись чата даёт вызывающий (titleOf). onSubmit получает все выбранные чаты разом:
// подпись общая для отправки, и разбивать её на чат было бы нечем.
export function ForwardDialog({
  chats,
  currentChatId,
  titleOf,
  tabs,
  onResolveSaved,
  onSubmit,
  onClose,
}: {
  chats: ChatListItem[]
  currentChatId: string | null
  titleOf: (c: ChatListItem) => string
  /** Папки над списком. Пусто или одна вкладка — ряд не рисуем: фильтровать нечем. */
  tabs?: ForwardTab[]
  /**
   * Найти (или завести) личный чат «Избранное». Плитка стоит сверху всегда, а самого чата
   * у человека может ещё не быть — создаём по первому же нажатию, как это делает Telegram.
   */
  onResolveSaved?: () => Promise<string>
  onSubmit: (targetChatIds: string[], caption: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<string>(tabs?.[0]?.id ?? 'all')
  const [caption, setCaption] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savedBusy, setSavedBusy] = useState(false)

  // Непринятый входящий запрос (§50) целью пересылки быть не может: отправка в него
  // считается ответом и молча приняла бы переписку, о которой решение ещё не принято.
  const targets = useMemo(
    () => chats.filter((c) => c.id !== currentChatId && !c.requestIncoming),
    [chats, currentChatId],
  )
  const savedChat = useMemo(() => chats.find((c) => c.type === 'SAVED'), [chats])

  const filtered = useMemo(() => {
    const active = tabs?.find((f) => f.id === tab)
    const byTab =
      active?.chatIds == null ? targets : targets.filter((c) => active.chatIds?.includes(c.id))
    const q = query.trim().toLowerCase()
    if (!q) return byTab
    return byTab.filter((c) => titleOf(c).toLowerCase().includes(q))
  }, [targets, tabs, tab, query, titleOf])

  const tabItems: SegmentedTabItem<string>[] = useMemo(
    () => (tabs ?? []).map((f) => ({ value: f.id, label: f.label })),
    [tabs],
  )

  function subtitleOf(c: ChatListItem): string {
    return c.type === 'PRIVATE' ? t('typePrivate') : t('participants', { count: c.memberCount })
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // «Избранное» отмечается как обычная цель — просто стоит отдельной плиткой сверху.
  function toggleSaved(): void {
    if (savedChat) {
      toggle(savedChat.id)
      return
    }
    if (!onResolveSaved || savedBusy) return
    setSavedBusy(true)
    void onResolveSaved()
      .then((id) => toggle(id))
      .finally(() => setSavedBusy(false))
  }

  function submit(): void {
    if (selected.size === 0) return
    onSubmit([...selected], caption.trim())
    onClose()
  }

  const savedSelected = !!savedChat && selected.has(savedChat.id)

  return (
    <Modal
      onClose={onClose}
      title={`${t('forward')}…`}
      size="lg"
      className="h-[min(85vh,40rem)]"
      bodyClassName="p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pb-2 pt-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="rounded-full pl-9"
              autoFocus
            />
          </div>
        </div>

        {/* «Избранное» — заметка самому себе: самый частый адресат пересылки, и искать его
            в общем списке наравне с людьми было бы странно. */}
        {(savedChat || onResolveSaved) && !query && (
          <button
            type="button"
            role="checkbox"
            aria-checked={savedSelected}
            onClick={toggleSaved}
            disabled={savedBusy}
            className={cn(
              'mx-4 mb-1 flex items-center gap-3 rounded-2xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-60',
              savedSelected && 'border-primary/40 bg-primary/10 hover:bg-primary/15',
            )}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Bookmark className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {t('savedMessages')}
            </span>
            {savedSelected && (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" strokeWidth={3} aria-hidden />
              </span>
            )}
          </button>
        )}

        {tabItems.length > 1 && !query && (
          <div className="px-4 pb-1">
            <SegmentedTabs
              items={tabItems}
              value={tab}
              onChange={setTab}
              compact
              collapsible={false}
              aria-label={t('foldersTitle')}
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1">
          {targets.length === 0 ? (
            <EmptyState
              icon={<MessagesSquare className="size-6" aria-hidden />}
              title={t('noChats')}
            />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Search className="size-6" aria-hidden />} title={t('noResults')} />
          ) : (
            filtered.map((c) => {
              const isChecked = selected.has(c.id)
              const title = titleOf(c)
              return (
                <button
                  key={c.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isChecked}
                  onClick={() => toggle(c.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/60',
                    isChecked && 'bg-primary/10 hover:bg-primary/15',
                  )}
                >
                  <span className="relative shrink-0">
                    <Avatar className="size-12">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={title} />}
                      <AvatarFallback
                        className={cn('text-sm font-medium text-white', identityColor(c.id))}
                      >
                        {identityInitials(title)}
                      </AvatarFallback>
                    </Avatar>
                    {isChecked && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground"
                        aria-hidden
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{title}</span>
                    <span className="truncate text-xs text-muted-foreground">{subtitleOf(c)}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {/* Подпись уходит отдельным сообщением следом за пересланным — своего поля у
              пересылки на сервере нет, а комментарий «от себя» нужен ровно так же. */}
          {selected.size > 0 && (
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={t('forwardCaption')}
              aria-label={t('forwardCaption')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancel')}
            </Button>
            {selected.size > 0 && (
              <Button type="button" onClick={submit}>
                {t('send')} ({selected.size})
              </Button>
            )}
          </div>
        </footer>
      </div>
    </Modal>
  )
}
