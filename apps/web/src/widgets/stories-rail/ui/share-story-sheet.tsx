'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Link2, Send } from 'lucide-react'
import { createChatRequest } from '../../../entities/chat'
import { fetchFriends, friendKeys } from '../../../entities/friendship'
import { shareStoryRequest } from '../../../entities/story'
import { toApiError } from '../../../shared/lib'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  Modal,
  Skeleton,
} from '../../../shared/ui'

// Сколько друзей показывать в окне отправки: это быстрый выбор, а не справочник.
const FRIENDS_LIMIT = 50

/**
 * «Поделиться сторис»: ссылка и отправка другу в личный чат. Сервер пропускает пересылку,
 * только если получатель сам видит сторис, — окно лишь предлагает, решает он.
 */
export function ShareStorySheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const t = useTranslations('Stories')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const [sending, setSending] = useState<string | null>(null)
  const [sent, setSent] = useState<Set<string>>(() => new Set())
  const friends = useQuery({
    queryKey: friendKeys.list(FRIENDS_LIMIT),
    queryFn: () => fetchFriends(FRIENDS_LIMIT),
  })

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/stories/${storyId}`)
      toast.success(t('linkCopied'))
    } catch {
      toast.error(tErr('INTERNAL_ERROR'))
    }
  }

  async function sendTo(userId: string, name: string): Promise<void> {
    setSending(userId)
    try {
      const chat = await createChatRequest({ type: 'PRIVATE', memberIds: [userId] })
      await shareStoryRequest(chat.id, storyId)
      setSent((prev) => new Set(prev).add(userId))
      toast.success(t('shareSent', { name }))
    } catch (e) {
      const code = toApiError(e).code
      toast.error(code === 'FORBIDDEN' ? t('shareForbidden') : tErr(code))
    } finally {
      setSending(null)
    }
  }

  return (
    <Modal onClose={onClose} title={t('shareTitle')} size="md">
      <div className="flex flex-col gap-4">
        <Button type="button" variant="outline" onClick={() => void copyLink()}>
          <Link2 className="size-4" aria-hidden />
          {t('copyLink')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('shareHint')}</p>
        {friends.isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : friends.isError ? (
          <EmptyState
            title={tErr('INTERNAL_ERROR')}
            className="border-0 p-6"
            action={
              <Button type="button" variant="outline" onClick={() => void friends.refetch()}>
                {tCommon('retry')}
              </Button>
            }
          />
        ) : (friends.data ?? []).length === 0 ? (
          <EmptyState title={t('shareNoFriends')} className="border-0 p-6" />
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {(friends.data ?? []).map(({ user }) => {
              const name = `${user.lastName} ${user.firstName}`
              const done = sent.has(user.id)
              return (
                <li key={user.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                  <Avatar className="size-9">
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                    <AvatarFallback>
                      {user.firstName.charAt(0)}
                      {user.lastName.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={done ? 'outline' : 'default'}
                    disabled={done}
                    loading={sending === user.id}
                    onClick={() => void sendTo(user.id, name)}
                  >
                    {done ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
                    {t('sendReply')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
