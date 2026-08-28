'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { joinChatRequest } from '../../../entities/chat'
import { ROLE_HOME } from '../../../shared/config/routes'

// Читаем нечувствительную role-cookie (sh_role) на клиенте, чтобы определить путь к чатам роли.
function chatsPathFromCookie(): string {
  if (typeof document === 'undefined') return '/chats'
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith('sh_role='))
    ?.split('=')[1]
  try {
    if (raw) {
      const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
      const parsed = JSON.parse(atob(padded)) as { role?: Role }
      const home = parsed.role && parsed.role in ROLE_HOME ? ROLE_HOME[parsed.role] : '/'
      return home === '/' ? '/chats' : `${home}/chats`
    }
  } catch {
    /* битая cookie — на общий путь */
  }
  return '/chats'
}

// Приземление по ссылке-приглашению в группу: присоединяемся и уходим к чатам роли.
export default function JoinChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const t = useTranslations('Chats')
  const [error, setError] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    joinChatRequest(id)
      .then(() => router.replace(chatsPathFromCookie()))
      .catch(() => setError(true))
  }, [id, router])

  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-center">
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('joinFailed')}</p>
          <button
            type="button"
            onClick={() => router.replace(chatsPathFromCookie())}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('title')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-hidden />
          <p className="text-sm">{t('joining')}</p>
        </div>
      )}
    </div>
  )
}
