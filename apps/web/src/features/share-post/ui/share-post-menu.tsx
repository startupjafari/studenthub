'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Check, Copy, Send, Share2 } from 'lucide-react'
import {
  ForwardDialog,
  chatKeys,
  fetchChats,
  sharePostRequest,
  type ChatListItem,
} from '../../../entities/chat'

function chatLabel(c: ChatListItem, tChats: (k: string) => string): string {
  return c.title || c.subject || tChats('typePrivate')
}

/** Постоянный адрес поста. На сервере window нет — там ссылка не нужна. */
export function postUrl(postId: string): string {
  return typeof window === 'undefined' ? '' : `${window.location.origin}/posts/${postId}`
}

/**
 * «Поделиться» постом: копировать ссылку, отправить в чат, системное меню устройства.
 *
 * Раньше кнопка сразу открывала пересылку в чат — то есть «поделиться» умело ровно
 * одно, и то внутри платформы. Ссылку дать было нельзя вовсе: постоянного адреса
 * у поста не существовало.
 *
 * Репост в меню НЕ входит: это публикация от своего имени со своей аудиторией,
 * а не отправка ссылки. У него отдельная кнопка.
 */
export function SharePostMenu({
  postId,
  className,
  label,
}: {
  postId: string
  className?: string
  /** Подпись рядом с иконкой; без неё кнопка — только иконка. */
  label?: string
}) {
  const t = useTranslations('Feed')
  const tChats = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [copied, setCopied] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Системное меню есть не везде: на десктопе в Firefox и Safari его нет.
  // Поэтому пункт условный, а «копировать ссылку» работает всегда.
  const [canNativeShare, setCanNativeShare] = useState(false)
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chats = useQuery({ queryKey: chatKeys.list(), queryFn: fetchChats, enabled: picking })
  const sendMut = useMutation({
    mutationFn: (chatId: string) => sharePostRequest(chatId, postId),
    onSuccess: () => {
      setPicking(false)
      toast.success(t('sharedToChat'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(postUrl(postId))
      setCopied(true)
      toast.success(t('linkCopied'))
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('copyFailed'))
    }
    setOpen(false)
  }

  async function nativeShare(): Promise<void> {
    setOpen(false)
    try {
      await navigator.share({ url: postUrl(postId) })
    } catch {
      // Пользователь закрыл системное меню — это не ошибка, молчим.
    }
  }

  const item =
    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted'

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-label={t('share')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('share')}
        onClick={() => setOpen((o) => !o)}
        className={className}
      >
        <Share2 className="size-5" aria-hidden />
        {label && <span className="hidden sm:inline">{label}</span>}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-1 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <button type="button" role="menuitem" className={item} onClick={() => void copyLink()}>
            {copied ? (
              <Check className="size-4 text-success" aria-hidden />
            ) : (
              <Copy className="size-4 text-muted-foreground" aria-hidden />
            )}
            {t('copyLink')}
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
            <Send className="size-4 text-muted-foreground" aria-hidden />
            {t('shareToChat')}
          </button>
          {canNativeShare && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => void nativeShare()}
            >
              <Share2 className="size-4 text-muted-foreground" aria-hidden />
              {t('shareMore')}
            </button>
          )}
        </div>
      )}

      {picking && (
        <ForwardDialog
          chats={chats.data ?? []}
          currentChatId={null}
          titleOf={(c) => chatLabel(c, tChats)}
          onPick={(chatId) => sendMut.mutate(chatId)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
