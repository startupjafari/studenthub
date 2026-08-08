'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Copy, Send, Share2 } from 'lucide-react'
import { Button } from '../../../shared/ui'
import {
  ForwardDialog,
  chatKeys,
  fetchChats,
  sendMessageWithAttachments,
  type ChatListItem,
} from '../../../entities/chat'

function chatLabel(c: ChatListItem, tChats: (k: string) => string): string {
  return c.title || c.subject || tChats('typePrivate')
}

const MENU_W = 208

interface MenuPos {
  left: number
  top?: number
  bottom?: number
}

// «Поделиться» профилем: меню с «Скопировать ссылку» и «Отправить в чат» (ссылка на профиль).
// Меню — в портал (шапка профиля имеет overflow-hidden, иначе меню обрезается).
export function ShareProfileButton({
  userId,
  name,
  className,
}: {
  userId: string
  name: string
  className?: string
}) {
  const t = useTranslations('Profile')
  const tChats = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const url = typeof window !== 'undefined' ? `${window.location.origin}/profile/${userId}` : ''

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      const margin = 8
      const left = Math.min(Math.max(margin, r.right - MENU_W), window.innerWidth - MENU_W - margin)
      const below = window.innerHeight - r.bottom - margin
      const openUp = below < 130 && r.top > below
      setPos({
        left,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      })
    }
    place()
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chats = useQuery({ queryKey: chatKeys.list(), queryFn: fetchChats, enabled: picking })
  const sendMut = useMutation({
    mutationFn: (chatId: string) =>
      sendMessageWithAttachments(chatId, { content: `${name}\n${url}` }, []),
    onSuccess: () => {
      setPicking(false)
      toast.success(t('sharedProfileToChat'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  function copyLink(): void {
    navigator.clipboard.writeText(url).then(
      () => toast.success(t('linkCopied')),
      () => toast.error(t('copyFailed')),
    )
    setOpen(false)
  }

  const item =
    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:bg-muted'

  return (
    <>
      <Button
        ref={btnRef}
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('share')}
        onClick={() => setOpen((o) => !o)}
        className={className}
      >
        <Share2 className="size-4" aria-hidden />
        <span className="hidden sm:inline">{t('share')}</span>
      </Button>

      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: MENU_W,
            }}
            className="z-[200] overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <button type="button" role="menuitem" className={item} onClick={copyLink}>
              <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {t('shareCopyLink')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false)
                setPicking(true)
              }}
            >
              <Send className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {t('shareToChat')}
            </button>
          </div>,
          document.body,
        )}

      {picking && (
        <ForwardDialog
          chats={chats.data ?? []}
          currentChatId={null}
          titleOf={(c) => chatLabel(c, tChats)}
          onPick={(id) => sendMut.mutate(id)}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}
