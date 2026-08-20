'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react'
import { CHAT_FOLDER_LIMITS } from '@studenthub/shared-schemas'
import type { ChatFolder, ChatListItem } from '../../../entities/chat'
import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { chatTitle } from '../lib/format'

// Управление пользовательскими папками (§2). Отдельный лист, а не инлайн в списке чатов:
// сборка папки — это работа с галочками по всему списку, в узкой колонке она не помещается.
//
// Состав отправляется целиком (итоговый набор), а не дельтой — так же, как его принимает API.
export function ChatFoldersSheet({
  open,
  onOpenChange,
  folders,
  chats,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: ChatFolder[]
  chats: ChatListItem[]
  busy?: boolean
  onCreate: (input: { name: string; chatIds: string[] }) => void
  onUpdate: (id: string, input: { name?: string; chatIds?: string[] }) => void
  onDelete: (id: string) => void
}) {
  const t = useTranslations('Chats')
  // null — ничего не редактируем; 'new' — черновик новой папки; иначе id существующей.
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  function startNew() {
    setEditing('new')
    setName('')
    setPicked(new Set())
  }

  function startEdit(f: ChatFolder) {
    setEditing(f.id)
    setName(f.name)
    setPicked(new Set(f.chatIds))
  }

  function cancel() {
    setEditing(null)
    setName('')
    setPicked(new Set())
  }

  function toggleChat(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER) next.add(id)
      return next
    })
  }

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (editing === 'new') onCreate({ name: trimmed, chatIds: [...picked] })
    else if (editing) onUpdate(editing, { name: trimmed, chatIds: [...picked] })
    cancel()
  }

  const limitReached = folders.length >= CHAT_FOLDER_LIMITS.MAX_FOLDERS

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-3 sm:max-w-md">
        <SheetHeader className="p-0">
          <SheetTitle>{t('foldersTitle')}</SheetTitle>
          <SheetDescription>{t('foldersDescription')}</SheetDescription>
        </SheetHeader>

        {editing === null ? (
          <>
            <div className="flex flex-col gap-1.5">
              {folders.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t('foldersEmpty')}
                </p>
              )}
              {folders.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('foldersChatCount', { count: f.chatIds.length })}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={t('foldersRename')}
                    onClick={() => startEdit(f)}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('foldersDelete')}
                    disabled={busy}
                    onClick={() => onDelete(f.id)}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>

            <Button onClick={startNew} disabled={limitReached} className="gap-2">
              <FolderPlus className="size-4" aria-hidden />
              {t('foldersCreate')}
            </Button>
            {limitReached && (
              <p className="text-xs text-muted-foreground">
                {t('foldersLimit', { max: CHAT_FOLDER_LIMITS.MAX_FOLDERS })}
              </p>
            )}
          </>
        ) : (
          <>
            <Input
              autoFocus
              value={name}
              maxLength={CHAT_FOLDER_LIMITS.NAME_MAX}
              placeholder={t('foldersNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              aria-label={t('foldersNameLabel')}
            />

            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('foldersPickChats', { count: picked.size })}
            </p>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {chats.map((c) => {
                const on = picked.has(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChat(c.id)}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                      aria-hidden
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="truncate">{chatTitle(c, t)}</span>
                  </button>
                )
              })}
            </div>

            <div className="flex gap-2">
              <Button onClick={save} disabled={!name.trim() || busy} className="flex-1 gap-2">
                <Check className="size-4" aria-hidden />
                {t('foldersSave')}
              </Button>
              <Button variant="outline" onClick={cancel} className="gap-2">
                <X className="size-4" aria-hidden />
                {t('foldersCancel')}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
