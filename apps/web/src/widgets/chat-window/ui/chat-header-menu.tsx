'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  BellOff,
  SquareCheckBig,
  Download,
  Eraser,
  Flag,
  Loader2,
  LogOut,
  MoreVertical,
  Search,
  Trash2,
} from 'lucide-react'
import type { ChatListItem } from '../../../entities/chat'
import { ReportModal } from '../../../features/report-content'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useConfirm,
} from '../../../shared/ui'
import { canDeleteChat } from '../lib/chat-kind'
import { ChatHeaderIconButton } from './chat-header-button'

// §17: на сколько заглушить. Тот же набор, что в панели деталей чата.
const MUTE_FOR: { key: MuteKey; minutes?: number }[] = [
  { key: 'mute1h', minutes: 60 },
  { key: 'mute4h', minutes: 240 },
  { key: 'mute8h', minutes: 480 },
  { key: 'mute1d', minutes: 1440 },
  { key: 'mute3d', minutes: 4320 },
  { key: 'muteForever' },
]
type MuteKey = 'mute1h' | 'mute4h' | 'mute8h' | 'mute1d' | 'mute3d' | 'muteForever'

/**
 * Меню «три точки» шапки переписки (Telegram: HeaderMenu).
 *
 * Порядок как в Telegram: поиск (только на телефоне — на ПК у него своя кнопка в шапке),
 * звук, выбор сообщений, затем свои пункты (архив, выгрузка), жалоба и очистка истории;
 * опасное — блокировка, удаление, выход — в самом конце за линией (DESIGN_SYSTEM §9).
 *
 * Меню на Radix: стрелки, Home/End, поиск по первой букве, Escape и возврат фокуса на
 * кнопку достаются даром — у прежнего самодельного списка с клавиатуры не работало ничего.
 */
export function ChatHeaderMenu({
  chat,
  title,
  peerId,
  canReport,
  exporting,
  showSearch,
  onSearch,
  onMute,
  onUnmute,
  onSelect,
  onToggleArchive,
  onExport,
  onToggleBlock,
  onClearHistory,
  onDelete,
}: {
  chat: ChatListItem
  title: string
  /** Собеседник личного чата — для блокировки и жалобы. */
  peerId?: string
  /** Роль может подавать жалобы (COMPLAINT_REPORTER_ROLES). */
  canReport: boolean
  exporting: boolean
  /** Пункт «Поиск» — на телефоне: на ПК у поиска своя кнопка в шапке. */
  showSearch: boolean
  onSearch: () => void
  onMute: (minutes?: number) => void
  onUnmute: () => void
  onSelect: () => void
  onToggleArchive: () => void
  onExport: () => void
  onToggleBlock: () => void
  onClearHistory: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Chats')
  const confirm = useConfirm()
  const [reportOpen, setReportOpen] = useState(false)
  const isPrivate = chat.type === 'PRIVATE'
  const canBlock = isPrivate && !!peerId
  // Жалоба — на человека: у схемы жалоб нет цели «чат», поэтому только в личном чате.
  const canReportPeer = canReport && isPrivate && !!peerId
  const deletable = canDeleteChat(chat.type)
  // Группа не своя — это выход из неё (сервер на «удалить» выводит участника), своя —
  // удаление для всех, личный чат — скрыть у себя.
  const deleteKind: 'chat' | 'group' | 'leave' = isPrivate
    ? 'chat'
    : chat.isOwner
      ? 'group'
      : 'leave'

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <ChatHeaderIconButton aria-label={t('tgHeader.moreActions')}>
            <MoreVertical aria-hidden />
          </ChatHeaderIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 shadow-lg">
          {showSearch && (
            <DropdownMenuItem onSelect={onSearch}>
              <Search aria-hidden />
              {t('searchInChat')}
            </DropdownMenuItem>
          )}
          {chat.muted ? (
            <DropdownMenuItem onSelect={onUnmute}>
              <Bell aria-hidden />
              {t('unmute')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BellOff className="size-4 shrink-0 opacity-70" aria-hidden />
                {t('mute')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="shadow-lg">
                {MUTE_FOR.map((d) => (
                  <DropdownMenuItem key={d.key} onSelect={() => onMute(d.minutes)}>
                    {t(d.key)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onSelect={onSelect}>
            <SquareCheckBig aria-hidden />
            {t('tgHeader.selectMessages')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleArchive}>
            {chat.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {chat.archived ? t('unarchive') : t('archive')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={exporting} onSelect={onExport}>
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {t('export')}
          </DropdownMenuItem>
          {/* «Разблокировать» не красный — остаётся среди обычных пунктов. */}
          {canBlock && chat.blocked && (
            <DropdownMenuItem onSelect={onToggleBlock}>
              <Ban aria-hidden />
              {t('unblockUser')}
            </DropdownMenuItem>
          )}
          {canReportPeer && (
            <DropdownMenuItem onSelect={() => setReportOpen(true)}>
              <Flag aria-hidden />
              {t('report')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              void confirm({ title: t('clearHistoryConfirm'), destructive: true }).then((ok) => {
                if (ok) onClearHistory()
              })
            }}
          >
            <Eraser aria-hidden />
            {t('clearHistory')}
          </DropdownMenuItem>
          {((canBlock && !chat.blocked) || deletable) && <DropdownMenuSeparator />}
          {canBlock && !chat.blocked && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                void confirm({
                  title: t('tgHeader.blockConfirm', { name: title }),
                  confirmLabel: t('blockUser'),
                  destructive: true,
                }).then((ok) => {
                  if (ok) onToggleBlock()
                })
              }}
            >
              <Ban aria-hidden />
              {t('blockUser')}
            </DropdownMenuItem>
          )}
          {deletable && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                const confirmTitle =
                  deleteKind === 'group'
                    ? t('deleteGroupConfirm')
                    : deleteKind === 'leave'
                      ? t('tgHeader.leaveGroupConfirm', { title })
                      : t('deleteChatConfirm')
                void confirm({ title: confirmTitle, destructive: true }).then((ok) => {
                  if (ok) onDelete()
                })
              }}
            >
              {deleteKind === 'leave' ? <LogOut aria-hidden /> : <Trash2 aria-hidden />}
              {deleteKind === 'group'
                ? t('deleteGroup')
                : deleteKind === 'leave'
                  ? t('tgHeader.leaveGroup')
                  : t('deleteChat')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {reportOpen && peerId && (
        <ReportModal
          targetType="USER"
          targetId={peerId}
          preview={title}
          onClose={() => setReportOpen(false)}
        />
      )}
    </>
  )
}
