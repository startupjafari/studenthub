'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, ShieldBan, ShieldOff, UserX } from 'lucide-react'
import {
  chatKeys,
  blockUserRequest,
  fetchBlockedUsers,
  unblockUserRequest,
} from '../../../entities/chat'
import { directoryKeys, fetchUserDirectory, type DirectoryUser } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage, RowContextMenu, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { identityColor } from '../../../shared/lib'
import { ColumnPanel, PanelHeader, PanelHeaderButton, PanelSearch } from './column-panel'

// Чёрный список — экран левой колонки (см. ColumnPanel), а не окно поверх списка чатов.
//
// Два экрана: сами блокировки и выбор человека, которого блокируют. Разблокировка живёт в
// контекстном меню строки, как и все действия над строками списков в продукте: кнопка
// «Разблокировать» в каждой строке читалась как призыв её нажать, хотя заблокировали
// человека осознанно.

export function BlockedUsersPanel({
  embedded,
  hidden,
  onClose,
}: {
  embedded: boolean
  hidden: boolean
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)

  const blocked = useQuery({ queryKey: chatKeys.blocked(), queryFn: fetchBlockedUsers })
  const list = blocked.data ?? []

  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: chatKeys.blocked() })
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  }

  const unblock = useMutation({
    mutationFn: (userId: string) => unblockUserRequest(userId),
    onSuccess: () => {
      invalidate()
      toast.success(t('userUnblocked'))
    },
    onError: err,
  })

  const block = useMutation({
    mutationFn: (userId: string) => blockUserRequest(userId),
    onSuccess: () => {
      invalidate()
      toast.success(t('userBlocked'))
      setAdding(false)
    },
    onError: err,
  })

  // Открытая строка: меню и подсветка. RowContextMenu сам строку не подсвечивает — он не
  // знает, как она выглядит; подсветку обязан дать вызывающий экран.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const openMenu = (e: React.MouseEvent<HTMLElement>, id: string): void => {
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    // Клавиша «контекстное меню» шлёт событие с координатами 0,0 — там меню встало бы
    // в угол экрана, а не у строки.
    const keyboard = e.clientX === 0 && e.clientY === 0
    setMenu({
      id,
      x: keyboard ? box.left + 24 : e.clientX,
      y: keyboard ? box.bottom : e.clientY,
    })
  }

  if (adding) {
    return (
      <ColumnPanel embedded={embedded} hidden={hidden}>
        <BlockPickScreen
          excludeIds={list.map((u) => u.id)}
          busyId={block.isPending ? (block.variables ?? null) : null}
          onBack={() => setAdding(false)}
          onPick={(u) => block.mutate(u.id)}
        />
      </ColumnPanel>
    )
  }

  return (
    <ColumnPanel embedded={embedded} hidden={hidden}>
      <PanelHeader
        title={t('blockedTitle')}
        onBack={onClose}
        action={
          <PanelHeaderButton label={t('blockedAdd')} onClick={() => setAdding(true)}>
            <Plus className="size-5" aria-hidden />
          </PanelHeaderButton>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-4">
        {/* Блок держит всю оставшуюся высоту колонки и прокручивается внутри рамки: список
            блокировок то пустой, то в полсотни строк, и рамка не должна за ним прыгать. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
          {blocked.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
              <UserX className="size-6" aria-hidden />
              {t('blockedEmpty')}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.map((u, i) => (
                <li
                  key={u.id}
                  onContextMenu={(e) => openMenu(e, u.id)}
                  className={cn(
                    'flex cursor-context-menu items-center gap-3 px-3 py-2 transition-colors',
                    i > 0 && 'border-t border-border',
                    menu?.id === u.id ? 'bg-primary/10' : 'hover:bg-muted/50',
                  )}
                >
                  <Avatar className="size-10 shrink-0">
                    {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
                    <AvatarFallback
                      className={cn('text-xs font-medium text-white', identityColor(u.id))}
                    >
                      {`${u.lastName[0] ?? ''}${u.firstName[0] ?? ''}`.toUpperCase() || '#'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {u.lastName} {u.firstName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {menu && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t('blockedTitle')}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'unblock',
              icon: ShieldOff,
              label: t('unblockUser'),
              onClick: () => unblock.mutate(menu.id),
            },
          ]}
        />
      )}
    </ColumnPanel>
  )
}

// ── Экран выбора: кого заблокировать ─────────────────────────────────────────
/**
 * Люди из круга общения (GET /users/directory): без запроса — друзья и одногруппники,
 * с запросом — поиск по своему вузу. Отдельного «списка тех, с кем я переписывался» у API
 * нет, а список чатов id собеседника не отдаёт — по нему человека не заблокировать.
 */
function BlockPickScreen({
  excludeIds,
  busyId,
  onBack,
  onPick,
}: {
  excludeIds: string[]
  busyId: string | null
  onBack: () => void
  onPick: (user: DirectoryUser) => void
}) {
  const t = useTranslations('Chats')
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  // Справочник ходит на сервер на каждый терм — дебаунсим, как поиск в чатах.
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])

  const people = useQuery({
    queryKey: directoryKeys.search(term),
    queryFn: () => fetchUserDirectory(term),
  })
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds])
  const items = (people.data?.items ?? []).filter((u) => !exclude.has(u.id))

  return (
    <>
      <PanelHeader title={t('blockedAdd')} onBack={onBack} />
      <PanelSearch value={query} onChange={setQuery} placeholder={t('search')} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
          {people.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {t('noResults')}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {items.map((u, i) => (
                <li key={u.id} className={cn(i > 0 && 'border-t border-border')}>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => onPick(u)}
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                  >
                    <Avatar className="size-10 shrink-0">
                      {u.avatarThumbUrl && <AvatarImage src={u.avatarThumbUrl} alt="" />}
                      <AvatarFallback
                        className={cn('text-xs font-medium text-white', identityColor(u.id))}
                      >
                        {`${u.lastName[0] ?? ''}${u.firstName[0] ?? ''}`.toUpperCase() || '#'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {u.lastName} {u.firstName}
                      </span>
                      {u.headline && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.headline}
                        </span>
                      )}
                    </span>
                    <ShieldBan className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
