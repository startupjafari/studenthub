'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Popover as PopoverPrimitive } from 'radix-ui'
import {
  Bookmark,
  Check,
  CircleCheck,
  MessagesSquare,
  Search,
  SendHorizontal,
  Smile,
  X,
} from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  EmojiPicker,
  EmptyState,
  Modal,
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

// Диалог пересылки в раскладке Telegram: поиск, карточка недавних с «Избранным», папки
// капсулами и список карточкой.
//
// Два режима, как в Telegram. Обычный — нажал на чат, и пересылка ушла туда: чаще всего
// пересылают одному адресату, и «выбрать → подтвердить» было лишним шагом. Галочка в шапке
// включает выбор нескольких: у строк появляются кружки, а внизу — подпись и круглая
// кнопка отправки.
//
// Подпись чата даёт вызывающий (titleOf). onSubmit получает все выбранные чаты разом:
// подпись общая для отправки, и разбивать её на чат было бы нечем.

/** Сколько недавних чатов в карточке сверху, кроме «Избранного». */
const RECENT_COUNT = 4
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
  const [many, setMany] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)

  // Непринятый входящий запрос (§50) целью пересылки быть не может: отправка в него
  // считается ответом и молча приняла бы переписку, о которой решение ещё не принято.
  const targets = useMemo(
    () => chats.filter((c) => c.id !== currentChatId && !c.requestIncoming),
    [chats, currentChatId],
  )
  const savedChat = useMemo(() => chats.find((c) => c.type === 'SAVED'), [chats])
  // Недавние — первые из списка: он и так упорядочен по последнему сообщению.
  const recent = useMemo(
    () => targets.filter((c) => c.type !== 'SAVED').slice(0, RECENT_COUNT),
    [targets],
  )

  const filtered = useMemo(() => {
    const active = tabs?.find((f) => f.id === tab)
    const byTab =
      active?.chatIds == null ? targets : targets.filter((c) => active.chatIds?.includes(c.id))
    const q = query.trim().toLowerCase()
    if (!q) return byTab
    return byTab.filter((c) => titleOf(c).toLowerCase().includes(q))
  }, [targets, tabs, tab, query, titleOf])

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

  // Нажатие на чат: в обычном режиме — сразу отправить туда, в режиме выбора — отметить.
  function pick(id: string): void {
    if (many) {
      toggle(id)
      return
    }
    onSubmit([id], '')
    onClose()
  }

  // «Избранное» — такая же цель, просто стоит первой в карточке недавних. Самого чата у
  // человека может ещё не быть — заводим по первому нажатию, как это делает Telegram.
  function pickSaved(): void {
    if (savedChat) {
      pick(savedChat.id)
      return
    }
    if (!onResolveSaved || savedBusy) return
    setSavedBusy(true)
    void onResolveSaved()
      .then((id) => pick(id))
      .finally(() => setSavedBusy(false))
  }

  function submit(): void {
    if (selected.size === 0) return
    onSubmit([...selected], caption.trim())
    onClose()
  }

  const savedSelected = !!savedChat && selected.has(savedChat.id)
  const showSaved = (savedChat || onResolveSaved) && !query

  return (
    <Modal
      onClose={onClose}
      title={t('forward')}
      header={false}
      size="md"
      // На телефоне окно занимает 90% экрана по обеим сторонам: список чатов с поиском и
      // вкладками в окне «по содержимому» показывал две строки и полполосы прокрутки.
      className="h-[90dvh] max-h-[90dvh] w-[90vw] max-w-[90vw] rounded-3xl sm:h-[min(88vh,44rem)] sm:w-[calc(100%-2rem)] sm:max-w-md"
      bodyClassName="p-0 overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Шапка как в Telegram: крестик слева, название, справа — переключатель выбора
            нескольких. Включённый — залитой галочкой: видно, в каком ты режиме. */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancel')}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{t('forward')}</h2>
          <button
            type="button"
            aria-pressed={many}
            aria-label={many ? t('forwardSelectOne') : t('forwardSelectMany')}
            title={many ? t('forwardSelectOne') : t('forwardSelectMany')}
            onClick={() => {
              setMany((v) => !v)
              setSelected(new Set())
            }}
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors',
              many
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <CircleCheck className="size-5" aria-hidden />
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="h-11 w-full rounded-full bg-muted pr-4 pl-12 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-4 focus-visible:ring-ring/20"
              autoFocus
            />
          </div>
        </div>

        {/* Недавние — карточкой в ряд, «Избранное» первым: самый частый адресат пересылки,
            и искать его в общем списке наравне с людьми было бы странно. */}
        {showSaved && (
          <div className="mx-4 mb-3 flex gap-2 overflow-x-auto rounded-2xl bg-muted/50 p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <RecentTile
              label={t('savedMessages')}
              selectable={many}
              checked={savedSelected}
              disabled={savedBusy}
              onClick={pickSaved}
              avatar={
                <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Bookmark className="size-6 fill-current" aria-hidden />
                </span>
              }
            />
            {recent.map((c) => {
              const title = titleOf(c)
              return (
                <RecentTile
                  key={c.id}
                  label={title}
                  selectable={many}
                  checked={selected.has(c.id)}
                  onClick={() => pick(c.id)}
                  avatar={
                    <Avatar className="size-14">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                      <AvatarFallback
                        className={cn('text-base font-medium text-white', identityColor(c.id))}
                      >
                        {identityInitials(title)}
                      </AvatarFallback>
                    </Avatar>
                  }
                />
              )
            })}
          </div>
        )}

        {/* Папки — капсулами в строку с прокруткой вбок, как в Telegram. */}
        {tabs && tabs.length > 1 && !query && (
          <div
            role="tablist"
            aria-label={t('foldersTitle')}
            className="mb-3 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={tab === f.id}
                onClick={() => setTab(f.id)}
                className={cn(
                  'h-10 shrink-0 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors',
                  tab === f.id
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div
          className={cn(
            'mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl bg-muted/50 py-1',
            !many && 'mb-4',
          )}
        >
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
                  role={many ? 'checkbox' : undefined}
                  aria-checked={many ? isChecked : undefined}
                  onClick={() => pick(c.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <Avatar className="size-11 shrink-0">
                    {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                    <AvatarFallback
                      className={cn('text-sm font-medium text-white', identityColor(c.id))}
                    >
                      {c.type === 'SAVED' ? (
                        <Bookmark className="size-5 fill-current" aria-hidden />
                      ) : (
                        identityInitials(title)
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">
                      {c.type === 'SAVED' ? t('savedMessages') : title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{subtitleOf(c)}</span>
                  </span>
                  {many && <Radio checked={isChecked} />}
                </button>
              )
            })
          )}
        </div>

        {/* Подпись и отправка — только в режиме выбора: в обычном отправляет само нажатие.
            Подпись уходит отдельным сообщением следом за пересланным — своего поля у
            пересылки на сервере нет, а комментарий «от себя» нужен ровно так же. */}
        {many && (
          <div className="flex items-center gap-2 px-4 pt-3 pb-4">
            <div className="relative flex h-12 min-w-0 flex-1 items-center rounded-full bg-muted pr-4 pl-1">
              {/* Пикер — поповером поверх страницы: внутри окна с `overflow-hidden` он
                  обрезался его рамкой на невысоком экране. Клик мимо и Esc закрывают
                  только пикер — это делает сам Radix, окно под ним остаётся. */}
              <PopoverPrimitive.Root open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverPrimitive.Trigger asChild>
                  <button
                    type="button"
                    aria-label={t('emoji')}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Smile className="size-6" aria-hidden />
                  </button>
                </PopoverPrimitive.Trigger>
                <PopoverPrimitive.Portal>
                  <PopoverPrimitive.Content
                    side="top"
                    align="start"
                    sideOffset={12}
                    collisionPadding={8}
                    className="z-[110] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                  >
                    <EmojiPicker
                      searchPlaceholder={t('search')}
                      onPick={(emoji) => setCaption((prev) => prev + emoji)}
                    />
                  </PopoverPrimitive.Content>
                </PopoverPrimitive.Portal>
              </PopoverPrimitive.Root>
              <input
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
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={selected.size === 0}
              aria-label={t('send')}
              className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] active:scale-95 disabled:opacity-40"
            >
              <SendHorizontal className="size-5" aria-hidden />
              {/* Сколько адресатов — на самой кнопке: «куда уйдёт» видно до нажатия. */}
              {selected.size > 1 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-primary px-1 text-[11px] font-semibold tabular-nums">
                  {selected.size}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Кружок выбора справа от строки: пустое кольцо или залитый акцентом с галочкой. */
function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-muted-foreground/40',
      )}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  )
}

/** Плитка недавнего чата: аватар и подпись под ним; в режиме выбора — кольцо на аватаре. */
function RecentTile({
  label,
  avatar,
  selectable,
  checked,
  disabled,
  onClick,
}: {
  label: string
  avatar: React.ReactNode
  selectable: boolean
  checked: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={selectable ? 'checkbox' : undefined}
      aria-checked={selectable ? checked : undefined}
      onClick={onClick}
      disabled={disabled}
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-xl py-1 text-center transition-opacity disabled:opacity-60"
    >
      <span className="relative">
        {avatar}
        {selectable && (
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border-2 border-background',
              checked ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/60',
            )}
          >
            {checked && <Check className="size-3" strokeWidth={3} />}
          </span>
        )}
      </span>
      <span className="w-full truncate text-xs font-medium">{label}</span>
    </button>
  )
}
