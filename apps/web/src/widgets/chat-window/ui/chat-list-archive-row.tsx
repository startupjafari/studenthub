'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Archive, ChevronsDownUp, ChevronsUpDown, EyeOff } from 'lucide-react'
import type { ChatListItem } from '../../../entities/chat'
import { RowContextMenu, captureAnchor, type MenuAnchor } from '../../../shared/ui'
import { hapticTick } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { chatTitle } from '../lib/format'
import type { ArchiveRowMode } from '../lib/archive-row-mode'
import { isChatUnread } from './chat-list-row'

/** Сколько названий архивных чатов перечислять в подзаголовке — дальше строка всё равно обрезана. */
const PREVIEW_TITLES = 8
/** Столько держат палец до меню — как у строк чатов. */
const LONG_PRESS_MS = 450

/**
 * Строка «Архив» над списком «Все» — как в Telegram: не вкладка среди папок, а отдельная
 * строка того же роста, что и чаты. В подзаголовке — названия архивных чатов через запятую,
 * непрочитанные — ярче; справа серый счётчик чатов с непрочитанным (архив заглушён по смыслу:
 * его убрали с глаз, и синий счётчик звал бы туда, откуда человек сам ушёл).
 *
 * Правый клик или долгое нажатие — меню вида, как в Telegram: свернуть строку в узкую полоску,
 * развернуть обратно или скрыть совсем (тогда архив — пункт меню списка). Вид помнит
 * `useArchiveRowMode`; скрытую строку сюда не рендерят вовсе.
 */
export function ChatListArchiveRow({
  chats,
  mode,
  onOpen,
  onModeChange,
}: {
  /** Архивные чаты в порядке списка. */
  chats: ChatListItem[]
  mode: Exclude<ArchiveRowMode, 'hidden'>
  onOpen: () => void
  onModeChange: (mode: ArchiveRowMode) => void
}) {
  const t = useTranslations('Chats')
  const unreadChats = chats.filter(isChatUnread).length
  const titles = chats.slice(0, PREVIEW_TITLES)
  const [menu, setMenu] = useState<{ x: number; y: number; anchor?: MenuAnchor } | null>(null)
  const press = useRef<{ x: number; y: number; timer: number | null; fired: boolean } | null>(null)
  const collapsed = mode === 'collapsed'

  const counter = unreadChats > 0 && (
    <span
      className="flex h-[1.375rem] min-w-[1.375rem] shrink-0 items-center justify-center rounded-full bg-muted-foreground/60 px-1.5 text-xs font-medium tabular-nums text-white"
      aria-label={t('tgList.archiveUnread', { n: unreadChats })}
    >
      {unreadChats}
    </span>
  )

  return (
    <div className="shrink-0">
      <button
        type="button"
        data-long-press=""
        onClick={() => {
          // Палец вызывал меню, а не открывал архив.
          if (press.current?.fired) {
            press.current = null
            return
          }
          onOpen()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          // Android шлёт contextmenu поверх нашего долгого нажатия — меню уже открыто.
          if (press.current?.fired) return
          const box = e.currentTarget.getBoundingClientRect()
          const keyboard = e.clientX === 0 && e.clientY === 0
          setMenu({
            x: keyboard ? box.left + 24 : e.clientX,
            y: keyboard ? box.bottom : e.clientY,
          })
        }}
        onTouchStart={(e) => {
          const tch = e.touches[0]
          if (!tch) return
          const el = e.currentTarget
          const state = {
            x: tch.clientX,
            y: tch.clientY,
            timer: null as number | null,
            fired: false,
          }
          state.timer = window.setTimeout(() => {
            state.timer = null
            state.fired = true
            hapticTick()
            const box = el.getBoundingClientRect()
            setMenu({ x: box.left + 24, y: box.bottom, anchor: captureAnchor(el) })
          }, LONG_PRESS_MS)
          press.current = state
        }}
        onTouchMove={(e) => {
          const s = press.current
          const tch = e.touches[0]
          if (!s || !tch || s.timer === null) return
          if (Math.abs(tch.clientX - s.x) > 8 || Math.abs(tch.clientY - s.y) > 8) {
            window.clearTimeout(s.timer)
            s.timer = null
          }
        }}
        onTouchEnd={() => {
          const s = press.current
          if (s?.timer != null) window.clearTimeout(s.timer)
          if (s && !s.fired) press.current = null
        }}
        className={cn(
          'flex w-full cursor-pointer items-center bg-background text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 active:bg-accent lg:rounded-xl',
          collapsed ? 'gap-2 px-3 py-1.5' : 'gap-3 px-2 py-[0.5625rem]',
          menu && 'bg-muted',
        )}
      >
        {collapsed ? (
          <>
            <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
              {t('tgList.archiveTitle')}
            </span>
            {counter}
          </>
        ) : (
          <>
            <span
              className="flex size-[3.375rem] shrink-0 items-center justify-center rounded-full bg-muted-foreground/60 text-white"
              aria-hidden
            >
              <Archive className="size-6" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-base font-medium leading-6">
                {t('tgList.archiveTitle')}
              </span>
              <div className="flex items-center gap-1.5">
                <p className="min-w-0 flex-1 truncate text-sm leading-5 text-muted-foreground">
                  {titles.map((c, i) => (
                    <span key={c.id}>
                      <span className={cn(isChatUnread(c) && 'font-medium text-foreground')}>
                        {chatTitle(c, t)}
                      </span>
                      {i < titles.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
                {counter}
              </div>
            </div>
          </>
        )}
      </button>
      {menu && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          ariaLabel={t('tgList.archiveTitle')}
          onClose={() => {
            setMenu(null)
            press.current = null
          }}
          items={[
            collapsed
              ? {
                  key: 'archive-expand',
                  icon: ChevronsUpDown,
                  label: t('tgListHeader.archiveExpand'),
                  onClick: () => onModeChange('expanded'),
                }
              : {
                  key: 'archive-collapse',
                  icon: ChevronsDownUp,
                  label: t('tgListHeader.archiveCollapse'),
                  onClick: () => onModeChange('collapsed'),
                },
            {
              key: 'archive-hide',
              icon: EyeOff,
              label: t('tgListHeader.archiveHide'),
              onClick: () => onModeChange('hidden'),
            },
          ]}
        />
      )}
    </div>
  )
}
