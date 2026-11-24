'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  List as ListIcon,
  Loader2,
  MessageSquareText,
  UserSearch,
  X,
} from 'lucide-react'
import type { ChatMemberInfo, ChatMessage } from '../../../entities/chat'
import { plainPreview, useBackClose } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Skeleton,
  useListboxKeys,
} from '../../../shared/ui'
import { avatarColor, chatInitials, listTime, senderName } from '../lib/format'
import type { ChatHeaderSearchState } from '../lib/use-chat-header-search'
import { ChatHeaderIconButton } from './chat-header-button'

/** До конца выдачи осталось меньше — подтягиваем следующую страницу. */
const LOAD_MORE_EDGE_PX = 80

/**
 * Поиск по переписке в шапке (Telegram: MiddleSearch).
 *
 * Шапка в этом режиме и есть поле: «назад», метка «От: …», строка запроса. Под ней —
 * выдача: аватар, автор, время и строка с подсвеченным совпадением; выбор строки ведёт к
 * сообщению и прячет выдачу, чтобы было видно переписку вокруг. Возврат в поле снова её
 * показывает.
 *
 * Справа — только фильтр «От: …» (автор; в группах; ищет и без слов, стоит меткой перед полем
 * и снимается крестиком). Календаря в поиске нет: к дню ведёт нажатие на плашку даты в ленте.
 * Счётчик «3 из 57» и стрелки появляются, когда есть совпадения: до поиска шагать не по чему,
 * и серые стрелки только путали.
 *
 * На ПК всё это стоит в шапке справа.
 * На телефоне им там тесно — они уезжают в нижнюю панель ({@link ChatHeaderSearchFooter}),
 * которая на время поиска заменяет поле ввода, как в Telegram.
 */
export function ChatHeaderSearch({
  search,
  isGroup,
  isPhone,
  members,
  myId,
}: {
  search: ChatHeaderSearchState
  /** Фильтр «От кого» — только там, где авторов больше одного собеседника. */
  isGroup: boolean
  isPhone: boolean
  members: readonly ChatMemberInfo[]
  myId?: string
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const locale = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  // Системная «назад» (Android, жест) закрывает поиск, а не сам чат.
  useBackClose(search.close)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [search.focusTick])

  const memberQuery = search.memberQuery.trim().toLowerCase()
  const memberOptions = search.pickingSender
    ? members.filter((m) => !memberQuery || fullName(m).toLowerCase().includes(memberQuery))
    : []
  const results = search.active && !search.pickingSender ? search.results : []
  const options = search.pickingSender ? memberOptions.length : results.length
  const listbox = useListboxKeys({
    count: search.listOpen ? options : 0,
    onPick: (i) => {
      if (search.pickingSender) {
        const m = memberOptions[i]
        if (m) search.chooseSender({ id: m.id, name: fullName(m) })
      } else {
        search.pick(i)
      }
    },
    resetKey: `${search.pickingSender ? 'm' : 'q'}:${search.term}:${memberQuery}`,
  })

  // Нажатие мимо шапки и выдачи прячет выдачу (Telegram): человек ушёл читать переписку.
  const { listOpen, setListOpen } = search
  useEffect(() => {
    if (!listOpen) return
    const onDown = (e: PointerEvent): void => {
      const box = boxRef.current
      if (!box || !(e.target instanceof Node) || box.contains(e.target)) return
      // Слои поверх (календарь, меню, окна) — не «мимо»: они открыты из самого поиска.
      if (
        e.target instanceof Element &&
        e.target.closest('[data-radix-popper-content-wrapper],[role="dialog"]')
      )
        return
      setListOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [listOpen, setListOpen])

  const showDropdown = search.listOpen && (search.pickingSender || search.active)

  return (
    <div ref={boxRef} className="relative z-30 shrink-0">
      {/* py-3 и кнопки 44/40 px — как у обычной шапки, которую поиск собой заменяет:
          линия под шапками соседних колонок не должна ломаться ступенькой. */}
      <header className="flex items-center gap-1 border-b border-border px-2 py-3 duration-(--motion-page) animate-in fade-in-0">
        <ChatHeaderIconButton aria-label={t('tgHeader.searchClose')} onClick={search.close}>
          <ChevronLeft aria-hidden />
        </ChatHeaderIconButton>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-1">
          {search.pickingSender && (
            <span className="shrink-0 text-sm font-medium text-primary">
              {t('tgHeader.searchFromLabel')}
            </span>
          )}
          {search.sender && !search.pickingSender && (
            <span className="flex h-7 max-w-[45%] shrink-0 items-center gap-1 rounded-full bg-primary/10 pr-0.5 pl-2.5 text-sm text-primary">
              <span className="truncate">
                {t('tgHeader.searchFromChip', { name: search.sender.name })}
              </span>
              <button
                type="button"
                aria-label={t('tgHeader.searchFromClear', { name: search.sender.name })}
                onClick={search.clearSender}
                className="flex size-6 shrink-0 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            value={search.input}
            onChange={(e) => {
              search.setInput(e.target.value)
              search.setListOpen(true)
            }}
            onFocus={() => search.setListOpen(true)}
            onClick={() => search.setListOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                search.escape()
                return
              }
              if (e.key === 'Backspace' && !e.currentTarget.value) {
                if (search.pickingSender) {
                  e.preventDefault()
                  search.escape()
                  return
                }
                if (search.sender) {
                  e.preventDefault()
                  search.clearSender()
                  return
                }
              }
              if (showDropdown && options > 0) {
                listbox.onKeyDown(e)
                return
              }
              // Выдача спрятана — Enter шагает по совпадениям: к более старому, с Shift — к
              // более новому (Telegram).
              if (e.key === 'Enter' && search.active) {
                e.preventDefault()
                if (e.shiftKey) search.newer()
                else void search.older()
              }
            }}
            role="combobox"
            aria-expanded={showDropdown && options > 0}
            aria-controls={listId}
            aria-activedescendant={showDropdown ? listbox.activeId : undefined}
            aria-autocomplete="list"
            aria-label={search.pickingSender ? t('tgHeader.searchMembers') : t('searchInChat')}
            placeholder={search.pickingSender ? t('tgHeader.searchMembers') : t('searchInChat')}
            enterKeyHint="search"
            // Поле без рамки и заливки: в режиме поиска шапка и есть поле, а коробочка
            // внутри коробочки только сужала строку ввода.
            className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground lg:h-10 lg:text-sm"
          />
          {search.input && (
            <ChatHeaderIconButton
              aria-label={t('clearSearch')}
              onClick={() => {
                search.setInput('')
                inputRef.current?.focus()
              }}
              className="size-9 lg:size-9 [&_svg]:size-4"
            >
              <X aria-hidden />
            </ChatHeaderIconButton>
          )}
        </div>
        {!isPhone && (
          <>
            <SearchCounter search={search} />
            <SearchArrows search={search} />
            {isGroup && <SenderFilterButton search={search} />}
          </>
        )}
      </header>

      {showDropdown && (
        <div className="absolute inset-x-2 top-full z-10 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-lg duration-(--motion-menu) animate-in fade-in-0 slide-in-from-top-1">
          {search.pickingSender ? (
            memberOptions.length > 0 ? (
              <ul
                id={listId}
                role="listbox"
                aria-label={t('tgHeader.searchMembers')}
                className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain py-1"
              >
                {memberOptions.map((m, i) => {
                  const name = fullName(m)
                  return (
                    <li
                      key={m.id}
                      id={listbox.optionId(i)}
                      role="option"
                      aria-selected={i === listbox.active}
                      onPointerEnter={() => listbox.setActive(i)}
                      onClick={() => search.chooseSender({ id: m.id, name })}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 px-3 py-2',
                        i === listbox.active && 'bg-muted',
                      )}
                    >
                      <PersonAvatar id={m.id} name={name} url={m.avatarUrl} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {m.id === myId ? t('you') : name}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t('noResults')}</p>
            )
          ) : !search.active ? null : search.loading ? (
            <div className="flex flex-col gap-3 px-3 py-3" aria-busy>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3.5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : search.error ? (
            <div className="flex items-center gap-3 px-4 py-3">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {t('tgHeader.searchFailed')}
              </p>
              <Button size="sm" variant="outline" onClick={search.retry}>
                {tCommon('retry')}
              </Button>
            </div>
          ) : results.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <MessageSquareText className="size-4 shrink-0" aria-hidden />
              {t('noResults')}
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('searchResults')}
              onScroll={(e) => {
                const el = e.currentTarget
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_EDGE_PX)
                  search.loadMore()
              }}
              className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain py-1"
            >
              {results.map((m, i) => (
                <li
                  key={m.id}
                  id={listbox.optionId(i)}
                  role="option"
                  aria-selected={i === search.index}
                  onPointerEnter={() => listbox.setActive(i)}
                  onClick={() => search.pick(i)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 px-3 py-2',
                    i === listbox.active && 'bg-muted',
                    i === search.index && 'bg-primary/10',
                  )}
                >
                  <PersonAvatar id={m.senderId} name={senderName(m)} url={m.sender.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {m.senderId === myId ? t('you') : senderName(m)}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {listTime(m.createdAt, locale)}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {highlightTerm(resultText(m) || t('attachment'), search.term)}
                    </p>
                  </div>
                </li>
              ))}
              {search.loadingMore && (
                <li className="flex justify-center py-2" aria-hidden>
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Нижняя панель поиска на телефоне (Telegram: footer MiddleSearch): автор, «3 из 57», «списком/в чате» и стрелки. Высота — как у панели ввода, которую она
 * заменяет, чтобы лента не прыгала при входе в поиск.
 */
export function ChatHeaderSearchFooter({
  search,
  isGroup,
}: {
  search: ChatHeaderSearchState
  isGroup: boolean
}) {
  const t = useTranslations('Chats')
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 border-t border-border bg-background px-2 py-2 pb-[max(0.5rem,calc(0.5rem+env(safe-area-inset-bottom)-var(--kb-inset,0px)))]">
      <div className="flex h-11 items-center gap-1">
        {isGroup && <SenderFilterButton search={search} />}
        <span className="flex min-w-0 flex-1 justify-center">
          <SearchCounter search={search} />
        </span>
        {search.total > 0 && (
          <button
            type="button"
            onClick={() => search.setListOpen(!search.listOpen)}
            aria-pressed={search.listOpen}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-4 focus-visible:ring-ring/20"
          >
            {search.listOpen ? (
              <MessageSquareText className="size-4" aria-hidden />
            ) : (
              <ListIcon className="size-4" aria-hidden />
            )}
            {search.listOpen ? t('tgHeader.searchAsChat') : t('tgHeader.searchAsList')}
          </button>
        )}
        <SearchArrows search={search} />
      </div>
    </div>
  )
}

/** «3 из 57» — после первого перехода; до него — сколько нашлось. */
function SearchCounter({ search }: { search: ChatHeaderSearchState }) {
  const t = useTranslations('Chats')
  if (!search.active || search.pickingSender) return null
  if (search.loading)
    return (
      <Loader2
        className="size-4 shrink-0 animate-spin text-muted-foreground"
        aria-label={t('tgHeader.searching')}
      />
    )
  if (search.error) return null
  const text =
    search.total === 0
      ? t('noResults')
      : search.index < 0
        ? t('tgHeader.searchFound', { count: search.total })
        : t('tgHeader.searchCounter', { current: search.index + 1, total: search.total })
  return (
    <span
      className="shrink-0 truncate px-1 text-sm tabular-nums whitespace-nowrap text-muted-foreground"
      aria-live="polite"
    >
      {text}
    </span>
  )
}

/** ↑ — старее, ↓ — новее (Telegram). Только когда есть по чему шагать. */
function SearchArrows({ search }: { search: ChatHeaderSearchState }) {
  const t = useTranslations('Chats')
  if (!search.active || search.pickingSender || search.total === 0) return null
  return (
    <>
      <ChatHeaderIconButton
        aria-label={t('tgHeader.searchOlder')}
        title={t('tgHeader.searchOlder')}
        onClick={() => void search.older()}
        disabled={!search.canOlder}
      >
        <ChevronUp aria-hidden />
      </ChatHeaderIconButton>
      <ChatHeaderIconButton
        aria-label={t('tgHeader.searchNewer')}
        title={t('tgHeader.searchNewer')}
        onClick={search.newer}
        disabled={!search.canNewer}
      >
        <ChevronDown aria-hidden />
      </ChatHeaderIconButton>
    </>
  )
}

function SenderFilterButton({ search }: { search: ChatHeaderSearchState }) {
  const t = useTranslations('Chats')
  const on = search.pickingSender || !!search.sender
  return (
    <ChatHeaderIconButton
      aria-label={t('searchFrom')}
      title={t('searchFrom')}
      aria-pressed={on}
      onClick={() => (on ? search.clearSender() : search.startPickSender())}
      className={cn(on && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
    >
      <UserSearch aria-hidden />
    </ChatHeaderIconButton>
  )
}

function PersonAvatar({ id, name, url }: { id: string; name: string; url: string | null }) {
  return (
    <Avatar className="size-9 shrink-0">
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className={cn('text-xs font-medium text-white', avatarColor(id))}>
        {chatInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

function fullName(m: ChatMemberInfo): string {
  return `${m.lastName} ${m.firstName}`.trim()
}

function resultText(m: ChatMessage): string {
  return plainPreview(m.content ?? '')
}

/**
 * Подсветка совпавшего фрагмента в строке выдачи. Первое вхождение, без регистра: строка
 * короткая, а подсвеченные все вхождения в двух строках — пестрота, из которой уже не
 * видно самого текста.
 */
function highlightTerm(text: string, term: string): ReactNode {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
        {text.slice(at, at + term.length)}
      </mark>
      {text.slice(at + term.length)}
    </>
  )
}
